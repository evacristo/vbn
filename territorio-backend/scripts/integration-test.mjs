import { rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const port = 8791;
const base = `http://127.0.0.1:${port}`;
const persistPath = '.wrangler-test';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(base + path, options);
  let data = null;
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) data = await response.json();
  else data = await response.arrayBuffer();
  return { response, data };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const result = await request('/health');
      if (result.response.ok) return result.data;
    } catch {
      // Worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Worker did not become healthy.');
}

function authHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

rmSync(persistPath, { recursive: true, force: true });

const init = spawnSync(npx, [
  'wrangler', 'd1', 'execute', 'corrientes-territorial-test',
  '--config', 'wrangler.test.toml', '--local', '--file', 'schema-v2.sql',
  '--persist-to', persistPath,
], { stdio: 'inherit', shell: false });
assert(init.status === 0, 'Local D1 initialization failed.');

const worker = spawn(npx, [
  'wrangler', 'dev', '--config', 'wrangler.test.toml', '--local',
  '--port', String(port), '--persist-to', persistPath, '--log-level', 'error',
], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });

let workerOutput = '';
worker.stdout.on('data', (chunk) => { workerOutput += chunk.toString(); });
worker.stderr.on('data', (chunk) => { workerOutput += chunk.toString(); });

try {
  const health = await waitForHealth();
  assert(health.version === '0.3.0', `Unexpected API version: ${health.version}`);
  assert(health.capabilities?.includes('audit'), 'Hardened capabilities are missing.');

  const bootstrap = await request('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Secret': 'integration-bootstrap' },
    body: JSON.stringify({ username: 'Admin', password: 'Admin', role: 'admin', organizationName: 'Territorio Test' }),
  });
  assert(bootstrap.response.status === 201, `Admin bootstrap failed: ${JSON.stringify(bootstrap.data)}`);

  const adminLogin = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Admin', password: 'Admin', deviceId: 'admin-phone' }),
  });
  assert(adminLogin.response.ok && adminLogin.data.token, 'Admin login failed.');
  const adminToken = adminLogin.data.token;
  assert(adminLogin.data.organization?.name === 'Territorio Test', 'Organization was not returned on login.');
  assert(adminLogin.response.headers.get('x-content-type-options') === 'nosniff', 'Security headers are missing.');

  const createdUsers = {};
  for (const user of [
    { username: 'Editor', password: 'Editor', role: 'editor' },
    { username: 'Viewer', password: 'Viewer', role: 'viewer' },
  ]) {
    const created = await request('/api/admin/users', {
      method: 'POST',
      headers: authHeaders(adminToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(user),
    });
    assert(created.response.status === 201, `Could not create ${user.username}: ${JSON.stringify(created.data)}`);
    createdUsers[user.username] = created.data.user;
  }

  const organization = await request('/api/organization', { headers: authHeaders(adminToken) });
  assert(organization.response.ok && organization.data.organization.activeMembers === 3, 'Organization summary is incorrect.');

  const renamed = await request('/api/organization', {
    method: 'POST',
    headers: authHeaders(adminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: 'Territorio Corrientes Test' }),
  });
  assert(renamed.response.ok && renamed.data.organization.name === 'Territorio Corrientes Test', 'Organization rename failed.');

  const editorLogin = await request('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Editor', password: 'Editor', deviceId: 'editor-tablet' }),
  });
  assert(editorLogin.response.ok, 'Editor login failed.');
  const editorToken = editorLogin.data.token;

  const viewerLogin = await request('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Viewer', password: 'Viewer', deviceId: 'viewer-phone' }),
  });
  assert(viewerLogin.response.ok, 'Viewer login failed.');
  const viewerToken = viewerLogin.data.token;

  const firstPush = await request('/api/sync/push', {
    method: 'POST', headers: authHeaders(adminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ revision: 0, deviceId: 'admin-phone', workspace: { version: 3, relations: [], visits: [], marker: 'admin-v1' } }),
  });
  assert(firstPush.response.ok && firstPush.data.revision === 1, 'Initial workspace push failed.');

  const editorPull = await request('/api/sync/pull', { headers: authHeaders(editorToken) });
  assert(editorPull.response.ok && editorPull.data.workspace.marker === 'admin-v1', 'Editor did not receive shared workspace.');

  const editorPush = await request('/api/sync/push', {
    method: 'POST', headers: authHeaders(editorToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ revision: 1, deviceId: 'editor-tablet', workspace: { version: 3, relations: [{ id: 'r1' }], visits: [], marker: 'editor-v2' } }),
  });
  assert(editorPush.response.ok && editorPush.data.revision === 2, 'Editor workspace push failed.');

  const conflict = await request('/api/sync/push', {
    method: 'POST', headers: authHeaders(adminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ revision: 1, workspace: { version: 3, marker: 'stale-admin' } }),
  });
  assert(conflict.response.status === 409 && conflict.data.revision === 2, 'Revision conflict was not detected.');

  const forced = await request('/api/sync/push', {
    method: 'POST', headers: authHeaders(adminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ revision: 2, force: true, workspace: { version: 3, relations: [{ id: 'r1' }], marker: 'merged-v3' } }),
  });
  assert(forced.response.ok && forced.data.revision === 3, 'Forced merged push failed.');

  const viewerWrite = await request('/api/sync/push', {
    method: 'POST', headers: authHeaders(viewerToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ revision: 3, workspace: { version: 3, marker: 'viewer-write' } }),
  });
  assert(viewerWrite.response.status === 403 && viewerWrite.data.error === 'read_only', 'Viewer write protection failed.');

  const fileBytes = new TextEncoder().encode('archivo compartido');
  const uploaded = await request('/api/files', {
    method: 'POST',
    headers: authHeaders(editorToken, {
      'Content-Type': 'text/plain',
      'X-File-Id': 'shared-file-1',
      'X-File-Name': encodeURIComponent('prueba.txt'),
      'X-Visit-Id': 'visit-1',
    }),
    body: fileBytes,
  });
  assert(uploaded.response.status === 201, `File upload failed: ${JSON.stringify(uploaded.data)}`);

  const downloaded = await request('/api/files/shared-file-1', { headers: authHeaders(adminToken) });
  assert(downloaded.response.ok, 'Admin could not download editor attachment.');
  assert(new TextDecoder().decode(downloaded.data) === 'archivo compartido', 'Downloaded attachment content differs.');

  const history = await request('/api/history', { headers: authHeaders(adminToken) });
  assert(history.response.ok && history.data.history.length >= 2, 'Workspace history was not recorded.');

  const restored = await request('/api/history/1/restore', {
    method: 'POST', headers: authHeaders(adminToken, { 'Content-Type': 'application/json' }), body: '{}',
  });
  assert(restored.response.ok && restored.data.workspace.marker === 'admin-v1', 'Workspace restore failed.');

  const users = await request('/api/admin/users', { headers: authHeaders(adminToken) });
  assert(users.response.ok && users.data.users.length === 3, 'Admin user list is incomplete.');
  const viewer = users.data.users.find((item) => item.username === 'Viewer');
  assert(viewer, 'Viewer account missing from user list.');

  const reset = await request(`/api/admin/users/${encodeURIComponent(createdUsers.Editor.id)}/password`, {
    method: 'POST',
    headers: authHeaders(adminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password: 'EditorNueva' }),
  });
  assert(reset.response.ok && reset.data.sessionsRevoked, 'Password reset failed.');

  const oldEditorLogin = await request('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Editor', password: 'Editor' }),
  });
  assert(oldEditorLogin.response.status === 401, 'Old editor password still works.');

  const newEditorLogin = await request('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Editor', password: 'EditorNueva', deviceId: 'editor-phone-2' }),
  });
  assert(newEditorLogin.response.ok, 'New editor password does not work.');

  const disabled = await request(`/api/admin/users/${encodeURIComponent(viewer.id)}`, {
    method: 'PATCH', headers: authHeaders(adminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ active: false }),
  });
  assert(disabled.response.ok && disabled.data.user.active === false, 'Viewer deactivation failed.');

  const viewerLoginAfterDisable = await request('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Viewer', password: 'Viewer' }),
  });
  assert(viewerLoginAfterDisable.response.status === 401, 'Disabled user can still log in.');

  const sessions = await request('/api/sessions', { headers: authHeaders(adminToken) });
  assert(sessions.response.ok && sessions.data.sessions.some((item) => item.current), 'Current session not listed.');

  const audit = await request('/api/audit?limit=100', { headers: authHeaders(adminToken) });
  assert(audit.response.ok && audit.data.audit.some((item) => item.action === 'password_reset'), 'Audit log does not contain password reset.');
  assert(audit.data.audit.some((item) => item.action === 'organization_updated'), 'Audit log does not contain organization update.');

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const invalid = await request('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Bloqueado', password: `incorrecta-${attempt}` }),
    });
    assert(invalid.response.status === 401, `Unexpected invalid-login status at attempt ${attempt + 1}.`);
  }
  const blocked = await request('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Bloqueado', password: 'otra' }),
  });
  assert(blocked.response.status === 429 && blocked.data.error === 'too_many_attempts', 'Login throttling failed.');

  console.log('Backend v3 integration passed: team sync, roles, files, history, sessions, password reset, audit, organization and login throttling.');
} finally {
  worker.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (worker.exitCode == null) worker.kill('SIGKILL');
  if (process.exitCode && workerOutput) console.error(workerOutput);
}
