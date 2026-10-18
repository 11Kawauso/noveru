// お試しモード：Firebase の代わりにブラウザの中（localStorage）に保存する仕組み
// Firebase を設定する前に画面を試すためのもの。

import type { Book, BookInput, BookMeta, BookPlacement, HistoryEntry, LikeInfo, Profile, Store, User } from "./types";
import { StoreError } from "./types";

const KEY = "noveru-demo";

interface DemoAccount {
  uid: string;
  email: string;
  password: string;
  penName: string;
  bio?: string;
  icon?: string | null;
}

interface DemoMark {
  uid: string;
  ownerId: string;
  bookId: string;
  at: number;
}

interface DemoData {
  accounts: DemoAccount[];
  books: Book[];
  currentUid: string | null;
  likes?: DemoMark[];
  history?: DemoMark[];
}

function load(): DemoData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DemoData;
  } catch {
    /* 読めなければ空から始める */
  }
  return { accounts: [], books: [], currentUid: null };
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

function meta(b: Book): BookMeta {
  const { body: _body, ...rest } = b;
  return { ...rest, tags: rest.tags ?? [], titleReading: rest.titleReading ?? "", shelfOrder: rest.shelfOrder ?? -rest.updatedAt, createdAt: rest.createdAt ?? rest.updatedAt };
}

