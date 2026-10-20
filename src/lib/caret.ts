// テキスト欄の中の、ある文字が画面のどこにあるかを調べる
// テキスト欄そのものからは分からないので、同じ見た目の見えない入れ物をすぐ上に重ねて、文字を写して測る。
// （縦書きでも、紙の拡大縮小をしていても同じように測れる）

const COPY = [
  "boxSizing",
  "width",
  "height",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "writingMode",
  "textOrientation",
  "whiteSpace",
  "overflowWrap",
  "wordBreak",
  "lineBreak",
  "textAlign",
  "textIndent",
  "tabSize",
] as const;

/** textarea の pos 文字目の位置（画面上の四角）。textarea の親は position: relative にしておく */
export function caretRect(ta: HTMLTextAreaElement, pos: number): DOMRect {
  const style = getComputedStyle(ta);
  const mirror = document.createElement("div");
  for (const key of COPY) mirror.style[key] = style[key];
  mirror.style.position = "absolute";
  mirror.style.top = `${ta.offsetTop}px`;
  mirror.style.left = `${ta.offsetLeft}px`;
  mirror.style.visibility = "hidden";
  mirror.style.overflow = "hidden";
  mirror.style.pointerEvents = "none";

  const marker = document.createElement("span");
  // 改行の上や最後の文字のあとでも場所が分かるように、何か1文字入れておく
  marker.textContent = ta.value.slice(pos, pos + 1).replace("\n", "") || "​";
  mirror.append(ta.value.slice(0, pos), marker);
  ta.parentElement!.append(mirror);
  const rect = marker.getBoundingClientRect();
  mirror.remove();
  return rect;
}
