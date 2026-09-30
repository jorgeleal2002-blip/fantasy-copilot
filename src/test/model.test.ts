import { describe, expect, it } from 'vitest';
import { ELIG, POS, PRIME, STRATS } from '../model/constants';
import { ageCurve, ageCurveRedraft, grade, modelVal, rankScore, talentBase, talentScale } from '../model/math';
import { marketQuery, parseMarket } from '../model/market';
import { matchMe } from '../api/sleeper';
import { inviteUrl, parseInvite } from '../model/invite';
import { buildModel } from '../model/model';
import { REACH, sfxFor } from '../model/sfx-map';
import type { MockPick } from '../model/types';
import { ownedWeights, pickValue, redraftWeights, scorePlayer } from '../model/score';
import { blendSeasons, breakWeight, buildUsage, priorStrength, seasonUsage, withCurrentSeason, type Usage, type UsageMap } from '../model/usage';
import type { PlayerCatalog } from '../api/types';
import { projectConfidence, projectPPG } from '../model/project';
import { makeBundle, makeFantasyCalc, makeLeague, makePlayers, makeStats, TEAMS } from './fixture';
import { nextDetailStack, topDetail } from '../state/detail-stack';
import { isInLeague, isMockEligible } from '../model/mock-pool';
import { ALLOWED, OPPONENTS, PLAYOFF_WEEKS, SEASON_WEEKS } from '../model/schedule';
import { byeOf, playoffWeeks, sosFor, sosScore, sosTable } from '../model/sos';
import type { Pos, SleeperPlayer } from '../api/types';
import { leaderOf, lineupRows, pairMatchups, startingSlots } from '../model/matchups';
import { PRIOR_MIN, USAGE_DECAY, USAGE_WEIGHTS } from '../model/constants';
import { PROD_SHARE_BASE, PROD_SHARE_MAX, PROD_SHARE_MAX_REDRAFT, poolFloor, prodShare } from '../model/math';
import { LOW, TOP, placing, toneOf, toneOfRank } from '../model/standing';
import { type CmpUse, aheadBy, compareMetrics, compareNumbers, compareSeasons, tally } from '../model/compare';
import { countTds, gapsIn, mergeSeason } from '../model/season';
import { barHeights, ordinal, pointsInWeek, quantile, rankAmong, rankCount, seasonLine } from '../model/season';
import { SCREEN_TRUST, bestHeight } from '../model/viewport';
import { FULL_SQ, THUMB_SQ, playerPhotoSet } from '../api/sleeper';
import { PULL_MAX, PULL_RESIST, PULL_SLOP, PULL_TRIGGER, edgeAt, pullArmed, pullFrom, pullProgress } from '../model/pull';
import { PHOTO_PX, PHOTO_Q, PHOTO_Q_FLOOR, pickEncoding } from '../model/photo';
import { projectionsAreStale, readProjections, scoreProjection, scoringKind, statsForWeek } from '../model/projections';
import { readLeagueTrades, sideRead, tradeOutcome } from '../model/league-trades';
import { allPlayRecords, finishedWeeks, powerRankings, WEIGHTS } from '../model/power';
import { statLine } from '../model/stat-line';
import { evaluateTrade, fitLine, verdictLine } from '../model/trade-eval';
import { depthOf, readPick, startsAt } from '../model/trade-picks';
import { hasPlayed, readRecord } from '../model/record';
import {
  leagueProjectionScale, leagueScoringAverage, projectLineup, projectedPoints, projectionIsSound,
  scoringAverage,
} from '../model/team-points';

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

