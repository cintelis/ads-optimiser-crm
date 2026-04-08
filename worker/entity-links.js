// ============================================================
// 365 Pulse — Cross-entity links (Sprint 6)
// Polymorphic links between issues, doc pages, and contacts.
// Self-contained: no imports from worker.js to avoid circular deps.
// Handlers expect (req, env, ctx) where ctx = {session, user} from requireAuth().
// ============================================================

// ── Local helpers (mirror worker.js) ─────────────────────────
function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }
function linkId() { return `elk_${uid().replace(/-/g, '').slice(0, 24)}`; }

const VALID_TYPES = new Set(['issue', 'doc_page', 'contact']);

// ── lookupEntity ─────────────────────────────────────────────
// Returns {title, subtitle} or null if the entity is missing/inactive.
async function lookupEntity(env, type, id) {
  if (!VALID_TYPES.has(type) || !id) return null;
  if (type === 'issue') {
    const row = await env.DB.prepare(
      'SELECT issue_key, title FROM issues WHERE id=?'
    ).bind(id).first();
    if (!row) return null;
    return { title: row.title || '', subtitle: row.issue_key || '' };
  }
  if (type === 'doc_page') {
    const row = await env.DB.prepare(
      'SELECT title FROM doc_pages WHERE id=?'
    ).bind(id).first();
    if (!row) return null;
    return { title: row.title || '', subtitle: '' };
  }
  if (type === 'contact') {
    const row = await env.DB.prepare(
      'SELECT name, email FROM contacts WHERE id=?'
    ).bind(id).first();
    if (!row) return null;
    return { title: row.name || row.email || '', subtitle: row.email || '' };
  }
  return null;
}

// Active-only existence check used by createLink.
async function entityExistsActive(env, type, id) {
  if (type === 'issue') {
    return await env.DB.prepare(
      'SELECT id FROM issues WHERE id=? AND active=1'
    ).bind(id).first();
  }
  if (type === 'doc_page') {
    return await env.DB.prepare(
      'SELECT id FROM doc_pages WHERE id=? AND active=1'
    ).bind(id).first();
  }
  if (type === 'contact') {
    return await env.DB.prepare(
      'SELECT id FROM contacts WHERE id=?'
    ).bind(id).first();
  }
  return null;
}

// ── listLinks ────────────────────────────────────────────────
// GET /api/entity-links?type=...&id=...
export async function listLinks(req, env) {
  const url = new URL(req.url);
  const type = String(url.searchParams.get('type') || '').trim();
  const id = String(url.searchParams.get('id') || '').trim();
  if (!type || !id) {
    return jres({ error: 'type and id required' }, 400);
  }
  if (!VALID_TYPES.has(type)) {
    return jres({ error: `type must be one of: ${Array.from(VALID_TYPES).join(', ')}` }, 400);
  }
  const { results } = await env.DB.prepare(
    `SELECT 'forward' AS direction, l.id, l.to_type AS other_type, l.to_id AS other_id, l.created_at
     FROM entity_links l
     WHERE l.from_type = ? AND l.from_id = ?
     UNION ALL
     SELECT 'backward' AS direction, l.id, l.from_type AS other_type, l.from_id AS other_id, l.created_at
     FROM entity_links l
     WHERE l.to_type = ? AND l.to_id = ?
     ORDER BY created_at DESC`
  ).bind(type, id, type, id).all();

  const links = [];
  for (const r of (results || [])) {
    const meta = await lookupEntity(env, r.other_type, r.other_id);
    links.push({
      id: r.id,
      direction: r.direction,
      other_type: r.other_type,
      other_id: r.other_id,
      title: meta ? meta.title : '(deleted)',
      subtitle: meta ? meta.subtitle : '',
      created_at: r.created_at,
    });
  }
  return jres({ links });
}

