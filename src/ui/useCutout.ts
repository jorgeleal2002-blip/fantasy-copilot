import { useEffect, useState } from 'react';
import { cutOut } from '../model/cutout';
import { crop, segmentPerson } from './segment';

/** Big enough for a banner on a 3x screen, small enough to clear in a frame. */
const MAX_SIDE = 1024;
const done = new Map<string, Promise<string | null>>();
/** What each photo came to, once known, so a second open draws it at once. */
const known = new Map<string, string | null>();

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
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h);
        const box = cutOut(px);
        if (!box) return resolve(null);
        ctx.putImageData(px, 0, 0);
        resolve(crop(c, box.x, box.y, box.w, box.h));
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
const KEY = 'doctors-cutout:v5:';
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + ':' + s.length.toString(36);
};
const remembered = (url: string): string | null => {
  try { return localStorage.getItem(KEY + hash(url)); } catch { return null; }
};
const remember = (url: string, cut: string) => {
  try {
    // The last version's, made with the black outline, only take up room.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('doctors-cutout:') && !k.startsWith(KEY)) localStorage.removeItem(k);
    }
    localStorage.setItem(KEY + hash(url), cut); } catch { /* full, or private mode: it is only a cache */ }
};

/* The model first, which handles any background; the plain-ground method
   when the model cannot load or finds nobody, so a flat studio photo still
   comes out even offline. */
async function make(url: string): Promise<string | null> {
  let cut: string | null = null;
  try { cut = await segmentPerson(url); } catch { cut = null; }
  if (!cut) cut = await flat(url);
  if (cut) remember(url, cut);
  known.set(url, cut);
  return cut;
}

/** The answer without waiting, when there is one: this visit's, or the
 *  phone's from an earlier one. Undefined while it is still being worked out. */
function now(url: string | null): string | null | undefined {
  if (!url) return null;
  if (known.has(url)) return known.get(url);
  const held = remembered(url);
  if (held) { known.set(url, held); return held; }
  return undefined;
}

/**
 * The photo with its background taken off, cropped to the person; null when
 * it cannot be, and undefined while it is being worked out — so the banner
 * can wait for it instead of drawing the plain photo and then jumping.
 */
export function useCutout(url: string | null): string | null | undefined {
  const [state, setState] = useState(() => ({ url, src: now(url) }));
  useEffect(() => {
    const ready = now(url);
    setState(s => (s.url === url && s.src === ready ? s : { url, src: ready }));
    if (ready !== undefined || !url) return;
    let live = true;
    let job = done.get(url);
    if (!job) { job = make(url); done.set(url, job); }
    void job.then(src => { if (live) setState({ url, src }); });
    return () => { live = false; };
  }, [url]);
  // A new photo is not the old one's cut-out, even for the one frame before
  // the effect catches up.
  return state.url === url ? state.src : now(url);
}
