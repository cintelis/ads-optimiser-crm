# HANDOFF — Sprint 4: Docs MVP (Confluence-like wiki)

**Branch:** `sprint-4-docs-mvp` from `main` (currently at `2143aa7`).
**Live URL:** https://outreach-dashboard.nick-598.workers.dev
**Depends on:** Sprint 1 (auth, activity table) and the markdown CDN scripts already loaded by Sprint 2 (`marked` + `DOMPurify`). Independent of Sprints 2 and 3.

---

## Goal

Add a Confluence-like internal documentation wiki: **spaces** (top-level groupings), **pages** (markdown content with parent/child tree nesting), and **version history** (auto-snapshot on every save with restore). View + edit + create + delete. No comments, no @mentions, no inline images, no FTS — those land in Sprint 5/6.

---

## Decisions already locked

| Decision | Value | Rationale |
|---|---|---|
| Page format | Markdown stored raw in `content_md`. Rendered with the existing `renderMarkdown()` helper from `tasks-ui.js` (`marked` + `DOMPurify` already on the page) | Same library as Sprint 2 issue descriptions |
| Page tree depth | Unbounded — pages can have a `parent_id` pointing to another page in the same space | Confluence allows arbitrary depth; cheap if we render with indentation |
| Version snapshot policy | Auto-snapshot the previous content into `doc_page_versions` BEFORE every UPDATE — including title changes. No manual "save version" button | Predictable; matches Confluence behavior; cheap because it's just one extra INSERT per save |
| Version retention | Keep all versions forever for v1 — no pruning | Simpler; revisit if/when storage hurts |
| Restore | Restoring an old version creates a NEW version snapshot of current state, then overwrites current with the old content | Reversible; never destructive |
| Page deletion | Soft delete via `active=0`. Cascade soft-deletes children. Versions of deleted pages are retained but unreachable through the UI | Audit-safe |
| Space deletion | Soft delete cascades to all pages in the space | Same |
| Permissions | Same role gating as everything else: viewer can read, member+ can write, admin can delete spaces. No per-space ACLs in v1 | Per-space permissions deferred to Sprint 6 |
| Slugs | Pages have a `slug` derived from the title (lowercase, hyphenated, deduped within parent). Used for nice URLs in a future deep-linking sprint, NOT for routing in v1 — v1 navigates by `id` only | Free metadata; small upfront cost |
| Page IDs | `dpg_{hex}`; spaces are `dsp_{hex}`; versions are `dpv_{hex}` | Match the existing prefix convention |
| Editor UX | Plain `<textarea>` with a live preview pane on the right side. Click "Edit" to enter edit mode; Save / Cancel buttons. No WYSIWYG, no toolbar, no autosave | Minimal v1; matches the markdown-first decision from earlier |
| Tree expand state | Stored in `state.ui.docsExpandedPages` (set of ids); ephemeral, no persistence | Simple |
| Default expand depth | All top-level pages expanded by default; click to collapse | Confluence-like |
| What appears in nav | New top-level "Docs" group between Tasks and Settings | Same pattern as Tasks |
| File split | New `worker/docs.js` (backend), new `public/docs-ui.js` (frontend), CSS append, minimal `worker.js` + `app.js` + `index.html` integration | Same pattern as Sprints 2 and 3 |

---

## Schema — `migrations/005_docs.sql`

Apply: `npx wrangler d1 execute outreach-db --remote --file=migrations/005_docs.sql`

