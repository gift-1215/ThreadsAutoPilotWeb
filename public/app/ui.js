import { el, state } from "./state.js";

const SETTINGS_TEXT_LIMIT = 1000;
const CLEAR_CONFIRM_WORD = "CLEAR";
const STEPS = ["settings", "draft", "runs"];
const DEFAULT_TIMEZONE = "Asia/Taipei";
const DEFAULT_LLM_PROVIDER = "gemini";
const DEFAULT_NEWS_PROVIDER = "google_rss";
const SETTINGS_SAVE_MESSAGES = {
  clean: "已載入最近一次儲存設定。修改後請務必按「儲存設定」。",
  dirty: "你有尚未儲存的設定變更。請先按「儲存設定」再執行其他操作。",
  saved: "設定已儲存。後續若再修改，請記得再按一次「儲存設定」。"
};
const LLM_PROVIDER_CONFIG = {
  gemini: {
    apiKeyLabel: "Gemini API Key",
    apiKeyPlaceholder: "貼上你的 Gemini API Key",
    apiKeyHint: "請填入 Gemini API Key。",
    models: [
      { value: "gemini-2.5-flash", label: "gemini-2.5-flash（較便宜）" },
      { value: "gemini-2.5-pro", label: "gemini-2.5-pro（較強）" }
    ]
  },
  chatgpt: {
    apiKeyLabel: "ChatGPT API Key",
    apiKeyPlaceholder: "貼上你的 OpenAI API Key",
    apiKeyHint: "請填入 OpenAI API Key（以 sk- 開頭）。",
    models: [
      { value: "gpt-4.1-mini", label: "gpt-4.1-mini（較便宜）" },
      { value: "gpt-4.1", label: "gpt-4.1（較強）" }
    ]
  },
  anthropic: {
    apiKeyLabel: "Anthropic API Key",
    apiKeyPlaceholder: "貼上你的 Anthropic API Key",
    apiKeyHint: "請填入 Anthropic API Key（以 sk-ant- 開頭）。",
    models: [
      { value: "claude-3-5-haiku-latest", label: "claude-3-5-haiku-latest（較便宜）" },
      { value: "claude-3-7-sonnet-latest", label: "claude-3-7-sonnet-latest（較強）" }
    ]
  },
  felo: {
    apiKeyLabel: "Felo API Key",
    apiKeyPlaceholder: "貼上你的 Felo API Key",
    apiKeyHint: "請填入 Felo Open Platform API Key（openapi.felo.ai）。",
    models: [
      { value: "felo-search", label: "felo-search（搜尋優先）" },
      { value: "felo-pro", label: "felo-pro（較強）" }
    ]
  }
};
const COMMON_TIMEZONES = [
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney"
];

function normalizeLlmProvider(value) {
  const candidate = String(value || "").trim().toLowerCase();
  if (candidate && Object.prototype.hasOwnProperty.call(LLM_PROVIDER_CONFIG, candidate)) {
    return candidate;
  }
  return DEFAULT_LLM_PROVIDER;
}

function getDefaultLlmModel(provider) {
  const config = LLM_PROVIDER_CONFIG[provider] || LLM_PROVIDER_CONFIG[DEFAULT_LLM_PROVIDER];
  return config.models[0].value;
}

