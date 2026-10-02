import { useEffect, useState } from 'react';
import { cutOut } from '../model/cutout';

/** Big enough for a banner on a 3x screen, small enough to clear in a frame. */
const MAX_SIDE = 420;
const done = new Map<string, Promise<string | null>>();

function make(url: string): Promise<string | null> {
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

/**
 * The photo with its plain background taken off, cropped to the person — or
 * null while it is being worked out and whenever it cannot be (a busy
 * background, an image another host will not let us read).
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
