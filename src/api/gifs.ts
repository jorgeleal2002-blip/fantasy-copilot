/**
 * GIFs for the chat, from Giphy. It needs a key of its own — free, from
 * developers.giphy.com — set as VITE_GIPHY_KEY when the app is built; without
 * one the GIF button says so instead of searching.
 */
import type { ChatGif } from './chat';

const KEY: string = import.meta.env?.VITE_GIPHY_KEY || '';
export const gifsEnabled = () => !!KEY;

export interface GifHit extends ChatGif { id: string; preview: string; title: string }

/** What is trending with no words, a search with them. */
export async function findGifs(q: string, signal?: AbortSignal): Promise<GifHit[]> {
  if (!KEY) return [];
  const words = q.trim();
  const url = 'https://api.giphy.com/v1/gifs/' + (words ? 'search' : 'trending')
    + '?api_key=' + encodeURIComponent(KEY) + '&limit=24&rating=pg-13&bundle=messaging_non_clips'
    + (words ? '&q=' + encodeURIComponent(words) : '');
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('giphy ' + res.status);
  const body = (await res.json()) as { data?: { id: string; title?: string; images?: Record<string, { url?: string; width?: string; height?: string }> }[] };
  return (body.data || []).flatMap(g => {
    const full = g.images?.fixed_width;
    const small = g.images?.fixed_width_small || full;
    if (!full?.url) return [];
    return [{
      id: g.id, title: g.title || 'GIF',
      url: full.url, w: Number(full.width) || 200, h: Number(full.height) || 200,
      preview: small?.url || full.url,
    }];
  });
}
