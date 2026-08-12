import { describe, expect, it } from 'vitest';
import { ELIG, PEAK, STRATS } from '../model/constants';
import { ageCurve, grade, rankScore, talentBase } from '../model/math';
import { parseMarket } from '../model/market';
import { buildModel } from '../model/model';
import { ownedWeights, scorePlayer } from '../model/score';
import { buildUsage } from '../model/usage';
import { makeBundle, makeFantasyCalc, makePlayers, makeStats, TEAMS } from './fixture';
import { nextDetailStack, topDetail } from '../state/detail-stack';

const bundle = makeBundle();
const market = parseMarket(makeFantasyCalc(bundle.players));
const usage = buildUsage(makeStats(bundle.players), bundle.players);
const model = buildModel({ data: bundle, usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0 });

describe('age curve', () => {
  it('peaks at the position peak and decays afterwards', () => {
    for (const pos of ['QB', 'RB', 'WR', 'TE'] as const) {
      const peak = PEAK[pos];
      expect(ageCurve(pos, peak)).toBeGreaterThan(ageCurve(pos, peak + 3));
      expect(ageCurve(pos, peak)).toBeGreaterThanOrEqual(ageCurve(pos, peak - 4));
    }
  });

  it('drops running backs faster than quarterbacks', () => {
    const rbLoss = ageCurve('RB', PEAK.RB) - ageCurve('RB', PEAK.RB + 4);
    const qbLoss = ageCurve('QB', PEAK.QB) - ageCurve('QB', PEAK.QB + 4);
    expect(rbLoss).toBeGreaterThan(qbLoss);
  });

  it('falls back to a neutral value with no age', () => {
    expect(ageCurve('WR', null)).toBe(0.72);
  });
});

describe('value helpers', () => {
  it('rankScore and talentBase both fall monotonically with rank', () => {
    expect(rankScore(1)).toBeGreaterThan(rankScore(50));
    expect(rankScore(50)).toBeGreaterThan(rankScore(300));
    expect(talentBase(1)).toBeGreaterThan(talentBase(62));
    // The exponential is what stops an ADP-162 outscoring a top-62.
    expect(talentBase(62) / talentBase(162)).toBeGreaterThan(3);
  });

  it('grades span A+ to D', () => {
    expect(grade(0.85)).toBe('A+');
    expect(grade(0.6)).toBe('B');
    expect(grade(0.1)).toBe('D');
  });
});

