import type { FantasyCalcRow, SleeperLeague } from '../api/types';

/** Market values keyed the way the app consumes them. */
export interface Market {
  /** sleeperId → value/rank/30-day trend */
  players: Record<string, { value: number; rank?: number; posRank?: number; trend: number }>;
  /** "2027-1" → value of a generic first-rounder that year */
  picks: Record<string, number>;
  /** "2026-1-5" → value of that exact slot, which FantasyCalc publishes for the current draft */
  exact: Record<string, number>;
  max: number;
  count: number;
}

const ROUND_WORD: Record<string, number> = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };

/**
 * FantasyCalc derives dynasty values from millions of real manager trades and
 * ships them with `sleeperId`, so they join to a league with no name matching.
 *
 * Picks arrive in two shapes and both matter:
 *   "2026 Pick 1.05"  → this draft's exact slot
 *   "2027 1st"        → a future round, already year-discounted by the market
 */
export function parseMarket(rows: FantasyCalcRow[]): Market {
  const byId: Market['players'] = {};
  const rounds: Record<string, { plain: number | null; all: number[] }> = {};
  const exact: Record<string, number> = {};
  let max = 1;

  for (const r of rows) {
    const p = r.player || {};
    const val = r.value || 0;
    if (val > max) max = val;
    const isPick = p.position === 'PICK' || /^FP_/.test(p.sleeperId || '');

    if (isPick) {
      const nm = p.name || '';
      const slot = /^(\d{4})\s*Pick\s*(\d+)\.(\d+)/i.exec(nm);
      if (slot) {
        const key = slot[1] + '-' + Number(slot[2]);
        exact[key + '-' + Number(slot[3])] = val;
        rounds[key] = rounds[key] || { plain: null, all: [] };
        rounds[key].all.push(val);
        continue;
      }
      const m = /(\d{4}).*?(1st|2nd|3rd|4th)/i.exec(nm);
      if (!m) continue;
      const key = m[1] + '-' + ROUND_WORD[m[2].toLowerCase()];
      rounds[key] = rounds[key] || { plain: null, all: [] };
      rounds[key].all.push(val);
      // "2027 1st" is the round itself; "(Early)/(Mid)/(Late)" are its tiers.
      if (!/early|mid|late/i.test(nm)) rounds[key].plain = val;
    } else if (p.sleeperId) {
      byId[p.sleeperId] = {
        value: val, rank: r.overallRank, posRank: r.positionRank, trend: r.trend30Day || 0,
      };
    }
  }

  const picks: Record<string, number> = {};
  for (const k of Object.keys(rounds)) {
    const e = rounds[k];
    picks[k] = e.plain != null ? e.plain : e.all.reduce((a, b) => a + b, 0) / e.all.length;
  }

  return { players: byId, picks, exact, max, count: rows.length };
}

/** Values are format-sensitive, so we ask for this league's own shape. */
export function marketQuery(league: SleeperLeague): string {
  const rp = league.roster_positions || [];
  const qbs = rp.indexOf('SUPER_FLEX') >= 0 ? 2 : 1;
  const teams = league.total_rosters || 12;
  // `|| 1` here priced every standard-scoring league as full PPR, because a
  // league that gives nothing for a reception has `rec: 0` and `0 || 1` is 1.
  // That is the single biggest lever on what a receiver is worth.
  const rec = league.scoring_settings ? league.scoring_settings.rec : null;
  const ppr = typeof rec === 'number' ? Math.max(rec, 0) : 1;
  const dynasty = (league.settings || {}).type === 2;
  return `isDynasty=${dynasty ? 'true' : 'false'}&numQbs=${qbs}&numTeams=${teams}&ppr=${ppr}`;
}

export async function loadMarket(league: SleeperLeague): Promise<Market> {
  const res = await fetch('https://api.fantasycalc.com/values/current?' + marketQuery(league));
  if (!res.ok) throw new Error('http ' + res.status);
  const rows = (await res.json()) as FantasyCalcRow[];
  if (!Array.isArray(rows) || !rows.length) throw new Error('empty');
  return parseMarket(rows);
}
