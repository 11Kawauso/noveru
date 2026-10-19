// ほかの人の作品を押したときに出る「作品の概要」の小窓
//   表紙・タイトル・作者・タグ・あらすじ・いいねを見て、「読む」で読み始める
//   小窓から作者のページなどへ移って「戻る」と、また小窓が開いた状態に戻る。

import { navigate } from "../router";
import type { BookMeta } from "../store";
import { formatDate } from "./bookTip";
import { displayTitle, renderCover } from "./cover";
import { h, openDialog } from "./dom";
import { createLikeButton } from "./likeButton";
import { withScrollThumb } from "./scrollThumb";
import { renderTagChips } from "./tags";

/** 履歴（history.state）に、どの本の小窓を開いているかを書いておくときの名前 */
const STATE_KEY = "noveruBookInfo";

function setOpenBook(id: string | null) {
  const state = { ...((history.state as Record<string, unknown> | null) ?? {}) };
  if (id) state[STATE_KEY] = id;
  else delete state[STATE_KEY];
  history.replaceState(state, "");
}

export function openBookInfo(b: BookMeta) {
  const openedHash = location.hash;
  setOpenBook(b.id);
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
            onclick: () => navigate(`/read/${encodeURIComponent(b.ownerId)}/${encodeURIComponent(b.id)}`),
          },
          "読む",
        ),
        h("a", { class: "btn", href: authorHref }, "作者のページを見る"),
      ),
    ),
  );
  // ほかの画面に移って閉じたときは、戻ったらまた開けるように履歴の印を残す。
  // この画面のまま閉じたとき（Esc・背景を押す）だけ印を消す
  const close = openDialog(content, () => {
    if (location.hash === openedHash) setOpenBook(null);
  });
  // いまと同じ画面へのリンク（画面が変わらない）を押したときも閉じる
  content.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (a && a.getAttribute("href") === location.hash) close();
  });
}

/** 戻ってきたとき、前に小窓を開いていたなら開き直す（本の一覧を読み込んだあとに呼ぶ） */
export function reopenBookInfo(findBook: (id: string) => BookMeta | undefined) {
  const id = (history.state as Record<string, unknown> | null)?.[STATE_KEY];
  const book = typeof id === "string" ? findBook(id) : undefined;
  if (book) openBookInfo(book);
  else if (id) setOpenBook(null);
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
