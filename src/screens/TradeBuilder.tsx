import { useState } from 'react';
import { colorOf } from '../model/constants';
import { evaluateTrade, fitLine, type RosterRoom, type TeamLedger, type TradeAsset } from '../model/trade-eval';
import { caseLine, fitHeadline, situationOf, type FitHeadline, type TeamCase } from '../model/team-verdict';
import { depthOf, readPick, startsAt } from '../model/trade-picks';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { Overlay } from '../ui/primitives';
import { BAD, GOOD, dim } from '../ui/styles';


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

  /* Whoever was chosen, in the order they were added — you are not put in
   * automatically, because a trade you are sizing up between two other teams
   * is a trade too. */
  const ids = app.tradeTeams;
  const teams = ids
    .map(id => m.leagueRows.find(r => r.id === id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map(r => ({ id: r.id, name: r.isMe ? 'You' : r.name, isMe: r.isMe }));

  const assets: TradeAsset[] = Object.entries(app.tradeAssets).map(([id, a]) => {
    const info = m.teamInfo(a.from);
    const found = info?.list.find(p => p.id === id) || info?.picks.find(p => p.id === id);
    const isPick = !!info?.picks.find(p => p.id === id);
    return { id, name: found?.name || id, value: found?.q || 0, from: a.from, to: a.to, isPick };
  });

  /* Each team's season with and without the trade, week by week: byes,
     injuries, matchups and the playoff weeks in. Falls back to the plain
     best-lineup difference off the bundled calendar. */
  const fromWeek = app.week || app.nflWeek || 1;
  const fits: Record<number, number> = {};
  const seasons: Record<number, ReturnType<Model['seasonWith']>> = {};
  for (const t of teams) {
    const incoming = assets.filter(x => x.to === t.id && !x.isPick).map(x => x.id);
    const outgoing = assets.filter(x => x.from === t.id && !x.isPick).map(x => x.id);
    if (!incoming.length && !outgoing.length) continue;
    const sw = m.seasonWith(t.id, incoming, outgoing, fromWeek);
    seasons[t.id] = sw;
    if (sw) { fits[t.id] = sw.perWeek; continue; }
    const w = m.lineupWith(t.id, incoming, outgoing);
    if (w.measured) fits[t.id] = w.delta;
  }

  const room: Record<number, RosterRoom> = {};
  for (const t of teams) {
    const r = m.rosterRoom(t.id);
    if (r) room[t.id] = r;
  }
  const v = evaluateTrade(teams, assets, fits, room);

  // What each team should want, from where it stands.
  const order = m.leagueRows.slice().sort((a, b) =>
    b.record.wins - a.record.wins || b.record.pointsFor - a.record.pointsFor);
  const playoffTeams = Math.min(m.teamCount, Number(m.league.settings?.playoff_teams) || 6);
  const cases: TeamCase[] = v.ledgers.map(l => {
    const row = m.leagueRows.find(r => r.id === l.id);
    const games = row ? row.record.wins + row.record.losses + row.record.ties : 0;
    return {
      id: l.id, name: l.name, isMe: l.isMe,
      situation: situationOf(order.findIndex(r => r.id === l.id) + 1, games, m.teamCount, playoffTeams),
      net: l.net, band: v.band,
      perWeek: l.fitDelta, playoffs: seasons[l.id]?.playoffs ?? null,
    };
  });
  const fit = fitLine(v);

  return (
    <div className="fb">
      <Balance v={v} fit={fit} pivot={teams.find(t => t.isMe)?.id ?? teams[0]?.id ?? null}
        head={fitHeadline(cases, m.isDynasty, v.moved)} />

      {teams.length < 2 ? (
        <div className="fb-empty">
          {teams.length ? 'Add one more team to trade with.' : 'Add the teams in the trade — yours too, if you are in it.'}
        </div>
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
                <button
                  type="button"
                  className="fb-x"
                  aria-label={'Remove ' + t.name}
                  onClick={() => app.toggleTradeTeam(t.id)}
                >
                  ×
                </button>
              </div>

              {assets.filter(a => a.to === t.id).map(a => (
                <Card key={a.id} app={app} m={m} asset={a} />
              ))}

              {(() => {
                const c = cases.find(x => x.id === t.id);
                const sw = seasons[t.id];
                if (!c || !v.moved) return null;
                return (
                  <div className="fb-case">
                    <div>{caseLine(c, m.isDynasty)}</div>
                    {sw?.byes.length ? (
                      <div>Byes: {sw.byes.map(b => 'wk ' + b.week + ' (' + b.names.join(', ') + ')').join(' · ')}</div>
                    ) : null}
                    {sw?.injured.length ? (
                      <div className="fb-case-bad">Injured: {sw.injured.map(i => i.name + ' — ' + i.status).join(', ')}</div>
                    ) : null}
                  </div>
                );
              })()}
              {(() => {
                const cuts = v.ledgers.find(l => l.id === t.id)?.cuts || [];
                return cuts.length ? (
                  <div className="fb-cut">Full roster — must cut {cuts.map(c => c.name).join(', ')}</div>
                ) : null;
              })()}

              <button type="button" className="fb-add" onClick={() => setAddTo(t.id)}>
                + Add player
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="fb-actions">
        {ids.length < m.leagueRows.length ? (
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
function Balance({ v, fit, pivot, head: h }: {
  v: ReturnType<typeof evaluateTrade>; fit: string | null; pivot: number | null; head: FitHeadline;
}) {
  const [open, setOpen] = useState(false);
  // The bar is read from one team's side: yours when you are in it, else the
  // first team added.
  const me = v.ledgers.find(l => l.id === pivot);
  const others = v.ledgers.filter(l => l.id !== pivot);
  // Green and red are you winning and you losing; a trade you are not in is
  // neither, and is told in the plain accent.
  const inIt = v.ledgers.some(l => l.isMe);
  const meWins = v.ledgers.some(l => l.isMe && h.winners.includes(l.id));
  const tone = !v.moved ? dim(0.62) : !h.winners.length ? dim(0.9)
    : !inIt ? 'var(--color-accent)' : meWins ? GOOD : BAD;
  const head = h.title;

  /* The bar reads as a tug of war: dead centre is even, and it travels toward
   * whoever is gaining. Measured against the whole deal rather than against
   * the largest net, so the same edge looks the same size in any trade. */
  const tilt = v.moved && me ? Math.max(-1, Math.min(1, me.net / v.moved)) : 0;

  return (
    <div className="fb-bal">
      <div className="fb-bal-head" style={{ color: tone }}>{head}</div>
      {h.why ? <div className="fb-fit" style={{ marginTop: 2 }}>{h.why}</div> : null}
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
        <span>{others.length === 1 ? others[0].name : others.length ? 'The others' : ''}</span>
        <span>{me?.name || ''}</span>
      </div>
      {fit && inIt ? <div className="fb-fit">{fit}</div> : null}
      {v.problems.map(p => <div key={p} className="fb-problem">{p}</div>)}

      {/* The headline can only name one team. In a three-way the other two
          are the whole question, and even in a swap "by how much, and what
          does it do to their lineup" is the part you argue with. */}
      {v.moved ? (
        <>
          <button
            type="button"
            className="fb-more"
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
          >
            {open ? 'Hide the breakdown' : 'See more'}
          </button>
          {open ? (
            <div className="fb-rows">
              {v.ledgers.map(l => <LedgerRow key={l.id} l={l} moved={v.moved} />)}
              <div className="fb-note">
                Value counts a star above the pieces that add up to him: each player is
                weighed against the best one in the deal, so two lesser players are worth
                less than their sum. A team taking more players than it sends on a full
                roster loses whoever it has to cut. Even is anything inside ±{Math.round(v.band).toLocaleString()}.
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** One team's whole side of the deal, in the terms it would judge it by. */
function LedgerRow({ l, moved }: { l: TeamLedger; moved: number }) {
  const tone = l.standing === 'wins' ? GOOD : l.standing === 'loses' ? BAD : dim(0.62);
  const pct = moved ? Math.round((l.net / moved) * 100) : 0;
  return (
    <div className="fb-row">
      <div className="fb-row-top">
        <span className={'fb-row-name' + (l.isMe ? ' is-me' : '')}>{l.name}</span>
        <span className="fb-row-net" style={{ color: tone }}>
          {(l.net > 0 ? '+' : '') + Math.round(l.net).toLocaleString()}
          <span className="fb-row-pct">{pct ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''}</span>
        </span>
      </div>
      <div className="fb-row-line">
        <span className="fb-row-tag">gets</span>
        {l.got.length ? l.got.map(a => a.name).join(', ') : 'nothing'}
      </div>
      <div className="fb-row-line">
        <span className="fb-row-tag">gives</span>
        {l.gave.length ? l.gave.map(a => a.name).join(', ') : 'nothing'}
      </div>
      {/* A full roster taking more bodies than it sends has to make room,
          and what it cuts is a real cost — already out of the number above. */}
      {l.cuts.length ? (
        <div className="fb-row-line">
          <span className="fb-row-tag">cuts</span>
          <span style={{ color: BAD }}>{l.cuts.map(c => c.name).join(', ')}</span>
        </div>
      ) : null}
      {l.fitDelta != null && Math.abs(l.fitDelta) >= 0.1 ? (
        <div className="fb-row-line">
          <span className="fb-row-tag">lineup</span>
          <span style={{ color: l.fitDelta > 0 ? GOOD : BAD }}>
            {(l.fitDelta > 0 ? '+' : '−') + Math.abs(l.fitDelta).toFixed(1)} pts a week
          </span>
        </div>
      ) : null}
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
  // Yours first: it is the team most often in a trade you are building.
  const rest = m.leagueRows.filter(r => !inDeal.includes(r.id))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe));
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
            <span className="fb-card-name">{r.isMe ? 'You' : r.name}</span>
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
