import type { Offer } from './types';

/**
 * The two sentences under a suggested trade: why it is good for you, and why
 * the other manager might say yes.
 *
 * Each clause is chosen by what the numbers actually say, in plain words, and
 * never with a sign the words already carry ("drops -2.3"). Value is a share
 * of market price; lineup is points a week in the best lineup. The two are
 * never mixed: a capital deal's gain is market value, not points.
 */

const pct = (x: number) => Math.round(Math.abs(x) * 100) + '%';
const pts = (x: number) => Math.abs(x).toFixed(1);
/** Within this of market is a fair price, not a bargain or an overpay. */
const FAIR = 0.02;
/** Under this many points a week, a lineup has not changed in any way anyone feels. */
const FLAT = 0.3;

export function whyMe(o: Offer): string {
  const price = o.edge > FAIR ? `You pay ${pct(o.edge)} less than market for him`
    : o.edge < -FAIR ? `You pay ${pct(o.edge)} more than market`
      : 'It is a fair price at market';

  const g = o.ptsGain;
  let effect: string;
  if (o.kind === 'capital') {
    effect = o.gain > 0 ? 'you come out ahead in value' : 'you give up a little value';
    if (g != null && g < -FLAT) effect += ` and your lineup scores ${pts(g)} fewer pts a week`;
  } else if (g == null) {
    effect = 'and it improves your lineup';
  } else if (g > FLAT) {
    effect = (o.edge < -FAIR ? 'but ' : 'and ') + `your lineup scores ${pts(g)} more pts a week`;
  } else if (g < -FLAT) {
    effect = `but your lineup scores ${pts(g)} fewer pts a week`;
  } else {
    effect = 'and your lineup stays about the same';
  }

  const tail = o.give.isPick ? ' You only send a draft pick, so nobody leaves your lineup.' : '';
  return `${price}, ${effect}.${tail}`;
}

export function whyThem(o: Offer, dynasty: boolean): string {
  const window = o.prof.window === 'contender' ? 'They are going for the title'
    : o.prof.window === 'rebuild' ? (dynasty ? 'They are rebuilding' : 'They are out of the race')
      : 'They are in the middle of the pack';
  // What they receive is what you send.
  const need = o.fillsTheirNeed && o.prof.worst && !o.give.isPick
    ? `, and ${o.give.name || 'he'} fills ${o.prof.worst}, their weakest spot` : '';

  // Value from THEIR side is the mirror of yours.
  const theirEdge = -o.edge;
  const valueBack = theirEdge > FAIR ? `they get ${pct(theirEdge)} more value back`
    : theirEdge < -FAIR ? `they take ${pct(theirEdge)} less value than they give`
      : 'the value is even';

  const tg = o.theirPtsGain;
  let lineup: string;
  if (tg != null && tg > FLAT) {
    lineup = `Their lineup scores ${pts(tg)} more pts a week, and ${valueBack}.`;
  } else if (tg != null && tg < -FLAT) {
    lineup = theirEdge > FAIR
      ? `Their lineup scores ${pts(tg)} fewer pts a week, but ${valueBack}`
        + (o.prof.window === 'rebuild' ? ' — the kind of deal a team building for later takes.' : '.')
      : `Their lineup scores ${pts(tg)} fewer pts a week and ${valueBack}, so expect a no.`;
  } else if (tg == null) {
    lineup = valueBack.charAt(0).toUpperCase() + valueBack.slice(1) + '.';
  } else {
    lineup = theirEdge > FAIR || theirEdge < -FAIR
      ? `Their lineup barely changes, so it comes down to value: ${valueBack}.`
      : 'Their lineup barely changes and the value is even.';
  }
  return `${window}${need}. ${lineup}`;
}

/** The line under a return for a player you put on the block. */
export function returnLine(r: { edge: number; myGain: number | null; fillsTheirNeed: boolean; worst: string | null; sendName: string }): string {
  const price = r.edge > FAIR ? `You get back ${pct(r.edge)} more than he is worth.`
    : r.edge < -FAIR ? `You take ${pct(r.edge)} less than his market price.`
      : 'You get back about what he is worth.';
  const lineup = r.myGain == null ? '' : r.myGain < -0.1 ? ` Your lineup scores ${pts(r.myGain)} fewer pts a week without him.`
    : r.myGain > 0.1 ? ` Your lineup still scores ${pts(r.myGain)} more pts a week.`
      : ' Your lineup stays the same.';
  const need = r.fillsTheirNeed && r.worst ? ` ${r.sendName} goes straight into ${r.worst}, their weakest spot.` : '';
  return price + lineup + need;
}
