// 表紙と背表紙の見た目を作る

import type { BookMeta } from "../store";
import { h } from "./dom";

// 画像がないときの表紙・背表紙の色（落ち着いた色だけ）
const COLORS = ["#7a4b3a", "#3f5e5a", "#4a4f73", "#6b5b3e", "#5e3f5c", "#3d5873", "#6f6a4a", "#7a3f45"];

function hashOf(id: string): number {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n;
}

function colorFor(id: string): string {
  return COLORS[hashOf(id) % COLORS.length];
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

// 背表紙の高さ（本ごとに少し変えて、本棚らしく見せる）
const SPINE_HEIGHTS = [192, 202, 210];
const MAX_SPINE_UNITS = 6;

/** 本棚に入っているときの背表紙（タイトルだけ） */
export function renderSpine(b: BookMeta): HTMLElement {
  return h(
    "div",
    { class: "spine-face", style: `--book-color:${colorFor(b.id)};height:${SPINE_HEIGHTS[hashOf(b.id) % SPINE_HEIGHTS.length]}px` },
    h("span", { class: "spine-title" }, displayTitle(b)),
  );
}

/**
 * タイトルが背表紙に入りきるように調整する（画面に置いたあとに呼ぶ）
 *   1. ふつうの大きさで1行に入ればそのまま
 *   2. 入らなければ文字を少し小さく
 *   3. それでも入らなければ、本1冊分ずつ横幅を増やして2行・3行…にする
 */
export function fitSpine(face: HTMLElement) {
  const title = face.querySelector<HTMLElement>(".spine-title");
  if (!title) return;
  const unit = parseFloat(getComputedStyle(face).getPropertyValue("--spine-w")) || 32;
  const fits = () => title.scrollHeight <= title.clientHeight + 1 && title.scrollWidth <= title.clientWidth + 1;

  face.style.width = "";
  title.style.fontSize = "";
  title.classList.remove("wrap");
  if (fits()) return;

  title.style.fontSize = "13px";
  if (fits()) return;

  title.style.fontSize = "";
  title.classList.add("wrap");
  for (let n = 2; n <= MAX_SPINE_UNITS; n++) {
    face.style.width = `${unit * n}px`;
    if (fits()) return;
  }
}
