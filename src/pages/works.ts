// 「書く」の最初の画面：自分の作品（本棚の本も公開中の本も）を、横長の列で上から並べる
// 押すとその作品の編集へ。右上の「作成」から新しい作品を書き始める。

import { openBookMenu } from "../lib/bookMenu";
import { displayTitle, renderCover } from "../lib/cover";
import { h, toast } from "../lib/dom";
import { openPopupMenu } from "../lib/popupMenu";
import { navigate } from "../router";
import { store, StoreError, type BookMeta } from "../store";
import { BOOK_SORTS } from "./mypage";

function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function worksPage(app: HTMLElement) {
  if (!store.currentUser()) {
    navigate("/login");
    return;
  }

  let books: BookMeta[] = [];
  // ふだんは作成した順（古いものが上）
  let sort = BOOK_SORTS.find((s) => s.label === "作成が古い順") ?? BOOK_SORTS[0];
  let left = false;

  const list = h("div", { class: "works-list" });
  const note = h("p", { class: "loading" }, "読み込み中…");

  const sortBtn: HTMLButtonElement = h(
    "button",
    {
      class: "sort-heading",
      "aria-haspopup": "menu",
      title: "並べ替え",
      onclick: () =>
        openPopupMenu(
          sortBtn,
          "作品を並べ替え",
          BOOK_SORTS.map((s) => ({
            label: s.label,
            onSelect: () => {
              sort = s;
              draw();
            },
          })),
        ),
    },
    "作品",
    h("span", { class: "sort-caret", "aria-hidden": "true" }, "▾"),
  );
  const sortLabel = h("span", { class: "works-sort-label" });

  app.append(
    h(
      "div",
      { class: "mypage" },
      h(
        "div",
        { class: "page-toolbar" },
        h("h1", { class: "page-title" }, sortBtn, sortLabel),
        h("a", { class: "btn btn-primary", href: "#/write/new" }, "＋ 作成"),
      ),
      note,
      list,
    ),
  );

  const draw = () => {
    sortLabel.textContent = sort.label;
    const sorted = [...books].sort(sort.compare);
    note.hidden = sorted.length > 0;
    note.textContent = "まだ作品はありません。右上の「作成」から書き始めましょう。";
    list.replaceChildren(
      ...sorted.map((b) =>
        h(
          "button",
          { class: "work-row", type: "button", onclick: () => openBookMenu(b, { onChanged: reload, primary: "edit" }) },
          h("div", { class: "work-cover" }, renderCover(b)),
          h(
            "div",
            { class: "work-main" },
            h("div", { class: "work-title" }, displayTitle(b)),
            h(
              "div",
              { class: "work-meta" },
              h("span", {}, b.author || "作者なし"),
              h("span", {}, b.vertical ? "縦書き" : "横書き"),
            ),
          ),
          h(
            "div",
            { class: "work-side" },
            h("span", { class: b.displayed ? "work-status is-public" : "work-status" }, b.displayed ? "公開中" : "本棚"),
            h("span", { class: "work-date" }, `作成 ${formatDate(b.createdAt)}`),
            h("span", { class: "work-date" }, `更新 ${formatDate(b.updatedAt)}`),
          ),
        ),
      ),
    );
  };

  const reload = () =>
    store
      .listMyBooks()
      .then((list) => {
        if (left) return;
        books = list;
        draw();
      })
      .catch((e) => {
        note.textContent = e instanceof StoreError ? e.message : "作品を読み込めませんでした。";
        toast(note.textContent);
      });
  reload();

  return () => {
    left = true;
  };
}
