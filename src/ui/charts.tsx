import { MARK_BAD, MARK_GAP, MARK_GOOD, MARK_MID, TRACK } from '../model/constants';
import { dim } from './styles';

/**
 * Fill colour for a STATE — strong / middling / weak, premium / neutral /
 * discount. Only where the colour genuinely means good or bad.
 */
export const markFor = (state: 'good' | 'mid' | 'bad') =>
  state === 'good' ? MARK_GOOD : state === 'bad' ? MARK_BAD : MARK_MID;

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
  const r = Math.round(height / 2);
  return (
    <div style={{ position: 'relative', height, background: TRACK, borderRadius: r, overflow: 'hidden' }}>
      <div
        style={{
          height: '100%',
          // A non-zero value never renders as nothing: 2px is the smallest mark
          // that still reads as a mark.
          width: w > 0 ? `max(2px, ${w}%)` : 0,
          background: color,
          borderRadius: `${r}px ${r}px ${r}px ${r}px`,
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
            background: dim(0.55),
            backgroundClip: 'padding-box',
          }}
        />
      ) : null}
    </div>
  );
}

export interface StripPoint {
  id: string | number;
  value: number;
  mine?: boolean;
  /** shown on hover — which team this tick is */
  name?: string;
}

/**
 * Where one value sits inside the whole field.
 *
 * A bar cannot answer this. Scaled against the leader it paints everyone who
 * leads at 100%, so four positions you happen to lead all draw the identical
 * full bar — which is exactly as informative as no chart at all. Plotting every
 * team on one axis and marking yours shows the thing the number cannot: whether
 * you lead by a mile or by nothing, and whether the field is bunched or strung
 * out.
 */
export function RankStrip({
  points, state, height = 22, label,
}: {
  points: StripPoint[];
  state: 'good' | 'mid' | 'bad';
  height?: number;
  label?: string;
}) {
  const vals = points.map(p => p.value).filter(v => Number.isFinite(v));
  if (vals.length < 2) return <Meter pct={100} color={markFor(state)} />;

  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  // A little inset each side so the extremes are marks on an axis rather than
  // clipped edges.
  const at = (v: number) => 3 + ((v - lo) / span) * 94;
  const mark = markFor(state);

  return (
    <div
      role="img"
      aria-label={label}
      style={{ position: 'relative', height, marginTop: 2 }}
    >
      {/* The axis: recessive, because it is the scale and not the data. */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: '50%',
        height: 1, background: TRACK,
      }} />
      {points.map(p => (
        <div
          key={p.id}
          // The cheapest possible hover layer: no layout, no state, and it
          // answers the only question a context tick raises — who is that?
          title={p.name ? p.name + ' · ' + Math.round(p.value).toLocaleString('en-US') : undefined}
          style={{
            position: 'absolute',
            left: `calc(${at(p.value)}% - ${p.mine ? 1.5 : 1}px)`,
            top: p.mine ? '50%' : '50%',
            transform: 'translateY(-50%)',
            width: p.mine ? 3 : 2,
            height: p.mine ? height : Math.round(height * 0.5),
            borderRadius: 2,
            background: p.mine ? mark : dim(0.22),
            // Yours sits on top of whoever it lands beside, and a ring of the
            // surface keeps the two from reading as one thicker tick.
            boxShadow: p.mine ? `0 0 0 2px ${MARK_GAP}` : undefined,
            zIndex: p.mine ? 2 : 1,
          }}
        />
      ))}
    </div>
  );
}
