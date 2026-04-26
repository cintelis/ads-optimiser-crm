// Personal Access Tokens for programmatic access — separate from session
// auth so cron jobs and integrations don't break when sessions rotate.
// Tokens are stored as SHA-256 hashes; the plaintext only exists in the
// response of the mint endpoint (shown once to the caller).

function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function isoNow() { return new Date().toISOString(); }
function tokenIdGen() { return 'pak_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24); }

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomTokenBody() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verify a presented Authorization header. Returns { user, token } or null.
export async function verifyApiToken(env, presented) {
  if (!presented || typeof presented !== 'string') return null;
  if (!presented.startsWith('pat_')) return null;
  const hash = await sha256Hex(presented);
  const row = await env.DB.prepare(
    `SELECT t.id AS t_id, t.name AS t_name, t.scope AS t_scope, t.owner_user_id,
            t.revoked_at, t.created_at AS t_created_at,
            u.id AS u_id, u.email AS u_email, u.display_name AS u_display_name,
            u.role AS u_role, u.active AS u_active
     FROM api_tokens t
     JOIN users u ON u.id = t.owner_user_id
     WHERE t.token_hash = ?`
  ).bind(hash).first();
  if (!row) return null;
  if (row.revoked_at) return null;
  if (Number(row.u_active) !== 1) return null;
  // Best-effort last-used timestamp.
  env.DB.prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?').bind(isoNow(), row.t_id).run().catch(() => {});
  return {
    token: { id: row.t_id, name: row.t_name, scope: row.t_scope, created_at: row.t_created_at },
    user: {
      id: row.u_id,
      email: row.u_email,
      display_name: row.u_display_name || '',
      role: row.u_role || 'member',
      active: true,
    },
  };
}

// Auth middleware shape — mirrors requireAuth() so handlers can use ctx.user.id.
export async function requireApiToken(req, env) {
  const h = req.headers.get('Authorization') || '';
  const presented = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!presented) return jres({ error: 'Bearer token required' }, 401);
  const ctx = await verifyApiToken(env, presented);
  if (!ctx) return jres({ error: 'Invalid or revoked API token' }, 401);
  return { session: { id: ctx.token.id, is_2fa_pending: false }, user: ctx.user, _apiToken: ctx.token };
}

// ── Admin endpoints (session-authenticated, admin-only) ──────────
// POST /api/admin/api-tokens   — mint
// GET  /api/admin/api-tokens   — list (no plaintext returned)
// DELETE /api/admin/api-tokens/:id — revoke

export async function adminMintApiToken(req, env, ctx) {
  if (ctx.user.role !== 'admin') return jres({ error: 'Admin only' }, 403);
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return jres({ error: 'name required' }, 400);
  if (name.length > 80) return jres({ error: 'name too long (max 80 chars)' }, 400);
  const scope = String(body.scope || 'docs:write');
  if (!['docs:write', 'docs:read'].includes(scope)) return jres({ error: 'invalid scope' }, 400);
  const plaintext = 'pat_' + randomTokenBody();
  const hash = await sha256Hex(plaintext);
  const id = tokenIdGen();
  const ts = isoNow();
  await env.DB.prepare(
    `INSERT INTO api_tokens (id, name, token_hash, owner_user_id, scope, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, name, hash, ctx.user.id, scope, ts).run();
  return jres({
    id, name, scope, created_at: ts,
    token: plaintext,
    note: 'Save this token — it will not be shown again.',
  }, 201);
}

export async function adminListApiTokens(env, ctx) {
  if (ctx.user.role !== 'admin') return jres({ error: 'Admin only' }, 403);
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, t.scope, t.created_at, t.last_used_at, t.revoked_at,
            u.email AS owner_email, u.display_name AS owner_name
     FROM api_tokens t
     LEFT JOIN users u ON u.id = t.owner_user_id
     ORDER BY t.created_at DESC`
  ).all();
  return jres({ tokens: results || [] });
}

export async function adminRevokeApiToken(env, ctx, tokenId) {
  if (ctx.user.role !== 'admin') return jres({ error: 'Admin only' }, 403);
  const row = await env.DB.prepare('SELECT id, revoked_at FROM api_tokens WHERE id=?').bind(tokenId).first();
  if (!row) return jres({ error: 'Token not found' }, 404);
  if (row.revoked_at) return jres({ ok: true, already_revoked: true });
  await env.DB.prepare('UPDATE api_tokens SET revoked_at=? WHERE id=?').bind(isoNow(), tokenId).run();
  return jres({ ok: true });
}
