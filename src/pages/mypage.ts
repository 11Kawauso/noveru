// マイページ：上に本棚、下に表紙を向けて並べた本

import { displayTitle, renderCover, renderSpine } from "../lib/cover";
import { confirmDialog, h, openDialog, toast } from "../lib/dom";
import { navigate } from "../router";
import { store, StoreError, type BookMeta } from "../store";

export function publicUrl(uid: string): string {
  return `${location.origin}${location.pathname}#/u/${encodeURIComponent(uid)}`;
}

export function myPage(app: HTMLElement) {
  const user = store.currentUser();
  if (!user) {
    navigate("/login");
    return;
  }

  const shelfBooks = h("div", { class: "shelf-books" });
  const displayGrid = h("div", { class: "cover-grid" });
  const displayEmpty = h("p", { class: "empty-note" }, "本棚の本を選んで「並べる」を押すと、ここに表紙を向けて並びます。");

  app.append(
    h(
      "div",
      { class: "mypage" },
      h(
        "div",
        { class: "page-toolbar" },
        h("h1", { class: "page-title" }, "本棚"),
        h(
          "div",
          { class: "toolbar-buttons" },
          h(
            "button",
            {
              class: "btn",
              title: "並べた本を見せるためのURLをコピーします",
              onclick: async () => {
                try {
                  await navigator.clipboard.writeText(publicUrl(user.uid));
                  toast("公開ページのURLをコピーしました。");
                } catch {
                  openDialog(
                    h(
                      "div",
                      {},
                      h("h2", {}, "公開ページのURL"),
                      h("input", { class: "url-box", readonly: true, value: publicUrl(user.uid) }),
                    ),
                  );
                }
              },
            },
            "公開ページのURLをコピー",
          ),
          h("a", { class: "btn", href: `#/u/${encodeURIComponent(user.uid)}` }, "公開ページを見る"),
          h("a", { class: "btn btn-primary", href: "#/write/new" }, "＋ 新しく書く"),
        ),
      ),
      h("section", { class: "shelf", "aria-label": "本棚" }, shelfBooks),
      h(
        "section",
        { class: "display", "aria-label": "並べている本" },
        h("h2", { class: "section-title" }, "並べている本"),
        displayEmpty,
        displayGrid,
      ),
    ),
  );

  let books: BookMeta[] = [];

  const draw = () => {
    const onShelf = books.filter((b) => !b.displayed).sort((a, b) => b.updatedAt - a.updatedAt);
    const displayed = books.filter((b) => b.displayed).sort((a, b) => a.displayOrder - b.displayOrder);

    shelfBooks.replaceChildren(
      ...onShelf.map((b) =>
        h(
          "button",
          { class: "spine", title: displayTitle(b), onclick: () => openBookMenu(b) },
          renderSpine(b),
        ),
      ),
    );
    if (onShelf.length === 0) {
      shelfBooks.append(
        h(
          "p",
          { class: "shelf-empty" },
          books.length === 0 ? "本棚はまだ空です。「＋ 新しく書く」から小説を書いてみましょう。" : "本棚の本はすべて並べています。",
        ),
      );
    }

    displayEmpty.hidden = displayed.length > 0;
    displayGrid.replaceChildren(
      ...displayed.map((b) =>
        h(
          "button",
          { class: "cover-item", onclick: () => openBookMenu(b) },
          renderCover(b),
          h("span", { class: "cover-caption" }, displayTitle(b)),
        ),
      ),
    );
  };

  const reload = async () => {
    try {
      books = await store.listMyBooks();
      draw();
    } catch (e) {
      toast(e instanceof StoreError ? e.message : "本棚を読み込めませんでした。");
    }
  };

  const openBookMenu = (b: BookMeta) => {
    const act = (label: string, fn: () => void | Promise<void>, cls = "btn") =>
      h(
        "button",
        {
          class: cls,
          onclick: async () => {
            close();
            try {
              await fn();
            } catch (e) {
              toast(e instanceof StoreError ? e.message : "うまくいきませんでした。");
            }
          },
        },
        label,
      );

    const close = openDialog(
      h(
        "div",
        { class: "book-menu" },
        h("div", { class: "book-menu-cover" }, renderCover(b)),
        h(
          "div",
          { class: "book-menu-body" },
          h("h2", {}, displayTitle(b)),
          b.author ? h("p", { class: "book-menu-author" }, b.author) : null,
          h(
            "div",
            { class: "book-menu-actions" },
            b.displayed
              ? act("本棚に戻す", async () => {
                  await store.setDisplayed(b.id, false);
                  await reload();
                })
              : act(
                  "並べる",
                  async () => {
                    await store.setDisplayed(b.id, true);
                    await reload();
                    toast("本棚から出して並べました。");
                  },
                  "btn btn-primary",
                ),
            act("読む", () => navigate(`/read/${encodeURIComponent(user.uid)}/${encodeURIComponent(b.id)}`)),
            act("書き直す", () => navigate(`/write/${encodeURIComponent(b.id)}`)),
            act(
              "削除",
              async () => {
                const ok = await confirmDialog(`「${displayTitle(b)}」を削除しますか？\n削除すると元に戻せません。`, "削除する", true);
                if (!ok) return;
                await store.deleteBook(b.id);
                await reload();
                toast("削除しました。");
              },
              "btn btn-ghost btn-delete",
            ),
          ),
        ),
      ),
    );
  };

  shelfBooks.append(h("p", { class: "shelf-empty" }, "読み込み中…"));
  reload();
}
