ALTER TABLE user_settings ADD COLUMN image_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pending_drafts ADD COLUMN image_url TEXT;
ALTER TABLE pending_drafts ADD COLUMN image_prompt TEXT;