```sql
-- Sprint 4: Docs (spaces + pages + version history)

CREATE TABLE IF NOT EXISTS doc_spaces (
  id TEXT PRIMARY KEY,                    -- dsp_{hex}
  key TEXT UNIQUE NOT NULL,               -- short uppercase identifier (e.g. ENG, PROC)
  name TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',          -- single emoji or short string for the sidebar
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_spaces_key ON doc_spaces(key);
CREATE INDEX IF NOT EXISTS idx_doc_spaces_active ON doc_spaces(active);

CREATE TABLE IF NOT EXISTS doc_pages (
  id TEXT PRIMARY KEY,                    -- dpg_{hex}
  space_id TEXT NOT NULL,
  parent_id TEXT,                         -- nullable; self-FK for tree nesting
  title TEXT NOT NULL,
  slug TEXT NOT NULL DEFAULT '',          -- title-derived; unique within (space_id, parent_id)
  content_md TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,    -- sibling order within parent
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_pages_space ON doc_pages(space_id, active);
CREATE INDEX IF NOT EXISTS idx_doc_pages_parent ON doc_pages(parent_id, position);
CREATE INDEX IF NOT EXISTS idx_doc_pages_updated ON doc_pages(updated_at DESC);

CREATE TABLE IF NOT EXISTS doc_page_versions (
  id TEXT PRIMARY KEY,                    -- dpv_{hex}
  page_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL DEFAULT '',
  author_id TEXT,
  created_at TEXT NOT NULL                -- snapshot timestamp
);
CREATE INDEX IF NOT EXISTS idx_doc_versions_page ON doc_page_versions(page_id, created_at DESC);
```

**Mirror the same DDL into `schema.sql`** under `-- ── Sprint 4: Docs ──` so fresh installs have it.

---

## API surface

All authenticated. Viewer is auto-blocked on writes by the existing role gate.

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/doc-spaces` | any | List active spaces with `page_count` per space |
| POST | `/api/doc-spaces` | member+ | Create space. Body: `{key, name, description_md?, icon?}`. Validates key shape (same regex as projects: `^[A-Z][A-Z0-9]{1,9}$`). |
| GET | `/api/doc-spaces/:id` | any | Space detail with the FULL page tree (all pages in the space, ordered by parent → position). Returned as a flat array; client builds the tree. |
| PATCH | `/api/doc-spaces/:id` | member+ | Update name, description, icon. Key is immutable. |
| DELETE | `/api/doc-spaces/:id` | **admin** | Soft delete space + cascade soft-delete all pages |
| GET | `/api/doc-spaces/:id/pages` | any | List active pages in the space (same shape as the tree returned by space detail). Provided for direct access if needed. |
| POST | `/api/doc-spaces/:id/pages` | member+ | Create page. Body: `{title, content_md?, parent_id?, position?}`. Auto-generates slug. Computes `position = MAX(position) + 1` within the parent if not provided. Initial version snapshot created with the same content. |
| GET | `/api/doc-pages/:id` | any | Page detail with `space`, `parent` (if any), `children` (id/title/slug only — used for "child pages" footer), `version_count`. |
| PATCH | `/api/doc-pages/:id` | member+ | Update title, content_md, parent_id, position. Atomically: snapshot current content into `doc_page_versions` BEFORE updating, then UPDATE. Body partial. Sets `updated_by = current user`. |
| DELETE | `/api/doc-pages/:id` | member+ | Soft delete + cascade soft-delete children |
| GET | `/api/doc-pages/:id/versions` | any | List versions for the page (id, title, author joined, created_at). Newest first. |
| GET | `/api/doc-pages/:id/versions/:versionId` | any | Get a single version's full content for diffing/preview |
| POST | `/api/doc-pages/:id/versions/:versionId/restore` | member+ | Snapshot current state as a new version, then overwrite content+title with the version's content. Returns the updated page. |

### Response shapes

```json
// GET /api/doc-spaces/:id
{
  "space": { "id": "...", "key": "ENG", "name": "Engineering", "description_md": "...", "icon": "🛠", ... },
  "pages": [
    { "id": "dpg_a1", "parent_id": null, "title": "Architecture", "slug": "architecture", "position": 0, "updated_at": "...", "updated_by_name": "Nick" },
    { "id": "dpg_a2", "parent_id": "dpg_a1", "title": "D1 schema", "slug": "d1-schema", "position": 0, ... }
  ]
}

