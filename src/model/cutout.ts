/**
 * Lifting a person off a plain background, without a model.
 *
 * A headshot on a flat ground — the studio black or white every team and
 * league photo is shot on — is the case that matters, and it needs no machine
 * learning: the background is the one colour that runs unbroken in from every
 * edge. So it is flood-filled in from the border, anything close enough to
 * that colour is cleared, and the edge is softened by a pixel so it does not
 * read as cut out with scissors.
 *
 * A photo whose border is not mostly one colour — a selfie in a car, a crowd —
 * is refused rather than mangled, and the caller keeps the photo as it was.
 */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, row by row, as a canvas hands it over. Written in place. */
  data: Uint8ClampedArray;
}

/** How close to the background a pixel has to be to count as it. */
const TOL = 26;
/** How much of the border has to be the background for this to be a plain one. */
const BORDER_SHARE = 0.6;

const dist = (d: Uint8ClampedArray, i: number, c: [number, number, number]) => {
  const r = d[i] - c[0], g = d[i + 1] - c[1], b = d[i + 2] - c[2];
  return Math.sqrt(r * r + g * g + b * b);
};

/**
 * Clears the background in place and returns the box the person is in, or
 * null when the photo has no plain background to clear.
 */
export function cutOut(px: Pixels): { x: number; y: number; w: number; h: number } | null {
  const { width: W, height: H, data: d } = px;
  if (W < 8 || H < 8) return null;

  // The border, and the colour most of it is: a per-channel median.
  const border: number[] = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 1; y < H - 1; y++) border.push(y * W, y * W + W - 1);
  const med = (ch: number) => {
    const v = border.map(p => d[p * 4 + ch]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const bg: [number, number, number] = [med(0), med(1), med(2)];
  const onBg = border.filter(p => dist(d, p * 4, bg) < TOL).length;
  if (onBg / border.length < BORDER_SHARE) return null;

  // In from the edges, through everything that is still the background.
  const gone = new Uint8Array(W * H);
  const stack: number[] = [];
  for (const p of border) {
    if (!gone[p] && dist(d, p * 4, bg) < TOL) { gone[p] = 1; stack.push(p); }
  }
  while (stack.length) {
    const p = stack.pop() as number;
    const x = p % W, y = (p - x) / W;
    const next = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
    for (const q of next) {
      if (q < 0 || gone[q]) continue;
      if (dist(d, q * 4, bg) < TOL) { gone[q] = 1; stack.push(q); }
    }
  }

  // Nothing left, or nothing cleared: either way not a person on a ground.
  let kept = 0;
  for (let p = 0; p < W * H; p++) if (!gone[p]) kept++;
  if (kept < W * H * 0.05 || kept === W * H) return null;

  // Alpha, softened over the pixel either side of the edge.
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          sum += gone[yy * W + xx] ? 0 : 1;
          n++;
        }
      }
      const a = Math.round((sum / n) * 255);
      d[p * 4 + 3] = Math.min(d[p * 4 + 3], a);
      if (a > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  defringe(px, bg);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Takes the old background's colour back out of the edge.
 *
 * A pixel on the outline of hair is part hair and part whatever was behind
 * it, and once the ground is cut away the "behind" part is still in its
 * colour: dark curls on a dark studio backdrop came out ringed in that
 * backdrop, a jagged halo against the team colour. Each pixel the cut left
 * partly transparent is solved for the colour it would have had on its own,
 * given how much of it is kept — the standard un-premultiply.
 */
export function defringe(px: Pixels, bg: [number, number, number]): void {
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 0 || a === 255) continue;
    // Below a fifth kept, the solve divides by almost nothing and invents
    // colour; those pixels are nearly invisible anyway.
    const f = Math.max(a / 255, 0.2);
    for (let c = 0; c < 3; c++) {
      const v = (d[i + c] - (1 - f) * bg[c]) / f;
      d[i + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
  }
}
