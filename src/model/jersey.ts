import type { Pixels } from './cutout';

/**
 * Putting a player in his own team's colours.
 *
 * A photo somebody uploads is usually somebody else — a point guard in his
 * own jersey, a friend in a T-shirt. Once the person is cut out the clothing
 * is the part of them below the shoulders that is not skin, and recolouring
 * it to the team's hue while keeping its own light and shade leaves the folds
 * and creases where they were: it still reads as a shirt, now the right one.
 */

/** "#00338D" → [0, 51, 141]. */
export const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(ch(h + 1 / 3) * 255), Math.round(ch(h) * 255), Math.round(ch(h - 1 / 3) * 255)];
}

/** Skin, by the YCbCr box every skin detector starts from — wide enough for
 *  every tone — and the classic RGB rule on top, because the box alone took a
 *  red or maroon jersey for skin and left its stripes the old team's colour. */
export function isSkin(r: number, g: number, b: number): boolean {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  if (!(cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173)) return false;
  return r > 60 && g > 40 && b > 20 && r > g && r > b && r - g > 10
    && Math.max(r, g, b) - Math.min(r, g, b) > 15 && g / r > 0.45;
}

/** Where the person is across one row: their middle and their width. */
export function rowSpan(px: Pixels, y: number): { mid: number; width: number } | null {
  const { width: W, data: d } = px;
  let x0 = -1, x1 = -1;
  for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] > 128) { if (x0 < 0) x0 = x; x1 = x; }
  }
  return x0 < 0 ? null : { mid: (x0 + x1) / 2, width: x1 - x0 + 1 };
}

/**
 * Where the shoulders start: the first row, past the head, at which the
 * person is half as wide again as the head was. A head-and-shoulders photo
 * has an obvious one; anything else gets the lower half.
 */
export function shoulderRow(px: Pixels): number {
  const { width: W, height: H, data: d } = px;
  const widthAt = (y: number) => {
    let n = 0;
    for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 128) n++;
    return n;
  };
  const head = Math.max(1, widthAt(Math.floor(H * 0.18)));
  for (let y = Math.floor(H * 0.3); y < H; y++) {
    if (widthAt(y) > head * 1.5) return y;
  }
  return Math.floor(H * 0.5);
}

/**
 * Recolours the clothing in place — the person below `from` that is not skin
 * — to the team's hue, keeping each pixel's own lightness so the fabric keeps
 * its shading. Returns how many pixels it changed.
 */
export function recolorClothing(px: Pixels, team: [number, number, number], from: number): number {
  const { width: W, height: H, data: d } = px;
  const [th, ts, tl] = rgbToHsl(team[0], team[1], team[2]);
  let changed = 0;
  for (let y = Math.max(0, from); y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] < 16) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (isSkin(r, g, b)) continue;
      const l = rgbToHsl(r, g, b)[2];
      // The fabric's own light, pulled toward the team colour's so a navy
      // team does not come out sky blue off a white shirt.
      const nl = Math.min(0.92, Math.max(0.06, l * 0.6 + tl * 0.4));
      const [nr, ng, nb] = hslToRgb(th, Math.max(ts, 0.35), nl);
      d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
      changed++;
    }
  }
  return changed;
}
