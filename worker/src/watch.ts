/**
 * Deciding what is worth waking a phone for.
 *
 * All of this is a pure function of two stat snapshots, which is the only
 * reason it can be tested at all — the half that talks to Sleeper and to the
 * push services is a thin shell around it in `index.ts`.
 *
 * The rule that matters most here is the one about the first look. A cron job
 * that wakes up with no memory and sees a receiver on two touchdowns has not
 * witnessed two touchdowns; it has witnessed a Sunday already in progress.
 * Sending for those is how a notification feature introduces itself by
 * buzzing eleven times at once, and it happens on every deploy, every KV
 * eviction and every new week.
 */

/**
 * A week's line for one player. The named fields are the only ones read here;
 * the index signature is because a real Sleeper line carries forty more, and a
 * type that refused them would force every caller to launder its own data.
 */
export interface StatLine {
  [key: string]: number | undefined;
  pass_td?: number;
  rush_td?: number;
  rec_td?: number;
  def_st_td?: number;
  def_td?: number;
  st_td?: number;
  fum_rec_td?: number;
}

/** Every way the box score records one, matching the app's own `touchdowns`. */
/* Plain strings, not `keyof StatLine`: the index signature above widens that
   to `string | number`, which cannot be used to read a field. */
const TD_KEYS: string[] = [
  'pass_td', 'rush_td', 'rec_td', 'def_st_td', 'def_td', 'st_td', 'fum_rec_td',
];

export function touchdowns(st: StatLine | undefined | null): number {
  if (!st) return 0;
  return TD_KEYS.reduce((n, k) => {
    const v = st[k];
    return n + (Number.isFinite(v) ? Math.round(v as number) : 0);
  }, 0);
}

/**
 * The whole week as a touchdown count per player.
 *
 * Players on nought are dropped rather than stored as zero. A week's stat file
 * is every player in the league and the state has to survive in a key-value
 * store; keeping only the scorers is the difference between a few hundred
 * bytes and a few hundred kilobytes, and an absent player reads as nought
 * everywhere below anyway.
 */
export function tdCounts(stats: Record<string, StatLine> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of Object.keys(stats || {})) {
    const n = touchdowns((stats as Record<string, StatLine>)[id]);
    if (n > 0) out[id] = n;
  }
  return out;
}

export interface Scored {
  id: string;
  /** how many he has now */
  total: number;
  /** how many of them are news */
  gained: number;
}

/**
 * Who has scored since the last look.
 *
 * `prev` of null means there was no last look — a cold start, a new week, an
 * evicted key — and the answer is nobody. The caller still writes the
 * snapshot, so the NEXT tick has something to compare against; the cost of the
 * rule is that a touchdown scored in the first minute of the feature's life
 * goes unannounced, which is the right thing to lose.
 *
 * Only increases count. Sleeper restates a stat line hours later — a
 * touchdown reassigned on review, a fumble that became a rush — and a count
 * that falls is a correction, not an event to announce. It still passes into
 * the new snapshot, so the player can score again from the corrected figure.
 */
export function newScores(
  prev: Record<string, number> | null | undefined,
  now: Record<string, number>,
): Scored[] {
  if (!prev) return [];
  const out: Scored[] = [];
  for (const id of Object.keys(now)) {
    const was = prev[id] || 0;
    const has = now[id] as number;
    if (has > was) out.push({ id, total: has, gained: has - was });
  }
  // Most touchdowns first, then by id so a tie is at least stable.
  return out.sort((a, b) => b.gained - a.gained || a.id.localeCompare(b.id));
}

/**
 * Narrow the scorers to the ones a particular person is actually starting.
 *
 * Starters rather than the whole roster, on purpose: a touchdown by a man on
 * your bench is not news you want your phone to interrupt you with, and the
 * alert that earns its buzz is the one about points you are being paid for.
 */
export function mine(scored: Scored[], starters: readonly string[] | null | undefined): Scored[] {
  const set = new Set(starters || []);
  // Sleeper fills an unset lineup slot with "0", which is not a player.
  set.delete('0');
  set.delete('');
  return scored.filter(s => set.has(s.id));
}

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

/** What the phone shows on the lock screen. */
export interface Alert {
  title: string;
  body: string;
  /** collapses with itself on the handset so a retry cannot buzz twice */
  tag: string;
}

/**
 * One touchdown, in the words a lock screen has room for.
 *
 * No points, deliberately. Scoring is per league and the figure a push could
 * carry is the stat feed's own half-PPR guess, which will not be the number on
 * the card when the app is opened ten seconds later. A wrong number is worse
 * than no number; the app is one tap away and has the right one.
 */
export function tdAlert(s: Scored, name: string, pos: string, team: string, week: number): Alert {
  const where = [pos, team].filter(Boolean).join(' · ');
  const many = s.gained > 1
    ? s.gained + ' touchdowns'
    : s.total > 1 && s.total < ORDINALS.length
      ? 'Touchdown — his ' + ORDINALS[s.total] + ' today'
      : 'Touchdown';
  return {
    title: name,
    body: where ? many + ' · ' + where : many,
    /* The tag is the EVENT, not the player: a retry of the same push collapses
       into one bubble, while his next touchdown is a different tag and arrives
       as its own. */
    tag: 'td:' + week + ':' + s.id + ':' + s.total,
  };
}
