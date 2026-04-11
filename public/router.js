// ============================================================
// Totally Wild AI — Hash-based router for shareable URLs
// Loaded after app.js. Writes #/path on every navigation,
// parses on load + hashchange to restore the view.
// ============================================================

(function () {
  let routerActive = false;
  let suppressNextHashChange = false;

  // ── URL scheme ────────────────────────────────────────────
  // #/overview, #/projects, #/project/:id, #/issue/:issueKey,
  // #/docs, #/space/:id, #/page/:id, #/account, #/users,
  // #/integrations, #/feature-settings, #/board/:projectId,
  // #/backlog/:projectId, #/sprints/:projectId

  function setHash(hash) {
    suppressNextHashChange = true;
    window.location.hash = hash;
    setTimeout(() => { suppressNextHashChange = false; }, 50);
  }

  // ── Write hash on navigation ──────────────────────────────
  // Patch the global nav() to also update the URL hash.
  const originalNav = window.nav;
  window.nav = async function routedNav(section) {
    // Write hash based on the section + current state
    if (section === 'projects') {
      if (state.ui.tasksProjectId) {
        setHash('#/project/' + state.ui.tasksProjectId);
      } else {
        setHash('#/projects');
      }
    } else if (section === 'docs') {
      if (state.ui.docsPageId) {
        setHash('#/page/' + state.ui.docsPageId);
      } else if (state.ui.docsSpaceId) {
        setHash('#/space/' + state.ui.docsSpaceId);
      } else {
        setHash('#/docs');
      }
    } else if (section === 'overview') {
      setHash('#/overview');
    } else {
      setHash('#/' + section);
    }
    return originalNav(section);
  };

  // Patch openIssueDetail to write the issue key into the hash
  const originalOpenIssue = window.openIssueDetail;
  if (originalOpenIssue) {
    window.openIssueDetail = async function (id) {
      await originalOpenIssue(id);
      // After the issue loads, currentIssue has the issue_key
      if (typeof currentIssue !== 'undefined' && currentIssue && currentIssue.issue_key) {
        setHash('#/issue/' + currentIssue.issue_key);
      } else {
        setHash('#/issue/' + id);
      }
    };
  }

  // Patch closeIssueDetail to restore the project hash
  const originalCloseIssue = window.closeIssueDetail;
  if (originalCloseIssue) {
    window.closeIssueDetail = function () {
      originalCloseIssue();
      if (state.ui.tasksProjectId) {
        setHash('#/project/' + state.ui.tasksProjectId);
      } else {
        setHash('#/projects');
      }
    };
  }

  // Patch openDocsPage to write the page hash
  const originalOpenPage = window.openDocsPage;
  if (originalOpenPage) {
    window.openDocsPage = function (pageId) {
      originalOpenPage(pageId);
      setHash('#/page/' + pageId);
    };
  }

  // Patch openProject (tasks-ui.js) to write the project hash
  const originalOpenProject = window.openProject;
  if (originalOpenProject) {
    window.openProject = function (id) {
      originalOpenProject(id);
      setHash('#/project/' + id);
    };
  }

  // Patch backToProjects to clear the project hash
  const originalBackToProjects = window.backToProjects;
  if (originalBackToProjects) {
    window.backToProjects = function () {
      originalBackToProjects();
      setHash('#/projects');
    };
  }

  // Patch openSpace (docs) to write the space hash
  const originalOpenSpace = window.openSpace;
  if (originalOpenSpace) {
    window.openSpace = function (id) {
      originalOpenSpace(id);
      setHash('#/space/' + id);
    };
  }

  // Patch backToSpaces to clear the space hash
  const originalBackToSpaces = window.backToSpaces;
  if (originalBackToSpaces) {
    window.backToSpaces = function () {
      originalBackToSpaces();
      setHash('#/docs');
    };
  }

  // ── Parse hash on load ────────────────────────────────────
  async function restoreFromHash() {
    const hash = (window.location.hash || '').replace(/^#\/?/, '');
    if (!hash) return false;

    const parts = hash.split('/');
    const route = parts[0];
    const param = parts[1] || '';

    if (route === 'overview') {
      nav('overview');
      return true;
    }
    if (route === 'projects' && !param) {
      state.ui.tasksProjectId = '';
      nav('projects');
      return true;
    }
    if (route === 'project' && param) {
      state.ui.tasksProjectId = param;
      state.ui.tasksTab = 'issues';
      nav('projects');
      return true;
    }
    if (route === 'board' && param) {
      state.ui.tasksProjectId = param;
      state.ui.tasksTab = 'board';
      nav('projects');
      return true;
    }
    if (route === 'backlog' && param) {
      state.ui.tasksProjectId = param;
      state.ui.tasksTab = 'backlog';
      nav('projects');
      return true;
    }
    if (route === 'sprints' && param) {
      state.ui.tasksProjectId = param;
      state.ui.tasksTab = 'sprints';
      nav('projects');
      return true;
    }
    if (route === 'issue' && param) {
      // param is the issue_key (e.g. ENG-12) or issue ID
      // First navigate to projects, then open the issue
      nav('projects');
      // Look up by issue_key or ID
      setTimeout(async () => {
        try {
          // Try as issue_key first (search), then as direct ID
          const searchR = await api('GET', '/api/search?q=' + encodeURIComponent(param));
          let issueId = null;
          if (searchR && searchR.results && searchR.results.issues) {
            const match = searchR.results.issues.find(i => i.issue_key === param);
            if (match) issueId = match.id;
          }
          if (!issueId) {
            // Try as a direct ID
            issueId = param;
          }
          if (issueId && typeof openIssueDetail === 'function') {
            await openIssueDetail(issueId);
          }
        } catch {}
      }, 300);
      return true;
    }
    if (route === 'docs' && !param) {
      state.ui.docsSpaceId = '';
      state.ui.docsPageId = '';
      nav('docs');
      return true;
    }
    if (route === 'space' && param) {
      state.ui.docsSpaceId = param;
      state.ui.docsPageId = '';
      nav('docs');
      return true;
    }
    if (route === 'page' && param) {
      // Fetch the page to get its space_id, then navigate
      try {
        const pageR = await api('GET', '/api/doc-pages/' + encodeURIComponent(param));
        if (pageR && !pageR.error) {
          const spaceId = (pageR.space && pageR.space.id) || (pageR.page && pageR.page.space_id) || '';
          state.ui.docsSpaceId = spaceId;
          state.ui.docsPageId = param;
          if (pageR.page) {
            state.docs = state.docs || {};
            state.docs.page = pageR.page;
            if (pageR.page._children === undefined) {
              state.docs.page._children = pageR.children || [];
              state.docs.page._parent = pageR.parent || null;
              state.docs.page._versionCount = pageR.version_count || 0;
            }
          }
          nav('docs');
          return true;
        }
      } catch {}
    }
    // Generic section routes
    if (['account', 'users', 'integrations', 'feature_settings', 'pipeline', 'followups',
         'templates', 'contacts', 'lists', 'campaigns', 'logs', 'unsubs'].includes(route)) {
      nav(route);
      return true;
    }
    return false;
  }

  // ── Copy URL helpers ──────────────────────────────────────
  function copyCurrentUrl() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      if (typeof toastSuccess === 'function') toastSuccess('Link copied to clipboard');
    }).catch(() => {
      if (typeof toastInfo === 'function') toastInfo('URL: ' + url);
    });
  }
  window.copyCurrentUrl = copyCurrentUrl;

  function getIssueUrl(issueKey) {
    return window.location.origin + window.location.pathname + '#/issue/' + issueKey;
  }
  window.getIssueUrl = getIssueUrl;

  function getPageUrl(pageId) {
    return window.location.origin + window.location.pathname + '#/page/' + pageId;
  }
  window.getPageUrl = getPageUrl;

  function copyIssueUrl(issueKey) {
    const url = getIssueUrl(issueKey);
    navigator.clipboard.writeText(url).then(() => {
      if (typeof toastSuccess === 'function') toastSuccess('Issue link copied');
    }).catch(() => {
      if (typeof toastInfo === 'function') toastInfo(url);
    });
  }
  window.copyIssueUrl = copyIssueUrl;

  function copyPageUrl(pageId) {
    const url = getPageUrl(pageId);
    navigator.clipboard.writeText(url).then(() => {
      if (typeof toastSuccess === 'function') toastSuccess('Page link copied');
    }).catch(() => {
      if (typeof toastInfo === 'function') toastInfo(url);
    });
  }
  window.copyPageUrl = copyPageUrl;

  // ── hashchange listener (browser back/forward) ────────────
  window.addEventListener('hashchange', () => {
    if (suppressNextHashChange) return;
    restoreFromHash();
  });

  // ── Initial route on page load ────────────────────────────
  // Wait for the app to finish init, then check the hash.
  // The existing init() calls nav('overview') — we override that
  // if there's a hash to restore.
  const originalInit = window.init;
  if (originalInit) {
    window.init = async function () {
      await originalInit();
      // After init completes (user is logged in, state is loaded),
      // check if there's a hash route to restore.
      const hash = (window.location.hash || '').replace(/^#\/?/, '');
      if (hash && hash !== 'overview') {
        await restoreFromHash();
      }
      routerActive = true;
    };
  }
})();
