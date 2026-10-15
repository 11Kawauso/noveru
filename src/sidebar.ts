// 画面の左側のメニュー（ロゴ・本棚・書く・色合い・ログアウト）
// 書く紙が縦長なので、上ではなく左に置いて高さを広く使う。

import { h } from "./lib/dom";
import { getTheme, toggleTheme } from "./lib/theme";
import { navigate } from "./router";
import { store, type User } from "./store";

// 線で描いた小さなアイコン（中身は固定の文字列）
const ICONS = {
  shelf: '<path d="M5 4v15M9.5 4v15M14 5.5l3.5 13.5M3 20h18"/>',
  pen: '<path d="M4 20l1-4.5L16 4.5l3.5 3.5L8.5 19z"/><path d="M14 7l3.5 3.5"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  login: '<path d="M14 4h5v16h-5M9 8l4 4-4 4M3 12h10"/>',
};

function icon(name: keyof typeof ICONS): HTMLElement {
  const span = h("span", { class: "rail-icon", "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

function railLink(href: string, iconName: keyof typeof ICONS, label: string, key: string) {
  return h("a", { class: "rail-item", href, "data-key": key }, icon(iconName), h("span", { class: "rail-label" }, label));
}

/** いま開いている画面のメニューを目立たせる */
function markActive() {
  const path = location.hash.replace(/^#/, "") || "/";
  const key = path === "/" ? "shelf" : path.startsWith("/write") ? "write" : "";
  document.querySelectorAll<HTMLElement>(".rail-item[data-key]").forEach((el) => {
    el.classList.toggle("active", el.dataset.key === key);
  });
}

window.addEventListener("hashchange", markActive);

export function renderSidebar(user: User | null) {
  const rail = document.getElementById("side-rail")!;

  const themeBtn = h("button", { class: "rail-item", title: "色合いを切り替える" });
  const drawTheme = () => {
    const dark = getTheme() === "dark";
    themeBtn.replaceChildren(icon(dark ? "sun" : "moon"), h("span", { class: "rail-label" }, dark ? "明るく" : "暗く"));
  };
  themeBtn.addEventListener("click", () => {
    toggleTheme();
    drawTheme();
  });
  drawTheme();

  const items: (HTMLElement | null)[] = [
    h("a", { class: "rail-logo", href: "#/", title: "noveru" }, "noveru"),
    user ? railLink("#/", "shelf", "本棚", "shelf") : null,
    user ? railLink("#/write/new", "pen", "書く", "write") : null,
    h("div", { class: "rail-spacer" }),
    themeBtn,
    user ? h("span", { class: "rail-user", title: user.email }, user.penName || user.email) : null,
    user
      ? h(
          "button",
          {
            class: "rail-item",
            onclick: async () => {
              await store.signOut();
              navigate("/login");
            },
          },
          icon("logout"),
          h("span", { class: "rail-label" }, "ログアウト"),
        )
      : railLink("#/login", "login", "ログイン", "login"),
  ];
  rail.replaceChildren(...items.filter((el): el is HTMLElement => el !== null));
  markActive();
}