// ── createLink ───────────────────────────────────────────────
// POST /api/entity-links  body: {from_type, from_id, to_type, to_id}
export async function createLink(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const from_type = String(body.from_type || '').trim();
  const from_id = String(body.from_id || '').trim();
  const to_type = String(body.to_type || '').trim();
  const to_id = String(body.to_id || '').trim();
  if (!from_type || !from_id || !to_type || !to_id) {
    return jres({ error: 'from_type, from_id, to_type, to_id all required' }, 400);
  }
  if (!VALID_TYPES.has(from_type) || !VALID_TYPES.has(to_type)) {
    return jres({ error: `types must be one of: ${Array.from(VALID_TYPES).join(', ')}` }, 400);
  }
  if (from_type === to_type && from_id === to_id) {
    return jres({ error: 'cannot link an entity to itself' }, 400);
  }

  const fromExists = await entityExistsActive(env, from_type, from_id);
  if (!fromExists) return jres({ error: `${from_type} ${from_id} not found` }, 404);
  const toExists = await entityExistsActive(env, to_type, to_id);
  if (!toExists) return jres({ error: `${to_type} ${to_id} not found` }, 404);

  // Check for an existing link in either direction (UNIQUE only covers one).
  const existing = await env.DB.prepare(
    `SELECT * FROM entity_links
     WHERE (from_type=? AND from_id=? AND to_type=? AND to_id=?)
        OR (from_type=? AND from_id=? AND to_type=? AND to_id=?)
     LIMIT 1`
  ).bind(
    from_type, from_id, to_type, to_id,
    to_type, to_id, from_type, from_id
  ).first();
  if (existing) return jres(existing);

  const id = linkId();
  const ts = now();
  try {
    await env.DB.prepare(
      `INSERT INTO entity_links (id, from_type, from_id, to_type, to_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, from_type, from_id, to_type, to_id, ctx.user.id, ts).run();
  } catch (e) {
    // UNIQUE violation race — return whatever exists.
    const dup = await env.DB.prepare(
      `SELECT * FROM entity_links
       WHERE from_type=? AND from_id=? AND to_type=? AND to_id=?`
    ).bind(from_type, from_id, to_type, to_id).first();
    if (dup) return jres(dup);
    console.error('createLink insert failed', e?.message || e);
    return jres({ error: 'failed to create link' }, 500);
  }
  return jres({
    id, from_type, from_id, to_type, to_id,
    created_by: ctx.user.id, created_at: ts,
  });
}

// ── deleteLink ───────────────────────────────────────────────
// DELETE /api/entity-links/:id — any member+ can delete.
export async function deleteLink(env, ctx, linkIdParam) {
  const row = await env.DB.prepare(
    'SELECT id FROM entity_links WHERE id=?'
  ).bind(linkIdParam).first();
  if (!row) return jres({ error: 'Link not found' }, 404);
  await env.DB.prepare('DELETE FROM entity_links WHERE id=?').bind(linkIdParam).run();
  return jres({ ok: true });
}

// ── deleteLinksForEntity ─────────────────────────────────────
// Helper for cascade deletes. NOT a route handler.
export async function deleteLinksForEntity(env, entityType, entityId) {
  if (!entityType || !entityId) return { deleted: 0 };
  const res = await env.DB.prepare(
    `DELETE FROM entity_links
     WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)`
  ).bind(entityType, entityId, entityType, entityId).run();
  const deleted = (res && res.meta && typeof res.meta.changes === 'number') ? res.meta.changes : 0;
  return { deleted };
}

// ── entitySearch ─────────────────────────────────────────────
// GET /api/entity-search?type=issue|doc_page|contact&q=...
// Returns up to 20 matches in a uniform shape so the link picker can render
// them like listLinks rows: {id, type, title, subtitle}.
export async function entitySearch(req, env) {
  const url = new URL(req.url);
  const type = String(url.searchParams.get('type') || '').trim();
  const qRaw = String(url.searchParams.get('q') || '').trim();
  if (!type) return jres({ error: 'type required' }, 400);
  if (!VALID_TYPES.has(type)) {
    return jres({ error: `type must be one of: ${Array.from(VALID_TYPES).join(', ')}` }, 400);
  }
  // Sanitize LIKE wildcards out of the user input.
  const q = qRaw.replace(/[%_]/g, '');
  const hasQuery = q.length > 0;
  const pat = `%${q}%`;

  let results = [];
  if (type === 'issue') {
    if (hasQuery) {
      const r = await env.DB.prepare(
        `SELECT id, issue_key, title FROM issues
         WHERE active=1 AND (issue_key LIKE ? OR title LIKE ?)
         ORDER BY updated_at DESC LIMIT 20`
      ).bind(pat, pat).all();
      results = r.results || [];
    } else {
      const r = await env.DB.prepare(
        `SELECT id, issue_key, title FROM issues
         WHERE active=1
         ORDER BY updated_at DESC LIMIT 20`
      ).all();
      results = r.results || [];
    }
    const out = results.map(row => ({
      id: row.id,
      type: 'issue',
      title: row.title || '',
      subtitle: row.issue_key || '',
    }));
    return jres({ results: out });
  }
  if (type === 'doc_page') {
    if (hasQuery) {
      const r = await env.DB.prepare(
        `SELECT id, title FROM doc_pages
         WHERE active=1 AND title LIKE ?
         ORDER BY updated_at DESC LIMIT 20`
      ).bind(pat).all();
      results = r.results || [];
    } else {
      const r = await env.DB.prepare(
        `SELECT id, title FROM doc_pages
         WHERE active=1
         ORDER BY updated_at DESC LIMIT 20`
      ).all();
      results = r.results || [];
    }
    const out = results.map(row => ({
      id: row.id,
      type: 'doc_page',
      title: row.title || '',
      subtitle: '',
    }));
    return jres({ results: out });
  }
  if (type === 'contact') {
    if (hasQuery) {
      const r = await env.DB.prepare(
        `SELECT id, name, email FROM contacts
         WHERE unsubscribed=0 AND (name LIKE ? OR email LIKE ?)
         ORDER BY created_at DESC LIMIT 20`
      ).bind(pat, pat).all();
      results = r.results || [];
    } else {
      const r = await env.DB.prepare(
        `SELECT id, name, email FROM contacts
         WHERE unsubscribed=0
         ORDER BY created_at DESC LIMIT 20`
      ).all();
      results = r.results || [];
    }
    const out = results.map(row => ({
      id: row.id,
      type: 'contact',
      title: row.name || row.email || '',
      subtitle: row.email || '',
    }));
    return jres({ results: out });
  }
  return jres({ results: [] });
}
