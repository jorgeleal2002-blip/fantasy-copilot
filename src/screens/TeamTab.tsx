import { ACCENT, BAD, GOOD, MID, PEAK, POS } from '../model/constants';
import { ageCurve, grade, num } from '../model/math';
import type { Model, RosterPlayer } from '../model/types';
import type { App, TeamView } from '../state/useApp';
import { ord, pct } from '../ui/format';
import { Meter, SERIES, markFor } from '../ui/charts';
import { Card, CardHead, DividedRow, Screen, Segmented, type SegOption } from '../ui/primitives';
import { capsule, cardNote, cardTitle, dim, ellipsis, heroCard, heroGlow, kicker, posBadge } from '../ui/styles';

const POS_FILTERS: SegOption<'ALL' | 'QB' | 'RB' | 'WR' | 'TE'>[] =
  [{ key: 'ALL', label: 'All' }, ...POS.map(p => ({ key: p, label: p }))];

export function TeamTab({ app, m }: { app: App; m: Model }) {
  const views: SegOption<TeamView>[] = [
    { key: 'resumen', label: 'Summary' },
    { key: 'lineup', label: 'Lineup' },
    { key: 'roster', label: 'Roster' },
    ...(m.isDynasty ? [{ key: 'activos' as TeamView, label: 'Assets' }] : []),
  ];
  const view = m.isDynasty || app.teamView !== 'activos' ? app.teamView : 'resumen';

  return (
    <Screen>
      <Segmented options={views} value={view} onChange={app.setTeamView} size="sm" />
      {view === 'resumen' && <Summary app={app} m={m} />}
      {view === 'lineup' && <Lineup app={app} m={m} />}
      {view === 'roster' && <Roster app={app} m={m} />}
      {view === 'activos' && <Assets app={app} m={m} />}
    </Screen>
  );
}

/* ── Summary ─────────────────────────────────────────────────────────────── */

