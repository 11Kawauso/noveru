// アカウントのアイコン（丸い画像。画像がなければペンネームの1文字目）

import { h } from "./dom";

const COLORS = ["#8a5a3b", "#3f5e5a", "#4a4f73", "#6b5b3e", "#5e3f5c", "#3d5873", "#7a3f45"];

export function renderAvatar(name: string, icon: string | null, size: number): HTMLElement {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`;
  if (icon) {
    return h("img", { class: "avatar", src: icon, alt: "", style });
  }
  const first = Array.from(name.trim())[0] ?? "？";
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return h(
    "span",
    { class: "avatar avatar-plain", style: `${style};background:${COLORS[n % COLORS.length]}`, "aria-hidden": "true" },
    first,
  );
}
