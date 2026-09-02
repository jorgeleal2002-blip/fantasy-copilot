import type { PlayerCatalog, Pos, SleeperStatLine } from '../api/types';
import { PRIME, USAGE_WEIGHTS } from './constants';

export interface Usage {
  /** offensive snaps played / team offensive snaps */
  snap: number | null;
  /** target share for receivers, carry share for backs, null for QBs */
  tgt: number | null;
  /** what "volume" means for this position — a share, or attempts per game for a QB */
  vol: number | null;
  gp: number;
  shareLabel: string;
  /** the share already formatted, since its unit changes by position */
  shareText: string | null;
  /** the same share as one short phrase — "22% targets" — for a line with no
   *  room to put a label and a value in separate columns */
  shareShort: string | null;

  /** yards per ball actually in their hands */
  eff: number | null;
  effLabel: string;
  /** long touchdowns per non-red-zone opportunity */
  ltr: number | null;
  longTd: number | null;

  /** touchdowns the player's opportunities predict */
  xtd: number | null;
  xtdPerGame: number | null;
  /** scored minus expected — the part that was luck */
  tdLuck: number | null;

  ppg: number | null;
  rz: number;
  rzShare: number | null;
  rzPerGame: number | null;
  td: number;
  tdPerGame: number | null;
  tdShare: number | null;
  rank: number | null;

  /** filled in once the seasons are blended */
  seasons?: number;
  seasonList?: string;
  gpTotal?: number;
  fade?: number;
  effPct?: number;
  volPct?: number;
  ltrPct?: number;
}

export type UsageMap = Record<string, Usage>;

/** Metrics that are the player's own rate, so they can be averaged across
 *  seasons. Shares are deliberately excluded: they are computed against this
 *  season's offence and do not travel backwards. */
/**
 * Blended across seasons, weighted by recency.
 *
 * `tgt` and `vol` were missing from this, which did not show while the screens
 * printed the snap share: that one WAS blended, so the app's own banner —
 * "real usage connected (2025 · 2024 · 2023)" — was true of the number on the
 * page. A share taken from the most recent season alone under that banner is
 * not, and one bad or injured year would have swung it. They are the same
 * number as each other for everyone but a quarterback, so blending one without
 * the other would only have made them disagree.
 */
const BLEND: (keyof Usage)[] = [
  'snap', 'tgt', 'vol', 'eff', 'ltr', 'xtdPerGame', 'ppg', 'tdPerGame', 'rzPerGame',
];

/**
 * The share, written out. Its unit changes by position, so it is formatted
 * where the position is known — once, rather than at each of the four places
 * that show it, and again after blending, where the value it describes moves.
 */
function shareTexts(pos: string | undefined, share: number | null, vol: number | null) {
  const isQB = pos === 'QB';
  const isRun = pos === 'RB';
  return {
    shareLabel: isQB ? 'Attempts per game' : isRun ? 'Rush share' : 'Target share',
    /* Zero is not printed. A feed with no passing column and a quarterback who
     * genuinely never throws both arrive here as 0, and only one of them is
     * worth a line — "0 att/gm" beside a starter reads as a broken app, which
     * is what it was. Nothing to say is better said by saying nothing. */
    shareText: isQB
      ? (vol ? (vol as number).toFixed(1) : null)
      : (share ? ((share as number) * 100).toFixed(1) + '%' : null),
    shareShort: isQB
      ? (vol ? Math.round(vol as number) + ' att/gm' : null)
      : (share
        ? Math.round((share as number) * 100) + (isRun ? '% carries' : '% targets')
        : null),
  };
}

/**
 * Expected touchdowns, by least squares over real opportunities:
 *
 *   td ≈ b1·(red-zone touches) + b2·(touches outside it)
 *
 * The coefficients come out of the same feed being scored, so there is no
 * invented constant and no second source to reconcile by name. A position
 * whose sample is too small, or whose fitted rates come back negative or
 * absurd, simply gets no expected-TD number rather than a bad one.
 */
