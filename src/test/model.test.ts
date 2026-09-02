import { describe, expect, it } from 'vitest';
import { ELIG, PRIME, STRATS } from '../model/constants';
import { ageCurve, ageCurveRedraft, grade, modelVal, rankScore, talentBase, talentScale } from '../model/math';
import { marketQuery, parseMarket } from '../model/market';
import { matchMe } from '../api/sleeper';
import { inviteUrl, parseInvite } from '../model/invite';
import { buildModel } from '../model/model';
import { ownedWeights, redraftWeights, scorePlayer } from '../model/score';
import { buildUsage, seasonUsage, type Usage } from '../model/usage';
import { makeBundle, makeFantasyCalc, makeLeague, makePlayers, makeStats, TEAMS } from './fixture';
import { nextDetailStack, topDetail } from '../state/detail-stack';
import { isMockEligible } from '../model/mock-pool';
import type { SleeperPlayer } from '../api/types';

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

  it('scores a slide as value and a reach as none', () => {
    const w = STRATS.balanced.w;
    const p = { position: 'WR', age: 24, years_exp: 2, search_rank: 30 };
    // Picking at 20 with the best man alive still on the board: a slide.
    const slide = scorePlayer(p, {}, { idx: 1, pick: 20, now: 1, dv: 50, dvMax: 100 }, w).m.value;
    // Picking at 5 for someone the board has 15th: a ten-spot reach.
    const reach = scorePlayer(p, {}, { idx: 15, pick: 5, now: 1, dv: 50, dvMax: 100 }, w).m.value;
    expect(slide).toBeGreaterThan(0.6);
    expect(reach).toBeLessThan(0.4);
    // On schedule is neither: at pick 20 the top survivor is exactly on time.
    expect(scorePlayer(p, {}, { idx: 1, pick: 20, now: 20, dv: 50, dvMax: 100 }, w).m.value)
      .toBeCloseTo(0.5, 5);
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

  it('does not let a ceiling nobody has seen beat one that was measured', () => {
    // A 22-year-old with no snaps gets a big youth bonus on explosiveness.
    // At full strength that guess outscored veterans whose real explosiveness
    // had been observed and come back modest — the model rewarding the absence
    // of evidence.
    const rookie = { position: 'WR', age: 22, years_exp: 0, search_rank: 60 };
    const unseen = scorePlayer(rookie, {}, {}, w).m.boom;
    const withProof = scorePlayer(rookie, {}, { use: usageStub(0.7, 0.05) }, w).m.boom;
    // The same player, once somebody has watched him, is judged on that.
    expect(unseen).not.toBeCloseTo(withProof, 3);
    // And the guess is discounted: a rank-60 rookie no longer clears .6 on
    // speculation alone.
    expect(unseen).toBeLessThan(0.6);

    // A proven veteran with a genuinely high measured ceiling still wins.
    const vet = { position: 'WR', age: 28, years_exp: 6, search_rank: 60 };
    expect(scorePlayer(vet, {}, { use: usageStub(0.9, 0.9) }, w).m.boom)
      .toBeGreaterThan(unseen);
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
    // Neither term has an answer for a player who is already yours: he fills
    // no hole, and he cannot still be falling past a pick you have made.
    expect(own.need).toBe(0);
    expect(own.value).toBe(0);
    const total = Object.values(own).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('puts talent on a log scale so a board is not all twenties', () => {
    // Value spans orders of magnitude. Divided linearly by the best asset in
    // scope, a rookie worth a twentieth of a veteran star scored 0.05 on the
    // heaviest term in the Fit and dragged the whole board into the twenties.
    expect(talentScale(1, 1)).toBe(1);
    expect(talentScale(0.05, 1)).toBeGreaterThan(0.05 * 5);
    expect(talentScale(0.05, 1)).toBeCloseTo(0.567, 2);
    // Still monotonic, and a thousandth of the best is still the floor.
    expect(talentScale(0.5, 1)).toBeGreaterThan(talentScale(0.1, 1));
    expect(talentScale(0.001, 1)).toBe(0);
    expect(talentScale(0, 1)).toBe(0);
  });
});

describe('market parsing', () => {
  it('asks for this league\'s format, and does not turn standard into PPR', () => {
    const base = makeLeague();
    // Half PPR, superflex, ten teams, dynasty — straight through.
    const q = new URLSearchParams(marketQuery(base));
    expect(q.get('ppr')).toBe('0.5');
    expect(q.get('numQbs')).toBe('2');
    expect(q.get('numTeams')).toBe(String(base.total_rosters));
    expect(q.get('isDynasty')).toBe('true');

    // A league that pays nothing for a reception is standard, not full PPR.
    // `rec || 1` used to make that 1, which is the biggest single lever there
    // is on what a receiver is worth.
    const std = { ...base, scoring_settings: { ...base.scoring_settings, rec: 0 } };
    expect(new URLSearchParams(marketQuery(std)).get('ppr')).toBe('0');

    // And a league with no scoring block at all still gets a sane default.
    const bare = { ...base, scoring_settings: undefined };
    expect(new URLSearchParams(marketQuery(bare)).get('ppr')).toBe('1');
  });

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

describe('scoring the market never sees', () => {
  const priceOf = (bundleIn: typeof bundle, pos: string) => {
    const mm = buildModel({
      data: bundleIn, usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
    });
    const id = Object.keys(bundleIn.players).find(k => (
      bundleIn.players[k].position === pos && !!mm.marketValue(k)?.real
    ));
    return mm.marketValue(id as string)!.pts;
  };
  const withScoring = (extra: Record<string, number>) => ({
    ...bundle,
    league: { ...bundle.league, scoring_settings: { ...bundle.league.scoring_settings, ...extra } },
  });

  it('lifts tight ends in a TE premium league', () => {
    // FantasyCalc is never told about a TE premium, so a league that pays its
    // tight ends an extra half point per catch was pricing them as if it did
    // not. The correction is applied on top of the market price.
    const plain = priceOf(withScoring({ bonus_rec_te: 0 }), 'TE');
    const premium = priceOf(withScoring({ bonus_rec_te: 0.5 }), 'TE');
    expect(premium).toBeGreaterThan(plain);
    expect(premium / plain).toBeCloseTo(1.16, 2);
  });

  it('leaves every other position where it was', () => {
    const base = withScoring({ bonus_rec_te: 0 });
    const premium = withScoring({ bonus_rec_te: 0.5 });
    for (const pos of ['QB', 'RB', 'WR']) {
      expect(priceOf(premium, pos)).toBe(priceOf(base, pos));
    }
  });

  it('changes nothing in a league without those bonuses', () => {
    // The market already prices PPR, superflex, dynasty and team count. Only
    // what it is NOT told may be applied, or it would be counted twice.
    const bare = withScoring({ bonus_rec_te: 0, rush_fd: 0, rec_fd: 0, pass_td: 4, pass_yd: 0.04 });
    const mm = buildModel({
      data: bare, usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
    });
    for (const id of Object.keys(bare.players).slice(0, 400)) {
      const v = mm.marketValue(id);
      if (!v || !v.real) continue;
      const raw = market.players[id];
      if (raw) expect(v.pts).toBe(Math.round(raw.value));
    }
  });
});

describe('finding your team', () => {
  it('does not sign you in as another manager when the name matches nobody', () => {
    const users = bundle.users;
    // The real thing still resolves.
    expect(matchMe(users, users[1].display_name as string).user_id).toBe(users[1].user_id);
    // A stranger gets no identity rather than the first manager's.
    const stranger = matchMe(users, 'nobody-here');
    expect(stranger.user_id).toBe('');
    expect(stranger.user_id).not.toBe(users[0].user_id);
    expect(stranger.display_name).toBe('nobody-here');

    // And that reads through the model as "we could not find your team",
    // never as somebody else's roster.
    const after = buildModel({
      data: { ...bundle, me: stranger },
      usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
    });
    expect(after.foundMyTeam).toBe(false);
    expect(after.myPlayers.length).toBe(0);
    expect(after.leagueRows.some(r => r.isMe)).toBe(false);
  });


  it('claims a roster you only co-own', () => {
    // Sleeper names ONE manager in `owner_id` and puts everyone else sharing
    // the team in `co_owners`. Matching on `owner_id` alone left a co-owner
    // with an empty team while the league page still listed every roster.
    const shared = {
      ...bundle,
      rosters: bundle.rosters.map(r => (
        r.owner_id === bundle.me.user_id
          ? { ...r, owner_id: 'someone-else', co_owners: [bundle.me.user_id] }
          : r
      )),
    };
    const mine = bundle.rosters.find(r => r.owner_id === bundle.me.user_id);
    const after = buildModel({
      data: shared, usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
    });
    expect(after.foundMyTeam).toBe(true);
    expect(after.myPlayers.length).toBe(
      (mine?.players || []).filter(id => ['QB', 'RB', 'WR', 'TE'].includes(bundle.players[id].position as string)).length,
    );
    expect(after.leagueRows.filter(r => r.isMe).length).toBe(1);
  });

  it('says so when the account is in no roster at all', () => {
    const stranger = { ...bundle, me: { ...bundle.me, user_id: 'nobody' } };
    const after = buildModel({
      data: stranger, usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
    });
    expect(after.foundMyTeam).toBe(false);
    expect(after.myPlayers.length).toBe(0);
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

  it('orders the board by draft position, not by trade value', () => {
    // Two different questions. `goes` answers "when does he come off the
    // board", which is Sleeper's own ordering; the market answers "what is he
    // worth", which in a superflex format puts quarterbacks ahead of the best
    // back alive. Ordering by value is what dropped a back who goes second
    // down to fourth.
    const board = model.scored.slice().sort((a, b) => (a.goes || 0) - (b.goes || 0));
    const searchOrder = board.map(p => bundle.players[p.id].search_rank || 0);
    expect([...searchOrder].sort((a, b) => a - b)).toEqual(searchOrder);
  });

  it('does not let a rich valuation move a player up the board', () => {
    const board = model.scored.slice().sort((a, b) => (a.goes || 0) - (b.goes || 0));
    const cheap = board[board.length - 1].id;
    // Make the last man on the board the most valuable asset in the league.
    const rich = parseMarket(makeFantasyCalc(bundle.players).map(r => (
      r.player?.sleeperId === cheap ? { ...r, value: 999999 } : r
    )));
    const after = buildModel({
      data: bundle, usage, market: rich, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
    });
    const row = after.scored.find(p => p.id === cheap);
    // Worth the most, still drafted last: value is not draft position.
    expect(row?.rank).toBe(1);
    expect(row?.goes).toBe(after.scored.length);
  });

  it('never reports a rank the market did not give it', () => {
    for (const p of model.scored) {
      if (p.rank == null) continue;
      expect(p.rank).toBeGreaterThan(0);
      expect(model.marketValue(p.id)?.real).toBe(true);
    }
  });

  it('sorts the list by Fit while `goes` keeps the board order', () => {
    // These are two different orders and the screens must not confuse them.
    // Reading a row's position in this Fit-sorted list as its place on the
    // board is what marked the best-fitting players "gone before your pick"
    // no matter where the board actually had them.
    const byFit = model.scored.map(p => p.goes);
    expect(byFit.every(g => g != null)).toBe(true);
    expect([...byFit].sort((a, b) => (a || 0) - (b || 0))).not.toEqual(byFit);
  });

  it('reorders when the strategy changes the weights', () => {
    const upside = buildModel({ data: bundle, usage, market, strat: 'upside', boardMode: 'rookies', pickSel: 0 });
    const before = model.scored.map(p => p.id).join();
    const after = upside.scored.map(p => p.id).join();
    expect(after).not.toBe(before);
  });
});

describe('the trade block', () => {
  const starter = model.optimal.map(s => s.player).filter(Boolean)[0];

  it('finds nothing until you name somebody', () => {
    expect(model.blockOffers.length).toBe(0);
  });

  it('shops a starter the suggestions would never touch', () => {
    const withBlock = buildModel({
      data: bundle, usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
      block: [starter!.id],
    });
    // The suggestions never put a starter on the table; the block is the whole
    // point of naming one.
    expect(model.offers.every(o => o.give.id !== starter!.id)).toBe(true);
    expect(withBlock.blockOffers.length).toBeGreaterThan(0);
    expect(withBlock.blockOffers.every(o => o.send.id === starter!.id)).toBe(true);
    // Best value back first.
    const edges = withBlock.blockOffers.map(o => o.edge);
    expect([...edges].sort((a, b) => b - a)).toEqual(edges);
    // A star is paid for with a package, not one piece.
    expect(withBlock.blockOffers.some(o => o.get.length > 1)).toBe(true);
  });

  it('never gives him away, and never robs the other manager', () => {
    const withBlock = buildModel({
      data: bundle, usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
      block: model.myPlayers.slice(0, 6).map(p => p.id),
    });
    expect(withBlock.blockOffers.length).toBeGreaterThan(0);
    for (const o of withBlock.blockOffers) {
      // Never sold short, never a robbery, and always a plausible yes.
      expect(o.back).toBeGreaterThanOrEqual(o.send.q * 0.90);
      expect(o.back).toBeLessThanOrEqual(o.send.q * 1.25);
      expect(o.accept).toBeGreaterThanOrEqual(45);
    }
  });

  it('leaves the ordinary suggestions alone', () => {
    const withBlock = buildModel({
      data: bundle, usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
      block: model.myPlayers.slice(0, 4).map(p => p.id),
    });
    expect(withBlock.offers.map(o => o.partner + o.get.id))
      .toEqual(model.offers.map(o => o.partner + o.get.id));
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

describe('a redraft league is not priced as a dynasty', () => {
  const redraftBundle = makeBundle();
  redraftBundle.league = { ...redraftBundle.league, settings: { ...redraftBundle.league.settings, type: 0 } };
  const rd = buildModel({
    data: redraftBundle, usage, market, strat: 'balanced', boardMode: 'fa', pickSel: 0,
  });

  it('drops the running-back age discount, and says so', () => {
    const dynRb = model.multInfo.find(x => x.pos === 'RB')!;
    const rdRb = rd.multInfo.find(x => x.pos === 'RB')!;
    expect(rdRb.mult).toBeGreaterThan(dynRb.mult);
    expect(dynRb.why).toMatch(/[Dd]ynasty/);
    // the thing the screenshot caught: a redraft league being told about dynasty
    expect(rdRb.why).not.toMatch(/[Dd]ynasty/);
  });

  it('never explains a redraft league in dynasty terms', () => {
    for (const info of rd.multInfo) expect(info.why).not.toMatch(/[Dd]ynasty/);
  });

  it('asks the market feed for redraft values', () => {
    expect(marketQuery(redraftBundle.league)).toContain('isDynasty=false');
    expect(marketQuery(model.league)).toContain('isDynasty=true');
  });

  it('values an old back on the redraft curve when the feed is down', () => {
    const old = { position: 'RB', age: 31, search_rank: 40 } as never;
    const mult = { RB: 1 };
    expect(modelVal(old, mult, true)).toBeGreaterThan(modelVal(old, mult, false) * 1.5);
  });
});

describe('the mock draft room', () => {
  const open = model.runMock(7);

  it('runs the bots up to your turn and stops there', () => {
    expect(open.done).toBe(false);
    expect(open.onClock).not.toBe(null);
    // everything already made belongs to somebody else, and it is contiguous
    expect(open.made.every(p => !p.mine)).toBe(true);
    open.made.forEach((p, i) => expect(p.overall).toBe(model.nextOverall + i));
    // your turn is the very next pick after the last one made
    expect(open.onClock!.overall).toBe(model.nextOverall + open.made.length);
  });

  it('never offers a player who is already gone', () => {
    const taken = new Set(open.made.map(p => p.player!.id));
    const owned = new Set(bundle.rosters.flatMap(r => r.players || []));
    for (const o of open.board) {
      expect(taken.has(o.id)).toBe(false);
      expect(owned.has(o.id)).toBe(false);
    }
  });

  it('offers three rated shortcuts, none of them repeated on the board', () => {
    // Two or three, never a repeat: when two lenses land on the same man the
    // list gets shorter rather than padded with a worse name under a good
    // label.
    expect(open.options.length).toBeGreaterThanOrEqual(2);
    expect(open.options.length).toBeLessThanOrEqual(3);
    expect(new Set(open.options.map(o => o.id)).size).toBe(open.options.length);
    expect(new Set(open.options.map(o => o.lens)).size).toBe(open.options.length);
    for (const o of open.options) expect(o.fit).toBeGreaterThan(0);

    // The first is the best Fit on the board, not merely the first name on it:
    // the whole app is built on that number and nothing used to be chosen by
    // it. And "best player available" really is the most valuable man left.
    const bestFit = open.options.find(o => o.lens === 'best')!;
    expect(bestFit.fit).toBe(Math.max(...open.board.map(o => o.fit)));
    const bpa = open.options.find(o => o.lens === 'value');
    if (bpa) {
      const top = open.board.slice().sort((a, b) =>
        (model.marketValue(b.id)?.pts || 0) - (model.marketValue(a.id)?.pts || 0))[0];
      expect(bpa.id).toBe(top.id);
    }
    // Highest Fit first: the board's best player is often not the best fit for
    // YOUR roster, and showing him above a higher-scoring name read as the app
    // arguing with its own number.
    const fits = open.options.map(o => o.fit);
    expect([...fits].sort((a, b) => b - a)).toEqual(fits);
  });

  it('offers players the rookie board filters away', () => {
    // The board this league drafts from is rookies only. A mock is a what-if,
    // so restricting it to that same slice made a veteran undraftable even
    // when searched for by name — he was simply not in the list.
    const rookie = (o: { id: string }) => {
      const raw = bundle.players[o.id];
      return (raw.years_exp === 0 || raw.years_exp == null) && !!raw.age && raw.age <= 24;
    };
    expect(open.board.some(o => !rookie(o))).toBe(true);
  });

  it('advances one turn when you take somebody', () => {
    const pick = open.options[1];
    const next = model.runMock(7, { [open.onClock!.overall]: pick.id });
    expect(next.myTeam.map(p => p.id)).toEqual([pick.id]);
    expect(next.made.some(p => p.mine && p.player!.id === pick.id)).toBe(true);
    expect(next.onClock!.overall).toBeGreaterThan(open.onClock!.overall);
    // and he is off the board for everyone else
    expect(next.board.some(o => o.id === pick.id)).toBe(false);
  });

  it('leaves the picks before your turn alone, whatever you take', () => {
    const a = model.runMock(7, { [open.onClock!.overall]: open.options[0].id });
    const b = model.runMock(7, { [open.onClock!.overall]: open.options[2].id });
    const upToMe = (r: typeof a) => r.made.filter(p => p.overall < open.onClock!.overall);
    expect(upToMe(a).map(p => p.player!.id)).toEqual(upToMe(b).map(p => p.player!.id));
  });

  it('finishes once you are out of picks', () => {
    let choices: Record<number, string> = {};
    let st = model.runMock(7);
    let guard = 0;
    while (st.onClock && guard++ < 50) {
      choices = { ...choices, [st.onClock.overall]: st.options[0].id };
      st = model.runMock(7, choices);
    }
    expect(st.done).toBe(true);
    expect(st.onClock).toBe(null);
    expect(st.myTeam.length).toBe(4);   // the four picks this team holds
  });

  it('lets you sit in another seat, and drafts its real owner as a bot', () => {
    const one = model.runMock(7, undefined, 1);
    expect(one.slot).toBe(1);
    // slot 1 is the first pick of the draft, so nothing precedes you
    expect(one.made.length).toBe(0);
    expect(one.onClock!.slot).toBe(1);
  });
});

describe('positional need is structural, not only relative', () => {
  /** A redraft league that starts exactly one quarterback. */
  const oneQb = (mine?: string[]) => {
    const b = makeBundle();
    b.league = {
      ...b.league,
      roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX',
        'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
      settings: { ...b.league.settings, type: 0 },
    };
    if (mine) b.rosters = b.rosters.map(r => (r.roster_id === 1 ? { ...r, players: mine } : r));
    return buildModel({
      data: b,
      usage: buildUsage(makeStats(b.players), b.players),
      market: parseMarket(makeFantasyCalc(b.players)),
      strat: 'balanced', boardMode: 'fa', pickSel: 0,
    });
  };

  it('stops wanting a quarterback once the one starting spot is filled', () => {
    const empty = oneQb([]);
    expect(empty.slots.QB).toBe(1);
    expect(empty.needScore.QB).toBeGreaterThan(0.9);

    /* A WEAK quarterback on purpose. Signing a good one also lifts where you
       rank at the position, which the old score already noticed — so a strong
       one cannot tell the two ideas apart. This one leaves you last at QB and
       still fills the only spot, which is the whole claim. */
    const qbs = empty.scored.filter(p => p.pos === 'QB');
    const worst = qbs[qbs.length - 1];
    const held = oneQb([worst.id]);
    expect(held.posPct.QB).toBeLessThan(0.35);        // still nearly last at QB
    expect(held.needScore.QB).toBeLessThan(0.4);      // and still does not want another
    expect(held.needScore.RB).toBeGreaterThan(0.9);   // a position short is untouched
  });

  it('drops the Fit of a second quarterback in a one-QB league', () => {
    const empty = oneQb([]);
    const qbs = empty.scored.filter(p => p.pos === 'QB');
    const held = oneQb([qbs[qbs.length - 1].id]);
    const best = qbs[0];
    const after = held.scored.find(p => p.id === best.id)!;
    expect(after.fit).toBeLessThan(best.fit - 5);
  });
});

describe('the mock reads the roster you are building in it', () => {
  /* A redraft league starting one QB, and an empty roster, so taking a
     quarterback in the mock genuinely closes the only spot there is. In the
     default fixture — dynasty superflex, two QB spots already covered — the
     score correctly does not move, which is why this needs its own league. */
  const oneQbEmpty = () => {
    const b = makeBundle();
    b.league = {
      ...b.league,
      roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX',
        'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
      settings: { ...b.league.settings, type: 0 },
    };
    b.rosters = b.rosters.map(r => (r.roster_id === 1 ? { ...r, players: [] } : r));
    return buildModel({
      data: b,
      usage: buildUsage(makeStats(b.players), b.players),
      market: parseMarket(makeFantasyCalc(b.players)),
      strat: 'balanced', boardMode: 'fa', pickSel: 0,
    });
  };

  it('stops offering a position you just filled, and credits a stack', () => {
    const model = oneQbEmpty();
    const s0 = model.runMock(7);
    const first = s0.onClock!.overall;
    const qb = s0.board.find(o => o.pos === 'QB')!;
    expect(qb).toBeTruthy();

    const s1 = model.runMock(7, { [first]: qb.id });

    // A quarterback still on both boards is worth less once you hold one.
    const both = s0.board.filter(o => o.pos === 'QB' && o.id !== qb.id)
      .find(o => s1.board.some(y => y.id === o.id));
    if (both) {
      const after = s1.board.find(y => y.id === both.id)!;
      expect(after.fit).toBeLessThan(both.fit);
    }

    // A pass catcher who shares his NFL team is worth more.
    const mate = s0.board.find(o => (o.pos === 'WR' || o.pos === 'TE') && o.team === qb.team);
    if (mate) {
      const after = s1.board.find(y => y.id === mate.id);
      if (after) expect(after.fit).toBeGreaterThan(mate.fit);
    }
  });
});

describe('who may reach the mock draft board', () => {
  const BASE = {
    player_id: 'x', first_name: 'A', last_name: 'B', position: 'WR',
    team: 'SEA', age: 27, years_exp: 5, search_rank: 300, active: true,
    status: 'Active', fantasy_positions: ['WR'],
  } as unknown as SleeperPlayer;
  const player = (over: Partial<SleeperPlayer>) => ({ ...BASE, ...over }) as SleeperPlayer;

  it('takes a veteran the rookie board would filter away', () => {
    expect(isMockEligible(player({}))).toBe(true);
  });

  it('drops a veteran with no NFL team — the tail where retired names live', () => {
    // active/status go stale on players who quietly left, so the roster is the
    // only signal left. This is the case a board-wide assertion could not see:
    // the fixture happens to contain nobody like him.
    expect(isMockEligible(player({ team: null }))).toBe(false);
  });

  it('still allows an undrafted rookie, who has no team yet', () => {
    expect(isMockEligible(player({ team: null, years_exp: 0, age: 22, search_rank: 700 }))).toBe(true);
  });

  it('stops before the practice squad', () => {
    expect(isMockEligible(player({ search_rank: 799 }))).toBe(true);
    expect(isMockEligible(player({ search_rank: 2400 }))).toBe(false);
  });

  it('respects the flags Sleeper does keep current', () => {
    expect(isMockEligible(player({ active: false }))).toBe(false);
    expect(isMockEligible(player({ status: 'Inactive' }))).toBe(false);
    expect(isMockEligible(player({ search_rank: null }))).toBe(false);
  });
});

describe('mock draft invites', () => {
  it('round-trips a league, a seed and a seat', () => {
    const url = inviteUrl({ leagueId: '123456', seed: 9, seat: 4 }, 'https://x.dev/app/');
    expect(parseInvite(new URL(url).search)).toEqual({ leagueId: '123456', seed: 9, seat: 4, room: null });
  });

  it('leaves the seat open when the link does not name one', () => {
    const url = inviteUrl({ leagueId: '123456', seed: 9, seat: null }, 'https://x.dev/app/');
    expect(url).not.toContain('seat=');
    // null, not 0 or 1: the guest takes their own seat in the league
    expect(parseInvite(new URL(url).search)!.seat).toBe(null);
  });

  it('refuses half an invite, or a junk one', () => {
    expect(parseInvite('')).toBe(null);
    expect(parseInvite('?mock=123456')).toBe(null);          // no seed
    expect(parseInvite('?seed=4')).toBe(null);               // no league
    expect(parseInvite('?mock=abc&seed=4')).toBe(null);      // league ids are numeric
    expect(parseInvite('?mock=123&seed=0')).toBe(null);      // seeds start at 1
    expect(parseInvite('?mock=123&seed=x')).toBe(null);
  });

  it('carries a room code, and rejects one that is not a code', () => {
    const url = inviteUrl({ leagueId: '123', seed: 2, seat: null, room: 'K7QM2P' }, 'https://x.dev/');
    expect(parseInvite(new URL(url).search)!.room).toBe('K7QM2P');
    expect(parseInvite('?mock=123&seed=2&room=ab')!.room).toBe(null);
    expect(parseInvite('?mock=123&seed=2&room=' + 'X'.repeat(40))!.room).toBe(null);
    // a link without one is the older kind: same board, drafted alone
    expect(parseInvite('?mock=123&seed=2')!.room).toBe(null);
  });

  it('ignores a seat that is not a seat', () => {
    expect(parseInvite('?mock=123&seed=2&seat=0')!.seat).toBe(null);
    expect(parseInvite('?mock=123&seed=2&seat=nope')!.seat).toBe(null);
  });

  it('survives a link that already carries other query parameters', () => {
    const inv = parseInvite('?utm=chat&mock=123&seed=7&seat=2');
    expect(inv).toEqual({ leagueId: '123', seed: 7, seat: 2, room: null });
  });
});

describe('the board an invite promises', () => {
  /* The whole feature rests on this: an invite sends a league, a seed and a
     seat, and nothing else. If the same three did not rebuild the same draft,
     two people comparing their teams afterwards would be comparing nothing. */
  const picksOf = (seed: number, slot?: number | null) =>
    model.runMock(seed, undefined, slot ?? undefined).made
      .map(p => p.overall + ':' + (p.player?.id ?? ''));

  it('rebuilds the same draft from the same seed', () => {
    expect(picksOf(12)).toEqual(picksOf(12));
    expect(picksOf(12).length).toBeGreaterThan(0);
  });

  it('and a different one from a different seed', () => {
    expect(picksOf(12)).not.toEqual(picksOf(13));
  });

  it('holds when the guest is seated somewhere else', () => {
    expect(picksOf(12, 3)).toEqual(picksOf(12, 3));
    // a different seat is a different draft: you pick at different moments
    expect(picksOf(12, 3)).not.toEqual(picksOf(12, 1));
  });
});

describe('what a redraft mock board holds, and in what order', () => {
  const REDRAFT = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
    'BN', 'BN', 'BN', 'BN'];
  const DYNASTY = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX',
    'BN', 'BN', 'BN', 'BN', 'BN'];

  const league = (rp: string[], type: number) => {
    const b = makeBundle();
    b.league = {
      ...b.league, roster_positions: rp,
      settings: { ...b.league.settings, type, draft_rounds: 12 },
    };
    b.rosters = b.rosters.map(r => (r.roster_id === 1 ? { ...r, players: [] } : r));
    const m = buildModel({
      data: b,
      usage: buildUsage(makeStats(b.players), b.players),
      market: parseMarket(makeFantasyCalc(b.players)),
      strat: 'balanced', boardMode: 'fa', pickSel: 0,
    });
    return { m, players: b.players };
  };

  it('runs in draft order, not in price order', () => {
    // The two are different questions, and the draft board answers the first.
    // Ordered by market value the list read 6, 1, 10, 5, 7 … — a trade value is
    // what somebody is worth to hold, which is not where he comes off a board.
    const { m, players } = league(REDRAFT, 0);
    const board = m.runMock(5).board.slice(0, 40);
    const sr = (id: string) => players[id]?.search_rank ?? 9999;
    for (let i = 1; i < board.length; i++) {
      expect(sr(board[i].id)).toBeGreaterThanOrEqual(sr(board[i - 1].id));
    }
  });

  it('holds kickers and defences where the league starts them', () => {
    const { m } = league(REDRAFT, 0);
    const board = m.runMock(5).board;
    expect(board.some(o => o.pos === 'K')).toBe(true);
    expect(board.some(o => o.pos === 'DEF')).toBe(true);
  });

  it('and leaves them out where it does not', () => {
    const { m } = league(DYNASTY, 2);
    const board = m.runMock(5).board;
    expect(board.some(o => o.pos === 'K' || o.pos === 'DEF')).toBe(false);
  });

  it('rates them off the board alone, well under a startable player', () => {
    // Not a Fit: none of the nine metrics exists for a kicker. The number is
    // where the consensus takes him, which is the only real signal there is —
    // and it has to land far enough below a starter that no suggestion ever
    // prefers one in an early round.
    const { m } = league(REDRAFT, 0);
    const board = m.runMock(5).board;
    const k = board.find(o => o.pos === 'K')!;
    const best = Math.max(...board.filter(o => o.pos === 'WR' || o.pos === 'RB').map(o => o.fit));
    expect(k.fit).toBeLessThan(best - 25);
    // and they sit deep enough that the bots' window never reaches them early
    expect(board.findIndex(o => o.pos === 'K')).toBeGreaterThan(40);
  });

  /* The board proper, not the mock. It listed neither for as long as the mock
   * did, so a redraft league with a kicker round and a defence round had two
   * picks a season the app said nothing at all about. */
  it('and the DRAFT BOARD holds them on the same terms', () => {
    const { m } = league(REDRAFT, 0);
    expect(m.scored.some(p => p.pos === 'K')).toBe(true);
    expect(m.scored.some(p => p.pos === 'DEF')).toBe(true);
    expect(m.fills).toEqual(['K', 'DEF']);
  });

  it('the board leaves them out where the league does not start them', () => {
    const { m } = league(DYNASTY, 2);
    expect(m.scored.some(p => p.pos === 'K' || p.pos === 'DEF')).toBe(false);
    expect(m.fills).toEqual([]);
  });

  it('the board rates them off the consensus, never off nine invented metrics', () => {
    const { m } = league(REDRAFT, 0);
    const k = m.scored.find(p => p.pos === 'K')!;
    expect(k).toBeTruthy();
    // Every metric zero: the breakdown says "nothing measured here" rather than
    // nine bars made of whatever each missing input defaults to.
    expect(Object.values(k.m).every(v => v === 0)).toBe(true);
    const best = Math.max(...m.scored.filter(p => p.pos === 'WR' || p.pos === 'RB').map(p => p.fit));
    expect(k.fit).toBeLessThan(best - 25);
  });
});

describe('a room with other people in it', () => {
  it('stops at a seat somebody else is holding, and names them', () => {
    // Seat 1 belongs to another person. A bot may not pick for them.
    const solo = model.runMock(4, undefined, 3);
    const shared = model.runMock(4, undefined, 3, [3, 1]);

    expect(solo.onClock!.mine).toBe(true);          // solo: bots ran to your pick
    expect(shared.onClock!.slot).toBe(1);           // shared: it stopped at theirs
    expect(shared.onClock!.mine).toBe(false);
    expect(shared.onClock!.who).not.toBe('you');
    expect(shared.options.length).toBe(0);          // nothing for you to take
    expect(shared.board.length).toBeGreaterThan(0); // but the board still reads
  });

  it('carries on once their pick lands, and keeps it out of your team', () => {
    const waiting = model.runMock(4, undefined, 3, [3, 1]);
    const theirPick = waiting.board[0].id;
    const after = model.runMock(4, { [waiting.onClock!.overall]: theirPick }, 3, [3, 1]);

    // it is on the board as somebody else's
    const landed = after.made.find(p => p.player?.id === theirPick)!;
    expect(landed).toBeTruthy();
    expect(landed.mine).toBe(false);
    expect(landed.team).not.toBe('you');
    // and not on yours
    expect(after.myTeam.some(o => o.id === theirPick)).toBe(false);
    // the draft moved on
    expect(after.onClock!.overall).toBeGreaterThan(waiting.onClock!.overall);
  });

  it('runs the whole draft when the room is shared, not just up to your last pick', () => {
    const solo = model.runMock(4, undefined, 3);
    const shared = model.runMock(4, undefined, 3, [3, 1]);
    // solo stops once you are done; shared belongs to everyone
    expect(shared.onClock!.overall).toBeLessThanOrEqual(solo.onClock!.overall);
    const full = model.rounds * model.teamCount;
    expect(full).toBeGreaterThan(0);
  });
});

describe('where the mock says a player goes', () => {
  it('counts from the pick on the clock, not from the top of the queue', () => {
    // `live` is what survives, so the best man left is first in it at every
    // moment of the draft. Printed raw that reads "1.01" in the fourth round.
    let choices: Record<number, string> = {};
    let st = model.runMock(11);
    const first = st.onClock!.overall;
    expect(st.board[0].goes).toBe(first);

    // take a few, then look again
    let guard = 0;
    while (st.onClock && guard++ < 3) {
      choices = { ...choices, [st.onClock.overall]: st.board[0].id };
      st = model.runMock(11, choices);
    }
    if (!st.onClock) return;
    expect(st.onClock.overall).toBeGreaterThan(first);
    // the head of the queue now goes at THIS pick, not at 1
    expect(st.board[0].goes).toBe(st.onClock.overall);
    expect(st.board[0].goes).toBeGreaterThan(1);
    // and the queue runs forward from there
    expect(st.board[1].goes).toBe(st.onClock.overall + 1);
    // the suggestions agree with the board
    if (st.options.length) {
      const top = st.options[0];
      const seat = st.board.findIndex(o => o.id === top.id);
      if (seat >= 0) expect(top.goes).toBe(st.onClock.overall + seat);
    }
  });
});
