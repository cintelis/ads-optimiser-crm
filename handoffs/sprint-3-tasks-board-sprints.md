# HANDOFF — Sprint 3: Tasks board, sprints, workflow

**Branch:** `sprint-3-tasks-board-sprints` from `main` (currently at `863b8fd`).
**Live URL:** https://outreach-dashboard.nick-598.workers.dev
**Depends on:** Sprint 2 (Tasks MVP — projects + issues + activity table). Already deployed.

---

## Goal

Add the agile half of Tasks on top of Sprint 2's CRUD: **sprints**, a **kanban board** with drag-and-drop, a **backlog** view that drags issues into sprints, and a **per-sprint burndown chart**. Per-project workflow customization is **deferred to Sprint 5 or 6** — Sprint 3 keeps the fixed five-status list from Sprint 2 (`backlog`, `todo`, `in_progress`, `in_review`, `done`).

---

## Decisions already locked

| Decision | Value | Rationale |
|---|---|---|
| Sprint↔issue cardinality | One sprint per issue (column on issues, no join table) | Matches Jira "next-gen" model; simpler than M:N |
| Active sprints per project | Exactly one at a time, enforced in backend | Standard agile flow; avoids ambiguous "current sprint" |
| Sprint states | `planned` → `active` → `completed` (no `archived` for v1) | Three is enough |
| Workflow states | **Stay fixed** at `backlog`, `todo`, `in_progress`, `in_review`, `done` — no `workflow_states` table yet | Per-project customization is its own feature; defer to Sprint 5/6 |
| Backlog definition | Any issue where `sprint_id IS NULL` AND `active=1` | No separate flag needed |
| Burndown source | Computed server-side from the existing `activity` table — find every `Status: X → done` row in the sprint date range, count remaining = total − cumulative done by day | No daily snapshot table; cheap, accurate, replayable |
| Burndown granularity | Daily, from `start_at` to `end_at` (or today if active) | Sprint length is days, not hours |
| Burndown unit | Issue **count**, not story points | We don't have story points yet — Sprint 6 maybe |
| Drag-drop library | None — HTML5 native DnD (`draggable="true"`, `dataTransfer`) | Matches the project's "no build step, no deps" rule |
| Mobile board UX | Drag-drop **disabled below 760px**; cards become tap-to-cycle-status (To Do → In Progress → In Review → Done) | Native HTML5 DnD on mobile is broken |
| Tab strip on project detail | New top-level tabs: **Issues** \| **Board** \| **Backlog** \| **Sprints**; default tab is Issues | Preserves existing Sprint 2 UX as the entry point |
| Sprint deletion | Allowed only if `state='planned'` and `issue_count=0`; otherwise blocked | Avoid orphaned-issue confusion; admin can hard-clean via SQL if needed |
| Sprint completion flow | Modal asks "Move N incomplete issues to: [next planned sprint] / [backlog]". Done issues stay on the completed sprint forever | Standard Jira flow |
| `emit()` calls | `SPRINT_STARTED` on transition to active, `SPRINT_COMPLETED` on transition to completed | Stubs already exist in `worker/events.js` |
| New file split | `worker/sprints.js` (backend) + `public/sprints-ui.js` (frontend) — extending the existing `worker/tasks.js` and `public/tasks-ui.js` only minimally | Keeps subagent work isolated, no merge conflicts |

---

## Schema — `migrations/004_sprints.sql`

Apply: `npx wrangler d1 execute outreach-db --remote --file=migrations/004_sprints.sql`

