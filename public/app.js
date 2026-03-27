
const API = '';
const SECTION_TITLES = {
  overview: 'Overview',
  templates: 'Email Templates',
  contacts: 'Contacts',
  lists: 'Contact Lists',
  campaigns: 'Campaigns',
  logs: 'Sent Log',
  unsubs: 'Unsubscribes',
  pipeline: 'Pipeline',
  followups: 'Follow-ups'
};
const PRIMARY_MOBILE_SECTIONS = new Set(['overview', 'contacts', 'pipeline', 'followups']);
const SECONDARY_MOBILE_SECTIONS = ['templates', 'lists', 'campaigns', 'logs', 'unsubs'];
const REAL_ESTATE_TEMPLATE_SEED_KEY = 'crm_seed_ads_optimiser_real_estate_collection_v5';
const TEMPLATE_PREVIEW_WIDTH_KEY = 'crm_template_preview_width_v1';
const CONTACT_COLUMNS_KEY = 'crm_contact_columns_v1';
const CONTACT_PAGE_SIZE_KEY = 'crm_contact_page_size_v1';
const TEMPLATE_DESKTOP_BREAKPOINT = 960;
const CONTACT_PAGE_SIZE_DEFAULT = 25;
const CONTACT_TABLE_COLUMNS = [
  { key: 'contact', label: 'Contact' },
  { key: 'email', label: 'Email' },
  { key: 'title', label: 'Title' },
  { key: 'company', label: 'Company' },
  { key: 'phone', label: 'Phone' },
  { key: 'stage', label: 'Stage' },
  { key: 'added', label: 'Added' }
];
const DEFAULT_CONTACT_COLUMNS = ['contact', 'email', 'title', 'company', 'phone', 'stage', 'added'];
const CONTACT_IMPORT_SAMPLE_CSV = [
  'email,first_name,last_name,title,company,phone,stage,deal_value,image_url',
  'john.smith@example.com,John,Smith,Sales Agent,Acme Realty,0400 000 000,lead,0,',
  'sarah.lee@example.com,Sarah,Lee,Property Manager,Harbour Property,0411 222 333,qualified,850000,https://example.com/sarah.jpg'
].join('\n');
const SEEDED_REAL_ESTATE_TEMPLATE_PREFIX = 'seed_ao_re_';
const TEMPLATE_PREVIEW_DEFAULTS = {
  name: 'Alex Morgan',
  first_name: 'Alex',
  last_name: 'Morgan',
  email: 'alex@harbourproperty.com.au',
  company: 'Harbour Property Group',
  unsubscribe_url: 'https://app.adsoptimiser.com.au/unsubscribe-preview',
  physical_address: 'Ads Optimiser, Brisbane QLD'
};

let token = localStorage.getItem('token');
let state = {
  templates: [],
  contacts: [],
  lists: [],
  campaigns: [],
  logs: [],
  stats: {},
  unsubs: [],
  ui: {
    pipelineStage: 'lead',
    contactsQuery: '',
    contactsTitle: '',
    contactTagsOpen: false,
    contactTagFilter: [],
    contactsPage: 1,
    contactsPageSize: getStoredContactPageSize(),
    contactColumns: getStoredContactColumns(),
    contactColumnsOpen: false,
    contactModalBase: null,
    contactModalReturnId: '',
    selectedTemplateId: '',
    templateDraft: null,
    templateLoading: false,
    templatePreviewWidth: clampTemplatePreviewWidth(parseInt(localStorage.getItem(TEMPLATE_PREVIEW_WIDTH_KEY) || '520', 10)),
    templateResizing: false
  }
};
let currentSection = 'overview';
let campaignEditingId = '';
let campaignModalMode = 'create';
let campaignScheduleDraft = {};
let listEditingId = '';
let contactsSearchTimer = null;
const ICONS = {
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5a7 7 0 1 1-6.2 10.2 1 1 0 1 1 1.76-.96A5 5 0 1 0 8 7.7h1.5a1 1 0 1 1 0 2H5.8a1 1 0 0 1-1-1V5a1 1 0 1 1 2 0v1.2A6.94 6.94 0 0 1 12 5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.8 3.3a2.3 2.3 0 0 1 3.2 3.2l-9.9 9.9-4.1.9.9-4.1 9.9-9.9zm1.8 1.4a.3.3 0 0 0-.4 0l-1.2 1.2 1.8 1.8L19 6.5a.3.3 0 0 0 0-.4l-1.4-1.4zM14.6 7.3l-7.8 7.8-.4 1.8 1.8-.4 7.8-7.8-1.4-1.4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3a1 1 0 0 0-.95.68L7.8 4.5H5a1 1 0 1 0 0 2h.6l.9 11.1A2 2 0 0 0 8.5 19.5h7a2 2 0 0 0 2-1.9l.9-11.1H19a1 1 0 1 0 0-2h-2.8l-.25-.82A1 1 0 0 0 15 3H9zm.52 2h4.96l.15.5H9.37l.15-.5zm-.98 3.5a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2l.4 2.1a7.3 7.3 0 0 1 1.8.7l1.8-1.1 1.4 1.4-1.1 1.8c.3.6.5 1.2.7 1.8L21 11v2l-2.1.4a7.3 7.3 0 0 1-.7 1.8l1.1 1.8-1.4 1.4-1.8-1.1a7.3 7.3 0 0 1-1.8.7L13 21h-2l-.4-2.1a7.3 7.3 0 0 1-1.8-.7l-1.8 1.1-1.4-1.4 1.1-1.8a7.3 7.3 0 0 1-.7-1.8L3 13v-2l2.1-.4c.1-.6.4-1.2.7-1.8L4.7 7l1.4-1.4 1.8 1.1c.6-.3 1.2-.5 1.8-.7L11 3zm1 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 11.2 19.7 4.1c.9-.4 1.8.5 1.4 1.4l-7.1 16.3c-.4.9-1.7.8-1.9-.2l-1.1-5-5-1.1c-1-.2-1.1-1.5-.2-1.9zm3.6 1 4.2.9a1 1 0 0 1 .76.76l.9 4.2 5.1-11.7L7 12.2z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3a2 2 0 0 0-2 2v1H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V8.4a2 2 0 0 0-.59-1.41l-2.4-2.4A2 2 0 0 0 13.6 4H9zm0 2h4v2a2 2 0 0 0 2 2h2v5h-2V8a2 2 0 0 0-2-2H9V5zm6 1.4L16.6 8H15V6.4zM6 8h7v9H6V8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5a1 1 0 0 1 1 1v12a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1zm8 0a1 1 0 0 1 1 1v12a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.7 5.2a1 1 0 0 1 1.05.07l8 5.5a1.5 1.5 0 0 1 0 2.42l-8 5.5A1 1 0 0 1 8 17.9V6.1c0-.36.2-.7.52-.88.06-.01.12-.03.18-.02z"/></svg>',
  stepback: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 6.7a1 1 0 0 1 0 1.4L7.7 11H18a1 1 0 1 1 0 2H7.7l2.9 2.9a1 1 0 1 1-1.4 1.4l-4.6-4.6a1 1 0 0 1 0-1.4l4.6-4.6a1 1 0 0 1 1.4 0z"/></svg>',
  stepforward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.4 6.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4l-4.6 4.6a1 1 0 0 1-1.4-1.4l2.9-2.9H6a1 1 0 1 1 0-2h10.3l-2.9-2.9a1 1 0 0 1 0-1.4z"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v12h12V6H6zm2 9 2.4-3 1.8 2.2 2.6-3.2L18 15H8zm2-6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4a1 1 0 1 1 2 0v8.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4l2.3 2.3V4zm-6 13a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1a1 1 0 0 1 1-1z"/></svg>',
  tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3H5a2 2 0 0 0-2 2v6.2a2 2 0 0 0 .59 1.41l7.8 7.8a2 2 0 0 0 2.82 0l6.2-6.2a2 2 0 0 0 0-2.82l-7.8-7.8A2 2 0 0 0 11 3zm-3 4.5A1.5 1.5 0 1 1 8 10.5 1.5 1.5 0 0 1 8 7.5z"/></svg>'
};

function iconButton(icon, title, onclick, variant = 'ghost', options = {}) {
  const { disabled = false, extraClass = '' } = options;
  return `<button class="icon-btn icon-btn-${variant}${extraClass ? ' ' + extraClass : ''}" type="button" title="${esc(title)}" aria-label="${esc(title)}" onclick="${onclick}" ${disabled ? 'disabled' : ''}>${ICONS[icon] || ICONS.edit}<span class="screen-reader-only">${esc(title)}</span></button>`;
}

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
  api('GET','/api/crm/stats').then(s => updateFollowUpBadges(s?.followups_due || 0));
  await seedRealEstateTemplate().catch(() => {});
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
  closeMobileMenu();
  document.querySelectorAll('.nav-item, .mobile-tab, .mobile-sheet-item').forEach(el => el.classList.remove('active'));
  const sideNav = document.getElementById('nav-' + section);
  const mobileTab = document.getElementById('tab-' + section);
  const moreItem = document.getElementById('more-' + section);
  if (sideNav) sideNav.classList.add('active');
  if (mobileTab) mobileTab.classList.add('active');
  if (moreItem) {
    moreItem.classList.add('active');
    const moreTab = document.getElementById('tab-more');
    if (moreTab) moreTab.classList.add('active');
  } else if (!PRIMARY_MOBILE_SECTIONS.has(section)) {
    const moreTab = document.getElementById('tab-more');
    if (moreTab) moreTab.classList.add('active');
  }
  document.getElementById('page-title').textContent = SECTION_TITLES[section] || section;
  renderSection(section);
}
async function refreshCurrent() { nav(currentSection); }

