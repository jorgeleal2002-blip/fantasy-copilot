import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ACCENT, GOOD, POS, POS_COLOR } from '../model/constants';
import { pickLabel } from '../model/math';
import type { Pos } from '../api/types';
import type { MockOption, MockPick, MockState, Model } from '../model/types';
import type { App } from '../state/useApp';
import { dim, ellipsis, fitColor } from '../ui/styles';

/** How long each bot pick sits on screen before the next one lands. */
const TICK_MS = 420;

/**
 * Board geometry.
 *
 * Big enough to read a name and a position at arm's length, which means a
 * phone shows four or five seats and scrolls to the rest — the same trade a
 * real draft room makes. Fitting all ten on screen costs more than it buys:
 * at 32px a surname has to break across two lines to survive.
 */
const CELL = 84;
const AXIS = 22;
const GAP = 3;

/** The round numbers ride along as the board scrolls sideways. */
const STICKY: CSSProperties = {
  position: 'sticky', left: 0, zIndex: 2, background: 'var(--color-bg)',
};

type DockTab = 'suggested' | 'players' | 'team';

/**
 * The draft room.
 *
 * The board is the room — it holds the top of the screen the whole time and
 * the picks land on it as they happen. The list of who is left sits docked
 * underneath, which is the only arrangement where you can watch the run on a
 * position and take somebody in response to it without switching views.
 */
