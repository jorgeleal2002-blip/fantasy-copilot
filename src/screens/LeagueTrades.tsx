import { useEffect, useMemo, useState } from 'react';
import { ACCENT, BAD, GOOD } from '../model/constants';
import { playerName } from '../model/math';
import {
  readLeagueTrades, sideRead, tradeOutcome,
  type LeagueTrade, type TradeLookup, type TradeMove, type TradeSide,
} from '../model/league-trades';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { ord } from '../ui/format';
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
          // Read against the receiving team's thinnest position — see `sideRead`.
          pos: pl.position || '',
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
      {/* Judged at today's market rather than the market on the day: whether a
          deal was fair when it was made is answered by both managers having
          accepted it. */}
      <div style={{ fontSize: 12, color: dim(0.62) }}>
        {trades.length === 1 ? '1 trade' : trades.length + ' trades'} this season
        {mine ? ', ' + mine + ' yours' : ''}
      </div>
      {trades.map(t => <TradeCard key={t.id} app={app} m={m} t={t} />)}
    </>
  );
}

const WHEN = (at: number) => (at
  ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  : '');

function TradeCard({ app, m, t }: { app: App; m: Model; t: LeagueTrade }) {
  const [open, setOpen] = useState(false);
  const winner = t.verdict?.winner || null;
  const tone = !winner ? dim(0.62) : winner.isMe ? GOOD : ACCENT;

  return (
    <Card>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
        fontSize: 10, color: dim(0.52),
      }}>
        <span>{t.week ? 'Week ' + t.week : 'Preseason'}</span>
        <span>{WHEN(t.at)}</span>
      </div>

      <div style={{ fontSize: 12, fontWeight: 500, color: tone, marginTop: 4, textWrap: 'pretty' }}>
        {tradeOutcome(t)}
      </div>
      {/* Said out loud where it changes the number, rather than quietly. */}
      {t.faab && t.verdict ? (
        <div style={{ fontSize: 10, color: dim(0.52), marginTop: 3 }}>
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
              fontSize: 10, fontWeight: 500, marginBottom: 5,
              color: s.isMe ? 'var(--color-accent)' : 'var(--color-text)', ...ellipsis,
            }}>
              {s.name} {s.isMe ? 'get' : 'gets'}
            </div>
            {s.got.length
              ? s.got.map(mv => <Piece key={mv.id} mv={mv} />)
              : <div style={{ fontSize: 10, color: dim(0.52) }}>nothing</div>}
            {s.net != null ? (
              <div style={{
                fontSize: 10, marginTop: 5,
                color: s.net > 0 ? GOOD : s.net < 0 ? BAD : dim(0.52),
              }}>
                {(s.net > 0 ? '+' : s.net < 0 ? '−' : '') + Math.abs(Math.round(s.net)) + ' in value'}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="btn btn-ghost"
        style={{ fontSize: 10, padding: 0, marginTop: 9 }}
      >
        {open ? 'Less' : 'What it did to each team ›'}
      </button>

      {open ? (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {t.sides.map(s => <SideDetail key={s.id} app={app} m={m} t={t} s={s} />)}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * One team's side of a finished trade, read against that team.
 *
 * The lineup number is the piece that needs the roster: it re-picks their best
 * lineup with the trade UNDONE — the pieces they gave put back, the pieces
 * they got taken away — and reports the difference. `lineupWith` gives the
 * current lineup as `before`, so the trade's own effect is `before − after`.
 */
function SideDetail({ app, m, t, s }: { app: App; m: Model; t: LeagueTrade; s: TradeSide }) {
  const row = m.leagueRows.find(r => r.id === s.id);
  // Picks are excluded on purpose: a 2027 first cannot start a game, so
  // counting one here would claim a lineup change that has not arrived.
  const players = (list: TradeMove[]) => list.filter(mv => mv.kind === 'player').map(mv => mv.id.slice(1));
  const undone = m.lineupWith(s.id, players(s.gave), players(s.got));
  const lineup = row && undone.measured ? Math.round((undone.before - undone.after) * 10) / 10 : null;

  const read = sideRead(s, {
    window: row?.window || 'medio',
    worst: row?.worst || null,
    lineup,
  }, t.verdict?.band ?? 0);

  return (
    <div style={{ borderTop: 'var(--hairline) solid var(--color-divider)', paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 10 }}>
        <span style={{
          fontWeight: 500, color: s.isMe ? 'var(--color-accent)' : 'var(--color-text)', ...ellipsis,
        }}>
          {s.name}
        </span>
        <span style={{ fontSize: 10, color: dim(0.52), flex: 'none' }}>
          {[row?.record.label, row ? ord(row.rankNow) + ' in the league' : ''].filter(Boolean).join(' · ')}
        </span>
      </div>

      <div style={{ fontSize: 12, lineHeight: '18px', color: dim(0.9), marginTop: 4, textWrap: 'pretty' }}>
        {read}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
        <Column app={app} label="Gave" list={s.gave} />
        <Column app={app} label="Got" list={s.got} />
      </div>
    </div>
  );
}

/** Tapping a player opens his card, which is what every other list does. */
function Column({ app, label, list }: { app: App; label: string; list: TradeMove[] }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.06em', color: dim(0.52), marginBottom: 3 }}>
        {label.toUpperCase()}
      </div>
      {list.length ? list.map(mv => (
        <div
          key={mv.id}
          role={mv.kind === 'player' ? 'button' : undefined}
          tabIndex={mv.kind === 'player' ? 0 : undefined}
          onClick={mv.kind === 'player' ? () => app.setDetail(mv.id.slice(1)) : undefined}
          onKeyDown={mv.kind === 'player'
            ? e => { if (e.key === 'Enter') app.setDetail(mv.id.slice(1)); }
            : undefined}
          style={{
            fontSize: 10, marginBottom: 2,
            cursor: mv.kind === 'player' ? 'pointer' : undefined, ...ellipsis,
          }}
        >
          {mv.name}
        </div>
      )) : <div style={{ fontSize: 10, color: dim(0.52) }}>—</div>}
    </div>
  );
}

function Piece({ mv }: { mv: TradeMove }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 12, ...ellipsis }}>{mv.name}</div>
      {mv.note ? <div style={{ fontSize: 10, color: dim(0.52), ...ellipsis }}>{mv.note}</div> : null}
    </div>
  );
}
