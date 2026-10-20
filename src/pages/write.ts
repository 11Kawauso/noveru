// 書く画面：タイトル・作者・本文を書いて、表紙を選んで保存する
//   書いているあいだは、左のメニューの代わりに3つのパネルを出す。
//     左の細いパネル：書く道具（戻る・向き・字数・書き方・プレビュー・保存）
//     その右：タイトル・作者の欄と目次（writerOutline.ts）
//     真ん中：表紙・タイトルのページ・本文のページを縦に並べた紙（pagedEditor.ts）。右側にスクロールバーと拡大縮小
//     画面の右：表紙とページの一覧（writerPages.ts）
//   画面がせまいときは、目次とページは道具のボタンで出し入れする。スマホでは道具は上に並ぶ。

import { backLink } from "../lib/backLink";
import { renderCover } from "../lib/cover";
import { h, openDialog, toast } from "../lib/dom";
import { compressCover } from "../lib/image";
import { createPagedEditor } from "../lib/pagedEditor";
import { createZoomControl, getZoom, onZoomChange } from "../lib/pageZoom";
import { createReader } from "../lib/reader";
import { createScrollbar } from "../lib/scrollbar";
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
  const scroller = h("div", { class: "writer-scroll" });
  const count = h("span", { class: "char-count" });

  // 書く向きは新しく書くときに決めて、あとからは変えられない（表示だけ）
  const dirBadge = h("span", { class: "dir-badge", title: "書く向きは、新しく書くときに決めます" });

  /** いまのページ（0：表紙、1：タイトル、2〜：本文） */
  let currentPage = 0;

  const editor = createPagedEditor({
    scroller,
    title: () => ({ title: title.value, author: author.value }),
    meta: () => currentMeta(cover),
    onChange: () => {
      drawCount();
      outline.update();
    },
    onPages: (pages, from) => {
      pagesPanel.setPages(pages, from, vertical);
      scrollbar.update();
    },
    onCurrent: (index, caret) => {
      currentPage = index;
      pagesPanel.markCurrent(index);
      outline.markCurrent(caret);
    },
    onTitleClick: () => {
      // 目次のパネルをしまっているときは出してから
      if (getComputedStyle(outline.el).visibility === "hidden") toggleDrawer(outline.el);
      title.focus();
    },
  });
  scroller.append(editor.el);

  /** 本文の pos 文字目へ飛ぶ（目次から） */
  const jumpTo = (pos: number) => {
    closeDrawers();
    editor.jumpTo(pos);
  };
  /** そのページへ飛ぶ（ページの一覧から） */
  const jumpToPage = (index: number) => {
    closeDrawers();
    editor.jumpToPage(index);
  };

  const outline = createOutlinePanel({ title, author, editor, jump: jumpTo });
  const pagesPanel = createPagesPanel({ meta: () => currentMeta(cover), jumpToPage });

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

  const back = backLink("/write", "tool-btn");
  back?.replaceChildren(toolIcon("back"), h("span", { class: "tool-label" }, "戻る"));

  const panel = h(
    "aside",
    { class: "writer-panel", "aria-label": "書く道具" },
    back,
    h("div", { class: "writer-info" }, dirBadge, count),
    toolButton("outline", "目次", () => toggleDrawer(outline.el), "drawer-toggle outline-toggle"),
    toolButton("pages", "ページ", () => toggleDrawer(pagesPanel.el), "drawer-toggle pages-toggle"),
    h("div", { class: "writer-panel-spacer" }),
    toolButton("help", "書き方", () => showHelp()),
    toolButton("preview", "プレビュー", () => showPreview()),
    toolButton("save", "保存", () => openSaveDialog(), "is-primary"),
  );

  // 紙の右側：縦に長いスクロールバーと、その下（右下）に拡大縮小
  const scrollbar = createScrollbar(scroller, {
    label: () => {
      const total = editor.readerPages().length;
      return currentPage === 0 ? "表紙" : `${currentPage} / ${total}`;
    },
  });
  const writer = h(
    "div",
    { class: "writer", hidden: !bookId },
    scroller,
    scrollbar.el,
    h("div", { class: "writer-zoom" }, createZoomControl()),
  );
  app.append(writer);
  writer.addEventListener("pointerdown", closeDrawers);

  for (const field of [title, author]) {
    field.addEventListener("input", () => editor.refreshTitle());
    field.addEventListener("focus", () => {
      outline.markCurrent(null);
      pagesPanel.markCurrent(1);
    });
  }

  // スマホでは書く道具が上に並ぶので、紙はその下から（道具の高さは、2段になったりして変わる）
  const panelObserver = new ResizeObserver(() =>
    document.body.style.setProperty("--writer-top", `${panel.offsetHeight}px`),
  );
  panelObserver.observe(panel);

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
    JSON.stringify([title.value, titleReading, tags, synopsis, author.value, editor.getBody(), vertical, cover]);
  const isClean = () => !started || snapshot() === saved;
  const input = (): BookInput => ({
    title: title.value.trim(),
    titleReading: titleReading.trim(),
    tags,
    synopsis: synopsis.trim(),
    author: author.value.trim(),
    body: editor.getBody(),
    vertical,
    cover,
  });

  const drawCount = () => {
    const n = editor.getBody().replace(/\n/g, "").length;
    count.textContent = `${n.toLocaleString()}字`;
    count.classList.toggle("over", n > MAX_CHARS);
  };

  // 拡大縮小：紙をまるごと大きく／小さくする（1行の字数は変わらない）。
  // 画面がせまくて紙が入らないときは、入る大きさまで小さくしてから倍率をかける
  const applyZoom = () => {
    const pageW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--page-w")) || 440;
    const room = scroller.clientWidth - 32;
    const fit = room > 0 ? Math.min(1, room / pageW) : 1;
    editor.setZoom(getZoom() * fit);
  };
  const stopZoom = onZoomChange(applyZoom);
  window.addEventListener("resize", applyZoom);

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
            editor.refreshTitle(); // 表紙が変わったかもしれないので
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
    cover = data.cover;
    vertical = data.vertical;
    dirBadge.textContent = vertical ? "縦書き" : "横書き";
    writer.hidden = false;
    // 左のメニューを隠して、書く道具・目次・ページのパネルを出す（スマホでは道具が上に出るので、ページの一番前に置く）
    document.body.prepend(panel);
    document.body.append(outline.el, pagesPanel.el);
    document.body.classList.add("is-writing");
    applyZoom();
    writer.classList.add("is-loading");
    const loading = editor.load(data.body, data.vertical);
    started = true;
    saved = snapshot();
    drawCount();
    outline.update();
    loading.then(() => {
      writer.classList.remove("is-loading");
      // タイトルがまだなければタイトルの欄から（目次のパネルをしまっているときは本文の最初から）
      if (!data.title) title.focus({ preventScroll: true });
      if (document.activeElement !== title) editor.jumpToPage(2);
    });
  };

  if (bookId) {
    store
      .getBook(user.uid, bookId)
      .then((b) => {
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
        h("span", {}, v ? "文字は上から下へ、行は右から左へ書きます。" : "文字は左から右へ、行は上から下へ書きます。"),
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
    window.removeEventListener("resize", applyZoom);
    stopZoom();
    closePreview?.();
    editor.destroy();
    scrollbar.destroy();
    panelObserver.disconnect();
    document.body.style.removeProperty("--writer-top");
    panel.remove();
    outline.el.remove();
    pagesPanel.el.remove();
    document.body.classList.remove("is-writing");
  };
}
