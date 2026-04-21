ALTER TABLE user_settings ADD COLUMN news_llm_provider TEXT NOT NULL DEFAULT 'gemini';
ALTER TABLE user_settings ADD COLUMN news_llm_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash';
ALTER TABLE user_settings ADD COLUMN news_llm_api_key TEXT NOT NULL DEFAULT '';

ALTER TABLE user_settings ADD COLUMN draft_llm_provider TEXT NOT NULL DEFAULT 'gemini';
ALTER TABLE user_settings ADD COLUMN draft_llm_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash';
ALTER TABLE user_settings ADD COLUMN draft_llm_api_key TEXT NOT NULL DEFAULT '';

ALTER TABLE user_settings ADD COLUMN image_llm_provider TEXT NOT NULL DEFAULT 'gemini';
ALTER TABLE user_settings ADD COLUMN image_llm_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash';
ALTER TABLE user_settings ADD COLUMN image_llm_api_key TEXT NOT NULL DEFAULT '';

UPDATE user_settings
SET
  news_llm_provider = COALESCE(NULLIF(news_llm_provider, ''), llm_provider, 'gemini'),
  news_llm_model = COALESCE(NULLIF(news_llm_model, ''), llm_model, 'gemini-2.5-flash'),
  news_llm_api_key = COALESCE(NULLIF(news_llm_api_key, ''), gemini_api_key, ''),
  draft_llm_provider = COALESCE(NULLIF(draft_llm_provider, ''), llm_provider, 'gemini'),
  draft_llm_model = COALESCE(NULLIF(draft_llm_model, ''), llm_model, 'gemini-2.5-flash'),
  draft_llm_api_key = COALESCE(NULLIF(draft_llm_api_key, ''), gemini_api_key, ''),
  image_llm_provider = COALESCE(NULLIF(image_llm_provider, ''), llm_provider, 'gemini'),
  image_llm_model = COALESCE(NULLIF(image_llm_model, ''), llm_model, 'gemini-2.5-flash'),
  image_llm_api_key = COALESCE(NULLIF(image_llm_api_key, ''), gemini_api_key, '');
