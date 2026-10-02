import { useEffect, useState } from 'react';
import { cutOut } from '../model/cutout';
import { segmentPerson } from './segment';
import { hexRgb, recolorClothing, rowSpan, shoulderRow } from '../model/jersey';

/** Big enough for a banner on a 3x screen, small enough to clear in a frame. */
const MAX_SIDE = 420;
const done = new Map<string, Promise<string | null>>();

function flat(url: string): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    // A Sleeper portrait comes off another host; without this its pixels are
    // unreadable, and a refusal falls back to the photo as it was.
    if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h);
        const box = cutOut(px);
        if (!box) return resolve(null);
        ctx.putImageData(px, 0, 0);
        const out = document.createElement('canvas');
        out.width = box.w;
        out.height = box.h;
        out.getContext('2d')?.drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
        resolve(out.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/* Kept on the phone, so each photo is worked out once and not on every open.
   Keyed by a hash of the photo itself: a new photo is a new key. */
const KEY = 'doctors-cutout:v2:';
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + ':' + s.length.toString(36);
};
const remembered = (url: string): string | null => {
  try { return localStorage.getItem(KEY + hash(url)); } catch { return null; }
};
const remember = (url: string, cut: string) => {
  try { localStorage.setItem(KEY + hash(url), cut); } catch { /* full, or private mode: it is only a cache */ }
};

/* The model first, which handles any background; the plain-ground method
   when the model cannot load or finds nobody, so a flat studio photo still
   comes out even offline. */
async function make(url: string): Promise<string | null> {
  const held = remembered(url);
  if (held) return held;
  let cut: string | null = null;
  try { cut = await segmentPerson(url); } catch { cut = null; }
  if (!cut) cut = await flat(url);
  if (cut) remember(url, cut);
  return cut;
}

/**
 * The photo with its background taken off, cropped to the person — or null
 * while it is being worked out and whenever it cannot be.
 */
/** His team's colour and number, for a photo that is not in them. */
export interface Dress { color: string; number?: string | null }

const dressed = new Map<string, Promise<string | null>>();

/* Recoloured off the cut-out rather than off the photo: the cut-out already
   says which pixels are him, and the clothing is the part of him under the
   shoulders that is not skin. */
function dress(cut: string, how: Dress): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(cut);
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, c.width, c.height);
        const from = shoulderRow(px);
        const changed = recolorClothing(px, hexRgb(how.color), from);
        ctx.putImageData(px, 0, 0);
        // The jersey's own furniture, drawn over the recoloured shirt and
        // clipped to him (`source-atop`) so it follows his outline: a V
        // collar at the neck, the number large on the chest, and again small
        // on each shoulder — the things that make a shirt read as a jersey.
        // Only where there is a shirt to put them on.
        const torso = c.height - from;
        const neck = rowSpan(px, Math.min(c.height - 1, from));
        const shoulders = rowSpan(px, Math.min(c.height - 1, Math.round(from + torso * 0.12)));
        const chestY = Math.min(c.height - 1, Math.round(from + torso * 0.42));
        const chest = rowSpan(px, chestY);
        if (neck && shoulders && chest && changed > c.width * c.height * 0.04) {
          const light = 'rgba(242, 253, 254, 0.9)';
          const edge = 'rgba(0, 0, 0, 0.4)';
          ctx.save();
          ctx.globalCompositeOperation = 'source-atop';

          const vw = Math.max(6, shoulders.width * 0.13);
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.lineWidth = Math.max(2, shoulders.width * 0.035);
          ctx.strokeStyle = light;
          ctx.beginPath();
          ctx.moveTo(neck.mid - vw, from);
          ctx.lineTo(neck.mid, from + vw * 1.1);
          ctx.lineTo(neck.mid + vw, from);
          ctx.stroke();

          if (how.number) {
            const block = (n: string, x: number, y: number, size: number) => {
              ctx.font = '900 ' + Math.round(size) + "px 'Arial Black', Impact, 'Helvetica Neue', sans-serif";
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.lineWidth = Math.max(2, size * 0.12);
              ctx.strokeStyle = edge;
              ctx.fillStyle = light;
              ctx.strokeText(n, x, y);
              ctx.fillText(n, x, y);
            };
            block(how.number, chest.mid, chestY, Math.min(chest.width * 0.55, torso * 0.5));
            const small = Math.min(shoulders.width * 0.14, torso * 0.14);
            const sy = from + torso * 0.14;
            block(how.number, shoulders.mid - shoulders.width * 0.4, sy, small);
            block(how.number, shoulders.mid + shoulders.width * 0.4, sy, small);
          }
          ctx.restore();
        }
        resolve(c.toDataURL('image/png'));
      } catch {
        resolve(cut);
      }
    };
    img.onerror = () => resolve(cut);
    img.src = cut;
  });
}

/**
 * The photo with its background taken off, cropped to the person and — given
 * `how` — put in his team's colours. Null while it is being worked out and
 * whenever it cannot be.
 */
export function useCutout(url: string | null, how?: Dress | null): string | null {
  const [src, setSrc] = useState<string | null>(null);
  const color = how?.color || '';
  const number = how?.number || '';
  useEffect(() => {
    setSrc(null);
    if (!url) return;
    let live = true;
    let job = done.get(url);
    if (!job) { job = make(url); done.set(url, job); }
    const key = url + '|' + color + '|' + number;
    const out = color
      ? (dressed.get(key) || (() => {
        const j = job.then(cut => (cut ? dress(cut, { color, number }) : null));
        dressed.set(key, j);
        return j;
      })())
      : job;
    void out.then(s => { if (live) setSrc(s); });
    return () => { live = false; };
  }, [url, color, number]);
  return src;
}
