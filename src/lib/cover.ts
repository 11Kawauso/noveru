// 表紙と背表紙の見た目を作る

import type { BookMeta } from "../store";
import { h } from "./dom";

// 画像がないときの表紙・背表紙の色（落ち着いた色だけ）
const COLORS = ["#7a4b3a", "#3f5e5a", "#4a4f73", "#6b5b3e", "#5e3f5c", "#3d5873", "#6f6a4a", "#7a3f45"];

function colorFor(id: string): string {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[n % COLORS.length];
}

export function displayTitle(b: Pick<BookMeta, "title">): string {
  return b.title.trim() || "無題";
}

/** 表紙（画像があれば画像、なければタイトルと作者を書いた表紙） */
export function renderCover(b: BookMeta): HTMLElement {
  if (b.cover) {
    return h(
      "div",
      { class: "cover" },
      h("img", { src: b.cover, alt: `${displayTitle(b)}の表紙`, loading: "lazy" }),
    );
  }
  return h(
    "div",
    { class: "cover cover-plain", style: `--book-color:${colorFor(b.id)}` },
    h("div", { class: "cover-plain-title" }, displayTitle(b)),
    h("div", { class: "cover-plain-author" }, b.author),
  );
}

/** 本棚に入っているときの背表紙 */
export function renderSpine(b: BookMeta): HTMLElement {
  return h(
    "div",
    { class: "spine-face", style: `--book-color:${colorFor(b.id)}` },
    h("span", { class: "spine-title" }, displayTitle(b)),
    b.author ? h("span", { class: "spine-author" }, b.author) : null,
  );
}