function Summary({ app, m }: { app: App; m: Model }) {
  const me = m.leagueRows.find(x => x.isMe);
  const shift = me?.shift ?? 0;

  // Naming the seasons matters: the numbers below are a three-year blend, and
  // a reader who assumes they are last season's will misread every one of them.
  const usageBadge = app.usageState === 'ok'
    ? `Real usage connected (${app.usageSeasons || 'last season'}): snap %, ball share, yards per touch and expected TDs`
    : app.usageState === 'loading' ? 'Loading three seasons of usage…'
      : app.usageState === 'fail' ? 'No real usage: floor and explosiveness fall back to the model' : '';
  const usageColor = app.usageState === 'ok' ? GOOD : app.usageState === 'fail' ? BAD : MID;

  const drafted = m.draft?.status === 'complete' || m.picks.length >= m.rounds * m.teamCount;
  const oldest = m.myPlayers.filter(p => (p.age || 25) >= 28).length;
  const ages = m.myPlayers.filter(p => p.age);
  const weakest = (() => {
    if (!m.leagueHasRosters || !m.myPlayers.length || !me) return { value: '—', sub: 'draft not started' };
    // A position you cannot field at all beats any ranking. Every team with an
    // empty slot ties on strength there, so the ranking scattered them and
    // named a different position weakest while the lineup sat with nobody
    // eligible at this one.
    const hole = POS.find(p => (m.slots[p] || 0) > 0 && !(m.have[p] || 0));
    if (hole) return { value: hole, sub: 'nobody on the roster' };
    const p = POS.slice().sort((a, b) => m.posRankOf(me.id, b) - m.posRankOf(me.id, a))[0];
    return { value: p + ' ' + ord(m.posRankOf(me.id, p)), sub: 'of ' + m.teamCount + ' teams' };
  })();

  // Raw sums are shown at scale; the Fit columns are already 0..100.
  const heroRanks = [
    { label: 'strength today', rank: me?.rankNow || 0, value: num((me?.now || 0) * 100), color: ACCENT },
    { label: 'quality today', rank: me?.rankFit || 0, value: 'Fit ' + Math.round(me?.fit || 0), color: MID },
    ...(m.isDynasty ? [
      { label: 'future value', rank: me?.rankFut || 0, value: num((me?.future || 0) * 100), color: GOOD },
      { label: 'quality in 2 yrs', rank: me?.rankFitFut || 0, value: 'Fit ' + Math.round(me?.fitFut || 0), color: '#bfe0cd' },
    ] : []),
  ];

  // The interesting sentence is not the movement, it is the disagreement:
  // hoarding lifts future value without lifting the starters it will field.
  const heroNote = (() => {
    if (!me) return '';
    const gap = me.rankFut - me.rankFitFut;
    const move = shift > 0 ? `You climb ${shift} place${shift === 1 ? '' : 's'} looking forward.`
      : shift < 0 ? `You drop ${-shift} place${shift === -1 ? '' : 's'} looking forward.`
        : 'Same place today and in the future.';
    if (gap <= -3) {
      return move + ' But that is accumulation: you sit ' + ord(me.rankFut) + ' in future value and only ' +
        ord(me.rankFitFut) + ' in quality two years out. Depth and picks count there; your starters do not yet.';
    }
    if (gap >= 3) {
      return move + ' Your starters age better than your pile of assets suggests — ' +
        ord(me.rankFitFut) + ' in quality against ' + ord(me.rankFut) + ' in raw future value.';
    }
    return move;
  })();

  const stats = [
    { label: 'Players', value: String(m.myPlayers.length), sub: POS.map(p => m.have[p] + ' ' + p).join(' · '), color: 'var(--color-text)' },
    {
      label: 'Average age',
      value: ages.length ? (ages.reduce((x, y) => x + (y.age || 0), 0) / ages.length).toFixed(1) : '—',
      sub: oldest + ' aged 28+', color: 'var(--color-text)',
    },
    {
      label: 'Next pick',
      // Two ways there is no pick to name, and neither should print one. The
      // fallback used to show whatever round the draft was sitting on — a real
      // -looking slot in a league that had not drafted, and an already-used one
      // in a league that had finished.
      value: drafted || !m.myNextOverall
        ? '—'
        : m.myRound + '.' + String(m.myPickInRound).padStart(2, '0'),
      sub: drafted ? 'draft complete'
        : m.myNextOverall ? 'overall ' + m.myNextOverall : 'draft order not set',
      color: ACCENT,
    },
    { label: 'Weakest position', value: weakest.value, sub: weakest.sub, color: BAD },
  ];

  // Every number on this page is derived from players you own. With none, the
  // page is a grid of dashes and zeros that reads like a failure to load —
  // which is exactly what a redraft league looks like for the weeks before it
  // drafts. Say so instead, and point at the screen that can do something.
  const empty = !m.myPlayers.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {usageBadge ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: usageColor }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: usageColor, flex: 'none' }} />
          {usageBadge}
        </div>
      ) : null}

      {empty ? (
        <div style={heroCard}>
          <div style={heroGlow} />
          <div style={{ position: 'relative' }}>
            <div style={kicker}>Nothing on your roster yet</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: dim(0.62), marginTop: 9, textWrap: 'pretty' }}>
              {m.draft?.status === 'drafting'
                ? 'The draft is running and none of your picks have landed. Strength, holes and lineup quality all come from players you own, so they stay empty until one does.'
                : 'This league has not drafted. Strength, holes and lineup quality are all measured off players you own, so there is nothing to rank until the picks are in.'}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.45), marginTop: 8, textWrap: 'pretty' }}>
              The board is already rated and ready — every available player carries a Fit
              score for the roster you are about to build.
            </div>
            <button
              type="button"
              onClick={() => app.setTab('draft')}
              className="btn btn-primary"
              style={{ marginTop: 14, borderRadius: 9, padding: '9px 14px' }}
            >
              Open the draft board
            </button>
          </div>
        </div>
      ) : null}

      {/* Four places, not one. "Future value" is a raw sum — the whole roster
          aged two years plus pick capital — so it rewards hoarding: a deep
          bench and a pile of picks can put you first while your starters are
          mid-table. The quality columns beside it measure only the optimal
          starters, which is the honest read. Shown together, the gap between
          them is itself the information. */}
      {empty ? null : <div style={heroCard}>
        <div style={heroGlow} />
        <div style={{ position: 'relative' }}>
          <div style={kicker}>Your place in the league</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginTop: 10 }}>
            {heroRanks.map(h => (
              <div key={h.label}>
                <div style={{
                  fontSize: 26, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                  color: m.leagueHasRosters && me ? h.color : dim(0.3),
                }}>
                  {m.leagueHasRosters && me ? ord(h.rank) : '—'}
                </div>
                <div style={{ fontSize: 10.5, color: dim(0.5), marginTop: 3 }}>{h.label}</div>
                <div style={{ fontSize: 10.5, color: dim(0.35), marginTop: 1 }}>{h.value}</div>
              </div>
            ))}
          </div>
          {m.isDynasty && m.leagueHasRosters ? (
            <div style={{ fontSize: 11.5, lineHeight: 1.45, color: dim(0.5), marginTop: 11, textWrap: 'pretty' }}>
              {heroNote}
            </div>
          ) : null}
        </div>
      </div>}

      {/* A ranking of nothing against nine other teams is four empty bars. */}
      {empty ? null : <Card>
        <div style={{ ...cardTitle, marginBottom: 2 }}>Rank by position</div>
        <div style={{ ...capsule, marginBottom: 9 }}>tap to filter your roster</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {POS.map(p => {
            const rows = m.leagueRows.slice().sort((a, b) => (b.posStrength[p] || 0) - (a.posStrength[p] || 0));
            const best = m.leagueHasRosters ? rows[0] : null;
            const mine = m.leagueHasRosters && me ? m.posRankOf(me.id, p) : 0;
            const color = mine && mine <= 3 ? GOOD : mine >= m.leagueRows.length - 2 ? BAD : MID;
            const top = Math.max(best?.posStrength[p] || 0, 0.01);
            const width = Math.round((me?.posStrength[p] || 0) / top * 100);
            // The bar alone cannot separate leading by a mile from leading by
            // nothing — everyone who leads draws a full one. The league average
            // sitting on it is what tells the two apart.
            const avg = rows.reduce((a, r) => a + (r.posStrength[p] || 0), 0) / Math.max(rows.length, 1);
            return (
              <div
                key={p}
                role="button"
                tabIndex={0}
                onClick={() => { app.setRosterFilter(p); app.setTeamView('roster'); }}
                onKeyDown={e => { if (e.key === 'Enter') { app.setRosterFilter(p); app.setTeamView('roster'); } }}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', color: ACCENT }}>{p}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color }}>{mine ? ord(mine) : '—'}</span>
                  </div>
                  <span style={{ fontSize: 10.5, color: dim(0.38) }}>best: {best ? best.name : 'not drafted'}</span>
                </div>
                <Meter
                  pct={width}
                  color={markFor(mine && mine <= 3 ? 'good' : mine >= m.leagueRows.length - 2 ? 'bad' : 'mid')}
                  mark={(avg / top) * 100}
                  markLabel="league average"
                />
              </div>
            );
          })}
        </div>
      </Card>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: 'var(--color-surface)', borderRadius: 12, padding: 13 }}>
            <div style={{ fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.42) }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.03em', marginTop: 4, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: dim(0.42), marginTop: 3 }}>{s.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Lineup ──────────────────────────────────────────────────────────────── */

