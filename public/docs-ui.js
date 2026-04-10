// ============================================================
// Totally Wild AI — Docs UI (Sprint 4)
// Frontend for the Docs module (spaces + pages + version
// history). Loaded as a regular <script> tag after tasks-ui.js
// and sprints-ui.js, so it freely uses the globals defined there
// and in app.js: state, api(), esc(), setModal(), closeModal(),
// currentSection, nav(), renderMarkdown(), relTime().
// Wired into app.js's renderSection() switch by the integration
// step (this file does not touch app.js itself).
// ============================================================

(function () {
  if (!state.ui.docsSpaceId) state.ui.docsSpaceId = '';
  if (!state.ui.docsPageId) state.ui.docsPageId = '';
  if (!state.ui.docsExpandedPages) state.ui.docsExpandedPages = {};
  if (!('docsEditing' in state.ui)) state.ui.docsEditing = false;
  if (!state.ui.docsDraft) state.ui.docsDraft = null;
  state.docs = state.docs || {};
  state.docs.spaces = state.docs.spaces || [];
  state.docs.space = state.docs.space || null;
  state.docs.pages = state.docs.pages || [];
  state.docs.page = state.docs.page || null;
  state.docs.versions = state.docs.versions || [];
})();

// ── Role helpers ──────────────────────────────────────────────
function docsCanWrite() { return state.me && state.me.role !== 'viewer'; }
function docsIsAdmin()  { return state.me && state.me.role === 'admin'; }
window.docsCanWrite = docsCanWrite;
window.docsIsAdmin = docsIsAdmin;

