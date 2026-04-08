# HANDOFF — Sprint 5: Discord notifications + @mentions + in-app inbox

**Branch:** `sprint-5-discord-mentions` from `main` (currently at `d5a75d5`).
**Live URL:** https://outreach-dashboard.nick-598.workers.dev
**Depends on:** Sprint 1 (auth + users + activity table + `emit()` stub) and Sprint 2/3/4 (the modules that fire `emit()` calls). Independent of Sprint 6.

---

## Goal

Make the four feature islands (CRM, Tasks, Docs, Auth) start feeling like one product by adding the **communication layer**:

1. **Discord notifications** — admin-configurable webhook integrations with per-event rules. Every issue / sprint / doc-page mutation that already calls `emit()` finally fires a Discord embed.
2. **@mentions in markdown** — type `@` in any comment or page body, autocomplete a user, the mentioned user gets an in-app notification (and optionally a Discord ping in the team channel).
3. **In-app notifications inbox** — bell icon in the topbar with an unread badge, dropdown listing recent items, mark-as-read, deep links to the source entity.
4. **Activity table consolidation** (small) — finally fold the legacy `contact_notes` reads/writes into the `activity` table and drop the legacy table.
5. **Permissions audit** (small) — sweep the legacy CRM/templates/contacts/lists/campaigns endpoints for role gating consistency with Sprints 2–4.

---

## Decisions already locked

| Decision | Value | Rationale |
|---|---|---|
| Discord channel scope | Team-channel webhooks only — **no per-user DMs** | User explicitly chose this earlier; per-user DMs need account linking which is its own feature |
| Webhook auth | Bare URL stored in DB — Discord webhook URLs already contain a secret token | Same model as every other Discord webhook integration; simpler than OAuth |
| Per-event rules | Yes — admin can route specific event types to specific webhooks with optional project filters | Without this everything goes to one channel which is too noisy |
| Discord embed format | Rich embeds (title, url, description, fields, color) | Cards look much better than plain text; Discord renders them inline |
| Embed color coding | Sprint 5 picks one color per event type from the existing accent vars (`--cyan` for created, `--amber` for status changes, `--green` for done/completed, `--red` for blocked, `--purple` for assignments). Sent as decimal RGB to Discord. | Visual scannability |
| Dispatch model | `ctx.waitUntil()` so the user-facing request never blocks on Discord | Workers idiom; identical to how Sprint 1 prep work was scoped |
| Delivery log | New `notification_log` table records every dispatch attempt (status: sent / failed / skipped, error message, timestamps) | Surface in admin Settings → Integrations health view |
| Failure handling | One retry with 2s backoff via `setTimeout` inside the `waitUntil` task. Log the failure either way. | Discord is occasionally flaky; retry is cheap |
| @mention syntax | `@username` where `username` is the part of the user's display name without spaces, OR the part of the email before `@`. Resolved at save-time on the server. | Standard convention. Server-side resolution is the source of truth so the autocomplete UI is just a hint. |
| Mention notification entry-points | Issues (description + comments), doc pages (body), contact notes (body) — anywhere markdown is stored | Every markdown surface participates |
| In-app inbox UI | Bell icon in the topbar between the theme toggle and the Refresh button. Click to open a dropdown panel anchored to the bell. | Standard topbar pattern; matches the existing theme toggle position |
| Inbox poll cadence | Refetched on every `nav()` call (which already happens on every page navigation) + on inbox open | No persistent connection / no SSE; cheap and good enough for v1 |
| Notification entity types | `issue`, `doc_page`, `contact` — match existing entity_type values in the activity table | Reuses existing nomenclature |
| Notification kinds | `mention`, `assignment`, `comment`, `status_change`, `doc_update` | Drives the icon + wording in the inbox |
| Per-user opt-out | NOT in this sprint — everyone gets every notification their account triggers. Opt-out lands in Sprint 6 polish if asked for. | Simpler v1 |
| Legacy contact_notes table | Switch reads + writes to `activity`, then DROP the legacy table in this sprint's migration. The Sprint 1 backfill already populated `activity` so the data is already there. | Long overdue |
| Permissions audit | Sweep the legacy CRM endpoints (contacts, templates, campaigns, lists, logs, unsubscribes) — every write method needs a `viewer` block. Currently they only check `requireAuth`. | Closes the gap |
| File split | New `worker/notifications.js` + `worker/discord.js` (backend), new `public/integrations-ui.js` (admin page) + extension to `app.js` topbar (bell + dropdown), CSS append | Same pattern as previous sprints |
| Vendoring CDN scripts | NOT in this sprint — `marked`/`DOMPurify`/`qrcode` stay on jsdelivr. Sprint 6/7 polish item. | Out of scope |

