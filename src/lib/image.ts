// 表紙の画像を小さくする
// Firestore には1件あたり約1MBまでしか保存できないので、表紙は約250KB以下にする。

const MAX_W = 600;
const MAX_H = 850;
const MAX_LENGTH = 250_000; // data URL の文字数

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした。"));
    };
    img.src = url;
  });
}

/** 画像ファイルを縮小・圧縮して data URL（文字列）にする */
export async function compressCover(file: File): Promise<string> {
  const img = await loadImage(file);
  let scale = Math.min(1, MAX_W / img.naturalWidth, MAX_H / img.naturalHeight);

  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const hgt = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = hgt;
    const ctx = canvas.getContext("2d")!;
    // 透明な部分が黒くならないように白で塗っておく
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(img, 0, 0, w, hgt);

    for (const quality of [0.85, 0.75, 0.65, 0.55]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length <= MAX_LENGTH) return url;
    }
    scale *= 0.8;
  }
  throw new Error("画像が大きすぎて小さくできませんでした。別の画像を選んでください。");
}

const THUMB_W = 180;

/** 「探す」用の小さい表紙を作る（data URL → 小さい data URL） */
export async function makeThumbnail(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, THUMB_W / img.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}