export function MockRoom({ app, m }: { app: App; m: Model }) {
  const st = m.runMock(app.mockSeed, app.mockChoices, app.mockSlot);
  const [shown, setShown] = useState(0);
  const [tab, setTab] = useState<DockTab>('players');
  const [pos, setPos] = useState<'ALL' | Pos>('ALL');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);

  const live = app.mockStarted;
  const waiting = live && shown < st.made.length;

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

  // Your turn arrives on the Suggested tab, because that is the moment the
  // three rated shortcuts are worth anything.
  const onClock = live && !waiting ? st.onClock : null;
  useEffect(() => {
    if (onClock) setTab(t => (t === 'team' ? t : 'suggested'));
  }, [onClock?.overall]);

  const visible = live ? st.made.slice(0, shown) : [];
  const latest = visible[visible.length - 1];
  const nextOverall = latest ? latest.overall + 1 : (st.onClock?.overall ?? 1);

  const take = (id: string) => {
    if (!onClock) return;
    app.chooseMock(onClock.overall, id);
  };

  const status = !live ? 'Claim a seat, then start'
    : st.done ? 'Mock complete'
      : onClock ? 'You are on the clock · ' + onClock.label
        : latest ? teamOf(latest) + ' took ' + (latest.player?.name || '')
          : 'Drafting…';

  return (
    <div className="mock-room">
      <header className="mock-head">
        <button type="button" className="btn btn-ghost" onClick={app.closeMock} style={{ fontSize: 13, padding: 0 }}>
          ‹ Leave
        </button>
        <div style={{ minWidth: 0, flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 9, letterSpacing: '.11em', textTransform: 'uppercase', color: dim(0.4) }}>
            Mock draft · seat {st.slot}
          </div>
          <div style={{
            fontSize: 12.5, fontWeight: 500, marginTop: 2, ...ellipsis,
            color: onClock ? ACCENT : 'inherit',
          }}>
            {status}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => { setShown(0); app.rerollMock(); }}
          style={{ fontSize: 12, padding: 0 }}
        >
          {live ? 'Restart' : 'Reshuffle'}
        </button>
      </header>

      {/* The lobby's one job: start the thing. It goes away once it has. */}
      {!live ? (
        <div style={{ padding: '10px 15px 0' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { setShown(0); app.startMock(); }}
            style={{ width: '100%', padding: '11px 0', fontSize: 13.5, borderRadius: 11 }}
          >
            Start mock draft
          </button>
        </div>
      ) : null}

      <MockBoard
        m={m}
        made={visible}
        seat={st.slot}
        next={live ? nextOverall : 0}
        claimable={!live}
        onClaim={n => app.setMockSlot(n === m.mySlot ? null : n)}
      />

      <section className="mock-dock">
        <div className="dock-tabs" role="tablist">
          {([
            ['suggested', onClock ? 'Take one' : 'Suggested'],
            ['players', 'Players'],
            ['team', 'My team'],
          ] as [DockTab, string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={'dock-tab' + (tab === k ? ' is-on' : '')}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'team' ? (
          <MyTeam st={st} m={m} />
        ) : (
          <>
            {/* Only over the full board. On Take one the list is three fixed
                names, so a position chip had nothing to filter and did
                nothing when tapped. */}
            {tab === 'players' ? (
              <PosFilter
                m={m}
                st={st}
                pos={pos}
                setPos={setPos}
                q={q}
                setQ={setQ}
                searching={searching}
                setSearching={setSearching}
              />
            ) : null}
            <div className="dock-list">
              <PlayerList
                st={st}
                m={m}
                tab={tab}
                pos={pos}
                q={q}
                canTake={!!onClock}
                onTake={take}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function teamOf(p: MockPick) {
  return p.mine ? 'You' : (p.team || 'A team');
}

/** Position chips carrying what you have against what the league starts. */
function PosFilter({ m, st, pos, setPos, q, setQ, searching, setSearching }: {
  m: Model; st: MockState; pos: 'ALL' | Pos; setPos: (p: 'ALL' | Pos) => void;
  q: string; setQ: (s: string) => void; searching: boolean; setSearching: (b: boolean) => void;
}) {
  if (searching) {
    return (
      <div className="dock-filters">
        <input
          className="dock-search"
          autoFocus
          value={q}
          placeholder="Search the board"
          onChange={e => setQ(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '0 4px', flex: 'none' }}
          onClick={() => { setSearching(false); setQ(''); }}
        >
          Done
        </button>
      </div>
    );
  }
  return (
    <div className="dock-filters">
      <button
        type="button"
        className="pos-chip is-icon"
        aria-label="Search the board"
        onClick={() => setSearching(true)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      </button>
      <button
        type="button"
        className={'pos-chip' + (pos === 'ALL' ? ' is-on' : '')}
        onClick={() => setPos('ALL')}
      >
        All
      </button>
      {POS.map(p => (
        <button
          key={p}
          type="button"
          className={'pos-chip' + (pos === p ? ' is-on' : '')}
          onClick={() => setPos(p)}
        >
          <span>{p}</span>
          {/* What you hold against what this league starts, so the chip
              answers "do I still need one?" rather than just filtering. */}
          <span className="pos-count">{(st.shape[p] || 0) + '/' + (m.slots[p] || 0)}</span>
        </button>
      ))}
    </div>
  );
}

function PlayerList({ st, m, tab, pos, q, canTake, onTake }: {
  st: MockState; m: Model; tab: DockTab; pos: 'ALL' | Pos; q: string;
  canTake: boolean; onTake: (id: string) => void;
}) {
  const needle = q.trim().toLowerCase();
  const rows = tab === 'suggested' && st.options.length
    ? st.options
    : st.board
      .filter(o => pos === 'ALL' || o.pos === pos)
      .filter(o => !needle || o.name.toLowerCase().includes(needle))
      .slice(0, 100);

  if (!rows.length) {
    return (
      <div style={{ fontSize: 12.5, color: dim(0.45), padding: '14px 15px' }}>
        {tab === 'suggested' ? 'Nothing to suggest until you are on the clock.' : 'Nobody left matching that.'}
      </div>
    );
  }
  return (
    <>
      {rows.map(o => (
        <PlayerRow key={o.id} o={o} teams={m.teamCount} canTake={canTake} onTake={onTake} />
      ))}
    </>
  );
}

/** One name, with the button that drafts him. */
function PlayerRow({ o, teams, canTake, onTake }: {
  o: MockOption; teams: number; canTake: boolean; onTake: (id: string) => void;
}) {
  const at = pickLabel(o.goes, teams);
  return (
    <div className="pl-row">
      <button
        type="button"
        className="pl-draft"
        disabled={!canTake}
        onClick={() => onTake(o.id)}
      >
        Draft
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        {o.title ? (
          <div className="pl-lens" style={{ color: o.lens === 'need' ? GOOD : dim(0.45) }}>
            {o.title}
          </div>
        ) : null}
        <div className="pl-name">{o.name}</div>
        <div className="pl-meta">
          <span style={{ color: POS_COLOR[o.pos] }}>{o.pos}</span>
          {' · ' + (o.team || 'no team yet') + ' · ' + (o.age ?? '?') + ' yrs'}
        </div>
      </div>
      <div className="pl-stat">
        <div className="pl-stat-k">goes</div>
        <div className="pl-stat-v">{at || '—'}</div>
      </div>
      <div className="pl-stat">
        <div className="pl-stat-k">fit</div>
        <div className="pl-stat-v" style={{ color: fitColor(o.fit) }}>{o.fit}</div>
      </div>
    </div>
  );
}

function MyTeam({ st, m }: { st: MockState; m: Model }) {
  return (
    <div className="dock-list" style={{ padding: '4px 15px 16px' }}>
      {st.myTeam.length ? st.myTeam.map((o, i) => (
        <div key={o.id} style={{
          display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13,
          padding: '9px 0', borderTop: i === 0 ? 'none' : '1px solid var(--color-divider)',
        }}>
          <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{o.name}</span>
          <span style={{ color: dim(0.42), flex: 'none' }}>
            <span style={{ color: POS_COLOR[o.pos] }}>{o.pos}</span>{' · fit ' + o.fit}
          </span>
        </div>
      )) : (
        <div style={{ fontSize: 12.5, color: dim(0.5), paddingTop: 10 }}>
          Nothing yet.
        </div>
      )}
      <div style={{ fontSize: 11, color: dim(0.4), marginTop: 12, lineHeight: 1.5 }}>
        {POS.map(p => (st.shape[p] || 0) + '/' + (m.slots[p] || 0) + ' ' + p).join(' · ')}
        {' — counting what you already own'}
      </div>
    </div>
  );
}

/**
 * The board: a column per seat, a row per round, snaking the way the draft
 * snakes. Every square carries its own pick number from the start and an
 * arrow to the next one, so an empty board still reads as a draft order
 * rather than as a blank grid.
 */
function MockBoard({ m, made, seat, next, claimable, onClaim }: {
  m: Model; made: MockPick[]; seat: number; next: number;
  claimable: boolean; onClaim: (n: number) => void;
}) {
  const cols = Array.from({ length: m.teamCount }, (_, i) => i + 1);
  const rows = Array.from({ length: m.rounds }, (_, i) => i + 1);
  const at = (round: number, col: number) => made.find(p => p.round === round && p.slot === col);
  const scroller = useRef<HTMLDivElement>(null);

  // Your seat is the one you came to see, and it is rarely on screen at this
  // cell size. Centre it once, on open; scrolling afterwards is the reader's.
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = Math.max(0, AXIS + (seat - 0.5) * (CELL + GAP) - el.clientWidth / 2);
  }, [seat]);

  return (
    <div ref={scroller} className="bd-scroll">
      <div
        className="bd"
        style={{
          gridTemplateColumns: `${AXIS}px repeat(${m.teamCount}, ${CELL}px)`,
          minWidth: AXIS + m.teamCount * (CELL + GAP),
        }}
      >
        <div style={STICKY} />
        {cols.map(c => {
          const t = m.teams.find(x => x.slot === c);
          return (
            <div key={'h' + c} className={'bd-head' + (c === seat ? ' is-you' : '')}>
              {claimable ? (
                <button
                  type="button"
                  className={'bd-claim' + (c === seat ? ' is-on' : '')}
                  onClick={() => onClaim(c)}
                >
                  {c === seat ? 'YOURS' : 'Claim'}
                </button>
              ) : (
                <span style={ellipsis}>{c === seat ? 'YOU' : (t?.name || String(c))}</span>
              )}
            </div>
          );
        })}
        {rows.flatMap(r => [
          <div key={'r' + r} className="bd-round" style={STICKY}>{r}</div>,
          ...cols.map(c => {
            const p = at(r, c);
            // Which pick this square is depends on the snake, and so does the
            // arrow: it points at wherever the NEXT pick lands.
            const snake = m.snake && r % 2 === 0;
            const inRound = snake ? m.teamCount - c + 1 : c;
            const overall = (r - 1) * m.teamCount + inRound;
            const turn = inRound === m.teamCount;
            const arrow = turn ? '↓' : snake ? '←' : '→';
            const onClock = !p && overall === next;
            const pos = p?.player?.pos;
            return (
              <div
                key={r + '-' + c}
                className={'bd-cell' + (p ? ' is-filled' : '') + (p?.mine ? ' is-mine' : '')
                  + (onClock ? ' is-clock' : '') + (c === seat ? ' is-seat' : '')}
                style={pos ? ({ '--pos': POS_COLOR[pos] } as CSSProperties) : undefined}
                title={p?.player?.name}
              >
                <div className="bd-tag">
                  <span>{r + '.' + inRound}</span>
                  {onClock ? <span className="bd-live">●</span> : null}
                </div>
                {p ? (
                  <>
                    <div className="bd-name">{last(p.player?.name)}</div>
                    <div className="bd-pos">{pos}</div>
                  </>
                ) : (
                  <div className="bd-arrow">{onClock ? 'on the clock' : arrow}</div>
                )}
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
 * The surname is the half people say out loud, and the column and row already
 * say whose pick it was and when.
 */
function last(name: string | undefined) {
  if (!name) return '';
  const parts = name.replace(/\s+(Jr\.?|Sr\.?|I{2,}|IV|V)$/i, '').split(' ');
  return parts[parts.length - 1];
}
