// ============================================================
// 365 Pulse — Tasks UI (Sprint 2)
// Frontend for the Projects + Issues module. Loaded as a regular
// <script> tag after app.js, so everything here lives on the
// global scope and freely uses helpers from app.js: state, api(),
// esc(), setModal(), closeModal(), currentSection, nav(), etc.
// Wired into app.js's renderSection() switch by the integration
// step (this file does not touch app.js itself).
// ============================================================

(function () {
  Object.assign(state.ui, {
    tasksProjectId: '',
    tasksFilters: { status: '', assignee_id: '', type: '', priority: '', q: '' },
    tasksOpenIssueId: ''
  });
  state.tasks = { projects: [], project: null, issues: [], users: [] };
})();

// ── Constants ────────────────────────────────────────────────
const TASK_STATUSES = ['backlog','todo','in_progress','in_review','done'];
const TASK_STATUS_LABELS = { backlog:'Backlog', todo:'To Do', in_progress:'In Progress', in_review:'In Review', done:'Done' };
const TASK_TYPES = ['task','bug','story','epic'];
const TASK_TYPE_LABELS = { task:'Task', bug:'Bug', story:'Story', epic:'Epic' };
const TASK_PRIORITIES = ['lowest','low','medium','high','highest'];
const TASK_PRIORITY_LABELS = { lowest:'Lowest', low:'Low', medium:'Medium', high:'High', highest:'Highest' };

const ISSUE_TYPE_ICONS = {
  task: '<svg class="issue-type-icon" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor"/></svg>',
  bug:  '<svg class="issue-type-icon" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="currentColor"/></svg>',
  story:'<svg class="issue-type-icon" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2h8v10l-4-2.5L3 12V2z" fill="currentColor"/></svg>',
  epic: '<svg class="issue-type-icon" viewBox="0 0 14 14" aria-hidden="true"><path d="M8 1L3 8h3l-1 5 5-7H7l1-5z" fill="currentColor"/></svg>'
};

// ── Markdown helper ───────────────────────────────────────────
function renderMarkdown(text) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    return `<pre class="md-fallback">${esc(text || '')}</pre>`;
  }
  try {
    const raw = marked.parse(String(text || ''), { breaks: true, gfm: true });
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  } catch {
    return `<pre class="md-fallback">${esc(text || '')}</pre>`;
  }
}

// ── Relative time ─────────────────────────────────────────────
function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 30) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 172800) return 'yesterday';
  if (diff < 86400 * 14) return `${Math.floor(diff/86400)} days ago`;
  try { return d.toLocaleDateString('en-AU', { day:'2-digit', month:'short', year: (Date.now() - d.getTime() > 86400*1000*300 ? 'numeric' : undefined) }); }
  catch { return iso; }
}

function tasksCanWrite() { return state.me && state.me.role !== 'viewer'; }
function tasksIsAdmin() { return state.me && state.me.role === 'admin'; }

// ── Section entry point ───────────────────────────────────────
async function renderTasksSection() {
  if (state.ui.tasksProjectId) {
    await loadProject(state.ui.tasksProjectId);
    renderProjectDetail();
  } else {
    await loadProjects();
    renderProjects();
  }
}
window.renderTasksSection = renderTasksSection;

// ── Project list ──────────────────────────────────────────────
async function loadProjects() {
  const r = await api('GET','/api/projects');
  state.tasks.projects = (r && Array.isArray(r.projects)) ? r.projects : [];
}

function projectStatusBar(counts, total) {
  if (!total) return '<div class="proj-bar proj-bar-empty"><span class="proj-bar-empty-label">No issues</span></div>';
  const segs = TASK_STATUSES.map(s => {
    const n = Number(counts && counts[s] || 0);
    if (!n) return '';
    return `<span class="proj-bar-seg lozenge-status-${s}" style="flex:${n}" title="${esc(TASK_STATUS_LABELS[s])}: ${n}">${n}</span>`;
  }).join('');
  return `<div class="proj-bar">${segs}</div>`;
}