// GET /api/doc-pages/:id
{
  "page": { "id": "...", "space_id": "...", "parent_id": null, "title": "...", "slug": "...", "content_md": "...", "position": 0, "created_at": "...", "updated_at": "...", "created_by": "...", "updated_by": "...", "created_by_name": "...", "updated_by_name": "..." },
  "space": { "id": "...", "key": "...", "name": "..." },
  "parent": { "id": "...", "title": "..." } | null,
  "children": [ { "id": "...", "title": "...", "slug": "..." }, ... ],
  "version_count": 7
}

// GET /api/doc-pages/:id/versions
{
  "versions": [
    { "id": "dpv_...", "page_id": "...", "title": "...", "author_id": "...", "author_name": "...", "created_at": "..." },
    ...
  ]
}
```

### Slug generation

```js
function slugify(title) {
  return String(title || '').toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'untitled';
}
```

Within the space, dedupe by appending `-2`, `-3`, etc. if a sibling under the same `parent_id` already has the same slug. Backend computes this at create time.

### Atomic version snapshot in patchPage

```
1. SELECT current title, content_md FROM doc_pages WHERE id=?
2. INSERT INTO doc_page_versions (id, page_id, title, content_md, author_id, created_at)
   VALUES (?, ?, current.title, current.content_md, current updated_by, now())
3. UPDATE doc_pages SET title=?, content_md=?, updated_at=now(), updated_by=? WHERE id=?
```

If the patch only changes `parent_id` or `position` (no content/title delta), skip the snapshot — version history is for content changes only.

---

## `worker/docs.js` — backend module

New file mirroring `worker/tasks.js` and `worker/sprints.js` patterns. Self-contained, redeclares `jres()`/`now()`/`uid()`, imports `emit` + `EVENT_TYPES` from `./events.js`. Exports:

```
listSpaces(env)
createSpace(req, env, ctx)
getSpace(env, spaceId)
patchSpace(req, env, spaceId)
deleteSpace(env, spaceId)

listSpacePages(env, spaceId)              // alias of the pages array inside getSpace
createPage(req, env, ctx, spaceId)
getPage(env, pageId)
patchPage(req, env, ctx, pageId)
deletePage(env, pageId)

