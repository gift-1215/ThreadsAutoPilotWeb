import { loadMeAndInit } from "./auth.js";
import { api } from "./api-client.js";
import { attachEventListeners } from "./handlers.js";
import { state } from "./state.js";
import { initThemeToggle } from "./theme.js";
import { showToast } from "./ui.js";

async function bootstrap() {
  try {
    const configResp = await api("/api/public-config");
    state.googleClientId = configResp.googleClientId || "";
  } catch (error) {
    showToast(`載入設定失敗：${error.message}`);
  }

  await loadMeAndInit();
}

export function initApp() {
  initThemeToggle();
  attachEventListeners();
  void bootstrap();
}
