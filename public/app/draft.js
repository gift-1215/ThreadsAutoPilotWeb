import { api } from "./api-client.js";
import { el, state } from "./state.js";
import { setDraftEditStatus, renderPendingDraft } from "./ui.js";
import { validateDraftText } from "./validation.js";

export function scheduleDraftSave() {
  if (state.draftSaveTimer) {
    clearTimeout(state.draftSaveTimer);
  }

  setDraftEditStatus("草稿編輯中，將自動儲存...", false);
  state.draftSaveTimer = setTimeout(() => {
    state.draftSaveTimer = null;
    void saveDraftEdits();
  }, 800);
}

export async function saveDraftEdits() {
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

export async function flushDraftSave() {
  if (state.draftSaveTimer) {
    clearTimeout(state.draftSaveTimer);
    state.draftSaveTimer = null;
  }
  return saveDraftEdits();
}
