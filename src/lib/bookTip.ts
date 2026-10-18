// 本にマウスを合わせたとき、カーソルの隣に本の情報（表紙・タイトル・作者・制作日）を出す
// スマホ（指）では出さない。本を持ち上げている間も出さない。

import type { BookMeta } from "../store";
import { displayTitle, renderCover } from "./cover";
import { h } from "./dom";

const OFFSET = 16; // カーソルからの距離
const MARGIN = 8; // 画面の端からの最小の距離

function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function enableBookTips(root: HTMLElement, findBook: (id: string) => BookMeta | undefined): () => void {
  const tip = h("div", { class: "book-tip", role: "tooltip", hidden: true });
  document.body.append(tip);
  let currentId: string | null = null;

  const hide = () => {
    tip.hidden = true;
    currentId = null;
  };

  const place = (x: number, y: number) => {
    const w = tip.offsetWidth;
    const hgt = tip.offsetHeight;
    // 右下に出す。はみ出すときは左や上に回す
    let left = x + OFFSET;
    let top = y + OFFSET;
    if (left + w > window.innerWidth - MARGIN) left = x - OFFSET - w;
    if (top + hgt > window.innerHeight - MARGIN) top = y - OFFSET - hgt;
    tip.style.left = `${Math.max(MARGIN, left)}px`;
    tip.style.top = `${Math.max(MARGIN, top)}px`;
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || document.body.classList.contains("dragging-book")) {
      hide();
      return;
    }
    const item = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-book-id]") : null;
    const book = item && root.contains(item) ? findBook(item.dataset.bookId!) : undefined;
    if (!book) {
      hide();
      return;
    }
    if (currentId !== book.id) {
      currentId = book.id;
      tip.replaceChildren(
        h("div", { class: "book-tip-cover" }, renderCover(book)),
        h(
          "div",
          { class: "book-tip-body" },
          h("div", { class: "book-tip-title" }, displayTitle(book)),
          h("div", { class: "book-tip-author" }, book.author || "作者なし"),
          h("div", { class: "book-tip-date" }, `制作日 ${formatDate(book.createdAt)}`),
          book.synopsis ? h("div", { class: "book-tip-synopsis" }, book.synopsis) : null,
        ),
      );
      tip.hidden = false;
    }
    place(e.clientX, e.clientY);
  };

  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerleave", hide);
  root.addEventListener("pointerdown", hide);
  window.addEventListener("scroll", hide, { passive: true });

  return () => {
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerleave", hide);
    root.removeEventListener("pointerdown", hide);
    window.removeEventListener("scroll", hide);
    tip.remove();
  };
}
