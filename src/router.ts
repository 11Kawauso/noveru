// URL の # のあと（#/write/xxx など）を見て、どの画面を出すか決める
// GitHub Pages でも動くように、ページの切り替えは # で行う。

export type Cleanup = (() => void) | void;
export type PageFn = (app: HTMLElement, params: Record<string, string>) => Cleanup;

interface Route {
  pattern: RegExp;
  keys: string[];
  page: PageFn;
}

const routes: Route[] = [];
let notFound: PageFn = () => {};
let cleanup: Cleanup;
let currentHash = "";
let ignoreNext = false;
/** このタブでアプリを開いてから何ページ目か（0 が最初のページ）。「戻る」に使う */
let pageIndex = -1;

/** この関数が false を返すあいだは、ほかの画面に移る前に確認する */
let leaveGuard: (() => boolean) | null = null;

export function addRoute(path: string, page: PageFn) {
  const keys: string[] = [];
  const re = path.replace(/:(\w+)/g, (_, k: string) => {
    keys.push(k);
    return "([^/]+)";
  });
  routes.push({ pattern: new RegExp(`^${re}$`), keys, page });
}

export function setNotFound(page: PageFn) {
  notFound = page;
}

export function setLeaveGuard(fn: (() => boolean) | null) {
  leaveGuard = fn;
}

export function navigate(path: string) {
  location.hash = path;
}

/** 画面を作り直さずに URL だけ書き換える（新しい本を保存したときなど） */
export function replacePath(path: string) {
  history.replaceState(history.state, "", `#${path}`);
  currentHash = location.hash;
}

function currentPath(): string {
  return location.hash.replace(/^#/, "") || "/";
}

export function render() {
  const app = document.getElementById("app")!;
  if (typeof cleanup === "function") cleanup();
  cleanup = undefined;
  leaveGuard = null;
  app.replaceChildren();
  window.scrollTo(0, 0);
  currentHash = location.hash;
  rememberPageIndex();

  const path = currentPath();
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      cleanup = r.page(app, params);
      return;
    }
  }
  cleanup = notFound(app, {});
}

/** 履歴の1件ごとに「何ページ目か」を書いておく（戻ったときは書いてある番号に戻る） */
function rememberPageIndex() {
  const state = history.state as { noveruIndex?: number } | null;
  if (typeof state?.noveruIndex === "number") {
    pageIndex = state.noveruIndex;
  } else {
    pageIndex += 1;
    history.replaceState({ ...(state ?? {}), noveruIndex: pageIndex }, "");
  }
}

/** このアプリの中で、1つ前の画面に戻れるか */
export function canGoBack(): boolean {
  return pageIndex > 0;
}

export function startRouter() {
  window.addEventListener("hashchange", () => {
    if (ignoreNext) {
      ignoreNext = false;
      return;
    }
    if (leaveGuard && !leaveGuard()) {
      if (!confirm("保存していない変更があります。このページを離れますか？")) {
        ignoreNext = true;
        location.hash = currentHash;
        return;
      }
    }
    render();
  });
  window.addEventListener("beforeunload", (e) => {
    if (leaveGuard && !leaveGuard()) e.preventDefault();
  });
  render();
}
