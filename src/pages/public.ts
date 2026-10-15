// 公開ページ：その人が並べている本だけを表紙で見せる（本棚は見せない）

import { displayTitle, renderCover } from "../lib/cover";
import { h } from "../lib/dom";
import { store } from "../store";

export function publicPage(app: HTMLElement, params: Record<string, string>) {
  const { uid } = params;
  const isMine = store.currentUser()?.uid === uid;
  let left = false;

  const name = h("h1", {}, "");
  const grid = h("div", { class: "cover-grid" });
  const note = h("p", { class: "loading" }, "読み込み中…");

  app.append(
    h(
      "div",
      { class: "public-page" },
      isMine
        ? h(
            "div",
            { class: "read-page-head" },
            h("a", { href: "#/" }, "← 本棚へ"),
            h("span", { class: "empty-note" }, "ほかの人には、このように見えます"),
          )
        : null,
      h("div", { class: "public-head" }, name, h("p", {}, "が公開している本")),
      note,
      grid,
    ),
  );

  Promise.all([store.getProfile(uid).catch(() => null), store.listDisplayedBooks(uid).catch(() => null)]).then(
    ([profile, books]) => {
      if (left) return;
      if (!profile && !books?.length) {
        name.textContent = "";
        note.textContent = "このページは見つかりませんでした。";
        app.querySelector(".public-head")?.remove();
        return;
      }
      name.textContent = profile?.penName || "名無し";
      document.title = `${name.textContent}の本 - noveru`;
      if (!books || books.length === 0) {
        note.textContent = "まだ並べている本はありません。";
        return;
      }
      note.remove();
      grid.replaceChildren(
        ...books.map((b) =>
          h(
            "a",
            { class: "cover-item", href: `#/read/${encodeURIComponent(uid)}/${encodeURIComponent(b.id)}` },
            renderCover(b),
            h("span", { class: "cover-caption" }, displayTitle(b)),
          ),
        ),
      );
    },
  );

  return () => {
    left = true;
    document.title = "noveru";
  };
}
