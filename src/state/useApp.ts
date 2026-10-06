import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  findUser, getDraftPicks, getRosters, getSeasonStats, getTradedPicks, getUsers,
  loadLeague, matchMe, userLeagues, playerPhoto, playerPhotoSet, teamLogo, type PhotoSet, getMatchups, getNflState, getTransactions,
  getWeekProjections, getWeekStats,
} from '../api/sleeper';
import type {
  LeagueBundle, PosFilter, SleeperLeague, SleeperMatchup, SleeperStatLine, SleeperTransaction,
} from '../api/types';
import { phaseFor, weekLive } from '../model/game-clock';
import { readNflGames, type NflGame } from '../model/nfl-games';
import { getNflScoreboard } from '../api/espn';
import { withLiveStats } from '../model/matchups';
import { DRAFT_POLL_MS, MATCHUP_LIVE_POLL_MS, MATCHUP_POLL_MS, PROJ_TTL_MS, STATS_LIVE_POLL_MS, RESUME_REFRESH_MS, STORAGE_ACCOUNTS, STORAGE_BLOCK, STORAGE_GOOGLE, STORAGE_PHOTOS, STORAGE_PHOTOS_SENT, STORAGE_SESSION, STORAGE_TEAM, StratKey, USAGE_V } from '../model/constants';
import {
  EMPTY_ROOM, PHOTO_MAX_BYTES, claimSeat, createRoom as createRoomAt, dropPhoto, liveEnabled,
  liveReason, newRoomId, pushPick, putPhoto, readPhotos, readRoom, restartRoom, startRoom,
  watchRoom, type Room, type SharedPhoto,
} from '../api/live';
import {
  ROOM_LEN, cleanRoomCode, clearInvite, isRoomCode, parseInvite, roomCodeProblem, type Invite,
} from '../model/invite';
import {
  exchange, forgetGoogle, googleEnabled, refresh as refreshGoogle, stale, type Session,
} from '../api/identity';
import { profileEnabled, readProfile, writeProfile } from '../api/profile';
import { loadDynastyPrices, loadMarket, type Market } from '../model/market';
import { readAlerts } from '../ui/alert-prefs';
import { buildModel } from '../model/model';
import { blendSeasons, seasonUsage, withCurrentSeason, type UsageMap } from '../model/usage';
import { PHOTO_ASPECT, pickEncoding } from '../model/photo';
import { scoreProjection, scoringKind } from '../model/projections';
import { countTds, mergeSeason, pointsInWeek, rankAmong, rankCount, seasonLine, type Game, type SeasonLine } from '../model/season';
import { type HeldStats, projectionsAreStale, readProjections, statsForWeek } from '../model/projections';
import type { WeekScore } from '../model/power';
import { nextDetailStack, topDetail } from './detail-stack';

/** `link` is the one-time "which Sleeper account is yours" step, reached only
 *  from a Google sign-in that found no saved setup. */
export type Stage = 'connect' | 'link' | 'leagues' | 'app';
export type Tab = 'team' | 'trades' | 'draft' | 'league' | 'settings';
export type TeamView = 'resumen' | 'lineup' | 'roster' | 'activos';
export type LeagueView = 'weeks' | 'myteam' | 'rankings' | 'players';
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
/** Sleeper's projections for one week of one season, with when they were
 *  read: they move as news breaks, so the entry ages out — see `PROJ_TTL_MS`. */
const projCache = new Map<string, { at: number; map: Record<string, number> }>();
/** Weeks whose projections are in the air. Two callers now ask for the same
 *  week at once — the matchup fetch and the effect that waits for the league —
 *  and without this they both go, which doubles the traffic to an undocumented
 *  endpoint on every week change for no second answer. */
const projInFlight = new Set<string>();
/** One week of every player's stats. Big, and only wanted where a stat line
 *  is drawn, so it ages out rather than polling with the scores. */
const statCache = new Map<string, { at: number; map: Record<string, SleeperStatLine> }>();

/**
 * WebP if the browser will encode it, JPEG if it will not.
 *
 * At the byte ceiling a photo has to live under, the format is worth as much
 * as the size is: WebP carries roughly twice the picture per kilobyte, which
 * is a whole step of the ladder in `model/photo`. A browser that cannot make
 * one hands back a PNG data URL instead of saying no, so the answer is read
 * off what comes out rather than asked for.
 */
let photoType: string | null = null;
function bestPhotoType(): string {
  if (photoType) return photoType;
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  photoType = c.toDataURL('image/webp', 0.9).startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
  return photoType;
}

/** A portrait crop of an upload, as large as the ceiling allows — a little
 *  above centre, because a face is in the top half of a photo of a person and
 *  a centred square cut the top of the head off. */
function encodePhoto(img: HTMLImageElement): string {
  const type = bestPhotoType();
  const tall = img.width / img.height < 1 / PHOTO_ASPECT;
  const cw = tall ? img.width : img.height / PHOTO_ASPECT;
  const ch = tall ? img.width * PHOTO_ASPECT : img.height;
  const cx = (img.width - cw) / 2;
  const cy = (img.height - ch) * 0.25;
  const drawn = new Map<number, HTMLCanvasElement>();
  const at = (px: number, q: number): number => {
    let c = drawn.get(px);
    if (!c) {
      c = document.createElement('canvas');
      c.width = px;
      c.height = Math.round(px * PHOTO_ASPECT);
      const ctx = c.getContext('2d');
      if (!ctx) return Infinity;
      // Downscaling a phone photo by a factor of ten is where a cheap resample
      // shows: the browser's own high setting is the difference between a face
      // and a sharpened mess of it.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, cx, cy, cw, ch, 0, 0, c.width, c.height);
      drawn.set(px, c);
    }
    return c.toDataURL(type, q).length;
  };
  const pick = pickEncoding(at, PHOTO_MAX_BYTES);
  const c = pick && drawn.get(pick.px);
  return c && pick ? c.toDataURL(type, pick.q) : '';
}
/** A league's transactions, keyed by how many weeks of them were asked for. */
const txCache = new Map<string, SleeperTransaction[]>();
/** Every team's score in every FINISHED week, for the all-play record. A week
 *  that has closed cannot change, so this needs no age on it. */
const scoreCache = new Map<string, { scores: WeekScore[]; players: Record<string, number> }>();

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

