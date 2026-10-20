// 書く画面の左から2番目のパネル：タイトル・作者を書く欄と、目次（章・節の見出しの一覧）
//   本文の行の先頭に「#」を付けると章、「##」を付けると節になる。目次を押すと、その行へ飛ぶ。

import { h } from "./dom";
import { parseHeading, tokenizeLine } from "./ruby";

interface Heading {
  level: 1 | 2;
  text: string;
  /** 本文の中で、その行が始まる位置 */
  pos: number;
}

/** 本文から見出しを集める */
function readHeadings(body: string): Heading[] {
  const list: Heading[] = [];
  let pos = 0;
  for (const line of body.split("\n")) {
    const head = parseHeading(line);
    if (head) list.push({ level: head.level, text: plainText(head.text), pos });
    pos += line.length + 1;
  }
  return list;
}

/** ふりがなの書き方を取って、見出しの文字だけにする（|漢字《かんじ》 → 漢字） */
function plainText(line: string): string {
  const div = document.createElement("div");
  div.innerHTML = tokenizeLine(line)
    .map((t) => t.html)
    .join("");
  div.querySelectorAll("rt").forEach((rt) => rt.remove());
  return div.textContent ?? "";
}

export interface OutlinePanel {
  el: HTMLElement;
  /** 本文が変わったときに呼ぶ（目次を作り直す） */
  update(): void;
  /** カーソルが動いたときに呼ぶ（いまいる章・節を目立たせる） */
  markCurrent(pos: number | null): void;
}

export function createOutlinePanel(opts: {
  title: HTMLInputElement;
  author: HTMLInputElement;
  body: HTMLTextAreaElement;
  /** 本文の pos 文字目へ飛ぶ */
  jump: (pos: number) => void;
}): OutlinePanel {
  const { body } = opts;
  let headings: Heading[] = [];
  let lastKey = "";

  const list = h("ol", { class: "outline-list" });
  const empty = h(
    "p",
    { class: "outline-empty" },
    "行の先頭に「#」を付けると章、「##」を付けると節になって、ここに並びます。",
  );

  /** カーソルのある行を、章（または節）の見出しにする。もう一度押すと、ふつうの行に戻す */
  const markLine = (level: 1 | 2) => {
    const v = body.value;
    const pos = body.selectionStart;
    const lineStart = v.lastIndexOf("\n", pos - 1) + 1;
    const lineEndAt = v.indexOf("\n", pos);
    const line = v.slice(lineStart, lineEndAt < 0 ? v.length : lineEndAt);
    const oldMark = /^[#＃]{1,2}[ 　\t]*/.exec(line)?.[0] ?? "";
    const mark = parseHeading(line)?.level === level ? "" : level === 1 ? "# " : "## ";
    body.focus();
    body.setSelectionRange(lineStart, lineStart + oldMark.length);
    // execCommand を使うと、Ctrl + Z で元に戻せる
    const done = mark ? document.execCommand("insertText", false, mark) : !oldMark || document.execCommand("delete");
    if (!done) {
      body.setRangeText(mark, lineStart, lineStart + oldMark.length, "end");
      body.dispatchEvent(new Event("input"));
    }
  };

  const markBtn = (level: 1 | 2, label: string) =>
    h(
      "button",
      {
        class: "outline-mark",
        type: "button",
        title: `カーソルのある行を${label}の見出しにする（もう一度押すと戻す）`,
        // 押したときにカーソルが本文から外れないようにする
        onmousedown: (e: Event) => e.preventDefault(),
        onclick: () => markLine(level),
      },
      `＋${label}`,
    );

  const el = h(
    "aside",
    { class: "writer-outline", "aria-label": "タイトル・作者と目次" },
    h("label", { class: "outline-field" }, h("span", {}, "タイトル"), opts.title),
    h("label", { class: "outline-field" }, h("span", {}, "作者"), opts.author),
    h(
      "div",
      { class: "outline-head" },
      h("span", { class: "outline-label" }, "目次"),
      markBtn(1, "章"),
      markBtn(2, "節"),
    ),
    list,
    empty,
  );

  const update = () => {
    const next = readHeadings(body.value);
    // 見出しが変わっていなければ作り直さない（場所だけ入れ替える）
    const key = next.map((x) => `${x.level}${x.text}`).join("\n");
    headings = next;
    if (key === lastKey && list.childElementCount === next.length) return;
    lastKey = key;
    empty.hidden = next.length > 0;
    list.replaceChildren(
      ...next.map((x, i) =>
        h(
          "li",
          { class: `outline-item level-${x.level}` },
          h("button", { type: "button", "data-index": i, onclick: () => opts.jump(headings[i].pos) }, x.text),
        ),
      ),
    );
  };

  const markCurrent = (pos: number | null) => {
    let current = -1;
    if (pos !== null) headings.forEach((x, i) => x.pos <= pos && (current = i));
    list
      .querySelectorAll<HTMLElement>(".outline-item")
      .forEach((li, i) => li.classList.toggle("is-current", i === current));
  };

  return { el, update, markCurrent };
}
