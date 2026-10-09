/**
 * The minute, end to end, with Sleeper and the push services played by a stub.
 *
 * This is the only place the wiring is exercised: the order the tally is
 * written in, who gets filtered out, what happens to a dead subscription. All
 * of it is the kind of thing that reads correctly and behaves wrongly, and
 * none of it can be seen from Cloudflare's logs until it has already buzzed
 * somebody at midnight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from '../src/index';
import { subKey, tallyKey, type Env } from '../src/store';
import { fakeHandset, fakeKv, openAsHandset, type Handset } from './handset';

/** A Sunday afternoon in New York, which `inGameWindow` says yes to. */
const SUNDAY = new Date('2025-10-05T18:30:00Z');
/** A Wednesday, which it says no to. */
const WEDNESDAY = new Date('2025-10-08T18:30:00Z');

const JAVONTE = '4035';
const BENCH = '9999';

interface Sent { url: string; body: Uint8Array; headers: Record<string, string> }

function stubNet(opts: {
  stats: Record<string, Record<string, number>>;
  starters?: string[];
  pushStatus?: number | ((url: string) => number);
}) {
  const sent: Sent[] = [];
  const hits: string[] = [];
  vi.stubGlobal('fetch', async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    hits.push(url);
    if (url.endsWith('/state/nfl')) {
      return new Response(JSON.stringify({ season: '2025', week: 5, season_type: 'regular' }));
    }
    if (url.includes('/stats/nfl/')) return new Response(JSON.stringify(opts.stats));
    if (url.includes('/rosters')) {
      return new Response(JSON.stringify([
        { owner_id: 'me', starters: opts.starters ?? [JAVONTE] },
        { owner_id: 'somebody', starters: ['1111'] },
      ]));
    }
    // Anything else is a push service.
    const status = typeof opts.pushStatus === 'function' ? opts.pushStatus(url) : opts.pushStatus ?? 201;
    sent.push({
      url,
      body: new Uint8Array(init?.body as ArrayBuffer),
      headers: (init?.headers || {}) as Record<string, string>,
    });
    return new Response('', { status });
  });
  return { sent, hits };
}

let kv: ReturnType<typeof fakeKv>;
let env: Env;
let phone: Handset;

