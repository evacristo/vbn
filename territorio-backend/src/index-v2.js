const encoder = new TextEncoder();
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

class AppError extends Error {
  constructor(code, status = 400, detail = undefined) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/health') {
        return json({ ok: true, service: 'corrientes-territorial-api', version: '0.2.0', storage: 'organization-workspace' }, 200, cors);
      }
      if (url.pathname === '/api/login' && request.method === 'POST') return login(request, env, cors);
      if (url.pathname === '/api/logout' && request.method === 'POST') return logout(request, env, cors);
      if (url.pathname === '/api/admin/users' && request.method === 'POST') return createUser(request, env, cors);

      const auth = await authenticate(request, env);
      if (!auth) return json({ error: 'unauthorized' }, 401, cors);

      if (url.pathname === '/api/me' && request.method === 'GET') {
        return json({
          user: publicUser(auth),
          organization: auth.organization,
          session: { id: auth.session.id, deviceId: auth.session.device_id, expiresAt: auth.session.expires_at },
        }, 200, cors);
      }
      if (url.pathname === '/api/admin/users' && request.method === 'GET') return listUsers(auth, env, cors);
      const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (userMatch && request.method === 'PATCH') return updateUser(request, decodeURIComponent(userMatch[1]), auth, env, cors);

      if (url.pathname === '/api/sessions' && request.method === 'GET') return listSessions(url, auth, env, cors);
      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch && request.method === 'DELETE') return revokeSession(decodeURIComponent(sessionMatch[1]), auth, env, cors);

      if (url.pathname === '/api/sync/pull' && request.method === 'GET') return pullWorkspace(auth, env, cors);
      if (url.pathname === '/api/sync/push' && request.method === 'POST') return pushWorkspace(request, auth, env, cors);
      if (url.pathname === '/api/history' && request.method === 'GET') return workspaceHistory(auth, env, cors);
      const historyMatch = url.pathname.match(/^\/api\/history\/(\d+)\/restore$/);
      if (historyMatch && request.method === 'POST') return restoreWorkspace(Number(historyMatch[1]), auth, env, cors);

      if (url.pathname === '/api/files' && request.method === 'GET') return listFiles(url, auth, env, cors);
      if (url.pathname === '/api/files' && request.method === 'POST') return uploadFile(request, auth, env, cors);
      const fileMatch = url.pathname.match(/^\/api\/files\/([^/]+)$/);
      if (fileMatch) {
        const id = decodeURIComponent(fileMatch[1]);
        if (request.method === 'GET') return downloadFile(id, auth, env, cors);
        if (request.method === 'DELETE') return deleteFile(id, auth, env, cors);
      }

      return json({ error: 'not_found' }, 404, cors);
    } catch (error) {
      console.error(error);
      if (error instanceof AppError) return json({ error: error.code, detail: error.detail }, error.status, cors);
      return json({ error: 'internal_error', message: error instanceof Error ? error.message : String(error) }, 500, cors);
    }
  },
};

function corsHeaders(origin, allowed) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Bootstrap-Secret,X-File-Name,X-Visit-Id,X-File-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  const allowList = String(allowed || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (origin && (allowList.includes(origin) || allowList.includes('*'))) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...jsonHeaders, ...extra, 'Cache-Control': 'no-store' },
  });
}

async function login(request, env, cors) {
  const body = await readJson(request, 32_000);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) throw new AppError('missing_credentials');

  const user = await env.DB.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1').bind(username).first();
  if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
    await audit(env, null, null, null, 'login_failed', { username });
    return json({ error: 'invalid_credentials' }, 401, cors);
  }

  const membership = await ensureOrganizationForUser(env, user);
  if (!membership || !membership.active) return json({ error: 'membership_inactive' }, 403, cors);

  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const now = new Date();
  const ttlDays = Math.max(1, Math.min(90, Number(env.SESSION_TTL_DAYS || 30)));
  const expiresAt = new Date(now.getTime() + ttlDays * 86400000).toISOString();
  const sessionId = crypto.randomUUID();
  const deviceId = String(body.deviceId || '').slice(0, 120);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (id,user_id,token_hash,device_id,user_agent,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
      .bind(sessionId, user.id, tokenHash, deviceId, request.headers.get('User-Agent') || '', now.toISOString(), expiresAt),
    env.DB.prepare('UPDATE users SET last_login_at=?,updated_at=? WHERE id=?').bind(now.toISOString(), now.toISOString(), user.id),
  ]);
  await audit(env, membership.organization_id, user.id, sessionId, 'login_success', { deviceId });

  const cookie = `ct_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${ttlDays * 86400}`;
  return json({
    token,
    expiresAt,
    user: { id: user.id, username: user.username, role: membership.member_role, active: true },
    organization: { id: membership.organization_id, name: membership.organization_name },
  }, 200, { ...cors, 'Set-Cookie': cookie });
}

