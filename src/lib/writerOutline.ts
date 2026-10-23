// 書く画面の左から2番目のパネル：表紙・あらすじ（top）、タイトル・作者を書く欄と、目次（見出しの一覧）
//   中身が長いときはパネルの中でスクロールする（右端に細いつまみが出る）。
//   行を見出しにするには、「＋見出し」「＋小見出し」（左の道具の「見出し」）を押すか、行の先頭に「#」「##」を書く。
//   目次を押すと、その行へ飛ぶ。

import { h, toast } from "./dom";
import { withScrollThumb } from "./scrollThumb";
import { PAGE_BREAK, parseHeading, tokenizeLine } from "./ruby";

interface Heading {
  level: 1 | 2;
  text: string;
  /** 本文の中で、その行が始まる位置 */
  pos: number;
}

/** 行の区切り（改行と、ページの区切りの印。どちらも1文字） */
const LINE_BREAK = new RegExp(`\n|${PAGE_BREAK}`);

/** 本文から見出しを集める（ページの区切りの印も、行の区切りと同じに数える） */
function readHeadings(body: string): Heading[] {
  const list: Heading[] = [];
  let pos = 0;
  for (const line of body.split(LINE_BREAK)) {
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
  /** カーソルが動いたときに呼ぶ（いまいる見出しを目立たせる） */
  markCurrent(pos: number | null): void;
  /** カーソルのある行を見出し（1）・小見出し（2）にする。もう一度押すと戻す */
  markLine(level: 1 | 2): void;
}

export function createOutlinePanel(opts: {
  title: HTMLInputElement;
  author: HTMLInputElement;
  /** 真ん中の紙（本文を読んだり書き換えたりする） */
  editor: {
    getBody(): string;
    caret(): number | null;
    replace(from: number, to: number, text: string, caretAt: number): void;
  };
  /** 本文の pos 文字目へ飛ぶ */
  jump: (pos: number) => void;
  /** タイトルの上に置くもの（表紙・あらすじ） */
  top?: Node[];
}): OutlinePanel {
  const { editor } = opts;
  let headings: Heading[] = [];
  let lastKey = "";

  const list = h("ol", { class: "outline-list" });
  const empty = h(
    "p",
    { class: "outline-empty" },
    "見出しを付けると、ここに並んで、押すとそこへ飛べます。見出しにしたい行にカーソルを置いて「＋見出し」を押してください（行の先頭に # を書いても見出しになります）。",
  );

  /** カーソルのある行を、見出し（または小見出し）にする。もう一度押すと、ふつうの行に戻す */
  const markLine = (level: 1 | 2) => {
    const pos = editor.caret();
    if (pos === null) return toast("見出しにしたい行に、本文のカーソルを置いてから押してください。");
    const v = editor.getBody();
    const lineStart = Math.max(v.lastIndexOf("\n", pos - 1), v.lastIndexOf(PAGE_BREAK, pos - 1)) + 1;
    const ends = [v.indexOf("\n", pos), v.indexOf(PAGE_BREAK, pos)].filter((x) => x >= 0);
    const line = v.slice(lineStart, ends.length ? Math.min(...ends) : v.length);
    const oldMark = /^[#＃]{1,2}[ 　\t]*/.exec(line)?.[0] ?? "";
    const mark = parseHeading(line)?.level === level ? "" : level === 1 ? "# " : "## ";
    // カーソルは、同じ文字の所に残す（印の中にあったときは、印のすぐあとへ）
    const caretAt = Math.max(lineStart + mark.length, pos + mark.length - oldMark.length);
    editor.replace(lineStart, lineStart + oldMark.length, mark, caretAt);
  };

  const markBtn = (level: 1 | 2, label: string) =>
    h(
      "button",
      {
        class: "outline-mark",
        type: "button",
        title: `カーソルのある行を${label}にする（もう一度押すと戻す）`,
        // 押したときにカーソルが本文から外れないようにする
        onmousedown: (e: Event) => e.preventDefault(),
        onclick: () => markLine(level),
      },
      `＋${label}`,
    );

  const inner = h(
    "div",
    { class: "writer-outline-inner" },
    ...(opts.top ?? []),
    h("label", { class: "outline-field" }, h("span", {}, "タイトル"), opts.title),
    h("label", { class: "outline-field" }, h("span", {}, "作者"), opts.author),
    h(
      "div",
      { class: "outline-head" },
      h("span", { class: "outline-label" }, "目次"),
      markBtn(1, "見出し"),
      markBtn(2, "小見出し"),
    ),
    list,
    empty,
  );
  const el = h(
    "aside",
    { class: "writer-outline", "aria-label": "表紙・あらすじ・タイトル・作者と目次" },
    withScrollThumb(inner, "writer-outline-wrap"),
  );

  const update = () => {
    const next = readHeadings(editor.getBody());
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

  return { el, update, markCurrent, markLine };
}