---

## Schema — `migrations/006_integrations_notifications.sql`

Apply: `npx wrangler d1 execute outreach-db --remote --file=migrations/006_integrations_notifications.sql`

```sql
-- Sprint 5: integrations + per-user notifications

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,                    -- int_{hex}
  kind TEXT NOT NULL,                     -- 'discord' (extensible — telegram/slack later)
  name TEXT NOT NULL,                     -- human label, e.g. "Engineering channel"
  config TEXT NOT NULL,                   -- JSON: {webhook_url} for discord
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_integrations_kind_active ON integrations(kind, active);

CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY,                    -- nrl_{hex}
  integration_id TEXT NOT NULL,
  event_type TEXT NOT NULL,               -- 'issue.created' | 'issue.assigned' | etc
  filter TEXT NOT NULL DEFAULT '{}',      -- JSON: {project_id?: ..., space_id?: ...}
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_rules_event ON notification_rules(event_type, active);
CREATE INDEX IF NOT EXISTS idx_notification_rules_integration ON notification_rules(integration_id);

CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,                    -- nlg_{hex}
  integration_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  status TEXT NOT NULL,                   -- 'sent' | 'failed' | 'skipped'
  error TEXT,
  sent_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_log_sent ON notification_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_integration ON notification_log(integration_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,                    -- ntf_{hex}
  user_id TEXT NOT NULL,                  -- target user
  kind TEXT NOT NULL,                     -- 'mention' | 'assignment' | 'comment' | 'status_change' | 'doc_update'
  entity_type TEXT NOT NULL,              -- 'issue' | 'doc_page' | 'contact'
  entity_id TEXT NOT NULL,                -- the source entity id
  title TEXT NOT NULL,                    -- one-line summary, e.g. "Nick mentioned you in ENG-12"
  body TEXT NOT NULL DEFAULT '',          -- optional excerpt
  link TEXT,                              -- in-app deep link path (e.g. /tasks/issues/iss_123)
  actor_id TEXT,                          -- user who triggered the notification (nullable)
  read_at TEXT,                           -- nullable; null = unread
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_recent ON notifications(user_id, created_at DESC);

-- Drop the legacy contact_notes table (data was backfilled into `activity` in Sprint 1).
-- Verify the activity table has the rows first by running this manually if you're nervous:
--   SELECT COUNT(*) FROM activity WHERE entity_type='contact';
DROP TABLE IF EXISTS contact_notes;
```

**Mirror everything except the DROP into `schema.sql`** under `-- ── Sprint 5: integrations + notifications ──`. Also remove the `contact_notes` block from `schema.sql` so a fresh install never creates it.

---

## API surface

