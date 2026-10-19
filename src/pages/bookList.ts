// 「いいね」と「履歴」の画面：本を表紙で横3列に並べて見せる

import { enableBookInfo } from "../lib/bookInfo";
import { enableBookTips } from "../lib/bookTip";
import { displayTitle, renderCover } from "../lib/cover";
import { confirmDialog, h, toast } from "../lib/dom";
import { navigate } from "../router";
import { store, StoreError, type BookMeta } from "../store";

interface ListItem {
  book: BookMeta;
  /** 表紙の下に小さく出す文字（読んだ日など） */
  note?: string;
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${mm}`;
}

function bookListPage(
  app: HTMLElement,
  opts: {
    title: string;
    empty: string;
    load: () => Promise<ListItem[]>;
    /** 見出しの右に出すボタン */
    action?: (reload: () => void) => HTMLElement;
  },
) {
  if (!store.currentUser()) {
    navigate("/login");
    return;
  }

  let items: ListItem[] = [];
  let left = false;
  const grid = h("div", { class: "cover-grid" });
  const note = h("p", { class: "loading" }, "読み込み中…");
  const toolbar = h("div", { class: "page-toolbar" }, h("h1", { class: "page-title" }, opts.title));
  app.append(h("div", { class: "mypage" }, toolbar, note, grid));

  const reload = () => {
    note.hidden = false;
    note.textContent = "読み込み中…";
    opts
      .load()
      .then((list) => {
        if (left) return;
        items = list;
        note.hidden = list.length > 0;
        note.textContent = opts.empty;
        grid.replaceChildren(
          ...list.map(({ book, note: sub }) =>
            h(
              "a",
              {
                class: "cover-item",
                "data-book-id": book.id,
                href: `#/read/${encodeURIComponent(book.ownerId)}/${encodeURIComponent(book.id)}`,
              },
              renderCover(book),
              h("span", { class: "cover-caption" }, displayTitle(book)),
              sub ? h("span", { class: "cover-sub" }, sub) : null,
            ),
          ),
        );
      })
      .catch((e) => {
        note.textContent = e instanceof StoreError ? e.message : "読み込めませんでした。";
      });
  };

  if (opts.action) toolbar.append(opts.action(reload));
  const findItem = (id: string) => items.find((x) => x.book.id === id)?.book;
  const stopTips = enableBookTips(grid, findItem);
  const stopInfo = enableBookInfo(grid, findItem);
  reload();

  return () => {
    left = true;
    stopTips();
    stopInfo();
  };
}

export function likesPage(app: HTMLElement) {
  return bookListPage(app, {
    title: "いいね",
    empty: "まだいいねした本はありません。本を読んでいるときに ♡ を押すと、ここに並びます。",
    load: async () => (await store.listLikedBooks()).map((book) => ({ book })),
  });
}

export function historyPage(app: HTMLElement) {
  return bookListPage(app, {
    title: "閲覧履歴",
    empty: "まだ読んだ本はありません。",
    load: async () =>
      (await store.listHistory()).map(({ book, viewedAt }) => ({ book, note: `${formatDateTime(viewedAt)} に読んだ` })),
    action: (reload) =>
      h(
        "button",
        {
          class: "btn",
          onclick: async () => {
            if (!(await confirmDialog("閲覧履歴をすべて消しますか？", "消す", true))) return;
            try {
              await store.clearHistory();
              toast("閲覧履歴を消しました。");
              reload();
            } catch (e) {
              toast(e instanceof StoreError ? e.message : "消せませんでした。");
            }
          },
        },
        "履歴を消す",
      ),
  });
}
