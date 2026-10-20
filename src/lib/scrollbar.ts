// 縦に長いスクロールバー（ブラウザのものは出していないので、noveru の見た目に合わせて作る）
//   細い線の上を、丸いつまみが動く。つまみはドラッグでき、線を押すとその場所へ移る。
//   つまみを動かしているあいだは、横に「いまのページ」を小さく出す。

import { h } from "./dom";

export interface Scrollbar {
  el: HTMLElement;
  update(): void;
  destroy(): void;
}

export function createScrollbar(scroller: HTMLElement, opts: { label?: () => string } = {}): Scrollbar {
  const tip = h("div", { class: "vscroll-tip", "aria-hidden": "true" });
  const thumb = h("div", { class: "vscroll-thumb" }, tip);
  const el = h("div", { class: "vscroll", "aria-hidden": "true" }, h("div", { class: "vscroll-line" }), thumb);
  let size = 0;
  let frame = 0;

  /** つまみが動ける長さと、スクロールできる長さ */
  const lengths = () => ({
    track: el.clientHeight - size,
    scroll: scroller.scrollHeight - scroller.clientHeight,
  });

  const update = () => {
    const { scrollHeight, clientHeight, scrollTop } = scroller;
    const idle = scrollHeight <= clientHeight + 1;
    el.classList.toggle("is-idle", idle);
    if (idle) return;
    size = Math.max(36, (clientHeight / scrollHeight) * el.clientHeight);
    const { track, scroll } = lengths();
    thumb.style.height = `${size}px`;
    thumb.style.transform = `translateY(${(scrollTop / scroll) * track}px)`;
    if (opts.label) tip.textContent = opts.label();
  };
  const onScroll = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  };

  // つまみのドラッグ
  let drag: { id: number; y: number; top: number } | null = null;
  thumb.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    drag = { id: e.pointerId, y: e.clientY, top: scroller.scrollTop };
    thumb.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");
  });
  thumb.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { track, scroll } = lengths();
    scroller.scrollTop = drag.top + ((e.clientY - drag.y) / Math.max(1, track)) * scroll;
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
    const { track, scroll } = lengths();
    const y = e.clientY - el.getBoundingClientRect().top - size / 2;
    scroller.scrollTo({ top: (Math.max(0, Math.min(track, y)) / Math.max(1, track)) * scroll, behavior: "smooth" });
  });

  // スクロールバーの上でホイールを回しても、紙がスクロールする
  el.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      scroller.scrollBy({ top: e.deltaY });
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
    destroy() {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
    },
  };
}