All authenticated. Roles enforced:

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/integrations` | **admin** | List all integrations with rule counts |
| POST | `/api/integrations` | **admin** | Create integration. Body: `{kind:'discord', name, webhook_url}` |
| PATCH | `/api/integrations/:id` | **admin** | Update name / webhook_url / active |
| DELETE | `/api/integrations/:id` | **admin** | Delete integration + cascade delete its rules |
| GET | `/api/integrations/:id/rules` | **admin** | List rules for an integration |
| POST | `/api/integrations/:id/rules` | **admin** | Create rule. Body: `{event_type, filter?:{project_id?, space_id?}}` |
| DELETE | `/api/integration-rules/:id` | **admin** | Delete a single rule |
| POST | `/api/integrations/:id/test` | **admin** | Send a test message to the webhook. Returns `{ok, error?}` |
| GET | `/api/integration-log` | **admin** | List recent notification_log rows (last 100, newest first) |
| GET | `/api/me/notifications` | any | Current user's notifications. Query: `?unread=1` to filter, `?limit=50` (default), `?offset=0` |
| GET | `/api/me/notifications/unread-count` | any | Just the unread count for the bell badge |
| POST | `/api/me/notifications/:id/read` | any | Mark one notification as read |
| POST | `/api/me/notifications/read-all` | any | Mark every unread notification for this user as read |
| GET | `/api/users/mention-search?q=...` | any | Lightweight user lookup for the @mention autocomplete. Returns `[{id, display_name, email}]` matching the prefix. Limit 8. |

---

## `worker/notifications.js` — backend module

New file. Handles in-app notification storage + the @mention parser. Self-contained, redeclares `jres()` / `now()` / `uid()`. Exports:

```
listNotifications(req, env, ctx)
getUnreadCount(env, ctx)
markRead(env, ctx, notificationId)
markAllRead(env, ctx)
createNotification(env, {user_id, kind, entity_type, entity_id, title, body, link, actor_id})
parseMentionsAndNotify(env, {body_md, entity_type, entity_id, actor, link, title})
mentionSearch(req, env)
```

**Mention parser:**

```js
// Match @-followed-by-non-whitespace, extract candidate names.
const MENTION_RE = /(?:^|\s)@([a-zA-Z0-9._-]{2,40})/g;

