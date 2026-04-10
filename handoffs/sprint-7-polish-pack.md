# HANDOFF — Sprint 7: Polish pack

**Branch:** `sprint-7-polish-pack` from `main` (`521fa96`).
**Live URL:** https://outreach-dashboard.nick-598.workers.dev
**Depends on:** Sprints 1–6. **No backend changes** in this sprint — pure frontend + CSS.

---

## Goal

Four user-visible polish items that make the product feel finished:

1. **Markdown toolbar** above every markdown textarea so users don't have to remember syntax
2. **Toast notifications** replacing the existing `alert()` calls scattered through the codebase
3. **Empty state illustrations** — small inline SVG illustrations replacing the current "you're all caught up. ✨" plain text empty states
4. **Mobile sweep** — audit every page on narrow viewports and fix layout breakage

---

## Decisions already locked

| Decision | Value | Rationale |
|---|---|---|
| Toolbar style | Small button row above each textarea, ~12 buttons (B, I, S, H, • list, 1. list, ☐, `<>`, ` ``` `, `>`, link, image) | Standard markdown toolbar shape |
| Toolbar handle | `attachMarkdownToolbar(textarea, options)` global, idempotent (data-attr guard) | Mirrors `attachMentionAutocomplete` from Sprint 5 |
| Toolbar interaction | Click button → wrap selection or insert prefix/suffix at cursor → restore focus + cursor position | No keyboard shortcuts in v1 (keep simple) |
| Link/image button | Tiny popup with "Text" and "URL" inputs, then inserts the markdown | Browser `prompt()` would work but feels cheap |
| Toolbar applies to | All six markdown surfaces: issue description editor, issue comment composer, doc page editor, sprint goal field (modal), project description (modal), contact note (drawer or wherever it lives) | Comprehensive coverage |
| Toast container | Single `#toast-stack` div fixed at bottom-right of viewport, created lazily on first call | One DOM node, no surprises |
| Toast helper | `toast(message, type = 'info', duration = 3500)` global. Types: `success`, `error`, `warn`, `info` | Standard four-type system |
| Toast colors | Map to existing accent vars: success=`var(--green)`, error=`var(--red)`, warn=`var(--amber)`, info=`var(--cyan)` | Theme-aware automatically |
| Toast dismiss | Auto-fade after `duration` ms; click to dismiss immediately; max stack of 5 (oldest gets dropped) | Standard behavior |
| Replace `alert()` | Every `alert(...)` call site in the existing JS modules gets converted to `toast(...)` with the right type. Where `alert()` was used as a confirm-on-error, we use `toast(msg, 'error')` | Sweep job |
| Empty state shape | A small inline SVG (~60×60px, currentColor) + heading + supporting line + optional CTA button | Consistent look |
| Empty state file | New `public/empty-states.js` exposes a `renderEmptyState({icon, title, body, action})` global helper. Pre-defines a small set of named SVG icons | Reusable across sections |
| Empty state surfaces | Inbox (Sprint 5), Projects (Sprint 2), Issues table (Sprint 2), Sprints tab (Sprint 3), Spaces (Sprint 4), Pages (Sprint 4), Backlog tab (Sprint 3), Board with no active sprint (Sprint 3) | All major empty states |
| Mobile sweep target | Nothing should overflow horizontally. Tables either scroll or become card lists. Modals don't get cropped. The sidebar nav is hidden in favor of the existing mobile-tabbar + mobile-sheet (already in place from earlier sprints — verify). | "Doesn't look broken on a phone" |
| Mobile sweep approach | Audit each section at 360px and 760px breakpoints. Fix the worst offenders. Don't try to perfect every layout. | Time-bounded |
| Toast vs confirm() | The existing `confirm()` calls (delete confirms etc.) STAY as native confirms — they're modal blocking dialogs which is the right shape. Only `alert()` becomes toast. | Don't fix what isn't broken |
| Vendoring CDNs | Not in this sprint — `marked` / `DOMPurify` / `qrcode` stay on jsdelivr | Out of scope |

---

## Files to touch

| File | Action | Approx size |
|---|---|---|
| `public/markdown-toolbar.js` | NEW — toolbar render, button handlers, link/image popups | ~280 lines |
| `public/toasts.js` | NEW — toast() global, stack management, auto-dismiss | ~150 lines |
| `public/empty-states.js` | NEW — `renderEmptyState()` + named SVG icon library | ~250 lines |
| `public/dashboard.css` | MODIFY — toolbar, toast, empty state styles + mobile sweep fixes | +250 lines |
| `public/index.html` | MODIFY — three new script tags | +3 |
| `public/tasks-ui.js` | MODIFY — alert→toast, attach toolbar to issue desc + comment, replace empty states (no issues / no projects) | ~30 lines changed |
| `public/sprints-ui.js` | MODIFY — alert→toast, attach toolbar to sprint goal, replace empty states (no active sprint, no sprints) | ~25 lines changed |
| `public/docs-ui.js` | MODIFY — alert→toast, attach toolbar to page editor, replace empty states (no spaces, no pages) | ~20 lines changed |
| `public/notifications-ui.js` | MODIFY — alert→toast (if any), replace empty inbox state | ~10 lines changed |
| `public/integrations-ui.js` | MODIFY — alert→toast, replace empty integrations state | ~10 lines changed |
| `public/attachments-ui.js` | MODIFY — alert→toast for upload errors, replace empty attachments state | ~15 lines changed |
| `public/linked-items-ui.js` | MODIFY — alert→toast for link errors, replace empty links state | ~10 lines changed |
| `public/feature-settings-ui.js` | MODIFY — alert→toast | ~5 lines changed |
| `public/app.js` | MODIFY — add toolbar attach calls in any other markdown surfaces (project description modal, etc.), alert→toast in helper functions | ~20 lines changed |

**Total:** ~200 lines of new code + ~150 lines of edits across 9 existing files + ~250 lines of CSS.

---

## API contract for the new globals

### `markdown-toolbar.js`

```js
attachMarkdownToolbar(textareaEl, options?)
// options: {
//   buttons?: ['bold','italic','strike','heading','ul','ol','check','code','codeblock','quote','link','image']
//     (defaults to all)
//   compact?: boolean (default false; if true, omit less-used buttons)
// }
// Idempotent — sets textareaEl.dataset.mdToolbarAttached = '1' on first call.
// Inserts a div.md-toolbar BEFORE the textarea in its parent node.
```

### `toasts.js`

```js
toast(message, type = 'info', duration = 3500)
// type: 'success' | 'error' | 'warn' | 'info'
// Returns the toast element so caller can imperatively dismiss if needed.

toastSuccess(message, duration?)  // shorthand
toastError(message, duration?)
toastWarn(message, duration?)
toastInfo(message, duration?)
```

### `empty-states.js`

```js
renderEmptyState(opts)
// opts: {
//   icon: 'inbox' | 'folder' | 'document' | 'sprint' | 'kanban' | 'link' | 'attachment' | 'search' | 'check' | 'spark'
//   title: string
//   body?: string
//   actionLabel?: string
//   actionOnClick?: string  (inline JS, e.g. "openCreateProject()")
// }
// Returns an HTML string ready to drop into innerHTML.

EMPTY_STATE_ICONS  // exported map of icon name → inline SVG string
```

---

## Subagent decomposition

- **Subagent A (new modules):** Read this handoff. Write `public/markdown-toolbar.js`, `public/toasts.js`, `public/empty-states.js`. Each is self-contained, exposes globals on `window`, mirrors the style of existing modules (notifications-ui.js, integrations-ui.js).

- **Subagent B (sweep + wire):** Read this handoff + every existing public/*.js file. Do TWO sweeps:
  1. **alert() audit:** find every `alert(...)` call site across `public/*.js`. Replace each with the appropriate `toast(...)` call. Most error alerts become `toastError(...)`; success messages become `toastSuccess(...)`; informational become `toastInfo(...)`. Be conservative — only convert `alert()`, leave `confirm()` alone.
  2. **Markdown toolbar wiring:** find every place where a markdown textarea is rendered (issue desc edit mode, comment composer, doc page editor, sprint goal modal, project description modal, contact note input). After the textarea is in the DOM (typically after a `setModal` setTimeout), call `attachMarkdownToolbar(textareaEl)`.
  3. **Empty state replacements:** find every `<div class="empty">...</div>` and `<p>...</p>` style empty state. Replace with calls to `renderEmptyState({...})` from empty-states.js. Be selective — only replace meaningful empty states (the user-facing ones), not the "loading" placeholders.

- **Subagent C (CSS + mobile sweep):** Read this handoff + the existing dashboard.css. Two jobs:
  1. **Append a Sprint 7 CSS block** with all classes for `.md-toolbar`, `.md-toolbar-btn`, `.toast-stack`, `.toast`, `.toast.success/.error/.warn/.info`, `.empty-state`, `.empty-state-icon`, `.empty-state-title`, `.empty-state-body`, `.empty-state-action`. Use existing theme tokens.
  2. **Mobile sweep:** audit the existing CSS at 360px and 760px breakpoints. Find and fix horizontal overflow, broken modals, narrow tables that need scroll wrappers, anything that looks visibly busted. Check at minimum: Overview, Projects, Project detail, Issue detail modal, Tasks Board (kanban), Backlog tab, Sprints tab, Burndown modal, Spaces, Page view, Page editor, Account, Users, Integrations, Feature visibility, Pipeline, Follow-ups. Document each fix in the report. Don't try to perfect mobile UX — just fix the broken things.

- **Main thread:** Branch + handoff (done). Add three script tags to index.html. Verify all files parse. Deploy. Smoke test mobile via curl + DevTools.

---

## Acceptance criteria

- [ ] Three new modules written and parse cleanly
- [ ] Every `alert(...)` call site in `public/*.js` is replaced with a `toast(...)` call (subagent B should report a count)
- [ ] Markdown toolbar appears above the textarea on: issue description editor, issue comment composer, doc page editor, sprint goal field, project description field, contact note field
- [ ] Clicking each toolbar button correctly wraps/inserts at the cursor and restores focus
- [ ] Empty states across Inbox, Projects, Issues, Sprints, Spaces, Pages, Backlog, Board, Attachments, Links all use `renderEmptyState`
- [ ] At 360px viewport, every section is usable (no horizontal page-scroll, modals fit, tables scroll where needed)
- [ ] At 760px viewport, layouts collapse cleanly (sidebar→tabbar, two-col→one-col)
- [ ] Toggle to light theme — every new component renders correctly
- [ ] All frontend files parse with `node --check`
- [ ] No backend changes (worker.js untouched)
- [ ] No new D1 migrations

---

## Out of scope

- Drag-to-reorder doc pages (Sprint 8 maybe)
- Page version diff view
- Daily digest cron
- Story points / velocity
- Login rate-limiting / CSP headers
- Self-host CDN scripts
- Keyboard shortcuts (`g i` / `c` / etc)
- Toast dedup / grouping
- Markdown toolbar keyboard shortcuts (Cmd+B etc)
- WYSIWYG anything
- Image upload via toolbar (use the attachments panel)
- Real router for deep links
- Accessibility audit beyond the obvious (focus rings, aria-live for toasts)

---

## Reference reads

- `handoffs/sprint-6-attachments-features.md` — most recent format
- `public/notifications-ui.js`, `public/integrations-ui.js`, `public/feature-settings-ui.js` — module style to mirror
- `public/dashboard.css` — theme tokens, existing utility classes, existing media queries (for mobile sweep)
- All other `public/*.js` files — for the alert() audit
- `public/index.html` — where to add the script tags (after the existing Sprint 6 ones)

---

## Expected commit log

```
feat(polish): markdown toolbar + toasts + empty states + mobile sweep (Sprint 7)
```
