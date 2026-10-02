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
/** Long side the photo is worked at — plenty for a banner on a 3x screen. */
const MAX_SIDE = 420;

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
    const my = Math.min(mh - 1, Math.floor((y * mh) / H));
    for (let x = 0; x < W; x++) {
      const mx = Math.min(mw - 1, Math.floor((x * mw) / W));
      const p = conf[my * mw + mx] ?? 0;
      // A soft edge rather than a hard threshold: hair and shoulders are where
      // the model is least sure, and a gradient there reads as a photo.
      const t = Math.max(0, Math.min(1, (p - 0.3) / 0.4));
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

  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')?.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
