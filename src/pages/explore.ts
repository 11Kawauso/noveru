// 「探す」：ほかの人の公開中の作品を、表紙で横3列に並べて探す
//   作品名（や作者名・読み）をそのまま書くか、「#タグ」で探せる。両方まぜてもいい。
//   作品を押すと、まず概要の小窓（あらすじ・いいね・「読む」）が出る。
//   並べ方は「おすすめ（人気＋新しさ）」「新着」「人気」から選べる。最初はおすすめ。

import { enableBookInfo, reopenBookInfo } from "../lib/bookInfo";
import { enableBookTips } from "../lib/bookTip";
import { displayTitle, renderCover } from "../lib/cover";
import { h, toast } from "../lib/dom";
import { renderTagChips } from "../lib/tags";
import { replacePath } from "../router";
import { store, StoreError, type BookMeta } from "../store";

const POPULAR_TAGS = 15;

type SortKey = "recommended" | "new" | "popular";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "recommended", label: "おすすめ" },
  { key: "new", label: "新着" },
  { key: "popular", label: "人気" },
];
/** 履歴（history.state）に、選んでいる並べ方を書いておくときの名前（戻ったときに同じ並べ方にする） */
const SORT_STATE_KEY = "noveruExploreSort";

const DAY = 24 * 60 * 60 * 1000;

/**
 * おすすめの点数：いいねが多いほど高く、更新してから日が経つほど下がる。
 *   新しい作品はいいねが0でも上のほうに出て、いいねの多い作品はしばらく上に残る。
 */
function recommendScore(b: BookMeta, now: number): number {
  const days = Math.max(0, now - b.updatedAt) / DAY;
  return ((b.likeCount ?? 0) + 1) / Math.pow(days + 2, 1.5);
}

function sortBooks(books: BookMeta[], key: SortKey): BookMeta[] {
  const byNew = (a: BookMeta, b: BookMeta) => b.updatedAt - a.updatedAt;
  if (key === "new") return [...books].sort(byNew);
  if (key === "popular") return [...books].sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0) || byNew(a, b));
  const now = Date.now();
  const score = new Map(books.map((b) => [b, recommendScore(b, now)]));
  return [...books].sort((a, b) => score.get(b)! - score.get(a)! || byNew(a, b));
}

function savedSort(): SortKey {
  const v = (history.state as Record<string, unknown> | null)?.[SORT_STATE_KEY];
  return SORTS.some((s) => s.key === v) ? (v as SortKey) : "recommended";
}