listPageVersions(env, pageId)
getPageVersion(env, pageId, versionId)
restorePageVersion(req, env, ctx, pageId, versionId)
```

Helpers:
- `spaceId()`, `pageId()`, `versionId()` ID generators
- `slugify(title)` and `uniqueSlugInParent(env, spaceId, parentId, baseSlug)` (returns a deduped slug)
- `snapshotPage(env, page, authorId)` — inserts a version row, returns the version id
- `cascadeSoftDeletePage(env, pageId)` — recursively walks `parent_id` children and sets them all to active=0

`emit()` calls — fire on every doc mutation:
- `DOC_PAGE_CREATED` after createPage
- `DOC_PAGE_UPDATED` after patchPage (when content/title changed) AND after restorePageVersion
- `DOC_PAGE_DELETED` (will need to be added to EVENT_TYPES — see below)

The existing `worker/events.js` already has `DOC_PAGE_CREATED`, `DOC_PAGE_UPDATED`, `DOC_PAGE_COMMENTED` declared. Add `DOC_PAGE_DELETED` to `EVENT_TYPES` as part of Sprint 4. (One line edit; mention in the report.)

---

## `worker.js` integration

Add to imports near the existing `worker/sprints.js` import block:

```js
import {
  listSpaces, createSpace, getSpace, patchSpace, deleteSpace,
  listSpacePages, createPage, getPage, patchPage, deletePage,
  listPageVersions, getPageVersion, restorePageVersion,
} from './worker/docs.js';
```

Add a Docs route block above the existing Tasks block in `route()` (or anywhere — the regex matching is independent):

```js
// ── Docs (Sprint 4) ──────────────────────────────────────
if (path === '/api/doc-spaces' && m === 'GET')  return listSpaces(env);
if (path === '/api/doc-spaces' && m === 'POST') return createSpace(req, env, authCtx);
{
  const spm = path.match(/^\/api\/doc-spaces\/([^/]+)(?:\/(pages))?$/);
  if (spm) {
    const spId = spm[1];
    const sub = spm[2];
    if (!sub) {
      if (m === 'GET')    return getSpace(env, spId);
      if (m === 'PATCH')  return patchSpace(req, env, spId);
      if (m === 'DELETE') {
        if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
        return deleteSpace(env, spId);
      }
    }
    if (sub === 'pages') {
      if (m === 'GET')  return listSpacePages(env, spId);
      if (m === 'POST') return createPage(req, env, authCtx, spId);
    }
  }
}
{
  const dpm = path.match(/^\/api\/doc-pages\/([^/]+)(?:\/(versions)(?:\/([^/]+)(?:\/(restore))?)?)?$/);
  if (dpm) {
    const pgId = dpm[1];
    const sub = dpm[2];
    const verId = dpm[3];
    const restore = dpm[4];
    if (!sub) {
      if (m === 'GET')    return getPage(env, pgId);
      if (m === 'PATCH')  return patchPage(req, env, authCtx, pgId);
      if (m === 'DELETE') return deletePage(env, pgId);
    }
    if (sub === 'versions' && !verId && m === 'GET') return listPageVersions(env, pgId);
    if (sub === 'versions' && verId && !restore && m === 'GET') return getPageVersion(env, pgId, verId);
    if (sub === 'versions' && verId && restore === 'restore' && m === 'POST') return restorePageVersion(req, env, authCtx, pgId, verId);
  }
}
```

---

## Frontend — `public/docs-ui.js`

New self-contained file loaded after `tasks-ui.js` and `sprints-ui.js`. Exposes globals on `window` so `app.js` can dispatch into it from the section switch.

### State extension (top of file, IIFE)

```js
(function () {
  if (!state.ui.docsSpaceId) state.ui.docsSpaceId = '';
  if (!state.ui.docsPageId) state.ui.docsPageId = '';
  if (!state.ui.docsExpandedPages) state.ui.docsExpandedPages = {};   // {pageId: true}
  if (!state.ui.docsEditing) state.ui.docsEditing = false;
  if (!state.ui.docsDraft) state.ui.docsDraft = null;                  // {title, content_md} when editing
  state.docs = state.docs || {};
  state.docs.spaces = state.docs.spaces || [];
  state.docs.space = state.docs.space || null;
  state.docs.pages = state.docs.pages || [];
  state.docs.page = state.docs.page || null;
  state.docs.versions = state.docs.versions || [];
})();
```

### Required globals

**Section dispatch:**
- `renderDocsSection()` — called from `app.js` when `section === 'docs'`. If `state.ui.docsSpaceId` is empty, calls `loadSpaces()` then `renderSpacesList()`. If a space is selected and `state.ui.docsPageId` is empty, calls `loadSpace()` then `renderSpaceHome()`. If a page is selected, calls `loadPage()` then `renderPage()`.

**Spaces list:**
- `loadSpaces()` — fetches `/api/doc-spaces`
- `renderSpacesList()` — card grid like the Projects page; each card shows icon (or first letter if no icon), key, name, page count. Click → `openSpace(id)`. "+ New space" button (member+).
- `openCreateSpace()` modal — key, name, icon (text input, accept any single-char/emoji), description.
- `submitCreateSpace()` — POST, reload list.

**Space view (sidebar tree + selected page):**
- `loadSpace(spaceId)` — fetches `/api/doc-spaces/:id`. Stores `state.docs.space` and `state.docs.pages` (the flat array). Sets `state.ui.docsSpaceId`.
- `openSpace(id)` — sets state, clears page selection, calls `nav('docs')` to re-render.
- `renderSpaceHome()` — when a space is selected but no page: render the space header (icon, name, description rendered with `renderMarkdown`) + an empty state with "+ New page" button + a list of top-level pages as cards.

**Page tree sidebar:**
- `renderPageTree(pages, parentId, depth)` — recursive HTML builder. Returns a `<ul class="docs-tree">` of `<li>` items. Each item:
  - Has a chevron icon (`▸` or `▾`) to toggle expand/collapse if it has children
  - Shows the title, click to open the page
  - Has a small "+" button on hover to add a child page
  - Active page (`state.ui.docsPageId === page.id`) is highlighted
  - Indentation via CSS (`padding-left: ${depth * 14}px`)
- `toggleExpand(pageId)` — flip in `state.ui.docsExpandedPages`, re-render
- `openPage(pageId)` — sets `state.ui.docsPageId`, exits edit mode if active, re-renders

**Page view:**
- `loadPage(pageId)` — fetches `/api/doc-pages/:id`. Stores `state.docs.page`. Also fetches the parent space if not already loaded.
- `renderPage()` — two-column layout:
  - **Left (~250px sidebar):** "← Back to spaces" link, space header (icon + name), then the page tree. Sticky.
  - **Right (main):** breadcrumb (Space › Parent › Page), page title (h1), buttons row (Edit, Version history, Delete), rendered markdown body, "Child pages" footer if any (renders as a `<ul>` of links).
- In edit mode (`state.ui.docsEditing`): replace the right side with a two-pane editor — title input on top, then a side-by-side `<textarea>` (left) and live preview (right) using `renderMarkdown(state.ui.docsDraft.content_md)`. Save / Cancel buttons.

**Page CRUD:**
- `openCreatePage(parentId)` — prompts for title via the existing modal helper. On submit, POST `/api/doc-spaces/:spaceId/pages`, then opens the new page in edit mode immediately.
- `startEditPage()` — sets `state.ui.docsEditing = true`, copies current page into `state.ui.docsDraft`, re-renders.
- `cancelEditPage()` — clears edit state, re-renders.
- `saveEditPage()` — PATCH `/api/doc-pages/:id` with the draft. On success, reload page (which picks up the new version count), re-render in view mode.
- `confirmDeletePage()` — confirm dialog, DELETE, navigate back to space home.
- Title and content textareas update `state.ui.docsDraft` on every input via `oninput` handlers.

**Version history modal:**
- `openVersionHistory()` — fetches `/api/doc-pages/:id/versions`. Opens a wide modal listing versions newest-first. Each row: timestamp, author, "Preview" link, "Restore" button (member+). Click a row to expand and show the content rendered with `renderMarkdown` (or a side-by-side diff is overkill for v1 — just show the snapshot).
- `previewVersion(versionId)` — fetch `/api/doc-pages/:id/versions/:versionId`, swap into the modal body.
- `confirmRestoreVersion(versionId)` — confirm, POST `/restore`, close modal, reload page.

**Markdown editor helpers:**
- The textarea is plain — no toolbar, no shortcuts. Tab key inserts two spaces (small UX nicety, ~10 lines).
- The preview pane scrolls independently of the textarea. Don't try to sync scroll positions for v1.

### CSS classes the JS uses (CSS subagent must define)

- `.docs-layout`, `.docs-sidebar`, `.docs-main`
- `.docs-tree`, `.docs-tree-item`, `.docs-tree-item.active`, `.docs-tree-item .chevron`, `.docs-tree-add` (+ button on hover)
- `.docs-page-header`, `.docs-breadcrumb`, `.docs-page-title`, `.docs-page-actions`
- `.docs-page-body` (the rendered markdown — alias of `.md-body` from Sprint 2)
- `.docs-children-list`
- `.docs-editor`, `.docs-editor-pane`, `.docs-editor-textarea`, `.docs-editor-preview`
- `.docs-version-row`, `.docs-version-row.expanded`, `.docs-version-meta`
- `.docs-empty-state`
- `.docs-space-card` (for the spaces grid — can extend `.project-card` or be its own variant)

---

## `app.js` integration

1. Add `docs: 'Docs'` to `SECTION_TITLES` (line ~3)
2. Add a branch to `renderSection()` (line ~347):
   ```js
   else if (s === 'docs') {
     if (typeof renderDocsSection === 'function') {
       await renderDocsSection();
     } else {
       c.innerHTML = '<div class="empty"><p>Docs module failed to load.</p></div>';
     }
   }
   ```

## `index.html` integration

1. Add nav item between Tasks and Settings:
   ```html
   <div class="nav-divider"></div>
   <div class="nav-group-label">Docs</div>
   <button class="nav-item" id="nav-docs" type="button" onclick="nav('docs')">Spaces</button>
   ```
2. Add to mobile sheet:
   ```html
   <button class="mobile-sheet-item" id="more-docs" type="button" onclick="closeMobileMenu();nav('docs')">Docs</button>
   ```
3. Add the script tag at the bottom (after `sprints-ui.js`):
   ```html
   <script src="/docs-ui.js" defer></script>
   ```

---

## Files to touch

| File | Action | Approx size |
|---|---|---|
| `migrations/005_docs.sql` | NEW | ~50 lines |
| `schema.sql` | MODIFY — append `-- ── Sprint 4: Docs ──` block | +50 lines |
| `worker/docs.js` | NEW — spaces + pages + versions handlers + helpers | ~500 lines |
| `worker/events.js` | MODIFY — add `DOC_PAGE_DELETED` to `EVENT_TYPES` | +1 line |
| `worker.js` | MODIFY — imports + 2 docs route blocks | +50 lines |
| `public/docs-ui.js` | NEW — full Docs frontend (sidebar tree, page view/edit, version history) | ~700 lines |
| `public/app.js` | MODIFY — `SECTION_TITLES` + `renderSection` branch | +9 lines |
| `public/index.html` | MODIFY — nav group, mobile sheet item, script tag | +6 lines |
| `public/dashboard.css` | MODIFY — Docs layout block | +130 lines |

---

## Subagent decomposition (recommended — same as Sprint 3)

- **Subagent A (backend):** Read this handoff + existing `worker/tasks.js` and `worker/sprints.js`. Write `worker/docs.js` from scratch. Also patch `worker/events.js` to add `DOC_PAGE_DELETED`. Do NOT touch worker.js — main thread integrates routes.
- **Subagent B (frontend):** Read this handoff + existing `public/tasks-ui.js` and `public/sprints-ui.js` for style/idioms. Write `public/docs-ui.js` from scratch. Do NOT touch app.js or index.html — main thread integrates section dispatch + script tag + nav.
- **Subagent C (CSS):** Read this handoff + existing `public/dashboard.css` (especially the Sprint 2/3 blocks at the bottom). Append a Sprint 4 Docs block defining all the classes listed above. Use existing theme tokens and `color-mix()` for tints.
- **Main thread:** migration + schema, route wiring in worker.js, app.js section branch, index.html nav + script tag, deploy, smoke test.

---

## Acceptance criteria

- [ ] `migrations/005_docs.sql` applied to remote D1; `doc_spaces`, `doc_pages`, `doc_page_versions` tables exist
- [ ] `schema.sql` mirrors the migration
- [ ] `worker/docs.js` exports all 13 handlers
- [ ] `worker/events.js` has `DOC_PAGE_DELETED` added
- [ ] `worker.js` imports + routes wired; `node -e "import('./worker.js')"` parses
- [ ] `public/docs-ui.js` written; `node --check` passes
- [ ] `public/app.js` SECTION_TITLES + renderSection branch in place; parses
- [ ] `public/index.html` has the new nav group, mobile item, script tag
- [ ] `public/dashboard.css` has all referenced classes
- [ ] **Live test plan passes:**
  - [ ] Click "Spaces" in the nav — empty state with "+ New space" button
  - [ ] Create a space ENG / Engineering with icon 🛠
  - [ ] Click into the space — empty state, click "+ New page"
  - [ ] Create a page "Architecture" — opens immediately in edit mode
  - [ ] Type some markdown (`# Heading`, `**bold**`, a code block) → live preview pane updates → Save
  - [ ] Edit the page again, change a paragraph → Save → click "Version history" → see TWO versions in the list
  - [ ] Open the older version → preview renders correctly
  - [ ] Click "Restore" on the older version → page content reverts → version history now shows THREE versions (the restore created a new snapshot)
  - [ ] Create a child page "D1 schema" under Architecture — appears nested in the sidebar tree with a chevron
  - [ ] Toggle the chevron — D1 schema collapses/expands
  - [ ] Click D1 schema → opens that page; sidebar highlights it; breadcrumb shows "ENG › Architecture › D1 schema"
  - [ ] Delete the D1 schema page → confirms → returns to Architecture, sidebar no longer shows it
  - [ ] Toggle to light theme → docs sidebar, page view, editor, version modal all render correctly
  - [ ] Sign in as a viewer → cannot see Edit / Delete / + New buttons; can read all pages

