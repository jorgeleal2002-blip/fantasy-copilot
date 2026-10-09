/**
 * A chat message pushed to the rest of the league.
 *
 * The thing being tested here is mostly the refusals. The worker holds no
 * database credentials, so anybody on the internet can post to this endpoint;
 * what stops them is that the message has to be readable back with the
 * caller's own token, and has to be recent. Both are easy to write and easy
 * to leave out, and leaving either out is not visible from the outside until
 * somebody's lock screen fills with messages nobody sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { said } from '../src/index';
import { subKey, type Env } from '../src/store';
import { fakeHandset, fakeKv, openAsHandset, type Handset } from './handset';

const LEAGUE = '123456789012345678';
const RTDB = 'https://db.example.com';

let kv: ReturnType<typeof fakeKv>;
let env: Env;
let jorge: Handset;
let ana: Handset;

/** The database, holding one message, and the push services. */
function stubNet(msg: unknown, opts: { status?: number } = {}) {
  const sent: { url: string; body: Uint8Array }[] = [];
  vi.stubGlobal('fetch', async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith(RTDB)) {
      // A refusal still carries a body — Firebase sends {"error": "..."} —
      // so the status has to be read rather than the shape guessed at.
      if (opts.status) {
        return new Response(JSON.stringify(msg ?? { error: 'Permission denied' }), { status: opts.status });
      }
      return new Response(JSON.stringify(msg));
    }
    sent.push({ url, body: new Uint8Array(init?.body as ArrayBuffer) });
    return new Response('', { status: 201 });
  });
  return { sent };
}

async function watcher(h: Handset, over: Record<string, unknown>) {
  await kv.put(await subKey(h.sub.endpoint), JSON.stringify({
    sub: h.sub, leagueId: LEAGUE, userId: '11111111111111111', names: {}, at: Date.now(), ...over,
  }));
}

beforeEach(async () => {
  kv = fakeKv();
  env = { COPILOT: kv, VAPID_SUBJECT: 'mailto:a@b.c', RTDB_URL: RTDB };
  jorge = await fakeHandset('https://push.example.com/send/jorge');
  ana = await fakeHandset('https://push.example.com/send/ana');
});

afterEach(() => vi.unstubAllGlobals());

const fresh = (over: Record<string, unknown> = {}) =>
  ({ uid: 'u-jorge', name: 'Doctors', text: 'cambio a Javonte?', at: Date.now(), ...over });

