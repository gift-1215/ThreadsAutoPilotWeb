CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT,
  picture_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY,
  threads_token TEXT,
  gemini_api_key TEXT,
  post_preference TEXT,
  reply_preference TEXT,
  post_time TEXT NOT NULL DEFAULT '09:00',
  timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_runs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  run_type TEXT NOT NULL,
  run_date TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  thread_id TEXT,
  draft TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_post_runs_user_created ON post_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_runs_user_date_type ON post_runs(user_id, run_date, run_type);
