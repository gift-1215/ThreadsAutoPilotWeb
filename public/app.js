const state = {
  me: null,
  googleClientId: "",
  toastTimer: null,
  hasPendingDraft: false,
  isLoading: false,
  draftSaveTimer: null,
  draftSaveRequestId: 0,
  lastSavedDraft: ""
};

const el = {
  loginCard: document.querySelector("#loginCard"),
  loginHint: document.querySelector("#loginHint"),
  googleSignInBtn: document.querySelector("#googleSignInBtn"),
  appCard: document.querySelector("#appCard"),
  nextPostCard: document.querySelector("#nextPostCard"),
  runsCard: document.querySelector("#runsCard"),
  userInfo: document.querySelector("#userInfo"),
  settingsForm: document.querySelector("#settingsForm"),
  threadsToken: document.querySelector("#threadsToken"),
  geminiApiKey: document.querySelector("#geminiApiKey"),
  llmModel: document.querySelector("#llmModel"),
  enableGrounding: document.querySelector("#enableGrounding"),
  postInstruction: document.querySelector("#postInstruction"),
  postStyle: document.querySelector("#postStyle"),
  postTime: document.querySelector("#postTime"),
  replyTimes: document.querySelector("#replyTimes"),
  timezone: document.querySelector("#timezone"),
  enabled: document.querySelector("#enabled"),
  saveBtn: document.querySelector("#saveBtn"),
  generateDraftBtn: document.querySelector("#generateDraftBtn"),
  regenerateDraftBtn: document.querySelector("#regenerateDraftBtn"),
  publishDraftBtn: document.querySelector("#publishDraftBtn"),
  reloadRunsBtn: document.querySelector("#reloadRunsBtn"),
  clearRunsBtn: document.querySelector("#clearRunsBtn"),
  loadingIndicator: document.querySelector("#loadingIndicator"),
  loadingText: document.querySelector("#loadingText"),
  draftPreview: document.querySelector("#draftPreview"),
  draftEditStatus: document.querySelector("#draftEditStatus"),
  nextDraftMeta: document.querySelector("#nextDraftMeta"),
  nextDraftPreview: document.querySelector("#nextDraftPreview"),
  logoutBtn: document.querySelector("#logoutBtn"),
  runsBody: document.querySelector("#runsBody"),
  toast: document.querySelector("#toast")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function showToast(message, durationMs = 3000) {
  if (!el.toast) return;
  el.toast.textContent = message;
  el.toast.classList.remove("hidden");

  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
  }
  state.toastTimer = setTimeout(() => {
    el.toast.classList.add("hidden");
  }, durationMs);
}

function setDraftEditStatus(message, isError = false) {
  if (!el.draftEditStatus) return;
  el.draftEditStatus.textContent = message;
  el.draftEditStatus.classList.toggle("error", isError);
}

function validateDraftText(draft) {
  const value = String(draft || "").trim();
  if (!value) {
    return "內容是空白";
  }
  if (value.length >= 500) {
    return `字數過長（${value.length}）`;
  }
  const normalized = value.toLowerCase();
  if (normalized.startsWith("```") || normalized.endsWith("```")) {
    return "請不要輸入 code block 格式";
  }
  if (/\{[\s\S]*\}/.test(value) && value.includes('"')) {
    return "請只輸入貼文內容，不要輸入 JSON";
  }
  return "";
}

