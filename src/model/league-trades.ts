import type { SleeperTransaction } from '../api/types';
import { evaluateTrade, type TradeVerdict } from './trade-eval';

/**
 * The trades the league actually made, and who won them.
 *
 * Sleeper describes a trade by where every asset lands rather than by sides:
 * `adds` maps a player to the roster receiving him, `drops` to the roster
 * giving him up, and a draft pick carries its previous owner and its new one.
 * That is the same shape the trade engine already takes, so a completed trade
 * and one being built are judged by the same arithmetic — see `trade-eval`.
 *
 * Priced at TODAY'S market, not at the market on the day it was made. That is
 * deliberate and it is the only question worth asking about a finished trade:
 * "was this fair at the time" is answered by the fact that both managers
 * accepted it. What you want to know in November is who is ahead now.
 */

export interface TradeMove {
  kind: 'player' | 'pick' | 'faab';
  /** stable within one trade, used as a render key */
  id: string;
  name: string;
  /** a position and team for a player, a round for a pick */
  note: string;
  from: number;
  to: number;
  value: number;
  /** false when the market has no price for it, which withholds the verdict */
  priced: boolean;
}

export interface TradeSide {
  id: number;
  name: string;
  isMe: boolean;
  got: TradeMove[];
  gave: TradeMove[];
  /** value gained minus value given, or null when the deal is unpriced */
  net: number | null;
}

export interface LeagueTrade {
  id: string;
  week: number;
  /** ms since epoch, for ordering and for the date on the card */
  at: number;
  /** roster ids, in the order Sleeper listed them */
  teams: number[];
  /** what each of them walked away with — the way the card is read */
  sides: TradeSide[];
  moves: TradeMove[];
  /** null when something in the deal has no price — see `unpriced` */
  verdict: TradeVerdict | null;
  /** how many moves the market could not put a number on */
  unpriced: number;
}

/**
 * A priced asset. `priced` is the lookup's own call, not a test on the number:
 * a kicker really is worth nothing on the trade market, and that is a price,
 * while a player the catalog has never heard of has none.
 */
export interface Priced {
  name: string;
  note: string;
  value: number;
  priced: boolean;
}

export interface TradeLookup {
  /** What a player is worth now, and what to call him. Null if unknown. */
  player: (id: string) => Priced | null;
  /** The same for a pick, named by the three things a trade names it by. */
  pick: (season: number, round: number, origin: number) => Priced | null;
  teamName: (rosterId: number) => string;
  isMe: (rosterId: number) => boolean;
}

/** Sleeper marks a trade that went through; a vetoed or pending one has not
 *  happened and does not belong on a list of what the league did. */
const DONE = 'complete';

/**
 * Turn a week of Sleeper transactions into the trades in it.
 *
 * Everything that is not a completed trade is dropped, including the waiver
 * claims and free-agent moves that share the endpoint. A trade whose assets
 * cannot be routed — no `adds`, or a player nobody dropped — is kept with
 * whatever could be read, because a trade missing from a list of trades reads
 * as the app losing it.
 */
export function readLeagueTrades(
  rows: SleeperTransaction[] | null | undefined,
  look: TradeLookup,
): LeagueTrade[] {
  const out: LeagueTrade[] = [];
  for (const t of rows || []) {
    if (!t || t.type !== 'trade' || (t.status && t.status !== DONE)) continue;

    const moves: TradeMove[] = [];
    const adds = t.adds || {};
    const drops = t.drops || {};

    for (const pid of Object.keys(adds)) {
      const to = adds[pid];
      const from = drops[pid];
      // A player who arrives from nowhere is a waiver claim riding in the same
      // payload, not a leg of the trade.
      if (from == null || to == null || from === to) continue;
      const p = look.player(pid);
      moves.push({
        kind: 'player',
        id: 'p' + pid,
        name: p?.name || 'Unknown player',
        note: p?.note || '',
        from, to,
        value: p?.value || 0,
        priced: !!p && p.priced,
      });
    }

    for (const dp of t.draft_picks || []) {
      const from = dp.previous_owner_id;
      const to = dp.owner_id;
      const season = Number(dp.season);
      const round = Number(dp.round);
      if (from == null || to == null || from === to) continue;
      const info = Number.isFinite(season) && Number.isFinite(round)
        ? look.pick(season, round, Number(dp.roster_id))
        : null;
      moves.push({
        kind: 'pick',
        id: 'k' + season + '-' + round + '-' + dp.roster_id + '-' + to,
        name: info?.name || (season + ' round ' + round),
        note: info?.note || '',
        from, to,
        value: info?.value || 0,
        priced: !!info && info.priced,
      });
    }

    for (const w of t.waiver_budget || []) {
      if (w.sender == null || w.receiver == null || !w.amount) continue;
      moves.push({
        kind: 'faab',
        id: 'f' + w.sender + '-' + w.receiver + '-' + w.amount,
        name: '$' + w.amount + ' FAAB',
        note: 'waiver budget',
        from: w.sender, to: w.receiver,
        // Budget is real and is not priced in the market's currency. Counting
        // it at some invented exchange rate would move a verdict on a guess.
        value: 0,
        priced: false,
      });
    }

    if (!moves.length) continue;

    const ids = t.roster_ids && t.roster_ids.length
      ? t.roster_ids
      : [...new Set(moves.flatMap(mv => [mv.from, mv.to]))];
    const teams = ids.map(id => ({ id, name: look.isMe(id) ? 'You' : look.teamName(id), isMe: look.isMe(id) }));

    const unpriced = moves.filter(mv => !mv.priced).length;
    /* One unpriced asset does not make the verdict approximate, it makes it
     * wrong: the team that received it is credited with nothing. Better to
     * show the trade and say the winner cannot be called. */
    const verdict = unpriced ? null : evaluateTrade(teams, moves.map(mv => ({
      id: mv.id, name: mv.name, value: mv.value, from: mv.from, to: mv.to,
    })));
    const netOf = new Map(verdict?.ledgers.map(l => [l.id, l.net]) ?? []);

    out.push({
      id: t.transaction_id || (t.status_updated || 0) + ':' + ids.join('-'),
      week: t.week || 0,
      at: t.status_updated || t.created || 0,
      teams: ids,
      sides: teams.map(tm => ({
        id: tm.id,
        name: tm.name,
        isMe: tm.isMe,
        got: moves.filter(mv => mv.to === tm.id),
        gave: moves.filter(mv => mv.from === tm.id),
        net: netOf.has(tm.id) ? (netOf.get(tm.id) as number) : null,
      })),
      moves,
      verdict,
      unpriced,
    });
  }

  // Newest first: the trade you are wondering about is the one that just
  // happened, not the one from week one.
  return out.sort((a, b) => b.at - a.at || b.week - a.week);
}

/**
 * One line saying who came out ahead, for the top of the card.
 *
 * "Even" is a real answer and the common one: two managers who both said yes
 * usually did so because the deal was close, and a screen that names a winner
 * for every trade is a screen nobody believes by the third card.
 */
export function tradeOutcome(t: LeagueTrade): string {
  if (t.unpriced) {
    return t.unpriced === t.moves.length
      ? 'No market price for anything in this trade'
      : 'Not judged — ' + t.unpriced + ' of ' + t.moves.length + ' pieces have no market price';
  }
  const v = t.verdict;
  if (!v || !v.moved) return 'Nothing of value changed hands';
  if (!v.winner) return 'Even trade at today\'s prices';
  const pct = Math.round((v.winner.net / v.moved) * 100);
  return (v.winner.isMe ? 'You win this one' : v.winner.name + ' wins this one')
    + ' — ' + pct + '% of the value moved';
}
