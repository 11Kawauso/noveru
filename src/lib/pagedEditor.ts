// 書く画面の真ん中：ページごとに分かれた紙を、上から「表紙 → タイトルと作者のページ → 本文のページ」の順に縦に並べる
//
//   本文のページの区切りは、読む画面と同じ（reader.ts の区切り方を使う）。1ページに1つずつ書く欄がある。
//   書いてページからはみ出した文字は、手が止まると次のページへ送られる（空きができれば前のページへ戻る）。
//   ページの境目では、Backspace・Delete・矢印キーで前後のページへつながる。
//   書く欄が分かれているので、「元に戻す（Ctrl + Z）／やり直す（Ctrl + Y）」はここで覚えておく。
//
//   ページの番号は、0 が表紙、1 がタイトルのページ、2 から本文（右のページの一覧と同じ）。

import type { BookMeta } from "../store";
import { caretRect } from "./caret";
import { renderCover } from "./cover";
import { h } from "./dom";
import { createPaginator, loadFonts, titlePageHtml, type PageInfo } from "./reader";

/** 手が止まってから区切り直すまで（ミリ秒） */
const WAIT = 500;
/** ページからはみ出しているときは早めに区切り直す */
const WAIT_OVERFLOW = 150;
/** 元に戻せる回数 */
const MAX_HISTORY = 200;
/** 続けて書いた文字を、元に戻すときに1回分にまとめる時間 */
const HISTORY_GROUP = 1000;

/** 本文の1ページ分の書く欄 */
interface BodyPage {
  wrap: HTMLElement;
  ta: HTMLTextAreaElement;
  num: HTMLElement;
  /** 本文の中で、この欄の文字が始まる位置 */
  start: number;
  /** 欄に出している文字 */
  text: string;
  /** 次のページとのあいだの改行（段落の切れ目でページが変わるときは "\n"、段落の途中なら ""） */
  sep: string;
}

interface Snapshot {
  body: string;
  caret: number;
}

export interface PagedEditor {
  /** 縦に並んだページ */
  el: HTMLElement;
  getBody(): string;
  /** 本文を入れて、ページを作る（フォントを読み込んでから） */
  load(body: string, vertical: boolean): Promise<void>;
  /** カーソルの位置（本文の何文字目か）。本文の欄にいないときは null */
  caret(): number | null;
  /** 本文の from〜to を text に置き換えて、カーソルを caretAt に置く（元に戻せる） */
  replace(from: number, to: number, text: string, caretAt: number): void;
  /** 本文の pos 文字目へ飛んで、そこにカーソルを置く */
  jumpTo(pos: number): void;
  /** そのページへ飛ぶ（0：表紙、1：タイトル、2〜：本文） */
  jumpToPage(index: number): void;
  /** タイトル・作者・表紙が変わったとき */
  refreshTitle(): void;
  /** 読む画面と同じ区切りのページ（0 がタイトルのページ） */
  readerPages(): PageInfo[];
  /** 拡大縮小（紙をまるごと大きく／小さくする） */
  setZoom(zoom: number): void;
  destroy(): void;
}

