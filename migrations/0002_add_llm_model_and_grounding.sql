ALTER TABLE user_settings ADD COLUMN llm_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash';
ALTER TABLE user_settings ADD COLUMN enable_grounding INTEGER NOT NULL DEFAULT 0;
