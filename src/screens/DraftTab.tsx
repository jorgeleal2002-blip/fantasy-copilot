import type { FillPos, Pos, PosFilter } from '../api/types';
import { ACCENT, GOOD, POS } from '../model/constants';
import { num, pickLabel } from '../model/math';
import { reasons } from '../model/score';
import type { DraftDeal, Model } from '../model/types';
import type { App } from '../state/useApp';
import { PlayerSearch, type SearchScope } from '../ui/PlayerSearch';
import { Icon } from '../ui/icons';
import { Banner, Card, Panel, Screen, Segmented, type SegOption } from '../ui/primitives';
import { capsule, cardTitle, dim, ellipsis, fitColor, fitStyle, panelNote, panelTitle, posBadge } from '../ui/styles';

const STATUS_TEXT: Record<string, string> = {
  pre_draft: 'Draft not started',
  drafting: 'Draft in progress',
  complete: 'Draft complete',
  paused: 'Draft paused',
};

/** The kicker and the defence join the row only where the league starts one,
 *  which is also the only place the board carries them. */
const posFilters = (fills: FillPos[]): SegOption<PosFilter>[] => [
  { key: 'ALL', label: 'All' },
  ...(POS as PosFilter[]).concat(fills).map(p => ({ key: p, label: p })),
];

