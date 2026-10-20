// 読む画面の本体：文庫本サイズのページに区切って、1ページずつめくって読む
// 「読む」ページと、書く画面の「プレビュー」の両方で使う。
// ページの区切り方（createPaginator）は、書く画面の右のページ一覧でも使う。

import { escapeHtml, h } from "./dom";
import { tokenizeBody, type Paragraph, type Token } from "./ruby";
import { createZoomControl, getZoom, onZoomChange } from "./pageZoom";

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

/** paginate を途中でやめるときの印 */
const STOP = Symbol("stop");

/**
 * 本文をページごとの HTML に分ける。measure は実際のページと同じ大きさの入れ物。
 * raw は、書く画面の書く欄と同じ見えない欄と、その本文。ふりがなの書き方（|漢字《かんじ》）は書く欄では
 * そのまま見えて長くなるので、読む画面の見た目と書く欄の両方に入るところでページを区切る
 * （書く画面の紙が、ページからはみ出して伸びないように）。
 * stop を渡すと、2ページ目より後で「ここから始まるページ」が stop に合ったところでやめて、その位置を返す
 * （書く画面で、前に区切った結果と同じになるところから先は計算し直さないため）。
 */
function paginate(
  measure: HTMLElement,
  raw: { ta: HTMLTextAreaElement; text: string },
  paragraphs: Paragraph[],
  vertical: boolean,
  stop?: (start: number) => boolean,
): { pages: PageInfo[]; stoppedAt?: number } {
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
    if (!measure.firstChild) {
      pageStart = at;
      if (pages.length && stop?.(at)) throw STOP;
    }
    measure.append(p);
  };

  measure.replaceChildren();
  try {
    paginateInto(paragraphs);
  } catch (e) {
    if (e !== STOP) throw e;
    measure.replaceChildren();
    return { pages, stoppedAt: pageStart };
  }
  if (measure.firstChild) pushPage();
  if (pages.length === 0) pages.push({ html: "", start: 0 });
  return { pages };

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
        ...paginate(measureContent, { ta: rawTa, text: book.body }, tokenizeBody(book.body), book.vertical).pages,
      ];
    },
    /**
     * 本文の from 文字目（ページの始まり）から後ろだけを区切る（タイトルのページはなし）。
     * ページの区切り方は、そこから後ろの文章だけで決まるので、前のページは計算し直さなくていい。
     * stop（本文の中の位置で聞く）に合うページの始まりまで来たら、そこでやめて stoppedAt を返す。
     */
    paginateFrom(
      body: string,
      from: number,
      vertical: boolean,
      stop?: (start: number) => boolean,
    ): { pages: PageInfo[]; stoppedAt?: number } {
      measurer.classList.toggle("is-vertical", vertical);
      const text = body.slice(from);
      const res = paginate(
        measureContent,
        { ta: rawTa, text },
        tokenizeBody(text),
        vertical,
        stop && ((at) => stop(at + from)),
      );
      return {
        pages: res.pages.map((p) => ({ html: p.html, start: p.start + from })),
        stoppedAt: res.stoppedAt === undefined ? undefined : res.stoppedAt + from,
      };
    },
    destroy() {
      measurer.remove();
    },
  };
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

