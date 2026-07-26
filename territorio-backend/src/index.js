const encoder = new TextEncoder();
const API_VERSION = '0.2.0';
const ROLES = new Set(['admin', 'editor', 'viewer']);
const MAX_WORKSPACE_BYTES = 1_500_000;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

class ApiError extends Error {
  constructor(status, code, detail) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('Origin') || '', env.ALLOWED_ORIGIN);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/health') {
        return json({ ok: true, service: 'corrientes-territorial-api', version: API_VERSION }, 200, cors);
      }
      if (url.pathname === '/api/login' && request.method === 'POST') return login(request, env, cors);
      if (url.pathname === '/api/logout' && request.method === 'POST') return logout(request, env, cors);
      // This endpoint also handles the first bootstrap administrator before authentication exists.
      if (url.pathname === '/api/admin/users' && request.method === 'POST') return createUser(request, env, cors);

      const auth = await authenticate(request, env);
      if (!auth) throw new ApiError(401, 'unauthorized');

      if (url.pathname === '/api/me' && request.method === 'GET') return currentIdentity(auth, cors);
      if (url.pathname === '/api/admin/users' && request.method === 'GET') return listUsers(auth, env, cors);

      const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (userMatch && request.method === 'POST') return updateUser(request, decodeURIComponent(userMatch[1]), auth, env, cors);

      if (url.pathname === '/api/sessions' && request.method === 'GET') return listSessions(url, auth, env, cors);
      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch && request.method === 'DELETE') return revokeSession(decodeURIComponent(sessionMatch[1]), auth, env, cors);

      if (url.pathname === '/api/sync/pull' && request.method === 'GET') return pullWorkspace(auth, env, cors);
      if (url.pathname === '/api/sync/push' && request.method === 'POST') return pushWorkspace(request, auth, env, cors);
      if (url.pathname === '/api/history' && request.method === 'GET') return workspaceHistory(auth, env, cors);
      const restoreMatch = url.pathname.match(/^\/api\/history\/(\d+)\/restore$/);
      if (restoreMatch && request.method === 'POST') return restoreWorkspace(Number(restoreMatch[1]), auth, env, cors);
      if (url.pathname === '/api/audit' && request.method === 'GET') return listAudit(url, auth, env, cors);

      if (url.pathname === '/api/files' && request.method === 'GET') return listFiles(url, auth, env, cors);
      if (url.pathname === '/api/files' && request.method === 'POST') return uploadFile(request, auth, env, cors);
      const fileMatch = url.pathname.match(/^\/api\/files\/([^/]+)$/);
      if (fileMatch && request.method === 'GET') return downloadFile(decodeURIComponent(fileMatch[1]), auth, env, cors);
      if (fileMatch && request.method === 'DELETE') return deleteFile(decodeURIComponent(fileMatch[1]), auth, env, cors);

      throw new ApiError(404, 'not_found');
    } catch (error) {
      const requestId = crypto.randomUUID();
      if (!(error instanceof ApiError)) console.error(requestId, error);
      const status = error instanceof ApiError ? error.status : 500;
      const code = error instanceof ApiError ? error.code : 'internal_error';
      const payload = { error: code, requestId };
      if (error instanceof ApiError && error.detail !== undefined) payload.detail = error.detail;
      if (status === 500 && String(env.DEBUG || '') === 'true') payload.message = String(error?.message || error);
      return json(payload, status, cors);
    }
  },
};

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

function corsHeaders(origin, allowed) {
  const headers = {
    ...securityHeaders(),
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
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
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...securityHeaders(),
      ...extra,
    },
  });
}

