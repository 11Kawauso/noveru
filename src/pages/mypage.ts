// マイページ：上に本棚、下に表紙を向けて並べた本

import { enableBookDrag, type DropResult } from "../lib/bookDrag";
import { enableBookTips } from "../lib/bookTip";
import { displayTitle, fitSpine, renderCover, renderSpine } from "../lib/cover";
import { confirmDialog, h, openDialog, toast } from "../lib/dom";
import { navigate } from "../router";
import { store, StoreError, type BookMeta, type BookPlacement } from "../store";

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
  const shelfArea = h("section", { class: "shelf", "aria-label": "本棚" }, shelfBooks);

  const root = h(
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
      shelfArea,
      h("section", { class: "display", "aria-label": "公開中" }, h("h2", { class: "section-title" }, "公開中"), displayGrid),
  );
  app.append(root);

  let books: BookMeta[] = [];

  const draw = () => {
    const onShelf = books.filter((b) => !b.displayed).sort((a, b) => a.shelfOrder - b.shelfOrder);
    const displayed = books.filter((b) => b.displayed).sort((a, b) => a.displayOrder - b.displayOrder);

    shelfBooks.replaceChildren(
      ...onShelf.map((b) =>
        h(
          "button",
          { class: "spine", "aria-label": displayTitle(b), "data-book-id": b.id, onclick: () => openBookMenu(b) },
          renderSpine(b),
        ),
      ),
    );
    if (onShelf.length === 0) {
      shelfBooks.append(
        h(
          "p",
          { class: "shelf-empty" },
          books.length === 0 ? "本棚はまだ空です。「＋ 新しく書く」から小説を書いてみましょう。" : "本棚の本はすべて公開中です。",
        ),
      );
    }

    displayGrid.replaceChildren(
      ...displayed.map((b) =>
        h(
          "button",
          { class: "cover-item", "data-book-id": b.id, onclick: () => openBookMenu(b) },
          renderCover(b),
          h("span", { class: "cover-caption" }, displayTitle(b)),
        ),
      ),
    );
    fitSpines();
  };

  const fitSpines = () => shelfBooks.querySelectorAll<HTMLElement>(".spine-face").forEach(fitSpine);
  // 本のフォントが届いたら、背表紙の文字の入り方を測り直す
  document.fonts?.ready.then(fitSpines);

  /** ドラッグで置いたあと：置き場所と順番を保存する */
  const onDrop = async ({ movedId, shelfIds, displayIds }: DropResult) => {
    const before = books.find((b) => b.id === movedId);
    const changes: BookPlacement[] = [];
    const apply = (ids: string[], displayed: boolean) =>
      ids.forEach((id, order) => {
        const b = books.find((x) => x.id === id);
        if (!b) return;
        const current = displayed ? b.displayOrder : b.shelfOrder;
        if (b.displayed === displayed && current === order) return;
        changes.push({ id, displayed, order });
        b.displayed = displayed;
        if (displayed) b.displayOrder = order;
        else b.shelfOrder = order;
      });
    const wasDisplayed = before?.displayed;
    apply(shelfIds, false);
    apply(displayIds, true);
    draw();
    if (changes.length === 0) return;
    try {
      await store.arrangeBooks(changes);
      if (before && wasDisplayed !== before.displayed) {
        toast(before.displayed ? "公開しました。" : "本棚に戻しました（非公開）。");
      }
    } catch (e) {
      toast(e instanceof StoreError ? e.message : "並べ替えを保存できませんでした。");
      reload();
    }
  };

  const stopDrag = enableBookDrag({
    root,
    shelf: shelfBooks,
    shelfArea,
    grid: displayGrid,
    makeShelfSlot: (width) => h("div", { class: "spine-slot", style: width ? `width:${width}px` : "width:var(--spine-w)" }),
    makeGridSlot: () => h("div", { class: "cover-item cover-slot" }, h("div", { class: "cover" })),
    onDrop,
  });
  const stopTips = enableBookTips(root, (id) => books.find((b) => b.id === id));

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
              ? act("本棚に戻す（非公開）", async () => {
                  await store.setDisplayed(b.id, false);
                  await reload();
                  toast("本棚に戻しました（非公開）。");
                })
              : act(
                  "公開する",
                  async () => {
                    await store.setDisplayed(b.id, true);
                    await reload();
                    toast("公開しました。");
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

  return () => {
    stopDrag();
    stopTips();
  };
}
