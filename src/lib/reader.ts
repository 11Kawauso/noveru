// 読む画面の本体：文庫本サイズのページを並べて、スクロールして読む（createReader）
// 「読む」ページと、書く画面の「プレビュー」の両方で使う。
// ページは作者が書く画面で足したとおり（本文の中の区切りの印 PAGE_BREAK で分ける）。長いページは中でスクロールする。
// 区切りの印がない本文（ページを自分で足す前に保存した作品）は、文庫本の大きさで自動で区切る（createPaginator）。

import { escapeHtml, h } from "./dom";
import { PAGE_BREAK, tokenizeBody, type Paragraph, type Token } from "./ruby";
import { createZoomControl, enableGestureZoom, getZoom, onZoomChange } from "./pageZoom";
import { createScrollbar } from "./scrollbar";

export interface ReadableBook {
  title: string;
  author: string;
  body: string;
  vertical: boolean;
}

// ページの先頭に来てはいけない文字（句読点や閉じかっこ）
const NO_LINE_START = new Set(
  Array.from("、。，．,.・：；？！?!ー）」』】〕〉》”’)]}ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々…‥"),
);
// ページの最後に来てはいけない文字（開きかっこ）
const NO_LINE_END = new Set(Array.from("「『（【〔〈《“‘([{"));

const FONT_TIMEOUT = 4000;

/** 本文に使われている文字のフォントを先に読み込む（ページ区切りがずれないように） */
export async function loadFonts(text: string) {
  if (!document.fonts) return;
  const chars = Array.from(new Set(Array.from(text))).join("");
  const loads = Promise.all([
    document.fonts.load(`400 16px "Noto Serif JP"`, chars),
    document.fonts.load(`600 16px "Noto Serif JP"`, chars.slice(0, 200)),
  ]).catch(() => {});
  await Promise.race([loads, new Promise((r) => setTimeout(r, FONT_TIMEOUT))]);
}

function joinTokens(tokens: Token[], from: number, to: number): string {
  let s = "";
  for (let i = from; i < to; i++) s += tokens[i].html;
  return s;
}

/** 1ページ分 */
export interface PageInfo {
  html: string;
  /** このページが本文の何文字目から始まるか */
  start: number;
}

/**
 * 本文をページごとの HTML に分ける。measure は実際のページと同じ大きさの入れ物。
 * raw は、書く画面の書く欄と同じ見えない欄と、その本文。ふりがなの書き方（|漢字《かんじ》）は書く欄では
 * そのまま見えて長くなるので、読む画面の見た目と書く欄の両方に入るところでページを区切る
 * （書く画面の紙が、ページからはみ出して伸びないように）。
 */
function paginate(
  measure: HTMLElement,
  raw: { ta: HTMLTextAreaElement; text: string },
  paragraphs: Paragraph[],
  vertical: boolean,
): PageInfo[] {
  const pages: PageInfo[] = [];
  let pageStart = 0;
  const overflows = (el: HTMLElement) =>
    vertical ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1;
  /** いまのページの中身（本文の pageStart〜end）が、読む画面でも書く欄でも1ページに入るか */
  const fits = (end: number) => {
    if (overflows(measure)) return false;
    raw.ta.value = raw.text.slice(pageStart, end);
    return !overflows(raw.ta);
  };
  /** 段落の tokens[0]〜tokens[i - 1] が本文のどこで終わるか */
  const endOf = (para: Paragraph, i: number) => para.offsets[i - 1] + para.tokens[i - 1].len;
  const pushPage = () => {
    pages.push({ html: measure.innerHTML, start: pageStart });
    measure.replaceChildren();
  };
  /** 段落をページに足す（ページの最初のものなら、そこをページの始まりにする） */
  const add = (p: HTMLElement, at: number) => {
    if (!measure.firstChild) pageStart = at;
    measure.append(p);
  };

  measure.replaceChildren();
  paginateInto(paragraphs);
  if (measure.firstChild) pushPage();
  if (pages.length === 0) pages.push({ html: "", start: 0 });
  return pages;

  function paginateInto(paragraphs: Paragraph[]) {
    for (const para of paragraphs) {
      const { tokens } = para;
      if (tokens.length === 0) {
        // 空行も1行分の場所をとる。入らなければ次のページの先頭へ
        // （省くと、書く画面で改行を続けたときに次のページへ送られず、紙が伸び続けてしまう）
        const p = document.createElement("p");
        p.innerHTML = "<br>";
        add(p, para.start);
        if (!fits(para.start) && measure.childElementCount > 1) {
          p.remove();
          pushPage();
          add(p, para.start);
        }
        continue;
      }

      if (para.heading) {
        // 見出しは分けない。章は新しいページから始める
        if (para.heading === 1 && measure.firstChild) pushPage();
        const p = document.createElement("p");
        p.className = `heading heading-${para.heading}`;
        p.innerHTML = joinTokens(tokens, 0, tokens.length);
        add(p, para.start);
        if (!fits(endOf(para, tokens.length)) && measure.childElementCount > 1) {
          p.remove();
          pushPage();
          add(p, para.start);
        }
        continue;
      }

      let start = 0;
      while (start < tokens.length) {
        const p = document.createElement("p");
        add(p, para.offsets[start]);
        p.innerHTML = joinTokens(tokens, start, tokens.length);
        if (fits(endOf(para, tokens.length))) break;

        // このページに入るぎりぎりの文字数を探す
        let lo = 0;
        let hi = tokens.length - start - 1;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          p.innerHTML = joinTokens(tokens, start, start + mid);
          if (fits(endOf(para, start + mid))) lo = mid;
          else hi = mid - 1;
        }
        // 句読点などが次のページの先頭に、開きかっこがこのページの最後に来ないようにする
        while (
          lo > 1 &&
          (NO_LINE_START.has(tokens[start + lo]?.ch ?? "") || NO_LINE_END.has(tokens[start + lo - 1]?.ch ?? ""))
        ) {
          lo--;
        }

        if (lo === 0) {
          if (measure.childElementCount > 1) {
            p.remove();
            pushPage();
            continue;
          }
          lo = 1; // 1文字も入らないときでも先に進む
        }
        p.innerHTML = joinTokens(tokens, start, start + lo);
        // 段落の途中でページが変わるので、このページの最後の行も行末までそろえる
        p.className = "split";
        pushPage();
        start += lo;
      }
    }
  }
}

