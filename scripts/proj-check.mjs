/**
 * What the projection actually says about real players.
 *
 * Runs the shipped seasonUsage / blendSeasons / projectPPG over the same three
 * seasons the app asks Sleeper for, and prints the top of each position next to
 * what those players really averaged. A projection is wrong in a way a rank
 * correlation cannot see if the NAMES are right and the NUMBERS are not.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blendSeasons, seasonUsage } from '../src/model/usage.ts';
import { projectPPG } from '../src/model/project.ts';

const DIR = process.env.NFLVERSE_DIR || join(process.cwd(), '.nflverse');
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

function csv(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const head = lines[0].split(',');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = []; let cur = ''; let q = false;
    for (const ch of lines[i]) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    const row = {};
    head.forEach((h, j) => { row[h] = cells[j]; });
    out.push(row);
  }
  return out;
}

const bio = {};
csv(join(DIR, 'players.csv')).forEach(r => { if (r.gsis_id) bio[r.gsis_id] = r; });

function load(year) {
  const n = (r, k) => { const v = Number(r[k]); return Number.isFinite(v) ? v : 0; };
  const stats = {}, players = {}, names = {}, team = {};
  csv(join(DIR, 'week_' + year + '.csv')).forEach(r => {
    if (r.season_type !== 'REG' || POSITIONS.indexOf(r.position) < 0) return;
    const s = (stats[r.player_id] = stats[r.player_id] || {});
    s.gp = (s.gp || 0) + 1;
    s.rec_tgt = (s.rec_tgt || 0) + n(r, 'targets');
    s.rec = (s.rec || 0) + n(r, 'receptions');
    s.rec_yd = (s.rec_yd || 0) + n(r, 'receiving_yards');
    s.rush_att = (s.rush_att || 0) + n(r, 'carries');
    s.rush_yd = (s.rush_yd || 0) + n(r, 'rushing_yards');
    s.pass_att = (s.pass_att || 0) + n(r, 'attempts');
    s.pass_yd = (s.pass_yd || 0) + n(r, 'passing_yards');
    s.rush_td = (s.rush_td || 0) + n(r, 'rushing_tds');
    s.rec_td = (s.rec_td || 0) + n(r, 'receiving_tds');
    s.pass_td = (s.pass_td || 0) + n(r, 'passing_tds');
    s.pts_half_ppr = (s.pts_half_ppr || 0) + (n(r, 'fantasy_points') + n(r, 'fantasy_points_ppr')) / 2;
    names[r.player_id] = r.player_display_name;
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
  return { year, stats, players, names };
}

const years = [2025, 2024, 2023];
const seasons = years.map(load);
// exactly what useApp does: the newest season's catalog, three seasons blended
const cat = seasons[0].players;
const usage = blendSeasons(seasons.map(s => ({ year: s.year, usage: seasonUsage(s.stats, cat) })), cat);

const real = (id, y) => {
  const s = seasons.find(x => x.year === y);
  const st = s.stats[id];
  return st && st.gp ? st.pts_half_ppr / st.gp : null;
};

for (const pos of POSITIONS) {
  const rows = Object.keys(usage)
    .filter(id => cat[id] && cat[id].position === pos)
    .map(id => ({
      id, name: seasons[0].names[id], age: cat[id].age,
      proj: projectPPG(usage[id]),
      u: usage[id],
    }))
    .filter(r => r.proj != null)
    .sort((a, b) => b.proj - a.proj)
    .slice(0, 12);
  console.log('\n' + pos + '   ' + 'player'.padEnd(24) + 'proj   2025   2024   ppgAdj  ppg   gp  seasons');
  rows.forEach(r => console.log('    ' + (r.name || r.id).padEnd(24)
    + r.proj.toFixed(1).padStart(5)
    + (real(r.id, 2025) == null ? '     —' : real(r.id, 2025).toFixed(1).padStart(7))
    + (real(r.id, 2024) == null ? '     —' : real(r.id, 2024).toFixed(1).padStart(7))
    + (r.u.ppgAdj == null ? '      —' : r.u.ppgAdj.toFixed(1).padStart(8))
    + (r.u.ppg == null ? '     —' : r.u.ppg.toFixed(1).padStart(6))
    + String(r.u.gpTotal ?? r.u.gp).padStart(5)
    + '  ' + (r.u.seasonList || '')));
}

/* ── is the LEVEL right, not just the order? ─────────────────────────────────
 * Spearman scores the order and is blind to whether every number is two points
 * low, so the same players are compared to what they actually did, in points.
 *
 * Two traps this walks around, both of which I fell into first:
 *
 *   · It must be OUT OF SAMPLE. Projecting from three seasons and then scoring
 *     against one of those three flatters nothing and proves nothing.
 *   · The group must be picked by the PROJECTION, never by the result. "The
 *     sixty best players of 2025" is a set selected for having overperformed,
 *     and a projection that is right in expectation will always read low on it.
 *     The question a card has to answer is the other one: when this app says
 *     15, do they score 15?
 */
const fit = (from) => {
  const ss = from.map(load);
  const c = ss[0].players;
  const u = blendSeasons(ss.map(s => ({ year: s.year, usage: seasonUsage(s.stats, c) })), c);
  return { u, c };
};
const PAIRS = [[2025, [2024, 2023, 2022]], [2024, [2023, 2022, 2021]]];
let rows = [];
for (const [ty, from] of PAIRS) {
const target = load(ty);
const { u: uOut, c: cOut } = fit(from);
rows = rows.concat(Object.keys(uOut)
  .filter(id => cOut[id] && POSITIONS.indexOf(cOut[id].position) >= 0)
  .map(id => ({
    id, name: cOut[id].full_name, pos: cOut[id].position,
    p: projectPPG(uOut[id]),
    r: target.stats[id] && target.stats[id].gp >= 6
      ? target.stats[id].pts_half_ppr / target.stats[id].gp : null,
  }))
  .filter(x => x.p != null && x.r != null));
}

console.log('\n\n  CALIBRATION — projected from 2024·2023·2022, scored against 2025, and 2023-21 against 2024');
console.log('  ' + 'group'.padEnd(24) + 'n     says   scored    bias   |err|');
const show = (label, list) => {
  if (!list.length) return;
  const mp = list.reduce((a, x) => a + x.p, 0) / list.length;
  const mr = list.reduce((a, x) => a + x.r, 0) / list.length;
  const ae = list.reduce((a, x) => a + Math.abs(x.p - x.r), 0) / list.length;
  console.log('  ' + label.padEnd(24) + String(list.length).padEnd(6)
    + mp.toFixed(2).padStart(6) + mr.toFixed(2).padStart(9)
    + ((mp - mr >= 0 ? '+' : '') + (mp - mr).toFixed(2)).padStart(8) + ae.toFixed(2).padStart(8));
};
const byProj = rows.slice().sort((a, b) => b.p - a.p);
show('everyone', rows);
show('top 24 by projection', byProj.slice(0, 24));
show('top 60 by projection', byProj.slice(0, 60));
show('top 120 by projection', byProj.slice(0, 120));
POSITIONS.forEach(pos => {
  const mine = byProj.filter(x => x.pos === pos);
  show('  top 12 ' + pos, mine.slice(0, 12));
});
console.log('\n  the twelve it is most confident about:');
console.log('    ' + 'player'.padEnd(24) + 'says  scored');
byProj.slice(0, 12).forEach(x => console.log('    ' + (x.name || x.id).padEnd(24)
  + x.p.toFixed(1).padStart(4) + x.r.toFixed(1).padStart(8)));
