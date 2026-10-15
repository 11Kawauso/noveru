// 書く画面：タイトル・作者・本文を書いて、表紙を選んで保存する

import { renderCover } from "../lib/cover";
import { h, openDialog, toast } from "../lib/dom";
import { compressCover } from "../lib/image";
import { createReader } from "../lib/reader";
import { navigate, replacePath, setLeaveGuard } from "../router";
import { store, StoreError, type BookInput, type BookMeta } from "../store";

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
  let saved = ""; // 最後に保存した内容（変更があるか調べるため）
  let saving = false;

  const title = h("input", { class: "w-title", type: "text", placeholder: "タイトル", maxlength: 100 });
  const author = h("input", { class: "w-author", type: "text", placeholder: "作者", maxlength: 60 });
  const body = h("textarea", { class: "w-body", placeholder: "ここから本文を書きます", spellcheck: false });
  const paper = h("div", { class: "paper" }, title, author, body);
  const scroller = h("div", { class: "writer-scroll" }, paper);
  const count = h("span", { class: "char-count" });

  const verticalBtn = h("button", { class: "seg-btn", onclick: () => setDirection(true) }, "縦書き");
  const horizontalBtn = h("button", { class: "seg-btn", onclick: () => setDirection(false) }, "横書き");

  const toolbar = h(
    "div",
    { class: "writer-toolbar" },
    h("a", { class: "btn btn-ghost", href: "#/" }, "← 本棚へ"),
    h("div", { class: "seg", role: "group", "aria-label": "書く向き" }, verticalBtn, horizontalBtn),
    count,
    h("div", { class: "toolbar-spacer" }),
    h("button", { class: "btn btn-ghost", onclick: () => showHelp() }, "書き方"),
    h("button", { class: "btn", onclick: () => showPreview() }, "プレビュー"),
    h("button", { class: "btn btn-primary", onclick: () => openSaveDialog() }, "保存"),
  );

  app.append(h("div", { class: "writer" }, toolbar, scroller));

  const snapshot = () => JSON.stringify([title.value, author.value, body.value, vertical, cover]);
  const isClean = () => snapshot() === saved;
  const input = (): BookInput => ({
    title: title.value.trim(),
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
    verticalBtn.classList.toggle("active", v);
    horizontalBtn.classList.toggle("active", !v);
    verticalBtn.setAttribute("aria-pressed", String(v));
    horizontalBtn.setAttribute("aria-pressed", String(!v));
    grow();
    // 縦書きは右端（書き始め）が見えるようにする
    scroller.scrollLeft = v ? scroller.scrollWidth : 0;
  };

  body.addEventListener("input", grow);
  window.addEventListener("resize", grow);

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

  /** 保存の小窓：表紙の画像を選んで保存する */
  const openSaveDialog = () => {
    let draftCover = cover;
    const previewBox = h("div", { class: "save-cover" });
    const removeBtn = h("button", { class: "btn btn-ghost", type: "button" }, "画像を外す");
    const fileInput = h("input", { type: "file", accept: "image/*", hidden: true });
    const error = h("p", { class: "form-error" });

    const drawPreview = () => {
      const meta: BookMeta = {
        id: bookId ?? "new",
        ownerId: user.uid,
        title: title.value,
        author: author.value,
        vertical,
        displayed: false,
        displayOrder: 0,
        cover: draftCover,
        updatedAt: 0,
      };
      previewBox.replaceChildren(renderCover(meta));
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
          cover = draftCover;
          saveBtn.disabled = true;
          const ok = await save();
          saveBtn.disabled = false;
          if (ok) close();
          else cover = prevCover;
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
        ),
        h("p", { class: "form-note" }, "| は全角の ｜ でも大丈夫です。改行すると段落が分かれます。Ctrl + S でも保存できます。"),
      ),
    );
  };

  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (document.querySelector(".dialog-backdrop, .preview-overlay")) return;
      if (bookId) save();
      else openSaveDialog();
    }
  };
  document.addEventListener("keydown", onKey);
  setLeaveGuard(isClean);

  const start = (data: { title: string; author: string; body: string; vertical: boolean; cover: string | null }) => {
    title.value = data.title;
    author.value = data.author;
    body.value = data.body;
    cover = data.cover;
    setDirection(data.vertical);
    saved = snapshot();
    (data.title ? body : title).focus({ preventScroll: true });
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
    start({ title: "", author: user.penName, body: "", vertical: true, cover: null });
  }

  return () => {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", grow);
    closePreview?.();
  };
}
