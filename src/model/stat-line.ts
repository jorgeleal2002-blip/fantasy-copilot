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

/** One clause, or nothing when there is nothing to say. */
const bit = (n: number | undefined, unit: string): string =>
  (Number.isFinite(n) && (n as number) !== 0 ? Math.round(n as number) + ' ' + unit : '');

const pair = (made: number | undefined, tried: number | undefined, unit: string): string =>
  (Number.isFinite(tried) && (tried as number) > 0
    ? Math.round(made || 0) + '/' + Math.round(tried as number) + ' ' + unit
    : '');

export function statLine(st: SleeperStatLine | undefined | null, pos: string): string {
  if (!st) return '';
  const out: string[] = [];

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
    if (Number.isFinite(st.pts_allow)) out.push(Math.round(st.pts_allow as number) + ' PTS ALLOW');
    out.push(bit(st.sack, 'SACK'), bit(st.int, 'INT'), bit(st.def_st_td, 'TD'));
  } else {
    rushing();
    catching();
  }

  out.push(bit(st.fum_lost, 'FUM LOST'));
  return out.filter(Boolean).join(', ');
}
