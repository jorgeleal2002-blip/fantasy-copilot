import { BAD, GOOD, MID } from '../model/constants';
import { num } from '../model/math';
import type { Model, Offer, SavedTrade, TradeAsset } from '../model/types';
import type { App } from '../state/useApp';
import { clockTime, ord } from '../ui/format';
import { PlayerSearch } from '../ui/PlayerSearch';
import { Card, Empty, Screen, Segmented, type SegOption } from '../ui/primitives';
import { dim, ellipsis } from '../ui/styles';

const assetMeta = (a: TradeAsset): string =>
  a.isPick
    ? `Rookie pick · ${a.season} · round ${a.round}`
    : `${a.pos} · ${a.age ?? '?'} yrs · ${a.team}`;

export function TradesTab({ app, m }: { app: App; m: Model }) {
  const badge = app.marketState === 'ok'
    ? `Market live · ${m.marketCount} assets`
    : app.marketState === 'loading' ? 'Loading market values…'
      : 'No market feed: using the ADP and age model';
  const badgeColor = app.marketState === 'ok' ? GOOD : app.marketState === 'fail' ? BAD : MID;

  const visible = m.offers.filter(o => app.passed.indexOf(o.partner + o.get.id) < 0).slice(0, 6);
  const views: SegOption<'suggested' | 'saved'>[] = [
    { key: 'suggested', label: 'Suggested' },
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
      ) : (
        <>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5), textWrap: 'pretty' }}>
            {m.offers.length === 1 ? '1 trade' : m.offers.length + ' trades'} simulated with your bench and your picks —
            never with your starters. Some raise your lineup immediately; others turn pieces that never play into draft capital.
          </div>

          {visible.map(o => (
            <OfferCard key={o.partner + o.get.id} app={app} offer={o} />
          ))}

          {m.offers.length === 0 ? (
            <Empty
              title="No clear trades today"
              body="No bench piece of yours improves your lineup without the other manager losing value. Check back after the rookie draft."
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

function OfferCard({ app, offer: o }: { app: App; offer: Offer }) {
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
          <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.6), textWrap: 'pretty' }}>{whyThem(o)}</div>
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

function whyThem(o: Offer): string {
  const window = o.prof.window === 'contender' ? 'They are going for the title now'
    : o.prof.window === 'rebuild' ? 'They are rebuilding' : 'They are mid-table';
  const need = o.fillsTheirNeed
    ? `It lands right on ${o.prof.worst}, their weakest position. `
    : o.prof.worst ? `Their real hole is ${o.prof.worst}. ` : '';
  const outcome = o.theirGain > 0.3
    ? `Their lineup rises ${o.theirGain.toFixed(1)}.`
    : o.give.isPick
      ? `Their lineup drops ${o.theirGain.toFixed(1)}, but they take ${Math.round(-o.edge * 100)}% extra value in future capital — which is exactly what a rebuild wants.`
      : `Their lineup barely moves (${o.theirGain.toFixed(1)}), so they take it on market value.`;
  return `${window} (${ord(o.prof.rank)} in value, age ${o.prof.avgAge.toFixed(1)}). ${need}${outcome}`;
}
