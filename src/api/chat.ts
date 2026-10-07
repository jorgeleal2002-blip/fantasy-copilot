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
  text: string;
  at: number;
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
    .map(([id, m]) => ({ id, ...m, trade: readTrade(m.trade), rid: typeof m.rid === 'number' ? m.rid : undefined }))
    .sort((a, b) => (a.at || 0) - (b.at || 0));
}

/** Post a message. False when the database refused it (not let in, or the
 *  chat rules not published). */
export async function sendChat(lid: string, m: Omit<ChatMessage, 'id' | 'uid' | 'at'>): Promise<boolean> {
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

  const pull = async () => {
    try {
      const m = await readLast(lid);
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
