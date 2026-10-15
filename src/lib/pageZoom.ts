// ページの拡大縮小（読む画面・書く画面の紙をまるごと大きく／小さくする）
// 文字の並び（1行の字数やページの区切り）は変わらず、見た目の大きさだけが変わる。
// 選んだ倍率はブラウザに覚えておく。

import { h } from "./dom";

const KEY = "noveru-page-zoom";
export const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2];
const EVENT = "noveru-page-zoom";

export function getZoom(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (ZOOMS.includes(v)) return v;
  } catch {
    /* 読めなければ 100% */
  }
  return 1;
}

function setZoom(zoom: number) {
  try {
    localStorage.setItem(KEY, String(zoom));
  } catch {
    /* 覚えられなくても、今の画面では変わる */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** 倍率が変わったときに呼ばれるようにする。やめる関数を返す */
export function onZoomChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** 「− 100% ＋」のボタン */
export function createZoomControl(): HTMLElement {
  const label = h("button", { class: "zoom-value", type: "button", title: "100% に戻す" });
  const smaller = h("button", { class: "zoom-btn", type: "button", title: "縮小" }, "−");
  const bigger = h("button", { class: "zoom-btn", type: "button", title: "拡大" }, "＋");

  const draw = () => {
    const zoom = getZoom();
    const i = ZOOMS.indexOf(zoom);
    label.textContent = `${Math.round(zoom * 100)}%`;
    smaller.disabled = i <= 0;
    bigger.disabled = i >= ZOOMS.length - 1;
  };
  const step = (d: number) => {
    const i = ZOOMS.indexOf(getZoom());
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + d))];
    if (next !== getZoom()) setZoom(next);
  };
  const on = (btn: HTMLElement, fn: () => void) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
    });
  on(smaller, () => step(-1));
  on(bigger, () => step(1));
  on(label, () => getZoom() !== 1 && setZoom(1));

  const el = h("div", { class: "zoom", role: "group", "aria-label": "ページの拡大縮小" }, smaller, label, bigger);
  // 同じ画面にボタンが2つあるとき（プレビューなど）も表示をそろえる。画面から消えたボタンは聞くのをやめる
  const stop = onZoomChange(() => (el.isConnected ? draw() : stop()));
  draw();
  return el;
}
