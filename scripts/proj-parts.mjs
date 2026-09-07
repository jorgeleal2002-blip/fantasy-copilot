/**
 * Which part of the projection is costing which position?
 *
 * The blend and the age step are two separate claims — "three seasons beat one"
 * and "a year of the curve is worth applying" — and there is no reason they
 * should be true for a running back and a quarterback in the same measure. A
 * back's role turns over faster than anybody's; a quarterback's does not.
 *
 * Every row is out of sample and grouped by the PROJECTION, never the result.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blendSeasons, seasonUsage } from '../src/model/usage.ts';
import { projectPPG } from '../src/model/project.ts';

const DIR = process.env.NFLVERSE_DIR || join(process.cwd(), '.nflverse');
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
function csv(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const head = lines[0].split(',');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = []; let cur = ''; let q = false;
    for (const ch of lines[i]) {
      if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    const row = {}; head.forEach((h, j) => { row[h] = cells[j]; }); out.push(row);
  }
  return out;
}
const bio = {};
csv(join(DIR, 'players.csv')).forEach(r => { if (r.gsis_id) bio[r.gsis_id] = r; });
const cache = {};
function load(year) {
  if (cache[year]) return cache[year];
  const n = (r, k) => { const v = Number(r[k]); return Number.isFinite(v) ? v : 0; };
  const stats = {}, players = {}, team = {};
  csv(join(DIR, 'week_' + year + '.csv')).forEach(r => {
    if (r.season_type !== 'REG' || POSITIONS.indexOf(r.position) < 0) return;
    const s = (stats[r.player_id] = stats[r.player_id] || {});
    s.gp = (s.gp || 0) + 1;
    for (const [k, c] of [['rec_tgt', 'targets'], ['rec', 'receptions'], ['rec_yd', 'receiving_yards'],
      ['rush_att', 'carries'], ['rush_yd', 'rushing_yards'], ['pass_att', 'attempts'],
      ['pass_yd', 'passing_yards'], ['rush_td', 'rushing_tds'], ['rec_td', 'receiving_tds'],
      ['pass_td', 'passing_tds']]) s[k] = (s[k] || 0) + n(r, c);
    s.pts_half_ppr = (s.pts_half_ppr || 0) + (n(r, 'fantasy_points') + n(r, 'fantasy_points_ppr')) / 2;
    (team[r.player_id] = team[r.player_id] || {})[r.team] = 1;
    players[r.player_id] = { player_id: r.player_id, position: r.position, full_name: r.player_display_name };
  });
  Object.keys(players).forEach(id => {
    const b = bio[id] || {};
    const born = b.birth_date ? new Date(b.birth_date) : null;
    players[id].age = born && !Number.isNaN(born.getTime())
      ? Math.round(((new Date(year + '-09-01') - born) / 3.15576e10) * 10) / 10 : null;
    players[id].team = Object.keys(team[id])[0] || null;
  });
  return (cache[year] = { year, stats, players });
}

const PAIRS = [[2025, [2024, 2023, 2022]], [2024, [2023, 2022, 2021]]];

/** depth = how many seasons to blend; age = apply the one-year step. */
function measure(depth, age) {
  const rows = [];
  for (const [ty, from] of PAIRS) {
    const target = load(ty);
    const ss = from.slice(0, depth).map(load);
    const c = ss[0].players;
    const u = blendSeasons(ss.map(s => ({ year: s.year, usage: seasonUsage(s.stats, c) })), c);
    Object.keys(u).forEach(id => {
      const pl = c[id];
      if (!pl || POSITIONS.indexOf(pl.position) < 0) return;
      const p = projectPPG(u[id], pl.position, age ? pl.age : null);
      const t = target.stats[id];
      if (p == null || !t || (t.gp || 0) < 6) return;
      rows.push({ pos: pl.position, p, r: t.pts_half_ppr / t.gp });
    });
  }
  return rows;
}

const stat = (list) => {
  if (!list.length) return { bias: NaN, err: NaN };
  const mp = list.reduce((a, x) => a + x.p, 0) / list.length;
  const mr = list.reduce((a, x) => a + x.r, 0) / list.length;
  return { bias: mp - mr, err: list.reduce((a, x) => a + Math.abs(x.p - x.r), 0) / list.length };
};
const fmt = (s) => ((s.bias >= 0 ? '+' : '') + s.bias.toFixed(2)).padStart(7) + ('±' + s.err.toFixed(2)).padStart(7);

console.log('\n  bias and mean error against the real season, by variant');
console.log('  positive bias = the app promises more than they scored');
console.log('\n  ' + 'variant'.padEnd(22) + 'top 12 QB     top 12 RB     top 12 WR     top 12 TE');
for (const [label, depth, age] of [
  ['1 season, no age', 1, false], ['1 season + age', 1, true],
  ['2 seasons + age', 2, true], ['3 seasons, no age', 3, false], ['3 seasons + age', 3, true],
]) {
  const rows = measure(depth, age);
  const cells = POSITIONS.map(pos => {
    const mine = rows.filter(x => x.pos === pos).sort((a, b) => b.p - a.p).slice(0, 24);
    return fmt(stat(mine));
  });
  console.log('  ' + label.padEnd(22) + cells.join(''));
}
