// マイページ：上に本棚、下に表紙を向けて並べた本

import { enableBookDrag, type DropResult } from "../lib/bookDrag";
import { enableBookTips } from "../lib/bookTip";
import { displayTitle, fitSpine, renderCover, renderSpine } from "../lib/cover";
import { confirmDialog, h, openDialog, toast } from "../lib/dom";
import { createLikeButton } from "../lib/likeButton";
import { openPopupMenu } from "../lib/popupMenu";
import { navigate } from "../router";
import { store, StoreError, type BookMeta, type BookPlacement } from "../store";

export function publicUrl(uid: string): string {
  return `${location.origin}${location.pathname}#/u/${encodeURIComponent(uid)}`;
}

/** あいうえお順に使う文字（読みが入っていれば読み、なければタイトル） */
const readingOf = (b: BookMeta) => b.titleReading.trim() || displayTitle(b);

// 「本棚」「公開中」を押したときの並べ方
const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
const SORTS: { label: string; compare: (a: BookMeta, b: BookMeta) => number }[] = [
  { label: "作成が新しい順", compare: (a, b) => b.createdAt - a.createdAt },
  { label: "作成が古い順", compare: (a, b) => a.createdAt - b.createdAt },
  { label: "更新が新しい順", compare: (a, b) => b.updatedAt - a.updatedAt },
  { label: "タイトル順（あいうえお）", compare: (a, b) => collator.compare(readingOf(a), readingOf(b)) },
];

export function myPage(app: HTMLElement) {
  const user = store.currentUser();
  if (!user) {
    navigate("/login");
    return;
  }

  /** 見出しのボタン。押すと並べ方を選べる */
  function sortButton(label: string, displayed: boolean) {
    const btn: HTMLButtonElement = h(
      "button",
      {
        class: "sort-heading",
        "aria-haspopup": "menu",
        title: "並べ替え",
        onclick: () =>
          openPopupMenu(
            btn,
            `${label}を並べ替え`,
            SORTS.map((s) => ({ label: s.label, onSelect: () => sortArea(displayed, s.compare, s.label) })),
          ),
      },
      label,
      h("span", { class: "sort-caret", "aria-hidden": "true" }, "▾"),
    );
    return btn;
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
        h("h1", { class: "page-title" }, sortButton("本棚", false)),
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
      h("section", { class: "display", "aria-label": "公開中" }, h("h2", { class: "section-title" }, sortButton("公開中", true)), displayGrid),
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

  const idsOf = (displayed: boolean) =>
    books
      .filter((b) => b.displayed === displayed)
      .sort((a, b) => (displayed ? a.displayOrder - b.displayOrder : a.shelfOrder - b.shelfOrder))
      .map((b) => b.id);

  /** 本棚・公開中の本を、選んだ順番に並べ直して保存する */
  const sortArea = async (displayed: boolean, compare: (a: BookMeta, b: BookMeta) => number, label: string) => {
    const sorted = books
      .filter((b) => b.displayed === displayed)
      .sort(compare)
      .map((b) => b.id);
    const ok = await arrange(displayed ? idsOf(false) : sorted, displayed ? sorted : idsOf(true));
    if (ok) toast(`${displayed ? "公開中" : "本棚"}を「${label}」に並べました。`);
  };

  /** ドラッグで置いたあと：置き場所と順番を保存する */
  const onDrop = async ({ movedId, shelfIds, displayIds }: DropResult) => {
    const before = books.find((b) => b.id === movedId);
    const wasDisplayed = before?.displayed;
    const ok = await arrange(shelfIds, displayIds);
    if (ok && before && wasDisplayed !== before.displayed) {
      toast(before.displayed ? "公開しました。" : "本棚に戻しました（非公開）。");
    }
  };

  /** 本棚と公開中の並びを、この順番にして保存する。うまくいけば true */
  const arrange = async (shelfIds: string[], displayIds: string[]): Promise<boolean> => {
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
    apply(shelfIds, false);
    apply(displayIds, true);
    draw();
    if (changes.length === 0) return true;
    try {
      await store.arrangeBooks(changes);
      return true;
    } catch (e) {
      toast(e instanceof StoreError ? e.message : "並べ替えを保存できませんでした。");
      reload();
      return false;
    }
  };

  const stopDrag = enableBookDrag({
    root,
    shelf: shelfBooks,
    shelfArea,
    grid: displayGrid,
    makeShelfSlot: (width) => h("div", { class: "spine-slot", style: width ? `width:${width}px` : "width:var(--spine-w)" }),
    makeGridSlot: () => h("div", { class: "cover-item cover-slot" }, h("div", { class: "cover" })),
    makeGhost: (id) => {
      const b = books.find((x) => x.id === id);
      return h("div", {}, b ? renderCover(b) : null);
    },
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
          h("div", { class: "book-menu-like" }, createLikeButton(user.uid, b.id)),
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
            act("編集", () => navigate(`/write/${encodeURIComponent(b.id)}`)),
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
