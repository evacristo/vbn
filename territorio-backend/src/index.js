const encoder = new TextEncoder();
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/health') return json({ ok: true, service: 'corrientes-territorial-api', version: '0.1.0' }, 200, cors);
      if (url.pathname === '/api/login' && request.method === 'POST') return login(request, env, cors);
      if (url.pathname === '/api/logout' && request.method === 'POST') return logout(request, env, cors);
      if (url.pathname === '/api/admin/users' && request.method === 'POST') return createUser(request, env, cors);

      const auth = await authenticate(request, env);
      if (!auth) return json({ error: 'unauthorized' }, 401, cors);
      if (url.pathname === '/api/me' && request.method === 'GET') return json({ user: publicUser(auth.user), session: { deviceId: auth.session.device_id, expiresAt: auth.session.expires_at } }, 200, cors);
      if (url.pathname === '/api/sync/pull' && request.method === 'GET') return pullWorkspace(auth, env, cors);
      if (url.pathname === '/api/sync/push' && request.method === 'POST') return pushWorkspace(request, auth, env, cors);
      if (url.pathname === '/api/history' && request.method === 'GET') return workspaceHistory(auth, env, cors);
      if (url.pathname === '/api/files' && request.method === 'GET') return listFiles(url, auth, env, cors);
      if (url.pathname === '/api/files' && request.method === 'POST') return uploadFile(request, auth, env, cors);
      if (url.pathname.startsWith('/api/files/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/files/'.length));
        if (request.method === 'GET') return downloadFile(id, auth, env, cors);
        if (request.method === 'DELETE') return deleteFile(id, auth, env, cors);
      }
      return json({ error: 'not_found' }, 404, cors);
    } catch (error) {
      console.error(error);
      return json({ error: 'internal_error', message: error instanceof Error ? error.message : String(error) }, 500, cors);
    }
  },
};

function corsHeaders(origin, allowed) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Bootstrap-Secret,X-File-Name,X-Visit-Id,X-File-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  const allowList = String(allowed || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (origin && (allowList.includes(origin) || allowList.includes('*'))) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...jsonHeaders, ...extra, 'Cache-Control': 'no-store' } });
}

async function login(request, env, cors) {
  const body = await readJson(request, 32_000);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return json({ error: 'missing_credentials' }, 400, cors);
  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND active = 1').bind(username).first();
  if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
    await audit(env, null, null, 'login_failed', { username });
    return json({ error: 'invalid_credentials' }, 401, cors);
  }
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const now = new Date();
  const ttlDays = Math.max(1, Number(env.SESSION_TTL_DAYS || 30));
  const expires = new Date(now.getTime() + ttlDays * 86400000).toISOString();
  const sessionId = crypto.randomUUID();
  const deviceId = String(body.deviceId || '').slice(0, 120);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (id,user_id,token_hash,device_id,user_agent,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').bind(sessionId, user.id, tokenHash, deviceId, request.headers.get('User-Agent') || '', now.toISOString(), expires),
    env.DB.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').bind(now.toISOString(), now.toISOString(), user.id),
  ]);
  await audit(env, user.id, sessionId, 'login_success', { deviceId });
  const cookie = `ct_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${ttlDays * 86400}`;
  return json({ token, expiresAt: expires, user: publicUser(user) }, 200, { ...cors, 'Set-Cookie': cookie });
}

async function logout(request, env, cors) {
  const auth = await authenticate(request, env);
  if (auth) {
    await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').bind(new Date().toISOString(), auth.session.id).run();
    await audit(env, auth.user.id, auth.session.id, 'logout', {});
  }
  return json({ ok: true }, 200, { ...cors, 'Set-Cookie': 'ct_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0' });
}

