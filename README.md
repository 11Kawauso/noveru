# noveru

手軽に小説を書いて、本棚に並べて見せられるサイト。仕様は [SPEC.md](SPEC.md) を見てください。

## 手元で動かす

```bash
npm install
npm run dev
```

表示された `http://localhost:5173` を開きます。
Firebase をまだ設定していないときは「お試しモード」で動き、データはそのブラウザの中だけに保存されます。

## Firebase の準備（はじめに1回だけ）

1. [Firebase コンソール](https://console.firebase.google.com/) で新しいプロジェクトを作る（Google アナリティクスはなしで大丈夫）。
2. 左のメニュー「構築」→「Authentication」→「始める」→「ログイン方法」で **メール / パスワード** を有効にする。
3. 「構築」→「Firestore Database」→「データベースを作成」。場所は `asia-northeast1`（東京）、「本番環境モード」で作る。
4. Firestore の「ルール」タブを開き、このフォルダの [firestore.rules](firestore.rules) の中身を全部貼り付けて「公開」。
5. 歯車マーク →「プロジェクトの設定」→「マイアプリ」でウェブアプリ（`</>` のマーク）を追加する。
   表示された `firebaseConfig` の値を [src/firebase-config.ts](src/firebase-config.ts) に貼り付ける。
6. 「Authentication」→「設定」→「承認済みドメイン」に、公開先の `ユーザー名.github.io` を追加する。

## GitHub Pages で公開する（はじめに1回だけ）

1. GitHub のリポジトリの「Settings」→「Pages」→「Build and deployment」の Source を **GitHub Actions** にする。
2. `main` ブランチに送る（push する）と、自動で組み立てて公開されます（数分かかります）。
   進み具合はリポジトリの「Actions」タブで見られます。

## ファイルの役割

| ファイル | 役割 |
|---|---|
| `index.html` | ページの土台 |
| `src/main.ts` | はじめに動く。ヘッダーと画面の切り替えの準備 |
| `src/router.ts` | URL を見て、どの画面を出すか決める |
| `src/pages/` | 画面ごとのファイル（ログイン・本棚・書く・読む・公開ページ） |
| `src/lib/reader.ts` | 読む画面の本体（ページ分け・ページめくり） |
| `src/lib/ruby.ts` | ふりがな・傍点の書き方を変換する |
| `src/lib/image.ts` | 表紙の画像を小さくする |
| `src/lib/cover.ts` | 表紙と背表紙の見た目 |
| `src/store/` | データの保存（Firebase とお試しモード） |
| `src/styles/` | 見た目（色・文字・レイアウト） |
| `firestore.rules` | 他人のデータを書き換えられないようにする Firebase のルール |
| `.github/workflows/deploy.yml` | GitHub Pages への自動公開 |
