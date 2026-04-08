-- 365Soft Labs Outreach Dashboard — D1 Schema
-- Run: wrangler d1 execute outreach-db --file=schema.sql

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT '',
  company TEXT DEFAULT '',
  unsubscribed INTEGER DEFAULT 0,
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_list_members (
  contact_id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  PRIMARY KEY (contact_id, list_id)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  list_id TEXT,
  schedule_type TEXT NOT NULL,
  schedule_config TEXT DEFAULT '{}',
  status TEXT DEFAULT 'draft',
  from_email TEXT DEFAULT 'nick@365softlabs.com',
  from_name TEXT DEFAULT 'Nick | 365Soft Labs',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_steps (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  delay_days INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS drip_progress (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  current_step INTEGER DEFAULT 0,
  last_sent_at TEXT,
  next_send_at TEXT,
  completed INTEGER DEFAULT 0,
  UNIQUE(campaign_id, contact_id)
);

CREATE TABLE IF NOT EXISTS sent_log (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  campaign_name TEXT,
  contact_id TEXT,
  contact_email TEXT NOT NULL,
  template_id TEXT,
  template_name TEXT,
  subject TEXT,
  status TEXT DEFAULT 'sent',
  error TEXT,
  sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_unsub ON contacts(unsubscribed);
CREATE INDEX IF NOT EXISTS idx_logs_sent_at ON sent_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_drip ON drip_progress(campaign_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_steps ON campaign_steps(campaign_id, step_order);

-- ── CRM Extensions ───────────────────────────────────────────

-- Migrate contacts table with CRM fields
-- (Run ALTER statements separately if contacts table already exists)
ALTER TABLE contacts ADD COLUMN stage TEXT DEFAULT 'lead';
ALTER TABLE contacts ADD COLUMN deal_value REAL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN tags TEXT DEFAULT '[]';
ALTER TABLE contacts ADD COLUMN last_contacted_at TEXT;
ALTER TABLE contacts ADD COLUMN follow_up_at TEXT;
ALTER TABLE contacts ADD COLUMN linkedin TEXT DEFAULT '';
ALTER TABLE contacts ADD COLUMN phone TEXT DEFAULT '';
ALTER TABLE contacts ADD COLUMN notes_count INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS contact_profiles (
  contact_id TEXT PRIMARY KEY,
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  title TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  updated_at TEXT NOT NULL
);

-- contact_notes was dropped in Sprint 5; contact notes now live in the
-- polymorphic `activity` table (entity_type='contact').

CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(stage);
CREATE INDEX IF NOT EXISTS idx_contacts_followup ON contacts(follow_up_at);
CREATE INDEX IF NOT EXISTS idx_contact_profiles_name ON contact_profiles(last_name, first_name);

-- ── Sprint 1: multi-user auth foundation ─────────────────────
-- Mirrors migrations/001_users_and_sessions.sql so a fresh DB created from
-- this file alone has the complete schema. Existing databases should run the
-- migration file once via wrangler d1 execute.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  active INTEGER NOT NULL DEFAULT 1,
  preferences TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'PBKDF2-SHA256',
  iterations INTEGER NOT NULL DEFAULT 100000,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_totp (
  user_id TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_backup_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON user_backup_codes(user_id, used_at);

CREATE TABLE IF NOT EXISTS app_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  is_2fa_pending INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON app_sessions(expires_at);

-- ── Sprint 1: polymorphic activity feed ──────────────────────
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  user_id TEXT,
  kind TEXT NOT NULL DEFAULT 'note',
  body_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity(user_id, created_at DESC);

-- ── Sprint 2: Tasks (projects + issues) ──────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  lead_user_id TEXT,
  issue_seq INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_key ON projects(key);
CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(active);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'task',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  assignee_id TEXT,
  reporter_id TEXT NOT NULL,
  parent_id TEXT,
  due_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, issue_number)
);
CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id, active, status);
CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee_id, active);
CREATE INDEX IF NOT EXISTS idx_issues_key ON issues(issue_key);
CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues(parent_id);
CREATE INDEX IF NOT EXISTS idx_issues_updated ON issues(updated_at DESC);

-- ── Sprint 6: attachments (R2-backed) ───────────────────────

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_uploader ON attachments(uploaded_by);

-- ── Sprint 6: cross-entity links ────────────────────────────

CREATE TABLE IF NOT EXISTS entity_links (
  id TEXT PRIMARY KEY,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(from_type, from_id, to_type, to_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_links_from ON entity_links(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_to ON entity_links(to_type, to_id);

-- ── Sprint 6: app-wide settings ─────────────────────────────

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- ── Sprint 5: integrations + per-user notifications ─────────

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_integrations_kind_active ON integrations(kind, active);

CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  filter TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_rules_event ON notification_rules(event_type, active);
CREATE INDEX IF NOT EXISTS idx_notification_rules_integration ON notification_rules(integration_id);

CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  status TEXT NOT NULL,
  error TEXT,
  sent_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_log_sent ON notification_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_integration ON notification_log(integration_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  actor_id TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_recent ON notifications(user_id, created_at DESC);

-- ── Sprint 4: Docs (spaces + pages + version history) ───────

CREATE TABLE IF NOT EXISTS doc_spaces (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_spaces_key ON doc_spaces(key);
CREATE INDEX IF NOT EXISTS idx_doc_spaces_active ON doc_spaces(active);

CREATE TABLE IF NOT EXISTS doc_pages (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
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
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL DEFAULT '',
  author_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_versions_page ON doc_page_versions(page_id, created_at DESC);

-- ── Sprint 3: sprints ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'planned',
  start_at TEXT,
  end_at TEXT,
  planned_end_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sprints_project_state ON sprints(project_id, state);
CREATE INDEX IF NOT EXISTS idx_sprints_state ON sprints(state);

-- sprint_id is added to issues via migrations/004_sprints.sql for existing
-- databases. For fresh installs from this file, issues already has it via
-- the column list below would need updating — but we keep the original
-- issues definition above untouched for clarity. New installs can run the
-- 004 migration as the final step.