async function logout(request, env, cors) {
  const auth = await authenticate(request, env);
  if (auth) {
    await env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(new Date().toISOString(), auth.session.id).run();
    await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'logout', {});
  }
  return json({ ok: true }, 200, { ...cors, 'Set-Cookie': 'ct_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0' });
}

async function createUser(request, env, cors) {
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
  const count = Number(countRow?.count || 0);
  const auth = await authenticate(request, env);
  const bootstrap = request.headers.get('X-Bootstrap-Secret') || '';
  const bootstrapAllowed = count === 0 && env.BOOTSTRAP_SECRET && timingSafeEqual(bootstrap, env.BOOTSTRAP_SECRET);
  if (!(auth?.user?.role === 'admin' || bootstrapAllowed)) return json({ error: 'forbidden' }, 403, cors);

  const body = await readJson(request, 32_000);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const role = normalizeRole(body.role);
  if (username.length < 2 || password.length < 3) throw new AppError('invalid_user');

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const salt = randomToken(16);
  const passwordHash = await hashPassword(password, salt);
  let organizationId = auth?.organization?.id || '';
  let organizationName = auth?.organization?.name || String(body.organizationName || 'Corrientes Territorial').trim() || 'Corrientes Territorial';

  if (!organizationId) {
    organizationId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO organizations (id,name,created_at,updated_at) VALUES (?,?,?,?)')
      .bind(organizationId, organizationName, now, now).run();
  }

  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id,username,password_hash,salt,role,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)')
        .bind(userId, username, passwordHash, salt, role, now, now),
      env.DB.prepare('INSERT INTO organization_members (organization_id,user_id,role,active,created_at,updated_at) VALUES (?,?,?,1,?,?)')
        .bind(organizationId, userId, role, now, now),
      env.DB.prepare('INSERT OR IGNORE INTO organization_workspaces (organization_id,revision,data_json,updated_at) VALUES (?,0,?,?)')
        .bind(organizationId, JSON.stringify({ version: 3, organization: organizationName }), now),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) return json({ error: 'username_exists' }, 409, cors);
    throw error;
  }

  await audit(env, organizationId, auth?.user?.id || userId, auth?.session?.id || null, 'user_created', { userId, username, role });
  return json({ user: { id: userId, username, role, active: true }, organization: { id: organizationId, name: organizationName } }, 201, cors);
}

async function listUsers(auth, env, cors) {
  requireAdmin(auth);
  const rows = await env.DB.prepare(`SELECT u.id,u.username,u.active,u.created_at,u.updated_at,u.last_login_at,m.role,m.active AS membership_active
    FROM organization_members m JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=? ORDER BY u.username COLLATE NOCASE`)
    .bind(auth.organization.id).all();
  return json({ users: (rows.results || []).map((row) => ({
    id: row.id,
    username: row.username,
    role: row.role,
    active: Boolean(row.active && row.membership_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  })) }, 200, cors);
}

async function updateUser(request, targetUserId, auth, env, cors) {
  requireAdmin(auth);
  const body = await readJson(request, 16_000);
  const target = await env.DB.prepare(`SELECT u.id,u.username,u.active,m.role,m.active AS membership_active
    FROM users u JOIN organization_members m ON m.user_id=u.id
    WHERE u.id=? AND m.organization_id=?`).bind(targetUserId, auth.organization.id).first();
  if (!target) return json({ error: 'user_not_found' }, 404, cors);

  const nextRole = body.role == null ? target.role : normalizeRole(body.role);
  const nextActive = body.active == null ? Boolean(target.active && target.membership_active) : Boolean(body.active);
  if (targetUserId === auth.user.id && !nextActive) throw new AppError('cannot_deactivate_current_user', 409);

  if (target.role === 'admin' && nextRole !== 'admin') {
    const admins = await env.DB.prepare(`SELECT COUNT(*) AS count FROM organization_members
      WHERE organization_id=? AND role='admin' AND active=1`).bind(auth.organization.id).first();
    if (Number(admins?.count || 0) <= 1) throw new AppError('last_admin_required', 409);
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE organization_members SET role=?,active=?,updated_at=? WHERE organization_id=? AND user_id=?')
      .bind(nextRole, nextActive ? 1 : 0, now, auth.organization.id, targetUserId),
    env.DB.prepare('UPDATE users SET role=?,active=?,updated_at=? WHERE id=?')
      .bind(nextRole, nextActive ? 1 : 0, now, targetUserId),
  ]);
  if (!nextActive) await env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now, targetUserId).run();
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'user_updated', { targetUserId, role: nextRole, active: nextActive });
  return json({ user: { id: targetUserId, username: target.username, role: nextRole, active: nextActive } }, 200, cors);
}