/** 比べるための形にそろえる（全角半角・大文字小文字・カタカナひらがなの違いをなくす） */
function fold(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

interface SearchQuery {
  tags: string[];
  words: string[];
}

function parseQuery(text: string): SearchQuery {
  const q: SearchQuery = { tags: [], words: [] };
  for (const raw of text.normalize("NFKC").split(/\s+/)) {
    if (!raw) continue;
    if (raw.startsWith("#")) {
      const tag = raw.replace(/^#+/, "");
      if (tag) q.tags.push(fold(tag));
    } else {
      q.words.push(fold(raw));
    }
  }
  return q;
}

function matches(b: BookMeta, q: SearchQuery): boolean {
  const tags = b.tags.map(fold);
  if (!q.tags.every((t) => tags.includes(t))) return false;
  const text = fold(`${b.title} ${b.titleReading} ${b.author} ${b.synopsis}`);
  return q.words.every((w) => text.includes(w));
}

export function explorePage(app: HTMLElement, params: Record<string, string>) {
  const me = store.currentUser();
  let all: BookMeta[] = [];
  let shown: BookMeta[] = [];
  let left = false;
  let timer = 0;
  let sort = savedSort();

  const input = h("input", {
    class: "search-input",
    type: "search",
    value: params.q ?? "",
    placeholder: "作品名・あらすじの言葉、または #タグ で探す",
    "aria-label": "作品を探す",
    autocomplete: "off",
  });
  const popular = h("div", { class: "popular-tags" });
  const note = h("p", { class: "loading" }, "読み込み中…");
  const count = h("span", { class: "works-sort-label" });
  const grid = h("div", { class: "cover-grid" });
  const reloadBtn = h("button", { class: "btn", type: "button", onclick: () => load() }, "再読み込み");
  const sortButtons = SORTS.map(({ key, label }) =>
    h(
      "button",
      {
        class: "sort-switch-btn",
        type: "button",
        onclick: () => {
          sort = key;
          history.replaceState({ ...((history.state as object | null) ?? {}), [SORT_STATE_KEY]: key }, "");
          drawSort();
          draw();
        },
      },
      label,
    ),
  );
  const drawSort = () =>
    sortButtons.forEach((btn, i) => btn.setAttribute("aria-pressed", String(SORTS[i].key === sort)));
  drawSort();

  app.append(
    h(
      "div",
      { class: "mypage" },
      h(
        "div",
        { class: "page-toolbar" },
        h("h1", { class: "page-title" }, "探す", count),
        h(
          "div",
          { class: "toolbar-buttons" },
          h("div", { class: "sort-switch", role: "group", "aria-label": "並べ方" }, ...sortButtons),
          reloadBtn,
        ),
      ),
      h("div", { class: "search-box" }, input),
      popular,
      note,
      grid,
    ),
  );

  const draw = () => {
    const text = input.value.trim();
    const q = parseQuery(text);
    shown = sortBooks(
      all.filter((b) => matches(b, q)),
      sort,
    );
    count.textContent = text ? `${shown.length}件` : `${all.length}作品`;
    note.hidden = shown.length > 0;
    note.textContent = all.length === 0 ? "まだ公開されている作品はありません。" : "見つかりませんでした。";
    grid.replaceChildren(
      ...shown.map((b) =>
        h(
          "a",
          {
            class: "cover-item",
            "data-book-id": b.id,
            href: `#/read/${encodeURIComponent(b.ownerId)}/${encodeURIComponent(b.id)}`,
          },
          renderCover(b),
          h("span", { class: "cover-caption" }, displayTitle(b)),
          b.author ? h("span", { class: "cover-sub" }, b.author) : null,
        ),
      ),
    );
  };

  /** よく使われているタグ（押すとそのタグで探す） */
  const drawPopular = () => {
    const counts = new Map<string, number>();
    for (const b of all) for (const t of b.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, POPULAR_TAGS)
      .map(([t]) => t);
    const chips = renderTagChips(top, false);
    popular.replaceChildren(...(chips ? [h("span", { class: "popular-label" }, "よく使われているタグ"), chips] : []));
    popular.querySelectorAll<HTMLElement>(".tag-chip").forEach((chip) => {
      chip.setAttribute("role", "button");
      chip.tabIndex = 0;
      chip.addEventListener("click", () => {
        input.value = chip.textContent ?? "";
        onSearch();
      });
    });
  };

  const onSearch = () => {
    const text = input.value.trim();
    replacePath(text ? `/explore/${encodeURIComponent(text)}` : "/explore");
    draw();
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(onSearch, 200);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(timer);
      onSearch();
    }
  });

  /** 作品を読み込む（「再読み込み」でも呼ぶ。新しく公開された作品も出る） */
  const load = (first = false) => {
    reloadBtn.disabled = true;
    return store
      .listPublicBooks()
      .then((list) => {
        if (left) return;
        // 自分の作品は出さない（ほかの人の作品を探すところなので）
        all = list.filter((b) => b.ownerId !== me?.uid);
        drawPopular();
        draw();
        if (first) reopenBookInfo(findShown);
      })
      .catch((e) => {
        if (first) note.textContent = e instanceof StoreError ? e.message : "作品を読み込めませんでした。";
        else toast(e instanceof StoreError ? e.message : "作品を読み込めませんでした。");
      })
      .finally(() => (reloadBtn.disabled = false));
  };

  const findShown = (id: string) => shown.find((b) => b.id === id);
  const stopTips = enableBookTips(grid, findShown);
  const stopInfo = enableBookInfo(grid, findShown);
  load(true);
  input.focus({ preventScroll: true });

  return () => {
    left = true;
    clearTimeout(timer);
    stopTips();
    stopInfo();
  };
}
