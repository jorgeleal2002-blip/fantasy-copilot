import { useEffect, useState } from 'react';
import { cutOut } from '../model/cutout';
import { segmentPerson } from './segment';

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
const KEY = 'doctors-cutout:v1:';
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
export function useCutout(url: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!url) return;
    let live = true;
    let job = done.get(url);
    if (!job) { job = make(url); done.set(url, job); }
    void job.then(s => { if (live) setSrc(s); });
    return () => { live = false; };
  }, [url]);
  return src;
}
