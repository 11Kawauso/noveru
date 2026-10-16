// 左上の「← 戻る」。1つ前の画面に戻る（前の画面がないときは fallback へ）

import { canGoBack } from "../router";
import { h } from "./dom";

export function backLink(fallback: string | null, className = ""): HTMLElement | null {
  if (!canGoBack() && !fallback) return null;
  return h(
    "a",
    {
      class: className || null,
      href: `#${fallback ?? "/"}`,
      onclick: (e: Event) => {
        if (canGoBack()) {
          e.preventDefault();
          history.back();
        }
      },
    },
    "← 戻る",
  );
}
