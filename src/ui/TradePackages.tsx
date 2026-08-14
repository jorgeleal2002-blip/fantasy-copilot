import { ACCENT, GOOD } from '../model/constants';
import { num } from '../model/math';
import type { Model, SavedTrade, TargetTrade } from '../model/types';
import type { App } from '../state/useApp';
import { dim } from './styles';

/** Stable across rebuilds of the model, so a saved package is recognisable later. */
export const targetKey = (t: TargetTrade, targetId: string) =>
  'target|' + targetId + '|' + t.give.map(g => g.id).sort().join(',');

export function savedFromTarget(
  t: TargetTrade, targetId: string, targetName: string,
): Omit<SavedTrade, 'leagueId' | 'savedAt'> {
  return {
    key: targetKey(t, targetId),
    partner: t.partner,
    giveIds: t.give.map(g => g.id),
    getIds: [targetId],
    giveText: t.give.map(g => g.name).join(' + '),
    getText: targetName,
    kind: 'target',
    note: priceRead(t),
    score: t.accept,
  };
}

/** One line saying what the package really is: a discount, a fair swap or a reach. */
export function priceRead(t: TargetTrade): string {
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

/**
 * The packages that would buy one specific player, each with the button that
 * puts it on your shortlist. Shared by the player sheet and the search results,
 * so a trade you found by looking someone up is the same object as one you
 * found by opening him — and lands in the same list.
 */
export function TradePackages(
  { app, m, targetId, targetName, compact }:
  { app: App; m: Model; targetId: string; targetName: string; compact?: boolean },
) {
  const deals = m.offersFor(targetId);

  if (!deals.length) {
    return (
      <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5), marginTop: 8 }}>
        Nothing you own gets there at a price his manager would take. Either he is worth more than
        any package you can build, or his team is short at exactly his position.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
      {deals.map((t, i) => {
        const key = targetKey(t, targetId);
        const on = app.isSaved(key);
        return (
          <div key={key} style={{
            paddingTop: 11,
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

            {compact ? null : (
              <div style={{ fontSize: 11.5, color: dim(0.45), marginTop: 5, lineHeight: 1.5 }}>
                {t.give.map(g => (g.isPick ? g.label : g.pos + ' · ' + (g.age ?? '?') + ' yrs')).join(' · ')}
                {' · '}{num(t.cost * 100)} vs his {num(t.target.q * 100)}
              </div>
            )}

            <div style={{ fontSize: 11.5, marginTop: 5, lineHeight: 1.5, color: dim(0.6) }}>
              {priceRead(t)}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0 14px', marginTop: 2 }}>
              <button
                type="button"
                onClick={() => app.toggleSaved(savedFromTarget(t, targetId, targetName))}
                aria-pressed={on}
                className="btn btn-ghost"
                style={{
                  fontSize: 11.5, padding: '4px 0', fontWeight: 500,
                  color: on ? GOOD : 'var(--color-accent)',
                }}
              >
                {on ? '✓ On your shortlist' : "I'm interested"}
              </button>
              {compact ? null : t.give.filter(g => !g.isPick).map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => app.setDetail(g.id)}
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '4px 0' }}
                >
                  Open {g.name}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
