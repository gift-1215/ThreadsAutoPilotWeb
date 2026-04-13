import { api } from "./api-client.js";
import { fillSettings, renderPendingDraft, renderRuns } from "./ui.js";

export async function refreshRunsAndPending() {
  const [runsResp, pendingResp] = await Promise.all([
    api("/api/runs?limit=30"),
    api("/api/pending-draft")
  ]);
  renderRuns(runsResp.runs || []);
  renderPendingDraft(pendingResp.pendingDraft || null);
}

export async function loadAllData() {
  const [settingsResp, runsResp, pendingResp] = await Promise.all([
    api("/api/settings"),
    api("/api/runs?limit=30"),
    api("/api/pending-draft")
  ]);
  fillSettings(settingsResp.settings || {});
  renderRuns(runsResp.runs || []);
  renderPendingDraft(pendingResp.pendingDraft || null);
}
