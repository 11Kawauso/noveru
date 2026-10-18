// タグ（作品につける目印）。保存するときは「#」をつけずに持つ

import { h } from "./dom";

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 20;

/** 入力された文字からタグを取り出す（空白・読点・カンマで区切る。先頭の # はあってもなくてもいい） */
export function parseTags(text: string): string[] {
  const tags: string[] = [];
  for (const raw of text.normalize("NFKC").split(/[\s,、，]+/)) {
    const tag = raw.replace(/^#+/, "").trim().slice(0, MAX_TAG_LENGTH);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/** 入力欄に出すとき用（「#ファンタジー #短編」） */
export function tagsToText(tags: string[]): string {
  return tags.map((t) => `#${t}`).join(" ");
}

/** タグを探す画面へのリンク */
export function tagHref(tag: string): string {
  return `#/explore/${encodeURIComponent(`#${tag}`)}`;
}

/** タグの並び（押すと、そのタグで探す画面へ） */
export function renderTagChips(tags: string[], linkable = true): HTMLElement | null {
  if (!tags.length) return null;
  return h(
    "div",
    { class: "tag-chips" },
    ...tags.map((t) =>
      linkable ? h("a", { class: "tag-chip", href: tagHref(t) }, `#${t}`) : h("span", { class: "tag-chip" }, `#${t}`),
    ),
  );
}
