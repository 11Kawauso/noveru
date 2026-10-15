// 本をドラッグして動かす仕組み（本棚の中の並べ替え、本棚 ⇄ 公開中 の移動）
//
// ・マウス：押したまま少し動かすと持ち上がる
// ・スマホ：長押しすると持ち上がる（ふつうに指を動かしたときは画面のスクロール）
// ・持ち上げた本は指やマウスについてきて、置ける場所に点線の枠が出る

export interface DropResult {
  movedId: string;
  shelfIds: string[];
  displayIds: string[];
}

export interface DragOptions {
  /** この中で押された本をドラッグできる */
  root: HTMLElement;
  /** 本棚の本が入っている入れ物と、その外枠（ここより上なら本棚に置く） */
  shelf: HTMLElement;
  shelfArea: HTMLElement;
  /** 公開中の本が入っている入れ物 */
  grid: HTMLElement;
  /** 本棚に置くときの枠（幅は持ち上げた本に合わせる） */
  makeShelfSlot(width: number): HTMLElement;
  /** 公開中に置くときの枠 */
  makeGridSlot(): HTMLElement;
  onDrop(result: DropResult): void;
}

const MOUSE_THRESHOLD = 6;
const TOUCH_HOLD_MS = 350;
const TOUCH_SLOP = 8;
const EDGE = 70;
const SCROLL_SPEED = 14;

interface Pending {
  item: HTMLElement;
  id: string;
  pointerId: number;
  isMouse: boolean;
  startX: number;
  startY: number;
  timer: number;
}

interface Dragging {
  item: HTMLElement;
  id: string;
  ghost: HTMLElement;
  offsetX: number;
  offsetY: number;
  shelfSlot: HTMLElement;
  gridSlot: HTMLElement;
  x: number;
  y: number;
  raf: number;
}