async function login(request, env, cors) {
  const body = await readJson(request, 32_000);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) throw new ApiError(400, 'missing_credentials');

  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') || 'unknown');
  if (await loginBlocked(env, username, ipHash)) throw new ApiError(429, 'too_many_attempts');

  const user = await env.DB.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1').bind(username).first();
  if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
    await recordLoginAttempt(env, username, ipHash, false);
    await audit(env, null, null, null, 'login_failed', { username });
    throw new ApiError(401, 'invalid_credentials');
  }

  const organization = await ensureUserOrganization(env, user);
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const now = new Date();
  const ttlDays = Math.max(1, Math.min(90, Number(env.SESSION_TTL_DAYS || 30)));
  const expiresAt = new Date(now.getTime() + ttlDays * 86400000).toISOString();
  const sessionId = crypto.randomUUID();
  const deviceId = String(body.deviceId || '').slice(0, 120);

  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (id,user_id,token_hash,device_id,user_agent,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
      .bind(sessionId, user.id, tokenHash, deviceId, String(request.headers.get('User-Agent') || '').slice(0, 500), now.toISOString(), expiresAt),
    env.DB.prepare('UPDATE users SET last_login_at=?,updated_at=? WHERE id=?').bind(now.toISOString(), now.toISOString(), user.id),
  ]);
  await recordLoginAttempt(env, username, ipHash, true);
  await audit(env, organization.id, user.id, sessionId, 'login_success', { deviceId });

  const publicIdentity = {
    id: user.id,
    username: user.username,
    role: organization.role,
    active: true,
    organization: { id: organization.id, name: organization.name },
  };
  const cookie = `ct_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${ttlDays * 86400}`;
  return json({ token, expiresAt, user: publicIdentity }, 200, { ...cors, 'Set-Cookie': cookie });
}

async function logout(request, env, cors) {
  const auth = await authenticate(request, env);
  if (auth) {
    await env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(new Date().toISOString(), auth.session.id).run();
    await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'logout', {});
  }
  return json({ ok: true }, 200, { ...cors, 'Set-Cookie': 'ct_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0' });
}