function statusTag(status) {
  const safeStatus = String(status || "unknown").toLowerCase();
  const className =
    safeStatus === "success" || safeStatus === "failed" || safeStatus === "skipped"
      ? safeStatus
      : "skipped";
  return `<span class="statusTag ${className}">${safeStatus}</span>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeExternalUrl(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) {
    return "";
  }
  return text;
}

function statusLabel(status) {
  const key = String(status || "").toLowerCase();
  if (key === "success") {
    return "成功";
  }
  if (key === "failed") {
    return "失敗";
  }
  if (key === "skipped") {
    return "略過";
  }
  return "未知";
}

function newsProviderLabel(provider) {
  const key = String(provider || "").toLowerCase();
  if (key === "google_rss") {
    return "Google News RSS";
  }
  if (key === "gnews") {
    return "GNews API";
  }
  if (key === "auto") {
    return "Auto";
  }
  if (key === "llm") {
    return "LLM 抓新聞";
  }
  return "未知來源";
}

function parseDbTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (sqliteUtc.test(text)) {
    const parsed = new Date(text.replace(" ", "T") + "Z");
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatInTimezone(value, timezone = state.displayTimezone || DEFAULT_TIMEZONE) {
  const date = parseDbTimestamp(value);
  if (!date) {
    return String(value || "");
  }

  try {
    const formatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    return formatter.format(date).replace(" ", " ");
  } catch {
    return String(value || "");
  }
}

function getSupportedTimezones() {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      return Intl.supportedValuesOf("timeZone");
    }
  } catch {
    // ignore
  }
  return COMMON_TIMEZONES;
}

function ensureTimezoneOption(timezone) {
  if (!el.timezone) {
    return;
  }
  const value = String(timezone || "").trim();
  if (!value) {
    return;
  }
  const exists = Array.from(el.timezone.options).some((option) => option.value === value);
  if (!exists) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    el.timezone.appendChild(option);
  }
}

export function initTimezoneOptions() {
  if (!el.timezone) {
    return;
  }

  const timezoneSet = new Set([...COMMON_TIMEZONES, ...getSupportedTimezones()]);
  const timezones = [...timezoneSet].sort((a, b) => a.localeCompare(b));

  el.timezone.innerHTML = "";
  for (const timezone of timezones) {
    const option = document.createElement("option");
    option.value = timezone;
    option.textContent = timezone;
    el.timezone.appendChild(option);
  }

  ensureTimezoneOption(DEFAULT_TIMEZONE);
  el.timezone.value = DEFAULT_TIMEZONE;
  state.displayTimezone = DEFAULT_TIMEZONE;
}

function isClearRunsReady() {
  return String(el.clearRunsConfirmText?.value || "").trim().toUpperCase() === CLEAR_CONFIRM_WORD;
}

export function showToast(message, durationMs = 3000) {
  if (!el.toast) {
    return;
  }

  el.toast.textContent = message;
  el.toast.classList.remove("hidden");

  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
  }
  state.toastTimer = setTimeout(() => {
    if (el.toast) {
      el.toast.classList.add("hidden");
    }
  }, durationMs);
}

export function setDraftEditStatus(message, isError = false) {
  if (!el.draftEditStatus) {
    return;
  }
  el.draftEditStatus.textContent = message;
  el.draftEditStatus.classList.toggle("error", isError);
}

export function setSettingsSaveState(mode = "clean") {
  const saveState =
    mode === "dirty" || mode === "saved" || mode === "clean" ? mode : "clean";
  state.settingsSaveState = saveState;

  if (!el.settingsSaveReminder || !el.settingsSaveReminderText) {
    return;
  }

  el.settingsSaveReminder.classList.toggle("isDirty", saveState === "dirty");
  el.settingsSaveReminder.classList.toggle("isSaved", saveState === "saved");
  el.settingsSaveReminderText.textContent = SETTINGS_SAVE_MESSAGES[saveState];
}

function getStageLlmElements(stage) {
  if (stage === "news") {
    return {
      provider: el.newsLlmProvider,
      model: el.newsLlmModel,
      apiKeyInput: el.newsLlmApiKey,
      apiKeyLabel: el.newsLlmApiKeyLabel,
      apiKeyHint: el.newsLlmApiKeyHint
    };
  }
  if (stage === "image") {
    return {
      provider: el.imageLlmProvider,
      model: el.imageLlmModel,
      apiKeyInput: el.imageLlmApiKey,
      apiKeyLabel: el.imageLlmApiKeyLabel,
      apiKeyHint: el.imageLlmApiKeyHint
    };
  }
  return {
    provider: el.draftLlmProvider,
    model: el.draftLlmModel,
    apiKeyInput: el.draftLlmApiKey,
    apiKeyLabel: el.draftLlmApiKeyLabel,
    apiKeyHint: el.draftLlmApiKeyHint
  };
}

export function syncStageLlmProviderUi(stage, provider, preferredModel = "") {
  const stageEls = getStageLlmElements(stage);
  const safeProvider = normalizeLlmProvider(provider);
  const config = LLM_PROVIDER_CONFIG[safeProvider];
  const modelOptions = config.models;
  const selectedModel = modelOptions.some((option) => option.value === preferredModel)
    ? preferredModel
    : modelOptions[0].value;

  if (stageEls.provider) {
    stageEls.provider.value = safeProvider;
  }

  if (stageEls.model) {
    stageEls.model.innerHTML = "";
    for (const option of modelOptions) {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      stageEls.model.appendChild(node);
    }
    stageEls.model.value = selectedModel;
  }

  if (stageEls.apiKeyLabel) {
    stageEls.apiKeyLabel.textContent = config.apiKeyLabel;
  }
  if (stageEls.apiKeyInput) {
    stageEls.apiKeyInput.placeholder = config.apiKeyPlaceholder;
  }
  if (stageEls.apiKeyHint) {
    stageEls.apiKeyHint.textContent = config.apiKeyHint;
  }

  return { provider: safeProvider, model: selectedModel };
}

export function syncLlmProviderUi(provider, preferredModel = "") {
  return syncStageLlmProviderUi("draft", provider, preferredModel);
}

export function setManualReplyLoading(isLoading) {
  state.manualReplyLoading = Boolean(isLoading);
  if (!el.manualReplyBtn) {
    return;
  }

  const defaultText = (el.manualReplyBtn.dataset.defaultText || el.manualReplyBtn.textContent || "").trim();
  if (!el.manualReplyBtn.dataset.defaultText) {
    el.manualReplyBtn.dataset.defaultText = defaultText || "回覆留言";
  }

  el.manualReplyBtn.textContent = state.manualReplyLoading
    ? "留言回覆中..."
    : el.manualReplyBtn.dataset.defaultText;
  el.manualReplyBtn.classList.toggle("isBusy", state.manualReplyLoading);
  el.manualReplyBtn.disabled = state.isLoading || state.manualReplyLoading;
}

export function setLoading(isLoading, text = "等待 LLM 回覆中...") {
  state.isLoading = isLoading;

  if (el.saveBtn) {
    el.saveBtn.disabled = isLoading;
  }
  if (el.generateDraftBtn) {
    el.generateDraftBtn.disabled = isLoading;
  }
  if (el.generateDraftImageBtn) {
    el.generateDraftImageBtn.disabled = isLoading || !state.hasPendingDraft;
  }
  if (el.runNewsNowBtn) {
    el.runNewsNowBtn.disabled = isLoading;
  }
  if (el.reloadRunsBtn) {
    el.reloadRunsBtn.disabled = isLoading;
  }
  if (el.clearRunsBtn) {
    el.clearRunsBtn.disabled = isLoading || !isClearRunsReady();
  }
  if (el.clearRunsConfirmText) {
    el.clearRunsConfirmText.disabled = isLoading;
  }
  if (el.publishDraftBtn) {
    el.publishDraftBtn.disabled = isLoading || !state.hasPendingDraft;
  }
  if (el.manualReplyBtn) {
    el.manualReplyBtn.disabled = isLoading || state.manualReplyLoading;
  }

  if (el.loadingIndicator) {
    el.loadingIndicator.classList.toggle("hidden", !isLoading);
  }
  if (el.loadingText) {
    el.loadingText.textContent = text;
  }
  if (el.activityIndicator) {
    el.activityIndicator.classList.toggle("hidden", !isLoading);
  }
  if (el.activityText) {
    el.activityText.textContent = text || "作業進行中...";
  }
}

function getFilteredRuns(runs) {
  const statusFilter = String(el.runStatusFilter?.value || "all").toLowerCase();
  const searchKeyword = String(el.runSearchInput?.value || "").trim().toLowerCase();

  return runs.filter((run) => {
    const status = String(run.status || "").toLowerCase();
    if (statusFilter !== "all" && status !== statusFilter) {
      return false;
    }
    if (!searchKeyword) {
      return true;
    }
    const haystack = [
      run.created_at,
      run.run_type,
      run.run_date,
      run.status,
      run.message,
      run.thread_id
    ]
      .map((item) => String(item || "").toLowerCase())
      .join(" ");
    return haystack.includes(searchKeyword);
  });
}

function updateRunsSummary(allRuns, filteredRuns) {
  const success = allRuns.filter((run) => String(run.status || "").toLowerCase() === "success").length;
  const failed = allRuns.filter((run) => String(run.status || "").toLowerCase() === "failed").length;
  const skipped = allRuns.filter((run) => String(run.status || "").toLowerCase() === "skipped").length;

  if (el.runsTotalCount) {
    el.runsTotalCount.textContent = String(allRuns.length);
  }
  if (el.runsSuccessCount) {
    el.runsSuccessCount.textContent = String(success);
  }
  if (el.runsFailedCount) {
    el.runsFailedCount.textContent = String(failed);
  }
  if (el.runsSkippedCount) {
    el.runsSkippedCount.textContent = String(skipped);
  }
  if (el.runsMeta) {
    el.runsMeta.textContent = `顯示 ${filteredRuns.length} / ${allRuns.length} 筆（顯示時區：${state.displayTimezone}），系統僅保留最近 30 筆。`;
  }
}

export function renderRuns(runs) {
  state.runs = Array.isArray(runs) ? runs : [];
  const filteredRuns = getFilteredRuns(state.runs);

  updateRunsSummary(state.runs, filteredRuns);

  if (!el.runsBody || !el.runsCards) {
    return;
  }

  if (state.runs.length === 0) {
    el.runsBody.innerHTML = `<tr><td colspan="6">尚無紀錄</td></tr>`;
    el.runsCards.innerHTML = `<p class="hint">尚無紀錄</p>`;
    return;
  }

  if (filteredRuns.length === 0) {
    el.runsBody.innerHTML = `<tr><td colspan="6">找不到符合篩選條件的紀錄</td></tr>`;
    el.runsCards.innerHTML = `<p class="hint">找不到符合篩選條件的紀錄</p>`;
    return;
  }

  el.runsBody.innerHTML = filteredRuns
    .map((run) => {
      const message = run.message ? escapeHtml(run.message) : "";
      const threadId = run.thread_id ? escapeHtml(run.thread_id) : "-";
      const createdAt = escapeHtml(formatInTimezone(run.created_at));
      const runType = escapeHtml(run.run_type || "");
      const runDate = escapeHtml(run.run_date || "");
      return `<tr>
        <td>${createdAt}</td>
        <td>${runType}</td>
        <td>${runDate}</td>
        <td>${statusTag(run.status)}</td>
        <td>${message}</td>
        <td>${threadId}</td>
      </tr>`;
    })
    .join("");

  el.runsCards.innerHTML = filteredRuns
    .map((run) => {
      const createdAt = escapeHtml(formatInTimezone(run.created_at));
      const runType = escapeHtml(run.run_type || "");
      const runDate = escapeHtml(run.run_date || "");
      const message = run.message ? escapeHtml(run.message) : "-";
      const threadId = run.thread_id ? escapeHtml(run.thread_id) : "-";

      return `<article class="runCard">
        <div class="runCardTop">
          <strong>${runType}</strong>
          ${statusTag(run.status)}
        </div>
        <dl class="runCardMeta">
          <dt>時間</dt><dd>${createdAt}</dd>
          <dt>日期</dt><dd>${runDate}</dd>
          <dt>訊息</dt><dd>${message}</dd>
          <dt>Thread ID</dt><dd>${threadId}</dd>
        </dl>
      </article>`;
    })
    .join("");
}

export function rerenderRuns() {
  renderRuns(state.runs);
}

export function resetRunFilters() {
  if (el.runStatusFilter) {
    el.runStatusFilter.value = "all";
  }
  if (el.runSearchInput) {
    el.runSearchInput.value = "";
  }
  rerenderRuns();
}

export function renderPendingDraft(pendingDraft) {
  const draftText = pendingDraft?.draft || "";
  const hasDraft = Boolean(draftText);
  const imageUrl = safeExternalUrl(pendingDraft?.image_url || pendingDraft?.imageUrl || "");
  const imagePrompt = String(pendingDraft?.image_prompt || pendingDraft?.imagePrompt || "").trim();
  const hasImage = Boolean(imageUrl);

  state.hasPendingDraft = hasDraft;
  state.lastSavedDraft = hasDraft ? draftText : "";

  if (el.draftPreview) {
    el.draftPreview.value = draftText;
    if (!hasDraft) {
      el.draftPreview.placeholder = "可直接鍵盤輸入下一篇草稿，系統會自動儲存。";
    }
  }

  if (el.nextDraftPreview) {
    el.nextDraftPreview.textContent = draftText || "目前沒有待發草稿。";
  }

  if (el.draftImageCard && el.draftImagePreview && el.draftImagePrompt) {
    if (hasDraft && hasImage) {
      el.draftImageCard.classList.remove("hidden");
      el.draftImagePreview.src = imageUrl;
      el.draftImagePrompt.textContent = imagePrompt
        ? "圖片提示詞：" + imagePrompt
        : "已生成配圖，可直接隨草稿發佈。";
    } else {
      el.draftImageCard.classList.add("hidden");
      el.draftImagePreview.removeAttribute("src");
      el.draftImagePrompt.textContent = "";
    }
  }

  if (el.generateDraftBtn) {
    el.generateDraftBtn.textContent = "產生草稿";
  }

  if (hasDraft) {
    const model = pendingDraft.llm_model || "gemini-2.5-flash";
    const grounding = Number(pendingDraft.enable_grounding) === 1 ? "開啟" : "關閉";
    const imageTag = hasImage ? "已生成" : "未生成";
    const updatedAt = formatInTimezone(pendingDraft.updated_at || pendingDraft.created_at || "-");
    const message =
      "模型：" +
      model +
      "｜Grounding：" +
      grounding +
      "｜配圖：" +
      imageTag +
      "｜最後更新：" +
      updatedAt;

    if (el.nextDraftMeta) {
      el.nextDraftMeta.textContent = message;
    }

    if (el.publishDraftBtn) {
      el.publishDraftBtn.disabled = state.isLoading;
    }
    if (el.generateDraftImageBtn) {
      el.generateDraftImageBtn.disabled = state.isLoading;
    }

    setDraftEditStatus("可直接鍵盤編輯，系統會自動儲存。", false);
    return;
  }

  if (el.nextDraftMeta) {
    el.nextDraftMeta.textContent = "目前尚未準備下一篇草稿。";
  }

  if (el.publishDraftBtn) {
    el.publishDraftBtn.disabled = true;
  }
  if (el.generateDraftImageBtn) {
    el.generateDraftImageBtn.disabled = true;
  }

  setDraftEditStatus("可直接鍵盤編輯，輸入後會自動儲存為下一篇。", false);
}

export function renderNewsFetchResult(result) {
  state.lastNewsFetchResult = result && typeof result === "object" ? result : null;

  if (!el.newsFetchResultCard || !el.newsFetchStatusTag || !el.newsFetchResultMeta) {
    return;
  }

  const current = state.lastNewsFetchResult;
  if (!current) {
    el.newsFetchResultCard.classList.add("hidden");
    el.newsFetchStatusTag.className = "statusTag skipped";
    el.newsFetchStatusTag.textContent = "略過";
    el.newsFetchResultMeta.textContent = "尚未執行「立即抓取新聞」。";
    el.newsFetchResultMeta.classList.remove("error");
    if (el.newsFetchAttemptList) {
      el.newsFetchAttemptList.innerHTML = "";
    }
    if (el.newsFetchArticleList) {
      el.newsFetchArticleList.innerHTML = "";
    }
    return;
  }

  el.newsFetchResultCard.classList.remove("hidden");
  const status = String(current.status || "skipped").toLowerCase();
  const statusClass =
    status === "success" || status === "failed" || status === "skipped" ? status : "skipped";
  const preview = current.newsPreview && typeof current.newsPreview === "object" ? current.newsPreview : {};
  const lookbackDays = Number(preview.lookbackDays || 2);
  const keywords = Array.isArray(preview.keywords) ? preview.keywords.filter(Boolean) : [];
  const provider = newsProviderLabel(preview.provider || "google_rss");

  el.newsFetchStatusTag.className = `statusTag ${statusClass}`;
  el.newsFetchStatusTag.textContent = statusLabel(status);
  el.newsFetchResultMeta.textContent = `來源：${provider}｜近 ${lookbackDays} 天｜關鍵字：${
    keywords.length ? keywords.join("、") : "(未提供)"
  }｜${String(current.message || "")}`;
  el.newsFetchResultMeta.classList.toggle("error", statusClass === "failed");

  const attempts = Array.isArray(preview.attempts) ? preview.attempts : [];
  if (el.newsFetchAttemptList) {
    if (!attempts.length) {
      el.newsFetchAttemptList.innerHTML = `<li class="hint">本次沒有查詢嘗試紀錄。</li>`;
    } else {
      el.newsFetchAttemptList.innerHTML = attempts
        .map((attempt, index) => {
          const label = escapeHtml(String(attempt.label || `嘗試 ${index + 1}`));
          const query = escapeHtml(String(attempt.query || ""));
          const lang = escapeHtml(String(attempt.lang || "不限"));
          const country = escapeHtml(String(attempt.country || "不限"));
          const isError = String(attempt.status || "") === "error";
          const statText = isError
            ? `失敗：${String(attempt.error || "未知錯誤")}`
            : `命中 ${Number(attempt.matched || 0)} 則`;
          const statClass = isError ? "attemptError" : "";
          return `<li class="${statClass}"><strong>${label}</strong>｜lang=${lang} / country=${country}｜q=${query}｜${escapeHtml(statText)}</li>`;
        })
        .join("");
    }
  }

  const articles = Array.isArray(preview.articles) ? preview.articles : [];
  if (el.newsFetchArticleList) {
    if (!articles.length) {
      el.newsFetchArticleList.innerHTML = `<p class="hint">本次沒有可用新聞。</p>`;
    } else {
      el.newsFetchArticleList.innerHTML = articles
        .map((article, index) => {
          const title = escapeHtml(String(article.title || "(無標題)"));
          const source = escapeHtml(String(article.source || "未知來源"));
          const publishedAt = escapeHtml(String(article.publishedAt || "-"));
          const snippet = escapeHtml(String(article.snippet || "(無摘要)"));
          const url = safeExternalUrl(article.url);
          const sourceLine = `${source}｜${publishedAt}`;
          const titleMarkup = url
            ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`
            : title;
          const linkMarkup = url
            ? `<a class="newsArticleLink" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">查看原文</a>`
            : `<span class="hint">無原文連結</span>`;
          return `<article class="newsArticleItem">
            <h4>${index + 1}. ${titleMarkup}</h4>
            <p class="hint">${sourceLine}</p>
            <p class="newsArticleSnippet">${snippet}</p>
            ${linkMarkup}
          </article>`;
        })
        .join("");
    }
  }
}

