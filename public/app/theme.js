import { el } from "./state.js";

const THEME_STORAGE_KEY = "taw-theme";

function getPreferredTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "dark" || saved === "light") {
    return saved;
  }
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function updateThemeButton(theme) {
  if (!el.themeToggleBtn) {
    return;
  }
  const isDark = theme === "dark";
  el.themeToggleBtn.textContent = isDark ? "切換淺色" : "切換深色";
  el.themeToggleBtn.setAttribute("aria-pressed", String(isDark));
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  updateThemeButton(theme);
}

export function initThemeToggle() {
  const initialTheme = getPreferredTheme();
  applyTheme(initialTheme);

  if (!el.themeToggleBtn) {
    return;
  }

  el.themeToggleBtn.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    applyTheme(currentTheme === "dark" ? "light" : "dark");
  });
}
