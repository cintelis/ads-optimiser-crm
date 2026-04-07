# Sprint 2 Handoff — Tasks MVP

**Goal:** Add Jira-like project + issue management to 365 Pulse CRM. CRUD only — no kanban, no sprints, no workflow customization. Those land in Sprint 3.

**Branch:** `sprint-2-tasks-mvp` from `main` (currently at `a9e2a49`).

**Live URL:** https://outreach-dashboard.nick-598.workers.dev (Cloudflare Workers, single deployment).

This sprint should produce **one branch with two or three commits**, applied to live D1 and deployed. Total scope is similar to Sprint 1 landing 1 (~1000 lines, mostly new code).

---

## Context you need (TL;DR)

- **Stack:** Cloudflare Workers + D1 (SQLite) + KV + vanilla JS SPA. No build step. ESM imports work in `worker.js`.
- **Auth (Sprint 1):** D1-backed sessions in `app_sessions`, Bearer tokens in `Authorization` header. Every `/api/*` route except `/api/auth/login` and `/api/auth/totp/login*` is gated by `requireAuth(req, env)` which returns `{session, user}` and is passed into `route(req, env, url, path, authCtx)` as the 5th arg. Viewers are auto-blocked on write methods at the top of `route()`.
- **Roles:** `admin`, `member`, `viewer`. Members can do everything except user management and project deletion. Viewers are read-only.
- **Activity feed (Sprint 1 prep work):** The polymorphic `activity` table already exists (`entity_type`, `entity_id`, `user_id`, `kind`, `body_md`, `created_at`). Sprint 2 finally uses it: every issue comment writes a row, every issue mutation writes a system row.
- **Event bus stub (Sprint 1 prep work):** `worker/events.js` exports `emit(env, eventType, payload, ctx)`. Currently a no-op. Sprint 2 sprinkles `emit()` calls into mutation handlers; Sprint 5 plugs in real Discord dispatch. The `EVENT_TYPES` constants for issues already exist (`ISSUE_CREATED`, `ISSUE_UPDATED`, `ISSUE_ASSIGNED`, `ISSUE_STATUS_CHANGED`, `ISSUE_COMMENTED`).
- **D1 access:** all queries use `env.DB.prepare(sql).bind(...).run() / .first() / .all()`. Migrations are applied via `npx wrangler d1 execute outreach-db --remote --file=migrations/003_tasks.sql`.
- **Frontend conventions:** `state` global, `loadX()` + `renderX()` pairs in `public/app.js`, `setModal(html)` + `closeModal()` for modals, `api(method, path, body)` helper for fetch (auto Bearer header from `localStorage.token`), `esc()` for HTML escaping. New sections branch in `renderSection(s)` (line ~347 of `app.js`) and get a title in `SECTION_TITLES` (line ~3).

---

## Decisions already locked (don't re-litigate)

| Decision | Value | Rationale |
|---|---|---|
| Issue key format | `{PROJECT_KEY}-{N}` where N is per-project sequence | Standard Jira shape; humans pattern-match on it |
| Issue key uniqueness | Per-project, monotonically increasing, never reused | Predictability matters more than density |
| Issue types | `task`, `bug`, `story`, `epic` (TEXT, no enum table) | Sprint 5 may add types per project; v1 keeps it flat |
| Statuses (Sprint 2) | Fixed: `backlog`, `todo`, `in_progress`, `in_review`, `done` (TEXT) | Sprint 3 makes these per-project via `workflow_states`; v1 hard-codes |
| Priorities | Jira standard: `lowest`, `low`, `medium`, `high`, `highest` | |
| Assignee | Nullable `user_id` FK to `users.id` | An issue can be unassigned |
| Reporter | Non-null `user_id` (defaults to current user on create) | |
| Parent | Nullable `issue_id` self-FK (sub-task under any issue, including epics) | |
| Description format | Markdown stored raw in `description_md` | Per the locked Sprint 1 plan |
| Markdown library | `marked` + `DOMPurify` from jsdelivr CDN | Matches the QR script approach in landing 2 |
| Comments storage | Write to `activity` table with `entity_type='issue'`, `entity_id=issue.id`, `kind='comment'`, `body_md=text`, `user_id=current` | The activity table is already provisioned for this exact use case |
| System events on issues | Also written to `activity` with `kind='system'` (e.g. "status changed: todo → in_progress") | One feed for everything, easy to render |
| Project deletion | Soft delete via `active=0` column, also soft-deletes its issues | Audit-safe, reversible |
| Issue deletion | Hard delete (cascades activity rows for that issue) | No audit need; DELETE is rare |
| Filter persistence | Stored in `state.ui.tasksFilters` only — not URL or localStorage | Keep simple; URL state is a Sprint 6 polish item |
| Project list location | New "Tasks" nav group at the bottom of the sidebar (above Settings) | Mirrors how "CRM" got its own group |
| Project detail surface | Replaces content area when a project is selected; back button returns to list | Not a separate route — just `state.ui.tasksProjectId` toggles which renderer runs |
| Issue detail surface | Modal via `setModal()` with full body | Keeps navigation simple, matches existing CRM modals |
| Labels | **Out of scope** for Sprint 2 — `labels` table lands in Sprint 5 with the rest of the cross-cutting polish | |
| Issue links / blockers | **Out of scope** for Sprint 2 | Sprint 5 |
| Attachments | **Out of scope** for Sprint 2 | Sprint 6 (needs R2 binding) |
| Sub-task UI | Issue detail shows sub-tasks if any exist; no special sub-task creation flow | |