function setLoading(isLoading, text = "等待 LLM 回覆中...") {
  state.isLoading = isLoading;

  if (el.saveBtn) el.saveBtn.disabled = isLoading;
  if (el.generateDraftBtn) el.generateDraftBtn.disabled = isLoading;
  if (el.reloadRunsBtn) el.reloadRunsBtn.disabled = isLoading;
  if (el.clearRunsBtn) el.clearRunsBtn.disabled = isLoading;
  if (el.logoutBtn) el.logoutBtn.disabled = isLoading;
  if (el.publishDraftBtn) {
    el.publishDraftBtn.disabled = isLoading || !state.hasPendingDraft;
  }
  if (el.regenerateDraftBtn) {
    el.regenerateDraftBtn.disabled = isLoading || !state.hasPendingDraft;
  }
  if (el.draftPreview) {
    el.draftPreview.disabled = isLoading;
  }

  if (el.loadingIndicator) {
    el.loadingIndicator.classList.toggle("hidden", !isLoading);
  }
  if (el.loadingText) {
    el.loadingText.textContent = text;
  }
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

function renderRuns(runs) {
  if (!el.runsBody) return;
  if (!Array.isArray(runs) || runs.length === 0) {
    el.runsBody.innerHTML = `<tr><td colspan="6">尚無紀錄</td></tr>`;
    return;
  }

  el.runsBody.innerHTML = runs
    .map((run) => {
      const message = run.message ? escapeHtml(run.message) : "";
      const threadId = run.thread_id ? escapeHtml(run.thread_id) : "-";
      const createdAt = escapeHtml(run.created_at || "");
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
}

function renderPendingDraft(pendingDraft) {
  const draftText = pendingDraft?.draft || "";
  const hasDraft = Boolean(draftText);

  state.hasPendingDraft = hasDraft;
  state.lastSavedDraft = hasDraft ? draftText : "";

  if (el.draftPreview) {
    el.draftPreview.value = draftText;
    el.draftPreview.disabled = state.isLoading;
    if (!hasDraft) {
      el.draftPreview.placeholder = "可直接鍵盤輸入下一篇草稿，系統會自動儲存。";
    }
  }

  if (el.nextDraftPreview) {
    el.nextDraftPreview.textContent = draftText || "目前沒有待發草稿。";
  }

  if (hasDraft) {
    const model = pendingDraft.llm_model || "gemini-2.5-flash";
    const grounding = Number(pendingDraft.enable_grounding) === 1 ? "開啟" : "關閉";
    const updatedAt = pendingDraft.updated_at || pendingDraft.created_at || "-";
    const message =
      "模型：" + model + "｜Grounding：" + grounding + "｜最後更新：" + updatedAt;

    if (el.nextDraftMeta) {
      el.nextDraftMeta.textContent = message;
    }

    if (el.publishDraftBtn) {
      el.publishDraftBtn.disabled = state.isLoading;
    }
    if (el.regenerateDraftBtn) {
      el.regenerateDraftBtn.disabled = state.isLoading;
    }

    setDraftEditStatus("可直接鍵盤編輯，系統會自動儲存。", false);
  } else {
    if (el.nextDraftMeta) {
      el.nextDraftMeta.textContent = "目前尚未準備下一篇草稿。";
    }

    if (el.publishDraftBtn) {
      el.publishDraftBtn.disabled = true;
    }
    if (el.regenerateDraftBtn) {
      el.regenerateDraftBtn.disabled = true;
    }

    setDraftEditStatus("可直接鍵盤編輯，輸入後會自動儲存為下一篇。", false);
  }
}

function scheduleDraftSave() {
  if (state.draftSaveTimer) {
    clearTimeout(state.draftSaveTimer);
  }

  setDraftEditStatus("草稿編輯中，將自動儲存...", false);
  state.draftSaveTimer = setTimeout(() => {
    state.draftSaveTimer = null;
    void saveDraftEdits();
  }, 800);
}

async function saveDraftEdits() {
  if (!el.draftPreview) {
    return false;
  }

  const draft = el.draftPreview.value.trim();

  if (!draft) {
    if (!state.hasPendingDraft && !state.lastSavedDraft) {
      setDraftEditStatus("草稿為空白，尚未建立下一篇。", false);
      return true;
    }

    const requestId = ++state.draftSaveRequestId;
    setDraftEditStatus("草稿為空白，正在清除待發草稿...", false);

    try {
      await api("/api/pending-draft", { method: "DELETE", body: "{}" });
      if (requestId !== state.draftSaveRequestId) {
        return false;
      }

      renderPendingDraft(null);
      setDraftEditStatus("草稿已清空，等待下一篇。", false);
      return true;
    } catch (error) {
      if (requestId !== state.draftSaveRequestId) {
        return false;
      }

      setDraftEditStatus("草稿清除失敗：" + error.message, true);
      return false;
    }
  }

  const invalidReason = validateDraftText(draft);
  if (invalidReason) {
    setDraftEditStatus("草稿尚未儲存：" + invalidReason, true);
    return false;
  }

  if (draft === state.lastSavedDraft) {
    setDraftEditStatus("草稿已自動儲存。", false);
    return true;
  }

  const requestId = ++state.draftSaveRequestId;
  setDraftEditStatus("草稿儲存中...", false);

  try {
    const resp = await api("/api/pending-draft", {
      method: "PUT",
      body: JSON.stringify({ draft })
    });

    if (requestId !== state.draftSaveRequestId) {
      return false;
    }

    renderPendingDraft(resp.pendingDraft || null);
    setDraftEditStatus("草稿已自動儲存。", false);
    return true;
  } catch (error) {
    if (requestId !== state.draftSaveRequestId) {
      return false;
    }

    setDraftEditStatus("草稿儲存失敗：" + error.message, true);
    return false;
  }
}

async function flushDraftSave() {
  if (state.draftSaveTimer) {
    clearTimeout(state.draftSaveTimer);
    state.draftSaveTimer = null;
  }
  return saveDraftEdits();
}

function setAuthView(isAuthed) {
  el.loginCard.classList.toggle("hidden", isAuthed);
  el.appCard.classList.toggle("hidden", !isAuthed);
  el.nextPostCard.classList.toggle("hidden", !isAuthed);
  el.runsCard.classList.toggle("hidden", !isAuthed);
}

function fillSettings(settings) {
  el.threadsToken.value = settings.threadsToken || "";
  el.geminiApiKey.value = settings.geminiApiKey || "";
  el.llmModel.value = settings.llmModel || "gemini-2.5-flash";
  el.enableGrounding.checked = Boolean(settings.enableGrounding);
  el.postInstruction.value = settings.postInstruction || "";
  el.postStyle.value = settings.postStyle || "";
  el.postTime.value = settings.postTime || "09:00";
  el.replyTimes.value = Array.isArray(settings.replyTimes)
    ? settings.replyTimes.join(", ")
    : settings.replyTimes || "";
  el.timezone.value = settings.timezone || "Asia/Taipei";
  el.enabled.checked = Boolean(settings.enabled);
}

function collectSettings() {
  return {
    threadsToken: el.threadsToken.value.trim(),
    geminiApiKey: el.geminiApiKey.value.trim(),
    llmModel: el.llmModel.value,
    enableGrounding: el.enableGrounding.checked,
    postInstruction: el.postInstruction.value.trim(),
    postStyle: el.postStyle.value.trim(),
    postTime: el.postTime.value || "09:00",
    replyTimes: el.replyTimes.value.trim(),
    timezone: el.timezone.value.trim() || "Asia/Taipei",
    enabled: el.enabled.checked
  };
}

async function refreshRunsAndPending() {
  const [runsResp, pendingResp] = await Promise.all([
    api("/api/runs?limit=30"),
    api("/api/pending-draft")
  ]);
  renderRuns(runsResp.runs || []);
  renderPendingDraft(pendingResp.pendingDraft || null);
}

async function loadAllData() {
  const [settingsResp, runsResp, pendingResp] = await Promise.all([
    api("/api/settings"),
    api("/api/runs?limit=30"),
    api("/api/pending-draft")
  ]);
  fillSettings(settingsResp.settings || {});
  renderRuns(runsResp.runs || []);
  renderPendingDraft(pendingResp.pendingDraft || null);
}

async function handleGoogleCredential(credential) {
  await api("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ idToken: credential })
  });

  await loadMeAndInit();
  showToast("登入成功");
}

async function waitForGoogleLibrary(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.google?.accounts?.id) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("Google 登入元件載入逾時");
}

async function renderGoogleButton() {
  if (!state.googleClientId) {
    el.loginHint.textContent =
      "尚未設定 GOOGLE_CLIENT_ID。請先在 wrangler.jsonc 或 .dev.vars 設定後再重新整理。";
    return;
  }

  try {
    await waitForGoogleLibrary();
  } catch (error) {
    el.loginHint.textContent = error.message;
    return;
  }

  window.google.accounts.id.initialize({
    client_id: state.googleClientId,
    callback: async (response) => {
      if (!response?.credential) {
        showToast("Google 登入失敗：缺少 credential");
        return;
      }

      try {
        await handleGoogleCredential(response.credential);
      } catch (error) {
        showToast(`登入失敗：${error.message}`, 4500);
      }
    }
  });

  el.googleSignInBtn.innerHTML = "";
  window.google.accounts.id.renderButton(el.googleSignInBtn, {
    type: "standard",
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "continue_with",
    width: 280
  });
}

async function loadMeAndInit() {
  try {
    const meResp = await api("/api/me");
    state.me = meResp.user;
  } catch {
    state.me = null;
    setAuthView(false);
    await renderGoogleButton();
    return;
  }

  setAuthView(true);
  const labelName = state.me?.name || state.me?.email || "已登入";
  el.userInfo.textContent = `目前帳號：${labelName}`;
  await loadAllData();
}

async function bootstrap() {
  try {
    const configResp = await api("/api/public-config");
    state.googleClientId = configResp.googleClientId || "";
  } catch (error) {
    showToast(`載入設定失敗：${error.message}`);
  }

  await loadMeAndInit();
}

el.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = collectSettings();
  setLoading(true, "儲存設定中...");
  try {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settings)
    });
    showToast("設定已儲存");
  } catch (error) {
    showToast(`儲存失敗：${error.message}`, 4500);
  } finally {
    setLoading(false);
  }
});

