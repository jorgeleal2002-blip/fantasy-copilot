/**
 * The thing that is awake when your phone is not.
 *
 * Every minute of a game day it reads the same box score the app reads, works
 * out which touchdowns are new since the last minute, and pushes the ones
 * scored by somebody's starters. That is the whole of it. The two halves worth
 * testing — the encryption and the "what is new" — are in their own modules
 * with their own tests; this file is the wiring, and is kept thin on purpose
 * because none of it can be exercised without Cloudflare and Sleeper both on
 * the other end of it.
 */
import { inGameWindow } from './window';
import { mine, newScores, tdAlert, tdCounts, type StatLine } from './watch';
import { vapidKeys, vapidPublic } from './vapid';
import { isGone, sendPush } from './webpush';
import { chatAlert, wantsMessage, type ChatSaid } from './chat';
import {
  MAX_WATCHERS, chatPrefsOf, listWatchers, subKey, tallyKey, validWatcher, type Env, type Watcher,
} from './store';

const SLEEPER = 'https://api.sleeper.app/v1';

/** Where complaints about this sender should go. An https: is a valid VAPID
 *  subject and needs no address to be published anywhere. */
const DEFAULT_SUBJECT = 'https://github.com/jorgeleal2002-blip/fantasy-copilot';

async function sleeper<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(SLEEPER + path, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

interface NflState { season: string; week: number; season_type: string }
interface Roster { owner_id: string | null; starters?: string[] | null }

/* ── The minute ─────────────────────────────────────────────────────────── */

export interface TickReport {
  looked: boolean;
  why?: string;
  scored?: number;
  sent?: number;
  dropped?: number;
}

export async function tick(env: Env, now: Date = new Date()): Promise<TickReport> {
  if (!inGameWindow(now)) return { looked: false, why: 'no game is on' };

  const state = await sleeper<NflState>('/state/nfl');
  if (!state?.season || !state.week) return { looked: false, why: 'no NFL state' };
  const kind = state.season_type === 'post' ? 'post' : 'regular';
  const stats = await sleeper<Record<string, StatLine>>(
    '/stats/nfl/' + kind + '/' + state.season + '/' + state.week,
  );
  if (!stats) return { looked: false, why: 'no stats' };

  const counts = tdCounts(stats);
  const key = tallyKey(state.season, state.week);
  const raw = await env.COPILOT.get(key);
  let prev: Record<string, number> | null = null;
  if (raw) { try { prev = JSON.parse(raw) as Record<string, number>; } catch { prev = null; } }

  const scored = newScores(prev, counts);

  /* Written before a single push goes out, not after. If this run dies
     halfway through the sending, the next one must not look at an unchanged
     tally and announce the same six touchdowns again. The cost is that a run
     which dies loses the alerts it had not sent yet, which is the right way
     round: a missed notification is a disappointment, and a repeat storm at
     one in the morning is why people turn notifications off. */
  await env.COPILOT.put(key, JSON.stringify(counts));
  if (!scored.length) return { looked: true, scored: 0, sent: 0 };

  const watchers = await listWatchers(env.COPILOT);
  if (!watchers.length) return { looked: true, scored: scored.length, sent: 0 };

  // One roster read per league, however many phones are watching it.
  const rosters = new Map<string, Roster[]>();
  for (const lid of new Set(watchers.map(w => w.w.leagueId))) {
    rosters.set(lid, (await sleeper<Roster[]>('/league/' + lid + '/rosters')) || []);
  }

  const vapid = await vapidKeys(env.COPILOT, env.VAPID_SUBJECT || DEFAULT_SUBJECT);
  let sent = 0;
  let dropped = 0;

  for (const { key: k, w } of watchers) {
    /* The lineup is read live rather than taken from what the app last sent,
       so a start/sit changed on Sleeper five minutes before kickoff counts.
       The names are the app's, because the worker has no player file — the
       whole one is megabytes and this runs every minute. */
    const roster = (rosters.get(w.leagueId) || []).find(r => r.owner_id === w.userId);
    for (const s of mine(scored, roster?.starters)) {
      const who = w.names?.[s.id];
      const alert = tdAlert(s, who?.n || 'One of your starters', who?.p || '', who?.t || '', state.week);
      const res = await sendPush(w.sub, JSON.stringify(alert), vapid);
      if (res.ok) { sent++; continue; }
      if (res.gone) { await env.COPILOT.delete(k); dropped++; }
    }
  }
  return { looked: true, scored: scored.length, sent, dropped };
}

/* ── A message in the league chat ───────────────────────────────────────── */

/**
 * How late a message may be and still be worth pushing.
 *
 * The verification below proves a message EXISTS; it does not prove it is
 * new. Without this, anybody holding a member's token could replay last
 * month's message ids and push the whole chat history at the league one
 * bubble at a time.
 */
const SAID_FRESH_MS = 5 * 60 * 1000;

interface SaidBody { leagueId?: string; id?: string; token?: string; leagueName?: string }

/**
 * Push a chat message to the rest of the league.
 *
 * The worker holds no database credentials, so it cannot read the chat on its
 * own and cannot take the caller's word for what was said. It reads the
 * message back using the SENDER'S OWN token: if the database hands it over,
 * the message is real, it is in that league, and whoever asked was a member
 * entitled to read it. The token is used for that one request and never
 * stored.
 *
 * Forgery then reduces to the chat's own threat model — faking a notification
 * requires being a member who could have posted the message for real, in
 * which case the notification is honest.
 */
export async function said(env: Env, body: SaidBody | null): Promise<{ ok: boolean; sent?: number; why?: string }> {
  const lid = body?.leagueId;
  const id = body?.id;
  const token = body?.token;
  if (!env.RTDB_URL) return { ok: false, why: 'no database configured' };
  if (!lid || !/^[0-9]{5,25}$/.test(lid)) return { ok: false, why: 'bad league' };
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, why: 'bad id' };
  if (!token || token.length > 4096) return { ok: false, why: 'bad token' };

  const base = env.RTDB_URL.replace(/\/+$/, '');
  let msg: (ChatSaid & { at?: number }) | null = null;
  try {
    const res = await fetch(
      base + '/chat/' + encodeURIComponent(lid) + '/' + encodeURIComponent(id)
      + '.json?auth=' + encodeURIComponent(token),
    );
    if (!res.ok) return { ok: false, why: 'database said ' + res.status };
    msg = await res.json() as ChatSaid & { at?: number };
  } catch {
    return { ok: false, why: 'database unreachable' };
  }
  if (!msg || typeof msg.text !== 'string' || typeof msg.uid !== 'string') {
    return { ok: false, why: 'no such message' };
  }
  if (!(typeof msg.at === 'number' && Date.now() - msg.at < SAID_FRESH_MS)) {
    return { ok: false, why: 'not fresh' };
  }

  const watchers = (await listWatchers(env.COPILOT)).filter(x => x.w.leagueId === lid);
  if (!watchers.length) return { ok: true, sent: 0 };

  const alert = chatAlert(msg, lid, body?.leagueName);
  const vapid = await vapidKeys(env.COPILOT, env.VAPID_SUBJECT || DEFAULT_SUBJECT);
  let sent = 0;
  for (const { key, w } of watchers) {
    if (!wantsMessage(msg, w)) continue;
    const res = await sendPush(w.sub, JSON.stringify(alert), vapid);
    if (res.ok) sent++;
    else if (res.gone) await env.COPILOT.delete(key);
  }
  return { ok: true, sent };
}