---

## Schema — `migrations/003_tasks.sql`

Apply after creation: `npx wrangler d1 execute outreach-db --remote --file=migrations/003_tasks.sql`

```sql
-- Sprint 2: Tasks MVP — projects + issues
-- Activity comments live in the existing `activity` table from Sprint 1.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,                    -- prj_{hex}
  key TEXT UNIQUE NOT NULL,               -- e.g. ENG, OPS — uppercase, 2–10 chars
  name TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  lead_user_id TEXT,                      -- nullable; FK app-enforced not DB-enforced
  issue_seq INTEGER NOT NULL DEFAULT 0,   -- last-issued issue number for this project
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,               -- user_id
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_key ON projects(key);
CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(active);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,                    -- iss_{hex}
  project_id TEXT NOT NULL,
  issue_key TEXT NOT NULL,                -- denormalized for fast display, e.g. ENG-12
  issue_number INTEGER NOT NULL,          -- the N portion, for sorting
  title TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'task',      -- task | bug | story | epic
  status TEXT NOT NULL DEFAULT 'todo',    -- backlog | todo | in_progress | in_review | done
  priority TEXT NOT NULL DEFAULT 'medium',-- lowest | low | medium | high | highest
  assignee_id TEXT,                       -- nullable user_id
  reporter_id TEXT NOT NULL,              -- user_id who created
  parent_id TEXT,                         -- nullable; self-ref for sub-tasks
  due_at TEXT,                            -- ISO 8601 or NULL
  active INTEGER NOT NULL DEFAULT 1,      -- soft delete (cascaded from project soft-delete)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, issue_number)
);
CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id, active, status);
CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee_id, active);
CREATE INDEX IF NOT EXISTS idx_issues_key ON issues(issue_key);
CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues(parent_id);
CREATE INDEX IF NOT EXISTS idx_issues_updated ON issues(updated_at DESC);
```

**Also append the same DDL to `schema.sql`** so a fresh DB created from scratch has everything. Match the existing pattern (each new section under a `-- ── Sprint 2: tasks ──` comment header).

---

## API surface

