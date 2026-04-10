// ============================================================
// Totally Wild AI — Integrations admin CRUD (Sprint 5)
// Self-contained: no imports from worker.js. All routes are admin-gated
// by worker.js; handlers here only validate bodies and run D1 queries.
// ============================================================

import { EVENT_TYPES } from './events.js';
import { testWebhook } from './discord.js';

// ── Local helpers (mirror worker.js) ─────────────────────────
function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }
function integrationId() { return `int_${uid().replace(/-/g, '').slice(0, 24)}`; }
function ruleId() { return `nrl_${uid().replace(/-/g, '').slice(0, 24)}`; }
function logId() { return `nlg_${uid().replace(/-/g, '').slice(0, 24)}`; }

const SUPPORTED_KINDS = new Set(['discord']);
const KNOWN_EVENT_TYPES = new Set(Object.values(EVENT_TYPES));
const DISCORD_WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//;

function safeParseJson(str) {
  if (!str) return {};
  try { return JSON.parse(str) || {}; } catch { return {}; }
}

// ── listIntegrations ─────────────────────────────────────────
// GET /api/integrations — admin only (gating in worker.js).
export async function listIntegrations(env) {
  const { results } = await env.DB.prepare(
    `SELECT i.*, COUNT(r.id) AS rule_count
     FROM integrations i
     LEFT JOIN notification_rules r
       ON r.integration_id = i.id AND r.active = 1
     WHERE i.active = 1
     GROUP BY i.id
     ORDER BY i.created_at DESC`
  ).all();
  const integrations = (results || []).map(r => {
    const out = { ...r };
    out.config = safeParseJson(r.config);
    return out;
  });
  return jres({ integrations });
}

