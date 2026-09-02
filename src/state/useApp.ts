import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  findUser, getDraftPicks, getRosters, getSeasonStats, getTradedPicks, getUsers,
  loadLeague, matchMe, userLeagues, playerPhoto,
} from '../api/sleeper';
import type { LeagueBundle, PosFilter, SleeperLeague } from '../api/types';
import { DRAFT_POLL_MS, STORAGE_ACCOUNTS, STORAGE_BLOCK, STORAGE_PHOTOS, STORAGE_SAVED, STORAGE_SESSION, STORAGE_TEAM, StratKey, USAGE_V } from '../model/constants';
import {
  EMPTY_ROOM, claimSeat, createRoom as createRoomAt, liveEnabled, liveReason, newRoomId,
  pushPick, readRoom, startRoom, watchRoom, type Room,
} from '../api/live';
import {
  ROOM_LEN, cleanRoomCode, clearInvite, isRoomCode, parseInvite, roomCodeProblem, type Invite,
} from '../model/invite';
import { loadMarket, type Market } from '../model/market';
import { buildModel } from '../model/model';
import type { SavedTrade } from '../model/types';
import { blendSeasons, seasonUsage, type UsageMap } from '../model/usage';
import { nextDetailStack, topDetail } from './detail-stack';

export type Stage = 'connect' | 'leagues' | 'app';
export type Tab = 'team' | 'trades' | 'draft' | 'league' | 'settings';
export type TeamView = 'resumen' | 'lineup' | 'roster' | 'activos';
export type FeedState = 'idle' | 'loading' | 'ok' | 'fail';

export const BOOT_STEPS = [
  'League and format',
  'Managers and draft order',
  'Draft status and picks',
  'Sleeper NFL catalog',
  'Computing ratings',
];

/** Feeds are shared across league views within a session, keyed by what they
 *  actually depend on — the market is format-specific, usage is per season. */
const marketCache = new Map<string, Market>();
const usageCache = new Map<string, UsageMap>();
const seasonCache = new Map<string, string>();

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or quota — the app works without persistence */
  }
}