beforeEach(async () => {
  kv = fakeKv();
  env = { COPILOT: kv, VAPID_SUBJECT: 'mailto:a@b.c' };
  phone = await fakeHandset();
  await kv.put(await subKey(phone.sub.endpoint), JSON.stringify({
    sub: phone.sub,
    leagueId: '123456789012345678',
    userId: 'me',
    names: { [JAVONTE]: { n: 'Javonte Williams', p: 'RB', t: 'DAL' } },
    at: Date.now(),
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('a minute of a game day', () => {
  it('touches nothing at all when no game is on', async () => {
    const { hits } = stubNet({ stats: {} });
    const r = await tick(env, WEDNESDAY);
    expect(r).toEqual({ looked: false, why: 'no game is on' });
    expect(hits).toEqual([]);
  });

  /* The first look is a Sunday already in progress, not six touchdowns. */
  it('says nothing on its first look, but remembers what it saw', async () => {
    const { sent } = stubNet({ stats: { [JAVONTE]: { rush_td: 1 }, other: { rec_td: 2 } } });
    const r = await tick(env, SUNDAY);
    expect(sent).toEqual([]);
    expect(r.scored).toBe(0);
    expect(JSON.parse(kv.map.get(tallyKey('2025', 5)) as string)).toEqual({ [JAVONTE]: 1, other: 2 });
  });

  it('pushes the touchdown that arrives after it', async () => {
    stubNet({ stats: { [JAVONTE]: { rush_td: 1 } } });
    await tick(env, SUNDAY);
    const { sent } = stubNet({ stats: { [JAVONTE]: { rush_td: 2 } } });
    const r = await tick(env, SUNDAY);

    expect(r.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(phone.sub.endpoint);
    expect(sent[0]?.headers['Content-Encoding']).toBe('aes128gcm');
    expect(sent[0]?.headers.Urgency).toBe('high');
    expect(sent[0]?.headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);

    const { text } = await openAsHandset(sent[0]?.body as Uint8Array, phone);
    expect(JSON.parse(text)).toEqual({
      title: 'Javonte Williams',
      body: 'Touchdown — his second today · RB · DAL',
      tag: 'td:5:' + JAVONTE + ':2',
    });
  });

  it('keeps quiet about a touchdown on the bench', async () => {
    stubNet({ stats: {}, starters: [JAVONTE] });
    await tick(env, SUNDAY);
    const { sent } = stubNet({ stats: { [BENCH]: { rec_td: 1 } }, starters: [JAVONTE] });
    const r = await tick(env, SUNDAY);
    expect(r.scored).toBe(1);
    expect(r.sent).toBe(0);
    expect(sent).toEqual([]);
  });

  it('reads the lineup live, so a start made ten minutes ago counts', async () => {
    stubNet({ stats: {}, starters: [] });
    await tick(env, SUNDAY);
    // The app never told the worker about this change; Sleeper did.
    const { sent } = stubNet({ stats: { [JAVONTE]: { rush_td: 1 } }, starters: [JAVONTE] });
    await tick(env, SUNDAY);
    expect(sent).toHaveLength(1);
  });

  it('names a scorer the app never sent a name for, rather than failing', async () => {
    stubNet({ stats: {}, starters: [BENCH] });
    await tick(env, SUNDAY);
    const { sent } = stubNet({ stats: { [BENCH]: { rec_td: 1 } }, starters: [BENCH] });
    await tick(env, SUNDAY);
    const { text } = await openAsHandset(sent[0]?.body as Uint8Array, phone);
    expect(JSON.parse(text).title).toBe('One of your starters');
  });

  /* A tally written after the sending would replay the whole afternoon on the
     next tick if anything here threw. */
  it('has already moved the tally on even when every push fails', async () => {
    stubNet({ stats: { [JAVONTE]: { rush_td: 1 } } });
    await tick(env, SUNDAY);
    stubNet({ stats: { [JAVONTE]: { rush_td: 2 } }, pushStatus: 500 });
    await tick(env, SUNDAY);
    expect(JSON.parse(kv.map.get(tallyKey('2025', 5)) as string)).toEqual({ [JAVONTE]: 2 });

    // And so the next minute, with nothing new, is silent.
    const { sent } = stubNet({ stats: { [JAVONTE]: { rush_td: 2 } } });
    await tick(env, SUNDAY);
    expect(sent).toEqual([]);
  });

  it('forgets a phone the push service calls gone', async () => {
    stubNet({ stats: {} });
    await tick(env, SUNDAY);
    stubNet({ stats: { [JAVONTE]: { rush_td: 1 } }, pushStatus: 410 });
    const r = await tick(env, SUNDAY);
    expect(r.dropped).toBe(1);
    expect(kv.map.has(await subKey(phone.sub.endpoint))).toBe(false);
  });

  it('keeps a phone whose push merely failed this minute', async () => {
    stubNet({ stats: {} });
    await tick(env, SUNDAY);
    stubNet({ stats: { [JAVONTE]: { rush_td: 1 } }, pushStatus: 503 });
    const r = await tick(env, SUNDAY);
    expect(r.dropped).toBe(0);
    expect(kv.map.has(await subKey(phone.sub.endpoint))).toBe(true);
  });

  it('reads a league roster once however many phones are watching it', async () => {
    const second = await fakeHandset('https://push.example.com/send/second');
    await kv.put(await subKey(second.sub.endpoint), JSON.stringify({
      sub: second.sub, leagueId: '123456789012345678', userId: 'me', names: {}, at: Date.now(),
    }));
    stubNet({ stats: {} });
    await tick(env, SUNDAY);
    const { hits, sent } = stubNet({ stats: { [JAVONTE]: { rush_td: 1 } } });
    await tick(env, SUNDAY);
    expect(hits.filter(u => u.includes('/rosters'))).toHaveLength(1);
    expect(sent).toHaveLength(2);
  });

  it('stays quiet through a stat correction that takes a touchdown away', async () => {
    stubNet({ stats: { [JAVONTE]: { rush_td: 2 } } });
    await tick(env, SUNDAY);
    const { sent } = stubNet({ stats: { [JAVONTE]: { rush_td: 1 } } });
    const r = await tick(env, SUNDAY);
    expect(sent).toEqual([]);
    expect(r.scored).toBe(0);
  });

  it('gives up quietly when Sleeper is down rather than wiping the tally', async () => {
    stubNet({ stats: { [JAVONTE]: { rush_td: 1 } } });
    await tick(env, SUNDAY);
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));
    const r = await tick(env, SUNDAY);
    expect(r.looked).toBe(false);
    expect(JSON.parse(kv.map.get(tallyKey('2025', 5)) as string)).toEqual({ [JAVONTE]: 1 });
  });
});
