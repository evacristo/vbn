import backend from './index-v2.js';

const encoder = new TextEncoder();
const API_VERSION = '0.3.0';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return hardened(json({
        ok: true,
        service: 'corrientes-territorial-api',
        version: API_VERSION,
        storage: 'shared-organization-workspace',
        capabilities: ['users', 'roles', 'sessions', 'sync', 'history', 'audit', 'files'],
      }, 200, request, env));
    }

    if (url.pathname === '/api/login' && request.method === 'POST') {
      return hardened(await guardedLogin(request, env));
    }

    const passwordMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
    if (passwordMatch && request.method === 'POST') {
      return hardened(await resetPassword(request, decodeURIComponent(passwordMatch[1]), env));
    }

    if (url.pathname === '/api/audit' && request.method === 'GET') {
      return hardened(await listAudit(request, env));
    }

    if (url.pathname === '/api/organization' && request.method === 'GET') {
      return hardened(await getOrganization(request, env));
    }

    if (url.pathname === '/api/organization' && request.method === 'POST') {
      return hardened(await updateOrganization(request, env));
    }

    const response = await backend.fetch(request, env);

    if (url.pathname === '/api/sync/push' && request.method === 'POST' && response.ok) {
      try {
        const auth = await authenticate(request, env);
        if (auth) await pruneHistory(env, auth.organization.id);
      } catch (error) {
        console.error('history_prune_failed', error);
      }
    }

    return hardened(response);
  },
};

async function guardedLogin(request, env) {
  let username = '';
  try {
    const body = await request.clone().json();
    username = String(body?.username || '').trim();
  } catch {
    // The base backend will return the canonical invalid JSON response.
  }

  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown');
  if (username && await isBlocked(env, username, ipHash)) {
    return json({ error: 'too_many_attempts', retryAfterSeconds: 900 }, 429, request, env, { 'Retry-After': '900' });
  }

  const response = await backend.fetch(request, env);
  if (username) {
    try {
      const success = response.ok;
      await env.DB.prepare('INSERT INTO login_attempts (id,username,ip_hash,success,created_at) VALUES (?,?,?,?,?)')
        .bind(crypto.randomUUID(), username, ipHash, success ? 1 : 0, new Date().toISOString()).run();
      if (success) {
        const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
        await env.DB.prepare('DELETE FROM login_attempts WHERE created_at<?').bind(cutoff).run();
      }
    } catch (error) {
      console.error('login_attempt_record_failed', error);
    }
  }
  return response;
}

