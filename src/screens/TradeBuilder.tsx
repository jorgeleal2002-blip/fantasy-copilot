import { evaluateTrade, fitLine, type TradeAsset, type TeamLedger } from '../model/trade-eval';
import { depthOf, readPick, startsAt, type PickTag } from '../model/trade-picks';
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
  const tone = !v.moved ? dim(0.5) : v.winner ? (v.winner.isMe ? GOOD : BAD) : dim(0.75);
  // Bars are drawn against the largest swing in the deal, so the longest one
  // always fills its half and the rest are read against it.
  const widest = Math.max(1, ...v.ledgers.map(l => Math.abs(l.net)));

  const head = !v.moved ? 'Nothing picked yet'
    : !v.winner ? 'Even trade'
      : v.winner.isMe ? 'You win this trade' : v.winner.name + ' wins';
  const sub = !v.moved ? 'Tap players below to build one'
    : !v.winner ? 'Nobody comes out ahead'
      : Math.round((v.winner.net / v.moved) * 100) + '% of the value moved';

  return (
    <div className="tb-card" style={{ borderColor: v.winner ? tone + '66' : undefined }}>
      <div className="tb-head" style={{ color: tone }}>{head}</div>
      <div className="tb-sub">{sub}</div>

      {v.moved ? (
        <div className="tb-ledger">
          {v.ledgers.map(l => <Row key={l.id} l={l} widest={widest} />)}
        </div>
      ) : null}

      {fit ? <div className="tb-fit">{fit}</div> : null}

      {v.problems.map(p => <div key={p} className="tb-problem">{p}</div>)}

      {v.moved ? (
        <div className="tb-band">
          {/* Say what "even" means here, or the number looks arbitrary. */}
          Even is anything inside ±{Math.round(v.band).toLocaleString()} — four percent
          of the {Math.round(v.moved).toLocaleString()} that changes hands.
        </div>
      ) : null}
    </div>
  );
}

/**
 * One team's side of the deal: who they are, what they walk away with, and how
 * far the value tipped — as a bar either side of a centre line, because "+6"
 * and "−6" are two numbers to compare and a bar is a picture to glance at.
 */
function Row({ l, widest }: { l: TeamLedger; widest: number }) {
  const color = l.standing === 'wins' ? GOOD : l.standing === 'loses' ? BAD : dim(0.5);
  const pct = (Math.abs(l.net) / widest) * 50;
  const up = l.net >= 0;

  return (
    <div className="tb-row">
      <div className="tb-row-top">
        <span className={'tb-name' + (l.isMe ? ' is-me' : '')}>{l.name}</span>
        <span className="tb-net" style={{ color }}>{sign(l.net)}</span>
      </div>

      <div className="tb-bar">
        <span
          className="tb-fill"
          style={{
            background: color,
            width: pct + '%',
            left: up ? '50%' : (50 - pct) + '%',
          }}
        />
      </div>

      {/* What they actually receive. A ledger of counts says how many; the
          names say whether the deal is worth reading twice. */}
      <div className="tb-gets">
        {l.got.length ? l.got.map(a => a.name).join(' · ') : 'nothing'}
        {l.fitDelta != null && Math.abs(l.fitDelta) >= 0.1
          ? '  ·  lineup ' + (l.fitDelta > 0 ? '+' : '−') + Math.abs(l.fitDelta).toFixed(1)
          : ''}
      </div>
    </div>
  );
}

function TeamPicker({ app, m, inDeal }: { app: App; m: Model; inDeal: number[] }) {
  const others = m.leagueRows.filter(r => !r.isMe);
  const full = inDeal.length >= MAX_TEAMS;
  return (
    <div className="tb-teams">
      {others.map(r => {
        const on = inDeal.includes(r.id);
        return (
          <button
            key={r.id}
            type="button"
            aria-pressed={on}
            disabled={!on && full}
            onClick={() => app.toggleTradeTeam(r.id)}
            className={'tb-team' + (on ? ' is-on' : '')}
            style={{ opacity: !on && full ? 0.35 : 1 }}
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
  const defaultTo = inDeal.find(t => t !== team.id) ?? team.id;
  const to = m.teamInfo(defaultTo);

  /* Sorted by what makes sense to move, not by price.
   *
   * Price alone puts the untouchable starters at the top and the men nobody
   * wants at the bottom, which is the list backwards. A spare at a position
   * the other team cannot field leads instead, and the player this team
   * cannot replace sinks — with the reason written next to each, because a
   * ranking nobody can see the logic of is just a different arbitrary order.
   */
  const players = info.list.map(p => {
    const read = readPick({
      pos: p.pos,
      depth: depthOf(info.list, p),
      startsAt: startsAt(m.league.roster_positions, p.pos),
      senderRank: info.ranks[p.pos] ?? m.teamCount,
      receiverRank: to?.ranks[p.pos] ?? m.teamCount,
      teamCount: m.teamCount,
    });
    return { p, read };
  }).sort((a, b) => (b.read.score - a.read.score) || (b.p.q - a.p.q));

  // Picks belong in a trade as much as players do — in dynasty they are often
  // the whole of one side — but no depth chart applies to them.
  const items = [
    ...players,
    ...info.picks.map(p => ({ p, read: { tag: null as PickTag, score: 0, why: '' } })),
  ].slice(0, 40);

  return (
    <div style={{ background: 'var(--color-surface)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        padding: '9px 12px', fontSize: 12, fontWeight: 500,
        color: team.isMe ? 'var(--color-accent)' : undefined,
        borderBottom: '1px solid var(--color-divider)',
      }}>
        {team.isMe ? 'You send' : team.name + ' sends'}
      </div>
      <div style={{ maxHeight: 240, overflow: 'auto' }}>
        {items.map(({ p, read }) => {
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
                <span className="tb-asset">
                  <span className="tb-asset-name">
                    {p.name}
                    <span style={{ color: dim(0.4), fontSize: 11 }}>
                      {' · ' + Math.round(p.q).toLocaleString()}
                    </span>
                  </span>
                  {read.why ? (
                    <span className={'tb-why is-' + (read.tag || 'none')}>{read.why}</span>
                  ) : null}
                </span>
              </button>
              {picked && inDeal.length > 2 ? (
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
              ) : picked ? (
                <span style={{ color: 'var(--color-accent)', fontSize: 13, flex: 'none' }}>✓</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
