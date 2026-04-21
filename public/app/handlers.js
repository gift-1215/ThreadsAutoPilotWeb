import { renderGoogleButton } from "./auth.js";
import { api } from "./api-client.js";
import { refreshRunsAndPending } from "./data.js";
import { flushDraftSave, scheduleDraftSave } from "./draft.js";
import { el, state } from "./state.js";
import {
  collectSettings,
  renderNewsFetchResult,
  renderPendingDraft,
  rerenderRuns,
  renderRuns,
  resetRunFilters,
  setActiveStep,
  setAuthView,
  setDraftEditStatus,
  setLoading,
  setManualReplyLoading,
  setSettingsSaveState,
  showToast,
  syncStageLlmProviderUi
} from "./ui.js";
import { validateDraftText } from "./validation.js";

const CLEAR_CONFIRM_WORD = "CLEAR";

export function attachEventListeners() {
  if (el.stepTabSettings) {
    el.stepTabSettings.addEventListener("click", () => {
      setActiveStep("settings");
    });
  }

  if (el.stepTabDraft) {
    el.stepTabDraft.addEventListener("click", () => {
      setActiveStep("draft");
    });
  }

  if (el.stepTabRuns) {
    el.stepTabRuns.addEventListener("click", () => {
      setActiveStep("runs");
    });
  }

  if (el.settingsForm) {
    el.settingsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const settings = collectSettings();
      setLoading(true, "儲存設定中...");
      try {
        await api("/api/settings", {
          method: "PUT",
          body: JSON.stringify(settings)
        });
        setSettingsSaveState("saved");
        showToast("設定已儲存");
      } catch (error) {
        setSettingsSaveState("dirty");
        showToast(`儲存失敗：${error.message}`, 4500);
      } finally {
        setLoading(false);
      }
    });

    const markSettingsDirty = () => {
      if (!state.me || state.isLoading) {
        return;
      }
      setSettingsSaveState("dirty");
    };
    el.settingsForm.addEventListener("input", markSettingsDirty);
    el.settingsForm.addEventListener("change", markSettingsDirty);
  }

  if (el.generateDraftBtn) {
    el.generateDraftBtn.addEventListener("click", async () => {
      setLoading(true, "正在等待 LLM 產生草稿，請稍候...");
      try {
        const resp = await api("/api/run-now", { method: "POST", body: "{}" });
        const result = resp.result || {};
        showToast(result.message || "草稿已產生");
        await refreshRunsAndPending();
        setActiveStep("draft");
      } catch (error) {
        showToast(`產生草稿失敗：${error.message}`, 5000);
      } finally {
        setLoading(false);
      }
    });
  }

  if (el.generateDraftImageBtn) {
    el.generateDraftImageBtn.addEventListener("click", async () => {
      await flushDraftSave();
      setLoading(true, "正在生成新聞圖片，請稍候...");
      try {
        const resp = await api("/api/pending-draft/generate-image", { method: "POST", body: "{}" });
        const result = resp.result || {};
        showToast(result.message || "已生成新聞圖片");
        await refreshRunsAndPending();
        setActiveStep("draft");
      } catch (error) {
        showToast(`生成新聞圖片失敗：${error.message}`, 5000);
      } finally {
        setLoading(false);
      }
    });
  }

  if (el.runNewsNowBtn) {
    el.runNewsNowBtn.addEventListener("click", async () => {
      setLoading(true, "正在抓取近兩天新聞並整理摘要...");
      try {
        const resp = await api("/api/news/run-now", { method: "POST", body: "{}" });
        const result = resp.result || {};
        renderNewsFetchResult(result);
        showToast(result.message || "已完成新聞抓取", 5000);
        await refreshRunsAndPending();
        setActiveStep("draft");
      } catch (error) {
        showToast(`新聞抓取失敗：${error.message}`, 5000);
      } finally {
        setLoading(false);
      }
    });
  }

  if (el.publishDraftBtn) {
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
        setActiveStep("runs");
      } catch (error) {
        showToast(`發文失敗：${error.message}`, 5000);
      } finally {
        setLoading(false);
      }
    });
  }

  if (el.manualReplyBtn) {
    el.manualReplyBtn.addEventListener("click", async () => {
      if (state.manualReplyLoading) {
        return;
      }
      setManualReplyLoading(true);
      showToast("正在掃描留言並自動回覆，你可繼續操作其他功能。", 4000);
      try {
        const resp = await api("/api/replies/scan-now", { method: "POST", body: "{}" });
        const result = resp.result || {};
        showToast(result.message || "留言掃描與回覆已完成", 5000);
        await refreshRunsAndPending();
        setActiveStep("runs");
      } catch (error) {
        showToast(`回覆留言失敗：${error.message}`, 5000);
      } finally {
        setManualReplyLoading(false);
      }
    });
  }

  if (el.reloadRunsBtn) {
    el.reloadRunsBtn.addEventListener("click", async () => {
      setLoading(true, "刷新資料中...");
      try {
        await refreshRunsAndPending();
        showToast("已刷新");
        setActiveStep("runs");
      } catch (error) {
        showToast(`刷新失敗：${error.message}`, 5000);
      } finally {
        setLoading(false);
      }
    });
  }

  if (el.clearRunsBtn) {
    el.clearRunsBtn.addEventListener("click", async () => {
      const confirmValue = String(el.clearRunsConfirmText?.value || "").trim().toUpperCase();
      if (confirmValue !== CLEAR_CONFIRM_WORD) {
        showToast("請先輸入 CLEAR 才能清除紀錄。", 3500);
        return;
      }

      const confirmed = window.confirm("確定要清除全部發文紀錄嗎？此動作無法復原。");
      if (!confirmed) {
        return;
      }

      setLoading(true, "清除發文紀錄中...");
      try {
        const resp = await api("/api/runs", { method: "DELETE" });
        await refreshRunsAndPending();
        if (el.clearRunsConfirmText) {
          el.clearRunsConfirmText.value = "";
        }
        showToast(`已刪除 ${Number(resp.deletedCount || 0)} 筆紀錄`);
      } catch (error) {
        showToast(`刪除失敗：${error.message}`, 5000);
      } finally {
        setLoading(false);
      }
    });
  }

  if (el.clearRunsConfirmText) {
    el.clearRunsConfirmText.addEventListener("input", () => {
      setLoading(state.isLoading);
    });
  }

  if (el.runStatusFilter) {
    el.runStatusFilter.addEventListener("change", () => {
      rerenderRuns();
    });
  }

  if (el.runSearchInput) {
    el.runSearchInput.addEventListener("input", () => {
      rerenderRuns();
    });
  }

  if (el.timezone) {
    el.timezone.addEventListener("change", () => {
      state.displayTimezone = (el.timezone.value || "").trim() || "Asia/Taipei";
      rerenderRuns();
    });
  }

  if (el.newsLlmProvider) {
    el.newsLlmProvider.addEventListener("change", () => {
      syncStageLlmProviderUi("news", el.newsLlmProvider?.value || "gemini", el.newsLlmModel?.value || "");
    });
  }

  if (el.draftLlmProvider) {
    el.draftLlmProvider.addEventListener("change", () => {
      syncStageLlmProviderUi(
        "draft",
        el.draftLlmProvider?.value || "gemini",
        el.draftLlmModel?.value || ""
      );
    });
  }

  if (el.imageLlmProvider) {
    el.imageLlmProvider.addEventListener("change", () => {
      syncStageLlmProviderUi(
        "image",
        el.imageLlmProvider?.value || "gemini",
        el.imageLlmModel?.value || ""
      );
    });
  }

  if (el.logoutBtn) {
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
        if (el.clearRunsConfirmText) {
          el.clearRunsConfirmText.value = "";
        }
        resetRunFilters();
        setAuthView(false);
        await renderGoogleButton();
        showToast("已登出");
      } catch (error) {
        showToast(`登出失敗：${error.message}`);
      } finally {
        setLoading(false);
      }
    });
  }

  if (el.draftPreview) {
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
  }
}