const NO_GAMES: Record<string, NflGame> = {};

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
  const [tradeView, setTradeView] = useState<'suggested' | 'block' | 'build' | 'league'>('suggested');
  /* The trade being built. Kept here rather than in the screen because looking
   * a player up mid-build means leaving the tab, and a half-built three-team
   * trade is not something to lose to a navigation. */
  const [tradeTeams, setTradeTeams] = useState<number[]>([]);
  /** asset id → where it comes from and where it is going */
  const [tradeAssets, setTradeAssets] = useState<Record<string, { from: number; to: number }>>({});
  // A redraft board holds kickers and defences too, so the picker that filters
  // it has to be able to say so.
  const [filter, setFilter] = useState<PosFilter>('ALL');
  const [rosterFilter, setRosterFilter] = useState<'ALL' | 'QB' | 'RB' | 'WR' | 'TE'>('ALL');
  const [rosterSort, setRosterSort] = useState<'value' | 'age' | 'snap'>('value');
  const [boardMode, setBoardMode] = useState<'rookies' | 'fa'>('rookies');
  const [rankMode, setRankMode] = useState<'power' | 'now' | 'future' | 'fit' | 'fitFut'>('power');
  /** Which of the league page's three screens is showing. They were one
   *  column and the rankings sat six matchup cards below the fold. */
  const [leagueView, setLeagueView] = useState<LeagueView>('myteam');
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
  /* Points, not the Rating. The Rating is a draft and trade board — it prices
     your holes, the replacement at his position and where the market has him,
     which is a different question from who has been best. In season the second
     question is the one being asked, and `TopPlayers` falls back to the Rating
     by itself before anybody has played. */
  const [topLens, setTopLens] = useState<'neutral' | 'pts' | 'me' | 'fut'>('pts');
  const [passed, setPassed] = useState<string[]>([]);

  /* The week's head-to-heads, and where the NFL currently is. Kept out of the
   * league bundle because it is the one thing on screen that changes while you
   * are looking at it. */
  const [week, setWeekState] = useState<number | null>(null);
  const [projections, setProjections] = useState<Record<string, number>>({});
  /**
   * Every player's week, for the line under a name on a scoreboard, carrying
   * the week it is true of.
   *
   * A stat line only ever belongs to one week, and the week on screen moves
   * under it — forward into a week the NFL has not played, which answers with
   * nothing at all. Holding the week beside the map is what stops last
   * Sunday's yards from sitting under next Sunday's 0.00.
   */
  const [weekStats, setWeekStats] = useState<HeldStats<SleeperStatLine>>({ wk: 0, map: {} });
  /**
   * Stat lines for several weeks at once, keyed by week, for a game log.
   *
   * Separate from `weekStats` because that one is deliberately the single week
   * on screen and nothing else — a scoreboard drawing last week's yards under
   * this week's score is the bug it exists to prevent. A log is the opposite
   * question: many weeks, each labelled with its own.
   */
  const [gameStats, setGameStats] = useState<Record<number, Record<string, SleeperStatLine>>>({});
  /** The week the NFL is on, as distinct from the one being looked at. */
  const [nflWeek, setNflWeek] = useState<number | null>(null);
  /** Said out loud when it fails. A projection that is simply absent, with no
   *  reason given, is the hardest kind of missing number to report. */
  const [projState, setProjState] = useState<FeedState>('idle');
  /** Raw league transactions; the trades are read out of them where the market
   *  that prices them is in scope. */
  const [transactions, setTransactions] = useState<SleeperTransaction[]>([]);
  const [tradeLogState, setTradeLogState] = useState<FeedState>('idle');
  /** Scores from the weeks that have finished — see `model/power`. */
  const [weekScores, setWeekScores] = useState<WeekScore[]>([]);
  /**
   * What each player has actually scored, week by week, in THIS league's
   * scoring — out of the same payload the team scores come from.
   *
   * The stats feed would give a points-per-game too, and it would be in
   * half-PPR: the model's currency and almost nobody's league. These are
   * Sleeper's own totals under this league's settings, which is the number
   * somebody means when they ask what a player is averaging.
   */
  const [seasonPoints, setSeasonPoints] = useState<Record<string, Game[]>>({});
  const [powerState, setPowerState] = useState<FeedState>('idle');
  const [matchups, setMatchups] = useState<SleeperMatchup[]>([]);
  /** The NFL's games for the week on screen — score, quarter, clock. */
  const [nflGames, setNflGames] = useState<{ wk: number; map: Record<string, NflGame> }>({ wk: 0, map: {} });
  const nflGamesRef = useRef(nflGames);
  nflGamesRef.current = nflGames;
  const [matchupState, setMatchupState] = useState<FeedState>('idle');

  // ── ephemera
  const [toast, setToast] = useState('');
  /** Photos this device set before there was anywhere to share them, and the
   *  fallback whenever there is no database. */
  const [localPhotos, setLocalPhotos] = useState<Record<string, string>>({});
  /** What the league has set, mirrored from the database — replaced wholesale
   *  on every read, so a photo somebody DELETES stops showing here too. */
  const [leaguePhotos, setLeaguePhotos] = useState<Record<string, SharedPhoto>>({});
  const toastTimer = useRef<number | undefined>(undefined);
  const poll = useRef<number | undefined>(undefined);
  const dataRef = useRef<LeagueBundle | null>(null);
  dataRef.current = data;
  /* Read inside callbacks that outlive the render they were made in — a
   * resume handler registered on Tuesday must not be holding Sunday's week. */
  const weekRef = useRef<number | null>(null);
  weekRef.current = week;
  const nflWeekRef = useRef<number | null>(null);
  nflWeekRef.current = nflWeek;
  const syncedAtRef = useRef<number | null>(null);
  syncedAtRef.current = syncedAt;
  const scoresAtRef = useRef(0);
  const statsAtRef = useRef(0);

  /**
   * Sleeper's projections for the week, scored in this league's own settings.
   *
   * Deliberately outside the scoreboard's own try: projections are an extra on
   * a scoreboard, and a week without them still has scores on it. They also
   * come from an undocumented endpoint, so everything downstream treats "no
   * projection" as an ordinary answer rather than an error.
   */
  const fetchProjections = useCallback(async (wk: number, force = false) => {
    const d = dataRef.current;
    if (!d || !wk) return;
    const season = d.league.season || String(new Date().getFullYear());
    const key = season + ':' + wk;

    /* Show what is already known at once — a refresh must never blank a
     * scoreboard — and only then decide whether to go back to the feed. The
     * cache used to have no age on it at all, so the first read of a week was
     * the last: the poll called this every forty-five seconds and returned
     * here every time, and a starter ruled out on Sunday morning never moved
     * the number. */
    const hit = projCache.get(key);
    if (hit) { setProjections(hit.map); setProjState('ok'); }
    if (!projectionsAreStale(hit, Date.now(), PROJ_TTL_MS, force)) return;
    if (projInFlight.has(key)) return;
    if (!hit) setProjState('loading');

    projInFlight.add(key);
    try {
      const raw = await getWeekProjections(season, wk);
      const map = readProjections(raw, d.league.scoring_settings);
      // An empty map is an answer that did not arrive, not a league where
      // nobody is projected to score: it must not replace one that did.
      if (!Object.keys(map).length) { if (!hit) setProjState('fail'); return; }
      projCache.set(key, { at: Date.now(), map });
      setProjections(map);
      setProjState('ok');
    } catch {
      // The scoreboard is a scoreboard without them; it just stops pretending
      // they are on their way. The next poll tries again.
      if (!hit) setProjState('fail');
    } finally {
      projInFlight.delete(key);
    }
  }, []);

  /**
   * Every trade the league has made this season.
   *
   * Sleeper keeps transactions a week at a time and has no endpoint for the
   * season, so a season is eighteen calls. They are only made when you open
   * the list, rather than on every league load, and the weeks go out together
   * — one round trip's latency instead of eighteen.
   */
  const fetchTrades = useCallback(async (upTo: number) => {
    const lid = leagueId;
    if (!lid) return;
    const weeks = Math.max(1, Math.min(18, upTo || 1));
    const key = lid + ':' + weeks;
    if (txCache.has(key)) { setTransactions(txCache.get(key)!); return; }
    setTradeLogState('loading');
    const got = await Promise.all(
      Array.from({ length: weeks }, (_, i) => getTransactions(lid, i + 1).catch(() => null)),
    );
    // A week that returns nothing is a quiet week. EVERY week failing is the
    // feed being down, and the two must not read the same on screen.
    const ok = got.filter((w): w is SleeperTransaction[] => Array.isArray(w));
    if (!ok.length) { setTradeLogState('fail'); return; }
    const rows = ok.flat();
    txCache.set(key, rows);
    setTransactions(rows);
    setTradeLogState('ok');
  }, [leagueId]);

  /**
   * Every team's score in every week that has FINISHED.
   *
   * Through the week on the clock, not up to it. Which of them actually
   * count is decided from the scores themselves — see `finishedWeeks` — and
   * not from where the clock is, because Sleeper's week does not roll until
   * Tuesday and a ranking that waits for it spends every Monday night a week
   * behind its own standings.
   */
  /**
   * Who plays whom in every regular-season week still to come — Sleeper
   * publishes the pairings for the whole season up front. Read once a league,
   * for the season outlook on the Team page.
   */
  const [schedule, setSchedule] = useState<{ lid: string; from: number; weeks: { week: number; pairs: [number, number][] }[] }>({ lid: '', from: 0, weeks: [] });
  const fetchSchedule = useCallback(async () => {
    const d = dataRef.current;
    const lid = leagueId;
    const from = nflWeekRef.current;
    if (!d || !lid || !from) return;
    if (schedule.lid === lid && schedule.from === from) return;
    const start = Number(d.league.settings?.playoff_week_start) || 15;
    const weeks: number[] = [];
    for (let w = from; w < start && w <= 18; w++) weeks.push(w);
    const got = await Promise.all(weeks.map(async week => {
      try {
        const rows = await getMatchups(lid, week);
        const by = new Map<number, number[]>();
        for (const r of rows || []) {
          if (r.matchup_id == null) continue;
          by.set(r.matchup_id, (by.get(r.matchup_id) || []).concat(r.roster_id));
        }
        const pairs = [...by.values()].filter(x => x.length === 2).map(x => [x[0], x[1]] as [number, number]);
        return { week, pairs };
      } catch {
        return { week, pairs: [] as [number, number][] };
      }
    }));
    setSchedule({ lid, from, weeks: got.filter(w => w.pairs.length) });
  }, [leagueId, schedule.lid, schedule.from]);

  const fetchWeekScores = useCallback(async (upTo: number) => {
    const lid = leagueId;
    if (!lid) return;
    const last = Math.max(0, Math.min(18, upTo));
    if (!last) { setWeekScores([]); setSeasonPoints({}); setPowerState('ok'); return; }
    const teams = (dataRef.current?.rosters || []).length;

    setPowerState('loading');
    const weeks = await Promise.all(Array.from({ length: last }, async (_, i) => {
      const wk = i + 1;
      const key = lid + ':' + wk;
      const held = scoreCache.get(key);
      if (held) return { week: wk, ...held };
      let rows: SleeperMatchup[];
      try {
        rows = await getMatchups(lid, wk);
      } catch {
        return null;
      }
      const scores: WeekScore[] = [];
      const players: Record<string, number> = {};
      for (const r of rows || []) {
        // Sleeper reports 0 for a week it has a row but no result for, which
        // is a score; null means no row, and a team with no row did not play.
        if (r.points == null || !Number.isFinite(r.points)) continue;
        scores.push({ rosterId: r.roster_id, week: wk, points: r.points });
        /* The same payload carries what every man on the roster scored, in
         * this league's own scoring. A zero is a bye or a week he did not
         * play, and averaging it in would say he is worse than he is. */
        for (const [pid, pts] of Object.entries(r.players_points || {})) {
          if (Number.isFinite(pts) && pts !== 0) players[pid] = pts;
        }
      }
      /* Kept only once the week is over. A week still being played changes
       * every few minutes, and a cache that froze the first partial read of
       * it would hold those half-scores for the rest of the session. */
      const over = teams > 0 && scores.length >= teams && scores.every(x => x.points > 0);
      if (over) scoreCache.set(key, { scores, players });
      return { week: wk, scores, players };
    }));

    const got = weeks.filter((w): w is { week: number; scores: WeekScore[]; players: Record<string, number> } => !!w);
    // A week that failed is a week; every week failing is the feed being down.
    if (!got.length) { setPowerState('fail'); return; }

    const perPlayer: Record<string, Game[]> = {};
    for (const w of got) {
      for (const [pid, pts] of Object.entries(w.players)) {
        (perPlayer[pid] = perPlayer[pid] || []).push({ week: w.week, pts });
      }
    }
    setWeekScores(got.flatMap(w => w.scores));
    setSeasonPoints(perPlayer);
    setPowerState('ok');
  }, [leagueId]);

  /**
   * One week of every player's stat line.
   *
   * The whole league in one payload, which is why it is asked for from the one
   * screen that draws it rather than polled beside the scores. It ages out on
   * the projections' clock: a stat line moves every play, and a line that is
   * five minutes behind a score it sits under is still the right stat line for
   * a player whose game finished on Sunday.
   */
  const fetchWeekStats = useCallback(async (wk: number, force = false) => {
    const d = dataRef.current;
    if (!d || !wk) return;
    const season = d.league.season || String(new Date().getFullYear());
    const key = season + ':' + wk;
    const hit = statCache.get(key);
    // Whatever happens next, the week we are asking about is the week that is
    // held from here on: a week the NFL has not played answers with nothing,
    // and nothing is the right answer to draw under it.
    setWeekStats(s => (hit ? { wk, map: hit.map } : s.wk === wk ? s : { wk, map: {} }));
    if (!projectionsAreStale(hit, Date.now(), PROJ_TTL_MS, force)) return;
    try {
      const raw = await getWeekStats(season, wk);
      if (!raw || typeof raw !== 'object' || !Object.keys(raw).length) return;
      statCache.set(key, { at: Date.now(), map: raw });
      setWeekStats({ wk, map: raw });
    } catch {
      /* the line under a name is an extra; the score above it is not */
    }
  }, []);

  /**
   * The stat lines behind a game log, for the weeks a player actually played.
   *
   * Sleeper publishes one week of stats per request, so a log costs one call
   * per game — which is why it is asked for from the card that draws it, only
   * for the weeks on that card, and never speculatively. Weeks already in hand
   * cost nothing: the cache is the same one the scoreboard fills, so a game
   * already looked at there is free here.
   */
  const fetchGameStats = useCallback(async (weeks: number[]) => {
    const d = dataRef.current;
    if (!d || !weeks.length) return;
    const season = d.league.season || String(new Date().getFullYear());
    const key = (wk: number) => season + ':' + wk;

    // Whatever is already cached goes up in one pass, before any waiting.
    setGameStats(prev => {
      const next = { ...prev };
      let grew = false;
      for (const wk of weeks) {
        const hit = statCache.get(key(wk));
        if (hit && !next[wk]) { next[wk] = hit.map; grew = true; }
      }
      return grew ? next : prev;
    });

    const want = weeks.filter(wk => wk > 0 && !statCache.get(key(wk)));
    if (!want.length) return;
    await Promise.all(want.map(async wk => {
      try {
        const raw = await getWeekStats(season, wk);
        if (!raw || typeof raw !== 'object' || !Object.keys(raw).length) return;
        statCache.set(key(wk), { at: Date.now(), map: raw });
        setGameStats(prev => ({ ...prev, [wk]: raw }));
      } catch {
        /* a line under a score is an extra; the score itself is not */
      }
    }));
  }, []);

  /* Asked for with the scores, but only while it can have changed: once for
   * a week, then again only while one of its games is on. */
  const fetchNflGames = useCallback(async (wk: number) => {
    const d = dataRef.current;
    if (!d || !wk) return;
    const held = nflGamesRef.current;
    const season = Number(d.league.season);
    if (held.wk === wk && !weekLive(wk, season, Date.now(), held.map)) return;
    try {
      const map = readNflGames(await getNflScoreboard(season, wk));
      if (Object.keys(map).length) setNflGames({ wk, map });
    } catch {
      /* the kickoff table stands in for it */
    }
  }, []);

  const fetchMatchups = useCallback(async (lid: string, wk: number, quiet = false, force = false) => {
    // A poll must not blank the scores it is refreshing, so it stays quiet and
    // only a first load or a week change shows the loading state.
    if (!quiet) setMatchupState('loading');
    scoresAtRef.current = Date.now();
    try {
      const rows = await getMatchups(lid, wk);
      setMatchups(Array.isArray(rows) ? rows : []);
      setMatchupState('ok');
    } catch {
      setMatchupState('fail');
    }
    void fetchProjections(wk, force);
    void fetchNflGames(wk);
  }, [fetchProjections, fetchNflGames]);

  const setWeek = useCallback((w: number) => {
    setWeekState(w);
    if (leagueId) void fetchMatchups(leagueId, w);
  }, [leagueId, fetchMatchups]);

  /* Dropping a team takes its assets with it — leaving them behind would route
   * players to a team no longer in the deal, which scores as nothing and reads
   * as the app losing them. */
  const toggleTradeTeam = useCallback((rid: number) => {
    setTradeTeams(list => {
      const next = list.includes(rid) ? list.filter(x => x !== rid) : list.concat(rid);
      setTradeAssets(assets => {
        const kept: Record<string, { from: number; to: number }> = {};
        for (const [id, a] of Object.entries(assets)) {
          if (next.includes(a.from) && next.includes(a.to)) kept[id] = a;
        }
        return kept;
      });
      return next;
    });
  }, []);

  const toggleTradeAsset = useCallback((id: string, from: number, to: number) => {
    setTradeAssets(a => {
      if (a[id]) {
        const { [id]: _gone, ...rest } = a;
        return rest;
      }
      return { ...a, [id]: { from, to } };
    });
  }, []);

  /** Tapping the destination walks it round the other teams in the deal. */
  const cycleTradeTo = useCallback((id: string, teamsInDeal: number[]) => {
    setTradeAssets(a => {
      const cur = a[id];
      if (!cur) return a;
      const options = teamsInDeal.filter(t => t !== cur.from);
      if (options.length < 2) return a;
      const next = options[(options.indexOf(cur.to) + 1) % options.length];
      return { ...a, [id]: { ...cur, to: next } };
    });
  }, []);

  const clearTrade = useCallback(() => { setTradeTeams([]); setTradeAssets({}); }, []);

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
      const [base, dynasty] = await Promise.all([loadMarket(league), loadDynastyPrices(league)]);
      const m = dynasty ? { ...base, dynasty } : base;
      marketCache.set(key, m);
      setMarket(m);
      setMarketState('ok');
    } catch {
      setMarketState('fail');
    }
  }, []);

  const fetchUsage = useCallback(async (bundle: LeagueBundle) => {
    // Three finished seasons, not one: a single year is a small sample, and one
    // injury or a new coordinator moves every number in it. On top of them, the
    // season being played, weighted by how much of it there is — without it
    // every screen describes a player as he was last January.
    const season = Number(bundle.league.season) || new Date().getFullYear();
    const latest = season - 1;
    const years = [latest, latest - 1, latest - 2];

    /* The week is part of the key: the same three finished seasons plus two
     * games is not the same map as the same three plus nine, and a map cached
     * on Tuesday must not still be answering in December. */
    let wk = 0;
    try {
      const st = await getNflState();
      if (Number(st?.season) === season) wk = Math.max(0, Math.min(18, Number(st?.week || 0)));
    } catch {
      /* no state feed: fall back to the finished seasons alone */
    }
    const key = USAGE_V + ':' + latest + ':' + wk;
    if (usageCache.has(key)) {
      setUsage(usageCache.get(key)!);
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
      let u = blendSeasons(loaded, bundle.players);

      if (wk > 0) {
        try {
          const now = await getSeasonStats(season);
          if (now && typeof now === 'object') {
            const cur = { year: season, usage: seasonUsage(now, bundle.players) };
            const played = Object.keys(cur.usage).reduce((n, id) => Math.max(n, cur.usage[id].gp || 0), 0);
            if (played > 0) {
              u = withCurrentSeason(u, cur, bundle.players);
            }
          }
        } catch {
          /* the season in progress being down leaves the finished ones intact */
        }
      }

      usageCache.set(key, u);
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
    setLocalPhotos(readJson<Record<string, string>>(STORAGE_PHOTOS, {}));
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

  /**
   * Which week to show, from the NFL's own clock rather than the calendar —
   * Sleeper's week rolls on Tuesday, and a date guess would be a day out for
   * two days of every week.
   *
   * Re-read rather than read once. This used to run only when a league loaded,
   * and a home-screen web app does not load for days: open it in week three,
   * leave it on the home screen, and in week four it is still polling week
   * three's scores against week three's projections, under a header that says
   * so. Nothing in the app noticed the season had moved.
   */
  const syncClock = useCallback(async (lid: string) => {
    let wk: number;
    try {
      const st = await getNflState();
      wk = Math.max(1, Math.min(18, Number(st?.display_week || st?.week || 1)));
    } catch {
      // Week one is a truthful default with nothing on screen yet, and a bad
      // one once there is: a state feed that blinks must not throw you back
      // to September.
      if (weekRef.current != null) return;
      wk = 1;
    }
    const was = nflWeekRef.current;
    setNflWeek(wk);

    /* Stepping back through the season is a thing people do, and the clock
     * moving under them must not yank the screen out from under it. Follow it
     * only for somebody who was on it. */
    const showing = weekRef.current;
    if (showing == null || was == null || showing === was) {
      setWeekState(wk);
      void fetchMatchups(lid, wk, showing === wk);
    } else if (showing === wk) {
      void fetchMatchups(lid, wk, true);
    }
    /* Every finished week of the season, read here rather than from a screen:
     * the rankings want the team scores and every player's card wants what he
     * has averaged, and both are in the same payload. Cached a week at a time,
     * so this is a handful of requests once and nothing after. */
    void fetchWeekScores(wk);
  }, [fetchMatchups, fetchWeekScores]);

  useEffect(() => {
    if (leagueId) void syncClock(leagueId);
  }, [leagueId, syncClock]);

  /* Scores move while games are on. Quietly, so the numbers change under you
   * instead of the section blinking through a loading state. Fast while a game
   * of the week is being played, slow otherwise, and not at all from the
   * background — coming back re-reads them through `syncClock`. */
  useEffect(() => {
    if (!leagueId || week == null) return;
    const id = window.setInterval(() => {
      const hidden = document.visibilityState === 'hidden';
      // In the background only the stat feed, and only for someone who asked
      // for phone notifications of touchdowns — where the browser lets a
      // background page run at all.
      if (hidden && !readAlerts().phone) return;
      const now = Date.now();
      const season = Number(dataRef.current?.league.season);
      const held = nflGamesRef.current;
      const live = weekLive(week, season, now, held.wk === week ? held.map : null);
      if (hidden) {
        if (live && now - statsAtRef.current >= STATS_LIVE_POLL_MS - 1000) {
          statsAtRef.current = now;
          void fetchWeekStats(week, true);
        }
        return;
      }
      // The stat feed runs ahead of the scoreboard during a game, so while one
      // is on it is polled too — see `withLiveStats`.
      if (live && now - statsAtRef.current >= STATS_LIVE_POLL_MS - 1000) {
        statsAtRef.current = now;
        void fetchWeekStats(week, true);
      }
      const every = live ? MATCHUP_LIVE_POLL_MS : MATCHUP_POLL_MS;
      if (now - scoresAtRef.current < every - 1000) return;
      void fetchMatchups(leagueId, week, true);
    }, MATCHUP_LIVE_POLL_MS);
    return () => window.clearInterval(id);
  }, [leagueId, week, fetchMatchups, fetchWeekStats]);

  /* The scoreboard as every screen reads it: Sleeper's, with the stat feed
   * folded in for players whose game is on. */
  const games = nflGames.wk === week ? nflGames.map : null;
  const liveMatchups = useMemo(() => {
    if (!week || !data) return matchups;
    const season = Number(data.league.season);
    const now = Date.now();
    return withLiveStats(
      matchups,
      statsForWeek(weekStats, week) as unknown as Record<string, Record<string, number>>,
      data.league.scoring_settings,
      id => phaseFor(data.players[id]?.team, week, season, now, games) === 'live',
    );
  }, [matchups, weekStats, week, data, games]);

  /**
   * Projections need the LEAGUE, not just the week: they are re-totalled
   * against its own scoring settings, so `fetchProjections` can do nothing
   * until the bundle is in. It was only ever called from `fetchMatchups`,
   * which on a cold start runs first — the clock answers before the league
   * does — so it returned at the `!d` guard and nothing came back to it. The
   * week you landed on was the one week with no projections on it: no figure
   * under either score, no bar, no projected margin, for as long as you stayed
   * on it. Stepping a week fixed it, which is why it read as "that week has
   * none" rather than as a bug.
   *
   * Stating the dependency as an effect is the fix: it fires when both halves
   * exist, whichever arrives last. The staleness guard inside means the extra
   * call costs nothing when the fetch already happened.
   */
  useEffect(() => {
    if (!data || week == null) return;
    void fetchProjections(week);
    // The same race, the same fix: the scoreboard needs the league's season.
    void fetchNflGames(week);
  }, [data, week, fetchProjections, fetchNflGames]);

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

  /* ── Signing in with Google ──────────────────────────────────────────────
   *
   * This does NOT replace the Sleeper username, and cannot: Sleeper has no
   * Google sign-in, so nothing here can work out which Sleeper team is yours.
   * What it does is remember the answer against your Google account, so a new
   * phone arrives already set up instead of asking for a username you chose
   * years ago. See `api/identity.ts`.
   * ───────────────────────────────────────────────────────────────────────── */
  const [google, setGoogle] = useState<Session | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState('');
  /* The callbacks below are created once and must not be re-created every time
   * a token is minted, so they read it through a ref rather than closing over
   * it — the same trick `dataRef` plays three hundred lines up. */
  const googleRef = useRef<Session | null>(null);
  googleRef.current = google;

  const keepGoogle = useCallback((s: Session | null) => {
    googleRef.current = s;
    setGoogle(s);
    // Only the long-lived half is written down. The other one is stale within
    // the hour and is minted from this whenever it is wanted.
    if (s) writeJson(STORAGE_GOOGLE, { refreshToken: s.refreshToken });
    else { try { localStorage.removeItem(STORAGE_GOOGLE); } catch { /* private mode */ } }
  }, []);

  /** A token the database will actually accept, minting a new one if the one
   *  in hand has gone off. Null when there is no session or it cannot be
   *  renewed — a signed-out state, not an error to put on a screen. */
  const liveSession = useCallback(async (): Promise<Session | null> => {
    const s = googleRef.current;
    if (!s) return null;
    if (!stale(s, Date.now())) return s;
    try {
      const next = await refreshGoogle(s.refreshToken);
      keepGoogle(next);
      return next;
    } catch {
      // A refresh token is revoked by signing out of Google, by changing a
      // password, or by ninety days of not opening the app. None of those is
      // worth an alarm: the username box is still there.
      keepGoogle(null);
      return null;
    }
  }, [keepGoogle]);

  /**
   * Open a league.
   *
   * `who` is here because the one caller that is not a tap — a Google account
   * arriving with a saved setup — knows the username before React has finished
   * putting it in state, and reading it from state there picked up the empty
   * string it was replacing.
   */
  const openLeague = useCallback((id: string, who: string) => {
    writeJson(STORAGE_SESSION, { username: who, leagueId: id });
    // Remember who just signed in, newest first, so the next person — or this
    // one coming back — is one tap rather than a username typed from memory.
    setAccounts(prev => {
      const next = [{ username: who, leagueId: id }]
        .concat(prev.filter(a => a.username.toLowerCase() !== who.toLowerCase()))
        .slice(0, 8);
      writeJson(STORAGE_ACCOUNTS, next);
      return next;
    });
    /* And against the Google account, if there is one, so the next phone does
     * not ask again. Deliberately not awaited and deliberately unable to fail:
     * this is a convenience over a setup that already works from local
     * storage, and a database having a bad day must cost nobody their league. */
    void (async () => {
      const g = await liveSession();
      if (g) void writeProfile(g, { username: who, leagueId: id });
    })();
    window.clearInterval(poll.current);
    setLeagueId(id);
    setStage('app');
    setData(null);
    setStep(0);
    setPassed([]);
    setDetailStack([]);
    setTab('team');
    void load(id, who);
  }, [load, liveSession]);

  const pickLeague = useCallback((id: string) => openLeague(id, username), [openLeague, username]);

  /** Google has said who this is. Turn that into a session the database will
   *  accept and, if this account has been here before, straight into its
   *  league — which is the whole point of the button. */
  const signInWithGoogle = useCallback(async (googleIdToken: string) => {
    setGoogleBusy(true);
    setGoogleError('');
    try {
      const s = await exchange(googleIdToken);
      keepGoogle(s);
      const saved = await readProfile(s).catch(() => null);
      // Nothing saved yet is the ordinary first time, not a failure: the
      // username box is right there and what they type gets written down.
      if (saved) {
        setUsername(saved.username);
        openLeague(saved.leagueId, saved.username);
      } else {
        setStage('link');
      }
    } catch {
      setGoogleError('Google signed you in, but this app could not finish. Try again.');
    } finally {
      setGoogleBusy(false);
    }
  }, [keepGoogle, openLeague]);

  /** Sign out of the app, not out of Google. `forgetGoogle` stops their script
   *  signing the same person straight back in on the next tap, which otherwise
   *  makes the button look broken to anyone switching accounts. */
  const signOutGoogle = useCallback(() => {
    forgetGoogle();
    keepGoogle(null);
  }, [keepGoogle]);

  /**
   * A Google session outlives a launch, and on a phone that has never opened
   * this app it IS the setup.
   *
   * Once per launch, guarded rather than left to the dependency list: every
   * callback this reaches for is rebuilt whenever a league loads, and an effect
   * that followed them would sign in again on each one.
   */
  const bootedGoogle = useRef(false);
  useEffect(() => {
    if (!googleEnabled() || bootedGoogle.current) return;
    bootedGoogle.current = true;
    const kept = readJson<{ refreshToken?: string } | null>(STORAGE_GOOGLE, null);
    if (!kept || !kept.refreshToken) return;
    void (async () => {
      try {
        const s = await refreshGoogle(kept.refreshToken as string);
        keepGoogle(s);
        /* Only where this device has nothing of its own. Somebody already in a
         * league must not be yanked out of it by a profile written from
         * another phone — the device they are holding wins. */
        if (readJson<{ leagueId?: string } | null>(STORAGE_SESSION, null)?.leagueId) return;
        const saved = await readProfile(s).catch(() => null);
        if (saved) {
          setUsername(saved.username);
          openLeague(saved.leagueId, saved.username);
        }
      } catch {
        keepGoogle(null);
      }
    })();
  }, [keepGoogle, openLeague]);



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
    /* And out of Google, or signing out does not sign anybody out: the next
     * launch would restore the session, read the profile and walk straight
     * back into the league the person just left — on a phone that may now be
     * in somebody else's hands. */
    signOutGoogle();
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
  }, [signOutGoogle]);

  /**
   * Re-ask for rosters, traded picks, market values and usage, then recompute.
   *
   * `quiet` is the automatic one, which says nothing when it works: a toast
   * for something nobody asked for is an interruption, and a toast for
   * something that failed on its own is worse — the next one will try again.
   */
  /**
   * Just the numbers on a scoreboard.
   *
   * What a scoreboard is refreshed for is the scores, the projections under
   * them and the lines under those. Rosters, picks, usage and market values do
   * not move during a game, so a pull on a matchup asks for the three things
   * that do rather than the whole league.
   */
  const refreshScores = useCallback(async () => {
    if (!leagueId || week == null) return;
    setSyncing(true);
    try {
      await Promise.all([
        fetchMatchups(leagueId, week, true, true),
        fetchWeekStats(week, true),
      ]);
      setSyncedAt(Date.now());
    } finally {
      setSyncing(false);
    }
  }, [fetchMatchups, fetchWeekStats, leagueId, week]);

  const refreshAll = useCallback(async (quiet = false) => {
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
      const fresh = { ...d, rosters, users, traded, picks, me: matchMe(users, username) };
      setData(fresh);
      setSyncedAt(Date.now());
      await fetchMarket(d.league, true);
      if (week != null) void fetchMatchups(leagueId, week, true, true);
      // The season's own stats move every week, and the map is keyed by the
      // week — so this is a no-op until one turns over, and the thing that
      // makes the numbers current when it does.
      void fetchUsage(fresh);
      if (!quiet) showToast('Updated: rosters, picks, usage and market values.');
    } catch {
      if (!quiet) showToast('Could not update right now. Try again.');
    } finally {
      setSyncing(false);
    }
    // `week` is read here, so it belongs in the list: without it a refresh
    // would keep asking for whatever week was showing when this was built.
  }, [fetchMarket, fetchMatchups, fetchUsage, leagueId, showToast, username, week]);

  /**
   * Coming back to the app is the only moment it can notice time passed.
   *
   * iOS suspends a home-screen web app and hands it back exactly as it was —
   * same week, same scores, same rosters, however many days later. So a
   * return re-reads the clock every time, and everything else when the gap
   * was long enough to be worth the requests.
   */
  useEffect(() => {
    if (!leagueId || typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void syncClock(leagueId);
      const at = syncedAtRef.current;
      if (!at || Date.now() - at > RESUME_REFRESH_MS) void refreshAll(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [leagueId, refreshAll, syncClock]);

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

  /* ── Player photos ──────────────────────────────────────────────────────
   *
   * Whatever somebody uploads wins over Sleeper's portrait, and it wins for
   * the whole league rather than for the phone it was uploaded from — the
   * joke was previously on its author and nobody else.
   *
   * The league's copy is the truth and the local one is the fallback, in that
   * order, so a photo somebody takes down disappears for everybody on the
   * next read instead of living on in whoever had already cached it. With no
   * database configured the local copy is all there is, which is the app
   * exactly as it behaved before.
   * ──────────────────────────────────────────────────────────────────────── */
  const photos = useMemo(() => {
    const out: Record<string, string> = { ...localPhotos };
    for (const [id, p] of Object.entries(leaguePhotos)) out[id] = p.data;
    return out;
  }, [localPhotos, leaguePhotos]);

  const photoFor = useCallback(
    (id: string, size?: 'thumb' | 'full') => photos[id] || playerPhoto(id, size),
    [photos],
  );

  /**
   * A face and, where there is a choice, both resolutions of it.
   *
   * A photo somebody uploaded has exactly one resolution, so it is handed over
   * plain; Sleeper's are published twice and the screen gets to choose.
   */
  const photoSet = useCallback(
    (id: string): PhotoSet => {
      const team = data?.players[id]?.team || null;
      if (photos[id]) return { photo: photos[id], team };
      // A defence's id is its team, and its face is the team's logo.
      if (!/^\d+$/.test(id)) return { photo: teamLogo(id), team: null };
      return { ...(playerPhotoSet(id) || { photo: null }), team };
    },
    [photos, data],
  );

  /**
   * What a player has averaged this season, in this league's scoring.
   *
   * Byes and weeks he did not play are left out rather than averaged in as
   * zeroes — a man who has played twice and sat out once has scored twice.
   */
  /**
   * Every week he has played, in order — out of the league's own payload
   * first, and out of the stat feed for the weeks that payload cannot know
   * about. See `mergeSeason`: the league lists the players on a roster, so a
   * man it had not picked up yet has no week there at all.
   */
  const seasonLog = useCallback((id: string): Game[] => {
    const league = dataRef.current?.league;
    const scoring = league?.scoring_settings;
    const kind = scoringKind(scoring);
    const scored: Record<number, number | null> = {};
    for (const [wk, map] of Object.entries(gameStats)) {
      scored[Number(wk)] = scoreProjection(map[id] as Record<string, number> | undefined, scoring, kind);
    }
    const log = mergeSeason(seasonPoints[id], scored);
    /* The week being played comes off the live scoreboard, not the season
     * payload: that one is read once and cached, so a bar for this week froze
     * at whatever he had when the card was first opened. */
    const now = week ? liveMatchups.find(r => r.players_points?.[id])?.players_points?.[id] : undefined;
    if (!week || !Number.isFinite(now) || now === 0) return log;
    return log.filter(g => g.week !== week).concat({ week, pts: now as number }).sort((a, b) => a.week - b.week);
  }, [gameStats, seasonPoints, liveMatchups, week]);

  /**
   * Touchdowns this season, out of the weeks whose stat lines are in hand.
   *
   * A different quantity from the `tdPerGame` on his card, which is a rate
   * blended over four seasons to feed the model — nobody asking how many he
   * has scored means that.
   */
  const seasonTds = useCallback((id: string): number | null => countTds(
    Object.values(gameStats).map(map => map[id] as unknown as Record<string, number> | undefined),
  ), [gameStats]);

  /** His whole season as one line: average, total, floor, ceiling. */
  const seasonOf = useCallback((id: string) => seasonLine(seasonLog(id)), [seasonLog]);

  const seasonPpg = useCallback((id: string): { ppg: number; games: number } | null => {
    const line = seasonOf(id);
    return line ? { ppg: line.ppg, games: line.games } : null;
  }, [seasonOf]);

  /**
   * Where he finished that week among the men at his position.
   *
   * The same field as the season ranks: everybody rostered in THIS league who
   * played that week, because that is who could have been started instead of
   * him. An NFL-wide finish would be the more familiar number and a less
   * useful one — it counts thirty quarterbacks nobody here can start, and it
   * would have to be recomputed from raw stats where this is Sleeper's own
   * total under this league's settings.
   */
  const weekRank = useCallback((id: string, pos: string, week: number) => {
    const mine = pointsInWeek(seasonLog(id), week);
    if (mine == null) return null;
    const players = dataRef.current?.players || {};
    const field: number[] = [];
    for (const r of dataRef.current?.rosters || []) {
      for (const pid of r.players || []) {
        if (players[pid]?.position !== pos) continue;
        const p = pointsInWeek(seasonLog(pid), week);
        if (p != null) field.push(p);
      }
    }
    return rankAmong(mine, field);
  }, [seasonLog]);

  /**
   * Where each of those numbers puts him among the men at his position who
   * could be started instead of him.
   *
   * The field is everybody rostered in THIS league at THIS position who has
   * played, because that is who the choice is actually between. A rank against
   * every quarterback in the NFL includes thirty nobody here can start.
   */
  const seasonRanks = useCallback((id: string, pos: string) => {
    const mine = seasonOf(id);
    if (!mine) return null;
    const players = dataRef.current?.players || {};
    const rostered = new Set<string>();
    for (const r of dataRef.current?.rosters || []) {
      for (const pid of r.players || []) rostered.add(pid);
    }
    const field: SeasonLine[] = [];
    /* Touchdowns are counted from the weekly stat lines rather than read off a
       SeasonLine, so they need their own field — gathered from the same men,
       and only from those a count exists for. Before the week's stats land
       nobody has one, including the subject, and then the tile shows no figure
       to rank anyway. */
    const tdField: (number | null)[] = [];
    for (const pid of rostered) {
      if (players[pid]?.position !== pos) continue;
      const line = seasonOf(pid);
      if (line) field.push(line);
      tdField.push(seasonTds(pid));
    }
    const of = (pick: (l: SeasonLine) => number) => rankAmong(pick(mine), field.map(pick));
    return {
      tds: rankCount(seasonTds(id), tdField),
      ppg: of(l => l.ppg),
      total: of(l => l.total),
      high: of(l => l.high),
      low: of(l => l.low),
      floor: of(l => l.floor),
      ceiling: of(l => l.ceiling),
      games: of(l => l.games),
    };
  }, [seasonOf, seasonTds]);

  /** Who set the photo on screen, where the league set it. */
  const photoBy = useCallback((id: string) => leaguePhotos[id]?.by || '', [leaguePhotos]);
  /**
   * Whether the photo on screen is the league's or only this phone's.
   *
   * Said on the card rather than in a toast that has already gone: "does
   * everybody see this" is a question about a photo that outlives the moment
   * it was set, and a photo with no answer beside it is one somebody has to
   * ask about.
   */
  const photoShared = useCallback((id: string) => id in leaguePhotos, [leaguePhotos]);

  const setPhoto = useCallback((id: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Square-crop and downscale before storing: a camera-roll photo would
        // blow localStorage's quota on its own, and it is worse than that in a
        // database the whole league reads on every launch. How far down is not
        // a constant — the encoder is asked, and the biggest square that fits
        // under the ceiling wins. See `model/photo`.
        const data = encodePhoto(img);
        if (!data) return;

        const lid = leagueId;
        const who = dataRef.current?.me?.display_name || username || 'someone';
        if (liveEnabled() && lid) {
          const shared = { data, at: Date.now(), by: who };
          // Shown at once and sent behind it: a photo that waits on a round
          // trip to appear feels like it did not take.
          setLeaguePhotos(prev => ({ ...prev, [id]: shared }));
          void putPhoto(lid, id, shared)
            .then(() => showToast('Photo updated for the league'))
            .catch(e => {
              setLeaguePhotos(prev => { const n = { ...prev }; delete n[id]; return n; });
              showToast(liveReason(e, 'share that photo'));
            });
          return;
        }

        setLocalPhotos(prev => {
          const next = { ...prev, [id]: data };
          writeJson(STORAGE_PHOTOS, next);
          return next;
        });
        showToast('Photo updated on this device');
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }, [leagueId, showToast, username]);

  const clearPhoto = useCallback((id: string) => {
    // Both copies, always: clearing only the league's would let this device's
    // own stale one take over the moment the read came back empty.
    setLocalPhotos(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      writeJson(STORAGE_PHOTOS, next);
      return next;
    });
    const lid = leagueId;
    if (liveEnabled() && lid && leaguePhotos[id]) {
      setLeaguePhotos(prev => { const n = { ...prev }; delete n[id]; return n; });
      void dropPhoto(lid, id).catch(e => showToast(liveReason(e, 'remove that photo')));
    }
    showToast('Original photo restored');
  }, [leagueId, leaguePhotos, showToast]);

  /**
   * Read the league's photos, and hand over this device's own the first time.
   *
   * The one-time handover is what makes the feature arrive with the photos
   * already in it rather than asking everybody to upload theirs again. It runs
   * once per league and never again, so a photo the league later takes down is
   * not pushed back up by whoever still had it cached.
   */
  const syncPhotos = useCallback(async (lid: string) => {
    if (!liveEnabled() || !lid) return;
    let shared: Record<string, SharedPhoto>;
    try {
      shared = await readPhotos(lid);
    } catch {
      return; /* no database reachable: the local copies still show */
    }
    setLeaguePhotos(shared);

    const handed = readJson<Record<string, true>>(STORAGE_PHOTOS_SENT, {});
    if (handed[lid]) return;
    const mine = readJson<Record<string, string>>(STORAGE_PHOTOS, {});
    const who = dataRef.current?.me?.display_name || username || 'someone';
    const added: Record<string, SharedPhoto> = {};
    for (const [id, data] of Object.entries(mine)) {
      if (shared[id] || data.length > PHOTO_MAX_BYTES) continue;
      const photo = { data, at: Date.now(), by: who };
      try {
        await putPhoto(lid, id, photo);
        added[id] = photo;
      } catch {
        return; /* leave the flag unset so the next launch tries again */
      }
    }
    if (Object.keys(added).length) setLeaguePhotos(prev => ({ ...prev, ...added }));
    writeJson(STORAGE_PHOTOS_SENT, { ...handed, [lid]: true });
  }, [username]);

  useEffect(() => {
    if (leagueId) void syncPhotos(leagueId);
  }, [leagueId, syncPhotos]);

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
    usageState, marketState,
    tab, teamView, draftView, tradeView, mockSlot, mockOpen, mockStarted,
    // A room owns the seed, the picks and the seat once one is open.
    mockSeed: room ? room.seed : mockSeed,
    mockChoices: liveChoices ?? mockChoices,
    liveOn: liveEnabled(),
    room, roomId, roomError, humanSeats, mySeat,
    hostRoom, joinRoom, joinByCode, takeSeat, leaveRoom,
    /** A refusal is about the code that was refused — see the join box. */
    clearRoomError: () => setRoomError(''),
    filter, rosterFilter, rosterSort, boardMode, rankMode,
    pickSel, strat, detail, passed, toast, photos, photoBy, photoShared,
    query, topPos, topLens,
    week, nflWeek, matchups: liveMatchups, matchupState, nflGames: games || NO_GAMES, projections, projState, fetchWeekStats,
    weekStats: statsForWeek(weekStats, week),
    gameStats, fetchGameStats,
    tradeTeams, tradeAssets,
    transactions, tradeLogState, fetchTrades,
    schedule: schedule.lid === leagueId ? schedule.weeks : [], fetchSchedule,
    weekScores, powerState, fetchWeekScores, seasonPpg, seasonLog, seasonOf, seasonRanks, seasonTds, weekRank,

    accounts, switchAccount, forgetAccount,
    /* Signing in with Google carries your setup between phones; it does not
     * replace the Sleeper username, which Sleeper gives no way to skip. */
    googleOn: googleEnabled() && profileEnabled(),
    google, googleBusy, googleError, signInWithGoogle, signOutGoogle,
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
    connectUser, pickLeague, switchLeague, logout, refreshAll, refreshScores, refreshPicks, retry,
    // League always opens on your own lineup, wherever you left it.
    setTab: (t: Tab) => { setTab(t); setDetailStack([]); if (t === 'league') setLeagueView('myteam'); },
    leagueView, setLeagueView,
    setTeamView, setDraftView, setTradeView, setFilter,
    /**
     * Start over.
     *
     * In a room the seed, the picks and whether it has begun all live in the
     * database, so setting the local three did nothing — measured: eleven
     * picks became zero on your own and stayed a draft in progress in a room,
     * while the reveal replayed from the top, which is what it looked like
     * when it "glitched". A room is restarted for everybody or not at all.
     */
    rerollMock: () => {
      if (roomId) {
        void restartRoom(roomId, Math.floor(Math.random() * 1e9) + 1)
          .catch(e => {
            setRoomError(liveReason(e, 'restart the room'));
            showToast('Could not restart the room. Leave it and the mock is yours again.');
          });
        return;
      }
      setMockSeed(x => x + 1);
      setMockChoices({});
      setMockStarted(false);
    },
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
    setQuery, setTopPos, setTopLens, setWeek,
    toggleTradeTeam, toggleTradeAsset, cycleTradeTo, clearTrade,
    refreshMatchups: () => { if (leagueId && week != null) void fetchMatchups(leagueId, week, false, true); },
    passOffer: (key: string) => setPassed(p => p.concat(key)),
    resetOffers: () => setPassed([]),

    showToast, hideToast, photoFor, photoSet, setPhoto, clearPhoto,
  };
}

export type App = ReturnType<typeof useApp>;