async function authenticate(request, env) {
  let token = '';
  const authorization = request.headers.get('Authorization') || '';
  if (authorization.startsWith('Bearer ')) token = authorization.slice(7).trim();
  if (!token) token = readCookie(request.headers.get('Cookie') || '', 'ct_session');
  if (!token) return null;

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`SELECT s.*,u.username,u.active,u.role AS user_role,u.created_at AS user_created_at,u.updated_at AS user_updated_at
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.active=1`)
    .bind(tokenHash, now).first();
  if (!row) return null;

  const membership = await ensureOrganizationForUser(env, { id: row.user_id, role: row.user_role });
  if (!membership || !membership.active) return null;
  return {
    session: row,
    user: { id: row.user_id, username: row.username, role: membership.member_role, active: true, createdAt: row.user_created_at, updatedAt: row.user_updated_at },
    organization: { id: membership.organization_id, name: membership.organization_name },
  };
}

async function ensureOrganizationForUser(env, user) {
  let row = await env.DB.prepare(`SELECT m.organization_id,m.role AS member_role,m.active,o.name AS organization_name
    FROM organization_members m JOIN organizations o ON o.id=m.organization_id
    WHERE m.user_id=? ORDER BY m.created_at LIMIT 1`).bind(user.id).first();
  if (row) return row;

  const now = new Date().toISOString();
  let organization = await env.DB.prepare('SELECT id,name FROM organizations ORDER BY created_at LIMIT 1').first();
  if (!organization) {
    organization = { id: crypto.randomUUID(), name: 'Corrientes Territorial' };
    await env.DB.prepare('INSERT INTO organizations (id,name,created_at,updated_at) VALUES (?,?,?,?)')
      .bind(organization.id, organization.name, now, now).run();
  }
  const role = normalizeRole(user.role);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO organization_members (organization_id,user_id,role,active,created_at,updated_at) VALUES (?,?,?,1,?,?)')
      .bind(organization.id, user.id, role, now, now),
    env.DB.prepare('INSERT OR IGNORE INTO organization_workspaces (organization_id,revision,data_json,updated_at) VALUES (?,0,?,?)')
      .bind(organization.id, JSON.stringify({ version: 3, organization: organization.name }), now),
  ]);
  row = { organization_id: organization.id, organization_name: organization.name, member_role: role, active: 1 };
  return row;
}

async function pullWorkspace(auth, env, cors) {
  let row = await env.DB.prepare('SELECT revision,data_json,updated_at FROM organization_workspaces WHERE organization_id=?')
    .bind(auth.organization.id).first();
  if (!row) {
    const now = new Date().toISOString();
    await env.DB.prepare('INSERT INTO organization_workspaces (organization_id,revision,data_json,updated_at) VALUES (?,0,?,?)')
      .bind(auth.organization.id, JSON.stringify({ version: 3, organization: auth.organization.name }), now).run();
    row = { revision: 0, data_json: '{}', updated_at: now };
  }
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'workspace_pull', { revision: row.revision });
  return json({ workspace: safeParse(row.data_json, {}), revision: Number(row.revision || 0), updatedAt: row.updated_at }, 200, cors);
}

