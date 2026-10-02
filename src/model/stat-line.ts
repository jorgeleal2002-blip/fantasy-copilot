import type { SleeperStatLine } from '../api/types';

/**
 * What a player actually did, in one line.
 *
 * A number of fantasy points says how much he was worth and nothing about how
 * he got there, and the second is most of what anybody wants from a scoreboard
 * — twenty points off eight catches is a different week from twenty off one
 * eighty-yard touchdown, and it says different things about next Sunday.
 *
 * Written by position, because the same stat line read for a quarterback and
 * for a receiver is two different lines: a back's three catches matter and a
 * quarterback's three carries are a footnote to four hundred passing yards.
 * Anything at zero is left out rather than printed as a zero — "0 TD" on every
 * row is a column of nothing pretending to be information — except where the
 * zero IS the story, which is a defence's points allowed and a missed kick.
 */

/**
 * The same line, kept in pieces.
 *
 * A game log sets the figure large and its unit small beside it, the way every
 * football app does — and a joined string cannot be drawn that way. So the line
 * is built as parts and joined only where a joined line is what is wanted; both
 * callers then read the same source and cannot drift apart.
 */
export type StatBit = { n: string; unit: string };

/** One clause, or nothing when there is nothing to say. */
const bit = (n: number | undefined, unit: string): StatBit | null =>
  (Number.isFinite(n) && (n as number) !== 0 ? { n: String(Math.round(n as number)), unit } : null);

const pair = (made: number | undefined, tried: number | undefined, unit: string): StatBit | null =>
  (Number.isFinite(tried) && (tried as number) > 0
    ? { n: Math.round(made || 0) + '/' + Math.round(tried as number), unit }
    : null);

export function statBits(st: SleeperStatLine | undefined | null, pos: string): StatBit[] {
  if (!st) return [];
  const out: (StatBit | null)[] = [];

  const rushing = () => {
    out.push(bit(st.rush_att, 'CAR'), bit(st.rush_yd, 'YD'), bit(st.rush_td, 'TD'));
  };
  const catching = () => {
    out.push(pair(st.rec, st.rec_tgt, 'REC'), bit(st.rec_yd, 'YD'), bit(st.rec_td, 'TD'));
  };

  if (pos === 'QB') {
    out.push(pair(st.pass_cmp, st.pass_att, 'CMP'), bit(st.pass_yd, 'YD'), bit(st.pass_td, 'TD'));
    // An interception is worth saying at one, which is why it is not in `bit`'s
    // "leave out the zeroes" the way a touchdown is.
    out.push(bit(st.pass_int, 'INT'));
    rushing();
  } else if (pos === 'RB') {
    rushing();
    catching();
  } else if (pos === 'WR' || pos === 'TE') {
    catching();
    rushing();
  } else if (pos === 'K') {
    // A kicker's line is what he was given and what he did with it, so the
    // attempts are the point and a miss has to be visible.
    out.push(pair(st.fgm, st.fga, 'FG'), pair(st.xpm, st.xpa, 'XP'));
  } else if (pos === 'DEF') {
    // The one place a zero is the story: nobody scored on them.
    if (Number.isFinite(st.pts_allow)) {
      out.push({ n: String(Math.round(st.pts_allow as number)), unit: 'PTS ALLOW' });
    }
    out.push(bit(st.sack, 'SACK'), bit(st.int, 'INT'), bit(st.def_st_td, 'TD'));
  } else {
    rushing();
    catching();
  }

  out.push(bit(st.fum_lost, 'FUM LOST'));
  return out.filter((b): b is StatBit => !!b);
}

/**
 * The week as Sleeper's own card headlines it: a few totals, large. Yards and
 * touchdowns are summed across rushing and receiving, because "30 yards, 1 td"
 * is the week and which way he got them is the line under it.
 */
export function headlineBits(st: SleeperStatLine | undefined | null, pos: string): StatBit[] {
  if (!st) return [];
  const sum = (...v: (number | undefined)[]) => v.reduce<number>((a, x) => a + (Number.isFinite(x) ? (x as number) : 0), 0);
  const n = (v: number) => String(Math.round(v));
  if (pos === 'K' || pos === 'DEF') return statBits(st, pos).slice(0, 3);
  if (pos === 'QB') {
    const out: StatBit[] = [
      { n: n(sum(st.pass_yd, st.rush_yd)), unit: 'yards' },
      { n: n(sum(st.pass_td, st.rush_td)), unit: 'tds' },
    ];
    if (sum(st.pass_int)) out.push({ n: n(sum(st.pass_int)), unit: 'int' });
    return out;
  }
  const out: StatBit[] = [
    { n: n(sum(st.rush_yd, st.rec_yd)), unit: 'yards' },
    { n: n(sum(st.rush_td, st.rec_td)), unit: 'tds' },
  ];
  const rec = pair(st.rec, st.rec_tgt, 'rec');
  if (rec) out.push(rec);
  return out;
}

/** Every touchdown he had a hand in — thrown, run, caught, or a defence's and a
 *  returner's — which is what a football per score on the card counts. */
const TD_KEYS = ['pass_td', 'rush_td', 'rec_td', 'def_st_td', 'def_td', 'st_td', 'fum_rec_td'];
export function touchdowns(st: SleeperStatLine | undefined | null): number {
  if (!st) return 0;
  const r = st as Record<string, number | undefined>;
  return TD_KEYS.reduce((n, k) => n + (Number.isFinite(r[k]) ? Math.round(r[k] as number) : 0), 0);
}

export function statLine(st: SleeperStatLine | undefined | null, pos: string): string {
  return statBits(st, pos).map(b => b.n + ' ' + b.unit).join(', ');
}