el.generateDraftBtn.addEventListener("click", async () => {
  setLoading(true, "正在等待 LLM 產生草稿，請稍候...");
  try {
    const resp = await api("/api/run-now", { method: "POST", body: "{}" });
    const result = resp.result || {};
    showToast(result.message || "草稿已產生");
    await refreshRunsAndPending();
  } catch (error) {
    showToast(`產生草稿失敗：${error.message}`, 5000);
  } finally {
    setLoading(false);
  }
});

el.regenerateDraftBtn.addEventListener("click", async () => {
  setLoading(true, "正在重新產生草稿，請稍候...");
  try {
    const resp = await api("/api/pending-draft/regenerate", { method: "POST", body: "{}" });
    const result = resp.result || {};
    showToast(result.message || "草稿已重新產生");
    await refreshRunsAndPending();
  } catch (error) {
    showToast(`重生草稿失敗：${error.message}`, 5000);
  } finally {
    setLoading(false);
  }
});

el.publishDraftBtn.addEventListener("click", async () => {
  const draft = el.draftPreview ? el.draftPreview.value.trim() : "";
  const invalidReason = validateDraftText(draft);
  if (invalidReason) {
    showToast(`草稿格式不正確：${invalidReason}`, 5000);
    setDraftEditStatus(`草稿尚未儲存：${invalidReason}`, true);
    return;
  }

  setLoading(true, "正在發送到 Threads...");
  try {
    const resp = await api("/api/pending-draft/publish", {
      method: "POST",
      body: JSON.stringify({ draft })
    });
    const result = resp.result || {};
    const message = result.threadId
      ? `${result.message}（${result.threadId}）`
      : result.message || "發佈完成";
    showToast(message, 4500);
    await refreshRunsAndPending();
  } catch (error) {
    showToast(`發文失敗：${error.message}`, 5000);
  } finally {
    setLoading(false);
  }
});

