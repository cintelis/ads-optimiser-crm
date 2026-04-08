// ============================================================
// 365 Pulse — Discord dispatcher (Sprint 5)
// Self-contained: no imports from worker.js. Reads rules + integrations
// out of D1, formats Discord rich embeds, fires webhooks with one retry,
// and logs every attempt into notification_log.
// ============================================================

import { EVENT_TYPES } from './events.js';

// Decimal RGB colors for embed accents.
const COLORS = {
  cyan:   0x00C8FF,
  purple: 0x7B5EA7,
  pink:   0xFF2D78,
  green:  0x00E676,
  red:    0xFF5252,
  amber:  0xFFAB40,
  muted:  0x5A5A7A,
};

// Base URL for deep-linking embeds back into the app. Sprint 6/7 adds a
// real router; for now we use a query-param hack.
const BASE_URL = 'https://outreach-dashboard.nick-598.workers.dev';

// ── Local helpers ────────────────────────────────────────────
function now() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }
function logId() { return `nlg_${uid().replace(/-/g, '').slice(0, 24)}`; }

function safeParseJson(str) {
  if (!str) return {};
  try { return JSON.parse(str) || {}; } catch { return {}; }
}

function truncate(s, max = 200) {
  if (!s) return '';
  const clean = String(s).replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

function userLabel(u) {
  if (!u) return 'Unknown';
  return u.display_name || u.email || 'Unknown';
}

// ── matchesFilter ────────────────────────────────────────────
// Rule filter JSON is currently {project_id?, space_id?}. We look at a small
// set of candidate paths on the payload for each key. Empty filter matches all.
function matchesFilter(filterJson, payload) {
  const filter = safeParseJson(filterJson);
  if (!filter || !Object.keys(filter).length) return true;
  if (filter.project_id) {
    const candidates = [
      payload?.project_id,
      payload?.issue?.project_id,
      payload?.sprint?.project_id,
      payload?.page?.project_id,
    ];
    if (!candidates.includes(filter.project_id)) return false;
  }
  if (filter.space_id) {
    const candidates = [
      payload?.space_id,
      payload?.page?.space_id,
    ];
    if (!candidates.includes(filter.space_id)) return false;
  }
  return true;
}

// ── inferEntityType / inferEntityId ──────────────────────────
// Best-effort extraction for the notification_log audit columns.
function inferEntityType(payload) {
  if (!payload) return null;
  if (payload.issue || payload.issue_id) return 'issue';
  if (payload.sprint || payload.sprint_id) return 'sprint';
  if (payload.page || payload.page_id) return 'doc_page';
  if (payload.contact || payload.contact_id) return 'contact';
  return null;
}
function inferEntityId(payload) {
  if (!payload) return null;
  return (
    payload.entity_id ||
    payload.issue?.id || payload.issue_id ||
    payload.sprint?.id || payload.sprint_id ||
    payload.page?.id || payload.page_id ||
    payload.contact?.id || payload.contact_id ||
    null
  );
}

// ── sendDiscordEmbed ─────────────────────────────────────────
// POSTs to a Discord webhook. Throws on non-2xx.
export async function sendDiscordEmbed(webhookUrl, embedPayload) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(embedPayload),
  });
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    throw new Error(`Discord webhook ${res.status}: ${body.slice(0, 300)}`);
  }
  return true;
}

// ── sendAndLog ───────────────────────────────────────────────
// Wraps sendDiscordEmbed with one retry after 2s and always logs the outcome.
async function sendAndLog(env, opts) {
  const { integration_id, event_type, entity_type, entity_id, webhookUrl, embed } = opts;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sendDiscordEmbed(webhookUrl, embed);
      await insertLog(env, { integration_id, event_type, entity_type, entity_id, status: 'sent', error: null });
      return;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  await insertLog(env, {
    integration_id, event_type, entity_type, entity_id,
    status: 'failed', error: (lastErr && lastErr.message) || 'unknown error',
  });
}

