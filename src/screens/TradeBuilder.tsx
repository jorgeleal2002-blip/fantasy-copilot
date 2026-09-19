import { useState } from 'react';
import { colorOf } from '../model/constants';
import { evaluateTrade, fitLine, type TradeAsset } from '../model/trade-eval';
import { depthOf, readPick, startsAt } from '../model/trade-picks';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { Overlay } from '../ui/primitives';
import { BAD, GOOD, dim } from '../ui/styles';

/** Four is where a phone runs out of room, and the league runs out of patience. */
const MAX_TEAMS = 4;

/**
 * Build a trade, laid out the way a trade is argued about: a column per team
 * saying what that team walks away with, and one bar across the top saying who
 * is winning.
 *
 * Columns rather than sides, because sides only exist when there are two of
 * them. A third team is one more column, and every asset already carries where
 * it is going, so nothing else has to change.
 */
export function TradeBuilder({ app, m }: { app: App; m: Model }) {
  const [addTo, setAddTo] = useState<number | null>(null);
  const [pickingTeam, setPickingTeam] = useState(false);

  const mine = m.leagueRows.find(r => r.isMe);
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

  const fits: Record<number, number> = {};
  for (const t of teams) {
    const incoming = assets.filter(x => x.to === t.id).map(x => x.id);
    const outgoing = assets.filter(x => x.from === t.id).map(x => x.id);
    if (!incoming.length && !outgoing.length) continue;
    fits[t.id] = m.lineupWith(t.id, incoming, outgoing).delta;
  }

  const v = evaluateTrade(teams, assets, fits);
  const fit = fitLine(v);

  return (
    <div className="fb">
      <Balance v={v} fit={fit} />

      {teams.length < 2 ? (
        <div className="fb-empty">Add a team to trade with.</div>
      ) : (
        <div className="fb-cols">
          {teams.map(t => (
            <div key={t.id} className={'fb-col' + (t.isMe ? ' is-me' : '')}>
              <div className="fb-col-head">
                {/* Two lines, because a narrow column truncated "receives"
                    mid-word and a cut-off label reads as a broken one. */}
                <span className="fb-col-title">
                  <span className="fb-col-name">{t.name}</span>
                  <span className="fb-col-sub">receives</span>
                </span>
                {!t.isMe ? (
                  <button
                    type="button"
                    className="fb-x"
                    aria-label={'Remove ' + t.name}
                    onClick={() => app.toggleTradeTeam(t.id)}
                  >
                    ×
                  </button>
                ) : null}
              </div>

              {assets.filter(a => a.to === t.id).map(a => (
                <Card key={a.id} app={app} m={m} asset={a} />
              ))}

              <button type="button" className="fb-add" onClick={() => setAddTo(t.id)}>
                + Add player
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="fb-actions">
        {ids.length < MAX_TEAMS ? (
          <button type="button" className="btn btn-secondary fb-btn" onClick={() => setPickingTeam(true)}>
            + Add team
          </button>
        ) : null}
        {v.moved ? (
          <button type="button" className="btn btn-secondary fb-btn" onClick={app.clearTrade}>
            Clear
          </button>
        ) : null}
      </div>

      {pickingTeam ? (
        <TeamList app={app} m={m} inDeal={ids} onClose={() => setPickingTeam(false)} />
      ) : null}

      {addTo != null ? (
        <AssetPicker
          app={app}
          m={m}
          to={addTo}
          from={ids.filter(x => x !== addTo)}
          onClose={() => setAddTo(null)}
        />
      ) : null}
    </div>
  );
}

/** The headline and the one bar that answers the whole screen. */
function Balance({ v, fit }: { v: ReturnType<typeof evaluateTrade>; fit: string | null }) {
  const me = v.ledgers.find(l => l.isMe);
  const tone = !v.moved ? dim(0.5) : v.winner ? (v.winner.isMe ? GOOD : BAD) : dim(0.75);

  const head = !v.moved ? 'Nothing in the trade yet'
    : !v.winner ? 'Even trade'
      : v.winner.isMe ? 'You win this trade' : v.winner.name + ' wins this trade';

  /* The bar reads as a tug of war: dead centre is even, and it travels toward
   * whoever is gaining. Measured against the whole deal rather than against
   * the largest net, so the same edge looks the same size in any trade. */
  const tilt = v.moved && me ? Math.max(-1, Math.min(1, me.net / v.moved)) : 0;

  return (
    <div className="fb-bal">
      <div className="fb-bal-head" style={{ color: tone }}>{head}</div>
      <div className="fb-bar">
        <span
          className="fb-bar-fill"
          style={{
            background: tone,
            left: tilt >= 0 ? '50%' : (50 + tilt * 50) + '%',
            width: Math.abs(tilt) * 50 + '%',
          }}
        />
      </div>
      <div className="fb-bal-legs">
        <span>{v.ledgers.find(l => !l.isMe)?.name || 'Them'}</span>
        <span>You</span>
      </div>
      {fit ? <div className="fb-fit">{fit}</div> : null}
      {v.problems.map(p => <div key={p} className="fb-problem">{p}</div>)}
    </div>
  );
}

/** One asset in a column: who he is, what he is worth, and the way out. */
function Card({ app, m, asset }: { app: App; m: Model; asset: TradeAsset }) {
  const val = m.marketValue(asset.id);
  const photo = app.photoFor(asset.id);
  const pos = val?.pos;
  return (
    <div className="fb-card">
      {photo
        ? <img className="fb-face" src={photo} alt="" />
        : <span className="fb-face fb-face-blank" />}
      <span className="fb-card-body">
        <span className="fb-card-name">{asset.name}</span>
        <span className="fb-card-meta">
          {pos ? (
            <span className="fb-pill" style={{ background: colorOf(pos) }}>
              {pos}{val?.posRank ? ' ' + val.posRank : ''}
            </span>
          ) : null}
          <span className="fb-val">{Math.round(asset.value).toLocaleString()}</span>
        </span>
      </span>
      <button
        type="button"
        className="fb-x"
        aria-label={'Remove ' + asset.name}
        onClick={() => app.toggleTradeAsset(asset.id, asset.from, asset.to)}
      >
        ×
      </button>
    </div>
  );
}

/** Choose who else is in the deal, from the league's own list. */
function TeamList({ app, m, inDeal, onClose }: {
  app: App; m: Model; inDeal: number[]; onClose: () => void;
}) {
  const rest = m.leagueRows.filter(r => !r.isMe && !inDeal.includes(r.id));
  return (
    <Overlay onClose={onClose} label="Trade" z={7}>
      <div className="fb-pick-title">Add a team</div>
      {rest.length ? rest.map(r => (
        <button
          key={r.id}
          type="button"
          className="fb-pick-row"
          onClick={() => { app.toggleTradeTeam(r.id); onClose(); }}
        >
          {r.avatar
            ? <img className="fb-face" src={r.avatar} alt="" />
            : <span className="fb-face fb-face-blank" />}
          <span className="fb-card-body">
            <span className="fb-card-name">{r.name}</span>
            <span className="fb-card-meta">
              <span className="fb-val">
                {r.record.wins + r.record.losses + r.record.ties ? r.record.label + ' · ' : ''}
                {r.worst ? 'weak at ' + r.worst : 'no obvious hole'}
              </span>
            </span>
          </span>
        </button>
      )) : <div className="fb-empty">Every team is already in the trade.</div>}
    </Overlay>
  );
}

/**
 * Who this team could receive.
 *
 * Ordered by what makes sense to move rather than by price, with the reason
 * written next to each — the same reading the board uses, applied to the team
 * that would be sending him.
 */
function AssetPicker({ app, m, to, from, onClose }: {
  app: App; m: Model; to: number; from: number[]; onClose: () => void;
}) {
  const receiver = m.teamInfo(to);
  const rows = from.flatMap(owner => {
    const info = m.teamInfo(owner);
    if (!info) return [];
    const ownerName = m.leagueRows.find(r => r.id === owner)?.name || '';
    return [
      ...info.list.map(p => ({
        p, owner, ownerName,
        read: readPick({
          pos: p.pos,
          depth: depthOf(info.list, p),
          startsAt: startsAt(m.league.roster_positions, p.pos),
          senderRank: info.ranks[p.pos] ?? m.teamCount,
          receiverRank: receiver?.ranks[p.pos] ?? m.teamCount,
          teamCount: m.teamCount,
        }),
      })),
      ...info.picks.map(p => ({
        p, owner, ownerName, read: { tag: null, score: 0, why: '' },
      })),
    ];
  }).sort((a, b) => (b.read.score - a.read.score) || (b.p.q - a.p.q)).slice(0, 60);

  const dest = m.leagueRows.find(r => r.id === to);
  const toName = dest?.isMe ? 'you' : dest?.name;

  return (
    <Overlay onClose={onClose} label="Trade" z={7}>
      <div className="fb-pick-title">Send to {toName}</div>
      {rows.map(({ p, owner, ownerName, read }) => {
        const val = m.marketValue(p.id);
        const on = !!app.tradeAssets[p.id];
        return (
          <button
            key={p.id}
            type="button"
            className={'fb-pick-row' + (on ? ' is-on' : '')}
            onClick={() => { app.toggleTradeAsset(p.id, owner, to); onClose(); }}
          >
            <span className="fb-card-body">
              <span className="fb-card-name">{p.name}</span>
              <span className="fb-card-meta">
                {val?.pos ? (
                  <span className="fb-pill" style={{ background: colorOf(val.pos) }}>
                    {val.pos}{val.posRank ? ' ' + val.posRank : ''}
                  </span>
                ) : null}
                <span className="fb-val">{Math.round(p.q).toLocaleString()}</span>
                {from.length > 1 ? <span className="fb-from">from {ownerName}</span> : null}
              </span>
              {read.why ? <span className={'tb-why is-' + (read.tag || 'none')}>{read.why}</span> : null}
            </span>
            {on ? <span className="fb-on">in</span> : null}
          </button>
        );
      })}
    </Overlay>
  );
}
