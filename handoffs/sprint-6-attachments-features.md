# HANDOFF — Sprint 6: Attachments + saved filters + cross-entity links + feature visibility

**Branch:** `sprint-6-attachments-features` from `main` (currently at `45f2043`).
**Live URL:** https://outreach-dashboard.nick-598.workers.dev
**Depends on:** Sprints 1–5. The R2 bucket `pulse-attachments` is already created and bound as `env.ATTACHMENTS` in `wrangler.toml`.

---

## Goal

Four self-contained workstreams that ship the Sprint 6 productivity layer:

1. **Attachments on issues** — drag-drop file upload, R2-backed storage, image preview, list/download/delete on the issue detail modal.
2. **Saved filters / "My open issues"** — per-user saved filters stored in `users.preferences`, plus a "My open issues" widget on the Overview page.
3. **Cross-entity linking** — a polymorphic `entity_links` table letting issues, doc pages, and contacts reference each other; backlinks panel on every detail surface.
4. **Feature visibility settings** — admin Settings page where admin chooses which top-level sections (Outreach, CRM, Tasks, Docs) members and viewers can see. Hidden in nav AND enforced server-side via the request router.

---

## Decisions already locked

| Decision | Value | Rationale |
|---|---|---|
| Attachment storage | Cloudflare R2 bucket `pulse-attachments` already created and bound as `env.ATTACHMENTS` | Native Workers integration, free tier covers internal-team scale |
| Attachment metadata | Stored in a new `attachments` D1 table; the actual blob in R2 keyed by `att_{id}/{filename}` | Standard split — DB owns metadata, R2 owns bytes |
| Attachment scope | Polymorphic `entity_type`+`entity_id` so issues, contacts, doc pages can all use it | Same pattern as the `activity` table |
| Max file size | 25 MB per file | Reasonable for screenshots, PDFs, small docs. Larger needs streaming uploads which is its own thing |
| Allowed MIME types | All — we don't block anything for an internal tool | Trust the team |
| Image previews | Inline `<img>` for `image/*` MIME types using a signed URL | Cheapest path |
| Signed URL TTL | 1 hour | Long enough to view, short enough that links don't get reshared |
| Signed URL implementation | Workers can serve R2 objects directly via the binding — `env.ATTACHMENTS.get(key)` returns the body. Frontend hits `/api/attachments/:id/download` which streams the blob with proper headers. No actual signing needed at this scale. | Simpler than presigned S3-style URLs |
| Delete cascade | Deleting an issue (or contact, or doc page) hard-deletes its attachment metadata rows AND deletes the R2 objects | Avoid orphaned blobs |
| Saved filters storage | Inside `users.preferences` JSON, namespaced by section: `preferences.saved_filters.tasks = [{name, filters}]` | No new table needed |
| "My open issues" widget | New card on the Overview page showing the current user's open issues across all projects, ordered by priority then due date, max 10 | Surfaces the most-used personal view |
| Cross-entity link table | Single `entity_links` table with `from_type/from_id/to_type/to_id`, no `kind` field for v1 (all links are equal) | Simpler; can add link types later |
| Linked items panel location | Bottom of issue detail modal, bottom of doc page view, bottom of contact drawer | One pattern, three surfaces |
| Linking UX | "+ Link" button opens a small modal with a dropdown (Issue / Contact / Doc page) and a search field. Backend search via existing endpoints | No drag-and-drop magic for v1 |
| Feature visibility storage | New `app_settings` table with key/value JSON rows. One row `key='feature_visibility'` holds the matrix `{outreach:{member:bool,viewer:bool}, crm:..., tasks:..., docs:...}` | Single row, simple shape, easy to extend |
| Feature visibility default | Everyone sees everything | Backwards-compatible; admin opts in to hiding |
| Admin-always | Admin role bypasses all feature visibility checks. Admin always sees everything. | Avoid lockout |
| Server enforcement | A `FEATURE_GATES` array maps URL prefixes → feature keys. The router checks before dispatching. Returns 403 with a clear message. | Defense in depth — client hiding alone is bypassable |
| Client enforcement | After login, `state.featureFlags` is loaded from the server. `applyRoleVisibility()` extends to also hide nav items based on those flags | One-line addition to the existing function |
| Settings page | New "Feature visibility" entry in the Settings group, admin-only, simple checkbox grid (sections × roles) | Mirrors the existing Users / Integrations admin pages |
| File split | New backend modules `worker/attachments.js`, `worker/entity-links.js`, `worker/app-settings.js`. New frontend modules `public/attachments-ui.js`, `public/linked-items-ui.js`, `public/feature-settings-ui.js`. CSS append. Minor splices into `tasks-ui.js`, `docs-ui.js`, `app.js`, `index.html`. | Same pattern as Sprints 3-5 |

