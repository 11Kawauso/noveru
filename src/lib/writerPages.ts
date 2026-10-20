// 書く画面の右のパネル：表紙と、読む画面と同じに区切ったページを、小さくして上から並べる
//   ページを押すと、本文のそのページの場所へ飛ぶ。一番下に「いまのページ / 全部のページ」を出す。
//   ページの区切りは、書く手が止まってから少しして計算し直す（毎回計算すると重いため）。

import type { BookMeta } from "../store";
import { renderCover } from "./cover";
import { h } from "./dom";
import { createPaginator, loadFonts, titlePageHtml, type PageInfo, type ReadableBook } from "./reader";

const WAIT = 700;

export interface PagesPanel {
  el: HTMLElement;
  /** 本文が変わったときに呼ぶ（少し待ってから区切り直す） */
  schedule(): void;
  /** タイトル・作者・表紙が変わったときに呼ぶ（表紙と1ページ目だけ描き直す） */
  refreshTitle(): void;
  /** いまのページを目立たせる。pos はカーソルの位置（null ならタイトルのページ） */
  markCurrent(pos: number | null): void;
  destroy(): void;
}

export function createPagesPanel(opts: {
  book: () => ReadableBook;
  meta: () => BookMeta;
  /** 本文の pos 文字目へ飛ぶ */
  jump: (pos: number) => void;
  /** 表紙・タイトルのページを押したとき（書き始めへ） */
  jumpToStart: () => void;
}): PagesPanel {
  const paginator = createPaginator();
  let pages: PageInfo[] = [];
  let timer = 0;
  let lastBody: string | null = null;
  let lastVertical: boolean | null = null;
  let current = -1;
  let caret: number | null = null;
  let destroyed = false;

  const list = h("div", { class: "page-thumbs" });
  const counter = h("div", { class: "page-count" });
  const el = h("aside", { class: "writer-pages", "aria-label": "ページ" }, list, counter);

  const thumb = (label: string, frame: HTMLElement, onclick: () => void, index: number | null) =>
    h(
      "button",
      { class: "page-thumb", type: "button", "data-page": index ?? "cover", onclick, title: label },
      h("div", { class: "page-thumb-frame" }, frame),
      h("span", { class: "page-thumb-num" }, label),
    );

  const pageFrame = (p: PageInfo, i: number) => {
    const content = h("div", { class: i === 0 ? "page-content is-title" : "page-content" });
    content.innerHTML = p.html;
    return h("div", { class: "page" }, content);
  };

  const coverThumb = () => thumb("表紙", renderCover(opts.meta()), opts.jumpToStart, null);

  const draw = () => {
    list.classList.toggle("is-vertical", opts.book().vertical);
    list.replaceChildren(
      coverThumb(),
      ...pages.map((p, i) =>
        thumb(`${i + 1}`, pageFrame(p, i), i === 0 ? opts.jumpToStart : () => opts.jump(p.start), i),
      ),
    );
    current = -1;
    markCurrent(caret);
  };

  const repaginate = async () => {
    const book = opts.book();
    if (book.body === lastBody && book.vertical === lastVertical) return;
    // 本文の文字のフォントがそろってから測る（ページの区切りがずれないように）
    await loadFonts(book.title + book.author + book.body);
    if (destroyed) return;
    lastBody = book.body;
    lastVertical = book.vertical;
    pages = paginator.paginate(book);
    draw();
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(repaginate, WAIT);
  };

  const refreshTitle = () => {
    if (!pages.length) return;
    pages[0] = { html: titlePageHtml(opts.book()), start: 0 };
    const [cover, first] = [list.children[0], list.children[1]];
    cover?.replaceWith(coverThumb());
    first?.replaceWith(thumb("1", pageFrame(pages[0], 0), opts.jumpToStart, 0));
    if (current === 0) list.children[1]?.classList.add("is-current");
  };

  /** pos 文字目があるページ（0 はタイトルのページ） */
  const pageAt = (pos: number | null): number => {
    if (pos === null || pages.length < 2) return 0;
    let lo = 1;
    let hi = pages.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (pages[mid].start <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const markCurrent = (pos: number | null) => {
    caret = pos;
    const next = pageAt(pos);
    counter.textContent = pages.length ? `${next + 1} / ${pages.length}` : "";
    if (next === current) return;
    current = next;
    list.querySelector(".page-thumb.is-current")?.classList.remove("is-current");
    const item = list.querySelector<HTMLElement>(`.page-thumb[data-page="${next}"]`);
    item?.classList.add("is-current");
    // 見えていなければ、パネルの中だけをスクロールして見せる
    if (item) {
      const r = item.getBoundingClientRect();
      const box = list.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) list.scrollTop += r.top - box.top - box.height / 3;
    }
  };

  // あとから届いたフォントがあれば区切り直す
  const onFonts = () => {
    lastBody = null;
    schedule();
  };
  document.fonts?.addEventListener("loadingdone", onFonts);

  return {
    el,
    schedule,
    refreshTitle,
    markCurrent,
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      document.fonts?.removeEventListener("loadingdone", onFonts);
      paginator.destroy();
    },
  };
}
