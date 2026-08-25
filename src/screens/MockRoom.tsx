import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ACCENT, GOOD, POS, POS_COLOR } from '../model/constants';
import type { MockOption, MockPick, Model } from '../model/types';
import type { App } from '../state/useApp';
import { Segmented, type SegOption } from '../ui/primitives';
import { pickLabel } from '../model/math';
import { dim, ellipsis, fitColor } from '../ui/styles';

const POS_FILTERS: SegOption<'ALL' | 'QB' | 'RB' | 'WR' | 'TE'>[] =
  [{ key: 'ALL', label: 'All' }, ...POS.map(p => ({ key: p, label: p }))];

const VIEWS: SegOption<'pick' | 'board' | 'team'>[] = [
  { key: 'pick', label: 'On the clock' },
  { key: 'board', label: 'Board' },
  { key: 'team', label: 'My team' },
];

/** How long each bot pick sits on screen before the next one lands. */
const TICK_MS = 420;

/**
 * A mock draft room, full screen.
 *
 * The model computes the whole run up to your turn at once; this paces the
 * reveal so the bots visibly draft one at a time instead of a wall of picks
 * appearing between your turns. That pacing is the difference between reading
 * a result and sitting in a draft.
 */
export function MockRoom({ app, m }: { app: App; m: Model }) {
  const st = m.runMock(app.mockSeed, app.mockChoices, app.mockSlot);
  const [view, setView] = useState<'pick' | 'board' | 'team'>('pick');
  const [pos, setPos] = useState<'ALL' | 'QB' | 'RB' | 'WR' | 'TE'>('ALL');
  const [all, setAll] = useState(false);
  const [shown, setShown] = useState(0);

  const waiting = shown < st.made.length;

  // One pick at a time. `shown` only ever grows, so picks already on screen
  // stay there when your own selection makes the list longer.
  useEffect(() => {
    if (!waiting) return undefined;
    const t = window.setTimeout(() => setShown(n => Math.min(n + 1, st.made.length)), TICK_MS);
    return () => window.clearTimeout(t);
  }, [waiting, shown, st.made.length]);

  // Escape leaves the room, like every other sheet in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') app.closeMock(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const visible = st.made.slice(0, shown);
  const latest = visible[visible.length - 1];
  const onClock = !waiting && st.onClock;
  // The square the room is actually sitting on, as far as the reveal has got.
  const nextOverall = latest ? latest.overall + 1 : (st.onClock?.overall ?? 1);

  const take = (id: string) => {
    if (!st.onClock) return;
    app.chooseMock(st.onClock.overall, id);
  };

  const shortlist = st.options.map(o => o.id);
  const rest = st.board
    .filter(o => shortlist.indexOf(o.id) < 0)
    .filter(o => pos === 'ALL' || o.pos === pos);

  return (
    <div className="mock-room">
      <header className="mock-head">
        <button type="button" className="btn btn-ghost" onClick={app.closeMock} style={{ fontSize: 13, padding: 0 }}>
          ‹ Leave
        </button>
        <div style={{ minWidth: 0, flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 9.5, letterSpacing: '.11em', textTransform: 'uppercase', color: dim(0.4) }}>
            Mock draft · slot {st.slot}
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em', marginTop: 2, ...ellipsis }}>
            {st.done ? 'Complete' : onClock ? 'Pick ' + st.onClock!.label : 'Bots on the clock'}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => { setShown(0); app.rerollMock(); }}
          style={{ fontSize: 12, padding: 0 }}
        >
          Restart
        </button>
      </header>

      {/* The live ticker: whoever just came off the board, and who is next. */}
      <div className="mock-ticker" aria-live="polite">
        {latest ? (
          <div key={latest.overall} style={{ display: 'flex', alignItems: 'center', gap: 9, animation: 'fadeUp .22s ease backwards' }}>
            <span style={{
              flex: 'none', fontSize: 10.5, fontVariantNumeric: 'tabular-nums',
              color: latest.mine ? ACCENT : dim(0.4), width: 34,
            }}>
              {latest.label}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, ...ellipsis }}>
              {latest.player?.name}
            </span>
            <span style={{ flex: 'none', fontSize: 10.5, color: dim(0.4), maxWidth: 120, ...ellipsis }}>
              {latest.player?.pos} · {latest.mine ? 'you' : latest.team}
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: dim(0.45) }}>
            {st.done ? 'The mock is over.' : 'You are first up.'}
          </div>
        )}
        {waiting ? (
          <div style={{ fontSize: 10.5, color: dim(0.35), marginTop: 5 }}>
            {st.made.length - shown} more before you…
          </div>
        ) : null}
      </div>

      <div style={{ padding: '0 15px' }}>
        <Segmented options={VIEWS} value={view} onChange={setView} size="sm" />
      </div>

      <main className="mock-body">
        {view === 'pick' ? (
          onClock ? (
            <>
              <div style={{ fontSize: 11.5, color: dim(0.45), lineHeight: 1.5 }}>
                Three ways to use it, rated — or take anybody from the board.
              </div>
              {st.options.map((o, i) => <Row key={o.id} o={o} first={i === 0} teams={m.teamCount} onTake={take} />)}

              <div style={{ height: 4 }} />
              <Segmented options={POS_FILTERS} value={pos} onChange={setPos} size="sm" />
              <div style={{ fontSize: 10.5, color: dim(0.38) }}>{rest.length} available</div>
              {rest.slice(0, all ? 80 : 12).map((o, i) => (
                <Row key={o.id} o={o} first={i === 0} teams={m.teamCount} onTake={take} />
              ))}
              {rest.length > 12 ? (
                <button
                  type="button"
                  onClick={() => setAll(!all)}
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '8px 0' }}
                >
                  {all ? 'Show fewer' : 'Show the rest of the board ›'}
                </button>
              ) : null}
            </>
          ) : (
            <div style={{ fontSize: 13, color: dim(0.5), lineHeight: 1.5, paddingTop: 20, textAlign: 'center' }}>
              {st.done
                ? 'Your picks are all in. Check the board, or restart.'
                : 'Waiting on the room…'}
            </div>
          )
        ) : view === 'board' ? (
          <MockBoard m={m} made={visible} slot={st.slot} next={nextOverall} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {st.myTeam.length ? st.myTeam.map((o, i) => (
              <div key={o.id} style={{
                display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13,
                paddingTop: 10, borderTop: i === 0 ? 'none' : '1px solid var(--color-divider)',
              }}>
                <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{o.name}</span>
                <span style={{ color: dim(0.42), flex: 'none' }}>{o.pos} · fit {o.fit}</span>
              </div>
            )) : (
              <div style={{ fontSize: 13, color: dim(0.5) }}>Nothing yet.</div>
            )}
            <div style={{ fontSize: 11, color: dim(0.38), marginTop: 12 }}>
              {POS.map(p => st.shape[p] + ' ' + p).join(' · ')} counting what you already own
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/** One name you can take. */
function Row({ o, first, teams, onTake }: {
  o: MockOption; first: boolean; teams: number; onTake: (id: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="row-tap"
      onClick={() => onTake(o.id)}
      onKeyDown={e => { if (e.key === 'Enter') onTake(o.id); }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        cursor: 'pointer', borderRadius: 10, padding: '9px 10px', margin: '0 -10px',
        borderTop: first ? 'none' : '1px solid var(--color-divider)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        {o.title ? (
          <div style={{
            fontSize: 9.5, letterSpacing: '.09em', textTransform: 'uppercase',
            color: o.lens === 'need' ? GOOD : dim(0.4),
          }}>
            {o.title}
          </div>
        ) : null}
        <div style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: '-0.01em', marginTop: o.title ? 3 : 0, ...ellipsis }}>
          {o.name}
        </div>
        <div style={{ fontSize: 10.5, color: dim(0.42), marginTop: 2 }}>
          {[
            o.pos,
            o.team || 'no team yet',
            (o.age ?? '?') + ' yrs',
            pickLabel(o.goes, teams) ? 'goes ' + pickLabel(o.goes, teams) : 'unranked',
          ].join(' · ')}
        </div>
        {o.why ? (
          <div style={{ fontSize: 11, color: dim(0.45), marginTop: 3, lineHeight: 1.4 }}>{o.why}</div>
        ) : null}
      </div>
      <div style={{ flex: 'none', textAlign: 'right' }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: fitColor(o.fit) }}>{o.fit}</div>
        <div style={{ fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: dim(0.35) }}>fit</div>
      </div>
    </div>
  );
}