export function useApp() {
  // ── session
  const [stage, setStage] = useState<Stage>('connect');
  const [username, setUsername] = useState('');
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  /** leagueId → roster_id you named as yours, when the account you signed in
   *  with is not the one holding it. */
  const [teamPick, setTeamPick] = useState<Record<string, number>>({});
  /** Everyone who has signed in on this device. More than one person uses a
   *  phone, and each of them has their own team. */
  const [accounts, setAccounts] = useState<{ username: string; leagueId: string }[]>([]);
  /** "username/leagueId" → the players you are shopping. */
  const [blocks, setBlocks] = useState<Record<string, string[]>>({});
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  // ── league data
  const [data, setData] = useState<LeagueBundle | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  // ── side feeds
  const [usage, setUsage] = useState<UsageMap>({});
  const [usageState, setUsageState] = useState<FeedState>('idle');
  const [usageSeasons, setUsageSeasons] = useState('');
  const [market, setMarket] = useState<Market | null>(null);
  const [marketState, setMarketState] = useState<FeedState>('idle');

  // ── view state
  const [tab, setTab] = useState<Tab>('team');
  const [teamView, setTeamView] = useState<TeamView>('resumen');
  const [draftView, setDraftView] = useState<'board' | 'mock' | 'deals'>('board');
  // Seeded, so a mock stays put while you read it and only changes when
  // you ask for another run.
  const [mockSeed, setMockSeed] = useState(1);
  /** overall pick → the player you took there, keyed so the sim can replay it */
  const [mockChoices, setMockChoices] = useState<Record<number, string>>({});
  /** null = your real seat; a number = the slot you are mocking from instead */
  const [mockSlot, setMockSlot] = useState<number | null>(null);
  /** the room takes over the screen — a draft room is not a panel on a page */
  const [mockOpen, setMockOpen] = useState(false);
  /** The room opens in a lobby: an empty board, seats to claim, and a start
   *  button. Nothing is drafted until you say go. */
  const [mockStarted, setMockStarted] = useState(false);
  /** An invite waiting to be honoured: read once from the address bar, held
   *  until the league it names has actually finished loading. */
  const invite = useRef<Invite | null>(null);

  /* ── The shared room.
   *
   * When one is open it OWNS the mock: the seed, the picks and who is sitting
   * where all come from the database rather than from this device, so every
   * phone in the room derives the same draft. With no room these stay null and
   * the mock is the solo one it has always been. */
  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomError, setRoomError] = useState('');
  const [tradeView, setTradeView] = useState<'suggested' | 'block' | 'saved'>('suggested');
  // A redraft board holds kickers and defences too, so the picker that filters
  // it has to be able to say so.
  const [filter, setFilter] = useState<PosFilter>('ALL');
  const [rosterFilter, setRosterFilter] = useState<'ALL' | 'QB' | 'RB' | 'WR' | 'TE'>('ALL');
  const [rosterSort, setRosterSort] = useState<'value' | 'age' | 'snap'>('value');
  const [boardMode, setBoardMode] = useState<'rookies' | 'fa'>('rookies');
  const [rankMode, setRankMode] = useState<'now' | 'future' | 'fit' | 'fitFut'>('now');
  const [pickSel, setPickSel] = useState(0);
  const [strat, setStrat] = useState<StratKey>('balanced');
  /* Sheets stack: opening a player from a rival's team has to come back to
   * that team, not to the tab underneath it. Only the top one renders. */
  const [detailStack, setDetailStack] = useState<string[]>([]);
  const detail = topDetail(detailStack);

  /** An id opens a sheet on top; null steps back one level. */
  const setDetail = useCallback((id: string | null) => {
    setDetailStack(stack => nextDetailStack(stack, id));
  }, []);

  const [query, setQuery] = useState('');
  const [topPos, setTopPos] = useState<'ALL' | 'QB' | 'RB' | 'WR' | 'TE'>('ALL');
  const [topLens, setTopLens] = useState<'neutral' | 'me' | 'fut'>('neutral');
  const [topOpen, setTopOpen] = useState(false);
  const [passed, setPassed] = useState<string[]>([]);
  // Every league's shortlist lives in one record; the screens only ever see
  // the current league's, so a saved deal cannot follow you somewhere it
  // makes no sense.
  const [savedAll, setSavedAll] = useState<SavedTrade[]>([]);

  // ── ephemera
  const [toast, setToast] = useState('');
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const toastTimer = useRef<number | undefined>(undefined);
  const poll = useRef<number | undefined>(undefined);
  const dataRef = useRef<LeagueBundle | null>(null);
  dataRef.current = data;

  const showToast = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  }, []);

  const hideToast = useCallback(() => {
    window.clearTimeout(toastTimer.current);
    setToast('');
  }, []);

  // ── the two side feeds. Both degrade loudly rather than silently faking data.
  const fetchMarket = useCallback(async (league: SleeperLeague, force = false) => {
    const key = league.league_id;
    if (!force && marketCache.has(key)) {
      setMarket(marketCache.get(key)!);
      setMarketState('ok');
      return;
    }
    setMarketState('loading');
    try {
      const m = await loadMarket(league);
      marketCache.set(key, m);
      setMarket(m);
      setMarketState('ok');
    } catch {
      setMarketState('fail');
    }
  }, []);

  const fetchUsage = useCallback(async (bundle: LeagueBundle) => {
    // Three seasons, not one: a single year is a small sample, and one injury
    // or a new coordinator moves every number in it. Usage only exists for a
    // finished season, so we count back from the league's own year.
    const latest = (Number(bundle.league.season) || new Date().getFullYear()) - 1;
    const years = [latest, latest - 1, latest - 2];
    const key = USAGE_V + ':' + latest;
    if (usageCache.has(key)) {
      setUsage(usageCache.get(key)!);
      setUsageSeasons(seasonCache.get(key) || '');
      setUsageState('ok');
      return;
    }
    setUsageState('loading');
    try {
      const loaded: { year: number; usage: UsageMap }[] = [];
      for (const year of years) {
        try {
          const stats = await getSeasonStats(year);
          if (stats && typeof stats === 'object') {
            loaded.push({ year, usage: seasonUsage(stats, bundle.players) });
          }
        } catch {
          /* one season being down does not take the others with it */
        }
      }
      const u = blendSeasons(loaded, bundle.players);
      const label = loaded.map(l => l.year).join(' · ');
      usageCache.set(key, u);
      seasonCache.set(key, label);
      setUsage(u);
      setUsageSeasons(label);
      setUsageState('ok');
    } catch {
      setUsageState('fail');
    }
  }, []);

  // ── While a draft is live, re-read picks so the board, your assets and the
  //    pick-movement offers recompute themselves as players come off the board.
  const startPolling = useCallback((draftId: string) => {
    window.clearInterval(poll.current);
    poll.current = window.setInterval(async () => {
      const d = dataRef.current;
      if (!d || !d.draft) return;
      try {
        const picks = await getDraftPicks(draftId);
        if ((picks || []).length !== (d.picks || []).length) {
          setData({ ...d, picks });
          setSyncedAt(Date.now());
        }
      } catch {
        /* try again next tick */
      }
    }, DRAFT_POLL_MS);
  }, []);

  const load = useCallback(async (lid: string, user: string) => {
    setStep(0);
    setError('');
    try {
      const bundle = await loadLeague(lid, user, setStep);
      setStep(5);
      setData(bundle);
      setSyncedAt(Date.now());
      if (bundle.draft && (bundle.draft.status === 'drafting' || bundle.draft.status === 'pre_draft')) {
        startPolling(bundle.draft.draft_id);
      }
      void fetchUsage(bundle);
      void fetchMarket(bundle.league);
    } catch (e) {
      setError(
        'Could not read the league from Sleeper (' + (e as Error).message + '). ' +
        'On a first load the player catalog is several MB — try again.',
      );
    }
  }, [fetchMarket, fetchUsage, startPolling]);

  // ── boot: resume the saved session, or ask for a username.
  useEffect(() => {
    setPhotos(readJson<Record<string, string>>(STORAGE_PHOTOS, {}));
    setSavedAll(readJson<SavedTrade[]>(STORAGE_SAVED, []));
    setTeamPick(readJson<Record<string, number>>(STORAGE_TEAM, {}));
    setAccounts(readJson<{ username: string; leagueId: string }[]>(STORAGE_ACCOUNTS, []));
    setBlocks(readJson<Record<string, string[]>>(STORAGE_BLOCK, {}));
    const saved = readJson<{ username?: string; leagueId?: string } | null>(STORAGE_SESSION, null);

    // An invited mock overrides the league you last had open — the link is a
    // request to be somewhere specific. It is taken out of the address bar
    // immediately: an installed PWA reloads on its own, and a link that
    // survives the reload would keep dragging you back into the same room.
    const inv = parseInvite(window.location.search);
    if (inv) {
      invite.current = inv;
      setMockSeed(inv.seed);
      setMockSlot(inv.seat);
      clearInvite();
    }

    if (saved && saved.leagueId && saved.username) {
      const id = inv ? inv.leagueId : saved.leagueId;
      setUsername(saved.username);
      setLeagueId(id);
      setStage('app');
      void load(id, saved.username);
    } else {
      setStage('connect');
    }
    return () => {
      window.clearTimeout(toastTimer.current);
      window.clearInterval(poll.current);
    };
  }, [load]);

  const connectUser = useCallback(async () => {
    const name = (username || '').trim().replace(/^@/, '');
    if (!name) {
      setAuthError('Enter your Sleeper username.');
      return;
    }
    setAuthBusy(true);
    setAuthError('');
    try {
      const user = await findUser(name);
      const found = await userLeagues(user.user_id);
      setUsername(name);
      setLeagues(found);
      setStage('leagues');
    } catch (e) {
      setAuthError(
        (e as Error).message === 'noleagues'
          ? 'That user has no active NFL leagues.'
          : 'Could not find @' + name + '. Use your username, not your team name.',
      );
    } finally {
      setAuthBusy(false);
    }
  }, [username]);

  const pickLeague = useCallback((id: string) => {
    writeJson(STORAGE_SESSION, { username, leagueId: id });
    // Remember who just signed in, newest first, so the next person — or this
    // one coming back — is one tap rather than a username typed from memory.
    setAccounts(prev => {
      const next = [{ username, leagueId: id }]
        .concat(prev.filter(a => a.username.toLowerCase() !== username.toLowerCase()))
        .slice(0, 8);
      writeJson(STORAGE_ACCOUNTS, next);
      return next;
    });
    window.clearInterval(poll.current);
    setLeagueId(id);
    setStage('app');
    setData(null);
    setStep(0);
    setPassed([]);
    setDetailStack([]);
    setTab('team');
    void load(id, username);
  }, [load, username]);



  /* Follow the room for as long as one is open. Every change re-reads it, so
   * two phones cannot drift apart over a dropped delta. */
  useEffect(() => {
    if (!roomId) { setRoom(null); return undefined; }
    return watchRoom(roomId, setRoom, () => setRoomError('Lost the room. Still trying.'));
  }, [roomId]);

  const me = data?.me;

  /** Open a room on this board and sit down in your own seat. */
  const hostRoom = useCallback(async (seat: number | null): Promise<string | null> => {
    if (!liveEnabled() || !leagueId || !me) return null;
    const id = newRoomId();
    const who = { id: me.user_id, name: me.display_name || username };
    try {
      const fresh = EMPTY_ROOM(mockSeed, leagueId, me.user_id);
      if (seat) fresh.seats[String(seat)] = who;
      await createRoomAt(id, fresh);
      setRoomError('');
      setRoomId(id);
      return id;
    } catch (e) {
      setRoomError(liveReason(e, 'open the room'));
      return null;
    }
  }, [leagueId, me, mockSeed, username]);

  /** Walk into somebody else's room. The seed comes with it — that is what
   *  makes it the same draft rather than a similar one. */
  const joinRoom = useCallback(async (id: string, seat: number | null) => {
    if (!liveEnabled() || !me) return;
    try {
      const found = await readRoom(id);
      if (!found) { setRoomError('No room with that code.'); return; }
      setMockSeed(found.seed);
      if (seat) await claimSeat(id, seat, { id: me.user_id, name: me.display_name || username });
      setRoomError('');
      setRoomId(id);
    } catch (e) {
      setRoomError(liveReason(e, 'reach the room'));
    }
  }, [me, username]);

  /**
   * Walk into a room from the code alone.
   *
   * A link means leaving the app — out to a browser, back in, and on a phone
   * that is a different window with a different session. The code is six
   * characters chosen so they survive being read out loud, so typing them is
   * the shorter path and the one that never leaves the screen.
   *
   * The one thing a code cannot carry that a link can is WHICH LEAGUE the room
   * is drafting, and that matters: the promise is the same board, and a room
   * opened on another league is a different board entirely. So the room is
   * read first and its league is honoured — switched to when this account is
   * in it, and said plainly when it is not, rather than silently running their
   * seed against your players.
   */
  const joinByCode = useCallback(async (raw: string) => {
    const code = cleanRoomCode(raw);
    if (!liveEnabled()) { setRoomError('Shared rooms are not switched on in this build.'); return; }
    const problem = roomCodeProblem(code);
    if (problem) { setRoomError(problem); return; }
    if (!isRoomCode(code)) { setRoomError('A room code is ' + ROOM_LEN + ' characters.'); return; }
    if (!me) { setRoomError('Sign in first.'); return; }
    try {
      const found = await readRoom(code);
      if (!found) { setRoomError('No room with that code. Codes are case-insensitive.'); return; }
      if (found.leagueId && leagueId && found.leagueId !== leagueId) {
        const other = leagues.find(l => l.league_id === found.leagueId);
        if (!other) {
          setRoomError('That room is drafting a league this account is not in. '
            + 'Whoever opened it can send you the link instead.');
          return;
        }
        // The league has to load before the room means anything, and there is
        // already a mechanism that waits for exactly that.
        invite.current = { leagueId: found.leagueId, seed: found.seed, seat: null, room: code };
        setRoomError('');
        showToast('Switching to ' + other.name + ' for room ' + code + '.');
        pickLeague(found.leagueId);
        return;
      }
      setMockSeed(found.seed);
      setMockChoices({});
      setMockStarted(false);
      setRoomError('');
      setRoomId(code);
      setDraftView('mock');
      setMockOpen(true);
    } catch (e) {
      setRoomError(liveReason(e, 'reach the room'));
    }
  }, [me, leagueId, leagues, pickLeague, showToast]);

  const takeSeat = useCallback(async (seat: number) => {
    if (!roomId || !me) return;
    try {
      // Every seat this account is already in, vacated in the same write.
      const held = Object.keys(room?.seats || {})
        .map(Number)
        .filter(n => n && room?.seats[n]?.id === me.user_id);
      await claimSeat(roomId, seat, { id: me.user_id, name: me.display_name || username }, held);
    } catch (e) {
      setRoomError(liveReason(e, 'take that seat'));
    }
  }, [roomId, me, username, room]);

  const leaveRoom = useCallback(() => {
    setRoomId(null);
    setRoom(null);
    setRoomError('');
    setMockChoices({});
  }, []);

  /* What the mock actually runs on. In a room these come from the database, so
   * every phone derives the same draft; alone they are this device's own. */
  const liveChoices = useMemo(() => {
    if (!room) return null;
    const out: Record<number, string> = {};
    Object.keys(room.picks || {}).forEach(k => { out[Number(k)] = room.picks[k]; });
    return out;
  }, [room]);

  /**
   * Seats with a PERSON in them. The mock waits on these instead of botting.
   *
   * At most one of them is you, however many your id is sitting in. A room that
   * already has you in four seats — from before claiming released the last one
   * — would otherwise stop four times over, every stop waiting for you, and the
   * bots would never take a turn at all.
   */
  const humanSeats = useMemo(() => {
    if (!room) return null;
    const seats = room.seats || {};
    const mine = me?.user_id;
    const out = Object.keys(seats)
      .map(Number)
      .filter(n => n && seats[n] && seats[n].id !== mine);
    const own = mine
      ? Object.keys(seats).map(Number).filter(n => n && seats[n]?.id === mine).sort((a, b) => a - b)[0]
      : 0;
    return own ? out.concat([own]) : out;
  }, [room, me]);

  /** Where YOU are sitting in the room, which may not be your league seat. */
  const mySeat = useMemo(() => {
    if (!room || !me) return null;
    const hit = Object.keys(room.seats || {}).find(k => room.seats[k]?.id === me.user_id);
    return hit ? Number(hit) : null;
  }, [room, me]);

  /**
   * Honour a pending invite, in the two places it can become possible.
   *
   * A guest who has never used the app lands on the sign-in screen; once their
   * username resolves they would normally be shown a list of their leagues,
   * but the link already named one, so it is chosen for them. A guest who is
   * already signed in skips straight past that, and only has to wait for the
   * league to finish loading before the room can open.
   */
  useEffect(() => {
    const inv = invite.current;
    if (!inv) return;
    if (stage === 'leagues') {
      pickLeague(inv.leagueId);
      return;
    }
    if (stage === 'app' && data && leagueId === inv.leagueId) {
      invite.current = null;
      setTab('draft');
      setDraftView('mock');
      setMockChoices({});
      setMockStarted(false);
      setMockOpen(true);
      if (inv.room) {
        // A real room: walk in and sit down. The seed travels with the room,
        // so the board is theirs rather than a fresh one of ours.
        void joinRoom(inv.room, inv.seat ?? null);
        showToast('Joining room ' + inv.room + ' — take a seat.');
      } else {
        showToast('Same board as the friend who invited you — your own seat.');
      }
    }
  }, [stage, data, leagueId, pickLeague, showToast, joinRoom]);

  /** Change league without signing out — reuses the stored username. */
  const switchLeague = useCallback(async () => {
    setAuthError('');
    setStage('leagues');
    if (!leagues.length) await connectUser();
  }, [connectUser, leagues.length]);

  /** Sign in as somebody already known to this device. */
  const switchAccount = useCallback((acc: { username: string; leagueId: string }) => {
    writeJson(STORAGE_SESSION, acc);
    window.clearInterval(poll.current);
    marketCache.clear();
    setUsername(acc.username);
    setLeagueId(acc.leagueId);
    setLeagues([]);
    setAuthError('');
    setStage('app');
    setData(null);
    setStep(0);
    setPassed([]);
    setDetailStack([]);
    setTab('team');
    void load(acc.leagueId, acc.username);
  }, [load]);

  /** Drop an account from the list without touching whoever is signed in. */
  const forgetAccount = useCallback((name: string) => {
    setAccounts(prev => {
      const next = prev.filter(a => a.username.toLowerCase() !== name.toLowerCase());
      writeJson(STORAGE_ACCOUNTS, next);
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    try { localStorage.removeItem(STORAGE_SESSION); } catch { /* ignore */ }
    window.clearInterval(poll.current);
    marketCache.clear();
    // The next person to meet this screen may not be the last one. Leaving
    // their username in the box invites signing in as them by accident.
    setUsername('');
    setStage('connect');
    setData(null);
    setLeagues([]);
    setLeagueId(null);
    setAuthError('');
    setDetailStack([]);
    setTab('team');
    setMarket(null);
    setMarketState('idle');
  }, []);

  /** Re-ask for rosters, traded picks and market values, then recompute. */
  const refreshAll = useCallback(async () => {
    const d = dataRef.current;
    if (!d || !leagueId) return;
    setSyncing(true);
    try {
      const [rosters, users, traded] = await Promise.all([
        getRosters(leagueId),
        getUsers(leagueId),
        getTradedPicks(leagueId).catch(() => d.traded || []),
      ]);
      const picks = d.draft ? await getDraftPicks(d.draft.draft_id).catch(() => d.picks) : d.picks;
      setData({ ...d, rosters, users, traded, picks, me: matchMe(users, username) });
      setSyncedAt(Date.now());
      await fetchMarket(d.league, true);
      showToast('Updated: rosters, picks and market values.');
    } catch {
      showToast('Could not update right now. Try again.');
    } finally {
      setSyncing(false);
    }
  }, [fetchMarket, leagueId, showToast, username]);

  /** Cheaper refresh used by the draft board: picks only. */
  const refreshPicks = useCallback(async () => {
    const d = dataRef.current;
    if (!d || !d.draft) return;
    try {
      const picks = await getDraftPicks(d.draft.draft_id);
      setData({ ...d, picks });
      showToast('Board updated · ' + picks.length + ' picks');
    } catch {
      showToast('Could not update the picks.');
    }
  }, [showToast]);

  const retry = useCallback(() => {
    if (leagueId) void load(leagueId, username);
  }, [leagueId, load, username]);

  // ── Player photos: whatever you upload wins over Sleeper's portrait.
  const photoFor = useCallback(
    (id: string, size?: 'thumb' | 'full') => photos[id] || playerPhoto(id, size),
    [photos],
  );

  const setPhoto = useCallback((id: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Square-crop and downscale before storing: localStorage is small and a
        // camera roll photo would blow the quota on its own.
        const size = 160;
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        setPhotos(prev => {
          const next = { ...prev, [id]: c.toDataURL('image/jpeg', 0.82) };
          writeJson(STORAGE_PHOTOS, next);
          return next;
        });
        showToast('Photo updated');
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }, [showToast]);

  const clearPhoto = useCallback((id: string) => {
    setPhotos(prev => {
      const next = { ...prev };
      delete next[id];
      writeJson(STORAGE_PHOTOS, next);
      return next;
    });
    showToast('Original photo restored');
  }, [showToast]);

  // ── The shortlist: trades you said you were interested in.
  const saved = useMemo(
    () => savedAll.filter(t => t.leagueId === leagueId).sort((a, b) => b.savedAt - a.savedAt),
    [savedAll, leagueId],
  );
  const savedKeys = useMemo(() => new Set(saved.map(t => t.key)), [saved]);
  const isSaved = useCallback((key: string) => savedKeys.has(key), [savedKeys]);

  const unsaveTrade = useCallback((key: string) => {
    setSavedAll(prev => {
      const next = prev.filter(t => !(t.key === key && t.leagueId === leagueId));
      writeJson(STORAGE_SAVED, next);
      return next;
    });
    showToast('Removed from your shortlist');
  }, [leagueId, showToast]);

  /** Tapping the same trade twice takes it back off the list. */
  const toggleSaved = useCallback((t: Omit<SavedTrade, 'leagueId' | 'savedAt'>) => {
    if (!leagueId) return;
    setSavedAll(prev => {
      const mine = prev.some(x => x.key === t.key && x.leagueId === leagueId);
      const next = mine
        ? prev.filter(x => !(x.key === t.key && x.leagueId === leagueId))
        : prev.concat([{ ...t, leagueId, savedAt: Date.now() }]);
      writeJson(STORAGE_SAVED, next);
      showToast(mine ? 'Removed from your shortlist' : 'Saved — propose it in Sleeper when you are ready');
      return next;
    });
  }, [leagueId, showToast]);

  // ── The model is pure: it re-derives whenever any of its inputs move.
  const model = useMemo(
    () => (data ? buildModel({
      data, usage, market, strat, boardMode, pickSel,
      myRosterId: leagueId ? teamPick[username + '/' + leagueId] ?? null : null,
      block: leagueId ? blocks[username + '/' + leagueId] : undefined,
    }) : null),
    [data, usage, market, strat, boardMode, pickSel, leagueId, username, teamPick, blocks],
  );

  return {
    stage, username, leagues, authBusy, authError, error,
    data, step, model, syncing, syncedAt,
    usageState, usageSeasons, marketState,
    tab, teamView, draftView, tradeView, mockSlot, mockOpen, mockStarted,
    // A room owns the seed, the picks and the seat once one is open.
    mockSeed: room ? room.seed : mockSeed,
    mockChoices: liveChoices ?? mockChoices,
    liveOn: liveEnabled(),
    room, roomId, roomError, humanSeats, mySeat,
    hostRoom, joinRoom, joinByCode, takeSeat, leaveRoom,
    filter, rosterFilter, rosterSort, boardMode, rankMode,
    pickSel, strat, detail, passed, toast, photos, query, topPos, topLens, topOpen,

    accounts, switchAccount, forgetAccount,
    block: (leagueId ? blocks[username + '/' + leagueId] : undefined) || [],
    isOnBlock: (id: string) => (
      (leagueId ? blocks[username + '/' + leagueId] : undefined) || []
    ).indexOf(id) >= 0,
    /** Put a player of yours up for trade, or take him back off. */
    toggleBlock: (id: string) => {
      if (!leagueId) return;
      const key = username + '/' + leagueId;
      setBlocks(prev => {
        const cur = prev[key] || [];
        const next = {
          ...prev,
          [key]: cur.indexOf(id) >= 0 ? cur.filter(x => x !== id) : cur.concat([id]),
        };
        writeJson(STORAGE_BLOCK, next);
        return next;
      });
    },
    myRosterId: leagueId ? teamPick[username + '/' + leagueId] ?? null : null,
    /** Name the roster that is yours here, or pass null to go back to matching
     *  it off the signed-in account. */
    setMyRoster: (rosterId: number | null) => {
      if (!leagueId) return;
      const key = username + '/' + leagueId;
      setTeamPick(prev => {
        const next = { ...prev };
        if (rosterId == null) delete next[key];
        else next[key] = rosterId;
        writeJson(STORAGE_TEAM, next);
        return next;
      });
    },
    setUsername: (v: string) => { setUsername(v); setAuthError(''); },
    connectUser, pickLeague, switchLeague, logout, refreshAll, refreshPicks, retry,
    setTab: (t: Tab) => { setTab(t); setDetailStack([]); },
    setTeamView, setDraftView, setTradeView, setFilter,
    rerollMock: () => { setMockSeed(x => x + 1); setMockChoices({}); setMockStarted(false); },
    /* In a room this begins for everybody. Starting only your own copy would
     * let the bots take the seats your friends have not sat in yet. */
    startMock: () => {
      if (roomId) { void startRoom(roomId).catch(e => setRoomError(liveReason(e, 'start the room'))); }
      setMockStarted(true);
    },
    // A different seat is a different draft, so nothing carries over.
    setMockSlot: (n: number | null) => { setMockSlot(n); setMockChoices({}); },
    openMock: () => { setMockChoices({}); setMockStarted(false); setMockOpen(true); },
    closeMock: () => setMockOpen(false),
    /**
     * Taking someone at one pick invalidates every choice after it — the board
     * downstream moves, and a later pick you had locked in may be gone. Dropping
     * them is more honest than replaying choices that no longer apply.
     */
    /* In a room the pick goes to the database and comes back through the
     * watcher, so everyone's board moves at once. It is NOT truncated the way
     * the solo one is: dropping every pick after yours is the right answer when
     * the draft is a private what-if you are re-running, and it would delete
     * other people's picks in a room. A shared draft only goes forward. */
    chooseMock: (overall: number, id: string) => {
      if (roomId) { void pushPick(roomId, overall, id).catch(() => setRoomError('Pick did not send.')); return; }
      setMockChoices(prev => {
        const next: Record<number, string> = {};
        Object.keys(prev).forEach(k => { if (Number(k) < overall) next[Number(k)] = prev[Number(k)]; });
        next[overall] = id;
        return next;
      });
    },
    clearMockChoices: () => setMockChoices({}), setRosterFilter, setRosterSort,
    setBoardMode, setRankMode, setPickSel, setStrat, setDetail,
    setQuery, setTopPos, setTopLens, setTopOpen,
    passOffer: (key: string) => setPassed(p => p.concat(key)),
    resetOffers: () => setPassed([]),

    saved, isSaved, toggleSaved, unsaveTrade,
    showToast, hideToast, photoFor, setPhoto, clearPhoto,
  };
}

export type App = ReturnType<typeof useApp>;
