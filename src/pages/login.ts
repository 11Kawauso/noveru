// ログイン／新規登録／パスワード再設定の画面

import { h, toast } from "../lib/dom";
import { navigate } from "../router";
import { store, StoreError } from "../store";

type Mode = "login" | "signup" | "reset";

export function loginPage(app: HTMLElement) {
  if (store.currentUser()) {
    navigate("/");
    return;
  }

  // ログイン画面では左のメニューを出さない
  document.body.classList.add("no-rail");

  let mode: Mode = "login";
  const box = h("div", { class: "login-box" });
  app.append(
    h(
      "div",
      { class: "login-page" },
      h("h1", { class: "login-logo" }, "noveru"),
      h("p", { class: "login-lead" }, "書いて、並べて、読んでもらう。"),
      box,
    ),
  );

  const draw = () => {
    const email = h("input", { type: "email", autocomplete: "email", required: true });
    const password = h("input", {
      type: "password",
      autocomplete: mode === "signup" ? "new-password" : "current-password",
      minlength: 6,
      required: true,
    });
    const penName = h("input", { type: "text", maxlength: 40, required: true });
    const error = h("p", { class: "form-error", role: "alert" });
    const submit = h(
      "button",
      { class: "btn btn-primary btn-wide", type: "submit" },
      { login: "ログイン", signup: "登録する", reset: "再設定のメールを送る" }[mode],
    );

    const form = h(
      "form",
      {
        class: "form",
        onsubmit: async (e: Event) => {
          e.preventDefault();
          error.textContent = "";
          submit.disabled = true;
          try {
            if (mode === "login") {
              await store.signIn(email.value.trim(), password.value);
              navigate("/");
            } else if (mode === "signup") {
              const name = penName.value.trim();
              if (!name) throw new StoreError("ペンネームを入力してください。");
              await store.signUp(email.value.trim(), password.value, name);
              navigate("/");
            } else {
              await store.sendPasswordReset(email.value.trim());
              toast("再設定のメールを送りました。メールを確認してください。");
              mode = "login";
              draw();
            }
          } catch (err) {
            error.textContent = err instanceof StoreError ? err.message : "うまくいきませんでした。";
          } finally {
            submit.disabled = false;
          }
        },
      },
      mode === "signup"
        ? h("label", { class: "field" }, h("span", {}, "ペンネーム"), penName)
        : null,
      h("label", { class: "field" }, h("span", {}, "メールアドレス"), email),
      mode !== "reset"
        ? h(
            "label",
            { class: "field" },
            h("span", {}, mode === "signup" ? "パスワード（6文字以上）" : "パスワード"),
            password,
          )
        : h("p", { class: "form-note" }, "登録したメールアドレスに、パスワードを決め直すためのメールを送ります。"),
      error,
      submit,
    );

    const link = (label: string, to: Mode) =>
      h(
        "button",
        {
          class: "link-btn",
          type: "button",
          onclick: () => {
            mode = to;
            draw();
          },
        },
        label,
      );

    box.replaceChildren(
      h(
        "h2",
        { class: "login-title" },
        { login: "ログイン", signup: "新しく登録", reset: "パスワードを忘れたとき" }[mode],
      ),
      form,
      h(
        "div",
        { class: "login-links" },
        mode === "login" ? link("はじめての方は 新しく登録", "signup") : link("ログインに戻る", "login"),
        mode === "login" ? link("パスワードを忘れたとき", "reset") : null,
      ),
    );
    (mode === "signup" ? penName : email).focus();
  };

  draw();

  return () => document.body.classList.remove("no-rail");
}
