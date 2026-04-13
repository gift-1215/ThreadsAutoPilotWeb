import { renderGoogleButton } from "./auth.js";
import { api } from "./api-client.js";
import { refreshRunsAndPending } from "./data.js";
import { flushDraftSave, scheduleDraftSave } from "./draft.js";
import { el, state } from "./state.js";
import {
  collectSettings,
  renderPendingDraft,
  renderRuns,
  setAuthView,
  setDraftEditStatus,
  setLoading,
  showToast
} from "./ui.js";
import { validateDraftText } from "./validation.js";

export function attachEventListeners() {
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
        showToast("設定已儲存");
      } catch (error) {
        showToast(`儲存失敗：${error.message}`, 4500);
      } finally {
        setLoading(false);
      }
    });
  }

  if (el.generateDraftBtn) {
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
  }

  if (el.regenerateDraftBtn) {
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
      } catch (error) {
        showToast(`發文失敗：${error.message}`, 5000);
      } finally {
        setLoading(false);
      }
    });
  }

  if (el.reloadRunsBtn) {
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
  }

  if (el.clearRunsBtn) {
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