---

## Schema — three migrations

### `migrations/007_attachments.sql`

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,                    -- att_{hex}
  entity_type TEXT NOT NULL,              -- 'issue' | 'doc_page' | 'contact'
  entity_id TEXT NOT NULL,
  filename TEXT NOT NULL,                 -- original upload filename
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,            -- e.g. 'att_xxx/screenshot.png'
  uploaded_by TEXT NOT NULL,              -- user_id
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_uploader ON attachments(uploaded_by);
```

### `migrations/008_entity_links.sql`

```sql
CREATE TABLE IF NOT EXISTS entity_links (
  id TEXT PRIMARY KEY,                    -- elk_{hex}
  from_type TEXT NOT NULL,                -- 'issue' | 'doc_page' | 'contact'
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(from_type, from_id, to_type, to_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_links_from ON entity_links(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_to ON entity_links(to_type, to_id);
```

### `migrations/009_app_settings.sql`

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- Seed default feature visibility (everyone sees everything)
INSERT OR IGNORE INTO app_settings (key, value, updated_at, updated_by)
VALUES (
  'feature_visibility',
  '{"outreach":{"member":true,"viewer":true},"crm":{"member":true,"viewer":true},"tasks":{"member":true,"viewer":true},"docs":{"member":true,"viewer":true}}',
  datetime('now'),
  NULL
);
```

**Mirror all three into `schema.sql`** under three new section headers.

---

## API surface

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/attachments?entity_type=...&entity_id=...` | any | List attachments for an entity. Returns metadata only (no blob). |
| POST | `/api/attachments` | member+ | Upload. Multipart form with `file`, `entity_type`, `entity_id`. Validates size + writes to R2 + inserts row. Returns the metadata row. |
| GET | `/api/attachments/:id/download` | any | Stream the blob from R2 with proper Content-Type and Content-Disposition. |
| GET | `/api/attachments/:id/preview` | any | Same as download but with inline disposition (for `<img>` tags). |
| DELETE | `/api/attachments/:id` | uploader or admin | Delete metadata row + R2 object. |
| GET | `/api/entity-links?type=...&id=...` | any | List all links to/from an entity. Returns both directions, joined with the linked entity's title. |
| POST | `/api/entity-links` | member+ | Create. Body: `{from_type, from_id, to_type, to_id}`. Idempotent (UNIQUE constraint). |
| DELETE | `/api/entity-links/:id` | member+ | Delete. |
| GET | `/api/me/saved-filters` | any | Returns the current user's saved filters: `{tasks: [...], docs: [...]}` |
| PUT | `/api/me/saved-filters` | any | Replace the saved filters object. Body: `{section: 'tasks', filters: [...]}` |
| GET | `/api/me/my-issues` | any | Returns the current user's open issues across all projects, max 10, ordered by priority desc + due_at asc + updated_at desc |
| GET | `/api/app-settings/feature-visibility` | any | Current feature visibility map. Used by frontend on login + by middleware. Returns `{outreach:{member,viewer}, crm:{member,viewer}, tasks:{member,viewer}, docs:{member,viewer}}` |
| PATCH | `/api/app-settings/feature-visibility` | **admin** | Update the matrix. Body: same shape. |

---

## Backend modules

### `worker/attachments.js`

Self-contained. Exports:

```
listAttachments(req, env)
uploadAttachment(req, env, ctx)
downloadAttachment(env, attachmentId, inline)
deleteAttachment(env, ctx, attachmentId)
deleteAttachmentsForEntity(env, entityType, entityId)   // helper for cascades
```

Key behaviors:
- `uploadAttachment`: parse multipart via `req.formData()`. Get `file` (a `File` object), `entity_type`, `entity_id`. Validate size ≤ 25 MB. Generate r2_key as `${attachmentId}/${sanitizedFilename}`. Store in R2 via `env.ATTACHMENTS.put(r2_key, file.stream(), {httpMetadata: {contentType: file.type}})`. Insert metadata row. Return the row.
- `downloadAttachment`: load metadata, fetch from R2 via `env.ATTACHMENTS.get(r2_key)`. Stream with `Content-Type` from metadata and `Content-Disposition` (`inline` for preview, `attachment` for download).
- `deleteAttachment`: load metadata, check uploader_id === ctx.user.id OR ctx.user.role === 'admin', delete from R2, delete row.
- `deleteAttachmentsForEntity`: SELECT all rows, batch DELETE from R2, DELETE all rows. Used by issue/page/contact delete cascades.

### `worker/entity-links.js`

Exports:

```
listLinks(req, env)            // for one entity, both directions
createLink(req, env, ctx)
deleteLink(env, ctx, linkId)
deleteLinksForEntity(env, entityType, entityId)
```

`listLinks` query:
```sql
-- Forward
SELECT 'forward' AS direction, l.id, l.to_type AS other_type, l.to_id AS other_id, l.created_at
FROM entity_links l
WHERE l.from_type = ? AND l.from_id = ?
UNION ALL
-- Backward
SELECT 'backward' AS direction, l.id, l.from_type AS other_type, l.from_id AS other_id, l.created_at
FROM entity_links l
WHERE l.to_type = ? AND l.to_id = ?
```

Then for each row, lookup the linked entity's title:
- `issue` → `SELECT issue_key, title FROM issues WHERE id=?`
- `doc_page` → `SELECT title FROM doc_pages WHERE id=?`
- `contact` → `SELECT name, email FROM contacts WHERE id=?`

Return shape:
```json
{
  "links": [
    {"id": "elk_...", "direction": "forward", "other_type": "contact", "other_id": "...", "title": "Acme Corp", "subtitle": "ceo@acme.com", "created_at": "..."},
    ...
  ]
}
```

### `worker/app-settings.js`

Exports:

```
getFeatureVisibility(env)              // returns the parsed matrix
patchFeatureVisibility(req, env, ctx)  // admin-only
isFeatureAllowed(env, featureKey, role) // helper used by route gate
```

`getFeatureVisibility` reads the row, parses JSON, returns `{outreach, crm, tasks, docs}` with safe defaults if the row is missing.

`patchFeatureVisibility` validates the shape, merges with existing, writes back, returns the updated matrix.

`isFeatureAllowed` is the runtime check used by `worker.js` route gating:
```js
async function isFeatureAllowed(env, featureKey, role) {
  if (role === 'admin') return true;
  const visibility = await getFeatureVisibilityCached(env);
  return visibility[featureKey]?.[role] !== false;
}
```

Cache the visibility map in module-level state with a 30-second TTL to avoid hitting D1 on every request.

---

## `worker.js` integration

Add imports:

```js
import {
  listAttachments, uploadAttachment, downloadAttachment, deleteAttachment,
  deleteAttachmentsForEntity,
} from './worker/attachments.js';
import {
  listLinks, createLink, deleteLink, deleteLinksForEntity,
} from './worker/entity-links.js';
import {
  getFeatureVisibility, patchFeatureVisibility, isFeatureAllowed,
} from './worker/app-settings.js';
```

Add Sprint 6 route block above Sprint 5's:

```js
// ── Sprint 6: attachments + entity links + saved filters + app settings ──

// Attachments
if (path === '/api/attachments' && m === 'GET')  return listAttachments(req, env);
if (path === '/api/attachments' && m === 'POST') return uploadAttachment(req, env, authCtx);
{
  const am = path.match(/^\/api\/attachments\/([^/]+)\/(download|preview)$/);
  if (am && m === 'GET') return downloadAttachment(env, am[1], am[2] === 'preview');
}
{
  const am = path.match(/^\/api\/attachments\/([^/]+)$/);
  if (am && m === 'DELETE') return deleteAttachment(env, authCtx, am[1]);
}

// Entity links
if (path === '/api/entity-links' && m === 'GET')  return listLinks(req, env);
if (path === '/api/entity-links' && m === 'POST') return createLink(req, env, authCtx);
{
  const lm = path.match(/^\/api\/entity-links\/([^/]+)$/);
  if (lm && m === 'DELETE') return deleteLink(env, authCtx, lm[1]);
}

// Saved filters + my issues
if (path === '/api/me/saved-filters' && m === 'GET') return getMySavedFilters(env, authCtx);
if (path === '/api/me/saved-filters' && m === 'PUT') return setMySavedFilters(req, env, authCtx);
if (path === '/api/me/my-issues' && m === 'GET') return getMyIssues(env, authCtx);

// Feature visibility
if (path === '/api/app-settings/feature-visibility' && m === 'GET') return getFeatureVisibility(env).then(v => jres(v));
if (path === '/api/app-settings/feature-visibility' && m === 'PATCH') {
  if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
  return patchFeatureVisibility(req, env, authCtx);
}
```

Note: `getMySavedFilters`, `setMySavedFilters`, `getMyIssues` are small enough to live directly in worker.js (next to the other `/api/me` handlers) — they're not big enough to justify a separate module.

### Feature visibility gate

After `requireAuth` resolves and before the existing route dispatch, add:

```js
// Sprint 6: feature visibility check (admin always allowed)
const FEATURE_GATES = [
  { prefix: '/api/templates', feature: 'outreach' },
  { prefix: '/api/contacts', feature: 'outreach' },
  { prefix: '/api/lists', feature: 'outreach' },
  { prefix: '/api/campaigns', feature: 'outreach' },
  { prefix: '/api/logs', feature: 'outreach' },
  { prefix: '/api/unsubscribes', feature: 'outreach' },
  { prefix: '/api/crm', feature: 'crm' },
  { prefix: '/api/projects', feature: 'tasks' },
  { prefix: '/api/issues', feature: 'tasks' },
  { prefix: '/api/sprints', feature: 'tasks' },
  { prefix: '/api/doc-spaces', feature: 'docs' },
  { prefix: '/api/doc-pages', feature: 'docs' },
];
if (authCtx.user.role !== 'admin') {
  for (const gate of FEATURE_GATES) {
    if (path.startsWith(gate.prefix)) {
      const allowed = await isFeatureAllowed(env, gate.feature, authCtx.user.role);
      if (!allowed) return jres({ error: `The ${gate.feature} feature is disabled for your role` }, 403);
      break;
    }
  }
}
```

This goes inside `route()` after the existing viewer write-method gate.

### Cascade hooks

In the existing `deleteIssue` (worker/tasks.js), `deletePage` (worker/docs.js), and `deleteContact` (worker.js), add `await deleteAttachmentsForEntity(env, ...)` and `await deleteLinksForEntity(env, ...)` calls after the existing cascade work. The subagent prompts cover this.

---

## Frontend modules

### `public/attachments-ui.js`

Self-contained module exposing globals on `window`. Used by tasks-ui.js, docs-ui.js, contact drawer:

```
loadAttachments(entityType, entityId)         // returns array
renderAttachmentsList(containerEl, entityType, entityId)
attachUploadHandler(dropZoneEl, entityType, entityId, onUploaded)
deleteAttachmentConfirm(attachmentId, entityType, entityId)
```

The render function takes a container element and re-renders it with the current attachment list. Each row shows filename, size (human-readable), uploaded by, time, and actions: download, preview (if image), delete (if uploader or admin).

The upload handler attaches a `dragover`, `drop`, and `change` listener to a drop zone element (which contains an `<input type="file" multiple>`). On file selection or drop, it iterates files and POSTs each via FormData. On success, calls `onUploaded()` to refresh the list.

### `public/linked-items-ui.js`

Globals:

```
loadLinks(entityType, entityId)
renderLinksPanel(containerEl, entityType, entityId)
openCreateLinkModal(entityType, entityId, onCreated)
submitCreateLink(entityType, entityId)
deleteLinkConfirm(linkId, entityType, entityId)
```

The "Add link" modal has a section selector (Issue / Contact / Doc page) and a search input. As the user types, hit a search endpoint:
- Issue → `/api/issues/...` doesn't have a search endpoint. Use `/api/projects/:id/issues?q=...` for the user's main project, or skip search and just paste an issue key. **Easier UX for v1: dropdown selector only — no search.** The user picks the entity type, then a dropdown is populated with up to 50 most-recent matches (loaded from `/api/projects/all` for issues, `/api/contacts` for contacts, `/api/doc-spaces` traversal for pages — or a single new lightweight endpoint).
- Actually, simplest: add a `/api/entity-search?type=issue&q=xxx` lightweight endpoint that returns id+title pairs. Subagent A adds this.

OK revised: add `entitySearch` to `worker/entity-links.js` and a `GET /api/entity-search?type=issue|contact|doc_page&q=xxx` route. Returns up to 20 matches.

### `public/feature-settings-ui.js`

Admin Settings page. Globals:

```
renderFeatureSettingsSection()
loadFeatureSettings()
toggleFeatureFlag(feature, role, value)
saveFeatureSettings()
```

The page is a simple table:

| Feature | Member | Viewer |
|---|---|---|
| Outreach (Templates, Contacts, Lists, Campaigns) | ☑ | ☑ |
| CRM (Pipeline, Follow-ups) | ☑ | ☑ |
| Tasks (Projects, Sprints, Board) | ☑ | ☑ |
| Docs (Spaces, Pages) | ☑ | ☑ |

Each checkbox toggle PATCHes the matrix and re-renders.

### Frontend integration

**`public/app.js`**:
- Add `state.featureFlags = null`. Load from `/api/app-settings/feature-visibility` after `refreshMe()` in `init()` AND in `onLoginSuccess()`.
- Extend `applyRoleVisibility()` to ALSO hide nav items based on `state.featureFlags` for non-admin users:
  ```js
  function applyFeatureVisibility() {
    if (!state.featureFlags || isAdmin()) return;
    const role = state.me?.role;
    const flags = state.featureFlags;
    const sectionMap = {
      outreach: ['nav-templates','nav-contacts','nav-lists','nav-campaigns','nav-logs','nav-unsubs','more-templates','more-contacts','more-lists','more-campaigns','more-logs','more-unsubs'],
      crm: ['nav-pipeline','nav-followups','tab-pipeline','tab-followups'],
      tasks: ['nav-projects','more-projects'],
      docs: ['nav-docs','more-docs'],
    };
    for (const [feature, ids] of Object.entries(sectionMap)) {
      const allowed = flags[feature]?.[role] !== false;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.style.display = allowed ? '' : 'none';
      }
    }
  }
  ```
  Call this from `applyRoleVisibility()` after the existing logic.
- Add a new section to `SECTION_TITLES`: `feature_settings: 'Feature visibility'`
- Add a `renderSection` branch for `feature_settings` that calls `renderFeatureSettingsSection()` (admin only).
- "My open issues" widget on Overview: add a small placeholder `<div id="my-issues-widget"></div>` to the existing `renderOverview()` HTML, and after rendering, call `renderMyIssuesWidget()` (a global from `app.js` itself or a tiny new helper). The widget fetches `/api/me/my-issues` and renders 5-10 rows.

**`public/index.html`**:
- Add "Feature visibility" nav item under Settings (admin-only, hidden by JS):
  ```html
  <button class="nav-item" id="nav-feature-settings" type="button" onclick="nav('feature_settings')" style="display:none">Feature visibility</button>
  ```
- Add 3 script tags:
  ```html
  <script src="/attachments-ui.js" defer></script>
  <script src="/linked-items-ui.js" defer></script>
  <script src="/feature-settings-ui.js" defer></script>
  ```

**`public/tasks-ui.js`**: in the issue detail modal (after the activity feed, before the modal-foot), add two new sections — Attachments and Linked items. Subagent B provides exact splice instructions.

**`public/docs-ui.js`**: in the page view (below the children-list footer), add a Linked items section. Subagent B provides exact splice instructions.

---

## Files to touch

| File | Action | Approx size |
|---|---|---|
| `migrations/007_attachments.sql` | NEW | ~15 |
| `migrations/008_entity_links.sql` | NEW | ~15 |
| `migrations/009_app_settings.sql` | NEW | ~15 |
| `schema.sql` | MODIFY — append three new sections | +50 |
| `wrangler.toml` | ALREADY DONE — R2 binding present | n/a |
| `worker/attachments.js` | NEW | ~250 |
| `worker/entity-links.js` | NEW (includes the entitySearch endpoint) | ~200 |
| `worker/app-settings.js` | NEW (with cached read helper) | ~120 |
| `worker.js` | MODIFY — imports + Sprint 6 route block + FEATURE_GATES check + getMyIssues/getMySavedFilters/setMySavedFilters helpers + cascade calls in deleteContact | +180 |
| `worker/tasks.js` | MODIFY — call deleteAttachmentsForEntity + deleteLinksForEntity in deleteIssue | +6 |
| `worker/docs.js` | MODIFY — call deleteAttachmentsForEntity + deleteLinksForEntity in deletePage | +6 |
| `public/attachments-ui.js` | NEW | ~350 |
| `public/linked-items-ui.js` | NEW | ~400 |
| `public/feature-settings-ui.js` | NEW | ~180 |
| `public/tasks-ui.js` | MODIFY — splice attachments + linked items panels into issue detail modal | +30 |
| `public/docs-ui.js` | MODIFY — splice linked items panel into page view | +15 |
| `public/app.js` | MODIFY — feature flags load + applyFeatureVisibility + my-issues widget + section dispatch | +80 |
| `public/index.html` | MODIFY — script tags + nav item | +5 |
| `public/dashboard.css` | MODIFY — attachments list, drop zone, linked items, feature settings table, my-issues widget | +160 |

---

## Subagent decomposition

- **Subagent A (backend):** Read this handoff + existing modules. Write `worker/attachments.js`, `worker/entity-links.js` (including the entitySearch helper), `worker/app-settings.js`. Patch `worker/tasks.js` and `worker/docs.js` to add cascade hooks. Do NOT touch worker.js — main thread integrates routes + feature gate + getMyIssues/getMySavedFilters/setMySavedFilters helpers.

- **Subagent B (frontend):** Read this handoff + existing tasks-ui.js, docs-ui.js, app.js. Write `public/attachments-ui.js`, `public/linked-items-ui.js`, `public/feature-settings-ui.js`. Provide exact splice instructions for tasks-ui.js (issue detail modal — attachments + linked items panels) and docs-ui.js (page view — linked items panel). Provide a `renderMyIssuesWidget()` function with the spec for where to add it in app.js (main thread does the splice).

- **Subagent C (CSS):** Append a Sprint 6 block defining all classes for the attachments list, drop zone, linked items panel, feature settings table, my-issues widget. Use existing theme tokens.

- **Main thread:** Migrations (3) + schema, route wiring + FEATURE_GATES gate + getMyIssues/getMySavedFilters/setMySavedFilters in worker.js, tasks-ui.js + docs-ui.js splices, app.js feature flags + my-issues widget integration, index.html nav item + script tags, deploy, smoke test.

---

## Acceptance criteria

- [ ] All three migrations applied; tables exist
- [ ] R2 bucket `pulse-attachments` accessible (create + download flows work)
- [ ] All new worker modules import successfully; `worker.js` parses
- [ ] All new frontend modules + patched files parse with `node --check`
- [ ] **Live test plan:**
  - [ ] Open an issue → see new "Attachments" section. Drag a screenshot file in → uploads, appears in the list with size + uploader
  - [ ] Click the image filename → opens preview in a new tab
  - [ ] Upload a non-image (PDF) → appears, no preview, click downloads
  - [ ] Delete an attachment as the uploader → gone. As admin, can delete anyone's
  - [ ] **Linked items:** open an issue → "+ Link" → pick "Contact", search → select → contact appears in the linked items panel
  - [ ] Open the linked contact → it shows the issue in its backlinks
  - [ ] Same flow for issue ↔ doc page, doc page ↔ contact, etc.
  - [ ] Delete a link → gone from both directions
  - [ ] **Saved filters:** in Tasks → set a filter combo → click "Save filter" → name it → reload page → click the saved filter chip → filter restored
  - [ ] **My issues widget:** Overview page shows a "My open issues" card with up to 10 issues assigned to you, ordered by priority
  - [ ] **Feature visibility:** Settings → Feature visibility (admin only) → uncheck "Outreach" for member → save
  - [ ] Sign in as a member → Outreach nav items (Templates / Contacts / Lists / Campaigns / Sent Log / Unsubscribes) are hidden → trying to GET /api/contacts via curl returns 403
  - [ ] Re-enable as admin → member can see Outreach again
  - [ ] Toggle to light theme → all new UI renders correctly

---

## Out of scope

- File preview for non-images (PDF inline preview, video, etc.) — download only for v1
- Drag-to-reorder attachments
- Image thumbnails in the list (just filename for v1)
- Per-attachment ACL — anyone in the entity's audience can see it
- Mention notification when a file is uploaded
- Saved filters on Docs (only Tasks for v1)
- "My open doc pages" widget (only issues for v1)
- Sharing saved filters between users
- Custom feature visibility groups (just the four top-level sections)
- Per-project feature visibility (only global)
- Attachment versioning
- Attachment scanning / antivirus (trust the team)
- Cross-entity link types (e.g. "blocks", "relates to") — all links are equal in v1
- Search across attachments by filename (Sprint 7+)
- File-too-large helpful error vs. a generic 400 — fine to ship a clear 400 only

---

## Reference reads

- `handoffs/sprint-5-discord-mentions.md` — most recent sprint, same format
- `worker/notifications.js` — backend module style (D1 + helpers + jres pattern)
- `worker/integrations.js` — admin CRUD pattern (mirrors what app-settings.js needs)
- `worker.js` — `route()` function structure, where the FEATURE_GATES check goes, the `/api/me/*` cluster
- `public/notifications-ui.js` — frontend module style (state IIFE, named exports, modal patterns, list rendering)
- `public/integrations-ui.js` — admin Settings page pattern (mirrors what feature-settings-ui.js needs)
- `public/tasks-ui.js` — issue detail modal where attachments + linked items panels splice in
- `public/docs-ui.js` — page view where linked items panel splices in
- `public/app.js` — `renderOverview()` function (where the my-issues widget placeholder goes), `applyRoleVisibility()` (where applyFeatureVisibility hooks in)

---

## Expected commit log

```
feat(sprint6): attachments + saved filters + entity links + feature visibility (Sprint 6)
```
