import { ACCENT, BAD, GOOD, MID, PEAK, POS } from '../model/constants';
import { ageCurve, grade, num } from '../model/math';
import type { Model, RosterPlayer } from '../model/types';
import type { App, TeamView } from '../state/useApp';
import { ord, pct } from '../ui/format';
import { Bar, Card, CardHead, DividedRow, Screen, Segmented, type SegOption } from '../ui/primitives';
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
  const bestNow = Math.max(...m.leagueRows.map(x => x.now), 1);
  const bestFut = Math.max(...m.leagueRows.map(x => x.future), 1);
  const shift = me?.shift ?? 0;

  const usageBadge = app.usageState === 'ok'
    ? 'Real usage connected: snap %, target share and PPG'
    : app.usageState === 'loading' ? 'Loading snap % and target share…'
      : app.usageState === 'fail' ? 'No real usage: floor and explosiveness fall back to the model' : '';
  const usageColor = app.usageState === 'ok' ? GOOD : app.usageState === 'fail' ? BAD : MID;

  const oldest = m.myPlayers.filter(p => (p.age || 25) >= 28).length;
  const ages = m.myPlayers.filter(p => p.age);
  const weakest = (() => {
    if (!m.leagueHasRosters || !m.myPlayers.length || !me) return { value: '—', sub: 'draft not started' };
    const p = POS.slice().sort((a, b) => m.posRankOf(me.id, b) - m.posRankOf(me.id, a))[0];
    return { value: p + ' ' + ord(m.posRankOf(me.id, p)), sub: 'of ' + m.teamCount + ' teams' };
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
      value: m.myRound + '.' + String(m.myPickInRound).padStart(2, '0'),
      sub: m.myNextOverall ? 'overall ' + m.myNextOverall : 'to be set', color: ACCENT,
    },
    { label: 'Weakest position', value: weakest.value, sub: weakest.sub, color: BAD },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {usageBadge ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: usageColor }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: usageColor, flex: 'none' }} />
          {usageBadge}
        </div>
      ) : null}

      <div style={heroCard}>
        <div style={heroGlow} />
        <div style={{ position: 'relative' }}>
          <div style={kicker}>Your place in the league</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, marginTop: 9 }}>
            <div>
              <div style={{ fontSize: 29, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1 }}>
                {m.leagueHasRosters ? ord(me?.rankNow || 0) : '—'}
              </div>
              <div style={{ fontSize: 10.5, color: dim(0.5), marginTop: 4 }}>strength today</div>
              <div style={{ height: 6, width: 88, borderRadius: 4, background: 'rgba(233,233,237,.1)', marginTop: 6, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4, width: Math.round((me?.now || 0) / bestNow * 100) + '%',
                  background: `linear-gradient(90deg,#6f63bd,${ACCENT})`,
                }} />
              </div>
            </div>
            {m.isDynasty ? (
              <div>
                <div style={{ fontSize: 29, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1, color: GOOD }}>
                  {m.leagueHasRosters ? ord(me?.rankFut || 0) : '—'}
                </div>
                <div style={{ fontSize: 10.5, color: dim(0.5), marginTop: 4 }}>future value</div>
                <div style={{ height: 6, width: 88, borderRadius: 4, background: 'rgba(233,233,237,.1)', marginTop: 6, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4, width: Math.round((me?.future || 0) / bestFut * 100) + '%',
                    background: `linear-gradient(90deg,#3f4a86,${GOOD})`,
                  }} />
                </div>
              </div>
            ) : null}
          </div>
          {m.isDynasty ? (
            <div style={{ fontSize: 12, color: shift > 0 ? GOOD : shift < 0 ? BAD : dim(0.5), marginTop: 9 }}>
              {shift > 0 ? `You climb ${shift} place${shift === 1 ? '' : 's'} looking forward`
                : shift < 0 ? `You drop ${-shift} place${shift === -1 ? '' : 's'} looking forward`
                  : 'Same place today and in the future'}
            </div>
          ) : null}
        </div>
      </div>

      <Card>
        <div style={{ ...cardTitle, marginBottom: 2 }}>Rank by position</div>
        <div style={{ ...capsule, marginBottom: 9 }}>tap to filter your roster</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {POS.map(p => {
            const rows = m.leagueRows.slice().sort((a, b) => (b.posStrength[p] || 0) - (a.posStrength[p] || 0));
            const best = m.leagueHasRosters ? rows[0] : null;
            const mine = m.leagueHasRosters && me ? m.posRankOf(me.id, p) : 0;
            const color = mine && mine <= 3 ? GOOD : mine >= m.leagueRows.length - 2 ? BAD : MID;
            const width = Math.round((me?.posStrength[p] || 0) / Math.max(best?.posStrength[p] || 1, 0.01) * 100);
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
                <Bar pct={width} color={mine && mine <= 3 ? GOOD : mine >= m.leagueRows.length - 2 ? BAD : ACCENT} />
              </div>
            );
          })}
        </div>
      </Card>

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
        <div style={{ ...cardNote, marginBottom: 12 }}>Highest ceiling on the roster according to the upside model</div>
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
              <Bar pct={p.m.boom * 100} color={p.m.boom > 0.7 ? GOOD : ACCENT} />
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
                <Bar pct={Math.max(4, Math.round(m.posPct[p] * 100))} color={strong ? GOOD : weak ? BAD : ACCENT} />
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