export class DemoStore implements Store {
  readonly demo = true;
  private data = load();
  private listeners: ((u: User | null) => void)[] = [];

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      throw new StoreError("ブラウザの保存領域がいっぱいです（お試しモードの制限）。");
    }
  }

  private emit() {
    const u = this.currentUser();
    for (const cb of this.listeners) cb(u);
  }

  onUserChanged(cb: (user: User | null) => void) {
    this.listeners.push(cb);
    cb(this.currentUser());
  }

  currentUser(): User | null {
    const a = this.data.accounts.find((x) => x.uid === this.data.currentUid);
    return a ? { uid: a.uid, email: a.email, penName: a.penName, icon: a.icon ?? null } : null;
  }

  private requireUser(): User {
    const u = this.currentUser();
    if (!u) throw new StoreError("ログインしてください。");
    return u;
  }

  async signUp(email: string, password: string, penName: string) {
    if (!email.includes("@")) throw new StoreError("メールアドレスの形が正しくありません。");
    if (password.length < 6) throw new StoreError("パスワードは6文字以上にしてください。");
    if (this.data.accounts.some((a) => a.email === email)) {
      throw new StoreError("このメールアドレスはすでに登録されています。");
    }
    const uid = makeId();
    this.data.accounts.push({ uid, email, password, penName });
    this.data.currentUid = uid;
    this.save();
    this.emit();
  }

  async signIn(email: string, password: string) {
    const a = this.data.accounts.find((x) => x.email === email && x.password === password);
    if (!a) throw new StoreError("メールアドレスかパスワードが違います。");
    this.data.currentUid = a.uid;
    this.save();
    this.emit();
  }

  async signOut() {
    this.data.currentUid = null;
    this.save();
    this.emit();
  }

  async sendPasswordReset(_email: string) {
    throw new StoreError("お試しモードではパスワードの再設定メールは送れません。");
  }

  async getProfile(uid: string): Promise<Profile | null> {
    const a = this.data.accounts.find((x) => x.uid === uid);
    return a ? { penName: a.penName, bio: a.bio ?? "", icon: a.icon ?? null } : null;
  }

  async updateProfile(profile: Profile) {
    const u = this.requireUser();
    const a = this.data.accounts.find((x) => x.uid === u.uid)!;
    Object.assign(a, profile);
    this.save();
    this.emit();
  }

  async listMyBooks() {
    const u = this.requireUser();
    return this.data.books.filter((b) => b.ownerId === u.uid).map(meta);
  }

  async listDisplayedBooks(uid: string) {
    return this.data.books
      .filter((b) => b.ownerId === uid && b.displayed)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(meta);
  }

  async listPublicBooks() {
    return this.data.books
      .filter((b) => b.displayed)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(meta);
  }

  async getBook(uid: string, bookId: string) {
    const b = this.data.books.find((x) => x.ownerId === uid && x.id === bookId);
    if (!b) return null;
    const u = this.currentUser();
    if (!b.displayed && u?.uid !== uid) return null;
    return { ...b };
  }

  async saveBook(input: BookInput, bookId?: string) {
    const u = this.requireUser();
    const now = Date.now();
    if (bookId) {
      const b = this.data.books.find((x) => x.ownerId === u.uid && x.id === bookId);
      if (!b) throw new StoreError("本が見つかりません。");
      Object.assign(b, input, { updatedAt: now });
    } else {
      bookId = makeId();
      this.data.books.push({
        ...input,
        id: bookId,
        ownerId: u.uid,
        displayed: false,
        displayOrder: 0,
        shelfOrder: -now,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.save();
    return bookId;
  }

  async setDisplayed(bookId: string, displayed: boolean) {
    const u = this.requireUser();
    const b = this.data.books.find((x) => x.ownerId === u.uid && x.id === bookId);
    if (!b) throw new StoreError("本が見つかりません。");
    b.displayed = displayed;
    if (displayed) b.displayOrder = Date.now();
    else b.shelfOrder = -Date.now();
    this.save();
  }

  async updateCover(bookId: string, cover: string | null) {
    const u = this.requireUser();
    const b = this.data.books.find((x) => x.ownerId === u.uid && x.id === bookId);
    if (!b) throw new StoreError("本が見つかりません。");
    b.cover = cover;
    b.updatedAt = Date.now();
    this.save();
  }

  async arrangeBooks(changes: BookPlacement[]) {
    const u = this.requireUser();
    for (const c of changes) {
      const b = this.data.books.find((x) => x.ownerId === u.uid && x.id === c.id);
      if (!b) continue;
      b.displayed = c.displayed;
      if (c.displayed) b.displayOrder = c.order;
      else b.shelfOrder = c.order;
    }
    this.save();
  }

  async deleteBook(bookId: string) {
    const u = this.requireUser();
    this.data.books = this.data.books.filter((x) => !(x.ownerId === u.uid && x.id === bookId));
    this.data.likes = (this.data.likes ?? []).filter((x) => !(x.ownerId === u.uid && x.bookId === bookId));
    this.save();
  }

  /** 自分が読める本（自分の本か、公開中の本） */
  private visibleMeta(ownerId: string, bookId: string): BookMeta | null {
    const b = this.data.books.find((x) => x.ownerId === ownerId && x.id === bookId);
    if (!b || (!b.displayed && b.ownerId !== this.currentUser()?.uid)) return null;
    return meta(b);
  }

  async getLikeInfo(ownerId: string, bookId: string): Promise<LikeInfo> {
    const likes = (this.data.likes ?? []).filter((x) => x.ownerId === ownerId && x.bookId === bookId);
    const me = this.currentUser()?.uid;
    return { count: likes.length, liked: likes.some((x) => x.uid === me) };
  }

  async setLiked(ownerId: string, bookId: string, liked: boolean) {
    const u = this.requireUser();
    const rest = (this.data.likes ?? []).filter(
      (x) => !(x.uid === u.uid && x.ownerId === ownerId && x.bookId === bookId),
    );
    this.data.likes = liked ? [...rest, { uid: u.uid, ownerId, bookId, at: Date.now() }] : rest;
    this.save();
  }

  async listLikedBooks() {
    const u = this.requireUser();
    return (this.data.likes ?? [])
      .filter((x) => x.uid === u.uid)
      .sort((a, b) => b.at - a.at)
      .map((x) => this.visibleMeta(x.ownerId, x.bookId))
      .filter((b): b is BookMeta => b !== null);
  }

  async recordView(ownerId: string, bookId: string) {
    const u = this.currentUser();
    if (!u) return;
    const rest = (this.data.history ?? []).filter(
      (x) => !(x.uid === u.uid && x.ownerId === ownerId && x.bookId === bookId),
    );
    this.data.history = [...rest, { uid: u.uid, ownerId, bookId, at: Date.now() }];
    this.save();
  }

  async listHistory() {
    const u = this.requireUser();
    return (this.data.history ?? [])
      .filter((x) => x.uid === u.uid)
      .sort((a, b) => b.at - a.at)
      .map((x): HistoryEntry | null => {
        const book = this.visibleMeta(x.ownerId, x.bookId);
        return book ? { book, viewedAt: x.at } : null;
      })
      .filter((e): e is HistoryEntry => e !== null);
  }

  async clearHistory() {
    const u = this.requireUser();
    this.data.history = (this.data.history ?? []).filter((x) => x.uid !== u.uid);
    this.save();
  }
}
