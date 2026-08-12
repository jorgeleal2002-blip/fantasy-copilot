/** Shapes we actually read off the Sleeper public API. Everything is optional
 *  where Sleeper may omit it — the catalog in particular is sparse. */

export type Pos = 'QB' | 'RB' | 'WR' | 'TE';

export interface SleeperPlayer {
  player_id?: string;
  position?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  age?: number | null;
  team?: string | null;
  years_exp?: number | null;
  /** Sleeper's internal ADP-ish ordering. Lower is better; missing means unranked. */
  search_rank?: number | null;
  injury_status?: string | null;
  active?: boolean;
  status?: string;
  /** 1 = starter on their NFL depth chart; higher means somebody is ahead of them */
  depth_chart_order?: number | null;
}

export type PlayerCatalog = Record<string, SleeperPlayer>;

export interface SleeperUser {
  user_id: string;
  display_name?: string;
  avatar?: string | null;
  metadata?: { team_name?: string; avatar?: string } | null;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players?: string[] | null;
  starters?: string[] | null;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  avatar?: string | null;
  total_rosters?: number;
  roster_positions?: string[];
  scoring_settings?: Record<string, number>;
  settings?: {
    /** 0 redraft · 1 keeper · 2 dynasty */
    type?: number;
    taxi_slots?: number;
    max_keepers?: number;
    draft_rounds?: number;
    waiver_budget?: number;
    [k: string]: number | undefined;
  };
}

export interface SleeperDraft {
  draft_id: string;
  status?: string;
  type?: string;
  season?: string;
  settings?: { rounds?: number; [k: string]: number | undefined };
  /** user_id → draft slot */
  draft_order?: Record<string, number> | null;
  /** draft slot → roster_id */
  slot_to_roster_id?: Record<string, number> | null;
}

export interface SleeperPick {
  player_id: string;
  picked_by?: string;
  round: number;
  pick_no: number;
  draft_slot?: number;
}

export interface SleeperTradedPick {
  season: string;
  round: number;
  /** roster the pick originally belongs to */
  roster_id: number;
  /** roster that owns it now */
  owner_id: number;
}

/** Per-player season totals from /stats/nfl/regular/{year}. */
export interface SleeperStatLine {
  gp?: number;
  off_snp?: number;
  tm_off_snp?: number;
  rec?: number;
  rec_tgt?: number;
  rec_yd?: number;
  rush_att?: number;
  rush_yd?: number;
  pass_att?: number;
  pass_yd?: number;
  rush_rz_att?: number;
  rec_rz_tgt?: number;
  rush_td?: number;
  rec_td?: number;
  pass_td?: number;
  pts_half_ppr?: number;
  pos_rank_half_ppr?: number;
}

export interface LeagueBundle {
  league: SleeperLeague;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  draft: SleeperDraft | null;
  picks: SleeperPick[];
  traded: SleeperTradedPick[];
  me: SleeperUser;
  players: PlayerCatalog;
}

/** One row of api.fantasycalc.com/values/current. */
export interface FantasyCalcRow {
  value?: number;
  overallRank?: number;
  positionRank?: number;
  trend30Day?: number;
  player?: { sleeperId?: string; name?: string; position?: string };
}