async function loginBlocked(env, username, ipHash) {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM login_attempts
    WHERE success=0 AND created_at>? AND (username=? COLLATE NOCASE OR ip_hash=?)`)
    .bind(cutoff, username, ipHash).first();
  return Number(row?.count || 0) >= 10;
}

async function recordLoginAttempt(env, username, ipHash, success) {
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO login_attempts (id,username,ip_hash,success,created_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), username, ipHash, success ? 1 : 0, now).run();
  if (success) {
    const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
    await env.DB.prepare('DELETE FROM login_attempts WHERE created_at<?').bind(cutoff).run();
  }
}

async function ensureUserOrganization(env, user) {
  let membership = await env.DB.prepare(`SELECT o.id,o.name,m.role FROM memberships m
    JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=? ORDER BY m.created_at LIMIT 1`).bind(user.id).first();
  if (membership) return membership;

  const now = new Date().toISOString();
  let organization = await env.DB.prepare('SELECT id,name FROM organizations ORDER BY created_at LIMIT 1').first();
  const statements = [];
  if (!organization) {
    organization = { id: crypto.randomUUID(), name: 'Corrientes Territorial' };
    statements.push(env.DB.prepare('INSERT INTO organizations (id,name,created_at,updated_at) VALUES (?,?,?,?)')
      .bind(organization.id, organization.name, now, now));
  }
  statements.push(env.DB.prepare('INSERT OR IGNORE INTO memberships (organization_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?)')
    .bind(organization.id, user.id, ROLES.has(user.role) ? user.role : 'editor', now, now));

  const team = await env.DB.prepare('SELECT organization_id FROM team_workspaces WHERE organization_id=?').bind(organization.id).first();
  if (!team) {
    const legacy = await env.DB.prepare('SELECT data_json FROM workspaces WHERE user_id=?').bind(user.id).first();
    const initial = legacy?.data_json || JSON.stringify({ version: 3, user: user.username });
    statements.push(env.DB.prepare('INSERT INTO team_workspaces (organization_id,revision,data_json,updated_at,updated_by_user) VALUES (?,0,?,?,?)')
      .bind(organization.id, initial, now, user.id));
  }
  await env.DB.batch(statements);
  membership = { ...organization, role: ROLES.has(user.role) ? user.role : 'editor' };
  return membership;
}

async function createUser(request, env, cors) {
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
  const count = Number(countRow?.count || 0);
  const auth = await authenticate(request, env);
  const bootstrap = request.headers.get('X-Bootstrap-Secret') || '';
  const isBootstrap = count === 0 && env.BOOTSTRAP_SECRET && timingSafeEqual(bootstrap, env.BOOTSTRAP_SECRET);
  if (!isBootstrap && auth?.user?.role !== 'admin') throw new ApiError(403, 'forbidden');

  const body = await readJson(request, 32_000);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const role = ROLES.has(body.role) ? body.role : (isBootstrap ? 'admin' : 'editor');
  if (username.length < 2 || username.length > 80 || password.length < 3 || password.length > 256) {
    throw new ApiError(400, 'invalid_user');
  }

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const salt = randomToken(16);
  const passwordHash = await hashPassword(password, salt);
  const organizationId = isBootstrap ? crypto.randomUUID() : auth.organization.id;
  const organizationName = String(body.organizationName || 'Corrientes Territorial').trim().slice(0, 120) || 'Corrientes Territorial';
  const statements = [];

  if (isBootstrap) {
    statements.push(env.DB.prepare('INSERT INTO organizations (id,name,created_at,updated_at) VALUES (?,?,?,?)')
      .bind(organizationId, organizationName, now, now));
  }
  statements.push(env.DB.prepare('INSERT INTO users (id,username,password_hash,salt,role,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)')
    .bind(userId, username, passwordHash, salt, role, now, now));
  statements.push(env.DB.prepare('INSERT INTO memberships (organization_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?)')
    .bind(organizationId, userId, role, now, now));
  statements.push(env.DB.prepare('INSERT INTO workspaces (user_id,revision,data_json,updated_at) VALUES (?,0,?,?)')
    .bind(userId, JSON.stringify({ version: 3, user: username }), now));
  if (isBootstrap) {
    statements.push(env.DB.prepare('INSERT INTO team_workspaces (organization_id,revision,data_json,updated_at,updated_by_user) VALUES (?,0,?,?,?)')
      .bind(organizationId, JSON.stringify({ version: 3, user: username }), now, userId));
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new ApiError(409, 'username_exists');
    throw error;
  }
  await audit(env, organizationId, auth?.user?.id || userId, auth?.session?.id || null, 'user_created', { createdUserId: userId, username, role });
  return json({ user: { id: userId, username, role, active: true } }, 201, cors);
}

async function authenticate(request, env) {
  let token = '';
  const header = request.headers.get('Authorization') || '';
  if (header.startsWith('Bearer ')) token = header.slice(7).trim();
  if (!token) token = readCookie(request.headers.get('Cookie') || '', 'ct_session');
  if (!token) return null;

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`SELECT s.*,u.username,u.active,u.created_at AS user_created_at,u.updated_at AS user_updated_at,
      m.organization_id,m.role AS membership_role,o.name AS organization_name
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    JOIN memberships m ON m.user_id=u.id
    JOIN organizations o ON o.id=m.organization_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.active=1
    ORDER BY m.created_at LIMIT 1`).bind(tokenHash, now).first();
  if (!row) return null;

  return {
    session: row,
    user: {
      id: row.user_id,
      username: row.username,
      role: row.membership_role,
      active: Boolean(row.active),
      createdAt: row.user_created_at,
      updatedAt: row.user_updated_at,
    },
    organization: { id: row.organization_id, name: row.organization_name },
  };
}

function currentIdentity(auth, cors) {
  return json({
    user: { ...auth.user, organization: auth.organization },
    session: { id: auth.session.id, deviceId: auth.session.device_id, createdAt: auth.session.created_at, expiresAt: auth.session.expires_at },
  }, 200, cors);
}

function requireAdmin(auth) {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'forbidden');
}

function requireWriter(auth) {
  if (auth.user.role === 'viewer') throw new ApiError(403, 'read_only');
}

async function listUsers(auth, env, cors) {
  requireAdmin(auth);
  const rows = await env.DB.prepare(`SELECT u.id,u.username,u.active,u.created_at,u.updated_at,u.last_login_at,m.role,
      (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>?) AS active_sessions
    FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=? ORDER BY u.username COLLATE NOCASE`).bind(new Date().toISOString(), auth.organization.id).all();
  return json({ users: (rows.results || []).map(publicUserRow) }, 200, cors);
}

async function updateUser(request, targetId, auth, env, cors) {
  requireAdmin(auth);
  const target = await env.DB.prepare(`SELECT u.*,m.role AS membership_role FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=? AND u.id=?`).bind(auth.organization.id, targetId).first();
  if (!target) throw new ApiError(404, 'user_not_found');

  const body = await readJson(request, 32_000);
  const nextRole = body.role === undefined ? target.membership_role : body.role;
  const nextActive = body.active === undefined ? Boolean(target.active) : Boolean(body.active);
  if (!ROLES.has(nextRole)) throw new ApiError(400, 'invalid_role');

  if (target.id === auth.user.id && (!nextActive || nextRole !== 'admin')) {
    const other = await env.DB.prepare(`SELECT COUNT(*) AS count FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.organization_id=? AND m.role='admin' AND u.active=1 AND u.id<>?`).bind(auth.organization.id, target.id).first();
    if (Number(other?.count || 0) === 0) throw new ApiError(409, 'last_admin');
  }

  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare('UPDATE memberships SET role=?,updated_at=? WHERE organization_id=? AND user_id=?')
      .bind(nextRole, now, auth.organization.id, target.id),
    env.DB.prepare('UPDATE users SET role=?,active=?,updated_at=? WHERE id=?')
      .bind(nextRole, nextActive ? 1 : 0, now, target.id),
  ];

  if (body.password !== undefined) {
    const password = String(body.password || '');
    if (password.length < 3 || password.length > 256) throw new ApiError(400, 'invalid_password');
    const salt = randomToken(16);
    const passwordHash = await hashPassword(password, salt);
    statements.push(env.DB.prepare('UPDATE users SET salt=?,password_hash=?,updated_at=? WHERE id=?').bind(salt, passwordHash, now, target.id));
    statements.push(env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now, target.id));
  } else if (!nextActive) {
    statements.push(env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now, target.id));
  }

  await env.DB.batch(statements);
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'user_updated', { targetId, role: nextRole, active: nextActive, passwordChanged: body.password !== undefined });
  return json({ user: { id: target.id, username: target.username, role: nextRole, active: nextActive } }, 200, cors);
}

async function listSessions(url, auth, env, cors) {
  const requestedUser = url.searchParams.get('userId');
  const userId = requestedUser && auth.user.role === 'admin' ? requestedUser : auth.user.id;
  if (requestedUser && auth.user.role !== 'admin' && requestedUser !== auth.user.id) throw new ApiError(403, 'forbidden');

  if (auth.user.role === 'admin') {
    const member = await env.DB.prepare('SELECT 1 FROM memberships WHERE organization_id=? AND user_id=?').bind(auth.organization.id, userId).first();
    if (!member) throw new ApiError(404, 'user_not_found');
  }
  const rows = await env.DB.prepare(`SELECT id,device_id,user_agent,created_at,expires_at,revoked_at FROM sessions
    WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).bind(userId).all();
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
  const row = await env.DB.prepare(`SELECT s.id,s.user_id FROM sessions s JOIN memberships m ON m.user_id=s.user_id
    WHERE s.id=? AND m.organization_id=?`).bind(sessionId, auth.organization.id).first();
  if (!row) throw new ApiError(404, 'session_not_found');
  if (row.user_id !== auth.user.id && auth.user.role !== 'admin') throw new ApiError(403, 'forbidden');
  await env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(new Date().toISOString(), sessionId).run();
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'session_revoked', { sessionId, targetUserId: row.user_id });
  return json({ ok: true }, 200, cors);
}