// ── createIntegration ────────────────────────────────────────
// POST /api/integrations  body: {kind, name, webhook_url}
export async function createIntegration(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const kind = String(body.kind || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const webhook_url = String(body.webhook_url || '').trim();
  if (!SUPPORTED_KINDS.has(kind)) {
    return jres({ error: "kind must be 'discord'" }, 400);
  }
  if (!name) return jres({ error: 'name required' }, 400);
  if (!DISCORD_WEBHOOK_RE.test(webhook_url)) {
    return jres({ error: 'webhook_url must be a https://discord.com/api/webhooks/... URL' }, 400);
  }
  const id = integrationId();
  const ts = now();
  const config = { webhook_url };
  await env.DB.prepare(
    `INSERT INTO integrations (id, kind, name, config, active, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
  ).bind(id, kind, name, JSON.stringify(config), ctx.user.id, ts, ts).run();
  return jres({
    id, kind, name, config, active: 1,
    created_by: ctx.user.id, created_at: ts, updated_at: ts,
    rule_count: 0,
  });
}

// ── patchIntegration ─────────────────────────────────────────
// PATCH /api/integrations/:id — name, webhook_url, active
export async function patchIntegration(req, env, integrationIdParam) {
  const body = await req.json().catch(() => ({}));
  const existing = await env.DB.prepare(
    'SELECT * FROM integrations WHERE id=?'
  ).bind(integrationIdParam).first();
  if (!existing) return jres({ error: 'Integration not found' }, 404);

  const fields = [];
  const params = [];
  let newConfig = null;

  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return jres({ error: 'name cannot be empty' }, 400);
    fields.push('name=?'); params.push(name);
  }
  if (typeof body.webhook_url === 'string') {
    const url = body.webhook_url.trim();
    if (!DISCORD_WEBHOOK_RE.test(url)) {
      return jres({ error: 'webhook_url must be a https://discord.com/api/webhooks/... URL' }, 400);
    }
    const cfg = safeParseJson(existing.config);
    cfg.webhook_url = url;
    newConfig = cfg;
    fields.push('config=?'); params.push(JSON.stringify(cfg));
  }
  if ('active' in body) {
    fields.push('active=?'); params.push(body.active ? 1 : 0);
  }
  if (!fields.length) return jres({ ok: true, unchanged: true });

  const ts = now();
  fields.push('updated_at=?'); params.push(ts);
  params.push(integrationIdParam);
  await env.DB.prepare(
    `UPDATE integrations SET ${fields.join(', ')} WHERE id=?`
  ).bind(...params).run();
  return jres({ ok: true, updated_at: ts, config: newConfig || safeParseJson(existing.config) });
}

// ── deleteIntegration ────────────────────────────────────────
// DELETE /api/integrations/:id — hard delete the integration AND its rules.
// notification_log rows are preserved as an audit trail.
export async function deleteIntegration(env, integrationIdParam) {
  const existing = await env.DB.prepare(
    'SELECT id FROM integrations WHERE id=?'
  ).bind(integrationIdParam).first();
  if (!existing) return jres({ error: 'Integration not found' }, 404);
  await env.DB.prepare('DELETE FROM notification_rules WHERE integration_id=?').bind(integrationIdParam).run();
  await env.DB.prepare('DELETE FROM integrations WHERE id=?').bind(integrationIdParam).run();
  return jres({ ok: true });
}

// ── listIntegrationRules ─────────────────────────────────────
// GET /api/integrations/:id/rules
export async function listIntegrationRules(env, integrationIdParam) {
  const existing = await env.DB.prepare(
    'SELECT id FROM integrations WHERE id=?'
  ).bind(integrationIdParam).first();
  if (!existing) return jres({ error: 'Integration not found' }, 404);
  const { results } = await env.DB.prepare(
    'SELECT * FROM notification_rules WHERE integration_id=? ORDER BY event_type ASC'
  ).bind(integrationIdParam).all();
  const rules = (results || []).map(r => {
    const out = { ...r };
    out.filter = safeParseJson(r.filter);
    return out;
  });
  return jres({ rules });
}

// ── createIntegrationRule ────────────────────────────────────
// POST /api/integrations/:id/rules  body: {event_type, filter?}
export async function createIntegrationRule(req, env, integrationIdParam) {
  const body = await req.json().catch(() => ({}));
  const event_type = String(body.event_type || '').trim();
  if (!KNOWN_EVENT_TYPES.has(event_type)) {
    return jres({ error: `event_type must be one of: ${Array.from(KNOWN_EVENT_TYPES).join(', ')}` }, 400);
  }
  const existing = await env.DB.prepare(
    'SELECT id FROM integrations WHERE id=?'
  ).bind(integrationIdParam).first();
  if (!existing) return jres({ error: 'Integration not found' }, 404);

  // Normalize filter: accept an object or an empty value; default to {}.
  let filterObj = {};
  if (body.filter && typeof body.filter === 'object') {
    filterObj = body.filter;
  } else if (typeof body.filter === 'string' && body.filter.trim()) {
    filterObj = safeParseJson(body.filter);
  }
  const filterJson = JSON.stringify(filterObj || {});

  const id = ruleId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO notification_rules (id, integration_id, event_type, filter, active, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).bind(id, integrationIdParam, event_type, filterJson, ts).run();
  return jres({
    id, integration_id: integrationIdParam, event_type,
    filter: filterObj, active: 1, created_at: ts,
  });
}

// ── deleteIntegrationRule ────────────────────────────────────
// DELETE /api/integration-rules/:id
export async function deleteIntegrationRule(env, ruleIdParam) {
  const existing = await env.DB.prepare(
    'SELECT id FROM notification_rules WHERE id=?'
  ).bind(ruleIdParam).first();
  if (!existing) return jres({ error: 'Rule not found' }, 404);
  await env.DB.prepare('DELETE FROM notification_rules WHERE id=?').bind(ruleIdParam).run();
  return jres({ ok: true });
}

// ── testIntegration ──────────────────────────────────────────
// POST /api/integrations/:id/test — fires a test embed and logs the outcome.
export async function testIntegration(env, integrationIdParam) {
  const row = await env.DB.prepare(
    'SELECT id, name, config FROM integrations WHERE id=? AND active=1'
  ).bind(integrationIdParam).first();
  if (!row) return jres({ error: 'Integration not found' }, 404);
  const config = safeParseJson(row.config);
  const webhookUrl = config?.webhook_url;
  if (!webhookUrl) return jres({ error: 'webhook_url missing on integration config' }, 400);

  const result = await testWebhook(webhookUrl);
  try {
    await env.DB.prepare(
      `INSERT INTO notification_log
         (id, integration_id, event_type, entity_type, entity_id, status, error, sent_at)
       VALUES (?, ?, 'test', NULL, NULL, ?, ?, ?)`
    ).bind(
      logId(),
      integrationIdParam,
      result.ok ? 'sent' : 'failed',
      result.ok ? null : (result.error || 'unknown error'),
      now()
    ).run();
  } catch (e) {
    console.error('test notification_log insert failed', e?.message || e);
  }
  if (result.ok) return jres({ ok: true });
  return jres({ ok: false, error: result.error || 'unknown error' }, 502);
}

// ── listIntegrationLog ───────────────────────────────────────
// GET /api/integration-log — admin-only health view (last 100 attempts).
export async function listIntegrationLog(env) {
  const { results } = await env.DB.prepare(
    `SELECT l.*, i.name AS integration_name
     FROM notification_log l
     LEFT JOIN integrations i ON i.id = l.integration_id
     ORDER BY l.sent_at DESC
     LIMIT 100`
  ).all();
  return jres({ log: results || [] });
}