---

## Out of scope (do NOT build)

- Inline images / image upload (Sprint 6 — needs R2 binding)
- @mentions in pages (Sprint 5)
- Page comments (Sprint 5 or 6 — would use the activity table like issue comments)
- Full-text search across pages (Sprint 5 — D1 FTS5)
- Cross-linking by page key paste (Sprint 5)
- Per-space permissions / private spaces (Sprint 6)
- WYSIWYG editor (never — markdown is the call)
- Markdown toolbar with bold/link/code buttons (could come in Sprint 6 polish)
- Diff view between versions (Sprint 6 — for v1 just show full snapshots)
- Drag-to-reorder pages in the tree (Sprint 6)
- Page export to HTML or PDF (Sprint 6)
- Templates (Sprint 6)
- Page autosave / draft recovery (Sprint 6)
- URL deep-linking to pages (Sprint 6)
- Public/published pages outside auth (out of scope for the internal tool)

---

## Reference reads

- `handoffs/sprint-3-tasks-board-sprints.md` — most recent sprint, same format and conventions
- `worker/tasks.js` and `worker/sprints.js` — backend module style to mirror
- `worker/events.js` — `EVENT_TYPES.DOC_PAGE_CREATED/UPDATED/COMMENTED` already declared; add `DOC_PAGE_DELETED`
- `public/tasks-ui.js` and `public/sprints-ui.js` — frontend module style (state IIFE, named functions, `window.foo = foo` exports, modal helpers)
- `public/app.js` lines 1-220 (state, theme bootstrap), 340-360 (renderSection switch)
- `public/dashboard.css` — theme tokens, Sprint 2/3 utility blocks at the bottom; the existing `.md-body` rules already cover markdown rendering — Sprint 4 just reuses them
- `public/index.html` — nav structure, where new groups go

---

## Open questions for the user before starting

None, assuming the locked decisions table is acceptable.

If anything in that table should change:
- **Versioning policy** (auto-snapshot every save vs manual save-version): the chosen "auto" is more like Confluence; the alternative (manual) would let users decide when a save is meaningful but adds a "save as new version" button. Auto is simpler and prevents data loss.
- **Page tree depth limit**: unbounded is fine for v1; if we hit performance issues with deeply nested trees we can cap at e.g. 5 in a future sprint.
- **Slug uniqueness scope** (per-parent vs per-space vs global): per-parent is the most flexible and matches Confluence. Per-space would mean two pages can never have the same slug even if they're in different parts of the tree — easier to URL-route later but less flexible.

---

## Expected commit log when done

```
feat(docs): docs MVP with version history (Sprint 4)
```

Or split into backend / frontend / polish if the change is large enough to warrant review separation. Match what worked for Sprint 3 (single combined commit was fine there).
