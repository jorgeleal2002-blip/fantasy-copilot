import { evaluateTrade, fitLine, verdictLine, type TradeAsset, type TeamLedger } from '../model/trade-eval';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { BAD, GOOD, dim, ellipsis } from '../ui/styles';

/** Four is where a phone runs out of room, and the league runs out of patience. */
const MAX_TEAMS = 4;

const sign = (n: number) => (n > 0 ? '+' : '') + Math.round(n).toLocaleString();

/**
 * Build a trade and see who wins it.
 *
 * Three teams is not a special mode: every asset carries where it goes, so a
 * ring of three is the same screen as a swap of two, with one more column of
 * names to route between.
 */
export function TradeBuilder({ app, m }: { app: App; m: Model }) {
  const mine = m.leagueRows.find(r => r.isMe);
  // Yours is always in the deal — you are the one proposing it.
  const ids = mine ? [mine.id, ...app.tradeTeams.filter(t => t !== mine.id)] : app.tradeTeams;
  const teams = ids
    .map(id => m.leagueRows.find(r => r.id === id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map(r => ({ id: r.id, name: r.isMe ? 'You' : r.name, isMe: r.isMe }));

  const assets: TradeAsset[] = Object.entries(app.tradeAssets).map(([id, a]) => {
    const info = m.teamInfo(a.from);
    const found = info?.list.find(p => p.id === id) || info?.picks.find(p => p.id === id);
    return { id, name: found?.name || id, value: found?.q || 0, from: a.from, to: a.to };
  });

  /* Value is what the assets are worth; fit is what the lineup does with them.
   * Measured per team by rebuilding each roster with the swap applied, which is
   * the same simulation the suggested offers already run. */
  const fits: Record<number, number> = {};
  for (const t of teams) {
    const incoming = assets.filter(x => x.to === t.id).map(x => x.id);
    const outgoing = assets.filter(x => x.from === t.id).map(x => x.id);
    if (!incoming.length && !outgoing.length) continue;
    fits[t.id] = m.lineupWith(t.id, incoming, outgoing).delta;
  }

  const v = evaluateTrade(teams, assets, fits);
  const fit = fitLine(v);
  const nameOf = (rid: number) => teams.find(t => t.id === rid)?.name || '?';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5), textWrap: 'pretty' }}>
        Pick the teams, then tap the players and picks that move. Tap the arrow on
        an asset to send it somewhere else — that is all a three-team trade is.
      </div>

      <TeamPicker app={app} m={m} inDeal={ids} />

      {teams.length < 2 ? (
        <div style={{
          background: 'var(--color-surface)', borderRadius: 12, padding: '14px 13px',
          fontSize: 12.5, color: dim(0.5),
        }}>
          Add at least one other team to start.
        </div>
      ) : (
        <>
          <Verdict v={v} fit={fit} />
          {teams.map(t => (
            <TeamAssets
              key={t.id}
              app={app}
              m={m}
              team={t}
              inDeal={ids}
              nameOf={nameOf}
            />
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={app.clearTrade}
            style={{ borderRadius: 10, minHeight: 40 }}
          >
            Clear the trade
          </button>
        </>
      )}
    </div>
  );
}

function Verdict({ v, fit }: { v: ReturnType<typeof evaluateTrade>; fit: string | null }) {
  const tone = !v.moved ? dim(0.5) : v.winner ? (v.winner.isMe ? GOOD : BAD) : dim(0.7);
  return (
    <div style={{
      background: 'var(--color-surface)', borderRadius: 12, padding: '12px 13px',
      border: '1px solid ' + (v.winner ? tone + '55' : 'var(--color-divider)'),
    }}>
      <div style={{ fontSize: 13.5, fontWeight: 500, color: tone, textWrap: 'pretty' }}>
        {verdictLine(v)}
      </div>
      {/* The second axis, and the one that decides most real trades. */}
      {fit ? (
        <div style={{ fontSize: 12, color: dim(0.62), marginTop: 6, textWrap: 'pretty' }}>
          {fit}
        </div>
      ) : null}
      {v.moved ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {v.ledgers.map(l => <Row key={l.id} l={l} />)}
        </div>
      ) : null}
      {v.problems.map(p => (
        <div key={p} style={{ fontSize: 11, color: BAD, marginTop: 7, textWrap: 'pretty' }}>
          {p}
        </div>
      ))}
      {v.moved ? (
        <div style={{ fontSize: 10.5, color: dim(0.38), marginTop: 8, textWrap: 'pretty' }}>
          {/* Say what "even" means here, or the number looks arbitrary. */}
          Anything inside ±{Math.round(v.band).toLocaleString()} counts as even — four
          percent of the {Math.round(v.moved).toLocaleString()} that changes hands.
        </div>
      ) : null}
    </div>
  );
}

