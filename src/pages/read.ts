// 読む画面（URL を知っている人なら、並べてある本を誰でも読める）
//   ページを並べてスクロールして読む（reader.ts）。左のパネルに、戻る・タイトルと作者・いいね・タグ・あらすじ・目次。

import { displayTitle, renderCover } from "../lib/cover";
import { h } from "../lib/dom";
import { backLink } from "../lib/backLink";
import { createLikeButton } from "../lib/likeButton";
import { createReader, type Reader } from "../lib/reader";
import { withScrollThumb } from "../lib/scrollThumb";
import { renderTagChips } from "../lib/tags";
import { store } from "../store";

export function readPage(app: HTMLElement, params: Record<string, string>) {
  const { uid, id } = params;
  const me = store.currentUser();
  const isMine = me?.uid === uid;
  let reader: Reader | null = null;
  let left = false;

  const status = h("p", { class: "loading" }, "読み込み中…");
  app.append(status);

  store
    .getBook(uid, id)
    .catch(() => null)
    .then((book) => {
      if (left) return;
      if (!book) {
        status.replaceWith(
          h(
            "div",
            { class: "message-page" },
            h("p", {}, "この本は見つかりませんでした。本棚に戻されたか、削除された可能性があります。"),
            h("a", { class: "btn", href: `#/u/${encodeURIComponent(uid)}` }, "作者のページを見る"),
          ),
        );
        return;
      }
      document.title = `${displayTitle(book)} - noveru`;
      reader = createReader(book, {
        back: backLink(isMine ? "/" : `/u/${encodeURIComponent(uid)}`, "reader-back"),
        cover: renderCover(book),
        extra: [
          h(
            "div",
            { class: "read-page-actions" },
            createLikeButton(uid, id),
            isMine ? h("a", { class: "reader-edit", href: `#/write/${encodeURIComponent(id)}` }, "編集") : null,
          ),
          renderTagChips(book.tags),
          book.synopsis
            ? withScrollThumb(
                h(
                  "div",
                  { class: "read-synopsis" },
                  h("span", { class: "read-synopsis-label" }, "あらすじ"),
                  book.synopsis,
                ),
                "read-synopsis-wrap",
              )
            : null,
        ],
      });
      store.recordView(uid, id).catch(() => {});
      status.replaceWith(reader.el);
    });

  return () => {
    left = true;
    reader?.destroy();
    document.title = "noveru";
  };
}
