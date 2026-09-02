/**
 * Regenerates src/model/schedule.ts.
 *
 * Run once a year, after the NFL releases the new season's schedule and the
 * previous season has finished:
 *
 *     node scripts/build-schedule.mjs 2026
 *
 * Two public nflverse datasets, both plain files over HTTPS:
 *
 *   · data/games.csv — every scheduled game, future seasons included. This is
 *     where the fixtures and the byes come from.
 *   · stats_player_week_<season>.csv — every player's week, with the defence
 *     he faced. Summed by that defence and by position it is how many fantasy
 *     points each team gave up per game, which is what makes one schedule
 *     harder than another.
 *
 * The app ships the answer rather than fetching either at runtime: it is four
 * kilobytes, it never changes inside a season, and a draft room that needs the
 * network to tell you a bye week is a draft room that breaks on a phone with
 * one bar.
 */
import { writeFileSync } from 'node:fs';

const SEASON = Number(process.argv[2] || new Date().getFullYear());
const PRIOR = SEASON - 1;
const GAMES = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const WEEKS = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_' + PRIOR + '.csv';
const POS = ['QB', 'RB', 'WR', 'TE'];

/** nflverse calls the Rams LA; Sleeper, and so this app, calls them LAR. */
const team = (t) => (t === 'LA' ? 'LAR' : t === 'SD' ? 'LAC' : t === 'OAK' ? 'LV' : t === 'STL' ? 'LAR' : t);

async function csv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' → http ' + res.status);
  const text = await res.text();
  const lines = text.split('\n');
  const head = lines[0].split(',');
  return lines.slice(1).filter(Boolean).map(line => {
    // Quoted fields exist in these files (stadium names), so split carefully.
    const out = [];
    let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    const row = {};
    head.forEach((h, i) => { row[h] = out[i]; });
    return row;
  });
}

const games = (await csv(GAMES))
  .filter(r => Number(r.season) === SEASON && r.game_type === 'REG');
if (!games.length) throw new Error('no ' + SEASON + ' regular-season games in games.csv yet');

const weeks = games.reduce((a, r) => Math.max(a, Number(r.week)), 0);
const opp = {};
games.forEach(r => {
  const h = team(r.home_team), a = team(r.away_team), w = Number(r.week);
  (opp[h] = opp[h] || [])[w - 1] = a;
  (opp[a] = opp[a] || [])[w - 1] = h;
});
const teams = Object.keys(opp).sort();
teams.forEach(t => { for (let i = 0; i < weeks; i++) opp[t][i] = opp[t][i] || ''; });

const rows = await csv(WEEKS);
const pts = {}, played = {};
rows.forEach(r => {
  if (r.season_type !== 'REG') return;
  const p = r.position, d = team(r.opponent_team);
  if (!d || POS.indexOf(p) < 0) return;
  pts[d] = pts[d] || {};
  pts[d][p] = (pts[d][p] || 0) + (Number(r.fantasy_points_ppr) || 0);
  (played[d] = played[d] || new Set()).add(r.week);
});

const missing = teams.filter(t => !pts[t]);
if (missing.length) throw new Error('no ' + PRIOR + ' defensive record for ' + missing.join(', '));

const allowed = {};
teams.forEach(t => {
  const g = Math.max((played[t] || new Set()).size, 1);
  allowed[t] = POS.map(p => Math.round(((pts[t][p] || 0) / g) * 10) / 10);
});

const q = (s) => "'" + s + "'";
const out = `/**
 * The NFL season, as two small tables.
 *
 * GENERATED — do not edit by hand. \`node scripts/build-schedule.mjs ${SEASON}\`
 * rebuilds it from nflverse; the header of that script says what from and why
 * it ships in the bundle instead of being fetched.
 */
import type { Pos } from '../api/types';

/** The season the fixtures below belong to. */
export const SCHEDULE_SEASON = ${SEASON};
/** The season the defensive record below was measured in — last year's, which
 *  is the only completed one when a draft happens. */
export const ALLOWED_SEASON = ${PRIOR};
/** Regular-season weeks in ${SEASON}. */
export const SEASON_WEEKS = ${weeks};
/** When most leagues decide it: the last three weeks before week ${weeks}. */
export const PLAYOFF_WEEKS: number[] = [${weeks - 3}, ${weeks - 2}, ${weeks - 1}];

/** Who each team plays, week 1 first. An empty string is their bye. */
export const OPPONENTS: Record<string, string[]> = {
${teams.map(t => '  ' + t + ': [' + opp[t].map(q).join(', ') + '],').join('\n')}
};

/** PPR fantasy points per game each defence gave up in ${PRIOR}, by the
 *  position that scored them: [QB, RB, WR, TE]. Last season's record is a
 *  lagged proxy for this one's — the honest one available in August. */
export const ALLOWED: Record<string, [number, number, number, number]> = {
${teams.map(t => '  ' + t + ': [' + allowed[t].join(', ') + '],').join('\n')}
};

/** The order the tuples above are written in. */
export const ALLOWED_POS: Pos[] = ['QB', 'RB', 'WR', 'TE'];
`;

writeFileSync(new URL('../src/model/schedule.ts', import.meta.url), out);
console.log(SEASON + ': ' + teams.length + ' teams, ' + weeks + ' weeks, '
  + games.length + ' games; defensive record from ' + PRIOR + '.');
