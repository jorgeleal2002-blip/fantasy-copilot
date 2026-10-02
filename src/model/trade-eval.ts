/**
 * What a proposed trade does to everyone in it.
 *
 * Deliberately independent of how many teams are involved. A two-team deal is
 * just the case where the assets happen to move in both directions between the
 * same pair; three teams in a ring, or one team paying a third to take salary
 * off a second, are the same arithmetic. So nothing here counts sides — every
 * asset carries where it came from and where it goes, and the ledger falls out.
 */

export interface TradeAsset {
  id: string;
  name: string;
  /** Market value, in whatever currency the league's market is priced in. */
  value: number;
  /** roster id it leaves */
  from: number;
  /** roster id it lands on */
  to: number;
}

export interface TradeTeam {
  id: number;
  name: string;
  isMe: boolean;
}

export type Standing = 'wins' | 'loses' | 'even';

export interface TeamLedger {
  id: number;
  name: string;
  isMe: boolean;
  gave: TradeAsset[];
  got: TradeAsset[];
  out: number;
  in: number;
  /** what the team is worth after, minus what it was worth before */
  net: number;
  standing: Standing;
  /** Starting-lineup points gained or lost, where the caller measured it.
   *  Null means nobody asked — not that the trade changes nothing. */
  fitDelta: number | null;
}

export interface TradeVerdict {
  /** Best net first, so the winner is always the head of the list. */
  ledgers: TeamLedger[];
  winner: TeamLedger | null;
  /** How far ahead the best team is of the next one. */
  margin: number;
  /** Total value that changes hands — what the band is measured against. */
  moved: number;
  /** Below this, a difference is noise rather than an edge. */
  band: number;
  /** Things that make the deal unsendable rather than merely lopsided. */
  problems: string[];
}

/**
 * A gap only counts once it is large enough to survive the market being
 * approximate. Four percent of what changes hands scales with the deal — a
 * 200-point edge means something in a swap of two benchwarmers and nothing in
 * a blockbuster — and the floor keeps a trade of scraps from declaring a
 * winner over a rounding difference.
 */
export function fairnessBand(moved: number): number {
  return Math.max(1, moved * 0.04);
}

/**
 * The consolidation premium: one star is worth more than two lesser players
 * who add up to him. He takes one roster spot instead of two, and only one
 * of them can start where he does. Summing market values ignored that, so
 * the side taking two pieces won every two-for-one — 38 + 88 "beat" 102.
 *
 * Each piece counts at its value scaled by how close it is to the best piece
 * in the deal: the best keeps all of its value, one at half his value keeps
 * about seventy percent of it, a throw-in much less. The same rule every
 * dynasty trade calculator applies, in a form that needs no table.
 */
export const CONSOLIDATION = 0.5;
export function effectiveValue(v: number, top: number): number {
  if (!(v > 0) || !(top > 0)) return 0;
  return v * Math.pow(Math.min(1, v / top), CONSOLIDATION);
}

export function evaluateTrade(
  teams: TradeTeam[],
  assets: TradeAsset[],
  /** roster id → change in best-lineup points, from the caller's simulation */
  fits?: Record<number, number>,
): TradeVerdict {
  const known = new Set(teams.map(t => t.id));
  // An asset routed to a team that is not in the deal has nowhere to land, and
  // one sent home is not a trade; both are dropped rather than scored.
  const raw = assets.filter(a => known.has(a.from) && known.has(a.to) && a.from !== a.to);
  const best = raw.reduce((m, a) => Math.max(m, a.value), 0);
  // Scored at their worth inside this deal; the asset keeps its own `value`
  // field for anyone printing it.
  const live = raw.map(a => ({ ...a, value: effectiveValue(a.value, best) }));

  const ledgers: TeamLedger[] = teams.map(t => {
    const gave = live.filter(a => a.from === t.id);
    const got = live.filter(a => a.to === t.id);
    const out = gave.reduce((s, a) => s + a.value, 0);
    const inn = got.reduce((s, a) => s + a.value, 0);
    return {
      id: t.id, name: t.name, isMe: t.isMe,
      gave, got, out, in: inn, net: inn - out,
      standing: 'even' as Standing,
      fitDelta: fits && t.id in fits ? fits[t.id] : null,
    };
  });

  const moved = live.reduce((s, a) => s + a.value, 0);
  const band = fairnessBand(moved);

  for (const l of ledgers) {
    l.standing = l.net > band ? 'wins' : l.net < -band ? 'loses' : 'even';
  }

  ledgers.sort((a, b) => b.net - a.net);
  const top = ledgers[0];
  const margin = ledgers.length > 1 ? top.net - ledgers[1].net : 0;
  const winner = top && top.standing === 'wins' ? top : null;

  const problems: string[] = [];
  // Only once something is on the table: an empty trade has no problems, it
  // has not started.
  for (const l of moved ? ledgers : []) {
    if (!l.gave.length && !l.got.length) {
      problems.push(l.isMe ? 'You are in the trade but nothing moves for you'
        : l.name + ' is in the trade but nothing moves for them');
    } else if (!l.got.length) {
      // Legal in Sleeper, and nobody accepts it. Worth saying before you send.
      problems.push(l.isMe ? 'You give and get nothing back' : l.name + ' gives and gets nothing back');
    }
  }

  return { ledgers, winner, margin, moved, band, problems };
}