function renderProjects() {
  const c = document.getElementById('content');
  const canWrite = tasksCanWrite();
  const cards = state.tasks.projects.map(p => {
    const lead = p.lead || null;
    const total = Number(p.total_issues || 0);
    const initials = lead && lead.display_name ? lead.display_name.trim().split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase() : '';
    return `
      <div class="card project-card" onclick="openProject('${esc(p.id)}')" style="cursor:pointer">
        <div class="card-body">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div class="project-key">${esc(p.key)}</div>
            <div class="text-muted text-sm">${total} issue${total===1?'':'s'}</div>
          </div>
          <div class="project-name" style="font-size:16px;font-weight:600;margin:8px 0 6px">${esc(p.name)}</div>
          ${lead ? `<div class="project-lead" style="display:flex;align-items:center;gap:8px;margin:6px 0 10px">
            <span class="avatar-sm">${esc(initials || '?')}</span>
            <span class="text-muted text-sm">${esc(lead.display_name || lead.email || '')}</span>
          </div>` : '<div class="text-muted text-sm" style="margin:6px 0 10px">No lead</div>'}
          ${projectStatusBar(p.issue_counts || {}, total)}
        </div>
      </div>
    `;
  }).join('');
  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div class="page-actions">
        ${canWrite ? '<button class="btn btn-primary" type="button" onclick="openCreateProject()">+ New project</button>' : ''}
      </div>
      <div class="project-grid">
        ${cards || '<div class="empty"><p>No projects yet.</p></div>'}
      </div>
    </div>
  `;
}
window.renderProjects = renderProjects;

function openProject(id) {
  state.ui.tasksProjectId = id;
  state.ui.tasksFilters = { status:'', assignee_id:'', type:'', priority:'', q:'' };
  renderTasksSection();
}
window.openProject = openProject;

function backToProjects() {
  state.ui.tasksProjectId = '';
  state.tasks.project = null;
  state.tasks.issues = [];
  renderTasksSection();
}
window.backToProjects = backToProjects;

// ── Project detail ────────────────────────────────────────────
async function loadProject(id) {
  const f = state.ui.tasksFilters || {};
  const qs = new URLSearchParams();
  if (f.status) qs.set('status', f.status);
  if (f.assignee_id) qs.set('assignee_id', f.assignee_id);
  if (f.type) qs.set('type', f.type);
  if (f.priority) qs.set('priority', f.priority);
  if (f.q) qs.set('q', f.q);
  const queryStr = qs.toString();
  const issuesPath = `/api/projects/${encodeURIComponent(id)}/issues${queryStr ? '?' + queryStr : ''}`;
  const calls = [
    api('GET', `/api/projects/${encodeURIComponent(id)}`),
    api('GET', issuesPath)
  ];
  if (!state.tasks.users || !state.tasks.users.length) {
    calls.push(api('GET', '/api/users'));
  }
  const results = await Promise.all(calls);
  const projRes = results[0] || {};
  const issuesRes = results[1] || {};
  state.tasks.project = projRes.project || projRes || null;
  state.tasks.issues = Array.isArray(issuesRes.issues) ? issuesRes.issues : [];
  if (results[2]) {
    state.tasks.users = (results[2] && Array.isArray(results[2].users)) ? results[2].users : [];
  }
}

let tasksSearchTimer = null;

function renderProjectDetail() {
  const c = document.getElementById('content');
  const p = state.tasks.project;
  const f = state.ui.tasksFilters;
  const canWrite = tasksCanWrite();
  if (!p) {
    c.innerHTML = '<div class="empty"><p>Project not found.</p><button class="btn btn-ghost" type="button" onclick="backToProjects()">← All projects</button></div>';
    return;
  }
  const statusOpts = ['<option value="">Status: Any</option>'].concat(TASK_STATUSES.map(s => `<option value="${s}" ${f.status===s?'selected':''}>${esc(TASK_STATUS_LABELS[s])}</option>`)).join('');
  const typeOpts = ['<option value="">Type: Any</option>'].concat(TASK_TYPES.map(s => `<option value="${s}" ${f.type===s?'selected':''}>${esc(TASK_TYPE_LABELS[s])}</option>`)).join('');
  const prioOpts = ['<option value="">Priority: Any</option>'].concat(TASK_PRIORITIES.map(s => `<option value="${s}" ${f.priority===s?'selected':''}>${esc(TASK_PRIORITY_LABELS[s])}</option>`)).join('');
  const userOpts = ['<option value="">Assignee: Any</option>', `<option value="__unassigned__" ${f.assignee_id==='__unassigned__'?'selected':''}>Unassigned</option>`]
    .concat((state.tasks.users||[]).map(u => `<option value="${esc(u.id)}" ${f.assignee_id===u.id?'selected':''}>${esc(u.display_name || u.email)}</option>`)).join('');

  const rows = state.tasks.issues.map(i => {
    const a = i.assignee;
    const assigneeCell = a ? esc(a.display_name || a.email) : '<span class="text-muted">Unassigned</span>';
    return `
      <tr onclick="openIssueDetail('${esc(i.id)}')" style="cursor:pointer">
        <td class="mono">${esc(i.issue_key)}</td>
        <td>${ISSUE_TYPE_ICONS[i.type] || ISSUE_TYPE_ICONS.task}</td>
        <td>${esc(i.title)}</td>
        <td><span class="lozenge lozenge-status-${esc(i.status)}">${esc(TASK_STATUS_LABELS[i.status] || i.status)}</span></td>
        <td><span class="lozenge lozenge-priority-${esc(i.priority)}">${esc(TASK_PRIORITY_LABELS[i.priority] || i.priority)}</span></td>
        <td>${assigneeCell}</td>
        <td class="text-muted text-sm">${esc(relTime(i.updated_at))}</td>
      </tr>
    `;
  }).join('');

  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div class="page-actions" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" type="button" onclick="backToProjects()">← All projects</button>
          <h2 style="margin:0;font-size:20px"><span class="project-key">${esc(p.key)}</span> <span style="margin-left:8px">${esc(p.name)}</span></h2>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${canWrite ? `<button class="btn btn-ghost btn-sm" type="button" onclick="openEditProject()">Edit project</button>` : ''}
          ${tasksIsAdmin() ? `<button class="btn btn-ghost btn-sm" type="button" onclick="confirmDeleteProject()">Delete project</button>` : ''}
          ${canWrite ? '<button class="btn btn-primary" type="button" onclick="openCreateIssue()">+ New issue</button>' : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-body" style="padding:12px 14px">
          <div class="tasks-filter-bar" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <select onchange="onTasksFilterChange('status', this.value)">${statusOpts}</select>
            <select onchange="onTasksFilterChange('type', this.value)">${typeOpts}</select>
            <select onchange="onTasksFilterChange('priority', this.value)">${prioOpts}</select>
            <select onchange="onTasksFilterChange('assignee_id', this.value)">${userOpts}</select>
            <input id="tasks-q" type="search" placeholder="Search issues…" value="${esc(f.q || '')}" oninput="onTasksSearchInput(this.value)" style="flex:1;min-width:180px">
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-body" style="padding:0">
          <table class="data-table tasks-table">
            <thead><tr>
              <th>Key</th><th>Type</th><th>Title</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Updated</th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="7" class="empty"><p>No issues match your filters.</p></td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}
window.renderProjectDetail = renderProjectDetail;

async function onTasksFilterChange(key, value) {
  state.ui.tasksFilters[key] = value || '';
  await loadProject(state.ui.tasksProjectId);
  renderProjectDetail();
}
window.onTasksFilterChange = onTasksFilterChange;

function onTasksSearchInput(value) {
  if (tasksSearchTimer) clearTimeout(tasksSearchTimer);
  tasksSearchTimer = setTimeout(async () => {
    state.ui.tasksFilters.q = value || '';
    await loadProject(state.ui.tasksProjectId);
    renderProjectDetail();
    const el = document.getElementById('tasks-q');
    if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; }
  }, 250);
}
window.onTasksSearchInput = onTasksSearchInput;

// ── Create project modal ──────────────────────────────────────
function openCreateProject() {
  setModal(`
    <div class="modal-head"><div class="modal-title">New project</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Project key (2–10 uppercase letters)</label>
      <input id="np-key" type="text" placeholder="ENG" maxlength="10" autofocus oninput="this.value=this.value.toUpperCase()" onblur="this.value=this.value.toUpperCase()">
      <label style="margin-top:10px">Name</label>
      <input id="np-name" type="text" placeholder="Engineering">
      <label style="margin-top:10px">Description (Markdown)</label>
      <textarea id="np-desc" rows="4" placeholder="What is this project for?"></textarea>
      <div class="form-msg" id="np-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitCreateProject()">Create project</button>
    </div>
  `);
}
window.openCreateProject = openCreateProject;

async function submitCreateProject() {
  const key = (document.getElementById('np-key').value || '').trim().toUpperCase();
  const name = (document.getElementById('np-name').value || '').trim();
  const description_md = document.getElementById('np-desc').value || '';
  const msg = document.getElementById('np-msg');
  msg.className = 'form-msg';
  if (!key || key.length < 2) { msg.textContent = 'Key must be at least 2 characters'; msg.classList.add('form-msg-err'); return; }
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) { msg.textContent = 'Key must be 2–10 uppercase letters/digits'; msg.classList.add('form-msg-err'); return; }
  if (!name) { msg.textContent = 'Name is required'; msg.classList.add('form-msg-err'); return; }
  const r = await api('POST','/api/projects',{ key, name, description_md });
  if (r && (r.id || r.project)) {
    closeModal();
    await loadProjects();
    renderProjects();
  } else {
    msg.textContent = (r && r.error) || 'Failed to create project';
    msg.classList.add('form-msg-err');
  }
}
window.submitCreateProject = submitCreateProject;

// ── Edit project modal ────────────────────────────────────────
function openEditProject() {
  const p = state.tasks.project;
  if (!p) return;
  const userOpts = '<option value="">No lead</option>' + (state.tasks.users || [])
    .map(u => `<option value="${esc(u.id)}" ${p.lead_user_id === u.id ? 'selected' : ''}>${esc(u.display_name || u.email)}</option>`).join('');
  setModal(`
    <div class="modal-head"><div class="modal-title">Edit project — ${esc(p.key)}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Project key</label>
      <input type="text" value="${esc(p.key)}" disabled>
      <label style="margin-top:10px">Name</label>
      <input id="ep-name" type="text" value="${esc(p.name)}" autofocus>
      <label style="margin-top:10px">Description (Markdown)</label>
      <textarea id="ep-desc" rows="6">${esc(p.description_md || '')}</textarea>
      <label style="margin-top:10px">Project lead</label>
      <select id="ep-lead">${userOpts}</select>
      <div class="form-msg" id="ep-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitEditProject()">Save changes</button>
    </div>
  `);
}
window.openEditProject = openEditProject;

async function submitEditProject() {
  const p = state.tasks.project;
  if (!p) return;
  const name = (document.getElementById('ep-name').value || '').trim();
  const description_md = document.getElementById('ep-desc').value || '';
  const lead_user_id = document.getElementById('ep-lead').value || null;
  const msg = document.getElementById('ep-msg');
  msg.className = 'form-msg';
  if (!name) { msg.textContent = 'Name is required'; msg.classList.add('form-msg-err'); return; }
  const r = await api('PATCH', `/api/projects/${encodeURIComponent(p.id)}`, { name, description_md, lead_user_id });
  if (r && r.ok) {
    closeModal();
    await loadProject(p.id);
    renderProjectDetail();
  } else {
    msg.textContent = (r && r.error) || 'Failed to save changes';
    msg.classList.add('form-msg-err');
  }
}
window.submitEditProject = submitEditProject;

async function confirmDeleteProject() {
  const p = state.tasks.project;
  if (!p) return;
  if (!confirm(`Delete project ${p.key} (${p.name})?\n\nAll issues in this project will be soft-deleted. This is reversible by re-activating the project row in the database.`)) return;
  const r = await api('DELETE', `/api/projects/${encodeURIComponent(p.id)}`);
  if (r && r.ok) {
    state.ui.tasksProjectId = '';
    state.tasks.project = null;
    await loadProjects();
    renderProjects();
  } else {
    alert((r && r.error) || 'Failed to delete project');
  }
}
window.confirmDeleteProject = confirmDeleteProject;

// ── Create issue modal ────────────────────────────────────────
function openCreateIssue() {
  if (!state.tasks.project) return;
  const typeOpts = TASK_TYPES.map(t => `<option value="${t}">${esc(TASK_TYPE_LABELS[t])}</option>`).join('');
  const prioOpts = TASK_PRIORITIES.map(p => `<option value="${p}" ${p==='medium'?'selected':''}>${esc(TASK_PRIORITY_LABELS[p])}</option>`).join('');
  const userOpts = '<option value="">Unassigned</option>' + (state.tasks.users||[]).map(u => `<option value="${esc(u.id)}">${esc(u.display_name || u.email)}</option>`).join('');
  setModal(`
    <div class="modal-head"><div class="modal-title">New issue in ${esc(state.tasks.project.key)}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Title</label>
      <input id="ni-title" type="text" autofocus placeholder="Short summary">
      <div class="form-row" style="margin-top:10px">
        <div><label>Type</label><select id="ni-type">${typeOpts}</select></div>
        <div><label>Priority</label><select id="ni-priority">${prioOpts}</select></div>
      </div>
      <label style="margin-top:10px">Assignee</label>
      <select id="ni-assignee">${userOpts}</select>
      <label style="margin-top:10px">Description (Markdown)</label>
      <textarea id="ni-desc" rows="6" placeholder="Details, steps to reproduce, acceptance criteria…"></textarea>
      <label style="margin-top:10px">Parent issue key (optional)</label>
      <input id="ni-parent" type="text" placeholder="${esc(state.tasks.project.key)}-12">
      <div class="form-msg" id="ni-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitCreateIssue()">Create issue</button>
    </div>
  `);
}
window.openCreateIssue = openCreateIssue;

async function submitCreateIssue() {
  const title = (document.getElementById('ni-title').value || '').trim();
  const type = document.getElementById('ni-type').value;
  const priority = document.getElementById('ni-priority').value;
  const assignee_id = document.getElementById('ni-assignee').value || null;
  const description_md = document.getElementById('ni-desc').value || '';
  const parent_key = (document.getElementById('ni-parent').value || '').trim();
  const msg = document.getElementById('ni-msg');
  msg.className = 'form-msg';
  if (!title) { msg.textContent = 'Title is required'; msg.classList.add('form-msg-err'); return; }
  const body = { title, type, priority, assignee_id, description_md };
  if (parent_key) body.parent_key = parent_key;
  const r = await api('POST', `/api/projects/${encodeURIComponent(state.ui.tasksProjectId)}/issues`, body);
  if (r && (r.id || r.issue)) {
    closeModal();
    await loadProject(state.ui.tasksProjectId);
    renderProjectDetail();
  } else {
    msg.textContent = (r && r.error) || 'Failed to create issue';
    msg.classList.add('form-msg-err');
  }
}
window.submitCreateIssue = submitCreateIssue;

// ── Issue detail modal ────────────────────────────────────────
let currentIssue = null;
let currentIssueParent = null;
let currentIssueSubtasks = [];
let currentIssueActivity = [];

async function openIssueDetail(id) {
  state.ui.tasksOpenIssueId = id;
  const r = await api('GET', `/api/issues/${encodeURIComponent(id)}`);
  if (!r || r.error || !r.issue) {
    setModal(`<div class="modal-head"><div class="modal-title">Error</div><button class="modal-close" type="button" onclick="closeModal()">x</button></div><div class="modal-body"><p>${esc((r && r.error) || 'Failed to load issue')}</p></div>`);
    return;
  }
  currentIssue = r.issue;
  currentIssueParent = r.parent || null;
  currentIssueSubtasks = Array.isArray(r.subtasks) ? r.subtasks : [];
  currentIssueActivity = Array.isArray(r.activity) ? r.activity : [];
  if (!state.tasks.users || !state.tasks.users.length) {
    const ur = await api('GET','/api/users');
    state.tasks.users = (ur && Array.isArray(ur.users)) ? ur.users : [];
  }
  renderIssueDetailModal();
}
window.openIssueDetail = openIssueDetail;

function renderIssueDetailModal() {
  const i = currentIssue;
  if (!i) return;
  const canWrite = tasksCanWrite();
  const a = i.assignee;
  const reporter = i.reporter;
  const assigneeName = a ? (a.display_name || a.email) : 'Unassigned';
  const reporterName = reporter ? (reporter.display_name || reporter.email) : '—';
  const dueVal = i.due_at ? String(i.due_at).slice(0,10) : '';
  setModal(`
    <div class="modal-head">
      <div class="modal-title">
        ${ISSUE_TYPE_ICONS[i.type] || ISSUE_TYPE_ICONS.task}
        <span class="mono" style="color:var(--muted2);margin-right:8px">${esc(i.issue_key)}</span>
      </div>
      <button class="modal-close" type="button" onclick="closeIssueDetail()">x</button>
    </div>
    <div class="modal-body issue-detail-body" style="display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:24px">
      <div class="issue-detail-main" style="min-width:0">
        <div class="issue-title-wrap" id="issue-title-wrap">
          ${renderIssueTitleView(i.title)}
        </div>
        <div class="issue-section-label" style="margin-top:18px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted2)">Description</div>
        <div class="issue-desc-wrap" id="issue-desc-wrap" style="margin-top:6px">
          ${renderIssueDescView(i.description_md)}
        </div>

        <div class="issue-section-label" style="margin-top:22px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted2)">Activity</div>
        <div class="issue-activity" id="issue-activity" style="margin-top:8px">
          ${renderIssueActivityFeed()}
        </div>

        ${canWrite ? `
        <div class="issue-comment-composer" style="margin-top:14px">
          <textarea id="issue-comment-text" rows="3" placeholder="Add a comment… (Markdown supported)"></textarea>
          <div style="margin-top:8px;display:flex;justify-content:flex-end">
            <button class="btn btn-primary btn-sm" type="button" onclick="addComment()">Add comment</button>
          </div>
        </div>` : ''}
      </div>

      <aside class="issue-detail-side" style="min-width:0">
        <div class="kv-grid" id="issue-meta-grid">
          ${renderIssueMetaRow('type', 'Type', `<span>${ISSUE_TYPE_ICONS[i.type] || ''}${esc(TASK_TYPE_LABELS[i.type] || i.type)}</span>`, canWrite)}
          ${renderIssueMetaRow('status', 'Status', `<span class="lozenge lozenge-status-${esc(i.status)}">${esc(TASK_STATUS_LABELS[i.status] || i.status)}</span>`, canWrite)}
          ${renderIssueMetaRow('priority', 'Priority', `<span class="lozenge lozenge-priority-${esc(i.priority)}">${esc(TASK_PRIORITY_LABELS[i.priority] || i.priority)}</span>`, canWrite)}
          ${renderIssueMetaRow('assignee', 'Assignee', a ? esc(assigneeName) : '<span class="text-muted">Unassigned</span>', canWrite)}
          <div class="kv-row"><div class="kv-k">Reporter</div><div class="kv-v">${esc(reporterName)}</div></div>
          ${renderIssueMetaRow('due', 'Due date', dueVal ? esc(dueVal) : '<span class="text-muted">—</span>', canWrite)}
          <div class="kv-row"><div class="kv-k">Parent</div><div class="kv-v">${currentIssueParent ? `<a href="javascript:void(0)" onclick="openIssueDetail('${esc(currentIssueParent.id)}')"><span class="mono">${esc(currentIssueParent.issue_key)}</span> ${esc(currentIssueParent.title)}</a>` : '<span class="text-muted">—</span>'}</div></div>
          <div class="kv-row"><div class="kv-k">Sub-tasks</div><div class="kv-v">${
            currentIssueSubtasks.length
              ? currentIssueSubtasks.map(s => `<div><a href="javascript:void(0)" onclick="openIssueDetail('${esc(s.id)}')"><span class="mono">${esc(s.issue_key)}</span> ${esc(s.title)}</a> <span class="lozenge lozenge-status-${esc(s.status)}" style="margin-left:6px">${esc(TASK_STATUS_LABELS[s.status] || s.status)}</span></div>`).join('')
              : '<span class="text-muted">None</span>'
          }</div></div>
          <div class="kv-row"><div class="kv-k">Created</div><div class="kv-v text-muted text-sm">${esc(relTime(i.created_at))}</div></div>
          <div class="kv-row"><div class="kv-k">Updated</div><div class="kv-v text-muted text-sm">${esc(relTime(i.updated_at))}</div></div>
        </div>
      </aside>
    </div>
    <div class="modal-foot" style="justify-content:space-between">
      <div>${canWrite ? `<button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" onclick="submitDeleteIssue()">Delete issue</button>` : ''}</div>
      <button class="btn btn-ghost" type="button" onclick="closeIssueDetail()">Close</button>
    </div>
  `);
}

function closeIssueDetail() {
  state.ui.tasksOpenIssueId = '';
  currentIssue = null;
  currentIssueParent = null;
  currentIssueSubtasks = [];
  currentIssueActivity = [];
  closeModal();
  if (currentSection === 'projects' && state.ui.tasksProjectId) {
    loadProject(state.ui.tasksProjectId).then(renderProjectDetail);
  }
}
window.closeIssueDetail = closeIssueDetail;

function renderIssueTitleView(title) {
  return `<h2 class="issue-title" style="margin:0;font-size:22px;cursor:text" onclick="editIssueTitle()">${esc(title || '(no title)')}</h2>`;
}

function editIssueTitle() {
  if (!tasksCanWrite()) return;
  const wrap = document.getElementById('issue-title-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<input id="issue-title-input" type="text" value="${esc(currentIssue.title || '')}" style="font-size:20px;width:100%" onblur="commitIssueTitle()" onkeydown="if(event.key==='Enter'){this.blur();}else if(event.key==='Escape'){cancelIssueTitleEdit();}">`;
  setTimeout(() => { const el = document.getElementById('issue-title-input'); if (el) { el.focus(); el.select(); } }, 10);
}
window.editIssueTitle = editIssueTitle;