function applyStepVisibility(isAuthed) {
  const panelMap = {
    settings: el.appCard,
    draft: el.nextPostCard,
    runs: el.runsCard
  };
  const tabMap = {
    settings: el.stepTabSettings,
    draft: el.stepTabDraft,
    runs: el.stepTabRuns
  };

  if (!isAuthed) {
    if (el.stepNavCard) {
      el.stepNavCard.classList.add("hidden");
    }
    for (const step of STEPS) {
      if (panelMap[step]) {
        panelMap[step].classList.add("hidden");
      }
      if (tabMap[step]) {
        tabMap[step].classList.remove("active");
      }
    }
    return;
  }

  if (el.stepNavCard) {
    el.stepNavCard.classList.remove("hidden");
  }

  const activeStep = STEPS.includes(state.activeStep) ? state.activeStep : "settings";
  for (const step of STEPS) {
    if (panelMap[step]) {
      panelMap[step].classList.toggle("hidden", step !== activeStep);
    }
    if (tabMap[step]) {
      tabMap[step].classList.toggle("active", step === activeStep);
    }
  }
}

export function setActiveStep(step) {
  if (!STEPS.includes(step)) {
    return;
  }
  state.activeStep = step;
  applyStepVisibility(true);
}

export function setAuthView(isAuthed) {
  if (el.loginCard) {
    el.loginCard.classList.toggle("hidden", isAuthed);
  }
  if (!isAuthed) {
    state.activeStep = "settings";
    renderNewsFetchResult(null);
  } else if (!state.activeStep) {
    state.activeStep = "settings";
  }
  applyStepVisibility(isAuthed);
}

