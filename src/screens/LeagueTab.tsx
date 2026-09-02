import { BAD, GOOD, MID, POS } from '../model/constants';
import { num } from '../model/math';
import type { LeagueRow, Model, PlayerFit } from '../model/types';
import type { App } from '../state/useApp';
import { Card, Screen, Segmented, type SegOption } from '../ui/primitives';
import { cardTitle, dim, ellipsis, fitColor } from '../ui/styles';

const STATUS_TEXT: Record<string, string> = {
  pre_draft: 'draft not started',
  drafting: 'draft in progress',
  complete: 'draft complete',
  paused: 'draft paused',
};

/**
 * "Rebuilding" is a dynasty word. A redraft league has nothing to rebuild
 * toward — every roster is torn up at the end of the season — so there the
 * label can only be about how strong a team is right now.
 */
const windowLabel = (r: LeagueRow, dynasty: boolean) =>
  r.now <= 0 ? 'No roster'
    : r.window === 'contender' ? 'Contending'
      : r.window === 'rebuild' ? (dynasty ? 'Rebuilding' : 'Out of it')
        : 'Mid';

const windowColor = (r: LeagueRow) =>
  r.now <= 0 ? dim(0.35) : r.window === 'contender' ? GOOD : r.window === 'rebuild' ? BAD : MID;

export function LeagueTab({ app, m }: { app: App; m: Model }) {
  type Mode = 'now' | 'future' | 'fit' | 'fitFut';
  const modes: SegOption<Mode>[] = m.isDynasty
    ? [
      { key: 'now', label: 'Strength today' },
      { key: 'future', label: 'Future value' },
      { key: 'fit', label: 'Fit today' },
      { key: 'fitFut', label: 'Fit ahead' },
    ]
    : [{ key: 'now', label: 'Roster strength' }, { key: 'fit', label: 'Fit Score' }];
  const allowed = modes.map(o => o.key);
  const mode: Mode = allowed.includes(app.rankMode) ? app.rankMode : 'now';
  const isFitMode = mode === 'fit' || mode === 'fitFut';

  const ranked = m.leagueRows.slice().sort((a, b) => (
    mode === 'future' ? b.future - a.future
      : mode === 'fit' ? b.fit - a.fit
        : mode === 'fitFut' ? b.fitFut - a.fitFut
          : b.now - a.now
  ));
  const NOTES: Record<Mode, string> = {
    now: 'the sum of the best lineup each team can field today.',
    future: 'the roster aged two seasons plus the pick capital it owns.',
    fit: 'the average Fit of the optimal starters — quality, not volume.',
    fitFut: 'the same Fit with the roster aged two seasons, picks excluded.',
  };
  const note = 'Ordered by ' + NOTES[mode] +
    (m.isDynasty ? ' On the right, how far each team drifts from its raw strength.' : '');

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
              background: t.isMe ? 'color-mix(in srgb, var(--color-accent) 9%, transparent)' : 'transparent',
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
                <span style={{ fontSize: 10, color: windowColor(t), flex: 'none' }}>{windowLabel(t, m.isDynasty)}</span>
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
              <div style={{ fontSize: 12.5, color: dim(0.7), fontVariantNumeric: 'tabular-nums' }}>
                {isFitMode
                  ? (t.now <= 0 ? '—' : Math.round(mode === 'fitFut' ? t.fitFut : t.fit))
                  : num((mode === 'future' ? t.future : t.now) * 100)}
              </div>
              {/* Across ten teams the order barely moves between measures, so a
                  change of place says little. What does have range is how many
                  Fit points a roster loses as it ages. */}
              {m.isDynasty && t.now > 0 ? (() => {
                const d = Math.round(t.fitFut - t.fit);
                if (Math.abs(d) < 2) return null;
                return (
                  <div style={{ fontSize: 10, marginTop: 2, color: d > 0 ? GOOD : BAD }}>
                    {(d > 0 ? '+' : '') + d} in 2 yrs
                  </div>
                );
              })() : null}
            </div>
            <div style={{ flex: 'none', padding: '6px 4px 6px 8px', color: 'var(--color-accent)', fontSize: 15 }}>›</div>
          </div>
        ))}
      </div>

      <TopPlayers app={app} m={m} />

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