describe('the rating', () => {
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
    // heaviest term in the Rating and dragged the whole board into the twenties.
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

  it('sorts the list by Rating while `goes` keeps the board order', () => {
    // These are two different orders and the screens must not confuse them.
    // Reading a row's position in this Rating-sorted list as its place on the
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

  it('produces a spread of ratings rather than everything at the ceiling', () => {
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

/* ── pricing a pick that is no longer an asset ──────────────────────────────
   The pick LIST is about what you can trade away, so it leaves out a redraft
   league's picks, anything past three seasons, and a pick already spent in a
   draft. A trade that moved one of those still happened, and asking the list
   to price it came back empty — which withheld the winner on every pick trade
   in the league. */
describe('what a traded pick is worth', () => {
  const year = Number(bundle.league.season);

  it('prices a pick the tradeable list does not carry', () => {
    // Four seasons out: past the three the list covers.
    const far = model.pickWorth(year + 4, 1, 1);
    expect(far).toBeTruthy();
    expect(far!.q).toBeGreaterThan(0);
  });

  it('prices one in a redraft league, which lists none at all', () => {
    const redraft = buildModel({
      data: { ...bundle, league: { ...bundle.league, settings: { ...bundle.league.settings, type: 0 } } },
      usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0,
    });
    expect(redraft.pickAssets).toHaveLength(0);
    expect(redraft.pickWorth(year + 1, 1, 1)!.q).toBeGreaterThan(0);
  });

  it('agrees with the list where the list has one', () => {
    // One formula, two callers. They drifted before it was pulled out.
    const listed = model.teamInfo(1)!.picks[0];
    expect(listed).toBeTruthy();
    expect(model.pickWorth(listed.season, listed.round, 1)).toBeTruthy();
  });

  it('still says nothing about a round that is not a round', () => {
    expect(model.pickWorth(year + 1, 0, 1)).toBe(null);
    expect(model.pickWorth(NaN, 1, 1)).toBe(null);
  });

  it('does not let an old pick appreciate', () => {
    // The year discount is a discount; unclamped, a past season multiplied.
    const past = model.pickWorth(year - 3, 1, 1)!.q;
    const now = model.pickWorth(year, 1, 1)!.q;
    expect(past).toBeLessThanOrEqual(now);
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
    shareShort: Math.round(tgt * 100) + '% targets',
    eff: 8, effLabel: 'Yards per touch', ltr: 0.02, longTd: 2,
    xtd: 5, xtdPerGame: 0.31, tdLuck: 1,
    ppg: 12, ppgAdj: 12, rz: 10, rzShare: 0.1, rzPerGame: 0.6,
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

  it('feeds the Rating through expected rather than scored touchdowns', () => {
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

    // The first is the best Rating on the board, not merely the first name on it:
    // the whole app is built on that number and nothing used to be chosen by
    // it. And "best player available" really is the most valuable man left.
    const bestFit = open.options.find(o => o.lens === 'best')!;
    expect(bestFit.fit).toBe(Math.max(...open.board.map(o => o.fit)));
    const bpa = open.options.find(o => o.lens === 'value');
    if (bpa) {
      /* The most valuable man left — past a one-slot position you have already
       * filled, where the next man cannot play at all and the card would be
       * spent on somebody you would bench for the season. So: the best of what
       * is left once those are set aside. */
      /* The room considers the next forty names in BOARD order and picks the
       * most valuable of those — not the most valuable of everything left,
       * which since the board stopped running in price order is a different
       * man and one it never looked at. */
      const byValue = open.board.slice(0, 40).sort((a, b) =>
        (model.marketValue(b.id)?.pts || 0) - (model.marketValue(a.id)?.pts || 0));
      const slotsAt = (p: string) => model.slots[p as Pos] || 1;
      const room = (p: string) => Math.max(slotsAt(p) - (open.shape[p as Pos] || 0), 0);
      /* A card is skipped when its position has no room left AND either only
       * one of it ever starts — the man behind him cannot play — or another
       * card already covers it, which would spend two of three on one slot. */
      const usable = byValue.filter(o =>
        room(o.pos) > 0
        || (slotsAt(o.pos) > 1 && !open.options.some(x => x.lens !== 'value' && x.pos === o.pos)));
      expect(bpa.id).toBe((usable[0] || byValue[0]).id);
    }
    // Highest Rating first: the board's best player is often not the best fit for
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

  it('drops the Rating of a second quarterback in a one-QB league', () => {
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

  /* Draft order and price order are different questions, and which source
   * answers the first depends on the format.
   *
   * In DYNASTY it is Sleeper's board: a trade value there carries three
   * seasons of future with it and stops describing draft position — ordered by
   * value the list read 6, 1, 10, 5, 7 …
   *
   * In REDRAFT there is no future to price, so the two collapse into one — and
   * only the market knows how many quarterbacks this league starts. Sleeper
   * ships one list to every league on the site. */
  /* Each source is asked what it knows. Sleeper's board is reliable WITHIN a
   * position and cannot see the format BETWEEN them; the market is the other
   * way round. So the order inside a position stays Sleeper's, and how high
   * that position sits against the others is the market's call. */
  it('keeps Sleeper\'s order inside a position in redraft', () => {
    const { m, players } = league(REDRAFT, 0);
    const board = m.runMock(5).board.slice(0, 60);
    const sr = (id: string) => players[id]?.search_rank ?? 9999;
    (['QB', 'RB', 'WR', 'TE'] as const).forEach(pos => {
      const mine = board.filter(o => o.pos === pos);
      for (let i = 1; i < mine.length; i++) {
        expect(sr(mine[i].id), pos + ' is out of order').toBeGreaterThan(sr(mine[i - 1].id));
      }
    });
  });

  it('and lets the market decide how the positions interleave', () => {
    const { m } = league(REDRAFT, 0);
    const board = m.runMock(5).board.slice(0, 40).filter(o => POS.indexOf(o.pos as Pos) >= 0);
    // The best of each position comes off in the market's order of them.
    const firsts = (['QB', 'RB', 'WR', 'TE'] as const)
      .map(pos => board.find(o => o.pos === pos))
      .filter(Boolean) as typeof board;
    const mv = (id: string) => m.marketValue(id)?.pts ?? 0;
    for (let i = 1; i < firsts.length; i++) {
      const a = board.indexOf(firsts[i - 1]);
      const b = board.indexOf(firsts[i]);
      if (a < b) expect(mv(firsts[i - 1].id)).toBeGreaterThanOrEqual(mv(firsts[i].id));
    }
  });

  it('and in Sleeper\'s order in dynasty', () => {
    const { m, players } = league(DYNASTY, 2);
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
    // Not a Rating: none of the eleven metrics exists for a kicker. The number is
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
    // a full set of bars made of whatever each missing input defaults to.
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

describe('what the draft room shouts, and how often', () => {
  const REDRAFT = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
    'BN', 'BN', 'BN', 'BN'];
  const redraft = () => {
    const b = makeBundle();
    b.league = {
      ...b.league, roster_positions: REDRAFT,
      settings: { ...b.league.settings, type: 0, draft_rounds: 12 },
    };
    b.rosters = b.rosters.map(r => (r.roster_id === 1 ? { ...r, players: [] } : r));
    return buildModel({
      data: b,
      usage: buildUsage(makeStats(b.players), b.players),
      market: parseMarket(makeFantasyCalc(b.players)),
      strat: 'balanced', boardMode: 'fa', pickSel: 0,
    });
  };

  const pick = (over: Partial<MockPick>): MockPick => ({
    overall: 5, round: 1, slot: 5, label: '1.05', team: 'Someone',
    mine: false, boardAt: 1,
    player: { id: 'x', name: 'X', pos: 'WR', team: 'MIA', age: 24, rank: 1, fit: 60 },
    ...over,
  });

  it('puts your own pick above everything else that is true of it', () => {
    // A reach that is also your pick is your pick. You do not boo yourself.
    expect(sfxFor(pick({ mine: true, boardAt: 40 }), [])).toBe('coin');
  });

  it('answers a kicker with the pipe, whatever else he was', () => {
    const k = { id: 'k', name: 'K', pos: 'K' as const, team: 'CIN', age: 27, rank: null, fit: 20 };
    expect(sfxFor(pick({ player: k, boardAt: 30 }), [])).toBe('pipe');
    expect(sfxFor(pick({ player: { ...k, pos: 'DEF' as const } }), [])).toBe('pipe');
  });

  it('is a womp when they take the man the app just told you to take', () => {
    expect(sfxFor(pick({}), ['x'])).toBe('womp');
    expect(sfxFor(pick({}), ['someone-else'])).toBe('tick');
  });

  it('booms on a reach and only on a reach', () => {
    expect(sfxFor(pick({ boardAt: REACH }), [])).toBe('boom');
    expect(sfxFor(pick({ boardAt: REACH - 1 }), [])).toBe('tick');
  });

  /**
   * The threshold, measured against a real draft rather than chosen by taste.
   *
   * A sound that fires on most picks is not a sound, it is a metronome — and
   * the vine boom is the loudest thing in the set, three and a half times the
   * energy of anything else. If the bots reach often enough for this to land on
   * a third of the board the room becomes unlistenable, and the number to move
   * is REACH, not the volume.
   */
  it('leaves the loud one rare across a whole draft', () => {
    const m = redraft();
    // Drive it to the end: the mock stops at your turn, so it has to be played.
    const choices: Record<number, string> = {};
    let st = m.runMock(7, choices);
    for (let i = 0; i < 200 && st.onClock; i++) {
      choices[st.onClock.overall] = st.options[0]?.id || st.board[0].id;
      st = m.runMock(7, choices);
    }
    const made = st.made;
    expect(made.length).toBeGreaterThan(20);
    const count = (n: string) => made.filter(p => sfxFor(p, []) === n).length;
    const booms = count('boom');
    expect(booms / made.length).toBeLessThan(0.12);
    // and not silent either — a rule that never fires is a rule nobody wrote
    expect(booms).toBeGreaterThan(0);
    expect(count('tick') / made.length).toBeGreaterThan(0.5);
  });
});

describe('naming the team on screen', () => {
  const build = (myRosterId?: number, bundle = makeBundle()) => buildModel({
    data: bundle,
    usage: buildUsage(makeStats(bundle.players), bundle.players),
    market: parseMarket(makeFantasyCalc(bundle.players)),
    strat: 'balanced', boardMode: 'rookies', pickSel: 0, myRosterId,
  });

  it('is the name the manager gave the team, not the account handle', () => {
    const m = build();
    expect(m.myTeamName).toBe('Sam Presti');
    expect(m.foundMyTeam).toBe(true);
  });

  /* The point of taking it off the ROSTER rather than off the signed-in
   * account. Plenty of people are in a league under a different handle than
   * the one they signed in with, and this league can be told which roster is
   * theirs by hand — reading the account's own metadata would print one
   * person's team name over another person's players. */
  it('follows a roster chosen by hand, and does not follow the account', () => {
    const m = build(4);
    expect(m.myTeamName).toBe('Rocket');
    expect(m.me.teamName).toBe('Sam Presti');
    expect(m.myTeamName).not.toBe(m.me.teamName);
  });

  it('is empty when the account has no team here, so the screen keeps its own word', () => {
    const b = makeBundle();
    b.rosters = b.rosters.map(r => ({ ...r, owner_id: 'nobody-' + r.roster_id, co_owners: [] }));
    const m = build(undefined, b);
    expect(m.foundMyTeam).toBe(false);
    expect(m.myTeamName).toBe('');
  });
});

describe('what "usage" means on a roster row', () => {
  const bundle = makeBundle();
  const st = makeStats(bundle.players);
  const base = buildUsage(makeStats(bundle.players), bundle.players);
  /** The receiver the seasons will disagree about. */
  const WR = Object.keys(bundle.players).find(k =>
    bundle.players[k].position === 'WR' && base[k] && (base[k].tgt || 0) > 0.05)!;

  /* One player's targets, not everybody's. Scaling the whole league leaves
   * every SHARE exactly where it was — the team total moves with him — so a
   * fixture built that way cannot tell a blended share from an unblended one.
   * This is a receiver who had a big year and two quiet ones. */
  const season = (tgtScale: number) => {
    const o: Record<string, Record<string, number>> = {};
    Object.keys(st).forEach(id => {
      const r = { ...st[id] } as unknown as Record<string, number>;
      if (id === WR && typeof r.rec_tgt === 'number') r.rec_tgt = r.rec_tgt * tgtScale;
      o[id] = r;
    });
    return o as never;
  };

  const wr = () => {
    const u = blendSeasons([
      { year: 2025, usage: seasonUsage(season(1), bundle.players) },
      { year: 2024, usage: seasonUsage(season(0.2), bundle.players) },
      { year: 2023, usage: seasonUsage(season(0.2), bundle.players) },
    ], bundle.players);
    return { u: u[WR], one: seasonUsage(season(1), bundle.players)[WR] };
  };

  it('is the share of his team\'s targets, written short enough for the line', () => {
    const { u } = wr();
    expect(u.shareLabel).toBe('Target share');
    expect(u.shareShort).toMatch(/^\d+% targets$/);
  });

  /* It is the number the row prints, so it has to be the same three-year blend
   * the app's own banner promises. It was not: `tgt` was left out of the blend
   * and came through as the most recent season alone, which no one noticed
   * while the row printed the snap share — that one WAS blended. */
  it('is blended across the seasons, not taken from the last one', () => {
    const { u, one } = wr();
    expect(one.tgt).toBeGreaterThan(0);
    expect(u.tgt).toBeLessThan(one.tgt! * 0.95);
    // and the text is rewritten from the blend, not left describing one season
    expect(u.shareText).not.toBe(one.shareText);
    expect(u.shareText).toBe((u.tgt! * 100).toFixed(1) + '%');
  });

  it('changes unit with the position, because the ball does', () => {
    const u = buildUsage(makeStats(bundle.players), bundle.players);
    const of = (pos: string) => {
      const id = Object.keys(bundle.players).find(k =>
        bundle.players[k].position === pos && u[k])!;
      return u[id];
    };
    expect(of('RB').shareLabel).toBe('Rush share');
    expect(of('RB').shareShort).toMatch(/carries$/);
    // A quarterback competes with nobody for the ball, so a share says nothing.
    expect(of('QB').shareLabel).toBe('Attempts per game');
    expect(of('QB').tgt).toBe(null);
  });
});

describe('a run on a position', () => {
  const at = (pos: string, over: Partial<MockPick> = {}): MockPick => ({
    overall: 5, round: 1, slot: 5, label: '1.05', team: 'Someone',
    mine: false, boardAt: 2,
    player: { id: 'p' + Math.random(), name: 'X', pos: pos as 'RB', team: 'MIA', age: 24, rank: 1, fit: 60 },
    ...over,
  });

  it('sounds on the third of a kind, not the second', () => {
    expect(sfxFor(at('RB'), [], [at('RB')])).toBe('tick');
    expect(sfxFor(at('RB'), [], [at('RB'), at('RB')])).toBe('tung');
  });

  it('and only when they are actually the same position', () => {
    expect(sfxFor(at('RB'), [], [at('RB'), at('WR')])).toBe('tick');
    expect(sfxFor(at('WR'), [], [at('RB'), at('RB')])).toBe('tick');
  });

  it('reads the run off the picks BEFORE it, so it cannot fire on an empty board', () => {
    expect(sfxFor(at('RB'), [], [])).toBe('tick');
  });

  /* Everything above it still wins. A run you are part of is your pick, and a
   * run that ends on a reach is a reach — the louder fact is the one to say. */
  it('gives way to everything that outranks it', () => {
    const three = [at('RB'), at('RB')];
    expect(sfxFor(at('RB', { mine: true }), [], three)).toBe('coin');
    expect(sfxFor(at('RB', { boardAt: 40 }), [], three)).toBe('boom');
    expect(sfxFor(at('K'), [], [at('K'), at('K')])).toBe('pipe');
  });
});

describe('sitting down in a league with no draft order', () => {
  /* Sleeper does not assign an order until the commissioner sets one, and a
   * league sitting in pre-draft usually has none. The mock still has to work
   * there — it is exactly when somebody wants to mock a draft. */
  const noOrder = () => {
    const b = makeBundle();
    b.draft = { ...b.draft, draft_order: undefined, slot_to_roster_id: undefined } as typeof b.draft;
    return buildModel({
      data: b,
      usage: buildUsage(makeStats(b.players), b.players),
      market: parseMarket(makeFantasyCalc(b.players)),
      strat: 'balanced', boardMode: 'fa', pickSel: 0,
    });
  };

  it('gives you a turn from every seat, seat one included', () => {
    const m = noOrder();
    for (let seat = 1; seat <= m.teamCount; seat++) {
      const st = m.runMock(3, undefined, seat);
      expect(st.onClock, 'seat ' + seat + ' never came on the clock').toBeTruthy();
      expect(st.onClock!.mine, 'seat ' + seat + ' was on the clock for somebody else').toBe(true);
      expect(st.onClock!.slot).toBe(seat);
    }
  });

  /* Seat one was the only one that failed, and the reason is worth keeping:
   * the seat you sat in was compared against a number that falls back to 1
   * when there is no order, so choosing seat one read as choosing nothing —
   * and then ownership fell to a seat-to-roster map that does not exist. */
  it('and seat one in particular is on the clock at 1.01', () => {
    const st = noOrder().runMock(3, undefined, 1);
    expect(st.onClock!.overall).toBe(1);
    expect(st.made.length).toBe(0);
    expect(st.done).toBe(false);
    expect(st.options.length).toBeGreaterThan(0);
  });

  it('a league that HAS an order still answers by roster when you sit nowhere', () => {
    // which is what honours a pick acquired in a trade, rather than the slot
    // it originally belonged to.
    const st = model.runMock(3);
    expect(st.onClock).toBeTruthy();
    expect(st.onClock!.mine).toBe(true);
  });
});

/**
 * A one-quarterback redraft league drafting from scratch, which is where the
 * model was wrong: it kept nominating quarterbacks after the one slot you can
 * start was full, because talent carries the heaviest weight and the log scale
 * it runs on reads a man worth a third of the board's best as 87% as good.
 */
describe('positional replaceability', () => {
  const base = makeBundle();
  const redraftLeague = (positions: string[]) => ({
    ...base,
    league: { ...base.league, roster_positions: positions,
      settings: { ...base.league.settings, type: 0, draft_rounds: 15 } },
    rosters: base.rosters.map(r => ({ ...r, players: [], starters: [] })),
    draft: { ...base.draft!, type: 'snake', settings: { rounds: 15 } },
  });
  const ONE_QB = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
    'BN', 'BN', 'BN', 'BN', 'BN', 'BN'];
  const SUPERFLEX = ONE_QB.map(p => (p === 'FLEX' ? 'SUPER_FLEX' : p));

  /* The fixture prices every position off one rank curve, which is the shape a
   * SUPERFLEX feed has. FantasyCalc is asked for numQbs=1 in a league like this
   * and returns quarterbacks far cheaper and far flatter — see `marketQuery`. */
  const oneQbMarket = parseMarket(makeFantasyCalc(base.players).map(r => {
    const v = r.value || 0;
    return (r.player || {}).position === 'QB'
      ? { ...r, value: Math.round(v * 0.45 * (0.55 + 0.45 * (v / 9000))) }
      : r;
  }));
  const u = buildUsage(makeStats(base.players), base.players);
  const build = (positions: string[], mk = oneQbMarket) => buildModel({
    data: redraftLeague(positions), usage: u, market: mk,
    strat: 'balanced', boardMode: 'fa', pickSel: 0,
  });

  it('a one-slot quarterback is worth less over replacement than a back', () => {
    const m = build(ONE_QB);
    const qb = m.scored.find(p => p.pos === 'QB')!;
    const rb = m.scored.find(p => p.pos === 'RB')!;
    expect(qb.m.scarce).toBeLessThan(rb.m.scarce);
    expect(qb.fit).toBeLessThan(rb.fit);

    /* And it is this term doing it, not a coincidence of the other ten. What
     * each metric contributes to the distance between them, in points of
     * Rating: replaceability alone opens nearly four, where before it opened
     * none. It shares the work with `value` now that a redraft board runs in
     * the market's order — the same opinion reaching the score twice, once as
     * "he is easy to replace" and once as "he does not come off the board
     * here" — and between them they are most of the gap. */
    const w = redraftWeights(STRATS.balanced.w);
    const gap = (k: keyof typeof w) => (rb.m[k] - qb.m[k]) * w[k] * 100;
    const total = (Object.keys(w) as (keyof typeof w)[]).reduce((a, k) => a + gap(k), 0);
    expect(gap('scarce')).toBeGreaterThan(2);
    expect(gap('scarce') + gap('value')).toBeGreaterThan(total * 0.6);
  });

  /* The same player, the same prices — only the league's own slots change. Ten
   * teams starting one quarterback make the eleventh best free; ten starting
   * two push that line to the twenty-first, and everyone above it gains. */
  it('and worth more in superflex, off the league slots alone', () => {
    /* The same man, the same prices, named explicitly — the two formats no
     * longer put the same quarterback at the top of the board, which is the
     * point of the board reading the format. */
    const one = build(ONE_QB).scored.find(p => p.pos === 'QB')!;
    const sf = build(SUPERFLEX).scored.find(p => p.id === one.id)!;
    expect(sf.m.scarce).toBeGreaterThan(one.m.scarce);
  });

  it('never offers two cards at a position with one slot open', () => {
    const m = build(ONE_QB);
    const choices: Record<number, string> = {};
    for (let turn = 0; turn < 6; turn++) {
      const st = m.runMock(1, choices);
      if (!st.onClock || !st.onClock.mine) break;
      const qbs = st.options.filter(o => o.pos === 'QB');
      expect(qbs.length, 'two quarterbacks offered at ' + st.onClock.label).toBeLessThan(2);
      const best = st.options.find(o => o.lens === 'best') || st.board[0];
      choices[st.onClock.overall] = best.id;
    }
  });

  it('and does not spend five rounds on quarterbacks', () => {
    const m = build(ONE_QB);
    const choices: Record<number, string> = {};
    const took: string[] = [];
    for (let turn = 0; turn < 6; turn++) {
      const st = m.runMock(1, choices);
      if (!st.onClock || !st.onClock.mine) break;
      const best = st.options.find(o => o.lens === 'best') || st.board[0];
      choices[st.onClock.overall] = best.id;
      took.push(best.pos);
    }
    expect(took.filter(p => p === 'QB').length).toBeLessThan(2);
  });

  /* A player looked up outside a league — the sheet reached from search — has
   * no slots to be measured against, and a missing measurement must not read
   * as a bad one. */
  it('is neutral where nothing was measured', () => {
    const w = STRATS.balanced.w;
    const p = { player_id: '1', position: 'WR', search_rank: 20 } as SleeperPlayer;
    expect(scorePlayer(p, {}, {}, w).m.scarce).toBe(0.5);
    expect(scorePlayer(p, {}, { vor: 0.9 }, w).m.scarce).toBe(0.9);
  });

  it('weighs replaceability harder in redraft than in dynasty', () => {
    const w = STRATS.balanced.w;
    expect(redraftWeights(w).scarce).toBeGreaterThan(w.scarce);
  });
});

/**
 * The schedule tables are generated (`scripts/build-schedule.mjs`), so what is
 * worth testing is that they are WHOLE — a half-written table would quietly
 * score every player on a partial season rather than fail.
 */
describe('strength of schedule', () => {
  const teams = Object.keys(OPPONENTS);

  it('is a complete season for all 32 teams', () => {
    expect(teams).toHaveLength(32);
    teams.forEach(t => {
      expect(OPPONENTS[t], t).toHaveLength(SEASON_WEEKS);
      expect(ALLOWED[t], t + ' has no defensive record').toHaveLength(4);
      // Exactly one week off, and every other week against one of the 32.
      const byes = OPPONENTS[t].filter(o => !o);
      expect(byes, t + ' byes').toHaveLength(1);
      OPPONENTS[t].filter(Boolean).forEach(o => {
        expect(teams, t + ' plays unknown team ' + o).toContain(o);
      });
    });
  });

  it('and the fixtures agree with each other', () => {
    teams.forEach(t => OPPONENTS[t].forEach((o, i) => {
      if (o) expect(OPPONENTS[o][i], t + ' week ' + (i + 1) + ' vs ' + o).toBe(t);
    }));
  });

  it('reads a bye off the table', () => {
    teams.forEach(t => {
      const w = byeOf(t);
      expect(w, t).toBeGreaterThan(0);
      expect(OPPONENTS[t][w - 1]).toBe('');
    });
    expect(byeOf('NOT_A_TEAM')).toBe(0);
    expect(byeOf(null)).toBe(0);
  });

  /* One schedule, four answers. The defence that cannot cover a tight end is
   * often the one that stops the run, so a back and a receiver on the same
   * team do not have the same season ahead of them — and a single "points
   * allowed to everybody" number says they do. */
  it('is measured per position, not per team', () => {
    const differs = teams.filter(t => {
      const vals = (['QB', 'RB', 'WR', 'TE'] as const).map(p => sosFor(t, p)!.rank);
      return Math.max(...vals) - Math.min(...vals) >= 8;
    });
    expect(differs.length).toBeGreaterThan(10);
  });

  it('ranks 1 softest and 32 hardest, once each', () => {
    (['QB', 'RB', 'WR', 'TE'] as const).forEach(p => {
      const ranks = teams.map(t => sosFor(t, p)!.rank).sort((a, b) => a - b);
      expect(ranks).toEqual(teams.map((_, i) => i + 1));
      const soft = teams.find(t => sosFor(t, p)!.rank === 1)!;
      const hard = teams.find(t => sosFor(t, p)!.rank === 32)!;
      expect(sosFor(soft, p)!.perGame).toBeGreaterThan(sosFor(hard, p)!.perGame);
      expect(sosFor(soft, p)!.season).toBe(1);
      expect(sosFor(hard, p)!.season).toBe(0);
    });
  });

  it('costs nothing outside redraft and a few points inside it', () => {
    const w = STRATS.balanced.w;
    expect(w.sos).toBe(0);                       // dynasty never prices it
    expect(redraftWeights(w).sos).toBeGreaterThan(0.03);
    expect(redraftWeights(w).sos).toBeLessThan(0.07);
  });

  it('is neutral for a player with no team', () => {
    expect(sosFor(null, 'WR')).toBe(null);
    expect(sosScore(null)).toBe(undefined);
    const p = { player_id: '1', position: 'WR', search_rank: 20 } as SleeperPlayer;
    expect(scorePlayer(p, {}, {}, STRATS.balanced.w).m.sos).toBe(0.5);
  });
});

/**
 * Which weeks a league is actually decided in.
 *
 * Everybody says "15 to 17" and Sleeper knows better: a league carries its own
 * `playoff_week_start`, and scoring a schedule against the wrong three weeks is
 * worse than not scoring it at all.
 */
describe('the playoff weeks are the league\'s own', () => {
  const lg = (settings: Record<string, number>) =>
    ({ ...makeLeague(), settings: { ...makeLeague().settings, ...settings } });

  it('reads them off the league, not off a guess', () => {
    expect(playoffWeeks(lg({ playoff_week_start: 15, playoff_teams: 6 }))).toEqual([15, 16, 17]);
    expect(playoffWeeks(lg({ playoff_week_start: 14, playoff_teams: 6 }))).toEqual([14, 15, 16]);
    // Four teams is two rounds, not three.
    expect(playoffWeeks(lg({ playoff_week_start: 16, playoff_teams: 4 }))).toEqual([16, 17]);
    // Twelve needs a fourth.
    expect(playoffWeeks(lg({ playoff_week_start: 15, playoff_teams: 12 }))).toEqual([15, 16, 17, 18]);
  });

  it('never runs off the end of the calendar', () => {
    playoffWeeks(lg({ playoff_week_start: 17, playoff_teams: 12 }))
      .forEach(w => expect(w).toBeLessThanOrEqual(SEASON_WEEKS));
    expect(playoffWeeks(lg({ playoff_week_start: 18, playoff_teams: 8 }))).toEqual([18]);
  });

  it('falls back where the league has not said', () => {
    expect(playoffWeeks(lg({}))).toEqual(PLAYOFF_WEEKS);
    expect(playoffWeeks(lg({ playoff_week_start: 0 }))).toEqual(PLAYOFF_WEEKS);
    expect(playoffWeeks(lg({ playoff_week_start: 99 }))).toEqual(PLAYOFF_WEEKS);
    expect(playoffWeeks(null)).toEqual(PLAYOFF_WEEKS);
  });

  /* And it has to reach the score, not just the screen: a team whose week-14
   * to 16 run is soft and whose 15 to 17 is brutal must come out differently
   * in the two leagues. */
  it('changes what the schedule is worth', () => {
    const early = sosTable(lg({ playoff_week_start: 14, playoff_teams: 6 }));
    const late = sosTable(lg({ playoff_week_start: 16, playoff_teams: 4 }));
    const moved = Object.keys(OPPONENTS).filter(t =>
      early[t].RB!.playoffRank !== late[t].RB!.playoffRank);
    expect(moved.length).toBeGreaterThan(15);
    Object.keys(OPPONENTS).forEach(t => {
      expect(early[t].RB!.weeks).toEqual([14, 15, 16]);
      expect(late[t].RB!.weeks).toEqual([16, 17]);
    });
  });
});

/**
 * The draft room's own rating, which was not the same number the rest of the
 * app computes.
 *
 * Reported from a real draft: at 6.10, holding Josh Allen already, the room's
 * BEST card was a 38-year-old quarterback going at 9.07, rated above a receiver
 * and a back going within a pick of the selection being made.
 */
describe('what the room offers you', () => {
  const base = makeBundle();
  const ONE_QB = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
    'BN', 'BN', 'BN', 'BN', 'BN', 'BN'];
  const data = {
    ...base,
    league: { ...base.league, roster_positions: ONE_QB,
      settings: { ...base.league.settings, type: 0, draft_rounds: 15 } },
    rosters: base.rosters.map(r => ({ ...r, players: [], starters: [] })),
    draft: { ...base.draft!, type: 'snake', settings: { rounds: 15 } },
  };
  const mk = parseMarket(makeFantasyCalc(base.players).map(r => {
    const v = r.value || 0;
    return (r.player || {}).position === 'QB'
      ? { ...r, value: Math.round(v * 0.45 * (0.55 + 0.45 * (v / 9000))) } : r;
  }));
  const build = () => buildModel({
    data, usage: buildUsage(makeStats(base.players), base.players), market: mk,
    strat: 'balanced', boardMode: 'fa', pickSel: 0,
  });

  /** Draft the shape from the report — RB, WR, QB, TE, RB — and stop on 6.10. */
  const atSixTen = (m: ReturnType<typeof build>) => {
    const want = ['RB', 'WR', 'QB', 'TE', 'RB'];
    const choices: Record<number, string> = {};
    for (let i = 0; i < 6; i++) {
      const st = m.runMock(1, choices, 1);
      if (!st.onClock || !st.onClock.mine) throw new Error('never got the clock');
      if (i === want.length) return st;
      choices[st.onClock.overall] = st.board.find(o => o.pos === want[i])!.id;
    }
    throw new Error('never reached 6.10');
  };

  /* With one quarterback slot and Josh Allen in it, the man behind him cannot
   * play. "Best player available: a quarterback" is a true sentence about
   * somebody you would bench for the season, and it cost a card that could
   * have named a starter. Deeper positions are deliberately left alone — a
   * fourth receiver plays, on byes, on injuries and in the flex. */
  it('never spends a card on a one-slot position you have already filled', () => {
    const st = atSixTen(build());
    expect(st.shape.QB).toBe(1);
    expect(st.options.map(o => o.pos)).not.toContain('QB');
  });

  it('and still offers three', () => {
    expect(atSixTen(build()).options).toHaveLength(3);
  });

  /**
   * The room could not tell a reach from a bargain.
   *
   * Every rating in it was computed without the player's place on the board,
   * so `value` sat pinned at its neutral for all 120 names — while the card
   * beside the number printed exactly where he goes. A man 95 picks away and
   * the same man 55 picks away scored identically.
   */
  it('knows how far away a man is, which it did not', () => {
    const m = build();
    const choices: Record<number, string> = {};
    let watched = '';
    const seen: number[] = [];
    for (let turn = 0; turn < 5; turn++) {
      const st = m.runMock(1, choices, 1);
      if (!st.onClock || !st.onClock.mine) break;
      // Somebody deep enough that no bot reaches him, so his rating moves for
      // one reason only: your pick is getting closer to his slot.
      if (!watched) watched = st.board[95].id;
      const him = st.board.find(o => o.id === watched);
      if (him) seen.push(him.fit);
      choices[st.onClock.overall] = st.board.find(o => o.pos === 'RB')!.id;
    }
    expect(seen.length).toBeGreaterThan(3);
    // Flat before: 51 at every turn. Now it climbs as the pick closes on him.
    expect(new Set(seen).size).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBeGreaterThan(seen[0]);
  });
});

/**
 * The board has to know how many quarterbacks the league starts.
 *
 * Sleeper's `search_rank` is one list shipped to every league on the site, and
 * it has the best quarterback alive inside the top ten — where he goes in
 * superflex, and three rounds earlier than he goes in a league that starts one
 * of him. Reported from a real draft, and measured before the fix: a one-QB
 * redraft, a superflex redraft and a dynasty superflex produced the identical
 * board, quarterback first in all three.
 */
describe('the board reads the format', () => {
  const base = makeBundle();
  const ONE_QB = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
    'BN', 'BN', 'BN', 'BN', 'BN', 'BN'];
  const SUPERFLEX = ONE_QB.map(p => (p === 'FLEX' ? 'SUPER_FLEX' : p));
  const build = (positions: string[], type: number, qbDiscount: boolean, empty = true) => buildModel({
    data: {
      ...base,
      league: { ...base.league, roster_positions: positions,
        settings: { ...base.league.settings, type, draft_rounds: 15 } },
      /* Empty for the format checks — a draft from scratch is where the order
       * is visible. Populated for the kicker check, because with every skill
       * player in the fixture still available none of them is inside a board
       * 120 deep, which is also the right answer: nobody takes a kicker with
       * one of the first 120 picks. */
      rosters: empty ? base.rosters.map(r => ({ ...r, players: [], starters: [] })) : base.rosters,
      draft: { ...base.draft!, type: 'snake', settings: { rounds: 15 } },
    },
    usage: buildUsage(makeStats(base.players), base.players),
    // FantasyCalc is asked for numQbs, so a one-QB league gets quarterbacks
    // priced far cheaper. That is the whole signal Sleeper's list cannot carry.
    market: parseMarket(makeFantasyCalc(base.players).map(r => {
      const v = r.value || 0;
      return qbDiscount && (r.player || {}).position === 'QB'
        ? { ...r, value: Math.round(v * 0.45 * (0.55 + 0.45 * (v / 9000))) } : r;
    })),
    strat: 'balanced', boardMode: 'fa', pickSel: 0,
  });
  /** Where the first quarterback comes off, as a pick of a ten-team draft. */
  const firstQb = (m: ReturnType<typeof build>) => {
    const order = m.scored.slice().sort((a, b) => (a.goes || 9999) - (b.goes || 9999));
    return order.find(p => p.pos === 'QB')!.goes!;
  };

  it('takes a quarterback three rounds later where only one of him starts', () => {
    const one = firstQb(build(ONE_QB, 0, true));
    const sflx = firstQb(build(SUPERFLEX, 0, false));
    expect(sflx).toBeLessThanOrEqual(10);              // round 1 in superflex
    expect(one).toBeGreaterThan(20);                   // round 3 or later
    expect(one - sflx).toBeGreaterThan(15);
  });

  /* The top of a one-QB board is the position you actually start three and
   * four of. It used to be a quarterback, in every format. */
  it('and does not open with one', () => {
    const m = build(ONE_QB, 0, true);
    const order = m.scored.slice().sort((a, b) => (a.goes || 9999) - (b.goes || 9999));
    expect(order.slice(0, 10).filter(p => p.pos === 'QB')).toHaveLength(0);
  });

  /* Dynasty keeps Sleeper's board: there a trade value carries three seasons
   * of future with it and stops describing where a player comes off. */
  it('leaves dynasty on Sleeper\'s own order', () => {
    const m = build(SUPERFLEX, 2, false);
    const order = m.scored.slice().sort((a, b) => (a.goes || 9999) - (b.goes || 9999));
    for (let i = 1; i < 40; i++) {
      expect(order[i].raw.search_rank ?? 9999)
        .toBeGreaterThanOrEqual(order[i - 1].raw.search_rank ?? 9999);
    }
  });

  /**
   * Kickers and defences are not priced by the market, so reordering by it
   * could have dumped them past the end of the draft — the market's ORDER is
   * used and its scale is thrown away precisely so it does not.
   *
   * The check is that switching format leaves them exactly where Sleeper had
   * them, while the skill players around them move.
   */
  it('leaves the players the market never priced where they were', () => {
    const rd = build(ONE_QB, 0, true, false);
    const dyn = build(ONE_QB, 2, true, false);
    const where = (m: ReturnType<typeof build>) => {
      const order = m.runMock(5).board;
      const at: Record<string, number> = {};
      order.forEach((o, i) => { at[o.id] = i; });
      return { order, at };
    };
    const a = where(rd);
    const b = where(dyn);
    const fills = a.order.filter(o => o.pos === 'K' || o.pos === 'DEF');
    expect(fills.length).toBeGreaterThan(0);
    // Same slot in both formats, and still in Sleeper's own order among
    // themselves — nothing about a kicker changes when the QB count does.
    fills.forEach(f => expect(b.at[f.id], f.pos + ' moved').toBe(a.at[f.id]));
    for (let i = 1; i < fills.length; i++) {
      expect(fills[i].rank == null || fills[i - 1].rank == null
        || (rd.scoreAny(fills[i].id)?.raw.search_rank ?? 9999)
          >= (rd.scoreAny(fills[i - 1].id)?.raw.search_rank ?? 9999)).toBe(true);
    }
  });

  /* And the skill players around them DID move, or none of this did anything. */
  it('while the skill players around them do move', () => {
    const rd = build(ONE_QB, 0, true, false).runMock(5).board.filter(o => POS.indexOf(o.pos as Pos) >= 0);
    const dyn = build(ONE_QB, 2, true, false).runMock(5).board.filter(o => POS.indexOf(o.pos as Pos) >= 0);
    const moved = rd.filter((o, i) => dyn[i] && dyn[i].id !== o.id);
    expect(moved.length).toBeGreaterThan(rd.length / 3);
  });
});

/**
 * What a round is worth.
 *
 * A draft is not a sequence of independent purchases. You hold another pick,
 * and the only thing this one buys that the next one cannot is a player who
 * will be GONE by then — which the model had no idea about, so a sixth-rounder
 * spent on a man certain to last still read as a fine selection.
 */
describe('the value of the round', () => {
  it('keeps a man the board takes before you pick again', () => {
    // Picking at 60, next real selection at 80. He goes at 62: you lose him.
    expect(pickValue(62, 60, 80)).toBeGreaterThan(pickValue(62, 60, 63));
  });

  it('and discounts one who will still be sitting there', () => {
    const soon = pickValue(62, 60, 80);      // gone well before you return
    const late = pickValue(95, 60, 80);      // still on the board at 80
    expect(late).toBeLessThan(soon);
    // Discounted, not erased — he is still a player worth having, just not a
    // reason to hurry.
    expect(late).toBeGreaterThan(0);
  });

  it('leaves your last pick alone, where there is no waiting to do', () => {
    const noNext = pickValue(95, 60);
    expect(noNext).toBe(pickValue(95, 60, 60));
    expect(noNext).toBeGreaterThan(pickValue(95, 60, 80));
  });

  /**
   * A turn is one window, not two rounds.
   *
   * At 6.10 and 7.1 there is no pick in between, so whoever you pass on at
   * 6.10 is still sitting there one pick later — and taking "the next pick you
   * hold" literally discounted the whole board equally and flattened it. The
   * horizon is the first pick that is NOT back-to-back with the run.
   */
  it('treats back-to-back picks as one window', () => {
    const base = makeBundle();
    const m = buildModel({
      data: {
        ...base,
        league: { ...base.league,
          roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
            'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
          settings: { ...base.league.settings, type: 0, draft_rounds: 15 } },
        rosters: base.rosters.map(r => ({ ...r, players: [], starters: [] })),
        draft: { ...base.draft!, type: 'snake', settings: { rounds: 15 } },
      },
      usage: buildUsage(makeStats(base.players), base.players),
      market: parseMarket(makeFantasyCalc(base.players)),
      strat: 'balanced', boardMode: 'fa', pickSel: 0,
    });
    // Seat 1 in a ten-team snake holds 60 and 61 back to back, then 80.
    const choices: Record<number, string> = {};
    let st = m.runMock(1, choices, 1);
    for (let i = 0; i < 5 && st.onClock?.mine; i++) {
      choices[st.onClock.overall] = st.board[0].id;
      st = m.runMock(1, choices, 1);
    }
    expect(st.onClock!.overall).toBe(60);
    // The horizon is 8.10, not 7.01 — so the twenty names in between are the
    // ones at risk, and nothing beyond them is.
    const risky = st.board.filter(o => o.goneBy);
    expect(risky).toHaveLength(20);
    risky.forEach(o => expect(o.goneBy).toBe('8.10'));
    st.board.slice(20).forEach(o => expect(o.goneBy).toBe(null));
  });

  /* And it has to reach the order, not only the numbers. */
  it('puts a man you are about to lose above one you are not', () => {
    const w = redraftWeights(STRATS.balanced.w);
    // Two players, identical but for where the board takes them, at pick 60
    // with the next real selection at 80.
    const at = (board: number) => pickValue(board, 60, 80) * w.value * 100;
    expect(at(65) - at(95)).toBeGreaterThan(1.5);
  });
});

/**
 * How closely the room follows its own board.
 *
 * Reported: the order looks nothing like a real mock — good players fall a long
 * way past where they go. Measured on the old bot, which re-sorted the next
 * TWENTY-FIVE names by need-weighted trade value and then drew almost evenly
 * from the top five of that: the average pick came from 7.6 places down the
 * board, one bot took the 24th-best name available inside the first round, and
 * the consensus number two fell to the sixth pick.
 */
describe('a room that follows the board', () => {
  const base = makeBundle();
  const m = buildModel({
    data: {
      ...base,
      league: { ...base.league,
        roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
          'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
        settings: { ...base.league.settings, type: 0, draft_rounds: 15 } },
      rosters: base.rosters.map(r => ({ ...r, players: [], starters: [] })),
      draft: { ...base.draft!, type: 'snake', settings: { rounds: 15 } },
    },
    usage: buildUsage(makeStats(base.players), base.players),
    market: parseMarket(makeFantasyCalc(base.players)),
    strat: 'balanced', boardMode: 'fa', pickSel: 0,
  });

  /** A whole draft, taking the top of the board at every one of your turns. */
  const played = (seed: number) => {
    const choices: Record<number, string> = {};
    let st = m.runMock(seed, choices, 1);
    for (let i = 0; i < 20 && st.onClock?.mine; i++) {
      choices[st.onClock.overall] = st.board[0].id;
      st = m.runMock(seed, choices, 1);
    }
    return st;
  };

  it('strays a place or two, not eight', () => {
    const bots = played(1).made.filter(p => p.player && !p.mine).map(p => p.boardAt);
    expect(bots.length).toBeGreaterThan(80);
    const mean = bots.reduce((a, b) => a + Math.abs(b - 1), 0) / bots.length;
    expect(mean).toBeLessThan(2);            // 7.6 before
    expect(Math.max(...bots)).toBeLessThanOrEqual(6);
  });

  it('takes the best man left more often than anything else', () => {
    const bots = played(1).made.filter(p => p.player && !p.mine).map(p => p.boardAt);
    const first = bots.filter(a => a === 1).length / bots.length;
    expect(first).toBeGreaterThan(0.35);
    // But not always, or it is a sorted list rather than a draft.
    expect(first).toBeLessThan(0.75);
  });

  /* The complaint in the form it was made: the names at the top of the board
   * have to come off near the top of the draft. */
  it('does not let the top of the board fall out of the first round', () => {
    const board = m.runMock(1, {}, 1).board;
    const st = played(1);
    const at: Record<string, number> = {};
    st.made.forEach(p => { if (p.player) at[p.player.id] = p.overall; });
    board.slice(0, 10).forEach(o => {
      expect(at[o.id], o.name + ' never came off the board').toBeTruthy();
      expect(at[o.id], o.name + ' fell to ' + at[o.id]).toBeLessThanOrEqual(m.teamCount + 5);
    });
  });

  /* Need is a tiebreak inside the window, not a licence to jump the board:
   * it used to run to 1.9x where a position was three starters short. */
  it('never lets a hole outrank the board by more than the window', () => {
    [1, 7, 42].forEach(seed => {
      played(seed).made.filter(p => p.player && !p.mine)
        .forEach(p => expect(p.boardAt).toBeLessThanOrEqual(6));
    });
  });
});

/**
 * The contention label and the table it sits in have to mean the same thing by
 * "strong".
 *
 * Reported from a phone: a team fifth in the league table labelled "contending"
 * while the third was "mid". The table is ordered by the best lineup each team
 * can field — it says so at the top — and the label was computed from the sum
 * of every player on the roster, bench included. Two different questions, one
 * row, and no way for a reader to tell.
 */
describe('what a team\'s strength means', () => {
  /* Ten teams whose lineups descend in quality, except one: the sixth-best
     lineup is given sixteen extra bodies behind it. Sum the whole roster and it
     is one of the strongest sides in the league; field a lineup and it is
     sixth. */
  const build = () => {
    const b = makeBundle();
    const byPos: Record<string, string[]> = { QB: [], RB: [], WR: [], TE: [] };
    Object.keys(b.players).forEach(id => {
      const p = b.players[id];
      if (byPos[p.position || '']) byPos[p.position!].push(id);
    });
    Object.keys(byPos).forEach(k => byPos[k].sort((x, y) =>
      (b.players[x].search_rank || 9999) - (b.players[y].search_rank || 9999)));
    b.rosters = b.rosters.map((r, i) => {
      const nine = [
        ...byPos.QB.slice(i, i + 1), ...byPos.RB.slice(i * 3, i * 3 + 3),
        ...byPos.WR.slice(i * 4, i * 4 + 4), ...byPos.TE.slice(i, i + 1),
      ];
      const deep = i === 5 ? [...byPos.RB.slice(30, 38), ...byPos.WR.slice(40, 48)] : [];
      return { ...r, players: [...nine, ...deep], starters: nine };
    });
    const m = buildModel({
      data: b, usage: buildUsage(makeStats(b.players), b.players),
      market: parseMarket(makeFantasyCalc(b.players)),
      strat: 'balanced', boardMode: 'fa', pickSel: 0,
    });
    return {
      rows: m.leagueRows.slice().sort((x, y) => y.now - x.now),
      deepest: b.rosters[5].roster_id,
    };
  };

  it('does not call a team contending while the team above it is not', () => {
    const { rows } = build();
    const rank = (w: string) => (w === 'contender' ? 0 : w === 'medio' ? 1 : 2);
    for (let i = 1; i < rows.length; i++) {
      expect(
        rank(rows[i].window),
        rows[i].name + ' is ' + rows[i].window + ' below ' + rows[i - 1].name
          + ', which is ' + rows[i - 1].window,
      ).toBeGreaterThanOrEqual(rank(rows[i - 1].window));
    }
  });

  /* The bench is where the two measures came apart, so this is the row that
     used to be labelled contending from sixth place. */
  it('and a deep bench does not make a sixth-place lineup a contender', () => {
    const { rows, deepest } = build();
    const at = rows.findIndex(r => r.id === deepest);
    expect(at).toBeGreaterThan(3);              // sixth by the lineup it fields
    expect(rows[at].window).not.toBe('contender');
  });
});

/* ── the season being played ────────────────────────────────────────────────
   The model counted back from the league's year and never looked at the season
   in progress, so every number described a player as he was last January: the
   back who lost his job in August was still a starter here, and the receiver
   who inherited a hundred targets was still a backup. */
describe('the season in progress', () => {
  const CATALOG = {
    a: { player_id: 'a', position: 'WR', team: 'SEA', age: 26, years_exp: 4 },
    rk: { player_id: 'rk', position: 'WR', team: 'SEA', age: 22, years_exp: 0 },
  } as unknown as import('../api/types').PlayerCatalog;

  const one = (over: Partial<Usage>): UsageMap => ({ a: { ...usageStub(0.8, 0.2), ...over } });
  const prior = () => one({ ppgAdj: 12, gp: 16, gpTotal: 45, seasons: 3, seasonList: '2025, 2024, 2023', rank: 12 });

  it('weighs this year by how much of it has been played', () => {
    // The prior is fifty games of a player who may not exist any more, so it
    // is not worth fifty games: by game three the year you are watching leads.
    const wk3 = withCurrentSeason(prior(), { year: 2026, usage: one({ ppgAdj: 24, gp: 3 }) }, CATALOG);
    expect(wk3.a.ppgAdj as number).toBeCloseTo(12 + 12 * (3 / 7), 6);
    expect(wk3.a.curWeight as number).toBeCloseTo(0.5, 6);
    const wk6 = withCurrentSeason(prior(), { year: 2026, usage: one({ ppgAdj: 24, gp: 6 }) }, CATALOG);
    expect(wk6.a.ppgAdj as number).toBeGreaterThan(18);
    // and it keeps growing, so by December the year in front of you leads
    const wk13 = withCurrentSeason(prior(), { year: 2026, usage: one({ ppgAdj: 24, gp: 13 }) }, CATALOG);
    expect(wk13.a.curWeight as number).toBeGreaterThan(0.75);
  });

  it('lets one big Sunday move a player without repainting him', () => {
    const after = withCurrentSeason(prior(), { year: 2026, usage: one({ ppgAdj: 40, gp: 1 }) }, CATALOG);
    expect(after.a.ppgAdj as number).toBeGreaterThan(12);
    expect(after.a.ppgAdj as number).toBeLessThan(20);
  });

  it('does nothing at all before a snap has been played', () => {
    // Preseason: the feed answers, everybody is at zero games, and a season of
    // nothing dragging the blend toward nothing would be worse than silence.
    const after = withCurrentSeason(prior(), { year: 2026, usage: one({ ppgAdj: 0, ppg: 0, gp: 0 }) }, CATALOG);
    expect(after.a.ppgAdj).toBe(12);
    expect(after.a.curGp).toBeUndefined();
  });

  it('carries a player no finished season has', () => {
    // A rookie four weeks in is the one case where the year so far is all there
    // is — and the four-game floor is still what decides whether it prints.
    const rookie = { rk: { ...usageStub(0.6, 0.18), ppgAdj: 11, gp: 3 } };
    const after = withCurrentSeason(prior(), { year: 2026, usage: rookie }, CATALOG);
    expect(after.rk.ppgAdj).toBe(11);
    expect(after.rk.seasonList).toBe('2026');
    expect(projectPPG(after.rk)).toBeNull();
    expect(projectPPG({ ...after.rk, gpTotal: 5 })).toBe(11);
  });

  it('counts this year toward how much sample a number is standing on', () => {
    const after = withCurrentSeason(one({ ppgAdj: 12, gp: 2, gpTotal: 6 }), { year: 2026, usage: one({ gp: 9 }) }, CATALOG);
    expect(after.a.gpTotal).toBe(15);
    // 6 games was "low", 15 is "fair" — the confidence moves with the sample
    expect(projectConfidence(after.a)).toBe('fair');
    expect(after.a.seasonList).toContain('2026');
  });

  it('takes the position rank from now rather than last January', () => {
    const after = withCurrentSeason(prior(), { year: 2026, usage: one({ rank: 3, gp: 4 }) }, CATALOG);
    // A rank is a statement about the present; averaging two of them is not one.
    expect(after.a.rank).toBe(3);
  });

  it('keeps a metric only this year has', () => {
    const after = withCurrentSeason(one({ snap: null, gp: 16 }), { year: 2026, usage: one({ snap: 0.9, gp: 5 }) }, CATALOG);
    expect(after.a.snap).toBe(0.9);
  });
});

/* ── the points projection ──────────────────────────────────────────────────
   A different object from the Rating, and these are the properties that make
   it one: it reads the player and nothing else, it is in POINTS rather than on
   a 0-100 scale, and it declines to answer off a sample too short to mean
   anything. */
describe('projected points per game', () => {
  const at = (over: Partial<Usage>): Usage => ({ ...usageStub(0.8, 0.2), ...over });

  it('is the luck-adjusted production, in points', () => {
    expect(projectPPG(at({ ppgAdj: 13.4 }))).toBeCloseTo(13.4, 6);
  });

  it('does not answer at all off fewer than four games', () => {
    expect(projectPPG(at({ gp: 3, gpTotal: 3 }))).toBeNull();
    expect(projectPPG(at({ gp: 3, gpTotal: 20 }))).not.toBeNull();
  });

  it('has nothing to say about a player it has no usage for', () => {
    expect(projectPPG(undefined)).toBeNull();
    expect(projectPPG(at({ ppgAdj: null }))).toBeNull();
  });

  /* The age step was measured out: it cost the top backs 1.7 points a game and
     raised their error, because the prime window closes at 26 for reasons about
     what a back is WORTH, not about what he scores next September. This is the
     regression test for that — a signature that cannot take an age cannot
     quietly grow one back. */
  it('does not read age at all — that belongs to the Rating', () => {
    expect(projectPPG.length).toBe(1);
    const u = at({ ppgAdj: 12 });
    expect(projectPPG(u)).toBeCloseTo(12, 6);
  });

  /* The luck adjustment shrinks each rate toward the position median by how
     much that rate repeats, and how much it repeats differs by position. Held
     at one global set, quarterbacks lost four points a game — their touchdowns
     keep and everybody else's do not. These check the behaviour rather than the
     constants, so the numbers can be re-measured without breaking the test. */
  it('keeps more of a quarterback\'s hot touchdown rate than a receiver\'s', () => {
    const GP = 16;
    const BASE = {
      gp: GP, rec_tgt: 100, rec: 65, rec_yd: 800, rush_att: 100, rush_yd: 400,
      rush_td: 3, rec_td: 3, pass_att: 500, pass_yd: 3500, pass_td: 20,
      pts_half_ppr: 200,
    };
    /** What one player's ppgAdj comes out as, among fifty ordinary ones at his
     *  position — fifty because the median they set is what he is shrunk toward. */
    const adj = (pos: Pos, over: Record<string, number>) => {
      const league: Record<string, typeof BASE> = { him: { ...BASE, ...over } };
      for (let i = 0; i < 50; i++) league['n' + i] = { ...BASE };
      const players: Record<string, SleeperPlayer> = {};
      Object.keys(league).forEach(id => {
        players[id] = { player_id: id, position: pos, team: 'KC', full_name: id } as SleeperPlayer;
      });
      return buildUsage(league, players).him.ppgAdj as number;
    };
    /** Of the points a hot season really put on the board, what fraction does
     *  the adjustment let him keep? */
    const kept = (pos: Pos, over: Record<string, number>, rawPoints: number) =>
      (adj(pos, over) - adj(pos, {})) / (rawPoints / GP);

    // Ten extra touchdowns each, worth the same raw points to both.
    const qb = kept('QB', { pass_td: 30, pts_half_ppr: 240 }, 40);
    const wr = kept('WR', { rec_td: 13, pts_half_ppr: 260 }, 60);

    expect(qb).toBeGreaterThan(wr);
    // and the receiver keeps well under half of it — his rate measures 0.21
    expect(wr).toBeLessThan(0.5);
  });

  it('reports how much sample it is standing on', () => {
    expect(projectConfidence(at({ gpTotal: 45 }))).toBe('high');
    expect(projectConfidence(at({ gpTotal: 17 }))).toBe('fair');
    expect(projectConfidence(at({ gpTotal: 6 }))).toBe('low');
    expect(projectConfidence(undefined)).toBeNull();
  });
});

/* ── the trades the league actually made ────────────────────────────────────
   Sleeper describes a trade by where each asset LANDS rather than by sides,
   which is the same shape the trade engine takes, so a finished deal and a
   proposed one are judged by the same arithmetic. */
describe('the season\'s trades', () => {
  const PRICES: Record<string, number> = { a: 4000, b: 3000, c: 900, k: 0 };
  const look = {
    player: (id: string) => (id in PRICES
      // A kicker is priced at nothing on purpose. That is a price.
      ? { name: id.toUpperCase(), note: 'RB · SEA', value: PRICES[id], priced: true }
      : null),
    pick: (season: number, round: number) => (season === 2027
      ? { name: season + ' 1st', note: 'Round ' + round, value: 2000, priced: true }
      : null),
    teamName: (rid: number) => 'Team ' + rid,
    isMe: (rid: number) => rid === 1,
  };
  const trade = (over: Record<string, unknown> = {}) => ({
    type: 'trade', status: 'complete', transaction_id: 't1', week: 3,
    status_updated: 1_700_000_000_000,
    roster_ids: [1, 2],
    adds: { a: 2, b: 1 },
    drops: { a: 1, b: 2 },
    ...over,
  }) as unknown as import('../api/types').SleeperTransaction;

  it('routes every asset from the roster that gave it to the one that got it', () => {
    const [t] = readLeagueTrades([trade()], look);
    expect(t.sides.map(s => s.name)).toEqual(['You', 'Team 2']);
    expect(t.sides[0].got.map(mv => mv.name)).toEqual(['B']);
    expect(t.sides[1].got.map(mv => mv.name)).toEqual(['A']);
  });

  it('names the winner with the same engine that judges a proposal', () => {
    // 4000 out, 3000 in: you lose this one by a thousand.
    const [t] = readLeagueTrades([trade()], look);
    expect(t.verdict!.winner!.name).toBe('Team 2');
    expect(t.sides[0].net).toBe(-1000);
    expect(tradeOutcome(t)).toContain('Team 2 wins this one');
  });

  it('calls an even trade even rather than inventing a winner', () => {
    const even = trade({ adds: { a: 2, b: 1 }, drops: { a: 1, b: 2 }, });
    const flat = readLeagueTrades([even], {
      ...look, player: (id: string) => ({ name: id, note: '', value: 3000, priced: true }),
    })[0];
    expect(flat.verdict!.winner).toBe(null);
    expect(tradeOutcome(flat)).toContain('Even trade');
  });

  it('carries a draft pick as an asset on the same ledger', () => {
    const [t] = readLeagueTrades([trade({
      adds: { a: 2 }, drops: { a: 1 },
      draft_picks: [{ season: '2027', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 }],
    })], look);
    expect(t.sides[0].got.map(mv => mv.name)).toEqual(['2027 1st']);
    // 2000 for the pick against 4000 for the player.
    expect(t.verdict!.winner!.name).toBe('Team 2');
  });

  it('refuses a verdict on a deal it could not price all of', () => {
    // A player the catalog has never heard of is credited with nothing, which
    // hands his new team a loss it did not earn. Say so instead.
    const [t] = readLeagueTrades([trade({ adds: { a: 2, zz: 1 }, drops: { a: 1, zz: 2 } })], look);
    expect(t.verdict).toBe(null);
    expect(t.unpriced).toBe(1);
    expect(tradeOutcome(t)).toContain('no market price');
  });

  it('still judges a trade with a kicker in it', () => {
    const [t] = readLeagueTrades([trade({ adds: { a: 2, k: 1 }, drops: { a: 1, k: 2 } })], look);
    expect(t.unpriced).toBe(0);
    expect(t.verdict!.winner!.name).toBe('Team 2');
  });

  /* Budget is not priced in the market's currency, so scoring it means
     inventing an exchange rate and deciding a trade on the invention. Leaving
     it out is harmless as a sweetener and fatal as the whole return, and only
     the second withholds the verdict. */
  it('judges a trade with budget thrown in on top', () => {
    const [t] = readLeagueTrades([trade({
      adds: { a: 2, b: 1 }, drops: { a: 1, b: 2 },
      waiver_budget: [{ sender: 2, receiver: 1, amount: 40 }],
    })], look);
    expect(t.faab).toBe(true);
    expect(t.budgetOnly).toBe(false);
    expect(t.verdict!.winner!.name).toBe('Team 2');
  });

  it('refuses to judge a team that was paid only in budget', () => {
    const [t] = readLeagueTrades([trade({
      adds: { a: 2 }, drops: { a: 1 },
      waiver_budget: [{ sender: 2, receiver: 1, amount: 40 }],
    })], look);
    expect(t.sides[0].got.map(mv => mv.name)).toEqual(['$40 FAAB']);
    expect(t.budgetOnly).toBe(true);
    expect(t.verdict).toBe(null);
    expect(tradeOutcome(t)).toContain('waiver budget');
  });

  it('keeps only the trades, and only the ones that went through', () => {
    const rows = [
      trade(),
      trade({ type: 'waiver', transaction_id: 'w1' }),
      trade({ type: 'free_agent', transaction_id: 'f1' }),
      trade({ status: 'vetoed', transaction_id: 't2' }),
    ];
    expect(readLeagueTrades(rows, look).map(t => t.id)).toEqual(['t1']);
    expect(readLeagueTrades(null, look)).toEqual([]);
  });

  it('ignores a player who arrives without anyone giving him up', () => {
    // A waiver add riding in the same payload is not a leg of the trade.
    const [t] = readLeagueTrades([trade({ adds: { a: 2, b: 1, x: 1 }, drops: { a: 1, b: 2 } })], look);
    expect(t.moves).toHaveLength(2);
  });

  it('puts the newest trade first', () => {
    const rows = [
      trade({ transaction_id: 'old', week: 1, status_updated: 1 }),
      trade({ transaction_id: 'new', week: 9, status_updated: 9 }),
    ];
    expect(readLeagueTrades(rows, look).map(t => t.id)).toEqual(['new', 'old']);
  });

  /* ── read against the team, not just the ledger ──────────────────────────
     Who got the better of it and whether either was trying to win it come
     apart constantly, and the disagreement is the useful half. */
  describe('one team\'s side of it', () => {
    const side = (net: number, gotPos: string[] = ['RB']) => ({
      id: 1, name: 'You', isMe: true, net,
      got: gotPos.map((pos, i) => ({ kind: 'player', id: 'p' + i, name: 'X', note: '', pos, from: 2, to: 1, value: 0, priced: true })),
      gave: [],
    } as unknown as import('../model/league-trades').TradeSide);
    const ctx = (over: Partial<import('../model/league-trades').SideContext> = {}) =>
      ({ window: 'medio' as const, worst: null, lineup: null, ...over });

    it('says when a team paid over the market and got lineup for it', () => {
      // The whole reason a value column is not enough: overpaying for the
      // position you cannot field is a good trade it calls a bad one.
      const line = sideRead(side(-800), ctx({ lineup: 2.4, worst: 'RB' }), 200);
      expect(line).toContain('Paid over the market');
      expect(line).toContain('2.4 pts');
      expect(line).toContain('thinnest spot');
    });

    it('says when a team won the value by selling its starters', () => {
      const line = sideRead(side(900), ctx({ lineup: -3.1, window: 'rebuild' }), 200);
      expect(line).toContain('Won the value');
      expect(line).toContain('3.1 pts');
      expect(line).toContain('rebuild');
    });

    it('does not call a tenth of a point a lineup change', () => {
      expect(sideRead(side(0), ctx({ lineup: 0.04 }), 200)).toContain('lineup is unchanged');
    });

    it('names the contender buying now', () => {
      expect(sideRead(side(0), ctx({ lineup: 1.8, window: 'contender' }), 200))
        .toContain('contender buying now');
    });

    it('only calls it their thinnest spot when they actually received one', () => {
      expect(sideRead(side(0, ['WR']), ctx({ lineup: 1.8, worst: 'RB' }), 200))
        .not.toContain('thinnest');
    });

    it('still reads a side whose lineup was never measured', () => {
      expect(sideRead(side(900), ctx(), 200)).toContain('Took the value');
      expect(sideRead(side(0), ctx(), 200)).toBe('Even on value.');
    });
  });

  it('works for a trade with more than two teams', () => {
    const [t] = readLeagueTrades([trade({
      roster_ids: [1, 2, 3],
      adds: { a: 2, b: 3, c: 1 },
      drops: { a: 1, b: 2, c: 3 },
    })], look);
    expect(t.sides).toHaveLength(3);
    // A ring, which is the case sides cannot describe at all: you pay 4000 for
    // 900, team 2 pays 3000 for 4000, team 3 pays 900 for 3000. Nobody traded
    // "with" anybody and team 3 still walks away with the most.
    expect(t.sides.map(s => s.net)).toEqual([-3100, 1000, 2100]);
    expect(t.verdict!.winner!.name).toBe('Team 3');
  });
});

/* ── the players, ranked ────────────────────────────────────────────────────
   "Best in the league" was ordered by the Rating, which is a DRAFT score: it
   prices the hole on your roster, the replacement at the position and where
   the board has him, and it is on record here as a worse predictor of points
   than ordering by production. Sorted by it, the list was answering a question
   nobody asked it. */
describe('ranking the league\'s players', () => {
  it('carries the price the rest of the app shows for the same player', () => {
    // A list whose number disagrees with the card it opens is a list nobody
    // can check, and the Rating is not a price.
    const some = model.allFits.slice(0, 12);
    expect(some.length).toBeGreaterThan(0);
    for (const x of some) {
      expect(x.value).toBeGreaterThan(0);
      expect(Math.round(x.value)).toBe(model.marketValue(x.id)!.pts);
    }
  });

  it('carries the projection, and withholds it off too small a sample', () => {
    const withProj = model.allFits.filter(x => x.proj != null);
    expect(withProj.length).toBeGreaterThan(0);
    for (const x of withProj) expect(x.proj).toBeGreaterThan(0);
    // The same number the player's own card prints, from the same function.
    const one = withProj[0];
    expect(one.proj).toBe(projectPPG(model.scoreAny(one.id)!.use));
  });

  it('does not put the Rating and the price in the same order', () => {
    /* If they agreed there would be nothing to fix. The two answer different
       questions — how good he is, and who to take at this pick — and a list
       sorted by one and read as the other is the whole of the bug. */
    const byValue = model.allFits.slice().sort((a, b) => b.value - a.value).map(x => x.id);
    const byFit = model.allFits.slice().sort((a, b) => b.fit - a.fit).map(x => x.id);
    expect(byValue.slice(0, 10)).not.toEqual(byFit.slice(0, 10));
  });
});

/* ── what a player actually did ─────────────────────────────────────────────
   A number of fantasy points says how much he was worth and nothing about how
   he got there, and the second is most of what anybody wants from a
   scoreboard: twenty off eight catches is a different week from twenty off one
   eighty-yard touchdown. */
describe('a player\'s stat line', () => {
  it('reads a quarterback as passing first', () => {
    expect(statLine({
      pass_cmp: 16, pass_att: 26, pass_yd: 204, pass_td: 2, pass_int: 1,
      rush_att: 8, rush_yd: 22, rush_td: 2,
    }, 'QB')).toBe('16/26 CMP, 204 YD, 2 TD, 1 INT, 8 CAR, 22 YD, 2 TD');
  });

  it('reads a back as carrying first and catching second', () => {
    expect(statLine({ rush_att: 19, rush_yd: 98, rush_td: 1, rec: 2, rec_tgt: 3, rec_yd: 5 }, 'RB'))
      .toBe('19 CAR, 98 YD, 1 TD, 2/3 REC, 5 YD');
  });

  it('reads a receiver the other way round', () => {
    expect(statLine({ rec: 6, rec_tgt: 10, rec_yd: 67 }, 'WR')).toBe('6/10 REC, 67 YD');
  });

  it('leaves out what did not happen', () => {
    // "0 TD" on every row is a column of nothing pretending to be information.
    expect(statLine({ rec: 3, rec_tgt: 4, rec_yd: 31, rec_td: 0, rush_att: 0 }, 'TE'))
      .toBe('3/4 REC, 31 YD');
    expect(statLine({}, 'WR')).toBe('');
    expect(statLine(undefined, 'WR')).toBe('');
  });

  it('keeps a kicker\'s misses, which are the whole of his line', () => {
    // What he was given and what he did with it: 1/3 has to be visible.
    expect(statLine({ fgm: 1, fga: 3, xpm: 2, xpa: 2 }, 'K')).toBe('1/3 FG, 2/2 XP');
  });

  it('says a shutout rather than saying nothing', () => {
    // The one place a zero is the story.
    expect(statLine({ pts_allow: 0, sack: 4 }, 'DEF')).toBe('0 PTS ALLOW, 4 SACK');
    expect(statLine({ pts_allow: 27, sack: 2 }, 'DEF')).toBe('27 PTS ALLOW, 2 SACK');
  });

  it('puts a lost fumble at the end, whoever lost it', () => {
    expect(statLine({ rush_att: 12, rush_yd: 40, fum_lost: 1 }, 'RB'))
      .toBe('12 CAR, 40 YD, 1 FUM LOST');
  });
});

/* ── power rankings ─────────────────────────────────────────────────────────
   A record is two numbers about a team and one about its luck. The all-play
   record removes the third: every week, every team against every other team
   that played, so the schedule has nothing left to say. */
describe('power rankings', () => {
  const wk = (week: number, points: Record<number, number>) =>
    Object.entries(points).map(([id, p]) => ({ rosterId: Number(id), week, points: p }));

  const row = (id: number, over: Partial<{ name: string; now: number; wins: number; losses: number; pointsFor: number; isMe: boolean }> = {}) => ({
    id,
    name: over.name ?? 'Team ' + id,
    isMe: over.isMe ?? false,
    avatar: null,
    now: over.now ?? 10,
    record: {
      wins: over.wins ?? 0, losses: over.losses ?? 0, ties: 0,
      label: (over.wins ?? 0) + '-' + (over.losses ?? 0),
      pointsFor: over.pointsFor ?? 0, pointsAgainst: 0,
    },
  } as unknown as import('../model/types').LeagueRow);

  it('scores every team against every other team that played', () => {
    // Four teams, one week: the top score beats three, the bottom beats none.
    const all = allPlayRecords(wk(1, { 1: 130, 2: 120, 3: 110, 4: 100 }));
    expect(all.get(1)).toMatchObject({ wins: 3, losses: 0 });
    expect(all.get(4)).toMatchObject({ wins: 0, losses: 3 });
    expect(all.get(2)!.pct).toBeCloseTo(2 / 3, 6);
  });

  it('splits a tie the way a record does', () => {
    const all = allPlayRecords(wk(1, { 1: 100, 2: 100, 3: 80 }));
    expect(all.get(1)).toMatchObject({ wins: 1, losses: 0, ties: 1 });
    // One win and half a tie out of two: three quarters.
    expect(all.get(1)!.pct).toBeCloseTo(0.75, 6);
  });

  it('measures nobody against a week they are alone in', () => {
    expect(allPlayRecords(wk(1, { 1: 100 })).size).toBe(0);
  });

  it('ranks the team that has outscored the league, not the one that won', () => {
    /* The whole point. Team 2 is 3-0 on the soft half of the schedule while
       scoring least; team 1 is 0-3 and has outscored everyone every week. */
    const scores = [
      ...wk(1, { 1: 140, 2: 90, 3: 120, 4: 80 }),
      ...wk(2, { 1: 138, 2: 88, 3: 118, 4: 78 }),
      ...wk(3, { 1: 136, 2: 86, 3: 116, 4: 76 }),
    ];
    const rows = [
      row(1, { wins: 0, losses: 3 }),
      row(2, { wins: 3, losses: 0 }),
      row(3, { wins: 2, losses: 1 }),
      row(4, { wins: 1, losses: 2 }),
    ];
    const power = powerRankings(rows, scores);
    expect(power.map(t => t.id)).toEqual([1, 3, 2, 4]);
    expect(power[0].allPlay.pct).toBe(1);
  });

  it('says out loud when a record is luck', () => {
    const scores = [
      ...wk(1, { 1: 140, 2: 90, 3: 120, 4: 80 }),
      ...wk(2, { 1: 138, 2: 88, 3: 118, 4: 78 }),
      ...wk(3, { 1: 136, 2: 86, 3: 116, 4: 76 }),
    ];
    const power = powerRankings([
      row(1, { wins: 0, losses: 3 }),
      row(2, { wins: 3, losses: 0 }),
      row(3, { wins: 2, losses: 1 }),
      row(4, { wins: 1, losses: 2 }),
    ], scores);
    const lucky = power.find(t => t.id === 2)!;
    const robbed = power.find(t => t.id === 1)!;
    /* Team 2 outscores only team 4, so a third of the league: its all-play
       record earns it one win of the three it has, and the other two are the
       schedule. Team 1 outscores everyone every week and has none of them. */
    expect(lucky.allPlay.pct).toBeCloseTo(1 / 3, 6);
    expect(lucky.luck).toBeCloseTo(2, 6);
    expect(lucky.read).toBe('Record flatters them');
    expect(robbed.luck).toBeCloseTo(-3, 6);
    expect(robbed.read).toBe('Record undersells them');
  });

  it('reads the roster only when it disagrees with the results', () => {
    // Every team level on scoring, so nothing but the roster is left to say.
    const scores = [...Array(4)].flatMap((_, i) => wk(i + 1, { 1: 100, 2: 100, 3: 100, 4: 100 }));
    const power = powerRankings([
      row(1, { now: 1, wins: 2, losses: 2 }),
      row(2, { now: 2, wins: 2, losses: 2 }),
      row(3, { now: 3, wins: 2, losses: 2 }),
      row(4, { now: 40, wins: 2, losses: 2 }),
    ], scores);
    expect(power.find(t => t.id === 4)!.rosterRank).toBe(1);
  });

  it('is the roster before a week has finished, not a third of it', () => {
    // Weights renormalise over what is there. Scoring the two missing parts as
    // zero would rank every team in the league at a third of its roster.
    const power = powerRankings([row(1, { now: 20 }), row(2, { now: 10 })], []);
    expect(power).toHaveLength(2);
    expect(power[0].weeks).toBe(0);
    expect(power[0].score).toBe(100);
    expect(power[1].score).toBe(50);
    // Nothing has been played, so there is no state to tag.
    expect(power[0].read).toBe('');
    expect(power[0].luck).toBe(0);
  });

  it('is the three parts weighted, and says so on the row', () => {
    const scores = [
      ...wk(1, { 1: 120, 2: 80 }), ...wk(2, { 1: 120, 2: 80 }),
    ];
    const power = powerRankings([
      row(1, { now: 20, wins: 2, losses: 0 }),
      row(2, { now: 10, wins: 0, losses: 2 }),
    ], scores);
    const top = power[0];
    // Beat everyone, best roster, won everything: every part at its maximum.
    expect(top.parts).toEqual({ points: 1, roster: 1, record: 1 });
    expect(top.score).toBe(100);
    // Lost every all-play, half the roster, lost every game.
    expect(power[1].parts).toEqual({ points: 0, roster: 0.5, record: 0 });
    expect(power[1].score).toBeCloseTo(WEIGHTS.roster * 0.5 * 100, 6);
  });

  it('lets the record move a team when the scoring is level', () => {
    // Identical every week, so points and roster cancel and only the record
    // is left to separate them — which is the whole of what it is for.
    const scores = [...Array(4)].flatMap((_, i) => wk(i + 1, { 1: 100, 2: 100 }));
    const power = powerRankings([
      row(1, { wins: 1, losses: 3 }),
      row(2, { wins: 3, losses: 1 }),
    ], scores);
    expect(power.map(t => t.id)).toEqual([2, 1]);
  });

  it('lets the roster move a team when the results are level', () => {
    // A trade lands the day it happens; the scoring catches up weeks later.
    const scores = [...Array(4)].flatMap((_, i) => wk(i + 1, { 1: 100, 2: 100 }));
    const power = powerRankings([
      row(1, { now: 10, wins: 2, losses: 2 }),
      row(2, { now: 30, wins: 2, losses: 2 }),
    ], scores);
    expect(power.map(t => t.id)).toEqual([2, 1]);
  });

  it('still puts the team that outscored the league over the one that won', () => {
    /* The record is in the score now and it is the smallest share of it, so a
       3-0 built on the soft half of the schedule must not outrank a 0-3 that
       has outscored everybody every week. */
    const scores = [
      ...wk(1, { 1: 140, 2: 90 }), ...wk(2, { 1: 138, 2: 88 }), ...wk(3, { 1: 136, 2: 86 }),
    ];
    const power = powerRankings([
      row(1, { wins: 0, losses: 3 }),
      row(2, { wins: 3, losses: 0 }),
    ], scores);
    expect(power.map(t => t.id)).toEqual([1, 2]);
  });

  it('counts the recent weeks for more than the old ones', () => {
    /* Two teams, mirror images: one started badly and finished well, the other
       the reverse. Their raw all-play records are identical and their seasons
       are not the same season. */
    const scores = [
      ...wk(1, { 1: 80, 2: 140 }), ...wk(2, { 1: 80, 2: 140 }),
      ...wk(3, { 1: 80, 2: 140 }), ...wk(4, { 1: 80, 2: 140 }),
      ...wk(5, { 1: 140, 2: 80 }), ...wk(6, { 1: 140, 2: 80 }),
      ...wk(7, { 1: 140, 2: 80 }), ...wk(8, { 1: 140, 2: 80 }),
    ];
    const all = allPlayRecords(scores);
    expect(all.get(1)!.pct).toBe(0.5);
    expect(all.get(2)!.pct).toBe(0.5);
    // The one winning now is ahead on form, and the ranking follows form.
    expect(all.get(1)!.form).toBeGreaterThan(0.65);
    expect(all.get(2)!.form).toBeLessThan(0.35);
    const power = powerRankings([row(1, { wins: 4, losses: 4 }), row(2, { wins: 4, losses: 4 })], scores);
    expect(power.map(t => t.id)).toEqual([1, 2]);
  });

  it('says where each team stood before the newest week', () => {
    /* Team 1 took the first three and team 2 the last two, which under the
       half-life is enough to have flipped them in week five and not in four.
       Equal records and equal rosters, so only the form can move anybody. */
    const scores = [
      ...wk(1, { 1: 140, 2: 80 }), ...wk(2, { 1: 140, 2: 80 }), ...wk(3, { 1: 140, 2: 80 }),
      ...wk(4, { 1: 80, 2: 140 }), ...wk(5, { 1: 80, 2: 140 }),
    ];
    const rows = [row(1, { wins: 2, losses: 3 }), row(2, { wins: 2, losses: 3 })];
    expect(powerRankings(rows, scores.filter(x => x.week < 5)).map(t => t.id)).toEqual([1, 2]);

    const power = powerRankings(rows, scores);
    expect(power.map(t => t.id)).toEqual([2, 1]);
    expect(power.find(t => t.id === 2)!.move).toBe(1);
    expect(power.find(t => t.id === 2)!.was).toBe(2);
    expect(power.find(t => t.id === 1)!.move).toBe(-1);
  });

  /* The ranking used to take every week before the one on the clock, and
     Sleeper's week does not roll until Tuesday — so all Monday night a
     finished week was thrown out while the records beside it already counted
     it, and a team that had just scored the league's worst week sat top of
     the page on an average that did not include it. */
  it('counts a week as soon as its results are in', () => {
    const scores = [
      ...wk(1, { 1: 140, 2: 80 }), ...wk(2, { 1: 140, 2: 80 }),
      ...wk(3, { 1: 60, 2: 160 }),
    ];
    expect([...finishedWeeks(scores, 2)].sort()).toEqual([1, 2, 3]);
    const power = powerRankings([row(1, { wins: 2, losses: 1 }), row(2, { wins: 1, losses: 2 })], scores);
    // (140 + 140 + 60) / 3, not (140 + 140) / 2.
    expect(power.find(t => t.id === 1)!.ppg).toBe(113.3);
    expect(power.find(t => t.id === 1)!.weeks).toBe(3);
  });

  it('leaves out a week the league is still playing', () => {
    // Somebody's players have not kicked off, so the week is not a result yet.
    const scores = [...wk(1, { 1: 140, 2: 80 }), ...wk(2, { 1: 96, 2: 0 })];
    expect([...finishedWeeks(scores, 2)]).toEqual([1]);
    const power = powerRankings([row(1, { wins: 1 }), row(2, { losses: 1 })], scores);
    expect(power.find(t => t.id === 1)!.ppg).toBe(140);
    expect(power.find(t => t.id === 1)!.weeks).toBe(1);
  });

  it('leaves out a week the feed only half sent', () => {
    // Ten rows in a twelve-team league is a week still arriving, and ranking
    // on it would credit the two missing teams with having been outscored.
    expect([...finishedWeeks(wk(1, { 1: 100, 2: 90 }), 4)]).toEqual([]);
  });

  it('has no movement to report off a single week', () => {
    const power = powerRankings([row(1), row(2)], wk(1, { 1: 120, 2: 80 }));
    expect(power.every(t => t.was === null && t.move === 0)).toBe(true);
  });

  it('measures how far a normal week lands from a team\'s average', () => {
    /* Same average, same record, opposite temperaments: one is 100 every week
       and the other cycles 40/160/100. A standings table cannot tell them
       apart and this is the column that can. */
    const scores = [
      ...wk(1, { 1: 100, 2: 40 }), ...wk(2, { 1: 100, 2: 160 }), ...wk(3, { 1: 100, 2: 100 }),
      ...wk(4, { 1: 100, 2: 40 }), ...wk(5, { 1: 100, 2: 160 }), ...wk(6, { 1: 100, 2: 100 }),
    ];
    const power = powerRankings([row(1, { wins: 3, losses: 3 }), row(2, { wins: 3, losses: 3 })], scores);
    const steady = power.find(t => t.id === 1)!;
    const wild = power.find(t => t.id === 2)!;
    expect(steady.ppg).toBe(100);
    expect(wild.ppg).toBe(100);
    expect(steady.swing).toBe(0);
    expect(wild.swing).toBe(49);
    expect(steady.steadiest).toBe(true);
    expect(wild.swingiest).toBe(true);
    expect(steady.read).toBe('Same team every Sunday');
    expect(wild.read).toBe('Wildest week to week');
  });

  it('prints the record the scoring earned', () => {
    const scores = [
      ...wk(1, { 1: 140, 2: 80 }), ...wk(2, { 1: 140, 2: 80 }),
      ...wk(3, { 1: 140, 2: 80 }), ...wk(4, { 1: 140, 2: 80 }),
    ];
    const power = powerRankings([row(1, { wins: 1, losses: 3 }), row(2, { wins: 3, losses: 1 })], scores);
    // Outscored the league every week and lost three of four.
    expect(power.find(t => t.id === 1)!.expected).toEqual({ wins: 4, losses: 0 });
    expect(power.find(t => t.id === 2)!.expected).toEqual({ wins: 0, losses: 4 });
  });

  it('reads a team that is heating up', () => {
    // Level all season, then three big weeks: the average hides it, the tail
    // does not, which is the only reason "lately" is a column at all.
    const scores = [
      ...wk(1, { 1: 80, 2: 100 }), ...wk(2, { 1: 80, 2: 100 }),
      ...wk(3, { 1: 140, 2: 100 }), ...wk(4, { 1: 140, 2: 100 }), ...wk(5, { 1: 140, 2: 100 }),
    ];
    const power = powerRankings([row(1, { wins: 3, losses: 2 }), row(2, { wins: 2, losses: 3 })], scores);
    const hot = power.find(t => t.id === 1)!;
    expect(hot.recent).toBe(140);
    expect(hot.ppg).toBe(116);
    expect(hot.read).toBe('Heating up');
  });
});

/* ── reading Sleeper's projection feed ──────────────────────────────────────
   Undocumented, so the parser is written to survive it rather than to assume
   it, and the totals are re-scored in the league's own settings: the three
   pre-totalled numbers it ships are right for exactly three leagues. */
describe('Sleeper\'s weekly projections', () => {
  // Six-point passing touchdowns and a tight-end premium — the two settings
  // that make pts_half_ppr wrong by several points a week for one position.
  const SCORING = {
    pass_yd: 0.04, pass_td: 6, pass_int: -2,
    rec: 0.5, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 0.5,
    rush_yd: 0.1, rush_td: 6, fum_lost: -2,
  };
  const qb = { pass_yd: 275, pass_td: 2, pass_int: 1, rush_yd: 20, pts_half_ppr: 18.4 };

  it('scores the projected stat line in the league\'s own settings', () => {
    // 11 + 12 − 2 + 2 = 23, where half-PPR's four-point passing TD says 18.4.
    expect(scoreProjection(qb, SCORING)).toBeCloseTo(23, 6);
  });

  it('falls back to the pre-totalled number when the league has no settings', () => {
    expect(scoreProjection(qb, null)).toBe(18.4);
    expect(scoreProjection(qb, {})).toBe(18.4);
  });

  it('picks the pre-totalled number that matches the league', () => {
    const line = { pts_std: 10, pts_half_ppr: 13, pts_ppr: 16 };
    expect(scoreProjection(line, null, scoringKind({ rec: 1 }))).toBe(16);
    expect(scoreProjection(line, null, scoringKind({ rec: 0.5 }))).toBe(13);
    expect(scoreProjection(line, null, scoringKind({ rec: 0 }))).toBe(10);
    // No `rec` at all is a league we cannot read; half is the common ground.
    expect(scoringKind({})).toBe('half');
  });

  it('does not report a nought when the column names have moved', () => {
    // Nothing in the line matches anything the league pays for. That is a feed
    // that changed, not a player projected to score nothing, and a confident
    // zero on a scoreboard is the worst of the three available answers.
    expect(scoreProjection({ points_half_ppr: 14, pts_half_ppr: 14 }, { pass_yd: 0.04 })).toBe(14);
    expect(scoreProjection({ xx: 1 }, { pass_yd: 0.04 })).toBe(null);
    expect(scoreProjection(null, SCORING)).toBe(null);
  });

  it('reads the feed as a list or as a map, nested or flat', () => {
    const flatMap = readProjections({ '4046': { pts_half_ppr: 21 } }, null);
    expect(flatMap['4046']).toBe(21);
    const nestedList = readProjections([{ player_id: '4046', stats: { pts_half_ppr: 21 } }], null);
    expect(nestedList['4046']).toBe(21);
    const nestedMap = readProjections({ '4046': { stats: { pts_half_ppr: 21 } } }, null);
    expect(nestedMap['4046']).toBe(21);
    const viaPlayer = readProjections([{ player: { player_id: '9' }, stats: { pts_half_ppr: 8 } }], null);
    expect(viaPlayer['9']).toBe(8);
  });

  /* The projections are not a fact about the week, they are Sleeper's current
     opinion of it. Under a cache with no age on it the first read of a week
     was the last, and a starter ruled out on Sunday morning never moved the
     number on the card. */
  it('goes back to the feed once its answer has aged out', () => {
    const TTL = 300000;
    expect(projectionsAreStale(undefined, 1000, TTL)).toBe(true);
    expect(projectionsAreStale({ at: 1000 }, 1000 + TTL - 1, TTL)).toBe(false);
    expect(projectionsAreStale({ at: 1000 }, 1000 + TTL, TTL)).toBe(true);
    expect(projectionsAreStale({ at: 1000 }, 1000 + TTL * 9, TTL)).toBe(true);
  });

  it('asks again straight away when somebody presses refresh', () => {
    // A button is a request for the number now, not for whatever is in hand.
    expect(projectionsAreStale({ at: 1000 }, 1001, 300000, true)).toBe(true);
  });

  /* Week 4 drew week 3's yards under week 4's 0.00: the scores came from the
     matchup feed, which changes week the moment you turn the page, and the
     stat lines came from a payload that had nothing to say about a week the
     NFL had not played yet, so the old map simply stayed on screen. */
  it('draws no stat line for a week it is not holding', () => {
    const wk3 = { wk: 3, map: { '4046': { rec_yd: 155 } } };
    expect(statsForWeek(wk3, 3)).toEqual({ '4046': { rec_yd: 155 } });
    expect(statsForWeek(wk3, 4)).toEqual({});
    expect(statsForWeek(wk3, 2)).toEqual({});
  });

  it('draws no stat line before anything is held, or with no week on screen', () => {
    expect(statsForWeek({ wk: 0, map: {} }, 4)).toEqual({});
    expect(statsForWeek({ wk: 4, map: { '4046': { rec_yd: 155 } } }, null)).toEqual({});
  });

  it('leaves out what it cannot read instead of falling over', () => {
    expect(readProjections(null, null)).toEqual({});
    expect(readProjections('nope', null)).toEqual({});
    expect(readProjections([1, null, { no_id: true }], null)).toEqual({});
    expect(readProjections([{ player_id: 'a' }, { player_id: 'b', stats: { pts_half_ppr: 9 } }], null))
      .toEqual({ b: 9 });
  });
});

describe('the league\'s matchups', () => {
  const teams = [
    { id: 1, name: 'Cuboys', avatar: null, isMe: true },
    { id: 2, name: 'Maulozano', avatar: null, isMe: false },
    { id: 3, name: 'Third', avatar: null, isMe: false },
    { id: 4, name: 'Fourth', avatar: null, isMe: false },
  ];
  const row = (roster_id: number, matchup_id: number | null, points: number | null) =>
    ({ roster_id, matchup_id, points });

  it('pairs the two rosters that share a matchup id', () => {
    const out = pairMatchups(teams, [row(3, 9, 88), row(4, 9, 91)]);
    expect(out).toHaveLength(1);
    expect([out[0].a.name, out[0].b!.name].sort()).toEqual(['Fourth', 'Third']);
  });

  it('puts your own game first and you on the left of it', () => {
    const out = pairMatchups(teams, [row(3, 9, 88), row(4, 9, 91), row(2, 7, 70), row(1, 7, 102)]);
    expect(out[0].hasMe).toBe(true);
    expect(out[0].a.name).toBe('Cuboys');
    expect(out[0].b!.name).toBe('Maulozano');
    expect(out[1].hasMe).toBe(false);
  });

  it('keeps a team on a bye rather than dropping it off the screen', () => {
    const out = pairMatchups(teams, [row(3, null, 0)]);
    expect(out).toHaveLength(1);
    expect(out[0].b).toBe(null);
    expect(out[0].a.name).toBe('Third');
  });

  it('ignores a roster the league no longer lists', () => {
    expect(pairMatchups(teams, [row(99, 4, 50)])).toHaveLength(0);
  });

  it('names the manager, but not twice', () => {
    // A team called "Brady Bunch" says nothing about who you are playing. A
    // team called "Konoha" managed by Konoha says it once, and "@Konoha"
    // under it is the same word in a 30px column.
    const named = [
      { id: 1, name: 'Cuboys', user: 'jorgeleal', avatar: null, isMe: true },
      { id: 2, name: 'Konoha', user: 'Konoha', avatar: null, isMe: false },
    ];
    const [g] = pairMatchups(named, [row(1, 7, 0), row(2, 7, 0)]);
    expect(g.a.user).toBe('jorgeleal');
    expect(g.b!.user).toBe('');
  });

  it('names a leader only once both sides have scored something different', () => {
    const [live] = pairMatchups(teams, [row(1, 7, 102), row(2, 7, 70)]);
    expect(leaderOf(live)).toBe('a');
    const [tied] = pairMatchups(teams, [row(1, 7, 70), row(2, 7, 70)]);
    expect(leaderOf(tied)).toBe(null);
    const [unplayed] = pairMatchups(teams, [row(1, 7, null), row(2, 7, null)]);
    expect(leaderOf(unplayed)).toBe(null);
  });

  it('treats a scoreless kickoff as a score, not as missing', () => {
    // 0-0 before kickoff is a real state; showing a dash there would read as
    // "Sleeper is down" rather than "nobody has played yet".
    const [m] = pairMatchups(teams, [row(1, 7, 0), row(2, 7, 0)]);
    expect(m.a.points).toBe(0);
    expect(leaderOf(m)).toBe(null);
  });

  /* ── the lineups behind a card ────────────────────────────────────────────
     Opening a matchup is meant to answer "where is this game being won", so
     the two lineups are paired slot against slot rather than listed one team
     after the other. */
  describe('opened up', () => {
    const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'IR'];
    const players: Record<string, SleeperPlayer> = {
      p1: { player_id: 'p1', full_name: 'Josh Allen', position: 'QB', team: 'BUF' },
      p2: { player_id: 'p2', first_name: 'Bijan', last_name: 'Robinson', position: 'RB', team: 'ATL' },
      p3: { player_id: 'p3', full_name: 'Jalen Hurts', position: 'QB', team: 'PHI' },
      p4: { player_id: 'p4', full_name: 'Puka Nacua', position: 'WR', team: 'LAR' },
    };
    const withLineup = (
      roster_id: number, matchup_id: number, points: number,
      starters: string[], players_points: Record<string, number>,
    ) => ({ roster_id, matchup_id, points, starters, players_points });

    const game = () => pairMatchups(teams, [
      withLineup(1, 7, 40, ['p1', 'p2'], { p1: 25.4, p2: 14.6 }),
      withLineup(2, 7, 18, ['p3', '0'], { p3: 18.2 }),
    ])[0];

    it('faces the two lineups off a slot at a time', () => {
      const rows = lineupRows(game(), SLOTS, players);
      expect(rows.map(r => r.slot)).toEqual(['QB', 'RB']);
      expect(rows[0].a!.name).toBe('J. Allen');
      expect(rows[0].b!.name).toBe('J. Hurts');
      expect(rows[0].a!.points).toBe(25.4);
      expect(rows[0].b!.points).toBe(18.2);
    });

    it('builds a name out of the parts when there is no full one', () => {
      const rows = lineupRows(game(), SLOTS, players);
      expect(rows[1].a!.name).toBe('B. Robinson');
    });

    /* The bench is not a lineup, and a league that starts seven would have had
       three phantom rows off the end of the ten it lists. */
    it('counts only the slots a lineup is actually made of', () => {
      expect(startingSlots(SLOTS)).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']);
      expect(startingSlots(null)).toEqual([]);
    });

    /* An empty slot is where a week gets lost, so it is shown as one rather
       than left blank or quietly skipped. */
    it('shows a slot the manager never filled', () => {
      const rows = lineupRows(game(), SLOTS, players);
      expect(rows[1].b).toEqual({
        id: null, name: 'Empty', pos: '', team: null, points: null, projected: null,
      });
    });

    /* ── Sleeper's own projections ──────────────────────────────────────────
       Read defensively, scored in the league's settings, and withheld rather
       than understated — the same rule the team projection follows. */
    it('carries a projection down to the player row', () => {
      const rows = lineupRows(game(), SLOTS, players, { p1: 22.5, p3: 19.1 });
      expect(rows[0].a!.projected).toBe(22.5);
      expect(rows[0].b!.projected).toBe(19.1);
      // Nobody projected him: that is not a projection of zero, which on a
      // scoreboard would read as "he will not score".
      expect(rows[1].a!.projected).toBe(null);
    });

    it('adds the starters up into the number beside the score', () => {
      const [g] = pairMatchups(teams, [
        withLineup(1, 7, 40, ['p1', 'p2'], {}),
        withLineup(2, 7, 18, ['p3', 'p4'], {}),
      ], { p1: 22.5, p2: 14.2, p3: 19.1, p4: 11.9 });
      expect(g.a.projected).toBe(36.7);
      expect(g.b!.projected).toBe(31);
    });

    it('withholds a total it could only half price', () => {
      const [g] = pairMatchups(teams, [
        withLineup(1, 7, 40, ['p1', 'p2', 'p4'], {}),
        withLineup(2, 7, 18, ['p3', '0'], {}),
      ], { p1: 22.5, p3: 19.1 });
      // One of three starters priced is not a smaller projection, it is a
      // wrong one. The empty slot on the other side counts as priced, because
      // nothing is exactly what it will score.
      expect(g.a.projected).toBe(null);
      expect(g.b!.projected).toBe(19.1);
    });

    it('says nothing at all when no projections arrived', () => {
      // Not even the score: a projection equal to what a team has already put
      // up says it will finish on exactly that, which is a lie while the games
      // are on and noise once they are over.
      expect(game().a.projected).toBe(null);
    });

    it('counts what a lineup has already scored toward the projection', () => {
      /* The number people want from a scoreboard: it starts at the plain
         projection, walks with the score, and lands on it. */
      const kicked = pairMatchups(teams, [
        withLineup(1, 7, 25.4, ['p1', 'p2'], { p1: 25.4 }),
      ], { p1: 22.5, p2: 14.2 })[0];
      // p1 has played and scored 25.4; p2 has not and is worth his 14.2.
      expect(kicked.a.projected).toBe(39.6);

      const kickoff = pairMatchups(teams, [
        withLineup(1, 7, 0, ['p1', 'p2'], {}),
      ], { p1: 22.5, p2: 14.2 })[0];
      expect(kickoff.a.projected).toBe(36.7);

      const over = pairMatchups(teams, [
        withLineup(1, 7, 41.1, ['p1', 'p2'], { p1: 25.4, p2: 15.7 }),
      ], { p1: 22.5, p2: 14.2 })[0];
      expect(over.a.projected).toBe(41.1);
    });

    it('keeps the slot labels when only one side has posted a lineup', () => {
      const half = pairMatchups(teams, [
        withLineup(1, 7, 40, ['p1', 'p4'], { p1: 25.4, p4: 14.6 }),
        { roster_id: 2, matchup_id: 7, points: 0 },
      ])[0];
      const rows = lineupRows(half, SLOTS, players);
      expect(rows).toHaveLength(2);
      expect(rows[0].a!.name).toBe('J. Allen');
      expect(rows[0].b).toBe(null);
      expect(rows[0].slot).toBe('QB');
    });

    it('has nothing to draw before Sleeper publishes any lineup', () => {
      const bare = pairMatchups(teams, [row(1, 7, 0), row(2, 7, 0)])[0];
      expect(lineupRows(bare, SLOTS, players)).toEqual([]);
    });

    /* A started player the league lists no slot for would otherwise vanish. */
    it('still draws a starter past the end of the slot list', () => {
      const long = pairMatchups(teams, [
        withLineup(1, 7, 40, ['p1', 'p2'], { p1: 25.4, p2: 14.6 }),
        { roster_id: 2, matchup_id: 7, points: 0 },
      ])[0];
      expect(lineupRows(long, ['QB'], players)).toHaveLength(2);
      expect(lineupRows(long, ['QB'], players)[1].slot).toBe('FLEX');
    });

    it('tells a player apart from the slot he is filling', () => {
      const flexed = pairMatchups(teams, [
        withLineup(1, 7, 14, ['p4'], { p4: 14.6 }),
        { roster_id: 2, matchup_id: 7, points: 0 },
      ])[0];
      // a receiver in the flex is still a receiver, which is what colours him
      expect(lineupRows(flexed, ['FLEX'], players)[0].a!.pos).toBe('WR');
    });
  });
});

describe('who wins a proposed trade', () => {
  const teams = [
    { id: 1, name: 'You', isMe: true },
    { id: 2, name: 'Maulozano', isMe: false },
    { id: 3, name: 'Third', isMe: false },
  ];
  const a = (id: string, value: number, from: number, to: number) =>
    ({ id, name: id, value, from, to });

  it('names you the winner when you take back more than you send', () => {
    const v = evaluateTrade(teams.slice(0, 2), [a('gibbs', 8000, 2, 1), a('spare', 3000, 1, 2)]);
    expect(v.winner?.isMe).toBe(true);
    expect(v.ledgers[0].net).toBe(5000);
    expect(v.ledgers[1].net).toBe(-5000);
    expect(verdictLine(v)).toContain('You win');
  });

  it('calls a close deal even rather than inventing a winner', () => {
    // Two percent apart: inside what an approximate market can tell apart.
    const v = evaluateTrade(teams.slice(0, 2), [a('x', 5100, 2, 1), a('y', 5000, 1, 2)]);
    expect(v.winner).toBe(null);
    expect(v.ledgers.every(l => l.standing === 'even')).toBe(true);
    expect(verdictLine(v)).toContain('Even trade');
  });

  it('scales the band with the size of the deal', () => {
    // The same 100-point gap decides a small trade and not a large one.
    const small = evaluateTrade(teams.slice(0, 2), [a('x', 600, 2, 1), a('y', 500, 1, 2)]);
    expect(small.winner?.isMe).toBe(true);
    const big = evaluateTrade(teams.slice(0, 2), [a('x', 20100, 2, 1), a('y', 20000, 1, 2)]);
    expect(big.winner).toBe(null);
  });

  it('handles three teams in a ring, where no two are trading with each other', () => {
    const v = evaluateTrade(teams, [
      a('p1', 9000, 1, 2),
      a('p2', 5000, 2, 3),
      a('p3', 4000, 3, 1),
    ]);
    expect(v.ledgers).toHaveLength(3);
    // Every asset is counted once on each side of the league's books.
    expect(v.ledgers.reduce((s, l) => s + l.net, 0)).toBe(0);
    const third = v.ledgers.find(l => l.name === 'Third')!;
    expect(third.got.map(x => x.id)).toEqual(['p2']);
    expect(third.gave.map(x => x.id)).toEqual(['p3']);
    expect(v.winner?.name).toBe('Maulozano');
  });

  it('flags a team that gives and gets nothing back', () => {
    const v = evaluateTrade(teams, [a('p1', 9000, 3, 1), a('p2', 4000, 1, 2)]);
    expect(v.problems.join(' ')).toContain('Third gives and gets nothing back');
  });

  it('flags a team nothing moves for', () => {
    const v = evaluateTrade(teams, [a('p1', 9000, 1, 2), a('p2', 8800, 2, 1)]);
    expect(v.problems.join(' ')).toContain('Third is in the trade but nothing moves');
  });

  it('drops an asset sent to its own owner, or to nobody in the deal', () => {
    const v = evaluateTrade(teams.slice(0, 2), [
      a('self', 5000, 1, 1),
      a('outside', 5000, 1, 9),
      a('real', 1000, 2, 1),
    ]);
    expect(v.moved).toBe(1000);
    expect(v.ledgers.find(l => l.isMe)!.got.map(x => x.id)).toEqual(['real']);
  });

  it('says nothing is in the trade before anything is picked', () => {
    expect(verdictLine(evaluateTrade(teams, []))).toBe('Nothing in the trade yet');
  });
});

describe('the fit half of a trade verdict', () => {
  const two = [
    { id: 1, name: 'You', isMe: true },
    { id: 2, name: 'Them', isMe: false },
  ];
  const a = (id: string, value: number, from: number, to: number) =>
    ({ id, name: id, value, from, to });
  const swap = [a('in', 5000, 2, 1), a('out', 5000, 1, 2)];

  it('says nothing about the lineup when nobody measured it', () => {
    const v = evaluateTrade(two, swap);
    expect(v.ledgers.every(l => l.fitDelta === null)).toBe(true);
    expect(fitLine(v)).toBe(null);
  });

  it('reports the lineup change on its own terms', () => {
    const v = evaluateTrade(two, swap, { 1: 6.4, 2: -6.4 });
    expect(fitLine(v)).toContain('gains 6.4 pts');
  });

  it('calls out a deal that loses on value and wins on fit', () => {
    // You overpay badly, and it still fixes the hole you could not field.
    const v = evaluateTrade(two, [a('star', 9000, 2, 1), a('haul', 14000, 1, 2)], { 1: 8.2 });
    expect(v.ledgers.find(l => l.isMe)!.standing).toBe('loses');
    expect(fitLine(v)).toContain('pay over market');
  });

  it('calls out a deal that wins on value and costs you a starter', () => {
    const v = evaluateTrade(two, [a('haul', 14000, 2, 1), a('star', 9000, 1, 2)], { 1: -5.1 });
    expect(v.ledgers.find(l => l.isMe)!.standing).toBe('wins');
    expect(fitLine(v)).toContain('selling from your starters');
  });

  it('does not dress a tenth of a point up as a lineup change', () => {
    const v = evaluateTrade(two, swap, { 1: 0.04 });
    expect(fitLine(v)).toBe('Your lineup is unchanged');
  });

  it('keeps the value verdict untouched by the fit', () => {
    const bare = evaluateTrade(two, swap);
    const withFit = evaluateTrade(two, swap, { 1: 40, 2: -40 });
    expect(withFit.winner).toBe(bare.winner);
    expect(withFit.ledgers.map(l => l.net)).toEqual(bare.ledgers.map(l => l.net));
  });
});

describe('what is worth moving in a trade', () => {
  const TEAMS = 12;
  const base = { pos: 'RB' as const, depth: 3, startsAt: 2, senderRank: 4, receiverRank: 4, teamCount: TEAMS };

  it('warns off a starter at a position the team is already thin at', () => {
    const r = readPick({ ...base, depth: 1, senderRank: 11 });
    expect(r.tag).toBe('core');
    expect(r.score).toBeLessThan(0);
    expect(r.why).toContain('thin at RB');
  });

  it('ranks a spare who fills their hole above everything else', () => {
    const spareAndNeeded = readPick({ ...base, depth: 3, senderRank: 3, receiverRank: 11 });
    const justNeeded = readPick({ ...base, depth: 1, senderRank: 3, receiverRank: 11 });
    const justSpare = readPick({ ...base, depth: 3, senderRank: 3, receiverRank: 2 });
    expect(spareAndNeeded.tag).toBe('surplus');
    expect(spareAndNeeded.score).toBeGreaterThan(justNeeded.score);
    expect(justNeeded.score).toBeGreaterThan(justSpare.score);
  });

  it('says nothing about a player who is neither spare nor needed', () => {
    const r = readPick({ ...base, depth: 1, senderRank: 4, receiverRank: 3 });
    expect(r.tag).toBe(null);
    expect(r.why).toBe('');
  });

  it('counts a flex as half a slot, so the third back is not called spare', () => {
    // 2 RB + a flex: a third runner starts often enough to matter.
    expect(startsAt(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'], 'RB')).toBe(3);
    expect(startsAt(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'BN'], 'RB')).toBe(2);
    // A superflex means the second quarterback is a starter, not a backup.
    expect(startsAt(['QB', 'SUPER_FLEX', 'RB', 'WR'], 'QB')).toBe(2);
  });

  it('always starts at least one of a position it lists', () => {
    expect(startsAt(['QB', 'FLEX'], 'RB')).toBe(1);
    expect(startsAt([], 'QB')).toBe(1);
  });

  it('reads a depth chart off value alone', () => {
    const list = [
      { id: 'a', pos: 'RB', q: 90 },
      { id: 'b', pos: 'RB', q: 40 },
      { id: 'c', pos: 'WR', q: 95 },
    ];
    expect(depthOf(list, list[0])).toBe(1);
    expect(depthOf(list, list[1])).toBe(2);
    // A different position has its own chart, not a place on the roster's.
    expect(depthOf(list, list[2])).toBe(1);
  });
});

describe('a team\'s record', () => {
  const roster = (settings: Record<string, number>) => ({ roster_id: 1, owner_id: 'u', settings });

  it('rejoins the two halves Sleeper stores a score in', () => {
    // 1,284.56 arrives as 1284 and 56. Read straight, it is 1284 or 128456.
    const r = readRecord(roster({ fpts: 1284, fpts_decimal: 56, fpts_against: 1190, fpts_against_decimal: 4 }));
    expect(r.pointsFor).toBe(1284.56);
    expect(r.pointsAgainst).toBe(1190.04);
  });

  it('leaves the ties column out of a league that has none', () => {
    expect(readRecord(roster({ wins: 7, losses: 3, ties: 0 })).label).toBe('7-3');
    expect(readRecord(roster({ wins: 7, losses: 3, ties: 1 })).label).toBe('7-3-1');
  });

  it('reads an empty roster as 0-0 rather than falling over', () => {
    const r = readRecord(null);
    expect(r.label).toBe('0-0');
    expect(r.pointsFor).toBe(0);
    expect(hasPlayed(r)).toBe(false);
  });

  it('knows whether the season has started', () => {
    expect(hasPlayed(readRecord(roster({ wins: 0, losses: 0 })))).toBe(false);
    expect(hasPlayed(readRecord(roster({ wins: 0, losses: 1 })))).toBe(true);
    // A season whose only result is a tie has still been played.
    expect(hasPlayed(readRecord(roster({ ties: 1 })))).toBe(true);
  });
});

describe('what a team scores and what it should', () => {
  const slot = (ppgAdj: number | null) => ({
    slot: 'RB',
    player: { id: 'x', use: ppgAdj == null ? undefined : { ppgAdj } },
  } as unknown as import('../model/types').LineupSlot);
  const rec = (wins: number, losses: number, pointsFor: number) =>
    ({ wins, losses, ties: 0, label: '', pointsFor, pointsAgainst: 0 });

  it('adds up only the starters it can actually price', () => {
    const p = projectLineup([slot(18.2), slot(11.4), slot(null)]);
    expect(p.total).toBe(29.6);
    expect(p.counted).toBe(2);
    expect(p.slots).toBe(3);
  });

  it('refuses to call a mostly unpriced lineup a projection', () => {
    // Six of nine is not a smaller projection, it is a wrong one.
    const mostly = projectLineup([...Array(7)].map(() => slot(10)).concat([slot(null), slot(null)]));
    const half = projectLineup([...Array(5)].map(() => slot(10)).concat([...Array(4)].map(() => slot(null))));
    expect(projectionIsSound(mostly)).toBe(true);
    expect(projectionIsSound(half)).toBe(false);
    expect(projectionIsSound(projectLineup([]))).toBe(false);
  });

  it('averages the points actually scored', () => {
    expect(scoringAverage(rec(3, 1, 449.2))).toBe(112.3);
  });

  it('says nothing before a game has been played', () => {
    expect(scoringAverage(rec(0, 0, 0))).toBe(null);
  });

  it('averages the league over the teams that have played', () => {
    const rows = [
      { record: rec(2, 0, 200) },
      { record: rec(1, 1, 180) },
      { record: rec(0, 0, 0) },
    ] as unknown as import('../model/types').LeagueRow[];
    // 100 and 90 — the team with no games does not drag the mean to 63.3.
    expect(leagueScoringAverage(rows)).toBe(95);
  });

  /* ── the league's own points ───────────────────────────────────────────────
   * The screen printed a 128.1 average beside an 83.6 projection for the same
   * roster. Both were right and neither was comparable: the average is what
   * this league pays, the projection was half-PPR over the skill slots alone,
   * with no kicker, no defence and no full point for a catch. */
  const row = (pointsFor: number, games: number, projTotal: number, slots = 9) => ({
    record: { wins: games, losses: 0, ties: 0, label: '', pointsFor, pointsAgainst: 0 },
    proj: { total: projTotal, counted: slots, slots },
  } as unknown as import('../model/types').LeagueRow);

  /** Twelve teams averaging 128 a week off lineups that sum to 95 in half-PPR. */
  const league = () => [...Array(12)].map((_, i) => row(128 * 4 + i, 4, 95 + (i % 3)));

  it('states the projection in the points the league actually scores', () => {
    const rows = league();
    const scale = leagueProjectionScale(rows) as number;
    expect(scale).toBeGreaterThan(1.3);
    // The team whose lineup was reading 83.6 lands near the league's own scale,
    // not a third under it.
    const mine = projectedPoints({ total: 83.6, counted: 9, slots: 9 }, scale) as number;
    expect(mine).toBeGreaterThan(110);
    expect(mine).toBeLessThan(120);
  });

  it('leaves the order of the teams alone', () => {
    // A scale is allowed to change the units and nothing else: the spread
    // between two lineups has to survive it.
    const scale = leagueProjectionScale(league()) as number;
    const a = projectedPoints({ total: 110, counted: 9, slots: 9 }, scale) as number;
    const b = projectedPoints({ total: 90, counted: 9, slots: 9 }, scale) as number;
    expect(a / b).toBeCloseTo(110 / 90, 3);
  });

  it('withholds the number rather than printing the wrong currency', () => {
    // No scale is not "roughly right" — it is half-PPR where the rest of the
    // screen is in league points.
    expect(projectedPoints({ total: 83.6, counted: 9, slots: 9 }, null)).toBe(null);
    // Three teams is a guess, not a measurement.
    expect(leagueProjectionScale(league().slice(0, 3))).toBe(null);
    // Nobody has played, so there is nothing to calibrate against.
    expect(leagueProjectionScale(league().map(r => row(0, 0, r.proj.total)))).toBe(null);
  });

  it('refuses a factor that says the two sides are not the same sport', () => {
    // Lineups summing to 12 against a 128-point average is not a scoring
    // difference, it is a broken usage feed, and 10.7× would hide it.
    expect(leagueProjectionScale([...Array(12)].map(() => row(512, 4, 12)))).toBe(null);
  });

  it('puts a real league on one scale instead of two', () => {
    // The shape of the complaint, end to end: a league scoring a hundred and
    // sixty a week, off lineups this model prices at a hundred and eighteen
    // because it knows nothing about full PPR, six-point passing touchdowns,
    // or the kicker and the defence that have no slot in `ELIG`.
    const b = makeBundle();
    b.rosters.forEach(r => { r.settings = { wins: 4, losses: 0, ties: 0, fpts: 640, fpts_decimal: 0 }; });
    const mm = buildModel({ data: b, usage, market, strat: 'balanced', boardMode: 'rookies', pickSel: 0 });
    const raw = projectLineup(mm.optimal);
    const scale = leagueProjectionScale(mm.leagueRows) as number;
    const shown = projectedPoints(raw, scale) as number;

    expect(mm.leagueRows.every(r => projectionIsSound(r.proj))).toBe(true);
    expect(scale).toBeGreaterThan(1.2);
    // The number on the card belongs beside the 160 average, not a third under it.
    expect(Math.abs(shown - 160)).toBeLessThan(40);
    expect(Math.abs(raw.total - 160)).toBeGreaterThan(40);
  });

  it('will not scale a lineup it could not price', () => {
    const half = projectLineup([...Array(5)].map(() => slot(10)).concat([...Array(4)].map(() => slot(null))));
    expect(projectedPoints(half, 1.35)).toBe(null);
    // And a team like that is kept out of the scale everyone else is measured on.
    const rows = league().concat([row(512, 4, 20, 9)]);
    rows[12].proj.counted = 4;
    expect(leagueProjectionScale(rows)).toBeCloseTo(leagueProjectionScale(league()) as number, 2);
  });
});

describe('who counts as still in the league', () => {
  const BASE = {
    player_id: 'x', first_name: 'A', last_name: 'B', position: 'RB',
    team: 'SEA', age: 27, years_exp: 5, search_rank: 300, active: true,
    status: 'Active',
  } as unknown as SleeperPlayer;
  const player = (over: Partial<SleeperPlayer>) => ({ ...BASE, ...over }) as SleeperPlayer;

  it('drops a retired back the catalog still lists as active', () => {
    // The real shape of the bug: Sleeper keeps the page, the flags stay
    // "Active", and only the missing NFL team says he is gone.
    expect(isInLeague(player({ team: null }))).toBe(false);
  });

  it('keeps an undrafted rookie, who has no team yet', () => {
    expect(isInLeague(player({ team: null, years_exp: 0, age: 22 }))).toBe(true);
  });

  it('keeps a deep backup with no rank cap to fall foul of', () => {
    // Searching a fourth-string tight end by name has to keep working, which
    // is why this rule has no rank in it.
    expect(isInLeague(player({ search_rank: 4000 }))).toBe(true);
    expect(isMockEligible(player({ search_rank: 4000 }))).toBe(false);
  });

  it('still honours the flags Sleeper does keep current', () => {
    expect(isInLeague(player({ active: false }))).toBe(false);
    expect(isInLeague(player({ status: 'Inactive' }))).toBe(false);
  });

  it('is the rule the mock pool is built on top of', () => {
    const gone = player({ team: null });
    expect(isInLeague(gone)).toBe(false);
    expect(isMockEligible(gone)).toBe(false);
  });
});

describe('the trade on the screen', () => {
  // Exactly what the builder showed: you receive a 104, you send a 46, and a
  // third team sits in the deal with nothing moving for it. The headline named
  // the wrong winner, so this pins down what the model actually says.
  const teams = [
    { id: 1, name: 'You', isMe: true },
    { id: 2, name: 'The Price Is Right', isMe: false },
    { id: 3, name: 'Third', isMe: false },
  ];
  const a = (id: string, value: number, from: number, to: number) =>
    ({ id, name: id, value, from, to });

  it('gives the win to whoever takes back more, whichever team that is', () => {
    const v = evaluateTrade(teams, [a('bijan', 104, 2, 1), a('montgomery', 46, 1, 2)]);
    expect(v.winner?.isMe).toBe(true);
    expect(v.ledgers.find(l => l.isMe)!.net).toBe(58);
    expect(v.ledgers.find(l => l.name === 'The Price Is Right')!.net).toBe(-58);
  });

  it('is unmoved by a third team that nothing passes through', () => {
    const v = evaluateTrade(teams, [a('bijan', 104, 2, 1), a('montgomery', 46, 1, 2)]);
    expect(v.ledgers.find(l => l.name === 'Third')!.net).toBe(0);
    expect(v.problems.join(' ')).toContain('Third is in the trade but nothing moves');
  });

  it('still reads correctly when the player comes from the third team', () => {
    const v = evaluateTrade(teams, [a('bijan', 104, 3, 1), a('montgomery', 46, 1, 2)]);
    expect(v.ledgers.find(l => l.isMe)!.net).toBe(58);
    expect(v.ledgers.find(l => l.name === 'Third')!.net).toBe(-104);
    expect(v.winner?.isMe).toBe(true);
  });
});

/* A photo lives under a hard byte ceiling — one database record the whole
   league reads on every launch — and used to be squashed to a flat 160 square
   to get there. That is fine behind a 34px roster face and visibly soft behind
   the 64px portrait on a card, which on a phone is 192 real pixels of a
   160-pixel picture. */
describe('how big an uploaded photo is stored', () => {
  /** Bytes roughly as an encoder makes them: with the area, and with quality. */
  const like = (k: number) => (px: number, q: number) => Math.round(px * px * q * k);

  it('takes the biggest square that fits under the ceiling', () => {
    expect(pickEncoding(like(0.2), 20000)).toEqual({ px: 288, q: 0.9 });
  });

  it('drops the quality before it drops the pixels', () => {
    // 288 at 0.9 is over, 288 at 0.82 is not: more picture beats more fidelity.
    const fit = pickEncoding(like(0.2), 288 * 288 * 0.85 * 0.2);
    expect(fit).toEqual({ px: 288, q: 0.82 });
  });

  it('steps down a square rather than encoding one to mush', () => {
    // Nothing at 288 fits above the quality floor, so the 224 square takes it
    // at a quality worth having instead of a big blocky 288.
    const cap = 288 * 288 * 0.6 * 0.2;
    const fit = pickEncoding(like(0.2), cap);
    expect(fit?.px).toBe(224);
    expect(fit?.q).toBeGreaterThanOrEqual(PHOTO_Q_FLOOR);
  });

  it('lets the smallest square go rough rather than store nothing', () => {
    // A tight ceiling no square clears at a decent quality: a rough photo is
    // still a photo, and the alternative on screen is a grey badge.
    const fit = pickEncoding(like(0.2), 160 * 160 * 0.5 * 0.2);
    expect(fit).toEqual({ px: 160, q: 0.45 });
  });

  it('gives up when even the smallest square cannot fit', () => {
    expect(pickEncoding(like(0.2), 10)).toBe(null);
  });

  it('never picks a size or quality it was not offered', () => {
    const fit = pickEncoding(like(0.2), 20000);
    expect(PHOTO_PX).toContain(fit?.px);
    expect(PHOTO_Q).toContain(fit?.q);
  });
});

/* A drag in the middle of a list is a scroll and has to stay one. The gesture
   only exists where the scroller has run out of scroll, which is the space the
   browser would otherwise spend on a rubber band. */
describe('pulling a screen to refresh it', () => {
  it('knows which edge a scroller is sitting against', () => {
    expect(edgeAt(0, 2000, 800)).toBe('top');
    expect(edgeAt(1200, 2000, 800)).toBe('bottom');
    expect(edgeAt(600, 2000, 800)).toBe(null);
  });

  it('calls a screen with nothing to scroll both edges at once', () => {
    // There is no meaningful top or bottom of a screen that fits; which
    // gesture it is comes from which way the thumb goes.
    expect(edgeAt(0, 700, 800)).toBe('both');
    expect(pullFrom('both', 100)?.edge).toBe('top');
    expect(pullFrom('both', -100)?.edge).toBe('bottom');
  });

  it('gives nothing back to a drag away from the edge it started against', () => {
    expect(pullFrom('top', -100)).toBe(null);
    expect(pullFrom('bottom', 100)).toBe(null);
    expect(pullFrom(null, 100)).toBe(null);
  });

  it('pulls the bottom edge upward, which is the same gesture mirrored', () => {
    const up = pullFrom('bottom', -100);
    const down = pullFrom('top', 100);
    expect(up?.edge).toBe('bottom');
    expect(up?.amount).toBe(down?.amount);
  });

  it('ignores a touch too small to have been meant', () => {
    expect(pullFrom('top', PULL_SLOP)).toBe(null);
    expect(pullFrom('top', PULL_SLOP + 1)).not.toBe(null);
  });

  it('moves the indicator less than the finger, and stops it giving', () => {
    // The resistance is what the gesture pulls against, and it is also what
    // stops a flick tripping a refresh nobody asked for.
    const p = pullFrom('top', 106);
    expect(p?.amount).toBeCloseTo((106 - PULL_SLOP) * PULL_RESIST, 5);
    expect(pullFrom('top', 10000)?.amount).toBe(PULL_MAX);
  });

  it('arms only once the pull has gone the distance', () => {
    const short = { edge: 'top' as const, amount: PULL_TRIGGER - 1 };
    const there = { edge: 'top' as const, amount: PULL_TRIGGER };
    expect(pullArmed(short)).toBe(false);
    expect(pullArmed(there)).toBe(true);
    expect(pullArmed(null)).toBe(false);
  });

  it('reports how much further, and never more than all of it', () => {
    expect(pullProgress(null)).toBe(0);
    expect(pullProgress({ edge: 'top', amount: PULL_TRIGGER / 2 })).toBeCloseTo(0.5, 5);
    expect(pullProgress({ edge: 'top', amount: PULL_MAX })).toBe(1);
  });
});

/* A 30px face on a 3x phone came out visibly soft. The srcSet was declaring
   the thumbnail at its nominal file width, which is the wrong number twice
   over: the portraits are taller than they are wide and a square face keeps
   only the shorter side, and the thumbnail is smaller than that anyway. */
describe('which portrait a face is given', () => {
  it('offers both, each with what it is worth to a square face', () => {
    const set = playerPhotoSet('6794');
    expect(set?.photo).toContain('/thumb/6794.jpg');
    expect(set?.srcSet).toContain('/thumb/6794.jpg ' + THUMB_SQ + 'w');
    expect(set?.srcSet).toContain('/players/6794.jpg ' + FULL_SQ + 'w');
  });

  it('leaves a retina phone no choice but the full portrait on a scoreboard', () => {
    // The faces in a game are 30px, which is 90 real pixels on a 3x screen.
    expect(30 * 3).toBeGreaterThan(THUMB_SQ);
    expect(30 * 3).toBeLessThanOrEqual(FULL_SQ);
  });

  it('still lets a plain screen have the cheap one for a roster row', () => {
    // 34px rows, dozens at a time, on a 1x screen: the thumbnail is enough.
    expect(34).toBeLessThanOrEqual(THUMB_SQ);
  });

  it('has nothing to offer where Sleeper has no portrait address', () => {
    // Defences and kickers are not numbered ids, and there is no picture.
    expect(playerPhotoSet('DEF')).toBe(null);
  });
});

/* An installed iOS copy sometimes reports its window before the system has
   finished sizing it — 793 where the screen is 852, which is the Dynamic
   Island inset to the pixel — and the app launches with a band of dead
   background under the tab bar. Both of the usual sources give the same wrong
   number in that moment, so the screen has to be asked. */
describe('how tall the app thinks the window is', () => {
  const phone = {
    inner: 793, dvh: 793, screen: 852, screenW: 393, innerW: 393, standalone: true,
  };

  it('takes the screen when a home-screen app is reported short', () => {
    expect(bestHeight(phone)).toBe(852);
  });

  it('leaves a window that is already right alone', () => {
    expect(bestHeight({ ...phone, inner: 852, dvh: 852 })).toBe(852);
  });

  it('still takes the larger of the two ordinary readings', () => {
    expect(bestHeight({ ...phone, inner: 700, dvh: 793, screen: 0, screenW: 0 })).toBe(793);
    expect(bestHeight({ ...phone, inner: 793, dvh: 0, screen: 0, screenW: 0 })).toBe(793);
  });

  it('does not believe the screen in a browser tab', () => {
    // Safari's chrome bars are real: the window is genuinely shorter than the
    // screen and always will be.
    expect(bestHeight({ ...phone, standalone: false })).toBe(793);
  });

  it('does not believe the screen on a rotated phone', () => {
    // Landscape: the window is wider than it is tall, and screen.height is
    // then the short side or the long one depending on the browser. Neither
    // is a correction to anything.
    expect(bestHeight({ inner: 393, dvh: 393, screen: 852, screenW: 852, innerW: 852, standalone: true })).toBe(393);
  });

  it('does not believe the screen in a window narrower than it', () => {
    // A desktop app window on a big monitor is standalone too, and the screen
    // says nothing about how tall that window is.
    expect(bestHeight({ inner: 900, dvh: 900, screen: 1440, screenW: 2560, innerW: 1200, standalone: true })).toBe(900);
  });

  it('will not stretch a reading that is nowhere near the screen', () => {
    // A maximised desktop app, as wide as the monitor: a correction of half
    // the window is not a safe-area inset, it is a different quantity.
    expect(bestHeight({ inner: 900, dvh: 900, screen: 1440, screenW: 1440, innerW: 1440, standalone: true })).toBe(900);
    expect(bestHeight({ ...phone, screen: Math.floor(793 * SCREEN_TRUST) })).toBe(Math.floor(793 * SCREEN_TRUST));
    expect(bestHeight({ ...phone, screen: Math.ceil(793 * SCREEN_TRUST) + 1 })).toBe(793);
  });

  it('never returns something out of nothing', () => {
    expect(bestHeight({ inner: 0, dvh: 0, screen: 852, screenW: 393, innerW: 393, standalone: true })).toBe(0);
  });
});

/* Passing yards are a quarterback's season; they are not a fantasy season.
   What a lineup decision turns on is what he put on the board, over how many
   games, and how low it goes on his bad weeks against how high on his good
   ones — the average alone hides the difference between 13, 14, 15 and
   2, 6, 34. */
describe('a player\'s season in fantasy points', () => {
  const g = (...pts: number[]) => pts.map((p, i) => ({ week: i + 1, pts: p }));

  it('averages, totals and bounds a season', () => {
    const l = seasonLine(g(10, 20, 30));
    expect(l).toMatchObject({ games: 3, total: 60, ppg: 20, low: 10, high: 30 });
  });

  it('separates two men who average the same', () => {
    const steady = seasonLine(g(13, 14, 15, 14, 14));
    const swingy = seasonLine(g(2, 6, 34, 18, 10));
    expect(steady?.ppg).toBe(14);
    expect(swingy?.ppg).toBe(14);
    // Same average, and nothing else the same: that is the whole point of
    // carrying the quartiles.
    expect(steady?.floor).toBeGreaterThan(swingy?.floor as number);
    expect(swingy?.ceiling).toBeGreaterThan(steady?.ceiling as number);
  });

  it('puts the floor below the average and the ceiling above it', () => {
    const l = seasonLine(g(4, 9, 12, 18, 25));
    expect(l?.floor).toBeLessThanOrEqual(l?.ppg as number);
    expect(l?.ceiling).toBeGreaterThanOrEqual(l?.ppg as number);
    expect(l?.low).toBeLessThanOrEqual(l?.floor as number);
    expect(l?.high).toBeGreaterThanOrEqual(l?.ceiling as number);
  });

  it('has nothing to say about a man who has not played', () => {
    expect(seasonLine([])).toBe(null);
  });

  it('reads one game as its own floor and ceiling', () => {
    expect(seasonLine(g(21))).toMatchObject({ games: 1, ppg: 21, floor: 21, ceiling: 21 });
  });

  it('interpolates a quartile rather than picking the nearest', () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([0, 10, 20, 30], 0.25)).toBeCloseTo(7.5, 5);
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([7], 0.9)).toBe(7);
  });

  it('counts a rank from the best, and lets ties share it', () => {
    expect(rankAmong(20, [30, 20, 10])).toEqual({ rank: 2, of: 3 });
    // Two men at 18.4 are both second, and nobody is third.
    expect(rankAmong(18.4, [20, 18.4, 18.4, 9])).toEqual({ rank: 2, of: 4 });
    expect(rankAmong(99, [30, 20])).toEqual({ rank: 1, of: 2 });
    expect(rankAmong(1, [30, 20])).toEqual({ rank: 3, of: 2 });
    expect(rankAmong(5, [])).toBe(null);
  });

  it('ranks a field that is mostly ties, which a touchdown count is', () => {
    /* Points a game separate everybody; touchdowns are small whole numbers and
       most of a position has the same one. A man on none is not last — he is
       level with everybody else on none, behind only the men who scored. */
    const none = [0, 0, 0, 0, 0, 3, 2, 1];
    expect(rankAmong(0, none)).toEqual({ rank: 4, of: 8 });
    expect(rankAmong(1, none)).toEqual({ rank: 3, of: 8 });
    expect(rankAmong(11, none)).toEqual({ rank: 1, of: 8 });
    // And the subject sitting in his own field does not push himself down.
    expect(rankAmong(3, [0, 0, 3, 1])).toEqual({ rank: 1, of: 4 });
  });

  it('gives a count no place when there is no count', () => {
    // The touchdown tile was the one figure in the season grid with nothing
    // under it. A subject with no number has no place — not last.
    expect(rankCount(null, [3, 2, 1])).toBe(null);
    expect(rankCount(undefined, [3, 2, 1])).toBe(null);
    expect(rankCount(NaN, [3, 2, 1])).toBe(null);
    expect(rankCount(2, [])).toBe(null);
  });

  it('leaves a man with no count out of the field rather than scoring him nil', () => {
    /* A player whose weeks are not in hand has not scored none — nothing is
       known about him. Filling him in as a zero does not move anybody's PLACE,
       since he lands at the bottom either way; what it moves is the size of
       the field, and the size is what `placing` divides by to decide whether a
       figure is painted as a strength. Two unknowns counted as nils turn a man
       third of three into a man third of five, and third of five is green. */
    expect(rankCount(1, [1, 3, 2, null, undefined])).toEqual({ rank: 3, of: 3 });
    expect(rankCount(1, [1, 3, 2, 0, 0])).toEqual({ rank: 3, of: 5 });
    expect(placing(3, 3)).toBe(0);
    expect(placing(3, 5)).toBe(0.5);
  });

  it('writes an ordinal the way it is said', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st']);
  });

  it('scales the bars to his own best week, not to the league', () => {
    // A chart of one player is a chart about him.
    const hs = barHeights(g(5, 10, 20));
    expect(hs).toEqual([0.25, 0.5, 1]);
  });

  it('still draws a bar for a week he scored nothing on', () => {
    const hs = barHeights(g(0, 20));
    expect(hs[0]).toBeGreaterThan(0);
    expect(hs[1]).toBe(1);
    // And does not divide by zero when no week scored at all.
    expect(barHeights(g(0, 0)).every(h => h > 0)).toBe(true);
  });
});

/* A week's score is asked as a placing: "19.5" is a number, "QB7" is a week.
   Which needs picking one week out of a season that only holds the weeks he
   played — there is no row for a bye, so an index is not a week. */
describe('what he scored in one week', () => {
  const season = [{ week: 1, pts: 35.7 }, { week: 3, pts: 19.5 }, { week: 4, pts: 40.8 }];

  it('finds a week by its number, not by where it sits', () => {
    expect(pointsInWeek(season, 1)).toBe(35.7);
    expect(pointsInWeek(season, 3)).toBe(19.5);
    expect(pointsInWeek(season, 4)).toBe(40.8);
  });

  it('says nothing for a week he did not play', () => {
    // Week 2 is his bye: absent, not zero, and the difference is the whole
    // reason the weeks carry their own number.
    expect(pointsInWeek(season, 2)).toBe(null);
    expect(pointsInWeek(season, 9)).toBe(null);
    expect(pointsInWeek(undefined, 1)).toBe(null);
    expect(pointsInWeek([], 1)).toBe(null);
  });

  it('places him in that week against the field that played it', () => {
    const field = [40.8, 19.5, 28.0, 12.1];
    expect(rankAmong(pointsInWeek(season, 3) as number, field)).toEqual({ rank: 3, of: 4 });
    expect(rankAmong(pointsInWeek(season, 4) as number, field)).toEqual({ rank: 1, of: 4 });
  });
});

/* Reading a number off one card and a number off another and doing the
   subtraction in your head is the work a comparison is supposed to have done,
   and it is exactly the work people get wrong. */
describe('two seasons against each other', () => {
  const line = (o: Partial<ReturnType<typeof seasonLine>> & object) => ({
    games: 3, total: 60, ppg: 20, high: 30, low: 10, floor: 15, ceiling: 25, ...o,
  } as NonNullable<ReturnType<typeof seasonLine>>);

  it('marks a winner on every row that has one', () => {
    const rows = compareSeasons(line({ ppg: 20 }), line({ ppg: 14 }));
    expect(rows.find(r => r.key === 'ppg')?.win).toBe('a');
    expect(rows.find(r => r.key === 'total')?.win).toBe(null);
  });

  it('reads a higher worst week as the better one', () => {
    // The row people misread: a worst week is the floor under him, so more is
    // better, the same as every other row here.
    const rows = compareSeasons(line({ low: 12 }), line({ low: 3 }));
    expect(rows.find(r => r.key === 'low')?.win).toBe('a');
  });

  it('gives a row to nobody when a man has not played', () => {
    const rows = compareSeasons(line({}), null);
    expect(rows.every(r => r.win === null)).toBe(true);
    expect(rows.every(r => r.b === null)).toBe(true);
    expect(aheadBy(rows)).toBe(null);
  });

  it('counts the rows rather than averaging them', () => {
    // Five narrow wins beat two wide ones, which is the honest reading of a
    // table whose rows are in different units and cannot be added up.
    const rows = compareSeasons(
      line({ ppg: 21, total: 61, games: 4, floor: 16, ceiling: 26, high: 20, low: 4 }),
      line({ ppg: 20, total: 60, games: 3, floor: 15, ceiling: 25, high: 99, low: 40 }),
    );
    expect(tally(rows)).toEqual({ a: 5, b: 2 });
    expect(aheadBy(rows)).toEqual({ side: 'a', rows: 5 });
  });

  it('calls a dead heat a dead heat', () => {
    const rows = compareSeasons(line({}), line({}));
    expect(tally(rows)).toEqual({ a: 0, b: 0 });
    expect(aheadBy(rows)).toBe(null);
  });
});

/* The other half of a player's card, reduced to what two of them can be asked
   together — which is not all of it. */
describe('two players\' numbers against each other', () => {
  const use = (o: Partial<CmpUse>): CmpUse => ({
    rating: 80, value: 6000, snap: 0.9, share: 20, shareLabel: 'Target share',
    eff: 7.0, tdPerGame: 0.5, rzShare: 0.2, ...o,
  });

  it('leads with the Rating, which is what put one above the other', () => {
    const rows = compareNumbers(use({ rating: 84 }), use({ rating: 71 }));
    expect(rows[0]?.key).toBe('rating');
    expect(rows[0]?.win).toBe('a');
  });

  it('compares what both of them measure the same way', () => {
    const rows = compareNumbers(use({ value: 7000 }), use({ value: 5000 }));
    expect(rows.find(r => r.key === 'value')?.win).toBe('a');
    expect(rows.find(r => r.key === 'share')?.win).toBe(null);
  });

  it('drops the share row when the two positions do not mean the same by it', () => {
    // A passer's attempts and a receiver's target share are both "his share of
    // the offence" and are not the same quantity; the row would decide itself
    // on the units.
    const rows = compareNumbers(
      use({ shareLabel: 'Attempts per game', share: 36 }),
      use({ shareLabel: 'Target share', share: 22 }),
    );
    expect(rows.find(r => r.key === 'share')).toBeUndefined();
  });

  it('keeps the share row for two men at the same position', () => {
    const rows = compareNumbers(use({ share: 26 }), use({ share: 19 }));
    expect(rows.find(r => r.key === 'share')?.win).toBe('a');
  });

  it('writes a share as a percentage rather than a fraction', () => {
    const rows = compareNumbers(use({ snap: 0.972 }), use({ snap: 0.431 }));
    expect(rows.find(r => r.key === 'snap')?.a).toBe(97.2);
    expect(rows.find(r => r.key === 'snap')?.b).toBe(43.1);
  });

  it('gives a row to nobody where one side has no reading', () => {
    const rows = compareNumbers(use({}), use({ eff: null, rzShare: null }));
    expect(rows.find(r => r.key === 'eff')?.win).toBe(null);
    expect(rows.find(r => r.key === 'rz')?.win).toBe(null);
  });
});

/* A number on its own is not a reading: 16% of a team's red-zone work is a lot
   for a back and nothing for a number one receiver. The card already knew
   where most of its figures placed and left the reader to do the last step. */
describe('what a placing is worth', () => {
  it('runs from the best of the field to the worst', () => {
    expect(placing(1, 16)).toBe(1);
    expect(placing(16, 16)).toBe(0);
    expect(placing(6, 11)).toBeCloseTo(0.5, 5);
  });

  it('has nothing to say about a field of one', () => {
    // Being the only quarterback anybody rosters makes you neither good nor
    // bad, and "1st of 1" would paint him green for it.
    expect(placing(1, 1)).toBe(null);
    expect(placing(1, 0)).toBe(null);
  });

  it('refuses a rank outside its own field', () => {
    expect(placing(0, 16)).toBe(null);
    expect(placing(17, 16)).toBe(null);
    expect(placing(NaN, 16)).toBe(null);
  });

  it('paints the top of a position good and the bottom bad', () => {
    expect(toneOf(1)).toBe('good');
    expect(toneOf(TOP)).toBe('good');
    expect(toneOf(LOW)).toBe('bad');
    expect(toneOf(0)).toBe('bad');
  });

  it('leaves the middle of a position alone', () => {
    // Being ordinary is not news, and a lit middle band paints most of a card
    // most of the time — the two ends only mean something against a quiet one.
    expect(toneOf(TOP - 0.01)).toBe(undefined);
    expect(toneOf(0.5)).toBe(undefined);
    expect(toneOf(LOW + 0.01)).toBe(undefined);
    expect(toneOfRank(16, 32)).toBe(undefined);
  });

  it('leaves a figure it cannot place uncoloured', () => {
    // An uncoloured number is honest about not knowing; a colour on a figure
    // with no direction spends the signal on noise.
    expect(toneOf(null)).toBe(undefined);
    expect(toneOf(undefined)).toBe(undefined);
    expect(toneOfRank(null, 32)).toBe(undefined);
    expect(toneOfRank(4, null)).toBe(undefined);
  });

  it('reads an easier schedule as the better one', () => {
    // The rank is "nth easiest of 32", so first is the kind run.
    expect(toneOfRank(1, 32)).toBe('good');
    expect(toneOfRank(32, 32)).toBe('bad');
  });
});

/* The league's weekly payload lists the players on a roster, so a man it had
   not picked up yet is missing every week before somebody claimed him — which
   for a waiver pickup is most of his own season total. */
describe('a season out of two sources', () => {
  const rostered = [{ week: 4, pts: 18.2 }, { week: 5, pts: 22.6 }];

  it('fills the weeks the league never saw him play', () => {
    const merged = mergeSeason(rostered, { 1: 14.4, 2: 9.1, 3: 0 });
    expect(merged.map(g => g.week)).toEqual([1, 2, 4, 5]);
    expect(seasonLine(merged)?.total).toBe(64.3);
  });

  it('keeps the league\'s own number where it has one, and counts a week once', () => {
    // Sleeper's figure is exact under this league's settings; the stat feed
    // has to be totalled here, so it loses any tie — and a week that reaches
    // the merge twice would be counted twice in the total, which is the way
    // this goes wrong in the direction nobody notices.
    const merged = mergeSeason(rostered, { 4: 99.9 });
    expect(merged.filter(g => g.week === 4)).toEqual([{ week: 4, pts: 18.2 }]);
    expect(merged.length).toBe(2);
    expect(seasonLine(merged)?.total).toBe(40.8);
  });

  it('treats a scored zero as a week he did not play', () => {
    expect(mergeSeason([], { 1: 0, 2: null, 3: undefined }).length).toBe(0);
  });

  it('returns the weeks in order whichever source they came from', () => {
    const merged = mergeSeason([{ week: 9, pts: 5 }], { 2: 7, 12: 3 });
    expect(merged.map(g => g.week)).toEqual([2, 9, 12]);
  });

  it('asks only for the weeks it is missing', () => {
    // A player rostered all year costs nothing extra; one picked up in week
    // six costs the five he was a free agent.
    expect(gapsIn([{ week: 1, pts: 1 }, { week: 2, pts: 2 }], 2)).toEqual([]);
    expect(gapsIn([{ week: 6, pts: 1 }], 7)).toEqual([1, 2, 3, 4, 5, 7]);
    expect(gapsIn(undefined, 3)).toEqual([1, 2, 3]);
    expect(gapsIn([], 0)).toEqual([]);
  });
});

/* One shrinkage constant for every metric was what held a breakout down: a
   receiver who has taken over an offence shows it in his snaps and his targets
   within a month, and those were being trusted as slowly as his yards per
   catch. They do not settle at the same speed. */
describe('how fast the season in progress is believed', () => {
  const CAT = { a: { position: 'WR', team: 'SEA' } } as unknown as PlayerCatalog;
  /* Three finished seasons behind him, so the prior is at full strength and
     these are the K ratios themselves rather than the K ratios softened for a
     thin prior — that is the block below. */
  const base = (o: Partial<Usage>): UsageMap =>
    ({ a: { gp: 16, gpTotal: 45, snap: 0.5, tgt: 0.15, eff: 7, tdPerGame: 0.3, ...o } }) as unknown as UsageMap;

  /** A man drifting upward — not far enough to be a different role. See the
   *  block below for what happens when it IS one. */
  const after = (gp: number) => withCurrentSeason(
    base({}),
    { year: 2026, usage: base({ gp, snap: 0.6, tgt: 0.18, eff: 14, tdPerGame: 0.9 }) },
    CAT,
  ).a;

  it('believes a changed role faster than a hot streak', () => {
    const u = after(3);
    // Role: three fifths of the answer by game three.
    expect((u.snap as number)).toBeCloseTo(0.5 + 0.1 * (3 / 5), 6);
    // Scoring: still the slowest of them, a little over a quarter.
    expect((u.tdPerGame as number)).toBeCloseTo(0.3 + 0.6 * (3 / 11), 6);
  });

  it('moves every metric in the right direction', () => {
    const u = after(3);
    for (const k of ['snap', 'tgt', 'eff', 'tdPerGame'] as const) {
      expect(u[k] as number).toBeGreaterThan(base({}).a[k] as number);
    }
  });

  it('trusts the role more than the efficiency at every point of a season', () => {
    for (const gp of [1, 3, 6, 10, 16]) {
      const u = after(gp);
      const roleShare = ((u.snap as number) - 0.5) / 0.1;
      const effShare = ((u.eff as number) - 7) / 7;
      expect(roleShare).toBeGreaterThan(effShare);
    }
  });

  it('still reports one number for how much of the year is counted', () => {
    // The card says one percentage about the player, not one per column.
    expect(after(3).curWeight as number).toBeCloseTo(3 / 6, 6);
  });

  it('never lets one Sunday repaint a player', () => {
    // One game may move him. It may not make him a different player: the
    // scoring rate stays nearer where it was than where one Sunday put it.
    const u = after(1);
    expect(u.tdPerGame as number).toBeLessThan(0.3 + 0.6 * 0.25);
    expect(u.eff as number).toBeLessThan(7 + 7 * 0.3);
  });
});

/* "Player quality" was a fixed three-fifths market price. That is fair in an
   off-season and wrong in October: the price is what he costs to trade for,
   and the season is telling you every Sunday who is actually good now. */
describe('how much of quality is production', () => {
  it('leaves the off-season exactly as it was', () => {
    expect(prodShare(0)).toBe(PROD_SHARE_BASE);
    expect(prodShare(null)).toBe(PROD_SHARE_BASE);
    expect(prodShare(undefined)).toBe(PROD_SHARE_BASE);
  });

  it('lets the evidence gain on the prior as the evidence accumulates', () => {
    expect(prodShare(0.33)).toBeGreaterThan(prodShare(0));
    expect(prodShare(0.7)).toBeGreaterThan(prodShare(0.33));
    expect(prodShare(1)).toBe(PROD_SHARE_MAX);
  });

  it('never lets production take the whole of it', () => {
    // The market has watched him for years; it does not stop being evidence.
    for (const w of [0, 0.5, 1, 2, -1]) expect(prodShare(w)).toBeLessThanOrEqual(PROD_SHARE_MAX);
    for (const w of [0, 0.5, 1, 2, -1]) expect(prodShare(w)).toBeGreaterThanOrEqual(PROD_SHARE_BASE);
  });

  it('is what turns a breakout into a rating that moves', () => {
    // A man the market prices mid-table whose production is top of the board.
    const market = 40, production = 100;
    const q = (w: number) => market * (1 - prodShare(w)) + production * prodShare(w);
    // In the off-season the price still leads; by December the season does.
    expect(q(0)).toBeCloseTo(64, 6);
    expect(q(0.7)).toBeGreaterThan(q(0) + 6);
  });
});

/* A Rating is eleven numbers times eleven weights, and the difference between
   two players is never spread evenly across them — it is one or two terms and
   a lot of noise. */
describe('which metric put one player above the other', () => {
  const W = { talent: 0.3, rz: 0.1, age: 0.06, sos: 0 };
  const side = (m: Record<string, number>) => ({ m, weights: W as Record<string, number> });
  const label = (k: string) => k.toUpperCase();
  const keys = ['talent', 'rz', 'age', 'sos'];

  it('puts the reason on the first line, wherever it sits in the input', () => {
    // `talent` is given last on purpose: the row order has to come from how
    // far apart the two men are, not from the order the metrics arrive in.
    const rows = compareMetrics(['rz', 'age', 'sos', 'talent'], label,
      side({ talent: 0.9, rz: 0.5, age: 0.5, sos: 1 }),
      side({ talent: 0.4, rz: 0.52, age: 0.5, sos: 1 }));
    expect(rows[0]?.key).toBe('talent');
    expect(rows[0]?.win).toBe('a');
    expect(rows.map(r => r.key)).toEqual(['talent', 'rz', 'age']);
  });

  it('compares contributions, not raw metrics', () => {
    // 0.8 of something worth 6% and 0.3 of something worth 30% are not
    // comparable until both are in Rating points.
    const rows = compareMetrics(keys, label,
      side({ talent: 0.3, rz: 0, age: 0.8, sos: 0 }),
      side({ talent: 0.3, rz: 0, age: 0.1, sos: 0 }));
    const age = rows.find(r => r.key === 'age');
    expect(age?.a).toBeCloseTo(4.8, 5);
    expect(age?.b).toBeCloseTo(0.6, 5);
  });

  it('leaves out a term neither of them is scored on', () => {
    const rows = compareMetrics(keys, label, side({ sos: 1 }), side({ sos: 0 }));
    expect(rows.find(r => r.key === 'sos')).toBeUndefined();
  });

  it('gives a row to nobody where the two land in the same place', () => {
    const rows = compareMetrics(keys, label, side({ talent: 0.5 }), side({ talent: 0.5 }));
    expect(rows.find(r => r.key === 'talent')?.win).toBe(null);
  });
});

/* "0.76 touchdowns a game" is a rate blended over four seasons to feed the
   model. It has not told anybody how many he has scored, and that is the
   number people mean when they ask about touchdowns. */
describe('touchdowns this season', () => {
  it('adds up every week in hand', () => {
    expect(countTds([{ rec_td: 2 }, { rec_td: 1, rush_td: 1 }, {}])).toBe(4);
  });

  it('counts every way of scoring one, not just his position\'s', () => {
    // A receiver who threw one still threw it, and only his own columns are
    // ever non-zero anyway.
    expect(countTds([{ pass_td: 3 }])).toBe(3);
    expect(countTds([{ rec_td: 1, pass_td: 1, rush_td: 1, def_st_td: 1 }])).toBe(4);
  });

  it('says nothing rather than nought where no week is loaded', () => {
    // Zero touchdowns and no data are different claims, and the second one
    // must not print as the first.
    expect(countTds([])).toBe(null);
    expect(countTds([undefined, null])).toBe(null);
    expect(countTds([{}])).toBe(0);
  });

  it('ignores a column that is not a number', () => {
    expect(countTds([{ rec_td: 2, rec_yd: 118 }, { rec_td: NaN }])).toBe(2);
  });
});

/* The comparison printed a Rating over a breakdown of it, and the breakdown
   did not add up to the Rating — because the two came from different scorings
   of the same player. Rows that do not sum to the number they explain are
   worse than no rows. */
describe('a rating and its breakdown agree', () => {
  const W = { talent: 0.3, rz: 0.1, age: 0.06 } as Record<string, number>;
  const keys = ['talent', 'rz', 'age'];
  const label = (k: string) => k;

  it('sums the contributions to the rating itself', () => {
    const m = { talent: 0.8, rz: 0.5, age: 0.25 };
    // A Rating is round(sum(weight * metric) * 100) — see `scorePlayer`.
    const fit = Math.round(keys.reduce((a, k) => a + (W[k] as number) * (m[k as keyof typeof m]), 0) * 100);
    const rows = compareMetrics(keys, label, { m, weights: W }, { m, weights: W });
    const summed = rows.reduce((a, r) => a + (r.a ?? 0), 0);
    // Within a point: the rows round once each and the Rating rounds once at
    // the end, so they cannot agree to the decimal and do not need to.
    expect(Math.abs(summed - fit)).toBeLessThanOrEqual(1);
  });

  it('gives the same answer to both sides of a man against himself', () => {
    const m = { talent: 0.62, rz: 0.4, age: 0.9 };
    const rows = compareMetrics(keys, label, { m, weights: W }, { m, weights: W });
    expect(rows.every(r => r.win === null)).toBe(true);
    expect(rows.every(r => r.a === r.b)).toBe(true);
  });

  it('is what two weight vectors would have broken', () => {
    // Scoring one player on the board's weights and the other on the owner's
    // is how a lower Rating came out of higher contributions.
    const m = { talent: 0.62, rz: 0.4, age: 0.9 };
    const other = { talent: 0.2, rz: 0.05, age: 0.03 } as Record<string, number>;
    const rows = compareMetrics(keys, label, { m, weights: W }, { m, weights: other });
    expect(rows.every(r => r.win === 'a')).toBe(true);
  });
});

/* Checked across every rated player in the league rather than the two somebody
   happened to compare: a Rating that does not equal the sum of its own parts
   is a Rating explaining itself with somebody else's arithmetic. */
describe('every player\'s rating equals what it is made of', () => {
  it('holds for all of them, not just the pair on screen', () => {
    expect(model.allFits.length).toBeGreaterThan(0);
    const off = model.allFits.map(p => {
      const summed = (Object.keys(p.weights) as (keyof typeof p.weights)[])
        .reduce((a, k) => a + p.weights[k] * p.m[k], 0) * 100;
      return { id: p.id, name: p.name, fit: p.fit, summed, gap: Math.abs(summed - p.fit) };
    }).filter(x => x.gap > 1);
    expect(off).toEqual([]);
  });

  it('scores all of them on one weight vector', () => {
    // Two vectors is how a lower Rating came out of higher contributions: an
    // un-owned player was coming back on the draft board's weights, where the
    // need and value terms are alive, against an owned one where they are not.
    const first = model.allFits[0]?.weights;
    for (const p of model.allFits) expect(p.weights).toEqual(first);
  });

  it('leaves the two draft-board terms out of a league-wide rating', () => {
    // "Positional need" and "value vs availability" are about YOUR pick. They
    // say nothing about how good somebody else's player is.
    for (const p of model.allFits) {
      expect(p.weights.need).toBe(0);
      expect(p.weights.value).toBe(0);
      // And the stack: it pays a player for who happens to own him.
      expect(p.weights.stack).toBe(0);
    }
  });
});

/* Two of the numbers describing a player were never averaged with anything.
   `blendSeasons` starts from the most recent finished season and only walks
   its own list, and those two were not on it — so they sat frozen at whatever
   they were last January, through every week of the new year. Red-zone share
   is a tenth of a Rating on its own. */
describe('every number that describes a player gets blended', () => {
  const CAT = { a: { position: 'WR', team: 'SEA' } } as unknown as PlayerCatalog;
  const one = (o: Partial<Usage>): UsageMap => ({ a: { gp: 16, ...o } } as unknown as UsageMap);

  it('moves a red-zone share with the season in progress', () => {
    const after = withCurrentSeason(
      one({ rzShare: 0.10, tdShare: 0.10 }),
      { year: 2026, usage: one({ gp: 3, rzShare: 0.30, tdShare: 0.30 }) },
      CAT,
    ).a;
    expect(after.rzShare as number).toBeGreaterThan(0.1);
    expect(after.tdShare as number).toBeGreaterThan(0.1);
  });

  it('still trusts the scoring share more slowly than the opportunity share', () => {
    // Where the ball goes near the goal line is a role; who ends up with the
    // touchdown is the noisiest thing in the sport.
    const after = withCurrentSeason(
      one({ rzShare: 0.10, tdShare: 0.10 }),
      { year: 2026, usage: one({ gp: 3, rzShare: 0.30, tdShare: 0.30 }) },
      CAT,
    ).a;
    expect(after.rzShare as number).toBeGreaterThan(after.tdShare as number);
  });

  it('leaves no describing number out of the blend', () => {
    // A guard against the next one being forgotten: a metric the model reads
    // off a season and never averages is a metric stuck in a past one.
    const described: (keyof Usage)[] = [
      'snap', 'tgt', 'vol', 'eff', 'ltr', 'xtdPerGame', 'ppg', 'ppgAdj',
      'tdPerGame', 'rzPerGame', 'rzShare', 'tdShare',
    ];
    const prior = one(Object.fromEntries(described.map(k => [k, 1])) as Partial<Usage>);
    const after = withCurrentSeason(
      prior,
      { year: 2026, usage: one({ gp: 8, ...Object.fromEntries(described.map(k => [k, 3])) }) },
      CAT,
    ).a;
    for (const k of described) expect(after[k] as number).toBeGreaterThan(1);
  });
});

/* The heaviest term in a Rating could not tell the best players in a league
   apart. Three decades of scale spent on a pool that spans one puts the whole
   top of it inside a sliver: two receivers thirteen per cent apart in value
   came out six tenths of a Rating point apart, while everything else about
   them was worth three or four. */
describe('the talent scale spans the pool it is ranking', () => {
  it('still gives a draft board its three decades', () => {
    // Value there really does span orders of magnitude, and dividing linearly
    // by the best asset in scope drags every rookie into the twenties.
    expect(talentScale(1000, 1000)).toBeCloseTo(1, 6);
    expect(talentScale(1, 1000)).toBeCloseTo(0, 6);
    expect(talentScale(100, 1000)).toBeCloseTo(2 / 3, 6);
  });

  it('stretches over a league where everybody is already rostered', () => {
    const top = 10000, floor = 2000;
    const wide = talentScale(9800, top) - talentScale(8700, top);
    const fitted = talentScale(9800, top, floor) - talentScale(8700, top, floor);
    expect(fitted).toBeGreaterThan(wide * 3);
  });

  it('separates the top of a narrow pool by more than a rounding error', () => {
    // Thirteen per cent of value has to be worth more than half a point of a
    // hundred-point Rating, or the term that weighs most says nothing.
    const gap = talentScale(9800, 10000, 2000) - talentScale(8700, 10000, 2000);
    expect(gap * 0.33 * 100).toBeGreaterThan(1.5);
  });

  it('is monotonic, and survives a floor that makes no sense', () => {
    for (const lo of [undefined, 0, -5, 20000, NaN]) {
      expect(talentScale(9000, 10000, lo)).toBeGreaterThan(talentScale(4000, 10000, lo));
    }
    expect(talentScale(0, 10000, 2000)).toBe(0);
    expect(talentScale(10, 0)).toBe(0);
  });
});


/* A league table whose Ratings collapse into a handful of values is not a
   ranking. Five players shared a 79 and a top-three receiver tied a flex back,
   because the two heaviest terms were both scaled over three decades of value
   for a pool of rostered players that spans about one. */
describe('the league\'s ratings do not collapse', () => {
  const fits = () => model.allFits.map(p => p.fit);

  it('spreads them over a range worth reading', () => {
    const hi = Math.max(...fits());
    const lo = Math.min(...fits());
    expect(hi - lo).toBeGreaterThan(25);
  });

  it('does not stack the league onto a few numbers', () => {
    // Ties are fine and inevitable; a table where most rows share a score with
    // somebody is a table that has stopped measuring.
    const all = fits();
    expect(new Set(all).size).toBeGreaterThan(all.length / 4);
  });

  it('keeps the best of them apart from each other', () => {
    // The top is where a ranking is actually read, and it is the end a log
    // scale compresses hardest.
    const top = fits().sort((a, b) => b - a).slice(0, 10);
    expect(new Set(top).size).toBeGreaterThan(4);
    expect((top[0] as number) - (top[9] as number)).toBeGreaterThan(3);
  });
});

/* A dynasty price is about a player's whole career and is worth respecting
   against four games. A redraft price is a guess at one season, made before it
   started — and by October the season itself has answered most of what that
   guess was for. */
describe('production leads harder where nobody is kept', () => {
  it('starts both formats in the same place before a ball is thrown', () => {
    expect(prodShare(0, true)).toBe(PROD_SHARE_BASE);
    expect(prodShare(0, false)).toBe(PROD_SHARE_BASE);
  });

  it('trusts the season more in redraft at every point of it', () => {
    for (const w of [0.2, 0.5, 0.7, 1]) {
      expect(prodShare(w, true)).toBeGreaterThan(prodShare(w, false));
    }
  });

  it('never lets the price stop counting entirely', () => {
    // The market has watched him for years. It is the weaker of the two here,
    // not nothing.
    expect(prodShare(1, true)).toBe(PROD_SHARE_MAX_REDRAFT);
    expect(PROD_SHARE_MAX_REDRAFT).toBeLessThan(1);
  });

  it('defaults to the dynasty shape when nobody says', () => {
    expect(prodShare(0.6)).toBe(prodShare(0.6, false));
  });
});

/* A two-year-old season was carrying a fifth of what the model thought a
   player was. That is too much for a league you only own him in for this one,
   and too much generally for a sport where roles turn over on a coaching
   change and a contract. */
describe('how far back a season still counts', () => {
  it('is worth half the year in front of it', () => {
    const [a, b, c] = USAGE_WEIGHTS;
    expect(b / a).toBeCloseTo(USAGE_DECAY, 6);
    expect(c / b).toBeCloseTo(USAGE_DECAY, 6);
  });

  it('still adds up to one whole player', () => {
    expect(USAGE_WEIGHTS.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 6);
  });

  it('leans harder on the most recent finished season than it used to', () => {
    // The old shape was 50/30/20 — a decay of about two thirds a year.
    expect(USAGE_WEIGHTS[0]).toBeGreaterThan(0.5);
    expect(USAGE_WEIGHTS[2]).toBeLessThan(0.2);
  });

  it('keeps three of them, because one is a small sample', () => {
    // An injury, a coordinator, a quarterback going down: every number in a
    // single season moves.
    expect(USAGE_WEIGHTS.length).toBe(3);
    expect(USAGE_WEIGHTS.every(w => w > 0)).toBe(true);
  });
});

/* Shrinking the season in progress toward the ones behind it assumes both are
   measuring the same thing. A receiver who has gone from third in a pecking
   order to first breaks that: the old number is not a worse estimate of his
   role, it is an accurate estimate of a role he no longer has. */
describe('a role that moved rather than drifted', () => {
  const CAT = { a: { position: 'WR', team: 'SEA' } } as unknown as PlayerCatalog;
  /* A veteran, so the shrinkage he is being pulled back by is the full one. */
  const one = (o: Partial<Usage>): UsageMap =>
    ({ a: { gp: 16, gpTotal: 45, ...o } }) as unknown as UsageMap;
  const move = (gp: number, snap: number) => withCurrentSeason(
    one({ snap: 0.45, eff: 7 }),
    { year: 2026, usage: one({ gp, snap, eff: 14 }) },
    CAT,
  ).a;

  it('leaves a drift alone', () => {
    // A fifth up is inside what three games can throw up by chance.
    const w = 3 / 5;
    expect(move(3, 0.55).snap as number).toBeCloseTo(0.45 + 0.10 * w, 6);
  });

  it('reads a halving as the same size of move as a doubling', () => {
    // Against his old number a doubled role moves 100% and a halved one 50%,
    // so measuring the difference believed the man who gained snaps and
    // shrank the one who lost them back toward a job he no longer has.
    expect(breakWeight(0.6, 0.90, 0.45, 5)).toBeCloseTo(breakWeight(0.6, 0.45, 0.90, 5), 6);
  });

  it('believes a role that has doubled', () => {
    expect(move(3, 0.90).snap as number).toBeCloseTo(0.90, 6);
  });

  it('scales between the two rather than flipping', () => {
    const drift = move(3, 0.55).snap as number;
    const some = move(3, 0.70).snap as number;
    const gone = move(3, 0.90).snap as number;
    expect(some).toBeGreaterThan(drift);
    expect(gone).toBeGreaterThan(some);
  });

  it('works downward too — a man who lost his job', () => {
    const lost = withCurrentSeason(
      one({ snap: 0.90 }), { year: 2026, usage: one({ gp: 4, snap: 0.20 }) }, CAT,
    ).a;
    expect(lost.snap as number).toBeCloseTo(0.20, 6);
  });

  it('never fires off one Sunday', () => {
    // A break needs a sample to be a break; two games of anything is not one.
    const w = 2 / 4;
    expect(move(2, 0.90).snap as number).toBeCloseTo(0.45 + 0.45 * w, 6);
  });

  it('leaves what he does with the ball to regress as before', () => {
    // A jump in yards per catch over three games is exactly the noise this
    // model exists to discount. A jump in snap share is a depth chart.
    const u = move(3, 0.90);
    expect(u.eff as number).toBeCloseTo(7 + 7 * (3 / 7), 6);
    expect(u.eff as number).toBeLessThan(14);
  });

  it('is a plain weight with nothing to divide by zero', () => {
    expect(breakWeight(0.6, 1, 0, 5)).toBe(0.6);
    expect(breakWeight(0.6, NaN, 0.5, 5)).toBe(0.6);
    expect(breakWeight(0.6, 0.5, 0.5, 5)).toBe(0.6);
    expect(breakWeight(0.6, 5, 0.5, 5)).toBe(1);
    // A role that went to nothing is a break, not a division by zero.
    expect(breakWeight(0.6, 0, 0.5, 5)).toBe(1);
  });
});

/* Shrinking toward a prior should be proportional to how much that prior
   knows, and this shrank toward all of them equally: a man with three seasons
   behind him and one with half a rookie year were pulled back just as hard,
   though one prior is forty-five games of evidence and the other is eight. It
   is second-year players it hurt most, and they are the ones whose roles
   change. */
describe('how much the seasons behind a player are worth', () => {
  it('leans fully on a prior that has seen two seasons or more', () => {
    expect(priorStrength(45)).toBe(1);
    expect(priorStrength(30)).toBe(1);
    // And does not keep growing past it: a fourth season does not make the
    // first three harder to argue with than they already were.
    expect(priorStrength(80)).toBe(1);
  });

  it('halves it for a player with one season behind him', () => {
    // Sixteen games out of the thirty that buy a full prior.
    expect(priorStrength(16)).toBeCloseTo(16 / 30, 6);
    expect(priorStrength(16)).toBeLessThan(0.6);
    expect(priorStrength(16)).toBeGreaterThan(0.45);
  });

  it('never falls to nothing, because one season beats none', () => {
    expect(priorStrength(8)).toBeGreaterThanOrEqual(PRIOR_MIN);
    expect(priorStrength(0)).toBe(PRIOR_MIN);
    expect(priorStrength(null)).toBe(PRIOR_MIN);
    expect(priorStrength(undefined)).toBe(PRIOR_MIN);
    expect(priorStrength(NaN)).toBe(PRIOR_MIN);
    expect(priorStrength(-5)).toBe(PRIOR_MIN);
  });

  it('rises with the prior and never falls', () => {
    let last = 0;
    for (const gp of [0, 4, 8, 16, 24, 30, 45, 60]) {
      const s = priorStrength(gp);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });

  it('believes a second-year breakout faster than a veteran one', () => {
    // The same man twice over, three games into the same jump in role. The
    // only difference between them is how much football is behind it.
    const CAT = { a: { position: 'WR', team: 'SEA' } } as unknown as PlayerCatalog;
    const at = (gpTotal: number) => withCurrentSeason(
      { a: { gp: 16, gpTotal, snap: 0.45, tgt: 0.14, eff: 7 } } as unknown as UsageMap,
      /* A drift rather than a break, so what is being read here is the prior's
         strength and not `breakWeight` on top of it. */
      { year: 2026, usage: { a: { gp: 3, snap: 0.55, tgt: 0.18, eff: 11 } } as unknown as UsageMap },
      CAT,
    ).a;
    const young = at(16);
    const vet = at(45);
    for (const k of ['snap', 'tgt', 'eff'] as const) {
      expect(young[k] as number).toBeGreaterThan(vet[k] as number);
    }
    // And by the right amount: three games buy three fifths of the move
    // against three seasons, and three quarters of it against one.
    expect(vet.tgt as number).toBeCloseTo(0.14 + 0.04 * (3 / 5), 6);
    expect(young.tgt as number).toBeCloseTo(0.14 + 0.04 * (3 / (3 + 2 * (16 / 30))), 6);
  });

  it('says so on the card, and prices him on the season instead of the guess', () => {
    // The headline percentage is scaled by the same thing, so what it reports
    // is what the blend did — and it is the number that decides how much of
    // "quality" is production rather than a price set before the season.
    const CAT = { a: { position: 'WR', team: 'SEA' } } as unknown as PlayerCatalog;
    const at = (gpTotal: number) => withCurrentSeason(
      { a: { gp: 16, gpTotal, snap: 0.45 } } as unknown as UsageMap,
      { year: 2026, usage: { a: { gp: 4, snap: 0.58 } } as unknown as UsageMap },
      CAT,
    ).a.curWeight as number;
    expect(at(45)).toBeCloseTo(4 / 7, 6);
    expect(at(16)).toBeGreaterThan(at(45));
    expect(prodShare(at(16), true)).toBeGreaterThan(prodShare(at(45), true));
  });

  it('leaves a rookie with no finished season alone', () => {
    // Nothing to shrink toward at all: his year is the whole of what is known,
    // which is a different case and was already handled.
    const CAT = { a: { position: 'WR', team: 'SEA' } } as unknown as PlayerCatalog;
    const u = withCurrentSeason(
      {} as UsageMap,
      { year: 2026, usage: { a: { gp: 3, snap: 0.58 } } as unknown as UsageMap },
      CAT,
    ).a;
    expect(u.snap as number).toBeCloseTo(0.58, 6);
    expect(u.curWeight).toBe(1);
  });
});

/* Three lenses over one league, and they were not measuring on one scale. The
   fix that stretched the talent term over the league's own range instead of a
   draft board's three decades was wired into the neutral Rating and the future
   one and missed out of "for you" — so the lens that was meant to add YOUR
   needs to a Rating was also flattening the two heaviest terms for everybody
   first, and then ordering what was left mostly by need. */
describe('one scale for every lens of the same board', () => {
  const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
  const fit = model.allFits.map(x => x.fit);
  const fitMe = model.allFits.map(x => x.fitMe);

  it('has a board wide enough to be worth asking about', () => {
    // If the fixture ever shrinks to a handful of players the tests below stop
    // meaning anything, so they say out loud what they are standing on.
    expect(model.allFits.length).toBeGreaterThan(50);
    expect(spread(fit)).toBeGreaterThan(40);
  });

  it('separates "for you" about as widely as the plain Rating', () => {
    // Same players, same pool. Adding your needs to a score reorders it; it
    // does not compress it into half the range, and when it did the top of the
    // board came out inside four points of itself.
    expect(spread(fitMe)).toBeGreaterThan(spread(fit) * 0.6);
  });

  it('does not collapse the board into a handful of buckets', () => {
    const distinct = (v: number[]) => new Set(v).size;
    expect(distinct(fitMe)).toBeGreaterThan(distinct(fit) * 0.8);
  });

  it('still ranks the same men near the top under both lenses', () => {
    // The two questions are different and the orders should differ — but not
    // wholly: the best players in a league are the best players in it whoever
    // is asking. Half of one top ten belongs in the other.
    const top = (key: 'fit' | 'fitMe') => model.allFits
      .slice().sort((a, b) => b[key] - a[key]).slice(0, 10).map(x => x.id);
    const shared = top('fit').filter(id => top('fitMe').indexOf(id) >= 0);
    expect(shared.length).toBeGreaterThanOrEqual(5);
  });
});

/* A scale belongs to the pool it is measuring — see `poolFloor`. */
describe('the bottom of a pool', () => {
  it('is its own smallest real value', () => {
    expect(poolFloor([5, 2, 9])).toBe(2);
    expect(poolFloor([0.004, 12])).toBe(0.004);
  });

  it('treats a missing price as absent, not as the cheapest man in the league', () => {
    // A player the market has no number for would otherwise become the floor
    // the whole league is measured against.
    expect(poolFloor([0, 5, 2])).toBe(2);
    expect(poolFloor([-3, 5, 2])).toBe(2);
    expect(poolFloor([NaN, 5, 2])).toBe(2);
    expect(poolFloor([Infinity, 5, 2])).toBe(2);
  });

  it('has none at all when there is nothing in it', () => {
    // Which `talentScale` reads as the three decades a draft board wants.
    expect(poolFloor([])).toBeUndefined();
    expect(poolFloor([0, NaN])).toBeUndefined();
  });

  it('gives a pool that has been aged a lower floor than the same pool today', () => {
    // The future lens ranks aged values, so it needs an aged floor. Handed
    // today's, its oldest players fall off the bottom of the scale together.
    const today = [100, 40, 12];
    const aged = today.map((v, i) => v * [0.9, 0.7, 0.5][i]!);
    expect(poolFloor(aged) as number).toBeLessThan(poolFloor(today) as number);
  });
});

/* The elite hold inside `ageCurve` takes a 0..1 quality, and the future lens
   was handing it one measured against three decades of value rather than
   against the league. On that scale almost every rostered player reads ~1, so
   almost every rostered player was credited with a star's ability to age well —
   including the ones at the bottom, who came out BETTER two years out than they
   are today while the actual stars declined. */
describe('who gets to age well', () => {
  const past = model.allFits.filter(x => x.age != null && x.age > PRIME[x.pos][1]);

  it('has past-prime players to talk about', () => {
    expect(past.length).toBeGreaterThan(20);
  });

  it('does not let a player past his prime get better in two years', () => {
    const gains = past.map(x => x.fit2 - x.fit);
    // A point either way is rounding. Four is the model telling you a
    // replacement-level 31-year-old receiver is a rising asset.
    expect(Math.max(...gains)).toBeLessThanOrEqual(1);
    expect(gains.filter(g => g > 0).length).toBeLessThan(past.length * 0.1);
  });
});
