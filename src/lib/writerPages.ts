// 書く画面の右のパネル：真ん中の紙と同じく「表紙 → タイトルのページ → 本文のページ」を、小さくして上から並べる
//   ページを押すと、真ん中のそのページへ飛ぶ。一番下の「＋ ページを足す」でページを足す（勝手には増えない）。
//   本文のページは、右上の × で消せて、ドラッグで順番を入れ替えられる（スマホは長押ししてから動かす）。
//   一番下に「いまのページ / 全部のページ」を出す。
//   ページの番号は、0 が表紙、1 がタイトルのページ、2 から本文。

import type { BookMeta } from "../store";
import { renderCover } from "./cover";
import { h } from "./dom";
import { pageHtml, titlePageHtml } from "./reader";

/** 指で長押ししたとみなすまで（ミリ秒） */
const LONG_PRESS = 350;
/** マウスで、これだけ動かしたらドラッグを始める（px） */
const DRAG_START = 6;

export interface PagesPanel {
  el: HTMLElement;
  /** 全部描き直す（ページを足した・消した・入れ替えたとき） */
  render(): void;
  /** 本文の i 枚目だけ描き直す（書いたとき） */
  updatePage(i: number): void;
  /** 表紙とタイトルのページを描き直す */
  refreshTitle(): void;
  /** いまのページを目立たせる（0：表紙、1：タイトル、2〜：本文） */
  markCurrent(index: number): void;
}