export async function parseMentionsAndNotify(env, opts) {
  const { body_md, entity_type, entity_id, actor, link, title } = opts;
  const candidates = new Set();
  let match;
  while ((match = MENTION_RE.exec(body_md)) !== null) {
    candidates.add(match[1].toLowerCase());
  }
  if (!candidates.size) return [];

  // Resolve candidates against users table — match against the email prefix
  // (before the @) AND a "slug" of display_name (lowercase, no spaces).
  // Skip the actor (don't notify yourself for your own mention).
  const { results: users } = await env.DB.prepare(
    `SELECT id, email, display_name FROM users WHERE active = 1`
  ).all();
  const matched = [];
  for (const u of (users || [])) {
    if (actor && u.id === actor.id) continue;
    const emailPrefix = String(u.email || '').split('@')[0].toLowerCase();
    const nameSlug = String(u.display_name || '').toLowerCase().replace(/\s+/g, '');
    if (candidates.has(emailPrefix) || (nameSlug && candidates.has(nameSlug))) {
      matched.push(u);
    }
  }
  // Insert one notification row per matched user.
  for (const u of matched) {
    await createNotification(env, {
      user_id: u.id,
      kind: 'mention',
      entity_type, entity_id,
      title: title || `${actor?.display_name || 'Someone'} mentioned you`,
      body: extractMentionExcerpt(body_md, /* match position */ 0),
      link,
      actor_id: actor?.id || null,
    });
  }
  return matched;
}
```

`extractMentionExcerpt(body_md, pos)` — return up to 120 chars around the mention site, stripped of newlines, ellipsis on overflow.

---

## `worker/discord.js` — Discord dispatcher

New file. Self-contained. Exports:

```
dispatchEvent(env, eventType, payload, ctx)
sendDiscordEmbed(webhookUrl, embedPayload)
formatEmbedFor(eventType, payload)
testWebhook(webhookUrl)
```

**`dispatchEvent`:**

```js
export async function dispatchEvent(env, eventType, payload, ctx) {
  // 1. Insert into `activity` for the in-app feed (already happens in handlers — skip)
  // 2. Find matching notification rules + integrations
  const rules = await env.DB.prepare(
    `SELECT r.id AS rule_id, r.filter, i.id AS integration_id, i.kind, i.config, i.name
     FROM notification_rules r
     JOIN integrations i ON i.id = r.integration_id
     WHERE r.active = 1 AND i.active = 1 AND r.event_type = ? AND i.kind = 'discord'`
  ).bind(eventType).all();

  for (const rule of (rules.results || [])) {
    if (!matchesFilter(rule.filter, payload)) continue;
    const config = safeParseJson(rule.config);
    const webhookUrl = config?.webhook_url;
    if (!webhookUrl) continue;
    const embed = formatEmbedFor(eventType, payload);
    if (!embed) continue;
    // Fire-and-forget; logging happens inside the helper
    const task = sendAndLog(env, {
      integration_id: rule.integration_id,
      event_type: eventType,
      entity_type: payload?.entity_type || inferEntityType(payload),
      entity_id: payload?.entity_id || inferEntityId(payload),
      webhookUrl, embed,
    });
    if (ctx?.waitUntil) ctx.waitUntil(task);
    else await task;  // fallback if ctx is missing
  }
}
```

**`matchesFilter`** — JSON filter against payload. Currently supports `{project_id, space_id}`. Returns true if filter is empty or all specified keys match.

**`sendAndLog`** — wraps `sendDiscordEmbed` with try/catch, retry once on failure, INSERT into `notification_log`.

**`formatEmbedFor`** — switch statement, one case per event type from `EVENT_TYPES`. Each returns a Discord embed object:

```js
{
  username: '365 Pulse',
  embeds: [{
    title: 'ENG-12: Login button broken on Safari',
    url: `${BASE_URL}/?nav=projects&issue=iss_...`,   // deep-link query — Sprint 6 may add real router
    description: '...first 200 chars of description...',
    color: 0x00C8FF,           // cyan for created
    fields: [
      { name: 'Type', value: 'bug', inline: true },
      { name: 'Priority', value: 'high', inline: true },
      { name: 'Assignee', value: 'Nick', inline: true },
      { name: 'Reporter', value: 'Alice', inline: true },
    ],
    footer: { text: `ENG • created by Alice` },
    timestamp: new Date().toISOString(),
  }]
}
```

Required cases:
- `ISSUE_CREATED` (cyan)
- `ISSUE_UPDATED` (muted purple)
- `ISSUE_ASSIGNED` (purple) — title `"Issue assigned to {assignee}"`, fields show old + new
- `ISSUE_STATUS_CHANGED` (amber) — title shows the transition
- `ISSUE_COMMENTED` (cyan) — body is the first 200 chars of the comment
- `SPRINT_STARTED` (green)
- `SPRINT_COMPLETED` (green) — fields show counts
- `DOC_PAGE_CREATED` (cyan)
- `DOC_PAGE_UPDATED` (cyan)
- `DOC_PAGE_DELETED` (red)
- `CONTACT_STAGE_CHANGED` (purple)
- `CONTACT_FOLLOWUP_DUE` (amber)

Skip events that don't have an obvious card form (e.g. silent system events).

---

## `worker/events.js` — `emit()` upgrade

The current stub becomes a real function:

```js
import { dispatchEvent } from './discord.js';
import { parseMentionsAndNotify } from './notifications.js';

