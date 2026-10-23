// 書く画面：タイトル・作者・本文を書いて、表紙を選んで保存する
//   書いているあいだは、左のメニューの代わりに3つのパネルを出す。
//     左の細いパネル：書く道具（戻る・向き・字数・書き方・プレビュー・保存）
//     その右：タイトル・作者の欄と目次（writerOutline.ts）
//     真ん中：表紙・タイトルのページ・本文のページを縦に並べた紙（pagedEditor.ts）。右側にスクロールバーと拡大縮小
//     画面の右：表紙とページの一覧（writerPages.ts）
//   画面がせまいときは、目次とページは道具のボタンで出し入れする。スマホでは道具は上に並ぶ。

import { backLink } from "../lib/backLink";
import { renderCover } from "../lib/cover";
import { confirmDialog, h, openDialog, toast } from "../lib/dom";
import { compressCover } from "../lib/image";
import { createPagedEditor } from "../lib/pagedEditor";
import { createZoomControl, enableGestureZoom, getZoom, onZoomChange } from "../lib/pageZoom";
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
  // ふりがな：字の上に小さな字
  ruby: '<path d="M7 4.5h10"/><rect x="6" y="9" width="12" height="11" rx="1.5"/><path d="M9.5 13h5M12 13v4.5"/>',
  // 傍点：字の上に点
  bouten: '<circle cx="12" cy="4.5" r="1.3" fill="currentColor"/><rect x="6" y="9" width="12" height="11" rx="1.5"/>',
  // 見出し：太い線と細い線
  heading: '<path d="M5 6h14" stroke-width="3"/><path d="M5 12h10M5 17h12"/>',
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

/** 本文の字に付けるボタン（押しても本文のカーソルと選んだ字がそのままになるように） */
function formatButton(name: keyof typeof TOOL_ICONS, label: string, title: string, onclick: () => void) {
  const btn = toolButton(name, label, onclick, "is-format");
  btn.title = title;
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  return btn;
}

