// アイコンの位置と大きさを決める小窓
// 丸い枠の中で画像をドラッグして動かし、スライダー（またはホイール）で拡大縮小する。
// 「決定」で、丸の中に見えている部分を正方形の画像にして返す。

import { h, openDialog } from "./dom";
import { loadImage } from "./image";

const STAGE = 260; // 画面に出す枠の大きさ（px）
const OUTPUT = 240; // 保存する画像の大きさ（px）
const MAX_ZOOM = 4;
const MAX_LENGTH = 80_000;

/** 画像を選んでもらい、切り取った data URL を返す。やめたときは null */
export async function openIconCropper(file: File): Promise<string | null> {
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const hgt = img.naturalHeight;
  const base = Math.max(STAGE / w, STAGE / hgt); // 枠がちょうど埋まる倍率
  let zoom = 1;
  let x = 0; // 画像の中心が、枠の中心からどれだけずれているか（px）
  let y = 0;

  // 画面に出す用の画像（読み込みに使ったアドレスはもう使えないので、別に作る）
  const displayUrl = URL.createObjectURL(file);
  const picture = h("img", { class: "crop-image", src: displayUrl, alt: "", draggable: "false" });
  const stage = h(
    "div",
    { class: "crop-stage", style: `width:${STAGE}px;height:${STAGE}px` },
    picture,
    h("div", { class: "crop-circle" }),
  );
  const slider = h("input", { class: "crop-zoom", type: "range", min: 1, max: MAX_ZOOM, step: 0.01, value: 1 });

  const scale = () => base * zoom;
  /** 画像が枠からはみ出さない（すき間ができない）ように位置を直す */
  const clamp = () => {
    const maxX = (w * scale() - STAGE) / 2;
    const maxY = (hgt * scale() - STAGE) / 2;
    x = Math.max(-maxX, Math.min(maxX, x));
    y = Math.max(-maxY, Math.min(maxY, y));
  };
  const draw = () => {
    clamp();
    const s = scale();
    picture.style.width = `${w * s}px`;
    picture.style.height = `${hgt * s}px`;
    picture.style.left = `${STAGE / 2 - (w * s) / 2 + x}px`;
    picture.style.top = `${STAGE / 2 - (hgt * s) / 2 + y}px`;
  };
  const setZoom = (z: number) => {
    const before = scale();
    zoom = Math.max(1, Math.min(MAX_ZOOM, z));
    // 枠の真ん中を中心に拡大縮小する
    x *= scale() / before;
    y *= scale() / before;
    slider.value = String(zoom);
    draw();
  };

  slider.addEventListener("input", () => setZoom(Number(slider.value)));
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
    },
    { passive: false },
  );

  // ドラッグで動かす（マウスも指も）
  let dragging: { id: number; px: number; py: number } | null = null;
  stage.addEventListener("pointerdown", (e) => {
    dragging = { id: e.pointerId, px: e.clientX, py: e.clientY };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add("is-dragging");
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    x += e.clientX - dragging.px;
    y += e.clientY - dragging.py;
    dragging.px = e.clientX;
    dragging.py = e.clientY;
    draw();
  });
  const endDrag = () => {
    dragging = null;
    stage.classList.remove("is-dragging");
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  /** 丸の中に見えている部分を画像にする */
  const render = (): string => {
    const s = scale();
    const left = STAGE / 2 - (w * s) / 2 + x;
    const top = STAGE / 2 - (hgt * s) / 2 + y;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, OUTPUT, OUTPUT);
    ctx.drawImage(img, -left / s, -top / s, STAGE / s, STAGE / s, 0, 0, OUTPUT, OUTPUT);
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length <= MAX_LENGTH) return url;
    }
    return canvas.toDataURL("image/jpeg", 0.3);
  };

  return new Promise((resolve) => {
    let result: string | null = null;
    const close = openDialog(
      h(
        "div",
        { class: "cropper" },
        h("h2", {}, "アイコンの位置と大きさ"),
        stage,
        h("div", { class: "crop-zoom-row" }, h("span", { "aria-hidden": "true" }, "−"), slider, h("span", { "aria-hidden": "true" }, "＋")),
        h("p", { class: "form-note" }, "画像をドラッグして位置を、スライダーで大きさを決めます。"),
        h(
          "div",
          { class: "dialog-buttons" },
          h("button", { class: "btn", onclick: () => close() }, "やめる"),
          h(
            "button",
            {
              class: "btn btn-primary",
              onclick: () => {
                result = render();
                close();
              },
            },
            "決定",
          ),
        ),
      ),
      () => {
        URL.revokeObjectURL(displayUrl);
        resolve(result);
      },
    );
    draw();
  });
}
