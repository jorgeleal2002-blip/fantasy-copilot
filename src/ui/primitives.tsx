import type { CSSProperties, ReactNode } from 'react';
import { cardNote, cardTitle, seg, SegSize, surface, trackStyle } from './styles';

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

/** A progress track with one fill. Every meter in the app is this. */
export function Bar({ pct, color, height = 6 }: { pct: number; color: string; height?: number }) {
  return (
    <div style={{ ...trackStyle, height }}>
      <div style={{ height: '100%', borderRadius: 3, width: Math.max(0, Math.min(100, pct)) + '%', background: color }} />
    </div>
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
export function Overlay({
  children, onClose, label = 'Back', z = 5,
}: {
  children: ReactNode;
  onClose: () => void;
  label?: string;
  z?: number;
}) {
  return (
    <div
      style={{
        position: 'absolute', inset: 0, background: 'var(--color-bg)',
        display: 'flex', flexDirection: 'column',
        animation: 'slideIn .28s cubic-bezier(.3,.9,.35,1) both', zIndex: z,
      }}
    >
      <div style={{ padding: 'calc(var(--safe-top) + 18px) 16px 10px' }}>
        <button type="button" className="btn btn-ghost" onClick={onClose} style={{ fontSize: 14, padding: 0 }}>
          ‹ {label}
        </button>
      </div>
      <div
        style={{
          flex: 1, overflow: 'auto',
          padding: '6px 18px calc(var(--safe-bottom) + 24px)',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** The screen-level scroller: every tab's content sits in one of these. */
export function Screen({ children, animation = 'fadeUp .3s ease both' }: { children: ReactNode; animation?: string }) {
  return (
    <div style={{ animation, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {children}
    </div>
  );
}
