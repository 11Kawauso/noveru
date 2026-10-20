// 書く画面：タイトル・作者・本文を書いて、表紙を選んで保存する
//   書いているあいだは、左のメニューの代わりに3つのパネルを出す。
//     左の細いパネル：書く道具（戻る・向き・字数・拡大縮小・書き方・プレビュー・保存）
//     その右：タイトル・作者の欄と目次（writerOutline.ts）
//     画面の右：表紙とページの一覧（writerPages.ts）
//   画面がせまいときは、目次とページは道具のボタンで出し入れする。スマホでは道具は上に並ぶ。

import { backLink } from "../lib/backLink";
import { caretRect } from "../lib/caret";
import { renderCover } from "../lib/cover";
import { h, openDialog, toast } from "../lib/dom";
import { compressCover } from "../lib/image";
import { createZoomControl, getZoom, onZoomChange } from "../lib/pageZoom";
import { createReader } from "../lib/reader";
import { withScrollThumb } from "../lib/scrollThumb";
import { MAX_TAGS, parseTags, renderTagChips, tagsToText } from "../lib/tags";
import { createOutlinePanel } from "../lib/writerOutline";
import { createPagesPanel } from "../lib/writerPages";
import { navigate, replacePath, setLeaveGuard } from "../router";
import { store, StoreError, type BookInput, type BookMeta } from "../store";

const MAX_SYNOPSIS = 300;

// 道具のボタンの、線で描いた小さなアイコン（中身は固定の文字列）
const TOOL_ICONS = {
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  outline:
    '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  pages: '<rect x="7" y="3" width="12" height="15" rx="1"/><path d="M5 7v13a1 1 0 0 0 1 1h10"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17.5v.01"/>',
  preview:
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
};