function fitTdRates(
  stats: Record<string, SleeperStatLine>,
  players: PlayerCatalog,
): Partial<Record<Pos, { rz: number; nz: number }>> {
  const rates: Partial<Record<Pos, { rz: number; nz: number }>> = {};

  for (const pos of ['RB', 'WR', 'TE'] as Pos[]) {
    let Sxx = 0, Syy = 0, Sxy = 0, Sxt = 0, Syt = 0, n = 0;
    for (const id of Object.keys(stats)) {
      const pl = players[id];
      const st = stats[id] || {};
      if (!pl || pl.position !== pos || !(st.gp && st.gp > 0)) continue;
      const rz = (st.rush_rz_att || 0) + (st.rec_rz_tgt || 0);
      const nz = Math.max((st.rush_att || 0) + (st.rec_tgt || 0) - rz, 0);
      if (rz + nz <= 0) continue;
      const td = (st.rush_td || 0) + (st.rec_td || 0);
      Sxx += rz * rz; Syy += nz * nz; Sxy += rz * nz; Sxt += rz * td; Syt += nz * td; n++;
    }
    const det = Sxx * Syy - Sxy * Sxy;
    if (n < 12 || Math.abs(det) < 1e-6) continue;
    const b1 = (Syy * Sxt - Sxy * Syt) / det;
    const b2 = (Sxx * Syt - Sxy * Sxt) / det;
    if (!(b1 > 0 && b1 < 1) || !(b2 >= 0 && b2 < 1)) continue;
    rates[pos] = { rz: b1, nz: b2 };
  }
  return rates;
}

/** One season's metrics. Everything joins by player_id — nothing is matched by name. */
export function seasonUsage(
  stats: Record<string, SleeperStatLine>,
  players: PlayerCatalog,
): UsageMap {
  const teamTgt: Record<string, number> = {};
  const teamRush: Record<string, number> = {};
  const teamRz: Record<string, number> = {};
  const teamTd: Record<string, number> = {};

  for (const id of Object.keys(stats)) {
    const pl = players[id];
    const st = stats[id] || {};
    if (!pl || !pl.team) continue;
    teamTgt[pl.team] = (teamTgt[pl.team] || 0) + (st.rec_tgt || 0);
    teamRush[pl.team] = (teamRush[pl.team] || 0) + (st.rush_att || 0);
    teamRz[pl.team] = (teamRz[pl.team] || 0) + (st.rush_rz_att || 0) + (st.rec_rz_tgt || 0);
    teamTd[pl.team] = (teamTd[pl.team] || 0) + (st.rush_td || 0) + (st.rec_td || 0);
  }

  const tdRates = fitTdRates(stats, players);
  // Does this feed carry receptions? If not every receiver is measured by
  // targets instead — a worse metric, but consistent inside the percentile,
  // which is the only thing it is used for.
  const hasRec = Object.keys(stats).some(id => {
    const r = stats[id] && stats[id].rec;
    return Number.isFinite(r) && (r as number) > 0;
  });

  const usage: UsageMap = {};
  for (const id of Object.keys(stats)) {
    const pl = players[id];
    const st = stats[id] || {};
    if (!pl || !pl.team) continue;
    const gp = st.gp || 0;
    const snap = st.tm_off_snp ? (st.off_snp || 0) / st.tm_off_snp : null;
    const isQB = pl.position === 'QB';
    const isRun = pl.position === 'RB';

    const share = isQB ? null : isRun
      ? (teamRush[pl.team] ? (st.rush_att || 0) / teamRush[pl.team] : null)
      : (teamTgt[pl.team] ? (st.rec_tgt || 0) / teamTgt[pl.team] : null);
    // A quarterback does not compete for targets but does have volume: pass
    // attempts plus carries per game. Leaving them with no measure at all gave
    // every starter a maximum floor (they all play ~100% of snaps) and
    // rewarded the efficient low-volume one. The percentile is taken within
    // the position, so the unit does not have to match.
    const vol = isQB ? (gp ? ((st.pass_att || 0) + (st.rush_att || 0)) / gp : null) : share;
    if (snap == null && share == null && !gp) continue;

    const rzOwn = (st.rush_rz_att || 0) + (st.rec_rz_tgt || 0);
    const nzOwn = Math.max((st.rush_att || 0) + (st.rec_tgt || 0) - rzOwn, 0);
    const tdOwn = (st.rush_td || 0) + (st.rec_td || 0) + (st.pass_td || 0);
    const scoredTd = (st.rush_td || 0) + (st.rec_td || 0);
    const rate = tdRates[pl.position as Pos];
    const xtd = rate && gp ? rate.rz * rzOwn + rate.nz * nzOwn : null;

    // Yards per ball IN THE HANDS, not per opportunity. Dividing by targets
    // would punish catch rate, which is the mark of the contested deep threat,
    // and reward the short-route receiver — the opposite of "explosive".
    const catches = hasRec ? (st.rec || 0) : (st.rec_tgt || 0);
    const opp = isQB ? (st.pass_att || 0) + (st.rush_att || 0)
      : isRun ? (st.rush_att || 0) + catches : catches;
    const yards = isQB ? (st.pass_yd || 0) + (st.rush_yd || 0)
      : isRun ? (st.rush_yd || 0) + (st.rec_yd || 0) : (st.rec_yd || 0);
    // Minimums are high on purpose: with a low threshold the specialist with a
    // handful of plays and an inflated average took the top and pushed the
    // real WR1s into the middle.
    const minOpp = isQB ? 200 : isRun ? 80 : (hasRec ? 40 : 60);
    const eff = opp >= minOpp ? yards / opp : null;

    // Long touchdowns: the ones scored ABOVE what their red-zone chances
    // predict. Those do not come from the 1-yard line — they come from
    // breaking a play. Red zone already bills the short ones, so they are not
    // counted twice here.
    const longTd = rate ? Math.max(scoredTd - rate.rz * rzOwn, 0) : null;
    const ltr = longTd != null && nzOwn >= (isRun ? 60 : 30) ? longTd / nzOwn : null;

    usage[id] = {
      snap, tgt: share, vol, gp,
      ...shareTexts(pl.position, share, vol),
      eff, effLabel: 'Yards per touch',
      ltr, longTd,
      xtd, xtdPerGame: xtd != null && gp ? xtd / gp : null,
      tdLuck: xtd != null ? scoredTd - xtd : null,
      ppg: gp ? (st.pts_half_ppr || 0) / gp : null,
      rz: rzOwn,
      rzShare: teamRz[pl.team] ? rzOwn / teamRz[pl.team] : null,
      rzPerGame: gp ? rzOwn / gp : null,
      td: tdOwn,
      tdPerGame: gp ? tdOwn / gp : null,
      tdShare: teamTd[pl.team] ? ((st.rush_td || 0) + (st.rec_td || 0)) / teamTd[pl.team] : null,
      rank: st.pos_rank_half_ppr || null,
    };
  }
  return usage;
}

