// いいね（♡）ボタン。押すといいね／取り消し。数も表示する

import { navigate } from "../router";
import { store, StoreError } from "../store";
import { h, toast } from "./dom";

export function createLikeButton(ownerId: string, bookId: string): HTMLButtonElement {
  let liked = false;
  let count = 0;
  let busy = false;

  const heart = h("span", { class: "like-heart", "aria-hidden": "true" });
  const num = h("span", { class: "like-count" });
  const btn = h("button", { class: "like-btn", type: "button", disabled: true }, heart, num);

  const draw = () => {
    heart.textContent = liked ? "♥" : "♡";
    num.textContent = String(count);
    btn.classList.toggle("liked", liked);
    btn.setAttribute("aria-pressed", String(liked));
    btn.title = liked ? "いいねを取り消す" : "いいね";
  };

  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (busy) return;
    if (!store.currentUser()) {
      toast("いいねするにはログインしてください。");
      navigate("/login");
      return;
    }
    // 先に見た目を変えてから保存する（うまくいかなければ元に戻す）
    busy = true;
    liked = !liked;
    count += liked ? 1 : -1;
    draw();
    try {
      await store.setLiked(ownerId, bookId, liked);
    } catch (err) {
      liked = !liked;
      count += liked ? 1 : -1;
      draw();
      toast(err instanceof StoreError ? err.message : "いいねできませんでした。");
    } finally {
      busy = false;
    }
  });

  draw();
  store
    .getLikeInfo(ownerId, bookId)
    .then((info) => {
      liked = info.liked;
      count = info.count;
      draw();
    })
    .catch(() => {})
    .finally(() => (btn.disabled = false));

  return btn;
}
