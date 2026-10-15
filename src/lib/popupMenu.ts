// ボタンの下に出る小さなメニュー（外をクリックするか Esc で閉じる）

import { h } from "./dom";

export interface MenuItem {
  label: string;
  onSelect: () => void;
}

let closeCurrent: (() => void) | null = null;

export function openPopupMenu(anchor: HTMLElement, title: string, items: MenuItem[]) {
  closeCurrent?.();

  const menu = h(
    "div",
    { class: "popup-menu", role: "menu" },
    h("div", { class: "popup-menu-title" }, title),
    ...items.map((item) =>
      h(
        "button",
        {
          class: "popup-menu-item",
          role: "menuitem",
          onclick: () => {
            close();
            item.onSelect();
          },
        },
        item.label,
      ),
    ),
  );

  const close = () => {
    menu.remove();
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", close);
    anchor.setAttribute("aria-expanded", "false");
    closeCurrent = null;
  };
  const onOutside = (e: Event) => {
    if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
  menu.style.left = `${Math.max(8, left) + window.scrollX}px`;
  menu.style.top = `${r.bottom + 6 + window.scrollY}px`;
  anchor.setAttribute("aria-expanded", "true");

  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", close);
  closeCurrent = close;
  (menu.querySelector(".popup-menu-item") as HTMLElement | null)?.focus();
}
