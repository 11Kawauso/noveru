// Firebase（本番）に保存する仕組み
//
// 保存場所
//   users/{uid}                  … ペンネーム（誰でも読める）
//   users/{uid}/books/{bookId}   … タイトル・作者・表紙など（並べた本は誰でも読める）
//   users/{uid}/texts/{bookId}   … 本文（並べた本は誰でも読める）
// 本文を分けているのは、本棚を表示するときに全部の本文を読み込まないため。

import { initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Auth,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import type { Book, BookInput, BookMeta, BookPlacement, Profile, Store, User } from "./types";
import { StoreError } from "./types";

type FirebaseConfig = Record<string, string>;

const AUTH_MESSAGES: Record<string, string> = {
  "auth/invalid-email": "メールアドレスの形が正しくありません。",
  "auth/missing-email": "メールアドレスを入力してください。",
  "auth/missing-password": "パスワードを入力してください。",
  "auth/email-already-in-use": "このメールアドレスはすでに登録されています。",
  "auth/weak-password": "パスワードは6文字以上にしてください。",
  "auth/invalid-credential": "メールアドレスかパスワードが違います。",
  "auth/wrong-password": "メールアドレスかパスワードが違います。",
  "auth/user-not-found": "メールアドレスかパスワードが違います。",
  "auth/too-many-requests": "何度も失敗したため、しばらく待ってからもう一度試してください。",
  "auth/network-request-failed": "インターネットにつながっていないようです。",
  "permission-denied": "この操作をする権限がありません。",
  unavailable: "サーバーにつながりません。時間をおいてもう一度試してください。",
};

function toStoreError(e: unknown): StoreError {
  const code = (e as { code?: string })?.code ?? "";
  const msg = AUTH_MESSAGES[code];
  if (msg) return new StoreError(msg);
  console.error(e);
  return new StoreError("うまくいきませんでした。もう一度試してください。");
}

async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw e instanceof StoreError ? e : toStoreError(e);
  }
}

function toMillis(v: unknown): number {
  const ts = v as Timestamp | null | undefined;
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : Date.now();
}

function toMeta(id: string, ownerId: string, d: DocumentData): BookMeta {
  return {
    id,
    ownerId,
    title: d.title ?? "",
    author: d.author ?? "",
    vertical: d.vertical ?? true,
    displayed: d.displayed ?? false,
    displayOrder: d.displayOrder ?? 0,
    // 順番がまだない本は、新しいものほど左に来るようにする
    shelfOrder: d.shelfOrder ?? -toMillis(d.updatedAt),
    cover: d.cover ?? null,
    updatedAt: toMillis(d.updatedAt),
  };
}

export class FirebaseStore implements Store {
  readonly demo = false;
  private auth: Auth;
  private db: Firestore;
  private user: User | null = null;
  private listeners: ((u: User | null) => void)[] = [];
  private ready = false;
  /** 新規登録の途中（ペンネームを保存し終わるまで）は通知を待つ */
  private signingUp = false;

  constructor(config: FirebaseConfig) {
    const app = initializeApp(config);
    this.auth = getAuth(app);
    this.db = getFirestore(app);

    onAuthStateChanged(this.auth, async (fbUser) => {
      if (this.signingUp) return;
      if (fbUser) {
        let penName = fbUser.displayName ?? "";
        if (!penName) {
          const p = await this.getProfile(fbUser.uid).catch(() => null);
          penName = p?.penName ?? "";
        }
        this.user = { uid: fbUser.uid, email: fbUser.email ?? "", penName };
      } else {
        this.user = null;
      }
      this.ready = true;
      this.emit();
    });
  }

  private emit() {
    for (const cb of this.listeners) cb(this.user);
  }

  onUserChanged(cb: (user: User | null) => void) {
    this.listeners.push(cb);
    if (this.ready) cb(this.user);
  }

  currentUser() {
    return this.user;
  }

  private requireUser(): User {
    if (!this.user) throw new StoreError("ログインしてください。");
    return this.user;
  }

