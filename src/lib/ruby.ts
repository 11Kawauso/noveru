// ふりがな（ルビ）と傍点の書き方を、画面に出す形に変える
//
//   |漢字《かんじ》   → 漢字 に かんじ のふりがな（| は全角の ｜ でもいい）
//   漢字《かんじ》    → 直前の漢字のまとまりにふりがな
//   《《強調》》      → 強調 に傍点
//   |《              → 《 をそのまま表示したいとき

import { escapeHtml } from "./dom";

/**
 * 文章の最小単位。ページの区切りはこの単位でしか切らない
 * （ふりがな付きの言葉が2ページに分かれないように）。
 */
export interface Token {
  html: string;
  /** ふつうの1文字のとき、その文字 */
  ch?: string;
}

const KANJI = /^[\p{Script=Han}々〆ヵヶ]$/u;
const BARS = new Set(["|", "｜"]);
const MAX_BASE = 20;
const MAX_RUBY = 30;

function plain(ch: string): Token {
  return { html: escapeHtml(ch), ch };
}

function ruby(base: string, rt: string): Token {
  return { html: `<ruby>${escapeHtml(base)}<rt>${escapeHtml(rt)}</rt></ruby>` };
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
        out.push(plain("《"));
        i += 2;
        continue;
      }
      const open = indexOfFrom(chars, "《", i + 1, MAX_BASE);
      const close = open > i + 1 ? indexOfFrom(chars, "》", open + 1, MAX_RUBY) : -1;
      if (close > open + 1) {
        out.push(ruby(chars.slice(i + 1, open).join(""), chars.slice(open + 1, close).join("")));
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
        for (const ch of chars.slice(i + 2, close)) {
          out.push({ html: `<em class="bouten">${escapeHtml(ch)}</em>` });
        }
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
        const base = out
          .splice(out.length - m, m)
          .map((t) => t.ch)
          .join("");
        out.push(ruby(base, chars.slice(i + 1, close).join("")));
        i = close + 1;
        continue;
      }
    }

    out.push(plain(c));
    i++;
  }
  return out;
}

/** 本文全体を、段落ごとの Token の並びにする（改行で段落が分かれる） */
export function tokenizeBody(body: string): Token[][] {
  return body.replace(/\r\n?/g, "\n").split("\n").map(tokenizeLine);
}
