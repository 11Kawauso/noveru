// 自分の本を押したときに出るメニューの小窓（本棚・「書く」の作品一覧の両方で使う）
//   公開する／本棚に戻す・読む・編集・表紙を変える・削除

import { navigate } from "../router";
import { store, StoreError, type BookMeta } from "../store";
import { displayTitle, renderCover } from "./cover";
import { confirmDialog, h, openDialog, toast } from "./dom";
import { compressCover } from "./image";
import { createLikeButton } from "./likeButton";

export interface BookMenuOptions {
  /** 公開・削除・表紙の変更などのあとに呼ばれる（画面を読み込み直す） */
  onChanged: () => void | Promise<void>;
  /** 一番目立たせるボタン。本棚では「公開する」、作品一覧では「編集」 */
  primary?: "publish" | "edit";
}

export function openBookMenu(b: BookMeta, opts: BookMenuOptions) {
  const primary = opts.primary ?? "publish";
  const act = (label: string, fn: () => void | Promise<void>, cls = "btn") =>
    h(
      "button",
      {
        class: cls,
        onclick: async () => {
          close();
          try {
            await fn();
          } catch (e) {
            toast(e instanceof StoreError ? e.message : "うまくいきませんでした。");
          }
        },
      },
      label,
    );

  const publishBtn = b.displayed
    ? act("本棚に戻す（非公開）", async () => {
        await store.setDisplayed(b.id, false);
        await opts.onChanged();
        toast("本棚に戻しました（非公開）。");
      })
    : act(
        "公開する",
        async () => {
          await store.setDisplayed(b.id, true);
          await opts.onChanged();
          toast("公開しました。");
        },
        primary === "publish" ? "btn btn-primary" : "btn",
      );
  const editBtn = act(
    "編集",
    () => navigate(`/write/${encodeURIComponent(b.id)}`),
    primary === "edit" ? "btn btn-primary" : "btn",
  );
  const readBtn = act("読む", () => navigate(`/read/${encodeURIComponent(b.ownerId)}/${encodeURIComponent(b.id)}`));
  const coverBtn = act("表紙を変える", () => openCoverDialog(b, opts.onChanged));
  const deleteBtn = act(
    "削除",
    async () => {
      const ok = await confirmDialog(`「${displayTitle(b)}」を削除しますか？\n削除すると元に戻せません。`, "削除する", true);
      if (!ok) return;
      await store.deleteBook(b.id);
      await opts.onChanged();
      toast("削除しました。");
    },
    "btn btn-ghost btn-delete",
  );

  const buttons =
    primary === "edit"
      ? [editBtn, readBtn, coverBtn, publishBtn, deleteBtn]
      : [publishBtn, readBtn, editBtn, coverBtn, deleteBtn];

  const close = openDialog(
    h(
      "div",
      { class: "book-menu" },
      h("div", { class: "book-menu-cover" }, renderCover(b)),
      h(
        "div",
        { class: "book-menu-body" },
        h("h2", {}, displayTitle(b)),
        b.author ? h("p", { class: "book-menu-author" }, b.author) : null,
        h("div", { class: "book-menu-like" }, createLikeButton(b.ownerId, b.id)),
        h("div", { class: "book-menu-actions" }, ...buttons),
      ),
    ),
  );
}

/** 表紙だけを変える小窓 */
function openCoverDialog(b: BookMeta, onChanged: () => void | Promise<void>) {
  let draft = b.cover;
  const preview = h("div", { class: "save-cover" });
  const removeBtn = h("button", { class: "btn btn-ghost", type: "button" }, "画像を外す");
  const fileInput = h("input", { type: "file", accept: "image/*", hidden: true });
  const error = h("p", { class: "form-error" });

  const draw = () => {
    preview.replaceChildren(renderCover({ ...b, cover: draft }));
    removeBtn.hidden = !draft;
  };
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    error.textContent = "";
    try {
      draft = await compressCover(file);
      draw();
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : "画像を読み込めませんでした。";
    }
  });
  removeBtn.addEventListener("click", () => {
    draft = null;
    draw();
  });

  const saveBtn = h(
    "button",
    {
      class: "btn btn-primary",
      onclick: async () => {
        saveBtn.disabled = true;
        try {
          await store.updateCover(b.id, draft);
          close();
          await onChanged();
          toast("表紙を変えました。");
        } catch (e) {
          error.textContent = e instanceof StoreError ? e.message : "保存できませんでした。";
        } finally {
          saveBtn.disabled = false;
        }
      },
    },
    "保存する",
  );

  const close = openDialog(
    h(
      "div",
      { class: "save-dialog" },
      h("h2", {}, "表紙を変える"),
      h(
        "div",
        { class: "save-body" },
        preview,
        h(
          "div",
          { class: "save-side" },
          h("p", { class: "form-note" }, "画像を選ばなければ、タイトルと作者を書いた表紙になります。"),
          h("button", { class: "btn", type: "button", onclick: () => fileInput.click() }, "画像を選ぶ"),
          removeBtn,
          fileInput,
        ),
      ),
      error,
      h("div", { class: "dialog-buttons" }, h("button", { class: "btn", onclick: () => close() }, "やめる"), saveBtn),
    ),
  );
  draw();
}
