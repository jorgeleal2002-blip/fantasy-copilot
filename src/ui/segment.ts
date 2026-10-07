import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { defringe } from '../model/cutout';

/**
 * Lifting a person off ANY background — a car, a crowd, a flag — with
 * MediaPipe's selfie segmenter, run in the browser.
 *
 * Loaded only the first time a banner asks for it: the runtime is about 12 MB
 * and nobody should pay that to open the app. The model itself is a quarter of
 * a megabyte and ships with the site, so nothing here depends on Google being
 * reachable.
 */
const MODEL = './models/selfie_segmenter.tflite';
/** Long side the photo is worked at. The banner is about 450 real pixels
 *  tall on a 3x screen and the person is cropped out of the middle of the
 *  photo, so the photo itself has to be larger than that or the cut-out is
 *  upscaled — which is what made them soft at 420. */
const MAX_SIDE = 1024;

let segmenter: Promise<ImageSegmenter> | null = null;
function load(): Promise<ImageSegmenter> {
  if (!segmenter) {
    segmenter = import('@mediapipe/tasks-vision').then(({ ImageSegmenter }) =>
      ImageSegmenter.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
        baseOptions: { modelAssetPath: MODEL },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      }));
    segmenter.catch(() => { segmenter = null; });
  }
  return segmenter;
}

const image = (url: string) => new Promise<HTMLImageElement>((ok, fail) => {
  const img = new Image();
  if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
  img.onload = () => ok(img);
  img.onerror = () => fail(new Error('image'));
  img.src = url;
});

/**
 * The person in the photo on a transparent ground, cropped to them, as a PNG
 * data URL — or null when there is nobody in it the model is sure of.
 * Throws when the model cannot run at all, so the caller can try something
 * plainer.
 */
export async function segmentPerson(url: string): Promise<string | null> {
  const img = await image(url);
  const own = alreadyCut(img);
  if (own) return own;
  const seg = await load();
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * k));
  const H = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, W, H);

  const result = seg.segment(c);
  const mask = result.confidenceMasks?.[0];
  if (!mask) { result.close(); return null; }
  const conf = mask.getAsFloat32Array();
  const mw = mask.width, mh = mask.height;
  result.close();

  const px = ctx.getImageData(0, 0, W, H);
  /* What the photo already had cleared stays cleared. Read on its own, the
     mask spills a few pixels past the hair, and a transparent pixel there is
     black underneath: set opaque it drew a jagged black outline round him. */
  const was = new Uint8ClampedArray(W * H);
  for (let p = 0; p < W * H; p++) was[p] = px.data[p * 4 + 3];
  // The backdrop's colour: the average of what the model is sure is not him.
  let br = 0, bgc = 0, bb = 0, bn = 0;
  const confAt = (x: number, y: number) =>
    conf[Math.min(mh - 1, Math.floor((y * mh) / H)) * mw + Math.min(mw - 1, Math.floor((x * mw) / W))] ?? 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (confAt(x, y) > 0.05) continue;
      const i = (y * W + x) * 4;
      if (px.data[i + 3] < 128) continue;
      br += px.data[i]; bgc += px.data[i + 1]; bb += px.data[i + 2]; bn++;
    }
  }
  const bg: [number, number, number] = bn ? [br / bn, bgc / bn, bb / bn] : [0, 0, 0];
  let x0 = W, y0 = H, x1 = -1, y1 = -1, kept = 0;
  for (let y = 0; y < H; y++) {
    // The mask is a fraction of the photo's size; sampled to the nearest of
    // its pixels it came back as stairs along every edge. Read between them.
    const fy = Math.max(0, Math.min(mh - 1, ((y + 0.5) * mh) / H - 0.5));
    const y0m = Math.floor(fy), y1m = Math.min(mh - 1, y0m + 1), ty = fy - y0m;
    for (let x = 0; x < W; x++) {
      const fx = Math.max(0, Math.min(mw - 1, ((x + 0.5) * mw) / W - 0.5));
      const x0m = Math.floor(fx), x1m = Math.min(mw - 1, x0m + 1), tx = fx - x0m;
      const top = (conf[y0m * mw + x0m] ?? 0) * (1 - tx) + (conf[y0m * mw + x1m] ?? 0) * tx;
      const bot = (conf[y1m * mw + x0m] ?? 0) * (1 - tx) + (conf[y1m * mw + x1m] ?? 0) * tx;
      const p = top * (1 - ty) + bot * ty;
      // A soft edge rather than a hard threshold, kept low enough that a dark
      // beard on a dark ground stays solid — the colour that low keep drags in
      // from the backdrop is taken back out by `defringe` below.
      const t = Math.max(0, Math.min(1, (p - 0.15) / 0.35));
      const a = Math.min(was[y * W + x], Math.round(t * t * (3 - 2 * t) * 255));
      px.data[(y * W + x) * 4 + 3] = a;
      if (a > 24) {
        kept++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (kept < W * H * 0.03) return null;
  defringe(px, bg);
  ctx.putImageData(px, 0, 0);

  return crop(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

/**
 * A photo that comes already cut out — Sleeper's portraits are, on a clear
 * ground — needs no model: it is cropped to what it kept, edges as they were.
 * Null when its border is not clear.
 */
function alreadyCut(img: HTMLImageElement): string | null {
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * k));
  const H = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  let clear = 0, n = 0;
  const at = (x: number, y: number) => { n++; if (d[(y * W + x) * 4 + 3] < 16) clear++; };
  for (let x = 0; x < W; x++) { at(x, 0); at(x, H - 1); }
  for (let y = 1; y < H - 1; y++) { at(0, y); at(W - 1, y); }
  // The shirt runs off the bottom, so most of the border, not all of it.
  if (clear / n < 0.6) return null;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] <= 24) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return crop(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

/** No taller than the banner needs on a 3x screen: it is kept on the phone. */
const OUT_H = 640;
/** WebP keeps the transparency at a fraction of a PNG's size; a browser that
 *  cannot encode it hands back a PNG, which is still right, only bigger. */
export function crop(src: HTMLCanvasElement, x: number, y: number, w: number, h: number): string {
  const k = Math.min(1, OUT_H / h);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * k));
  out.height = Math.max(1, Math.round(h * k));
  const ctx = out.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, x, y, w, h, 0, 0, out.width, out.height);
  }
  const webp = out.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : out.toDataURL('image/png');
}
