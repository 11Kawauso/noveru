// 書く画面の真ん中：上から「表紙 → タイトルと作者のページ → 本文のページ」の順に紙を縦に並べる
//
//   本文のページは、作者が自分で足す（右のページのパネルの「＋ ページを足す」）。勝手には増えない。
//   1ページにはいくらでも書けて、書いた分だけ紙が伸びる（読む画面では、そのページの中でスクロールする）。
//   消す・順番を入れ替えるのも、右のパネルから。
//   本文は、ページのあいだに PAGE_BREAK（目に見えない区切りの印）をはさんだ1つの文字列として保存する。
//
//   ページの番号は、0 が表紙、1 がタイトルのページ、2 から本文（右のページの一覧と同じ）。

import type { BookMeta } from "../store";
import { caretRect } from "./caret";
import { renderCover } from "./cover";
import { h } from "./dom";
import { createPaginator, loadFonts } from "./reader";
import { PAGE_BREAK } from "./ruby";

/** 本文の1ページ分の書く欄 */
interface BodyPage {
  wrap: HTMLElement;
  ta: HTMLTextAreaElement;
  num: HTMLElement;
}

export interface PagedEditor {
  /** 縦に並んだページ */
  el: HTMLElement;
  /** 本文（ページのあいだに PAGE_BREAK が入る） */
  getBody(): string;
  /**
   * 本文を入れて、ページを作る。区切りの印がない本文（ページを自分で足す前に保存した作品）は、
   * 読む画面と同じ文庫本の大きさで区切ってページにする
   */
  load(body: string, vertical: boolean): Promise<void>;
  /** カーソルの位置（本文の何文字目か）。本文の欄にいないときは null */
  caret(): number | null;
  /** 本文の from〜to（同じページの中）を text に置き換えて、カーソルを caretAt に置く（Ctrl + Z で戻せる） */
  replace(from: number, to: number, text: string, caretAt: number): void;
  /** 本文の欄で選んでいる文字を、wrap(選んだ文字) に置き換える。選んでいなければ false */
  wrapSelection(wrap: (selected: string) => string | null): boolean;
  /** 本文の欄で選んでいる文字（選んでいなければ ""） */
  selectedText(): string;
  /** いまのカーソルと選んでいる所を覚えておく。返した関数を呼ぶと、そこへ戻る（小窓を閉じたあとなどに） */
  rememberSelection(): () => void;
  /** 本文の pos 文字目へ飛んで、そこにカーソルを置く */
  jumpTo(pos: number): void;
  /** そのページへ飛ぶ（0：表紙、1：タイトル、2〜：本文） */
  jumpToPage(index: number): void;
  /** 本文のページを1枚足す（at の前に。省くと最後に） */
  addPage(at?: number): void;
  /** 本文の i 枚目（0 から）を消す */
  deletePage(i: number): void;
  /** 本文の from 枚目を to 枚目へ動かす */
  movePage(from: number, to: number): void;
  pageCount(): number;
  pageText(i: number): string;
  /** タイトル・作者・表紙が変わったとき */
  refreshTitle(): void;
  /** 拡大縮小（紙をまるごと大きく／小さくする） */
  setZoom(zoom: number): void;
  destroy(): void;
}

