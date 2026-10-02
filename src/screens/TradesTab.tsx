import { useState } from 'react';
import { returnLine, whyMe, whyThem } from '../model/offer-copy';
import { BAD, GOOD, MID } from '../model/constants';
import { num } from '../model/math';
import type { BlockReturn, Model, Offer, TradeAsset } from '../model/types';
import { isWinWin } from '../model/team-verdict';
import type { App } from '../state/useApp';
import { clockTime } from '../ui/format';
import { PlayerSearch } from '../ui/PlayerSearch';
import { Card, Empty, Face, Screen, Segmented, type SegOption } from '../ui/primitives';
import type { PhotoSet } from '../api/sleeper';
import { cardNote, cardTitle, dim, ellipsis } from '../ui/styles';
import { TradeBuilder } from './TradeBuilder';
import { LeagueTrades } from './LeagueTrades';

const assetMeta = (a: TradeAsset): string =>
  a.isPick
    ? `Rookie pick · ${a.season} · round ${a.round}`
    : `${a.pos} · ${a.age ?? '?'} yrs · ${a.team}`;

export function TradesTab({ app, m }: { app: App; m: Model }) {
  const badge = app.marketState === 'ok'
    ? `Market live · ${m.marketCount} assets`
    : app.marketState === 'loading' ? 'Loading market values…'
      : 'No market feed: using the ranking and age model';
  const badgeColor = app.marketState === 'ok' ? GOOD : app.marketState === 'fail' ? BAD : MID;

  const visible = m.offers.filter(o => app.passed.indexOf(o.partner + o.get.id) < 0).slice(0, 6);
  const views: SegOption<'suggested' | 'block' | 'build' | 'league'>[] = [
    { key: 'suggested', label: 'Suggested' },
    { key: 'build', label: 'Build' },
    { key: 'league', label: 'League' },
    { key: 'block', label: app.block.length ? `Block · ${app.block.length}` : 'Block' },
  ];

  return (
    <Screen>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        background: 'var(--color-surface)', borderRadius: 12, padding: '11px 12px',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: badgeColor }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: badgeColor, flex: 'none' }} />
            <span style={ellipsis}>{badge}</span>
          </div>
          <div style={{ fontSize: 10, color: dim(0.52), marginTop: 4 }}>
            Data from {clockTime(app.syncedAt || Date.now())} · rosters, traded picks and market
          </div>
        </div>
        <button
          type="button"
          onClick={() => void app.refreshAll()}
          disabled={app.syncing}
          className="btn btn-secondary"
          style={{ borderRadius: 8, padding: '7px 11px', fontSize: 12, flex: 'none' }}
        >
          {app.syncing ? 'Updating…' : 'Update now'}
        </button>
      </div>

      {/* Look a player up before you offer for him: the price comes first,
          then his rank at the position and what he would do for your lineup. */}
      {/* Chips as well as a name box: this is the only player list in the app
          you could not browse, and a position is the way people scan one. */}
      <PlayerSearch app={app} m={m} placeholder="Look up any player's value" byPos />

      <Segmented options={views} value={app.tradeView} onChange={app.setTradeView} size="sm" />

      {app.tradeView === 'build' ? (
        <TradeBuilder app={app} m={m} />
      ) : app.tradeView === 'league' ? (
        <LeagueTrades app={app} m={m} />
      ) : app.tradeView === 'block' ? (
        <Block app={app} m={m} />
      ) : (
        <>
          <div style={{ fontSize: 12, color: dim(0.62) }}>
            {m.offers.length === 1 ? '1 trade' : m.offers.length + ' trades'}
          </div>

          {visible.map(o => (
            <OfferCard key={o.partner + o.get.id} app={app} offer={o} dynasty={m.isDynasty} />
          ))}

          {m.offers.length === 0 ? (
            <Empty
              title="No clear trades today"
              body={'No bench piece of yours improves your lineup without the other manager losing value. Check back after the '
                + (m.isDynasty ? 'rookie draft.' : 'draft.')}
              action={
                <button type="button" onClick={app.resetOffers} className="btn btn-secondary" style={{ borderRadius: 8 }}>
                  Recalculate
                </button>
              }
            />
          ) : null}

        </>
      )}
    </Screen>
  );
}

