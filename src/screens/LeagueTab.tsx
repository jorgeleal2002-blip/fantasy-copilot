import { BAD, GOOD, MID } from '../model/constants';
import { num } from '../model/math';
import type { LeagueRow, Model } from '../model/types';
import type { App } from '../state/useApp';
import { Card, Screen, Segmented, type SegOption } from '../ui/primitives';
import { cardTitle, dim, ellipsis } from '../ui/styles';

const STATUS_TEXT: Record<string, string> = {
  pre_draft: 'draft not started',
  drafting: 'draft in progress',
  complete: 'draft complete',
  paused: 'draft paused',
};

const windowLabel = (r: LeagueRow) =>
  r.now <= 0 ? 'No roster'
    : r.window === 'contender' ? 'Contending'
      : r.window === 'rebuild' ? 'Rebuilding' : 'Mid';

const windowColor = (r: LeagueRow) =>
  r.now <= 0 ? dim(0.35) : r.window === 'contender' ? GOOD : r.window === 'rebuild' ? BAD : MID;

export function LeagueTab({ app, m }: { app: App; m: Model }) {
  const modes: SegOption<'now' | 'future'>[] = m.isDynasty
    ? [{ key: 'now', label: 'Strength today' }, { key: 'future', label: 'Future value' }]
    : [{ key: 'now', label: 'Roster strength' }];
  const mode = m.isDynasty ? app.rankMode : 'now';

  const ranked = m.leagueRows.slice().sort((a, b) => (mode === 'future' ? b.future - a.future : b.now - a.now));
  const note = !m.isDynasty
    ? 'Redraft league: only this season\'s strength counts.'
    : mode === 'future'
      ? 'Each roster projected two seasons out with the age curve, plus the pick capital that team actually owns.'
      : 'The sum of the best lineup each team can field today, at market values.';

  const facts = [
    { label: 'Teams', value: String(m.teamCount) },
    {
      label: 'Type',
      value: m.league.settings?.type === 2 ? 'Dynasty' : m.league.settings?.type === 1 ? 'Keeper' : 'Redraft',
    },
    { label: 'Draft', value: (m.draft ? m.draft.type || 'snake' : '—') + ' · ' + m.rounds + ' rounds' },
    {
      label: 'Starters',
      value: (m.league.roster_positions || []).filter(p => p !== 'BN' && p !== 'IR').join(', '),
    },
    {
      label: 'Season',
      value: m.league.season + ' · ' + (m.draft ? STATUS_TEXT[m.draft.status || ''] || m.draft.status : 'no draft'),
    },
  ];

  return (
    <Screen>
      <Segmented options={modes} value={mode} onChange={app.setRankMode} />
      <div style={{ fontSize: 11, lineHeight: 1.45, color: dim(0.4), marginTop: -4, textWrap: 'pretty' }}>{note}</div>

      <div style={{ background: 'var(--color-surface)', borderRadius: 12, overflow: 'hidden' }}>
        {ranked.map((t, i) => (
          <div
            key={t.id}
            className="row-tap"
            role="button"
            tabIndex={0}
            onClick={() => app.setDetail('team-' + t.id)}
            onKeyDown={e => { if (e.key === 'Enter') app.setDetail('team-' + t.id); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px',
              borderTop: i === 0 ? 'none' : '1px solid var(--color-divider)',
              cursor: 'pointer',
              background: t.isMe ? 'rgba(145,132,217,.09)' : 'transparent',
            }}
          >
            <span style={{ width: 16, flex: 'none', color: dim(0.4), fontSize: 12 }}>{i + 1}</span>
            {t.avatar ? (
              <img
                src={t.avatar}
                alt=""
                style={{
                  width: 28, height: 28, borderRadius: 8, flex: 'none', objectFit: 'cover',
                  border: '1px solid var(--color-divider)',
                }}
              />
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                <span style={{ fontSize: 13, fontWeight: t.isMe ? 600 : 400, letterSpacing: '-0.01em', ...ellipsis }}>
                  {t.name}
                </span>
                <span style={{ fontSize: 10, color: windowColor(t), flex: 'none' }}>{windowLabel(t)}</span>
              </div>
              <div style={{ fontSize: 10.5, color: dim(0.4), marginTop: 2 }}>
                {t.now <= 0
                  ? 'Draft not started'
                  : 'age ' + t.avgAge.toFixed(1) +
                    (t.worst ? ' · weak at ' + t.worst : '') +
                    (m.isDynasty ? ' · picks ' + num(t.pickCapital * 100) : '')}
              </div>
            </div>
            <div style={{ textAlign: 'right', flex: 'none' }}>
              <div style={{ fontSize: 12.5, color: dim(0.7) }}>
                {num((mode === 'future' ? t.future : t.now) * 100)}
              </div>
              {m.isDynasty ? (
                <div style={{
                  fontSize: 10, marginTop: 2,
                  color: t.shift > 0 ? GOOD : t.shift < 0 ? BAD : dim(0.35),
                }}>
                  {t.shift > 0 ? `↑${t.shift} ahead` : t.shift < 0 ? `↓${-t.shift} ahead` : 'steady'}
                </div>
              ) : null}
            </div>
            <div style={{ flex: 'none', padding: '6px 4px 6px 8px', color: 'var(--color-accent)', fontSize: 15 }}>›</div>
          </div>
        ))}
      </div>

      <Card>
        <div style={{ ...cardTitle, marginBottom: 10 }}>Format</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {facts.map(f => (
            <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }}>
              <span style={{ color: dim(0.5) }}>{f.label}</span>
              <span style={{ textAlign: 'right' }}>{f.value}</span>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ ...cardTitle, marginTop: 2 }}>Latest picks</div>
      {m.picks.length === 0 ? (
        <div style={{
          background: 'var(--color-surface)', borderRadius: 12, padding: '20px 16px',
          fontSize: 12.5, lineHeight: 1.5, color: dim(0.5), textAlign: 'center',
        }}>
          The draft has not started. Once it runs, every pick shows up here live and the board recomputes itself.
        </div>
      ) : null}
      {m.picks.slice(-8).reverse().map(p => {
        const pl = m.scoreAny(p.player_id);
        const by = m.teams.find(t => t.id === p.picked_by);
        return (
          <div
            key={p.pick_no}
            style={{
              display: 'flex', alignItems: 'center', gap: 11,
              background: 'var(--color-surface)', borderRadius: 11, padding: '10px 12px',
            }}
          >
            <div style={{ fontSize: 11, color: dim(0.4), width: 34, flex: 'none' }}>
              {p.round}.{String(((p.pick_no - 1) % m.teamCount) + 1).padStart(2, '0')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{pl ? pl.name : 'Player'}</div>
              <div style={{ fontSize: 11, color: dim(0.45), marginTop: 2 }}>
                {(by ? by.name : '—') + ' · ' + (pl ? `${pl.pos} ${pl.team}` : '')}
              </div>
            </div>
          </div>
        );
      })}
    </Screen>
  );
}
