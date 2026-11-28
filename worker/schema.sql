-- HIRAD ROBOT PANEL - D1 schema (migration 0001)
PRAGMA foreign_keys = ON;

CREATE TABLE bot_connections (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','connected','error')),
  bot_id TEXT,
  bot_name TEXT,
  bot_username TEXT,
  token_enc TEXT,                -- AES-GCM ciphertext (key = Worker secret TOKEN_ENC_KEY); never plaintext
  last_error TEXT,
  connected_at TEXT,
  last_checked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO bot_connections (id, status) VALUES (1, 'disconnected');

CREATE TABLE groups (
  chat_id TEXT PRIMARY KEY CHECK (length(chat_id) BETWEEN 1 AND 128),
  title TEXT,
  chat_type TEXT,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('reachable','unreachable','unknown')),
  last_error TEXT,
  last_checked_at TEXT,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE group_settings (
  group_id TEXT PRIMARY KEY REFERENCES groups(chat_id) ON DELETE CASCADE,
  rules_text TEXT NOT NULL DEFAULT '' CHECK (length(rules_text) <= 2000),
  slow_mode_seconds INTEGER NOT NULL DEFAULT 0 CHECK (slow_mode_seconds BETWEEN 0 AND 3600),
  lock_links INTEGER NOT NULL DEFAULT 0 CHECK (lock_links IN (0,1)),
  lock_media INTEGER NOT NULL DEFAULT 0 CHECK (lock_media IN (0,1)),
  warn_threshold INTEGER NOT NULL DEFAULT 3 CHECK (warn_threshold BETWEEN 1 AND 20),
  warn_action TEXT NOT NULL DEFAULT 'review' CHECK (warn_action IN ('none','review','mute','temp_ban','ban')),
  action_duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (action_duration_minutes BETWEEN 1 AND 525600),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE moderation_rules (
  group_id TEXT NOT NULL REFERENCES groups(chat_id) ON DELETE CASCADE,
  rule_key TEXT NOT NULL CHECK (rule_key IN ('anti_spam','anti_flood','anti_link','anti_ads','profanity','anti_repeat','anti_mention','anti_emoji','join_flood','scam_patterns','long_message','admin_protection')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  params_json TEXT NOT NULL DEFAULT '{}' CHECK (length(params_json) <= 8000),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (group_id, rule_key)
);

CREATE TABLE welcome_settings (
  group_id TEXT PRIMARY KEY REFERENCES groups(chat_id) ON DELETE CASCADE,
  welcome_enabled INTEGER NOT NULL DEFAULT 0 CHECK (welcome_enabled IN (0,1)),
  welcome_text TEXT NOT NULL DEFAULT 'سلام {name} عزیز! به {group} خوش آمدی.' CHECK (length(welcome_text) <= 1000),
  leave_enabled INTEGER NOT NULL DEFAULT 0 CHECK (leave_enabled IN (0,1)),
  leave_text TEXT NOT NULL DEFAULT '{name} از {group} خارج شد.' CHECK (length(leave_text) <= 1000),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(chat_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 128),
  reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  issued_by TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT
);
CREATE INDEX idx_warnings_group_user ON warnings (group_id, user_id, revoked_at);

CREATE TABLE violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(chat_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 128),
  rule_key TEXT NOT NULL,
  excerpt TEXT CHECK (excerpt IS NULL OR length(excerpt) <= 200),
  action_taken TEXT NOT NULL DEFAULT 'logged',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_violations_group_time ON violations (group_id, created_at);

CREATE TABLE user_exemptions (
  group_id TEXT NOT NULL REFERENCES groups(chat_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 128),
  kind TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user','admin')),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE user_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(chat_id) ON DELETE CASCADE,
  reporter_id TEXT,
  reported_user_id TEXT NOT NULL CHECK (length(reported_user_id) BETWEEN 1 AND 128),
  message_id TEXT,
  reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);
CREATE INDEX idx_reports_group_status ON user_reports (group_id, status);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details_json TEXT CHECK (details_json IS NULL OR length(details_json) <= 2000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_time ON audit_logs (id DESC);

CREATE TABLE analytics_daily (
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  group_id TEXT NOT NULL DEFAULT '*',
  metric TEXT NOT NULL CHECK (metric IN ('warnings','violations','messages_deleted','welcome_tests')),
  value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  PRIMARY KEY (day, group_id, metric)
);

-- Operational tables (not domain data)
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
