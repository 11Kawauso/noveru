// 保存まわりで使う「データの形」をまとめたファイル

export interface User {
  uid: string;
  email: string;
  penName: string;
  /** アイコン画像（data URL）。なければ null */
  icon: string | null;
}

/** アカウントページに出す情報（誰でも見られる） */
export interface Profile {
  penName: string;
  /** プロフィール（自己紹介の文） */
  bio: string;
  /** アイコン画像（data URL）。なければ null */
  icon: string | null;
}

/** 本棚や表紙の一覧で使う情報（本文は含まない） */
export interface BookMeta {
  id: string;
  ownerId: string;
  title: string;
  /** タイトルの読み（ひらがな）。あいうえお順に並べるときに使う。空ならタイトルのまま */
  titleReading: string;
  author: string;
  vertical: boolean;
  /** タグ（「#」なし） */
  tags: string[];
  /** あらすじ（300字まで） */
  synopsis: string;
  /** true なら本棚から出して表紙を向けて並べている */
  displayed: boolean;
  /** 公開中に並べた順番（小さいほど先） */
  displayOrder: number;
  /** 本棚の中での順番（小さいほど左） */
  shelfOrder: number;
  /** 圧縮した表紙画像（data URL）。なければ null */
  cover: string | null;
  /** 作った日時（ミリ秒） */
  createdAt: number;
  updatedAt: number;
  /** いいねの数（「探す」の一覧でだけ入る。並べ替えに使う） */
  likeCount?: number;
}

export interface Book extends BookMeta {
  body: string;
}

/** 書く画面から保存するときに渡す内容 */
export interface BookInput {
  title: string;
  titleReading: string;
  tags: string[];
  synopsis: string;
  author: string;
  body: string;
  vertical: boolean;
  cover: string | null;
}

export interface Store {
  /** true ならお試しモード（ブラウザの中だけに保存） */
  readonly demo: boolean;

  /** ログイン状態が変わるたびに呼ばれる。最初の1回はページを開いた直後に呼ばれる */
  onUserChanged(cb: (user: User | null) => void): void;
  currentUser(): User | null;

  signUp(email: string, password: string, penName: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;

  getProfile(uid: string): Promise<Profile | null>;
  /** 自分のペンネーム・プロフィール・アイコンを変える */
  updateProfile(profile: Profile): Promise<void>;

  /** 自分の本を全部（本棚の本も並べた本も） */
  listMyBooks(): Promise<BookMeta[]>;
  /** ある人が並べている本だけ（公開ページ用） */
  listDisplayedBooks(uid: string): Promise<BookMeta[]>;
  /** 「探す」用：みんなの公開中の作品（新しく更新された順・いいねの数つき）。表紙は小さい画像 */
  listPublicBooks(): Promise<BookMeta[]>;
  getBook(uid: string, bookId: string): Promise<Book | null>;

  /** 新しい本なら id を省略。保存した本の id を返す */
  saveBook(input: BookInput, bookId?: string): Promise<string>;
  setDisplayed(bookId: string, displayed: boolean): Promise<void>;
  /** 表紙だけを変える（null なら画像なしの表紙） */
  updateCover(bookId: string, cover: string | null): Promise<void>;
  /** 本の置き場所（本棚／公開中）と順番をまとめて変える */
  arrangeBooks(changes: BookPlacement[]): Promise<void>;
  deleteBook(bookId: string): Promise<void>;

  /** いいねの数と、自分がいいねしているか */
  getLikeInfo(ownerId: string, bookId: string): Promise<LikeInfo>;
  /** いいねする／やめる（ログインが必要） */
  setLiked(ownerId: string, bookId: string, liked: boolean): Promise<void>;
  /** 自分がいいねした本（新しい順）。非公開になった本は入らない */
  listLikedBooks(): Promise<BookMeta[]>;

  /** 本を読んだことを閲覧履歴に残す（ログインしているときだけ） */
  recordView(ownerId: string, bookId: string): Promise<void>;
  /** 閲覧履歴（新しい順）。非公開になった本は入らない */
  listHistory(): Promise<HistoryEntry[]>;
  clearHistory(): Promise<void>;
}

export interface LikeInfo {
  /** いいねの数（全員分） */
  count: number;
  /** 自分がいいねしているか */
  liked: boolean;
}

/** 閲覧履歴の1件 */
export interface HistoryEntry {
  book: BookMeta;
  viewedAt: number;
}

/** 本の置き場所と順番の変更（ドラッグで並べ替えたとき） */
export interface BookPlacement {
  id: string;
  displayed: boolean;
  /** displayed が true なら公開中での順番、false なら本棚での順番 */
  order: number;
  /** 本棚 ⇄ 公開中 を移ったとき true */
  moved?: boolean;
}

/** 画面に出すためのエラー（メッセージは日本語） */
export class StoreError extends Error {}
