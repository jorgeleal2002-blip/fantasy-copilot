import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  findUser, getDraftPicks, getRosters, getSeasonStats, getTradedPicks, getUsers,
  loadLeague, matchMe, userLeagues, playerPhoto,
} from '../api/sleeper';
import type { LeagueBundle, SleeperLeague } from '../api/types';
import { DRAFT_POLL_MS, STORAGE_PHOTOS, STORAGE_SESSION, StratKey } from '../model/constants';
import { loadMarket, type Market } from '../model/market';
import { buildModel } from '../model/model';
import { buildUsage, type UsageMap } from '../model/usage';

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
const usageCache = new Map<number, UsageMap>();

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
  const [market, setMarket] = useState<Market | null>(null);
  const [marketState, setMarketState] = useState<FeedState>('idle');

  // ── view state
  const [tab, setTab] = useState<Tab>('team');
  const [teamView, setTeamView] = useState<TeamView>('resumen');
  const [draftView, setDraftView] = useState<'board' | 'deals'>('board');
  const [filter, setFilter] = useState<'ALL' | 'QB' | 'RB' | 'WR' | 'TE'>('ALL');
  const [rosterFilter, setRosterFilter] = useState<'ALL' | 'QB' | 'RB' | 'WR' | 'TE'>('ALL');
  const [rosterSort, setRosterSort] = useState<'value' | 'age' | 'snap'>('value');
  const [boardMode, setBoardMode] = useState<'rookies' | 'fa'>('rookies');
  const [rankMode, setRankMode] = useState<'now' | 'future'>('now');
  const [pickSel, setPickSel] = useState(0);
  const [strat, setStrat] = useState<StratKey>('balanced');
  const [detail, setDetail] = useState<string | null>(null);
  const [passed, setPassed] = useState<string[]>([]);

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
    // Weekly usage only exists for a finished season, so we read the last one.
    const year = (Number(bundle.league.season) || new Date().getFullYear()) - 1;
    if (usageCache.has(year)) {
      setUsage(usageCache.get(year)!);
      setUsageState('ok');
      return;
    }
    setUsageState('loading');
    try {
      const stats = await getSeasonStats(year);
      const u = buildUsage(stats, bundle.players);
      usageCache.set(year, u);
      setUsage(u);
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
    setDetail(null);
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
    setDetail(null);
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
    (id: string) => photos[id] || playerPhoto(id),
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

  // ── The model is pure: it re-derives whenever any of its inputs move.
  const model = useMemo(
    () => (data ? buildModel({ data, usage, market, strat, boardMode, pickSel }) : null),
    [data, usage, market, strat, boardMode, pickSel],
  );

  return {
    stage, username, leagues, authBusy, authError, error,
    data, step, model, syncing, syncedAt,
    usageState, marketState,
    tab, teamView, draftView, filter, rosterFilter, rosterSort, boardMode, rankMode,
    pickSel, strat, detail, passed, toast, photos,

    setUsername: (v: string) => { setUsername(v); setAuthError(''); },
    connectUser, pickLeague, switchLeague, logout, refreshAll, refreshPicks, retry,
    setTab: (t: Tab) => { setTab(t); setDetail(null); },
    setTeamView, setDraftView, setFilter, setRosterFilter, setRosterSort,
    setBoardMode, setRankMode, setPickSel, setStrat, setDetail,
    passOffer: (key: string) => setPassed(p => p.concat(key)),
    resetOffers: () => setPassed([]),
    showToast, hideToast, photoFor, setPhoto, clearPhoto,
  };
}

export type App = ReturnType<typeof useApp>;
