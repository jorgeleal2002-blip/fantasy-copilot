import { MARK_BAD, MARK_GAP, MARK_GOOD, MARK_MID, MARK_NONE, TRACK } from '../model/constants';
import { dim } from './styles';
import { type Game, barHeights } from '../model/season';
import { R } from './scale';

/**
 * Fill colour for a STATE — strong / middling / weak, premium / neutral /
 * discount. Only where the colour genuinely means good or bad.
 */
export const markFor = (state: 'good' | 'mid' | 'bad' | 'none') =>
  state === 'good' ? MARK_GOOD : state === 'bad' ? MARK_BAD
    : state === 'none' ? MARK_NONE : MARK_MID;

/**
 * The one series colour, for every bar in a set.
 *
 * Not a ramp. Shading each bar darker-where-smaller would paint the length a
 * second time in hue, spend the only free channel on something the chart
 * already shows, and — since these metrics have no natural order — read as a
 * ranking that does not exist. Length is the encoding; sorting is the ranking.
 */
export const SERIES = MARK_MID;

/**
 * A meter: one value against a known scale.
 *
 * Anchored to the baseline with a rounded data end, so which side is zero is
 * never in doubt. `ref` draws a reference mark — an average, a break-even, the
 * league leader — with a surface-coloured gap either side so it stays legible
 * where the fill runs under it. A meter with no reference only says "some";
 * with one it says "more than what".
 */
export function Meter({
  pct, color, height = 6, mark, markLabel,
}: {
  pct: number;
  color: string;
  height?: number;
  /** where the reference line sits, 0..100 — NOT named `ref`, which React
   *  reserves and refuses to pass to a function component at all. */
  mark?: number;
  markLabel?: string;
}) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ position: 'relative', height, background: TRACK, borderRadius: R.pill, overflow: 'hidden' }}>
      <div
        style={{
          height: '100%',
          // A non-zero value never renders as nothing: 2px is the smallest mark
          // that still reads as a mark.
          width: w > 0 ? `max(2px, ${w}%)` : 0,
          background: color,
          /* Follows its own height — see `R.pill`. This was four copies of
             `Math.round(height / 2)`, which is the same shape written as a
             number that has to be recomputed whenever the bar changes. */
          borderRadius: R.pill,
        }}
      />
      {mark != null ? (
        <div
          aria-label={markLabel}
          style={{
            position: 'absolute', top: -1, bottom: -1,
            left: `calc(${Math.max(0, Math.min(100, mark))}% - 3px)`,
            width: 6,
            // 2px of surface either side of a 2px rule: the gap is what keeps
            // the mark visible where the fill passes beneath it.
            borderLeft: `2px solid ${MARK_GAP}`,
            borderRight: `2px solid ${MARK_GAP}`,
            background: dim(0.75),
            backgroundClip: 'padding-box',
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A player's weeks, as bars.
 *
 * One component, because there were two — the player card and the compare
 * screen each drew this — and they shared a defect that a screenshot of the
 * real app made visible: a week of 35.7 and a week of 40.8 came out the same
 * height, and 19.5 came out at two thirds of the tallest rather than a half.
 * The chart was not describing its own numbers.
 *
 * The cause was that the figure above each bar lived in the same flex column
 * as the bar, so a bar tall enough that bar + label exceeded the 92px chart was
 * SHRUNK to fit — flex-shrink defaults to 1 — and every week above about four
 * fifths of the best one flattened onto the same ceiling. The label now sits
 * outside a track of its own, so a percentage means the same thing in every
 * column, which is the one thing a bar chart has to get right.
 */
export function WeekBars({ games, digits = 1 }: { games: Game[]; digits?: number }) {
  if (!games.length) return null;
  const hs = barHeights(games);
  const top = Math.max(...games.map(g => g.pts));
  return (
    <>
      <div
        className="ps-bars"
        role="img"
        aria-label={'points by week: '
          + games.map(g => 'week ' + g.week + ', ' + g.pts.toFixed(1)).join('; ')}
      >
        {games.map((g, i) => (
          <div className={'ps-bar' + (g.pts === top ? ' is-top' : '')} key={g.week}>
            <div className="ps-bar-n">{g.pts.toFixed(digits)}</div>
            <div className="ps-bar-track">
              <div className="ps-bar-fill" style={{ height: ((hs[i] as number) * 100) + '%' }} />
            </div>
          </div>
        ))}
      </div>
      <div className="ps-wks" aria-hidden="true">
        {games.map(g => <div className="ps-wk" key={g.week}>W{g.week}</div>)}
      </div>
    </>
  );
}
