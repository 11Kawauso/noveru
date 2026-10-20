// 紙のスクロールバー（ブラウザのものは出していないので、noveru の見た目に合わせて作る）
//   細い線の上を、丸いつまみが動く。つまみはドラッグでき、線を押すとその場所へ移る。
//   つまみを動かしているあいだは、横に「いまのページ」を小さく出す。
//   縦（横書きの本：紙が上から下へ並ぶ）と、横（縦書きの本：紙が右から左へ並ぶ）の2とおり。
//   横のときは、本と同じく右が始まり（入れ物は direction: rtl で、scrollLeft は 0 から左へ負になる）。

import { h } from "./dom";

export type ScrollAxis = "x" | "y";

export interface Scrollbar {
  el: HTMLElement;
  update(): void;
  /** 縦（y）か横（x）か */
  setAxis(axis: ScrollAxis): void;
  destroy(): void;
}

export function createScrollbar(scroller: HTMLElement, opts: { label?: () => string } = {}): Scrollbar {
  const tip = h("div", { class: "vscroll-tip", "aria-hidden": "true" });
  const thumb = h("div", { class: "vscroll-thumb" }, tip);
  const el = h("div", { class: "vscroll", "aria-hidden": "true" }, h("div", { class: "vscroll-line" }), thumb);
  let axis: ScrollAxis = "y";
  let size = 0;
  let frame = 0;

  /** 線の長さ（つまみの分を引いたもの）と、スクロールできる長さ */
  const lengths = () => ({
    track: (axis === "y" ? el.clientHeight : el.clientWidth) - size,
    scroll: axis === "y" ? scroller.scrollHeight - scroller.clientHeight : scroller.scrollWidth - scroller.clientWidth,
  });

  /** どこまで進んだか（0：始まり、1：終わり） */
  const progress = (): number => {
    const { scroll } = lengths();
    if (scroll <= 0) return 0;
    return axis === "y" ? scroller.scrollTop / scroll : -scroller.scrollLeft / scroll;
  };
  const setProgress = (p: number, smooth = false) => {
    const { scroll } = lengths();
    const v = Math.max(0, Math.min(1, p)) * scroll;
    const behavior = smooth ? "smooth" : "instant";
    if (axis === "y") scroller.scrollTo({ top: v, behavior });
    else scroller.scrollTo({ left: -v, behavior });
  };

  const update = () => {
    const view = axis === "y" ? scroller.clientHeight : scroller.clientWidth;
    const whole = axis === "y" ? scroller.scrollHeight : scroller.scrollWidth;
    const idle = whole <= view + 1;
    el.classList.toggle("is-idle", idle);
    if (idle) return;
    const length = axis === "y" ? el.clientHeight : el.clientWidth;
    size = Math.max(36, (view / whole) * length);
    const { track } = lengths();
    const p = progress();
    if (axis === "y") {
      thumb.style.width = "";
      thumb.style.height = `${size}px`;
      thumb.style.transform = `translateY(${p * track}px)`;
    } else {
      // 右が始まりなので、進むほど左へ
      thumb.style.height = "";
      thumb.style.width = `${size}px`;
      thumb.style.transform = `translateX(${(1 - p) * track}px)`;
    }
    if (opts.label) tip.textContent = opts.label();
  };
  const onScroll = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  };

  /** 線の上の位置（px）を、進んだ割合にする */
  const toProgress = (offset: number) => {
    const { track } = lengths();
    const p = Math.max(0, Math.min(1, offset / Math.max(1, track)));
    return axis === "y" ? p : 1 - p;
  };

  // つまみのドラッグ
  let drag: { id: number; at: number; p: number } | null = null;
  const pointerAt = (e: PointerEvent) => (axis === "y" ? e.clientY : e.clientX);
  thumb.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    drag = { id: e.pointerId, at: pointerAt(e), p: progress() };
    thumb.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");
  });
  thumb.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { track } = lengths();
    const moved = (pointerAt(e) - drag.at) / Math.max(1, track);
    setProgress(drag.p + (axis === "y" ? moved : -moved));
  });
  const end = () => {
    drag = null;
    el.classList.remove("is-dragging");
  };
  thumb.addEventListener("pointerup", end);
  thumb.addEventListener("pointercancel", end);

  // 線を押したら、そこへ移る（つまみの真ん中が押した所に来るように）
  el.addEventListener("pointerdown", (e) => {
    if (e.target === thumb || thumb.contains(e.target as Node)) return;
    const r = el.getBoundingClientRect();
    const offset = (axis === "y" ? e.clientY - r.top : e.clientX - r.left) - size / 2;
    setProgress(toProgress(offset), true);
  });

  // スクロールバーの上でホイールを回しても、紙がスクロールする（横のときは、下に回すと先＝左へ）
  el.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (axis === "y") scroller.scrollBy({ top: e.deltaY });
      else scroller.scrollBy({ left: -(e.deltaY || e.deltaX) });
    },
    { passive: false },
  );

  scroller.addEventListener("scroll", onScroll, { passive: true });
  const observer = new ResizeObserver(onScroll);
  observer.observe(scroller);
  observer.observe(el);
  if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
  requestAnimationFrame(update);

  return {
    el,
    update,
    setAxis(next: ScrollAxis) {
      axis = next;
      el.classList.toggle("is-x", next === "x");
      update();
    },
    destroy() {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
    },
  };
}
