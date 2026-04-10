ALTER TABLE user_settings ADD COLUMN post_instruction TEXT;
ALTER TABLE user_settings ADD COLUMN post_style TEXT;

UPDATE user_settings
SET
  post_instruction = COALESCE(post_instruction, post_preference),
  post_style = COALESCE(post_style, reply_preference);

CREATE TABLE IF NOT EXISTS pending_drafts (
  user_id INTEGER PRIMARY KEY,
  draft TEXT NOT NULL,
  llm_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  enable_grounding INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pending_drafts_updated ON pending_drafts(updated_at DESC);