// ふりがなを付けられる長さ（ruby.ts の書き方の決まりに合わせる）
const MAX_RUBY_BASE = 20;
const MAX_RUBY_TEXT = 30;

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
  /** 右のページの一覧で、描き直しを待っているページ（書いている途中は少し待ってからまとめて） */
  const thumbTimers = new Map<number, number>();

  const editor = createPagedEditor({
    scroller,
    title: () => ({ title: title.value, author: author.value }),
    meta: () => currentMeta(cover),
    onChange: (page) => {
      drawCount();
      outline.update();
      scrollbar.update();
      if (page === null) {
        pagesPanel.render();
        return;
      }
      clearTimeout(thumbTimers.get(page));
      thumbTimers.set(
        page,
        window.setTimeout(() => {
          thumbTimers.delete(page);
          pagesPanel.updatePage(page);
        }, 300),
      );
    },
    onCurrent: (index, caret) => {
      currentPage = index;
      pagesPanel.markCurrent(index);
      outline.markCurrent(caret);
    },
    // 真ん中のタイトルのページで書いたら、左のパネルの欄・右のページの一覧・表紙にも入れる
    onTitleInput: (value) => {
      title.value = value.title;
      author.value = value.author;
      pagesPanel.refreshTitle();
      drawCoverPreview();
      editor.refreshTitle();
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

  // ---- 表紙とあらすじ（タイトルの上） ----

  const coverPreview = h("div", { class: "outline-cover-preview" });
  const coverFile = h("input", { type: "file", accept: "image/*", hidden: true });
  const coverRemove = h("button", { class: "outline-small-btn", type: "button" }, "画像を外す");
  const drawCoverPreview = () => {
    coverPreview.replaceChildren(renderCover(currentMeta(cover)));
    coverRemove.hidden = !cover;
  };
  /** 表紙が変わったら、真ん中の紙と右のページの一覧の表紙も描き直す */
  const coverChanged = () => {
    drawCoverPreview();
    editor.refreshTitle();
    pagesPanel.refreshTitle();
  };
  coverFile.addEventListener("change", async () => {
    const file = coverFile.files?.[0];
    coverFile.value = "";
    if (!file) return;
    try {
      cover = await compressCover(file);
      coverChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "画像を読み込めませんでした。");
    }
  });
  coverRemove.addEventListener("click", () => {
    cover = null;
    coverChanged();
  });
  const coverField = h(
    "div",
    { class: "outline-field" },
    h("span", {}, "表紙"),
    h(
      "div",
      { class: "outline-cover" },
      coverPreview,
      h(
        "div",
        { class: "outline-cover-side" },
        h("button", { class: "outline-small-btn", type: "button", onclick: () => coverFile.click() }, "画像を選ぶ"),
        coverRemove,
        coverFile,
        h("p", { class: "outline-cover-note" }, "選ばなければ、タイトルと作者を書いた表紙になります。"),
      ),
    ),
  );

  const synopsisInput = h("textarea", {
    class: "synopsis-input outline-synopsis",
    maxlength: MAX_SYNOPSIS,
    placeholder: "どんなお話か、短く書いておくと、読む人が選びやすくなります。",
  });
  const synopsisCount = h("small", { class: "outline-count" });
  const drawSynopsisCount = () => (synopsisCount.textContent = `${synopsisInput.value.length} / ${MAX_SYNOPSIS}字`);
  synopsisInput.addEventListener("input", () => {
    synopsis = synopsisInput.value;
    drawSynopsisCount();
  });
  const synopsisField = h(
    "label",
    { class: "outline-field" },
    h("span", {}, "あらすじ"),
    withScrollThumb(synopsisInput, "bio-input-wrap"),
    synopsisCount,
  );

  const outline = createOutlinePanel({ title, author, editor, jump: jumpTo, top: [coverField, synopsisField] });
  const pagesPanel = createPagesPanel({
    meta: () => currentMeta(cover),
    title: () => ({ title: title.value, author: author.value }),
    vertical: () => vertical,
    pageCount: () => editor.pageCount(),
    pageText: (i) => editor.pageText(i),
    jumpToPage,
    addPage: () => {
      closeDrawers();
      editor.addPage();
    },
    deletePage: async (i) => {
      if (editor.pageText(i).trim()) {
        const ok = await confirmDialog(`${i + 2}ページを消しますか？\nこのページに書いた文も消えます。`, "消す", true);
        if (!ok) return;
      }
      editor.deletePage(i);
    },
    movePage: (from, to) => editor.movePage(from, to),
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

  // ---- ふりがな・傍点・見出しのボタン（記号を覚えなくても付けられる） ----

  /** 選んだ字にふりがなを付ける（小窓で読みを聞く） */
  const addRuby = () => {
    const base = editor.selectedText();
    if (!base) return toast("ふりがなを付けたい字を、本文で選んでから押してください。");
    if (base.includes("\n") || Array.from(base).length > MAX_RUBY_BASE) {
      return toast(`ふりがなは、1行の中の${MAX_RUBY_BASE}字までの言葉に付けられます。`);
    }
    const restore = editor.rememberSelection();
    const reading = h("input", {
      type: "text",
      maxlength: MAX_RUBY_TEXT,
      placeholder: "例：かんじ",
      autocomplete: "off",
    });
    const error = h("p", { class: "form-error" });
    const ok = () => {
      const r = reading.value.trim();
      if (!r) {
        error.textContent = "ふりがなを入力してください。";
        return;
      }
      if (/[《》\n]/.test(r)) {
        error.textContent = "ふりがなに《 》は使えません。";
        return;
      }
      close();
      restore();
      editor.wrapSelection((s) => `|${s}《${r}》`);
    };
    reading.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        ok();
      }
    });
    const close = openDialog(
      h(
        "div",
        { class: "ruby-dialog" },
        h("h2", {}, "ふりがなを付ける"),
        h("p", { class: "ruby-dialog-base" }, base),
        h("label", { class: "field" }, h("span", {}, "ふりがな"), reading),
        error,
        h(
          "div",
          { class: "dialog-buttons" },
          h("button", { class: "btn", onclick: () => close() }, "やめる"),
          h("button", { class: "btn btn-primary", onclick: ok }, "付ける"),
        ),
      ),
      () => restore(),
    );
    reading.focus();
  };

  /** 選んだ字に傍点（・）を付ける */
  const addBouten = () => {
    const text = editor.selectedText();
    if (!text) return toast("傍点を付けたい字を、本文で選んでから押してください。");
    if (text.includes("\n")) return toast("傍点は、1行の中の字に付けられます。");
    editor.wrapSelection((s) => `《《${s}》》`);
  };

  const back = backLink("/write", "tool-btn");
  back?.replaceChildren(toolIcon("back"), h("span", { class: "tool-label" }, "戻る"));

  const panel = h(
    "aside",
    { class: "writer-panel", "aria-label": "書く道具" },
    back,
    h("div", { class: "writer-info" }, dirBadge, count),
    h(
      "div",
      { class: "tool-group", role: "group", "aria-label": "本文の字に付ける" },
      formatButton("ruby", "ふりがな", "選んだ字にふりがなを付ける", addRuby),
      formatButton("bouten", "傍点", "選んだ字に傍点（・）を付ける", addBouten),
      formatButton("heading", "見出し", "カーソルのある行を見出しにする（もう一度押すと戻す）", () =>
        outline.markLine(1),
      ),
    ),
    toolButton("outline", "目次", () => toggleDrawer(outline.el), "drawer-toggle outline-toggle"),
    toolButton("pages", "ページ", () => toggleDrawer(pagesPanel.el), "drawer-toggle pages-toggle"),
    h("div", { class: "writer-panel-spacer" }),
    toolButton("help", "書き方", () => showHelp()),
    toolButton("preview", "プレビュー", () => showPreview()),
    toolButton("save", "保存", () => openSaveDialog(), "is-primary"),
  );

  // 紙の右側：縦に長いスクロールバーと、その下（右下）に拡大縮小
  const scrollbar = createScrollbar(scroller, {
    label: () => (currentPage === 0 ? "表紙" : `${currentPage} / ${editor.pageCount() + 1}`),
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
    field.addEventListener("input", () => {
      editor.refreshTitle();
      pagesPanel.refreshTitle();
      drawCoverPreview();
    });
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
    synopsis: synopsis
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
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
  // 縦書きは紙が横に並ぶので、高さも入るようにする（上下にもスクロールしなくていいように）
  const applyZoom = () => {
    const root = getComputedStyle(document.documentElement);
    const pageW = parseFloat(root.getPropertyValue("--page-w")) || 440;
    const pageH = parseFloat(root.getPropertyValue("--page-h")) || 624;
    const roomW = scroller.clientWidth - 32;
    // 上下の余白・ページの番号・下のスクロールバーの分をのぞいた高さ
    const roomH = scroller.clientHeight - 150;
    let fit = roomW > 0 ? Math.min(1, roomW / pageW) : 1;
    if (vertical && roomH > 0) fit = Math.min(fit, roomH / pageH);
    editor.setZoom(getZoom() * fit);
  };
  const stopZoom = onZoomChange(applyZoom);
  window.addEventListener("resize", applyZoom);
  // 紙の上での指のピンチ・Ctrl ＋ ホイールでも拡大縮小できる
  const stopGestureZoom = enableGestureZoom(scroller, editor.el);

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
    if (!started) return; // ページができるまでは保存しない
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
    const readingInput = h("input", {
      type: "text",
      value: titleReading,
      maxlength: 200,
      placeholder: "例：なつのおわりに",
      autocomplete: "off",
    });
    const saveBtn = h(
      "button",
      {
        class: "btn btn-primary",
        onclick: async () => {
          const prevReading = titleReading;
          const prevTags = tags;
          titleReading = readingInput.value;
          tags = parseTags(tagsInput.value);
          saveBtn.disabled = true;
          const ok = await save();
          saveBtn.disabled = false;
          if (ok) close();
          else {
            titleReading = prevReading;
            tags = prevTags;
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
        h("p", { class: "form-note" }, "表紙とあらすじは、左のパネルのいちばん上で変えられます。"),
        h("div", { class: "dialog-buttons" }, h("button", { class: "btn", onclick: () => close() }, "やめる"), saveBtn),
      ),
    );
  };

  let closePreview: (() => void) | null = null;
  const showPreview = () => {
    const overlay = h("div", { class: "preview-overlay" });
    closePreview = () => {
      reader.destroy();
      overlay.remove();
      closePreview = null;
    };
    const reader = createReader(input(), {
      back: h("button", { class: "reader-back", type: "button", onclick: () => closePreview?.() }, "← 閉じる"),
      cover: renderCover(currentMeta(cover)),
      extra: [h("p", { class: "reader-preview-note" }, "プレビュー：読む人には、このように見えます。")],
      onClose: () => closePreview?.(),
    });
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
          "ul",
          { class: "help-list" },
          h("li", {}, "思いついたことを、そのまま書いていきましょう。改行すると段落が分かれます。"),
          h(
            "li",
            {},
            "ページは、右の「＋ ページを足す」で足せます。1ページにいくらでも書けて、読む人はページをめくって読みます。ページの × で消したり、ドラッグで順番を入れ替えたりもできます。",
          ),
          h(
            "li",
            {},
            "ふりがな・傍点は、字を選んでから左の「ふりがな」「傍点」を押すと付けられます。見出しは、行にカーソルを置いて「見出し」を押します。",
          ),
        ),
        h("p", { class: "help-sub" }, "記号で書くこともできます："),
        h(
          "table",
          { class: "help-table" },
          row("|漢字《かんじ》", "「漢字」にふりがな"),
          row("漢字《かんじ》", "直前の漢字にふりがな（| は省略できます）"),
          row("《《強調》》", "「強調」に傍点"),
          row("|《", "《 をそのまま表示"),
          row("# 見出し", "見出し（行の先頭に書く）"),
          row("## 小見出し", "小見出し"),
        ),
        h(
          "p",
          { class: "form-note" },
          "| は全角の ｜、# は全角の ＃ でも大丈夫です。見出しは目次に並び、押すとその行へ飛べます。Ctrl + S でも保存できます。",
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
    synopsisInput.value = data.synopsis;
    drawSynopsisCount();
    drawCoverPreview();
    writer.hidden = false;
    // 左のメニューを隠して、書く道具・目次・ページのパネルを出す（スマホでは道具が上に出るので、ページの一番前に置く）
    document.body.prepend(panel);
    document.body.append(outline.el, pagesPanel.el);
    document.body.classList.add("is-writing");
    // 縦書きは紙が右から左へ並ぶので、スクロールバーも横にする
    scrollbar.setAxis(vertical ? "x" : "y");
    applyZoom();
    writer.classList.add("is-loading");
    editor.load(data.body, data.vertical).then(() => {
      // ページができてから書き始め（それまでは本文が空なので、保存もしない）。
      // ページを自分で足す前に保存した作品は、ここでページに分かれるが、まだ変更とはみなさない
      started = true;
      saved = snapshot();
      drawCount();
      outline.update();
      pagesPanel.render();
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
            start({
              title: "",
              titleReading: "",
              tags: [],
              synopsis: "",
              author: user.penName,
              body: "",
              vertical: v,
              cover: null,
            });
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
      h("p", { class: "form-note" }, "書く向きは、あとから変えられません。迷ったら、横書きが書きやすくておすすめです。"),
      h("div", { class: "dir-choices" }, choice(true), choice(false)),
      h("a", { class: "btn btn-ghost", href: "#/write" }, "やめる"),
    );
    app.append(chooser);
  }

  return () => {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", applyZoom);
    stopZoom();
    stopGestureZoom();
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
