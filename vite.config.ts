import { defineConfig } from "vite";

// "./" にしておくと GitHub Pages のどのURLに置いても動く
export default defineConfig({
  base: "./",
  build: {
    // Firebase の部品が大きいので、警告の基準を少し上げておく
    chunkSizeWarningLimit: 800,
  },
});
