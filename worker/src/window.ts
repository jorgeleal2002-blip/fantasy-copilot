/**
 * When it is worth looking at all.
 *
 * The cron fires every minute because a touchdown announced ten minutes late
 * is not an announcement. But football is played on four days of the week for
 * five months of the year, and a minutely poll of a free public API through
 * July is both useless and rude. So the tick returns immediately unless a game
 * could plausibly be on.
 *
 * Deliberately generous. The cost of a window that is too wide is a few
 * hundred wasted requests; the cost of one that is too narrow is a silent
 * Sunday, and there is no way to notice that from here. Kickoffs move, games
 * run long, London plays at half past nine in the morning and a December
 * Saturday is a full slate.
 *
 * Eastern time throughout, via `Intl`, because the NFL schedules in it and
 * because that is what survives the two clock changes inside a season.
 */

/** Weekday and hour in New York, whatever the runtime's own clock is set to. */
export function easternParts(at: Date): { day: number; hour: number; month: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
    month: 'numeric',
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map(p => [p.type, p.value]));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    day: days.indexOf(parts.weekday as string),
    // Midnight comes back as "24" from this formatter, which is the same hour.
    hour: Number(parts.hour) % 24,
    month: Number(parts.month),
  };
}

/** Earliest and latest Eastern hour worth polling, per weekday. */
const WINDOWS: Record<number, [number, number]> = {
  0: [9, 24],  // Sunday: the London kickoff through the end of the night game
  1: [0, 2],   // Monday: a Sunday night game that ran past midnight
  4: [0, 2],   // Thursday: same, for Monday night
  5: [0, 2],   // Friday: same, for Thursday night
  6: [11, 24], // Saturday: December and January slates
};
/** Evening kickoffs, which every day of the week can have by now. */
const NIGHT: Record<number, [number, number]> = {
  1: [18, 24], // Monday night
  4: [18, 24], // Thursday night
  5: [11, 24], // Friday: Black Friday, and the international games
};

/** September through early February. Nothing is played in the gap. */
const SEASON_MONTHS = new Set([1, 2, 9, 10, 11, 12]);

export function inGameWindow(at: Date): boolean {
  const { day, hour, month } = easternParts(at);
  if (!SEASON_MONTHS.has(month)) return false;
  // February is the Super Bowl and nothing else, and it is a Sunday night.
  if (month === 2 && !(day === 0 && hour >= 17)) return false;
  for (const table of [WINDOWS, NIGHT]) {
    const w = table[day];
    if (w && hour >= (w[0] as number) && hour < (w[1] as number)) return true;
  }
  return false;
}