All routes are authenticated (requireAuth) unless marked public. Role gating happens automatically for write methods (viewers blocked at top of `route()`); per-route admin checks called out where needed.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/projects` | any | List all active projects with issue counts grouped by status |
| POST | `/api/projects` | member+ | Create project — body: `{key, name, description_md?, lead_user_id?}` |
| GET | `/api/projects/:id` | any | Project detail with `issue_counts` and recent issues |
| PATCH | `/api/projects/:id` | member+ | Update name/description/lead — body partial |
| DELETE | `/api/projects/:id` | **admin** | Soft delete project + cascade soft-delete its issues |
| GET | `/api/projects/:id/issues` | any | List issues with query params: `status`, `assignee_id`, `type`, `priority`, `q` (text search across title+description), `parent_id` (filter to sub-tasks), `limit` (default 100) |
| POST | `/api/projects/:id/issues` | member+ | Create issue — body: `{title, description_md?, type?, priority?, assignee_id?, parent_id?, due_at?}` — auto-generates `issue_key`, sets `reporter_id=current`, fires `emit(ISSUE_CREATED)` |
| GET | `/api/issues/:id` | any | Full issue detail: issue row + activity feed (`SELECT * FROM activity WHERE entity_type='issue' AND entity_id=? ORDER BY created_at ASC`) + sub-tasks (if `parent_id` is null, find children) + parent issue stub (if has parent) |
| PATCH | `/api/issues/:id` | member+ | Partial update of any field. **Must** detect field-level changes and emit specific events: `ISSUE_ASSIGNED` if assignee_id changed, `ISSUE_STATUS_CHANGED` if status changed, `ISSUE_UPDATED` for everything else. Each change also writes a `kind='system'` activity row with a human-readable summary |
| DELETE | `/api/issues/:id` | member+ | Hard delete issue + delete its activity rows |
| POST | `/api/issues/:id/comments` | member+ | Add comment — body: `{body_md}` — writes activity row with `kind='comment'`, `user_id=current`. Fires `emit(ISSUE_COMMENTED)`. Returns the created activity row |
| DELETE | `/api/activity/:id` | author or admin | Delete a single activity row. Only the original author or an admin may delete |

### Response shapes

```json
// GET /api/projects
{
  "projects": [
    {
      "id": "prj_...",
      "key": "ENG",
      "name": "Engineering",
      "description_md": "...",
      "lead_user_id": "usr_...",
      "lead": { "id": "usr_...", "display_name": "...", "email": "..." }, // joined
      "issue_counts": { "backlog": 3, "todo": 5, "in_progress": 2, "in_review": 1, "done": 12 },
      "total_issues": 23,
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}

// GET /api/projects/:id/issues
{
  "issues": [
    {
      "id": "iss_...",
      "project_id": "prj_...",
      "issue_key": "ENG-12",
      "issue_number": 12,
      "title": "Login button broken on Safari",
      "type": "bug",
      "status": "in_progress",
      "priority": "high",
      "assignee_id": "usr_...",
      "assignee": { "id": "...", "display_name": "...", "email": "..." }, // joined
      "reporter_id": "usr_...",
      "parent_id": null,
      "due_at": "2026-04-30T00:00:00Z",
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}

// GET /api/issues/:id
{
  "issue": { ... full row + assignee/reporter joined ... },
  "parent": { "id": "...", "issue_key": "...", "title": "..." } | null,
  "subtasks": [ { "id": "...", "issue_key": "...", "title": "...", "status": "..." }, ... ],
  "activity": [
    { "id": "act_...", "kind": "system", "body_md": "Status: todo → in_progress", "user_id": "usr_...", "user": {...}, "created_at": "..." },
    { "id": "act_...", "kind": "comment", "body_md": "I checked the logs ...", "user_id": "...", "user": {...}, "created_at": "..." }
  ]
}
```

All timestamps are ISO 8601 strings (use the existing `now()` helper from `worker.js`).

### Key generation

```js
// Inside the create-issue handler, transactional via D1 batch:
async function nextIssueKey(env, projectId) {
  // Increment seq atomically by relying on UPDATE ... RETURNING (D1 supports)
  const row = await env.DB.prepare(
    'UPDATE projects SET issue_seq = issue_seq + 1, updated_at = ? WHERE id = ? RETURNING issue_seq, key'
  ).bind(now(), projectId).first();
  if (!row) throw new Error('Project not found');
  return { number: row.issue_seq, key: `${row.key}-${row.issue_seq}` };
}
```

D1 supports `RETURNING` as of late 2024. If for some reason it doesn't on this account, fall back to: SELECT seq → bump locally → UPDATE WHERE seq=old (optimistic locking, retry on conflict). Don't use a separate sequence table.

### Activity helper to add to `worker.js`

```js
// Polymorphic activity write — used by issues/docs/etc going forward.
async function logActivity(env, { entityType, entityId, userId, kind, body }) {
  const id = `act_${uid().replace(/-/g, '').slice(0, 24)}`;
  await env.DB.prepare(
    'INSERT INTO activity (id, entity_type, entity_id, user_id, kind, body_md, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, entityType, entityId, userId || null, kind, body || '', now()).run();
  return id;
}
```

---

## Frontend surfaces

### Navigation

In `public/index.html`, add a new nav group **above** the existing Settings group (so the order top-to-bottom is: Outreach → CRM → Tasks → Settings):

```html
<div class="nav-divider"></div>
<div class="nav-group-label">Tasks</div>
<button class="nav-item" id="nav-projects" type="button" onclick="nav('projects')">Projects</button>
```

Also add to the mobile sheet (`#mobile-sheet-body`):

```html
<button class="mobile-sheet-item" id="more-projects" type="button" onclick="closeMobileMenu();nav('projects')">Projects</button>
```

### Sections to add to `app.js`

1. **`SECTION_TITLES.projects = 'Projects'`** at line ~3
2. **`renderSection`** branch:
   ```js
   else if (s === 'projects') {
     if (state.ui.tasksProjectId) {
       await loadProject(state.ui.tasksProjectId); renderProjectDetail();
     } else {
       await loadProjects(); renderProjects();
     }
   }
   ```
3. **State additions:**
   ```js
   // Inside state.ui:
   tasksProjectId: '',
   tasksFilters: { status: '', assignee_id: '', type: '', priority: '', q: '' },
   tasksOpenIssueId: '',
   ```

### `loadProjects` / `renderProjects`

Renders a card grid of projects, each card showing key, name, lead avatar, total issue count, and a mini status breakdown bar (5 segments coloured by status). Click navigates to the project detail view (sets `state.ui.tasksProjectId` and re-renders).

Includes a "+ New project" button (member+) that opens a modal with key + name + description fields.

### `loadProject(id)` / `renderProjectDetail`

Header: project key + name, "back to projects" button on the left, "+ New issue" button on the right.

Filter bar: status dropdown, assignee dropdown (populated from `/api/users`), type dropdown, priority dropdown, text search input.

Issue table: columns `Key | Type | Title | Status | Priority | Assignee | Updated`. Click a row to open the issue detail modal. Type icons via inline SVG (see Lozenges section below).

### Issue detail modal (`openIssueDetail(id)`)

Wide modal (use existing `.modal-lg` class). Two-column layout:
- **Left** (~65%): title (editable inline), description (markdown rendered, click-to-edit toggling between rendered and textarea), activity feed (system + comments interleaved chronologically), comment composer at bottom.
- **Right** (~35%): metadata panel — type, status, priority, assignee, reporter, due date, parent (if any), sub-tasks list (if any), created/updated.

Each metadata field is click-to-edit using a small inline editor pattern (mirror the existing CRM contact drawer pattern in `app.js`).

### Markdown rendering helper

Add to top of `app.js`:

```js
function renderMarkdown(text) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    return `<pre class="md-fallback">${esc(text || '')}</pre>`;
  }
  const raw = marked.parse(String(text || ''), { breaks: true, gfm: true });
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}
```

In `index.html` `<head>`, add (next to the QR script):

```html
<script src="https://cdn.jsdelivr.net/npm/marked@13.0.3/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.7/dist/purify.min.js"></script>
```

### Lozenges (status pills)

The CSS has the `.lozenge` and `.role-badge` patterns. Add status/type/priority lozenges in `dashboard.css`:

```css
.lozenge{display:inline-block;padding:2px 8px;border-radius:var(--radius-sm,4px);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.lozenge-status-backlog{background:color-mix(in srgb, var(--muted) 18%, transparent);color:var(--muted)}
.lozenge-status-todo{background:color-mix(in srgb, var(--cyan) 14%, transparent);color:var(--cyan)}
.lozenge-status-in_progress{background:color-mix(in srgb, var(--amber) 16%, transparent);color:var(--amber)}
.lozenge-status-in_review{background:color-mix(in srgb, var(--purple) 16%, transparent);color:var(--purple)}
.lozenge-status-done{background:color-mix(in srgb, var(--green) 18%, transparent);color:var(--green)}
.lozenge-priority-lowest,.lozenge-priority-low{color:var(--muted2)}
.lozenge-priority-medium{color:var(--cyan)}
.lozenge-priority-high{color:var(--amber)}
.lozenge-priority-highest{color:var(--red)}
.issue-type-icon{display:inline-block;width:14px;height:14px;vertical-align:-2px;margin-right:6px}
```

Type icons: 4 small inline SVGs (square for task, circle for bug, bookmark for story, lightning for epic). Define once in app.js as `ISSUE_TYPE_ICONS = {task:'<svg>...</svg>', bug:'...', ...}` next to the existing `ICONS` constant.

---

## Files to create / modify

| File | Action | Approx size |
|---|---|---|
| `migrations/003_tasks.sql` | NEW | ~50 lines |
| `worker/tasks.js` | NEW — exports handlers for projects/issues/comments/activity-delete | ~400 lines |
| `worker.js` | MODIFY — import from `worker/tasks.js`, wire new routes inside `route()` | ~40 added lines |
| `worker.js` | MODIFY — add the `logActivity()` helper near `uid()`/`now()` | ~10 added lines |
| `schema.sql` | MODIFY — append the same DDL as the migration | ~50 added lines |
| `public/index.html` | MODIFY — Tasks nav group, mobile sheet item, marked + DOMPurify CDN scripts | ~6 added lines |
| `public/app.js` | MODIFY — `SECTION_TITLES`, state additions, `renderSection` branch, `renderMarkdown` helper, `ISSUE_TYPE_ICONS`, project list/detail/create/edit, issue list/create/edit/delete, issue detail modal with activity feed and comment composer, all click-to-edit inline editors | ~700 added lines |
| `public/dashboard.css` | MODIFY — lozenge classes, issue table styles, issue detail modal layout, comment composer | ~80 added lines |

**Don't refactor `worker.js` further** — the user explicitly chose to keep it monolithic. The new module `worker/tasks.js` follows the same pattern as `worker/auth.js` and `worker/sessions.js`.

---

## `worker/tasks.js` skeleton

```js
// ============================================================
// 365 Pulse — Tasks (projects + issues + comments)
// All handlers expect (req, env, ctx) where ctx = {session, user} from
// requireAuth(). They return Response objects via the jres() helper from
// worker.js — import what you need or replicate locally for clarity.
// ============================================================

import { emit, EVENT_TYPES } from './events.js';

// Re-declare here to avoid circular imports back to worker.js.
function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }
function projectId() { return `prj_${uid().replace(/-/g, '').slice(0, 24)}`; }
function issueId() { return `iss_${uid().replace(/-/g, '').slice(0, 24)}`; }
function activityId() { return `act_${uid().replace(/-/g, '').slice(0, 24)}`; }

const ISSUE_TYPES = ['task', 'bug', 'story', 'epic'];
const ISSUE_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
const ISSUE_PRIORITIES = ['lowest', 'low', 'medium', 'high', 'highest'];

function validateEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// ── Projects ─────────────────────────────────────────────────
export async function listProjects(env) {
  const { results: projects } = await env.DB.prepare(
    `SELECT p.*, u.display_name AS lead_display_name, u.email AS lead_email
     FROM projects p
     LEFT JOIN users u ON u.id = p.lead_user_id
     WHERE p.active = 1
     ORDER BY p.key ASC`
  ).all();
  // Counts per project
  const { results: counts } = await env.DB.prepare(
    `SELECT project_id, status, COUNT(*) AS n
     FROM issues WHERE active = 1
     GROUP BY project_id, status`
  ).all();
  const countsByProject = {};
  for (const row of counts) {
    if (!countsByProject[row.project_id]) countsByProject[row.project_id] = {};
    countsByProject[row.project_id][row.status] = row.n;
  }
  return jres({
    projects: projects.map(p => ({
      ...p,
      lead: p.lead_user_id ? { id: p.lead_user_id, display_name: p.lead_display_name, email: p.lead_email } : null,
      lead_display_name: undefined, lead_email: undefined,
      issue_counts: { backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0, ...(countsByProject[p.id] || {}) },
      total_issues: Object.values(countsByProject[p.id] || {}).reduce((a, b) => a + b, 0),
    })),
  });
}

export async function createProject(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const key = String(body.key || '').trim().toUpperCase();
  const name = String(body.name || '').trim();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) return jres({ error: 'key must be 2–10 uppercase alphanumerics starting with a letter' }, 400);
  if (!name) return jres({ error: 'name required' }, 400);
  const exists = await env.DB.prepare('SELECT id FROM projects WHERE key=?').bind(key).first();
  if (exists) return jres({ error: 'A project with that key already exists' }, 409);
  const id = projectId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO projects (id, key, name, description_md, lead_user_id, issue_seq, active, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`
  ).bind(id, key, name, String(body.description_md || ''), body.lead_user_id || null, ctx.user.id, ts, ts).run();
  return jres({ id, key, name });
}

// ... getProject, patchProject, deleteProject (soft) ...

// ── Issues ───────────────────────────────────────────────────
export async function listIssues(req, env, projectIdParam) {
  const url = new URL(req.url);
  const where = ['i.active = 1', 'i.project_id = ?'];
  const params = [projectIdParam];
  for (const f of ['status', 'type', 'priority', 'assignee_id', 'parent_id']) {
    const v = url.searchParams.get(f);
    if (v) { where.push(`i.${f} = ?`); params.push(v); }
  }
  const q = url.searchParams.get('q');
  if (q) { where.push('(i.title LIKE ? OR i.description_md LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
  const sql = `SELECT i.*, a.display_name AS assignee_display_name, a.email AS assignee_email
               FROM issues i LEFT JOIN users a ON a.id = i.assignee_id
               WHERE ${where.join(' AND ')}
               ORDER BY i.updated_at DESC LIMIT ?`;
  params.push(limit);
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return jres({
    issues: results.map(r => ({
      ...r,
      assignee: r.assignee_id ? { id: r.assignee_id, display_name: r.assignee_display_name, email: r.assignee_email } : null,
      assignee_display_name: undefined, assignee_email: undefined,
    })),
  });
}

export async function createIssue(req, env, ctx, projectIdParam) {
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || '').trim();
  if (!title) return jres({ error: 'title required' }, 400);
  // Atomically bump seq + read project key
  const seqRow = await env.DB.prepare(
    'UPDATE projects SET issue_seq = issue_seq + 1, updated_at = ? WHERE id = ? AND active = 1 RETURNING issue_seq, key'
  ).bind(now(), projectIdParam).first();
  if (!seqRow) return jres({ error: 'Project not found' }, 404);
  const id = issueId();
  const ts = now();
  const issueKey = `${seqRow.key}-${seqRow.issue_seq}`;
  const issue = {
    id,
    project_id: projectIdParam,
    issue_key: issueKey,
    issue_number: seqRow.issue_seq,
    title,
    description_md: String(body.description_md || ''),
    type: validateEnum(body.type, ISSUE_TYPES, 'task'),
    status: validateEnum(body.status, ISSUE_STATUSES, 'todo'),
    priority: validateEnum(body.priority, ISSUE_PRIORITIES, 'medium'),
    assignee_id: body.assignee_id || null,
    reporter_id: ctx.user.id,
    parent_id: body.parent_id || null,
    due_at: body.due_at || null,
    active: 1,
    created_at: ts,
    updated_at: ts,
  };
  await env.DB.prepare(
    `INSERT INTO issues (id, project_id, issue_key, issue_number, title, description_md, type, status,
                         priority, assignee_id, reporter_id, parent_id, due_at, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).bind(
    issue.id, issue.project_id, issue.issue_key, issue.issue_number, issue.title, issue.description_md,
    issue.type, issue.status, issue.priority, issue.assignee_id, issue.reporter_id, issue.parent_id,
    issue.due_at, issue.created_at, issue.updated_at
  ).run();

  // Fire event (no-op stub in Sprint 1; Sprint 5 wires Discord)
  await emit(env, EVENT_TYPES.ISSUE_CREATED, { issue, actor: ctx.user });
  return jres(issue);
}

// patchIssue: detect field-level deltas, write a system activity row per change,
// emit ISSUE_ASSIGNED / ISSUE_STATUS_CHANGED / ISSUE_UPDATED accordingly.

// ── Comments ─────────────────────────────────────────────────
export async function addIssueComment(req, env, ctx, issueIdParam) {
  const body = await req.json().catch(() => ({}));
  const text = String(body.body_md || '').trim();
  if (!text) return jres({ error: 'body_md required' }, 400);
  const issue = await env.DB.prepare('SELECT id FROM issues WHERE id=? AND active=1').bind(issueIdParam).first();
  if (!issue) return jres({ error: 'Issue not found' }, 404);
  const id = activityId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO activity (id, entity_type, entity_id, user_id, kind, body_md, created_at)
     VALUES (?, 'issue', ?, ?, 'comment', ?, ?)`
  ).bind(id, issueIdParam, ctx.user.id, text, ts).run();
  await emit(env, EVENT_TYPES.ISSUE_COMMENTED, { issue_id: issueIdParam, actor: ctx.user, body_md: text });
  return jres({ id, kind: 'comment', body_md: text, user_id: ctx.user.id, created_at: ts });
}
```

The full module fills in `getProject`, `patchProject`, `deleteProject`, `getIssue`, `patchIssue`, `deleteIssue`, `deleteActivity`, plus a `joinUsers()` helper for batched user lookups in detail responses.

---

## `worker.js` integration

Add at the top with the other module imports:

```js
import {
  listProjects, createProject, getProject, patchProject, deleteProject,
  listIssues, createIssue, getIssue, patchIssue, deleteIssue,
  addIssueComment, deleteActivity,
} from './worker/tasks.js';
```

In `route()`, add a section above the existing CRM segment-based routing (the section that starts with `// ── Existing CRM / outreach segment-based routing ──`):

```js
// ── Tasks (Sprint 2) ─────────────────────────────────────
if (path === '/api/projects' && m === 'GET')  return listProjects(env);
if (path === '/api/projects' && m === 'POST') return createProject(req, env, authCtx);
{
  const pm = path.match(/^\/api\/projects\/([^/]+)(?:\/(issues))?$/);
  if (pm) {
    const projId = pm[1];
    const sub = pm[2];
    if (!sub) {
      if (m === 'GET')    return getProject(env, projId);
      if (m === 'PATCH')  return patchProject(req, env, projId);
      if (m === 'DELETE') {
        if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
        return deleteProject(env, projId);
      }
    }
    if (sub === 'issues') {
      if (m === 'GET')  return listIssues(req, env, projId);
      if (m === 'POST') return createIssue(req, env, authCtx, projId);
    }
  }
}
{
  const im = path.match(/^\/api\/issues\/([^/]+)(?:\/(comments))?$/);
  if (im) {
    const isId = im[1];
    const sub = im[2];
    if (!sub) {
      if (m === 'GET')    return getIssue(env, isId);
      if (m === 'PATCH')  return patchIssue(req, env, authCtx, isId);
      if (m === 'DELETE') return deleteIssue(env, isId);
    }
    if (sub === 'comments' && m === 'POST') return addIssueComment(req, env, authCtx, isId);
  }
}
{
  const am = path.match(/^\/api\/activity\/([^/]+)$/);
  if (am && m === 'DELETE') return deleteActivity(env, authCtx, am[1]);
}
```

---

## Test plan

Manual end-to-end test as the bootstrap admin against the live URL after deploy:

1. **Project creation**
   - Add user: ENG with name "Engineering"
   - Add user: OPS with name "Operations"
   - Verify both appear with empty issue counts on the Projects page

2. **Issue creation + key generation**
   - Open ENG → New issue → "Login button broken on Safari" type=bug priority=high assignee=self
   - Verify key is `ENG-1`
   - Create three more — should be ENG-2, ENG-3, ENG-4
   - Open OPS → create one — should be OPS-1 (independent sequence)

3. **Filters**
   - In ENG, filter status=todo → should show only ENG-1, ENG-2 (or whichever you didn't move)
   - Filter assignee=self → all yours
   - Text search "login" → only matching titles

4. **Issue detail**
   - Open ENG-1
   - Edit title inline → should save on blur
   - Edit description (markdown) → should render with `marked`, type **bold** to verify formatting works
   - Change status from todo → in_progress → activity feed shows a system row
   - Change assignee → activity feed shows a system row
   - Add a comment "I checked the logs and..." → renders as markdown, appears in feed

5. **Sub-tasks**
   - Open ENG-2, set its parent to ENG-1
   - Open ENG-1 — sub-tasks panel shows ENG-2 with its current status

6. **Role gating**
   - Create a viewer user via Settings → Users → Add user
   - Sign in as them → Projects page loads, can browse issues, but New Project / New Issue / Edit / Delete buttons are either hidden or 403 on click
   - Sign back in as admin

7. **Comment delete**
   - Add a comment as admin, delete it, gone
   - Add a comment as a member, sign in as a different member → can NOT delete the first member's comment, only admins or the author can

8. **Project soft-delete**
   - Delete OPS as admin
   - Projects page no longer shows OPS
   - Direct GET `/api/projects/{ops_id}` returns 404
   - Run `SELECT * FROM projects WHERE active=0` against D1 → OPS is still there with active=0
   - Same for its issues — `SELECT * FROM issues WHERE project_id='{ops_id}'` → all active=0

9. **emit() smoke test**
   - Open Cloudflare Workers logs (`npx wrangler tail`) during issue create/patch/comment
   - Should see no errors from `emit()` (it's still a no-op stub but every call site exercises it)

10. **Theme verification**
    - Toggle to light mode and re-verify the Projects page, issue table, issue detail modal, comment composer all look right

## Definition of done

- [ ] `migrations/003_tasks.sql` applied to remote D1 successfully
- [ ] `schema.sql` updated to mirror the migration
- [ ] `worker/tasks.js` exists with all handlers, exports, validations
- [ ] `worker.js` imports and routes wired
- [ ] `logActivity()` helper added to `worker.js`
- [ ] Frontend nav group, sections, modal, markdown rendering, lozenges all in place
- [ ] All 10 manual test plan steps pass on the live URL
- [ ] Both light and dark themes render correctly across the new surfaces
- [ ] Three commits on `sprint-2-tasks-mvp`:
  - `feat(tasks): schema + worker handlers (Sprint 2 backend)`
  - `feat(tasks): projects page, issue list, issue detail modal (Sprint 2 frontend)`
  - `feat(tasks): markdown rendering + activity feed + comments (Sprint 2 polish)`
- [ ] Branch deployed and verified
- [ ] Handoff to next sprint summarized at the end of the conversation

## Out of scope (do NOT build)

- Kanban board view (Sprint 3)
- Sprints / sprint planning (Sprint 3)
- Per-project workflow customization (Sprint 3)
- Burndown charts (Sprint 3)
- Labels and label filtering (Sprint 5)
- Issue links / blockers (Sprint 5)
- @mentions in comments (Sprint 5)
- Discord notifications (Sprint 5 — keep `emit()` calls but don't wire dispatch)
- Attachments / file uploads (Sprint 6 — needs R2 binding)
- Issue templates, bulk edit, saved filters (Sprint 6)
- URL deep-linking to project/issue (Sprint 6)
- FTS5 search across the whole app (Sprint 5)

---

## Open questions for the user before starting

None, as long as the locked decisions table above is acceptable.

If anything in that table looks wrong, the only one likely to come up is **issue statuses**. The fixed list (`backlog`, `todo`, `in_progress`, `in_review`, `done`) is opinionated. If a different set is wanted in v1, change `ISSUE_STATUSES` in `worker/tasks.js` and the lozenge classes in `dashboard.css`. Sprint 3 will replace this with per-project `workflow_states` anyway.

---

## Reference: existing files to read before starting

- `worker.js` lines 1–650 (imports, fetch handler, auth section, route function — see how landing 1's auth modules are wired)
- `worker/auth.js` (the lift pattern + Web Crypto idioms)
- `worker/sessions.js` (the D1 query patterns)
- `worker/events.js` (`emit()` signature and `EVENT_TYPES`)
- `migrations/001_users_and_sessions.sql` and `002_activity_table.sql` (DDL conventions)
- `schema.sql` (where to append new tables)
- `public/app.js` lines 1–200 (state shape, theme bootstrap, login flow, init, refreshMe)
- `public/app.js` lines 340–360 (renderSection switch — where the new Tasks branch goes)
- `public/app.js` lines 1750–1760 (setModal/closeModal helpers)
- `public/app.js` lines 1870–end (Account + Users sections from landing 2 — copy the form patterns)
- `public/index.html` (nav structure, modal element, mobile sheet — where to add the new nav items)
- `public/dashboard.css` lines 1–60 (theme tokens) and lines 440–end (the landing 2 utility classes including `.role-badge` to model `.lozenge` after)

---

**Estimated commit log when done:**

```
feat(tasks): markdown rendering + activity feed + comments (Sprint 2 polish)
feat(tasks): projects page, issue list, issue detail modal (Sprint 2 frontend)
feat(tasks): schema + worker handlers (Sprint 2 backend)
```
