/**
 * A synthetic but structurally faithful league: 10 teams, dynasty superflex,
 * a 3-round rookie draft in `pre_draft`, one acquired pick, and season stats.
 * Used by the unit tests and by the browser smoke test, which stubs `fetch`
 * with exactly these payloads.
 */
import type {
  FantasyCalcRow, LeagueBundle, PlayerCatalog, SleeperDraft, SleeperLeague,
  SleeperMatchup, SleeperPick, SleeperRoster, SleeperStatLine, SleeperUser,
} from '../api/types';

export const MY_USER_ID = 'u1';
export const MY_USERNAME = 'lil2002';
export const TEAMS = 10;
export const LEAGUE_ID = '1385973534941011968';
export const DRAFT_ID = 'd100';

/** Each team is dealt 2 QB / 3 RB / 4 WR / 2 TE, and the surplus stays
 *  unrostered so the free-agent board has something to show. */
const PER_TEAM = { QB: 2, RB: 3, WR: 4, TE: 2 } as const;
const VET_COUNTS = { QB: 26, RB: 38, WR: 50, TE: 26 } as const;
const ROOKIE_COUNTS = { QB: 4, RB: 8, WR: 10, TE: 4 } as const;

/** Deterministic pseudo-random so every run sees the same league. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

export function makePlayers(): {
  players: PlayerCatalog; vets: string[]; rookies: string[]; byPos: Record<string, string[]>;
} {
  const rand = rng(7);
  const players: PlayerCatalog = {};
  const vets: string[] = [];
  const rookies: string[] = [];
  const byPos: Record<string, string[]> = { QB: [], RB: [], WR: [], TE: [] };
  let id = 1000;
  let rank = 1;

  // Veterans, interleaved by position so search_rank is a plausible board.
  const vetQueue: { pos: keyof typeof VET_COUNTS; n: number }[] = [];
  (Object.keys(VET_COUNTS) as (keyof typeof VET_COUNTS)[]).forEach(pos => {
    for (let i = 0; i < VET_COUNTS[pos]; i++) vetQueue.push({ pos, n: i });
  });
  vetQueue.sort((a, b) => a.n * 4 + posOrder(a.pos) - (b.n * 4 + posOrder(b.pos)));
  vetQueue.forEach(({ pos, n }) => {
    const pid = String(++id);
    players[pid] = {
      player_id: pid,
      position: pos,
      full_name: `${pos} Vet ${n + 1}`,
      first_name: pos, last_name: `Vet${n + 1}`,
      age: 23 + Math.floor(rand() * 10),
      team: NFL_TEAMS[(id + n) % NFL_TEAMS.length],
      years_exp: 1 + Math.floor(rand() * 8),
      search_rank: rank++,
      active: true, status: 'Active',
      injury_status: n % 17 === 0 ? 'Questionable' : null,
    };
    vets.push(pid);
    byPos[pos].push(pid);
  });

  // Rookies: experience 0 and 21–23 years old, which is what the board filters on.
  (Object.keys(ROOKIE_COUNTS) as (keyof typeof ROOKIE_COUNTS)[]).forEach(pos => {
    for (let i = 0; i < ROOKIE_COUNTS[pos]; i++) {
      const pid = String(++id);
      players[pid] = {
        player_id: pid,
        position: pos,
        full_name: `${pos} Rookie ${i + 1}`,
        first_name: pos, last_name: `Rookie${i + 1}`,
        age: 21 + Math.floor(rand() * 3),
        team: NFL_TEAMS[(id + i) % NFL_TEAMS.length],
        years_exp: 0,
        search_rank: rank++,
        active: true, status: 'Active',
        injury_status: null,
      };
      rookies.push(pid);
    }
  });

  /* Kickers and team defences. They sit deep in the search rank, the way
     Sleeper has them, so a board ordered by that rank naturally reaches them
     only in the late rounds — which is the behaviour under test. A defence has
     no age and no experience, exactly as the catalog reports it. */
  let fillRank = 240;
  for (let i = 0; i < 14; i++) {
    const kid = String(++id);
    players[kid] = {
      player_id: kid, position: 'K', full_name: `Kicker ${i + 1}`,
      first_name: 'Kicker', last_name: String(i + 1),
      age: 27, team: NFL_TEAMS[i % NFL_TEAMS.length], years_exp: 4,
      search_rank: fillRank++, active: true, status: 'Active', injury_status: null,
    };
    const did = String(++id);
    players[did] = {
      player_id: did, position: 'DEF', full_name: `${NFL_TEAMS[i % NFL_TEAMS.length]} Defense`,
      first_name: NFL_TEAMS[i % NFL_TEAMS.length], last_name: 'Defense',
      age: null, team: NFL_TEAMS[i % NFL_TEAMS.length], years_exp: null,
      search_rank: fillRank++, active: true, status: 'Active', injury_status: null,
    };
  }

  return { players, vets, rookies, byPos };
}

