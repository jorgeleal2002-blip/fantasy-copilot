import type { DraftPos, FillPos, Pos, SleeperDraft, SleeperLeague, SleeperPick, SleeperPlayer } from '../api/types';
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
  /** consensus rank across the whole board, from the market. Null where the
   *  market has no opinion on him — never Sleeper's search index. */
  rank: number | null;
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
  /** Anything a draft can take, which in a league that starts them includes a
   *  kicker and a team defence. They carry a rank instead of a Fit Score. */
  pos: DraftPos;
  team: string | null | undefined;
  age: number | null | undefined;
  exp: number | null | undefined;
  /** where he sits among what is STILL AVAILABLE, so the screens can render it
   *  as the pick he goes at. Null when he was not scored off a board. */
  goes: number | null;
  /** consensus rank across every player the market prices. */
  rank: number | null;
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

/**
 * A package you could send to acquire one specific player. Unlike `Offer`,
 * which the engine proposes on its own, this one starts from a name you chose
 * — so it may cost you a starter, and it reports that instead of hiding it.
 */
export interface TargetTrade {
  partner: string;
  target: OppPlayer;
  give: (RosterPlayer | PickAsset)[];
  /** market value of everything you send */
  cost: number;
  /** + you buy under market · − you overpay */
  edge: number;
  /** how likely the other manager is to say yes, 5–95 */
  accept: number;
  /** starter points your lineup gains — negative when the package costs you one */
  myGain: number;
  theirGain: number;
  fillsTheirNeed: boolean;
  prof: TeamProfile;
}

/**
 * A trade you said you were interested in, kept across launches.
 *
 * It stores its own text rather than only ids, because the offer it came from
 * is recomputed from live data on every load: a roster move can make the exact
 * deal disappear, and a shortlist that silently loses rows is worse than one
 * that says "this is gone now".
 */
export interface SavedTrade {
  key: string;
  leagueId: string;
  partner: string;
  giveIds: string[];
  getIds: string[];
  giveText: string;
  getText: string;
  /** 'offer' came from the suggestions, 'target' from a player you went after */
  kind: 'offer' | 'target';
  /** the read at the moment you saved it */
  note: string;
  /** Fit for a suggestion, acceptance odds for a target */
  score: number;
  savedAt: number;
}

/** One selection already made in the mock, bot or yours. */
export interface MockPick {
  overall: number;
  round: number;
  slot: number;
  label: string;
  /** Where he stood among everyone STILL on the board when he came off it:
   *  1 is the consensus best available, and a big number is a reach. It is the
   *  difference between a pick and a surprise, which is the only thing the room
   *  can react to without being told. */
  boardAt: number;
  /** the manager on the clock */
  team: string;
  mine: boolean;
  player: MockOption | null;
}

export interface MockOption {
  id: string;
  name: string;
  /** a mock board also holds the kicker and the defence, which are not `Pos` */
  pos: DraftPos;
  team: string | null | undefined;
  age: number | null | undefined;
  /** consensus rank across every player the market prices. */
  rank: number | null;
  /** his place among what is still on the mock's board. */
  goes?: number | null;
  fit: number;
  /** set only on the three shortcuts offered at your turn */
  lens?: 'best' | 'need' | 'value' | 'upside';
  /** the heading, written where the facts are — "fills your hole" is a claim,
   *  and it is only true when the position is actually short */
  title?: string;
  why?: string;
}

/**
 * A mock draft room, frozen at the moment it is your turn.
 *
 * Not a finished simulation: the bots run up to your pick and stop, exactly
 * like sitting on the clock. Everything the screen needs to let you draft is
 * here, and taking someone advances it by replaying with one more choice.
 */
export interface MockState {
  /** the seat you are drafting from */
  slot: number;
  /** every selection made so far, oldest first */
  made: MockPick[];
  /** your turn, or null once the mock is over */
  onClock: {
    overall: number; round: number; slot: number; label: string;
    /** false while a person in another seat is thinking */
    mine: boolean;
    /** who that person is, for the line that says so */
    who: string;
  } | null;
  /** the three rated shortcuts for this turn */
  options: MockOption[];
  /** everything still on the board, rated, best first */
  board: MockOption[];
  /** what you have taken in this mock, in order */
  myTeam: MockOption[];
  /** your roster shape including what you already own */
  shape: Record<DraftPos, number>;
  done: boolean;
}

/**
 * What the league would give back for a player you put up for trade.
 *
 * The mirror of `TargetTrade`: there you ask what a man would COST, here what
 * he would FETCH. Packages matter in this direction too — nobody pays for your
 * best starter with one piece, so the answer for him is two of theirs or
 * nothing, and "nothing" is not an answer worth showing.
 */
export interface BlockReturn {
  partner: string;
  /** the player of yours going out */
  send: RosterPlayer;
  /** what comes back: one or two of their pieces */
  get: (OppPlayer | PickAsset)[];
  /** market value of everything coming back */
  back: number;
  /** + you get back more than he is worth · − you sell him short */
  edge: number;
  /** how likely the other manager is to say yes, 5–95 */
  accept: number;
  /** starter points your lineup gains — usually negative, since he was yours */
  myGain: number;
  theirGain: number;
  fillsTheirNeed: boolean;
  prof: TeamProfile;
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
  /** first-year player young enough to still be a rookie-draft asset */
  rookie: boolean;
  /** already on somebody's roster or off this draft's board */
  taken: boolean;
}

/**
 * What a player is worth, ready to display. `pts` is the market's own number
 * when the feed loaded; when it did not, it is the model's stand-in on the same
 * scale, and `real` says which one you are looking at.
 */
export interface PlayerValue {
  pts: number;
  real: boolean;
  pos: Pos;
  /** where that price ranks him inside his own position */
  posRank: number | null;
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
  /** the draft reverses every other round, which the board has to draw */
  snake: boolean;
  /** Which of the fill positions this league actually starts, so the screens
   *  offer a kicker exactly where one can be played and nowhere else. */
  fills: FillPos[];
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
  /** What comes back for the players you put up for trade, best first. */
  blockOffers: BlockReturn[];
  bestDeals: DraftDeal[];
  leagueRows: LeagueRow[];
  leagueHasRosters: boolean;
  /** false when this account matches no roster in the league — as an owner or
   *  a co-owner. Everything derived from "your team" is empty when it is. */
  foundMyTeam: boolean;
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
  /** the price tag for one player, with its rank inside his position */
  marketValue: (playerId: string) => PlayerValue | null;
  /** what it would cost to acquire one specific player from his owner */
  offersFor: (playerId: string) => TargetTrade[];
  /**
   * Play the rest of the draft out. The seed makes one run reproducible;
   * `choices` maps an overall pick of yours to the player you took there, so
   * the board downstream reacts to what you actually did.
   */
  /**
   * Run the mock up to your next turn and stop there. `choices` is every pick
   * you have already made, keyed by overall; `fromSlot` drafts from a seat
   * other than your own.
   */
  runMock: (
    seed: number,
    choices?: Record<number, string>,
    fromSlot?: number | null,
    /** seats other people hold in a shared room; a bot never picks for these */
    humanSeats?: number[],
  ) => MockState;
  metricKeys: MetricKey[];
}
