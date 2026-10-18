// はじめに読み込まれるファイル。見た目・左のメニュー・画面の切り替えを準備する

import "./styles/base.css";
import "./styles/login.css";
import "./styles/shelf.css";
import "./styles/editor.css";
import "./styles/reader.css";

import { historyPage, likesPage } from "./pages/bookList";
import { explorePage } from "./pages/explore";
import { loginPage } from "./pages/login";
import { myPage } from "./pages/mypage";
import { notFoundPage } from "./pages/notfound";
import { publicPage } from "./pages/public";
import { readPage } from "./pages/read";
import { worksPage } from "./pages/works";
import { writePage } from "./pages/write";
import { addRoute, navigate, setNotFound, startRouter } from "./router";
import { renderSidebar } from "./sidebar";
import { store } from "./store";

addRoute("/", myPage);
addRoute("/login", loginPage);
addRoute("/write", worksPage);
addRoute("/write/new", writePage);
addRoute("/write/:id", writePage);
addRoute("/read/:uid/:id", readPage);
addRoute("/u/:uid", publicPage);
addRoute("/explore", explorePage);
addRoute("/explore/:q", explorePage);
addRoute("/likes", likesPage);
addRoute("/history", historyPage);
setNotFound(notFoundPage);

if (store.demo) document.getElementById("demo-banner")!.hidden = false;

let started = false;
store.onUserChanged((user) => {
  renderSidebar(user);
  if (!started) {
    started = true;
    startRouter();
  } else if (user && location.hash.replace(/^#/, "") === "/login") {
    // ログインが終わったのにログイン画面のままなら、本棚へ
    navigate("/");
  }
});
