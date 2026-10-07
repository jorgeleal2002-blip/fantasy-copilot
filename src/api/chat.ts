/**
 * The league's chat: everyone let into the app who has this league open.
 *
 * It lives in the same Realtime Database as the draft rooms and the invites,
 * under `chat/{leagueId}`, and the database's rules — `database.rules.json` —
 * let only people let into the app read it or write to it, and only as
 * themselves. Messages stream in the way a draft room does: the database
 * announces a change, and the last hundred are read again.
 */
import { LIVE_URL } from './live';
import { accessEnabled, session } from './access';

export interface ChatMessage {
  id: string;
  uid: string;
  /** the team name, as the league knows it */
  name: string;
  /** the Sleeper username, for telling two "Doctor"s apart */
  user?: string;
  avatar?: string;
  /** the writer's team in the league, for opening his profile */
  rid?: number;
  /** a trade put to the league: the teams in it and who sends whom where */
  trade?: ChatTrade;
  /** a GIF, as Giphy serves it */
  gif?: ChatGif;
  /** something done to a player, logged for the league: a nickname or a photo */
  sys?: ChatEvent;
  /** reactions: for each one, who left it */
  r?: Partial<Record<ReactKey, Record<string, boolean>>>;
  text: string;
  at: number;
}

export interface ChatGif { url: string; w: number; h: number }

export interface ChatEvent {
  kind: 'nick' | 'unnick' | 'photo' | 'unphoto';
  /** the player's id */
  id: string;
  /** his real name */
  player: string;
  /** the new nickname, and the one it replaced */
  nick?: string;
  old?: string;
}

function readEvent(x: unknown): ChatEvent | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const e = x as Record<string, unknown>;
  const kinds = ['nick', 'unnick', 'photo', 'unphoto'];
  if (!kinds.includes(String(e.kind)) || typeof e.id !== 'string') return undefined;
  return {
    kind: e.kind as ChatEvent['kind'], id: e.id, player: String(e.player || e.id).slice(0, 60),
    ...(typeof e.nick === 'string' ? { nick: e.nick.slice(0, 30) } : {}),
    ...(typeof e.old === 'string' ? { old: e.old.slice(0, 30) } : {}),
  };
}

/** The reactions on offer. Keyed by name: the database will not take most
 *  emoji as a key, and the rules list exactly these. */
export const REACTS = [
  // The quick six, first in the picker.
  ['like', '👍'], ['love', '❤️'], ['haha', '😂'], ['fire', '🔥'], ['wow', '😮'], ['sad', '😢'],
  // And the rest, behind the +.
  ['rofl', '🤣'], ['cry', '😭'], ['skull', '💀'], ['eyes', '👀'], ['think', '🤔'], ['cool', '😎'],
  ['angry', '😡'], ['dislike', '👎'], ['clap', '👏'], ['pray', '🙏'], ['flex', '💪'], ['handshake', '🤝'],
  ['party', '🥳'], ['hundred', '💯'], ['goat', '🐐'], ['trophy', '🏆'], ['crown', '👑'], ['football', '🏈'],
  ['money', '💰'], ['rocket', '🚀'], ['up', '📈'], ['down', '📉'], ['ice', '🧊'], ['clown', '🤡'],
  ['trash', '🗑️'], ['poop', '💩'], ['vomit', '🤮'], ['ambulance', '🚑'], ['sleep', '😴'], ['shush', '🤫'],
  ['salute', '🫡'], ['cap', '🧢'], ['check', '✅'], ['nope', '❌'],
] as const;
/** How many show before the +. */
export const QUICK_REACTS = 6;
export type ReactKey = (typeof REACTS)[number][0];

function readGif(x: unknown): ChatGif | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const g = x as Record<string, unknown>;
  return typeof g.url === 'string' && /^https:\/\//.test(g.url)
    ? { url: g.url, w: Number(g.w) || 200, h: Number(g.h) || 200 } : undefined;
}

export interface ChatTrade {
  teams: number[];
  moves: { id: string; from: number; to: number; name: string; pos?: string }[];
}

/* The database hands a list back as an object keyed 0, 1, 2… when it has
   gaps, and anything from it is checked before it is drawn. */
const list = <T,>(x: unknown): T[] => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []) as T[];
function readTrade(x: unknown): ChatTrade | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const t = x as { teams?: unknown; moves?: unknown };
  const teams = list<unknown>(t.teams).map(Number).filter(n => Number.isFinite(n));
  const moves = list<Record<string, unknown>>(t.moves)
    .filter(mv => mv && typeof mv.id === 'string')
    .map(mv => ({
      id: String(mv.id), from: Number(mv.from), to: Number(mv.to),
      name: String(mv.name || mv.id), ...(typeof mv.pos === 'string' ? { pos: mv.pos } : {}),
    }));
  return teams.length >= 2 && moves.length ? { teams, moves } : undefined;
}

/** A tag in a message: @ and a Sleeper username, or @everyone. */
export const TAG = /@([A-Za-z0-9_.]+)/g;
/** Whether a message tags this Sleeper user, by name or as everyone. */
export function tagsMe(text: string, user: string): boolean {
  const me = user.toLowerCase();
  for (const [, h] of text.matchAll(TAG)) {
    const k = h.toLowerCase().replace(/\.+$/, '');
    if (k === me || k === 'everyone') return true;
  }
  return false;
}

