import { useEffect, useMemo } from 'react';
import { ACCENT, BAD, GOOD } from '../model/constants';
import { playerName } from '../model/math';
import { readLeagueTrades, tradeOutcome, type LeagueTrade, type TradeLookup, type TradeMove } from '../model/league-trades';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { Card, Empty } from '../ui/primitives';
import { cardNote, dim, ellipsis } from '../ui/styles';

/**
 * Every trade the league has made this season, newest first, with a verdict.
 *
 * The same engine that judges a trade you are building judges these — see
 * `model/trade-eval` — so the number on a finished deal and the number on a
 * proposed one mean the same thing. The difference is only what it is priced
 * at: a finished trade is scored at TODAY'S market, because "was it fair at
 * the time" is already answered by both managers having said yes.
 */
export function LeagueTrades({ app, m }: { app: App; m: Model }) {
  const upTo = app.week || 18;
  useEffect(() => { void app.fetchTrades(upTo); }, [app.fetchTrades, upTo]);

  const players = app.data?.players;
  const trades = useMemo(() => {
    const look: TradeLookup = {
      player: id => {
        const pl = players?.[id];
        // Not in the catalog at all: we do not know what he is worth, which is
        // a different answer from "nothing".
        if (!pl) return null;
        const v = m.marketValue(id);
        return {
          name: playerName(pl),
          note: [pl.position, pl.team || 'FA'].filter(Boolean).join(' · '),
          // `marketValue` covers the four skill positions. A kicker or a
          // defence is priced at nothing ON PURPOSE — that is what they fetch
          // — so they are priced, not unknown, and a trade with one in it
          // still gets a verdict.
          value: v ? v.pts : 0,
          priced: true,
        };
      },
      pick: (season, round, origin) => {
        const p = m.pickWorth(season, round, origin);
        if (!p) return null;
        return {
          name: p.name,
          note: p.label,
          // `q` is the internal scale and `marketValue.pts` is that scale ×100.
          // Two currencies in one ledger would price every pick at a hundredth
          // of a player.
          value: p.q * 100,
          priced: true,
        };
      },
      teamName: rid => m.leagueRows.find(r => r.id === rid)?.name || 'Team ' + rid,
      isMe: rid => !!m.leagueRows.find(r => r.id === rid)?.isMe,
    };
    return readLeagueTrades(app.transactions, look);
  }, [app.transactions, m, players]);

  if (app.tradeLogState === 'loading' && !trades.length) {
    return <div style={{ ...cardNote, padding: '4px 2px' }}>Reading the league&apos;s transactions…</div>;
  }
  if (app.tradeLogState === 'fail') {
    return <div style={{ ...cardNote, padding: '4px 2px' }}>Sleeper did not return this league&apos;s transactions.</div>;
  }
  if (!trades.length) {
    return (
      <Empty
        title="No trades yet this season"
        body="Nothing has changed hands in this league since week one. Every trade the league makes shows up here with a verdict."
      />
    );
  }

  const mine = trades.filter(t => t.sides.some(s => s.isMe)).length;

  return (
    <>
      <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5), textWrap: 'pretty' }}>
        {trades.length === 1 ? '1 trade' : trades.length + ' trades'} this season
        {mine ? ', ' + mine + ' of them yours' : ''}. Judged at today&apos;s market, not the market on the day
        — whether a deal was fair when it was made is answered by both managers having accepted it. A pick is
        worth what its round fetches now, including one already spent in a draft.
      </div>
      {trades.map(t => <TradeCard key={t.id} t={t} />)}
    </>
  );
}

const WHEN = (at: number) => (at
  ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  : '');

function TradeCard({ t }: { t: LeagueTrade }) {
  const winner = t.verdict?.winner || null;
  const tone = !winner ? dim(0.5) : winner.isMe ? GOOD : ACCENT;

  return (
    <Card>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
        fontSize: 10.5, color: dim(0.4),
      }}>
        <span>{t.week ? 'Week ' + t.week : 'Preseason'}</span>
        <span>{WHEN(t.at)}</span>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 500, color: tone, marginTop: 4, textWrap: 'pretty' }}>
        {tradeOutcome(t)}
      </div>
      {/* Said out loud where it changes the number, rather than quietly. */}
      {t.faab && t.verdict ? (
        <div style={{ fontSize: 10, color: dim(0.35), marginTop: 3 }}>
          waiver budget not counted
        </div>
      ) : null}

      {/* A column per team saying what it walked away with. Columns rather than
          "gives / gets": sides only exist when there are two of them, and a
          three-team trade is one more column. */}
      <div style={{
        display: 'grid', gap: 10, marginTop: 10,
        gridTemplateColumns: 'repeat(' + Math.min(t.sides.length, 2) + ', minmax(0, 1fr))',
      }}>
        {t.sides.map(s => (
          <div key={s.id}>
            <div style={{
              fontSize: 11, fontWeight: 500, marginBottom: 5,
              color: s.isMe ? 'var(--color-accent)' : 'var(--color-text)', ...ellipsis,
            }}>
              {s.name} {s.isMe ? 'get' : 'gets'}
            </div>
            {s.got.length
              ? s.got.map(mv => <Piece key={mv.id} mv={mv} />)
              : <div style={{ fontSize: 11, color: dim(0.33) }}>nothing</div>}
            {s.net != null ? (
              <div style={{
                fontSize: 10, marginTop: 5,
                color: s.net > 0 ? GOOD : s.net < 0 ? BAD : dim(0.4),
              }}>
                {(s.net > 0 ? '+' : s.net < 0 ? '−' : '') + Math.abs(Math.round(s.net)) + ' in value'}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Piece({ mv }: { mv: TradeMove }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 11.5, ...ellipsis }}>{mv.name}</div>
      {mv.note ? <div style={{ fontSize: 9.5, color: dim(0.35), ...ellipsis }}>{mv.note}</div> : null}
    </div>
  );
}