// ── Tree builder ──────────────────────────────────────────────
// Converts the flat pages array (ordered parent_id NULLS FIRST,
// then position, then title) into a nested structure. Returns
// the top-level pages with `children` attached recursively.
function buildPageTree(pages) {
  const byId = {};
  const roots = [];
  const list = Array.isArray(pages) ? pages : [];
  for (const p of list) {
    byId[p.id] = Object.assign({}, p, { children: [] });
  }
  for (const p of list) {
    const node = byId[p.id];
    if (p.parent_id && byId[p.parent_id]) {
      byId[p.parent_id].children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
window.buildPageTree = buildPageTree;

// ── Section dispatch ──────────────────────────────────────────
async function renderDocsSection() {
  const c = document.getElementById('content');
  if (!c) return;
  try {
    if (!state.ui.docsSpaceId) {
      await loadSpaces();
      renderSpacesList();
      return;
    }
    // A space is selected. Load it (if not already in memory for this id).
    if (!state.docs.space || state.docs.space.id !== state.ui.docsSpaceId) {
      await loadSpace(state.ui.docsSpaceId);
    }
    if (!state.ui.docsPageId) {
      renderSpaceHome();
      return;
    }
    // A page is selected — load it and render.
    await loadPage(state.ui.docsPageId);
    renderPage();
  } catch (err) {
    c.innerHTML = `<div class="empty"><p>Failed to load docs: ${esc(err && err.message || String(err))}</p></div>`;
  }
}
window.renderDocsSection = renderDocsSection;

// ── Spaces list ───────────────────────────────────────────────
async function loadSpaces() {
  const r = await api('GET', '/api/doc-spaces');
  state.docs.spaces = (r && Array.isArray(r.spaces)) ? r.spaces : [];
}
window.loadSpaces = loadSpaces;

function docsSpaceIconHTML(space) {
  const icon = (space && space.icon) ? String(space.icon) : '';
  if (icon) return `<span class="docs-space-icon">${esc(icon)}</span>`;
  const name = (space && space.name) ? String(space.name) : '?';
  return `<span class="docs-space-icon">${esc(name.charAt(0).toUpperCase() || '?')}</span>`;
}

function renderSpacesList() {
  const c = document.getElementById('content');
  const canWrite = docsCanWrite();
  const cards = (state.docs.spaces || []).map(s => {
    const count = Number(s.page_count || 0);
    return `
      <div class="card docs-space-card" onclick="openSpace('${esc(s.id)}')" style="cursor:pointer">
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:12px">
            ${docsSpaceIconHTML(s)}
            <div style="min-width:0;flex:1">
              <div class="mono text-sm text-muted">${esc(s.key)}</div>
              <div style="font-size:16px;font-weight:600;margin-top:2px">${esc(s.name)}</div>
            </div>
          </div>
          <div class="text-muted text-sm" style="margin-top:12px">${count} page${count===1?'':'s'}</div>
        </div>
      </div>
    `;
  }).join('');
  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div class="page-actions">
        ${canWrite ? '<button class="btn btn-primary" type="button" onclick="openCreateSpace()">+ New space</button>' : ''}
      </div>
      <div class="docs-spaces-grid">
        ${cards || '<div class="empty empty-state-large"><p>No spaces yet.</p>' + (canWrite ? '<p class="text-muted text-sm">Create your first space to get started.</p>' : '') + '</div>'}
      </div>
    </div>
  `;
}
window.renderSpacesList = renderSpacesList;

// ── Create space modal ───────────────────────────────────────
function openCreateSpace() {
  setModal(`
    <div class="modal-head"><div class="modal-title">New space</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Space key (2–10 uppercase letters)</label>
      <input id="ns-key" type="text" placeholder="ENG" maxlength="10" autofocus oninput="this.value=this.value.toUpperCase()" onblur="this.value=this.value.toUpperCase()">
      <label style="margin-top:10px">Name</label>
      <input id="ns-name" type="text" placeholder="Engineering">
      <label style="margin-top:10px">Icon (emoji or single character, optional)</label>
      <input id="ns-icon" type="text" placeholder="🛠" maxlength="4">
      <label style="margin-top:10px">Description (Markdown, optional)</label>
      <textarea id="ns-desc" rows="5" placeholder="What lives in this space?"></textarea>
      <div class="form-msg" id="ns-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitCreateSpace()">Create space</button>
    </div>
  `);
}
window.openCreateSpace = openCreateSpace;

async function submitCreateSpace() {
  const key = (document.getElementById('ns-key').value || '').trim().toUpperCase();
  const name = (document.getElementById('ns-name').value || '').trim();
  const icon = (document.getElementById('ns-icon').value || '').trim();
  const description_md = document.getElementById('ns-desc').value || '';
  const msg = document.getElementById('ns-msg');
  msg.className = 'form-msg';
  if (!key || key.length < 2) { msg.textContent = 'Key must be at least 2 characters'; msg.classList.add('form-msg-err'); return; }
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) { msg.textContent = 'Key must be 2–10 uppercase letters/digits'; msg.classList.add('form-msg-err'); return; }
  if (!name) { msg.textContent = 'Name is required'; msg.classList.add('form-msg-err'); return; }
  const r = await api('POST', '/api/doc-spaces', { key, name, icon, description_md });
  if (r && (r.id || r.space)) {
    closeModal();
    await loadSpaces();
    renderSpacesList();
  } else {
    msg.textContent = (r && r.error) || 'Failed to create space';
    msg.classList.add('form-msg-err');
  }
}
window.submitCreateSpace = submitCreateSpace;

// ── Open / load space ─────────────────────────────────────────
function openSpace(spaceId) {
  state.ui.docsSpaceId = spaceId;
  state.ui.docsPageId = '';
  state.ui.docsEditing = false;
  state.ui.docsDraft = null;
  state.docs.page = null;
  // Reset expansion state when switching spaces so auto-expand re-runs.
  state.ui.docsExpandedPages = {};
  nav('docs');
}
window.openSpace = openSpace;

async function loadSpace(spaceId) {
  const r = await api('GET', `/api/doc-spaces/${encodeURIComponent(spaceId)}`);
  if (r && r.space) {
    state.docs.space = r.space;
    state.docs.pages = Array.isArray(r.pages) ? r.pages : [];
    // Auto-expand all top-level pages on first load.
    const hasExpansion = state.ui.docsExpandedPages && Object.keys(state.ui.docsExpandedPages).length > 0;
    if (!hasExpansion) {
      const exp = {};
      for (const p of state.docs.pages) {
        if (!p.parent_id) exp[p.id] = true;
      }
      state.ui.docsExpandedPages = exp;
    }
  } else {
    state.docs.space = null;
    state.docs.pages = [];
    throw new Error((r && r.error) || 'Failed to load space');
  }
}
window.loadSpace = loadSpace;

function backToSpaces() {
  state.ui.docsSpaceId = '';
  state.ui.docsPageId = '';
  state.ui.docsEditing = false;
  state.ui.docsDraft = null;
  state.docs.space = null;
  state.docs.pages = [];
  state.docs.page = null;
  state.ui.docsExpandedPages = {};
  nav('docs');
}
window.backToSpaces = backToSpaces;

// ── Page tree sidebar ─────────────────────────────────────────
function renderPageTreeHTML(tree, depth) {
  const canWrite = docsCanWrite();
  if (!tree || !tree.length) {
    if (depth === 0) {
      return '<li class="docs-tree-empty text-muted text-sm" style="padding:8px 10px">No pages yet.</li>';
    }
    return '';
  }
  return tree.map(node => {
    const hasChildren = node.children && node.children.length > 0;
    const expanded = !!state.ui.docsExpandedPages[node.id];
    const active = state.ui.docsPageId === node.id;
    const pad = 8 + depth * 14;
    const chevron = hasChildren
      ? `<button class="chevron" type="button" onclick="event.stopPropagation();toggleDocsExpand('${esc(node.id)}')" aria-label="${expanded ? 'Collapse' : 'Expand'}">${expanded ? '▾' : '▸'}</button>`
      : '<span class="chevron chevron-empty" aria-hidden="true"></span>';
    const addBtn = canWrite
      ? `<button class="docs-tree-add" type="button" title="Add child page" onclick="event.stopPropagation();openCreatePage('${esc(node.id)}')">+</button>`
      : '';
    const childrenHTML = (hasChildren && expanded)
      ? `<ul class="docs-tree-children">${renderPageTreeHTML(node.children, depth + 1)}</ul>`
      : '';
    return `
      <li class="docs-tree-item ${active ? 'active' : ''}" data-page-id="${esc(node.id)}">
        <div class="docs-tree-row" style="padding-left:${pad}px" onclick="openDocsPage('${esc(node.id)}')">
          ${chevron}
          <a class="docs-tree-link" onclick="event.stopPropagation();openDocsPage('${esc(node.id)}')">${esc(node.title)}</a>
          ${addBtn}
        </div>
        ${childrenHTML}
      </li>
    `;
  }).join('');
}
window.renderPageTreeHTML = renderPageTreeHTML;

function toggleDocsExpand(pageId) {
  state.ui.docsExpandedPages[pageId] = !state.ui.docsExpandedPages[pageId];
  // Re-render only the sidebar tree in place if possible, otherwise
  // fall back to full section re-render. For simplicity, re-render the
  // whole section — it's cheap and matches tasks-ui.js patterns.
  if (state.ui.docsPageId) {
    renderPage();
  } else {
    renderSpaceHome();
  }
}
window.toggleDocsExpand = toggleDocsExpand;

function renderDocsSidebarHTML() {
  const space = state.docs.space;
  if (!space) return '';
  const tree = buildPageTree(state.docs.pages);
  const canWrite = docsCanWrite();
  return `
    <aside class="docs-sidebar">
      <div style="padding:10px 12px 6px">
        <button class="btn btn-ghost btn-sm" type="button" onclick="backToSpaces()">← All spaces</button>
      </div>
      <div class="docs-sidebar-header" style="padding:8px 12px 12px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px">
          ${docsSpaceIconHTML(space)}
          <div style="min-width:0;flex:1">
            <div class="mono text-sm text-muted">${esc(space.key)}</div>
            <div style="font-weight:600">${esc(space.name)}</div>
          </div>
        </div>
        ${canWrite ? `<button class="icon-btn icon-btn-ghost" type="button" title="New top-level page" style="margin-top:8px" onclick="openCreatePage('')"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5z" fill="currentColor"/></svg></button>` : ''}
      </div>
      <ul class="docs-tree">
        ${renderPageTreeHTML(tree, 0)}
      </ul>
    </aside>
  `;
}
window.renderDocsSidebarHTML = renderDocsSidebarHTML;

// ── Space home (no page selected) ────────────────────────────
function renderSpaceHome() {
  const c = document.getElementById('content');
  const space = state.docs.space;
  if (!space) {
    c.innerHTML = '<div class="empty"><p>Space not found.</p><button class="btn btn-ghost" type="button" onclick="backToSpaces()">← All spaces</button></div>';
    return;
  }
  const canWrite = docsCanWrite();
  const isAdmin = docsIsAdmin();
  const tree = buildPageTree(state.docs.pages);
  const topLevel = tree; // roots
  const topLevelCards = topLevel.map(p => `
    <div class="card docs-space-card" style="cursor:pointer" onclick="openDocsPage('${esc(p.id)}')">
      <div class="card-body">
        <div style="font-weight:600">${esc(p.title)}</div>
        <div class="text-muted text-sm" style="margin-top:6px">
          ${p.updated_by_name ? esc(p.updated_by_name) + ' · ' : ''}${esc(relTime(p.updated_at))}
          ${(p.children && p.children.length) ? ` · ${p.children.length} child page${p.children.length===1?'':'s'}` : ''}
        </div>
      </div>
    </div>
  `).join('');
  const descHTML = space.description_md
    ? `<div class="md-body">${renderMarkdown(space.description_md)}</div>`
    : '<p class="text-muted">No description yet.</p>';
  c.innerHTML = `
    <div class="docs-layout">
      ${renderDocsSidebarHTML()}
      <main class="docs-main">
        <div class="docs-page-header">
          <div class="docs-breadcrumb">
            <a onclick="backToSpaces()" style="cursor:pointer">Spaces</a>
            <span> › </span>
            <span>${esc(space.key)}</span>
          </div>
          <h1 class="docs-page-title" style="display:flex;align-items:center;gap:10px">
            ${docsSpaceIconHTML(space)}
            <span>${esc(space.name)}</span>
          </h1>
          <div class="docs-page-actions">
            ${canWrite ? '<button class="btn btn-primary" type="button" onclick="openCreatePage(\'\')">+ New page</button>' : ''}
            ${isAdmin ? '<button class="btn btn-ghost btn-sm" type="button" onclick="confirmDeleteSpace()">Delete space</button>' : ''}
          </div>
        </div>
        <div style="margin-top:18px">
          ${descHTML}
        </div>
        <div class="docs-children-list" style="margin-top:28px">
          <div class="issue-section-label" style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted2);margin-bottom:10px">Top-level pages</div>
          ${topLevelCards || '<div class="empty"><p>No pages yet.</p>' + (canWrite ? '<p class="text-muted text-sm">Click “+ New page” to create the first one.</p>' : '') + '</div>'}
        </div>
      </main>
    </div>
  `;
}
window.renderSpaceHome = renderSpaceHome;

// ── Page view ─────────────────────────────────────────────────
async function loadPage(pageId) {
  const r = await api('GET', `/api/doc-pages/${encodeURIComponent(pageId)}`);
  if (!r || !r.page) {
    state.docs.page = null;
    throw new Error((r && r.error) || 'Failed to load page');
  }
  state.docs.page = r.page;
  // If the page is in a different space than what we have loaded, refresh.
  if (r.space && state.docs.space && r.space.id !== state.docs.space.id) {
    state.ui.docsSpaceId = r.space.id;
    await loadSpace(r.space.id);
  } else if (!state.docs.space && r.space) {
    state.ui.docsSpaceId = r.space.id;
    await loadSpace(r.space.id);
  }
  // Stash children for the footer.
  state.docs.page._children = Array.isArray(r.children) ? r.children : [];
  state.docs.page._parent = r.parent || null;
  state.docs.page._versionCount = Number(r.version_count || 0);
}
window.loadPage = loadPage;

function openDocsPage(pageId) {
  state.ui.docsPageId = pageId;
  state.ui.docsEditing = false;
  state.ui.docsDraft = null;
  // Ensure the path to this page is expanded so it's visible in the tree.
  const byId = {};
  for (const p of state.docs.pages || []) byId[p.id] = p;
  let cur = byId[pageId];
  while (cur && cur.parent_id) {
    state.ui.docsExpandedPages[cur.parent_id] = true;
    cur = byId[cur.parent_id];
  }
  nav('docs');
}
window.openDocsPage = openDocsPage;

function buildBreadcrumbHTML(page) {
  const space = state.docs.space;
  const parts = [];
  parts.push(`<a onclick="backToSpaces()" style="cursor:pointer">Spaces</a>`);
  if (space) {
    parts.push(`<a onclick="openSpace('${esc(space.id)}')" style="cursor:pointer">${esc(space.key)}</a>`);
  }
  // Walk up via parent_id using the flat pages array so we can stitch
  // together ancestry even when the cached page object only has the
  // immediate parent.
  const byId = {};
  for (const p of state.docs.pages || []) byId[p.id] = p;
  const chain = [];
  let cur = page && page.parent_id ? byId[page.parent_id] : null;
  let guard = 0;
  while (cur && guard < 20) {
    chain.unshift(cur);
    cur = cur.parent_id ? byId[cur.parent_id] : null;
    guard++;
  }
  for (const anc of chain) {
    parts.push(`<a onclick="openDocsPage('${esc(anc.id)}')" style="cursor:pointer">${esc(anc.title)}</a>`);
  }
  parts.push(`<span>${esc(page.title)}</span>`);
  return parts.join(' <span class="docs-breadcrumb-sep">›</span> ');
}

function renderPage() {
  const c = document.getElementById('content');
  const page = state.docs.page;
  const space = state.docs.space;
  if (!page || !space) {
    c.innerHTML = '<div class="empty"><p>Page not found.</p><button class="btn btn-ghost" type="button" onclick="backToSpaces()">← All spaces</button></div>';
    return;
  }
  const canWrite = docsCanWrite();
  const editing = !!state.ui.docsEditing;
  const mainHTML = editing ? renderPageEditorHTML(page) : renderPageViewHTML(page, canWrite);
  c.innerHTML = `
    <div class="docs-layout">
      ${renderDocsSidebarHTML()}
      <main class="docs-main">
        ${mainHTML}
      </main>
    </div>
  `;
  // Focus the editor textarea when entering edit mode for a smoother UX.
  if (editing) {
    const ta = document.getElementById('docs-editor-textarea');
    if (ta) {
      try { ta.focus(); } catch (e) { /* ignore */ }
      // Wire @mention autocomplete (notifications-ui.js owns the helper).
      if (typeof attachMentionAutocomplete === 'function') attachMentionAutocomplete(ta);
      // Sprint 7: markdown toolbar
      if (typeof attachMarkdownToolbar === 'function') attachMarkdownToolbar(ta);
    }
  }
  // Render any mermaid diagrams in the page body or preview.
  if (typeof renderMermaidDiagrams === 'function') setTimeout(renderMermaidDiagrams, 0);
  // Sprint 6: render the linked items panel below the page (view mode only).
  if (!editing && page && page.id) {
    setTimeout(() => {
      const lnEl = document.getElementById('page-links-panel');
      if (lnEl && typeof renderLinksPanel === 'function') {
        renderLinksPanel(lnEl, 'doc_page', page.id);
      }
    }, 0);
  }
}
window.renderPage = renderPage;

function renderPageViewHTML(page, canWrite) {
  const children = (page._children || []);
  const versionCount = Number(page._versionCount || 0);
  const childrenHTML = children.length
    ? `<ul class="docs-children-links">${children.map(ch => `<li><a onclick="openDocsPage('${esc(ch.id)}')" style="cursor:pointer">${esc(ch.title)}</a></li>`).join('')}</ul>`
    : '';
  const updatedLine = `${page.updated_by_name ? esc(page.updated_by_name) + ' · ' : ''}updated ${esc(relTime(page.updated_at))}${versionCount ? ' · ' + versionCount + ' version' + (versionCount===1?'':'s') : ''}`;
  return `
    <div class="docs-page-header">
      <div class="docs-breadcrumb">${buildBreadcrumbHTML(page)}</div>
      <h1 class="docs-page-title">${esc(page.title)}</h1>
      <div class="text-muted text-sm" style="margin-top:4px">${updatedLine}</div>
      <div class="docs-page-actions" style="margin-top:12px">
        ${canWrite ? '<button class="btn btn-primary btn-sm" type="button" onclick="startEditPage()">Edit</button>' : ''}
        <button class="btn btn-ghost btn-sm" type="button" onclick="openVersionHistory()">Version history${versionCount ? ' (' + versionCount + ')' : ''}</button>
        ${canWrite ? '<button class="btn btn-ghost btn-sm" type="button" onclick="openCreatePage(\'' + esc(page.id) + '\')">+ Add child</button>' : ''}
        ${canWrite ? '<button class="btn btn-ghost btn-sm" type="button" onclick="confirmDeletePage()">Delete</button>' : ''}
      </div>
    </div>
    <div class="md-body docs-page-body" style="margin-top:18px">
      ${page.content_md ? renderMarkdown(page.content_md) : '<p class="text-muted">This page is empty. Click Edit to add content.</p>'}
    </div>
    ${childrenHTML ? `
      <div class="docs-children-list" style="margin-top:28px">
        <div class="issue-section-label" style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted2);margin-bottom:10px">Child pages</div>
        ${childrenHTML}
      </div>
    ` : ''}
    <div id="page-links-panel" style="margin-top:28px"></div>
  `;
}

function renderPageEditorHTML(page) {
  const draft = state.ui.docsDraft || { title: page.title, content_md: page.content_md };
  const previewHTML = draft.content_md
    ? renderMarkdown(draft.content_md)
    : '<p class="text-muted">Preview will appear here as you type.</p>';
  return `
    <div class="docs-page-header">
      <div class="docs-breadcrumb">${buildBreadcrumbHTML(page)}</div>
      <input id="docs-editor-title" class="docs-editor-title" type="text" value="${esc(draft.title || '')}" oninput="onEditorTitleInput(this.value)" placeholder="Page title" style="width:100%;font-size:24px;font-weight:700;padding:8px 10px;margin-top:4px">
      <div class="form-msg" id="docs-editor-msg" style="margin-top:8px"></div>
    </div>
    <div class="docs-editor" style="margin-top:14px">
      <div class="docs-editor-pane docs-editor-textarea-pane">
        <div class="docs-editor-label text-muted text-sm" style="margin-bottom:4px">Markdown</div>
        <textarea id="docs-editor-textarea" class="docs-editor-textarea" oninput="onEditorContentInput(this.value)" onkeydown="onEditorTabKey(event)" spellcheck="true" placeholder="Write markdown here...">${esc(draft.content_md || '')}</textarea>
      </div>
      <div class="docs-editor-pane docs-editor-preview-pane">
        <div class="docs-editor-label text-muted text-sm" style="margin-bottom:4px">Preview</div>
        <div id="docs-editor-preview" class="md-body docs-editor-preview">${previewHTML}</div>
      </div>
    </div>
    <div class="docs-editor-actions" style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-ghost" type="button" onclick="cancelEditPage()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="saveEditPage()">Save</button>
    </div>
  `;
}

// Editor input handlers — keep state in sync without a full re-render
// so the textarea doesn't lose focus/selection on every keystroke.
function onEditorTitleInput(value) {
  if (!state.ui.docsDraft) state.ui.docsDraft = { title: '', content_md: '' };
  state.ui.docsDraft.title = value;
}
window.onEditorTitleInput = onEditorTitleInput;

function onEditorContentInput(value) {
  if (!state.ui.docsDraft) state.ui.docsDraft = { title: '', content_md: '' };
  state.ui.docsDraft.content_md = value;
  const preview = document.getElementById('docs-editor-preview');
  if (preview) {
    preview.innerHTML = value ? renderMarkdown(value) : '<p class="text-muted">Preview will appear here as you type.</p>';
    if (typeof renderMermaidDiagrams === 'function') renderMermaidDiagrams();
  }
}
window.onEditorContentInput = onEditorContentInput;

function onEditorTabKey(ev) {
  if (ev.key !== 'Tab') return;
  ev.preventDefault();
  const t = ev.target;
  const start = t.selectionStart;
  const end = t.selectionEnd;
  t.value = t.value.slice(0, start) + '  ' + t.value.slice(end);
  t.selectionStart = t.selectionEnd = start + 2;
  if (!state.ui.docsDraft) state.ui.docsDraft = { title: '', content_md: '' };
  state.ui.docsDraft.content_md = t.value;
  const preview = document.getElementById('docs-editor-preview');
  if (preview) preview.innerHTML = renderMarkdown(t.value);
}
window.onEditorTabKey = onEditorTabKey;

// ── Edit mode transitions ─────────────────────────────────────
function startEditPage() {
  const page = state.docs.page;
  if (!page) return;
  state.ui.docsEditing = true;
  state.ui.docsDraft = { title: page.title || '', content_md: page.content_md || '' };
  renderPage();
}
window.startEditPage = startEditPage;

function cancelEditPage() {
  state.ui.docsEditing = false;
  state.ui.docsDraft = null;
  renderPage();
}
window.cancelEditPage = cancelEditPage;

async function saveEditPage() {
  const page = state.docs.page;
  if (!page) return;
  const draft = state.ui.docsDraft || {};
  const title = (draft.title || '').trim();
  const content_md = draft.content_md != null ? draft.content_md : '';
  const msg = document.getElementById('docs-editor-msg');
  if (msg) msg.className = 'form-msg';
  if (!title) {
    if (msg) { msg.textContent = 'Title is required'; msg.classList.add('form-msg-err'); }
    return;
  }
  const r = await api('PATCH', `/api/doc-pages/${encodeURIComponent(page.id)}`, { title, content_md });
  if (!r || r.error) {
    if (msg) { msg.textContent = (r && r.error) || 'Failed to save'; msg.classList.add('form-msg-err'); }
    return;
  }
  // Backend returns either {ok, unchanged:true} or the full getPage envelope.
  if (r.unchanged) {
    state.ui.docsEditing = false;
    state.ui.docsDraft = null;
    renderPage();
    return;
  }
  if (r.page) {
    state.docs.page = r.page;
    state.docs.page._children = Array.isArray(r.children) ? r.children : [];
    state.docs.page._parent = r.parent || null;
    state.docs.page._versionCount = Number(r.version_count || 0);
    // Refresh the space pages list so the sidebar tree reflects title changes.
    await loadSpace(state.ui.docsSpaceId);
  }
  state.ui.docsEditing = false;
  state.ui.docsDraft = null;
  renderPage();
}
window.saveEditPage = saveEditPage;

// ── Create page modal ────────────────────────────────────────
function openCreatePage(parentId) {
  const space = state.docs.space;
  if (!space) return;
  const parent = parentId ? (state.docs.pages || []).find(p => p.id === parentId) : null;
  const parentLabel = parent ? ` under “${esc(parent.title)}”` : '';
  setModal(`
    <div class="modal-head"><div class="modal-title">New page${parentLabel}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Title</label>
      <input id="np-title" type="text" autofocus placeholder="Page title">
      <div class="form-msg" id="np-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitCreatePage('${esc(parentId || '')}')">Create page</button>
    </div>
  `);
  // Enter submits.
  setTimeout(() => {
    const el = document.getElementById('np-title');
    if (el) {
      el.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') submitCreatePage(parentId || '');
      });
    }
  }, 0);
}
window.openCreatePage = openCreatePage;

async function submitCreatePage(parentId) {
  const space = state.docs.space;
  if (!space) return;
  const title = (document.getElementById('np-title').value || '').trim();
  const msg = document.getElementById('np-msg');
  if (msg) msg.className = 'form-msg';
  if (!title) {
    if (msg) { msg.textContent = 'Title is required'; msg.classList.add('form-msg-err'); }
    return;
  }
  const body = { title, parent_id: parentId || null };
  const r = await api('POST', `/api/doc-spaces/${encodeURIComponent(space.id)}/pages`, body);
  if (!r || r.error || !(r.id || r.page)) {
    if (msg) { msg.textContent = (r && r.error) || 'Failed to create page'; msg.classList.add('form-msg-err'); }
    return;
  }
  const newId = r.id || (r.page && r.page.id);
  closeModal();
  await loadSpace(space.id);
  if (parentId) state.ui.docsExpandedPages[parentId] = true;
  state.ui.docsPageId = newId;
  // Jump straight into edit mode.
  try {
    await loadPage(newId);
    state.ui.docsEditing = true;
    state.ui.docsDraft = { title: state.docs.page.title || '', content_md: state.docs.page.content_md || '' };
    renderPage();
  } catch (err) {
    renderSpaceHome();
  }
}
window.submitCreatePage = submitCreatePage;

// ── Delete page / space ──────────────────────────────────────
async function confirmDeletePage() {
  const page = state.docs.page;
  if (!page) return;
  if (!confirm(`Delete this page and all its children?\n\n“${page.title}”\n\nThis is reversible by re-activating the row in the database.`)) return;
  const r = await api('DELETE', `/api/doc-pages/${encodeURIComponent(page.id)}`);
  if (r && r.ok) {
    state.ui.docsPageId = '';
    state.ui.docsEditing = false;
    state.ui.docsDraft = null;
    state.docs.page = null;
    await loadSpace(state.ui.docsSpaceId);
    renderSpaceHome();
  } else {
    toastError((r && r.error) || 'Failed to delete page');
  }
}
window.confirmDeletePage = confirmDeletePage;

async function confirmDeleteSpace() {
  if (!docsIsAdmin()) return;
  const space = state.docs.space;
  if (!space) return;
  if (!confirm(`Delete space ${space.key} (${space.name})?\n\nAll pages in this space will be soft-deleted. This is reversible by re-activating the space row in the database.`)) return;
  const r = await api('DELETE', `/api/doc-spaces/${encodeURIComponent(space.id)}`);
  if (r && r.ok) {
    state.ui.docsSpaceId = '';
    state.ui.docsPageId = '';
    state.docs.space = null;
    state.docs.pages = [];
    state.docs.page = null;
    state.ui.docsExpandedPages = {};
    await loadSpaces();
    renderSpacesList();
  } else {
    toastError((r && r.error) || 'Failed to delete space');
  }
}
window.confirmDeleteSpace = confirmDeleteSpace;

// ── Version history ──────────────────────────────────────────
async function openVersionHistory() {
  const page = state.docs.page;
  if (!page) return;
  // Show a loading modal while we fetch.
  setModal(`
    <div class="modal-head"><div class="modal-title">Version history — ${esc(page.title)}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body"><p class="text-muted">Loading…</p></div>
  `);
  const r = await api('GET', `/api/doc-pages/${encodeURIComponent(page.id)}/versions`);
  state.docs.versions = (r && Array.isArray(r.versions)) ? r.versions : [];
  renderVersionHistoryModal();
}
window.openVersionHistory = openVersionHistory;

function renderVersionHistoryModal() {
  const page = state.docs.page;
  if (!page) return;
  const canWrite = docsCanWrite();
  const rows = (state.docs.versions || []).map((v, idx) => {
    const author = v.author_name || '—';
    const when = relTime(v.created_at);
    const label = idx === 0 ? ' <span class="text-muted text-sm">(most recent)</span>' : '';
    return `
      <div class="docs-version-row">
        <div class="docs-version-meta">
          <div><strong>${esc(v.title || page.title)}</strong>${label}</div>
          <div class="text-muted text-sm">${esc(author)} · ${esc(when)}</div>
        </div>
        <div class="docs-version-actions">
          <button class="btn btn-ghost btn-sm" type="button" onclick="previewVersion('${esc(v.id)}')">Preview</button>
          ${canWrite ? `<button class="btn btn-ghost btn-sm" type="button" onclick="confirmRestoreVersion('${esc(v.id)}')">Restore</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
  setModal(`
    <div class="modal-head"><div class="modal-title">Version history — ${esc(page.title)}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body" style="max-height:70vh;overflow:auto;min-width:min(720px,92vw)">
      ${rows || '<div class="empty"><p>No versions yet.</p></div>'}
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Close</button>
    </div>
  `);
}
window.renderVersionHistoryModal = renderVersionHistoryModal;

async function previewVersion(versionId) {
  const page = state.docs.page;
  if (!page) return;
  setModal(`
    <div class="modal-head"><div class="modal-title">Loading version…</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body"><p class="text-muted">Loading…</p></div>
  `);
  const r = await api('GET', `/api/doc-pages/${encodeURIComponent(page.id)}/versions/${encodeURIComponent(versionId)}`);
  // Backend wraps in {version: {...}}.
  const v = r && r.version ? r.version : null;
  if (!v) {
    setModal(`
      <div class="modal-head"><div class="modal-title">Version not found</div>
        <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
      <div class="modal-body"><p>${esc((r && r.error) || 'Failed to load version')}</p></div>
      <div class="modal-foot"><button class="btn btn-ghost" type="button" onclick="renderVersionHistoryModal()">Back to versions</button></div>
    `);
    return;
  }
  const canWrite = docsCanWrite();
  setModal(`
    <div class="modal-head"><div class="modal-title">Version preview — ${esc(v.title || page.title)}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body" style="max-height:72vh;overflow:auto;min-width:min(760px,92vw)">
      <div class="text-muted text-sm" style="margin-bottom:10px">
        ${esc(v.author_name || '—')} · ${esc(relTime(v.created_at))}
      </div>
      <div class="md-body">${v.content_md ? renderMarkdown(v.content_md) : '<p class="text-muted">(empty)</p>'}</div>
    </div>
    <div class="modal-foot" style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap">
      <button class="btn btn-ghost" type="button" onclick="renderVersionHistoryModal()">← Back to versions</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" type="button" onclick="closeModal()">Close</button>
        ${canWrite ? `<button class="btn btn-primary" type="button" onclick="confirmRestoreVersion('${esc(v.id)}')">Restore this version</button>` : ''}
      </div>
    </div>
  `);
}
window.previewVersion = previewVersion;

async function confirmRestoreVersion(versionId) {
  const page = state.docs.page;
  if (!page) return;
  if (!confirm('Restore this version? Current content will be saved as a new version first, so the restore is reversible.')) return;
  const r = await api('POST', `/api/doc-pages/${encodeURIComponent(page.id)}/versions/${encodeURIComponent(versionId)}/restore`);
  if (!r || r.error || !r.page) {
    toastError((r && r.error) || 'Failed to restore version');
    return;
  }
  state.docs.page = r.page;
  state.docs.page._children = Array.isArray(r.children) ? r.children : [];
  state.docs.page._parent = r.parent || null;
  state.docs.page._versionCount = Number(r.version_count || 0);
  await loadSpace(state.ui.docsSpaceId);
  closeModal();
  state.ui.docsEditing = false;
  state.ui.docsDraft = null;
  renderPage();
}
window.confirmRestoreVersion = confirmRestoreVersion;
