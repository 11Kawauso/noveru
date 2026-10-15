// 本文の文字の大きさ（読む人・書く人がそれぞれ変えられる。ブラウザに覚えておく）
// ふだんは 14px。変えるとページの区切りも計算し直す。

import { h } from "./dom";

const KEY = "noveru-text-size";
export const TEXT_SIZES = [12, 14, 16, 18, 20, 22];
const DEFAULT_SIZE = 14;
const EVENT = "noveru-text-size";

export function getTextSize(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (TEXT_SIZES.includes(v)) return v;
  } catch {
    /* 読めなければふだんの大きさ */
  }
  return DEFAULT_SIZE;
}

/** 覚えている大きさを画面に反映する（はじめに1回呼ぶ） */
export function applyTextSize() {
  document.documentElement.style.setProperty("--body-size", `${getTextSize()}px`);
}

function setTextSize(size: number) {
  try {
    localStorage.setItem(KEY, String(size));
  } catch {
    /* 覚えられなくても、今の画面では変わる */
  }
  applyTextSize();
  window.dispatchEvent(new Event(EVENT));
}

/** 大きさが変わったときに呼ばれるようにする。やめる関数を返す */
export function onTextSizeChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** 「A− 14 A＋」のボタン */
export function createTextSizeControl(): HTMLElement {
  const label = h("span", { class: "text-size-value" });
  const smaller = h("button", { class: "text-size-btn", type: "button", title: "文字を小さく" }, "A−");
  const bigger = h("button", { class: "text-size-btn", type: "button", title: "文字を大きく" }, "A＋");

  const draw = () => {
    const size = getTextSize();
    const i = TEXT_SIZES.indexOf(size);
    label.textContent = String(size);
    smaller.disabled = i <= 0;
    bigger.disabled = i >= TEXT_SIZES.length - 1;
  };
  const step = (d: number) => {
    const i = TEXT_SIZES.indexOf(getTextSize());
    const next = TEXT_SIZES[Math.max(0, Math.min(TEXT_SIZES.length - 1, i + d))];
    if (next !== getTextSize()) setTextSize(next);
  };
  smaller.addEventListener("click", (e) => {
    e.stopPropagation();
    step(-1);
  });
  bigger.addEventListener("click", (e) => {
    e.stopPropagation();
    step(1);
  });

  const el = h("div", { class: "text-size", role: "group", "aria-label": "文字の大きさ" }, smaller, label, bigger);
  // 同じ画面にボタンが2つあるとき（プレビューなど）も表示をそろえる。画面から消えたボタンは聞くのをやめる
  const stop = onTextSizeChange(() => (el.isConnected ? draw() : stop()));
  draw();
  return el;
}