function Row({ l }: { l: TeamLedger }) {
  const color = l.standing === 'wins' ? GOOD : l.standing === 'loses' ? BAD : dim(0.55);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ flex: 1, minWidth: 0, color: l.isMe ? 'var(--color-accent)' : undefined, ...ellipsis }}>
        {l.name}
      </span>
      <span style={{ color: dim(0.4), fontSize: 10.5 }}>
        {l.gave.length} out · {l.got.length} in
        {l.fitDelta != null && Math.abs(l.fitDelta) >= 0.1
          ? ' · lineup ' + (l.fitDelta > 0 ? '+' : '−') + Math.abs(l.fitDelta).toFixed(1)
          : ''}
      </span>
      <span style={{ color, fontWeight: 500, minWidth: 62, textAlign: 'right' }}>{sign(l.net)}</span>
    </div>
  );
}

function TeamPicker({ app, m, inDeal }: { app: App; m: Model; inDeal: number[] }) {
  const others = m.leagueRows.filter(r => !r.isMe);
  const full = inDeal.length >= MAX_TEAMS;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {others.map(r => {
        const on = inDeal.includes(r.id);
        return (
          <button
            key={r.id}
            type="button"
            aria-pressed={on}
            disabled={!on && full}
            onClick={() => app.toggleTradeTeam(r.id)}
            style={{
              font: 'inherit', fontSize: 11, cursor: 'pointer',
              padding: '6px 9px', borderRadius: 8, maxWidth: 140,
              color: on ? 'var(--color-accent)' : dim(0.55),
              border: '1px solid ' + (on ? 'var(--color-accent)' : 'var(--color-divider)'),
              background: on ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent',
              opacity: !on && full ? 0.4 : 1,
              ...ellipsis,
            }}
          >
            {r.name}
          </button>
        );
      })}
    </div>
  );
}

function TeamAssets({ app, m, team, inDeal, nameOf }: {
  app: App;
  m: Model;
  team: { id: number; name: string; isMe: boolean };
  inDeal: number[];
  nameOf: (rid: number) => string;
}) {
  const info = m.teamInfo(team.id);
  if (!info) return null;
  // Picks belong in a trade as much as players do, and in dynasty they are
  // often the whole of one side.
  const items = [...info.list, ...info.picks].slice(0, 40);
  const defaultTo = inDeal.find(t => t !== team.id) ?? team.id;

  return (
    <div style={{ background: 'var(--color-surface)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        padding: '9px 12px', fontSize: 12, fontWeight: 500,
        color: team.isMe ? 'var(--color-accent)' : undefined,
        borderBottom: '1px solid var(--color-divider)',
      }}>
        {team.name} sends
      </div>
      <div style={{ maxHeight: 240, overflow: 'auto' }}>
        {items.map(p => {
          const picked = app.tradeAssets[p.id];
          return (
            <div
              key={p.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                borderTop: '1px solid var(--color-divider)',
                background: picked ? 'color-mix(in srgb, var(--color-accent) 9%, transparent)' : 'transparent',
              }}
            >
              <button
                type="button"
                onClick={() => app.toggleTradeAsset(p.id, team.id, defaultTo)}
                style={{
                  flex: 1, minWidth: 0, textAlign: 'left', font: 'inherit', fontSize: 12.5,
                  background: 'transparent', border: 0, color: 'var(--color-text)', cursor: 'pointer',
                  padding: 0, ...ellipsis,
                }}
              >
                {p.name}
                <span style={{ color: dim(0.4), fontSize: 11 }}>
                  {' · ' + Math.round(p.q).toLocaleString()}
                </span>
              </button>
              {picked ? (
                <button
                  type="button"
                  onClick={() => app.cycleTradeTo(p.id, inDeal)}
                  style={{
                    font: 'inherit', fontSize: 10.5, cursor: 'pointer', flex: 'none', maxWidth: 120,
                    padding: '3px 7px', borderRadius: 7, color: 'var(--color-accent)',
                    border: '1px solid var(--color-accent)', background: 'transparent', ...ellipsis,
                  }}
                >
                  → {nameOf(picked.to)}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
