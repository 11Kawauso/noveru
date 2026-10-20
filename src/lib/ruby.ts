// ふりがな（ルビ）と傍点の書き方を、画面に出す形に変える
//
//   |漢字《かんじ》   → 漢字 に かんじ のふりがな（| は全角の ｜ でもいい）
//   漢字《かんじ》    → 直前の漢字のまとまりにふりがな
//   《《強調》》      → 強調 に傍点
//   |《              → 《 をそのまま表示したいとき
//   # 見出し         → 見出し（行の先頭。全角の ＃ でもいい）
//   ## 見出し        → 小見出し

import { escapeHtml } from "./dom";

/**
 * 本文の中の、ページの区切りの印（書く画面で作者が足したページのあいだに入る。目に見えない文字）。
 * これがない本文（ページを自分で足す前に保存した作品）は、読む画面で自動でページに区切る。
 */
export const PAGE_BREAK = "\f";

/**
 * 文章の最小単位。ページの区切りはこの単位でしか切らない
 * （ふりがな付きの言葉が2ページに分かれないように）。
 */
export interface Token {
  html: string;
  /** ふつうの1文字のとき、その文字 */
  ch?: string;
  /** 元の文章で何文字分か（ふりがなの記号なども含む。書く画面で場所を探すのに使う） */
  len: number;
}

/** 1段落（本文の1行） */
export interface Paragraph {
  tokens: Token[];
  /** 0：ふつうの段落、1：見出し、2：小見出し */
  heading: 0 | 1 | 2;
  /** 本文の中で、この段落が始まる位置 */
  start: number;
  /** tokens[i] が本文の中で始まる位置 */
  offsets: number[];
}

const KANJI = /^[\p{Script=Han}々〆ヵヶ]$/u;
const BARS = new Set(["|", "｜"]);
const DASHES = new Set(["—", "―", "─"]);
const MAX_BASE = 20;
const MAX_RUBY = 30;

function plain(ch: string, len = ch.length): Token {
  return { html: escapeHtml(ch), ch, len };
}

function ruby(base: string, rt: string, len: number): Token {
  return { html: `<ruby>${escapeHtml(base)}<rt>${escapeHtml(rt)}</rt></ruby>`, len };
}

/** chars[from]〜chars[to - 1] が元の文章で何文字分か */
function lengthOf(chars: string[], from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) n += chars[i].length;
  return n;
}

function indexOfFrom(chars: string[], target: string, from: number, limit: number): number {
  const end = Math.min(chars.length, from + limit + 1);
  for (let i = from; i < end; i++) {
    if (chars[i] === target) return i;
    if (chars[i] === "《" && target === "》") return -1;
  }
  return -1;
}

/** 1行（1段落）を Token の並びにする */
export function tokenizeLine(line: string): Token[] {
  const chars = Array.from(line);
  const out: Token[] = [];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];

    // |親文字《ルビ》 または |《
    if (BARS.has(c)) {
      if (chars[i + 1] === "《") {
        out.push(plain("《", c.length + 1));
        i += 2;
        continue;
      }
      const open = indexOfFrom(chars, "《", i + 1, MAX_BASE);
      const close = open > i + 1 ? indexOfFrom(chars, "》", open + 1, MAX_RUBY) : -1;
      if (close > open + 1) {
        out.push(
          ruby(chars.slice(i + 1, open).join(""), chars.slice(open + 1, close).join(""), lengthOf(chars, i, close + 1)),
        );
        i = close + 1;
        continue;
      }
      out.push(plain(c));
      i++;
      continue;
    }

    // 《《傍点》》
    if (c === "《" && chars[i + 1] === "《") {
      let close = -1;
      for (let k = i + 2; k < chars.length - 1; k++) {
        if (chars[k] === "》" && chars[k + 1] === "》") {
          close = k;
          break;
        }
      }
      if (close > i + 2) {
        const dots = chars.slice(i + 2, close);
        dots.forEach((ch, k) => {
          // 前後の《《 》》の分は、最初と最後の文字に入れておく
          const len = ch.length + (k === 0 ? 2 : 0) + (k === dots.length - 1 ? 2 : 0);
          out.push({ html: `<em class="bouten">${escapeHtml(ch)}</em>`, len });
        });
        i = close + 2;
        continue;
      }
    }

    // 漢字《ルビ》（| なし）
    if (c === "《") {
      const close = indexOfFrom(chars, "》", i + 1, MAX_RUBY);
      let m = 0;
      while (m < out.length && m < MAX_BASE) {
        const t = out[out.length - 1 - m];
        if (!t.ch || !KANJI.test(t.ch)) break;
        m++;
      }
      if (close > i + 1 && m > 0) {
        const baseTokens = out.splice(out.length - m, m);
        const base = baseTokens.map((t) => t.ch).join("");
        const baseLen = baseTokens.reduce((n, t) => n + t.len, 0);
        out.push(ruby(base, chars.slice(i + 1, close).join(""), baseLen + lengthOf(chars, i, close + 1)));
        i = close + 1;
        continue;
      }
    }

    // ダッシュ「——」（2つ以上続くもの）は1つのまとまりにして、行やページの境目で分かれないようにする
    if (DASHES.has(c) && chars[i + 1] === c) {
      let end = i + 1;
      while (chars[end + 1] === c) end++;
      const dash = chars.slice(i, end + 1).join("");
      out.push({ html: `<span class="nobr">${escapeHtml(dash)}</span>`, len: dash.length });
      i = end + 1;
      continue;
    }

    out.push(plain(c));
    i++;
  }
  return out;
}

const HEADING = /^([#＃]{1,2})[ 　\t]*/;

/** 行が見出しなら、その深さ（1：見出し、2：小見出し）と、印（# と空白）の長さ・見出しの文字を返す */
export function parseHeading(line: string): { level: 1 | 2; markLen: number; text: string } | null {
  const m = HEADING.exec(line);
  if (!m) return null;
  const text = line.slice(m[0].length).trim();
  if (!text) return null;
  return { level: m[1].length as 1 | 2, markLen: m[0].length, text };
}

/** 本文全体を段落（行）に分ける（改行で段落が分かれる）。見出しの行は、印を取って見出しにする */
export function tokenizeBody(body: string): Paragraph[] {
  const out: Paragraph[] = [];
  let start = 0;
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const head = parseHeading(line);
    const tokens = tokenizeLine(head ? line.slice(head.markLen) : line);
    const offsets: number[] = [];
    let at = start + (head?.markLen ?? 0);
    for (const t of tokens) {
      offsets.push(at);
      at += t.len;
    }
    out.push({ tokens, heading: head?.level ?? 0, start, offsets });
    start += line.length + 1;
  }
  return out;
}
