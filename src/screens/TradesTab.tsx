import { useState } from 'react';
import { BAD, GOOD, MID } from '../model/constants';
import { num } from '../model/math';
import type { BlockReturn, Model, Offer, SavedTrade, TradeAsset } from '../model/types';
import type { App } from '../state/useApp';
import { clockTime, ord } from '../ui/format';
import { PlayerSearch } from '../ui/PlayerSearch';
import { Card, Empty, Screen, Segmented, type SegOption } from '../ui/primitives';
import { cardNote, cardTitle, dim, ellipsis } from '../ui/styles';

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
  const views: SegOption<'suggested' | 'block' | 'saved'>[] = [
    { key: 'suggested', label: 'Suggested' },
    { key: 'block', label: app.block.length ? `Block · ${app.block.length}` : 'Block' },
    { key: 'saved', label: app.saved.length ? `Shortlist · ${app.saved.length}` : 'Shortlist' },
  ];

  return (
    <Screen>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        background: 'var(--color-surface)', borderRadius: 11, padding: '11px 12px',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: badgeColor }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: badgeColor, flex: 'none' }} />
            <span style={ellipsis}>{badge}</span>
          </div>
          <div style={{ fontSize: 10.5, color: dim(0.4), marginTop: 4 }}>
            Data from {clockTime(app.syncedAt || Date.now())} · rosters, traded picks and market
          </div>
        </div>
        <button
          type="button"
          onClick={() => void app.refreshAll()}
          disabled={app.syncing}
          className="btn btn-secondary"
          style={{ borderRadius: 9, padding: '7px 11px', fontSize: 12, flex: 'none' }}
        >
          {app.syncing ? 'Updating…' : 'Update now'}
        </button>
      </div>

      {/* Look a player up before you offer for him: the price comes first,
          then his rank at the position and what he would do for your lineup. */}
      <PlayerSearch app={app} m={m} placeholder="Look up any player's value" />

      <Segmented options={views} value={app.tradeView} onChange={app.setTradeView} size="sm" />

      {app.tradeView === 'saved' ? (
        <Shortlist app={app} m={m} />
      ) : app.tradeView === 'block' ? (
        <Block app={app} m={m} />
      ) : (
        <>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5), textWrap: 'pretty' }}>
            {m.offers.length === 1 ? '1 trade' : m.offers.length + ' trades'} simulated with your bench and your picks —
            never with your starters. Some raise your lineup immediately; others turn pieces that never play into draft capital.
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
                <button type="button" onClick={app.resetOffers} className="btn btn-secondary" style={{ borderRadius: 9 }}>
                  Recalculate
                </button>
              }
            />
          ) : null}

          <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(0.33), textWrap: 'pretty' }}>
            Every offer is simulated: your optimal lineup and theirs are recomputed with the swap applied. An offer only shows
            up if you gain and the other manager would plausibly accept — rookie picks included, on both sides.
          </div>
        </>
      )}
    </Screen>
  );
}

/** Stable across rebuilds of the model, so a saved deal is recognisable later. */
export const offerKey = (o: Offer) => 'offer|' + o.partner + '|' + o.get.id + '|' + o.give.id;

function savedFromOffer(o: Offer): Omit<SavedTrade, 'leagueId' | 'savedAt'> {
  return {
    key: offerKey(o),
    partner: o.partner,
    giveIds: [o.give.id],
    getIds: [o.get.id],
    giveText: o.give.name,
    getText: o.get.name,
    kind: 'offer',
    note: whyMe(o),
    score: o.fit,
  };
}