async function ensureTeamWorkspace(auth, env) {
  let row = await env.DB.prepare('SELECT revision,data_json,updated_at,updated_by_user FROM team_workspaces WHERE organization_id=?')
    .bind(auth.organization.id).first();
  if (!row) {
    const now = new Date().toISOString();
    const legacy = await env.DB.prepare('SELECT data_json FROM workspaces WHERE user_id=?').bind(auth.user.id).first();
    const initial = legacy?.data_json || JSON.stringify({ version: 3, user: auth.user.username });
    await env.DB.prepare('INSERT INTO team_workspaces (organization_id,revision,data_json,updated_at,updated_by_user) VALUES (?,0,?,?,?)')
      .bind(auth.organization.id, initial, now, auth.user.id).run();
    row = { revision: 0, data_json: initial, updated_at: now, updated_by_user: auth.user.id };
  }
  return row;
}

async function pullWorkspace(auth, env, cors) {
  const row = await ensureTeamWorkspace(auth, env);
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'workspace_pull', { revision: row.revision });
  return json({
    workspace: safeParse(row.data_json, {}),
    revision: Number(row.revision || 0),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by_user,
    organization: auth.organization,
  }, 200, cors);
}

async function pushWorkspace(request, auth, env, cors) {
  requireWriter(auth);
  const body = await readJson(request, 1_800_000);
  const workspace = body.workspace;
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) throw new ApiError(400, 'invalid_workspace');
  const serialized = JSON.stringify(workspace);
  if (encoder.encode(serialized).byteLength > MAX_WORKSPACE_BYTES) throw new ApiError(413, 'workspace_too_large');

  const current = await ensureTeamWorkspace(auth, env);
  const serverRevision = Number(current.revision || 0);
  const clientRevision = Number(body.revision || 0);
  if (clientRevision < serverRevision && !body.force) {
    return json({ error: 'revision_conflict', revision: serverRevision, workspace: safeParse(current.data_json, {}) }, 409, cors);
  }

  const revision = serverRevision + 1;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO team_workspace_history (id,organization_id,revision,data_json,created_at,user_id,session_id) VALUES (?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), auth.organization.id, serverRevision, current.data_json, now, auth.user.id, auth.session.id),
    env.DB.prepare('UPDATE team_workspaces SET revision=?,data_json=?,updated_at=?,updated_by_user=?,updated_by_session=? WHERE organization_id=?')
      .bind(revision, serialized, now, auth.user.id, auth.session.id, auth.organization.id),
  ]);
  await pruneHistory(env, auth.organization.id);
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'workspace_push', { revision, deviceId: body.deviceId || null, forced: Boolean(body.force) });
  return json({ ok: true, revision, updatedAt: now }, 200, cors);
}

