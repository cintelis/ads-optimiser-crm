// ============================================================
// 365 Pulse — Integrations UI (Sprint 5)
// Admin Settings -> Integrations page. Lists Discord webhooks,
// their per-event rules, and the delivery log. Loaded as a
// regular <script> tag after app.js; uses state, api(), esc(),
// setModal(), closeModal(), relTime(), nav() from app.js.
// ============================================================

(function () {
  state.integrations = state.integrations || { items: [], log: [], rulesById: {} };
})();

// ── Event type constants (mirror of worker/events.js) ───────
const SPRINT_5_EVENT_TYPES = [
  { value: 'issue.created',         label: 'Issue created' },
  { value: 'issue.updated',         label: 'Issue updated' },
  { value: 'issue.assigned',        label: 'Issue assigned' },
  { value: 'issue.status_changed',  label: 'Issue status changed' },
  { value: 'issue.commented',       label: 'Issue commented' },
  { value: 'sprint.started',        label: 'Sprint started' },
  { value: 'sprint.completed',      label: 'Sprint completed' },
  { value: 'doc.page_created',      label: 'Doc page created' },
  { value: 'doc.page_updated',      label: 'Doc page updated' },
  { value: 'doc.page_deleted',      label: 'Doc page deleted' },
  { value: 'contact.stage_changed', label: 'Contact stage changed' },
  { value: 'contact.followup_due',  label: 'Contact follow-up due' }
];

function eventTypeLabel(value) {
  const hit = SPRINT_5_EVENT_TYPES.find(e => e.value === value);
  if (hit) return hit.label;
  if (value === 'test') return 'Test message';
  return value || '';
}

function integrationsIsAdmin() { return state.me && state.me.role === 'admin'; }

// ── Loaders ──────────────────────────────────────────────────
async function loadIntegrations() {
  const r = await api('GET', '/api/integrations');
  state.integrations.items = (r && Array.isArray(r.integrations)) ? r.integrations : [];
  // Also refresh the delivery log so both panes render together.
  await loadIntegrationLog();
  // Load rules for each integration in parallel.
  await Promise.all(state.integrations.items.map(it => loadIntegrationRules(it.id)));
}
window.loadIntegrations = loadIntegrations;

async function loadIntegrationLog() {
  const r = await api('GET', '/api/integration-log');
  state.integrations.log = (r && Array.isArray(r.log)) ? r.log
    : (r && Array.isArray(r.entries)) ? r.entries
    : (r && Array.isArray(r.items)) ? r.items
    : [];
}
window.loadIntegrationLog = loadIntegrationLog;

async function loadIntegrationRules(integrationId) {
  const r = await api('GET', `/api/integrations/${encodeURIComponent(integrationId)}/rules`);
  const rules = (r && Array.isArray(r.rules)) ? r.rules : [];
  state.integrations.rulesById[integrationId] = rules;
}
window.loadIntegrationRules = loadIntegrationRules;

// ── Section entry point ──────────────────────────────────────
async function renderIntegrationsSection() {
  const c = document.getElementById('content');
  if (!integrationsIsAdmin()) {
    c.innerHTML = '<div class="page-section"><div class="empty"><p>Integrations is restricted to admins.</p></div></div>';
    return;
  }
  c.innerHTML = '<div class="page-section"><p class="text-muted">Loading integrations\u2026</p></div>';
  await loadIntegrations();
  renderIntegrations();
}
window.renderIntegrationsSection = renderIntegrationsSection;

