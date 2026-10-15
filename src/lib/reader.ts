// 読む画面の本体：文庫本サイズのページに区切って、1ページずつめくって読む
// 「読む」ページと、書く画面の「プレビュー」の両方で使う。

import { escapeHtml, h } from "./dom";
import { tokenizeBody, type Token } from "./ruby";

export interface ReadableBook {
  title: string;
  author: string;
  body: string;
  vertical: boolean;
}

// ページの先頭に来てはいけない文字（句読点や閉じかっこ）
const NO_LINE_START = new Set(Array.from("、。，．,.・：；？！?!ー）」』】〕〉》”’)]}ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々…‥"));

const FONT_TIMEOUT = 4000;

/** 本文に使われている文字のフォントを先に読み込む（ページ区切りがずれないように） */
async function loadFonts(text: string) {
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

/** 本文をページごとの HTML に分ける。measure は実際のページと同じ大きさの入れ物 */
function paginate(measure: HTMLElement, paragraphs: Token[][], vertical: boolean): string[] {
  const pages: string[] = [];
  const fits = () =>
    vertical
      ? measure.scrollWidth <= measure.clientWidth + 1
      : measure.scrollHeight <= measure.clientHeight + 1;
  const pushPage = () => {
    pages.push(measure.innerHTML);
    measure.replaceChildren();
  };

  measure.replaceChildren();
  for (const tokens of paragraphs) {
    if (tokens.length === 0) {
      // 空行。ページの先頭に来る空行は省く
      if (!measure.firstChild) continue;
      const p = document.createElement("p");
      p.innerHTML = "<br>";
      measure.append(p);
      if (!fits()) {
        p.remove();
        pushPage();
      }
      continue;
    }

    let start = 0;
    while (start < tokens.length) {
      const p = document.createElement("p");
      measure.append(p);
      p.innerHTML = joinTokens(tokens, start, tokens.length);
      if (fits()) break;

      // このページに入るぎりぎりの文字数を探す
      let lo = 0;
      let hi = tokens.length - start - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        p.innerHTML = joinTokens(tokens, start, start + mid);
        if (fits()) lo = mid;
        else hi = mid - 1;
      }
      // 句読点などが次のページの先頭に来ないようにする
      while (lo > 1 && NO_LINE_START.has(tokens[start + lo]?.ch ?? "")) lo--;

      if (lo === 0) {
        if (measure.childElementCount > 1) {
          p.remove();
          pushPage();
          continue;
        }
        lo = 1; // 1文字も入らないときでも先に進む
      }
      p.innerHTML = joinTokens(tokens, start, start + lo);
      pushPage();
      start += lo;
    }
  }
  if (measure.firstChild) pushPage();
  if (pages.length === 0) pages.push("");
  return pages;
}

function titlePageHtml(book: ReadableBook): string {
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
  const dirBtn = h("button", { class: "btn btn-ghost", onclick: () => switchDirection() });

  // 区切りを計算するための見えないページ
  const measureContent = h("div", { class: "page-content" });
  const measurer = h("div", { class: "reader measuring" }, h("div", { class: "page" }, measureContent));

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
      dirBtn,
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

  /** 画面に収まるようにページ全体を縮める（中の文字の並びは変えない） */
  const fit = () => {
    const pw = page.offsetWidth;
    const ph = page.offsetHeight;
    if (!pw || !ph) return;
    const controls = el.querySelector<HTMLElement>(".reader-controls")?.offsetHeight ?? 60;
    const top = stage.getBoundingClientRect().top + window.scrollY;
    const availW = stage.clientWidth;
    const availH = window.innerHeight - top - controls - 40;
    const scale = Math.min(1, availW / pw, Math.max(availH, 240) / ph);
    page.style.transform = `scale(${scale})`;
    wrap.style.width = `${pw * scale}px`;
    wrap.style.height = `${ph * scale}px`;
  };

  const layout = () => {
    if (destroyed) return;
    const progress = pages.length > 1 ? index / (pages.length - 1) : 0;
    el.classList.toggle("is-vertical", book.vertical);
    measurer.classList.toggle("is-vertical", book.vertical);
    dirBtn.textContent = book.vertical ? "横書きで読む" : "縦書きで読む";
    pages = [titlePageHtml(book), ...paginate(measureContent, tokenizeBody(book.body), book.vertical)];
    index = pages.length > 1 && index > 0 ? Math.round(progress * (pages.length - 1)) : index;
    show();
    fit();
  };

  const switchDirection = () => {
    book.vertical = !book.vertical;
    layout();
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
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", fit);

  document.body.append(measurer);
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
      document.fonts?.removeEventListener("loadingdone", onFontsDone);
      measurer.remove();
    },
  };
}
