import { h } from "../lib/dom";

export function notFoundPage(app: HTMLElement) {
  app.append(
    h(
      "div",
      { class: "message-page" },
      h("p", {}, "ページが見つかりませんでした。"),
      h("a", { class: "btn", href: "#/" }, "トップへ戻る"),
    ),
  );
}