/**
 * The trades you said you wanted. They are re-checked against live data every
 * time you open this: rosters move, and a shortlist that quietly keeps showing
 * a deal the other manager can no longer make is worse than one that says so.
 */
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
      <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5), textWrap: 'pretty' }}>
        Name the players you would move and the search runs on them — starters
        included. Every offer is still simulated on both sides, so what you see
        is what a rival would plausibly accept.
      </div>

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
              borderTop: i === 0 ? 'none' : '1px solid var(--color-divider)',
            }}
          >
            <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{p.name}</span>
            <span style={{ flex: 'none', fontSize: 11, color: dim(0.42) }}>
              {p.pos}{m.optIds.indexOf(p.id) >= 0 ? ' · starter' : ''}
            </span>
            <button
              type="button"
              onClick={() => app.toggleBlock(p.id)}
              className="btn btn-ghost"
              style={{ flex: 'none', fontSize: 11.5, padding: 0 }}
            >
              Remove
            </button>
          </div>
        )) : (
          <div style={{ fontSize: 12.5, color: dim(0.5) }}>Nobody yet.</div>
        )}

        {adding ? (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--color-divider)', paddingTop: 10 }}>
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
                    borderRadius: 9, padding: '9px 10px', color: 'inherit',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{p.name}</span>
                  <span style={{ flex: 'none', fontSize: 11, color: dim(0.42) }}>
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
  const under = r.edge >= 0;
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ ...cardTitle, ...ellipsis }}>with {r.partner}</div>
        <div style={{ flex: 'none', fontSize: 11, color: r.accept >= 60 ? GOOD : MID }}>
          {r.accept}% they say yes
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...cardNote, marginBottom: 3 }}>You send</div>
          <div style={{ fontSize: 13.5, fontWeight: 500, ...ellipsis }}>{r.send.name}</div>
          <div style={{ fontSize: 10.5, color: dim(0.42) }}>
            {r.send.pos} · {num(r.send.q * 100)} market
          </div>
        </div>
        <div style={{ flex: 'none', color: dim(0.35), fontSize: 15 }}>⇄</div>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
          <div style={{ ...cardNote, marginBottom: 3 }}>You get</div>
          {r.get.map(g => (
            <div key={g.id} style={{ fontSize: 13.5, fontWeight: 500, ...ellipsis }}>{g.name}</div>
          ))}
          <div style={{ fontSize: 10.5, color: dim(0.42) }}>
            {r.get.map(g => g.pos).join(' + ')} · {num(r.back * 100)} market
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.55), marginTop: 10, textWrap: 'pretty' }}>
        {under
          ? `You get back ${Math.round(r.edge * 100)}% more than he is worth.`
          : `You take ${Math.round(-r.edge * 100)}% under his market price.`}
        {' '}
        {/* Losing lineup points is expected when you sell a starter, so it is
            stated rather than buried — that is the cost of the deal. */}
        {r.myGain < -0.1
          ? `Your lineup drops ${(-r.myGain).toFixed(1)} pts this week.`
          : r.myGain > 0.1
            ? `Your lineup still rises ${r.myGain.toFixed(1)} pts.`
            : 'Your lineup is unchanged.'}
        {r.fillsTheirNeed ? ` He lands on ${r.prof.worst}, their weakest spot.` : ''}
      </div>
    </Card>
  );
}

