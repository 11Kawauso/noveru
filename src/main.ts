// はじめに読み込まれるファイル。見た目・ヘッダー・画面の切り替えを準備する

import "./styles/base.css";
import "./styles/login.css";
import "./styles/shelf.css";
import "./styles/editor.css";
import "./styles/reader.css";

import { h } from "./lib/dom";
import { getTheme, toggleTheme } from "./lib/theme";
import { loginPage } from "./pages/login";
import { myPage } from "./pages/mypage";
import { notFoundPage } from "./pages/notfound";
import { publicPage } from "./pages/public";
import { readPage } from "./pages/read";
import { writePage } from "./pages/write";
import { addRoute, navigate, setNotFound, startRouter } from "./router";
import { store, type User } from "./store";

function renderHeader(user: User | null) {
  const right = document.getElementById("header-right")!;
  const themeBtn = h(
    "button",
    {
      class: "btn btn-ghost",
      title: "色合いを切り替える",
      onclick: () => {
        toggleTheme();
        themeBtn.textContent = themeLabel();
      },
    },
    themeLabel(),
  );
  const userName = user ? h("span", { class: "header-user" }, user.penName || user.email) : null;
  right.replaceChildren(
    themeBtn,
    ...(userName ? [userName] : []),
    user
      ? h(
          "button",
          {
            class: "btn btn-ghost",
            onclick: async () => {
              await store.signOut();
              navigate("/login");
            },
          },
          "ログアウト",
        )
      : h("a", { class: "btn btn-ghost", href: "#/login" }, "ログイン"),
  );
}

function themeLabel() {
  return getTheme() === "dark" ? "☀ 明るく" : "☾ 暗く";
}

addRoute("/", myPage);
addRoute("/login", loginPage);
addRoute("/write/new", writePage);
addRoute("/write/:id", writePage);
addRoute("/read/:uid/:id", readPage);
addRoute("/u/:uid", publicPage);
setNotFound(notFoundPage);

if (store.demo) document.getElementById("demo-banner")!.hidden = false;

let started = false;
store.onUserChanged((user) => {
  renderHeader(user);
  if (!started) {
    started = true;
    startRouter();
  }
});
