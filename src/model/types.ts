import type { Pos, SleeperDraft, SleeperLeague, SleeperPick, SleeperPlayer } from '../api/types';
import type { MetricKey, Weights } from './constants';
// Weights is re-exported through the Model's wUsed below.
import type { Metrics } from './score';
import type { Usage } from './usage';

/** Anything that can occupy a lineup slot or sit on a trade table. */
export interface LineupItem {
  id: string;
  pos: string;
  /** market value ÷ 100 — the common currency across players and picks */
  q: number;
}

export interface RosterPlayer extends LineupItem {
  pos: Pos;
  name: string;
  age: number | null;
  team: string;
  exp: number | null;
  adp: number | null | undefined;
  injury: string;
  /** currently in the Sleeper starting lineup */
  starter: boolean;
  /** round they were drafted in, when this league's draft produced them */
  round?: number;
  raw: SleeperPlayer;
  use?: Usage;
  m: Metrics;
  fit: number;
  owned: true;
  wEff: Weights;
  isPick?: false;
}

export interface BoardPlayer {
  id: string;
  name: string;
  pos: Pos;
  team: string | null | undefined;
  age: number | null | undefined;
  exp: number | null | undefined;
  adp: number | null | undefined;
  m: Metrics;
  fit: number;
  raw: SleeperPlayer;
  use?: Usage;
  /** set when the sheet is opened for a player on someone else's roster */
  owner?: string | null;
  owned?: boolean;
}

/** A player on an opponent's roster, as the trade engine sees them. */
export interface OppPlayer extends LineupItem {
  pos: Pos;
  name: string;
  age: number | null;
  team: string;
  raw: SleeperPlayer;
  isPick?: false;
}

export interface PickAsset extends LineupItem {
  pos: 'PICK';
  name: string;
  label: string;
  origin: string;
  season: number;
  round: number;
  isPick: true;
  age: null;
  team: string;
}

export type TradeAsset = RosterPlayer | OppPlayer | PickAsset;

export interface MyDraftPick {
  round: number;
  slot: number;
  overall: number;
  label: string;
  /** team it was acquired from, when it is not natively yours */
  via: string | null;
  done: boolean;
}

export interface TeamEntry {
  id: string;
  name: string;
  avatar: string | null;
  slot: number | null;
  isMe: boolean;
}

export type Window = 'contender' | 'rebuild' | 'medio';

export interface TeamProfile {
  window: Window;
  avgAge: number;
  /** 1 = strongest roster in the league */
  rank: number;
  worst: Pos | null;
  worstRank: number;
}

export interface LeagueRow {
  id: number;
  ownerId: string;
  name: string;
  isMe: boolean;
  avatar: string | null;
  posStrength: Partial<Record<Pos, number>>;
  now: number;
  future: number;
  pickCapital: number;
  /** average Fit of the optimal starters, today */
  fit: number;
  /** the same, with the roster aged two seasons */
  fitFut: number;
  avgAge: number;
  window: Window;
  worst: Pos | null;
  rankNow: number;
  rankFut: number;
  /** place by the average Fit of the optimal starters, today and two years out */
  rankFit: number;
  rankFitFut: number;
  /** places gained (+) or lost (−) moving from today to the future view */
  shift: number;
}

export interface Offer {
  partner: string;
  give: RosterPlayer | PickAsset;
  get: OppPlayer | PickAsset;
  /** starter points gained (lineup deals) or market value gained (capital deals) */
  gain: number;
  theirGain: number;
  fit: number;
  /** + you buy under market · − you overpay */
  edge: number;
  kind: 'lineup' | 'capital';
  prof: TeamProfile;
  fillsTheirNeed: boolean;
}

export interface DraftDeal {
  kind: 'up' | 'down';
  partner: string;
  get: PickAsset[];
  give: TradeAsset[];
  ratio: number;
  fit: number;
  prof: TeamProfile;
}

export interface LineupSlot {
  slot: string;
  player?: RosterPlayer;
}

/** One row of the search index over Sleeper's whole catalog. */
export interface SearchEntry {
  id: string;
  name: string;
  /** pre-lowercased so a keystroke does not re-case the catalog */
  lower: string;
  pos: Pos;
  rank: number;
}

/** One rostered player, scored through the three lenses of the top list. */
export interface PlayerFit {
  id: string;
  name: string;
  pos: Pos;
  team: string;
  age: number | null;
  /** no need term, stack inside the owner's roster — how good he is, full stop */
  fit: number;
  /** with your positional need and the stack against your roster */
  fitMe: number;
  /** aged two seasons */
  fit2: number;
  owner: string;
  mine: boolean;
}

export interface PositionMultiplier {
  pos: Pos;
  mult: number;
  why: string;
}

export interface TeamSheet {
  row: LeagueRow;
  list: OppPlayer[];
  ranks: Record<Pos, number>;
  bestPos: Pos;
  picks: PickAsset[];
}

export interface Model {
  league: SleeperLeague;
  draft: SleeperDraft | null;
  picks: SleeperPick[];
  teams: TeamEntry[];
  me: { id: string; name: string; teamName: string; avatar: string | null; initials: string };

  isDynasty: boolean;
  sflx: boolean;
  teamCount: number;
  rounds: number;
  seasonNum: number;

  myPlayers: RosterPlayer[];
  have: Record<Pos, number>;
  slots: Record<Pos, number>;
  posRank: Record<Pos, number>;
  posPct: Record<Pos, number>;
  needScore: Record<Pos, number>;

  scored: BoardPlayer[];
  optimal: LineupSlot[];
  swaps: LineupSlot[];
  optIds: string[];
  benchQ: number;
  starterQ: number;
  totalQ: number;
  myBase: number;

  explosive: RosterPlayer[];
  fading: RosterPlayer[];
  buried: RosterPlayer[];
  stacks: { team: string; text: string; why: string }[];
  conflicts: { team: string; text: string; why: string }[];
  concentration: { team: string; text: string; why: string }[];

  pickAssets: PickAsset[];
  myPickList: MyDraftPick[];
  upcoming: MyDraftPick[];
  selPick: MyDraftPick | null;
  nextOverall: number;
  myRound: number;
  myPickInRound: number;
  myNextOverall: number | null;
  mySlot: number | null;

  offers: Offer[];
  bestDeals: DraftDeal[];
  leagueRows: LeagueRow[];
  leagueHasRosters: boolean;
  multInfo: PositionMultiplier[];
  /** every rostered player in the league, scored through the three lenses */
  allFits: PlayerFit[];
  searchIndex: SearchEntry[];
  /** market vs. production percentiles for the player sheet */
  qDiverge: (pl: SleeperPlayer | null, id: string) => { mkt: number; prod: number } | null;
  /** the weights actually in force — redraft leagues reshape them */
  wUsed: Weights;
  /** how many assets the market feed matched — 0 when it never loaded */
  marketCount: number;

  teamInfo: (rosterId: number) => TeamSheet | null;
  posRankOf: (rosterId: number, pos: Pos) => number;
  scoreAny: (playerId: string) => BoardPlayer | null;
  metricKeys: MetricKey[];
}
