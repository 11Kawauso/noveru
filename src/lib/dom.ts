// 画面の部品を作るための小さな道具

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown>;

/**
 * 要素を作る。
 *   h("button", { class: "btn", onclick: () => ... }, "押す")
 * on で始まる属性はイベント、それ以外は属性として設定する。
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (k === "class") {
      el.className = String(v);
    } else if (k === "value" || k === "checked") {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else if (v === true) {
      el.setAttribute(k, "");
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let toastTimer = 0;

/** 画面の下に短いお知らせを出す */
export function toast(message: string) {
  const el = document.getElementById("toast")!;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 2600);
}

/**
 * 画面の真ん中に小窓を出す。閉じる関数を返す。
 * 背景をクリックするか Esc キーで閉じる。
 */
export function openDialog(content: HTMLElement, onClose?: () => void): () => void {
  const backdrop = h("div", { class: "dialog-backdrop" }, h("div", { class: "dialog", role: "dialog" }, content));
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    // 小窓が重なっているときは、一番上の小窓だけを閉じる
    const top = Array.from(document.querySelectorAll(".dialog-backdrop")).pop();
    if (e.key === "Escape" && top === backdrop) close();
  };
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  return close;
}

/** 「はい／いいえ」の確認。はいなら true */
export function confirmDialog(message: string, okLabel = "はい", danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const close = openDialog(
      h(
        "div",
        { class: "confirm" },
        h("p", {}, message),
        h(
          "div",
          { class: "dialog-buttons" },
          h("button", { class: "btn", onclick: () => close() }, "やめる"),
          h(
            "button",
            {
              class: danger ? "btn btn-danger" : "btn btn-primary",
              onclick: () => {
                result = true;
                close();
              },
            },
            okLabel,
          ),
        ),
      ),
      () => resolve(result),
    );
  });
}