export function createPagedEditor(opts: {
  /** スクロールする入れ物（el はこの中に置く） */
  scroller: HTMLElement;
  title: () => { title: string; author: string };
  meta: () => BookMeta;
  /** 本文が変わったとき（字数・保存の確認・目次のため） */
  onChange: () => void;
  /** ページの区切りが変わったとき。from より前のページは変わっていない */
  onPages: (pages: PageInfo[], from: number) => void;
  /** いま見ている（書いている）ページが変わったとき。caret は本文の欄にいないとき null */
  onCurrent: (index: number, caret: number | null) => void;
  /** タイトルのページを押したとき */
  onTitleClick: () => void;
}): PagedEditor {
  const { scroller } = opts;
  const paginator = createPaginator();
  let body = "";
  let vertical = false;
  /** 読む画面と同じ区切り（0 がタイトルのページ、1〜 が本文のページ） */
  let reader: PageInfo[] = [];
  let pages: BodyPage[] = [];
  let ready = false;
  let destroyed = false;
  let composing = false;
  let timer = 0;
  /** ここから後ろのページを区切り直す（pages の番号） */
  let dirtyFrom = Infinity;
  /** 区切り直すまでに書き換えた所の、いちばん後ろ（ここより後ろは、前に区切ったときと同じ文章） */
  let editedUpTo = -1;
  let undoStack: Snapshot[] = [];
  let redoStack: Snapshot[] = [];
  let lastKind = "";
  let lastTime = 0;
  let current = -1;

  const coverWrap = h("div", { class: "wsheet-wrap", "data-index": 0 });
  const titleContent = h("div", { class: "page-content is-title" });
  const titleWrap = h(
    "div",
    { class: "wsheet-wrap", "data-index": 1 },
    h("div", { class: "wsheet wsheet-title", onclick: () => opts.onTitleClick() }, titleContent),
    h("span", { class: "wsheet-num" }, "1"),
  );
  const el = h("div", { class: "page-stack" }, coverWrap, titleWrap);

  // ---- 本文の場所とページ ----

  /** 本文の pos 文字目があるページ（pages の番号） */
  const pageAt = (pos: number): number => {
    let lo = 0;
    let hi = pages.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (pages[mid].start <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const focusedPage = (): BodyPage | undefined => pages.find((p) => p.ta === document.activeElement);

  const caret = (): number | null => {
    const p = focusedPage();
    return p ? p.start + p.ta.selectionStart : null;
  };

  /**
   * 書く欄の大きさを中身に合わせる（ページからはみ出した分だけ伸びる。ふだんはページの大きさ）。
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

  const overflowing = (p: BodyPage): boolean => {
    const s = getComputedStyle(p.ta);
    return vertical ? p.ta.offsetWidth > parseFloat(s.minWidth) + 2 : p.ta.offsetHeight > parseFloat(s.minHeight) + 2;
  };

  /** カーソルの行が見えるようにスクロールする（force なら、見えていても画面の上から3割の所へ） */
  const showCaret = (p: BodyPage, force: boolean) => {
    const r = caretRect(p.ta, p.ta.selectionStart);
    const box = scroller.getBoundingClientRect();
    const margin = 40;
    if (force || r.top < box.top + margin || r.bottom > box.bottom - margin) {
      autoScroll();
      scroller.scrollBy({ top: r.top - (box.top + box.height * 0.3) });
    }
    if (r.left < box.left || r.right > box.right) {
      autoScroll();
      scroller.scrollBy({ left: r.left - (box.left + box.width / 2) });
    }
  };

  /**
   * こちらでスクロールするときに呼ぶ。少しのあいだは、スクロールしても「いまのページ」を変えない
   * （カーソルのあるページや、押したページのままにする）
   */
  let autoScrollUntil = 0;
  const autoScroll = () => (autoScrollUntil = performance.now() + 250);

  /** 本文の pos 文字目にカーソルを置く */
  const placeCaret = (pos: number, scroll: "none" | "ifNeeded" | "force", end = pos) => {
    if (!pages.length) return;
    const i = pageAt(pos);
    const p = pages[i];
    const local = Math.max(0, Math.min(pos - p.start, p.text.length));
    const localEnd = pageAt(end) === i ? Math.max(local, Math.min(end - p.start, p.text.length)) : local;
    p.ta.focus({ preventScroll: true });
    p.ta.setSelectionRange(local, localEnd);
    if (scroll !== "none") showCaret(p, scroll === "force");
    setCurrent(i + 2);
  };

  // ---- ページを作る ----

  const makePage = (): BodyPage => {
    const ta = h("textarea", { class: "w-body", spellcheck: false, "aria-label": "本文" });
    const num = h("span", { class: "wsheet-num" });
    const wrap = h("div", { class: "wsheet-wrap" }, h("div", { class: "wsheet wsheet-body" }, ta), num);
    const page: BodyPage = { wrap, ta, num, start: 0, text: "", sep: "" };
    ta.addEventListener("beforeinput", (e) => onBeforeInput(e));
    ta.addEventListener("input", () => onInput(page));
    ta.addEventListener("keydown", (e) => onKey(e, page));
    ta.addEventListener("compositionstart", () => (composing = true));
    ta.addEventListener("compositionend", () => {
      composing = false;
      schedule(WAIT);
    });
    ta.addEventListener("focus", () => setCurrent(pages.indexOf(page) + 2, true));
    return page;
  };

  /** 読む画面の区切りから、ページごとの書く欄の中身を決めて、画面のページを合わせる */
  const syncPages = () => {
    const n = reader.length - 1;
    const changed: BodyPage[] = [];
    for (let j = 0; j < n; j++) {
      const start = j === 0 ? 0 : reader[j + 1].start;
      const end = j < n - 1 ? reader[j + 2].start : body.length;
      let text = body.slice(start, end);
      let sep = "";
      if (j < n - 1 && text.endsWith("\n")) {
        text = text.slice(0, -1);
        sep = "\n";
      }
      let p = pages[j];
      if (!p) {
        p = makePage();
        pages.push(p);
        el.append(p.wrap);
      }
      p.start = start;
      p.sep = sep;
      p.wrap.dataset.index = String(j + 2);
      p.num.textContent = String(j + 2);
      p.ta.placeholder = j === 0 ? "ここから本文を書きます" : "";
      if (p.ta.value !== text) {
        p.ta.value = text;
        changed.push(p);
      }
      p.text = text;
    }
    for (const p of pages.splice(n)) p.wrap.remove();
    grow(changed);
  };

  /** pages[k] から後ろを区切り直す（前のページはそのまま） */
  const reflow = (k: number) => {
    if (!ready || destroyed) return;
    // 書いている場所を覚えておいて、区切り直したあとも同じ文字の所にカーソルを戻す
    const fp = focusedPage();
    const sel = fp
      ? { start: fp.start + fp.ta.selectionStart, end: fp.start + fp.ta.selectionEnd, page: pages.indexOf(fp) }
      : null;
    k = Math.max(0, Math.min(k, pages.length - 1));
    const from = k === 0 ? 0 : pages[k].start;
    // 書き換えた所より後ろで、前と同じ場所から始まるページまで来たら、そこから先は前と同じなので計算しない
    // （章は新しいページから始まるので、たいていは今の章の中だけを区切り直せばすむ）
    const oldStarts = new Map<number, number>();
    for (let j = k + 2; j < reader.length; j++) oldStarts.set(reader[j].start, j);
    const limit = editedUpTo;
    const res = paginator.paginateFrom(body, from, vertical, (at) => at > limit && oldStarts.has(at));
    const same = res.stoppedAt === undefined ? [] : reader.slice(oldStarts.get(res.stoppedAt)!);
    reader = [reader[0] ?? titlePage(), ...reader.slice(1, k + 1), ...res.pages, ...same];
    editedUpTo = -1;
    syncPages();
    if (sel) placeCaret(sel.start, pageAt(sel.start) === sel.page ? "none" : "ifNeeded", sel.end);
    opts.onPages(reader, k + 1);
  };

  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (composing || dirtyFrom === Infinity) return;
      const k = dirtyFrom;
      dirtyFrom = Infinity;
      reflow(k);
    }, ms);
  };

  const titlePage = (): PageInfo => ({ html: titlePageHtml({ ...opts.title(), body: "", vertical }), start: 0 });

  const drawTitle = () => {
    reader[0] = titlePage();
    titleContent.innerHTML = reader[0].html;
    coverWrap.replaceChildren(h("div", { class: "wsheet wsheet-cover" }, renderCover(opts.meta())));
  };

  // ---- 書いたとき ----

  /** 元に戻すための記録。続けて書いた分は1回にまとめる */
  const remember = (kind: string, force = false) => {
    const now = Date.now();
    if (!force && kind === lastKind && now - lastTime < HISTORY_GROUP) {
      lastTime = now;
      return;
    }
    undoStack.push({ body, caret: caret() ?? 0 });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    lastKind = kind;
    lastTime = now;
  };

  const onBeforeInput = (e: InputEvent) => {
    if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
      e.preventDefault();
      if (e.inputType === "historyUndo") undo();
      else redo();
      return;
    }
    const kind = e.inputType.startsWith("delete") ? "delete" : "insert";
    // 改行・貼り付け・切り取りは、それだけで1回分にする
    const alone =
      e.inputType === "insertParagraph" || e.inputType === "insertLineBreak" || /Paste|Drop|Cut/.test(e.inputType);
    remember(kind, alone);
    if (alone) lastKind = "";
  };

  const onInput = (p: BodyPage) => {
    const i = pages.indexOf(p);
    if (i < 0) return;
    const text = p.ta.value;
    const delta = text.length - p.text.length;
    body = body.slice(0, p.start) + text + body.slice(p.start + p.text.length);
    p.text = text;
    // 後ろのページの始まりの位置をずらしておく（区切り直すまでのあいだも、場所が合うように）
    for (let j = i + 1; j < pages.length; j++) pages[j].start += delta;
    for (let j = i + 2; j < reader.length; j++) reader[j] = { ...reader[j], start: reader[j].start + delta };
    editedUpTo = Math.max(editedUpTo > p.start ? editedUpTo + delta : editedUpTo, p.start + text.length);
    grow([p]);
    dirtyFrom = Math.min(dirtyFrom, Math.max(0, i - 1));
    opts.onChange();
    opts.onCurrent(i + 2, caret());
    if (!composing) schedule(overflowing(p) ? WAIT_OVERFLOW : WAIT);
  };

  /** 本文をまるごと入れ替える（元に戻す・やり直すとき） */
  const restore = (s: Snapshot) => {
    body = s.body;
    dirtyFrom = Infinity;
    editedUpTo = Infinity; // 全部区切り直す
    clearTimeout(timer);
    reflow(0);
    placeCaret(s.caret, "ifNeeded");
    opts.onChange();
  };

  const undo = () => {
    const s = undoStack.pop();
    if (!s) return;
    redoStack.push({ body, caret: caret() ?? s.caret });
    lastKind = "";
    restore(s);
  };

  const redo = () => {
    const s = redoStack.pop();
    if (!s) return;
    undoStack.push({ body, caret: caret() ?? s.caret });
    lastKind = "";
    restore(s);
  };

  const replace = (from: number, to: number, text: string, caretAt: number) => {
    remember("replace", true);
    lastKind = "";
    body = body.slice(0, from) + text + body.slice(to);
    // 後ろのページの始まりの位置をずらしておく（前に区切った結果と比べるため）
    const delta = text.length - (to - from);
    for (let j = 1; j < reader.length; j++) {
      if (reader[j].start > from) reader[j] = { ...reader[j], start: reader[j].start + delta };
    }
    editedUpTo = Math.max(editedUpTo > from ? editedUpTo + delta : editedUpTo, from + text.length);
    clearTimeout(timer);
    const k = Math.max(0, Math.min(dirtyFrom, pageAt(from) - 1));
    dirtyFrom = Infinity;
    reflow(k);
    placeCaret(caretAt, "ifNeeded");
    opts.onChange();
  };

  // ---- ページの境目のキー ----

  const onKey = (e: KeyboardEvent, p: BodyPage) => {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && !e.altKey && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && !e.altKey && key === "y") {
      e.preventDefault();
      redo();
      return;
    }
    const i = pages.indexOf(p);
    const { selectionStart: a, selectionEnd: b } = p.ta;
    if (a !== b || e.shiftKey || e.altKey) return;
    const atStart = a === 0;
    const atEnd = a === p.ta.value.length;

    // ページの最初で Backspace：前のページの最後の1文字（または段落の切れ目）を消す
    if (e.key === "Backspace" && atStart && i > 0) {
      e.preventDefault();
      replace(p.start - 1, p.start, "", p.start - 1);
      return;
    }
    // ページの最後で Delete：次のページの最初の1文字（または段落の切れ目）を消す
    if (e.key === "Delete" && atEnd && i < pages.length - 1) {
      e.preventDefault();
      const at = p.start + p.text.length;
      replace(at, at + 1, "", at);
      return;
    }
    if (mod) return;
    // 矢印キーでページをまたぐ（縦書きは ← が次の行）
    const next = vertical ? ["ArrowDown", "ArrowLeft"] : ["ArrowDown", "ArrowRight"];
    const prev = vertical ? ["ArrowUp", "ArrowRight"] : ["ArrowUp", "ArrowLeft"];
    if (atEnd && next.includes(e.key) && i < pages.length - 1) {
      e.preventDefault();
      placeCaret(pages[i + 1].start, "ifNeeded");
    } else if (atStart && prev.includes(e.key) && i > 0) {
      e.preventDefault();
      placeCaret(pages[i - 1].start + pages[i - 1].text.length, "ifNeeded");
    }
  };

  // ---- いま見ているページ ----

  const wrapAt = (index: number): HTMLElement | undefined =>
    index === 0 ? coverWrap : index === 1 ? titleWrap : pages[index - 2]?.wrap;

  /** いまのページを知らせる。fromCaret なら本文の欄でカーソルが動いたとき */
  const setCurrent = (index: number, fromCaret = true) => {
    current = index;
    opts.onCurrent(index, fromCaret ? caret() : null);
  };

  /**
   * スクロールしたとき：画面の真ん中あたりにあるページを、いまのページにする。
   * ただし、書いているページ（カーソルのあるページ）が見えているあいだは、そのページのまま
   */
  const onScroll = () => {
    if (performance.now() < autoScrollUntil) return;
    const box = scroller.getBoundingClientRect();
    const fp = focusedPage();
    if (fp) {
      const r = fp.wrap.getBoundingClientRect();
      if (r.bottom > box.top && r.top < box.bottom) {
        const index = pages.indexOf(fp) + 2;
        if (index !== current) setCurrent(index);
        return;
      }
    }
    const line = box.top + box.height * 0.4;
    let lo = 0;
    let hi = pages.length + 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const w = wrapAt(mid);
      if (w && w.getBoundingClientRect().top <= line) lo = mid;
      else hi = mid - 1;
    }
    if (lo !== current) {
      current = lo;
      opts.onCurrent(lo, caret());
    }
  };
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

  // あとから届いたフォントがあれば、区切り直す。書いている途中に届くのは、たいてい今書いた字のフォントなので、
  // 書いているページのあたりから（書いていないときは全部）
  const onFonts = () => {
    const fp = focusedPage();
    if (fp) {
      dirtyFrom = Math.min(dirtyFrom, Math.max(0, pages.indexOf(fp) - 1));
      editedUpTo = Math.max(editedUpTo, fp.start + fp.text.length);
    } else {
      dirtyFrom = 0;
      editedUpTo = Infinity;
    }
    schedule(WAIT);
  };
  document.fonts?.addEventListener("loadingdone", onFonts);

  return {
    el,
    getBody: () => body,
    async load(text: string, v: boolean) {
      body = text;
      vertical = v;
      el.classList.toggle("is-vertical", v);
      drawTitle();
      await loadFonts(opts.title().title + opts.title().author + text);
      if (destroyed) return;
      ready = true;
      reflow(0);
    },
    caret,
    replace,
    jumpTo(pos: number) {
      placeCaret(pos, "force");
    },
    jumpToPage(index: number) {
      const w = wrapAt(index);
      if (!w) return;
      const box = scroller.getBoundingClientRect();
      autoScroll();
      scroller.scrollBy({ top: w.getBoundingClientRect().top - box.top - 16 });
      if (index >= 2) {
        pages[index - 2].ta.focus({ preventScroll: true });
        pages[index - 2].ta.setSelectionRange(0, 0);
      }
      setCurrent(index, index >= 2);
    },
    refreshTitle() {
      drawTitle();
      opts.onPages(reader, 0);
    },
    readerPages: () => reader,
    setZoom(zoom: number) {
      el.style.zoom = String(zoom);
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      cancelAnimationFrame(scrollFrame);
      scroller.removeEventListener("scroll", onScrollThrottled);
      document.removeEventListener("selectionchange", onSelection);
      document.fonts?.removeEventListener("loadingdone", onFonts);
      paginator.destroy();
    },
  };
}
