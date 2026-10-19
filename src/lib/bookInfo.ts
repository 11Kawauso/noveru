// ほかの人の作品を押したときに出る「作品の概要」の小窓
//   表紙・タイトル・作者・タグ・あらすじ・いいねを見て、「読む」で読み始める

import { navigate } from "../router";
import type { BookMeta } from "../store";
import { formatDate } from "./bookTip";
import { displayTitle, renderCover } from "./cover";
import { h, openDialog } from "./dom";
import { createLikeButton } from "./likeButton";
import { withScrollThumb } from "./scrollThumb";
import { renderTagChips } from "./tags";

export function openBookInfo(b: BookMeta) {
  const authorHref = `#/u/${encodeURIComponent(b.ownerId)}`;
  const content = h(
    "div",
    { class: "book-menu book-info" },
    h("div", { class: "book-menu-cover" }, renderCover(b)),
    h(
      "div",
      { class: "book-menu-body" },
      h("h2", {}, displayTitle(b)),
      h("p", { class: "book-menu-author" }, h("a", { href: authorHref }, b.author || "作者なし")),
      h("p", { class: "book-info-meta" }, `${b.vertical ? "縦書き" : "横書き"}・${formatDate(b.createdAt)}`),
      renderTagChips(b.tags),
      b.synopsis ? withScrollThumb(h("p", { class: "synopsis-text" }, b.synopsis), "synopsis-wrap") : null,
      h("div", { class: "book-menu-like" }, createLikeButton(b.ownerId, b.id)),
      h(
        "div",
        { class: "book-menu-actions" },
        h(
          "button",
          {
            class: "btn btn-primary",
            onclick: () => {
              close();
              navigate(`/read/${encodeURIComponent(b.ownerId)}/${encodeURIComponent(b.id)}`);
            },
          },
          "読む",
        ),
        h("a", { class: "btn", href: authorHref }, "作者のページを見る"),
      ),
    ),
  );
  const close = openDialog(content);
  // タグや作者のリンクを押したら閉じる（いまと同じ画面へのリンクでも閉じるように）
  content.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest("a[href]")) close();
  });
}

/**
 * 表紙の並び（root の中の [data-book-id]）を押したら、すぐ読まずに概要の小窓を出す。
 * Ctrl＋クリックなど（新しいタブで開く）はそのまま読む画面へ。
 */
export function enableBookInfo(root: HTMLElement, findBook: (id: string) => BookMeta | undefined): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const item = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-book-id]") : null;
    const book = item && root.contains(item) ? findBook(item.dataset.bookId!) : undefined;
    if (!book) return;
    e.preventDefault();
    openBookInfo(book);
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