export function fillSettings(settings) {
  if (el.threadsToken) {
    el.threadsToken.value = settings.threadsToken || "";
  }

  const syncedNews = syncStageLlmProviderUi(
    "news",
    settings.newsLlmProvider ?? settings.llmProvider ?? DEFAULT_LLM_PROVIDER,
    settings.newsLlmModel || ""
  );
  const syncedDraft = syncStageLlmProviderUi(
    "draft",
    settings.draftLlmProvider ?? settings.llmProvider ?? DEFAULT_LLM_PROVIDER,
    settings.draftLlmModel || settings.llmModel || ""
  );
  const syncedImage = syncStageLlmProviderUi(
    "image",
    settings.imageLlmProvider ?? settings.llmProvider ?? DEFAULT_LLM_PROVIDER,
    settings.imageLlmModel || ""
  );

  if (el.newsLlmApiKey) {
    el.newsLlmApiKey.value = settings.newsLlmApiKey ?? settings.geminiApiKey ?? "";
  }
  if (el.draftLlmApiKey) {
    el.draftLlmApiKey.value = settings.draftLlmApiKey ?? settings.geminiApiKey ?? "";
  }
  if (el.imageLlmApiKey) {
    el.imageLlmApiKey.value = settings.imageLlmApiKey ?? settings.geminiApiKey ?? "";
  }

  if (el.newsLlmModel && !el.newsLlmModel.value) {
    el.newsLlmModel.value = syncedNews.model;
  }
  if (el.draftLlmModel && !el.draftLlmModel.value) {
    el.draftLlmModel.value = syncedDraft.model;
  }
  if (el.imageLlmModel && !el.imageLlmModel.value) {
    el.imageLlmModel.value = syncedImage.model;
  }
  if (el.enableGrounding) {
    el.enableGrounding.checked = Boolean(settings.enableGrounding);
  }
  if (el.postInstruction) {
    el.postInstruction.value = settings.postInstruction || "";
  }
  if (el.postStyle) {
    el.postStyle.value = settings.postStyle || "";
  }
  if (el.postTime) {
    el.postTime.value = settings.postTime || "09:00";
  }
  if (el.replyTimes) {
    el.replyTimes.value = Array.isArray(settings.replyTimes)
      ? settings.replyTimes.join(", ")
      : settings.replyTimes || "";
  }
  if (el.newsKeywords) {
    el.newsKeywords.value = Array.isArray(settings.newsKeywords)
      ? settings.newsKeywords.join(", ")
      : settings.newsKeywords || "";
  }
  if (el.newsFetchTime) {
    el.newsFetchTime.value = settings.newsFetchTime || "08:00";
  }
  if (el.newsMaxItems) {
    const allowed = new Set(["3", "5", "8", "10"]);
    const value = String(settings.newsMaxItems || 5);
    el.newsMaxItems.value = allowed.has(value) ? value : "5";
  }
  if (el.newsEnabled) {
    el.newsEnabled.checked = Boolean(settings.newsEnabled);
  }
  if (el.newsProvider) {
    const allowed = new Set(["google_rss", "auto", "gnews", "llm"]);
    const value = String(settings.newsProvider || DEFAULT_NEWS_PROVIDER);
    el.newsProvider.value = allowed.has(value) ? value : DEFAULT_NEWS_PROVIDER;
  }
  if (el.imageEnabled) {
    el.imageEnabled.checked = Boolean(settings.imageEnabled);
  }
  if (el.timezone) {
    const timezone = settings.timezone || DEFAULT_TIMEZONE;
    ensureTimezoneOption(timezone);
    el.timezone.value = timezone;
    state.displayTimezone = timezone;
  }
  if (el.enabled) {
    el.enabled.checked = Boolean(settings.enabled);
  }
  setSettingsSaveState("clean");
}