export function createPagedEditor(opts: {
  /** スクロールする入れ物（el はこの中に置く） */
  scroller: HTMLElement;
  title: () => { title: string; author: string };
  meta: () => BookMeta;
  /** 本文が変わったとき。page は書き換えたページ（本文の何枚目か。ページを足したり消したりしたときは null） */
  onChange: (page: number | null) => void;
  /** いま見ている（書いている）ページが変わったとき。caret は本文の欄にいないとき null */
  onCurrent: (index: number, caret: number | null) => void;
  /** タイトルのページで、タイトルか作者を書き換えたとき */
  onTitleInput: (value: { title: string; author: string }) => void;
}): PagedEditor {
  const { scroller } = opts;
  let vertical = false;
  let pages: BodyPage[] = [];
  let destroyed = false;
  let current = -1;

  const coverWrap = h("div", { class: "wsheet-wrap", "data-index": 0 });

  // タイトルのページ：読む画面と同じ見た目のまま、タイトルと作者をここでも書ける（左のパネルの欄と同じ中身）
  const titleInput = h("textarea", {
    class: "title-edit title-page-title",
    rows: 1,
    maxlength: 100,
    placeholder: "タイトル",
    spellcheck: false,
    "aria-label": "タイトル",
  });
  const authorInput = h("textarea", {
    class: "title-edit title-page-author",
    rows: 1,
    maxlength: 60,
    placeholder: "作者",
    spellcheck: false,
    "aria-label": "作者",
  });
  /** 書いた分だけ欄を伸ばす（横書きは下へ、縦書きは左へ） */
  const growTitle = () => {
    for (const ta of [titleInput, authorInput]) {
      if (vertical) {
        ta.style.height = "";
        ta.style.width = "0px";
        ta.style.width = `${ta.scrollWidth}px`;
      } else {
        ta.style.width = "";
        ta.style.height = "0px";
        ta.style.height = `${ta.scrollHeight}px`;
      }
    }
  };
  for (const ta of [titleInput, authorInput]) {
    ta.addEventListener("input", () => {
      // 1行の欄なので、改行は入れない（貼り付けたときなど）
      if (/[\r\n]/.test(ta.value)) ta.value = ta.value.replace(/[\r\n]+/g, " ");
      growTitle();
      opts.onTitleInput({ title: titleInput.value, author: authorInput.value });
    });
    ta.addEventListener("focus", () => setCurrent(1));
  }
  // タイトルで Enter を押したら作者へ、作者で Enter を押したら本文の最初へ
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      authorInput.focus();
    }
  });
  authorInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      if (pages[0]) placeCaret(0, 0, "ifNeeded");
    }
  });
  const titleWrap = h(
    "div",
    { class: "wsheet-wrap", "data-index": 1 },
    h(
      "div",
      { class: "wsheet wsheet-title" },
      h("div", { class: "page-content is-title" }, h("div", { class: "title-page" }, titleInput, authorInput)),
    ),
    h("span", { class: "wsheet-num" }, "1"),
  );
  const el = h("div", { class: "page-stack" }, coverWrap, titleWrap);

  const getBody = () => pages.map((p) => p.ta.value).join(PAGE_BREAK);

  /** 本文の i 枚目が、本文の何文字目から始まるか */
  const startOf = (i: number) => {
    let n = 0;
    for (let j = 0; j < i; j++) n += pages[j].ta.value.length + PAGE_BREAK.length;
    return n;
  };

  /** 本文の pos 文字目があるページと、そのページの中での位置 */
  const locate = (pos: number): { i: number; local: number } => {
    let start = 0;
    for (let i = 0; i < pages.length; i++) {
      const len = pages[i].ta.value.length;
      if (pos <= start + len || i === pages.length - 1) return { i, local: Math.max(0, Math.min(pos - start, len)) };
      start += len + PAGE_BREAK.length;
    }
    return { i: 0, local: 0 };
  };

  const focusedPage = (): BodyPage | undefined => pages.find((p) => p.ta === document.activeElement);

  const caret = (): number | null => {
    const p = focusedPage();
    return p ? startOf(pages.indexOf(p)) + p.ta.selectionStart : null;
  };

  /**
   * 書く欄の大きさを中身に合わせる（書いた分だけ伸びる。ふだんはページの大きさ）。
   * たくさんのページをまとめて測るときも、画面の計算が1回ですむように、縮める→測る→合わせる の順にまとめてやる
   */
  const grow = (list: BodyPage[]) => {
    const size = vertical ? "width" : "height";
    for (const p of list) {
      p.ta.style[vertical ? "height" : "width"] = "";
      p.ta.style[size] = "0px";
    }
    const sizes = list.map((p) => (vertical ? p.ta.scrollWidth : p.ta.scrollHeight));
    list.forEach((p, i) => (p.ta.style[size] = `${sizes[i]}px`));
  };

  /**
   * こちらでスクロールするときに呼ぶ。少しのあいだは、スクロールしても「いまのページ」を変えない
   * （カーソルのあるページや、押したページのままにする）
   */
  let autoScrollUntil = 0;
  const autoScroll = () => (autoScrollUntil = performance.now() + 250);

  /**
   * カーソルの行が見えるようにスクロールする（force なら、見えていても画面の上から3割の所へ。
   * 縦書きは紙が右から左へ並ぶので、右から3割の所へ）
   */
  const showCaret = (p: BodyPage, force: boolean) => {
    const r = caretRect(p.ta, p.ta.selectionStart);
    const box = scroller.getBoundingClientRect();
    const margin = 40;
    if (vertical) {
      if (force || r.left < box.left + margin || r.right > box.right - margin) {
        autoScroll();
        scroller.scrollBy({ left: r.right - (box.right - box.width * 0.3) });
      }
      if (r.top < box.top || r.bottom > box.bottom) {
        autoScroll();
        scroller.scrollBy({ top: r.top - (box.top + box.height / 2) });
      }
      return;
    }
    if (force || r.top < box.top + margin || r.bottom > box.bottom - margin) {
      autoScroll();
      scroller.scrollBy({ top: r.top - (box.top + box.height * 0.3) });
    }
    if (r.left < box.left || r.right > box.right) {
      autoScroll();
      scroller.scrollBy({ left: r.left - (box.left + box.width / 2) });
    }
  };

  /** 本文の i 枚目の local 文字目にカーソルを置く */
  const placeCaret = (i: number, local: number, scroll: "none" | "ifNeeded" | "force") => {
    const p = pages[i];
    if (!p) return;
    p.ta.focus({ preventScroll: true });
    p.ta.setSelectionRange(local, local);
    if (scroll !== "none") showCaret(p, scroll === "force");
    setCurrent(i + 2);
  };

  // ---- ページを作る ----

  const makePage = (text: string): BodyPage => {
    const ta = h("textarea", { class: "w-body", spellcheck: false, "aria-label": "本文" });
    ta.value = text;
    const num = h("span", { class: "wsheet-num" });
    const wrap = h("div", { class: "wsheet-wrap" }, h("div", { class: "wsheet wsheet-body" }, ta), num);
    const page: BodyPage = { wrap, ta, num };
    ta.addEventListener("input", () => {
      // 区切りの印は書く欄には入れない（貼り付けで入ってきたときなど）
      if (ta.value.includes(PAGE_BREAK)) ta.value = ta.value.split(PAGE_BREAK).join("\n");
      grow([page]);
      opts.onChange(pages.indexOf(page));
      opts.onCurrent(pages.indexOf(page) + 2, caret());
    });
    ta.addEventListener("keydown", (e) => onKey(e, page));
    ta.addEventListener("focus", () => setCurrent(pages.indexOf(page) + 2));
    return page;
  };

  /** ページの並びに合わせて、画面の並び・番号・書き出しの案内を直す */
  const arrange = () => {
    pages.forEach((p, i) => {
      el.append(p.wrap);
      p.wrap.dataset.index = String(i + 2);
      p.num.textContent = String(i + 2);
      p.ta.placeholder = i === 0 ? "ここから物語を書きます" : "このページの続きを書きます";
    });
  };

  const setPages = (texts: string[]) => {
    for (const p of pages) p.wrap.remove();
    pages = texts.map(makePage);
    arrange();
    grow(pages);
  };

  // ---- ページの境目のキー（矢印で前後のページへ動ける） ----

  const onKey = (e: KeyboardEvent, p: BodyPage) => {
    if (e.isComposing || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = pages.indexOf(p);
    const { selectionStart: a, selectionEnd: b } = p.ta;
    if (a !== b) return;
    // 縦書きは ← が次の行
    const next = vertical ? ["ArrowDown", "ArrowLeft"] : ["ArrowDown", "ArrowRight"];
    const prev = vertical ? ["ArrowUp", "ArrowRight"] : ["ArrowUp", "ArrowLeft"];
    if (a === p.ta.value.length && next.includes(e.key) && i < pages.length - 1) {
      e.preventDefault();
      placeCaret(i + 1, 0, "ifNeeded");
    } else if (a === 0 && prev.includes(e.key) && i > 0) {
      e.preventDefault();
      placeCaret(i - 1, pages[i - 1].ta.value.length, "ifNeeded");
    }
  };

  // ---- いま見ているページ ----

  const wrapAt = (index: number): HTMLElement | undefined =>
    index === 0 ? coverWrap : index === 1 ? titleWrap : pages[index - 2]?.wrap;

  const setCurrent = (index: number) => {
    current = index;
    opts.onCurrent(index, caret());
  };

  /**
   * スクロールしたとき：画面の真ん中あたりにあるページを、いまのページにする。
   * ただし、書いているページ（カーソルのあるページ）が見えているあいだは、そのページのまま。
   * 横書きは紙が上から下へ、縦書きは右から左へ並ぶ
   */
  const onScroll = () => {
    if (performance.now() < autoScrollUntil) return;
    const box = scroller.getBoundingClientRect();
    const fp = focusedPage();
    if (fp) {
      const r = fp.wrap.getBoundingClientRect();
      const seen = vertical ? r.right > box.left && r.left < box.right : r.bottom > box.top && r.top < box.bottom;
      if (seen) {
        const index = pages.indexOf(fp) + 2;
        if (index !== current) setCurrent(index);
        return;
      }
    }
    // この線より手前（横書きは上、縦書きは右）から始まっている、いちばん後ろのページ
    const line = vertical ? box.right - box.width * 0.4 : box.top + box.height * 0.4;
    const started = (w: HTMLElement) => {
      const r = w.getBoundingClientRect();
      return vertical ? r.right >= line : r.top <= line;
    };
    let lo = 0;
    let hi = pages.length + 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const w = wrapAt(mid);
      if (w && started(w)) lo = mid;
      else hi = mid - 1;
    }
    if (lo !== current) setCurrent(lo);
  };

  // 縦書きは紙が横に並ぶので、マウスのホイール（上下）で左右に動けるようにする（下に回すと先＝左へ）
  const onWheel = (e: WheelEvent) => {
    if (!vertical || e.shiftKey || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (scroller.scrollWidth <= scroller.clientWidth + 1) return;
    e.preventDefault();
    scroller.scrollBy({ left: -e.deltaY });
  };
  scroller.addEventListener("wheel", onWheel, { passive: false });
  let scrollFrame = 0;
  const onScrollThrottled = () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(onScroll);
  };
  scroller.addEventListener("scroll", onScrollThrottled, { passive: true });

  const onSelection = () => {
    const p = focusedPage();
    if (p) opts.onCurrent(pages.indexOf(p) + 2, caret());
  };
  document.addEventListener("selectionchange", onSelection);

  /** タイトルのページと表紙を、いまのタイトル・作者・表紙に合わせる（書いている途中の欄はそのまま） */
  const drawTitle = () => {
    const { title, author } = opts.title();
    if (document.activeElement !== titleInput && titleInput.value !== title) titleInput.value = title;
    if (document.activeElement !== authorInput && authorInput.value !== author) authorInput.value = author;
    growTitle();
    coverWrap.replaceChildren(h("div", { class: "wsheet wsheet-cover" }, renderCover(opts.meta())));
  };

  /** そのページが見えるようにスクロールする */
  const scrollToPage = (index: number) => {
    const w = wrapAt(index);
    if (!w) return;
    const box = scroller.getBoundingClientRect();
    const r = w.getBoundingClientRect();
    autoScroll();
    // 縦書きは、そのページの右の端が、見えている所の右の端に来るように
    if (vertical) scroller.scrollBy({ left: r.right - (box.right - 24) });
    else scroller.scrollBy({ top: r.top - box.top - 16 });
  };

  return {
    el,
    getBody,
    async load(body: string, v: boolean) {
      vertical = v;
      el.classList.toggle("is-vertical", v);
      // 縦書きは紙を右から左へ並べる（右が始まりになるように、スクロールする入れ物ごと右からにする）
      scroller.classList.toggle("is-vertical", v);
      drawTitle();
      await loadFonts(opts.title().title + opts.title().author + body);
      if (destroyed) return;
      if (body.includes(PAGE_BREAK) || !body) {
        setPages(body.split(PAGE_BREAK));
        return;
      }
      // ページを自分で足す前に保存した作品：読む画面で見えていたのと同じところでページに分ける
      const paginator = createPaginator();
      const starts = paginator
        .paginate({ ...opts.title(), body, vertical: v })
        .slice(1)
        .map((p, j) => (j === 0 ? 0 : p.start));
      paginator.destroy();
      setPages(
        starts.map((start, j) => {
          const text = body.slice(start, starts[j + 1] ?? body.length);
          return j < starts.length - 1 && text.endsWith("\n") ? text.slice(0, -1) : text;
        }),
      );
    },
    caret,
    replace(from: number, to: number, text: string, caretAt: number) {
      const { i, local } = locate(from);
      const p = pages[i];
      const end = local + (to - from);
      p.ta.focus({ preventScroll: true });
      p.ta.setSelectionRange(local, end);
      // execCommand を使うと、Ctrl + Z で元に戻せる
      const done = text
        ? document.execCommand("insertText", false, text)
        : local === end || document.execCommand("delete");
      if (!done) {
        p.ta.setRangeText(text, local, end, "end");
        p.ta.dispatchEvent(new Event("input"));
      }
      const target = locate(caretAt);
      placeCaret(target.i, target.local, "ifNeeded");
    },
    wrapSelection(wrap: (selected: string) => string | null) {
      const p = focusedPage();
      if (!p || p.ta.selectionStart === p.ta.selectionEnd) return false;
      const text = wrap(p.ta.value.slice(p.ta.selectionStart, p.ta.selectionEnd));
      if (text === null) return true;
      if (!document.execCommand("insertText", false, text)) {
        p.ta.setRangeText(text, p.ta.selectionStart, p.ta.selectionEnd, "end");
        p.ta.dispatchEvent(new Event("input"));
      }
      return true;
    },
    selectedText() {
      const p = focusedPage();
      return p ? p.ta.value.slice(p.ta.selectionStart, p.ta.selectionEnd) : "";
    },
    rememberSelection() {
      const p = focusedPage();
      if (!p) return () => {};
      const { selectionStart: a, selectionEnd: b } = p.ta;
      return () => {
        if (!p.ta.isConnected) return;
        p.ta.focus({ preventScroll: true });
        p.ta.setSelectionRange(a, b);
      };
    },
    jumpTo(pos: number) {
      const { i, local } = locate(pos);
      placeCaret(i, local, "force");
    },
    jumpToPage(index: number) {
      scrollToPage(index);
      if (index >= 2) {
        pages[index - 2].ta.focus({ preventScroll: true });
        pages[index - 2].ta.setSelectionRange(0, 0);
      }
      setCurrent(index);
    },
    addPage(at = pages.length) {
      const page = makePage("");
      pages.splice(at, 0, page);
      arrange();
      grow([page]);
      opts.onChange(null);
      scrollToPage(at + 2);
      placeCaret(at, 0, "none");
    },
    deletePage(i: number) {
      if (pages.length <= 1) return;
      const [page] = pages.splice(i, 1);
      page.wrap.remove();
      arrange();
      opts.onChange(null);
      setCurrent(Math.min(i, pages.length - 1) + 2);
    },
    movePage(from: number, to: number) {
      if (from === to) return;
      const [page] = pages.splice(from, 1);
      pages.splice(to, 0, page);
      arrange();
      opts.onChange(null);
      scrollToPage(to + 2);
      setCurrent(to + 2);
    },
    pageCount: () => pages.length,
    pageText: (i: number) => pages[i]?.ta.value ?? "",
    refreshTitle: drawTitle,
    setZoom(zoom: number) {
      el.style.zoom = String(zoom);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(scrollFrame);
      scroller.removeEventListener("scroll", onScrollThrottled);
      scroller.removeEventListener("wheel", onWheel);
      document.removeEventListener("selectionchange", onSelection);
    },
  };
}