/** Phone-first board geometry. Ten seats plus the round axis land inside a
 *  360px content width, so the common league fits with nothing to scroll.
 *  Keep these in step with `--cell` / `--axis` in the stylesheet. */
const CELL = 32;
const GAP = 2;
const AXIS = 18;

/** The round numbers ride along as the board scrolls sideways. */
const STICKY: CSSProperties = {
  position: 'sticky', left: 0, zIndex: 1, background: 'var(--color-bg)',
};

/**
 * The draft board: a column per seat, a row per round, the whole grid drawn
 * from the start so the picks still to come are visible as empty squares. It
 * is the one view that shows a run on a position happening — five backs in a
 * row across a row is a picture, not a list.
 */
function MockBoard(
  { m, made, slot, next }: { m: Model; made: MockPick[]; slot: number; next: number },
) {
  const cols = Array.from({ length: m.teamCount }, (_, i) => i + 1);
  const rows = Array.from({ length: m.rounds }, (_, i) => i + 1);
  const at = (round: number, col: number) => made.find(p => p.round === round && p.slot === col);
  const scroller = useRef<HTMLDivElement>(null);

  // A ten-team board fits a phone at this size, so there is nothing to scroll
  // to. Wider leagues do scroll, and then your column is the one you came to
  // see — centre it once, on open. Scrolling afterwards is the reader's.
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = Math.max(0, AXIS + (slot - 0.5) * (CELL + GAP) - el.clientWidth / 2);
  }, [slot]);

  // No full-bleed. A board that ran past the screen edge would need the sticky
  // round column to cover the padding it scrolls through, and it never covers
  // the gaps between rows. Clipping at the container edge is honest.
  return (
    <div ref={scroller} className="bd-scroll">
      {/* Even columns under a floor on the whole grid: at ten teams the floor
          is 358px, so the board fits a phone with nothing to scroll; wider
          leagues push past it and scroll; a laptop lets the columns spread to
          fill the room. `minmax(0, 1fr)` rather than `1fr` so a long name can
          never widen its own column. */}
      <div
        className="bd"
        style={{
          gridTemplateColumns: `var(--axis) repeat(${m.teamCount}, minmax(0, 1fr))`,
          minWidth: AXIS + m.teamCount * (CELL + GAP),
        }}
      >
        <div style={STICKY} />
        {cols.map(c => (
          <div key={'h' + c} className={'bd-head' + (c === slot ? ' is-you' : '')}>
            {c === slot ? 'YOU' : c}
          </div>
        ))}
        {rows.flatMap(r => [
          <div key={'r' + r} className="bd-round" style={STICKY}>{r}</div>,
          ...cols.map(c => {
            const p = at(r, c);
            const onClock = !p && (r - 1) * m.teamCount + (r % 2 ? c : m.teamCount - c + 1) === next;
            const pos = p?.player?.pos;
            return (
              <div
                key={r + '-' + c}
                className={'bd-cell' + (p ? ' is-filled' : '') + (p?.mine ? ' is-mine' : '')
                  + (onClock ? ' is-clock' : '')}
                // The tint and the letters are the same hue, one variable.
                style={pos ? ({ '--pos': POS_COLOR[pos] } as CSSProperties) : undefined}
                title={p?.player?.name}
              >
                {p ? (
                  <>
                    <div className="bd-name">{last(p.player?.name)}</div>
                    <div className="bd-pos">{pos}</div>
                  </>
                ) : onClock ? (
                  <div className="bd-clock">on<br />clock</div>
                ) : null}
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}

/**
 * "Jahmyr Gibbs" → "Gibbs".
 *
 * A 32px cell holds one short word. The surname is the half people say out
 * loud, and the column and row already say whose pick it was and when.
 */
function last(name: string | undefined) {
  if (!name) return '';
  const parts = name.replace(/\s+(Jr\.?|Sr\.?|I{2,}|IV|V)$/i, '').split(' ');
  return parts[parts.length - 1];
}