/* ── The endpoints the app talks to ─────────────────────────────────────── */

const cors = (env: Env) => ({
  'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
});

const json = (env: Env, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors(env) },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });

    if (url.pathname === '/vapid' && request.method === 'GET') {
      return json(env, { key: await vapidPublic(env.COPILOT) });
    }

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!validWatcher(body)) return json(env, { error: 'not a subscription' }, 400);
      const k = await subKey(body.sub.endpoint);
      /* The ceiling is only checked for a phone that is NOT already here, so a
         full store still lets its own subscribers re-register — otherwise
         everyone's subscription silently rots the day the limit is reached. */
      if (!(await env.COPILOT.get(k))) {
        const held = await listWatchers(env.COPILOT);
        if (held.length >= MAX_WATCHERS) return json(env, { error: 'full' }, 507);
      }
      const watcher: Watcher = {
        ...body, ...chatPrefsOf(body), names: body.names || {}, at: Date.now(),
      };
      await env.COPILOT.put(k, JSON.stringify(watcher));
      return json(env, { ok: true });
    }

    if (url.pathname === '/unsubscribe' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as { endpoint?: string } | null;
      if (!body?.endpoint) return json(env, { error: 'no endpoint' }, 400);
      await env.COPILOT.delete(await subKey(body.endpoint));
      return json(env, { ok: true });
    }

    if (url.pathname === '/said' && request.method === 'POST') {
      return json(env, await said(env, await request.json().catch(() => null)));
    }

    // Somewhere to look when nothing is arriving, that reveals nothing.
    if (url.pathname === '/health') {
      return json(env, { ok: true, watching: (await listWatchers(env.COPILOT)).length });
    }

    return json(env, { error: 'no such path' }, 404);
  },

  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(tick(env).then(r => {
      // Shows up in `wrangler tail`, which is the only window into this.
      console.log(JSON.stringify(r));
    }));
  },
};

export { isGone };
