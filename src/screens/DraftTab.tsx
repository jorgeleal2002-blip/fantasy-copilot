import { ACCENT, GOOD, POS } from '../model/constants';
import { num } from '../model/math';
import { reasons } from '../model/score';
import type { DraftDeal, Model } from '../model/types';
import type { App } from '../state/useApp';
import { PlayerSearch } from '../ui/PlayerSearch';
import { Card, Screen, Segmented, type SegOption } from '../ui/primitives';
import { capsule, dim, ellipsis, fitColor, fitStyle, heroCard, heroGlow, kicker, posBadge } from '../ui/styles';

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

  const views: SegOption<'board' | 'deals'>[] = m.isDynasty
    ? [{ key: 'board', label: 'Board' }, { key: 'deals', label: 'Pick moves' }]
    : [{ key: 'board', label: 'Board' }];
  const view = m.isDynasty ? app.draftView : 'board';

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
                {top ? `${top.pos} · ${top.team} · ${top.age ?? '?'} yrs · ADP ${top.adp}` : ''}
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

      <Segmented options={views} value={view} onChange={app.setDraftView} size="sm" />

      {view === 'board' ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {m.upcoming.length ? (
              <div style={{ display: 'flex', gap: 6 }}>
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
            <PlayerSearch app={app} m={m} />
            <div style={{ display: 'flex', gap: 6 }}>
              {m.isDynasty ? (
                <Segmented
                  options={[{ key: 'rookies', label: 'Rookies' }, { key: 'fa', label: 'Free agents' }]}
                  value={app.boardMode}
                  onChange={app.setBoardMode}
                />
              ) : (
                <div style={{ ...capsule, flex: 1, justifyContent: 'center' }}>Available players</div>
              )}
            </div>
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
                      {p.pos} · {p.team} · {p.age ?? '?'} yrs{gone ? ' · unlikely to last' : ''}
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
      ) : (
        <PickMoves app={app} m={m} />
      )}
    </Screen>
  );
}

function segChip(active: boolean) {
  return {
    flex: 1,
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
