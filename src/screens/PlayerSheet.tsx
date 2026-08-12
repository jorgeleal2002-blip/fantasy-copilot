import { ACCENT, GOOD, METRIC_LABEL, PEAK, STRATS, type Weights } from '../model/constants';
import type { Metrics } from '../model/score';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
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
  use?: { snap: number | null; tgt: number | null; shareLabel: string; ppg: number | null; rzShare: number | null; tdPerGame: number | null; tdShare: number | null };
}

function resolve(m: Model, id: string, strat: Weights): Sheet | null {
  const mine = m.myPlayers.find(p => p.id === id);
  if (mine) {
    return {
      id, name: mine.name, pos: mine.pos, team: mine.team, age: mine.age, adp: mine.adp,
      fit: mine.fit, m: mine.m, weights: mine.wEff, owned: true, ownerLabel: 'yours', use: mine.use,
    };
  }
  const board = m.scored.find(p => p.id === id) || m.scoreAny(id);
  if (!board) return null;
  return {
    id, name: board.name, pos: board.pos, team: board.team || 'FA', age: board.age, adp: board.adp,
    fit: board.fit, m: board.m, weights: strat, owned: !!board.owned,
    ownerLabel: board.owned ? 'yours' : board.owner ? 'on ' + board.owner : 'free agent',
    use: board.use,
  };
}

export function PlayerSheet({ app, m, playerId }: { app: App; m: Model; playerId: string }) {
  const p = resolve(m, playerId, STRATS[app.strat].w);
  const usageYear = m.seasonNum - 1;

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

  const stats = [
    { label: `Snap % ${usageYear}`, value: u && u.snap != null ? Math.round(u.snap * 100) + '%' : 'no data' },
    { label: u?.shareLabel || 'Target share', value: u && u.tgt != null ? (u.tgt * 100).toFixed(1) + '%' : 'no data' },
    { label: 'Red-zone share', value: u && u.rzShare != null ? (u.rzShare * 100).toFixed(1) + '%' : 'no data' },
    {
      label: 'TDs per game',
      value: u && u.tdPerGame != null
        ? u.tdPerGame.toFixed(2) + (u.tdShare != null ? ` · ${Math.round(u.tdShare * 100)}% of the team` : '')
        : 'no data',
    },
    { label: `PPG ${usageYear}`, value: u && u.ppg != null ? u.ppg.toFixed(1) + ' pts' : 'no data' },
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