function updateFollowUpBadges(count) {
  ['fu-badge', 'mobile-fu-badge'].forEach(id => {
    const badge = document.getElementById(id);
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-flex';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  });
}

function openMobileMenu() {
  document.getElementById('mobile-sheet-bg')?.classList.add('open');
  document.getElementById('mobile-sheet')?.classList.add('open');
}

function closeMobileMenu() {
  document.getElementById('mobile-sheet-bg')?.classList.remove('open');
  document.getElementById('mobile-sheet')?.classList.remove('open');
}

async function seedRealEstateTemplate() {
  if (localStorage.getItem(REAL_ESTATE_TEMPLATE_SEED_KEY) === '1') return;
  const seeded = await api('POST', '/api/templates/seed/real-estate');
  if (!seeded?.error) localStorage.setItem(REAL_ESTATE_TEMPLATE_SEED_KEY, '1');
}

function isSeededRealEstateTemplateId(id) {
  return String(id || '').startsWith(SEEDED_REAL_ESTATE_TEMPLATE_PREFIX);
}

function showTemplateMessage(message, kind = 'success') {
  const alertId = isDesktopTemplateWorkspace() ? 't-work-err' : 't-err';
  const alertClass = kind === 'success' ? 'alert-success' : 'alert-error';
  const el = document.getElementById(alertId);
  if (el) {
    showAlert(alertId, message, alertClass);
    return;
  }
  window.alert(message);
}

async function refreshSeededTemplates(selectedTemplateId = state.ui.selectedTemplateId) {
  const seeded = await api('POST', '/api/templates/seed/real-estate');
  if (seeded?.error) {
    showTemplateMessage(seeded.error || 'Unable to refresh seeded templates.');
    return;
  }
  localStorage.setItem(REAL_ESTATE_TEMPLATE_SEED_KEY, '1');
  await loadTemplates();
  if (selectedTemplateId && selectedTemplateId !== 'new') {
    await loadTemplateIntoWorkspace(selectedTemplateId, true);
  } else if (isDesktopTemplateWorkspace()) {
    renderTemplates();
  }
  if (!isDesktopTemplateWorkspace()) renderTemplates();
  showTemplateMessage(`Seeded templates refreshed${seeded.created_count ? ` (${seeded.created_count} created)` : ''}.`, 'success');
}

function isDesktopTemplateWorkspace() {
  return typeof window !== 'undefined' && window.innerWidth > TEMPLATE_DESKTOP_BREAKPOINT;
}

function clampTemplatePreviewWidth(value) {
  if (!Number.isFinite(value)) return 520;
  return Math.max(320, Math.min(760, value));
}

function createEmptyTemplateDraft() {
  return { id: '', name: '', subject: '', html_body: '' };
}

function mergeTemplatePreview(html) {
  return String(html || '')
    .replace(/\{\{first_name\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.first_name)
    .replace(/\{\{last_name\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.last_name)
    .replace(/\{\{name\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.name)
    .replace(/\{\{email\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.email)
    .replace(/\{\{company\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.company)
    .replace(/\{\{unsubscribe_url\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.unsubscribe_url)
    .replace(/\{\{physical_address\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.physical_address);
}

function getActiveTemplateDraft() {
  return state.ui.templateDraft || createEmptyTemplateDraft();
}

function renderTemplatePreviewPane() {
  const frame = document.getElementById('template-preview-frame');
  if (!frame) return;
  const draft = getActiveTemplateDraft();
  const previewHtml = draft.html_body?.trim()
    ? mergeTemplatePreview(draft.html_body)
    : `<!DOCTYPE html><html><body style="margin:0;padding:32px;font-family:Arial,sans-serif;background:#ffffff;color:#111827;"><p style="margin:0;font-size:15px;color:#6b7280;">Start writing template HTML to see the preview.</p></body></html>`;
  frame.srcdoc = previewHtml;
  const title = document.getElementById('template-workspace-title');
  const meta = document.getElementById('template-workspace-meta');
  if (title) title.textContent = draft.name || 'New Template';
  if (meta) meta.textContent = draft.subject || 'Preview uses sample merge values for first name, last name, full name, email, company, unsubscribe link, and address.';
}

async function loadTemplateIntoWorkspace(id, force = false) {
  if (!id) {
    state.ui.selectedTemplateId = 'new';
    state.ui.templateDraft = createEmptyTemplateDraft();
    state.ui.templateLoading = false;
    if (currentSection === 'templates') renderTemplates();
    return;
  }
  if (!force && state.ui.templateDraft?.id === id && state.ui.templateDraft.html_body) {
    state.ui.selectedTemplateId = id;
    if (currentSection === 'templates') renderTemplates();
    return;
  }
  state.ui.selectedTemplateId = id;
  state.ui.templateLoading = true;
  if (currentSection === 'templates') renderTemplates();
  const tmpl = await api('GET', `/api/templates/${id}`);
  if (tmpl?.error) {
    state.ui.templateLoading = false;
    return;
  }
  state.ui.templateDraft = {
    id: tmpl.id || '',
    name: tmpl.name || '',
    subject: tmpl.subject || '',
    html_body: tmpl.html_body || ''
  };
  state.ui.templateLoading = false;
  if (currentSection === 'templates') renderTemplates();
}

function createNewTemplateWorkspace() {
  state.ui.selectedTemplateId = 'new';
  state.ui.templateDraft = createEmptyTemplateDraft();
  state.ui.templateLoading = false;
  renderTemplates();
}

function updateTemplateWorkspaceField(field, value) {
  const draft = getActiveTemplateDraft();
  draft[field] = value;
  state.ui.templateDraft = draft;
  renderTemplatePreviewPane();
}

function startTemplateResize(event) {
  if (!isDesktopTemplateWorkspace()) return;
  event.preventDefault();
  state.ui.templateResizing = true;
}

// ── Sections ──────────────────────────────────────────────────
async function renderSection(s) {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="empty"><div class="empty-icon">...</div><p>Loading...</p></div>';
  if (s === 'overview') { await loadStats(); await loadLogs(); renderOverview(); }
  else if (s === 'templates') { await loadTemplates(); renderTemplates(); }
  else if (s === 'contacts') { await loadContacts(state.ui.contactsQuery); renderContacts(); }
  else if (s === 'lists') { await Promise.all([loadLists(), loadContacts('', '')]); renderLists(); }
  else if (s === 'campaigns') { await Promise.all([loadCampaigns(), loadTemplates(), loadLists()]); renderCampaigns(); }
  else if (s === 'logs') { await loadLogs(); renderLogs(); }
  else if (s === 'unsubs') { await loadUnsubs(); renderUnsubs(); }
  else if (s === 'pipeline') { await Promise.all([loadPipeline(), loadCrmStats()]); renderPipeline(); }
  else if (s === 'followups') { await loadFollowUps(); renderFollowUps(); }
}

// ── Loaders ───────────────────────────────────────────────────
async function loadStats() { state.stats = await api('GET','/api/stats') || {}; }
async function loadTemplates() { state.templates = await api('GET','/api/templates') || []; }
async function loadContacts(q = state.ui.contactsQuery || '', title = state.ui.contactsTitle || '') {
  state.ui.contactsQuery = q;
  state.ui.contactsTitle = title;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (title) params.set('title', title);
  const data = await api('GET','/api/contacts'+(params.size ? `?${params.toString()}` : '')) || [];
  state.contacts = Array.isArray(data) ? data.map(normalizeContactRecord) : [];
  const maxPage = Math.max(1, Math.ceil(state.contacts.length / state.ui.contactsPageSize));
  state.ui.contactsPage = Math.min(state.ui.contactsPage, maxPage);
}
async function loadLists() {
  const data = await api('GET','/api/lists');
  state.lists = Array.isArray(data) ? data : [];
}
async function loadCampaigns() { state.campaigns = await api('GET','/api/campaigns') || []; }
async function loadLogs() { state.logs = await api('GET','/api/logs?limit=200') || []; }
async function loadUnsubs() { state.unsubs = await api('GET','/api/unsubscribes') || []; }

function getStoredContactColumns() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONTACT_COLUMNS_KEY) || '[]');
    const allowed = raw.filter(key => CONTACT_TABLE_COLUMNS.some(col => col.key === key));
    return allowed.length ? allowed : DEFAULT_CONTACT_COLUMNS.slice();
  } catch {
    return DEFAULT_CONTACT_COLUMNS.slice();
  }
}

function getStoredContactPageSize() {
  const value = parseInt(localStorage.getItem(CONTACT_PAGE_SIZE_KEY) || `${CONTACT_PAGE_SIZE_DEFAULT}`, 10);
  return [10, 25, 50, 100].includes(value) ? value : CONTACT_PAGE_SIZE_DEFAULT;
}

function splitFullName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: '', last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

function composeContactName(firstName, lastName, fallbackName = '') {
  const fullName = [String(firstName || '').trim(), String(lastName || '').trim()].filter(Boolean).join(' ').trim();
  return fullName || String(fallbackName || '').trim();
}

function parseTagInput(value) {
  return Array.from(new Set(String(value || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)));
}

function normalizeContactRecord(contact) {
  const base = contact || {};
  const split = splitFullName(base.name);
  const firstName = String(base.first_name || '').trim() || split.first_name;
  const lastName = String(base.last_name || '').trim() || split.last_name;
  let tags = [];
  if (Array.isArray(base.tags)) tags = base.tags;
  else {
    try { tags = JSON.parse(base.tags || '[]'); } catch { tags = []; }
  }
  return {
    ...base,
    first_name: firstName,
    last_name: lastName,
    title: String(base.title || '').trim(),
    tags,
    image_url: String(base.image_url || '').trim(),
    name: composeContactName(firstName, lastName, base.name)
  };
}

function getContactDisplayName(contact) {
  return composeContactName(contact?.first_name, contact?.last_name, contact?.name) || contact?.email || 'Unnamed contact';
}

function getContactInitials(contact) {
  const parts = [contact?.first_name, contact?.last_name].map(part => String(part || '').trim()).filter(Boolean);
  if (parts.length) return parts.slice(0, 2).map(part => part[0].toUpperCase()).join('');
  const fallback = String(contact?.name || contact?.email || '?').trim();
  return fallback.slice(0, 2).toUpperCase();
}

function renderContactAvatar(contact, large = false) {
  const className = `contact-avatar${large ? ' contact-avatar-lg' : ''}`;
  if (contact?.image_url) {
    return `<img src="${esc(contact.image_url)}" alt="${esc(getContactDisplayName(contact))}" class="${className}">`;
  }
  return `<div class="${className} contact-avatar-fallback">${esc(getContactInitials(contact))}</div>`;
}

function getVisibleContactColumns() {
  const columns = state.ui.contactColumns.filter(key => CONTACT_TABLE_COLUMNS.some(col => col.key === key));
  return columns.length ? columns : ['contact'];
}

function fmtDateShort(s) {
  if (!s) return '-';
  try {
    return new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return s;
  }
}

// ── Overview ──────────────────────────────────────────────────
function renderOverview() {
  const s = state.stats;
  const recent = (state.logs.length ? state.logs : []).slice(0,10);
  document.getElementById('content').innerHTML = `
  <div class="stats-grid stats-grid-overview">
    <div class="stat-card"><div class="stat-label">Active Contacts</div><div class="stat-val">${s.contacts||0}</div></div>
    <div class="stat-card"><div class="stat-label">Templates</div><div class="stat-val">${s.templates||0}</div></div>
    <div class="stat-card"><div class="stat-label">Live Campaigns</div><div class="stat-val">${s.campaigns||0}</div></div>
    <div class="stat-card"><div class="stat-label">Emails Sent</div><div class="stat-val">${s.sent||0}</div></div>
    <div class="stat-card"><div class="stat-label">Pipeline Value</div><div class="stat-val" style="font-size:22px">${fmtCurrency(s.pipeline_value||0)}</div></div>
  </div>
  <div class="table-wrap stack-on-mobile">
    <table><thead><tr><th>Recipient</th><th>Subject</th><th>Campaign</th><th>Status</th><th>Sent At</th></tr></thead><tbody>
    ${recent.length ? recent.map(l=>`<tr>
      <td class="mono" data-label="Recipient" style="font-size:12px">${l.contact_email}</td>
      <td data-label="Subject">${l.subject||'-'}</td>
      <td data-label="Campaign">${l.campaign_name||'-'}</td>
      <td data-label="Status"><span class="badge badge-${l.status}">${l.status}</span></td>
      <td class="text-muted text-sm" data-label="Sent At">${fmtDate(l.sent_at)}</td>
    </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted2);padding:32px">No emails sent yet.</td></tr>'}
    </tbody></table>
  </div>`; 
}

// ── Templates ─────────────────────────────────────────────────
function renderTemplates() {
  if (isDesktopTemplateWorkspace()) return renderTemplatesDesktop();
  return renderTemplatesMobile();
}

function renderTemplatesDesktop() {
  const t = state.templates;
  const selectedId = state.ui.selectedTemplateId;
  if (!selectedId && t[0]?.id) void loadTemplateIntoWorkspace(t[0].id);
  if (selectedId && selectedId !== 'new' && !t.some(x => x.id === selectedId) && t[0]?.id) void loadTemplateIntoWorkspace(t[0].id);
  if ((selectedId === 'new' || !selectedId) && !state.ui.templateDraft) state.ui.templateDraft = createEmptyTemplateDraft();
  const draft = selectedId === 'new'
    ? getActiveTemplateDraft()
    : state.ui.templateDraft?.id === selectedId
      ? getActiveTemplateDraft()
      : createEmptyTemplateDraft();
  const isLoading = state.ui.templateLoading && selectedId && selectedId !== 'new' && draft.id !== selectedId;
  document.getElementById('content').innerHTML = `
  <div class="template-workspace">
    <aside class="template-list-panel">
      <div class="template-list-head">
        <div>
          <div class="template-list-title">Templates</div>
          <div class="text-muted text-sm">${t.length} template${t.length!==1?'s':''}</div>
        </div>
        <div class="template-detail-actions">
          ${iconButton('refresh', 'Refresh seeded templates', 'refreshSeededTemplates()')}
          <button class="btn btn-primary btn-sm" onclick="createNewTemplateWorkspace()">+ New</button>
        </div>
      </div>
      <div class="template-list-body">
        ${t.length ? t.map(r => `
          <button class="template-list-item ${selectedId===r.id?'active':''}" type="button" onclick="loadTemplateIntoWorkspace('${r.id}')">
            <div class="template-list-name">${esc(r.name)}</div>
            <div class="template-list-subject">${esc(r.subject)}</div>
            <div class="template-list-date">${fmtDate(r.updated_at)}</div>
          </button>
        `).join('') : `<div class="template-list-empty">No templates yet. Start a new one to begin.</div>`}
      </div>
    </aside>
    <section class="template-detail-panel">
      <div class="template-detail-head">
        <div>
          <div class="template-detail-title" id="template-workspace-title">${draft.name || (selectedId === 'new' ? 'New Template' : 'Loading template...')}</div>
          <div class="template-detail-meta" id="template-workspace-meta">${draft.subject || 'Preview uses sample merge values for first name, last name, full name, email, company, unsubscribe link, and address.'}</div>
        </div>
        <div class="template-detail-actions">
          ${draft.id ? iconButton('refresh', 'Reset template', isSeededRealEstateTemplateId(draft.id) ? `refreshSeededTemplates('${draft.id}')` : `loadTemplateIntoWorkspace('${draft.id}', true)`) : ''}
          ${draft.id ? iconButton('trash', 'Delete template', `deleteTemplate('${draft.id}')`, 'ghost', { extraClass: 'icon-btn-danger' }) : ''}
          <button class="btn btn-primary" onclick="saveTemplate('${draft.id || ''}')">Save Template</button>
        </div>
      </div>
      <div class="template-workspace-main" id="template-workspace-main" style="--template-preview-width:${state.ui.templatePreviewWidth}px">
        <div class="template-editor-pane">
          <div class="form-group"><label>Template Name</label><input id="tw-name" value="${esc(draft.name)}" placeholder="e.g. AI Outreach - Intro" oninput="updateTemplateWorkspaceField('name', this.value)" ${isLoading?'disabled':''}></div>
          <div class="form-group"><label>Email Subject</label><input id="tw-subj" value="${esc(draft.subject)}" placeholder="Subject line..." oninput="updateTemplateWorkspaceField('subject', this.value)" ${isLoading?'disabled':''}></div>
          <div class="form-group template-editor-grow"><label>HTML Body <span class="text-muted text-sm">(use {{first_name}}, {{last_name}}, {{name}}, {{email}}, {{company}}, {{unsubscribe_url}}, {{physical_address}})</span></label><textarea id="tw-body" oninput="updateTemplateWorkspaceField('html_body', this.value)" ${isLoading?'disabled':''}>${esc(draft.html_body)}</textarea></div>
          <div class="alert alert-error" id="t-work-err"></div>
        </div>
        <div class="template-splitter" onmousedown="startTemplateResize(event)" title="Resize preview pane"></div>
        <div class="template-preview-pane">
          <div class="template-preview-head">
            <div>
              <div class="template-preview-title">Live Preview</div>
              <div class="template-preview-note">Desktop preview only. Email clients may still differ.</div>
            </div>
          </div>
          <div class="template-preview-canvas">
            <iframe id="template-preview-frame" class="template-preview-frame" sandbox="allow-same-origin"></iframe>
          </div>
        </div>
      </div>
    </section>
  </div>`;
  renderTemplatePreviewPane();
}

function renderTemplatesMobile() {
  const t = state.templates;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <div class="toolbar-meta" style="flex:1"><span class="text-muted text-sm">${t.length} template${t.length!==1?'s':''}</span></div>
    ${iconButton('refresh', 'Refresh seeded templates', 'refreshSeededTemplates()')}
    <button class="btn btn-primary" onclick="openTemplateModal()">+ New Template</button>
  </div>
  <div class="table-wrap stack-on-mobile">
    <table><thead><tr><th>Name</th><th>Subject</th><th>Updated</th><th style="width:130px">Actions</th></tr></thead><tbody>
    ${t.length ? t.map(r=>`<tr>
      <td data-label="Name" style="font-weight:600">${esc(r.name)}</td>
      <td class="text-muted" data-label="Subject">${esc(r.subject)}</td>
      <td class="text-muted text-sm" data-label="Updated">${fmtDate(r.updated_at)}</td>
      <td data-label="Actions"><div class="table-actions">${iconButton('edit', 'Edit template', `editTemplate('${r.id}')`)}${iconButton('trash', 'Delete template', `deleteTemplate('${r.id}')`, 'ghost', { extraClass: 'icon-btn-danger' })}</div></td>
    </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--muted2);padding:32px">No templates yet. Create your first.</td></tr>'}
    </tbody></table>
  </div>`;
}

function openTemplateModal(tmpl) {
  const t = tmpl || { id:'', name:'', subject:'', html_body:'' };
  setModal(`<div class="modal-head"><h3>${t.id?'Edit Template':'New Template'}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div class="form-group"><label>Template Name</label><input id="t-name" value="${esc(t.name)}" placeholder="e.g. AI Outreach - Intro"></div>
    <div class="form-group"><label>Email Subject</label><input id="t-subj" value="${esc(t.subject)}" placeholder="Subject line..."></div>
    <div class="form-group"><label>HTML Body <span class="text-muted text-sm">(use {{first_name}}, {{last_name}}, {{name}}, {{email}}, {{company}})</span></label><textarea id="t-body" style="min-height:240px">${esc(t.html_body)}</textarea></div>
    <div class="alert alert-error" id="t-err"></div>
    <div class="flex gap" style="justify-content:flex-end;margin-top:8px">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTemplate('${t.id}')">Save Template</button>
    </div>
  </div>`);
}

async function editTemplate(id) {
  if (isDesktopTemplateWorkspace()) {
    await loadTemplateIntoWorkspace(id, true);
    return;
  }
  const tmpl = await api('GET', `/api/templates/${id}`);
  if (!tmpl?.error) openTemplateModal(tmpl);
}

async function saveTemplate(id) {
  const workspace = !!document.getElementById('tw-name');
  const name = (document.getElementById(workspace ? 'tw-name' : 't-name')?.value || '').trim();
  const subject = (document.getElementById(workspace ? 'tw-subj' : 't-subj')?.value || '').trim();
  const html_body = (document.getElementById(workspace ? 'tw-body' : 't-body')?.value || '').trim();
  const alertId = workspace ? 't-work-err' : 't-err';
  if (!name || !subject || !html_body) { showAlert(alertId,'All fields required'); return; }
  const r = id ? await api('PUT',`/api/templates/${id}`,{name,subject,html_body}) : await api('POST','/api/templates',{name,subject,html_body});
  if (r.error) { showAlert(alertId, r.error); return; }
  if (!workspace) closeModal();
  state.ui.templateDraft = { id: id || r.id || '', name, subject, html_body };
  state.ui.selectedTemplateId = id || r.id || 'new';
  await loadTemplates();
  if (workspace && (id || r.id)) await loadTemplateIntoWorkspace(id || r.id, true);
  else renderTemplates();
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  await api('DELETE',`/api/templates/${id}`);
  await loadTemplates();
  if (isDesktopTemplateWorkspace()) {
    if (state.templates[0]?.id) await loadTemplateIntoWorkspace(state.templates[0].id, true);
    else {
      state.ui.selectedTemplateId = 'new';
      state.ui.templateDraft = createEmptyTemplateDraft();
      state.ui.templateLoading = false;
      renderTemplates();
    }
    return;
  }
  renderTemplates();
}

// ── Contacts ──────────────────────────────────────────────────
function renderContacts(q = state.ui.contactsQuery || '') {
  const ct = state.contacts;
  const selectedTitle = state.ui.contactsTitle || '';
  const selectedTags = state.ui.contactTagFilter || [];
  const titleOptions = Array.from(new Set((state.contacts || []).map(contact => String(contact.title || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  if (selectedTitle && !titleOptions.includes(selectedTitle)) titleOptions.unshift(selectedTitle);
  const tagOptions = Array.from(new Set((state.contacts || []).flatMap(contact => Array.isArray(contact.tags) ? contact.tags : []).map(tag => String(tag || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  for (const tag of selectedTags) {
    if (!tagOptions.includes(tag)) tagOptions.unshift(tag);
  }
  const columns = getVisibleContactColumns();
  const filteredContacts = selectedTags.length
    ? ct.filter(contact => selectedTags.every(tag => (contact.tags || []).includes(tag)))
    : ct;
  const total = filteredContacts.length;
  const pageSize = state.ui.contactsPageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(state.ui.contactsPage, totalPages);
  state.ui.contactsPage = page;
  const start = total ? ((page - 1) * pageSize) + 1 : 0;
  const end = Math.min(total, page * pageSize);
  const rows = filteredContacts.slice(start ? start - 1 : 0, end);
  const columnMenu = CONTACT_TABLE_COLUMNS.map(col => `
    <label class="contact-column-option">
      <input type="checkbox" ${columns.includes(col.key) ? 'checked' : ''} onchange="toggleContactColumn('${col.key}', this.checked)">
      <span>${col.label}</span>
    </label>`).join('');
  const headers = columns.map(key => `<th>${CONTACT_TABLE_COLUMNS.find(col => col.key === key)?.label || key}</th>`).join('');
  const body = rows.length ? rows.map(c => `<tr>
      ${columns.map(key => renderContactTableCell(c, key)).join('')}
      <td data-label="Actions">
        <div class="table-actions contact-actions">
          <button class="icon-btn" title="Edit contact" aria-label="Edit contact" onclick="editContact('${c.id}')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4.75L19 9.75 14.25 5 4 15.25V20zm12.06-13.94 1.88-1.88a1.5 1.5 0 0 1 2.12 0l1.76 1.76a1.5 1.5 0 0 1 0 2.12l-1.88 1.88-3.88-3.88z"/></svg>
          </button>
          <button class="icon-btn icon-btn-danger" title="Delete contact" aria-label="Delete contact" onclick="deleteContact('${c.id}')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 10h2v8H7v-8zm-1 10h12l1-13H5l1 13z"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join('') : `<tr><td colspan="${columns.length + 1}" style="text-align:center;color:var(--muted2);padding:28px">No contacts yet.</td></tr>`;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <input class="search-box" placeholder="Search or use tag:, company:, title: ..." value="${esc(q)}" oninput="queueContactsSearch(this.value)" style="max-width:340px">
    <div class="toolbar-meta" style="flex:1">
      <span class="text-muted text-sm">${total} contact${total!==1?'s':''}</span>
      <span class="text-muted text-sm">${start ? `Showing ${start}-${end}` : 'Showing 0'}</span>
      <label class="text-muted text-sm">Rows
        <select class="contact-page-size" onchange="setContactsPageSize(this.value)">
          ${[10,25,50,100].map(size => `<option value="${size}" ${pageSize===size?'selected':''}>${size}</option>`).join('')}
        </select>
      </label>
    </div>
    <select class="contact-page-size" onchange="setContactsTitleFilter(this.value)" style="min-width:180px">
      <option value="">All Functions</option>
      ${titleOptions.map(title => `<option value="${esc(title)}"${selectedTitle===title?' selected':''}>${esc(title)}</option>`).join('')}
    </select>
    <button class="btn btn-ghost" onclick="toggleContactTagsMenu()">${selectedTags.length ? `Tags (${selectedTags.length})` : 'Tags'}</button>
    <button class="btn btn-ghost" onclick="toggleContactColumnsMenu()">Columns</button>
    <button class="btn btn-ghost" onclick="openImportModal()">Import CSV</button>
    <button class="btn btn-primary" onclick="openContactModal()">+ Add Contact</button>
  </div>
  <div class="text-muted text-sm" style="margin:-8px 0 12px;line-height:1.6">Examples: <code>tag:luxury</code>, <code>company:lynx</code>, <code>title:&quot;sales agent&quot;</code>, or combine them with normal text.</div>
  ${state.ui.contactTagsOpen ? `<div class="contact-column-panel">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px">
      <div class="text-muted text-sm" style="font-weight:600">Filter by tag</div>
      ${selectedTags.length ? `<button class="btn btn-ghost btn-sm" onclick="clearContactTagFilter()">Clear</button>` : ''}
    </div>
    ${tagOptions.length ? tagOptions.map(tag => `
      <label class="contact-column-option">
        <input type="checkbox" ${selectedTags.includes(tag) ? 'checked' : ''} onchange="toggleContactTagFilter('${esc(tag)}', this.checked)">
        <span>${esc(tag)}</span>
      </label>`).join('') : '<div class="text-muted text-sm">No tags available.</div>'}
  </div>` : ''}
  ${state.ui.contactColumnsOpen ? `<div class="contact-column-panel">${columnMenu}</div>` : ''}
  <div class="table-wrap stack-on-mobile contacts-table-wrap">
    <table class="contacts-table"><thead><tr>${headers}<th style="width:76px">Actions</th></tr></thead><tbody>
    ${body}
    </tbody></table>
  </div>
  <div class="pagination-bar">
    <div class="pagination-meta">Page ${page} of ${totalPages}</div>
    <div class="pagination-actions">
      ${iconButton('stepback', 'Previous page', `setContactsPage(${page - 1})`, 'ghost', { disabled: page <= 1 })}
      ${iconButton('stepforward', 'Next page', `setContactsPage(${page + 1})`, 'ghost', { disabled: page >= totalPages })}
    </div>
  </div>`;
}

function renderContactTableCell(contact, key) {
  if (key === 'contact') {
    const name = getContactDisplayName(contact);
    const secondary = [contact.title, contact.phone || contact.email || '-'].map(value => String(value || '').trim()).filter(Boolean).join(' | ');
    return `<td data-label="Contact">
      <div class="contact-cell">
        ${renderContactAvatar(contact)}
        <div class="contact-copy">
          <div class="contact-primary">${esc(name)}</div>
          <div class="contact-secondary">${esc(secondary)}</div>
        </div>
      </div>
    </td>`;
  }
  if (key === 'email') return `<td data-label="Email" class="mono contact-email">${esc(contact.email || '-')}</td>`;
  if (key === 'title') return `<td data-label="Title" class="text-muted">${esc(contact.title || '-')}</td>`;
  if (key === 'company') return `<td data-label="Company" class="text-muted">${esc(contact.company || '-')}</td>`;
  if (key === 'phone') return `<td data-label="Phone">${esc(contact.phone || '-')}</td>`;
  if (key === 'stage') return `<td data-label="Stage"><span class="badge badge-${esc(contact.stage || 'draft')}">${esc(STAGE_LABELS?.[contact.stage] || contact.stage || 'Lead')}</span></td>`;
  if (key === 'added') return `<td data-label="Added" class="text-muted text-sm">${fmtDateShort(contact.created_at)}</td>`;
  return `<td data-label="${esc(key)}">-</td>`;
}

function queueContactsSearch(q) {
  state.ui.contactsQuery = q;
  if (contactsSearchTimer) clearTimeout(contactsSearchTimer);
  contactsSearchTimer = setTimeout(() => {
    contactsSearchTimer = null;
    searchContacts(q);
  }, 250);
}

async function searchContacts(q) {
  state.ui.contactsPage = 1;
  await loadContacts(q, state.ui.contactsTitle);
  renderContacts(q);
}

async function setContactsTitleFilter(title) {
  state.ui.contactsPage = 1;
  await loadContacts(state.ui.contactsQuery, title);
  renderContacts(state.ui.contactsQuery);
}

function toggleContactTagsMenu() {
  state.ui.contactTagsOpen = !state.ui.contactTagsOpen;
  renderContacts(state.ui.contactsQuery);
}

function toggleContactTagFilter(tag, checked) {
  const next = checked
    ? Array.from(new Set([...(state.ui.contactTagFilter || []), tag]))
    : (state.ui.contactTagFilter || []).filter(item => item !== tag);
  state.ui.contactTagFilter = next;
  state.ui.contactsPage = 1;
  renderContacts(state.ui.contactsQuery);
}

function clearContactTagFilter() {
  state.ui.contactTagFilter = [];
  state.ui.contactsPage = 1;
  renderContacts(state.ui.contactsQuery);
}

function toggleContactColumnsMenu() {
  state.ui.contactColumnsOpen = !state.ui.contactColumnsOpen;
  renderContacts(state.ui.contactsQuery);
}

function toggleContactColumn(key, checked) {
  const next = checked
    ? Array.from(new Set([...state.ui.contactColumns, key]))
    : state.ui.contactColumns.filter(item => item !== key);
  state.ui.contactColumns = next.length ? next : ['contact'];
  localStorage.setItem(CONTACT_COLUMNS_KEY, JSON.stringify(state.ui.contactColumns));
  renderContacts(state.ui.contactsQuery);
}

function setContactsPage(page) {
  const totalPages = Math.max(1, Math.ceil(state.contacts.length / state.ui.contactsPageSize));
  state.ui.contactsPage = Math.max(1, Math.min(totalPages, Number(page) || 1));
  renderContacts(state.ui.contactsQuery);
}

function setContactsPageSize(value) {
  const next = [10, 25, 50, 100].includes(Number(value)) ? Number(value) : CONTACT_PAGE_SIZE_DEFAULT;
  state.ui.contactsPageSize = next;
  state.ui.contactsPage = 1;
  localStorage.setItem(CONTACT_PAGE_SIZE_KEY, String(next));
  renderContacts(state.ui.contactsQuery);
}

function openContactModal(c, options = {}) {
  const ct = normalizeContactRecord(c || { id:'', email:'', name:'', first_name:'', last_name:'', title:'', company:'', phone:'', linkedin:'', image_url:'' });
  state.ui.contactModalBase = ct;
  state.ui.contactModalReturnId = options.returnToDrawer || '';
  setModal(`<div class="modal-head"><h3>${ct.id?'Edit Contact':'Add Contact'}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div class="contact-upload-row">
      <div id="contact-image-preview">${renderContactAvatar(ct, true)}</div>
      <div style="flex:1">
        <div class="form-group" style="margin-bottom:10px">
          <label>Contact Image</label>
          <input id="c-image-url" type="hidden" value="${esc(ct.image_url || '')}">
          <input type="file" id="c-image-file" accept="image/*" style="display:none" onchange="readContactImage(this)">
          <div class="flex gap">
            ${iconButton('image', 'Upload image', 'triggerContactImageUpload()')}
            ${iconButton('trash', 'Remove image', 'clearContactImage()', 'ghost', { extraClass: 'icon-btn-danger' })}
          </div>
        </div>
        <div class="text-muted text-sm">Image is optional. A small headshot or agency photo works best.</div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Email *</label><input id="c-email" type="email" value="${esc(ct.email)}" placeholder="contact@example.com" ${ct.id?'readonly':''} oninput="refreshContactImagePreview()"></div>
      <div class="form-group"><label>Phone</label><input id="c-phone" value="${esc(ct.phone || '')}" placeholder="0400 000 000"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>First Name</label><input id="c-first-name" value="${esc(ct.first_name || '')}" placeholder="First name" oninput="refreshContactImagePreview()"></div>
      <div class="form-group"><label>Last Name</label><input id="c-last-name" value="${esc(ct.last_name || '')}" placeholder="Last name" oninput="refreshContactImagePreview()"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Title</label><input id="c-title" value="${esc(ct.title || '')}" placeholder="Sales Agent"></div>
      <div class="form-group"><label>Company</label><input id="c-company" value="${esc(ct.company)}" placeholder="Company name"></div>
    </div>
    <div class="form-group">
      <label>Tags</label>
      <input id="c-tags" value="${esc((ct.tags || []).join(', '))}" placeholder="luxury, qld, replied, source:csv">
      <div class="text-muted text-sm" style="margin-top:6px">Separate multiple tags with commas.</div>
    </div>
    <div class="form-group"><label>LinkedIn URL</label><input id="c-linkedin" value="${esc(ct.linkedin || '')}" placeholder="https://www.linkedin.com/in/..."></div>
    <div class="alert alert-error" id="c-err"></div>
    <div class="flex gap" style="justify-content:flex-end">
      ${ct.id ? '' : '<button class="btn btn-ghost" onclick="closeModal();openImportModal()">Bulk Import CSV</button>'}
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveContact('${ct.id}')">Save</button>
    </div>
  </div>`);
}

function editContact(id) {
  const contact = state.contacts.find(item => item.id === id);
  if (!contact) return;
  openContactModal(contact);
}

async function saveContact(id) {
  const email = document.getElementById('c-email')?.value.trim();
  const first_name = document.getElementById('c-first-name').value.trim();
  const last_name = document.getElementById('c-last-name').value.trim();
  const name = composeContactName(first_name, last_name);
  const title = document.getElementById('c-title').value.trim();
  const company = document.getElementById('c-company').value.trim();
  const tags = parseTagInput(document.getElementById('c-tags')?.value || '');
  const phone = document.getElementById('c-phone').value.trim();
  const linkedin = document.getElementById('c-linkedin').value.trim();
  const image_url = document.getElementById('c-image-url').value.trim();
  const base = state.ui.contactModalBase || {};
  let r;
  if (id) {
    r = await api('PUT',`/api/contacts/${id}`,{
      name,
      first_name,
      last_name,
      title,
      company,
      stage: base.stage || 'lead',
      deal_value: base.deal_value || 0,
      tags,
      phone,
      linkedin,
      follow_up_at: base.follow_up_at || null,
      image_url
    });
  } else {
    if (!email) { showAlert('c-err','Email required'); return; }
    r = await api('POST','/api/contacts',{ email, name, first_name, last_name, title, company, tags, phone, linkedin, image_url });
  }
  if (r.error) { showAlert('c-err', r.error); return; }
  const returnId = state.ui.contactModalReturnId;
  closeModal();
  state.ui.contactModalBase = null;
  state.ui.contactModalReturnId = '';
  await loadContacts(state.ui.contactsQuery);
  if (currentSection === 'contacts') renderContacts(state.ui.contactsQuery);
  if (currentSection === 'pipeline') { await Promise.all([loadPipeline(), loadCrmStats()]); renderPipeline(); }
  if (currentSection === 'followups') { await loadFollowUps(); renderFollowUps(); }
  if (returnId) openDrawer(returnId);
}

async function deleteContact(id) {
  if (!confirm('Delete this contact?')) return;
  await api('DELETE',`/api/contacts/${id}`);
  await loadContacts(state.ui.contactsQuery);
  renderContacts(state.ui.contactsQuery);
}

async function openImportModal() {
  if (!Array.isArray(state.lists) || !state.lists.length) {
    try { await loadLists(); } catch { state.lists = []; }
  }
  const lists = Array.isArray(state.lists) ? state.lists : [];
  const stageList = STAGE_ORDER.map(stage => `<code>${stage}</code>`).join(', ');
  const defaultBatchTag = `import:${new Date().toISOString().slice(0, 10)}`;
  const listOptions = lists.length
    ? `<option value="">Do not add to a list</option>${lists.map(list => `<option value="${list.id}">${esc(list.name)} (${list.cnt || 0} contacts)</option>`).join('')}`
    : '<option value="">No lists available yet</option>';
  setModal(`<div class="modal-head"><h3>Import Contacts (CSV)</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div style="margin-bottom:14px;padding:14px 16px;border:1px solid var(--border);border-radius:12px;background:var(--surface2)">
      <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted2);margin-bottom:8px">How CSV Import Works</div>
      <div class="text-muted text-sm" style="line-height:1.7">
        <div><strong>Required:</strong> <code>email</code></div>
        <div><strong>Optional:</strong> <code>first_name</code>, <code>last_name</code>, <code>name</code>, <code>title</code>, <code>company</code>, <code>phone</code>, <code>stage</code>, <code>deal_value</code>, <code>image_url</code></div>
        <div>If you provide <code>first_name</code> and <code>last_name</code>, the full <code>name</code> is built automatically during import.</div>
        <div>If you already have a single <code>name</code> column, that still works.</div>
        <div>Imported contacts are automatically tagged with <code>source:csv</code> plus your batch/import tags.</div>
        <div>Valid stage values: ${stageList}</div>
      </div>
    </div>
    <div class="form-group">
      <label>Example CSV Template</label>
      <textarea readonly style="min-height:110px;font-family:var(--font-mono);font-size:12px;opacity:.9">${esc(CONTACT_IMPORT_SAMPLE_CSV)}</textarea>
    </div>
    <div class="flex gap" style="margin:-4px 0 14px">
      <button class="btn btn-ghost btn-sm" onclick="loadContactImportExample()">Load Example Into Import Box</button>
      <button class="btn btn-ghost btn-sm" onclick="downloadContactImportTemplate()">Download Example CSV</button>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Batch Tag</label><input id="csv-batch-tag" value="${esc(defaultBatchTag)}" placeholder="import:2026-03-27"></div>
      <div class="form-group"><label>Extra Tags</label><input id="csv-extra-tags" placeholder="luxury, qld, scraped"></div>
    </div>
    <div class="form-group">
      <label>Add Imported Contacts To Existing List</label>
      <select id="csv-list-id">${listOptions}</select>
    </div>
    <div class="form-group">
      <label>Or Create New List During Import</label>
      <input id="csv-new-list-name" placeholder="e.g. Luxury Agencies March 2026">
      <div class="text-muted text-sm" style="margin-top:6px;line-height:1.6">If you enter a new list name here, it will be created automatically and used instead of the selected list above.</div>
    </div>
    <div class="form-group"><label>Paste CSV or upload file</label>
      <textarea id="csv-data" placeholder="email,first_name,last_name,title,company,phone&#10;john@example.com,John,Smith,Sales Agent,Acme Corp,0400 000 000" style="min-height:180px"></textarea>
    </div>
    <input type="file" id="csv-file" accept=".csv" style="display:none" onchange="readCsv(this)">
    <div class="flex gap" style="margin-bottom:12px"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('csv-file').click()">Upload CSV file</button></div>
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

function loadContactImportExample() {
  const input = document.getElementById('csv-data');
  if (input) input.value = CONTACT_IMPORT_SAMPLE_CSV;
}

function downloadContactImportTemplate() {
  const blob = new Blob([CONTACT_IMPORT_SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'contacts-import-template.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function doImport() {
  const csv = document.getElementById('csv-data').value.trim();
  const batch_tag = document.getElementById('csv-batch-tag')?.value.trim() || '';
  const list_id = document.getElementById('csv-list-id')?.value || '';
  const new_list_name = document.getElementById('csv-new-list-name')?.value.trim() || '';
  const extra_tags = (document.getElementById('csv-extra-tags')?.value || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
  if (!csv) { showAlert('imp-err','Paste CSV data first'); return; }
  const r = await api('POST','/api/contacts/import',{csv, batch_tag, extra_tags, list_id, new_list_name});
  if (r.error) { showAlert('imp-err',r.error); return; }
  const listNote = r.list_name ? `, linked ${r.linked || 0} to ${r.list_name}` : '';
  showAlert('imp-ok',`Imported ${r.imported} contacts, skipped ${r.skipped}${listNote}`,'alert-success');
  state.ui.contactsPage = 1;
  await Promise.all([
    loadContacts(state.ui.contactsQuery),
    list_id ? loadLists() : Promise.resolve()
  ]);
  if (currentSection === 'contacts') renderContacts(state.ui.contactsQuery);
  if (currentSection === 'lists') renderLists();
}

function triggerContactImageUpload() {
  document.getElementById('c-image-file')?.click();
}

function clearContactImage() {
  const imageInput = document.getElementById('c-image-url');
  if (imageInput) imageInput.value = '';
  refreshContactImagePreview();
}

function refreshContactImagePreview() {
  const preview = document.getElementById('contact-image-preview');
  if (!preview) return;
  const contact = {
    first_name: document.getElementById('c-first-name')?.value || '',
    last_name: document.getElementById('c-last-name')?.value || '',
    title: document.getElementById('c-title')?.value || '',
    email: document.getElementById('c-email')?.value || '',
    image_url: document.getElementById('c-image-url')?.value || ''
  };
  preview.innerHTML = renderContactAvatar(contact, true);
}

function readContactImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = event => {
    const img = new Image();
    img.onload = () => {
      const maxSize = 320;
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const value = canvas.toDataURL('image/jpeg', 0.82);
      const imageInput = document.getElementById('c-image-url');
      if (imageInput) imageInput.value = value;
      refreshContactImagePreview();
    };
    img.src = event.target?.result;
  };
  reader.readAsDataURL(file);
}

// ── Lists ─────────────────────────────────────────────────────
function renderLists() {
  const ls = state.lists;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <div style="flex:1"></div>
    <button class="btn btn-primary" onclick="openListModal()">+ New List</button>
  </div>
  <div class="table-wrap stack-on-mobile">
    <table><thead><tr><th>List Name</th><th>Description</th><th>Members</th><th>Created</th><th style="width:220px">Actions</th></tr></thead><tbody>
    ${ls.length ? ls.map(l=>`<tr>
      <td data-label="List" style="font-weight:600">${esc(l.name)}</td>
      <td class="text-muted" data-label="Description">${esc(l.description)||'-'}</td>
      <td data-label="Members"><span class="badge badge-active">${l.cnt||0}</span></td>
      <td class="text-muted text-sm" data-label="Created">${fmtDate(l.created_at)}</td>
      <td data-label="Actions"><div class="table-actions">${iconButton('settings', 'Manage list', `viewList('${l.id}','${esc(l.name)}')`)}${iconButton('edit', 'Edit list', `openListModal('${l.id}')`)}${iconButton('trash', 'Delete list', `deleteList('${l.id}')`, 'ghost', { extraClass: 'icon-btn-danger' })}</div></td>
    </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted2);padding:32px">No lists yet.</td></tr>'}
    </tbody></table>
  </div>`;
}

function openListModal(id = '') {
  const list = id ? state.lists.find(item => item.id === id) : null;
  listEditingId = list?.id || '';
  const title = list ? 'Edit Contact List' : 'New Contact List';
  const submitLabel = list ? 'Save Changes' : 'Create List';
  setModal(`<div class="modal-head"><h3>${title}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div class="form-group"><label>List Name *</label><input id="l-name" value="${esc(list?.name || '')}" placeholder="e.g. AI Startup Founders"></div>
    <div class="form-group"><label>Description</label><input id="l-desc" value="${esc(list?.description || '')}" placeholder="Optional description"></div>
    <div class="alert alert-error" id="l-err"></div>
    <div class="flex gap" style="justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveList()">${submitLabel}</button>
    </div>
  </div>`);
}

async function saveList() {
  const name = document.getElementById('l-name').value.trim();
  const description = document.getElementById('l-desc').value.trim();
  if (!name) { showAlert('l-err','Name required'); return; }
  const method = listEditingId ? 'PUT' : 'POST';
  const path = listEditingId ? `/api/lists/${listEditingId}` : '/api/lists';
  const r = await api(method, path, {name,description});
  if (r.error) { showAlert('l-err',r.error); return; }
  listEditingId = '';
  closeModal(); await loadLists(); renderLists();
}

async function deleteList(id) {
  if (!confirm('Delete this list?')) return;
  await api('DELETE',`/api/lists/${id}`);
  await loadLists(); renderLists();
}

async function viewList(id, name) {
  if (!state.contacts.length) await loadContacts('', '');
  const members = await api('GET',`/api/lists/${id}/contacts`) || [];
  const all = state.contacts;
  const memberIds = new Set(members.map(m=>m.id));
  const available = all.filter(c=>!memberIds.has(c.id));
  setModal(`<div class="modal-head"><h3>List: ${esc(name)}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div style="margin-bottom:16px">
      <label style="font-size:12px;color:var(--muted2);text-transform:uppercase;letter-spacing:.7px;display:block;margin-bottom:6px">Add contacts to list</label>
      <div class="flex gap">
        <select id="add-contact" style="flex:1;background:#0d0d15;border:1px solid var(--border2);border-radius:8px;padding:8px 12px;color:var(--text);font-size:13px">
          <option value="">- Select a contact -</option>
          ${available.map(c=>`<option value="${c.id}">${esc(c.email)}${c.name?' ('+esc(c.name)+')':''}</option>`).join('')}
        </select>
        ${iconButton('plus', 'Add contact to list', `addContactToList('${id}')`, 'primary')}
      </div>
    </div>
    <div class="table-wrap stack-on-mobile">
      <table><thead><tr><th>Email</th><th>Name</th><th>Company</th><th></th></tr></thead>
      <tbody id="list-members">
      ${members.length ? members.map(m=>`<tr><td class="mono" data-label="Email" style="font-size:12px">${esc(m.email)}</td><td data-label="Name">${esc(m.name)||'-'}</td><td class="text-muted" data-label="Company">${esc(m.company)||'-'}</td><td data-label="Actions"><div class="table-actions">${iconButton('trash', 'Remove from list', `removeFromList('${id}','${m.id}','${esc(name)}')`, 'ghost', { extraClass: 'icon-btn-danger' })}</div></td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--muted2);padding:24px">No members yet.</td></tr>'}
      </tbody></table>
    </div>
  </div>`);
}

async function addContactToList(listId) {
  const cid = document.getElementById('add-contact').value;
  if (!cid) return;
  await api('POST',`/api/lists/${listId}/contacts`,{contact_ids:[cid]});
  await loadLists();
  const list = state.lists.find(l=>l.id===listId);
  await viewList(listId, list?.name||'');
  if (currentSection === 'lists') renderLists();
}

async function removeFromList(listId, contactId, name) {
  await api('DELETE',`/api/lists/${listId}/contacts/${contactId}`);
  await loadLists();
  const list = state.lists.find(l=>l.id===listId);
  await viewList(listId, list?.name||name);
  if (currentSection === 'lists') renderLists();
}

// ── Campaigns ─────────────────────────────────────────────────
function renderCampaigns() {
  const cs = state.campaigns;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <div class="toolbar-meta" style="flex:1"><span class="text-muted text-sm">${cs.length} campaign${cs.length!==1?'s':''}</span></div>
    <button class="btn btn-primary" onclick="openCampaignModal()">+ New Campaign</button>
  </div>
  <div class="table-wrap stack-on-mobile">
    <table><thead><tr><th>Name</th><th>List</th><th>Type</th><th>Status</th><th style="width:260px">Actions</th></tr></thead><tbody>
    ${cs.length ? cs.map(c=>`<tr>
      <td data-label="Name" style="font-weight:600">${esc(c.name)}</td>
      <td class="text-muted" data-label="List">${esc(c.list_name||'-')}</td>
      <td data-label="Type"><span class="badge badge-draft" style="background:rgba(0,200,255,.08);color:var(--cyan)">${c.schedule_type}</span></td>
      <td data-label="Status"><span class="badge badge-${c.status}">${c.status}</span></td>
      <td data-label="Actions"><div class="table-actions">
        ${iconButton('settings', 'Manage campaign', `openCampaignModal('${c.id}')`)}
        ${iconButton('copy', 'Copy campaign', `copyCampaign('${c.id}')`)}
        ${c.status==='active'?iconButton('pause', 'Pause campaign', `setCampaignStatus('${c.id}','pause')`):''}
        ${c.status==='paused'||c.status==='draft'?iconButton('play', 'Activate campaign', `setCampaignStatus('${c.id}','activate')`, 'success'):''}
        ${iconButton('send', 'Send campaign now', `sendCampaignNow('${c.id}','${esc(c.name)}')`, 'primary')}
        ${iconButton('trash', 'Delete campaign', `deleteCampaign('${c.id}')`, 'ghost', { extraClass: 'icon-btn-danger' })}
      </div></td>
    </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted2);padding:32px">No campaigns yet.</td></tr>'}
    </tbody></table>
  </div>`;
}

let campaignSteps = [{ template_id: '', delay_days: 0 }];

function openCampaignModal(id = '') {
  const campaign = id ? state.campaigns.find(item => item.id === id) : null;
  campaignModalMode = campaign ? 'edit' : 'create';
  campaignEditingId = campaign?.id || '';
  campaignScheduleDraft = { ...(campaign?.schedule_config || {}) };
  campaignSteps = campaign?.steps?.length
    ? campaign.steps.map(step => ({ template_id: step.template_id, delay_days: step.delay_days || 0 }))
    : [{ template_id: '', delay_days: 0 }];
  renderCampaignModal();
}

function copyCampaign(id) {
  const campaign = state.campaigns.find(item => item.id === id);
  if (!campaign) return;
  campaignModalMode = 'copy';
  campaignEditingId = '';
  campaignScheduleDraft = { ...(campaign.schedule_config || {}) };
  campaignSteps = campaign.steps?.length
    ? campaign.steps.map(step => ({ template_id: step.template_id, delay_days: step.delay_days || 0 }))
    : [{ template_id: '', delay_days: 0 }];
  renderCampaignModal({
    ...campaign,
    id: '',
    name: campaign.name ? `${campaign.name} Copy` : 'Campaign Copy'
  });
}

function renderCampaignModal(campaignOverride = null) {
  const campaign = campaignOverride || (campaignEditingId ? state.campaigns.find(item => item.id === campaignEditingId) : null);
  const title = campaignModalMode === 'edit' ? 'Manage Campaign' : campaignModalMode === 'copy' ? 'Copy Campaign' : 'New Campaign';
  const submitLabel = campaignModalMode === 'edit' ? 'Save Changes' : campaignModalMode === 'copy' ? 'Create Copy' : 'Create Campaign';
  const tOpts = state.templates.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
  const lOpts = state.lists.map(l=>`<option value="${l.id}"${campaign?.list_id===l.id?' selected':''}>${esc(l.name)} (${l.cnt||0} contacts)</option>`).join('');
  setModal(`<div class="modal-head"><h3>${title}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div class="form-row">
      <div class="form-group"><label>Campaign Name *</label><input id="ca-name" value="${esc(campaign?.name || '')}" placeholder="e.g. AI Outreach Q2"></div>
      <div class="form-group"><label>Contact List *</label><select id="ca-list"><option value="">- Select list -</option>${lOpts}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>From Name</label><input id="ca-from-name" value="${esc(campaign?.from_name || 'Nick | 365Soft Labs')}" placeholder="Sender name"></div>
      <div class="form-group"><label>From Email</label><input id="ca-from-email" value="${esc(campaign?.from_email || 'nick@365softlabs.com')}" placeholder="sender@example.com"></div>
    </div>
    <div class="form-group"><label>Schedule Type *</label>
      <select id="ca-type" onchange="renderScheduleFields()">
        <option value="immediate"${campaign?.schedule_type==='immediate'?' selected':''}>Send Immediately (on demand)</option>
        <option value="once"${campaign?.schedule_type==='once'?' selected':''}>Send Once - at a specific time</option>
        <option value="recurring"${campaign?.schedule_type==='recurring'?' selected':''}>Recurring - daily or weekly</option>
        <option value="drip"${campaign?.schedule_type==='drip'?' selected':''}>Drip Sequence - staggered multi-email</option>
      </select>
    </div>
    <div id="schedule-fields"></div>
    <div class="form-group" style="margin-top:4px">
      <label>Email Steps <span style="display:inline-flex;vertical-align:middle;margin-left:8px">${iconButton('plus', 'Add step', 'addStep()')}</span></label>
      <div class="steps-list" id="steps-list">${renderSteps(tOpts)}</div>
    </div>
    <div class="alert alert-error" id="ca-err"></div>
    <div class="flex gap" style="justify-content:flex-end;margin-top:8px">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCampaign()">${submitLabel}</button>
    </div>
  </div>`);
  renderScheduleFields();
}

function renderScheduleFields() {
  const type = document.getElementById('ca-type')?.value;
  const c = document.getElementById('schedule-fields');
  if (!c) return;
  if (type === 'once') {
    c.innerHTML = `<div class="form-group"><label>Send At</label><input type="datetime-local" id="sch-send-at"></div>`;
    document.getElementById('sch-send-at').value = toDateTimeLocalValue(campaignScheduleDraft.send_at);
  } else if (type === 'recurring') {
    c.innerHTML = `<div class="form-row"><div class="form-group"><label>First Send</label><input type="datetime-local" id="sch-send-at"></div><div class="form-group"><label>Repeat every (days)</label><input type="number" id="sch-interval" value="7" min="1"></div></div>`;
    document.getElementById('sch-send-at').value = toDateTimeLocalValue(campaignScheduleDraft.next_run);
    document.getElementById('sch-interval').value = String(parseInt(campaignScheduleDraft.interval_days, 10) || 7);
  } else {
    c.innerHTML = '';
  }
}

function renderSteps(tOpts) {
  return campaignSteps.map((s,i)=>`<div class="step-item">
    <div class="step-num">${i+1}</div>
    <div style="flex:1">
      <div class="form-row" style="margin-bottom:0">
        <div class="form-group" style="margin-bottom:0"><label>Template</label><select onchange="campaignSteps[${i}].template_id=this.value"><option value="">- Select -</option>${tOpts.replace('value="'+s.template_id+'"','value="'+s.template_id+'" selected')}</select></div>
        <div class="form-group" style="margin-bottom:0"><label>${i===0?'Send immediately':'Delay (days after prev)' }</label><input type="number" value="${s.delay_days}" min="0" onchange="campaignSteps[${i}].delay_days=parseInt(this.value)||0" ${i===0?'disabled':''}></div>
      </div>
    </div>
    ${campaignSteps.length>1?iconButton('trash', 'Remove step', `removeStep(${i})`, 'ghost', { extraClass: 'icon-btn-danger' }):''}
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
  const method = campaignEditingId ? 'PUT' : 'POST';
  const path = campaignEditingId ? `/api/campaigns/${campaignEditingId}` : '/api/campaigns';
  const r = await api(method, path, {name,list_id,schedule_type,schedule_config,steps:campaignSteps,from_name,from_email});
  if (r.error) { showAlert('ca-err',r.error); return; }
  campaignEditingId = '';
  campaignModalMode = 'create';
  campaignScheduleDraft = {};
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
  <div class="toolbar"><div class="toolbar-meta" style="flex:1"><span class="text-muted text-sm">${l.length} entries</span></div></div>
  <div class="table-wrap stack-on-mobile">
    <table><thead><tr><th>Recipient</th><th>Subject</th><th>Campaign</th><th>Template</th><th>Status</th><th>Sent At</th></tr></thead><tbody>
    ${l.length ? l.map(r=>`<tr>
      <td class="mono" data-label="Recipient" style="font-size:12px">${esc(r.contact_email)}</td>
      <td data-label="Subject" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.subject||'-')}</td>
      <td class="text-muted" data-label="Campaign">${esc(r.campaign_name||'-')}</td>
      <td class="text-muted" data-label="Template">${esc(r.template_name||'-')}</td>
      <td data-label="Status"><span class="badge badge-${r.status}">${r.status}${r.error?'<span title="'+esc(r.error)+'" style="cursor:help;margin-left:4px">(i)</span>':''}</span></td>
      <td class="text-muted text-sm" data-label="Sent At">${fmtDate(r.sent_at)}</td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted2);padding:32px">No sent emails yet.</td></tr>'}
    </tbody></table>
  </div>`;
}

// ── Unsubscribes ──────────────────────────────────────────────
function renderUnsubs() {
  const u = state.unsubs;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <div class="toolbar-meta" style="flex:1"><span class="text-muted text-sm">${u.length} unsubscribed</span></div>
    <span class="text-muted text-sm" style="font-style:italic">Managed by the email worker. <a href="https://365soft-email-worker.nick-598.workers.dev/unsubscribe" target="_blank" style="color:var(--cyan)">Open unsubscribe page</a></span>
  </div>
  <div class="table-wrap stack-on-mobile">
    <table><thead><tr><th>Email</th><th>Unsubscribed At</th><th>IP</th><th>Source</th></tr></thead><tbody>
    ${u.length ? u.map(c=>`<tr>
      <td class="mono" data-label="Email" style="font-size:12px">${esc(c.email)}</td>
      <td class="text-muted text-sm" data-label="Unsubscribed At">${fmtDate(c.unsubscribedAt||c.unsubscribed_at)}</td>
      <td class="text-muted text-sm mono" data-label="IP">${esc(c.ip||'-')}</td>
      <td class="text-muted text-sm" data-label="Source">${esc(c.source||'-')}</td>
    </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--muted2);padding:32px">No unsubscribes.</td></tr>'}
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
document.addEventListener('mousemove', e => {
  if (!state.ui.templateResizing) return;
  const workspace = document.getElementById('template-workspace-main');
  if (!workspace) return;
  const rect = workspace.getBoundingClientRect();
  const maxWidth = Math.max(320, Math.min(760, rect.width - 360));
  const nextWidth = clampTemplatePreviewWidth(Math.min(maxWidth, rect.right - e.clientX));
  state.ui.templatePreviewWidth = nextWidth;
  workspace.style.setProperty('--template-preview-width', `${nextWidth}px`);
});
document.addEventListener('mouseup', () => {
  if (!state.ui.templateResizing) return;
  state.ui.templateResizing = false;
  localStorage.setItem(TEMPLATE_PREVIEW_WIDTH_KEY, String(state.ui.templatePreviewWidth));
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeModal();
  closeMobileMenu();
  closeDrawer();
});
window.addEventListener('resize', () => {
  if (currentSection === 'templates') renderTemplates();
});

// ── Utils ─────────────────────────────────────────────────────
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function fmtDate(s) { if(!s) return '-'; try { return new Date(s).toLocaleString('en-AU',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return s; } }
function toDateTimeLocalValue(s) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
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
async function loadCrmStats() {
  state.crmStats = await api('GET','/api/crm/stats') || {};
  updateFollowUpBadges(state.crmStats?.followups_due || 0);
}
async function loadFollowUps() {
  state.followups = await api('GET','/api/crm/followups') || [];
  updateFollowUpBadges(state.followups.length);
}

// ── Pipeline Board ────────────────────────────────────────────
function renderPipelineColumn(stage, cards, stageVal) {
  return `<div class="pipeline-col stage-${stage}">
    <div class="pipeline-head">
      <span class="pipeline-title">${STAGE_LABELS[stage]}</span>
      <span class="pipeline-meta">${cards.length}${stageVal>0?' | '+fmtCurrency(stageVal):''}</span>
    </div>
    <div class="pipeline-cards">
      ${cards.length ? cards.map(c=>`<div class="pipeline-card" onclick="openDrawer('${c.id}')">
        <div class="pipeline-card-name">${esc(c.name||c.email)}</div>
        <div class="pipeline-card-company">${esc(c.company||c.email)}</div>
        ${c.deal_value>0?`<div class="pipeline-card-value">${fmtCurrency(c.deal_value)}</div>`:''}
        ${(c.tags||[]).length?`<div class="pipeline-card-tags">${c.tags.slice(0,3).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`:''}
        ${c.follow_up_at&&isOverdue(c.follow_up_at)?'<div class="pipeline-overdue">Follow-up overdue</div>':''}
      </div>`).join('') : `<div class="pipeline-empty">No contacts in ${STAGE_LABELS[stage].toLowerCase()} yet.</div>`}
    </div>
  </div>`;
}

function setPipelineStage(stage) {
  state.ui.pipelineStage = stage;
  renderPipeline();
}

function renderPipeline() {
  const p = state.pipeline || {};
  const cs = state.crmStats?.stages || {};
  const activeStage = state.ui.pipelineStage || STAGE_ORDER[0];
  const totalValue = STAGE_ORDER.filter(s=>s!=='lost').reduce((a,s)=>(a+(cs[s]?.value||0)),0);
  document.getElementById('content').innerHTML = `
  <div class="pipeline-toolbar">
    <div class="pipeline-summary">
      <div class="pipeline-summary-label">Open Pipeline Value</div>
      <div class="pipeline-summary-value">${fmtCurrency(totalValue)}</div>
      <div class="pipeline-summary-note">${Object.values(p).reduce((sum, cards) => sum + cards.length, 0)} tracked contacts across ${STAGE_ORDER.length} stages</div>
    </div>
    <div class="pipeline-actions">
      <button class="btn btn-ghost" onclick="openImportModal()">Import CSV</button>
      <button class="btn btn-primary" onclick="openContactModal()">+ Add Contact</button>
    </div>
  </div>
  <div class="pipeline-mobile">
    <div class="pipeline-stage-tabs">
      ${STAGE_ORDER.map(stage=>`<button class="pipeline-stage-tab ${activeStage===stage?'active':''}" type="button" onclick="setPipelineStage('${stage}')">${STAGE_LABELS[stage]} (${(p[stage]||[]).length})</button>`).join('')}
    </div>
    ${renderPipelineColumn(activeStage, p[activeStage] || [], cs[activeStage]?.value || 0)}
  </div>
  <div class="pipeline pipeline-desktop">
    ${STAGE_ORDER.map(stage => renderPipelineColumn(stage, p[stage] || [], cs[stage]?.value || 0)).join('')}
  </div>`;
}

// ── Follow-ups ────────────────────────────────────────────────
function renderFollowUps() {
  const fu = state.followups || [];
  document.getElementById('content').innerHTML = `
  <div class="followup-summary">
    <div class="followup-summary-title">Due Now</div>
    <div class="followup-summary-value">${fu.length}</div>
    <div class="followup-summary-note">Contacts that need a touchpoint or stage review.</div>
  </div>
  ${fu.length ? fu.map(c=>`
  <div class="followup-card ${isOverdue(c.follow_up_at)?'followup-overdue':''}" onclick="openDrawer('${c.id}')">
    <div style="width:40px;height:40px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">
      ${(c.name||c.email||'?')[0].toUpperCase()}
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:600;font-size:14px">${esc(c.name||c.email)}</div>
      <div class="text-muted text-sm">${esc(c.company||'')} <span class="badge badge-draft">${STAGE_LABELS[c.stage]||c.stage}</span></div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:12px;${isOverdue(c.follow_up_at)?'color:var(--red)':'color:var(--amber)'};font-weight:600">${fmtDate(c.follow_up_at)}</div>
      ${c.deal_value>0?`<div style="font-size:11px;color:var(--green)">${fmtCurrency(c.deal_value)}</div>`:''}
    </div>
  </div>`).join('') : `<div class="empty"><div class="empty-icon">OK</div><p>No follow-ups due. You are all caught up.</p></div>`}
  `;
}

// ── Contact Drawer ────────────────────────────────────────────
let currentDrawerContactId = null;

async function openDrawer(contactId) {
  currentDrawerContactId = contactId;
  document.getElementById('drawer-bg').classList.add('open');
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-body').innerHTML = `<div class="empty"><div class="empty-icon">...</div><p>Loading...</p></div>`;
  document.getElementById('drawer-name').textContent = '...';
  document.getElementById('drawer-company').textContent = '';
  const d = await api('GET',`/api/crm/contact/${contactId}`);
  if (d.error) { document.getElementById('drawer-body').innerHTML = `<p style="color:var(--red)">${d.error}</p>`; return; }
  renderDrawerContent(d);
}

function renderDrawerContent(d) {
  const c = d.contact;
  document.getElementById('drawer-name').textContent = c.name || c.email;
  document.getElementById('drawer-company').textContent = [c.title, c.company].filter(Boolean).join(' | ');
  const tags = c.tags || [];
  document.getElementById('drawer-body').innerHTML = `
  <div class="drawer-section">
    <div class="drawer-control-row">
      <select class="stage-select" onchange="patchContact('${c.id}','stage',this.value)">
        ${STAGE_ORDER.map(s=>`<option value="${s}" ${c.stage===s?'selected':''}>${STAGE_LABELS[s]}</option>`).join('')}
      </select>
      <div class="drawer-inline-field">
        <span class="text-muted text-sm">Deal value $</span>
        <input class="drawer-inline-input drawer-inline-input-sm" type="number" value="${c.deal_value||0}" min="0" step="100" onchange="patchContact('${c.id}','deal_value',parseFloat(this.value)||0)">
      </div>
      <div class="drawer-inline-field">
        <span class="text-muted text-sm">Follow-up</span>
        <input class="drawer-inline-input" type="date" value="${(c.follow_up_at||'').split('T')[0]}" onchange="patchContact('${c.id}','follow_up_at',this.value?this.value+'T00:00:00Z':null)">
      </div>
    </div>
  </div>

  <div class="drawer-section">
    <div class="drawer-section-title">Contact Info ${iconButton('edit', 'Edit contact', `openContactEditModal('${c.id}')`)}</div>
    <div class="info-grid">
      <div class="info-item"><label>Email</label><span class="mono" style="font-size:12px">${esc(c.email)}</span></div>
      <div class="info-item"><label>Title</label><span>${esc(c.title||'-')}</span></div>
      <div class="info-item"><label>Phone</label><span>${esc(c.phone||'-')}</span></div>
      <div class="info-item"><label>Company</label><span>${esc(c.company||'-')}</span></div>
      <div class="info-item"><label>LinkedIn</label>${c.linkedin?`<a href="${esc(c.linkedin)}" target="_blank" style="color:var(--cyan);font-size:12px">View Profile</a>`:'<span>-</span>'}</div>
      <div class="info-item"><label>Last Contacted</label><span class="text-sm">${c.last_contacted_at?fmtDate(c.last_contacted_at):'Never'}</span></div>
      <div class="info-item"><label>Added</label><span class="text-sm">${fmtDate(c.created_at)}</span></div>
    </div>
    ${tags.length?`<div style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap">${tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}${iconButton('tag', 'Edit tags', `editTags('${c.id}',${JSON.stringify(tags).replace(/'/g,'&#39;')})`)}</div>`
    :`<div style="margin-top:8px">${iconButton('tag', 'Add tags', `editTags('${c.id}',${JSON.stringify(tags)})`)}</div>`}
  </div>

  <div class="drawer-section">
    <div class="drawer-section-title">Activity & Notes</div>
    <div class="drawer-note-entry">
      <select id="note-type" class="drawer-note-select">
        <option value="note">Note</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="email">Email</option>
      </select>
      <input id="note-input" class="drawer-note-input" placeholder="Log an activity or note..." onkeydown="if(event.key==='Enter')addNoteFromDrawer('${c.id}')">
      ${iconButton('plus', 'Add note', `addNoteFromDrawer('${c.id}')`, 'primary')}
    </div>
    <div id="notes-list">
    ${d.notes.length ? d.notes.map(n=>`<div class="note-item" id="note-${n.id}">
      <span class="note-type note-${n.type}">${n.type}</span>
      <div class="note-content">${esc(n.content)}</div>
      <div class="flex" style="justify-content:space-between;align-items:center;margin-top:4px">
        <span class="note-date">${fmtDate(n.created_at)}</span>
        ${iconButton('trash', 'Delete note', `deleteNoteFromDrawer('${c.id}','${n.id}')`, 'ghost', { extraClass: 'icon-btn-danger' })}
      </div>
    </div>`).join('') : '<p class="text-muted text-sm">No notes yet.</p>'}
    </div>
  </div>

  <div class="drawer-section">
    <div class="drawer-section-title">Email History (${d.emails.length})</div>
    ${d.emails.length ? `<div class="table-wrap stack-on-mobile"><table>
      <thead><tr><th>Subject</th><th>Status</th><th>Sent At</th></tr></thead>
      <tbody>${d.emails.map(e=>`<tr>
        <td data-label="Subject" style="font-size:12px">${esc(e.subject||'-')}</td>
        <td data-label="Status"><span class="badge badge-${e.status}">${e.status}</span></td>
        <td class="text-muted text-sm" data-label="Sent At">${fmtDate(e.sent_at)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p class="text-muted text-sm">No emails sent yet.</p>'}
  </div>

  ${d.lists.length?`<div class="drawer-section"><div class="drawer-section-title">Lists</div><div style="display:flex;gap:6px;flex-wrap:wrap">${d.lists.map(l=>`<span class="badge badge-active">${esc(l)}</span>`).join('')}</div></div>`:''}
  `;
}

async function patchContact(id, field, value) {
  await api('PATCH',`/api/crm/contact/${id}`,{ [field]: value });
  await loadCrmStats();
  if (currentSection==='pipeline') {
    await loadPipeline();
    renderPipeline();
  }
  if (currentSection==='followups') {
    await loadFollowUps();
    renderFollowUps();
  }
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
    div.innerHTML = `<span class="note-type note-${r.type}">${r.type}</span><div class="note-content">${esc(r.content)}</div><div class="flex" style="justify-content:space-between;align-items:center;margin-top:4px"><span class="note-date">just now</span>${iconButton('trash', 'Delete note', `deleteNoteFromDrawer('${contactId}','${r.id}')`, 'ghost', { extraClass: 'icon-btn-danger' })}</div>`;
    nl.prepend(div);
  }
}

async function deleteNoteFromDrawer(contactId, noteId) {
  await api('DELETE',`/api/crm/contact/${contactId}/notes/${noteId}`);
  const el = document.getElementById('note-'+noteId);
  if (el) el.remove();
}

async function openContactEditModal(id) {
  const detail = await api('GET',`/api/crm/contact/${id}`);
  if (detail?.error) return;
  openContactModal(normalizeContactRecord(detail.contact), { returnToDrawer: id });
}

function editTags(id, tags) {
  setModal(`<div class="modal-head"><h3>Edit Tags</h3><button class="modal-close" onclick="closeModal()">x</button></div>
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
