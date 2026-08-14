import { ACCENT, GOOD, METRIC_LABEL, PEAK, type Weights } from '../model/constants';
import { num } from '../model/math';
import type { Metrics } from '../model/score';
import type { SleeperPlayer } from '../api/types';
import type { Model, TargetTrade } from '../model/types';
import type { Usage } from '../model/usage';
import type { App } from '../state/useApp';
import { ord } from '../ui/format';
import { Bar, Card, Overlay } from '../ui/primitives';
import { dim, fitColor } from '../ui/styles';

const DATA_NOTE =
  'Live from Sleeper: league, managers, draft order, picks and the NFL catalog (position, age, team, experience, internal ADP). ' +
  'Market values come from FantasyCalc, priced for this league\'s format. The Fit Score, floor and upside are the app\'s own model on top of those.';

interface Sheet {
  id: string;
  name: string;
  pos: string;
  team: string;
  age: number | null | undefined;
  adp: number | null | undefined;
  fit: number;
  m: Metrics;
  weights: Weights;
  owned: boolean;
  ownerLabel: string;
  raw: SleeperPlayer;
  use?: Usage;
}

function resolve(m: Model, id: string, strat: Weights): Sheet | null {
  const mine = m.myPlayers.find(p => p.id === id);
  if (mine) {
    return {
      id, name: mine.name, pos: mine.pos, team: mine.team, age: mine.age, adp: mine.adp,
      fit: mine.fit, m: mine.m, weights: mine.wEff, owned: true, ownerLabel: 'yours',
      raw: mine.raw, use: mine.use,
    };
  }
  const board = m.scored.find(p => p.id === id) || m.scoreAny(id);
  if (!board) return null;
  return {
    id, name: board.name, pos: board.pos, team: board.team || 'FA', age: board.age, adp: board.adp,
    fit: board.fit, m: board.m, weights: strat, owned: !!board.owned,
    ownerLabel: board.owned ? 'yours' : board.owner ? 'on ' + board.owner : 'free agent',
    raw: board.raw, use: board.use,
  };
}