function Shortlist({ app, m }: { app: App; m: Model }) {
  if (!app.saved.length) {
    return (
      <Empty
        title="Nothing on your shortlist yet"
        body={"Tap “I’m interested” on any suggested trade, or open a player and save what it would cost to get him. They stay here until you remove them."}
      />
    );
  }

  const liveOffer = new Set(m.offers.map(offerKey));

  return (
    <>
      <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5), textWrap: 'pretty' }}>
        {app.saved.length === 1 ? '1 trade' : app.saved.length + ' trades'} you marked as interesting. Sleeper has no
        API for sending offers, so propose them there — this is the list to work from.
      </div>

      {app.saved.map(t => {
        const live = t.kind === 'offer'
          ? liveOffer.has(t.key)
          : m.offersFor(t.getIds[0]).some(x => x.give.map(g => g.id).join(',') === t.giveIds.join(','));
        return (
          <Card key={t.key}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ fontSize: 12.5, color: dim(0.55), ...ellipsis }}>
                with <span style={{ color: 'var(--color-text)' }}>{t.partner}</span>
              </div>
              <span style={{
                flex: 'none', fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase',
                padding: '3px 8px', borderRadius: 6,
                background: live ? 'rgba(142,201,168,.16)' : 'rgba(217,160,142,.16)',
                color: live ? GOOD : BAD,
              }}>
                {live ? 'still on' : 'gone'}
              </span>
            </div>

            {/* start, not center: a two-line package on one side would drag its
                own label out of line with the other's. */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 20px 1fr', gap: 8, alignItems: 'start', marginTop: 11 }}>
              <SavedSide label="Receive" color={GOOD} text={t.getText} onOpen={() => app.setDetail(t.getIds[0])} />
              <div style={{ color: dim(0.28), fontSize: 15, textAlign: 'center', paddingTop: 17 }}>⇄</div>
              <SavedSide label="Send" color={BAD} text={t.giveText} onOpen={undefined} />
            </div>

            <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.55), marginTop: 10, textWrap: 'pretty' }}>
              {live
                ? t.note
                : 'The rosters moved since you saved this, so the model no longer builds this exact deal. Open the player to see what he costs now.'}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10 }}>
              <button
                type="button"
                onClick={() => app.unsaveTrade(t.key)}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '4px 0' }}
              >
                Remove
              </button>
              <span style={{ fontSize: 10.5, color: dim(0.35) }}>
                saved {clockTime(t.savedAt)} · {t.kind === 'offer' ? 'fit ' + t.score : t.score + '% they accept'}
              </span>
            </div>
          </Card>
        );
      })}
    </>
  );
}

function SavedSide({ label, color, text, onOpen }: {
  label: string; color: string; text: string; onOpen?: () => void;
}) {
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={onOpen ? e => { if (e.key === 'Enter') onOpen(); } : undefined}
      style={{ cursor: onOpen ? 'pointer' : 'default', minWidth: 0 }}
    >
      <div style={{ fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1.25 }}>{text}</div>
    </div>
  );
}

function OfferCard({ app, offer: o, dynasty }: { app: App; offer: Offer; dynasty: boolean }) {
  const fitTint = o.fit >= 75 ? GOOD : o.fit >= 62 ? MID : dim(0.6);
  const kind = o.edge > 0.04 ? 'Buying under market' : o.edge < -0.04 ? 'Justified overpay' : 'Fair price';
  const kindStyle = o.edge > 0.04
    ? { background: 'rgba(142,201,168,.16)', color: GOOD }
    : o.edge < -0.04
      ? { background: 'rgba(217,160,142,.16)', color: BAD }
      : { background: 'rgba(145,132,217,.18)', color: MID };

  return (
    <div style={{
      background: 'var(--color-surface)', borderRadius: 14, overflow: 'hidden', animation: 'pop .28s ease backwards',
    }}>
      <div style={{ padding: '14px 14px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, color: dim(0.55), ...ellipsis }}>
            with <span style={{ color: 'var(--color-text)' }}>{o.partner}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 'none' }}>
            <span style={{
              fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase',
              padding: '3px 8px', borderRadius: 6, ...kindStyle,
            }}>
              {kind}
            </span>
            <span style={{
              fontSize: 12.5, fontWeight: 500, padding: '2px 9px', borderRadius: 7,
              color: fitTint, border: '1px solid ' + fitTint + '55', background: fitTint + '18',
            }}>
              {o.fit}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 20px 1fr', gap: 8, alignItems: 'center' }}>
          <Side
            label="Receive"
            color={GOOD}
            asset={o.get}
            onOpen={o.get.isPick ? undefined : () => app.setDetail(o.get.id)}
          />
          <div style={{ color: dim(0.28), fontSize: 15, textAlign: 'center' }}>⇄</div>
          <Side
            label="Send"
            color={BAD}
            asset={o.give}
            onOpen={o.give.isPick ? undefined : () => app.setDetail(o.give.id)}
          />
        </div>

        <div style={{ fontSize: 12, fontWeight: 500, color: GOOD, marginTop: 12 }}>
          {o.kind === 'capital'
            ? `${o.gain >= 0 ? '+' : ''}${num(o.gain * 100)} in market value`
            : `${o.gain >= 0 ? '+' : ''}${o.gain.toFixed(1)} lineup pts`}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.55), marginTop: 4, textWrap: 'pretty' }}>
          {whyMe(o)}
        </div>

        <div style={{ marginTop: 10, padding: '10px 11px', borderRadius: 9, background: 'rgba(233,233,237,.04)' }}>
          <div style={{
            fontSize: 9.5, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.4), marginBottom: 5,
          }}>
            Why it works for them
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.6), textWrap: 'pretty' }}>{whyThem(o, dynasty)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', borderTop: '1px solid var(--color-divider)' }}>
        <button
          type="button"
          className="ghost-tap"
          onClick={() => app.passOffer(o.partner + o.get.id)}
          style={{
            flex: 1, textAlign: 'center', padding: 12, fontSize: 13, color: dim(0.5),
            background: 'transparent', border: 0, cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
        <div style={{ width: 1, background: 'var(--color-divider)' }} />
        <button
          type="button"
          className="accent-tap"
          onClick={() => app.toggleSaved(savedFromOffer(o))}
          aria-pressed={app.isSaved(offerKey(o))}
          style={{
            flex: 1, textAlign: 'center', padding: 12, fontSize: 13, fontWeight: 500,
            color: app.isSaved(offerKey(o)) ? GOOD : 'var(--color-accent)',
            background: 'transparent', border: 0, cursor: 'pointer',
          }}
        >
          {app.isSaved(offerKey(o)) ? '✓ On your shortlist' : "I'm interested"}
        </button>
      </div>
    </div>
  );
}

function Side({
  label, color, asset, onOpen,
}: {
  label: string; color: string; asset: TradeAsset; onOpen?: () => void;
}) {
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={onOpen ? e => { if (e.key === 'Enter') onOpen(); } : undefined}
      style={{ cursor: onOpen ? 'pointer' : 'default' }}
    >
      <div style={{
        fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color, marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1.25 }}>{asset.name}</div>
      <div style={{ fontSize: 10.5, color: dim(0.42), marginTop: 2 }}>{assetMeta(asset)}</div>
      <div style={{ fontSize: 10.5, color: dim(0.3), marginTop: 3 }}>{num(asset.q * 100)} market</div>
    </div>
  );
}