async function pushWorkspace(request, auth, env, cors) {
  requireWriter(auth);
  const body = await readJson(request, 1_800_000);
  const workspace = body.workspace;
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) throw new AppError('invalid_workspace');
  const serialized = JSON.stringify(workspace);
  if (serialized.length > 1_500_000) throw new AppError('workspace_too_large', 413);

  const current = await env.DB.prepare('SELECT revision,data_json FROM organization_workspaces WHERE organization_id=?')
    .bind(auth.organization.id).first();
  const serverRevision = Number(current?.revision || 0);
  const clientRevision = Number(body.revision || 0);
  if (current && clientRevision < serverRevision && !body.force) {
    return json({ error: 'revision_conflict', revision: serverRevision, workspace: safeParse(current.data_json, {}) }, 409, cors);
  }

  const revision = serverRevision + 1;
  const now = new Date().toISOString();
  const statements = [];
  if (current) {
    statements.push(env.DB.prepare(`INSERT INTO organization_workspace_history
      (id,organization_id,revision,data_json,created_at,session_id,actor_user_id) VALUES (?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), auth.organization.id, serverRevision, current.data_json, now, auth.session.id, auth.user.id));
    statements.push(env.DB.prepare(`UPDATE organization_workspaces
      SET revision=?,data_json=?,updated_at=?,updated_by_session=? WHERE organization_id=?`)
      .bind(revision, serialized, now, auth.session.id, auth.organization.id));
  } else {
    statements.push(env.DB.prepare(`INSERT INTO organization_workspaces
      (organization_id,revision,data_json,updated_at,updated_by_session) VALUES (?,?,?,?,?)`)
      .bind(auth.organization.id, revision, serialized, now, auth.session.id));
  }
  await env.DB.batch(statements);
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'workspace_push', { revision, deviceId: body.deviceId || null });
  return json({ ok: true, revision, updatedAt: now }, 200, cors);
}

async function workspaceHistory(auth, env, cors) {
  const rows = await env.DB.prepare(`SELECT h.revision,h.created_at,h.session_id,h.actor_user_id,u.username AS actor_username
    FROM organization_workspace_history h LEFT JOIN users u ON u.id=h.actor_user_id
    WHERE h.organization_id=? ORDER BY h.revision DESC LIMIT 30`).bind(auth.organization.id).all();
  return json({ history: rows.results || [] }, 200, cors);
}

async function restoreWorkspace(revisionToRestore, auth, env, cors) {
  requireWriter(auth);
  const archived = await env.DB.prepare('SELECT data_json FROM organization_workspace_history WHERE organization_id=? AND revision=?')
    .bind(auth.organization.id, revisionToRestore).first();
  if (!archived) return json({ error: 'revision_not_found' }, 404, cors);
  const current = await env.DB.prepare('SELECT revision,data_json FROM organization_workspaces WHERE organization_id=?')
    .bind(auth.organization.id).first();
  if (!current) return json({ error: 'workspace_not_found' }, 404, cors);

  const now = new Date().toISOString();
  const nextRevision = Number(current.revision || 0) + 1;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO organization_workspace_history
      (id,organization_id,revision,data_json,created_at,session_id,actor_user_id) VALUES (?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), auth.organization.id, Number(current.revision || 0), current.data_json, now, auth.session.id, auth.user.id),
    env.DB.prepare('UPDATE organization_workspaces SET revision=?,data_json=?,updated_at=?,updated_by_session=? WHERE organization_id=?')
      .bind(nextRevision, archived.data_json, now, auth.session.id, auth.organization.id),
  ]);
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'workspace_restored', { fromRevision: current.revision, restoredRevision: revisionToRestore, revision: nextRevision });
  return json({ ok: true, revision: nextRevision, workspace: safeParse(archived.data_json, {}), updatedAt: now }, 200, cors);
}

async function listSessions(url, auth, env, cors) {
  const requestedUserId = auth.user.role === 'admin' ? String(url.searchParams.get('userId') || auth.user.id) : auth.user.id;
  const member = await env.DB.prepare('SELECT 1 FROM organization_members WHERE organization_id=? AND user_id=?')
    .bind(auth.organization.id, requestedUserId).first();
  if (!member) return json({ error: 'user_not_found' }, 404, cors);
  const rows = await env.DB.prepare(`SELECT id,device_id,user_agent,created_at,expires_at,revoked_at
    FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).bind(requestedUserId).all();
  return json({ sessions: (rows.results || []).map((row) => ({
    id: row.id,
    deviceId: row.device_id,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    current: row.id === auth.session.id,
  })) }, 200, cors);
}

async function revokeSession(sessionId, auth, env, cors) {
  const target = await env.DB.prepare('SELECT id,user_id FROM sessions WHERE id=?').bind(sessionId).first();
  if (!target) return json({ error: 'session_not_found' }, 404, cors);
  const permitted = target.user_id === auth.user.id || auth.user.role === 'admin';
  if (!permitted) return json({ error: 'forbidden' }, 403, cors);
  if (auth.user.role === 'admin' && target.user_id !== auth.user.id) {
    const member = await env.DB.prepare('SELECT 1 FROM organization_members WHERE organization_id=? AND user_id=?')
      .bind(auth.organization.id, target.user_id).first();
    if (!member) return json({ error: 'forbidden' }, 403, cors);
  }
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(now, sessionId).run();
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'session_revoked', { sessionId, targetUserId: target.user_id });
  return json({ ok: true }, 200, cors);
}

