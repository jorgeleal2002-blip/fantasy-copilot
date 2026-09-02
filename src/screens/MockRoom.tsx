import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ACCENT, BAD, GOOD, POS, cellOf, colorOf } from '../model/constants';
import { inviteUrl, shareInvite } from '../model/invite';
import { pickLabel } from '../model/math';
import { sfxFor } from '../model/sfx-map';
import type { Pos } from '../api/types';
import type { MockOption, MockPick, MockState, Model } from '../model/types';
import type { App } from '../state/useApp';
import { armSfx, playSfx } from '../ui/sfx';
import { dim, ellipsis, fitColor } from '../ui/styles';

/**
 * How long each bot pick sits on screen before the next one lands.
 *
 * At 420ms a run of nine picks between your turns was over in under four
 * seconds — the names went past faster than you could read who had gone, which
 * is the one thing the reveal exists to show you. Each pick also fires its own
 * sound, and at that spacing they ran into each other.
 */
const TICK_MS = 850;

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
  /* In a shared room your seat and the seats other people hold both come from
   * the room, and the sim waits on them rather than botting them. */
  const st = m.runMock(
    app.mockSeed,
    app.mockChoices,
    app.mySeat ?? app.mockSlot,
    app.humanSeats ?? undefined,
  );
  const [shown, setShown] = useState(0);
  const [tab, setTab] = useState<DockTab>('players');
  const [pos, setPos] = useState<'ALL' | Pos>('ALL');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(false);

  // In a room the draft begins for everyone at once, so this follows the room
  // rather than this device: a guest who never pressed anything is still in it.
  const live = app.room
    ? !!app.room.started
    : app.mockStarted || Object.keys(app.mockChoices).length > 0;
  const waiting = live && shown < st.made.length;

  // One pick at a time. `shown` only ever grows, so picks already on screen
  // stay there when your own selection makes the list longer.
  useEffect(() => {
    if (!waiting) return undefined;
    const t = window.setTimeout(() => setShown(n => Math.min(n + 1, st.made.length)), TICK_MS);
    return () => window.clearTimeout(t);
  }, [waiting, shown, st.made.length]);

  /* What the app was recommending the last time you were on the clock, kept so
   * the room can tell the difference between a pick and a robbery. `options`
   * only exists while it is your turn, and the moment worth reacting to is the
   * one after that — when somebody else takes one of them. */
  // Woken from a real tap, which is the only way an installed copy makes noise.
  useEffect(() => { armSfx(); }, []);

  const suggested = useRef<string[]>([]);
  if (st.onClock?.mine && st.options.length) suggested.current = st.options.map(o => o.id);

  /* One sound per pick, as it appears — driven off `shown` rather than off the
   * mock, because the mock computes every pick up to your turn at once and the
   * room reveals them one at a time. Playing them when they are COMPUTED would
   * fire eight sounds in one frame and then leave eight silent picks. */
  useEffect(() => {
    if (!live || !shown) return;
    const pick = st.made[shown - 1];
    if (pick) playSfx(sfxFor(pick, suggested.current, st.made.slice(0, shown - 1)));
    // `st.made` is rebuilt every render and `shown` is what actually moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, live]);

  /* The mock ending, once. `done` stays true for every render after it, and an
   * effect on a value that never changes back still re-runs whenever anything
   * beside it does. */
  const ended = useRef(false);
  useEffect(() => {
    if (!live || waiting || !st.done) return;
    if (ended.current) return;
    ended.current = true;
    /* The end of a draft is not the same event as somebody taking the player
       you were told to take, and it used to share a sound with it. */
    playSfx('done');
  }, [live, waiting, st.done]);
  useEffect(() => { if (!live) ended.current = false; }, [live]);

  // Escape leaves the room, like every other sheet in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') app.closeMock(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  // Your turn arrives on the Suggested tab, because that is the moment the
  // three rated shortcuts are worth anything.
  const clock = live && !waiting ? st.onClock : null;
  /** Only YOUR turn unlocks the Draft buttons. */
  const onClock = clock && clock.mine ? clock : null;
  useEffect(() => {
    if (!onClock) return;
    setTab(t => (t === 'team' ? t : 'suggested'));
    // Your turn is the one thing in here you might miss while looking away.
    playSfx('horn');
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
      : clock && !clock.mine ? clock.who + ' is on the clock · ' + clock.label
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
        {/* Always reachable, drafting or not. It used to live in the lobby
            beside Start, which put it exactly one tap out of reach: the lobby
            has one obvious button and it is Start, and pressing it took the
            invite off the screen for good. The reasoning behind hiding it was
            wrong anyway — a guest opens their own copy from the same seed, so
            what you have taken in yours never touched their board. */}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setInviting(v => !v)}
          style={{ fontSize: 12, padding: 0, flex: 'none' }}
        >
          Invite
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => { setShown(0); app.rerollMock(); }}
          style={{ fontSize: 12, padding: 0, flex: 'none' }}
        >
          {live ? 'Restart' : 'Reshuffle'}
        </button>
      </header>

      {!live ? (
        <div style={{ padding: '10px 15px 0' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { armSfx(); setShown(0); app.startMock(); }}
            style={{ width: '100%', padding: '11px 0', fontSize: 13.5, borderRadius: 11 }}
          >
            {app.roomId ? 'Start for the room' : 'Start mock draft'}
          </button>
        </div>
      ) : null}

      {inviting ? (
        <InvitePanel app={app} m={m} finished={live && st.done && !waiting} onClose={() => setInviting(false)} />
      ) : null}

      <MockBoard
        m={m}
        made={visible}
        seat={st.slot}
        next={live ? nextOverall : 0}
        yours={!!onClock}
        claimable={!live || !!app.roomId}
        onClaim={n => {
          // In a room a seat is a claim other people can see, so it goes to the
          // database. Alone it is just which chair you are simulating from.
          if (app.roomId) void app.takeSeat(n);
          else app.setMockSlot(n === m.mySlot ? null : n);
        }}
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
  /* Only while the clock is yours: "still there when you pick again" is a
     statement about YOUR next selection, and there is no such thing to say
     while somebody else is on the clock. */
  const again = st.onClock?.mine ? st.pickAgain : null;
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
        <PlayerRow key={o.id} o={o} teams={m.teamCount} canTake={canTake} onTake={onTake} again={again} />
      ))}
    </>
  );
}

