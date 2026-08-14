import { describe, expect, it } from 'vitest';
import { ELIG, PRIME, STRATS } from '../model/constants';
import { ageCurve, ageCurveRedraft, grade, rankScore, talentBase } from '../model/math';
import { parseMarket } from '../model/market';
import { buildModel } from '../model/model';
import { ownedWeights, redraftWeights, scorePlayer } from '../model/score';
import { buildUsage, seasonUsage, type Usage } from '../model/usage';
import { makeBundle, makeFantasyCalc, makePlayers, makeStats, TEAMS } from './fixture';
import { nextDetailStack, topDetail } from '../state/detail-stack';

const bundle = makeBundle();
const market = parseMarket(makeFantasyCalc(bundle.players));
const usage = buildUsage(makeStats(bundle.players), bundle.players);
const model = buildModel({ data: bundle, usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0 });

describe('age curve', () => {
  it('is flat across the prime window, climbing before and falling after', () => {
    for (const pos of ['QB', 'RB', 'WR', 'TE'] as const) {
      const [start, end] = PRIME[pos];
      expect(ageCurve(pos, start)).toBe(1);
      expect(ageCurve(pos, end)).toBe(1);
      // a window, not a point: every age inside it is worth the same
      expect(ageCurve(pos, Math.round((start + end) / 2))).toBe(1);
      expect(ageCurve(pos, start - 3)).toBeLessThan(1);
      expect(ageCurve(pos, end + 3)).toBeLessThan(1);
    }
  });

  it('drops running backs faster than quarterbacks', () => {
    const rbLoss = 1 - ageCurve('RB', PRIME.RB[1] + 4);
    const qbLoss = 1 - ageCurve('QB', PRIME.QB[1] + 4);
    expect(rbLoss).toBeGreaterThan(qbLoss);
  });

  it('lets a star hold the window longer and decay slower', () => {
    const [, end] = PRIME.WR;
    // still at full value where a replacement-level player has already dropped
    expect(ageCurve('WR', end + 1, 1)).toBe(1);
    expect(ageCurve('WR', end + 1, 0)).toBeLessThan(1);
    expect(ageCurve('WR', end + 5, 1)).toBeGreaterThan(ageCurve('WR', end + 5, 0));
  });

  it('prices a redraft season as wear, not decline', () => {
    const old = PRIME.RB[1] + 4;
    // no climb before the window, and the fall is far gentler than dynasty's
    expect(ageCurveRedraft('RB', PRIME.RB[0] - 3)).toBe(1);
    expect(1 - ageCurveRedraft('RB', old)).toBeLessThan(1 - ageCurve('RB', old));
    expect(ageCurveRedraft('RB', 40)).toBeGreaterThanOrEqual(0.45);
  });

  it('falls back to a neutral value with no age', () => {
    expect(ageCurve('WR', null)).toBe(0.72);
    expect(ageCurveRedraft('WR', null)).toBe(0.8);
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

  it('softens the age term for redraft leagues', () => {
    const old = { position: 'RB', age: 31, years_exp: 9, search_rank: 60 };
    const redraft = scorePlayer(old, {}, { redraft: true }, w).m.age;
    const dynasty = scorePlayer(old, {}, { redraft: false }, w).m.age;
    expect(redraft).toBeGreaterThan(dynasty);
    expect(dynasty).toBeLessThan(0.5);
  });

  it('demands both floor and ceiling through the combo term', () => {
    const lopsided = Math.sqrt(0.9 * 0.1);
    const even = Math.sqrt(0.5 * 0.5);
    // averaging would tie these; the geometric mean does not
    expect(lopsided).toBeLessThan(even);
    const p = { position: 'WR', age: 25, years_exp: 3, search_rank: 40 };
    const { m } = scorePlayer(p, {}, { use: usageStub(0.8, 0.2) }, w);
    expect(m.combo).toBeCloseTo(Math.sqrt(m.floor * m.boom), 10);
  });

  it('charges injuries and depth-chart demotions against the floor', () => {
    const base = { position: 'RB', age: 25, years_exp: 3, search_rank: 40 };
    const healthy = scorePlayer(base, {}, {}, w).m.floor;
    const hurt = scorePlayer({ ...base, injury_status: 'Out' }, {}, {}, w).m.floor;
    const backup = scorePlayer({ ...base, depth_chart_order: 3 }, {}, {}, w).m.floor;
    expect(hurt).toBeLessThan(healthy);
    expect(backup).toBeLessThan(healthy);
    // talent is untouched — only the certainty of producing moves
    expect(scorePlayer({ ...base, injury_status: 'Out' }, {}, {}, w).m.talent)
      .toBe(scorePlayer(base, {}, {}, w).m.talent);
  });

  it('reshapes the weights for redraft without changing their sum', () => {
    const r = redraftWeights(w);
    const total = Object.values(r).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(r.age).toBeLessThan(w.age);     // the future stops being paid for
    expect(r.value).toBeGreaterThan(w.value); // reaching hurts more
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

function usageStub(snap: number, tgt: number): Usage {
  return {
    snap, tgt, vol: tgt, gp: 16,
    shareLabel: 'Target share', shareText: (tgt * 100).toFixed(1) + '%',
    eff: 8, effLabel: 'Yards per touch', ltr: 0.02, longTd: 2,
    xtd: 5, xtdPerGame: 0.31, tdLuck: 1,
    ppg: 12, rz: 10, rzShare: 0.1, rzPerGame: 0.6,
    td: 6, tdPerGame: 0.4, tdShare: 0.2, rank: 12,
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

describe('expected touchdowns', () => {
  // A feed built so that td = 0.20·(red-zone touches) + 0.02·(the rest), exactly.
  // If the least-squares fit is right it has to recover those two rates.
  const RZ_RATE = 0.20;
  const NZ_RATE = 0.02;
  const players: Record<string, { player_id: string; position: string; team: string; age: number }> = {};
  const stats: Record<string, Record<string, number>> = {};
  for (let i = 0; i < 40; i++) {
    const id = 'x' + i;
    players[id] = { player_id: id, position: 'RB', team: 'AAA', age: 25 };
    const rz = 5 + i;
    const nz = 40 + i * 4;
    stats[id] = {
      gp: 16, rush_att: rz + nz, rush_rz_att: rz,
      rush_td: RZ_RATE * rz + NZ_RATE * nz,
      rush_yd: (rz + nz) * 4.2, off_snp: 500, tm_off_snp: 1000,
    };
  }
  const built = seasonUsage(stats, players);

  it('recovers the rates that generated the data', () => {
    const id = 'x10';
    const st = stats[id];
    const expected = RZ_RATE * st.rush_rz_att + NZ_RATE * (st.rush_att - st.rush_rz_att);
    expect(built[id].xtd).toBeCloseTo(expected, 6);
  });

  it('separates luck from opportunity', () => {
    // same opportunities, but this one got hot and scored four extra
    const lucky = { ...stats, x10: { ...stats.x10, rush_td: stats.x10.rush_td + 4 } };
    const u = seasonUsage(lucky, players);
    expect(u.x10.tdLuck).toBeGreaterThan(3);
    // the expectation barely moves — it is built from chances, not results
    expect(u.x10.xtd).toBeCloseTo(built.x10.xtd!, 0);
  });

  it('publishes no number at all when the sample cannot support one', () => {
    const thin = { a: stats.x1, b: stats.x2 };
    const thinPlayers = { a: players.x1, b: players.x2 };
    expect(seasonUsage(thin, thinPlayers).a.xtd).toBeNull();
  });

  it('feeds the Fit through expected rather than scored touchdowns', () => {
    const w = STRATS.balanced.w;
    const p = { position: 'RB', age: 25, years_exp: 3, search_rank: 40 };
    const base = usageStub(0.8, 0.2);
    const hot = scorePlayer(p, {}, { use: { ...base, xtdPerGame: 0.2, tdPerGame: 0.9 } }, w);
    const cold = scorePlayer(p, {}, { use: { ...base, xtdPerGame: 0.2, tdPerGame: 0.1 } }, w);
    // scored TDs swing wildly between these two; the red-zone metric does not
    expect(hot.m.rz).toBeCloseTo(cold.m.rz, 10);
  });
});

describe('league fit and the top list', () => {
  it('scores every team today and two years out', () => {
    for (const row of model.leagueRows) {
      expect(row.fit).toBeGreaterThan(0);
      expect(row.fitFut).toBeGreaterThan(0);
    }
  });

  it('leaves fitFut at zero in redraft, where there is no future to price', () => {
    const redraft = buildModel({
      data: { ...bundle, league: { ...bundle.league, settings: { ...bundle.league.settings, type: 0 } } },
      usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
    });
    expect(redraft.leagueRows.every(r => r.fitFut === 0)).toBe(true);
  });

  it('scores every rostered player through three lenses', () => {
    const rostered = bundle.rosters.reduce((a, r) => a + (r.players || []).length, 0);
    expect(model.allFits.length).toBe(rostered);
    for (const x of model.allFits) {
      for (const v of [x.fit, x.fitMe, x.fit2]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
    expect(model.allFits.some(x => x.mine)).toBe(true);
  });

  it('ranks the neutral lens from best to worst', () => {
    const fits = model.allFits.map(x => x.fit);
    expect([...fits].sort((a, b) => b - a)).toEqual(fits);
  });

  it('indexes the whole catalog for search, lowercased once', () => {
    expect(model.searchIndex.length).toBeGreaterThan(100);
    const hit = model.searchIndex.find(e => e.name.includes('Rookie'));
    expect(hit!.lower).toBe(hit!.name.toLowerCase());
  });
});

describe('what talent buys at each position', () => {
  const keeps = (pos: 'QB' | 'RB' | 'WR' | 'TE', age: number, elite: number) =>
    ageCurve(pos, age + 2, elite) / Math.max(ageCurve(pos, age, elite), 0.05);

  it('does not let a star running back age like a star quarterback', () => {
    // A back's decline is a body absorbing 300 carries a year; ability does
    // not postpone it. A passer's decline is craft, and craft keeps.
    expect(keeps('RB', 29, 1)).toBeLessThan(keeps('QB', 29, 1));
    // and the gap is large, not a rounding difference
    expect(keeps('QB', 29, 1) - keeps('RB', 29, 1)).toBeGreaterThan(0.25);
  });

  it('still rewards the elite back, just far less than before', () => {
    const star = keeps('RB', 29, 1);
    const scrub = keeps('RB', 29, 0);
    expect(star).toBeGreaterThan(scrub);          // talent is worth something
    expect(star).toBeLessThan(0.7);               // but a 31-year-old back is not 80% of himself
  });

  it('leaves the flat bonus intact where it belongs', () => {
    // A quarterback is inside his prime window at 29 either way.
    expect(ageCurve('QB', 29, 1)).toBe(1);
    expect(ageCurve('QB', 29, 0)).toBe(1);
  });
});

describe('what a player is worth', () => {
  it('reports the market feed\'s own number, not the internal scaling', () => {
    const rows = makeFantasyCalc(bundle.players);
    const anyone = model.searchIndex.find(e => rows.some(r => r.player?.sleeperId === e.id))!;
    const feed = rows.find(r => r.player?.sleeperId === anyone.id)!;
    const v = model.marketValue(anyone.id)!;
    expect(v.real).toBe(true);
    expect(v.pts).toBe(feed.value);
  });

  it('ranks a price inside its own position, best first', () => {
    const ranked = model.searchIndex
      .map(e => ({ e, v: model.marketValue(e.id) }))
      .filter(x => x.v && x.v.pos === 'WR' && x.v.posRank)
      .sort((a, b) => a.v!.posRank! - b.v!.posRank!);
    expect(ranked.length).toBeGreaterThan(3);
    expect(ranked[0].v!.posRank).toBe(1);
    // a better rank never carries a lower price
    for (let i = 1; i < Math.min(ranked.length, 12); i++) {
      expect(ranked[i - 1].v!.pts).toBeGreaterThanOrEqual(ranked[i].v!.pts);
    }
  });

  it('falls back to the model and says so when the feed never loaded', () => {
    const blind = buildModel({
      data: bundle, usage, market: null, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
    });
    const id = blind.searchIndex[0].id;
    const v = blind.marketValue(id)!;
    expect(v.real).toBe(false);
    expect(v.pts).toBeGreaterThan(0);
  });

  it('returns nothing for an id that is not a skill-position player', () => {
    expect(model.marketValue('no-such-player')).toBe(null);
  });
});

describe('the search index knows what each screen may show', () => {
  it('flags rookies and everyone already on a roster', () => {
    const { rookies, vets } = makePlayers();
    const byId = Object.fromEntries(model.searchIndex.map(e => [e.id, e]));
    expect(rookies.every(id => !byId[id] || byId[id].rookie)).toBe(true);
    // veterans are dealt onto rosters by the fixture, so they read as taken
    expect(vets.filter(id => byId[id]?.taken).length).toBeGreaterThan(0);
  });

  it('leaves a rookie board with rookies only, and none of them owned', () => {
    const pool = model.searchIndex.filter(e => e.rookie && !e.taken);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every(e => e.rookie)).toBe(true);
    expect(model.scored.every(p => pool.some(e => e.id === p.id))).toBe(true);
  });
});

describe('what it would cost to get one specific player', () => {
  const theirs = model.leagueRows.find(r => !r.isMe)!;
  const target = model.teamInfo(theirs.id)!.list.sort((a, b) => b.q - a.q)[3];

  it('prices a real target out of your own assets', () => {
    const deals = model.offersFor(target.id);
    expect(deals.length).toBeGreaterThan(0);
    for (const t of deals) {
      expect(t.target.id).toBe(target.id);
      expect(t.give.length).toBeGreaterThan(0);
      // never proposes a package built out of thin air
      const mine = new Set([...model.myPlayers.map(p => p.id), ...model.pickAssets.map(p => p.id)]);
      expect(t.give.every(g => mine.has(g.id))).toBe(true);
      // and never one the other manager would laugh at
      expect(t.cost).toBeGreaterThanOrEqual(target.q * 0.9);
      expect(t.cost).toBeLessThanOrEqual(target.q * 1.25);
      // and never one that guts your own starting lineup to get him
      expect(t.myGain).toBeGreaterThan(-0.6);
      expect(t.accept).toBeGreaterThanOrEqual(5);
      expect(t.accept).toBeLessThanOrEqual(95);
    }
  });

  it('leads with the cheapest package, not the one easiest to get accepted', () => {
    const deals = model.offersFor(target.id);
    for (let i = 1; i < deals.length; i++) {
      expect(deals[i - 1].edge).toBeGreaterThanOrEqual(deals[i].edge);
    }
    // every one still has to be plausible, or cheap is just fantasy
    expect(deals.every(t => t.accept >= 45)).toBe(true);
  });

  it('never proposes handing over far more value than he is worth', () => {
    for (const row of model.leagueRows.filter(r => !r.isMe)) {
      for (const p of model.teamInfo(row.id)!.list) {
        for (const t of model.offersFor(p.id)) {
          expect(t.edge).toBeGreaterThan(-0.25);
        }
      }
    }
  });

  it('has nothing to say about your own players or a free agent', () => {
    expect(model.offersFor(model.myPlayers[0].id)).toEqual([]);
    const fa = model.searchIndex.find(e => !e.taken)!;
    expect(model.offersFor(fa.id)).toEqual([]);
  });
});