/**
 * The players you have put up for trade, and what the league would give back.
 *
 * The suggestions never touch a starter — the app should not propose taking
 * your lineup apart on its own. Here you have already decided, so the search
 * runs on exactly the men you named and is allowed to cost you lineup points
 * if the return is worth it. Those points are shown either way.
 */
function Block({ app, m }: { app: App; m: Model }) {
  const [adding, setAdding] = useState(false);
  const shopping = m.myPlayers.filter(p => app.isOnBlock(p.id));
  const rest = m.myPlayers.filter(p => !app.isOnBlock(p.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
          <div style={cardTitle}>On the block</div>
          <button
            type="button"
            onClick={() => setAdding(!adding)}
            aria-expanded={adding}
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: 0 }}
          >
            {adding ? 'Done' : 'Add a player ›'}
          </button>
        </div>

        {shopping.length ? shopping.map((p, i) => (
          <div
            key={p.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
              paddingTop: i === 0 ? 0 : 9, marginTop: i === 0 ? 0 : 9,
              borderTop: i === 0 ? 'none' : 'var(--hairline) solid var(--color-divider)',
            }}
          >
            <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{p.name}</span>
            <span style={{ flex: 'none', fontSize: 10, color: dim(0.52) }}>
              {p.pos}{m.optIds.indexOf(p.id) >= 0 ? ' · starter' : ''}
            </span>
            <button
              type="button"
              onClick={() => app.toggleBlock(p.id)}
              className="btn btn-ghost"
              style={{ flex: 'none', fontSize: 12, padding: 0 }}
            >
              Remove
            </button>
          </div>
        )) : (
          <div style={{ fontSize: 12, color: dim(0.62) }}>Nobody yet.</div>
        )}

        {adding ? (
          <div style={{ marginTop: 10, borderTop: 'var(--hairline) solid var(--color-divider)', paddingTop: 10 }}>
            <div style={{ ...cardNote, marginBottom: 8 }}>Tap anyone from your roster.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260, overflow: 'auto' }}>
              {rest.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => app.toggleBlock(p.id)}
                  className="row-tap"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, font: 'inherit', fontSize: 13,
                    textAlign: 'left', cursor: 'pointer', background: 'transparent', border: 0,
                    borderRadius: 8, padding: '9px 10px', color: 'inherit',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{p.name}</span>
                  <span style={{ flex: 'none', fontSize: 10, color: dim(0.52) }}>
                    {p.pos}{m.optIds.indexOf(p.id) >= 0 ? ' · starter' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {!shopping.length ? null : m.blockOffers.length ? (
        m.blockOffers.slice(0, 8).map(o => (
          <ReturnCard key={o.partner + o.send.id + o.get.map(g => g.id).join('+')} r={o} />
        ))
      ) : (
        <Empty
          title="Nothing came back"
          body="No manager in the league can pay for them without losing value themselves. Add another name, or check back once rosters move."
        />
      )}
    </div>
  );
}

/** One return: who pays, what comes back, and what it does to your lineup. */
function ReturnCard({ r }: { r: BlockReturn }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ ...cardTitle, ...ellipsis }}>with {r.partner}</div>
        <div style={{ flex: 'none', fontSize: 10, color: r.accept >= 60 ? GOOD : MID }}>
          {r.accept}% they say yes
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...cardNote, marginBottom: 3 }}>You send</div>
          <div style={{ fontSize: 13, fontWeight: 500, ...ellipsis }}>{r.send.name}</div>
          <div style={{ fontSize: 10, color: dim(0.52) }}>
            {r.send.pos} · {num(r.send.q * 100)} market
          </div>
        </div>
        <div style={{ flex: 'none', color: dim(0.52), fontSize: 15 }}>⇄</div>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
          <div style={{ ...cardNote, marginBottom: 3 }}>You get</div>
          {r.get.map(g => (
            <div key={g.id} style={{ fontSize: 13, fontWeight: 500, ...ellipsis }}>{g.name}</div>
          ))}
          <div style={{ fontSize: 10, color: dim(0.52) }}>
            {r.get.map(g => g.pos).join(' + ')} · {num(r.back * 100)} market
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12, lineHeight: '18px', color: dim(0.75), marginTop: 10, textWrap: 'pretty' }}>
        {returnLine({ edge: r.edge, myGain: r.myPts, fillsTheirNeed: r.fillsTheirNeed, worst: r.prof.worst, sendName: r.send.name })}
      </div>
    </Card>
  );
}



