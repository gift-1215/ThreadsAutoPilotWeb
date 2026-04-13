import { api } from "./api-client.js";
import { loadAllData } from "./data.js";
import { el, state } from "./state.js";
import { setAuthView, showToast } from "./ui.js";

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

export async function renderGoogleButton() {
  if (!el.loginHint || !el.googleSignInBtn) {
    return;
  }

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

export async function loadMeAndInit() {
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
  if (el.userInfo) {
    el.userInfo.textContent = `目前帳號：${labelName}`;
  }
  await loadAllData();
}