/** One name, with the button that drafts him. */
function PlayerRow({ o, teams, canTake, onTake, again }: {
  o: MockOption; teams: number; canTake: boolean; onTake: (id: string) => void;
  /** when this seat really picks again, so the row can say what waiting costs */
  again?: string | null;
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
          <span style={{ color: colorOf(o.pos) }}>{o.pos}</span>
          {/* A team defence has no age, and printing "? yrs" for one implies a
              number is missing rather than inapplicable. */}
          {' · ' + (o.team || 'no team yet') + (o.age != null ? ' · ' + o.age + ' yrs' : '')}
        </div>
        {/* The one thing that decides a draft, and the room never said it: this
            pick only buys what your next one cannot. A man who is still going
            to be sitting there is not a reason to spend the round. */}
        {again ? (
          <div className="pl-meta" style={{ color: o.goneBy ? BAD : dim(0.38) }}>
            {o.goneBy ? 'gone before your ' + o.goneBy : 'still there at your ' + again}
          </div>
        ) : null}
      </div>
      <div className="pl-stat">
        <div className="pl-stat-k">goes</div>
        <div className="pl-stat-v">{at || '—'}</div>
      </div>
      <div className="pl-stat">
        <div className="pl-stat-k">rating</div>
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
            <span style={{ color: colorOf(o.pos) }}>{o.pos}</span>{' · rating ' + o.fit}
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
 * Bringing the league into this mock.
 *
 * What the link does and does not do is stated on the panel itself, because
 * getting it wrong costs somebody a wasted evening: everyone drafts the SAME
 * board — same pool, same bots, same order — but each in their own copy. Picks
 * are not shared as they happen. That is not a shortcut taken here; a live
 * room needs a server, and this app has none. What it buys is the thing that
 * makes a mock worth arguing about afterwards: the conditions were identical,
 * so the teams can be compared.
 */
function InvitePanel({ app, m, finished, onClose }: {
  app: App; m: Model;
  /** the board has been drafted all the way out — see the share button below */
  finished: boolean;
  onClose: () => void;
}) {
  const [done, setDone] = useState('');
  const [opening, setOpening] = useState(false);
  /* No seat in the link any more. It used to be able to name one — the panel
   * listed every manager so you could hand each of them a particular chair —
   * and the seats are on the board, one tap away, where they can be seen next
   * to who is already in them. */
  const link = (room?: string | null) =>
    inviteUrl({ leagueId: m.league.league_id, seed: app.mockSeed, seat: null, room });

  const send = async (who: string, room?: string | null) => {
    const how = await shareInvite(link(room), 'Mock draft · ' + m.league.name);
    setDone(how === 'failed'
      ? 'Could not share the link on this device.'
      : how === 'shared' ? 'Sent to ' + who : 'Link copied for ' + who);
  };

  /** Open a real room, then hand out the link that walks into it. */
  const openRoom = async () => {
    setOpening(true);
    const id = app.roomId || await app.hostRoom(app.mySeat ?? m.mySlot ?? null);
    setOpening(false);
    if (id) await send('the league', id);
  };

  return (
    <div className="mock-invite" role="dialog" aria-label="Invite the league">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Invite {m.league.name}</div>
        <button type="button" className="btn btn-ghost" onClick={onClose} style={{ fontSize: 12, padding: 0 }}>
          Close
        </button>
      </div>
      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: dim(0.5), marginTop: 6, textWrap: 'pretty' }}>
        {app.liveOn
          ? 'Two ways in. A room puts everybody in one draft, picking in turn. '
            + 'Sharing the board sends the same players and the same bots to '
            + 'each of you to draft alone, and you compare teams after.'
          : 'When this board is drafted out you can send it on. Whoever opens the '
            + 'link gets the same players, the same bots and the same order, drafts '
            + 'it from their own seat, and then the two teams can be compared.'}
      </div>

      {app.liveOn ? (
        <>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void openRoom()}
            disabled={opening}
            style={{ width: '100%', marginTop: 11, padding: '10px 0', fontSize: 13, borderRadius: 10 }}
          >
            {app.roomId ? 'Share room ' + app.roomId : opening ? 'Opening…' : 'Draft together'}
          </button>
          {/* The code, big enough to read across a room.
              A link is the fast path when everyone is on a phone with a chat
              open; when they are sitting next to you it is the slow one — send,
              open a browser, come back — and six characters said out loud beat
              it. They go into Draft → Mock → Join a room. Which is why the
              alphabet has no I, L, O, 0 or 1 in it. */}
          {app.roomId ? (
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 9,
              marginTop: 10, padding: '9px 10px', borderRadius: 10,
              background: 'rgba(242,253,254,.05)', border: '1px solid var(--color-divider)',
            }}>
              <span style={{ fontSize: 10.5, color: dim(0.42) }}>or read them</span>
              <span style={{
                font: "600 20px ui-monospace, SFMono-Regular, Menlo, monospace",
                letterSpacing: '.22em', color: ACCENT,
              }}>
                {app.roomId}
              </span>
            </div>
          ) : null}
          <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(0.45), marginTop: 7, textWrap: 'pretty' }}>
            {app.roomId
              ? 'They pick in turn with you, on this board — from the link, or by '
                + 'typing that code under Draft → Mock. Seats nobody claims are drafted by the app.'
              : 'One room, everyone picking in turn. Seats nobody takes are drafted by the app.'}
          </div>
          {app.roomError ? (
            <div style={{ fontSize: 11.5, color: BAD, marginTop: 6 }} role="alert">{app.roomError}</div>
          ) : null}
          {app.roomId ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={app.leaveRoom}
              style={{ width: '100%', marginTop: 8, padding: '8px 0', fontSize: 12, borderRadius: 10 }}
            >
              Leave the room
            </button>
          ) : null}
          <div style={{
            fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase',
            color: dim(0.35), margin: '14px 0 4px',
          }}>
            Or just the same board
          </div>
        </>
      ) : null}

      {/* Only once it is drafted.
          Handing the board out beforehand is an invitation to go and draft
          alone, which is the thing a room replaced. Handing it out at the end
          is the other thing entirely: here is what I did, do it yourself off
          the same players and the same bots, and let us compare. That is worth
          a button, and it is worth it THEN. */}
      {finished ? (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void send('the league')}
          style={{ width: '100%', marginTop: app.liveOn ? 0 : 11, padding: '10px 0', fontSize: 13, borderRadius: 10 }}
        >
          Share this board
        </button>
      ) : (
        <div style={{ fontSize: 11.5, lineHeight: 1.5, color: dim(0.4), marginTop: app.liveOn ? 0 : 11, textWrap: 'pretty' }}>
          Once the board is drafted out, this is where you send it — the same
          players and the same bots, for somebody else to draft against, and a
          team to hold yours up next to.
        </div>
      )}

      {done ? (
        <div style={{ fontSize: 11.5, color: GOOD, marginTop: 10 }} role="status">{done}</div>
      ) : null}
    </div>
  );
}

