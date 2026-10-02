import { useState } from 'react';
import { colorOf } from '../model/constants';
import { evaluateTrade, type RosterRoom, type TeamLedger, type TradeAsset } from '../model/trade-eval';
import { fitHeadline, outcomeFor, situationLabel, situationOf, type FitHeadline, type Outcome, type TeamCase } from '../model/team-verdict';
import { depthAfter, depthChip, type PosDepth } from '../model/depth';
import { depthOf, readPick, startsAt } from '../model/trade-picks';
import type { Pos } from '../api/types';
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

  /* What the deal leaves each roster looking like — see `depthAfter`. It
     changes no verdict: a slot that cannot be filled is already paid for in
     lineup points and a man who cannot start already earns none. It is here
     because the points go quiet in both cases and nothing said why. */
  const posOf = (id: string) => m.marketValue(id)?.pos as Pos | undefined;
  const depth: Record<number, ReturnType<typeof depthAfter>> = {};
  for (const t of teams) {
    const r = room[t.id];
    if (!r) continue;
    const got = assets.filter(x => x.to === t.id && !x.isPick).map(x => posOf(x.id)).filter(Boolean) as Pos[];
    const gave = assets.filter(x => x.from === t.id && !x.isPick).map(x => posOf(x.id)).filter(Boolean) as Pos[];
    if (!got.length && !gave.length) continue;
    depth[t.id] = depthAfter(r.pos, got, gave, m.slots);
  }

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
  /* One card per team, under the players: the verdict for that team and the
     numbers behind it, drawn rather than written out. */
  const cards = v.moved && teams.length > 1 ? (
    <div className="fb-cards">
      {teams.map(t => {
        const l = v.ledgers.find(x => x.id === t.id);
        const c = cases.find(x => x.id === t.id);
        return l && c ? (
          <Scorecard key={t.id} l={l} c={c} moved={v.moved} dynasty={m.isDynasty}
            season={seasons[t.id] || null} depth={depth[t.id] || []} waiver={m.waiverAt}
            avatar={m.leagueRows.find(r => r.id === t.id)?.avatar || null} />
        ) : null;
      })}
      <HowJudged />
    </div>
  ) : null;

  return (
    <div className="fb">
      <Balance v={v} pivot={teams.find(t => t.isMe)?.id ?? teams[0]?.id ?? null}
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

              <button type="button" className="fb-add" onClick={() => setAddTo(t.id)}>
                + Add player
              </button>
            </div>
          ))}
        </div>
      )}

      {cards}

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
function Balance({ v, pivot, head: h }: {
  v: ReturnType<typeof evaluateTrade>; pivot: number | null; head: FitHeadline;
}) {
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

  /* The bar reads as a tug of war: dead centre is even, and it travels toward
   * whoever is gaining. Measured against the whole deal rather than against
   * the largest net, so the same edge looks the same size in any trade. */
  const tilt = v.moved && me ? Math.max(-1, Math.min(1, me.net / v.moved)) : 0;

  return (
    <div className="fb-bal">
      <div className="fb-bal-head" style={{ color: tone }}>{h.title}</div>
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
      {v.problems.map(p => <div key={p} className="fb-problem">{p}</div>)}
    </div>
  );
}

const SITUATION_ICON: Record<TeamCase['situation'], string> = { contender: '🔥', middle: '⚖️', out: '🌱' };
const VERDICT: Record<Outcome, { mark: string; them: string; you: string }> = {
  good: { mark: '✓', them: 'Suits them', you: 'Suits you' },
  bad: { mark: '✗', them: 'Hurts them', you: 'Hurts you' },
  even: { mark: '=', them: 'Even for them', you: 'Even for you' },
};
const sign = (x: number, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '±')
  + (d ? Math.abs(x).toFixed(d) : Math.abs(x).toLocaleString());

/**
 * One team's side of the deal, drawn: what it is playing for, whether this
 * suits that, and each number behind the call as a bar rather than a sentence.
 */