const posOrder = (p: string) => ({ QB: 0, RB: 1, WR: 2, TE: 3 } as Record<string, number>)[p] ?? 4;

const NFL_TEAMS = ['CIN', 'MIA', 'NO', 'LAC', 'ARI', 'KC', 'PHI', 'SF', 'DAL', 'BUF', 'DET', 'GB'];

export function makeLeague(): SleeperLeague {
  return {
    league_id: LEAGUE_ID,
    name: 'Cuboys',
    season: '2026',
    avatar: null,
    total_rosters: TEAMS,
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
    scoring_settings: { rec: 0.5, bonus_rec_te: 0.5, rush_fd: 0.5, rec_fd: 0, pass_td: 4, pass_yd: 0.04 },
    settings: { type: 2, taxi_slots: 2, max_keepers: 0, draft_rounds: 3, waiver_budget: 100 },
  };
}

export function makeUsers(): SleeperUser[] {
  const names = ['Sam Presti', 'Konoha', 'Chompeiji', 'Rocket', 'Vega', 'Kobra', 'Nimbus', 'Atlas', 'Pyro', 'Zenith'];
  return names.map((name, i) => ({
    user_id: i === 0 ? MY_USER_ID : 'u' + (i + 1),
    display_name: i === 0 ? MY_USERNAME : name.toLowerCase().replace(/\s+/g, ''),
    avatar: null,
    metadata: { team_name: name },
  }));
}

export function makeRosters(byPos: Record<string, string[]>): SleeperRoster[] {
  const users = makeUsers();
  // Deal by position so every roster can legally fill the format's slots.
  return users.map((u, i) => {
    const players = (Object.keys(PER_TEAM) as (keyof typeof PER_TEAM)[])
      .flatMap(pos => byPos[pos].slice(i * PER_TEAM[pos], (i + 1) * PER_TEAM[pos]));
    /* A season already under way, so a standing, a record and a place are on
       screen to be designed around. A fixture at 0-0 draws a scoreboard header
       with its subtitle missing, which is a different header from the one that
       ships. Spread deliberately: a 3-0 at the top, a 0-3 at the bottom and a
       tie in the middle, so every shape of the line is drawn by somebody. */
    const wins = [3, 3, 2, 2, 2, 1, 1, 1, 0, 0][i];
    const ties = i === 4 ? 1 : 0;
    const fpts = 420 - i * 17;
    return {
      roster_id: i + 1,
      owner_id: u.user_id,
      players,
      // Deliberately not the optimal set, so "changes vs Sleeper" is non-zero.
      starters: players.slice(1, 10),
      settings: {
        wins,
        losses: 3 - wins - ties,
        ties,
        fpts: Math.floor(fpts),
        fpts_decimal: Math.round((fpts % 1) * 100),
      },
    };
  });
}

export function makeDraft(): SleeperDraft {
  const draft_order: Record<string, number> = {};
  const slot_to_roster_id: Record<string, number> = {};
  makeUsers().forEach((u, i) => {
    // I am slot 5, as in the real league; everyone else fills around me.
    const slot = i === 0 ? 5 : i <= 4 ? i : i + 1;
    draft_order[u.user_id] = slot;
    slot_to_roster_id[String(slot)] = i + 1;
  });
  return {
    draft_id: DRAFT_ID,
    status: 'pre_draft',
    type: 'linear',
    season: '2026',
    settings: { rounds: 3 },
    draft_order,
    slot_to_roster_id,
  };
}