function renderIntegrations() {
  const c = document.getElementById('content');
  if (!integrationsIsAdmin()) {
    c.innerHTML = '<div class="page-section"><div class="empty"><p>Integrations is restricted to admins.</p></div></div>';
    return;
  }
  const items = state.integrations.items || [];
  const cards = items.length
    ? items.map(renderIntegrationCard).join('')
    : '<div class="empty"><p>No integrations yet. Add a Discord webhook to start receiving notifications.</p></div>';

  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div class="page-actions">
        <div class="page-actions-left"><h2 class="page-section-title">Integrations</h2></div>
        <div class="page-actions-right">
          <button class="btn btn-primary" type="button" onclick="openCreateIntegration()">+ Add Discord webhook</button>
        </div>
      </div>
      <div class="integrations-list" style="margin-top:14px">
        ${cards}
      </div>
      <div class="integrations-log-wrap" style="margin-top:28px">
        <h3 class="page-section-title" style="font-size:16px">Delivery log</h3>
        ${renderIntegrationLogTable()}
      </div>
    </div>
  `;
}
window.renderIntegrations = renderIntegrations;

function renderIntegrationCard(it) {
  const rules = state.integrations.rulesById[it.id] || [];
  const active = it.active ? 'Active' : 'Paused';
  const activeCls = it.active ? 'ok' : 'err';
  const count = Array.isArray(rules) ? rules.length : Number(it.rule_count || 0);
  return `
    <div class="card integration-card" id="integration-card-${esc(it.id)}">
      <div class="card-body">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:10px">
              <strong style="font-size:16px">${esc(it.name || '(unnamed)')}</strong>
              <span class="lozenge">${esc(it.kind || 'discord')}</span>
              <span class="integration-test-result ${activeCls}">${esc(active)}</span>
            </div>
            <div class="text-muted text-sm" style="margin-top:4px">${count} rule${count === 1 ? '' : 's'}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" type="button" onclick="testIntegration('${esc(it.id)}')">Test</button>
            <button class="btn btn-ghost btn-sm" type="button" onclick="openEditIntegration('${esc(it.id)}')">Edit</button>
            <button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" onclick="confirmDeleteIntegration('${esc(it.id)}')">Delete</button>
          </div>
        </div>
        <div class="integration-test-result-slot" id="integration-test-result-${esc(it.id)}" style="margin-top:8px"></div>
        <div class="integration-rules" style="margin-top:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div class="text-muted text-sm" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px">Rules</div>
            <button class="btn btn-ghost btn-sm" type="button" onclick="openAddRule('${esc(it.id)}')">+ Add rule</button>
          </div>
          <div style="margin-top:6px">
            ${renderIntegrationRules(it.id, rules)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderIntegrationRules(integrationId, rules) {
  if (!rules || !rules.length) {
    return '<div class="text-muted text-sm">No rules yet. Add one to route events to this webhook.</div>';
  }
  return rules.map(r => {
    let filter = {};
    try { filter = typeof r.filter === 'string' ? JSON.parse(r.filter || '{}') : (r.filter || {}); }
    catch (e) { filter = {}; }
    const parts = [];
    if (filter.project_id) parts.push(`project=${filter.project_id}`);
    if (filter.space_id) parts.push(`space=${filter.space_id}`);
    const filterText = parts.length ? parts.join(', ') : 'no filter';
    return `
      <div class="integration-rule-row">
        <div class="integration-rule-row-main">
          <span class="lozenge">${esc(eventTypeLabel(r.event_type))}</span>
          <span class="text-muted text-sm" style="margin-left:8px">${esc(filterText)}</span>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" onclick="confirmDeleteRule('${esc(r.id)}', '${esc(integrationId)}')">Remove</button>
      </div>
    `;
  }).join('');
}

function renderIntegrationLogTable() {
  const log = state.integrations.log || [];
  if (!log.length) {
    return '<div class="text-muted text-sm">No dispatches yet.</div>';
  }
  const rows = log.map(row => {
    const status = row.status || '';
    const statusCls = status === 'sent' ? 'ok' : (status === 'failed' ? 'err' : '');
    return `
      <tr>
        <td class="text-muted text-sm">${esc(relTime(row.sent_at))}</td>
        <td>${esc(eventTypeLabel(row.event_type))}</td>
        <td class="text-muted text-sm">${esc(row.entity_type || '')}${row.entity_id ? ' · ' + esc(row.entity_id) : ''}</td>
        <td><span class="integration-test-result ${statusCls}">${esc(status)}</span></td>
        <td class="text-muted text-sm">${esc(row.error || '')}</td>
      </tr>
    `;
  }).join('');
  return `
    <div class="integration-log-table-wrap" style="overflow-x:auto">
      <table class="integration-log-table">
        <thead>
          <tr><th>When</th><th>Event</th><th>Entity</th><th>Status</th><th>Error</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ── Create integration ───────────────────────────────────────
function openCreateIntegration() {
  if (!integrationsIsAdmin()) return;
  setModal(`
    <div class="modal-head"><div class="modal-title">Add Discord webhook</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Name</label>
      <input id="ci-name" type="text" autofocus placeholder="Engineering channel">
      <label style="margin-top:10px">Discord webhook URL</label>
      <input id="ci-url" type="text" placeholder="https://discord.com/api/webhooks/...">
      <div class="form-msg" id="ci-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitCreateIntegration()">Create integration</button>
    </div>
  `);
}
window.openCreateIntegration = openCreateIntegration;

async function submitCreateIntegration() {
  const name = (document.getElementById('ci-name').value || '').trim();
  const webhook_url = (document.getElementById('ci-url').value || '').trim();
  const msg = document.getElementById('ci-msg');
  msg.className = 'form-msg';
  if (!name) { msg.textContent = 'Name is required'; msg.classList.add('form-msg-err'); return; }
  if (!webhook_url) { msg.textContent = 'Webhook URL is required'; msg.classList.add('form-msg-err'); return; }
  const r = await api('POST', '/api/integrations', { kind: 'discord', name, webhook_url });
  if (r && (r.id || r.integration || r.ok)) {
    closeModal();
    await loadIntegrations();
    renderIntegrations();
  } else {
    msg.textContent = (r && r.error) || 'Failed to create integration';
    msg.classList.add('form-msg-err');
  }
}
window.submitCreateIntegration = submitCreateIntegration;

// ── Edit integration ─────────────────────────────────────────
function openEditIntegration(id) {
  const it = (state.integrations.items || []).find(x => x.id === id);
  if (!it) return;
  // The backend stores the webhook URL inside config; surface whatever
  // field name is present.
  let url = '';
  if (it.webhook_url) url = it.webhook_url;
  else if (it.config) {
    try {
      const cfg = typeof it.config === 'string' ? JSON.parse(it.config) : it.config;
      url = (cfg && cfg.webhook_url) || '';
    } catch (e) { url = ''; }
  }
  const activeChecked = it.active ? 'checked' : '';
  setModal(`
    <div class="modal-head"><div class="modal-title">Edit integration — ${esc(it.name || '')}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Name</label>
      <input id="ei-name" type="text" value="${esc(it.name || '')}" autofocus>
      <label style="margin-top:10px">Discord webhook URL</label>
      <input id="ei-url" type="text" value="${esc(url)}" placeholder="https://discord.com/api/webhooks/...">
      <label style="margin-top:10px;display:flex;align-items:center;gap:8px">
        <input id="ei-active" type="checkbox" ${activeChecked}>
        <span>Active</span>
      </label>
      <div class="form-msg" id="ei-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitEditIntegration('${esc(id)}')">Save changes</button>
    </div>
  `);
}
window.openEditIntegration = openEditIntegration;

async function submitEditIntegration(id) {
  const name = (document.getElementById('ei-name').value || '').trim();
  const webhook_url = (document.getElementById('ei-url').value || '').trim();
  const active = document.getElementById('ei-active').checked ? 1 : 0;
  const msg = document.getElementById('ei-msg');
  msg.className = 'form-msg';
  if (!name) { msg.textContent = 'Name is required'; msg.classList.add('form-msg-err'); return; }
  const r = await api('PATCH', `/api/integrations/${encodeURIComponent(id)}`, { name, webhook_url, active });
  if (r && (r.ok || r.id || r.integration)) {
    closeModal();
    await loadIntegrations();
    renderIntegrations();
  } else {
    msg.textContent = (r && r.error) || 'Failed to save integration';
    msg.classList.add('form-msg-err');
  }
}
window.submitEditIntegration = submitEditIntegration;

// ── Delete integration ───────────────────────────────────────
async function confirmDeleteIntegration(id) {
  const it = (state.integrations.items || []).find(x => x.id === id);
  const label = it ? it.name : id;
  if (!confirm(`Delete integration "${label}"? This also removes its rules. Cannot be undone.`)) return;
  const r = await api('DELETE', `/api/integrations/${encodeURIComponent(id)}`);
  if (r && (r.ok || r.deleted)) {
    await loadIntegrations();
    renderIntegrations();
  } else {
    alert((r && r.error) || 'Failed to delete integration');
  }
}
window.confirmDeleteIntegration = confirmDeleteIntegration;

// ── Test integration ─────────────────────────────────────────
async function testIntegration(id) {
  const slot = document.getElementById('integration-test-result-' + id);
  if (slot) slot.innerHTML = '<span class="integration-test-result">Sending test\u2026</span>';
  // IMPORTANT: backend returns HTTP 502 on webhook failure with a JSON body
  // {ok:false, error:...}. Our api() helper swallows the non-2xx and returns
  // the parsed JSON regardless — perfect, we just check json.ok.
  const r = await api('POST', `/api/integrations/${encodeURIComponent(id)}/test`);
  const ok = !!(r && r.ok);
  if (!slot) return;
  if (ok) {
    slot.innerHTML = '<span class="integration-test-result ok">\u2713 Test message sent</span>';
  } else {
    const err = (r && (r.error || r.message)) || 'Unknown error';
    slot.innerHTML = `<span class="integration-test-result err">\u2717 Failed: ${esc(err)}</span>`;
  }
  // Refresh the delivery log so the test row shows up.
  await loadIntegrationLog();
  const logWrap = document.querySelector('.integrations-log-wrap');
  if (logWrap) {
    logWrap.innerHTML = `
      <h3 class="page-section-title" style="font-size:16px">Delivery log</h3>
      ${renderIntegrationLogTable()}
    `;
  }
}
window.testIntegration = testIntegration;

// ── Add rule ─────────────────────────────────────────────────
function openAddRule(integrationId) {
  if (!integrationsIsAdmin()) return;
  // Project options come from state.tasks.projects if loaded; otherwise
  // fall back to a plain text input for the project id.
  const projects = (state.tasks && Array.isArray(state.tasks.projects)) ? state.tasks.projects : [];
  const projectField = projects.length
    ? `<select id="ar-project"><option value="">Any project</option>${projects.map(p => `<option value="${esc(p.id)}">${esc(p.key)} — ${esc(p.name)}</option>`).join('')}</select>`
    : `<input id="ar-project" type="text" placeholder="(optional) project id, e.g. prj_abc">`;

  setModal(`
    <div class="modal-head"><div class="modal-title">Add rule</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Event type</label>
      <select id="ar-event" autofocus>
        ${SPRINT_5_EVENT_TYPES.map(e => `<option value="${esc(e.value)}">${esc(e.label)}</option>`).join('')}
      </select>
      <label style="margin-top:10px">Project filter</label>
      ${projectField}
      <label style="margin-top:10px">Space filter (optional doc space id)</label>
      <input id="ar-space" type="text" placeholder="(optional) space id, e.g. spc_abc">
      <div class="form-msg" id="ar-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitAddRule('${esc(integrationId)}')">Add rule</button>
    </div>
  `);
}
window.openAddRule = openAddRule;

async function submitAddRule(integrationId) {
  const event_type = document.getElementById('ar-event').value;
  const projectEl = document.getElementById('ar-project');
  const spaceEl = document.getElementById('ar-space');
  const project_id = (projectEl && projectEl.value || '').trim();
  const space_id = (spaceEl && spaceEl.value || '').trim();
  const msg = document.getElementById('ar-msg');
  msg.className = 'form-msg';
  if (!event_type) { msg.textContent = 'Event type is required'; msg.classList.add('form-msg-err'); return; }
  const filter = {};
  if (project_id) filter.project_id = project_id;
  if (space_id) filter.space_id = space_id;
  const body = { event_type };
  if (Object.keys(filter).length) body.filter = filter;
  const r = await api('POST', `/api/integrations/${encodeURIComponent(integrationId)}/rules`, body);
  if (r && (r.id || r.rule || r.ok)) {
    closeModal();
    await loadIntegrationRules(integrationId);
    renderIntegrations();
  } else {
    msg.textContent = (r && r.error) || 'Failed to add rule';
    msg.classList.add('form-msg-err');
  }
}
window.submitAddRule = submitAddRule;

// ── Delete rule ──────────────────────────────────────────────
async function confirmDeleteRule(ruleId, integrationId) {
  if (!confirm('Delete this rule?')) return;
  const r = await api('DELETE', `/api/integration-rules/${encodeURIComponent(ruleId)}`);
  if (r && (r.ok || r.deleted)) {
    if (integrationId) await loadIntegrationRules(integrationId);
    renderIntegrations();
  } else {
    alert((r && r.error) || 'Failed to delete rule');
  }
}
window.confirmDeleteRule = confirmDeleteRule;
