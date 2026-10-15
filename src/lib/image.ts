// 表紙の画像を小さくする
// Firestore には1件あたり約1MBまでしか保存できないので、表紙は約250KB以下にする。

const MAX_W = 600;
const MAX_H = 850;
const MAX_LENGTH = 250_000; // data URL の文字数

function loadImage(file: File): Promise<HTMLImageElement> {
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

const ICON_SIZE = 240;
const ICON_MAX_LENGTH = 80_000;

/** アイコン用：真ん中を正方形に切り取って小さくし、data URL にする */
export async function compressIcon(file: File): Promise<string> {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, ICON_SIZE, ICON_SIZE);
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= ICON_MAX_LENGTH) return url;
  }
  throw new Error("画像を小さくできませんでした。別の画像を選んでください。");
}