async function uploadFile(request, auth, env, cors) {
  requireWriter(auth);
  const declaredSize = Number(request.headers.get('Content-Length') || 0);
  if (declaredSize > 12 * 1024 * 1024) throw new AppError('file_too_large', 413);
  const id = request.headers.get('X-File-Id') || crypto.randomUUID();
  const filename = decodeURIComponent(request.headers.get('X-File-Name') || 'archivo');
  const visitId = String(request.headers.get('X-Visit-Id') || '').slice(0, 160);
  const mimeType = request.headers.get('Content-Type') || 'application/octet-stream';
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 12 * 1024 * 1024) throw new AppError('file_too_large', 413);

  const key = `${auth.organization.id}/${id}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: mimeType }, customMetadata: { filename, visitId } });
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT OR REPLACE INTO shared_file_metadata
    (id,organization_id,uploaded_by_user_id,visit_id,filename,mime_type,size_bytes,created_at,deleted_at)
    VALUES (?,?,?,?,?,?,?,?,NULL)`)
    .bind(id, auth.organization.id, auth.user.id, visitId, filename, mimeType, bytes.byteLength, now).run();
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'file_uploaded', { id, visitId, filename, size: bytes.byteLength });
  return json({ id, filename, visitId, mimeType, size: bytes.byteLength, createdAt: now }, 201, cors);
}

async function listFiles(url, auth, env, cors) {
  const visitId = url.searchParams.get('visitId');
  const statement = visitId
    ? env.DB.prepare(`SELECT id,visit_id,filename,mime_type,size_bytes,created_at,uploaded_by_user_id
      FROM shared_file_metadata WHERE organization_id=? AND visit_id=? AND deleted_at IS NULL ORDER BY created_at DESC`)
      .bind(auth.organization.id, visitId)
    : env.DB.prepare(`SELECT id,visit_id,filename,mime_type,size_bytes,created_at,uploaded_by_user_id
      FROM shared_file_metadata WHERE organization_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 300`)
      .bind(auth.organization.id);
  const rows = await statement.all();
  return json({ files: rows.results || [] }, 200, cors);
}

async function downloadFile(id, auth, env, cors) {
  const meta = await env.DB.prepare('SELECT * FROM shared_file_metadata WHERE id=? AND organization_id=? AND deleted_at IS NULL')
    .bind(id, auth.organization.id).first();
  if (!meta) return json({ error: 'file_not_found' }, 404, cors);
  const object = await env.FILES.get(`${auth.organization.id}/${id}`);
  if (!object) return json({ error: 'file_not_found' }, 404, cors);
  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`);
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(object.body, { headers });
}

async function deleteFile(id, auth, env, cors) {
  requireWriter(auth);
  const meta = await env.DB.prepare('SELECT id FROM shared_file_metadata WHERE id=? AND organization_id=? AND deleted_at IS NULL')
    .bind(id, auth.organization.id).first();
  if (!meta) return json({ error: 'file_not_found' }, 404, cors);
  await env.FILES.delete(`${auth.organization.id}/${id}`);
  await env.DB.prepare('UPDATE shared_file_metadata SET deleted_at=? WHERE id=? AND organization_id=?')
    .bind(new Date().toISOString(), id, auth.organization.id).run();
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'file_deleted', { id });
  return json({ ok: true }, 200, cors);
}

function requireAdmin(auth) {
  if (auth.user.role !== 'admin') throw new AppError('forbidden', 403);
}

function requireWriter(auth) {
  if (auth.user.role === 'viewer') throw new AppError('read_only', 403);
}

function normalizeRole(value) {
  return ['admin', 'editor', 'viewer'].includes(value) ? value : 'editor';
}

function publicUser(auth) {
  return { id: auth.user.id, username: auth.user.username, role: auth.user.role, active: true };
}

async function audit(env, organizationId, userId, sessionId, action, detail) {
  await env.DB.prepare(`INSERT INTO audit_log_v2
    (id,organization_id,user_id,session_id,action,detail_json,created_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), organizationId, userId, sessionId, action, JSON.stringify(detail || {}), new Date().toISOString()).run();
}

async function readJson(request, maxBytes) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length && length > maxBytes) throw new AppError('request_too_large', 413);
  const text = await request.text();
  if (text.length > maxBytes) throw new AppError('request_too_large', 413);
  try { return text ? JSON.parse(text) : {}; } catch { throw new AppError('invalid_json'); }
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 180000 }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function verifyPassword(password, salt, expected) {
  return timingSafeEqual(await hashPassword(password, salt), expected);
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
  let difference = 0;
  for (let index = 0; index < x.length; index += 1) difference |= x[index] ^ y[index];
  return difference === 0;
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
