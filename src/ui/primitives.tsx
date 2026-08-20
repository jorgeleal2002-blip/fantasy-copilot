import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { cardNote, cardTitle, seg, SegSize, surface } from './styles';

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...surface, ...style }}>{children}</div>;
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
    <div style={{ display: 'flex', gap: size === 'sm' ? 5 : 6 }}>
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          style={{ ...seg(value === o.key, size), font: 'inherit', fontSize: size === 'sm' ? 11 : 11.5 }}
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
        borderTop: first ? '1px solid transparent' : '1px solid var(--color-divider)',
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
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'rgba(233,233,237,.5)', marginBottom: action ? 16 : 0 }}>{body}</div>
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
  children, onClose, label = 'Back', z = 5,
}: {
  children: ReactNode;
  onClose: () => void;
  label?: string;
  z?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay-host" style={{ position: 'absolute', inset: 0, zIndex: z }}>
      <div className="overlay-scrim" onClick={onClose} aria-hidden="true" />
      <div className="overlay-panel" role="dialog" aria-modal="true" aria-label={label}>
        <div className="overlay-head">
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ fontSize: 14, padding: 0 }}>
            ‹ {label}
          </button>
        </div>
        <div className="overlay-body">{children}</div>
      </div>
    </div>
  );
}

/** The screen-level scroller: every tab's content sits in one of these. */
export function Screen({ children, animation = 'fadeUp .3s ease backwards' }: { children: ReactNode; animation?: string }) {
  return (
    <div style={{ animation, display: 'flex', flexDirection: 'column', gap: 9 }}>
      {children}
    </div>
  );
}