export const makePicks = (): SleeperPick[] => [];

/** Roster 2 ("Konoha") sent me its 2026 second-rounder. */
export const makeTraded = () => [{ season: '2026', round: 2, roster_id: 2, owner_id: 1 }];

export function makeStats(players: PlayerCatalog): Record<string, SleeperStatLine> {
  const rand = rng(11);
  const stats: Record<string, SleeperStatLine> = {};
  Object.keys(players).forEach(id => {
    const p = players[id];
    if (p.years_exp === 0) return;          // rookies have no prior season
    const gp = 12 + Math.floor(rand() * 6);
    stats[id] = {
      gp,
      off_snp: Math.round(400 + rand() * 600),
      tm_off_snp: 1050,
      rec_tgt: p.position === 'QB' ? 0 : Math.round(30 + rand() * 110),
      rush_att: p.position === 'RB' ? Math.round(60 + rand() * 190) : 0,
      rush_rz_att: p.position === 'RB' ? Math.round(rand() * 40) : 0,
      rec_rz_tgt: p.position === 'QB' ? 0 : Math.round(rand() * 20),
      rush_td: p.position === 'RB' ? Math.round(rand() * 12) : 0,
      rec_td: p.position === 'QB' ? 0 : Math.round(rand() * 10),
      pass_td: p.position === 'QB' ? Math.round(15 + rand() * 20) : 0,
      pts_half_ppr: Math.round(80 + rand() * 220),
      pos_rank_half_ppr: 1 + Math.floor(rand() * 40),
    };
  });
  return stats;
}

/** FantasyCalc rows: players by sleeperId, plus this draft's exact pick slots
 *  and generic future rounds — the three shapes the parser has to handle. */
export function makeFantasyCalc(players: PlayerCatalog): FantasyCalcRow[] {
  const rows: FantasyCalcRow[] = Object.keys(players).map((id, i) => {
    const rank = players[id].search_rank || 900;
    return {
      value: Math.max(80, Math.round(9000 * Math.exp(-rank / 45))),
      overallRank: rank,
      positionRank: 1 + (i % 30),
      trend30Day: 0,
      player: { sleeperId: id, name: players[id].full_name, position: players[id].position },
    };
  });
  for (let round = 1; round <= 3; round++) {
    for (let slot = 1; slot <= TEAMS; slot++) {
      rows.push({
        value: Math.round(7200 * Math.exp(-((round - 1) * TEAMS + slot) / 9)) + 200,
        player: { sleeperId: `FP_2026_${round}_${slot}`, name: `2026 Pick ${round}.${String(slot).padStart(2, '0')}`, position: 'PICK' },
      });
    }
  }
  [2027, 2028].forEach((year, yi) => {
    (['1st', '2nd', '3rd'] as const).forEach((word, ri) => {
      rows.push({
        value: Math.round([2892, 1508, 1076][ri] * Math.pow(0.72, yi)),
        player: { sleeperId: `FP_${year}_${ri + 1}`, name: `${year} ${word}`, position: 'PICK' },
      });
      rows.push({
        value: Math.round([3400, 1700, 1200][ri] * Math.pow(0.72, yi)),
        player: { sleeperId: `FP_${year}_${ri + 1}_E`, name: `${year} ${word} (Early)`, position: 'PICK' },
      });
    });
  });
  return rows;
}

export function makeBundle(): LeagueBundle {
  const { players, byPos } = makePlayers();
  const users = makeUsers();
  return {
    league: makeLeague(),
    users,
    rosters: makeRosters(byPos),
    draft: makeDraft(),
    picks: makePicks(),
    traded: makeTraded(),
    me: users[0],
    players,
  };
}

/**
 * One week of head-to-heads, with the lineups Sleeper actually sends.
 *
 * The screen that reads this pairs the two lineups slot against slot, so the
 * fixture has to carry `starters` and `players_points` and not just a total —
 * a fixture with only the totals in it renders a scoreboard that opens onto
 * nothing, which is exactly the state this is here to catch.
 *
 * Rosters are paired 1v2, 3v4 and so on, and one team is left out so the bye
 * path is on screen too.
 */
