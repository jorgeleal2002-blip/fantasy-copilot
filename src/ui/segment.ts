import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';

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
  const [seg, img] = await Promise.all([load(), image(url)]);
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
      // A soft edge rather than a hard threshold — but a low one. Dark hair on
      // a dark ground is where the model is least sure, and an even split
      // there let the banner show through a beard.
      const t = Math.max(0, Math.min(1, (p - 0.1) / 0.3));
      const a = Math.round(t * t * (3 - 2 * t) * 255);
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
  ctx.putImageData(px, 0, 0);

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
