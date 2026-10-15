// 読む画面（URL を知っている人なら、並べてある本を誰でも読める）

import { displayTitle } from "../lib/cover";
import { h } from "../lib/dom";
import { createLikeButton } from "../lib/likeButton";
import { createReader, type Reader } from "../lib/reader";
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
            h("a", { class: "btn", href: `#/u/${encodeURIComponent(uid)}` }, "公開中の本を見る"),
          ),
        );
        return;
      }
      document.title = `${displayTitle(book)} - noveru`;
      reader = createReader(book);
      store.recordView(uid, id).catch(() => {});
      status.replaceWith(
        h(
          "div",
          { class: "read-page-head" },
          isMine
            ? h("a", { href: "#/" }, "← 本棚へ")
            : h("a", { href: `#/u/${encodeURIComponent(uid)}` }, "← 公開中の本へ"),
          h(
            "div",
            { class: "read-page-actions" },
            createLikeButton(uid, id),
            isMine ? h("a", { href: `#/write/${encodeURIComponent(id)}` }, "編集") : null,
          ),
        ),
        reader.el,
      );
    });

  return () => {
    left = true;
    reader?.destroy();
    document.title = "noveru";
  };
}
