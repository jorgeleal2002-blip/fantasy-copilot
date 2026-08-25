import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  findUser, getDraftPicks, getRosters, getSeasonStats, getTradedPicks, getUsers,
  loadLeague, matchMe, userLeagues, playerPhoto,
} from '../api/sleeper';
import type { LeagueBundle, SleeperLeague } from '../api/types';
import { DRAFT_POLL_MS, STORAGE_PHOTOS, STORAGE_SAVED, STORAGE_SESSION, StratKey, USAGE_V } from '../model/constants';
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
  'Computing Fit Score',
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
  const [tradeView, setTradeView] = useState<'suggested' | 'saved'>('suggested');
  const [filter, setFilter] = useState<'ALL' | 'QB' | 'RB' | 'WR' | 'TE'>('ALL');
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
    const saved = readJson<{ username?: string; leagueId?: string } | null>(STORAGE_SESSION, null);
    if (saved && saved.leagueId && saved.username) {
      setUsername(saved.username);
      setLeagueId(saved.leagueId);
      setStage('app');
      void load(saved.leagueId, saved.username);
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

  /** Change league without signing out — reuses the stored username. */
  const switchLeague = useCallback(async () => {
    setAuthError('');
    setStage('leagues');
    if (!leagues.length) await connectUser();
  }, [connectUser, leagues.length]);

  const logout = useCallback(() => {
    try { localStorage.removeItem(STORAGE_SESSION); } catch { /* ignore */ }
    window.clearInterval(poll.current);
    marketCache.clear();
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
    () => (data ? buildModel({ data, usage, market, strat, boardMode, pickSel }) : null),
    [data, usage, market, strat, boardMode, pickSel],
  );

  return {
    stage, username, leagues, authBusy, authError, error,
    data, step, model, syncing, syncedAt,
    usageState, usageSeasons, marketState,
    tab, teamView, draftView, tradeView, mockSeed, mockChoices, mockSlot, mockOpen, filter, rosterFilter, rosterSort, boardMode, rankMode,
    pickSel, strat, detail, passed, toast, photos, query, topPos, topLens, topOpen,

    setUsername: (v: string) => { setUsername(v); setAuthError(''); },
    connectUser, pickLeague, switchLeague, logout, refreshAll, refreshPicks, retry,
    setTab: (t: Tab) => { setTab(t); setDetailStack([]); },
    setTeamView, setDraftView, setTradeView, setFilter,
    rerollMock: () => { setMockSeed(x => x + 1); setMockChoices({}); },
    // A different seat is a different draft, so nothing carries over.
    setMockSlot: (n: number | null) => { setMockSlot(n); setMockChoices({}); },
    openMock: () => { setMockChoices({}); setMockOpen(true); },
    closeMock: () => setMockOpen(false),
    /**
     * Taking someone at one pick invalidates every choice after it — the board
     * downstream moves, and a later pick you had locked in may be gone. Dropping
     * them is more honest than replaying choices that no longer apply.
     */
    chooseMock: (overall: number, id: string) => setMockChoices(prev => {
      const next: Record<number, string> = {};
      Object.keys(prev).forEach(k => { if (Number(k) < overall) next[Number(k)] = prev[Number(k)]; });
      next[overall] = id;
      return next;
    }),
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
