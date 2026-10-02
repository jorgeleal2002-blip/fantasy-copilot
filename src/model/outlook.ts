/**
 * The rest of the regular season, played out a few thousand times.
 *
 * Each team scores a normal draw around its own strength every week it has a
 * game left; the higher score wins. Count the wins, rank the table the way a
 * league does (wins, then points for) and see who makes the cut. What comes
 * out is three numbers a manager actually asks about: what record this ends
 * on, how often that is a playoff team, and how hard the road there is.
 *
 * A model, not a forecast anybody should bet on: the spread is the same for
 * every team, injuries do not exist, and strength is fixed for the season.
 * It is seeded, so the same inputs print the same numbers every time.
 */

export interface OutlookTeam {
  id: number;
  wins: number;
  losses: number;
  ties: number;
  /** points for so far, the league's tiebreak */
  pf: number;
  /** what the team is expected to score in a week */
  strength: number;
}

/** One week left to play: the pairs of roster ids facing each other. */
export interface OutlookWeek { week: number; pairs: [number, number][] }

export interface TeamOutlook {
  /** wins and losses expected by the end of the regular season */
  wins: number;
  losses: number;
  ties: number;
  /** share of runs in which the team finished inside the playoff places */
  playoffPct: number;
  /** average strength of the opponents still to come, or null with none left */
  oppStrength: number | null;
  /** 1 = the easiest schedule left in the league */
  sosRank: number | null;
}

/** Small, fast and seedable — the numbers must not jitter on a re-render. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How much a team's score moves week to week, as a share of what it scores.
 * Across fantasy leagues a team's weekly standard deviation sits around a
 * sixth to a fifth of its mean.
 */
export const WEEKLY_SPREAD = 0.18;

export function seasonOutlook(
  teams: OutlookTeam[],
  schedule: OutlookWeek[],
  playoffTeams: number,
  sims = 2000,
  seed = 7,
): Record<number, TeamOutlook> {
  const out: Record<number, TeamOutlook> = {};
  if (!teams.length) return out;
  const byId = new Map(teams.map(t => [t.id, t]));
  const cut = Math.max(1, Math.min(teams.length, playoffTeams));
  const rand = rng(seed);
  // Box–Muller, one draw at a time; the second value is not worth the state.
  const normal = () => {
    const u = Math.max(rand(), 1e-12), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const winSum: Record<number, number> = {};
  const lossSum: Record<number, number> = {};
  const made: Record<number, number> = {};
  for (const t of teams) { winSum[t.id] = 0; lossSum[t.id] = 0; made[t.id] = 0; }

  const pairs = schedule.flatMap(w => w.pairs).filter(([a, b]) => byId.has(a) && byId.has(b));
  for (let s = 0; s < sims; s++) {
    const w: Record<number, number> = {};
    const l: Record<number, number> = {};
    const pf: Record<number, number> = {};
    for (const t of teams) { w[t.id] = t.wins + t.ties / 2; l[t.id] = t.losses + t.ties / 2; pf[t.id] = t.pf; }
    for (const [a, b] of pairs) {
      const ta = byId.get(a) as OutlookTeam, tb = byId.get(b) as OutlookTeam;
      const sa = ta.strength * (1 + WEEKLY_SPREAD * normal());
      const sb = tb.strength * (1 + WEEKLY_SPREAD * normal());
      pf[a] += sa; pf[b] += sb;
      if (sa >= sb) { w[a]++; l[b]++; } else { w[b]++; l[a]++; }
    }
    const table = teams.map(t => t.id).sort((x, y) => w[y] - w[x] || pf[y] - pf[x]);
    for (let i = 0; i < cut; i++) made[table[i]]++;
    for (const t of teams) { winSum[t.id] += w[t.id]; lossSum[t.id] += l[t.id]; }
  }

  const opp: Record<number, number[]> = {};
  for (const [a, b] of pairs) {
    (opp[a] = opp[a] || []).push((byId.get(b) as OutlookTeam).strength);
    (opp[b] = opp[b] || []).push((byId.get(a) as OutlookTeam).strength);
  }
  const avgOpp = (id: number) => {
    const xs = opp[id];
    return xs && xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
  };
  const ranked = teams
    .map(t => ({ id: t.id, v: avgOpp(t.id) }))
    .filter((x): x is { id: number; v: number } => x.v != null)
    .sort((a, b) => a.v - b.v);

  for (const t of teams) {
    const i = ranked.findIndex(x => x.id === t.id);
    out[t.id] = {
      wins: winSum[t.id] / sims,
      losses: lossSum[t.id] / sims,
      ties: 0,
      playoffPct: made[t.id] / sims,
      oppStrength: avgOpp(t.id),
      sosRank: i < 0 ? null : i + 1,
    };
  }
  return out;
}

/**
 * What a team is expected to score in a week: its own average, leaning on the
 * projection of its best lineup while there are few games to average — two
 * games are mostly noise, ten are mostly the team.
 */
export function teamStrength(avg: number | null, proj: number | null, games: number, fallback: number): number {
  if (avg == null && proj == null) return fallback;
  if (avg == null) return proj as number;
  if (proj == null) return avg;
  const w = games / (games + 3);
  return w * avg + (1 - w) * proj;
}