async function createUser(request, env, cors) {
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
  const count = Number(countRow?.count || 0);
  const auth = await authenticate(request, env);
  const bootstrap = request.headers.get('X-Bootstrap-Secret') || '';
  const allowed = auth?.user?.role === 'admin' || (count === 0 && env.BOOTSTRAP_SECRET && timingSafeEqual(bootstrap, env.BOOTSTRAP_SECRET));
  if (!allowed) return json({ error: 'forbidden' }, 403, cors);
  const body = await readJson(request, 32_000);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const role = ['admin', 'editor', 'viewer'].includes(body.role) ? body.role : 'editor';
  if (username.length < 2 || password.length < 3) return json({ error: 'invalid_user' }, 400, cors);
  const salt = randomToken(16);
  const passwordHash = await hashPassword(password, salt);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id,username,password_hash,salt,role,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)').bind(id, username, passwordHash, salt, role, now, now),
      env.DB.prepare('INSERT INTO workspaces (user_id,revision,data_json,updated_at) VALUES (?,0,?,?)').bind(id, JSON.stringify({ version: 3, user: username }), now),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) return json({ error: 'username_exists' }, 409, cors);
    throw error;
  }
  await audit(env, auth?.user?.id || id, auth?.session?.id || null, 'user_created', { createdUserId: id, username, role });
  return json({ user: { id, username, role, active: true } }, 201, cors);
}

async function authenticate(request, env) {
  let token = '';
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) token = auth.slice(7).trim();
  if (!token) token = readCookie(request.headers.get('Cookie') || '', 'ct_session');
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`SELECT s.*, u.username, u.role, u.active, u.created_at AS user_created_at, u.updated_at AS user_updated_at
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.active=1`).bind(tokenHash, now).first();
  if (!row) return null;
  return {
    session: row,
    user: { id: row.user_id, username: row.username, role: row.role, active: Boolean(row.active), created_at: row.user_created_at, updated_at: row.user_updated_at },
  };
}

async function pullWorkspace(auth, env, cors) {
  let row = await env.DB.prepare('SELECT revision,data_json,updated_at FROM workspaces WHERE user_id=?').bind(auth.user.id).first();
  if (!row) {
    const now = new Date().toISOString();
    await env.DB.prepare('INSERT INTO workspaces (user_id,revision,data_json,updated_at) VALUES (?,0,?,?)').bind(auth.user.id, JSON.stringify({ version: 3, user: auth.user.username }), now).run();
    row = { revision: 0, data_json: JSON.stringify({ version: 3, user: auth.user.username }), updated_at: now };
  }
  await audit(env, auth.user.id, auth.session.id, 'workspace_pull', { revision: row.revision });
  return json({ workspace: safeParse(row.data_json, {}), revision: Number(row.revision || 0), updatedAt: row.updated_at }, 200, cors);
}

