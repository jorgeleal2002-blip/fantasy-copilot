import { ACCENT, BAD, GOOD, METRIC_LABEL, MID, STRATS, StratKey } from '../model/constants';
import { clamp } from '../model/math';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { Bar, Card, Screen, Segmented, type SegOption } from '../ui/primitives';
import { cardNote, cardTitle, dim, ellipsis } from '../ui/styles';

const STRAT_OPTIONS: SegOption<StratKey>[] =
  (Object.keys(STRATS) as StratKey[]).map(k => ({ key: k, label: STRATS[k].label }));

export function SettingsTab({ app, m }: { app: App; m: Model }) {
  const strat = STRATS[app.strat];
  const sc = m.league.scoring_settings || {};
  const settings = m.league.settings || {};

  const rules = [
    { label: 'Reception', value: (sc.rec || 0) + ' pts' },
    { label: 'TE bonus', value: '+' + (sc.bonus_rec_te || 0) + ' per catch' },
    { label: 'Rushing first down', value: '+' + (sc.rush_fd || 0) },
    { label: 'Receiving first down', value: sc.rec_fd ? '+' + sc.rec_fd : 'no points' },
    { label: 'Pass TD / yard', value: (sc.pass_td || 4) + ' / ' + (sc.pass_yd || 0.04) },
    { label: 'Startable QBs', value: m.sflx ? '2 (superflex)' : '1' },
    { label: 'Taxi / keepers', value: (settings.taxi_slots || 0) + ' taxi · ' + (settings.max_keepers || 0) + ' keepers' },
    { label: 'Rookie draft', value: (settings.draft_rounds || 0) + ' rounds · FAAB ' + (settings.waiver_budget || 0) },
  ];

  return (
    <Screen>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 13,
        background: 'var(--color-surface)', borderRadius: 13, padding: 14,
      }}>
        <div style={{
          width: 46, height: 46, flex: 'none', borderRadius: '50%', overflow: 'hidden',
          border: '1px solid var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 600, color: 'var(--color-accent)',
        }}>
          {m.me.avatar
            ? <img src={m.me.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : m.me.initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em', ...ellipsis }}>{m.me.teamName}</div>
          <div style={{ fontSize: 12, color: dim(0.45), marginTop: 2, ...ellipsis }}>{m.league.name}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => void app.switchLeague()}
          className="btn btn-primary"
          style={{ flex: 1, borderRadius: 10, minHeight: 42 }}
        >
          Change league
        </button>
        <button
          type="button"
          onClick={app.logout}
          className="btn btn-secondary"
          style={{ flex: 1, borderRadius: 10, minHeight: 42 }}
        >
          Sign out
        </button>
      </div>

      <div>
        <div style={{
          fontSize: 10.5, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.4), marginBottom: 9,
        }}>
          Algorithm strategy
        </div>
        <Segmented options={STRAT_OPTIONS} value={app.strat} onChange={app.setStrat} />
        <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5), marginTop: 10, textWrap: 'pretty' }}>
          {strat.copy}
        </div>
      </div>

      <Card>
        <div style={{ ...cardTitle, marginBottom: 4 }}>Fit Score weights</div>
        <div style={{ fontSize: 11.5, color: dim(0.45), marginBottom: 12 }}>Fit = Σ wᵢ × metricᵢ</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {m.metricKeys.map(k => (
            <div key={k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                <span>{METRIC_LABEL[k]}</span>
                <span style={{ color: ACCENT }}>{Math.round(strat.w[k] * 100)}%</span>
              </div>
              {/* scaled against a 35% ceiling — the largest weight any strategy assigns */}
              <Bar pct={strat.w[k] * 100 / 0.35} color={ACCENT} height={5} />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div style={{ ...cardTitle, marginBottom: 2 }}>Your scoring changes value</div>
        <div style={{ ...cardNote, marginBottom: 12 }}>
          Positional premium derived from {m.league.name}'s real rules, not from a generic format
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {m.multInfo.map(mi => {
            const color = mi.mult >= 1.05 ? GOOD : mi.mult <= 0.9 ? BAD : MID;
            return (
              <div key={mi.pos}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 5,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', color: ACCENT }}>{mi.pos}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color }}>×{mi.mult.toFixed(2)}</span>
                </div>
                <Bar
                  pct={clamp(mi.mult / 1.4, 0.05, 1) * 100}
                  color={mi.mult >= 1.05 ? GOOD : mi.mult <= 0.9 ? BAD : ACCENT}
                  height={5}
                />
                <div style={{ ...cardNote, fontSize: 10.5, marginTop: 5 }}>{mi.why}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <div style={{ ...cardTitle, marginBottom: 10 }}>Rules read from your league</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }}>
              <span style={{ color: dim(0.5) }}>{r.label}</span>
              <span style={{ textAlign: 'right' }}>{r.value}</span>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ height: 8 }} />
    </Screen>
  );
}