export function PlayerSheet({ app, m, playerId }: { app: App; m: Model; playerId: string }) {
  const p = resolve(m, playerId, m.wUsed);

  if (!p) {
    return (
      <Overlay onClose={() => app.setDetail(null)}>
        <div style={{ fontSize: 14, color: dim(0.6) }}>No data for this player.</div>
      </Overlay>
    );
  }

  const photo = app.photoFor(p.id);
  const custom = !!app.photos[p.id];
  const u = p.use;

  const fin = Number.isFinite;
  const diverge = m.qDiverge(p.raw, p.id);

  const val = m.marketValue(p.id);

  const stats = [
    {
      // The first thing anyone wants before proposing a trade: the price, and
      // whether that price is the market's or the model's stand-in for it.
      label: val && !val.real ? 'Value (modelled)' : 'Market value',
      value: val
        ? num(val.pts) + (val.posRank ? ' · ' + val.pos + val.posRank + ' at his position' : '')
        : 'no data',
    },
    {
      label: 'Availability',
      value: (() => {
        const status = String(p.raw.status || '');
        const inj = String(p.raw.injury_status || '');
        const dco = Number(p.raw.depth_chart_order);
        const role = fin(dco) ? (dco === 1 ? 'starter on his depth chart' : ord(dco) + ' on his depth chart') : null;
        const state = inj || (status && status.toLowerCase() !== 'active' ? status : 'healthy');
        return state + (role ? ' · ' + role : '');
      })(),
    },
    {
      label: 'Seasons measured',
      value: u && u.seasons
        ? (u.seasons === 1
          ? '1 · ' + u.seasonList + ' (small sample)'
          : u.seasons + ' · ' + u.seasonList + (u.fade != null && u.fade < 0.9 ? ' · past his peak: recency weighted' : ''))
        : 'no data',
    },
    { label: 'Snap %', value: u && u.snap != null ? Math.round(u.snap * 100) + '%' : 'no data' },
    {
      label: u?.shareLabel || 'Target share',
      value: u && u.shareText
        ? u.shareText + (fin(u.volPct) ? ' · ' + Math.round((u.volPct as number) * 100) + 'th pct' : '')
        : 'no data',
    },
    {
      label: 'Market vs production',
      value: (() => {
        if (!diverge) return 'no data';
        const d = Math.round((diverge.mkt - diverge.prod) * 100);
        const base = 'market ' + Math.round(diverge.mkt * 100) + ' · production ' + Math.round(diverge.prod * 100);
        return base + (Math.abs(d) < 12 ? ' · agreed' : d > 0 ? ' · market overpays' : ' · produces more than he costs');
      })(),
    },
    {
      label: u?.effLabel || 'Yards per touch',
      value: u && fin(u.eff)
        ? (u.eff as number).toFixed(1) + (fin(u.effPct) ? ' · ' + Math.round((u.effPct as number) * 100) + 'th pct' : '')
        : 'no data',
    },
    {
      label: 'Long TDs',
      value: u && fin(u.longTd)
        ? (u.longTd as number).toFixed(1) + ' of ' + Math.round((u.xtd || 0) + (u.tdLuck || 0)) +
          (fin(u.ltrPct) ? ' · ' + Math.round((u.ltrPct as number) * 100) + 'th pct' : '')
        : 'no data',
    },
    { label: 'Red-zone share', value: u && u.rzShare != null ? (u.rzShare * 100).toFixed(1) + '%' : 'no data' },
    {
      label: 'TDs per game',
      value: u && u.tdPerGame != null
        ? u.tdPerGame.toFixed(2) + (u.tdShare != null ? ` · ${Math.round(u.tdShare * 100)}% of the team` : '')
        : 'no data',
    },
    {
      label: 'Expected TDs',
      value: u && u.xtd != null
        ? u.xtd.toFixed(1) + ' expected vs ' + Math.round(u.xtd + (u.tdLuck || 0)) + ' scored' +
          (Math.abs(u.tdLuck || 0) < 1.5 ? ' · in line' : (u.tdLuck || 0) > 0 ? ' · scored above it' : ' · scored below it')
        : 'no data',
    },
    { label: 'PPG', value: u && u.ppg != null ? u.ppg.toFixed(1) + ' pts' : 'no data' },
    { label: 'Age · ADP', value: (p.age ?? '?') + ' · #' + (p.adp || '—') },
  ];

  return (
    <Overlay onClose={() => app.setDetail(null)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <label style={{ position: 'relative', cursor: 'pointer', flex: 'none' }}>
          <div
            style={photo
              ? {
                width: 64, height: 64, flex: 'none', borderRadius: 14,
                background: `rgba(145,132,217,.12) url(${photo}) center/cover no-repeat`,
                border: '1px solid var(--color-divider)',
              }
              : {
                width: 64, height: 64, flex: 'none', borderRadius: 14,
                background: 'rgba(145,132,217,.12)', border: '1px solid var(--color-divider)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: ACCENT, fontSize: 13, fontWeight: 600,
              }}
          >
            {photo ? '' : p.pos}
          </div>
          <div style={{
            position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, borderRadius: '50%',
            background: 'var(--color-bg)', border: '1px solid var(--color-accent)', color: 'var(--color-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
          }}>
            ✎
          </div>
          <input
            type="file"
            accept="image/*"
            onChange={e => {
              const f = e.target.files && e.target.files[0];
              if (f) app.setPhoto(p.id, f);
              e.target.value = '';
            }}
            style={{ display: 'none' }}
          />
        </label>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 25, fontWeight: 500, letterSpacing: '-0.025em' }}>{p.name}</div>
          <div style={{ fontSize: 12.5, color: dim(0.5), marginTop: 4 }}>
            {p.pos} · {p.team} · {p.age ?? '?'} yrs · {p.ownerLabel}
          </div>
          {custom ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => app.clearPhoto(p.id)}
              style={{ fontSize: 11, marginTop: 6, padding: 0 }}
            >
              Restore original photo
            </button>
          ) : null}
        </div>

        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em', color: fitColor(p.fit) }}>{p.fit}</div>
          <div style={{ fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.45) }}>
            fit score
          </div>
        </div>
      </div>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, color: dim(0.45), marginBottom: 12 }}>Breakdown — metric × weight</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {m.metricKeys.filter(k => p.weights[k] > 0).map(k => (
            <div key={k}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 5,
              }}>
                <span style={{ fontSize: 12.5 }}>{METRIC_LABEL[k]}</span>
                <span style={{ fontSize: 11.5, color: dim(0.45) }}>
                  {Math.round(p.m[k] * 100)} × {Math.round(p.weights[k] * 100)}% = {Math.round(p.m[k] * p.weights[k] * 100)}
                </span>
              </div>
              <Bar
                pct={p.m[k] * 100}
                color={p.m[k] > 0.7 ? GOOD : p.m[k] > 0.45 ? ACCENT : 'rgba(145,132,217,.35)'}
              />
            </div>
          ))}
        </div>
      </Card>

      <div style={{
        border: '1px solid rgba(145,132,217,.4)', borderRadius: 12, padding: '14px 13px', marginTop: 12,
        background: 'rgba(145,132,217,.06)',
      }}>
        <div style={{
          fontSize: 10, letterSpacing: '.11em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 8,
        }}>
          Read
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5, textWrap: 'pretty' }}>{verdict(p)}</div>
      </div>

      <WhatHeCosts app={app} m={m} sheet={p} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: 'var(--color-surface)', borderRadius: 11, padding: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.42) }}>
              {s.label}
            </div>
            <div style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.02em', marginTop: 5 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(0.33), marginTop: 14, textWrap: 'pretty' }}>{DATA_NOTE}</div>
    </Overlay>
  );
}