async function workspaceHistory(auth, env, cors) {
  const current = await ensureTeamWorkspace(auth, env);
  const rows = await env.DB.prepare(`SELECT h.revision,h.created_at,h.user_id,u.username
    FROM team_workspace_history h LEFT JOIN users u ON u.id=h.user_id
    WHERE h.organization_id=? ORDER BY h.revision DESC LIMIT 30`).bind(auth.organization.id).all();
  return json({
    current: { revision: Number(current.revision || 0), updatedAt: current.updated_at, updatedBy: current.updated_by_user },
    history: (rows.results || []).map((row) => ({ revision: Number(row.revision), createdAt: row.created_at, userId: row.user_id, username: row.username })),
  }, 200, cors);
}

async function restoreWorkspace(revision, auth, env, cors) {
  requireWriter(auth);
  if (!Number.isInteger(revision) || revision < 0) throw new ApiError(400, 'invalid_revision');
  const historical = await env.DB.prepare('SELECT data_json FROM team_workspace_history WHERE organization_id=? AND revision=?')
    .bind(auth.organization.id, revision).first();
  if (!historical) throw new ApiError(404, 'revision_not_found');
  const current = await ensureTeamWorkspace(auth, env);
  const nextRevision = Number(current.revision || 0) + 1;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO team_workspace_history (id,organization_id,revision,data_json,created_at,user_id,session_id) VALUES (?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), auth.organization.id, Number(current.revision || 0), current.data_json, now, auth.user.id, auth.session.id),
    env.DB.prepare('UPDATE team_workspaces SET revision=?,data_json=?,updated_at=?,updated_by_user=?,updated_by_session=? WHERE organization_id=?')
      .bind(nextRevision, historical.data_json, now, auth.user.id, auth.session.id, auth.organization.id),
  ]);
  await pruneHistory(env, auth.organization.id);
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'workspace_restored', { restoredRevision: revision, newRevision: nextRevision });
  return json({ ok: true, revision: nextRevision, workspace: safeParse(historical.data_json, {}), updatedAt: now }, 200, cors);
}

