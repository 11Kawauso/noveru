// お試しモード：Firebase の代わりにブラウザの中（localStorage）に保存する仕組み
// Firebase を設定する前に画面を試すためのもの。

import type { Book, BookInput, BookMeta, BookPlacement, Profile, Store, User } from "./types";
import { StoreError } from "./types";

const KEY = "noveru-demo";

interface DemoAccount {
  uid: string;
  email: string;
  password: string;
  penName: string;
}

interface DemoData {
  accounts: DemoAccount[];
  books: Book[];
  currentUid: string | null;
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
  return { ...rest, titleReading: rest.titleReading ?? "", shelfOrder: rest.shelfOrder ?? -rest.updatedAt, createdAt: rest.createdAt ?? rest.updatedAt };
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
    return a ? { uid: a.uid, email: a.email, penName: a.penName } : null;
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
    return a ? { penName: a.penName } : null;
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
    this.save();
  }
}
