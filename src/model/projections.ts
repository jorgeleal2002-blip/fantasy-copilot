/**
 * Sleeper's own weekly projections, scored in YOUR league.
 *
 * The feed publishes a projected STAT LINE per player — attempts, yards,
 * catches, touchdowns — alongside three pre-totalled numbers for standard,
 * half-PPR and full PPR. The pre-totalled ones are the easy read and the wrong
 * one in any league that is not exactly one of those three: six-point passing
 * touchdowns, a tight-end premium or a point for a first down all move a
 * quarterback or a tight end by several points a week.
 *
 * The league already tells us what it pays for each of those, in
 * `scoring_settings`, whose keys are the same keys the projected stat line
 * uses. So the projection is re-totalled against them — a dot product, exact
 * for any league whose scoring is a linear function of counting stats, which
 * is very nearly all of them. The pre-totalled number is the fallback for a
 * league that publishes no settings, never the first choice.
 */

/** Which of Sleeper's three pre-totalled numbers a league is closest to. */
export type ScoringKind = 'ppr' | 'half' | 'std';

export function scoringKind(scoring?: Record<string, number> | null): ScoringKind {
  const rec = scoring?.rec;
  if (!Number.isFinite(rec as number)) return 'half';
  if ((rec as number) >= 0.75) return 'ppr';
  if ((rec as number) >= 0.25) return 'half';
  return 'std';
}

const TOTAL_KEY: Record<ScoringKind, string> = {
  ppr: 'pts_ppr', half: 'pts_half_ppr', std: 'pts_std',
};

/**
 * One player's projected points under a league's scoring.
 *
 * Only the keys the league actually pays for are read, so a projection that
 * carries a stat this league scores nothing for contributes nothing, and a
 * threshold bonus the projection has no column for — `bonus_pass_yd_300` and
 * its kind — falls out at zero rather than being guessed at.
 */
export function scoreProjection(
  stats: Record<string, number> | null | undefined,
  scoring: Record<string, number> | null | undefined,
  kind: ScoringKind = 'half',
): number | null {
  if (!stats) return null;
  const fallback = stats[TOTAL_KEY[kind]];
  const pre = Number.isFinite(fallback) ? fallback : null;
  if (!scoring || !Object.keys(scoring).length) return pre;

  let total = 0;
  let paid = 0;
  for (const k of Object.keys(scoring)) {
    const v = stats[k];
    const w = scoring[k];
    if (!Number.isFinite(v) || !Number.isFinite(w)) continue;
    total += v * w;
    if (w !== 0 && v !== 0) paid++;
  }
  /* Nothing in the stat line matched anything the league pays for. That is a
   * feed whose column names have moved, not a player projected to score zero,
   * and the pre-totalled number is a better answer than a confident nought. */
  if (!paid) return pre;
  return Math.round(total * 100) / 100;
}

/**
 * The week's projections, keyed by player id.
 *
 * Written to survive the feed rather than to assume it: an array of rows, an
 * object keyed by player id, the stat line nested under `stats` or sitting at
 * the top level. Anything it cannot read is left out, and a player with no
 * projection is a player with no projection — never a zero, which on a
 * scoreboard is a claim that he will not score.
 */
export function readProjections(
  raw: unknown,
  scoring?: Record<string, number> | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  const kind = scoringKind(scoring);

  const rows: { id: string; row: Record<string, unknown> }[] = [];
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const row = r as Record<string, unknown>;
      const id = row.player_id ?? row.playerId ?? (row.player as { player_id?: unknown })?.player_id;
      if (id == null) continue;
      rows.push({ id: String(id), row });
    }
  } else {
    for (const [id, r] of Object.entries(raw as Record<string, unknown>)) {
      if (r && typeof r === 'object') rows.push({ id, row: r as Record<string, unknown> });
    }
  }

  for (const { id, row } of rows) {
    const nested = row.stats;
    const stats = (nested && typeof nested === 'object' ? nested : row) as Record<string, number>;
    const pts = scoreProjection(stats, scoring, kind);
    if (pts != null && Number.isFinite(pts)) out[id] = pts;
  }
  return out;
}

export interface SideProjection {
  /** Projected points for the starters that have one. */
  total: number;
  /** How many of them did. */
  counted: number;
  /** How many starters there are. */
  slots: number;
}

/**
 * What a lineup is projected to score.
 *
 * Reports what it could price as well as the total, for the same reason the
 * team projection does: a total over five of nine starters is not a smaller
 * number, it is a wrong one, and the scoreboard withholds it instead.
 */
export function projectSide(
  starters: string[] | null | undefined,
  proj: Record<string, number>,
): SideProjection | null {
  if (!starters || !starters.length) return null;
  let total = 0;
  let counted = 0;
  let slots = 0;
  for (const id of starters) {
    // Sleeper writes "0" for a slot nobody was put in. It is an empty slot, not
    // an unpriced one, so it counts against the lineup rather than against the
    // projection's coverage.
    slots++;
    if (!id || id === '0') { counted++; continue; }
    const p = proj[id];
    if (!Number.isFinite(p)) continue;
    total += p;
    counted++;
  }
  return { total: Math.round(total * 10) / 10, counted, slots };
}

/** Whether enough of a lineup is priced for its total to mean anything. */
export function sideProjectionIsSound(p: SideProjection | null): p is SideProjection {
  return !!p && p.slots > 0 && p.counted >= Math.ceil(p.slots * 0.7);
}