async function pruneHistory(env, organizationId) {
  await env.DB.prepare(`DELETE FROM team_workspace_history WHERE organization_id=? AND id NOT IN (
    SELECT id FROM team_workspace_history WHERE organization_id=? ORDER BY revision DESC LIMIT 50
  )`).bind(organizationId, organizationId).run();
}

async function listAudit(url, auth, env, cors) {
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)));
  const action = String(url.searchParams.get('action') || '').slice(0, 80);
  let query;
  if (auth.user.role === 'admin') {
    query = action
      ? env.DB.prepare(`SELECT a.*,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
          WHERE a.organization_id=? AND a.action=? ORDER BY a.created_at DESC LIMIT ?`).bind(auth.organization.id, action, limit)
      : env.DB.prepare(`SELECT a.*,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
          WHERE a.organization_id=? ORDER BY a.created_at DESC LIMIT ?`).bind(auth.organization.id, limit);
  } else {
    query = action
      ? env.DB.prepare(`SELECT a.*,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
          WHERE a.organization_id=? AND a.user_id=? AND a.action=? ORDER BY a.created_at DESC LIMIT ?`).bind(auth.organization.id, auth.user.id, action, limit)
      : env.DB.prepare(`SELECT a.*,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
          WHERE a.organization_id=? AND a.user_id=? ORDER BY a.created_at DESC LIMIT ?`).bind(auth.organization.id, auth.user.id, limit);
  }
  const rows = await query.all();
  return json({ audit: (rows.results || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    sessionId: row.session_id,
    action: row.action,
    detail: safeParse(row.detail_json, {}),
    createdAt: row.created_at,
  })) }, 200, cors);
}

async function uploadFile(request, auth, env, cors) {
  requireWriter(auth);
  const declaredSize = Number(request.headers.get('Content-Length') || 0);
  if (declaredSize > MAX_FILE_BYTES) throw new ApiError(413, 'file_too_large');

  const requestedId = request.headers.get('X-File-Id') || crypto.randomUUID();
  const id = /^[A-Za-z0-9._-]{1,128}$/.test(requestedId) ? requestedId : crypto.randomUUID();
  const filename = safeFilename(decodeURIComponent(request.headers.get('X-File-Name') || 'archivo'));
  const visitId = String(request.headers.get('X-Visit-Id') || '').slice(0, 160);
  const mimeType = String(request.headers.get('Content-Type') || 'application/octet-stream').slice(0, 160);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ApiError(413, 'file_too_large');

  const key = `${auth.organization.id}/${id}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: mimeType }, customMetadata: { filename, visitId, uploadedBy: auth.user.id } });
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT OR REPLACE INTO team_file_metadata
    (id,organization_id,uploaded_by,visit_id,filename,mime_type,size_bytes,created_at,deleted_at)
    VALUES (?,?,?,?,?,?,?,?,NULL)`).bind(id, auth.organization.id, auth.user.id, visitId, filename, mimeType, bytes.byteLength, now).run();
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'file_uploaded', { id, visitId, filename, size: bytes.byteLength });
  return json({ id, filename, visitId, mimeType, size: bytes.byteLength, createdAt: now, uploadedBy: auth.user.id }, 201, cors);
}

