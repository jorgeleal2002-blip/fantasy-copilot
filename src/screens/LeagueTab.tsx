import { ACCENT, BAD, GOOD, MID, POS } from '../model/constants';
import { num } from '../model/math';
import type { LeagueRow, Model, PlayerFit } from '../model/types';
import type { App, LeagueView } from '../state/useApp';
import { Card, Screen, Segmented, type SegOption } from '../ui/primitives';
import { cardTitle, dim, ellipsis, fitColor } from '../ui/styles';
import { Matchups } from './Matchups';
import { MyTeam } from './MyTeam';
import { PowerRankings } from './PowerRankings';
import { hasPlayed } from '../model/record';

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
  r.now <= 0 ? dim(0.52) : r.window === 'contender' ? GOOD : r.window === 'rebuild' ? BAD : MID;

export function LeagueTab({ app, m }: { app: App; m: Model }) {
  type Mode = 'power' | 'now' | 'future' | 'fit' | 'fitFut';
  /* One control carried two questions — what is measured, and when — so it
   * needed four labels of fourteen characters and the fourth fell off the
   * side of the phone. Split in two, every label is a word. */
  const allowed: Mode[] = m.isDynasty
    ? ['power', 'now', 'future', 'fit', 'fitFut']
    : ['power', 'now', 'fit'];
  const mode: Mode = allowed.includes(app.rankMode) ? app.rankMode : 'power';
  const isPower = mode === 'power';
  const isFitMode = mode === 'fit' || mode === 'fitFut';
  const ahead = mode === 'future' || mode === 'fitFut';

  /* Three questions, not two. "Power" is who has actually been the best;
   * the other two are what each roster is worth, which is a different
   * question and regularly a different order. */
  const measures: SegOption<'power' | 'strength' | 'rating'>[] = [
    { key: 'power', label: 'Power' },
    { key: 'strength', label: 'Strength' },
    { key: 'rating', label: 'Rating' },
  ];
  const horizons: SegOption<'today' | 'ahead'>[] = [
    { key: 'today', label: 'Today' },
    { key: 'ahead', label: 'In 2 years' },
  ];
  const pick = (meas: 'power' | 'strength' | 'rating', when: boolean) => app.setRankMode(
    meas === 'power' ? 'power'
      : meas === 'rating' ? (when ? 'fitFut' : 'fit')
        : (when ? 'future' : 'now'),
  );

  const ranked = m.leagueRows.slice().sort((a, b) => (
    mode === 'future' ? b.future - a.future
      : mode === 'fit' ? b.fit - a.fit
        : mode === 'fitFut' ? b.fitFut - a.fitFut
          : b.now - a.now
  ));
  /* The league's own screens, the way the Team page has its own: the week you
   * are in, where everybody stands, and what the league is. They used to be
   * one column in reading order, which put the rankings six matchup cards
   * below the fold and everything else under those — a page you had to scroll
   * to find out what was on it.
   *
   * The third screen used to be the league's format — its size, its starters,
   * its draft type — five lines that are set once and read once, and did not
   * earn a third of the only control at the top of this tab. The best players
   * in the league did. */
  const screens: SegOption<LeagueView>[] = [
    { key: 'weeks', label: 'Weeks' },
    { key: 'myteam', label: 'My team' },
    { key: 'rankings', label: 'Rankings' },
    { key: 'players', label: 'Players' },
  ];

  return (
    <Screen>
      {/* The same strip the Team page is navigated by, at the same size: one
          control means one thing across the app, and a screen switcher that
          is bigger on one tab than on another is two controls. */}
      <Segmented options={screens} value={app.leagueView} onChange={app.setLeagueView} size="sm" />

      {app.leagueView === 'weeks' ? <Matchups app={app} m={m} /> : null}
      {app.leagueView === 'myteam' ? <MyTeam app={app} m={m} /> : null}

      {app.leagueView === 'rankings' ? (
        <>
          <Segmented
            options={measures}
            value={isPower ? 'power' : isFitMode ? 'rating' : 'strength'}
            onChange={v => pick(v, ahead)}
          />
          {/* Only a dynasty has a future to look at: a redraft roster two seasons
              out is not a thing anybody owns. And a power ranking has no horizon
              — it is the season that happened. */}
          {m.isDynasty && !isPower ? (
            <Segmented
              options={horizons}
              value={ahead ? 'ahead' : 'today'}
              onChange={v => pick(isFitMode ? 'rating' : 'strength', v === 'ahead')}
              size="sm"
            />
          ) : null}

          {isPower ? <PowerRankings app={app} m={m} /> : (
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
                  borderTop: i === 0 ? 'none' : 'var(--hairline) solid var(--color-divider)',
                  cursor: 'pointer',
                  background: t.isMe ? 'color-mix(in srgb, var(--color-accent) 9%, transparent)' : 'transparent',
                }}
              >
                <span style={{ width: 16, flex: 'none', color: dim(0.52), fontSize: 12 }}>{i + 1}</span>
                {t.avatar ? (
                  <img
                    src={t.avatar}
                    alt=""
                    style={{
                      width: 28, height: 28, borderRadius: 8, flex: 'none', objectFit: 'cover',
                      border: 'var(--hairline) solid var(--color-divider)',
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
                  <div style={{ fontSize: 10, color: dim(0.52), marginTop: 2 }}>
                    {/* The record leads: the table ranks rosters by what they are
                        worth, and the first thing anyone checks against that is
                        what the season has actually done to them. */}
                    {hasPlayed(t.record) ? t.record.label + ' · ' : ''}
                    {t.now <= 0
                      ? 'Draft not started'
                      : 'age ' + t.avgAge.toFixed(1) +
                        (t.worst ? ' · weak at ' + t.worst : '') +
                        (m.isDynasty ? ' · picks ' + num(t.pickCapital * 100) : '')}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <div style={{ fontSize: 12, color: dim(0.9), fontVariantNumeric: 'tabular-nums' }}>
                    {isFitMode
                      ? (t.now <= 0 ? '—' : Math.round(mode === 'fitFut' ? t.fitFut : t.fit))
                      : num((mode === 'future' ? t.future : t.now) * 100)}
                  </div>
                  {/* Across ten teams the order barely moves between measures, so a
                      change of place says little. What does have range is how many
                      Rating points a roster loses as it ages. */}
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
          )}
        </>
      ) : null}

      {app.leagueView === 'players' ? <TopPlayers app={app} m={m} /> : null}
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
  /* The Points lens only exists once somebody has played: a board of dashes
     ordered by nothing is worse than not offering it, so before kickoff the
     option is not there and anyone left on it falls back to the rating. */
  const played = m.allFits.some(x => app.seasonPpg(x.id));
  const lens = app.topLens === 'pts' && !played ? 'neutral' : app.topLens;

  const season = (x: PlayerFit) => app.seasonPpg(x.id);
  /* Sorted on a number, worn as text: points a game reads 18.4, not 18. */
  const rankBy = (x: PlayerFit) => (
    lens === 'me' ? x.fitMe
      : lens === 'fut' ? x.fit2
        : lens === 'pts' ? (season(x)?.ppg ?? -1)
          : x.fit);
  const valueOf = (x: PlayerFit) => (
    lens === 'pts' ? (season(x)?.ppg.toFixed(1) ?? '—') : String(rankBy(x)));

  const pool = m.allFits
    .filter(x => app.topPos === 'ALL' || x.pos === app.topPos)
    .slice()
    .sort((a, b) => rankBy(b) - rankBy(a));
  const list = pool.slice(0, TOP_N);

  const lensOptions: SegOption<'neutral' | 'pts' | 'me' | 'fut'>[] = [
    { key: 'neutral', label: 'Rating' },
    ...(played ? [{ key: 'pts' as const, label: 'Points' }] : []),
    { key: 'me', label: 'For you' },
    ...(m.isDynasty ? [{ key: 'fut' as const, label: 'In 2 yrs' }] : []),
  ];

  if (!m.allFits.length) return null;

  return (
    <Card>
      {/* No longer a disclosure. It used to share a screen with the team
          table, where a collapsed heading was how it kept out of the way;
          now it IS the screen, and a screen that opens shut is a screen you
          have to be told to tap. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div style={cardTitle}>Best in the league</div>
        <span style={{ fontSize: 12, color: dim(0.62), ...ellipsis }}>
          {pool.length > list.length ? 'top ' + list.length : 'all ' + list.length}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          <Segmented options={POS_OPTIONS} value={app.topPos} onChange={app.setTopPos} size="sm" />
          <Segmented options={lensOptions} value={lens} onChange={app.setTopLens} size="sm" />

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
                  borderTop: i === 0 ? 'none' : 'var(--hairline) solid var(--color-divider)',
                  cursor: 'pointer',
                  background: x.mine ? 'color-mix(in srgb, var(--color-accent) 9%, transparent)' : 'transparent',
                }}
              >
                <span style={{ width: 16, flex: 'none', color: dim(0.52), fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em', ...ellipsis }}>{x.name}</div>
                  <div style={{ fontSize: 10, color: dim(0.52), marginTop: 2, ...ellipsis }}>
                    {x.pos} · {x.team || 'FA'} ·{' '}
                    {lens === 'fut'
                      ? `${x.age ?? '?'}→${(x.age || 25) + 2} yrs`
                      : lens === 'pts'
                        ? `${season(x)?.games ?? 0} ${season(x)?.games === 1 ? 'game' : 'games'}`
                        : `${x.age ?? '?'} yrs`} ·{' '}
                    {x.mine ? 'yours' : x.owner}
                    {lens === 'fut'
                      ? ` · today ${x.fit}${x.fit2 - x.fit > 1 ? ' ↑' : x.fit - x.fit2 > 1 ? ' ↓' : ''}`
                      : ''}
                  </div>
                </div>
                <span style={{
                  fontSize: 12, flex: 'none', padding: '2px 8px', borderRadius: 4,
                  fontVariantNumeric: 'tabular-nums',
                  background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                  /* The Rating's colour scale means nothing applied to a price
                     or to points a game, so it is only worn where it is one. */
                  color: lens === 'me' ? fitColor(x.fitMe) : lens === 'fut' ? fitColor(x.fit2) : ACCENT,
                }}>
                  {valueOf(x)}
                </span>
              </div>
            ))}
        </div>
      </div>
    </Card>
  );
}

/* Fifteen was the length of a card that had to share a screen. This one is
   the screen, so the list runs the length of a hundred — and under a position
   chip it usually runs out first, which is why the heading says which of the
   two happened. */
const TOP_N = 100;

const POS_OPTIONS: SegOption<'ALL' | 'QB' | 'RB' | 'WR' | 'TE'>[] =
  [{ key: 'ALL', label: 'All' }, ...POS.map(p => ({ key: p, label: p }))];