/** Overpaying is fine when the lineup jump pays for it; buying cheap is fine
 *  when they would still say yes. The copy has to say which one this is. */
function whyMe(o: Offer): string {
  const base = o.edge < -0.02
    ? `You pay ${Math.round(-o.edge * 100)}% over market, and it is worth it: your lineup rises ${o.gain.toFixed(1)} pts.`
    : o.edge > 0.02
      ? `You buy ${Math.round(o.edge * 100)}% under market` +
        (o.kind === 'lineup' ? ` and it still lifts your lineup ${o.gain.toFixed(1)} pts.` : '.')
      : 'Even money at market price' + (o.kind === 'lineup' ? `, with +${o.gain.toFixed(1)} pts for your lineup.` : '.');
  return base + (o.give.isPick ? ' You send draft capital, not players from your lineup.' : '');
}

function whyThem(o: Offer, dynasty: boolean): string {
  // "Rebuilding" needs a next season to build toward, and redraft has none.
  const window = o.prof.window === 'contender' ? 'They are going for the title now'
    : o.prof.window === 'rebuild'
      ? (dynasty ? 'They are rebuilding' : 'They are out of the race')
      : 'They are mid-table';
  const need = o.fillsTheirNeed
    ? `It lands right on ${o.prof.worst}, their weakest position. `
    : o.prof.worst ? `Their real hole is ${o.prof.worst}. ` : '';
  const outcome = o.theirGain > 0.3
    ? `Their lineup rises ${o.theirGain.toFixed(1)}.`
    : o.give.isPick
      ? `Their lineup drops ${o.theirGain.toFixed(1)}, but they take ${Math.round(-o.edge * 100)}% extra value in future capital — which is exactly what a team with nothing to play for wants.`
      : `Their lineup barely moves (${o.theirGain.toFixed(1)}), so they take it on market value.`;
  return `${window} (${ord(o.prof.rank)} in value, age ${o.prof.avgAge.toFixed(1)}). ${need}${outcome}`;
}
