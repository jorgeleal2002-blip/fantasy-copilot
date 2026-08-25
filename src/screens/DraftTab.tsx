import { useState } from 'react';
import { ACCENT, BAD, GOOD, POS } from '../model/constants';
import { num } from '../model/math';
import { reasons } from '../model/score';
import type { DraftDeal, MockOption, MockPick, Model } from '../model/types';
import type { App } from '../state/useApp';
import { PlayerSearch, type SearchScope } from '../ui/PlayerSearch';
import { Card, Screen, Segmented, type SegOption } from '../ui/primitives';
import { capsule, cardTitle, dim, ellipsis, fitColor, fitStyle, heroCard, heroGlow, kicker, posBadge } from '../ui/styles';

const STATUS_TEXT: Record<string, string> = {
  pre_draft: 'Draft not started',
  drafting: 'Draft in progress',
  complete: 'Draft complete',
  paused: 'Draft paused',
};

const POS_FILTERS: SegOption<'ALL' | 'QB' | 'RB' | 'WR' | 'TE'>[] =
  [{ key: 'ALL', label: 'All' }, ...POS.map(p => ({ key: p, label: p }))];

export function DraftTab({ app, m }: { app: App; m: Model }) {
  const filtered = app.filter === 'ALL' ? m.scored : m.scored.filter(p => p.pos === app.filter);
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

      <div style={heroCard}>
        <div style={heroGlow} />
        <div style={{ position: 'relative' }}>
          <div style={kicker}>
            Recommendation · pick {m.myRound}.{String(m.myPickInRound).padStart(2, '0')}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginTop: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.025em', ...ellipsis }}>
                {top ? top.name : '—'}
              </div>
              <div style={{ fontSize: 12.5, color: dim(0.6), marginTop: 4 }}>
                {/* A rookie has no NFL team until he is drafted, and Sleeper
                    reports that as null — which a template literal prints as
                    the word "null". */}
                {top ? [top.pos, top.team || 'no team yet', (top.age ?? '?') + ' yrs', 'ADP ' + top.adp].join(' · ') : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right', flex: 'none' }}>
              <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.03em', color: '#c9c0f0' }}>
                {top ? top.fit : '—'}
              </div>
              <div style={{ fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.45) }}>
                fit score
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {top ? reasons(top.m, top.adp, top.pos, top.age).map(r => (
              <span key={r} style={{
                fontSize: 11, padding: '4px 9px', borderRadius: 7,
                background: 'rgba(145,132,217,.18)', color: '#c9c0f0',
              }}>
                {r}
              </span>
            )) : null}
          </div>
          <button
            type="button"
            onClick={() => top && app.setDetail(top.id)}
            className="btn btn-primary"
            style={{ marginTop: 14, borderRadius: 9, padding: '8px 13px' }}
          >
            See score breakdown
          </button>
        </div>
      </div>

      {/* A picker with one option is not a picker. Redraft leagues have no
          pick-movement view, so there is nothing to switch between. */}
      {views.length > 1
        ? <Segmented options={views} value={view} onChange={app.setDraftView} size="sm" />
        : null}

      {view === 'board' ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* A grid, not a row. A dynasty rookie draft gives you four picks
                and a row fits; a redraft league gives you thirteen and a row
                runs off the side of the phone, taking the last nine with it.
                Wrapping keeps every pick of yours visible and tappable. */}
            {m.upcoming.length ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(58px, 1fr))',
                gap: 6,
              }}>
                {m.upcoming.map((p, i) => (
                  <button
                    key={p.overall}
                    type="button"
                    onClick={() => app.setPickSel(i)}
                    style={{
                      ...segChip(!!m.selPick && m.selPick.overall === p.overall),
                      font: 'inherit', fontSize: 11.5,
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div style={{ fontSize: 10.5, letterSpacing: '.02em', color: dim(0.38), padding: '0 2px' }}>
              {m.selPick
                ? `Overall pick ${m.selPick.overall} of ${m.rounds * m.teamCount} · ` +
                  `${Math.max(m.selPick.overall - m.nextOverall, 0)} selections before yours` +
                  (m.selPick.via ? ` · acquired from ${m.selPick.via}` : '') +
                  ` · you hold ${m.myPickList.length} picks in this draft`
                : 'Draft complete'}
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
            <Segmented options={POS_FILTERS} value={app.filter} onChange={app.setFilter} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.slice(0, 24).map(p => {
              const idx = m.scored.indexOf(p) + 1;
              // Anyone this far up the board should be gone before your pick lands.
              const gone = m.selPick ? idx < (m.selPick.overall - m.nextOverall) - 1 : false;
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
                      {[p.pos, p.team || 'no team yet', (p.age ?? '?') + ' yrs'].join(' · ')}
                      {gone ? ' · unlikely to last' : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.02em', color: fitColor(p.fit) }}>
                      {p.fit}
                    </div>
                    <div style={{ fontSize: 10.5, color: dim(0.4), marginTop: 2 }}>
                      {gone ? 'gone before' : 'ADP ' + p.adp}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : view === 'mock' ? (
        <MockDraft app={app} m={m} />
      ) : (
        <PickMoves app={app} m={m} />
      )}
    </Screen>
  );
}

/**
 * The rest of the draft, played out.
 *
 * Every other manager takes the best player on the board for THEM, with enough
 * noise that two runs give two plausible boards — so the useful output is not
 * "this will happen" but "this is who tends to reach you, and here is what you
 * could do with each turn".
 */
function MockDraft({ app, m }: { app: App; m: Model }) {
  const res = m.runMock(app.mockSeed, app.mockChoices, app.mockSlot);
  const chosen = Object.keys(app.mockChoices).length;
  const [board, setBoard] = useState(false);
  const realSlot = m.mySlot;

  if (!res.mine.length) {
    return (
      <Card>
        <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 6 }}>No picks left to simulate</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: dim(0.5) }}>
          You have no selections remaining in this draft, so there is nothing to play out.
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        background: 'var(--color-surface)', borderRadius: 11, padding: '11px 12px',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>
            {res.mine.length === 1 ? '1 pick of yours' : res.mine.length + ' picks of yours'} through round {res.through}
          </div>
          <div style={{ fontSize: 10.5, color: dim(0.42), marginTop: 3 }}>
            {POS.map(p => res.shape[p] + ' ' + p).join(' · ')} when it is over
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 'none' }}>
          <button
            type="button"
            onClick={app.rerollMock}
            className="btn btn-secondary"
            style={{ borderRadius: 9, padding: '7px 11px', fontSize: 12 }}
          >
            Run again
          </button>
          {chosen ? (
            <button
              type="button"
              onClick={app.clearMockChoices}
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: 0 }}
            >
              Undo my {chosen === 1 ? 'pick' : chosen + ' picks'}
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontSize: 11, letterSpacing: '.02em', color: dim(0.42) }}>
          Draft from slot
          {realSlot ? <span style={{ color: dim(0.3) }}> · yours is {realSlot}</span> : null}
        </div>
        {/* The question every mock exists to answer is "what if I picked
            somewhere else", so the seat is a control and not a fact. */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))', gap: 6,
        }}>
          {Array.from({ length: m.teamCount }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              type="button"
              onClick={() => app.setMockSlot(n === realSlot ? null : n)}
              aria-pressed={res.slot === n}
              style={{ ...segChip(res.slot === n), font: 'inherit', fontSize: 11.5 }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: dim(0.45), textWrap: 'pretty' }}>
        Bots draft every other seat, for their own holes, with noise in it — so run it a few times.
        Tap whoever you would take and the rest of the board reacts. Every name carries its Fit,
        which is the part a mock room does not give you.
      </div>

      {res.mine.map(pick => (
        <Card key={pick.overall}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: '-0.01em' }}>Pick {pick.label}</div>
            <div style={{ fontSize: 10.5, color: dim(0.4) }}>overall {pick.overall}</div>
          </div>

          {pick.choiceLost ? (
            <div style={{ fontSize: 11.5, color: BAD, marginTop: 6, lineHeight: 1.45 }}>
              The player you took here went before your turn once the board changed. Pick again.
            </div>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
            {(pick.options || []).map((o, i) => (
              <MockChoice
                key={o.id}
                app={app}
                option={o}
                overall={pick.overall}
                taken={pick.player?.id === o.id}
                first={i === 0}
              />
            ))}
          </div>

          <ShowMore app={app} pick={pick} />
        </Card>
      ))}

      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <div style={cardTitle}>The whole board</div>
          <button
            type="button"
            onClick={() => setBoard(!board)}
            aria-expanded={board}
            className="btn btn-ghost"
            style={{ fontSize: 11.5, padding: 0 }}
          >
            {board ? 'Hide' : res.picks.length + ' picks ›'}
          </button>
        </div>
        {board ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {res.picks.map(p => (
              <div
                key={p.overall}
                style={{
                  display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12,
                  padding: p.mine ? '4px 7px' : '4px 0', margin: p.mine ? '0 -7px' : 0,
                  borderRadius: 7,
                  background: p.mine ? 'rgba(145,132,217,.14)' : 'transparent',
                }}
              >
                <span style={{ color: dim(0.45), flex: 'none', width: 42 }}>{p.label}</span>
                <span style={{ flex: 1, minWidth: 0, fontWeight: p.mine ? 500 : 400, ...ellipsis }}>
                  {p.player?.name}
                </span>
                <span style={{ color: dim(0.4), flex: 'none', maxWidth: 130, ...ellipsis }}>
                  {p.player?.pos} · {p.mine ? 'you' : p.team}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5), marginTop: 6 }}>
            Every selection the bots make, round by round, with yours marked.
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * One selectable name. Tapping the row takes him — the whole point of a mock
 * is playing it your way — so opening his sheet gets its own control rather
 * than stealing the tap everyone will make first.
 */
function MockChoice({ app, option: o, overall, taken, first }: {
  app: App; option: MockOption; overall: number; taken: boolean; first: boolean;
}) {
  return (
    <div style={{ paddingTop: 10, borderTop: first ? 'none' : '1px solid var(--color-divider)' }}>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={taken}
        onClick={() => app.chooseMock(overall, o.id)}
        onKeyDown={e => { if (e.key === 'Enter') app.chooseMock(overall, o.id); }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          cursor: 'pointer', borderRadius: 9, padding: '6px 8px', margin: '0 -8px',
          background: taken ? 'rgba(145,132,217,.14)' : 'transparent',
          border: '1px solid ' + (taken ? ACCENT : 'transparent'),
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
          <div style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: '-0.01em', marginTop: 3, ...ellipsis }}>
            {taken ? '✓ ' : ''}{o.name}
          </div>
          <div style={{ fontSize: 10.5, color: dim(0.42), marginTop: 2 }}>
            {[o.pos, o.team || 'no team yet', (o.age ?? '?') + ' yrs', 'ADP ' + (o.adp || '—')].join(' · ')}
          </div>
        </div>
        <div style={{ flex: 'none', textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: fitColor(o.fit) }}>{o.fit}</div>
          <div style={{ fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: dim(0.35) }}>
            fit
          </div>
        </div>
      </div>
      {o.why ? (
        <div style={{ fontSize: 11.5, color: dim(0.5), marginTop: 4, lineHeight: 1.45 }}>{o.why}</div>
      ) : null}
      <button
        type="button"
        onClick={() => app.setDetail(o.id)}
        className="btn btn-ghost"
        style={{ fontSize: 11, padding: '3px 0' }}
      >
        See his breakdown
      </button>
    </div>
  );
}

/** The rest of the board at that turn — three names is a shortlist, not a draft. */
function ShowMore({ app, pick }: { app: App; pick: MockPick }) {
  const [open, setOpen] = useState(false);
  const rest = pick.available || [];
  if (!rest.length) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="btn btn-ghost"
        style={{ fontSize: 11.5, padding: '9px 0 0' }}
      >
        {open ? 'Hide the rest of the board' : 'Someone else · ' + rest.length + ' more available ›'}
      </button>
      {open ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
          {rest.map((o, i) => (
            <MockChoice
              key={o.id}
              app={app}
              option={o}
              overall={pick.overall}
              taken={pick.player?.id === o.id}
              first={i === 0}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function segChip(active: boolean) {
  return {
    textAlign: 'center' as const,
    padding: '8px 4px',
    borderRadius: 9,
    cursor: 'pointer',
    border: '1px solid ' + (active ? ACCENT : 'var(--color-divider)'),
    color: active ? ACCENT : dim(0.6),
    background: active ? 'rgba(145,132,217,.12)' : 'transparent',
  };
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