async function insertLog(env, row) {
  try {
    await env.DB.prepare(
      `INSERT INTO notification_log
         (id, integration_id, event_type, entity_type, entity_id, status, error, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      logId(),
      row.integration_id,
      row.event_type,
      row.entity_type || null,
      row.entity_id || null,
      row.status,
      row.error || null,
      now()
    ).run();
  } catch (e) {
    console.error('notification_log insert failed', e?.message || e);
  }
}

// ── dispatchEvent ────────────────────────────────────────────
// The entry point called from emit(). Finds matching rules + integrations,
// builds an embed per rule, and schedules delivery via ctx.waitUntil.
export async function dispatchEvent(env, eventType, payload, ctx) {
  if (!eventType) return;
  let rules;
  try {
    rules = await env.DB.prepare(
      `SELECT r.id AS rule_id, r.filter, i.id AS integration_id, i.kind, i.config, i.name
       FROM notification_rules r
       JOIN integrations i ON i.id = r.integration_id
       WHERE r.active = 1 AND i.active = 1 AND r.event_type = ? AND i.kind = 'discord'`
    ).bind(eventType).all();
  } catch (e) {
    console.error('dispatchEvent rule lookup failed', e?.message || e);
    return;
  }
  const list = (rules && rules.results) || [];
  if (!list.length) return;

  for (const rule of list) {
    if (!matchesFilter(rule.filter, payload)) continue;
    const config = safeParseJson(rule.config);
    const webhookUrl = config?.webhook_url;
    if (!webhookUrl) continue;
    let embed;
    try {
      embed = formatEmbedFor(eventType, payload);
    } catch (e) {
      console.error('formatEmbedFor threw', eventType, e?.message || e);
      embed = null;
    }
    if (!embed) continue;
    const task = sendAndLog(env, {
      integration_id: rule.integration_id,
      event_type: eventType,
      entity_type: inferEntityType(payload),
      entity_id: inferEntityId(payload),
      webhookUrl,
      embed,
    });
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(task);
    } else {
      await task;
    }
  }
}

// ── testWebhook ──────────────────────────────────────────────
// Admin "Send test message" helper. Returns a normalized {ok, error?}.
export async function testWebhook(webhookUrl) {
  try {
    await sendDiscordEmbed(webhookUrl, {
      username: '365 Pulse',
      embeds: [{
        title: 'Test message from 365 Pulse',
        description: 'If you can see this, your webhook is configured correctly.',
        color: COLORS.cyan,
        footer: { text: '365 Pulse • integration test' },
        timestamp: new Date().toISOString(),
      }],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown error' };
  }
}

// ── formatEmbedFor ───────────────────────────────────────────
// One case per EVENT_TYPES value. Returns a Discord webhook envelope or
// null if the payload doesn't contain enough data to render a useful card.
export function formatEmbedFor(eventType, payload) {
  const ts = new Date().toISOString();
  const actorName = userLabel(payload?.actor);

  switch (eventType) {
    // ── Issues ────────────────────────────────────────────────
    case EVENT_TYPES.ISSUE_CREATED: {
      const issue = payload?.issue;
      if (!issue) return null;
      const assignee = payload?.assignee ? userLabel(payload.assignee) : 'Unassigned';
      return {
        username: '365 Pulse',
        embeds: [{
          title: `${issue.issue_key}: ${issue.title || ''}`,
          url: `${BASE_URL}/?nav=projects&issue=${issue.id}`,
          description: truncate(issue.description_md, 200),
          color: COLORS.cyan,
          fields: [
            { name: 'Type',     value: String(issue.type || 'task'),     inline: true },
            { name: 'Priority', value: String(issue.priority || 'medium'), inline: true },
            { name: 'Status',   value: String(issue.status || 'todo'),   inline: true },
            { name: 'Assignee', value: assignee,                          inline: true },
            { name: 'Reporter', value: actorName,                         inline: true },
          ],
          footer: { text: `${issue.issue_key} • created by ${actorName}` },
          timestamp: ts,
        }],
      };
    }

    case EVENT_TYPES.ISSUE_UPDATED: {
      const issueId = payload?.issue_id || payload?.issue?.id;
      if (!issueId) return null;
      const key = payload?.issue?.issue_key || payload?.issue_key || issueId;
      const title = payload?.issue?.title || '';
      const changed = Array.isArray(payload?.changed_fields) ? payload.changed_fields.join(', ') : '';
      return {
        username: '365 Pulse',
        embeds: [{
          title: `Updated: ${key}${title ? ': ' + title : ''}`,
          url: `${BASE_URL}/?nav=projects&issue=${issueId}`,
          description: changed ? `Changed fields: ${changed}` : 'Issue updated',
          color: COLORS.purple,
          footer: { text: `${key} • updated by ${actorName}` },
          timestamp: ts,
        }],
      };
    }

    case EVENT_TYPES.ISSUE_ASSIGNED: {
      const issueId = payload?.issue_id || payload?.issue?.id;
      if (!issueId) return null;
      const key = payload?.issue?.issue_key || payload?.issue_key || issueId;
      const title = payload?.issue?.title || '';
      const from = payload?.old_assignee_name
        || (payload?.old_assignee ? userLabel(payload.old_assignee) : null)
        || (payload?.old_assignee_id ? 'Previous assignee' : 'Unassigned');
      const to = payload?.new_assignee_name
        || (payload?.new_assignee ? userLabel(payload.new_assignee) : null)
        || (payload?.new_assignee_id ? 'New assignee' : 'Unassigned');
      return {
        username: '365 Pulse',
        embeds: [{
          title: `Issue assigned: ${key}${title ? ': ' + title : ''}`,
          url: `${BASE_URL}/?nav=projects&issue=${issueId}`,
          color: COLORS.purple,
          fields: [
            { name: 'From', value: String(from), inline: true },
            { name: 'To',   value: String(to),   inline: true },
          ],
          footer: { text: `${key} • by ${actorName}` },
          timestamp: ts,
        }],
      };
    }

    case EVENT_TYPES.ISSUE_STATUS_CHANGED: {
      const issueId = payload?.issue_id || payload?.issue?.id;
      if (!issueId) return null;
      const key = payload?.issue?.issue_key || payload?.issue_key || issueId;
      const title = payload?.issue?.title || '';
      const from = payload?.old_status || 'unknown';
      const to = payload?.new_status || 'unknown';
      const assignee = payload?.assignee ? userLabel(payload.assignee) : null;
      const fields = [
        { name: 'From', value: String(from), inline: true },
        { name: 'To',   value: String(to),   inline: true },
      ];
      if (assignee) fields.push({ name: 'Assignee', value: assignee, inline: true });
      return {
        username: '365 Pulse',
        embeds: [{
          title: `Status changed: ${key}${title ? ': ' + title : ''}`,
          url: `${BASE_URL}/?nav=projects&issue=${issueId}`,
          color: COLORS.amber,
          fields,
          footer: { text: `${key} • by ${actorName}` },
          timestamp: ts,
        }],
      };
    }

    case EVENT_TYPES.ISSUE_COMMENTED: {
      const issueId = payload?.issue_id || payload?.issue?.id;
      if (!issueId) return null;
      const key = payload?.issue?.issue_key || payload?.issue_key || issueId;
      const title = payload?.issue?.title || '';
      return {
        username: '365 Pulse',
        embeds: [{
          title: `New comment on ${key}${title ? ': ' + title : ''}`,
          url: `${BASE_URL}/?nav=projects&issue=${issueId}`,
          description: truncate(payload?.body_md, 200),
          color: COLORS.cyan,
          footer: { text: `${key} • comment by ${actorName}` },
          timestamp: ts,
        }],
      };
    }

    // ── Sprints ───────────────────────────────────────────────
    case EVENT_TYPES.SPRINT_STARTED: {
      const sprint = payload?.sprint;
      if (!sprint) return null;
      const fields = [];
      if (sprint.project_id) fields.push({ name: 'Project', value: String(sprint.project_id), inline: true });
      if (typeof payload?.issue_count === 'number') {
        fields.push({ name: 'Issues', value: String(payload.issue_count), inline: true });
      }
      return {
        username: '365 Pulse',
        embeds: [{
          title: `Sprint started: ${sprint.name || 'Untitled'}`,
          description: truncate(sprint.goal_md || sprint.goal, 200),
          color: COLORS.green,
          fields,
          footer: { text: `Started by ${actorName}` },
          timestamp: ts,
        }],
      };
    }

    case EVENT_TYPES.SPRINT_COMPLETED: {
      const sprint = payload?.sprint;
      if (!sprint) return null;
      const action = payload?.move_action || payload?.action || 'backlog';
      const done = payload?.done_count;
      const moved = payload?.moved_count;
      const fields = [];
      if (typeof done === 'number')  fields.push({ name: 'Done',  value: String(done),  inline: true });
      if (typeof moved === 'number') fields.push({ name: 'Moved', value: String(moved), inline: true });
      fields.push({ name: 'Action', value: String(action), inline: true });
      return {
        username: '365 Pulse',
        embeds: [{
          title: `Sprint completed: ${sprint.name || 'Untitled'}`,
          description: truncate(sprint.goal_md || sprint.goal, 200),
          color: COLORS.green,
          fields,
          footer: { text: `Completed by ${actorName}` },
          timestamp: ts,
        }],
      };
    }

    // ── Docs ──────────────────────────────────────────────────
    case EVENT_TYPES.DOC_PAGE_CREATED: {
      const pageId = payload?.page_id || payload?.page?.id;
      if (!pageId) return null;
      const title = payload?.title || payload?.page?.title || 'Untitled';
      const spaceId = payload?.space_id || payload?.page?.space_id;
      const spaceName = payload?.space_name || '';
      return {
        username: '365 Pulse',
        embeds: [{
          title: `New page: ${title}`,
          url: `${BASE_URL}/?nav=docs&space=${spaceId || ''}&page=${pageId}`,
          description: truncate(payload?.content_md || payload?.page?.content_md, 200),
          color: COLORS.cyan,
          footer: { text: spaceName ? `${spaceName} • by ${actorName}` : `by ${actorName}` },
          timestamp: ts,
        }],
      };
    }

    case EVENT_TYPES.DOC_PAGE_UPDATED: {
      const pageId = payload?.page_id || payload?.page?.id;
      if (!pageId) return null;
      const title = payload?.title || payload?.page?.title || 'Untitled';
      const spaceId = payload?.space_id || payload?.page?.space_id;
      const spaceName = payload?.space_name || '';
      const changed = Array.isArray(payload?.changed_fields) ? payload.changed_fields.join(', ') : '';
      return {
        username: '365 Pulse',
        embeds: [{
          title: `Updated: ${title}`,
          url: `${BASE_URL}/?nav=docs&space=${spaceId || ''}&page=${pageId}`,
          description: changed ? `Changed: ${changed}` : 'Page updated',
          color: COLORS.cyan,
          footer: { text: spaceName ? `${spaceName} • by ${actorName}` : `by ${actorName}` },
          timestamp: ts,
        }],
      };
    }

    case EVENT_TYPES.DOC_PAGE_DELETED: {
      const pageId = payload?.page_id || payload?.page?.id;
      const title = payload?.title || payload?.page?.title || 'Untitled';
      const spaceName = payload?.space_name || '';
      return {
        username: '365 Pulse',
        embeds: [{
          title: `Deleted page: ${title}`,
          description: pageId ? `Page ${pageId} and its descendants were removed.` : 'Page removed.',
          color: COLORS.red,
          footer: { text: spaceName ? `${spaceName} • by ${actorName}` : `by ${actorName}` },
          timestamp: ts,
        }],
      };
    }

    // ── CRM ───────────────────────────────────────────────────
    case EVENT_TYPES.CONTACT_STAGE_CHANGED: {
      const name = payload?.contact_name || payload?.contact?.name || 'Contact';
      const from = payload?.old_stage || 'unknown';
      const to = payload?.new_stage || 'unknown';
      return {
        username: '365 Pulse',
        embeds: [{
          title: `${name}: ${from} → ${to}`,
          color: COLORS.purple,
          footer: { text: `by ${actorName}` },
          timestamp: ts,
        }],
      };
    }

    case EVENT_TYPES.CONTACT_FOLLOWUP_DUE: {
      const name = payload?.contact_name || payload?.contact?.name || 'Contact';
      return {
        username: '365 Pulse',
        embeds: [{
          title: `Follow-up due: ${name}`,
          description: truncate(payload?.note, 200),
          color: COLORS.amber,
          timestamp: ts,
        }],
      };
    }

    default:
      return null;
  }
}
