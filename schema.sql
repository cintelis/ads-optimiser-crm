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

CREATE TABLE IF NOT EXISTS contact_notes (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'note',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_contact ON contact_notes(contact_id, created_at DESC);
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
