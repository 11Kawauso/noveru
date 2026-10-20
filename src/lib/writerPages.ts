// 書く画面の右のパネル：真ん中の紙と同じく「表紙 → タイトルのページ → 本文のページ」を、小さくして上から並べる
//   ページを押すと、真ん中のそのページへ飛ぶ。一番下に「いまのページ / 全部のページ」を出す。
//   ページの区切りは真ん中の紙（pagedEditor.ts）が決めて、ここへ渡してくれる。
//   ページの番号は、0 が表紙、1 がタイトルのページ、2 から本文。

import type { BookMeta } from "../store";
import { renderCover } from "./cover";
import { h } from "./dom";
import type { PageInfo } from "./reader";

export interface PagesPanel {
  el: HTMLElement;
  /** ページの区切りが変わったとき（from より前のページは変わっていないので描き直さない。from は読む画面の番号） */
  setPages(pages: PageInfo[], from: number, vertical: boolean): void;
  /** いまのページを目立たせる（0：表紙、1：タイトル、2〜：本文） */
  markCurrent(index: number): void;
}

export function createPagesPanel(opts: {
  meta: () => BookMeta;
  /** そのページへ飛ぶ */
  jumpToPage: (index: number) => void;
}): PagesPanel {
  let total = 0;
  let current = -1;

  const list = h("div", { class: "page-thumbs" });
  const counter = h("div", { class: "page-count" });
  const el = h("aside", { class: "writer-pages", "aria-label": "ページ" }, list, counter);

  const thumb = (index: number, label: string, frame: HTMLElement) =>
    h(
      "button",
      {
        class: index === current ? "page-thumb is-current" : "page-thumb",
        type: "button",
        "data-page": index,
        title: label,
        onclick: () => opts.jumpToPage(index),
      },
      h("div", { class: "page-thumb-frame" }, frame),
      h("span", { class: "page-thumb-num" }, label),
    );

  /** 読む画面の i ページ目（0 がタイトル）を小さくしたもの */
  const pageThumb = (p: PageInfo, i: number) => {
    const content = h("div", { class: i === 0 ? "page-content is-title" : "page-content" });
    content.innerHTML = p.html;
    return thumb(i + 1, String(i + 1), h("div", { class: "page" }, content));
  };

  /** 並べているページの中身（同じなら作り直さない） */
  let shown: string[] = [];

  const setPages = (pages: PageInfo[], from: number, vertical: boolean) => {
    list.classList.toggle("is-vertical", vertical);
    total = pages.length;
    if (from === 0 || !list.firstElementChild) {
      list.firstElementChild?.remove();
      list.prepend(thumb(0, "表紙", renderCover(opts.meta())));
    }
    // 表紙のぶん、一覧の中では1つずれる。中身が変わったページだけ作り直す（まだ並べていないページからは必ず並べる）
    for (let i = Math.min(from, list.children.length - 1); i < pages.length; i++) {
      const old = list.children[i + 1];
      if (old && shown[i] === pages[i].html) continue;
      const next = pageThumb(pages[i], i);
      if (old) old.replaceWith(next);
      else list.append(next);
    }
    while (list.children.length > pages.length + 1) list.lastElementChild!.remove();
    shown = pages.map((p) => p.html);
    drawCounter();
  };

  const drawCounter = () => {
    counter.textContent = current <= 0 ? `表紙 / ${total}` : `${current} / ${total}`;
  };

  const markCurrent = (index: number) => {
    if (index === current) return;
    current = index;
    drawCounter();
    list.querySelector(".page-thumb.is-current")?.classList.remove("is-current");
    const item = list.querySelector<HTMLElement>(`.page-thumb[data-page="${index}"]`);
    item?.classList.add("is-current");
    // 見えていなければ、パネルの中だけをスクロールして見せる
    if (item) {
      const r = item.getBoundingClientRect();
      const box = list.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) list.scrollTop += r.top - box.top - box.height / 3;
    }
  };

  return { el, setPages, markCurrent };
}