export function createPagesPanel(opts: {
  meta: () => BookMeta;
  title: () => { title: string; author: string };
  vertical: () => boolean;
  pageCount: () => number;
  pageText: (i: number) => string;
  jumpToPage: (index: number) => void;
  addPage: () => void;
  /** 本文の i 枚目を消す（確かめるのは呼ぶ側） */
  deletePage: (i: number) => void;
  movePage: (from: number, to: number) => void;
}): PagesPanel {
  let current = -1;

  const list = h("div", { class: "page-thumbs" });
  const addBtn = h(
    "button",
    { class: "page-add", type: "button", onclick: () => opts.addPage() },
    h("span", { class: "page-add-plus", "aria-hidden": "true" }, "＋"),
    "ページを足す",
  );
  const counter = h("div", { class: "page-count" });
  const el = h(
    "aside",
    { class: "writer-pages", "aria-label": "ページ" },
    h("div", { class: "page-thumbs-scroll" }, list, addBtn),
    counter,
  );

  /** 小さいページ1つ */
  const thumb = (index: number, label: string, frame: HTMLElement) => {
    const item = h(
      "div",
      {
        class: index === current ? "page-thumb is-current" : "page-thumb",
        role: "button",
        tabindex: 0,
        "data-page": index,
        title: index === 0 ? "表紙" : `${label}ページ`,
      },
      h("div", { class: "page-thumb-frame" }, frame),
      h("span", { class: "page-thumb-num" }, label),
    );
    item.addEventListener("click", () => {
      if (dragged) return; // ドラッグしたあとの「押した」は数えない
      opts.jumpToPage(index);
    });
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        opts.jumpToPage(index);
      }
    });
    return item;
  };

  const contentFrame = (html: string, isTitle = false) => {
    const content = h("div", { class: isTitle ? "page-content is-title" : "page-content" });
    content.innerHTML = html;
    return h("div", { class: "page" }, content);
  };

  const coverThumb = () => thumb(0, "表紙", renderCover(opts.meta()));
  const titleThumb = () =>
    thumb(1, "1", contentFrame(titlePageHtml({ ...opts.title(), body: "", vertical: opts.vertical() }), true));

  /** 本文の i 枚目（消すボタンつき・ドラッグで動かせる） */
  const bodyThumb = (i: number) => {
    const item = thumb(i + 2, String(i + 2), contentFrame(pageHtml(opts.pageText(i))));
    item.classList.add("is-body");
    item.dataset.bodyIndex = String(i);
    const del = h(
      "button",
      {
        class: "page-thumb-del",
        type: "button",
        title: "このページを消す",
        "aria-label": `${i + 2}ページを消す`,
        onclick: (e: Event) => {
          e.stopPropagation();
          opts.deletePage(i);
        },
      },
      "×",
    );
    del.hidden = opts.pageCount() <= 1; // 最後の1枚は消せない
    item.querySelector(".page-thumb-frame")!.append(del);
    enableDrag(item);
    return item;
  };

  const render = () => {
    list.classList.toggle("is-vertical", opts.vertical());
    const n = opts.pageCount();
    list.replaceChildren(coverThumb(), titleThumb(), ...Array.from({ length: n }, (_, i) => bodyThumb(i)));
    drawCounter();
  };

  const updatePage = (i: number) => {
    const old = list.querySelector(`.page-thumb[data-body-index="${i}"]`);
    old?.replaceWith(bodyThumb(i));
  };

  const refreshTitle = () => {
    list.children[0]?.replaceWith(coverThumb());
    list.children[1]?.replaceWith(titleThumb());
  };

  const drawCounter = () => {
    const total = opts.pageCount() + 1;
    counter.textContent = current <= 0 ? `表紙 / ${total}` : `${current} / ${total}`;
  };

  const markCurrent = (index: number) => {
    if (index === current) return drawCounter();
    current = index;
    drawCounter();
    list.querySelector(".page-thumb.is-current")?.classList.remove("is-current");
    const item = list.querySelector<HTMLElement>(`.page-thumb[data-page="${index}"]`);
    item?.classList.add("is-current");
    // 見えていなければ、パネルの中だけをスクロールして見せる
    const box = el.querySelector(".page-thumbs-scroll")!;
    if (item) {
      const r = item.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - b.height / 3;
    }
  };

  // ---- ドラッグで順番を入れ替える ----

  /** ドラッグし終わった直後か（そのあとの click を無視する） */
  let dragged = false;

  function enableDrag(item: HTMLElement) {
    let start: { x: number; y: number; id: number; touch: boolean } | null = null;
    let timer = 0;
    let dragging = false;

    const begin = () => {
      dragging = true;
      item.classList.add("is-dragging");
      list.classList.add("is-sorting");
      if (start) item.setPointerCapture(start.id);
    };

    const finish = () => {
      clearTimeout(timer);
      if (dragging) {
        dragging = false;
        item.classList.remove("is-dragging");
        list.classList.remove("is-sorting");
        const from = Number(item.dataset.bodyIndex);
        const to = [...list.querySelectorAll(".page-thumb.is-body")].indexOf(item);
        dragged = true;
        setTimeout(() => (dragged = false));
        if (to >= 0 && to !== from) opts.movePage(from, to);
        else render();
      }
      start = null;
    };

    item.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || (e.target as Element).closest(".page-thumb-del")) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType !== "mouse" };
      // 指のときは長押ししてから（ふつうに動かしたときは、パネルのスクロールにする）。
      // マウスのときは、すばやく動かしてページの外に出ても追えるように、すぐにつかまえておく
      if (start.touch) timer = window.setTimeout(begin, LONG_PRESS);
      else item.setPointerCapture(e.pointerId);
    });
    item.addEventListener("pointermove", (e) => {
      if (!start || e.pointerId !== start.id) return;
      if (!dragging) {
        const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
        if (start.touch) {
          if (moved > 10) clearTimeout(timer);
          return;
        }
        if (moved < DRAG_START) return;
        begin();
      }
      // 指の下のページの前か後ろへ、動かしているページを移す
      const others = [...list.querySelectorAll<HTMLElement>(".page-thumb.is-body")].filter((x) => x !== item);
      const before = others.find((x) => {
        const r = x.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      if (before) {
        if (item.nextElementSibling !== before) list.insertBefore(item, before);
      } else if (others.length && list.lastElementChild !== item) {
        list.append(item);
      }
    });
    item.addEventListener("pointerup", finish);
    item.addEventListener("pointercancel", finish);
    // 長押しで動かしているあいだは、画面がスクロールしないようにする
    item.addEventListener("touchmove", (e) => dragging && e.preventDefault(), { passive: false });
    item.addEventListener("contextmenu", (e) => start?.touch && e.preventDefault());
  }

  return { el, render, updatePage, refreshTitle, markCurrent };
}
