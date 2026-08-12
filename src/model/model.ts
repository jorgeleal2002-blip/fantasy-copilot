import { avatarUrl } from '../api/sleeper';
import type { LeagueBundle, Pos, SleeperPlayer, SleeperRoster } from '../api/types';
import {
  BASE_ROUND_VALUE, ELIG, MetricKey, POS, PEAK, SLOT_SORT, STRATS, StratKey,
} from './constants';
import { ageCurve, clamp, dynastyVal, playerName } from './math';
import type { Market } from './market';
import { ownedWeights, redraftWeights, scorePlayer } from './score';
import type {
  BoardPlayer, DraftDeal, LeagueRow, LineupItem, LineupSlot, Model, MyDraftPick, Offer,
  OppPlayer, PickAsset, PlayerFit, PositionMultiplier, RosterPlayer, SearchEntry, TeamEntry, TeamProfile,
  TeamSheet, Window,
} from './types';
import type { UsageMap } from './usage';

export interface ModelInput {
  data: LeagueBundle;
  usage: UsageMap;
  market: Market | null;
  strat: StratKey;
  boardMode: 'rookies' | 'fa';
  pickSel: number;
}

/**
 * Everything the screens read is derived here, in one pass, from live league
 * data. Nothing is cached between calls: a roster move, a completed pick or a
 * refreshed market re-runs the whole thing, which is what keeps the trade
 * offers and the board honest.
 */