describe('fit score', () => {
  const w = STRATS.balanced.w;

  it('stays within 0..100 and equals the weighted sum of its metrics', () => {
    const p = { position: 'WR', age: 24, years_exp: 2, search_rank: 30 };
    const { m, fit } = scorePlayer(p, { WR: 0.8 }, { idx: 10, pick: 45, dv: 50, dvMax: 100 }, w);
    const manual = Math.round(
      (Object.keys(w) as (keyof typeof w)[]).reduce((a, k) => a + w[k] * m[k], 0) * 100,
    );
    expect(fit).toBe(manual);
    expect(fit).toBeGreaterThanOrEqual(0);
    expect(fit).toBeLessThanOrEqual(100);
  });

  it('lets real snap share dominate the floor proxy', () => {
    const p = { position: 'RB', age: 25, years_exp: 4, search_rank: 120 };
    const low = scorePlayer(p, {}, { use: usageStub(0.15, 0.05) }, w);
    const high = scorePlayer(p, {}, { use: usageStub(0.92, 0.05) }, w);
    expect(high.m.floor).toBeGreaterThan(low.m.floor + 0.4);
  });

  it('switches the age curve off for redraft leagues', () => {
    const old = { position: 'RB', age: 31, years_exp: 9, search_rank: 60 };
    expect(scorePlayer(old, {}, { redraft: true }, w).m.age).toBe(0.8);
    expect(scorePlayer(old, {}, { redraft: false }, w).m.age).toBeLessThan(0.5);
  });

  it('renormalises weights for players you already own', () => {
    const own = ownedWeights(w);
    expect(own.need).toBe(0);
    const total = Object.values(own).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('market parsing', () => {
  it('reads this draft\'s exact slots, generic future rounds and players', () => {
    expect(market.exact['2026-1-5']).toBeGreaterThan(0);
    expect(market.exact['2026-1-1']).toBeGreaterThan(market.exact['2026-1-5']);
    expect(market.picks['2027-1']).toBeGreaterThan(market.picks['2027-2']);
    expect(Object.keys(market.players).length).toBeGreaterThan(50);
  });

  it('prefers the untiered round value over the Early/Mid/Late average', () => {
    const rows = [
      { value: 1000, player: { sleeperId: 'FP_2029_1', name: '2029 1st', position: 'PICK' } },
      { value: 4000, player: { sleeperId: 'FP_2029_1E', name: '2029 1st (Early)', position: 'PICK' } },
    ];
    expect(parseMarket(rows).picks['2029-1']).toBe(1000);
  });
});

describe('usage', () => {
  it('computes snap share out of team snaps and keeps it in range', () => {
    const values = Object.values(usage);
    expect(values.length).toBeGreaterThan(50);
    for (const u of values) {
      if (u.snap != null) expect(u.snap).toBeGreaterThan(0);
      if (u.snap != null) expect(u.snap).toBeLessThanOrEqual(1);
    }
  });

  it('labels backs by rush share and receivers by target share', () => {
    const rbId = Object.keys(bundle.players).find(id => bundle.players[id].position === 'RB' && usage[id]);
    const wrId = Object.keys(bundle.players).find(id => bundle.players[id].position === 'WR' && usage[id]);
    expect(usage[rbId!].shareLabel).toBe('Rush share');
    expect(usage[wrId!].shareLabel).toBe('Target share');
  });
});

describe('optimal lineup', () => {
  it('fills every slot the format defines, with an eligible player each', () => {
    const slots = (bundle.league.roster_positions || []).filter(x => ELIG[x]);
    expect(model.optimal).toHaveLength(slots.length);
    for (const o of model.optimal) {
      expect(o.player).toBeTruthy();
      expect(ELIG[o.slot]).toContain(o.player!.pos);
    }
  });

  it('never starts the same player twice', () => {
    const ids = model.optimal.map(o => o.player!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is at least as strong as the lineup currently set in Sleeper', () => {
    const optimalQ = model.optimal.reduce((a, o) => a + (o.player?.q || 0), 0);
    const currentQ = (bundle.rosters[0].starters || [])
      .map(id => model.myPlayers.find(p => p.id === id))
      .reduce((a, p) => a + (p?.q || 0), 0);
    expect(optimalQ).toBeGreaterThanOrEqual(currentQ);
  });

  it('splits roster quality into starters and bench without losing any', () => {
    expect(model.starterQ + model.benchQ).toBeCloseTo(model.totalQ, 6);
  });
});

describe('pick capital', () => {
  it('gives me my own slot-5 picks plus the one acquired from Konoha (slot 1)', () => {
    const mine2026 = model.pickAssets.filter(p => p.season === 2026).map(p => p.label).sort();
    expect(mine2026).toEqual(['Pick 1.05', 'Pick 2.01', 'Pick 2.05', 'Pick 3.05']);
  });

  it('marks an acquired pick with where it came from', () => {
    const acquired = model.pickAssets.find(p => p.label === 'Pick 2.01');
    expect(acquired!.origin).toContain('Konoha');
    // My own picks say so instead of naming a seller.
    expect(model.pickAssets.find(p => p.label === 'Pick 1.05')!.origin).toContain('Your own pick');
  });

  it('prices the current draft off the exact market slot, not a flat table', () => {
    const p105 = model.pickAssets.find(p => p.label === 'Pick 1.05')!;
    expect(p105.q * 100).toBeCloseTo(market.exact['2026-1-5'], 6);
  });

  it('drops picks that have already been used', () => {
    const drafted = buildModel({
      data: { ...bundle, picks: Array.from({ length: 45 }, (_, i) => ({ player_id: 'x', round: 1, pick_no: i + 1 })) },
      usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
    });
    expect(drafted.pickAssets.some(p => p.season === 2026 && p.round === 1)).toBe(false);
  });
});

describe('draft board', () => {
  it('shows only rookies in rookie mode, and nobody already rostered', () => {
    const owned = new Set(bundle.rosters.flatMap(r => r.players || []));
    for (const p of model.scored) {
      expect(bundle.players[p.id].years_exp).toBe(0);
      expect(owned.has(p.id)).toBe(false);
    }
  });

  it('lists free agents instead when the board switches modes', () => {
    const fa = buildModel({ data: bundle, usage, market, strat: 'balanced', boardMode: 'fa', pickSel: 0 });
    expect(fa.scored.some(p => (bundle.players[p.id].years_exp || 0) > 0)).toBe(true);
  });

  it('is sorted by fit, best first', () => {
    const fits = model.scored.map(p => p.fit);
    expect([...fits].sort((a, b) => b - a)).toEqual(fits);
  });

  it('reorders when the strategy changes the weights', () => {
    const upside = buildModel({ data: bundle, usage, market, strat: 'upside', boardMode: 'rookies', pickSel: 0 });
    const before = model.scored.map(p => p.id).join();
    const after = upside.scored.map(p => p.id).join();
    expect(after).not.toBe(before);
  });
});

describe('trade engine', () => {
  it('never offers a player from my optimal lineup', () => {
    for (const o of model.offers) {
      expect(model.optIds).not.toContain(o.give.id);
    }
  });

  it('only proposes deals where I actually gain', () => {
    for (const o of model.offers) {
      expect(o.gain).toBeGreaterThan(0);
    }
  });

  it('keeps both sides inside a plausible value band', () => {
    for (const o of model.offers) {
      // Neither a robbery nor a giveaway: the guardrails cap both directions.
      expect(o.edge).toBeGreaterThan(-0.21);
      expect(o.edge).toBeLessThan(0.19);
    }
  });

  it('never asks a manager to sell their own weakest position', () => {
    for (const o of model.offers) {
      if (o.prof.worst) expect(o.get.pos).not.toBe(o.prof.worst);
    }
  });

  it('only sends picks to a rebuilding team', () => {
    for (const o of model.offers) {
      if (o.give.isPick) expect(o.prof.window).toBe('rebuild');
    }
  });

  it('produces a spread of fit scores rather than everything at the ceiling', () => {
    if (model.offers.length > 2) {
      const fits = model.offers.map(o => o.fit);
      expect(Math.max(...fits) - Math.min(...fits)).toBeGreaterThan(0);
      expect(Math.max(...fits)).toBeLessThanOrEqual(93);
    }
  });
});

describe('league ranking', () => {
  it('ranks every team once, today and in the future', () => {
    expect(model.leagueRows).toHaveLength(TEAMS);
    expect(new Set(model.leagueRows.map(r => r.rankNow)).size).toBe(TEAMS);
    expect(new Set(model.leagueRows.map(r => r.rankFut)).size).toBe(TEAMS);
  });

  it('agrees with the shared positional ranking used across the app', () => {
    const me = model.leagueRows.find(r => r.isMe)!;
    for (const pos of ['QB', 'RB', 'WR', 'TE'] as const) {
      const rank = model.posRankOf(me.id, pos);
      expect(rank).toBeGreaterThanOrEqual(1);
      expect(rank).toBeLessThanOrEqual(TEAMS);
      expect(model.posRank[pos]).toBe(rank);
    }
  });

  it('reads a team sheet for every roster', () => {
    for (const row of model.leagueRows) {
      const sheet = model.teamInfo(row.id);
      expect(sheet).toBeTruthy();
      expect(sheet!.list.length).toBeGreaterThan(0);
    }
  });
});

describe('redraft leagues drop everything about the future', () => {
  const redraft = buildModel({
    data: { ...bundle, league: { ...bundle.league, settings: { ...bundle.league.settings, type: 0 } } },
    usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
  });

  it('has no pick capital and no rookie-only board', () => {
    expect(redraft.isDynasty).toBe(false);
    expect(redraft.pickAssets).toHaveLength(0);
    expect(redraft.bestDeals).toHaveLength(0);
    expect(redraft.scored.some(p => (bundle.players[p.id].years_exp || 0) > 0)).toBe(true);
  });
});

describe('an empty league still renders', () => {
  it('survives rosters with no players at all', () => {
    const empty = buildModel({
      data: { ...bundle, rosters: bundle.rosters.map(r => ({ ...r, players: [], starters: [] })) },
      usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
    });
    expect(empty.myPlayers).toHaveLength(0);
    expect(empty.leagueHasRosters).toBe(false);
    expect(empty.offers).toHaveLength(0);
    expect(() => empty.teamInfo(1)).not.toThrow();
  });
});

describe('the catalog itself', () => {
  it('generates rookies with zero experience and veterans with more', () => {
    const { players, rookies, vets } = makePlayers();
    expect(rookies.every(id => players[id].years_exp === 0)).toBe(true);
    expect(vets.every(id => (players[id].years_exp || 0) > 0)).toBe(true);
  });
});

function usageStub(snap: number, tgt: number) {
  return {
    snap, tgt, gp: 16, shareLabel: 'Target share', ppg: 12,
    rz: 10, rzShare: 0.1, rzPerGame: 0.6, td: 6, tdPerGame: 0.4, tdShare: 0.2, rank: 12,
  };
}

describe('sheet navigation stack', () => {
  it('steps back to the team a player was opened from', () => {
    let s = nextDetailStack([], 'team-5');
    s = nextDetailStack(s, 'jaxon');
    expect(topDetail(s)).toBe('jaxon');

    s = nextDetailStack(s, null);
    expect(topDetail(s)).toBe('team-5');

    s = nextDetailStack(s, null);
    expect(topDetail(s)).toBe(null);
  });

  it('leaves a sheet opened straight from a tab in one step', () => {
    const s = nextDetailStack(nextDetailStack([], 'caleb'), null);
    expect(topDetail(s)).toBe(null);
  });

  it('ignores re-opening whatever is already on top', () => {
    const s = nextDetailStack(nextDetailStack([], 'caleb'), 'caleb');
    expect(s).toHaveLength(1);
  });

  it('stays empty when stepping back with nothing open', () => {
    expect(nextDetailStack([], null)).toEqual([]);
  });
});
