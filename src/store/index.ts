// Firebase が設定されていれば本番の保存先、なければお試しモードを使う

import { firebaseConfig } from "../firebase-config";
import { DemoStore } from "./demoStore";
import { FirebaseStore } from "./firebaseStore";
import type { Store } from "./types";

export const store: Store = firebaseConfig.apiKey ? new FirebaseStore(firebaseConfig) : new DemoStore();

export * from "./types";