```sql
-- Sprint 3: sprints + issue→sprint link

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,                    -- spr_{hex}
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,                     -- e.g. "Sprint 1", "Q2 hardening"
  goal TEXT NOT NULL DEFAULT '',          -- short markdown one-liner
  state TEXT NOT NULL DEFAULT 'planned',  -- planned | active | completed
  start_at TEXT,                          -- set when state goes active
  end_at TEXT,                            -- set when state goes completed (or planned end)
  planned_end_at TEXT,                    -- target end date set during planning (nullable)
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sprints_project_state ON sprints(project_id, state);
CREATE INDEX IF NOT EXISTS idx_sprints_state ON sprints(state);

-- Add sprint_id to issues. Existing rows default to NULL (= backlog).
ALTER TABLE issues ADD COLUMN sprint_id TEXT;
CREATE INDEX IF NOT EXISTS idx_issues_sprint ON issues(sprint_id, status);
```

**Mirror the same DDL into `schema.sql`** under a new `-- ── Sprint 3: sprints ──` section header for fresh DB installs.

---

## API surface (additions to existing routes)

All authenticated. Viewer is auto-blocked on writes by the existing role gate in `route()`.

| Method | Path | Role | Body / response notes |
|---|---|---|---|
| GET | `/api/projects/:id/sprints` | any | List all sprints for the project, ordered by `created_at ASC`. Each row includes computed `issue_count`, `done_count`, and (for active sprint) `days_remaining`. |
| POST | `/api/projects/:id/sprints` | member+ | Create planned sprint. Body: `{name, goal?, planned_end_at?}`. Returns the row. |
| GET | `/api/sprints/:id` | any | Sprint detail with full issue list (joined with assignee), grouped by status. |
| PATCH | `/api/sprints/:id` | member+ | Edit `name`, `goal`, `planned_end_at`. Cannot edit `state` here — use the explicit transition endpoints. |
| DELETE | `/api/sprints/:id` | member+ | 400 if `state != 'planned'` OR has any issues. Otherwise hard delete. |
| POST | `/api/sprints/:id/start` | member+ | Transition `planned` → `active`. 409 if another sprint in the same project is already active. Sets `start_at = now()`. Emits `SPRINT_STARTED`. |
| POST | `/api/sprints/:id/complete` | member+ | Transition `active` → `completed`. Body: `{incomplete_action: 'backlog' \| 'next_sprint', next_sprint_id?}`. Sets `end_at = now()`. Moves any non-`done` issues per the action. Emits `SPRINT_COMPLETED`. |
| POST | `/api/sprints/:id/issues` | member+ | Bulk add issues to sprint. Body: `{issue_ids: [...]}`. Atomically sets `sprint_id` on each. Writes one system activity row per issue. |
| DELETE | `/api/sprints/:id/issues/:issueId` | member+ | Remove a single issue from the sprint (sets `sprint_id = NULL`). Writes a system activity row. |
| GET | `/api/sprints/:id/burndown` | any | Returns `{sprint, ideal: [{date, remaining}], actual: [{date, remaining}], total_issues}` with daily series from `start_at` to `min(end_at, today)`. |

### Existing routes that need a small extension

- **`PATCH /api/issues/:id`** (in `worker/tasks.js`): allow `sprint_id` in the patchable fields. When it changes, write a system activity row `"Sprint: {old name or 'Backlog'} → {new name or 'Backlog'}"` and emit `ISSUE_UPDATED` with `changed_fields: ['sprint_id']`. Resolve `sprint_id=null` to "Backlog" in the row text.
- **`GET /api/issues/:id`** (in `worker/tasks.js`): `LEFT JOIN sprints s ON s.id = i.sprint_id` and include `sprint: {id, name, state}` (or `null`) on the returned issue.
- **`GET /api/projects/:id/issues`** (in `worker/tasks.js`): same join + same field on each row. Also accept a new query param `sprint_id` (with the `__backlog__` sentinel meaning `IS NULL`) so the board view can fetch only issues in a given sprint.

### Burndown calculation

```
total = SELECT COUNT(*) FROM issues WHERE sprint_id = ? AND active = 1
done_events = SELECT created_at FROM activity
              WHERE entity_type = 'issue'
                AND kind = 'system'
                AND body_md LIKE 'Status: % → done'
                AND entity_id IN (SELECT id FROM issues WHERE sprint_id = ?)
              ORDER BY created_at ASC
```

