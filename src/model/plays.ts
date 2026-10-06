/**
 * Touchdowns and big plays, read out of two stat lines a poll apart.
 *
 * Sleeper's stat feed is a running total per player, not a play-by-play, so a
 * play is whatever changed between one read and the next. A touchdown is a
 * touchdown counter going up. A big play is a yardage total jumping by more
 * than one ordinary play could: the feed is read every twenty seconds, which is
 * about one snap, so forty yards between reads is one long play, not several
 * short ones. A gap in the reads (the app in the background, a dropped
 * connection) could add several plays together; a jump that big is still worth
 * hearing about, and it says the yards it counted rather than claiming one play.
 */

export type PlayKind = 'td' | 'big';

export interface Play {
  pid: string;
  kind: PlayKind;
  /** 'rec', 'rush', 'pass', 'ret' or 'def' */
  how: string;
  /** yards gained since the last read, where that means anything */
  yards: number | null;
  /** fantasy points gained since the last read, in this league's scoring */
  pts: number | null;
}

type Line = Record<string, number | undefined>;

const n = (l: Line | undefined, k: string) => (l && Number.isFinite(l[k]) ? (l[k] as number) : 0);

/** Yards between reads that make a play big, by how it was gained. */
export const BIG_YARDS: Record<string, number> = { rec: 40, rush: 30, pass: 40 };

const TDS: [string, string, string | null][] = [
  // stat key, how, the yardage key the touchdown play's yards come from
  ['rec_td', 'rec', 'rec_yd'],
  ['rush_td', 'rush', 'rush_yd'],
  ['pass_td', 'pass', 'pass_yd'],
  ['st_td', 'ret', null],
  ['def_st_td', 'ret', null],
  ['def_td', 'def', null],
  ['fum_rec_td', 'def', null],
];

/**
 * What happened between two reads, for the players being watched. A player
 * with no earlier line has nothing to compare against and says nothing — the
 * first read of a week is a baseline, not a highlight reel of the day so far.
 */
export function playsBetween(
  before: Record<string, Line>,
  after: Record<string, Line>,
  watch: Iterable<string>,
  points?: (line: Line) => number | null,
): Play[] {
  const out: Play[] = [];
  for (const pid of watch) {
    const a = before[pid];
    const b = after[pid];
    if (!a || !b) continue;
    const pts = points ? diff(points(a), points(b)) : null;
    let scored = false;
    for (const [k, how, ydKey] of TDS) {
      const got = Math.round(n(b, k) - n(a, k));
      for (let i = 0; i < got; i++) {
        const yd = ydKey ? Math.round(n(b, ydKey) - n(a, ydKey)) : null;
        out.push({ pid, kind: 'td', how, yards: yd != null && yd > 0 ? yd : null, pts });
        scored = true;
      }
    }
    if (scored) continue;
    // The longest jump only: a receiver who also ran once is one highlight.
    let best: Play | null = null;
    for (const how of ['rec', 'rush', 'pass']) {
      const yd = Math.round(n(b, how + '_yd') - n(a, how + '_yd'));
      if (yd >= BIG_YARDS[how] && (!best || yd > (best.yards as number))) {
        best = { pid, kind: 'big', how, yards: yd, pts };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

const diff = (a: number | null, b: number | null) =>
  a == null || b == null ? null : Math.round((b - a) * 10) / 10;

const HOW: Record<string, string> = { rec: 'catch', rush: 'run', pass: 'pass', ret: 'return', def: 'defensive' };

/** The headline and the line under it, for a banner or a phone notification. */
export function playText(p: Play, name: string, side: 'mine' | 'theirs' | 'both'): { title: string; body: string } {
  const head = p.kind === 'td' ? '🏈 TOUCHDOWN' : '💥 Big play';
  const tag = side === 'theirs' ? ' (your opponent)' : '';
  const yd = p.yards ? p.yards + '-yd ' : '';
  const what = p.kind === 'td'
    ? (p.how === 'pass' ? yd + 'TD pass' : yd + HOW[p.how] + ' for a TD')
    : yd + HOW[p.how];
  const pts = p.pts ? ' · ' + (p.pts > 0 ? '+' : '') + p.pts.toFixed(1) + ' pts' : '';
  return { title: head + ': ' + name + tag, body: what.charAt(0).toUpperCase() + what.slice(1) + pts };
}