/**
 * The best players in the league, seen through three lenses. The neutral one
 * drops the need term and measures the stack inside the owner's own roster —
 * how good he is, full stop. "For you" is a different question: how much he
 * would help YOU. And "in 2 years" ages everyone, which is where the players
 * the league has not priced yet show up.
 */
function TopPlayers({ app, m }: { app: App; m: Model }) {
  const lens = app.topLens;
  const valueOf = (x: PlayerFit) => (lens === 'me' ? x.fitMe : lens === 'fut' ? x.fit2 : x.fit);

  const list = m.allFits
    .filter(x => app.topPos === 'ALL' || x.pos === app.topPos)
    .slice()
    .sort((a, b) => valueOf(b) - valueOf(a))
    .slice(0, 15);

  const lensOptions: SegOption<'neutral' | 'me' | 'fut'>[] = m.isDynasty
    ? [{ key: 'neutral', label: 'Today' }, { key: 'me', label: 'For you' }, { key: 'fut', label: 'In 2 yrs' }]
    : [{ key: 'neutral', label: 'Today' }, { key: 'me', label: 'For you' }];

  const lensNote = lens === 'me'
    ? 'With YOUR positional need and the stack against your roster: how much having him would actually help you.'
    : lens === 'fut'
      ? 'Every player aged two seasons, his quality discounted by his position\'s curve and his metrics recomputed at that age. The ones that climb are the ones the league has not priced yet.'
      : 'No need term, and the stack measured inside his owner\'s roster: how good he is, full stop. The same for everybody.';

  if (!m.allFits.length) return null;

  return (
    <Card>
      <div
        role="button"
        tabIndex={0}
        onClick={() => app.setTopOpen(!app.topOpen)}
        onKeyDown={e => { if (e.key === 'Enter') app.setTopOpen(!app.topOpen); }}
        style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, cursor: 'pointer' }}
      >
        <div style={cardTitle}>Best in the league</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 11.5, color: dim(0.45), ...ellipsis }}>
            {app.topOpen ? 'top 15' : `${list[0]?.name ?? 'top 15'} ${list[0] ? valueOf(list[0]) : ''}`}
          </span>
          <span style={{ color: 'var(--color-accent)', fontSize: 13 }}>{app.topOpen ? '⌄' : '›'}</span>
        </div>
      </div>

      {app.topOpen ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          <Segmented options={POS_OPTIONS} value={app.topPos} onChange={app.setTopPos} size="sm" />
          <Segmented options={lensOptions} value={lens} onChange={app.setTopLens} size="sm" />
          <div style={{ fontSize: 11, lineHeight: 1.45, color: dim(0.42), textWrap: 'pretty' }}>{lensNote}</div>

          <div style={{ marginTop: 2 }}>
            {list.map((x, i) => (
              <div
                key={x.id}
                role="button"
                tabIndex={0}
                onClick={() => app.setDetail(x.id)}
                onKeyDown={e => { if (e.key === 'Enter') app.setDetail(x.id); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--color-divider)',
                  cursor: 'pointer',
                  background: x.mine ? 'color-mix(in srgb, var(--color-accent) 9%, transparent)' : 'transparent',
                }}
              >
                <span style={{ width: 16, flex: 'none', color: dim(0.4), fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em', ...ellipsis }}>{x.name}</div>
                  <div style={{ fontSize: 10.5, color: dim(0.42), marginTop: 2, ...ellipsis }}>
                    {x.pos} · {x.team || 'FA'} ·{' '}
                    {lens === 'fut' ? `${x.age ?? '?'}→${(x.age || 25) + 2} yrs` : `${x.age ?? '?'} yrs`} ·{' '}
                    {x.mine ? 'yours' : x.owner}
                    {lens === 'fut'
                      ? ` · today ${x.fit}${x.fit2 - x.fit > 1 ? ' ↑' : x.fit - x.fit2 > 1 ? ' ↓' : ''}`
                      : ''}
                  </div>
                </div>
                <span style={{
                  fontSize: 12.5, flex: 'none', padding: '2px 8px', borderRadius: 6,
                  fontVariantNumeric: 'tabular-nums',
                  background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: fitColor(valueOf(x)),
                }}>
                  {valueOf(x)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

const POS_OPTIONS: SegOption<'ALL' | 'QB' | 'RB' | 'WR' | 'TE'>[] =
  [{ key: 'ALL', label: 'All' }, ...POS.map(p => ({ key: p, label: p }))];
