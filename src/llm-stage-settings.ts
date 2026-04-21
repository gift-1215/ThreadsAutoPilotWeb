import type { StoredSettings } from "./types";
import { sanitizeLlmModel, sanitizeLlmProvider } from "./utils";

export type LlmStage = "news" | "draft" | "image";

function sanitizeApiKey(value: unknown) {
  return String(value || "").trim().slice(0, 4000);
}

function resolveDraftFields(settings: StoredSettings) {
  const provider = sanitizeLlmProvider(settings.draftLlmProvider ?? settings.llmProvider);
  const model = sanitizeLlmModel(settings.draftLlmModel ?? settings.llmModel, provider);
  const apiKey = sanitizeApiKey(settings.draftLlmApiKey ?? settings.geminiApiKey);
  return { provider, model, apiKey };
}

export function resolveStageLlmSettings(settings: StoredSettings, stage: LlmStage): StoredSettings {
  const draft = resolveDraftFields(settings);

  if (stage === "draft") {
    return {
      ...settings,
      geminiApiKey: draft.apiKey,
      llmProvider: draft.provider,
      llmModel: draft.model
    };
  }

  const providerSource = stage === "news" ? settings.newsLlmProvider : settings.imageLlmProvider;
  const modelSource = stage === "news" ? settings.newsLlmModel : settings.imageLlmModel;
  const apiKeySource = stage === "news" ? settings.newsLlmApiKey : settings.imageLlmApiKey;

  const provider = sanitizeLlmProvider(providerSource ?? draft.provider);
  const model = sanitizeLlmModel(modelSource ?? draft.model, provider);
  const apiKey = sanitizeApiKey(apiKeySource ?? draft.apiKey);

  return {
    ...settings,
    geminiApiKey: apiKey,
    llmProvider: provider,
    llmModel: model
  };
}

export function hasStageApiKey(settings: StoredSettings, stage: LlmStage) {
  return Boolean(resolveStageLlmSettings(settings, stage).geminiApiKey);
}