/**
 * You have decided you want him. Now: what would it take?
 *
 * The Trades tab answers the opposite question — it starts from your spare
 * parts and finds anything worth doing. This starts from one name, so it is
 * allowed to cost you a starter, and it says so rather than quietly excluding
 * every package that would.
 */
function WhatHeCosts({ app, m, sheet }: { app: App; m: Model; sheet: Sheet }) {
  if (sheet.owned) return null;
  const deals = m.offersFor(sheet.id);

  // A free agent has no owner to negotiate with — that is a waiver claim.
  if (!deals.length && sheet.ownerLabel === 'free agent') {
    return (
      <Card style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 5 }}>Nobody to trade with</div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5) }}>
          He is a free agent. Add him from the Draft tab's free-agent board — no trade needed.
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>What he would cost</div>
        <div style={{ fontSize: 11, color: dim(0.42) }}>{sheet.ownerLabel}</div>
      </div>

      {!deals.length ? (
        <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5), marginTop: 8 }}>
          Nothing you own gets there at a price his manager would take. Either he is worth more than
          any package you can build, or his team is short at exactly his position.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
          {deals.map((t, i) => (
            <div key={t.give.map(g => g.id).join('+')} style={{
              paddingTop: 11, marginTop: i === 0 ? 0 : 0,
              borderTop: i === 0 ? 'none' : '1px solid var(--color-divider)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.4) }}>
                    You send
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: '-0.01em', marginTop: 3 }}>
                    {t.give.map(g => g.name).join(' + ')}
                  </div>
                </div>
                <div style={{ flex: 'none', textAlign: 'right' }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: t.accept >= 70 ? GOOD : t.accept >= 50 ? ACCENT : dim(0.6) }}>
                    {t.accept}
                  </div>
                  <div style={{ fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: dim(0.38) }}>
                    they accept
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 11.5, color: dim(0.45), marginTop: 5, lineHeight: 1.5 }}>
                {t.give.map(g => (g.isPick ? g.label : g.pos + ' · ' + (g.age ?? '?') + ' yrs')).join(' · ')}
                {' · '}{num(t.cost * 100)} vs his {num(t.target.q * 100)}
              </div>

              <div style={{ fontSize: 11.5, marginTop: 5, lineHeight: 1.5, color: dim(0.6) }}>
                {priceRead(t)}
              </div>

              {t.give.filter(g => !g.isPick).map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => app.setDetail(g.id)}
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '4px 0', marginRight: 12 }}
                >
                  Open {g.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** One line saying what the package really is: a discount, a fair swap or a reach. */
function priceRead(t: TargetTrade): string {
  const pct = Math.round(Math.abs(t.edge) * 100);
  const price = t.edge > 0.04 ? `You buy ${pct}% under market`
    : t.edge < -0.04 ? `You overpay by ${pct}%`
      : 'Roughly market price';
  const lineup = t.myGain > 0.3 ? `your lineup rises ${t.myGain.toFixed(1)}`
    : t.myGain < -0.3 ? `costs you ${Math.abs(t.myGain).toFixed(1)} of starter value`
      : 'your lineup barely moves';
  const why = t.fillsTheirNeed ? ' — and it fills the hole they actually have'
    : t.theirGain > 0.3 ? ` — their lineup rises ${t.theirGain.toFixed(1)}`
      : '';
  return `${price}, ${lineup}${why}.`;
}

/** For a player you own the question is hold or sell; for anyone else it is buy. */
function verdict(p: Sheet): string {
  const peak = PEAK[p.pos as keyof typeof PEAK] || 26;
  if (p.owned) {
    if ((p.age || 0) > peak + 1) {
      return `Already yours and past his peak (${p.age}): your best sell candidate while the league still pays for him.`;
    }
    if (p.m.age > 0.9) return 'Already yours and still short of his peak. Hold — the model projects him upward.';
    return 'Already yours, inside his maximum-value window. No rush to buy or sell.';
  }
  if (p.m.need > 0.6 && p.m.value > 0.55) {
    return 'Clean fit: he fills your most expensive hole and falls below his ADP at this pick.';
  }
  if (p.m.need > 0.6) return 'Fills your most urgent need, though you would be taking him near his market price.';
  if (p.m.value > 0.65) return 'The best value on the board, not your need. Take him if you believe in best-player-available.';
  return 'A reasonable option without being the best: it neither solves a hole nor gives you a discount on his ADP.';
}