async function listFiles(url, auth, env, cors) {
  const visitId = url.searchParams.get('visitId');
  const query = visitId
    ? env.DB.prepare(`SELECT f.id,f.visit_id,f.filename,f.mime_type,f.size_bytes,f.created_at,f.uploaded_by,u.username
        FROM team_file_metadata f LEFT JOIN users u ON u.id=f.uploaded_by
        WHERE f.organization_id=? AND f.visit_id=? AND f.deleted_at IS NULL ORDER BY f.created_at DESC`).bind(auth.organization.id, visitId)
    : env.DB.prepare(`SELECT f.id,f.visit_id,f.filename,f.mime_type,f.size_bytes,f.created_at,f.uploaded_by,u.username
        FROM team_file_metadata f LEFT JOIN users u ON u.id=f.uploaded_by
        WHERE f.organization_id=? AND f.deleted_at IS NULL ORDER BY f.created_at DESC LIMIT 300`).bind(auth.organization.id);
  const rows = await query.all();
  return json({ files: (rows.results || []).map((row) => ({
    id: row.id,
    visitId: row.visit_id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: Number(row.size_bytes || 0),
    createdAt: row.created_at,
    uploadedBy: row.uploaded_by,
    username: row.username,
  })) }, 200, cors);
}

async function downloadFile(id, auth, env, cors) {
  const meta = await env.DB.prepare('SELECT * FROM team_file_metadata WHERE id=? AND organization_id=? AND deleted_at IS NULL')
    .bind(id, auth.organization.id).first();
  if (!meta) throw new ApiError(404, 'file_not_found');
  const object = await env.FILES.get(`${auth.organization.id}/${id}`);
  if (!object) throw new ApiError(404, 'file_not_found');
  const headers = new Headers({ ...cors, ...securityHeaders() });
  object.writeHttpMetadata(headers);
  headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`);
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(object.body, { headers });
}

async function deleteFile(id, auth, env, cors) {
  requireWriter(auth);
  const meta = await env.DB.prepare('SELECT id FROM team_file_metadata WHERE id=? AND organization_id=? AND deleted_at IS NULL')
    .bind(id, auth.organization.id).first();
  if (!meta) throw new ApiError(404, 'file_not_found');
  await env.FILES.delete(`${auth.organization.id}/${id}`);
  await env.DB.prepare('UPDATE team_file_metadata SET deleted_at=? WHERE id=? AND organization_id=?')
    .bind(new Date().toISOString(), id, auth.organization.id).run();
  await audit(env, auth.organization.id, auth.user.id, auth.session.id, 'file_deleted', { id });
  return json({ ok: true }, 200, cors);
}

async function audit(env, organizationId, userId, sessionId, action, detail) {
  await env.DB.prepare('INSERT INTO audit_log (id,organization_id,user_id,session_id,action,detail_json,created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), organizationId, userId, sessionId, action, JSON.stringify(detail || {}), new Date().toISOString()).run();
}

async function readJson(request, maxBytes) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length && length > maxBytes) throw new ApiError(413, 'request_too_large');
  const text = await request.text();
  if (encoder.encode(text).byteLength > maxBytes) throw new ApiError(413, 'request_too_large');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new ApiError(400, 'invalid_json'); }
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 210000 }, key, 256);
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
  for (let index = 0; index < x.length; index += 1) diff |= x[index] ^ y[index];
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

function safeFilename(value) {
  return String(value || 'archivo').replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 180) || 'archivo';
}

function publicUserRow(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    activeSessions: Number(row.active_sessions || 0),
  };
}