async function isBlocked(env, username, ipHash) {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM login_attempts
    WHERE success=0 AND created_at>? AND (username=? COLLATE NOCASE OR ip_hash=?)`)
    .bind(cutoff, username, ipHash).first();
  return Number(row?.count || 0) >= 10;
}

async function resetPassword(request, targetUserId, env) {
  const auth = await authenticate(request, env);
  if (!auth) return json({ error: 'unauthorized' }, 401, request, env);
  if (auth.user.role !== 'admin') return json({ error: 'forbidden' }, 403, request, env);

  const target = await env.DB.prepare(`SELECT u.id,u.username FROM users u
    JOIN organization_members m ON m.user_id=u.id
    WHERE u.id=? AND m.organization_id=?`).bind(targetUserId, auth.organization.id).first();
  if (!target) return json({ error: 'user_not_found' }, 404, request, env);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400, request, env); }
  const password = String(body?.password || '');
  if (password.length < 3 || password.length > 256) return json({ error: 'invalid_password' }, 400, request, env);

  const salt = randomToken(16);
  const passwordHash = await hashPassword(password, salt);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash=?,salt=?,updated_at=? WHERE id=?').bind(passwordHash, salt, now, targetUserId),
    env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now, targetUserId),
    auditStatement(env, auth, 'password_reset', { targetUserId, username: target.username }),
  ]);
  return json({ ok: true, userId: targetUserId, sessionsRevoked: true }, 200, request, env);
}

async function listAudit(request, env) {
  const auth = await authenticate(request, env);
  if (!auth) return json({ error: 'unauthorized' }, 401, request, env);

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)));
  const action = String(url.searchParams.get('action') || '').slice(0, 80);
  let statement;

  if (auth.user.role === 'admin') {
    statement = action
      ? env.DB.prepare(`SELECT a.*,u.username FROM audit_log_v2 a LEFT JOIN users u ON u.id=a.user_id
          WHERE a.organization_id=? AND a.action=? ORDER BY a.created_at DESC LIMIT ?`).bind(auth.organization.id, action, limit)
      : env.DB.prepare(`SELECT a.*,u.username FROM audit_log_v2 a LEFT JOIN users u ON u.id=a.user_id
          WHERE a.organization_id=? ORDER BY a.created_at DESC LIMIT ?`).bind(auth.organization.id, limit);
  } else {
    statement = action
      ? env.DB.prepare(`SELECT a.*,u.username FROM audit_log_v2 a LEFT JOIN users u ON u.id=a.user_id
          WHERE a.organization_id=? AND a.user_id=? AND a.action=? ORDER BY a.created_at DESC LIMIT ?`)
          .bind(auth.organization.id, auth.user.id, action, limit)
      : env.DB.prepare(`SELECT a.*,u.username FROM audit_log_v2 a LEFT JOIN users u ON u.id=a.user_id
          WHERE a.organization_id=? AND a.user_id=? ORDER BY a.created_at DESC LIMIT ?`)
          .bind(auth.organization.id, auth.user.id, limit);
  }

  const rows = await statement.all();
  return json({ audit: (rows.results || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    sessionId: row.session_id,
    action: row.action,
    detail: safeParse(row.detail_json, {}),
    createdAt: row.created_at,
  })) }, 200, request, env);
}

async function getOrganization(request, env) {
  const auth = await authenticate(request, env);
  if (!auth) return json({ error: 'unauthorized' }, 401, request, env);
  const members = await env.DB.prepare(`SELECT COUNT(*) AS count FROM organization_members
    WHERE organization_id=? AND active=1`).bind(auth.organization.id).first();
  return json({ organization: { ...auth.organization, activeMembers: Number(members?.count || 0) } }, 200, request, env);
}

async function updateOrganization(request, env) {
  const auth = await authenticate(request, env);
  if (!auth) return json({ error: 'unauthorized' }, 401, request, env);
  if (auth.user.role !== 'admin') return json({ error: 'forbidden' }, 403, request, env);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400, request, env); }
  const name = String(body?.name || '').trim().slice(0, 120);
  if (name.length < 2) return json({ error: 'invalid_organization_name' }, 400, request, env);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE organizations SET name=?,updated_at=? WHERE id=?').bind(name, now, auth.organization.id),
    auditStatement(env, auth, 'organization_updated', { name }),
  ]);
  return json({ organization: { id: auth.organization.id, name } }, 200, request, env);
}

async function authenticate(request, env) {
  let token = '';
  const authorization = request.headers.get('Authorization') || '';
  if (authorization.startsWith('Bearer ')) token = authorization.slice(7).trim();
  if (!token) token = readCookie(request.headers.get('Cookie') || '', 'ct_session');
  if (!token) return null;

  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`SELECT s.id AS session_id,s.user_id,s.device_id,s.created_at AS session_created_at,s.expires_at,
      u.username,m.role,m.organization_id,o.name AS organization_name
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    JOIN organization_members m ON m.user_id=u.id AND m.active=1
    JOIN organizations o ON o.id=m.organization_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.active=1
    ORDER BY m.created_at LIMIT 1`).bind(tokenHash, new Date().toISOString()).first();
  if (!row) return null;
  return {
    session: { id: row.session_id, deviceId: row.device_id, createdAt: row.session_created_at, expiresAt: row.expires_at },
    user: { id: row.user_id, username: row.username, role: row.role },
    organization: { id: row.organization_id, name: row.organization_name },
  };
}

async function pruneHistory(env, organizationId) {
  await env.DB.prepare(`DELETE FROM organization_workspace_history
    WHERE organization_id=? AND id NOT IN (
      SELECT id FROM organization_workspace_history WHERE organization_id=? ORDER BY revision DESC LIMIT 50
    )`).bind(organizationId, organizationId).run();
}

function auditStatement(env, auth, action, detail) {
  return env.DB.prepare(`INSERT INTO audit_log_v2
    (id,organization_id,user_id,session_id,action,detail_json,created_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), auth.organization.id, auth.user.id, auth.session.id, action, JSON.stringify(detail || {}), new Date().toISOString());
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 180000 }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
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

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map((value) => value.trim()).filter(Boolean);
  const headers = {};
  if (origin && (allowed.includes(origin) || allowed.includes('*'))) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers.Vary = 'Origin';
  }
  return headers;
}

function json(value, status, request, env, extra = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, env),
      ...extra,
    },
  });
}

function hardened(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
