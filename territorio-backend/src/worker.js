import application from './index-v3.js';

export default {
  async fetch(request, env, context) {
    try {
      return await application.fetch(request, env, context);
    } catch (error) {
      console.error('Unhandled route error:', error);
      const code = String(error?.code || error?.message || 'internal_error');
      const status = Number(error?.status || statusFor(code));
      const origin = request.headers.get('Origin') || '';
      const headers = corsHeaders(origin, env.ALLOWED_ORIGIN);
      headers.set('Content-Type', 'application/json; charset=utf-8');
      headers.set('Cache-Control', 'no-store');
      return new Response(JSON.stringify({ error: code, detail: error?.detail }), { status, headers });
    }
  },
};

function statusFor(code) {
  if (code === 'read_only' || code === 'forbidden') return 403;
  if (code === 'unauthorized') return 401;
  if (code === 'too_many_attempts') return 429;
  if (code === 'file_too_large' || code === 'workspace_too_large' || code === 'request_too_large') return 413;
  if (code === 'revision_conflict' || code === 'last_admin_required' || code === 'cannot_deactivate_current_user') return 409;
  if (code.endsWith('_not_found')) return 404;
  if (code === 'internal_error') return 500;
  return 400;
}

function corsHeaders(origin, allowed) {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Bootstrap-Secret,X-File-Name,X-Visit-Id,X-File-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });
  const allowList = String(allowed || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (origin && (allowList.includes(origin) || allowList.includes('*'))) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return headers;
}
