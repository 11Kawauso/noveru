// アカウントページ：アイコン・ペンネーム・プロフィールと、公開している作品（本棚は見せない）
// 自分のページなら「プロフィールを編集」ができる。

import { renderAvatar } from "../lib/avatar";
import { backLink } from "../lib/backLink";
import { enableBookTips } from "../lib/bookTip";
import { displayTitle, renderCover } from "../lib/cover";
import { confirmDialog, h, openDialog, toast } from "../lib/dom";
import { getTheme, toggleTheme } from "../lib/theme";
import { openIconCropper } from "../lib/iconCropper";
import { withScrollThumb } from "../lib/scrollThumb";
import type { BookMeta, Profile } from "../store";
import { store, StoreError } from "../store";
import { navigate } from "../router";
import { publicUrl } from "./mypage";

const MAX_BIO = 200;

/** 空行が続きすぎないようにする（空行は1つまで）。前後の空白も取る */
function tidyBio(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u3000]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function publicPage(app: HTMLElement, params: Record<string, string>) {
  const { uid } = params;
  const isMine = store.currentUser()?.uid === uid;
  let left = false;
  let shown: BookMeta[] = [];
  let profile: Profile | null = null;

  const head = h("div", { class: "account-head" });
  const worksTitle = h("h2", { class: "section-title" }, "公開している作品");
  const grid = h("div", { class: "cover-grid" });
  const note = h("p", { class: "loading" }, "読み込み中…");

  app.append(
    h(
      "div",
      { class: "public-page" },
      (() => {
        const back = backLink(isMine ? "/" : null);
        return back ? h("div", { class: "read-page-head" }, back) : null;
      })(),
      head,
      h("section", { class: "account-works" }, worksTitle, note, grid),
    ),
  );

  const drawHead = () => {
    if (!profile) return;
    const name = profile.penName || "名無し";
    document.title = `${name} - noveru`;
    head.replaceChildren(
      renderAvatar(name, profile.icon, 96),
      h(
        "div",
        { class: "account-info" },
        h("h1", { class: "account-name" }, name),
        profile.bio ? withScrollThumb(h("p", { class: "account-bio" }, profile.bio), "account-bio-wrap") : null,
        isMine
          ? h(
              "div",
              { class: "account-actions" },
              h("button", { class: "btn", onclick: () => openEditDialog() }, "プロフィールを編集"),
              h(
                "button",
                {
                  class: "btn btn-ghost",
                  onclick: async () => {
                    try {
                      await navigator.clipboard.writeText(publicUrl(uid));
                      toast("このページのURLをコピーしました。");
                    } catch {
                      toast(publicUrl(uid));
                    }
                  },
                },
                "URLをコピー",
              ),
              // スマホでは上のメニューに色合いの切り替えとログアウトがないので、ここに出す
              (() => {
                const btn: HTMLButtonElement = h("button", {
                  class: "btn btn-ghost mobile-only",
                  onclick: () => {
                    toggleTheme();
                    btn.textContent = getTheme() === "dark" ? "明るくする" : "暗くする";
                  },
                });
                btn.textContent = getTheme() === "dark" ? "明るくする" : "暗くする";
                return btn;
              })(),
              h(
                "button",
                {
                  class: "btn btn-ghost mobile-only",
                  onclick: async () => {
                    if (!(await confirmDialog("ログアウトしますか？", "ログアウト"))) return;
                    await store.signOut();
                    navigate("/login");
                  },
                },
                "ログアウト",
              ),
            )
          : null,
      ),
    );
  };

  /** プロフィールを編集する小窓（アイコン・ペンネーム・プロフィール） */
  const openEditDialog = () => {
    if (!profile) return;
    let draftIcon = profile.icon;
    const penName = h("input", { type: "text", maxlength: 40, value: profile.penName });
    const bio = h("textarea", { class: "bio-input", maxlength: MAX_BIO, rows: 5 });
    bio.value = profile.bio;
    const bioCount = h("small", { class: "form-note" });
    const drawCount = () => (bioCount.textContent = `${bio.value.length} / ${MAX_BIO}字`);
    bio.addEventListener("input", drawCount);
    drawCount();

    const iconBox = h("div", { class: "edit-icon" });
    const removeBtn = h("button", { class: "btn btn-ghost", type: "button" }, "画像を外す");
    const fileInput = h("input", { type: "file", accept: "image/*", hidden: true });
    const error = h("p", { class: "form-error" });
    const drawIcon = () => {
      iconBox.replaceChildren(renderAvatar(penName.value || "？", draftIcon, 88));
      removeBtn.hidden = !draftIcon;
    };
    penName.addEventListener("input", () => !draftIcon && drawIcon());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      error.textContent = "";
      try {
        const cropped = await openIconCropper(file);
        if (cropped) {
          draftIcon = cropped;
          drawIcon();
        }
      } catch (e) {
        error.textContent = e instanceof Error ? e.message : "画像を読み込めませんでした。";
      }
    });
    removeBtn.addEventListener("click", () => {
      draftIcon = null;
      drawIcon();
    });

    const saveBtn = h(
      "button",
      {
        class: "btn btn-primary",
        onclick: async () => {
          const name = penName.value.trim();
          if (!name) {
            error.textContent = "ペンネームを入力してください。";
            return;
          }
          saveBtn.disabled = true;
          try {
            const next: Profile = { penName: name, bio: tidyBio(bio.value), icon: draftIcon };
            await store.updateProfile(next);
            profile = next;
            drawHead();
            close();
            toast("プロフィールを保存しました。");
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
        { class: "edit-profile" },
        h("h2", {}, "プロフィールを編集"),
        h(
          "div",
          { class: "edit-icon-row" },
          iconBox,
          h(
            "div",
            { class: "save-side" },
            h("button", { class: "btn", type: "button", onclick: () => fileInput.click() }, "アイコンを選ぶ"),
            removeBtn,
            fileInput,
          ),
        ),
        h("label", { class: "field" }, h("span", {}, "ペンネーム"), penName),
        h("label", { class: "field" }, h("span", {}, "プロフィール"), withScrollThumb(bio, "bio-input-wrap"), bioCount),
        error,
        h("div", { class: "dialog-buttons" }, h("button", { class: "btn", onclick: () => close() }, "やめる"), saveBtn),
      ),
    );
    drawIcon();
  };

  Promise.all([store.getProfile(uid).catch(() => null), store.listDisplayedBooks(uid).catch(() => null)]).then(
    ([p, books]) => {
      if (left) return;
      if (!p && !books?.length) {
        note.textContent = "このページは見つかりませんでした。";
        worksTitle.remove();
        return;
      }
      profile = p ?? { penName: "", bio: "", icon: null };
      drawHead();
      worksTitle.textContent = `公開している作品（${books?.length ?? 0}）`;
      if (!books || books.length === 0) {
        note.textContent = "まだ公開している作品はありません。";
        return;
      }
      note.remove();
      shown = books;
      grid.replaceChildren(
        ...books.map((b) =>
          h(
            "a",
            { class: "cover-item", "data-book-id": b.id, href: `#/read/${encodeURIComponent(uid)}/${encodeURIComponent(b.id)}` },
            renderCover(b),
            h("span", { class: "cover-caption" }, displayTitle(b)),
          ),
        ),
      );
    },
  );

  const stopTips = enableBookTips(grid, (id) => shown.find((b) => b.id === id));

  return () => {
    left = true;
    stopTips();
    document.title = "noveru";
  };
}