function toolIcon(name: keyof typeof TOOL_ICONS): HTMLElement {
  const span = h("span", { class: "tool-icon", "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${TOOL_ICONS[name]}</svg>`;
  return span;
}

/** 道具のボタン（アイコンと小さな文字） */
function toolButton(name: keyof typeof TOOL_ICONS, label: string, onclick: () => void, cls = ""): HTMLButtonElement {
  return h(
    "button",
    { class: `tool-btn ${cls}`.trim(), type: "button", onclick },
    toolIcon(name),
    h("span", { class: "tool-label" }, label),
  );
}

// 1作品に保存できる本文の文字数（Firestore の1件あたりの上限から決めた値）
const MAX_CHARS = 300_000;

export function writePage(app: HTMLElement, params: Record<string, string>) {
  const user = store.currentUser();
  if (!user) {
    navigate("/login");
    return;
  }

  let bookId: string | undefined = params.id;
  let vertical = true;
  let cover: string | null = null;
  let titleReading = "";
  let tags: string[] = [];
  let synopsis = "";
  let saved = ""; // 最後に保存した内容（変更があるか調べるため）
  let saving = false;
  let started = false; // 紙を出して書き始めたか（新しい本は向きを選んでから）

  const title = h("input", { type: "text", placeholder: "タイトル", maxlength: 100 });
  const author = h("input", { type: "text", placeholder: "作者", maxlength: 60 });
  const body = h("textarea", { class: "w-body", placeholder: "ここから本文を書きます", spellcheck: false });
  const paper = h("div", { class: "paper" }, body);
  const scroller = h("div", { class: "writer-scroll" }, paper);
  const count = h("span", { class: "char-count" });

  // 書く向きは新しく書くときに決めて、あとからは変えられない（表示だけ）
  const dirBadge = h("span", { class: "dir-badge", title: "書く向きは、新しく書くときに決めます" });

  /** 本文の pos 文字目へ飛んで、そこにカーソルを置く */
  const jumpTo = (pos: number) => {
    closeDrawers();
    pos = Math.max(0, Math.min(pos, body.value.length));
    body.focus({ preventScroll: true });
    body.setSelectionRange(pos, pos);
    const r = caretRect(body, pos);
    if (vertical) {
      // その行が、見えている範囲の右寄りに来るようにする
      const box = scroller.getBoundingClientRect();
      scroller.scrollBy({ left: r.right - (box.right - box.width * 0.2) });
    } else {
      window.scrollBy({ top: r.top - window.innerHeight * 0.3 });
    }
    markCurrent();
  };
  /** 書き始め（本文の先頭）へ */
  const jumpToStart = () => {
    closeDrawers();
    if (vertical) scroller.scrollLeft = scroller.scrollWidth;
    window.scrollTo({ top: 0 });
    body.focus({ preventScroll: true });
    body.setSelectionRange(0, 0);
    markCurrent();
  };

  const outline = createOutlinePanel({ title, author, body, jump: jumpTo });
  const pagesPanel = createPagesPanel({
    book: () => ({ title: title.value, author: author.value, body: body.value, vertical }),
    meta: () => currentMeta(cover),
    jump: jumpTo,
    jumpToStart,
  });

  /** 画面がせまいときに、目次・ページのパネルを出し入れする */
  const toggleDrawer = (el: HTMLElement) => {
    const open = !el.classList.contains("is-open");
    closeDrawers();
    el.classList.toggle("is-open", open);
  };
  const closeDrawers = () => {
    outline.el.classList.remove("is-open");
    pagesPanel.el.classList.remove("is-open");
  };

  /** カーソルのある場所に合わせて、目次の章・節と、ページの一覧のいまの場所を目立たせる */
  const markCurrent = () => {
    const active = document.activeElement;
    const pos = active === title || active === author ? null : body.selectionStart;
    outline.markCurrent(pos);
    pagesPanel.markCurrent(pos);
  };

  const back = backLink("/write", "tool-btn");
  back?.replaceChildren(toolIcon("back"), h("span", { class: "tool-label" }, "戻る"));

  const panel = h(
    "aside",
    { class: "writer-panel", "aria-label": "書く道具" },
    back,
    h("div", { class: "writer-info" }, dirBadge, count),
    createZoomControl(),
    toolButton("outline", "目次", () => toggleDrawer(outline.el), "drawer-toggle outline-toggle"),
    toolButton("pages", "ページ", () => toggleDrawer(pagesPanel.el), "drawer-toggle pages-toggle"),
    h("div", { class: "writer-panel-spacer" }),
    toolButton("help", "書き方", () => showHelp()),
    toolButton("preview", "プレビュー", () => showPreview()),
    toolButton("save", "保存", () => openSaveDialog(), "is-primary"),
  );

  const writer = h("div", { class: "writer", hidden: !bookId }, scroller);
  app.append(writer);
  writer.addEventListener("pointerdown", closeDrawers);

  body.addEventListener("input", () => {
    outline.update();
    pagesPanel.schedule();
    markCurrent();
  });
  for (const field of [title, author]) {
    field.addEventListener("input", () => pagesPanel.refreshTitle());
    field.addEventListener("focus", markCurrent);
  }
  const onSelection = () => document.activeElement === body && markCurrent();
  document.addEventListener("selectionchange", onSelection);

  /** 表紙を描くための、いまの本の情報 */
  const currentMeta = (coverImage: string | null): BookMeta => ({
    id: bookId ?? "new",
    ownerId: user.uid,
    title: title.value,
    titleReading,
    tags: [],
    synopsis: "",
    author: author.value,
    vertical,
    displayed: false,
    displayOrder: 0,
    shelfOrder: 0,
    cover: coverImage,
    createdAt: 0,
    updatedAt: 0,
  });

  const snapshot = () =>
    JSON.stringify([title.value, titleReading, tags, synopsis, author.value, body.value, vertical, cover]);
  const isClean = () => !started || snapshot() === saved;
  const input = (): BookInput => ({
    title: title.value.trim(),
    titleReading: titleReading.trim(),
    tags,
    synopsis: synopsis.trim(),
    author: author.value.trim(),
    body: body.value,
    vertical,
    cover,
  });

  /** 本文の量に合わせて紙を伸ばす（縦書きは横へ、横書きは下へ） */
  const grow = () => {
    if (vertical) {
      body.style.height = "";
      body.style.width = "0px";
      body.style.width = `${body.scrollWidth}px`;
    } else {
      body.style.width = "";
      body.style.height = "0px";
      body.style.height = `${body.scrollHeight}px`;
    }
    const n = body.value.replace(/\n/g, "").length;
    count.textContent = `${n.toLocaleString()}字`;
    count.classList.toggle("over", n > MAX_CHARS);
  };

  const setDirection = (v: boolean) => {
    vertical = v;
    paper.classList.toggle("is-vertical", v);
    scroller.classList.toggle("is-vertical", v);
    dirBadge.textContent = v ? "縦書き" : "横書き";
    grow();
    // 縦書きは右端（書き始め）が見えるようにする
    scroller.scrollLeft = v ? scroller.scrollWidth : 0;
  };

  body.addEventListener("input", grow);

  // 縦書きの紙は横に伸びるので、マウスのホイール（上下）で左右に動けるようにする
  // （スクロールバーを出していないため）。下に回すと先（左）へ進む
  scroller.addEventListener(
    "wheel",
    (e) => {
      if (!vertical || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      e.preventDefault();
      scroller.scrollLeft -= e.deltaY;
    },
    { passive: false },
  );
  window.addEventListener("resize", grow);
  // 拡大縮小：紙をまるごと大きく／小さくする（1行の字数は変わらない）
  const applyZoom = () => {
    paper.style.zoom = String(getZoom());
    grow();
  };
  const stopZoom = onZoomChange(applyZoom);
  applyZoom();

  const save = async (): Promise<boolean> => {
    if (saving) return false;
    const data = input();
    if (data.body.replace(/\n/g, "").length > MAX_CHARS) {
      toast(`本文が長すぎます（${MAX_CHARS.toLocaleString()}字まで）。作品を分けてください。`);
      return false;
    }
    saving = true;
    try {
      const isNew = !bookId;
      bookId = await store.saveBook(data, bookId);
      saved = snapshot();
      if (isNew) replacePath(`/write/${encodeURIComponent(bookId)}`);
      toast(isNew ? "保存しました。本棚に入りました。" : "保存しました。");
      return true;
    } catch (e) {
      toast(e instanceof StoreError ? e.message : "保存できませんでした。");
      return false;
    } finally {
      saving = false;
    }
  };

  /** 保存の小窓：タイトルの読み・タグ・表紙の画像を決めて保存する */
  const openSaveDialog = () => {
    let draftCover = cover;
    const tagsInput = h("input", {
      type: "text",
      value: tagsToText(tags),
      placeholder: "例：#ファンタジー #短編",
      autocomplete: "off",
    });
    const tagsPreview = h("div", { class: "tags-preview" });
    const drawTags = () => tagsPreview.replaceChildren(renderTagChips(parseTags(tagsInput.value), false) ?? "");
    tagsInput.addEventListener("input", drawTags);
    drawTags();
    const synopsisInput = h("textarea", { class: "synopsis-input", maxlength: MAX_SYNOPSIS, rows: 4 });
    synopsisInput.value = synopsis;
    const synopsisCount = h("small", { class: "form-note" });
    const drawSynopsisCount = () => (synopsisCount.textContent = `${synopsisInput.value.length} / ${MAX_SYNOPSIS}字`);
    synopsisInput.addEventListener("input", drawSynopsisCount);
    drawSynopsisCount();
    const readingInput = h("input", {
      type: "text",
      value: titleReading,
      maxlength: 200,
      placeholder: "例：なつのおわりに",
      autocomplete: "off",
    });
    const previewBox = h("div", { class: "save-cover" });
    const removeBtn = h("button", { class: "btn btn-ghost", type: "button" }, "画像を外す");
    const fileInput = h("input", { type: "file", accept: "image/*", hidden: true });
    const error = h("p", { class: "form-error" });

    const drawPreview = () => {
      previewBox.replaceChildren(renderCover(currentMeta(draftCover)));
      removeBtn.hidden = !draftCover;
    };

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      error.textContent = "";
      try {
        draftCover = await compressCover(file);
        drawPreview();
      } catch (e) {
        error.textContent = e instanceof Error ? e.message : "画像を読み込めませんでした。";
      }
    });
    removeBtn.addEventListener("click", () => {
      draftCover = null;
      drawPreview();
    });

    const saveBtn = h(
      "button",
      {
        class: "btn btn-primary",
        onclick: async () => {
          const prevCover = cover;
          const prevReading = titleReading;
          const prevTags = tags;
          const prevSynopsis = synopsis;
          synopsis = synopsisInput.value.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
          cover = draftCover;
          titleReading = readingInput.value;
          tags = parseTags(tagsInput.value);
          saveBtn.disabled = true;
          const ok = await save();
          saveBtn.disabled = false;
          if (ok) {
            close();
            pagesPanel.refreshTitle(); // 表紙が変わったかもしれないので
          } else {
            cover = prevCover;
            titleReading = prevReading;
            tags = prevTags;
            synopsis = prevSynopsis;
          }
        },
      },
      bookId ? "保存する" : "保存して本棚に入れる",
    );

    const close = openDialog(
      h(
        "div",
        { class: "save-dialog" },
        h("h2", {}, "保存"),
        h(
          "label",
          { class: "field save-reading" },
          h("span", {}, "タイトルの読み（ひらがな）"),
          readingInput,
          h("small", { class: "form-note" }, "あいうえお順に並べるときに使います。空欄ならタイトルのまま並びます。"),
        ),
        h(
          "label",
          { class: "field save-reading" },
          h("span", {}, `タグ（${MAX_TAGS}個まで）`),
          tagsInput,
          tagsPreview,
          h("small", { class: "form-note" }, "空白で区切って書きます。「探す」でタグから作品を見つけてもらえます。"),
        ),
        h(
          "label",
          { class: "field save-reading" },
          h("span", {}, "あらすじ"),
          withScrollThumb(synopsisInput, "bio-input-wrap"),
          synopsisCount,
        ),
        h(
          "div",
          { class: "save-body" },
          previewBox,
          h(
            "div",
            { class: "save-side" },
            h("p", { class: "form-note" }, "表紙にする画像を選べます。選ばなければ、タイトルと作者を書いた表紙になります。"),
            h("button", { class: "btn", type: "button", onclick: () => fileInput.click() }, "画像を選ぶ"),
            removeBtn,
            fileInput,
          ),
        ),
        error,
        h("div", { class: "dialog-buttons" }, h("button", { class: "btn", onclick: () => close() }, "やめる"), saveBtn),
      ),
    );
    drawPreview();
  };

  let closePreview: (() => void) | null = null;
  const showPreview = () => {
    const overlay = h("div", { class: "preview-overlay" });
    closePreview = () => {
      reader.destroy();
      overlay.remove();
      closePreview = null;
    };
    const reader = createReader(input(), { onClose: closePreview });
    overlay.append(reader.el);
    document.body.append(overlay);
  };

  const showHelp = () => {
    const row = (code: string, desc: string) => h("tr", {}, h("td", {}, h("code", {}, code)), h("td", {}, desc));
    openDialog(
      h(
        "div",
        { class: "help" },
        h("h2", {}, "書き方"),
        h(
          "table",
          { class: "help-table" },
          row("|漢字《かんじ》", "「漢字」にふりがな"),
          row("漢字《かんじ》", "直前の漢字にふりがな（| は省略できます）"),
          row("《《強調》》", "「強調」に傍点"),
          row("|《", "《 をそのまま表示"),
          row("# 第一章", "章の見出し（行の先頭に書く）。読むときは新しいページから始まる"),
          row("## その一", "節の見出し"),
        ),
        h(
          "p",
          { class: "form-note" },
          "| は全角の ｜、# は全角の ＃ でも大丈夫です。見出しは目次に並び、押すとその行へ飛べます。改行すると段落が分かれます。Ctrl + S でも保存できます。",
        ),
      ),
    );
  };

  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (!started) return;
      if (document.querySelector(".dialog-backdrop, .preview-overlay")) return;
      if (bookId) save();
      else openSaveDialog();
    }
  };
  document.addEventListener("keydown", onKey);
  setLeaveGuard(isClean);

  const start = (data: {
    title: string;
    titleReading: string;
    tags: string[];
    synopsis: string;
    author: string;
    body: string;
    vertical: boolean;
    cover: string | null;
  }) => {
    title.value = data.title;
    titleReading = data.titleReading;
    tags = data.tags;
    synopsis = data.synopsis;
    author.value = data.author;
    body.value = data.body;
    cover = data.cover;
    writer.hidden = false;
    // 左のメニューを隠して、書く道具・目次・ページのパネルを出す（スマホでは道具が上に出るので、ページの一番前に置く）
    document.body.prepend(panel);
    document.body.append(outline.el, pagesPanel.el);
    document.body.classList.add("is-writing");
    setDirection(data.vertical);
    started = true;
    saved = snapshot();
    outline.update();
    pagesPanel.schedule();
    // タイトルがまだなければタイトルの欄から（目次のパネルをしまっているときは本文から）
    if (!data.title) title.focus({ preventScroll: true });
    if (document.activeElement !== title) body.focus({ preventScroll: true });
    markCurrent();
  };

  if (bookId) {
    paper.classList.add("is-loading");
    store
      .getBook(user.uid, bookId)
      .then((b) => {
        paper.classList.remove("is-loading");
        if (!b) {
          toast("本が見つかりませんでした。");
          navigate("/");
          return;
        }
        start(b);
      })
      .catch((e) => {
        toast(e instanceof StoreError ? e.message : "読み込めませんでした。");
        navigate("/");
      });
  } else {
    // 新しい本：はじめに縦書きか横書きかを選ぶ
    const choice = (v: boolean) =>
      h(
        "button",
        {
          class: "dir-choice",
          onclick: () => {
            chooser.remove();
            start({ title: "", titleReading: "", tags: [], synopsis: "", author: user.penName, body: "", vertical: v, cover: null });
          },
        },
        h("div", { class: `dir-sample ${v ? "is-vertical" : "is-horizontal"}`, "aria-hidden": "true" }),
        h("strong", {}, v ? "縦書き" : "横書き"),
        h("span", {}, v ? "右から左へ書きます。紙は横に伸びます。" : "上から下へ書きます。紙は下に伸びます。"),
      );
    const chooser = h(
      "div",
      { class: "dir-chooser" },
      h("h1", { class: "page-title" }, "どちらで書きますか？"),
      h("p", { class: "form-note" }, "書く向きは、あとから変えられません。"),
      h("div", { class: "dir-choices" }, choice(true), choice(false)),
      h("a", { class: "btn btn-ghost", href: "#/write" }, "やめる"),
    );
    app.append(chooser);
  }

  return () => {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", grow);
    stopZoom();
    closePreview?.();
    document.removeEventListener("selectionchange", onSelection);
    pagesPanel.destroy();
    panel.remove();
    outline.el.remove();
    pagesPanel.el.remove();
    document.body.classList.remove("is-writing");
  };
}