export function collectSettings() {
  const postInstruction = (el.postInstruction?.value || "").trim().slice(0, SETTINGS_TEXT_LIMIT);
  const postStyle = (el.postStyle?.value || "").trim().slice(0, SETTINGS_TEXT_LIMIT);

  const newsProvider = normalizeLlmProvider(el.newsLlmProvider?.value || DEFAULT_LLM_PROVIDER);
  const newsOptions = (LLM_PROVIDER_CONFIG[newsProvider] || LLM_PROVIDER_CONFIG[DEFAULT_LLM_PROVIDER]).models;
  const newsModel = newsOptions.some((option) => option.value === el.newsLlmModel?.value)
    ? String(el.newsLlmModel?.value || "")
    : getDefaultLlmModel(newsProvider);

  const draftProvider = normalizeLlmProvider(el.draftLlmProvider?.value || DEFAULT_LLM_PROVIDER);
  const draftOptions = (LLM_PROVIDER_CONFIG[draftProvider] || LLM_PROVIDER_CONFIG[DEFAULT_LLM_PROVIDER]).models;
  const draftModel = draftOptions.some((option) => option.value === el.draftLlmModel?.value)
    ? String(el.draftLlmModel?.value || "")
    : getDefaultLlmModel(draftProvider);

  const imageProvider = normalizeLlmProvider(el.imageLlmProvider?.value || DEFAULT_LLM_PROVIDER);
  const imageOptions = (LLM_PROVIDER_CONFIG[imageProvider] || LLM_PROVIDER_CONFIG[DEFAULT_LLM_PROVIDER]).models;
  const imageModel = imageOptions.some((option) => option.value === el.imageLlmModel?.value)
    ? String(el.imageLlmModel?.value || "")
    : getDefaultLlmModel(imageProvider);

  return {
    threadsToken: el.threadsToken?.value.trim() || "",
    geminiApiKey: el.draftLlmApiKey?.value.trim() || "",
    llmProvider: draftProvider,
    llmModel: draftModel,
    newsLlmProvider: newsProvider,
    newsLlmModel: newsModel,
    newsLlmApiKey: el.newsLlmApiKey?.value.trim() || "",
    draftLlmProvider: draftProvider,
    draftLlmModel: draftModel,
    draftLlmApiKey: el.draftLlmApiKey?.value.trim() || "",
    imageLlmProvider: imageProvider,
    imageLlmModel: imageModel,
    imageLlmApiKey: el.imageLlmApiKey?.value.trim() || "",
    enableGrounding: Boolean(el.enableGrounding?.checked),
    postInstruction,
    postStyle,
    postTime: el.postTime?.value || "09:00",
    replyTimes: el.replyTimes?.value.trim() || "",
    newsEnabled: Boolean(el.newsEnabled?.checked),
    newsKeywords: el.newsKeywords?.value.trim() || "",
    newsFetchTime: el.newsFetchTime?.value || "08:00",
    newsMaxItems: Number(el.newsMaxItems?.value || "5"),
    newsProvider: el.newsProvider?.value || DEFAULT_NEWS_PROVIDER,
    imageEnabled: Boolean(el.imageEnabled?.checked),
    timezone: (el.timezone?.value || "").trim() || DEFAULT_TIMEZONE,
    enabled: Boolean(el.enabled?.checked)
  };
}
