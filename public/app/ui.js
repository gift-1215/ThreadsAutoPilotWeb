import { el, state } from "./state.js";

const SETTINGS_TEXT_LIMIT = 1000;
const CLEAR_CONFIRM_WORD = "CLEAR";

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

export function setLoading(isLoading, text = "等待 LLM 回覆中...") {
  state.isLoading = isLoading;

  if (el.saveBtn) {
    el.saveBtn.disabled = isLoading;
  }
  if (el.generateDraftBtn) {
    el.generateDraftBtn.disabled = isLoading;
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
  if (el.logoutBtn) {
    el.logoutBtn.disabled = isLoading;
  }
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
    el.runsMeta.textContent = `顯示 ${filteredRuns.length} / ${allRuns.length} 筆，系統僅保留最近 30 筆。`;
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

  el.runsCards.innerHTML = filteredRuns
    .map((run) => {
      const createdAt = escapeHtml(run.created_at || "");
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
    return;
  }

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

export function setAuthView(isAuthed) {
  if (el.loginCard) {
    el.loginCard.classList.toggle("hidden", isAuthed);
  }
  if (el.appCard) {
    el.appCard.classList.toggle("hidden", !isAuthed);
  }
  if (el.nextPostCard) {
    el.nextPostCard.classList.toggle("hidden", !isAuthed);
  }
  if (el.runsCard) {
    el.runsCard.classList.toggle("hidden", !isAuthed);
  }
}

export function fillSettings(settings) {
  if (el.threadsToken) {
    el.threadsToken.value = settings.threadsToken || "";
  }
  if (el.geminiApiKey) {
    el.geminiApiKey.value = settings.geminiApiKey || "";
  }
  if (el.llmModel) {
    el.llmModel.value = settings.llmModel || "gemini-2.5-flash";
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
  if (el.timezone) {
    el.timezone.value = settings.timezone || "Asia/Taipei";
  }
  if (el.enabled) {
    el.enabled.checked = Boolean(settings.enabled);
  }
}

export function collectSettings() {
  const postInstruction = (el.postInstruction?.value || "").trim().slice(0, SETTINGS_TEXT_LIMIT);
  const postStyle = (el.postStyle?.value || "").trim().slice(0, SETTINGS_TEXT_LIMIT);

  return {
    threadsToken: el.threadsToken?.value.trim() || "",
    geminiApiKey: el.geminiApiKey?.value.trim() || "",
    llmModel: el.llmModel?.value || "gemini-2.5-flash",
    enableGrounding: Boolean(el.enableGrounding?.checked),
    postInstruction,
    postStyle,
    postTime: el.postTime?.value || "09:00",
    replyTimes: el.replyTimes?.value.trim() || "",
    timezone: el.timezone?.value.trim() || "Asia/Taipei",
    enabled: Boolean(el.enabled?.checked)
  };
}