let titleEditCancelled = false;
function cancelIssueTitleEdit() {
  titleEditCancelled = true;
  const wrap = document.getElementById('issue-title-wrap');
  if (wrap) wrap.innerHTML = renderIssueTitleView(currentIssue.title);
  setTimeout(() => { titleEditCancelled = false; }, 50);
}
window.cancelIssueTitleEdit = cancelIssueTitleEdit;

async function commitIssueTitle() {
  if (titleEditCancelled) return;
  const el = document.getElementById('issue-title-input');
  if (!el) return;
  const next = (el.value || '').trim();
  if (!next || next === currentIssue.title) {
    const wrap = document.getElementById('issue-title-wrap');
    if (wrap) wrap.innerHTML = renderIssueTitleView(currentIssue.title);
    return;
  }
  const r = await api('PATCH', `/api/issues/${encodeURIComponent(currentIssue.id)}`, { title: next });
  if (r && (r.ok || r.issue || r.id)) {
    currentIssue.title = next;
    if (r.issue) currentIssue = r.issue;
    const wrap = document.getElementById('issue-title-wrap');
    if (wrap) wrap.innerHTML = renderIssueTitleView(currentIssue.title);
  } else {
    alert((r && r.error) || 'Failed to update title');
    const wrap = document.getElementById('issue-title-wrap');
    if (wrap) wrap.innerHTML = renderIssueTitleView(currentIssue.title);
  }
}
window.commitIssueTitle = commitIssueTitle;