export async function emit(env, eventType, payload, ctx) {
  if (!eventType) return;
  // 1. Discord dispatch (matched rules → fire embeds)
  try {
    await dispatchEvent(env, eventType, payload, ctx);
  } catch (e) {
    console.error('emit dispatch failed', eventType, e);
  }
  // 2. Mention parsing on entity body, if applicable
  // (Mention parsing is invoked directly from comment/page/issue handlers
  // after the row is inserted, NOT here — emit() doesn't always have the
  // body_md text. The handlers know best when to call parseMentionsAndNotify.)
}
```

The mention parser is **NOT called from `emit()`** because not every event has a markdown body. Instead, the handlers that own a markdown surface call `parseMentionsAndNotify` directly after they insert/update the entity. Specifically:

- **`worker/tasks.js`** → after `addIssueComment`, after `createIssue` (description), after `patchIssue` (description if changed)
- **`worker/docs.js`** → after `createPage` (content), after `patchPage` (content if changed)
- **`worker.js`** legacy contact notes → after the new `addNote` writes to `activity`

Subagent A's job is to add those `parseMentionsAndNotify` calls in the right places. Each takes `{body_md, entity_type, entity_id, actor, link, title}` — link is the in-app path (e.g. `/?nav=projects&issue=iss_xxx`), title is a short label (e.g. `Nick commented on ENG-12`).

---

## `worker.js` integration

Add to imports near the existing module imports:

```js
import {
  listNotifications, getUnreadCount, markRead, markAllRead,
  mentionSearch,
} from './worker/notifications.js';
import {
  listIntegrations, createIntegration, patchIntegration, deleteIntegration,
  listIntegrationRules, createIntegrationRule, deleteIntegrationRule,
  testIntegration, listIntegrationLog,
} from './worker/integrations.js';
```

**Wait — there's a third backend module to add: `worker/integrations.js`** for the integration CRUD. This one is small (~150 lines) and self-contained. Subagent A writes it alongside `worker/notifications.js` and `worker/discord.js`.

Add a Sprint 5 route block in `route()`:

```js
// ── Notifications + Integrations (Sprint 5) ──────────────
if (path === '/api/me/notifications' && m === 'GET') return listNotifications(req, env, authCtx);
if (path === '/api/me/notifications/unread-count' && m === 'GET') return getUnreadCount(env, authCtx);
if (path === '/api/me/notifications/read-all' && m === 'POST') return markAllRead(env, authCtx);
{
  const nm = path.match(/^\/api\/me\/notifications\/([^/]+)\/read$/);
  if (nm && m === 'POST') return markRead(env, authCtx, nm[1]);
}
if (path === '/api/users/mention-search' && m === 'GET') return mentionSearch(req, env);

