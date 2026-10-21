// ページの拡大縮小（読む画面・書く画面の紙をまるごと大きく／小さくする）
// 文字の並び（1行の字数やページの区切り）は変わらず、見た目の大きさだけが変わる。
// 選んだ倍率はブラウザに覚えておく。
//   「− 100% ＋」のボタンは決まった段階（ZOOMS）ごとに、
//   紙の上での指のピンチ・Ctrl ＋ マウスのホイール（タッチパッドのピンチも）は、段階のあいだも細かく動く。

import { h } from "./dom";

const KEY = "noveru-page-zoom";
export const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2];
const MIN = ZOOMS[0];
const MAX = ZOOMS[ZOOMS.length - 1];
const EVENT = "noveru-page-zoom";

const clamp = (z: number) => Math.min(MAX, Math.max(MIN, z));

export function getZoom(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (v >= MIN && v <= MAX) return v;
  } catch {
    /* 読めなければ 100% */
  }
  return 1;
}

function setZoom(zoom: number) {
  // 細かすぎる数にならないように、0.01 きざみにする
  const z = Math.round(clamp(zoom) * 100) / 100;
  if (z === getZoom()) return;
  try {
    localStorage.setItem(KEY, String(z));
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
    label.textContent = `${Math.round(zoom * 100)}%`;
    smaller.disabled = zoom <= MIN;
    bigger.disabled = zoom >= MAX;
  };
  /** となりの段階へ（ピンチで段階のあいだにいるときは、その向きのいちばん近い段階へ） */
  const step = (d: number) => {
    const zoom = getZoom();
    const next = d > 0 ? ZOOMS.find((z) => z > zoom + 0.001) : [...ZOOMS].reverse().find((z) => z < zoom - 0.001);
    if (next !== undefined) setZoom(next);
  };
  const on = (btn: HTMLElement, fn: () => void) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
    });
  on(smaller, () => step(-1));
  on(bigger, () => step(1));
  on(label, () => setZoom(1));

  const el = h("div", { class: "zoom", role: "group", "aria-label": "ページの拡大縮小" }, smaller, label, bigger);
  // 同じ画面にボタンが2つあるとき（プレビューなど）も表示をそろえる。画面から消えたボタンは聞くのをやめる
  const stop = onZoomChange(() => (el.isConnected ? draw() : stop()));
  draw();
  return el;
}

/**
 * 紙が置いてある所（area：スクロールする入れ物）で、指のピンチと Ctrl ＋ ホイールで拡大縮小できるようにする。
 * content は大きさが変わる中身（並んだ紙）。指やマウスの下にあった所が、拡大縮小したあとも同じ場所に来るように
 * スクロールを合わせる。やめる関数を返す。
 */
export function enableGestureZoom(area: HTMLElement, content: HTMLElement): () => void {
  /** (x, y) の所を動かさずに、倍率を zoom にする */
  const zoomAt = (zoom: number, x: number, y: number) => {
    const before = content.getBoundingClientRect();
    if (!before.width || !before.height) return setZoom(zoom);
    const fx = (x - before.left) / before.width;
    const fy = (y - before.top) / before.height;
    setZoom(zoom); // ここで紙の大きさが変わる（倍率が変わったと聞いた画面が、すぐに大きさを変える）
    const after = content.getBoundingClientRect();
    area.scrollBy({ left: after.left + fx * after.width - x, top: after.top + fy * after.height - y, behavior: "instant" });
  };

  // Ctrl ＋ マウスのホイール（タッチパッドのピンチも、ブラウザからはこれで届く）。ブラウザ全体の拡大はさせない
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomAt(getZoom() * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
  };

  // 指2本のピンチ（1本のときは、ふつうにスクロールする）
  let pinch: { dist: number; zoom: number } | null = null;
  const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) pinch = { dist: distance(e.touches), zoom: getZoom() };
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault(); // ブラウザ全体の拡大はさせない
    const x = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    zoomAt((pinch.zoom * distance(e.touches)) / Math.max(1, pinch.dist), x, y);
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) pinch = null;
  };

  // Mac の Safari のタッチパッドのピンチ（Ctrl ＋ ホイールにならないので）
  let gestureZoom = 1;
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    gestureZoom = getZoom();
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    const g = e as Event & { scale: number; clientX: number; clientY: number };
    zoomAt(gestureZoom * g.scale, g.clientX, g.clientY);
  };

  area.addEventListener("wheel", onWheel, { passive: false });
  area.addEventListener("touchstart", onTouchStart, { passive: true });
  area.addEventListener("touchmove", onTouchMove, { passive: false });
  area.addEventListener("touchend", onTouchEnd);
  area.addEventListener("touchcancel", onTouchEnd);
  area.addEventListener("gesturestart", onGestureStart);
  area.addEventListener("gesturechange", onGestureChange);
  return () => {
    area.removeEventListener("wheel", onWheel);
    area.removeEventListener("touchstart", onTouchStart);
    area.removeEventListener("touchmove", onTouchMove);
    area.removeEventListener("touchend", onTouchEnd);
    area.removeEventListener("touchcancel", onTouchEnd);
    area.removeEventListener("gesturestart", onGestureStart);
    area.removeEventListener("gesturechange", onGestureChange);
  };
}