export function enableBookDrag(opts: DragOptions): () => void {
  let pending: Pending | null = null;
  let drag: Dragging | null = null;
  let suppressClick = false;

  const bookOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>("[data-book-id]") : null;

  const clearPending = () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  };

  // ---- 持ち上げる ----
  const start = (x: number, y: number) => {
    if (!pending) return;
    const { item, id } = pending;
    clearPending();

    const rect = item.getBoundingClientRect();
    const ghost = item.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("data-book-id");
    ghost.classList.add("drag-ghost");
    Object.assign(ghost.style, {
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      left: `${rect.left}px`,
      top: `${rect.top}px`,
    });
    document.body.append(ghost);

    const fromShelf = item.parentElement === opts.shelf;
    const face = item.querySelector<HTMLElement>(".spine-face");
    const shelfSlot = opts.makeShelfSlot(fromShelf && face ? face.offsetWidth : 0);
    const gridSlot = opts.makeGridSlot();

    // 元の場所に枠を置いて、本そのものは隠す
    item.before(fromShelf ? shelfSlot : gridSlot);
    item.hidden = true;

    drag = { item, id, ghost, offsetX: x - rect.left, offsetY: y - rect.top, shelfSlot, gridSlot, x, y, raf: 0 };
    opts.root.classList.add("is-dragging");
    document.body.classList.add("dragging-book");
    navigator.vibrate?.(15);
    tick();
  };

  // ---- 動かしている間 ----
  const placeSlot = () => {
    if (!drag) return;
    const { x, y } = drag;
    const toShelf = y <= opts.shelfArea.getBoundingClientRect().bottom;
    const container = toShelf ? opts.shelf : opts.grid;
    const slot = toShelf ? drag.shelfSlot : drag.gridSlot;
    (toShelf ? drag.gridSlot : drag.shelfSlot).remove();

    const items = Array.from(container.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !!el.dataset.bookId && el !== drag!.item,
    );
    let index = items.length;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) {
        index = i;
        break;
      }
    }
    const ref = items[index] ?? null;
    if (ref) {
      if (slot.nextElementSibling !== ref || slot.parentElement !== container) ref.before(slot);
    } else {
      const last = items[items.length - 1];
      if (last) {
        if (last.nextElementSibling !== slot) last.after(slot);
      } else if (slot.parentElement !== container) {
        container.prepend(slot);
      }
    }
  };

  const moveGhost = () => {
    if (!drag) return;
    drag.ghost.style.left = `${drag.x - drag.offsetX}px`;
    drag.ghost.style.top = `${drag.y - drag.offsetY}px`;
  };

  // 画面の端に近づいたら自動でスクロールする
  const tick = () => {
    if (!drag) return;
    const { y } = drag;
    let dy = 0;
    if (y > window.innerHeight - EDGE) dy = SCROLL_SPEED;
    else if (y < EDGE) dy = -SCROLL_SPEED;
    if (dy) {
      window.scrollBy(0, dy);
      placeSlot();
    }
    drag.raf = requestAnimationFrame(tick);
  };

  // ---- 置く／やめる ----
  const finish = (drop: boolean) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.raf);

    let result: DropResult | null = null;
    if (drop) {
      const idsIn = (container: HTMLElement) =>
        Array.from(container.children).flatMap((el) => {
          if (el === d.shelfSlot || el === d.gridSlot) return [d.id];
          const id = (el as HTMLElement).dataset.bookId;
          return id && el !== d.item ? [id] : [];
        });
      result = { movedId: d.id, shelfIds: idsIn(opts.shelf), displayIds: idsIn(opts.grid) };
    }

    d.ghost.remove();
    d.shelfSlot.remove();
    d.gridSlot.remove();
    d.item.hidden = false;
    opts.root.classList.remove("is-dragging");
    document.body.classList.remove("dragging-book");
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);

    if (result) opts.onDrop(result);
  };

  // ---- イベント ----
  const onPointerDown = (e: PointerEvent) => {
    if (drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    const item = bookOf(e.target);
    if (!item || !opts.root.contains(item)) return;
    clearPending();
    pending = {
      item,
      id: item.dataset.bookId!,
      pointerId: e.pointerId,
      isMouse: e.pointerType === "mouse",
      startX: e.clientX,
      startY: e.clientY,
      timer: 0,
    };
    if (!pending.isMouse) {
      const x = e.clientX;
      const y = e.clientY;
      pending.timer = window.setTimeout(() => start(x, y), TOUCH_HOLD_MS);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (drag) {
      e.preventDefault();
      drag.x = e.clientX;
      drag.y = e.clientY;
      moveGhost();
      placeSlot();
      return;
    }
    if (!pending || e.pointerId !== pending.pointerId) return;
    const moved = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
    if (pending.isMouse) {
      if (moved > MOUSE_THRESHOLD) {
        start(pending.startX, pending.startY);
        const d = drag as Dragging | null; // start() で持ち上がった本
        if (d) {
          d.x = e.clientX;
          d.y = e.clientY;
          moveGhost();
          placeSlot();
        }
      }
    } else if (moved > TOUCH_SLOP) {
      clearPending(); // 長押しの前に指が動いた＝スクロールしたい
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    clearPending();
    if (drag) {
      // 離した位置で置き場所を決める
      drag.x = e.clientX;
      drag.y = e.clientY;
      placeSlot();
      finish(true);
    }
  };

  const onPointerCancel = () => {
    clearPending();
    if (drag) finish(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (drag && e.key === "Escape") finish(false);
  };

  // ドラッグ中はスマホの画面がスクロールしないようにする
  const onTouchMove = (e: TouchEvent) => {
    if (drag) e.preventDefault();
  };

  // ドラッグしたあとの「クリック」で本のメニューが開かないようにする
  const onClick = (e: MouseEvent) => {
    if (suppressClick) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // 画像などをブラウザがドラッグしようとするのを止める
  const onDragStart = (e: DragEvent) => {
    if (bookOf(e.target)) e.preventDefault();
  };

  // 長押しでメニュー（画像の保存など）が出ないようにする
  const onContextMenu = (e: Event) => {
    if (pending || drag) e.preventDefault();
  };

  opts.root.addEventListener("pointerdown", onPointerDown);
  opts.root.addEventListener("click", onClick, true);
  opts.root.addEventListener("dragstart", onDragStart);
  opts.root.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("keydown", onKey);
  document.addEventListener("touchmove", onTouchMove, { passive: false });

  return () => {
    clearPending();
    finish(false);
    opts.root.removeEventListener("pointerdown", onPointerDown);
    opts.root.removeEventListener("click", onClick, true);
    opts.root.removeEventListener("dragstart", onDragStart);
    opts.root.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("touchmove", onTouchMove);
  };
}