/**
 * ページの区切りを計算する道具（画面の外に、実際のページと同じ大きさの見えないページを置いて測る）。
 * 1ページ目はタイトルと作者のページ。使い終わったら destroy() を呼ぶ。
 */
export function createPaginator() {
  const measureContent = h("div", { class: "page-content" });
  // 書く画面の書く欄と同じ欄（ふりがなの書き方をそのまま入れて、1ページに入るかを測る）
  const rawTa = h("textarea", { class: "w-body", tabindex: -1, "aria-hidden": "true" });
  const measurer = h(
    "div",
    { class: "reader measuring" },
    h("div", { class: "page" }, measureContent),
    h("div", { class: "page" }, h("div", { class: "page-content" }, rawTa)),
  );
  document.body.append(measurer);
  return {
    paginate(book: ReadableBook): PageInfo[] {
      measurer.classList.toggle("is-vertical", book.vertical);
      return [
        { html: titlePageHtml(book), start: 0 },
        ...paginate(measureContent, { ta: rawTa, text: book.body }, tokenizeBody(book.body), book.vertical),
      ];
    },
    destroy() {
      measurer.remove();
    },
  };
}

/** 作者が足した1ページ分の本文を、読む画面の HTML にする（ページからはみ出すときは、ページの中でスクロールする） */
export function pageHtml(text: string): string {
  return tokenizeBody(text)
    .map((para) => {
      if (para.tokens.length === 0) return "<p><br></p>";
      const html = joinTokens(para.tokens, 0, para.tokens.length);
      return para.heading ? `<p class="heading heading-${para.heading}">${html}</p>` : `<p>${html}</p>`;
    })
    .join("");
}

/**
 * 読む画面に出すページ（0 がタイトルのページ）。
 * 作者が自分でページを足した本文は、そのページのまま。ページの区切りの印がない本文
 * （ページを自分で足す前に保存した作品）は、文庫本の大きさで自動で区切る。
 */
export function bookPages(book: ReadableBook, paginator: ReturnType<typeof createPaginator>): string[] {
  if (!book.body.includes(PAGE_BREAK)) return paginator.paginate(book).map((p) => p.html);
  return [titlePageHtml(book), ...book.body.split(PAGE_BREAK).map(pageHtml)];
}

export function titlePageHtml(book: ReadableBook): string {
  const title = escapeHtml(book.title.trim() || "無題");
  const author = escapeHtml(book.author.trim());
  return `<div class="title-page"><h1 class="title-page-title">${title}</h1>${
    author ? `<p class="title-page-author">${author}</p>` : ""
  }</div>`;
}

export interface Reader {
  el: HTMLElement;
  destroy(): void;
}