export const chatEnabled = () => accessEnabled();
export const CHAT_MAX = 500;
const LAST = 100;

const base = (lid: string) => LIVE_URL + '/chat/' + encodeURIComponent(lid) + '.json';

async function readLast(lid: string): Promise<ChatMessage[]> {
  const s = await session();
  const res = await fetch(base(lid) + '?orderBy=%22$key%22&limitToLast=' + LAST + '&auth=' + encodeURIComponent(s.idToken));
  if (!res.ok) throw new Error('chat ' + res.status);
  const body = (await res.json()) as Record<string, Omit<ChatMessage, 'id'>> | null;
  return Object.entries(body || {})
    .filter(([, m]) => m && typeof m.text === 'string')
    .map(([id, m]) => ({
      id, ...m, trade: readTrade(m.trade), gif: readGif(m.gif), sys: readEvent(m.sys),
      rid: typeof m.rid === 'number' ? m.rid : undefined,
      r: m.r && typeof m.r === 'object' ? m.r : undefined,
    }))
    .sort((a, b) => (a.at || 0) - (b.at || 0));
}

/** Post a message. False when the database refused it (not let in, or the
 *  chat rules not published). */
export async function sendChat(lid: string, m: Omit<ChatMessage, 'id' | 'uid' | 'at' | 'r'>): Promise<boolean> {
  const s = await session();
  const text = m.text.trim().slice(0, CHAT_MAX);
  if (!text) return false;
  const res = await fetch(base(lid) + '?auth=' + encodeURIComponent(s.idToken), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      uid: s.uid, name: m.name.slice(0, 40), text,
      ...(m.user ? { user: m.user.slice(0, 40) } : {}),
      ...(m.avatar ? { avatar: m.avatar.slice(0, 300) } : {}),
      ...(m.rid != null ? { rid: m.rid } : {}),
      ...(m.gif ? { gif: { url: m.gif.url.slice(0, 300), w: m.gif.w, h: m.gif.h } } : {}),
      ...(m.sys ? { sys: m.sys } : {}),
      ...(m.trade ? {
        trade: {
          teams: m.trade.teams.slice(0, 4),
          moves: m.trade.moves.slice(0, 30).map(x => ({ ...x, name: x.name.slice(0, 60) })),
        },
      } : {}),
      at: { '.sv': 'timestamp' },
    }),
  });
  return res.ok;
}

/** Leave a reaction on a message, or take yours back. */
export async function reactChat(lid: string, id: string, key: ReactKey, on: boolean): Promise<boolean> {
  const s = await session();
  const url = LIVE_URL + '/chat/' + encodeURIComponent(lid) + '/' + encodeURIComponent(id) + '/r/' + key + '/'
    + encodeURIComponent(s.uid) + '.json?auth=' + encodeURIComponent(s.idToken);
  const res = await fetch(url, on ? { method: 'PUT', body: 'true' } : { method: 'DELETE' });
  return res.ok;
}

/** The owner taking a message down. */
export async function deleteChat(lid: string, id: string): Promise<boolean> {
  const s = await session();
  const res = await fetch(LIVE_URL + '/chat/' + encodeURIComponent(lid) + '/' + encodeURIComponent(id)
    + '.json?auth=' + encodeURIComponent(s.idToken), { method: 'DELETE' });
  return res.ok;
}

/**
 * Follow the chat until stopped. Calls back with the last hundred messages
 * on every change, and with an error when it cannot read them at all. Closes
 * while the app is in the background and catches up on return.
 */
export function watchChat(lid: string, onMessages: (m: ChatMessage[]) => void, onError: (why: string) => void): () => void {
  let stopped = false;
  let es: EventSource | null = null;
  let timer: number | undefined;

  // The same hundred messages read again are not news: redrawing the whole
  // chat for them every few seconds was what made it stutter.
  let last = '';
  const pull = async () => {
    try {
      const m = await readLast(lid);
      const sig = JSON.stringify(m);
      if (sig === last) return;
      last = sig;
      if (!stopped) onMessages(m);
    } catch (e) {
      if (!stopped) onError(String((e as Error).message));
    }
  };
  const poll = (on: boolean) => {
    if (on && !timer && !stopped) timer = window.setInterval(() => void pull(), 5000);
    if (!on && timer) { window.clearInterval(timer); timer = undefined; }
  };
  const open = async () => {
    if (stopped || es) return;
    if (typeof EventSource === 'undefined') { poll(true); return; }
    try {
      // The token goes in the address: an EventSource cannot set a header.
      // It lasts an hour, so a stream that errors is reopened with a fresh one.
      const s = await session();
      if (stopped) return;
      es = new EventSource(base(lid) + '?auth=' + encodeURIComponent(s.idToken));
      const bump = () => { if (!stopped) void pull(); };
      es.addEventListener('put', bump);
      es.addEventListener('patch', bump);
      es.addEventListener('auth_revoked', () => { close(); void open(); });
      es.onopen = () => poll(false);
      es.onerror = () => {
        poll(true);
        es?.close(); es = null;
        window.setTimeout(() => { if (!stopped) void open(); }, 8000);
      };
    } catch {
      poll(true);
    }
  };
  const close = () => { es?.close(); es = null; poll(false); };
  const onVisible = () => {
    if (document.visibilityState === 'hidden') close();
    else { void open(); void pull(); }
  };
  document.addEventListener('visibilitychange', onVisible);
  void open();
  void pull();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
    close();
  };
}