el.reloadRunsBtn.addEventListener("click", async () => {
  setLoading(true, "刷新資料中...");
  try {
    await refreshRunsAndPending();
    showToast("已刷新");
  } catch (error) {
    showToast(`刷新失敗：${error.message}`, 5000);
  } finally {
    setLoading(false);
  }
});

el.clearRunsBtn.addEventListener("click", async () => {
  const confirmed = window.confirm("確定要清除全部發文紀錄嗎？此動作無法復原。");
  if (!confirmed) {
    return;
  }

  setLoading(true, "清除發文紀錄中...");
  try {
    const resp = await api("/api/runs", { method: "DELETE" });
    await refreshRunsAndPending();
    showToast(`已刪除 ${Number(resp.deletedCount || 0)} 筆紀錄`);
  } catch (error) {
    showToast(`刪除失敗：${error.message}`, 5000);
  } finally {
    setLoading(false);
  }
});

el.logoutBtn.addEventListener("click", async () => {
  setLoading(true, "登出中...");
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    state.me = null;
    state.hasPendingDraft = false;
    state.lastSavedDraft = "";
    if (state.draftSaveTimer) {
      clearTimeout(state.draftSaveTimer);
      state.draftSaveTimer = null;
    }
    renderRuns([]);
    renderPendingDraft(null);
    setAuthView(false);
    await renderGoogleButton();
    showToast("已登出");
  } catch (error) {
    showToast(`登出失敗：${error.message}`);
  } finally {
    setLoading(false);
  }
});

el.draftPreview.addEventListener("input", () => {
  if (el.nextDraftPreview) {
    const preview = el.draftPreview.value.trim();
    el.nextDraftPreview.textContent = preview || "目前沒有待發草稿。";
  }

  scheduleDraftSave();
});

el.draftPreview.addEventListener("blur", () => {
  void flushDraftSave();
});

el.draftPreview.addEventListener("keydown", (event) => {
  const key = String(event.key || "").toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "s") {
    event.preventDefault();
    void flushDraftSave().then((saved) => {
      if (saved) {
        showToast("草稿已儲存");
      }
    });
  }
});

bootstrap();