export interface ReaderOptions {
  /** 左上に置く「戻る」（プレビューなら「閉じる」） */
  back?: HTMLElement | null;
  /** 表紙（なければ表紙のページは出さない） */
  cover?: HTMLElement | null;
  /** 左のパネルの、タイトルと作者の下に入れるもの（いいね・タグ・あらすじなど） */
  extra?: (Node | null | undefined | false)[];
  /** Esc で閉じるとき（プレビュー） */
  onClose?: () => void;
}

/**
 * 読む画面：ページを並べて、スクロールして読む。
 *   横書きの本はページを上から下へ並べて、縦にスクロールする（スクロールバーとページ数は右）。
 *   縦書きの本はページを右から左へ並べて、横にスクロールする（スクロールバーとページ数は下）。
 *   左のパネルには、戻る・タイトルと作者・いいねなど・見出しの一覧（押すとそこへ飛ぶ）。
 *   長いページは、そのぶんページが伸びる。
 *   画面の全体をおおう（position: fixed）。「読む」ページと、書く画面の「プレビュー」の両方で使う。
 */
export function createReader(source: ReadableBook, opts: ReaderOptions = {}): Reader {
  const book = { ...source };
  let destroyed = false;
  let current = -1;
  let total = 0;

  const stack = h("div", { class: "page-stack reader-stack" });
  const scroller = h("div", { class: "reader-scroll" }, stack);
  const counter = h("span", { class: "reader-count" });
  const scrollbar = createScrollbar(scroller, { label: () => counter.textContent ?? "" });
  const outline = h("ol", { class: "outline-list" });
  const outlineBox = h(
    "div",
    { class: "reader-outline", hidden: true },
    h("div", { class: "outline-head" }, h("span", { class: "outline-label" }, "目次")),
    outline,
  );
  const menuBtn = h("button", { class: "reader-menu-btn", type: "button", "aria-expanded": "false" }, "目次など");
  const sideBody = h(
    "div",
    { class: "reader-side-body" },
    h(
      "div",
      { class: "reader-book" },
      h("h1", { class: "reader-title" }, book.title.trim() || "無題"),
      book.author.trim() ? h("p", { class: "reader-author" }, book.author.trim()) : null,
    ),
    ...(opts.extra ?? []).filter((x): x is Node => !!x),
    outlineBox,
  );
  const side = h(
    "aside",
    { class: "reader-side", "aria-label": "目次など" },
    h("div", { class: "reader-side-head" }, opts.back ?? null, menuBtn),
    sideBody,
  );
  const el = h(
    "div",
    { class: "book-reader" },
    side,
    h(
      "div",
      { class: "reader-main" },
      scroller,
      scrollbar.el,
      h("div", { class: "reader-status" }, counter, createZoomControl()),
    ),
  );

  // スマホでは、左のパネルは上の1列になり、「目次など」で中身を出し入れする
  const setMenu = (open: boolean) => {
    side.classList.toggle("is-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
  };
  menuBtn.addEventListener("click", () => setMenu(!side.classList.contains("is-open")));

  // ---- ページ ----

  const wraps = (): HTMLElement[] => [...stack.querySelectorAll<HTMLElement>(".wsheet-wrap")];

  const layout = () => {
    if (destroyed) return;
    el.classList.toggle("is-vertical", book.vertical);
    stack.classList.toggle("is-vertical", book.vertical);
    scroller.classList.toggle("is-vertical", book.vertical);
    scrollbar.setAxis(book.vertical ? "x" : "y");
    const pages = bookPages(book, paginator);
    total = pages.length;
    stack.replaceChildren(
      ...(opts.cover
        ? [h("div", { class: "wsheet-wrap", "data-index": 0 }, h("div", { class: "wsheet wsheet-cover" }, opts.cover))]
        : []),
      ...pages.map((html, i) => {
        const content = h("div", { class: i === 0 ? "page-content is-title" : "page-content" });
        content.innerHTML = html;
        return h(
          "div",
          { class: "wsheet-wrap", "data-index": i + 1 },
          h("div", { class: i === 0 ? "wsheet wsheet-title" : "wsheet reader-sheet" }, content),
          h("span", { class: "wsheet-num" }, String(i + 1)),
        );
      }),
    );
    drawOutline();
    fit();
    current = -1;
    onScroll();
  };

  /** 見出しの一覧（押すと、その見出しへ飛ぶ） */
  const headings = (): HTMLElement[] => [...stack.querySelectorAll<HTMLElement>("p.heading")];
  const drawOutline = () => {
    const list = headings();
    outlineBox.hidden = list.length === 0;
    outline.replaceChildren(
      ...list.map((p, i) => {
        const copy = p.cloneNode(true) as HTMLElement;
        copy.querySelectorAll("rt").forEach((rt) => rt.remove());
        return h(
          "li",
          { class: `outline-item level-${p.classList.contains("heading-2") ? 2 : 1}` },
          h(
            "button",
            {
              type: "button",
              onclick: () => {
                setMenu(false);
                showAt(headings()[i]);
              },
            },
            copy.textContent ?? "",
          ),
        );
      }),
    );
  };

  /** その要素が見えるようにスクロールする（横書きは上の端、縦書きは右の端に合わせる） */
  const showAt = (target: Element, smooth = true) => {
    const r = target.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const behavior = smooth ? "smooth" : "instant";
    if (book.vertical) scroller.scrollBy({ left: r.right - (box.right - 32), behavior });
    else scroller.scrollBy({ top: r.top - box.top - 24, behavior });
  };

  /** スクロールしたとき：画面の真ん中あたりにあるページと見出しを、いまの場所にする */
  const onScroll = () => {
    const box = scroller.getBoundingClientRect();
    const line = book.vertical ? box.right - box.width * 0.4 : box.top + box.height * 0.4;
    const started = (e: Element) => {
      const r = e.getBoundingClientRect();
      return book.vertical ? r.right >= line : r.top <= line;
    };
    const list = wraps();
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (started(list[mid])) lo = mid;
      else hi = mid - 1;
    }
    const index = Number(list[lo]?.dataset.index ?? 0);
    if (index !== current) {
      current = index;
      counter.textContent = index === 0 ? `表紙 / ${total}` : `${index} / ${total}`;
    }
    let head = -1;
    headings().forEach((p, i) => started(p) && (head = i));
    outline.querySelectorAll(".outline-item").forEach((li, i) => li.classList.toggle("is-current", i === head));
  };
  let frame = 0;
  const onScrollThrottled = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(onScroll);
  };
  scroller.addEventListener("scroll", onScrollThrottled, { passive: true });

  /** 画面に入る大きさにページを縮めて、選んだ倍率をかける（縦書きは高さも入るように） */
  const fit = () => {
    const root = getComputedStyle(document.documentElement);
    const pageW = parseFloat(root.getPropertyValue("--page-w")) || 440;
    const pageH = parseFloat(root.getPropertyValue("--page-h")) || 624;
    const roomW = scroller.clientWidth - 32;
    const roomH = scroller.clientHeight - 150;
    let scale = roomW > 0 ? Math.min(1, roomW / pageW) : 1;
    if (book.vertical && roomH > 0) scale = Math.min(scale, roomH / pageH);
    stack.style.zoom = String(scale * getZoom());
  };

  // 縦書きはページが横に並ぶので、マウスのホイール（上下）で左右に動く（下に回すと先＝左へ）
  scroller.addEventListener(
    "wheel",
    (e) => {
      if (!book.vertical || e.shiftKey || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      scroller.scrollBy({ left: -e.deltaY });
    },
    { passive: false },
  );

  // キーで読み進める（横書きは ↓・縦書きは ← が先。スペース・PageDown も先へ）
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === "Escape" && opts.onClose) return opts.onClose();
    const forward = book.vertical ? ["ArrowLeft", "PageDown", " "] : ["ArrowDown", "PageDown", " "];
    const backward = book.vertical ? ["ArrowRight", "PageUp"] : ["ArrowUp", "PageUp"];
    const dir = forward.includes(e.key) ? 1 : backward.includes(e.key) ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const step = (book.vertical ? scroller.clientWidth : scroller.clientHeight) * (e.key.startsWith("Arrow") ? 0.3 : 0.85);
    if (book.vertical) scroller.scrollBy({ left: -dir * step, behavior: "smooth" });
    else scroller.scrollBy({ top: dir * step, behavior: "smooth" });
  };
  document.addEventListener("keydown", onKey);

  const onResize = () => fit();
  window.addEventListener("resize", onResize);
  const stopZoom = onZoomChange(fit);
  // ページの上での指のピンチ・Ctrl ＋ ホイールでも拡大縮小できる
  const stopGestureZoom = enableGestureZoom(scroller, stack);

  // 区切りを計算する道具（ページを自分で足す前に保存した作品だけ使う）
  const paginator = createPaginator();
  const onFontsDone = () => layout();
  stack.append(h("p", { class: "reader-loading" }, "読み込み中…"));
  loadFonts(book.title + book.author + book.body).then(() => {
    // 表紙（なければタイトルのページ）から読み始める
    layout();
    // あとから届いたフォントがあれば区切り直す
    document.fonts?.addEventListener("loadingdone", onFontsDone);
  });

  return {
    el,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      stopZoom();
      stopGestureZoom();
      scrollbar.destroy();
      document.fonts?.removeEventListener("loadingdone", onFontsDone);
      paginator.destroy();
    },
  };
}