function Lineup({ app, m }: { app: App; m: Model }) {
  // The reference every explosiveness meter is read against.
  const boomAvg = m.myPlayers.length
    ? m.myPlayers.reduce((a, b) => a + b.m.boom, 0) / m.myPlayers.length
    : 0.5;
  const swapNames = m.swaps.map(o => o.player!.name).join(', ');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        <CardHead
          title="Optimal lineup"
          right={
            <div style={{ fontSize: 11, color: m.swaps.length === 0 ? GOOD : ACCENT }}>
              {m.swaps.length === 1 ? '1 change' : m.swaps.length + ' changes'}
            </div>
          }
        />
        <div style={{ ...cardNote, marginBottom: 8 }}>
          {m.swaps.length === 0
            ? 'Your current Sleeper lineup already is the optimal one according to the model.'
            : `${m.swaps.length === 1 ? '1 change' : m.swaps.length + ' changes'} against what you have set in Sleeper: ${swapNames}.`}
        </div>
        {m.optimal.map((o, i) => (
          <DividedRow
            key={o.slot + i}
            first={i === 0}
            onClick={o.player ? () => app.setDetail(o.player!.id) : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 11 }}
          >
            <div style={{
              width: 40, flex: 'none', fontSize: 10, fontWeight: 600, letterSpacing: '.05em',
              color: o.slot.indexOf('FLEX') >= 0 ? MID : ACCENT,
            }}>
              {o.slot === 'SUPER_FLEX' ? 'SFLX' : o.slot === 'REC_FLEX' ? 'RFLX' : o.slot}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: '-0.01em', ...ellipsis }}>
                {o.player ? o.player.name : 'empty'}
              </div>
              <div style={{ fontSize: 11, color: dim(0.42), marginTop: 2 }}>
                {o.player ? `${o.player.pos} · ${o.player.team} · ${o.player.age ?? '?'} yrs` : 'nobody eligible'}
              </div>
            </div>
            <div style={{
              fontSize: 12.5, fontWeight: 500, flex: 'none',
              color: o.player && o.player.fit >= 72 ? GOOD : o.player && o.player.fit >= 55 ? MID : dim(0.5),
            }}>
              {o.player ? grade(o.player.fit / 100) : '—'}
            </div>
          </DividedRow>
        ))}
      </Card>

      <Card>
        <div style={{ ...cardTitle, marginBottom: 2 }}>Your explosive players</div>
        <div style={{ ...cardNote, marginBottom: 12 }}>
          Highest ceiling on the roster according to the upside model. The line on each meter is
          your roster&apos;s own average, so a long bar means long <em>for you</em>.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {m.explosive.map(p => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => app.setDetail(p.id)}
              onKeyDown={e => { if (e.key === 'Enter') app.setDetail(p.id); }}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{p.name}</span>
                <span style={{ fontSize: 11, color: dim(0.45) }}>{Math.round(p.m.boom * 100)} boom</span>
              </div>
              <Meter
                pct={p.m.boom * 100}
                color={SERIES}
                mark={boomAvg * 100}
                markLabel="your roster average"
              />
              <div style={{ fontSize: 10.5, color: dim(0.38), marginTop: 4 }}>
                {p.pos} · {p.age ?? '?'} yrs · {p.team}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ── Roster ──────────────────────────────────────────────────────────────── */

function rosterMeta(p: RosterPlayer): string {
  return [
    p.pos, p.team || 'FA', (p.age ?? '?') + ' yrs',
    p.starter ? 'starter' : null,
    p.injury || null,
    p.use && p.use.snap != null ? Math.round(p.use.snap * 100) + '% snaps' : null,
    p.raw.active === false ? 'inactive' : null,
  ].filter(Boolean).join(' · ');
}

function Roster({ app, m }: { app: App; m: Model }) {
  const maxQ = Math.max(...m.myPlayers.map(x => x.q), 1);
  const list = m.myPlayers
    .filter(p => app.rosterFilter === 'ALL' || p.pos === app.rosterFilter)
    .slice()
    .sort((a, b) => {
      if (app.rosterSort === 'age') return (a.age || 99) - (b.age || 99);
      if (app.rosterSort === 'snap') return ((b.use?.snap) || 0) - ((a.use?.snap) || 0);
      return b.q - a.q;
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 2 }}>
        <div style={cardTitle}>Your roster ({m.myPlayers.length})</div>
        <div style={{ fontSize: 10.5, color: dim(0.38) }}>accent = optimal starter</div>
      </div>
      <Segmented options={POS_FILTERS} value={app.rosterFilter} onChange={app.setRosterFilter} />
      <Segmented
        options={[{ key: 'value', label: 'Value' }, { key: 'age', label: 'Age' }, { key: 'snap', label: 'Usage' }]}
        value={app.rosterSort}
        onChange={app.setRosterSort}
      />

      {m.myPlayers.length === 0 ? (
        <div style={{ background: 'var(--color-surface)', borderRadius: 12, padding: '24px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 6 }}>You haven't drafted yet</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: dim(0.5) }}>
            As soon as the draft starts, every pick of yours lands here and the Fit Score recomputes against your real holes.
          </div>
        </div>
      ) : null}

      {list.map(p => (
        <div
          key={p.id}
          className="row-tap"
          role="button"
          tabIndex={0}
          onClick={() => app.setDetail(p.id)}
          onKeyDown={e => { if (e.key === 'Enter') app.setDetail(p.id); }}
          style={{ background: 'var(--color-surface)', borderRadius: 11, padding: '11px 12px', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={posBadge(app.photoFor(p.id))}>{p.pos}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', flex: 'none',
                  background: m.optIds.indexOf(p.id) >= 0 ? ACCENT : 'transparent',
                }} />
                <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em', ...ellipsis }}>{p.name}</span>
              </div>
              <div style={{ fontSize: 11.5, color: dim(0.45), marginTop: 2 }}>{rosterMeta(p)}</div>
            </div>
            <div style={{ fontSize: 12, color: dim(0.5), flex: 'none' }}>{grade(p.fit / 100)}</div>
          </div>
          <div style={{ height: 4, borderRadius: 3, background: 'rgba(233,233,237,.07)', marginTop: 9, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3, width: Math.round(p.q / maxQ * 100) + '%',
              background: m.optIds.indexOf(p.id) >= 0 ? ACCENT : 'rgba(145,132,217,.35)',
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Assets ──────────────────────────────────────────────────────────────── */

function Assets({ app, m }: { app: App; m: Model }) {
  const corr = [
    ...m.stacks.map(x => ({ ...x, mark: '+', color: GOOD })),
    ...m.conflicts.map(x => ({ ...x, mark: '−', color: BAD })),
    ...m.concentration.map(x => ({ ...x, mark: '!', color: MID })),
  ];
  const pickTotal = m.pickAssets.reduce((a, b) => a + b.q, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {m.pickAssets.length ? (
        <Card>
          <CardHead
            title="Your rookie picks"
            right={<div style={{ fontSize: 12, color: ACCENT }}>{num(pickTotal * 100)}</div>}
          />
          <div style={{ ...capsule, marginBottom: 8 }}>{m.pickAssets.length} picks · market value</div>
          {m.pickAssets.slice().sort((a, b) => a.season - b.season || a.round - b.round).map(p => (
            <DividedRow key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 38, flex: 'none', fontSize: 11, fontWeight: 600, letterSpacing: '.02em',
                color: p.season === m.seasonNum ? ACCENT : dim(0.35),
              }}>
                {p.season}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{p.label}</div>
                <div style={{ fontSize: 11, color: dim(0.42), marginTop: 2 }}>{p.origin}</div>
              </div>
              <div style={{ fontSize: 12, color: dim(0.55), flex: 'none' }}>{num(p.q * 100)}</div>
            </DividedRow>
          ))}
        </Card>
      ) : null}

      {corr.length ? (
        <Card>
          <div style={{ ...cardTitle, marginBottom: 2 }}>NFL team correlation</div>
          <div style={{ ...cardNote, marginBottom: 10 }}>
            Sharing an offence with your QB adds; sharing the ball with your own player subtracts
          </div>
          {corr.map((c, i) => (
            <DividedRow key={c.team + i} style={{ display: 'flex', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: c.color, width: 12, flex: 'none' }}>{c.mark}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>{c.team} · {c.text}</div>
                <div style={{ ...cardNote, marginTop: 2 }}>{c.why}</div>
              </div>
            </DividedRow>
          ))}
        </Card>
      ) : null}

      {m.fading.length ? (
        <Card>
          <div style={{ ...cardTitle, marginBottom: 2 }}>Sell window</div>
          <div style={{ ...cardNote, marginBottom: 10 }}>Past their age peak: worth more today than they will be in March</div>
          {m.fading.map(p => (
            <DividedRow
              key={p.id}
              onClick={() => app.setDetail(p.id)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0' }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: dim(0.42), marginTop: 2 }}>
                  {p.pos} · {p.age} yrs · past peak ({PEAK[p.pos]})
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: BAD, flex: 'none' }}>{decayTag(p)}</div>
            </DividedRow>
          ))}
        </Card>
      ) : null}

      {m.buried.length ? (
        <Card>
          <div style={{ ...cardTitle, marginBottom: 2 }}>Bench value: {pct(m.benchQ / m.totalQ)}</div>
          <div style={{ ...cardNote, marginBottom: 10 }}>
            Quality that never reaches your optimal lineup — your raw material for trades
          </div>
          {m.buried.map(p => (
            <DividedRow key={p.id} onClick={() => app.setDetail(p.id)} style={{ padding: '8px 0' }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: dim(0.42), marginTop: 2 }}>
                {p.pos} · {p.age ?? '?'} yrs · does not make your optimal lineup
              </div>
            </DividedRow>
          ))}
        </Card>
      ) : null}

      <Card>
        <div style={{ ...cardTitle, marginBottom: 2 }}>Relative strength by position</div>
        <div style={{ ...cardNote, marginBottom: 12 }}>
          The quality of your starters against the same slots on every other roster
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {POS.map(p => {
            const rank = m.posRank[p];
            const strong = rank <= Math.ceil(m.teamCount / 3);
            const weak = rank > Math.ceil(m.teamCount * 2 / 3);
            return (
              <div key={p}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', color: ACCENT }}>{p}</span>
                    <span style={{ fontSize: 12, color: dim(0.55) }}>
                      {m.have[p]} on roster · comparing your best {m.slots[p]}
                    </span>
                  </div>
                  <span style={{ fontSize: 11.5, color: strong ? GOOD : weak ? BAD : MID }}>
                    {ord(rank)} of {m.teamCount}
                  </span>
                </div>
                <Meter
                  pct={Math.max(4, Math.round(m.posPct[p] * 100))}
                  color={markFor(strong ? 'good' : weak ? 'bad' : 'mid')}
                  mark={50}
                  markLabel="middle of the league"
                />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/** How much of a fading player's value the age curve takes away by 2028. */
function decayTag(p: RosterPlayer): string {
  const cur = Math.max(ageCurve(p.pos, p.age), 0.01);
  const two = ageCurve(p.pos, (p.age || 25) + 2);
  return Math.round((1 - two / cur) * 100) + '% in 2 years';
}