export function DraftTab({ app, m }: { app: App; m: Model }) {
  // Once every pick is in, this screen stops being a draft board and becomes
  // the free-agent pool. `selPick` falls back to your LAST pick when none are
  // left, which is how a finished draft kept recommending a pick that had
  // already been used and counting "0 selections before yours".
  const done = m.draft?.status === 'complete' || m.picks.length >= m.rounds * m.teamCount;
  /**
   * Where a player sits.
   *
   * `goes` counts among who is STILL AVAILABLE, which is his place in the free
   * agents once the draft is over — but is not a pick number while one is
   * running. The best man left is first in that queue at every moment, so
   * printed raw he read "1.01" in the fourth round. With `nextOverall - 1`
   * picks already spent, the player first in the queue goes at `nextOverall`.
   */
  /** That queue position as an overall pick of this draft. */
  const asPick = (goes: number | null) => (goes ? m.nextOverall - 1 + goes : null);
  const where = (goes: number | null) => (
    done
      ? (goes ? 'FA #' + goes : 'unranked')
      : (pickLabel(asPick(goes), m.teamCount) || 'unranked')
  );
  /* The picker keeps its choice across leagues, and K is not a choice in a
   * league that starts no kicker: left alone it selected a tab that was no
   * longer drawn and emptied the board with nothing on screen looking wrong. */
  const filter: PosFilter = m.fills.indexOf(app.filter as FillPos) < 0
    && POS.indexOf(app.filter as Pos) < 0 && app.filter !== 'ALL' ? 'ALL' : app.filter;
  const filtered = filter === 'ALL' ? m.scored : m.scored.filter(p => p.pos === filter);
  const top = filtered[0] || m.scored[0];
  const status = m.draft ? (STATUS_TEXT[m.draft.status || ''] || m.draft.status || '—') : 'No draft configured';
  const dotColor = m.draft?.status === 'drafting' ? GOOD : m.draft?.status === 'complete' ? dim(0.4) : ACCENT;

  const views: SegOption<'board' | 'mock' | 'deals'>[] = m.isDynasty
    ? [{ key: 'board', label: 'Board' }, { key: 'mock', label: 'Mock' }, { key: 'deals', label: 'Pick moves' }]
    : [{ key: 'board', label: 'Board' }, { key: 'mock', label: 'Mock' }];
  const view = app.draftView;

  // The search follows whichever board is on screen: a rookie draft has no
  // business surfacing a rostered veteran you cannot select.
  const rookieBoard = m.isDynasty && app.boardMode !== 'fa';
  const searchScope: SearchScope & { placeholder: string } = rookieBoard
    ? {
      keep: e => e.rookie && !e.taken,
      narrowed: 'not in the rookie pool. Switch to Free agents, or look them up from the Trades tab.',
      placeholder: 'Search the rookie class',
    }
    : {
      keep: e => !e.taken,
      narrowed: 'already on a roster. Look them up from the Trades tab to see what they cost.',
      placeholder: 'Search available players',
    };

  return (
    <Screen>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9,
        background: 'var(--color-surface)', borderRadius: 11, padding: '11px 12px',
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>{status}</div>
          <div style={{ fontSize: 11, color: dim(0.45), marginTop: 2 }}>
            {(m.mySlot ? 'Your slot ' + m.mySlot + ' · ' : '') +
              m.picks.length + ' of ' + m.rounds * m.teamCount + ' picks made · auto-refreshes every 20s'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void app.refreshPicks()}
          className="btn btn-ghost"
          style={{ fontSize: 11.5, flex: 'none' }}
        >
          Refresh
        </button>
      </div>

      {/* The recommendation, drawn as the reference draws a headline card: the
          page's own ground, one line round it, everything on the centre line.
          The name is the headline and the score is the figure under it — side
          by side they were two things at the top of the screen arguing about
          which one you read first. */}
      <Panel style={{ padding: '15px 14px' }}>
        <div style={panelTitle}>
          <Icon name="star" size={17} />
          <span>
            {done
              ? 'Best free agent'
              : `Pick ${m.myRound}.${String(m.myPickInRound).padStart(2, '0')}`}
          </span>
        </div>
        <div style={{
          fontSize: 27, fontWeight: 500, letterSpacing: '-0.025em', textAlign: 'center',
          marginTop: 10, ...ellipsis,
        }}>
          {top ? top.name : '—'}
        </div>
        <div style={{ ...panelNote, marginTop: 5 }}>
          {/* A rookie has no NFL team until he is drafted, and Sleeper
              reports that as null — which a template literal prints as
              the word "null". */}
          {top ? [
            top.pos,
            top.team || 'no team yet',
          ].concat(top.age ? [top.age + ' yrs'] : [])
            // Where the board has him among what is left, as a pick.
            .concat([done ? where(top.goes) : 'goes ' + where(top.goes)])
            .join(' · ') : ''}
        </div>
        {/* Stacked, not side by side: the figure has to sit on the card's
            centre line, and a number with its caption beside it centres the
            PAIR, which leaves the number itself off to the left. */}
        <div style={{ textAlign: 'center', marginTop: 13 }}>
          <div style={{
            fontSize: 30, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1,
            color: 'var(--color-accent-300)',
          }}>
            {top ? top.fit : '—'}
          </div>
          <div style={{
            fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase',
            color: dim(0.45), marginTop: 5,
          }}>
            {/* A kicker's number is where the consensus takes him, not a
                Fit — none of the nine metrics exists for one. */}
            {top && POS.indexOf(top.pos as Pos) < 0 ? 'consensus' : 'fit score'}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 12 }}>
          {top ? reasons(top.m, pickLabel(asPick(top.goes), m.teamCount), top.pos, top.age).map(r => (
            <span key={r} style={{
              fontSize: 11, padding: '4px 9px', borderRadius: 7,
              background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)', color: 'var(--color-accent-200)',
            }}>
              {r}
            </span>
          )) : null}
        </div>
        <button
          type="button"
          onClick={() => top && app.setDetail(top.id)}
          className="btn btn-primary"
          style={{ marginTop: 13, width: '100%', borderRadius: 9, padding: '9px 13px' }}
        >
          See score breakdown
        </button>
      </Panel>

      {/* A picker with one option is not a picker. Redraft leagues have no
          pick-movement view, so there is nothing to switch between. */}
      {views.length > 1
        ? <Segmented options={views} value={view} onChange={app.setDraftView} size="sm" />
        : null}

      {view === 'board' ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 10.5, letterSpacing: '.02em', color: dim(0.38), padding: '0 2px' }}>
              {done
                ? `Draft complete · ${m.picks.length} picks made · everyone below is still unrostered`
                : m.selPick
                ? `Overall pick ${m.selPick.overall} of ${m.rounds * m.teamCount} · ` +
                  `${Math.max(m.selPick.overall - m.nextOverall, 0)} selections before yours` +
                  (m.selPick.via ? ` · acquired from ${m.selPick.via}` : '') +
                  ` · you hold ${m.myPickList.length} picks in this draft`
                // No pick of yours left can mean two opposite things, and
                // "complete" is the wrong one for a draft nobody has started:
                // a league whose order is not set yet has no picks to name.
                : m.picks.length >= m.rounds * m.teamCount
                  ? 'Draft complete'
                  : 'Draft order not set yet — Sleeper publishes it when the commissioner does'}
            </div>
            {/* Direct children of the screen's column, so each fills the width
                like every other control row. Wrapping the segmented in a flex
                row left it hugging its own text. */}
            {m.isDynasty ? (
              <Segmented
                options={[{ key: 'rookies', label: 'Rookies' }, { key: 'fa', label: 'Free agents' }]}
                value={app.boardMode}
                onChange={app.setBoardMode}
              />
            ) : (
              <div style={{ ...capsule, justifyContent: 'center' }}>Available players</div>
            )}
            {/* Under the toggle, because it obeys it: the board is filtered and
                a search over it that is not would hand you a name you cannot
                draft. */}
            <PlayerSearch app={app} m={m} placeholder={searchScope.placeholder} scope={searchScope} />
            <Segmented options={posFilters(m.fills)} value={filter} onChange={app.setFilter} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* How many names come off between now and the pick you are
                looking at. Anyone the board has inside that many is unlikely
                to reach you. */}
            {filtered.slice(0, 24).map(p => {
              const before = m.selPick ? Math.max(m.selPick.overall - m.nextOverall, 0) : 0;
              // Against his place on the BOARD, not his place in this list.
              // This list is sorted by Fit, so measuring against its index
              // marked the best-fitting players gone no matter where the board
              // actually had them — and then hid their pick number behind the
              // warning, which is how the top of the board ended up showing no
              // information at all.
              const gone = !!p.goes && p.goes <= before;
              return (
                <div
                  key={p.id}
                  className="row-tap"
                  role="button"
                  tabIndex={0}
                  onClick={() => app.setDetail(p.id)}
                  onKeyDown={e => { if (e.key === 'Enter') app.setDetail(p.id); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 11,
                    background: 'var(--color-surface)', borderRadius: 11, padding: '11px 12px', cursor: 'pointer',
                  }}
                >
                  <div style={posBadge(app.photoFor(p.id))}>{p.pos}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em', ...ellipsis }}>{p.name}</div>
                    <div style={{ fontSize: 11.5, color: dim(0.45), marginTop: 2 }}>
                      {/* A team defence has no age, and "? yrs" is not a fact. */}
                      {[p.pos, p.team || 'no team yet']
                        .concat(p.age ? [p.age + ' yrs'] : []).join(' · ')}
                      {gone ? ' · unlikely to last' : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.02em', color: fitColor(p.fit) }}>
                      {p.fit}
                    </div>
                    <div style={{ fontSize: 10.5, color: dim(0.4), marginTop: 2 }}>
                      {/* The warning goes with the number, never over it. */}
                      {where(p.goes)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : view === 'mock' ? (
        <MockLauncher app={app} m={m} />
      ) : (
        <PickMoves app={app} m={m} />
      )}
    </Screen>
  );
}

/**
 * The way into the mock — a seat, then a door.
 *
 * The draft itself is not here. It takes over the screen (`MockRoom`), because
 * a room you can still see the rest of the app behind is not a room. All this
 * does is pick where you sit and let you back into a run already going.
 */
function MockLauncher({ app, m }: { app: App; m: Model }) {
  const st = m.runMock(app.mockSeed, app.mockChoices, app.mockSlot);
  const going = Object.keys(app.mockChoices).length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Banner
        icon="board"
        title="Mock draft"
        note={`${m.teamCount} teams, ${m.rounds} rounds`}
      >
        <div style={{ fontSize: 12, color: dim(0.5), marginTop: 10, lineHeight: 1.5, textAlign: 'center', textWrap: 'pretty' }}>
          Claim a seat on the board, then start. The other {m.teamCount - 1} draft live
          while you watch, and every name left carries a fit rating for your roster.
        </div>
        <button
          type="button"
          onClick={app.openMock}
          className="btn btn-primary"
          style={{ marginTop: 13, width: '100%', padding: '12px 0', fontSize: 13.5, borderRadius: 11 }}
        >
          {going ? 'Back to the draft room' : 'Enter the draft room'}
        </button>
        {going ? (
          <button
            type="button"
            onClick={app.rerollMock}
            className="btn btn-ghost"
            style={{ marginTop: 8, width: '100%', fontSize: 12, padding: '6px 0' }}
          >
            Start over from scratch
          </button>
        ) : null}
      </Banner>

      {/* Only worth a card once there is something in it. The seat is claimed
          on the board inside the room, where you can see what you are claiming. */}
      {going ? (
        <Card>
          <div style={{ ...cardTitle, marginBottom: 8 }}>What you have drafted</div>
          {st.myTeam.map((o, i) => (
            <div key={o.id} style={{
              display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5,
              paddingTop: 8, borderTop: i === 0 ? 'none' : '1px solid var(--color-divider)',
            }}>
              <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{o.name}</span>
              <span style={{ color: dim(0.42), flex: 'none' }}>{o.pos} · fit {o.fit}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: dim(0.4), marginTop: 10 }}>
            {st.made.length} picks in · {POS.map(p => st.shape[p] + ' ' + p).join(' · ')}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** Trade-up / trade-down offers, priced off the same market as everything else. */
function PickMoves({ app, m }: { app: App; m: Model }) {
  if (!m.bestDeals.length) {
    return (
      <Card>
        <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 6 }}>No pick moves worth making</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: dim(0.5) }}>
          Nobody's picks line up with yours at a price both sides would take. This recomputes as picks come off the board.
        </div>
      </Card>
    );
  }
  return (
    <Card>
      {m.bestDeals.map((dd, i) => (
        <div key={dd.kind + dd.partner + i} style={{
          padding: '11px 0',
          borderTop: i === 0 ? '1px solid transparent' : '1px solid var(--color-divider)',
          marginTop: i === 0 ? 0 : 9,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              {dd.kind === 'up' ? 'Move up to ' + dd.get[0].label : 'Move down and stack picks'}
            </div>
            <span style={fitStyle(dd.fit)}>{dd.fit}</span>
          </div>
          <div style={{ fontSize: 11.5, color: dim(0.5), marginTop: 6 }}>with {dd.partner}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 7 }}>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: GOOD }}>Receive</span>{' '}
              {dd.get.map(x => `${x.label} (${num(x.q * 100)})`).join(' + ')}
            </div>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: '#d9a08e' }}>Send</span>{' '}
              {dd.give.map(x => `${'label' in x && x.label ? x.label : x.name} (${num(x.q * 100)})`).join(' + ')}
            </div>
          </div>
          <div style={{ fontSize: 11.5, lineHeight: 1.5, color: dim(0.45), marginTop: 7, textWrap: 'pretty' }}>
            {dealWhy(dd)}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => app.showToast(
              'Propose: send ' + dd.give.map(x => ('label' in x && x.label ? x.label : x.name)).join(' + ') +
              ', receive ' + dd.get.map(x => x.label).join(' + '),
            )}
            style={{ fontSize: 12, marginTop: 8, padding: 0 }}
          >
            Propose this move
          </button>
        </div>
      ))}
    </Card>
  );
}

function dealWhy(dd: DraftDeal): string {
  const premium = Math.round((dd.ratio - 1) * 100);
  if (dd.kind === 'up') {
    return `You pay a ${premium}% premium to consolidate into one high pick. ` +
      (dd.prof.window === 'rebuild'
        ? 'They are rebuilding: they want volume, not one high pick.'
        : 'They are mid-table, so the extra volume suits them.');
  }
  return `You collect a ${premium}% premium for giving up the higher slot and keeping two swings. ` +
    (dd.prof.window === 'contender'
      ? 'They are contending and want to move up for a starter now.'
      : 'They want to move up the board.');
}
