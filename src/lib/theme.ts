// 色合い（クリーム／暗め）の切り替え

export type Theme = "cream" | "dark";

const KEY = "noveru-theme";

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "cream";
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* 保存できなくても切り替え自体はできる */
  }
}

export function toggleTheme() {
  setTheme(getTheme() === "dark" ? "cream" : "dark");
}
