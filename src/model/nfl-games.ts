/**
 * The NFL's own games for a week — score, quarter and clock — read out of
 * ESPN's public scoreboard, keyed by team in Sleeper's abbreviations.
 *
 * Sleeper's API has no game state, and a player's card without the score of
 * the game he is in, or a live projection that guesses the quarter from the
 * kickoff time, is missing the thing everybody looks at first. Read
 * defensively: it is somebody else's feed, and a card that loses its score
 * line is still a card.
 */
export interface NflGame {
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  state: 'pre' | 'in' | 'post';
  /** 1–4, 5 and up for overtime; 0 before kickoff. */
  period: number;
  /** "2:00", as the broadcast shows it. */
  clock: string;
  /** ESPN's own short line — "Final", "Halftime", "Sun 1:00 PM EDT". */
  detail: string;
  /** Kickoff, epoch ms, when ESPN gave one. */
  start: number | null;
}

/** ESPN's abbreviations, where they are not Sleeper's. */
const TEAM: Record<string, string> = { WSH: 'WAS', LA: 'LAR' };
const team = (t: unknown) => (typeof t === 'string' ? TEAM[t] || t : '');
const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export function readNflGames(raw: unknown): Record<string, NflGame> {
  const out: Record<string, NflGame> = {};
  const events = (raw as { events?: unknown })?.events;
  if (!Array.isArray(events)) return out;
  for (const ev of events) {
    const comp = (ev as { competitions?: unknown[] })?.competitions?.[0] as Record<string, unknown> | undefined;
    if (!comp) continue;
    const sides = Array.isArray(comp.competitors) ? comp.competitors as Record<string, unknown>[] : [];
    const home = sides.find(c => c.homeAway === 'home');
    const away = sides.find(c => c.homeAway === 'away');
    const h = team((home?.team as { abbreviation?: unknown })?.abbreviation);
    const a = team((away?.team as { abbreviation?: unknown })?.abbreviation);
    if (!h || !a) continue;
    const st = (comp.status || (ev as { status?: unknown }).status || {}) as Record<string, unknown>;
    const type = (st.type || {}) as Record<string, unknown>;
    const state = type.state === 'in' || type.state === 'post' ? type.state : 'pre';
    const g: NflGame = {
      home: h,
      away: a,
      homeScore: state === 'pre' ? null : num(home?.score),
      awayScore: state === 'pre' ? null : num(away?.score),
      state,
      period: num(st.period) ?? 0,
      clock: typeof st.displayClock === 'string' ? st.displayClock : '',
      detail: typeof type.shortDetail === 'string' ? type.shortDetail : '',
      start: (() => {
        const t = Date.parse(String((comp.date ?? (ev as { date?: unknown }).date) || ''));
        return Number.isFinite(t) ? t : null;
      })(),
    };
    out[h] = g;
    out[a] = g;
  }
  return out;
}

/** How much of a game is left, off its real clock: 1 before kickoff, 0 once
 *  it is over or into overtime. */
export function gameLeftOf(g: NflGame): number {
  if (g.state === 'pre') return 1;
  if (g.state === 'post' || g.period > 4) return 0;
  const [m, s] = g.clock.split(':').map(Number);
  const inQ = Number.isFinite(m) ? m + (Number.isFinite(s) ? s / 60 : 0) : 7.5;
  return Math.max(0, Math.min(1, ((4 - Math.max(1, g.period)) * 15 + inQ) / 60));
}

/** "Sun 11:00 AM", in the phone's own time zone — the way Sleeper writes it. */
export const kickoffLabel = (ms: number): string =>
  new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(',', '');

/** "Q2 2:00", "Half", "OT 4:12", "Final", "Sun 1:00 PM" — the corner of the card. */
export function clockLabel(g: NflGame): string {
  if (g.state === 'post') return 'Final';
  if (g.state === 'pre') return g.start != null ? kickoffLabel(g.start) : g.detail.replace(/\s+E[DS]T$/, '');
  if (/half/i.test(g.detail)) return 'Half';
  const q = g.period > 4 ? 'OT' : 'Q' + g.period;
  return g.clock ? q + ' ' + g.clock : q;
}