// Integrations (admin only)
if (path === '/api/integrations' && m === 'GET') {
  if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
  return listIntegrations(env);
}
if (path === '/api/integrations' && m === 'POST') {
  if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
  return createIntegration(req, env, authCtx);
}
{
  const im = path.match(/^\/api\/integrations\/([^/]+)(?:\/(rules|test))?$/);
  if (im) {
    if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
    const intId = im[1];
    const sub = im[2];
    if (!sub) {
      if (m === 'PATCH')  return patchIntegration(req, env, intId);
      if (m === 'DELETE') return deleteIntegration(env, intId);
    }
    if (sub === 'rules') {
      if (m === 'GET')  return listIntegrationRules(env, intId);
      if (m === 'POST') return createIntegrationRule(req, env, intId);
    }
    if (sub === 'test' && m === 'POST') return testIntegration(env, intId);
  }
}
{
  const irm = path.match(/^\/api\/integration-rules\/([^/]+)$/);
  if (irm && m === 'DELETE') {
    if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
    return deleteIntegrationRule(env, irm[1]);
  }
}
if (path === '/api/integration-log' && m === 'GET') {
  if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
  return listIntegrationLog(env);
}
```

---

## Frontend — `public/integrations-ui.js` + topbar bell extension

### `public/integrations-ui.js` — admin Settings → Integrations page

New file. Loaded after `docs-ui.js`. Globals on `window`:

- `loadIntegrations()` / `renderIntegrations()` — admin only; lists all integrations + their rules + recent log entries
- `openCreateIntegration()` modal — name + webhook URL (Discord-only for v1)
- `submitCreateIntegration()`
- `openAddRule(integrationId)` modal — event_type dropdown + project filter (optional) + space filter (optional)
- `submitAddRule()`
- `confirmDeleteIntegration(id)`
- `confirmDeleteRule(id)`
- `testIntegration(id)` — fires test message, shows result inline
- `loadIntegrationLog()` — admin can see "Delivery log" tab inside the page

### Topbar bell + inbox dropdown — extension to `app.js`

The bell icon goes in `index.html` topbar (between theme toggle and Refresh). Wired via new globals defined in either `app.js` or a tiny new file `public/notifications-ui.js` (subagent B's call).

Required globals:

- `loadInbox()` — fetches `/api/me/notifications?limit=20`, stores in `state.inbox.items` and `state.inbox.unread_count`
- `refreshUnreadCount()` — fetches `/api/me/notifications/unread-count` and updates the badge
- `toggleInbox()` — opens/closes the dropdown
- `renderInboxDropdown()` — renders the panel: list of recent notifications grouped into "Unread" and "Earlier"; click an item to mark read + navigate
- `markNotificationRead(id, link)` — POST then navigate via `window.location.hash` or `nav(...)`
- `markAllNotificationsRead()` — POST then refresh

Polling: `refreshUnreadCount()` is called from `init()` after login and from `nav()` on every section change. No long-polling, no SSE for v1.

### `@mention` autocomplete — extension to comment + page editors

Both the issue comment composer (in `tasks-ui.js`) and the doc page editor (in `docs-ui.js`) have markdown textareas. Subagent B adds a small attached autocomplete:

- Detect `@` typed at the start of a word
- Capture the partial name as the user types
- Fetch `/api/users/mention-search?q=...` (debounced 200ms)
- Show a small dropdown anchored below the cursor
- Up/Down to navigate, Enter or Tab to select, Escape to dismiss
- Selecting inserts the chosen `@username` (the email prefix or display name slug — backend resolves either)

This is fiddly UI but small — about 100 lines. The `mention-search` endpoint is the simple part.

### CSS classes the JS uses (Subagent C defines)

- `.topbar-bell`, `.topbar-bell-badge`, `.inbox-dropdown`, `.inbox-dropdown.open`, `.inbox-row`, `.inbox-row.unread`, `.inbox-row-icon`, `.inbox-row-text`, `.inbox-row-time`, `.inbox-empty`, `.inbox-section-label`, `.inbox-foot` (with mark-all-read button)
- `.integration-card`, `.integration-rule-row`, `.integration-test-result`, `.integration-log-table`
- `.mention-pill` (rendered in markdown after parsing — applied in renderMarkdown post-processing OR just styles `@username` plain text)
- `.mention-autocomplete`, `.mention-autocomplete-item`, `.mention-autocomplete-item.active`

---

## Files to touch

| File | Action | Approx size |
|---|---|---|
| `migrations/006_integrations_notifications.sql` | NEW | ~70 lines |
| `schema.sql` | MODIFY — append Sprint 5 block, REMOVE the legacy `contact_notes` block | +60, -10 |
| `worker/notifications.js` | NEW — inbox CRUD + mention parser + mention-search | ~280 lines |
| `worker/discord.js` | NEW — dispatcher + embed formatters + retry/log helper | ~350 lines |
| `worker/integrations.js` | NEW — integration CRUD | ~150 lines |
| `worker/events.js` | MODIFY — `emit()` becomes a real function calling `dispatchEvent` | ~10 lines changed |
| `worker/tasks.js` | MODIFY — call `parseMentionsAndNotify` in addIssueComment / createIssue / patchIssue | +30 lines |
| `worker/docs.js` | MODIFY — call `parseMentionsAndNotify` in createPage / patchPage | +20 lines |
| `worker.js` | MODIFY — imports + Sprint 5 route block + addNote rewrite to use activity table + permissions audit on legacy CRM endpoints | +100, -40 lines |
| `public/integrations-ui.js` | NEW — admin integrations page | ~500 lines |
| `public/notifications-ui.js` | NEW — bell icon + inbox dropdown + mention autocomplete | ~400 lines |
| `public/tasks-ui.js` | MODIFY — wire mention autocomplete on issue comment composer + issue description editor | +30 lines |
| `public/docs-ui.js` | MODIFY — wire mention autocomplete on page editor textarea | +15 lines |
| `public/app.js` | MODIFY — `SECTION_TITLES.integrations`, renderSection branch, init() calls refreshUnreadCount, nav() calls refreshUnreadCount | +20 lines |
| `public/index.html` | MODIFY — bell icon markup in topbar, integrations-ui.js + notifications-ui.js script tags, "Integrations" nav item under Settings (admin only — show/hide via JS) | +10 lines |
| `public/dashboard.css` | MODIFY — bell + badge + inbox dropdown + integrations cards + mention autocomplete + mention pill | +180 lines |

---

## Subagent decomposition

Same shape as Sprints 3 and 4:

- **Subagent A (backend):** Read this handoff + the existing `worker/tasks.js`, `worker/docs.js`, `worker/sprints.js`, `worker/events.js`. Write `worker/notifications.js`, `worker/discord.js`, `worker/integrations.js` from spec. Patch `worker/events.js` for the real `emit()`. Patch `worker/tasks.js` and `worker/docs.js` to call `parseMentionsAndNotify` after every relevant write. Do NOT touch worker.js — main thread integrates routes + does the activity consolidation + permissions audit.

- **Subagent B (frontend):** Read this handoff + `public/tasks-ui.js`, `public/sprints-ui.js`, `public/docs-ui.js`. Write `public/integrations-ui.js` + `public/notifications-ui.js`. Patch `tasks-ui.js` and `docs-ui.js` to wire mention autocomplete on comment composers and page editors (small additive edits — provide exact splice instructions in the report). Do NOT touch app.js or index.html — main thread integrates section dispatch + bell markup + script tags + nav items.

- **Subagent C (CSS):** Read this handoff + the existing dashboard.css. Append a Sprint 5 block defining bell, badge, inbox dropdown, integrations cards, mention autocomplete, mention pill. Use existing theme tokens.

- **Main thread:** migration + schema (including DROP contact_notes), route wiring in worker.js, **rewrite `addNote`/`getNotes`/`deleteNote`/`logStageChangeActivity` in worker.js to read+write the `activity` table instead of `contact_notes`**, **sweep legacy CRM/template/contact/list/campaign endpoints for `viewer` role gating**, app.js section + bell init, index.html bell markup + nav item + script tags, deploy, smoke test.

---

## Acceptance criteria

- [ ] `migrations/006_integrations_notifications.sql` applied; `integrations`, `notification_rules`, `notification_log`, `notifications` tables exist; `contact_notes` is gone
- [ ] `schema.sql` mirrors the migration (no `contact_notes`)
- [ ] All new worker modules import successfully
- [ ] `worker/events.js` `emit()` calls `dispatchEvent`
- [ ] `worker.js` route block + activity rewrites + permissions audit complete; `node -e "import('./worker.js')"` parses
- [ ] All frontend files parse with `node --check`
- [ ] **Live test plan passes:**
  - [ ] As admin, go to Settings → Integrations → Add a Discord integration with a real webhook URL
  - [ ] Click "Test" → a test message appears in the Discord channel
  - [ ] Add a rule: `issue.created` → this integration, no filter
  - [ ] Create a new issue in any project → a Discord embed appears in the channel within seconds
  - [ ] Add another rule: `issue.assigned` → same integration, filter `{project_id: ENG_id}`
  - [ ] Assign an issue in ENG → Discord ping; assign one in OPS → no Discord ping (filter blocked)
  - [ ] Add a third rule: `sprint.started` → no filter
  - [ ] Start a sprint → Discord ping
  - [ ] Open Settings → Integrations → Delivery log tab → see all four sent rows with status `sent`
  - [ ] Set the integration's webhook URL to a known-bad URL → start another sprint → log row appears with status `failed`
  - [ ] **Mention flow:** create another user (or use an existing teammate). As yourself, add a comment on an issue: `Hey @theirname can you review?`. Sign in as that user → bell badge shows `1` → click bell → see the notification → click it → navigates to the issue → bell badge clears
  - [ ] As yourself again, edit a doc page to include `@theirname here's the doc`. Sign in as them → another notification arrives. Mark all as read. Bell clears.
  - [ ] **Permissions audit:** sign in as a viewer → try to PATCH a contact via curl → get 403. Try to POST a template → 403. Read still works.
  - [ ] **Activity consolidation:** create a contact, add a note via the existing CRM page → confirm the note appears (data lives in `activity` table now). Edit the contact's stage → confirm the system row appears in the activity feed. Delete the note → confirm gone. Run `SELECT name FROM sqlite_master WHERE name='contact_notes'` → no row.
  - [ ] Toggle to light theme → bell, inbox dropdown, integrations cards, mention autocomplete all render correctly
  - [ ] No regressions — every existing flow (Tasks board, Docs editor, CRM pipeline, etc.) still works

