// スクロールバーの「つまみ」だけを、スクロールする欄の右側に細く出す
// （スクロールバーは出していないので、どこまで読んだか分かるように）。
// 中身が欄に収まっているときは出さない。つまみはドラッグしても動かせる。

import { h } from "./dom";

/** el をつまみ付きの入れ物で包んで返す。el は画面に置く前に渡してよい */
export function withScrollThumb(el: HTMLElement, className = ""): HTMLElement {
  const thumb = h("div", { class: "scroll-thumb", "aria-hidden": "true" });
  const wrap = h("div", { class: `scroll-wrap ${className}`.trim() }, el, thumb);

  const update = () => {
    const { scrollHeight, clientHeight, scrollTop } = el;
    const overflow = scrollHeight > clientHeight + 1;
    thumb.hidden = !overflow;
    if (!overflow) return;
    const track = clientHeight;
    const size = Math.max(24, (clientHeight / scrollHeight) * track);
    const top = (scrollTop / (scrollHeight - clientHeight)) * (track - size);
    thumb.style.height = `${size}px`;
    thumb.style.transform = `translateY(${el.offsetTop + top}px)`;
  };

  el.addEventListener("scroll", update, { passive: true });
  el.addEventListener("input", update);
  new ResizeObserver(update).observe(el);

  // つまみをドラッグしてスクロールする
  let drag: { id: number; y: number; scrollTop: number } | null = null;
  thumb.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    drag = { id: e.pointerId, y: e.clientY, scrollTop: el.scrollTop };
    thumb.setPointerCapture(e.pointerId);
    thumb.classList.add("is-dragging");
  });
  thumb.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const ratio = el.scrollHeight / el.clientHeight;
    el.scrollTop = drag.scrollTop + (e.clientY - drag.y) * ratio;
  });
  const end = () => {
    drag = null;
    thumb.classList.remove("is-dragging");
  };
  thumb.addEventListener("pointerup", end);
  thumb.addEventListener("pointercancel", end);

  requestAnimationFrame(update);
  return wrap;
}