/**
 * Three seasons, not one. A single season is a small sample: one injury, a new
 * coordinator or six strange weeks move any number. The most recent season
 * leads the blend and also owns anything that depends on today's role.
 */
export function blendSeasons(
  seasons: { year: number; usage: UsageMap }[],
  players: PlayerCatalog,
): UsageMap {
  if (!seasons.length) throw new Error('stats');
  const maps = seasons.map((s, i) => ({ ...s, w: USAGE_WEIGHTS[i] ?? 0.1, i }));
  const usage = maps[0].usage;

  for (const id of Object.keys(usage)) {
    const src = maps.filter(m => m.usage[id] && m.usage[id].gp >= 4);
    usage[id].seasons = src.length;
    usage[id].seasonList = src.map(m => m.year).join(', ');
    usage[id].gpTotal = src.reduce((a, m) => a + (m.usage[id].gp || 0), 0);
    if (src.length < 2) continue;

    // Averaging assumes the player is the same one they were three years ago,
    // and past their prime they are not: their 2023 props them up falsely. So
    // the further past the prime, the more the old seasons fade out.
    const pl = players[id];
    const end = (PRIME[pl?.position as Pos] ?? [24, 28])[1];
    const past = Math.max(0, (pl && pl.age ? pl.age : 25) - end);
    const fade = Math.max(1 - past * 0.18, 0.15);
    usage[id].fade = fade;

    for (const k of BLEND) {
      let sw = 0, sv = 0;
      for (const m of src) {
        const v = m.usage[id][k] as number | null | undefined;
        const w = m.w * Math.pow(fade, m.i);
        if (Number.isFinite(v)) { sv += (v as number) * w; sw += w; }
      }
      // weights renormalised over whatever was actually available
      if (sw > 0) (usage[id] as unknown as Record<string, number>)[k as string] = sv / sw;
    }
    // The formatted forms were written from ONE season's numbers. They describe
    // a value that has just moved, so they are written again from the blend.
    Object.assign(usage[id], shareTexts(pl?.position, usage[id].tgt, usage[id].vol));
  }

  // Percentiles AFTER blending, so a player is ranked against a three-year
  // distribution rather than one year's. A percentile also avoids any constant
  // that would saturate.
  for (const pos of ['QB', 'RB', 'WR', 'TE'] as Pos[]) {
    const ok = Object.keys(usage).filter(id => {
      const pl = players[id];
      return pl && pl.position === pos && (usage[id].gpTotal || usage[id].gp || 0) >= 8;
    });
    for (const [src, dst] of [['eff', 'effPct'], ['vol', 'volPct'], ['ltr', 'ltrPct']] as const) {
      const vals = ok
        .filter(id => Number.isFinite(usage[id][src] as number))
        .sort((a, b) => (usage[a][src] as number) - (usage[b][src] as number));
      if (vals.length < 8) continue;
      vals.forEach((id, i) => { usage[id][dst] = i / (vals.length - 1); });
    }
  }

  if (!Object.keys(usage).length) throw new Error('empty');
  return usage;
}

/** Kept for the single-season path the tests and older callers use. */
export function buildUsage(
  stats: Record<string, SleeperStatLine>,
  players: PlayerCatalog,
): UsageMap {
  return blendSeasons([{ year: 0, usage: seasonUsage(stats, players) }], players);
}
