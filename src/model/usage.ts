import type { PlayerCatalog, SleeperStatLine } from '../api/types';

export interface Usage {
  /** offensive snaps played / team offensive snaps */
  snap: number | null;
  /** target share for receivers, carry share for backs */
  tgt: number | null;
  gp: number;
  shareLabel: string;
  ppg: number | null;
  rz: number;
  rzShare: number | null;
  rzPerGame: number | null;
  td: number;
  tdPerGame: number | null;
  tdShare: number | null;
  rank: number | null;
}

export type UsageMap = Record<string, Usage>;

/**
 * Real usage, derived from Sleeper's own season stats rather than a third
 * party: same `player_id`, so nothing is matched by name and nothing mismatches.
 * nflverse publishes richer data but blocks cross-origin reads from a browser.
 */
export function buildUsage(stats: Record<string, SleeperStatLine>, players: PlayerCatalog): UsageMap {
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

  const usage: UsageMap = {};
  for (const id of Object.keys(stats)) {
    const pl = players[id];
    const st = stats[id] || {};
    if (!pl || !pl.team) continue;
    const gp = st.gp || 0;
    const snap = st.tm_off_snp ? (st.off_snp || 0) / st.tm_off_snp : null;
    const isRun = pl.position === 'RB';
    const share = isRun
      ? (teamRush[pl.team] ? (st.rush_att || 0) / teamRush[pl.team] : null)
      : (teamTgt[pl.team] ? (st.rec_tgt || 0) / teamTgt[pl.team] : null);
    if (snap == null && share == null && !gp) continue;

    const rzOwn = (st.rush_rz_att || 0) + (st.rec_rz_tgt || 0);
    const tdOwn = (st.rush_td || 0) + (st.rec_td || 0) + (st.pass_td || 0);
    usage[id] = {
      snap,
      tgt: share,
      gp,
      shareLabel: isRun ? 'Rush share' : 'Target share',
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
  if (!Object.keys(usage).length) throw new Error('empty');
  return usage;
}