async function pushWorkspace(request, auth, env, cors) {
  if (auth.user.role === 'viewer') return json({ error: 'read_only' }, 403, cors);
  const body = await readJson(request, 1_800_000);
  const workspace = body.workspace;
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) return json({ error: 'invalid_workspace' }, 400, cors);
  const serialized = JSON.stringify(workspace);
  if (serialized.length > 1_500_000) return json({ error: 'workspace_too_large' }, 413, cors);
  const current = await env.DB.prepare('SELECT revision,data_json FROM workspaces WHERE user_id=?').bind(auth.user.id).first();
  const serverRevision = Number(current?.revision || 0);
  const clientRevision = Number(body.revision || 0);
  if (current && clientRevision < serverRevision && !body.force) {
    return json({ error: 'revision_conflict', revision: serverRevision, workspace: safeParse(current.data_json, {}) }, 409, cors);
  }
  const revision = serverRevision + 1;
  const now = new Date().toISOString();
  const statements = [];
  if (current) {
    statements.push(env.DB.prepare('INSERT INTO workspace_history (id,user_id,revision,data_json,created_at,session_id) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), auth.user.id, serverRevision, current.data_json, now, auth.session.id));
    statements.push(env.DB.prepare('UPDATE workspaces SET revision=?,data_json=?,updated_at=?,updated_by_session=? WHERE user_id=?').bind(revision, serialized, now, auth.session.id, auth.user.id));
  } else {
    statements.push(env.DB.prepare('INSERT INTO workspaces (user_id,revision,data_json,updated_at,updated_by_session) VALUES (?,?,?,?,?)').bind(auth.user.id, revision, serialized, now, auth.session.id));
  }
  await env.DB.batch(statements);
  await audit(env, auth.user.id, auth.session.id, 'workspace_push', { revision, deviceId: body.deviceId || null });
  return json({ ok: true, revision, updatedAt: now }, 200, cors);
}

async function workspaceHistory(auth, env, cors) {
  const rows = await env.DB.prepare('SELECT revision,created_at,session_id FROM workspace_history WHERE user_id=? ORDER BY revision DESC LIMIT 20').bind(auth.user.id).all();
  return json({ history: rows.results || [] }, 200, cors);
}

async function uploadFile(request, auth, env, cors) {
  if (auth.user.role === 'viewer') return json({ error: 'read_only' }, 403, cors);
  const size = Number(request.headers.get('Content-Length') || 0);
  if (size > 12 * 1024 * 1024) return json({ error: 'file_too_large' }, 413, cors);
  const id = request.headers.get('X-File-Id') || crypto.randomUUID();
  const filename = decodeURIComponent(request.headers.get('X-File-Name') || 'archivo');
  const visitId = request.headers.get('X-Visit-Id') || '';
  const type = request.headers.get('Content-Type') || 'application/octet-stream';
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 12 * 1024 * 1024) return json({ error: 'file_too_large' }, 413, cors);
  const key = `${auth.user.id}/${id}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { filename, visitId } });
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT OR REPLACE INTO file_metadata (id,user_id,visit_id,filename,mime_type,size_bytes,created_at,deleted_at) VALUES (?,?,?,?,?,?,?,NULL)').bind(id, auth.user.id, visitId, filename, type, bytes.byteLength, now).run();
  await audit(env, auth.user.id, auth.session.id, 'file_uploaded', { id, visitId, filename, size: bytes.byteLength });
  return json({ id, filename, visitId, mimeType: type, size: bytes.byteLength, createdAt: now }, 201, cors);
}

async function listFiles(url, auth, env, cors) {
  const visitId = url.searchParams.get('visitId');
  const query = visitId
    ? env.DB.prepare('SELECT id,visit_id,filename,mime_type,size_bytes,created_at FROM file_metadata WHERE user_id=? AND visit_id=? AND deleted_at IS NULL ORDER BY created_at DESC').bind(auth.user.id, visitId)
    : env.DB.prepare('SELECT id,visit_id,filename,mime_type,size_bytes,created_at FROM file_metadata WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200').bind(auth.user.id);
  const rows = await query.all();
  return json({ files: rows.results || [] }, 200, cors);
}

async function downloadFile(id, auth, env, cors) {
  const meta = await env.DB.prepare('SELECT * FROM file_metadata WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(id, auth.user.id).first();
  if (!meta) return json({ error: 'file_not_found' }, 404, cors);
  const object = await env.FILES.get(`${auth.user.id}/${id}`);
  if (!object) return json({ error: 'file_not_found' }, 404, cors);
  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`);
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(object.body, { headers });
}

async function deleteFile(id, auth, env, cors) {
  if (auth.user.role === 'viewer') return json({ error: 'read_only' }, 403, cors);
  const meta = await env.DB.prepare('SELECT id FROM file_metadata WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(id, auth.user.id).first();
  if (!meta) return json({ error: 'file_not_found' }, 404, cors);
  await env.FILES.delete(`${auth.user.id}/${id}`);
  await env.DB.prepare('UPDATE file_metadata SET deleted_at=? WHERE id=? AND user_id=?').bind(new Date().toISOString(), id, auth.user.id).run();
  await audit(env, auth.user.id, auth.session.id, 'file_deleted', { id });
  return json({ ok: true }, 200, cors);
}

async function audit(env, userId, sessionId, action, detail) {
  await env.DB.prepare('INSERT INTO audit_log (id,user_id,session_id,action,detail_json,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), userId, sessionId, action, JSON.stringify(detail || {}), new Date().toISOString()).run();
}

async function readJson(request, maxBytes) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length && length > maxBytes) throw new Error('request_too_large');
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('request_too_large');
  return text ? JSON.parse(text) : {};
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 180000 }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function verifyPassword(password, salt, expected) {
  const actual = await hashPassword(password, salt);
  return timingSafeEqual(actual, expected);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

function randomToken(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function timingSafeEqual(a, b) {
  const x = encoder.encode(String(a));
  const y = encoder.encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

function readCookie(header, name) {
  const prefix = `${name}=`;
  for (const part of header.split(';')) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return '';
}

function safeParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role, active: Boolean(user.active) };
}