function OfferCard({ app, offer: o, dynasty }: { app: App; offer: Offer; dynasty: boolean }) {
  const fitTint = o.fit >= 75 ? GOOD : o.fit >= 62 ? MID : dim(0.75);
  /* Both lineups better off — see `isWinWin`. It leads, because it is the
     strongest thing that can be said about a proposal: a deal the other
     manager also gets better from is the one that gets accepted. */
  const winWin = isWinWin(o.ptsGain ?? o.gain, o.theirPtsGain ?? o.theirGain);
  const kind = o.edge > 0.04 ? 'Buying under market'
    : o.edge < -0.04 ? (o.kind === 'lineup' && (o.ptsGain ?? 0) > 0.3 ? 'Overpay that helps you' : 'Overpay') : 'Fair price';
  const gain = o.kind === 'capital' || o.ptsGain == null
    ? `${o.gain >= 0 ? '+' : ''}${num(o.gain * 100)} ${o.kind === 'capital' ? 'market value' : 'lineup quality'}`
    : `${o.ptsGain >= 0 ? '+' : '−'}${Math.abs(o.ptsGain).toFixed(1)} pts a week`;

  return (
    <div className="of">
      {/* The partner is what the trade is WITH, so it is the heading. It used
          to share the line with two filled chips and be the thing that got
          truncated for them. */}
      <div className="of-head">
        <div className="of-with">{o.partner}</div>
        <div className="of-fit" style={{ color: fitTint }}>{o.fit}</div>
      </div>
      <div className="of-verdict" style={{ color: dim(0.62) }}>
        {winWin ? <><span className="of-ww">Win-win</span> · </> : null}
        {kind} · <span className="of-gain">{gain}</span>
      </div>

      <div className="of-sides">
        <Side
          label="Receive"
          color={GOOD}
          asset={o.get}
          photo={o.get.isPick ? undefined : app.photoSet(o.get.id)}
          onOpen={o.get.isPick ? undefined : () => app.setDetail(o.get.id)}
        />
        <div className="of-swap">⇄</div>
        <Side
          label="Send"
          color={BAD}
          asset={o.give}
          align="right"
          photo={o.give.isPick ? undefined : app.photoSet(o.give.id)}
          onOpen={o.give.isPick ? undefined : () => app.setDetail(o.give.id)}
        />
      </div>

      <div className="of-why">{whyMe(o)}</div>
      <div className="of-why"><b>For them:</b> {whyThem(o, dynasty)}</div>

      <div className="of-acts">
        <button
          type="button"
          className="of-act ghost-tap"
          onClick={() => app.passOffer(o.partner + o.get.id)}
        >
          Not interested
        </button>
      </div>
    </div>
  );
}

function Side({
  label, color, asset, onOpen, align, photo,
}: {
  label: string; color: string; asset: TradeAsset; onOpen?: () => void; align?: 'right';
  photo?: PhotoSet;
}) {
  return (
    <div
      className={'of-side' + (align ? ' is-right' : '')}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={onOpen ? e => { if (e.key === 'Enter') onOpen(); } : undefined}
      style={{ cursor: onOpen ? 'pointer' : 'default' }}
    >
      <div className="of-k" style={{ color }}>{label}</div>
      {!asset.isPick && photo ? (
        <div className="of-face"><Face {...photo} pos={asset.pos} size={44} round /></div>
      ) : null}
      <div className="of-name">{asset.name}</div>
      <div className="of-meta">{assetMeta(asset)}</div>
      {/* "market" said once, in the verdict above, rather than after each of
          two figures that are obviously the same kind of thing. */}
      <div className="of-meta">{num(asset.q * 100)}</div>
    </div>
  );
}
