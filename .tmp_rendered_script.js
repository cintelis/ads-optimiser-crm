
const API = '';
let token = localStorage.getItem('token');
let state = { templates: [], contacts: [], lists: [], campaigns: [], logs: [], stats: {}, unsubs: [] };
let currentSection = 'overview';

// ── Auth ──────────────────────────────────────────────────────
async function doLogin() {
  const u = document.getElementById('l-user').value;
  const p = document.getElementById('l-pass').value;
  const r = await api('POST','/api/auth/login',{username:u,password:p},false);
  if (r.token) {
    token = r.token;
    localStorage.setItem('token', token);
    document.getElementById('login').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    nav('overview');
  } else {
    document.getElementById('l-err').style.display = 'block';
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Enter' && document.getElementById('login').style.display !== 'none') doLogin(); });
async function doLogout() {
  await api('POST','/api/auth/logout');
  localStorage.removeItem('token');
  location.reload();
}
async function init() {
  if (!token) return;
  const r = await api('GET','/api/auth/check');
  if (!r.ok) { localStorage.removeItem('token'); return; }
  document.getElementById('login').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  // Load follow-up badge count
  api('GET','/api/crm/stats').then(s => {
    const n = s?.followups_due || 0;
    const badge = document.getElementById('fu-badge');
    if (badge && n > 0) { badge.textContent = n; badge.style.display = 'inline'; }
  });
  nav('overview');
}

// ── API helper ────────────────────────────────────────────────
async function api(method, path, body, auth = true) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (auth && token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(API + path, opts);
    return await r.json();
  } catch { return { error: 'Network error' }; }
}

// ── Navigation ────────────────────────────────────────────────
function nav(section) {
  currentSection = section;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('nav-' + section);
  if (el) el.classList.add('active');
  const titles = { overview:'Overview', templates:'Email Templates', contacts:'Contacts', lists:'Contact Lists', campaigns:'Campaigns', logs:'Sent Log', unsubs:'Unsubscribes', pipeline:'Pipeline', followups:'Follow-ups' };
  document.getElementById('page-title').textContent = titles[section] || section;
  renderSection(section);
}
async function refreshCurrent() { nav(currentSection); }

// ── Sections ──────────────────────────────────────────────────
async function renderSection(s) {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="empty"><div class="empty-icon">⋯</div><p>Loading...</p></div>';
  if (s === 'overview') { await loadStats(); await loadLogs(); renderOverview(); }
  else if (s === 'templates') { await loadTemplates(); renderTemplates(); }
  else if (s === 'contacts') { await loadContacts(); renderContacts(); }
  else if (s === 'lists') { await loadLists(); renderLists(); }
  else if (s === 'campaigns') { await Promise.all([loadCampaigns(), loadTemplates(), loadLists()]); renderCampaigns(); }
  else if (s === 'logs') { await loadLogs(); renderLogs(); }
  else if (s === 'unsubs') { await loadUnsubs(); renderUnsubs(); }
  else if (s === 'pipeline') { await Promise.all([loadPipeline(), loadCrmStats()]); renderPipeline(); }
  else if (s === 'followups') { await loadFollowUps(); renderFollowUps(); }
}

// ── Loaders ───────────────────────────────────────────────────
async function loadStats() { state.stats = await api('GET','/api/stats') || {}; }
async function loadTemplates() { state.templates = await api('GET','/api/templates') || []; }
async function loadContacts(q='') { state.contacts = await api('GET','/api/contacts'+(q?'?q='+encodeURIComponent(q):'')) || []; }
async function loadLists() { state.lists = await api('GET','/api/lists') || []; }
async function loadCampaigns() { state.campaigns = await api('GET','/api/campaigns') || []; }
async function loadLogs() { state.logs = await api('GET','/api/logs?limit=200') || []; }
async function loadUnsubs() { state.unsubs = await api('GET','/api/unsubscribes') || []; }

// ── Overview ──────────────────────────────────────────────────
function renderOverview() {
  const s = state.stats;
  const recent = (state.logs.length ? state.logs : []).slice(0,10);
  document.getElementById('content').innerHTML = `
  <div class="stats-grid" style="grid-template-columns:repeat(5,1fr)">
    <div class="stat-card"><div class="stat-label">Active Contacts</div><div class="stat-val">${s.contacts||0}</div></div>
    <div class="stat-card"><div class="stat-label">Templates</div><div class="stat-val">${s.templates||0}</div></div>
    <div class="stat-card"><div class="stat-label">Live Campaigns</div><div class="stat-val">${s.campaigns||0}</div></div>
    <div class="stat-card"><div class="stat-label">Emails Sent</div><div class="stat-val">${s.sent||0}</div></div>
    <div class="stat-card"><div class="stat-label">Pipeline Value</div><div class="stat-val" style="font-size:22px">${fmtCurrency(s.pipeline_value||0)}</div></div>
  </div>
  <div class="table-wrap">
    <table><thead><tr><th>Recipient</th><th>Subject</th><th>Campaign</th><th>Status</th><th>Sent At</th></tr></thead><tbody>
    ${recent.length ? recent.map(l=>`<tr><td class="mono" style="font-size:12px">${l.contact_email}</td><td>${l.subject||'—'}</td><td>${l.campaign_name||'—'}</td><td><span class="badge badge-${l.status}">${l.status}</span></td><td class="text-muted text-sm">${fmtDate(l.sent_at)}</td></tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted2);padding:32px">No emails sent yet.</td></tr>'}
    </tbody></table>
  </div>`; 
}

// ── Templates ─────────────────────────────────────────────────
function renderTemplates() {
  const t = state.templates;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <div style="flex:1"><span class="text-muted text-sm">${t.length} template${t.length!==1?'s':''}</span></div>
    <button class="btn btn-primary" onclick="openTemplateModal()">+ New Template</button>
  </div>
  <div class="table-wrap">
    <table><thead><tr><th>Name</th><th>Subject</th><th>Updated</th><th style="width:130px">Actions</th></tr></thead><tbody>
    ${t.length ? t.map(r=>`<tr>
      <td style="font-weight:600">${esc(r.name)}</td>
      <td class="text-muted">${esc(r.subject)}</td>
      <td class="text-muted text-sm">${fmtDate(r.updated_at)}</td>
      <td><div class="flex gap"><button class="btn btn-ghost btn-sm" onclick="editTemplate('${r.id}')">Edit</button><button class="btn btn-danger btn-sm" onclick="deleteTemplate('${r.id}')">Del</button></div></td>
    </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--muted2);padding:32px">No templates yet. Create your first.</td></tr>'}
    </tbody></table>
  </div>`;
}

function openTemplateModal(tmpl) {
  const t = tmpl || { id:'', name:'', subject:'', html_body:'' };
  setModal(`<div class="modal-head"><h3>${t.id?'Edit Template':'New Template'}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-group"><label>Template Name</label><input id="t-name" value="${esc(t.name)}" placeholder="e.g. AI Outreach — Intro"></div>
    <div class="form-group"><label>Email Subject</label><input id="t-subj" value="${esc(t.subject)}" placeholder="Subject line..."></div>
    <div class="form-group"><label>HTML Body <span class="text-muted text-sm">(use {{name}}, {{email}}, {{company}})</span></label><textarea id="t-body" style="min-height:240px">${esc(t.html_body)}</textarea></div>
    <div class="alert alert-error" id="t-err"></div>
    <div class="flex gap" style="justify-content:flex-end;margin-top:8px">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTemplate('${t.id}')">Save Template</button>
    </div>
  </div>`);
}

async function editTemplate(id) {
  const r = await api('GET',`/api/templates`);
  const t = (r||[]).find(x=>x.id===id);
  if (t) {
    const full = await api('GET','/api/templates');
    // re-fetch to get html_body
    const tfull = await fetch(API+'/api/templates', {headers:{'Authorization':'Bearer '+token}});
    const all = await tfull.json();
    const tmpl = all.find(x=>x.id===id);
    // need to get full template with html_body - fetch individual
    openTemplateModal(tmpl || t);
  }
}

async function saveTemplate(id) {
  const name = document.getElementById('t-name').value.trim();
  const subject = document.getElementById('t-subj').value.trim();
  const html_body = document.getElementById('t-body').value.trim();
  if (!name || !subject || !html_body) { showAlert('t-err','All fields required'); return; }
  const r = id ? await api('PUT',`/api/templates/${id}`,{name,subject,html_body}) : await api('POST','/api/templates',{name,subject,html_body});
  if (r.error) { showAlert('t-err', r.error); return; }
  closeModal(); await loadTemplates(); renderTemplates();
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  await api('DELETE',`/api/templates/${id}`);
  await loadTemplates(); renderTemplates();
}

// ── Contacts ──────────────────────────────────────────────────
function renderContacts(q='') {
  const ct = state.contacts;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <input class="search-box" placeholder="Search email, name, company..." value="${esc(q)}" oninput="searchContacts(this.value)" style="max-width:320px">
    <div style="flex:1"><span class="text-muted text-sm">${ct.length} contact${ct.length!==1?'s':''}</span></div>
    <button class="btn btn-ghost" onclick="openImportModal()">⬆ Import CSV</button>
    <button class="btn btn-primary" onclick="openContactModal()">+ Add Contact</button>
  </div>
  <div class="table-wrap">
    <table><thead><tr><th>Email</th><th>Name</th><th>Company</th><th>Added</th><th style="width:110px">Actions</th></tr></thead><tbody>
    ${ct.length ? ct.map(c=>`<tr>
      <td class="mono" style="font-size:12px">${esc(c.email)}</td>
      <td>${esc(c.name)||'—'}</td>
      <td class="text-muted">${esc(c.company)||'—'}</td>
      <td class="text-muted text-sm">${fmtDate(c.created_at)}</td>
      <td><div class="flex gap"><button class="btn btn-ghost btn-sm" onclick="editContact('${c.id}','${esc(c.name)}','${esc(c.company)}')">Edit</button><button class="btn btn-danger btn-sm" onclick="deleteContact('${c.id}')">Del</button></div></td>
    </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted2);padding:32px">No contacts yet.</td></tr>'}
    </tbody></table>
  </div>`;
}

async function searchContacts(q) { await loadContacts(q); renderContacts(q); }

function openContactModal(c) {
  const ct = c || { id:'', email:'', name:'', company:'' };
  setModal(`<div class="modal-head"><h3>${ct.id?'Edit Contact':'Add Contact'}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-group"><label>Email *</label><input id="c-email" type="email" value="${esc(ct.email)}" placeholder="contact@example.com" ${ct.id?'readonly':''}></div>
    <div class="form-row">
      <div class="form-group"><label>Name</label><input id="c-name" value="${esc(ct.name)}" placeholder="Full name"></div>
      <div class="form-group"><label>Company</label><input id="c-company" value="${esc(ct.company)}" placeholder="Company name"></div>
    </div>
    <div class="alert alert-error" id="c-err"></div>
    <div class="flex gap" style="justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveContact('${ct.id}')">Save</button>
    </div>
  </div>`);
}

function editContact(id, name, company) { openContactModal({ id, name, company, email: '' }); }

async function saveContact(id) {
  const email = document.getElementById('c-email')?.value.trim();
  const name = document.getElementById('c-name').value.trim();
  const company = document.getElementById('c-company').value.trim();
  let r;
  if (id) r = await api('PUT',`/api/contacts/${id}`,{name,company});
  else { if (!email) { showAlert('c-err','Email required'); return; } r = await api('POST','/api/contacts',{email,name,company}); }
  if (r.error) { showAlert('c-err', r.error); return; }
  closeModal(); await loadContacts(); renderContacts();
}

async function deleteContact(id) {
  if (!confirm('Delete this contact?')) return;
  await api('DELETE',`/api/contacts/${id}`);
  await loadContacts(); renderContacts();
}

function openImportModal() {
  setModal(`<div class="modal-head"><h3>Import Contacts (CSV)</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <p class="text-muted text-sm" style="margin-bottom:12px">CSV must have an <strong>email</strong> column. Optional columns: <strong>name</strong>, <strong>company</strong>.</p>
    <div class="form-group"><label>Paste CSV or upload file</label>
      <textarea id="csv-data" placeholder="email,name,company&#10;john@example.com,John Smith,Acme Corp" style="min-height:180px"></textarea>
    </div>
    <input type="file" id="csv-file" accept=".csv" style="display:none" onchange="readCsv(this)">
    <div class="flex gap" style="margin-bottom:12px"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('csv-file').click()">📎 Upload CSV file</button></div>
    <div class="alert alert-error" id="imp-err"></div>
    <div class="alert alert-success" id="imp-ok"></div>
    <div class="flex gap" style="justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="doImport()">Import</button>
    </div>
  </div>`);
}

function readCsv(input) {
  const f = input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = e => { document.getElementById('csv-data').value = e.target.result; };
  r.readAsText(f);
}

async function doImport() {
  const csv = document.getElementById('csv-data').value.trim();
  if (!csv) { showAlert('imp-err','Paste CSV data first'); return; }
  const r = await api('POST','/api/contacts/import',{csv});
  if (r.error) { showAlert('imp-err',r.error); return; }
  showAlert('imp-ok',`Imported ${r.imported} contacts, skipped ${r.skipped}`,'alert-success');
  await loadContacts();
}

// ── Lists ─────────────────────────────────────────────────────
function renderLists() {
  const ls = state.lists;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <div style="flex:1"></div>
    <button class="btn btn-primary" onclick="openListModal()">+ New List</button>
  </div>
  <div class="table-wrap">
    <table><thead><tr><th>List Name</th><th>Description</th><th>Members</th><th>Created</th><th style="width:160px">Actions</th></tr></thead><tbody>
    ${ls.length ? ls.map(l=>`<tr>
      <td style="font-weight:600">${esc(l.name)}</td>
      <td class="text-muted">${esc(l.description)||'—'}</td>
      <td><span class="badge badge-active">${l.cnt||0}</span></td>
      <td class="text-muted text-sm">${fmtDate(l.created_at)}</td>
      <td><div class="flex gap"><button class="btn btn-ghost btn-sm" onclick="viewList('${l.id}','${esc(l.name)}')">Manage</button><button class="btn btn-danger btn-sm" onclick="deleteList('${l.id}')">Del</button></div></td>
    </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted2);padding:32px">No lists yet.</td></tr>'}
    </tbody></table>
  </div>`;
}

function openListModal() {
  setModal(`<div class="modal-head"><h3>New Contact List</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-group"><label>List Name *</label><input id="l-name" placeholder="e.g. AI Startup Founders"></div>
    <div class="form-group"><label>Description</label><input id="l-desc" placeholder="Optional description"></div>
    <div class="alert alert-error" id="l-err"></div>
    <div class="flex gap" style="justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveList()">Create List</button>
    </div>
  </div>`);
}

async function saveList() {
  const name = document.getElementById('l-name').value.trim();
  const description = document.getElementById('l-desc').value.trim();
  if (!name) { showAlert('l-err','Name required'); return; }
  const r = await api('POST','/api/lists',{name,description});
  if (r.error) { showAlert('l-err',r.error); return; }
  closeModal(); await loadLists(); renderLists();
}

async function deleteList(id) {
  if (!confirm('Delete this list?')) return;
  await api('DELETE',`/api/lists/${id}`);
  await loadLists(); renderLists();
}

async function viewList(id, name) {
  const members = await api('GET',`/api/lists/${id}/contacts`) || [];
  const all = state.contacts;
  const memberIds = new Set(members.map(m=>m.id));
  const available = all.filter(c=>!memberIds.has(c.id));
  setModal(`<div class="modal-head"><h3>List: ${esc(name)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div style="margin-bottom:16px">
      <label style="font-size:12px;color:var(--muted2);text-transform:uppercase;letter-spacing:.7px;display:block;margin-bottom:6px">Add contacts to list</label>
      <div class="flex gap">
        <select id="add-contact" style="flex:1;background:#0d0d15;border:1px solid var(--border2);border-radius:8px;padding:8px 12px;color:var(--text);font-size:13px">
          <option value="">— select a contact —</option>
          ${available.map(c=>`<option value="${c.id}">${esc(c.email)}${c.name?' ('+esc(c.name)+')':''}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="addContactToList('${id}')">Add</button>
      </div>
    </div>
    <div class="table-wrap">
      <table><thead><tr><th>Email</th><th>Name</th><th>Company</th><th></th></tr></thead>
      <tbody id="list-members">
      ${members.length ? members.map(m=>`<tr><td class="mono" style="font-size:12px">${esc(m.email)}</td><td>${esc(m.name)||'—'}</td><td class="text-muted">${esc(m.company)||'—'}</td><td><button class="btn btn-danger btn-sm" onclick="removeFromList('${id}','${m.id}','${esc(name)}')">Remove</button></td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--muted2);padding:24px">No members yet.</td></tr>'}
      </tbody></table>
    </div>
  </div>`);
}

async function addContactToList(listId) {
  const cid = document.getElementById('add-contact').value;
  if (!cid) return;
  await api('POST',`/api/lists/${listId}/contacts`,{contact_ids:[cid]});
  const list = state.lists.find(l=>l.id===listId);
  await viewList(listId, list?.name||'');
}

async function removeFromList(listId, contactId, name) {
  await api('DELETE',`/api/lists/${listId}/contacts/${contactId}`);
  await viewList(listId, name);
}

// ── Campaigns ─────────────────────────────────────────────────
function renderCampaigns() {
  const cs = state.campaigns;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <div style="flex:1"><span class="text-muted text-sm">${cs.length} campaign${cs.length!==1?'s':''}</span></div>
    <button class="btn btn-primary" onclick="openCampaignModal()">+ New Campaign</button>
  </div>
  <div class="table-wrap">
    <table><thead><tr><th>Name</th><th>List</th><th>Type</th><th>Status</th><th style="width:220px">Actions</th></tr></thead><tbody>
    ${cs.length ? cs.map(c=>`<tr>
      <td style="font-weight:600">${esc(c.name)}</td>
      <td class="text-muted">${esc(c.list_name||'—')}</td>
      <td><span class="badge badge-draft" style="background:rgba(0,200,255,.08);color:var(--cyan)">${c.schedule_type}</span></td>
      <td><span class="badge badge-${c.status}">${c.status}</span></td>
      <td><div class="flex gap">
        ${c.status==='active'?`<button class="btn btn-ghost btn-sm" onclick="setCampaignStatus('${c.id}','pause')">Pause</button>`:''}
        ${c.status==='paused'||c.status==='draft'?`<button class="btn btn-success btn-sm" onclick="setCampaignStatus('${c.id}','activate')">Activate</button>`:''}
        <button class="btn btn-primary btn-sm" onclick="sendCampaignNow('${c.id}','${esc(c.name)}')">▶ Send</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCampaign('${c.id}')">Del</button>
      </div></td>
    </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted2);padding:32px">No campaigns yet.</td></tr>'}
    </tbody></table>
  </div>`;
}

let campaignSteps = [{ template_id: '', delay_days: 0 }];

function openCampaignModal() {
  campaignSteps = [{ template_id: '', delay_days: 0 }];
  renderCampaignModal();
}

function renderCampaignModal() {
  const tOpts = state.templates.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
  const lOpts = state.lists.map(l=>`<option value="${l.id}">${esc(l.name)} (${l.cnt||0} contacts)</option>`).join('');
  setModal(`<div class="modal-head"><h3>New Campaign</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-row">
      <div class="form-group"><label>Campaign Name *</label><input id="ca-name" placeholder="e.g. AI Outreach Q2"></div>
      <div class="form-group"><label>Contact List *</label><select id="ca-list"><option value="">— Select list —</option>${lOpts}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>From Name</label><input id="ca-from-name" value="Nick | 365Soft Labs" placeholder="Sender name"></div>
      <div class="form-group"><label>From Email</label><input id="ca-from-email" value="nick@365softlabs.com" placeholder="sender@example.com"></div>
    </div>
    <div class="form-group"><label>Schedule Type *</label>
      <select id="ca-type" onchange="renderScheduleFields()">
        <option value="immediate">Send Immediately (on demand)</option>
        <option value="once">Send Once — at a specific time</option>
        <option value="recurring">Recurring — daily/weekly</option>
        <option value="drip">Drip Sequence — staggered multi-email</option>
      </select>
    </div>
    <div id="schedule-fields"></div>
    <div class="form-group" style="margin-top:4px">
      <label>Email Steps <button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="addStep()">+ Add Step</button></label>
      <div class="steps-list" id="steps-list">${renderSteps(tOpts)}</div>
    </div>
    <div class="alert alert-error" id="ca-err"></div>
    <div class="flex gap" style="justify-content:flex-end;margin-top:8px">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCampaign()">Create Campaign</button>
    </div>
  </div>`);
  renderScheduleFields();
}

function renderScheduleFields() {
  const type = document.getElementById('ca-type')?.value;
  const c = document.getElementById('schedule-fields');
  if (!c) return;
  if (type === 'once') c.innerHTML = `<div class="form-group"><label>Send At</label><input type="datetime-local" id="sch-send-at"></div>`;
  else if (type === 'recurring') c.innerHTML = `<div class="form-row"><div class="form-group"><label>First Send</label><input type="datetime-local" id="sch-send-at"></div><div class="form-group"><label>Repeat every (days)</label><input type="number" id="sch-interval" value="7" min="1"></div></div>`;
  else c.innerHTML = '';
}

function renderSteps(tOpts) {
  return campaignSteps.map((s,i)=>`<div class="step-item">
    <div class="step-num">${i+1}</div>
    <div style="flex:1">
      <div class="form-row" style="margin-bottom:0">
        <div class="form-group" style="margin-bottom:0"><label>Template</label><select onchange="campaignSteps[${i}].template_id=this.value"><option value="">— select —</option>${tOpts.replace('value="'+s.template_id+'"','value="'+s.template_id+'" selected')}</select></div>
        <div class="form-group" style="margin-bottom:0"><label>${i===0?'Send immediately':'Delay (days after prev)' }</label><input type="number" value="${s.delay_days}" min="0" onchange="campaignSteps[${i}].delay_days=parseInt(this.value)||0" ${i===0?'disabled':''}></div>
      </div>
    </div>
    ${campaignSteps.length>1?'<button class="btn btn-danger btn-sm" onclick="removeStep('+i+')">✕</button>':''}
  </div>`).join('');
}

function addStep() { campaignSteps.push({ template_id:'', delay_days:1 }); refreshSteps(); }
function removeStep(i) { campaignSteps.splice(i,1); refreshSteps(); }
function refreshSteps() {
  const tOpts = state.templates.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
  document.getElementById('steps-list').innerHTML = renderSteps(tOpts);
}

async function saveCampaign() {
  const name = document.getElementById('ca-name').value.trim();
  const list_id = document.getElementById('ca-list').value;
  const schedule_type = document.getElementById('ca-type').value;
  const from_name = document.getElementById('ca-from-name').value.trim();
  const from_email = document.getElementById('ca-from-email').value.trim();
  if (!name || !list_id) { showAlert('ca-err','Campaign name and list are required'); return; }
  // Sync template selections from selects
  document.querySelectorAll('#steps-list select').forEach((sel,i)=>{ if(campaignSteps[i]) campaignSteps[i].template_id=sel.value; });
  if (campaignSteps.some(s=>!s.template_id)) { showAlert('ca-err','All steps need a template selected'); return; }
  let schedule_config = {};
  if (schedule_type==='once') {
    const sa = document.getElementById('sch-send-at')?.value;
    if (!sa) { showAlert('ca-err','Select a send time'); return; }
    schedule_config = { send_at: new Date(sa).toISOString() };
  } else if (schedule_type==='recurring') {
    const sa = document.getElementById('sch-send-at')?.value;
    const interval = parseInt(document.getElementById('sch-interval')?.value)||7;
    if (!sa) { showAlert('ca-err','Select a first send time'); return; }
    schedule_config = { next_run: new Date(sa).toISOString(), interval_days: interval };
  }
  const r = await api('POST','/api/campaigns',{name,list_id,schedule_type,schedule_config,steps:campaignSteps,from_name,from_email});
  if (r.error) { showAlert('ca-err',r.error); return; }
  closeModal(); await loadCampaigns(); renderCampaigns();
}

async function sendCampaignNow(id, name) {
  if (!confirm(`Send campaign "${name}" to all contacts in the list right now?`)) return;
  const r = await api('POST',`/api/campaigns/${id}/send`);
  if (r.error) { alert('Error: '+r.error); return; }
  alert(`Done! Sent: ${r.sent}, Skipped (unsubscribed): ${r.skipped||0}, Failed: ${r.failed}`);
  await loadCampaigns(); renderCampaigns();
}

async function setCampaignStatus(id, action) {
  await api('POST',`/api/campaigns/${id}/${action}`);
  await loadCampaigns(); renderCampaigns();
}

async function deleteCampaign(id) {
  if (!confirm('Delete this campaign?')) return;
  await api('DELETE',`/api/campaigns/${id}`);
  await loadCampaigns(); renderCampaigns();
}

// ── Logs ──────────────────────────────────────────────────────
function renderLogs() {
  const l = state.logs;
  document.getElementById('content').innerHTML = `
  <div class="toolbar"><div style="flex:1"><span class="text-muted text-sm">${l.length} entries</span></div></div>
  <div class="table-wrap">
    <table><thead><tr><th>Recipient</th><th>Subject</th><th>Campaign</th><th>Template</th><th>Status</th><th>Sent At</th></tr></thead><tbody>
    ${l.length ? l.map(r=>`<tr>
      <td class="mono" style="font-size:12px">${esc(r.contact_email)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.subject||'—')}</td>
      <td class="text-muted">${esc(r.campaign_name||'—')}</td>
      <td class="text-muted">${esc(r.template_name||'—')}</td>
      <td><span class="badge badge-${r.status}">${r.status}${r.error?'<span title="'+esc(r.error)+'" style="cursor:help;margin-left:4px">ⓘ</span>':''}</span></td>
      <td class="text-muted text-sm">${fmtDate(r.sent_at)}</td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted2);padding:32px">No sent emails yet.</td></tr>'}
    </tbody></table>
  </div>`;
}

// ── Unsubscribes ──────────────────────────────────────────────
function renderUnsubs() {
  const u = state.unsubs;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <div style="flex:1"><span class="text-muted text-sm">${u.length} unsubscribed</span></div>
    <span class="text-muted text-sm" style="font-style:italic">Managed by the email worker · <a href="https://365soft-email-worker.nick-598.workers.dev/unsubscribe" target="_blank" style="color:var(--cyan)">Unsubscribe page ↗</a></span>
  </div>
  <div class="table-wrap">
    <table><thead><tr><th>Email</th><th>Unsubscribed At</th><th>IP</th><th>Source</th></tr></thead><tbody>
    ${u.length ? u.map(c=>`<tr>
      <td class="mono" style="font-size:12px">${esc(c.email)}</td>
      <td class="text-muted text-sm">${fmtDate(c.unsubscribedAt||c.unsubscribed_at)}</td>
      <td class="text-muted text-sm mono">${esc(c.ip||'—')}</td>
      <td class="text-muted text-sm">${esc(c.source||'—')}</td>
    </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--muted2);padding:32px">No unsubscribes. 🎉</td></tr>'}
    </tbody></table>
  </div>`;
}

// ── Modal helpers ─────────────────────────────────────────────
function setModal(html) {
  document.getElementById('modal-inner').innerHTML = html;
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }
document.getElementById('modal').addEventListener('click', e => { if(e.target.id==='modal') closeModal(); });

// ── Utils ─────────────────────────────────────────────────────
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function fmtDate(s) { if(!s) return '—'; try { return new Date(s).toLocaleString('en-AU',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return s; } }
function showAlert(id, msg, cls='alert-error') {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'alert ' + cls;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(()=>el.style.display='none', 4000);
}

// ── CRM ───────────────────────────────────────────────────────
const STAGE_LABELS = { lead:'Lead', prospect:'Prospect', qualified:'Qualified', proposal:'Proposal', won:'Won', lost:'Lost' };
const STAGE_ORDER = ['lead','prospect','qualified','proposal','won','lost'];

async function loadPipeline() { state.pipeline = await api('GET','/api/crm/pipeline') || {}; }
async function loadCrmStats() { state.crmStats = await api('GET','/api/crm/stats') || {}; }
async function loadFollowUps() { state.followups = await api('GET','/api/crm/followups') || []; }

// ── Pipeline Board ────────────────────────────────────────────
function renderPipeline() {
  const p = state.pipeline || {};
  const cs = state.crmStats?.stages || {};
  const totalValue = STAGE_ORDER.filter(s=>s!=='lost').reduce((a,s)=>(a+(cs[s]?.value||0)),0);
  document.getElementById('content').innerHTML = `
  <div class="toolbar" style="margin-bottom:20px">
    <div style="flex:1">
      <span style="font-family:var(--font-head);font-size:13px;color:var(--muted2)">Pipeline Value: </span>
      <span style="font-family:var(--font-head);font-size:16px;font-weight:700;color:var(--green)">${fmtCurrency(totalValue)}</span>
    </div>
    <button class="btn btn-primary" onclick="openContactModal()">+ Add Contact</button>
  </div>
  <div class="pipeline">
    ${STAGE_ORDER.map(stage => {
      const cards = p[stage] || [];
      const stageVal = cs[stage]?.value || 0;
      return `<div class="pipeline-col stage-${stage}">
        <div class="pipeline-head">
          <span class="pipeline-title">${STAGE_LABELS[stage]}</span>
          <span class="pipeline-meta">${cards.length}${stageVal>0?' · '+fmtCurrency(stageVal):''}</span>
        </div>
        <div class="pipeline-cards">
          ${cards.map(c=>`<div class="pipeline-card" onclick="openDrawer('${c.id}')">
            <div class="pipeline-card-name">${esc(c.name||c.email)}</div>
            <div class="pipeline-card-company">${esc(c.company||c.email)}</div>
            ${c.deal_value>0?`<div class="pipeline-card-value">${fmtCurrency(c.deal_value)}</div>`:''}
            ${(c.tags||[]).length?`<div class="pipeline-card-tags">${c.tags.slice(0,3).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`:''}
            ${c.follow_up_at&&isOverdue(c.follow_up_at)?`<div style="font-size:10px;color:var(--pink);margin-top:5px">⏰ Follow-up overdue</div>`:''}
          </div>`).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ── Follow-ups ────────────────────────────────────────────────
function renderFollowUps() {
  const fu = state.followups || [];
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('content').innerHTML = `
  <div class="toolbar"><div style="flex:1"><span class="text-muted text-sm">${fu.length} due</span></div></div>
  ${fu.length ? fu.map(c=>`
  <div class="followup-card ${isOverdue(c.follow_up_at)?'followup-overdue':''}" onclick="openDrawer('${c.id}')">
    <div style="width:40px;height:40px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">
      ${(c.name||c.email||'?')[0].toUpperCase()}
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:600;font-size:14px">${esc(c.name||c.email)}</div>
      <div class="text-muted text-sm">${esc(c.company||'')} · <span class="badge badge-draft">${STAGE_LABELS[c.stage]||c.stage}</span></div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:12px;${isOverdue(c.follow_up_at)?'color:var(--red)':'color:var(--amber)'};font-weight:600">${fmtDate(c.follow_up_at)}</div>
      ${c.deal_value>0?`<div style="font-size:11px;color:var(--green)">${fmtCurrency(c.deal_value)}</div>`:''}
    </div>
  </div>`).join('') : `<div class="empty"><div class="empty-icon">✓</div><p>No follow-ups due — you're all caught up!</p></div>`}
  `;
}

// ── Contact Drawer ────────────────────────────────────────────
let currentDrawerContactId = null;

async function openDrawer(contactId) {
  currentDrawerContactId = contactId;
  document.getElementById('drawer-bg').classList.add('open');
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-body').innerHTML = `<div class="empty"><div class="empty-icon">⋯</div><p>Loading...</p></div>`;
  document.getElementById('drawer-name').textContent = '...';
  document.getElementById('drawer-company').textContent = '';
  const d = await api('GET',`/api/crm/contact/${contactId}`);
  if (d.error) { document.getElementById('drawer-body').innerHTML = `<p style="color:var(--red)">${d.error}</p>`; return; }
  renderDrawerContent(d);
}

function renderDrawerContent(d) {
  const c = d.contact;
  document.getElementById('drawer-name').textContent = c.name || c.email;
  document.getElementById('drawer-company').textContent = c.company || '';
  const tags = c.tags || [];
  document.getElementById('drawer-body').innerHTML = `
  <!-- Stage + value row -->
  <div class="drawer-section">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <select class="stage-select" onchange="patchContact('${c.id}','stage',this.value)">
        ${STAGE_ORDER.map(s=>`<option value="${s}" ${c.stage===s?'selected':''}>${STAGE_LABELS[s]}</option>`).join('')}
      </select>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="text-muted text-sm">Deal value $</span>
        <input type="number" value="${c.deal_value||0}" min="0" step="100" style="width:110px;background:#0d0d15;border:1px solid var(--border2);border-radius:6px;padding:5px 10px;color:var(--text);font-size:13px" onchange="patchContact('${c.id}','deal_value',parseFloat(this.value)||0)">
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="text-muted text-sm">Follow-up</span>
        <input type="date" value="${(c.follow_up_at||'').split('T')[0]}" style="background:#0d0d15;border:1px solid var(--border2);border-radius:6px;padding:5px 10px;color:var(--text);font-size:12px" onchange="patchContact('${c.id}','follow_up_at',this.value?this.value+'T00:00:00Z':null)">
      </div>
    </div>
  </div>

  <!-- Contact info -->
  <div class="drawer-section">
    <div class="drawer-section-title">Contact Info <button class="btn btn-ghost btn-sm" onclick="openContactEditModal('${c.id}')">Edit</button></div>
    <div class="info-grid">
      <div class="info-item"><label>Email</label><span class="mono" style="font-size:12px">${esc(c.email)}</span></div>
      <div class="info-item"><label>Phone</label><span>${esc(c.phone||'—')}</span></div>
      <div class="info-item"><label>Company</label><span>${esc(c.company||'—')}</span></div>
      <div class="info-item"><label>LinkedIn</label>${c.linkedin?`<a href="${esc(c.linkedin)}" target="_blank" style="color:var(--cyan);font-size:12px">View Profile ↗</a>`:'<span>—</span>'}</div>
      <div class="info-item"><label>Last Contacted</label><span class="text-sm">${c.last_contacted_at?fmtDate(c.last_contacted_at):'Never'}</span></div>
      <div class="info-item"><label>Added</label><span class="text-sm">${fmtDate(c.created_at)}</span></div>
    </div>
    ${tags.length?`<div style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap">${tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}<button class="btn btn-ghost btn-sm" onclick="editTags('${c.id}',${JSON.stringify(tags).replace(/'/g,'&#39;')})">+ Tags</button></div>`
    :`<button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="editTags('${c.id}',${JSON.stringify(tags)})">+ Add Tags</button>`}
  </div>

  <!-- Notes -->
  <div class="drawer-section">
    <div class="drawer-section-title">Activity & Notes</div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <select id="note-type" style="background:#0d0d15;border:1px solid var(--border2);border-radius:6px;padding:6px 10px;color:var(--text);font-size:12px">
        <option value="note">📝 Note</option><option value="call">📞 Call</option><option value="meeting">🤝 Meeting</option><option value="email">✉ Email</option>
      </select>
      <input id="note-input" placeholder="Log an activity or note..." style="flex:1;background:#0d0d15;border:1px solid var(--border2);border-radius:6px;padding:6px 12px;color:var(--text);font-size:13px" onkeydown="if(event.key==='Enter')addNoteFromDrawer('${c.id}')">
      <button class="btn btn-primary btn-sm" onclick="addNoteFromDrawer('${c.id}')">Add</button>
    </div>
    <div id="notes-list">
    ${d.notes.length ? d.notes.map(n=>`<div class="note-item" id="note-${n.id}">
      <span class="note-type note-${n.type}">${n.type}</span>
      <div class="note-content">${esc(n.content)}</div>
      <div class="flex" style="justify-content:space-between;align-items:center;margin-top:4px">
        <span class="note-date">${fmtDate(n.created_at)}</span>
        <button class="btn btn-danger btn-sm" style="padding:2px 8px" onclick="deleteNoteFromDrawer('${c.id}','${n.id}')">✕</button>
      </div>
    </div>`).join('') : '<p class="text-muted text-sm">No notes yet.</p>'}
    </div>
  </div>

  <!-- Email history -->
  <div class="drawer-section">
    <div class="drawer-section-title">Email History (${d.emails.length})</div>
    ${d.emails.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Subject</th><th>Status</th><th>Sent At</th></tr></thead>
      <tbody>${d.emails.map(e=>`<tr>
        <td style="font-size:12px">${esc(e.subject||'—')}</td>
        <td><span class="badge badge-${e.status}">${e.status}</span></td>
        <td class="text-muted text-sm">${fmtDate(e.sent_at)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p class="text-muted text-sm">No emails sent yet.</p>'}
  </div>

  <!-- Lists -->
  ${d.lists.length?`<div class="drawer-section"><div class="drawer-section-title">Lists</div><div style="display:flex;gap:6px;flex-wrap:wrap">${d.lists.map(l=>`<span class="badge badge-active">${esc(l)}</span>`).join('')}</div></div>`:''}
  `;
}

async function patchContact(id, field, value) {
  await api('PATCH',`/api/crm/contact/${id}`,{ [field]: value });
  // Refresh pipeline silently if open
  if (currentSection==='pipeline') { await loadPipeline(); renderPipeline(); }
  if (currentSection==='followups') { await loadFollowUps(); renderFollowUps(); }
}

async function addNoteFromDrawer(contactId) {
  const content = document.getElementById('note-input')?.value?.trim();
  const type = document.getElementById('note-type')?.value || 'note';
  if (!content) return;
  const r = await api('POST',`/api/crm/contact/${contactId}/notes`,{content,type});
  if (r.error) return;
  document.getElementById('note-input').value = '';
  // Prepend new note
  const nl = document.getElementById('notes-list');
  if (nl) {
    const div = document.createElement('div');
    div.className = 'note-item'; div.id = 'note-'+r.id;
    div.innerHTML = `<span class="note-type note-${r.type}">${r.type}</span><div class="note-content">${esc(r.content)}</div><div class="flex" style="justify-content:space-between;align-items:center;margin-top:4px"><span class="note-date">just now</span><button class="btn btn-danger btn-sm" style="padding:2px 8px" onclick="deleteNoteFromDrawer('${contactId}','${r.id}')">✕</button></div>`;
    nl.prepend(div);
  }
}

async function deleteNoteFromDrawer(contactId, noteId) {
  await api('DELETE',`/api/crm/contact/${contactId}/notes/${noteId}`);
  const el = document.getElementById('note-'+noteId);
  if (el) el.remove();
}

function openContactEditModal(id) {
  const c = Object.values(state.pipeline||{}).flat().find(x=>x.id===id) || {};
  setModal(`<div class="modal-head"><h3>Edit Contact</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-row">
      <div class="form-group"><label>Name</label><input id="ce-name" value="${esc(c.name||'')}"></div>
      <div class="form-group"><label>Company</label><input id="ce-company" value="${esc(c.company||'')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Phone</label><input id="ce-phone" value="${esc(c.phone||'')}"></div>
      <div class="form-group"><label>LinkedIn URL</label><input id="ce-linkedin" value="${esc(c.linkedin||'')}"></div>
    </div>
    <div class="flex gap" style="justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveContactEdit('${id}')">Save</button>
    </div>
  </div>`);
}

async function saveContactEdit(id) {
  const name = document.getElementById('ce-name').value.trim();
  const company = document.getElementById('ce-company').value.trim();
  const phone = document.getElementById('ce-phone').value.trim();
  const linkedin = document.getElementById('ce-linkedin').value.trim();
  await api('PATCH',`/api/crm/contact/${id}`,{name,company,phone,linkedin});
  closeModal();
  openDrawer(id);
}

function editTags(id, tags) {
  setModal(`<div class="modal-head"><h3>Edit Tags</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <p class="text-muted text-sm" style="margin-bottom:12px">Comma-separated tags, e.g: saas, founder, hot-lead</p>
    <div class="form-group"><label>Tags</label><input id="tag-input" value="${esc(tags.join(', '))}"></div>
    <div class="flex gap" style="justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTags('${id}')">Save</button>
    </div>
  </div>`);
}

async function saveTags(id) {
  const raw = document.getElementById('tag-input').value;
  const tags = raw.split(',').map(t=>t.trim()).filter(Boolean);
  await api('PATCH',`/api/crm/contact/${id}`,{tags});
  closeModal();
  openDrawer(id);
}

function closeDrawer() {
  document.getElementById('drawer-bg').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
  currentDrawerContactId = null;
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) <= new Date();
}

function fmtCurrency(v) {
  if (!v) return '$0';
  if (v >= 1000) return '$' + (v/1000).toFixed(v%1000===0?0:1) + 'k';
  return '$' + v.toLocaleString();
}

init();