Walk the day series from `start_at.date` to `min(end_at.date, today)`. For each day, `remaining = total - count(done_events where created_at.date <= day)`. The "ideal" line is a straight slope from `total` on day 0 to `0` on the last day.

Edge cases:
- Issues added to the sprint *after* it started count toward total for all days. (Simpler than scoping per day; matches Jira's default scope-creep view enough for v1.)
- Issues moved out of the sprint before completion are still counted. We can refine in Sprint 6.

---

## `worker/sprints.js` — backend module

New file mirroring `worker/tasks.js` patterns. Self-contained, redeclares `jres()`/`now()`/`uid()`, imports `emit` + `EVENT_TYPES` from `./events.js`. Exports:

```
listProjectSprints(env, projectId)
createSprint(req, env, ctx, projectId)
getSprint(env, sprintId)
patchSprint(req, env, sprintId)
deleteSprint(env, sprintId)
startSprint(env, ctx, sprintId)
completeSprint(req, env, ctx, sprintId)
addIssuesToSprint(req, env, ctx, sprintId)
removeIssueFromSprint(env, ctx, sprintId, issueId)
getBurndown(env, sprintId)
```

Helpers:
- `sprintId()` returns `spr_` + 24 hex chars
- `assertOneActivePerProject(env, projectId, excludeId)` — used by `startSprint` to enforce the constraint
- `insertSprintActivity(env, ...)` reuses the same `insertActivity` pattern from `worker/tasks.js` (the polymorphic `activity` table — `entity_type='sprint'` for sprint-scoped events, `entity_type='issue'` for the per-issue movement rows)

The completion flow is the trickiest handler. Pseudocode:

```
async function completeSprint(req, env, ctx, sprintId) {
  const sprint = await SELECT WHERE id=? AND state='active'
  if (!sprint) return 400
  const body = await req.json()
  const action = body.incomplete_action  // 'backlog' | 'next_sprint'
  const incompleteIssues = await SELECT FROM issues WHERE sprint_id=? AND active=1 AND status<>'done'

  if (action === 'next_sprint') {
    const next = await SELECT WHERE id=? AND project_id=? AND state='planned'
    if (!next) return 400 'next_sprint_id invalid'
    UPDATE issues SET sprint_id=next.id WHERE id IN (...)
    + insert one activity row per issue: "Moved to sprint {next.name} on completion of {sprint.name}"
  } else { // 'backlog'
    UPDATE issues SET sprint_id=NULL WHERE id IN (...)
    + insert one activity row per issue: "Returned to backlog on completion of {sprint.name}"
  }

  UPDATE sprints SET state='completed', end_at=now(), updated_at=now() WHERE id=?
  insertActivity(entity_type='sprint', entity_id=sprintId, kind='system',
                 body=`Sprint completed. ${incompleteIssues.length} issue(s) moved to ${action}.`)
  emit(SPRINT_COMPLETED, {sprint, completed_at: now(), moved_count: incompleteIssues.length, action})
  return getSprint(env, sprintId)
}
```

---

## `worker.js` integration

Add to imports:

```js
import {
  listProjectSprints, createSprint,
  getSprint, patchSprint, deleteSprint,
  startSprint, completeSprint,
  addIssuesToSprint, removeIssueFromSprint,
  getBurndown,
} from './worker/sprints.js';
```

Add a Sprints route block above the existing Tasks block in `route()`:

```js
// ── Sprints (Sprint 3) ───────────────────────────────────
{
  // /api/projects/:id/sprints (list + create) — handled inside the Tasks block
  // below by extending the projects/:id/sprints regex match
}
{
  const sm = path.match(/^\/api\/sprints\/([^/]+)(?:\/(start|complete|burndown|issues(?:\/([^/]+))?))?$/);
  if (sm) {
    const sprId = sm[1];
    const action = sm[2];
    const issueIdInPath = sm[3];
    if (!action) {
      if (m === 'GET')    return getSprint(env, sprId);
      if (m === 'PATCH')  return patchSprint(req, env, sprId);
      if (m === 'DELETE') return deleteSprint(env, sprId);
    }
    if (action === 'start' && m === 'POST')      return startSprint(env, authCtx, sprId);
    if (action === 'complete' && m === 'POST')   return completeSprint(req, env, authCtx, sprId);
    if (action === 'burndown' && m === 'GET')    return getBurndown(env, sprId);
    if (action === 'issues' && !issueIdInPath && m === 'POST') {
      return addIssuesToSprint(req, env, authCtx, sprId);
    }
    if (action === 'issues' && issueIdInPath && m === 'DELETE') {
      return removeIssueFromSprint(env, authCtx, sprId, issueIdInPath);
    }
  }
}
```

In the existing Tasks block, extend the `pm` regex match to also handle `/api/projects/:id/sprints`:

```js
const pm = path.match(/^\/api\/projects\/([^/]+)(?:\/(issues|sprints))?$/);
// ... existing logic for the no-sub and 'issues' branches ...
if (sub === 'sprints') {
  if (m === 'GET')  return listProjectSprints(env, projId);
  if (m === 'POST') return createSprint(req, env, authCtx, projId);
}
```

---

## `worker/tasks.js` — minimal extensions

1. **`patchIssue`**: add `sprint_id` to the recognized field set. When it changes, write a system activity row with the readable sprint name (look up old + new from `sprints` in one batched query). Emit `ISSUE_UPDATED` with `changed_fields: ['sprint_id']` (NOT a new dedicated event type — sprint moves are just updates).
2. **`getIssue`**: extend the SELECT to `LEFT JOIN sprints s ON s.id = i.sprint_id` and include `sprint: {id, name, state} | null` on the reshaped issue.
3. **`listIssues`**: same join. Also accept a `sprint_id` query param: `__backlog__` → `i.sprint_id IS NULL`; otherwise direct equality.
4. **`reshapeIssueRow`**: add `sprint` reshape from the joined `s_id`/`s_name`/`s_state` columns.

---

## Frontend — `public/sprints-ui.js`

New self-contained file loaded after `tasks-ui.js`. Exposes globals on `window` so `tasks-ui.js` can dispatch into it from the project detail tab strip.

### State extension (top of file)

```js
(function () {
  Object.assign(state.ui, {
    tasksTab: 'issues',                  // 'issues' | 'board' | 'backlog' | 'sprints'
    tasksBoardSprintId: '',              // which sprint the board is showing; '' = active
    tasksDragIssueId: '',                // current dragged issue
  });
  state.tasks.sprints = [];              // list for current project
  state.tasks.boardIssues = [];          // issues currently rendered on the board
  state.tasks.backlogIssues = [];        // backlog tab issues
  state.tasks.activeSprint = null;       // cached active sprint (if any)
  state.tasks.burndown = null;           // last fetched burndown for the open sprint
})();
```

### Functions (all globals on `window`)

**Tab dispatch:**
- `renderTasksTab()` — called from inside `tasks-ui.js`'s `renderProjectDetail` after the tab strip is rendered. Branches on `state.ui.tasksTab` to call the right `render*Tab` function.
- `setTasksTab(tab)` — mutates state, re-renders project detail.

**Board tab:**
- `loadBoard(projectId)` — fetches sprints for the project + issues filtered by `tasksBoardSprintId` (or active sprint if blank). If no active sprint exists and `tasksBoardSprintId` is blank, show an empty state with "Create a sprint" CTA.
- `renderBoardTab()` — renders 5 columns (`backlog` is hidden in board mode unless explicitly enabled — show only `todo`, `in_progress`, `in_review`, `done`). Each column has a header (status name + count) and a list of cards. Each card is `draggable="true"`, has type icon, key, title, assignee avatar, priority lozenge.
- `onCardDragStart(ev, issueId)` — set `state.ui.tasksDragIssueId`, set `dataTransfer`, add `.dragging` class.
- `onColumnDragOver(ev)` — `ev.preventDefault()`, add `.drop-target` class to the column.
- `onColumnDrop(ev, newStatus)` — `ev.preventDefault()`, look up current issue, PATCH `/api/issues/:id` with `{status: newStatus}`, then refetch the board column. Skip if `tasksCanWrite()` is false.
- `onCardDragEnd(ev)` — clear `.dragging` and any lingering `.drop-target`.
- **Mobile fallback:** below 760px, cards become tap-to-cycle. Tapping a card opens a small bottom sheet with the four target statuses; tapping one PATCHes and re-renders.

**Backlog tab:**
- `loadBacklog(projectId)` — fetches issues with `?sprint_id=__backlog__`.
- `renderBacklogTab()` — table similar to the existing issues view but with a leftmost checkbox column for multi-select and a "Move to sprint…" button at the top that's enabled when ≥1 row is selected. Clicking it opens a modal with a sprint dropdown (planned + active sprints for this project) and "Move" button.
- `submitBacklogMoveToSprint(sprintId)` — calls `POST /api/sprints/:id/issues` with the selected ids, then re-renders backlog + invalidates board cache.

**Sprints tab:**
- `loadSprints(projectId)` — fetches `/api/projects/:id/sprints`.
- `renderSprintsTab()` — three sections: **Active sprint** (or "No active sprint" empty state), **Planned sprints**, **Completed sprints** (collapsible). Active sprint shows: name, goal, days remaining, total/done counts, "Open burndown" button, "Complete sprint" button. Each planned sprint has "Edit", "Start sprint", "Delete" actions. Completed sprints are read-only with "Open burndown".
- "+ New sprint" button at top opens `openCreateSprint()` modal.

**Sprint create / edit / start / complete modals:**
- `openCreateSprint(projectId)` → form with name + goal + planned_end_at (date).
- `submitCreateSprint(projectId)` → POST, close, reload sprints tab.
- `openEditSprint(sprintId)` → form prefilled with current values, name + goal + planned_end_at.
- `submitEditSprint(sprintId)` → PATCH, close, reload.
- `confirmStartSprint(sprintId)` → confirm dialog (mention this will become the active sprint), then POST `/start`, reload, switch to Board tab.
- `openCompleteSprint(sprintId)` → modal showing the count of incomplete issues in this sprint, with two radio buttons: "Move to next planned sprint" (with a dropdown of planned sprints — disabled if none) / "Move back to backlog". "Complete sprint" button.
- `submitCompleteSprint(sprintId)` → POST `/complete` with the chosen action, close, reload sprints tab.
- `confirmDeleteSprint(sprintId)` → confirm, DELETE, reload.

**Burndown:**
- `openBurndown(sprintId)` → fetches `/api/sprints/:id/burndown`, opens a wide modal with an inline SVG chart. Rendered with plain JS — two polylines (ideal dashed grey, actual solid cyan), x-axis ticks per day, y-axis 0..total. Show the `total_issues` and `days_remaining` in a header row. Include a "Switch to dark/light has been handled by theme tokens" — use `var(--cyan)` etc, no hardcoded colors.

### Drag-drop CSS classes the JS uses
The CSS subagent will define these — they include:
- `.kanban-board`, `.kanban-col`, `.kanban-col.drop-target`, `.kanban-col-head`, `.kanban-col-count`, `.kanban-col-body`
- `.issue-card`, `.issue-card.dragging`, `.issue-card-key`, `.issue-card-title`, `.issue-card-foot` (avatar + priority lozenge)
- `.sprint-card`, `.sprint-card-active`, `.sprint-card-planned`, `.sprint-card-completed`
- `.burndown-chart`, `.burndown-axis`, `.burndown-grid`, `.burndown-line-ideal`, `.burndown-line-actual`, `.burndown-tooltip`

---

## `public/tasks-ui.js` — minimal extensions

### 1. Replace the project header `+ New issue` row with a tab strip

Currently the project detail page has a single header row with "← All projects" + project key/name + Edit/Delete/+New issue. Add a tab strip immediately below:

```html
<div class="tasks-tabs">
  <button class="tasks-tab ${tab==='issues'?'active':''}" onclick="setTasksTab('issues')">Issues</button>
  <button class="tasks-tab ${tab==='board'?'active':''}" onclick="setTasksTab('board')">Board</button>
  <button class="tasks-tab ${tab==='backlog'?'active':''}" onclick="setTasksTab('backlog')">Backlog</button>
  <button class="tasks-tab ${tab==='sprints'?'active':''}" onclick="setTasksTab('sprints')">Sprints</button>
</div>
```

The body of the project detail then dispatches: if `tasksTab === 'issues'`, render the existing filter bar + table. Otherwise call `renderTasksTab()` from `sprints-ui.js`.

### 2. `setTasksTab(tab)` is defined in `sprints-ui.js`, but `tasks-ui.js` calls it. That's fine — both files share the global scope.

### 3. The "+ New issue" button stays in the header but shows on every tab.

---

## Files to touch

| File | Action | Approx size |
|---|---|---|
| `migrations/004_sprints.sql` | NEW | ~25 lines |
| `schema.sql` | MODIFY — append `-- ── Sprint 3: sprints ──` block | +25 lines |
| `worker/sprints.js` | NEW — sprint handlers + burndown | ~450 lines |
| `worker/tasks.js` | MODIFY — extend patchIssue/getIssue/listIssues/reshapeIssueRow for `sprint_id` + `sprint` join | +60 lines |
| `worker.js` | MODIFY — imports + sprint route block + extend tasks regex for `/sprints` sub | +50 lines |
| `public/sprints-ui.js` | NEW — board, backlog, sprints tabs + drag-drop + burndown SVG | ~800 lines |
| `public/tasks-ui.js` | MODIFY — tab strip in project detail header, dispatch into `renderTasksTab()` | +30 lines |
| `public/index.html` | MODIFY — `<script src="/sprints-ui.js" defer></script>` | +1 line |
| `public/dashboard.css` | MODIFY — kanban, sprint cards, tab strip, burndown chart, drag states | +180 lines |

---

## Subagent decomposition (recommended)

This sprint splits cleanly into three parallel subagents + main thread work:

- **Subagent A (backend):** Read this handoff + the existing `worker/tasks.js`, `worker/sessions.js`, `worker/events.js`. Write `worker/sprints.js` from spec. Also patch `worker/tasks.js` for the four extensions (patchIssue/getIssue/listIssues/reshapeIssueRow). Output: two files written. Do NOT touch worker.js — main thread integrates.

- **Subagent B (frontend):** Read this handoff + the existing `public/tasks-ui.js`. Write `public/sprints-ui.js` from spec. Also produce a small set of suggested edits (as text in the report) for the tab strip to splice into `tasks-ui.js`'s `renderProjectDetail`. Main thread does the splice. Note all the global function names so main thread can verify nothing is missed.

- **Subagent C (CSS):** Read this handoff + `public/dashboard.css`. Append a Sprint-3 block with all the kanban / sprint card / tab strip / burndown styles. Use existing theme tokens and `color-mix()` for tints. Define the drag states (`.dragging` opacity, `.drop-target` highlight). Output: dashboard.css updated.

- **Main thread:** Migrations + schema, route wiring in worker.js, splice the tab strip into tasks-ui.js, add the sprints-ui.js script tag, apply migration, deploy, smoke-test.

---

## Acceptance criteria

- [ ] `migrations/004_sprints.sql` applied to remote D1; `sprints` table + `sprint_id` column on `issues` exist
- [ ] `schema.sql` mirrors the migration
- [ ] `worker/sprints.js` exports all 10 handlers
- [ ] `worker/tasks.js` patchIssue/getIssue/listIssues/reshapeIssueRow handle `sprint_id`
- [ ] `worker.js` imports + routes wired; `node -e "import('./worker.js')"` parses
- [ ] `public/sprints-ui.js` written; `node --check` passes
- [ ] `public/tasks-ui.js` tab strip splice in place; `node --check` passes
- [ ] `public/index.html` loads `sprints-ui.js`
- [ ] `public/dashboard.css` has all referenced classes
- [ ] Live test plan passes:
  - [ ] Create a sprint in the ENG project (use whatever exists from Sprint 2 testing)
  - [ ] Add 3 backlog issues to it via Backlog → multi-select → Move to sprint
  - [ ] Start the sprint → Board tab shows the issues in their current status columns
  - [ ] Drag a card from To Do → In Progress on desktop → status updates instantly + activity row recorded
  - [ ] Try to start a second sprint in the same project → 409 conflict
  - [ ] Mark some issues done, then Complete sprint → choose "Move incomplete to backlog" → sprint shows in Completed list
  - [ ] Open burndown on the completed sprint → SVG chart renders with ideal vs actual lines
  - [ ] Toggle to light theme → board, sprint cards, burndown all render correctly
  - [ ] Sign in as a viewer → cards on the board are not draggable, no Edit/Start/Complete buttons
  - [ ] `npx wrangler tail` shows the `emit()` calls fire on start/complete/drag (still no-op stubs)

---

## Out of scope (do NOT build)

- Story points / velocity (Sprint 6 maybe)
- Multi-project boards or cross-project sprints
- Per-project workflow customization (Sprint 5/6) — fixed status list stays
- Sprint goals tracking against actual outcome
- Sprint retrospectives module
- Calendar/Gantt view of sprints
- Sprint capacity planning
- Mobile drag-drop (mobile uses tap-to-cycle fallback only)
- Bulk import of issues into a sprint (single multi-select is fine)
- Email notifications when a sprint starts (Sprint 5 wires Discord; email is out of scope for Sprint 3)
- Burndown export / sharing
- Smart "scope creep" detection (added vs removed mid-sprint)

---

## Reference reads (skim before starting)

- `handoffs/sprint-2-tasks-mvp.md` — the prior sprint's spec; format and conventions match
- `worker/tasks.js` (entire file ~480 lines) — exact patterns to mirror in `worker/sprints.js`
- `worker/events.js` — `EVENT_TYPES.SPRINT_STARTED` and `SPRINT_COMPLETED` already declared
- `worker/sessions.js` — D1 query patterns
- `worker.js` lines 1–80 (imports), line 690+ (Tasks route block from Sprint 2) — where to wire new routes
- `public/tasks-ui.js` (entire file, ~830 lines) — patterns for state, modals, click-to-edit, list/detail rendering, the existing project header that needs the tab strip splice
- `public/dashboard.css` lines 1–60 (theme tokens), the Sprint 2 block at the bottom — class naming and `color-mix()` patterns to copy
- `public/index.html` — where the existing script tags live

---

## Expected commit log when done

```
feat(tasks): kanban board with HTML5 drag-drop (Sprint 3 board)
feat(tasks): sprints, burndown, completion flow (Sprint 3 sprints)
feat(tasks): sprint schema + worker handlers (Sprint 3 backend)
```

Or one combined commit if the change is reviewed in one pass — match what worked in Sprint 2.

---

## Open questions for the user before starting

None, assuming the locked decisions table is acceptable.

If any locked decision should change:
- **Story points instead of issue count for burndown** would mean adding `points` column to `issues` and a UI to set it. That's its own ~half-day of work; defer if not needed for v1.
- **Per-project workflow customization** is the biggest possible addition. If it's wanted in Sprint 3, expect another ~600 lines of code (workflow_states table, drag-to-reorder UI in project settings, mapping migration logic for existing issues). Strongly recommend keeping it deferred.
- **Cross-project sprints** would mean moving `project_id` off `sprints` and onto `issue_sprint` join — a rewrite of the data model. Sprint 6 conversation if ever.
