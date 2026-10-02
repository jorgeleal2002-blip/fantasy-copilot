/** Each NFL team's primary colour — the ground of a player's banner. */
export const NFL_COLOR: Record<string, string> = {
  ARI: '#97233F', ATL: '#A71930', BAL: '#241773', BUF: '#00338D', CAR: '#0085CA', CHI: '#0B162A',
  CIN: '#FB4F14', CLE: '#311D00', DAL: '#003594', DEN: '#FB4F14', DET: '#0076B6', GB: '#203731',
  HOU: '#03202F', IND: '#002C5F', JAX: '#006778', KC: '#E31837', LV: '#3A3A3A', LAC: '#0080C6',
  LAR: '#003594', MIA: '#008E97', MIN: '#4F2683', NE: '#002244', NO: '#9F8958', NYG: '#0B2265',
  NYJ: '#125740', PHI: '#004C54', PIT: '#C99A0E', SF: '#AA0000', SEA: '#002244', TB: '#D50A0A',
  TEN: '#0C2340', WAS: '#5A1414',
};

/** "6'5\"" out of whatever Sleeper sent — inches as a number, or already written out. */
export function heightLabel(h: string | number | null | undefined): string | null {
  if (h == null || h === '') return null;
  const s = String(h);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Math.floor(n / 12) + "'" + (n % 12) + '"';
  }
  return s;
}

/** Age to a tenth of a year, the way Sleeper's card has it. */
export function ageFrom(birth: string | null | undefined, now: number): number | null {
  const t = birth ? Date.parse(birth) : NaN;
  if (!Number.isFinite(t)) return null;
  return Math.floor(((now - t) / (365.25 * 864e5)) * 10) / 10;
}