export function buildModel(input: ModelInput): Model {
  const { data: d, usage, market: mk, strat, boardMode, pickSel } = input;
  const players = d.players;
  const league = d.league;
  const uFor = (id: string) => usage[id];

  // ── Format: which slots this league starts, and how many of each.
  const rp = league.roster_positions || [];
  const starters = {} as Record<Pos, number>;
  POS.forEach(p => { starters[p] = rp.filter(x => x === p).length; });
  const flex = rp.filter(x => x === 'FLEX' || x === 'SUPER_FLEX' || x === 'REC_FLEX').length;
  const sflx = rp.indexOf('SUPER_FLEX') >= 0;
  const isDynasty = (league.settings || {}).type === 2;
  const w = isDynasty ? STRATS[strat].w : redraftWeights(STRATS[strat].w);
  const metricKeys = Object.keys(w) as MetricKey[];

  const slotToRoster = (d.draft && d.draft.slot_to_roster_id) || {};
  const draftOrder = (d.draft && d.draft.draft_order) || {};
  const mySlot = draftOrder[d.me.user_id] || null;

  const teams: TeamEntry[] = d.users.map(u => ({
    id: u.user_id,
    name: (u.metadata && u.metadata.team_name) || u.display_name || 'Team',
    avatar: avatarUrl((u.metadata && u.metadata.avatar) || u.avatar),
    slot: draftOrder[u.user_id] || null,
    isMe: u.user_id === d.me.user_id,
  })).sort((a, b) => (a.slot || 99) - (b.slot || 99));
  const teamName = (ownerId: string | undefined) =>
    (teams.find(t => t.id === ownerId) || {} as TeamEntry).name || 'Team';

  // ── Who is already owned: drafted this year, or on any roster.
  const takenIds = new Set<string>(d.picks.map(p => p.player_id));
  (d.rosters || []).forEach(r => (r.players || []).forEach(id => takenIds.add(id)));
  const myRow = (d.rosters || []).find(r => r.owner_id === d.me.user_id) || ({} as SleeperRoster);
  const myIds = (myRow.players || []).slice();
  const pickRound: Record<string, number> = {};
  d.picks.filter(p => p.picked_by === d.me.user_id).forEach(p => { pickRound[p.player_id] = p.round; });

  const teamCount = league.total_rosters || teams.length || 12;
  const rounds = (d.draft && d.draft.settings && d.draft.settings.rounds) || 15;
  const nextOverall = d.picks.length + 1;
  const nextRound = Math.floor((nextOverall - 1) / teamCount) + 1;
  const nextSlot = ((nextOverall - 1) % teamCount) + 1;

  // ── The format's positional premium, read from this league's real scoring
  //    rules: superflex lifts QB, TE premium lifts TE, and RB carries a dynasty
  //    discount because its value curve falls faster than any other position's.
  const sc = league.scoring_settings || {};
  const rec = sc.rec || 0, teB = sc.bonus_rec_te || 0, rushFd = sc.rush_fd || 0, recFd = sc.rec_fd || 0;
  const passTd = sc.pass_td != null ? sc.pass_td : 4;
  const passYd = sc.pass_yd != null ? sc.pass_yd : 0.04;
  const mult: Record<Pos, number> = {
    QB: (sflx ? 1.32 : 0.78) * (1 + (passTd - 4) * 0.05) * (1 + (passYd - 0.04) * 3),
    RB: 0.84 * (1 + rushFd * 0.30),
    WR: 1.06 * (0.94 + rec * 0.12 + recFd * 0.30),
    TE: 0.88 * (1 + (teB + recFd * 0.5) * 0.32),
  };
  const multInfo: PositionMultiplier[] = [
    { pos: 'QB', mult: mult.QB, why: sflx ? 'Superflex: you can start two QBs, the scarcest slot in the format' : '1QB: no scarcity premium' },
    { pos: 'RB', mult: mult.RB, why: rushFd ? 'Dynasty age discount, offset by +' + rushFd + ' per rushing first down' : 'Dynasty discount: the position that sheds value fastest' },
    { pos: 'WR', mult: mult.WR, why: rec + ' per reception' + (recFd ? ' plus receiving first downs' : ' and no receiving first-down bonus') },
    { pos: 'TE', mult: mult.TE, why: teB ? 'TE premium: +' + teB + ' extra per catch, so ' + (rec + teB) + ' a reception' : 'No TE premium' },
  ];

  // ── Value: real market when it loaded, our own model when it did not.
  const mval = (pl: SleeperPlayer): number | null => {
    const row = mk && pl && pl.player_id ? mk.players[pl.player_id] : null;
    return row ? row.value / 100 : null;
  };
  const quality = (pl: SleeperPlayer): number => {
    const v = mval(pl);
    return v != null ? v : dynastyVal(pl, mult) * 100;
  };

  // ── Quality measured twice. The market is the best judgement available, but
  // it is somebody else's judgement: where you only copy the market you cannot
  // beat it. Real production is the second opinion. Where they agree there is
  // nothing to do; where they diverge is the edge. Note this feeds the Fit
  // only — trades are still priced at pure market, because a rival will not
  // accept an offer with YOUR opinion baked into it.
  const prodMap: Partial<Record<Pos, { vals: number[]; ppgs: number[] }>> = {};
  {
    const byPos: Partial<Record<Pos, { v: number; ppg: number }[]>> = {};
    for (const pid in players) {
      const pl = players[pid];
      if (!pl || POS.indexOf(pl.position as Pos) < 0) continue;
      const u = uFor(pid);
      const v = mval(pl);
      if (v == null || !u || !Number.isFinite(u.ppg) || !(u.gp >= 4)) continue;
      (byPos[pl.position as Pos] = byPos[pl.position as Pos] || []).push({ v, ppg: u.ppg as number });
    }
    POS.forEach(p => {
      const arr = byPos[p];
      if (!arr || arr.length < 10) return;
      prodMap[p] = {
        vals: arr.map(x => x.v).sort((a, b) => a - b),
        ppgs: arr.map(x => x.ppg).sort((a, b) => a - b),
      };
    });
  }
  const pctOf = (arr: number[], x: number) => {
    let i = 0;
    while (i < arr.length && arr[i] < x) i++;
    return arr.length > 1 ? i / (arr.length - 1) : 0;
  };
  // Quantile mapping: a player's PPG percentile within his position is
  // translated to the market value sitting at that same percentile. Production
  // and market end up in one unit without inventing a conversion factor
  // between points and value.
  const prodVal = (pl: SleeperPlayer, pid: string): number | null => {
    const m = prodMap[pl.position as Pos];
    const u = uFor(pid);
    if (!m || !u || !Number.isFinite(u.ppg) || !(u.gp >= 4)) return null;
    const pct = pctOf(m.ppgs, u.ppg as number);
    return m.vals[Math.min(Math.round(pct * (m.vals.length - 1)), m.vals.length - 1)];
  };
  const talentQ = (pl: SleeperPlayer, pid: string): number => {
    const v = quality(pl);
    const p = prodVal(pl, pid);
    return p == null ? v : v * 0.6 + p * 0.4;
  };
  /** Where market and production disagree, for the player sheet. */
  const qDiverge = (pl: SleeperPlayer | null, pid: string) => {
    const m = pl ? prodMap[pl.position as Pos] : null;
    const u = uFor(pid);
    const v = pl ? mval(pl) : null;
    if (!m || v == null || !u || !Number.isFinite(u.ppg) || !(u.gp >= 4)) return null;
    return { mkt: pctOf(m.vals, v), prod: pctOf(m.ppgs, u.ppg as number) };
  };

  // ── Positional strength: the quality of the starters you can actually field
  //    at each position, ranked against the same slots on every other roster.
  const slots = {} as Record<Pos, number>;
  POS.forEach(p => {
    const share = p === 'QB' ? (sflx ? 1 : 0) : p === 'TE' ? flex * 0.2 : flex * 0.4;
    slots[p] = Math.max(1, Math.round((starters[p] || 0) + share));
  });
  const strengthOf = (ids: string[]): Record<Pos, number> => {
    const out = {} as Record<Pos, number>;
    POS.forEach(p => {
      const qs = ids.map(id => players[id]).filter(pl => pl && pl.position === p)
        .map(quality).sort((a, b) => b - a).slice(0, slots[p]);
      out[p] = qs.reduce((a, b) => a + b, 0) / slots[p];
    });
    return out;
  };
  const allStrength = (d.rosters || []).map(r => ({ owner: r.owner_id, s: strengthOf(r.players || []) }));
  const myStrength = strengthOf(myIds);
  const nTeams = Math.max(allStrength.length, 1);
  const posRank = {} as Record<Pos, number>;
  const posPct = {} as Record<Pos, number>;
  const needScore = {} as Record<Pos, number>;
  POS.forEach(p => {
    posRank[p] = allStrength.filter(t => t.s[p] > myStrength[p]).length + 1;
    posPct[p] = nTeams > 1 ? (nTeams - posRank[p]) / (nTeams - 1) : 0.5;
    needScore[p] = clamp(1 - posPct[p], 0, 1);
  });

  // ── Your roster.
  const starterIds = myRow.starters || [];
  const myPlayers: RosterPlayer[] = myIds.map(id => {
    const pl = players[id];
    if (!pl || !POS.includes(pl.position as Pos)) return null;
    return {
      id, name: playerName(pl), pos: pl.position as Pos, age: pl.age ?? null,
      team: pl.team || 'FA', exp: pl.years_exp ?? null, adp: pl.search_rank,
      injury: pl.injury_status || '', starter: starterIds.indexOf(id) >= 0,
      round: pickRound[id], raw: pl,
    } as unknown as RosterPlayer;
  }).filter(Boolean) as RosterPlayer[];
  myPlayers.sort((a, b) => POS.indexOf(a.pos) - POS.indexOf(b.pos) || (a.adp || 999) - (b.adp || 999));

  const have = {} as Record<Pos, number>;
  POS.forEach(p => { have[p] = myPlayers.filter(x => x.pos === p).length; });

  // ── Every pick you really own in this draft, acquisitions included.
  const slotOfRoster: Record<number, number> = {};
  Object.keys(slotToRoster).forEach(sl => { slotOfRoster[slotToRoster[sl]] = Number(sl); });
  const myPickList: MyDraftPick[] = [];
  for (let r = 1; r <= rounds; r++) {
    (d.rosters || []).forEach(orig => {
      let owner = orig.roster_id;
      (d.traded || [])
        .filter(t => String(t.season) === String(league.season) && Number(t.round) === r && Number(t.roster_id) === orig.roster_id)
        .forEach(t => { owner = Number(t.owner_id); });
      if (owner !== myRow.roster_id) return;
      const slot = slotOfRoster[orig.roster_id];
      if (!slot) return;
      const slotThisRound = (d.draft && d.draft.type === 'snake' && r % 2 === 0) ? (teamCount - slot + 1) : slot;
      const overall = (r - 1) * teamCount + slotThisRound;
      myPickList.push({
        round: r, slot: slotThisRound, overall,
        label: r + '.' + String(slotThisRound).padStart(2, '0'),
        via: orig.roster_id === myRow.roster_id ? null : teamName(orig.owner_id),
        done: overall < nextOverall,
      });
    });
  }
  myPickList.sort((a, b) => a.overall - b.overall);
  const upcoming = myPickList.filter(p => !p.done);
  const selIdx = Math.min(pickSel || 0, Math.max(upcoming.length - 1, 0));
  const selPick = upcoming[selIdx] || myPickList[myPickList.length - 1] || null;
  const myNextOverall = selPick ? selPick.overall : null;
  const myRound = myNextOverall ? Math.floor((myNextOverall - 1) / teamCount) + 1 : nextRound;
  const myPickInRound = myNextOverall ? ((myNextOverall - 1) % teamCount) + 1 : nextSlot;
  const pickForValue = myNextOverall || nextOverall;

  // ── The board. This league's draft is rookies only, so that is the default;
  //    the free-agent switch is there for waiver work.
  const rookieMode = isDynasty && boardMode !== 'fa';
  const pool: { id: string; raw: SleeperPlayer }[] = [];
  for (const id in players) {
    const p = players[id];
    if (!p || !POS.includes(p.position as Pos) || takenIds.has(id)) continue;
    if (p.active === false) continue;
    if (p.status && p.status !== 'Active') continue;
    const isRookie = (p.years_exp === 0 || p.years_exp == null) && !!p.age && p.age <= 24;
    if (rookieMode) {
      if (!isRookie || !p.search_rank || p.search_rank > 900) continue;
    } else {
      if (!p.team || !p.search_rank || p.search_rank > 400) continue;
    }
    pool.push({ id, raw: p });
  }
  pool.sort((a, b) => (a.raw.search_rank || 0) - (b.raw.search_rank || 0));

  // ── NFL-team correlation: sharing an offence with your QB pays twice;
  //    sharing the ball with your own player cuts both your players' shares.
  const stackIn = (roster: { id: string; pos: Pos; team: string }[], pl: SleeperPlayer, exclude?: string): number => {
    const mates = roster.filter(x => x.team === pl.team && x.id !== exclude);
    let v = 0.5;
    const isCatcher = pl.position === 'WR' || pl.position === 'TE';
    if (isCatcher && mates.some(x => x.pos === 'QB')) v += 0.25;
    if (pl.position === 'QB' && mates.some(x => x.pos === 'WR' || x.pos === 'TE')) v += 0.25;
    if (pl.position === 'RB' && mates.some(x => x.pos === 'RB')) v -= 0.22;
    if (pl.position === 'WR' && mates.filter(x => x.pos === 'WR').length >= 1) v -= 0.12;
    if (pl.position === 'TE' && mates.some(x => x.pos === 'TE')) v -= 0.12;
    if (mates.length >= 3) v -= 0.12;
    return clamp(v, 0, 1);
  };
  /** The bound case: correlation against my own roster. */
  const stackFor = (pl: SleeperPlayer, exclude?: string) => stackIn(myPlayers, pl, exclude);

  const byTeam: Record<string, RosterPlayer[]> = {};
  myPlayers.forEach(p => { (byTeam[p.team] = byTeam[p.team] || []).push(p); });
  const stacks: Model['stacks'] = [];
  const conflicts: Model['conflicts'] = [];
  const concentration: Model['concentration'] = [];
  Object.keys(byTeam).forEach(t => {
    const list = byTeam[t];
    const qb = list.filter(p => p.pos === 'QB')[0];
    const catchers = list.filter(p => p.pos === 'WR' || p.pos === 'TE');
    const rbs = list.filter(p => p.pos === 'RB');
    const wrs = list.filter(p => p.pos === 'WR');
    if (qb && catchers.length) {
      stacks.push({ team: t, text: qb.name + ' + ' + catchers.map(c => c.name).join(', '), why: 'One good game from that offence pays you twice' });
    }
    if (rbs.length > 1) conflicts.push({ team: t, text: rbs.map(r => r.name).join(' · '), why: 'They split carries out of the same backfield' });
    if (wrs.length > 2) conflicts.push({ team: t, text: wrs.map(r => r.name).join(' · '), why: 'They compete for the same targets' });
    if (list.length >= 4) concentration.push({ team: t, text: list.length + ' of your players on ' + t, why: 'Same bye week and the same bad-game risk' });
  });

  const dvAll = pool.slice(0, 60).map(x => talentQ(x.raw, x.id)).concat(myPlayers.map(p => talentQ(p.raw, p.id)));
  const dvMax = Math.max.apply(null, dvAll.concat([0.01]));

  const scored: BoardPlayer[] = pool.slice(0, 160).map((x, i) => {
    const p = x.raw;
    const s = scorePlayer(p, needScore, {
      idx: i + 1, pick: pickForValue, dv: talentQ(p, x.id), dvMax,
      stack: stackFor(p), use: uFor(x.id), redraft: !isDynasty,
    }, w);
    return {
      id: x.id, name: playerName(p), pos: p.position as Pos, team: p.team,
      age: p.age, exp: p.years_exp, adp: s.adp, m: s.m, fit: s.fit, raw: p, use: uFor(x.id),
    };
  }).sort((a, b) => b.fit - a.fit);

  // Your own players are scored on the renormalised weights (see ownedWeights).
  const wOwn = ownedWeights(w);
  myPlayers.forEach(p => {
    const s = scorePlayer(p.raw, {}, {
      dv: talentQ(p.raw, p.id), dvMax, stack: stackFor(p.raw, p.id), use: uFor(p.id), redraft: !isDynasty,
    }, wOwn);
    p.use = uFor(p.id);
    p.m = s.m;
    p.fit = s.fit;
    p.owned = true;
    p.wEff = wOwn;
    p.q = quality(p.raw);
  });

  // ── Optimal lineup: fill every slot the format defines with your best
  //    eligible player, scarcest slot first so a flex never steals a starter.
  const lineupSlots = rp.filter(x => ELIG[x]);
  const used: Record<string, 1> = {};
  const optimal: LineupSlot[] = lineupSlots.slice()
    .sort((a, b) => ELIG[a].length - ELIG[b].length)
    .map(slot => {
      const cand = myPlayers.filter(p => !used[p.id] && ELIG[slot].indexOf(p.pos) >= 0).sort((a, b) => b.q - a.q)[0];
      if (cand) used[cand.id] = 1;
      return { slot, player: cand };
    })
    .sort((a, b) => SLOT_SORT[a.slot] - SLOT_SORT[b.slot]);

  const curStarters = (myRow.starters || []).filter(x => x && x !== '0');
  const optIds = optimal.filter(o => o.player).map(o => o.player!.id);
  const swaps = optimal.filter(o => o.player && curStarters.indexOf(o.player.id) < 0);
  const totalQ = myPlayers.reduce((a, b) => a + b.q, 0) || 1;
  const benchQ = myPlayers.filter(p => optIds.indexOf(p.id) < 0).reduce((a, b) => a + b.q, 0);
  const starterQ = totalQ - benchQ;

  const lineupSum = (list: LineupItem[]): number => {
    const seen: Record<string, 1> = {};
    return lineupSlots.slice().sort((a, b) => ELIG[a].length - ELIG[b].length).reduce((sum, slot) => {
      const c = list.filter(p => !seen[p.id] && ELIG[slot].indexOf(p.pos as Pos) >= 0).sort((a, b) => b.q - a.q)[0];
      if (c) { seen[c.id] = 1; return sum + c.q; }
      return sum;
    }, 0);
  };
  /**
   * A team's Fit Score: the average Fit of its optimal starters, scored on the
   * weights without the need term (nobody fills their own hole) and with the
   * stack measured inside THEIR roster, not mine.
   *
   * `years` of 0 measures today; 2 ages every player two seasons and picks the
   * starters again on the projected quality — whoever starts today may not
   * start then.
   */
  const lineupFit = (list: OppPlayer[], years: number): number => {
    const yr = years || 0;
    const cands = list.map(p => {
      if (!yr) return { p, raw: p.raw, q: p.q };
      const el = clamp(p.q / (dvMax || 1), 0, 1);
      const cur = ageCurve(p.pos, p.age, el) || 0.5;
      const raw = { ...p.raw, age: (p.age || 25) + yr, years_exp: (p.raw.years_exp || 0) + yr };
      return { p, raw, q: p.q * (ageCurve(p.pos, (p.age || 25) + yr, el) / Math.max(cur, 0.05)) };
    });
    const seen: Record<string, 1> = {};
    const starters = lineupSlots.slice()
      .sort((a, b) => ELIG[a].length - ELIG[b].length)
      .map(slot => {
        const c = cands.filter(x => !seen[x.p.id] && ELIG[slot].indexOf(x.p.pos) >= 0).sort((a, b) => b.q - a.q)[0];
        if (c) seen[c.p.id] = 1;
        return c;
      })
      .filter(Boolean);
    if (!starters.length) return 0;
    const sum = starters.reduce((a, x) => a + scorePlayer(x.raw, {}, {
      dv: talentQ(x.raw, x.p.id), dvMax, stack: stackIn(list, x.raw, x.p.id),
      use: uFor(x.p.id), redraft: !isDynasty,
    }, wOwn).fit, 0);
    return sum / starters.length;
  };

  const myBase = lineupSum(myPlayers);

  // ── Rookie picks as tradeable capital: real owner from the league's traded
  //    picks, valued at the market's price for that exact slot when it has one.
  const seasonNum = Number(league.season) || new Date().getFullYear();
  const rosterStrength: Record<number, number> = {};
  (d.rosters || []).forEach(r => {
    rosterStrength[r.roster_id] = (r.players || []).reduce((a, id) => {
      const pl = players[id];
      return a + (pl && POS.indexOf(pl.position as Pos) >= 0 ? quality(pl) : 0);
    }, 0);
  });
  const strengthOrder = Object.keys(rosterStrength).sort((a, b) => rosterStrength[Number(a)] - rosterStrength[Number(b)]);

  const picksByOwner: Record<number, PickAsset[]> = {};
  if (isDynasty) {
    [seasonNum, seasonNum + 1, seasonNum + 2].forEach(sea => {
      for (let r = 1; r <= rounds; r++) {
        (d.rosters || []).forEach(orig => {
          let owner = orig.roster_id;
          (d.traded || [])
            .filter(t => Number(t.season) === sea && Number(t.round) === r && Number(t.roster_id) === orig.roster_id)
            .forEach(t => { owner = Number(t.owner_id); });
          const weakIdx = strengthOrder.indexOf(String(orig.roster_id));
          const slotMult = 0.80 + (weakIdx >= 0 ? (1 - weakIdx / Math.max(strengthOrder.length - 1, 1)) : 0.5) * 0.45;
          const yearMult = Math.pow(0.88, sea - seasonNum);
          const own = orig.roster_id === owner;
          const origSlot = slotOfRoster[orig.roster_id];

          // A pick stops being an asset the moment it is used.
          if (sea === seasonNum && origSlot) {
            const slotR = (d.draft && d.draft.type === 'snake' && r % 2 === 0) ? (teamCount - origSlot + 1) : origSlot;
            if ((r - 1) * teamCount + slotR <= (d.picks || []).length) return;
          }

          const named = origSlot && sea === seasonNum
            ? sea + ' pick ' + r + '.' + String(origSlot).padStart(2, '0')
            : sea + ' round ' + r;
          const value = (() => {
            const ex = mk && origSlot ? mk.exact[sea + '-' + r + '-' + origSlot] : null;
            if (ex != null) return ex / 100;                                     // this draft's exact slot
            if (mk && mk.picks[sea + '-' + r] != null) return mk.picks[sea + '-' + r] / 100; // market already discounts the year
            return (BASE_ROUND_VALUE[r] || 2) * slotMult * yearMult;             // last resort
          })();

          (picksByOwner[owner] = picksByOwner[owner] || []).push({
            id: 'pick-' + sea + '-' + r + '-' + orig.roster_id,
            pos: 'PICK', team: '—', age: null,
            name: named + (own ? '' : ' (via ' + teamName(orig.owner_id) + ')'),
            label: origSlot && sea === seasonNum
              ? 'Pick ' + r + '.' + String(origSlot).padStart(2, '0')
              : 'Round ' + r,
            origin: own
              ? (sea === seasonNum ? 'Your own pick, slot ' + origSlot : 'Your own pick, slot not set yet')
              : 'Acquired from ' + teamName(orig.owner_id),
            q: value, season: sea, round: r, isPick: true,
          });
        });
      }
    });
  }
  Object.keys(picksByOwner).forEach(k => picksByOwner[Number(k)].sort((a, b) => b.q - a.q));
  const pickAssets = picksByOwner[myRow.roster_id] || [];

  const mapRoster = (ids: string[] | null | undefined): OppPlayer[] => (ids || []).map(id => {
    const pl = players[id];
    if (!pl || POS.indexOf(pl.position as Pos) < 0) return null;
    return {
      id, name: playerName(pl), pos: pl.position as Pos, age: pl.age ?? null,
      team: pl.team || 'FA', q: quality(pl), raw: pl,
    } as OppPlayer;
  }).filter(Boolean) as OppPlayer[];

  // ── Reading the other manager: contending or rebuilding, and where they hurt.
  const teamProfile: Record<number, TeamProfile> = {};
  (d.rosters || []).forEach(r => {
    const list = mapRoster(r.players);
    const wq = list.reduce((a, b) => a + b.q, 0) || 1;
    const avgAge = list.reduce((a, b) => a + (b.age || 25) * b.q, 0) / wq;
    const rank = strengthOrder.slice().reverse().indexOf(String(r.roster_id)) + 1; // 1 = strongest
    const strong = rank <= Math.ceil(nTeams / 3);
    const weak = rank > Math.ceil(nTeams * 2 / 3);
    const old = avgAge >= 26.2, young = avgAge <= 24.6;
    const topHalf = rank <= nTeams / 2;
    // An old roster in seventh place is not a contender — it is stuck in the middle.
    const window: Window = strong ? 'contender' : weak ? 'rebuild'
      : (old && topHalf) ? 'contender' : (young && !topHalf) ? 'rebuild' : 'medio';
    const st = allStrength.find(x => x.owner === r.owner_id);
    let worst: Pos | null = null, worstRank = 0;
    POS.forEach(p => {
      const pr = 1 + allStrength.filter(t => t.s[p] > (st ? st.s[p] : 0)).length;
      if (pr > worstRank) { worstRank = pr; worst = p; }
    });
    teamProfile[r.roster_id] = { window, avgAge, rank, worst, worstRank };
  });

  // ── League ranking: strength today vs. value two seasons out (aged roster
  //    plus the pick capital each team actually owns).
  const leagueRows: LeagueRow[] = (d.rosters || []).map(r => {
    const list = mapRoster(r.players);
    const now = lineupSum(list);
    const decayed = list.reduce((a, p) => {
      const cur = ageCurve(p.pos, p.age) || 0.5;
      return a + p.q * (ageCurve(p.pos, (p.age || 25) + 2) / Math.max(cur, 0.05));
    }, 0);
    const pickCapital = (picksByOwner[r.roster_id] || []).reduce((a, b) => a + b.q, 0);
    const prof = teamProfile[r.roster_id] || ({} as TeamProfile);
    const st = allStrength.find(x => x.owner === r.owner_id);
    return {
      id: r.roster_id, ownerId: r.owner_id, name: teamName(r.owner_id),
      isMe: r.owner_id === d.me.user_id,
      avatar: (teams.find(t => t.id === r.owner_id) || {} as TeamEntry).avatar || null,
      posStrength: st ? st.s : {},
      now, future: decayed * 0.55 + pickCapital, pickCapital,
      fit: lineupFit(list, 0),
      fitFut: isDynasty ? lineupFit(list, 2) : 0,
      avgAge: prof.avgAge || 0, window: prof.window || 'medio', worst: prof.worst || null,
      rankNow: 0, rankFut: 0, rankFit: 0, rankFitFut: 0, shift: 0,
    };
  });

  // ── Every player in the league, scored through three lenses. Neutral is
  //    "how good is he, full stop"; "for you" adds your own positional need and
  //    measures the stack against your roster; "in two years" ages him and
  //    discounts his quality by exactly what his position keeps at that age.
  const allFits: PlayerFit[] = [];
  (d.rosters || []).forEach(r => {
    const list = mapRoster(r.players);
    const owner = teamName(r.owner_id);
    const mine = r.owner_id === d.me.user_id;
    list.forEach(p => {
      const neutral = scorePlayer(p.raw, {}, {
        dv: talentQ(p.raw, p.id), dvMax, stack: stackIn(list, p.raw, p.id),
        use: uFor(p.id), redraft: !isDynasty,
      }, wOwn);
      if (!Number.isFinite(neutral.fit)) return;
      const forMe = scorePlayer(p.raw, needScore, {
        dv: talentQ(p.raw, p.id), dvMax, stack: stackIn(myPlayers, p.raw, p.id),
        use: uFor(p.id), redraft: !isDynasty,
      }, w);
      const el = clamp(talentQ(p.raw, p.id) / (dvMax || 1), 0, 1);
      const cur = ageCurve(p.pos, p.age, el) || 0.5;
      const keep = ageCurve(p.pos, (p.age || 25) + 2, el) / Math.max(cur, 0.05);
      const raw2 = { ...p.raw, age: (p.age || 25) + 2, years_exp: (p.raw.years_exp || 0) + 2 };
      const ahead = scorePlayer(raw2, {}, {
        dv: talentQ(p.raw, p.id) * keep, dvMax, stack: stackIn(list, p.raw, p.id),
        use: uFor(p.id), redraft: !isDynasty,
      }, wOwn);
      allFits.push({
        id: p.id, name: p.name, pos: p.pos, team: p.team, age: p.age,
        fit: neutral.fit,
        fitMe: Number.isFinite(forMe.fit) ? forMe.fit : neutral.fit,
        fit2: Number.isFinite(ahead.fit) ? ahead.fit : neutral.fit,
        owner, mine,
      });
    });
  });
  allFits.sort((a, b) => b.fit - a.fit);
  const orderNow = leagueRows.slice().sort((a, b) => b.now - a.now);
  const orderFut = leagueRows.slice().sort((a, b) => b.future - a.future);
  const orderFit = leagueRows.slice().sort((a, b) => b.fit - a.fit);
  const orderFitFut = leagueRows.slice().sort((a, b) => b.fitFut - a.fitFut);
  leagueRows.forEach(x => {
    x.rankNow = orderNow.indexOf(x) + 1;
    x.rankFut = orderFut.indexOf(x) + 1;
    x.rankFit = orderFit.indexOf(x) + 1;
    x.rankFitFut = orderFitFut.indexOf(x) + 1;
    x.shift = x.rankNow - x.rankFut;
  });

  // One ranking rule for the whole app, so ties resolve the same way everywhere.
  const posRankOf = (rid: number, p: Pos): number => {
    const ordered = leagueRows.slice().sort((a, b) => (b.posStrength[p] || 0) - (a.posStrength[p] || 0));
    return ordered.findIndex(x => x.id === rid) + 1;
  };
  const leagueHasRosters = leagueRows.some(x => x.now > 0);

  const teamInfo = (rid: number): TeamSheet | null => {
    const row = leagueRows.find(x => x.id === rid);
    const r = (d.rosters || []).find(x => x.roster_id === rid);
    if (!row || !r) return null;
    const list = mapRoster(r.players).sort((a, b) => b.q - a.q);
    const ranks = {} as Record<Pos, number>;
    POS.forEach(p => { ranks[p] = posRankOf(row.id, p); });
    const bestPos = POS.slice().sort((a, b) => ranks[a] - ranks[b])[0];
    return { row, list, ranks, bestPos, picks: (picksByOwner[rid] || []).slice().sort((a, b) => b.q - a.q) };
  };

  // ── Trade engine. Every offer is simulated on both sides: your optimal
  //    lineup and theirs are recomputed with the swap applied, and the deal
  //    only survives if you gain and they would plausibly say yes.
  const offers: Offer[] = [];
  (d.rosters || []).filter(r => r.owner_id !== d.me.user_id).forEach(r => {
    const them = mapRoster(r.players);
    if (!them.length) return;
    const theirBase = lineupSum(them);
    const partner = teamName(r.owner_id);
    const prof = teamProfile[r.roster_id] || ({ window: 'medio', worst: null } as TeamProfile);

    // Only pieces outside your optimal lineup are on the table — never a starter.
    const mineGive: (RosterPlayer | PickAsset)[] = (myPlayers.filter(p => optIds.indexOf(p.id) < 0)
      .sort((a, b) => b.q - a.q).slice(0, 10) as (RosterPlayer | PickAsset)[])
      .concat(pickAssets.slice(0, 4));
    const theirGet = them.slice().sort((a, b) => b.q - a.q).slice(0, 14);

    let best: Offer | null = null;
    mineGive.forEach(give => theirGet.forEach(get => {
      if (give.pos === get.pos && !give.isPick) return;
      // A contender does not trade its lineup for future picks; a rebuilder will.
      if (give.isPick && prof.window !== 'rebuild') return;
      // Nobody sells you the very position they are short at.
      if (prof.worst && get.pos === prof.worst) return;

      const ref = Math.max(give.q, get.q, 1);
      const myEdge = (get.q - give.q) / ref;   // + buying under market · − overpaying
      const myAfter = lineupSum((myPlayers as LineupItem[]).filter(p => p.id !== give.id).concat([get]));
      const gain = myAfter - myBase;
      if (gain <= 0.3) return;

      const theirAfter = lineupSum((them as LineupItem[]).filter(p => p.id !== get.id).concat([give]));
      const theirGain = theirAfter - theirBase;
      // Overpaying is fine only to the extent your lineup actually jumps.
      if (myEdge < -clamp(0.03 + gain * 0.012, 0, 0.20)) return;
      // And they only eat a loss to the extent their own lineup improves.
      if (myEdge > clamp(0.03 + Math.max(theirGain, 0) * 0.02, 0, 0.16)) return;
      // If they lose lineup points (the pick case), they need a value premium to answer at all.
      if (theirGain < -0.3 && myEdge > -0.05) return;

      const fillsTheirNeed = !!prof.worst && give.pos === prof.worst;
      const perSlot = myBase / Math.max(lineupSlots.length, 1);
      const gainRel = gain / Math.max(perSlot, 1);
      const fit = clamp(Math.round(
        50 + gainRel * 34 + myEdge * 70 + Math.min(Math.max(theirGain, 0), 6) * 1.2 + (fillsTheirNeed ? 6 : 0),
      ), 40, 93);
      if (!best || fit > best.fit) {
        best = { partner, give, get, gain, theirGain, fit, edge: myEdge, kind: 'lineup', prof, fillsTheirNeed };
      }
    }));
    if (best) offers.push(best);

    // Capital variant: send them somebody who does start for them, take their pick.
    if (prof.window === 'rebuild') return;   // a rebuilder is not selling picks for veterans
    const theirPicks = picksByOwner[r.roster_id] || [];
    let bestPick: Offer | null = null;
    myPlayers.filter(p => optIds.indexOf(p.id) < 0)
      .sort((a, b) => b.q - a.q).slice(0, 8)
      .forEach(give => theirPicks.forEach(get => {
        const myValueGain = get.q - give.q;
        if (myValueGain <= 0) return;                        // only if you gain value
        if (get.q > give.q * 1.15) return;                   // but within what a rival would accept
        const myAfter = lineupSum((myPlayers as LineupItem[]).filter(p => p.id !== give.id));
        if (myAfter < myBase - 0.01) return;                 // and without touching your lineup
        const theirGain = lineupSum((them as LineupItem[]).concat([give])) - theirBase;
        if (theirGain <= 0.3) return;                        // they have to want it
        const edge = myValueGain / Math.max(give.q, get.q, 1);
        if (edge > clamp(0.03 + theirGain * 0.035, 0, 0.18)) return;  // do not ask for a robbery
        const fillsTheirNeed = !!prof.worst && give.pos === prof.worst;
        const fit = clamp(Math.round(50 + edge * 120 + Math.min(theirGain, 5) * 2.2 + (fillsTheirNeed ? 6 : 0)), 40, 90);
        if (!bestPick || fit > bestPick.fit) {
          bestPick = { partner, give, get, gain: myValueGain, theirGain, fit, edge, kind: 'capital', prof, fillsTheirNeed };
        }
      }));
    if (bestPick) offers.push(bestPick);
  });
  offers.sort((a, b) => b.fit - a.fit);

  // ── Pick movement for the draft: trade up (pay a premium to consolidate) or
  //    down (charge a premium to collect two swings), priced off the market.
  const draftDeals: DraftDeal[] = [];
  const myNow = pickAssets.filter(p => p.season === seasonNum).sort((a, b) => b.q - a.q);
  const myBestPick = myNow[0];
  if (myBestPick) {
    const sweeteners: (PickAsset | RosterPlayer)[] = (pickAssets.filter(p => p.id !== myBestPick.id) as (PickAsset | RosterPlayer)[])
      .concat(myPlayers.filter(p => optIds.indexOf(p.id) < 0).sort((a, b) => b.q - a.q).slice(0, 6));

    (d.rosters || []).filter(r => r.owner_id !== d.me.user_id).forEach(r => {
      const prof = teamProfile[r.roster_id] || ({ window: 'medio' } as TeamProfile);
      const partner = teamName(r.owner_id);
      const theirNow = (picksByOwner[r.roster_id] || []).filter(p => p.season === seasonNum);

      // UP: pay a premium to consolidate into a higher pick.
      theirNow.filter(t => t.q > myBestPick.q * 1.05).forEach(target => {
        sweeteners.forEach(extra => {
          const ratio = (myBestPick.q + extra.q) / target.q;
          if (ratio < 1.0 || ratio > 1.18) return;
          if (prof.window === 'contender') return;      // a contender does not move down the board
          const fit = clamp(Math.round(74 - (ratio - 1) * 170 + (prof.window === 'rebuild' ? 8 : 0)), 40, 92);
          draftDeals.push({ kind: 'up', partner, get: [target], give: [myBestPick, extra], ratio, fit, prof });
        });
      });

      // DOWN: collect volume and charge for the slot.
      theirNow.forEach((a, i) => theirNow.slice(i + 1).forEach(b => {
        if (a.q >= myBestPick.q || b.q >= myBestPick.q) return;
        const ratio = (a.q + b.q) / myBestPick.q;
        if (ratio < 1.02 || ratio > 1.22) return;
        if (prof.window === 'rebuild') return;          // a rebuilder does not move up the board
        const fit = clamp(Math.round(58 + (ratio - 1) * 150 + (prof.window === 'contender' ? 8 : 0)), 40, 92);
        draftDeals.push({ kind: 'down', partner, get: [a, b], give: [myBestPick], ratio, fit, prof });
      }));
    });
  }
  draftDeals.sort((a, b) => b.fit - a.fit);
  const bestDeals: DraftDeal[] = [];
  draftDeals.forEach(x => {
    if (bestDeals.length >= 4) return;
    if (bestDeals.some(y => y.kind === x.kind && y.partner === x.partner)) return;
    bestDeals.push(x);
  });

  const explosive = myPlayers.slice().sort((a, b) => b.m.boom - a.m.boom).slice(0, 5);
  const fading = myPlayers.filter(p => (p.age || 25) > (PEAK[p.pos] || 26) + 1).sort((a, b) => b.q - a.q).slice(0, 4);
  const buried = myPlayers.filter(p => optIds.indexOf(p.id) < 0).sort((a, b) => b.q - a.q).slice(0, 3);

  // A flat index for the search box: built once per model rather than walking
  // the whole catalog on every keystroke.
  const searchIndex: SearchEntry[] = [];
  for (const id in players) {
    const pl = players[id];
    if (!pl || POS.indexOf(pl.position as Pos) < 0) continue;
    const name = playerName(pl);
    if (name) searchIndex.push({ id, name, lower: name.toLowerCase(), pos: pl.position as Pos, rank: pl.search_rank || 99999 });
  }

  // Any player in the league can open a full profile, including other rosters'.
  const scoreAny = (id: string): BoardPlayer | null => {
    const pl = players[id];
    if (!pl || POS.indexOf(pl.position as Pos) < 0) return null;
    const s = scorePlayer(pl, needScore, {
      dv: talentQ(pl, id), dvMax, stack: stackFor(pl), use: uFor(id), redraft: !isDynasty,
    }, w);
    const ownerRow = (d.rosters || []).find(r => (r.players || []).indexOf(id) >= 0);
    return {
      id, name: playerName(pl), pos: pl.position as Pos, team: pl.team || 'FA',
      age: pl.age, exp: pl.years_exp, adp: s.adp, m: s.m, fit: s.fit, raw: pl, use: uFor(id),
      owner: ownerRow ? teamName(ownerRow.owner_id) : null,
      owned: !!ownerRow && ownerRow.owner_id === d.me.user_id,
    };
  };

  return {
    league, draft: d.draft, picks: d.picks, teams,
    me: {
      id: d.me.user_id,
      name: d.me.display_name || 'me',
      teamName: (d.me.metadata && d.me.metadata.team_name) || d.me.display_name || 'Your team',
      avatar: avatarUrl((d.me.metadata && d.me.metadata.avatar) || d.me.avatar),
      initials: (d.me.display_name || 'ME').slice(0, 2).toUpperCase(),
    },
    isDynasty, sflx, teamCount, rounds, seasonNum,
    myPlayers, have, slots, posRank, posPct, needScore,
    scored, optimal, swaps, optIds, benchQ, starterQ, totalQ, myBase,
    explosive, fading, buried, stacks, conflicts, concentration,
    pickAssets, myPickList, upcoming, selPick,
    nextOverall, myRound, myPickInRound, myNextOverall, mySlot,
    offers, bestDeals, leagueRows, leagueHasRosters, multInfo,
    allFits, searchIndex, qDiverge, wUsed: w,
    marketCount: mk ? Object.keys(mk.players).length : 0,
    teamInfo, posRankOf, scoreAny, metricKeys,
  };
}
