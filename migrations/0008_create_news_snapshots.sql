CREATE TABLE IF NOT EXISTS news_snapshots (
  user_id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'google_rss',
  context_text TEXT NOT NULL DEFAULT '',
  preview_json TEXT NOT NULL DEFAULT '{}',
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_news_snapshots_updated ON news_snapshots(updated_at DESC);
