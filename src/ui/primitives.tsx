import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { type Pull, pullArmed, pullProgress } from '../model/pull';
import { cardNote, cardTitle, seg, SegSize, surface } from './styles';
import { usePullToRefresh } from './usePull';
import { FS, boxRadius, boxType } from './scale';
import { teamLogo } from '../api/sleeper';

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="card" style={style}>{children}</div>;
}

export function CardHead({ title, right, note }: { title: string; right?: ReactNode; note?: string }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 2 }}>
        <div style={cardTitle}>{title}</div>
        {right}
      </div>
      {note ? <div style={{ ...cardNote, marginBottom: 10 }}>{note}</div> : null}
    </>
  );
}

export interface SegOption<T extends string> {
  key: T;
  label: string;
}

/** The segmented control: one row of outlined options, one active. */
export function Segmented<T extends string>({
  options, value, onChange, size = 'md',
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: SegSize;
}) {
  return (
    // Five tabs with a count on two of them do not fit a narrow phone, and the
    // one that falls off is the one you cannot reach. Scrolling costs nothing
    // where they already fit.
    <div style={{
      display: 'flex',
      gap: size === 'sm' ? 5 : 6,
      borderBottom: 'var(--hairline) solid var(--color-divider)',
      overflowX: 'auto',
    }}>
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          style={{
            ...seg(value === o.key, size), font: 'inherit',
            fontSize: size === 'sm' ? FS.micro : FS.small,
            flex: 'none', whiteSpace: 'nowrap',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Rows inside a card are separated by a rule, except the first. */
export function DividedRow({
  children, first = false, onClick, style,
}: {
  children: ReactNode;
  first?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      style={{
        padding: '9px 0',
        borderTop: first ? '1px solid transparent' : 'var(--hairline) solid var(--color-divider)',
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div style={{ ...surface, padding: '26px 18px', textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, lineHeight: '18px', color: 'rgba(242,253,254,0.62)', marginBottom: action ? 16 : 0 }}>{body}</div>
      {action}
    </div>
  );
}

/** Full-screen sheet that slides in over a tab — player and team detail. */
/**
 * A sheet over the current screen. On a phone it is the whole screen, pushed
 * in from the right; on a laptop the same markup becomes a centred panel over
 * a scrim, because there is room to keep the context visible behind it. Both
 * shapes live in global.css — see `.overlay-panel`.
 *
 * Escape closes it, which is the first thing anyone tries with a keyboard.
 */
export function Overlay({
  children, onClose, label = 'Back', z = 5, onRefresh,
}: {
  children: ReactNode;
  onClose: () => void;
  label?: string;
  z?: number;
  /** Given, the screen refreshes when it is dragged past either edge. */
  onRefresh?: () => void | Promise<void>;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { ref, pull, busy } = usePullToRefresh(onRefresh);
  const shift = pull ? (pull.edge === 'top' ? pull.amount : -pull.amount) : 0;

  return (
    <div className="overlay-host" style={{ position: 'absolute', inset: 0, zIndex: z }}>
      <div className="overlay-scrim" onClick={onClose} aria-hidden="true" />
      <div className="overlay-panel" role="dialog" aria-modal="true" aria-label={label}>
        <div className="overlay-head">
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ fontSize: 13, padding: 0 }}>
            ‹ {label}
          </button>
        </div>
        {pull || busy ? <PullNote pull={pull} busy={busy} /> : null}
        <div
          className="overlay-body"
          ref={ref}
          style={{
            transform: shift ? 'translateY(' + shift + 'px)' : undefined,
            // Snapping back is an animation; following the finger is not.
            transition: pull ? 'none' : 'transform .22s cubic-bezier(.3,.9,.35,1)',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * What the pull says while it is happening.
 *
 * It sits at the edge being pulled rather than always at the top, because the
 * gesture works from either one and an indicator at the far end of the screen
 * from the thumb is an indicator nobody reads. The ring fills as the pull
 * approaches the distance that arms it, so "how much further" is answered by
 * looking rather than by guessing.
 */
function PullNote({ pull, busy }: { pull: Pull | null; busy: boolean }) {
  const armed = busy || pullArmed(pull);
  const pct = Math.round(pullProgress(pull) * 100);
  return (
    <div className={'pull-note' + (pull?.edge === 'bottom' ? ' is-bottom' : '')}>
      <span className="pull-said">
        <span
          className={'pull-ring' + (busy ? ' is-busy' : '')}
          style={{ background: 'conic-gradient(var(--color-accent) ' + pct + '%, transparent 0)' }}
        />
        {busy ? 'Updating…' : armed ? 'Release to update' : 'Pull to update'}
      </span>
    </div>
  );
}

/** The screen-level scroller: every tab's content sits in one of these. */
export function Screen({ children, animation = 'fadeUp .3s ease backwards' }: { children: ReactNode; animation?: string }) {
  return (
    <div className="screen" style={{ animation }}>
      {children}
    </div>
  );
}

/**
 * A player's face, with his position behind it.
 *
 * `photoFor` always hands back a URL — Sleeper's portrait address, whether or
 * not there is a portrait at it — so a badge that hides its label whenever a
 * url exists shows an empty square for everybody the CDN has no picture of,
 * which is every kicker, every defence and a long tail of the rest. The letters
 * only give way once the image has actually loaded, and come back if it fails.
 */
export function Face({ photo, srcSet, pos, size = 34, round, team }: {
  photo?: string | null;
  /** Both of Sleeper's portraits with their widths, where there are two. */
  srcSet?: string;
  pos: string;
  size?: number;
  /** A circle rather than a rounded square, for a feed row. */
  round?: boolean;
  /** His NFL team, whose logo sits on the corner of the face. */
  team?: string | null;
}) {
  const [ok, setOk] = useState(false);
  // A new url is a new question: forget whether the last one worked.
  useEffect(() => { setOk(false); }, [photo]);
  const face = (
    <div
      style={{
        width: size, height: size, flex: 'none', borderRadius: round ? '50%' : boxRadius(size),
        position: 'relative', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: boxType(size), fontWeight: 600, letterSpacing: '.04em',
        color: 'var(--color-accent)',
        background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
      }}
    >
      {pos}
      {photo ? (
        <img
          src={photo}
          // The width it will be drawn at, which is what turns the widths in
          // srcSet into a choice: the browser multiplies by the screen.
          srcSet={srcSet || undefined}
          sizes={srcSet ? size + 'px' : undefined}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setOk(true)}
          onError={() => setOk(false)}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', opacity: ok ? 1 : 0,
          }}
        />
      ) : null}
    </div>
  );
  if (!team) return face;
  /* Outside the face, which clips: the badge hangs off its corner the way
   * Sleeper's does, on a disc of the page ground so it reads over any photo. */
  return (
    <div style={{ position: 'relative', flex: 'none', width: size, height: size }}>
      {face}
      <TeamBadge team={team} size={Math.max(12, Math.round(size * 0.42))} />
    </div>
  );
}

export function TeamBadge({ team, size, style }: { team: string; size: number; style?: CSSProperties }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [team]);
  const src = teamLogo(team);
  if (!src || bad) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setBad(true)}
      style={{
        position: 'absolute', right: -3, bottom: -3, width: size, height: size,
        borderRadius: '50%', objectFit: 'contain', padding: 1,
        background: 'var(--color-bg)', ...style,
      }}
    />
  );
}

/** A football per touchdown. Past five it is a count, not a row of balls. */
export function TdBalls({ n }: { n: number }) {
  if (!(n > 0)) return null;
  return (
    <span className="td-balls" role="img" aria-label={n + (n === 1 ? ' touchdown' : ' touchdowns')}>
      {n > 5 ? '🏈×' + n : '🏈'.repeat(n)}
    </span>
  );
}