export function makeMatchups(byPos: Record<string, string[]>, week: number): SleeperMatchup[] {
  const rosters = makeRosters(byPos);
  const r = rng(week * 7919 + 13);
  return rosters.map((roster, i) => {
    // The league starts nine; the roster's own `starters` is already that many.
    const starters = (roster.starters || []).slice(0, 9);
    const players_points: Record<string, number> = {};
    let total = 0;
    starters.forEach((id, j) => {
      // A slot nobody filled, on one team, so the empty case is drawn.
      if (i === 1 && j === 4) return;
      const pts = Math.round(r() * 240) / 10;
      players_points[id] = pts;
      total += pts;
    });
    return {
      roster_id: roster.roster_id,
      // The last roster gets no id at all, which is Sleeper's way of saying bye.
      matchup_id: i === rosters.length - 1 ? null : Math.floor(i / 2) + 1,
      points: Math.round(total * 100) / 100,
      starters: i === 1 ? starters.map((id, j) => (j === 4 ? '0' : id)) : starters,
      players_points,
    };
  });
}

/**
 * One week of per-player STAT LINES — what each man actually did, which is the
 * line under his name on the matchup sheet.
 *
 * Shaped by position, because `statBits` reads a quarterback's line and a
 * receiver's differently, and a fixture that fed everybody carries and catches
 * would draw a screen nobody will ever see.
 */
export function makeWeekStats(
  players: PlayerCatalog,
  week: number,
): Record<string, SleeperStatLine> {
  const r = rng(week * 104729 + 7);
  const out: Record<string, SleeperStatLine> = {};
  for (const id of Object.keys(players)) {
    const pos = players[id].position;
    // Not everybody plays, so the "—" path stays on screen too.
    if (r() < 0.12) continue;
    const s: SleeperStatLine = { gp: 1 };
    if (pos === 'QB') {
      s.pass_att = 20 + Math.round(r() * 20);
      s.pass_cmp = Math.round(s.pass_att * (0.55 + r() * 0.2));
      s.pass_yd = 120 + Math.round(r() * 230);
      s.pass_td = Math.round(r() * 3.4);
      s.pass_int = Math.round(r() * 1.6);
      s.rush_att = Math.round(r() * 7);
      s.rush_yd = Math.round(r() * 45);
    } else if (pos === 'RB') {
      s.rush_att = 4 + Math.round(r() * 18);
      s.rush_yd = 10 + Math.round(r() * 110);
      s.rush_td = Math.round(r() * 1.4);
      s.rec_tgt = Math.round(r() * 6);
      s.rec = Math.round((s.rec_tgt || 0) * (0.5 + r() * 0.5));
      s.rec_yd = Math.round((s.rec || 0) * (4 + r() * 8));
    } else {
      s.rec_tgt = 2 + Math.round(r() * 10);
      s.rec = Math.round((s.rec_tgt || 0) * (0.4 + r() * 0.5));
      s.rec_yd = Math.round((s.rec || 0) * (6 + r() * 11));
      s.rec_td = Math.round(r() * 1.3);
    }
    out[id] = s;
  }
  return out;
}

/**
 * Sleeper's weekly projections, in the shape the live endpoint answers with:
 * an array of rows, each a `player_id` and a nested `stats` object. The app
 * re-totals that line against the league's own scoring rather than trusting a
 * pre-totalled number, so a fixture that carried only `pts_half_ppr` would
 * exercise the fallback instead of the path that runs.
 */
export function makeProjections(players: PlayerCatalog, week: number): unknown[] {
  const r = rng(week * 15485863 + 11);
  return Object.keys(players).map(id => {
    const pos = players[id].position;
    const stats: Record<string, number> = {};
    if (pos === 'QB') {
      stats.pass_yd = 180 + Math.round(r() * 120);
      stats.pass_td = Math.round(r() * 25) / 10;
      stats.rush_fd = Math.round(r() * 20) / 10;
    } else {
      stats.rec = Math.round(r() * 70) / 10;
      stats.rush_fd = Math.round(r() * 25) / 10;
    }
    stats.pts_half_ppr = Math.round(r() * 190) / 10;
    return { player_id: id, stats };
  });
}