/**
 * The board: a column per seat, a row per round, snaking the way the draft
 * snakes. Every square carries its own pick number from the start and an
 * arrow to the next one, so an empty board still reads as a draft order
 * rather than as a blank grid.
 */
function MockBoard({ m, made, seat, next, yours, claimable, onClaim }: {
  m: Model; made: MockPick[]; seat: number; next: number;
  /** your own clock — the one moment the board is yours to move */
  yours: boolean;
  claimable: boolean; onClaim: (n: number) => void;
}) {
  const cols = Array.from({ length: m.teamCount }, (_, i) => i + 1);
  const rows = Array.from({ length: m.rounds }, (_, i) => i + 1);
  const at = (round: number, col: number) => made.find(p => p.round === round && p.slot === col);
  const scroller = useRef<HTMLDivElement>(null);
  /** Where the board was last told to go, so a second pick arriving mid-glide
   *  measures against the destination rather than against the animation. */
  const aim = useRef<{ x: number; y: number } | null>(null);

  // Your seat is the one you came to see, and it is rarely on screen at this
  // cell size. Centre it once, on open.
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = Math.max(0, AXIS + (seat - 0.5) * (CELL + GAP) - el.clientWidth / 2);
  }, [seat]);

  /**
   * Follow the draft to wherever it goes.
   *
   * Only four or five seats fit at this cell size, so most picks land off the
   * side of the screen: the header would announce a name while the board sat
   * still on somebody else's column, and the pick you were told about was the
   * one thing you could not see. The same is true downward once the rounds
   * outrun the board's height.
   *
   * It moves only when the square is actually outside the view, so a board
   * already showing the action stays where the reader put it, and it stops
   * short of the sticky round numbers rather than sliding underneath them.
   *
   * The square it follows is the one ON THE CLOCK, not the last one taken.
   * Following the last pick left the board a single column short of the draft,
   * every time: the pick about to be made sat just off the edge — measured at
   * 78px past it on a phone, one cell — so the square you were waiting on was
   * the one square you could not see. And before the first pick exists there is
   * nothing to follow at all, which left 1.1 off screen for its whole turn.
   *
   * The cell just taken is next door to the one on the clock, so aiming at the
   * clock still brings it along.
   */
  const clockKey = (() => {
    if (!next) return null;
    const round = Math.ceil(next / m.teamCount);
    const inRound = next - (round - 1) * m.teamCount;
    if (round > m.rounds) return null;
    const slot = m.snake && round % 2 === 0 ? m.teamCount - inRound + 1 : inRound;
    return round + '-' + slot;
  })();
  const newest = made.length ? made[made.length - 1] : null;
  // Once the board is full there is no clock left, so it rests on the last pick.
  const lastKey = clockKey || (newest ? newest.round + '-' + newest.slot : null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !lastKey) return;
    const cell = el.querySelector<HTMLElement>('[data-cell="' + lastKey + '"]');
    if (!cell) return;
    /* Absolute targets, not `scrollBy`.
     *
     * A relative scroll is relative to where the board is AT THAT INSTANT, and
     * during a smooth animation that is a moving number — so a pick landing
     * while the previous one is still gliding compounds two offsets and stops
     * short. The far column never quite arrived, every round.
     *
     * The cell's position in CONTENT coordinates does not move while the board
     * does: the rect and the scroll offset shift together, so their sum is
     * stable mid-animation. Aim at that instead, and compare against where the
     * board was last told to go rather than where it currently is. */
    const c = cell.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const PAD = 14;
    const cx = c.left - box.left + el.scrollLeft;
    const cy = c.top - box.top + el.scrollTop;
    const from = aim.current ?? { x: el.scrollLeft, y: el.scrollTop };

    let x = from.x;
    if (cx - AXIS - PAD < x) x = cx - AXIS - PAD;
    else if (cx + c.width + PAD > x + el.clientWidth) x = cx + c.width + PAD - el.clientWidth;
    let y = from.y;
    if (cy - PAD < y) y = cy - PAD;
    else if (cy + c.height + PAD > y + el.clientHeight) y = cy + c.height + PAD - el.clientHeight;

    x = Math.max(0, Math.min(x, el.scrollWidth - el.clientWidth));
    y = Math.max(0, Math.min(y, el.scrollHeight - el.clientHeight));
    if (x === from.x && y === from.y) return;
    aim.current = { x, y };
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: x, top: y, behavior: still ? 'auto' : 'smooth' });
  }, [lastKey]);

  return (
    <div
      ref={scroller}
      className={'bd-scroll' + (yours ? ' is-yours' : '')}
      /* While it is yours, where you leave it IS where it is. The follow aims
       * from its own last target rather than from the live position, so without
       * this it would measure your turn's move from wherever it last put the
       * board and jump somewhere neither of you asked for on the next pick. */
      onScroll={yours ? (e => {
        const el = e.currentTarget;
        aim.current = { x: el.scrollLeft, y: el.scrollTop };
      }) : undefined}
    >
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
                data-cell={r + '-' + c}
                className={'bd-cell' + (p ? ' is-filled' : '') + (p?.mine ? ' is-mine' : '')
                  + (onClock ? ' is-clock' : '') + (c === seat ? ' is-seat' : '')}
                style={pos ? ({
                  '--pos': colorOf(pos),
                  '--pos-fill': cellOf(pos),
                } as CSSProperties) : undefined}
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