  signUp(email: string, password: string, penName: string) {
    return wrap(async () => {
      this.signingUp = true;
      try {
        const cred = await createUserWithEmailAndPassword(this.auth, email, password);
        await updateProfile(cred.user, { displayName: penName });
        await setDoc(doc(this.db, "users", cred.user.uid), {
          penName,
          createdAt: serverTimestamp(),
        });
        this.user = { uid: cred.user.uid, email, penName };
      } finally {
        this.signingUp = false;
      }
      this.ready = true;
      this.emit();
    });
  }

  signIn(email: string, password: string) {
    return wrap(async () => {
      await signInWithEmailAndPassword(this.auth, email, password);
    });
  }

  signOut() {
    return wrap(() => signOut(this.auth));
  }

  sendPasswordReset(email: string) {
    return wrap(async () => {
      this.auth.languageCode = "ja";
      await sendPasswordResetEmail(this.auth, email);
    });
  }

  getProfile(uid: string) {
    return wrap(async (): Promise<Profile | null> => {
      const snap = await getDoc(doc(this.db, "users", uid));
      if (!snap.exists()) return null;
      return { penName: snap.data().penName ?? "" };
    });
  }

  listMyBooks() {
    return wrap(async () => {
      const u = this.requireUser();
      const snap = await getDocs(collection(this.db, "users", u.uid, "books"));
      return snap.docs.map((d) => toMeta(d.id, u.uid, d.data()));
    });
  }

  listDisplayedBooks(uid: string) {
    return wrap(async () => {
      const q = query(collection(this.db, "users", uid, "books"), where("displayed", "==", true));
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => toMeta(d.id, uid, d.data()))
        .sort((a, b) => a.displayOrder - b.displayOrder);
    });
  }

  getBook(uid: string, bookId: string) {
    return wrap(async (): Promise<Book | null> => {
      const metaSnap = await getDoc(doc(this.db, "users", uid, "books", bookId));
      if (!metaSnap.exists()) return null;
      const textSnap = await getDoc(doc(this.db, "users", uid, "texts", bookId));
      return {
        ...toMeta(bookId, uid, metaSnap.data()),
        body: textSnap.exists() ? (textSnap.data().body ?? "") : "",
      };
    });
  }

  saveBook(input: BookInput, bookId?: string) {
    return wrap(async () => {
      const u = this.requireUser();
      const books = collection(this.db, "users", u.uid, "books");
      const metaRef = bookId ? doc(books, bookId) : doc(books);
      const textRef = doc(this.db, "users", u.uid, "texts", metaRef.id);
      const batch = writeBatch(this.db);
      const meta = {
        title: input.title,
        author: input.author,
        vertical: input.vertical,
        cover: input.cover,
        updatedAt: serverTimestamp(),
      };
      if (bookId) {
        batch.update(metaRef, meta);
      } else {
        batch.set(metaRef, {
          ...meta,
          displayed: false,
          displayOrder: 0,
          shelfOrder: -Date.now(), // 新しい本は本棚の左端に入る
          createdAt: serverTimestamp(),
        });
      }
      batch.set(textRef, { body: input.body });
      await batch.commit();
      return metaRef.id;
    });
  }

  setDisplayed(bookId: string, displayed: boolean) {
    return wrap(async () => {
      const u = this.requireUser();
      await updateDoc(
        doc(this.db, "users", u.uid, "books", bookId),
        displayed ? { displayed, displayOrder: Date.now() } : { displayed, shelfOrder: -Date.now() },
      );
    });
  }

  arrangeBooks(changes: BookPlacement[]) {
    return wrap(async () => {
      const u = this.requireUser();
      // 1回にまとめて書ける数（500件）ごとに分けて保存する
      for (let i = 0; i < changes.length; i += 450) {
        const batch = writeBatch(this.db);
        for (const c of changes.slice(i, i + 450)) {
          batch.update(
            doc(this.db, "users", u.uid, "books", c.id),
            c.displayed ? { displayed: true, displayOrder: c.order } : { displayed: false, shelfOrder: c.order },
          );
        }
        await batch.commit();
      }
    });
  }

  deleteBook(bookId: string) {
    return wrap(async () => {
      const u = this.requireUser();
      const batch = writeBatch(this.db);
      batch.delete(doc(this.db, "users", u.uid, "texts", bookId));
      batch.delete(doc(this.db, "users", u.uid, "books", bookId));
      await batch.commit();
    });
  }
}