---

## Out of scope (do NOT build)

- Per-user Discord DM identity linking (the `user_integration_identity` table from earlier planning) — Sprint 6 if asked
- Discord slash commands (Level 2) — Sprint 6/7
- Discord bidirectional sync — explicit "no"
- Telegram, Slack, email notifications — only Discord webhooks for v1
- Per-user notification opt-out / per-event preferences — Sprint 6 polish
- Email digest of notifications — Sprint 6/7
- Real-time push (SSE / websockets) for the inbox — polling on nav() is enough
- Notification grouping ("3 comments on ENG-12") — Sprint 6
- @mention of teams or roles (e.g. `@admins`) — only individual users for v1
- Markdown post-process to render `@username` as a styled pill — keep it as plain text in the rendered HTML for v1; the autocomplete is just an input helper. (Subagent C may still define `.mention-pill` for the future.)
- Cross-linking by paste (`ENG-12` → auto-link, `[[Page]]` → auto-link) — was originally Sprint 5; deferred to Sprint 6/7
- Full-text search (FTS5) — was originally Sprint 5; deferred
- URL deep-linking router — Discord links use `/?nav=projects&issue=iss_xxx` query-param hack; real router lands in Sprint 6/7

---

## Reference reads

- `handoffs/sprint-4-docs-mvp.md` — most recent sprint, same format/conventions
- `worker/events.js` — current `emit()` stub; Sprint 5 makes it real
- `worker/tasks.js` — every place that calls `emit(env, EVENT_TYPES.ISSUE_*, ...)` is where mention parsing also needs to be wired
- `worker/docs.js` — same for `DOC_PAGE_*`
- `worker.js` lines 1450-1490 — current `addNote`/`getNotes`/`deleteNote` against `contact_notes` (these get rewritten to use `activity` in this sprint)
- `worker.js` `route()` function — where viewer role gating currently exists for Sprints 2/3/4 endpoints; legacy CRM endpoints need the same
- `public/tasks-ui.js` issue detail modal — where the comment composer + description editor live (mention autocomplete attaches here)
- `public/docs-ui.js` page editor — where the page body textarea lives (mention autocomplete attaches here)
- `public/index.html` topbar markup — where the bell icon goes (next to the theme toggle)
- `public/dashboard.css` Sprint 2/3/4 utility classes — match style for the new components

---

## Open questions before starting

None, assuming the locked decisions are acceptable. Two checkable assumptions to confirm with the user before starting:

1. **Discord webhook URL** — ready to provide one for end-to-end testing? If not, the integration can be built and tested with a fake URL (the worker just logs failures), but the only way to verify embeds look right is to send to a real channel.
2. **Activity consolidation timing** — happy to drop the legacy `contact_notes` table now? The data is already in `activity` from the Sprint 1 backfill. Worst case if something goes wrong: re-run the backfill from a D1 backup. Recommend: yes, drop it now.

---

## Expected commit log when done

```
feat(notifications): Discord webhooks + @mentions + in-app inbox (Sprint 5)
```

Or split into 2-3 commits if review separation matters:
- `feat(integrations): Discord webhook dispatch + admin integrations page (Sprint 5 backend)`
- `feat(notifications): @mentions + in-app inbox + bell icon (Sprint 5 frontend)`
- `chore(activity): consolidate contact_notes into activity table + permissions audit (Sprint 5 cleanup)`