/** One line for the top of the card. */
export function verdictLine(v: TradeVerdict): string {
  if (!v.moved) return 'Nothing in the trade yet';
  if (!v.winner) return 'Even trade — nobody comes out ahead';
  const pct = Math.round((v.winner.net / v.moved) * 100);
  return v.winner.isMe
    ? `You win this trade — ${pct}% of the value moved`
    : `${v.winner.name} wins this trade — ${pct}% of the value moved`;
}

/**
 * What the trade does to the proposer's lineup, and whether that agrees with
 * what it does to their ledger.
 *
 * The two questions come apart constantly, and the disagreement is the useful
 * part: overpaying for the position you cannot field is a good trade the
 * ledger calls a loss, and selling a backup for a fortune is the reverse.
 * Returns null when nobody measured the lineup, rather than claiming it is flat.
 */
export function fitLine(v: TradeVerdict): string | null {
  const me = v.ledgers.find(l => l.isMe);
  if (!me || me.fitDelta == null || !v.moved) return null;

  const pts = Math.abs(me.fitDelta).toFixed(1);
  // A tenth of a point a week is not a lineup change anyone can feel.
  if (Math.abs(me.fitDelta) < 0.1) {
    return me.standing === 'even'
      ? 'Your lineup is unchanged'
      : 'Your lineup is unchanged — this is a value move, not a lineup one';
  }

  const up = me.fitDelta > 0;
  const head = up ? `Your lineup gains ${pts} pts` : `Your lineup loses ${pts} pts`;

  if (up && me.standing === 'loses') {
    return head + ', even though you pay over market — the fit is what you are buying';
  }
  if (!up && me.standing === 'wins') {
    return head + ', even though you win on value — you are selling from your starters';
  }
  return head + ' a week in your best lineup';
}

/**
 * The headline: who won, weighing value and lineup the way the league's own
 * trade log does. When they agree, one winner. When value is even, the lineup
 * decides. When they disagree, a redraft league is decided by this season's
 * lineup and a dynasty is a split.
 */
export interface Headline { title: string; winner: TeamLedger | null; why: string }

export function tradeHeadline(v: TradeVerdict, dynasty: boolean): Headline {
  const name = (l: TeamLedger) => (l.isMe ? 'You' : l.name);
  const wins = (l: TeamLedger) => (l.isMe ? 'You win this trade' : l.name + ' wins this trade');
  if (!v.moved) return { title: 'Nothing in the trade yet', winner: null, why: '' };
  const measured = v.ledgers.filter(l => l.fitDelta != null);
  const lu = measured.slice().sort((a, b) => (b.fitDelta as number) - (a.fitDelta as number))[0];
  const lineupWin = lu && (lu.fitDelta as number) >= 0.5 ? lu : null;
  const vw = v.winner;
  const pts = (l: TeamLedger) => (l.fitDelta as number).toFixed(1);

  if (vw && (!lineupWin || lineupWin.id === vw.id)) {
    return { title: wins(vw), winner: vw, why: 'More value' + (lineupWin ? ' and +' + pts(lineupWin) + ' pts a week in the lineup' : '') };
  }
  if (!vw && lineupWin) {
    return { title: wins(lineupWin), winner: lineupWin, why: 'Even on value, +' + pts(lineupWin) + ' pts a week in the lineup' };
  }
  if (!vw) return { title: 'Even trade', winner: null, why: 'Even on value and on lineup' };
  const lw = lineupWin as TeamLedger;
  if (!dynasty) {
    return {
      title: wins(lw) + ' for this season', winner: lw,
      why: '+' + pts(lw) + ' pts a week in the lineup; ' + name(vw) + ' gets more market value',
    };
  }
  return { title: 'Split: ' + name(vw) + ' on value, ' + name(lw) + ' on lineup', winner: null, why: '' };
}
