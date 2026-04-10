// ============================================================
// Totally Wild AI — Global search (topbar)
// Debounced search across issues, doc pages, contacts, projects.
// Loaded as a <script> tag after app.js.
// ============================================================

(function () {
  let searchTimer = null;
  let searchOpen = false;
  let lastQuery = '';

  function onGlobalSearchInput(value) {
    const q = String(value || '').trim();
    lastQuery = q;
    if (searchTimer) clearTimeout(searchTimer);
    if (q.length < 2) {
      hideSearchDropdown();
      return;
    }
    searchTimer = setTimeout(async () => {
      const r = await api('GET', '/api/search?q=' + encodeURIComponent(q));
      if (lastQuery !== q) return; // stale
      if (r && r.results) renderSearchResults(r.results, q);
    }, 250);
  }
  window.onGlobalSearchInput = onGlobalSearchInput;

  function onGlobalSearchFocus() {
    const input = document.getElementById('global-search-input');
    if (input && input.value.trim().length >= 2) {
      const dd = document.getElementById('global-search-dropdown');
      if (dd && dd.innerHTML) dd.classList.add('open');
    }
  }
  window.onGlobalSearchFocus = onGlobalSearchFocus;

  function renderSearchResults(results, q) {
    const dd = document.getElementById('global-search-dropdown');
    if (!dd) return;

    const sections = [];

    if (results.issues && results.issues.length) {
      const rows = results.issues.map(i => `
        <div class="search-result" onclick="searchNavigate('issue','${esc(i.id)}')">
          <span class="search-result-icon">📋</span>
          <div class="search-result-body">
            <div class="search-result-title"><span class="mono" style="color:var(--cyan);margin-right:6px">${esc(i.issue_key)}</span>${esc(i.title)}</div>
            <div class="search-result-meta">${esc(i.project_key)} · <span class="lozenge lozenge-status-${esc(i.status)}" style="font-size:10px">${esc(i.status)}</span></div>
          </div>
        </div>
      `).join('');
      sections.push(`<div class="search-section-label">Issues</div>${rows}`);
    }

    if (results.pages && results.pages.length) {
      const rows = results.pages.map(p => `
        <div class="search-result" onclick="searchNavigate('doc_page','${esc(p.id)}','${esc(p.space_key || '')}')">
          <span class="search-result-icon">📄</span>
          <div class="search-result-body">
            <div class="search-result-title">${esc(p.title)}</div>
            <div class="search-result-meta">${esc(p.space_name || p.space_key || '')}</div>
          </div>
        </div>
      `).join('');
      sections.push(`<div class="search-section-label">Pages</div>${rows}`);
    }

    if (results.contacts && results.contacts.length) {
      const rows = results.contacts.map(c => `
        <div class="search-result" onclick="searchNavigate('contact','${esc(c.id)}')">
          <span class="search-result-icon">👤</span>
          <div class="search-result-body">
            <div class="search-result-title">${esc(c.name || c.email)}</div>
            <div class="search-result-meta">${esc(c.company || '')}${c.company && c.email ? ' · ' : ''}${esc(c.email || '')}</div>
          </div>
        </div>
      `).join('');
      sections.push(`<div class="search-section-label">Contacts</div>${rows}`);
    }

    if (results.projects && results.projects.length) {
      const rows = results.projects.map(p => `
        <div class="search-result" onclick="searchNavigate('project','${esc(p.id)}')">
          <span class="search-result-icon">📁</span>
          <div class="search-result-body">
            <div class="search-result-title"><span class="mono" style="color:var(--cyan);margin-right:6px">${esc(p.key)}</span>${esc(p.name)}</div>
          </div>
        </div>
      `).join('');
      sections.push(`<div class="search-section-label">Projects</div>${rows}`);
    }

    if (!sections.length) {
      dd.innerHTML = '<div class="search-empty">No results for "' + esc(q) + '"</div>';
    } else {
      dd.innerHTML = sections.join('');
    }
    dd.classList.add('open');
    searchOpen = true;
  }

  function hideSearchDropdown() {
    const dd = document.getElementById('global-search-dropdown');
    if (dd) { dd.classList.remove('open'); dd.innerHTML = ''; }
    searchOpen = false;
  }
  window.hideSearchDropdown = hideSearchDropdown;

  function searchNavigate(type, id, extra) {
    hideSearchDropdown();
    const input = document.getElementById('global-search-input');
    if (input) input.value = '';

    if (type === 'issue' && typeof openIssueDetail === 'function') {
      // Navigate to projects first so the modal has context, then open issue
      nav('projects');
      setTimeout(() => openIssueDetail(id), 100);
    } else if (type === 'doc_page') {
      if (typeof state !== 'undefined') {
        state.ui.docsPageId = id;
        // Try to set the space from the extra param or from the page data
        if (extra) {
          // extra is the space_key — we'd need the space_id. Just navigate to docs and let it load.
        }
      }
      nav('docs');
    } else if (type === 'contact') {
      nav('contacts');
    } else if (type === 'project') {
      if (typeof state !== 'undefined') {
        state.ui.tasksProjectId = id;
      }
      nav('projects');
    } else {
      nav('overview');
    }
  }
  window.searchNavigate = searchNavigate;

  // Keyboard shortcut: press "/" from anywhere to focus the search bar
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== '/' && ev.key !== 'Escape') return;
    // Don't capture "/" if the user is typing in an input/textarea/select
    const tag = (ev.target && ev.target.tagName || '').toLowerCase();
    if (ev.key === '/') {
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || ev.target.isContentEditable) return;
      ev.preventDefault();
      const input = document.getElementById('global-search-input');
      if (input) input.focus();
    }
    if (ev.key === 'Escape' && searchOpen) {
      hideSearchDropdown();
      const input = document.getElementById('global-search-input');
      if (input) input.blur();
    }
  });

  // Click outside to close
  document.addEventListener('mousedown', function (ev) {
    if (!searchOpen) return;
    const container = document.getElementById('topbar-search');
    if (container && !container.contains(ev.target)) {
      hideSearchDropdown();
    }
  });
})();