function Scorecard({ l, c, moved, dynasty, season, avatar, depth, waiver }: {
  l: TeamLedger; c: TeamCase; moved: number; dynasty: boolean;
  season: ReturnType<Model['seasonWith']>; avatar: string | null;
  depth: PosDepth[]; waiver: Model['waiverAt'];
}) {
  const o = outcomeFor(c, dynasty);
  const vd = VERDICT[o];
  const pct = moved ? Math.round((l.net / moved) * 100) : 0;
  const valueTone = l.net > c.band ? GOOD : l.net < -c.band ? BAD : dim(0.62);
  const ptsTone = (x: number) => (x >= 0.5 ? GOOD : x <= -0.5 ? BAD : dim(0.62));
  return (
    <div className={'fb-sc is-' + o}>
      <div className="fb-sc-head">
        {avatar ? <img className="fb-sc-face" src={avatar} alt="" /> : <span className="fb-sc-face fb-face-blank" />}
        <span className="fb-sc-who">
          <span className={'fb-sc-name' + (l.isMe ? ' is-me' : '')}>{l.name}</span>
          <span className="fb-sc-sit">{SITUATION_ICON[c.situation]} {situationLabel(c.situation, dynasty)}</span>
        </span>
        <span className={'fb-sc-verdict is-' + o}>{vd.mark} {l.isMe ? vd.you : vd.them}</span>
      </div>

      {/* The share of what the deal moves, and nothing else. It used to read
          "+5 · +3%": two numbers glued together, the first in a currency with
          no name and no scale anywhere on the card — five of something, against
          players worth six thousand of it — and the second a percentage of
          something unstated. The share is the one that means anything, and it
          is the unit the verdict above is already decided in: even is inside
          four per cent. */}
      <Meter icon="💰" label="Value" share={moved ? l.net / moved : 0} tone={valueTone}
        text={moved ? sign(pct, 0) + '%' : '—'} />
      {c.perWeek != null ? (
        <Meter icon="📈" label="Season" share={c.perWeek / PTS_FULL} tone={ptsTone(c.perWeek)}
          text={sign(c.perWeek) + ' pts/wk'} />
      ) : null}
      {c.playoffs != null ? (
        <Meter icon="🏆" label="Playoffs" share={c.playoffs / PTS_FULL} tone={ptsTone(c.playoffs)}
          text={sign(c.playoffs) + ' pts/wk'} />
      ) : null}

      {(() => {
        /* The bye cost is already inside the Season bar; the chip says how
           much of that bar it is, as points like everything else here. */
        const bye = season && Math.abs(season.thinner) >= 0.3 ? season.thinner : 0;
        const any = season?.byes.length || season?.injured.length || l.cuts.length || depth.length || bye;
        return any ? (
          <div className="fb-sc-tags">
            {depth.map(x => {
              const chip = depthChip(x);
              /* A hole is only as bad as the waiver wire: with a free agent
                 near starter level it is a pickup, said in grey, with his name. */
              const fa = x.state === 'stacked' ? null : waiver(x.pos);
              const easy = !!fa?.easy;
              return (
                <span key={'d' + x.pos} className={'fb-tag' + (x.state === 'stacked' || easy ? '' : ' is-bad')}
                  title={fa ? 'Best on waivers: ' + fa.name + ', ' + fa.ppg.toFixed(1) + ' pts/wk' : undefined}>
                  {easy ? '🔄' : chip.icon} <b>{chip.pos}</b> {chip.text}
                  {fa ? (easy
                    ? <> · waivers: {fa.name} <b>{fa.ppg.toFixed(1)}</b></>
                    : <> · waivers best <b>{fa.ppg.toFixed(1)}</b></>) : null}
                </span>
              );
            })}
            {season?.byes.map(b => (
              <span key={'b' + b.week} className="fb-tag" title={'Bye week ' + b.week}>
                💤 Bye <b>W{b.week}</b> {b.names.join(', ')}
              </span>
            ))}
            {bye ? (
              <span className={'fb-tag' + (bye > 0 ? ' is-bad' : ' is-good')}
                title="Points the bye weeks take from the lineup, versus before the trade">
                💤 Bye holes <b>{bye > 0 ? '−' : '+'}{Math.abs(bye).toFixed(1)} pts/wk</b>
              </span>
            ) : null}
            {season?.injured.map(i => (
              <span key={'i' + i.name} className="fb-tag is-bad" title={i.status}>
                🩹 {i.name} <b>{injuryCode(i.status)}</b>
              </span>
            ))}
            {/* The spot, not the man: nobody drops the player a model picked for them. */}
            {l.cuts.length ? (
              <span className="fb-tag is-bad" title="Roster full: a spot has to come from somewhere">
                ✂️ Roster full · <b>{l.cuts.length}</b> to drop
              </span>
            ) : null}
          </div>
        ) : null;
      })()}
    </div>
  );
}

/** Points a week that fill the bar: a starter's worth of difference. */
const PTS_FULL = 6;

/** A bar that grows from the centre toward gain or loss. */
function Meter({ icon, label, share, tone, text }: {
  icon: string; label: string; share: number; tone: string; text: string;
}) {
  const s = Math.max(-1, Math.min(1, share));
  return (
    <div className="fb-meter">
      <span className="fb-meter-icon" aria-hidden="true">{icon}</span>
      <span className="fb-meter-label">{label}</span>
      <span className="fb-meter-track">
        <span className="fb-meter-mid" />
        <span
          className="fb-meter-fill"
          style={{ background: tone, left: s >= 0 ? '50%' : (50 + s * 50) + '%', width: Math.abs(s) * 50 + '%' }}
        />
      </span>
      <span className="fb-meter-num" style={{ color: tone }}>{text}</span>
    </div>
  );
}

const injuryCode = (s: string) => {
  const k = s.toLowerCase();
  return k === 'questionable' ? 'Q' : k === 'doubtful' ? 'D' : k === 'out' ? 'OUT' : s.toUpperCase();
};

/** The rules behind the cards, folded away: one glance each. */
function HowJudged() {
  const [open, setOpen] = useState(false);
  return (
    <div className="fb-how">
      <button type="button" className="fb-more" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        ⓘ How it’s judged
      </button>
      {open ? (
        <div className="fb-how-list">
          <span>🔥 Contending → this season’s points decide</span>
          <span>🌱 Building → value decides</span>
          <span>⚖️ In the hunt → needs both</span>
          <span>⭐ One star &gt; two pieces that add up to him</span>
          <span>⚠️ 📚 Depth after the deal → can he spare them, is the return any use</span>
          <span>The line under each card is the roster the deal leaves, and what the weeks nobody plays take out of the rows above it</span>
          <span>✂️ Full roster → a dropped player’s worth counts against, priced at the cheapest spare</span>
          <span>💤 🩹 Byes and injuries score 0 · 🏆 playoff weeks ×1.5</span>
          <span>🔄 Holes are filled from waivers: an easy pickup costs little</span>
          <span>💰 Value → the share of everything the deal moves</span>
          <span>= Even inside ±4% of that, or ±0.5 pts a week</span>
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
