/**
 * Whether a trade suits each team in it — not whether it wins on a price list.
 *
 * A team's record says what it should want. A contender is playing for this
 * season and the playoff weeks, so it wins a trade that makes those Sundays
 * better, at a premium if it has to. A dynasty team out of the race is
 * playing for later and wins by taking value. Everybody else wants both and
 * will not pay much in either. Two teams can both win — that is the trade
 * that actually gets accepted — and the headline says so.
 */

export type Situation = 'contender' | 'middle' | 'out';

export interface TeamCase {
  id: number;
  name: string;
  isMe: boolean;
  situation: Situation;
  /** value gained, in the trade engine's currency (consolidation and cuts in) */
  net: number;
  /** what counts as even on value */
  band: number;
  /** points a week over the season left, playoff weeks weighed in; null if unknown */
  perWeek: number | null;
  playoffs: number | null;
}

export type Outcome = 'good' | 'bad' | 'even';

/** Under this many points a week a lineup has not changed in a way anyone feels. */
const FELT = 0.5;

export function situationOf(rank: number, games: number, teamCount: number, playoffTeams: number): Situation {
  if (games < 2) return 'middle';
  if (rank <= playoffTeams) return 'contender';
  if (rank > teamCount - Math.floor(teamCount / 3)) return 'out';
  return 'middle';
}

export function outcomeFor(t: TeamCase, dynasty: boolean): Outcome {
  const vGood = t.net > t.band, vBad = t.net < -t.band;
  const s = t.perWeek;
  const sGood = s != null && s >= FELT, sBad = s != null && s <= -FELT;
  if (t.situation === 'contender') {
    if (sGood) return 'good';
    if (sBad) return 'bad';
    return vGood ? 'good' : vBad ? 'bad' : 'even';
  }
  if (t.situation === 'out' && dynasty) {
    if (vGood) return 'good';
    if (vBad) return sGood ? 'even' : 'bad';
    return sGood ? 'good' : 'even';
  }
  // Wants both, and pays for neither.
  if ((sGood && !vBad) || (vGood && !sBad)) return 'good';
  if (sBad || vBad) return 'bad';
  return 'even';
}

const LABEL: Record<Situation, string> = { contender: 'Contending', middle: 'In the hunt', out: 'Out of the race' };
export const situationLabel = (s: Situation, dynasty: boolean) =>
  s === 'out' && dynasty ? 'Building for later' : LABEL[s];

/** One line on what the trade does for this team, in the terms it cares about. */
export function caseLine(t: TeamCase, dynasty: boolean): string {
  const bits: string[] = [];
  const pts = (x: number) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1);
  if (t.perWeek != null) bits.push(pts(t.perWeek) + ' pts a week this season');
  if (t.playoffs != null && t.perWeek != null && Math.abs(t.playoffs - t.perWeek) >= FELT) {
    bits.push(pts(t.playoffs) + ' in the playoff weeks');
  }
  bits.push(t.net > t.band ? 'more value' : t.net < -t.band ? 'less value' : 'even on value');
  return situationLabel(t.situation, dynasty) + ': ' + bits.join(', ');
}

export interface FitHeadline { title: string; winners: number[]; why: string }

export function fitHeadline(cases: TeamCase[], dynasty: boolean, moved: number): FitHeadline {
  if (!moved) return { title: 'Nothing in the trade yet', winners: [], why: '' };
  const name = (t: TeamCase) => (t.isMe ? 'You' : t.name);
  const out = cases.map(t => ({ t, o: outcomeFor(t, dynasty) }));
  const good = out.filter(x => x.o === 'good').map(x => x.t);
  const bad = out.filter(x => x.o === 'bad').map(x => x.t);
  if (good.length > 1 && !bad.length) {
    return { title: 'Win-win: it suits ' + good.map(name).join(' and '), winners: good.map(t => t.id), why: '' };
  }
  if (good.length === 1) {
    const w = good[0];
    return {
      title: (w.isMe ? 'You win this trade' : w.name + ' wins this trade'),
      winners: [w.id],
      why: caseLine(w, dynasty),
    };
  }
  // "You get" and "they get", but "Alex gets".
  const verb = (ts: TeamCase[], one: string, many: string) =>
    ts.map(name).join(' and ') + ' ' + (ts.length === 1 && !ts[0].isMe ? one : many);
  if (good.length > 1) {
    return { title: 'It suits ' + good.map(name).join(' and '), winners: good.map(t => t.id), why: verb(bad, 'comes out worse', 'come out worse') };
  }
  if (!bad.length) return { title: 'Even trade', winners: [], why: 'Nobody is clearly better or worse off' };
  return { title: 'Nobody comes out ahead', winners: [], why: verb(bad, 'gets worse', 'get worse') };
}