describe('a message handed to the watcher', () => {
  it('reaches the rest of the league, with the name on it', async () => {
    await watcher(ana, { uid: 'u-ana', chat: true });
    const { sent } = stubNet(fresh());
    const r = await said(env, { leagueId: LEAGUE, id: '-Nabc', token: 't', leagueName: 'Liga de Doctors' });

    expect(r).toEqual({ ok: true, sent: 1 });
    expect(sent).toHaveLength(1);
    const { text } = await openAsHandset(sent[0]?.body as Uint8Array, ana);
    expect(JSON.parse(text)).toEqual({
      title: 'Doctors · Liga de Doctors',
      body: 'cambio a Javonte?',
      tag: 'chat:' + LEAGUE,
      renotify: true,
    });
  });

  it('does not come back to the person who wrote it', async () => {
    await watcher(jorge, { uid: 'u-jorge', chat: true });
    await watcher(ana, { uid: 'u-ana', chat: true });
    const { sent } = stubNet(fresh({ uid: 'u-jorge' }));
    const r = await said(env, { leagueId: LEAGUE, id: '-Nabc', token: 't' });
    expect(r.sent).toBe(1);
    expect(sent[0]?.url).toBe(ana.sub.endpoint);
  });

  it('skips a phone that asked for no messages', async () => {
    await watcher(ana, { uid: 'u-ana', chat: false });
    const { sent } = stubNet(fresh());
    expect((await said(env, { leagueId: LEAGUE, id: '-Nabc', token: 't' })).sent).toBe(0);
    expect(sent).toEqual([]);
  });

  it('reaches somebody on tags-only when the message names them', async () => {
    await watcher(ana, { uid: 'u-ana', chat: true, tagsOnly: true, user: 'anaf' });
    const { sent } = stubNet(fresh({ text: 'oye @anaf me cambias?' }));
    expect((await said(env, { leagueId: LEAGUE, id: '-Nabc', token: 't' })).sent).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('leaves somebody on tags-only alone when it does not', async () => {
    await watcher(ana, { uid: 'u-ana', chat: true, tagsOnly: true, user: 'anaf' });
    stubNet(fresh({ text: 'buen juego' }));
    expect((await said(env, { leagueId: LEAGUE, id: '-Nabc', token: 't' })).sent).toBe(0);
  });

  it('never crosses into another league', async () => {
    await watcher(ana, { uid: 'u-ana', chat: true, leagueId: '999999999999999999' });
    const { sent } = stubNet(fresh());
    expect((await said(env, { leagueId: LEAGUE, id: '-Nabc', token: 't' })).sent).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe('what the endpoint refuses', () => {
  /* The whole of the security. A caller the database will not read for is a
     caller with no business pushing to this league. */
  it('a token the database rejects', async () => {
    await watcher(ana, { uid: 'u-ana', chat: true });
    const { sent } = stubNet(null, { status: 401 });
    const r = await said(env, { leagueId: LEAGUE, id: '-Nabc', token: 'forged' });
    expect(r.ok).toBe(false);
    expect(sent).toEqual([]);
  });

  /* The guard this pins is not the shape check below it. A refusal that
     happens to carry something message-shaped — a proxy, a captive portal, a
     future error format — would otherwise be pushed to the whole league on
     the strength of a 403. The status is the answer; the body is not. */
  it('a non-OK status, whatever the body claims to be', async () => {
    await watcher(ana, { uid: 'u-ana', chat: true });
    const { sent } = stubNet(fresh(), { status: 403 });
    const r = await said(env, { leagueId: LEAGUE, id: '-Nabc', token: 'forged' });
    expect(r).toEqual({ ok: false, why: 'database said 403' });
    expect(sent).toEqual([]);
  });

  it('an id that is not a message', async () => {
    await watcher(ana, { uid: 'u-ana', chat: true });
    const { sent } = stubNet(null);
    expect((await said(env, { leagueId: LEAGUE, id: '-Nope', token: 't' })).ok).toBe(false);
    expect(sent).toEqual([]);
  });

  /* Reading a message back proves it exists, not that it is new. Without a
     freshness window, a member's token replays the whole chat history one
     bubble at a time. */
  it('a real message from last month, replayed', async () => {
    await watcher(ana, { uid: 'u-ana', chat: true });
    const { sent } = stubNet(fresh({ at: Date.now() - 31 * 24 * 3600 * 1000 }));
    const r = await said(env, { leagueId: LEAGUE, id: '-Nabc', token: 't' });
    expect(r).toEqual({ ok: false, why: 'not fresh' });
    expect(sent).toEqual([]);
  });

  it('a message with no timestamp at all', async () => {
    await watcher(ana, { uid: 'u-ana', chat: true });
    const { sent } = stubNet({ uid: 'u-jorge', name: 'D', text: 'hola' });
    expect((await said(env, { leagueId: LEAGUE, id: '-Nabc', token: 't' })).ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it('a league id that is not one, without asking the database', async () => {
    let asked = false;
    vi.stubGlobal('fetch', async () => { asked = true; return new Response('{}'); });
    expect((await said(env, { leagueId: '../admins', id: '-Nabc', token: 't' })).ok).toBe(false);
    expect((await said(env, { leagueId: LEAGUE, id: '../../members', token: 't' })).ok).toBe(false);
    expect(asked).toBe(false);
  });

  it('anything at all in a build with no database behind it', async () => {
    const { sent } = stubNet(fresh());
    const r = await said({ ...env, RTDB_URL: undefined }, { leagueId: LEAGUE, id: '-Nabc', token: 't' });
    expect(r.ok).toBe(false);
    expect(sent).toEqual([]);
  });
});