function renderIssueDescView(md) {
  const body = (md && String(md).trim()) ? renderMarkdown(md) : '<p class="text-muted">No description. Click to add one.</p>';
  return `<div class="issue-desc md-body" style="cursor:text" onclick="editIssueDesc()">${body}</div>`;
}

function editIssueDesc() {
  if (!tasksCanWrite()) return;
  const wrap = document.getElementById('issue-desc-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <textarea id="issue-desc-input" rows="8" style="width:100%">${esc(currentIssue.description_md || '')}</textarea>
    <div style="margin-top:8px;display:flex;gap:8px">
      <button class="btn btn-primary btn-sm" type="button" onclick="commitIssueDesc()">Save</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="cancelIssueDescEdit()">Cancel</button>
    </div>
  `;
  setTimeout(() => { const el = document.getElementById('issue-desc-input'); if (el) el.focus(); }, 10);
}
window.editIssueDesc = editIssueDesc;

function cancelIssueDescEdit() {
  const wrap = document.getElementById('issue-desc-wrap');
  if (wrap) wrap.innerHTML = renderIssueDescView(currentIssue.description_md);
}
window.cancelIssueDescEdit = cancelIssueDescEdit;

async function commitIssueDesc() {
  const el = document.getElementById('issue-desc-input');
  if (!el) return;
  const next = el.value || '';
  const r = await api('PATCH', `/api/issues/${encodeURIComponent(currentIssue.id)}`, { description_md: next });
  if (r && (r.ok || r.issue || r.id)) {
    currentIssue.description_md = next;
    if (r.issue) currentIssue = r.issue;
    const wrap = document.getElementById('issue-desc-wrap');
    if (wrap) wrap.innerHTML = renderIssueDescView(currentIssue.description_md);
  } else {
    alert((r && r.error) || 'Failed to update description');
  }
}
window.commitIssueDesc = commitIssueDesc;

// Activity feed ───────────────────────────────────────────────
function renderIssueActivityFeed() {
  if (!currentIssueActivity.length) return '<div class="text-muted text-sm">No activity yet.</div>';
  const myId = state.me && state.me.id;
  const isAdmin = tasksIsAdmin();
  return currentIssueActivity.map(act => {
    const u = act.user || null;
    const who = u ? (u.display_name || u.email) : 'system';
    const when = relTime(act.created_at);
    const canDelete = isAdmin || (myId && act.user_id && myId === act.user_id);
    const delBtn = canDelete ? `<button class="activity-del" type="button" title="Delete" onclick="deleteActivity('${esc(act.id)}')">×</button>` : '';
    if (act.kind === 'comment') {
      return `
        <div class="activity-row activity-comment" style="margin:10px 0;padding:10px 12px;border:1px solid var(--border);border-radius:6px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div><strong>${esc(who)}</strong> <span class="text-muted text-sm">commented ${esc(when)}</span></div>
            ${delBtn}
          </div>
          <div class="md-body">${renderMarkdown(act.body_md || '')}</div>
        </div>
      `;
    }
    return `
      <div class="activity-row activity-system" style="margin:6px 0;font-style:italic;color:var(--muted2);font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div><strong>${esc(who)}</strong> ${esc(act.body_md || '')} <span class="text-muted">· ${esc(when)}</span></div>
        ${delBtn}
      </div>
    `;
  }).join('');
}

async function addComment() {
  const el = document.getElementById('issue-comment-text');
  if (!el) return;
  const body_md = (el.value || '').trim();
  if (!body_md) return;
  const r = await api('POST', `/api/issues/${encodeURIComponent(currentIssue.id)}/comments`, { body_md });
  if (r && (r.id || r.activity || r.ok)) {
    el.value = '';
    await refreshIssueDetail();
  } else {
    alert((r && r.error) || 'Failed to add comment');
  }
}
window.addComment = addComment;

async function deleteActivity(id) {
  if (!confirm('Delete this entry?')) return;
  const r = await api('DELETE', `/api/activity/${encodeURIComponent(id)}`);
  if (r && (r.ok || r.id)) {
    await refreshIssueDetail();
  } else {
    alert((r && r.error) || 'Failed to delete');
  }
}
window.deleteActivity = deleteActivity;

async function refreshIssueDetail() {
  if (!currentIssue) return;
  const r = await api('GET', `/api/issues/${encodeURIComponent(currentIssue.id)}`);
  if (r && r.issue) {
    currentIssue = r.issue;
    currentIssueParent = r.parent || null;
    currentIssueSubtasks = Array.isArray(r.subtasks) ? r.subtasks : [];
    currentIssueActivity = Array.isArray(r.activity) ? r.activity : [];
    renderIssueDetailModal();
  }
}

// Metadata sidebar — click-to-edit ───────────────────────────
function renderIssueMetaRow(field, label, valueHtml, canWrite) {
  const onclick = canWrite ? `onclick="editIssueField('${field}')"` : '';
  const cursor = canWrite ? 'cursor:pointer' : '';
  return `<div class="kv-row" id="kv-row-${field}"><div class="kv-k">${esc(label)}</div><div class="kv-v" style="${cursor}" ${onclick}>${valueHtml}</div></div>`;
}

function editIssueField(field) {
  if (!tasksCanWrite()) return;
  const row = document.getElementById('kv-row-' + field);
  if (!row) return;
  const valEl = row.querySelector('.kv-v');
  if (!valEl) return;
  const i = currentIssue;
  let editorHtml = '';
  if (field === 'type') {
    editorHtml = `<select id="ife-input" onchange="commitIssueField('type', this.value)" onblur="commitIssueField('type', this.value)">` +
      TASK_TYPES.map(t => `<option value="${t}" ${i.type===t?'selected':''}>${esc(TASK_TYPE_LABELS[t])}</option>`).join('') + '</select>';
  } else if (field === 'status') {
    editorHtml = `<select id="ife-input" onchange="commitIssueField('status', this.value)" onblur="commitIssueField('status', this.value)">` +
      TASK_STATUSES.map(s => `<option value="${s}" ${i.status===s?'selected':''}>${esc(TASK_STATUS_LABELS[s])}</option>`).join('') + '</select>';
  } else if (field === 'priority') {
    editorHtml = `<select id="ife-input" onchange="commitIssueField('priority', this.value)" onblur="commitIssueField('priority', this.value)">` +
      TASK_PRIORITIES.map(p => `<option value="${p}" ${i.priority===p?'selected':''}>${esc(TASK_PRIORITY_LABELS[p])}</option>`).join('') + '</select>';
  } else if (field === 'assignee') {
    const opts = '<option value="">Unassigned</option>' + (state.tasks.users||[]).map(u => `<option value="${esc(u.id)}" ${i.assignee_id===u.id?'selected':''}>${esc(u.display_name || u.email)}</option>`).join('');
    editorHtml = `<select id="ife-input" onchange="commitIssueField('assignee_id', this.value)" onblur="commitIssueField('assignee_id', this.value)">${opts}</select>`;
  } else if (field === 'due') {
    const v = i.due_at ? String(i.due_at).slice(0,10) : '';
    editorHtml = `<input id="ife-input" type="date" value="${esc(v)}" onchange="commitIssueField('due_at', this.value)" onblur="commitIssueField('due_at', this.value)">`;
  }
  valEl.innerHTML = editorHtml;
  setTimeout(() => { const el = document.getElementById('ife-input'); if (el) el.focus(); }, 10);
}
window.editIssueField = editIssueField;

let fieldCommitting = false;
async function commitIssueField(field, value) {
  if (fieldCommitting) return;
  fieldCommitting = true;
  try {
    const body = {};
    if (field === 'assignee_id') body.assignee_id = value || null;
    else if (field === 'due_at') body.due_at = value ? new Date(value + 'T00:00:00Z').toISOString() : null;
    else body[field] = value;
    const r = await api('PATCH', `/api/issues/${encodeURIComponent(currentIssue.id)}`, body);
    if (r && (r.ok || r.issue || r.id)) {
      await refreshIssueDetail();
    } else {
      alert((r && r.error) || 'Failed to update');
      renderIssueDetailModal();
    }
  } finally {
    fieldCommitting = false;
  }
}
window.commitIssueField = commitIssueField;

async function submitDeleteIssue() {
  if (!currentIssue) return;
  if (!confirm(`Delete ${currentIssue.issue_key}? This cannot be undone.`)) return;
  const id = currentIssue.id;
  const r = await api('DELETE', `/api/issues/${encodeURIComponent(id)}`);
  if (r && (r.ok || r.deleted)) {
    closeIssueDetail();
  } else {
    alert((r && r.error) || 'Failed to delete issue');
  }
}
window.submitDeleteIssue = submitDeleteIssue;