export function createReader(source: ReadableBook, opts: { onClose?: () => void } = {}): Reader {
  const book = { ...source };
  let pages: string[] = [];
  let index = 0;
  let destroyed = false;

  const content = h("div", { class: "page-content" });
  const page = h("div", { class: "page" }, content);
  const wrap = h("div", { class: "page-wrap" }, page);
  const stage = h("div", { class: "reader-stage" }, wrap);
  const counter = h("span", { class: "page-counter" });
  const leftBtn = h("button", { class: "btn page-btn", onclick: () => (book.vertical ? next() : prev()) }, "‹");
  const rightBtn = h("button", { class: "btn page-btn", onclick: () => (book.vertical ? prev() : next()) }, "›");

  // 区切りを計算する道具（見えないページ）
  const paginator = createPaginator();

  const el = h(
    "div",
    { class: "reader" },
    stage,
    h(
      "div",
      { class: "reader-controls" },
      leftBtn,
      counter,
      rightBtn,
      createZoomControl(),
      opts.onClose ? h("button", { class: "btn", onclick: () => opts.onClose!() }, "閉じる") : null,
    ),
  );

  const show = () => {
    index = Math.max(0, Math.min(index, pages.length - 1));
    content.innerHTML = pages[index] ?? "";
    content.classList.toggle("is-title", index === 0);
    counter.textContent = `${index + 1} / ${pages.length}`;
    const atStart = index === 0;
    const atEnd = index === pages.length - 1;
    leftBtn.disabled = book.vertical ? atEnd : atStart;
    rightBtn.disabled = book.vertical ? atStart : atEnd;
    leftBtn.title = book.vertical ? "次のページ" : "前のページ";
    rightBtn.title = book.vertical ? "前のページ" : "次のページ";
  };

  const next = () => {
    if (index < pages.length - 1) {
      index++;
      show();
    }
  };
  const prev = () => {
    if (index > 0) {
      index--;
      show();
    }
  };

  /** 画面に収まる大きさにページ全体を縮め、選んだ倍率をかける（中の文字の並びは変えない） */
  const fit = () => {
    const pw = page.offsetWidth;
    const ph = page.offsetHeight;
    if (!pw || !ph) return;
    const controls = el.querySelector<HTMLElement>(".reader-controls")?.offsetHeight ?? 60;
    const top = stage.getBoundingClientRect().top + window.scrollY;
    const availW = stage.clientWidth;
    const availH = window.innerHeight - top - controls - 40;
    const scale = Math.min(1, availW / pw, Math.max(availH, 240) / ph) * getZoom();
    page.style.transform = `scale(${scale})`;
    wrap.style.width = `${pw * scale}px`;
    wrap.style.height = `${ph * scale}px`;
  };

  const layout = () => {
    if (destroyed) return;
    const progress = pages.length > 1 ? index / (pages.length - 1) : 0;
    el.classList.toggle("is-vertical", book.vertical);
    pages = paginator.paginate(book).map((p) => p.html);
    index = pages.length > 1 && index > 0 ? Math.round(progress * (pages.length - 1)) : index;
    show();
    fit();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      book.vertical ? next() : prev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      book.vertical ? prev() : next();
    } else if (e.key === "PageDown" || e.key === " ") {
      e.preventDefault();
      next();
    } else if (e.key === "PageUp") {
      e.preventDefault();
      prev();
    } else if (e.key === "Escape" && opts.onClose) {
      opts.onClose();
    }
  };

  // ページの左右をクリックしてめくる
  page.addEventListener("click", (e) => {
    const r = page.getBoundingClientRect();
    const left = e.clientX < r.left + r.width / 2;
    if (left === book.vertical) next();
    else prev();
  });

  // スマホのスワイプ
  let touchX = 0;
  let touchY = 0;
  page.addEventListener(
    "touchstart",
    (e) => {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    },
    { passive: true },
  );
  page.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    e.preventDefault(); // クリック扱いにしない
    const swipeRight = dx > 0;
    if (swipeRight === book.vertical) next();
    else prev();
  });

  const onFontsDone = () => layout();
  // 拡大縮小したら、ページの見た目の大きさだけを変える
  const stopZoom = onZoomChange(fit);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", fit);

  content.innerHTML = '<p class="reader-loading">読み込み中…</p>';
  loadFonts(book.title + book.author + book.body).then(() => {
    layout();
    // あとから届いたフォントがあれば区切り直す
    document.fonts?.addEventListener("loadingdone", onFontsDone);
  });

  return {
    el,
    destroy() {
      destroyed = true;
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", fit);
      stopZoom();
      document.fonts?.removeEventListener("loadingdone", onFontsDone);
      paginator.destroy();
    },
  };
}
