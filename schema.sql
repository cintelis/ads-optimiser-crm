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
