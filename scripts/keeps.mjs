/**
 * How much of each rate actually survives a year, WITHIN position.
 *
 * The luck adjustment shrinks a player's own rate toward his position's by
 * exactly this much, so these are the numbers it is standing on. They were one
 * global set, which is a claim that a quarterback's touchdown rate and a wide
 * receiver's decay at the same speed. That is measurable and it is not true.
 *
 * The correlation is weighted by the smaller of the two seasons' volume: a rate
 * off thirty touches and a rate off three hundred are not the same evidence.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const DIR = process.env.NFLVERSE_DIR || join(process.cwd(), '.nflverse');
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
function csv(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const head = lines[0].split(',');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = []; let cur = '', q = false;
    for (const ch of lines[i]) {
      if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    const r = {}; head.forEach((h, j) => { r[h] = cells[j]; }); out.push(r);
  }
  return out;
}
const n = (r, k) => { const v = Number(r[k]); return Number.isFinite(v) ? v : 0; };
function load(y) {
  const s = {};
  csv(join(DIR, 'week_' + y + '.csv')).forEach(r => {
    if (r.season_type !== 'REG' || POSITIONS.indexOf(r.position) < 0) return;
    const a = (s[r.player_id] = s[r.player_id] || { pos: r.position, gp: 0 });
    a.gp++;
    for (const [k, c] of [['tgt', 'targets'], ['rec', 'receptions'], ['recy', 'receiving_yards'],
      ['ra', 'carries'], ['ry', 'rushing_yards'], ['pa', 'attempts'], ['py', 'passing_yards'],
      ['rtd', 'rushing_tds'], ['rectd', 'receiving_tds'], ['ptd', 'passing_tds']]) a[k] = (a[k] || 0) + n(r, c);
    return a;
  });
  return s;
}
const YEARS = [2021, 2022, 2023, 2024, 2025];
const data = {}; YEARS.forEach(y => { data[y] = load(y); });

/** Volume-weighted Pearson correlation between the same rate in back-to-back seasons. */
function keep(pos, rate, vol, min) {
  const xs = [], ys = [], ws = [];
  for (let i = 0; i + 1 < YEARS.length; i++) {
    const a = data[YEARS[i]], b = data[YEARS[i + 1]];
    for (const id of Object.keys(a)) {
      if (!b[id] || a[id].pos !== pos || b[id].pos !== pos) continue;
      const va = vol(a[id]), vb = vol(b[id]);
      if (va < min || vb < min) continue;
      const ra = rate(a[id]), rb = rate(b[id]);
      if (!Number.isFinite(ra) || !Number.isFinite(rb)) continue;
      xs.push(ra); ys.push(rb); ws.push(Math.min(va, vb));
    }
  }
  const W = ws.reduce((s, w) => s + w, 0);
  if (!W || xs.length < 20) return { r: NaN, n: xs.length };
  const mx = xs.reduce((s, x, i) => s + x * ws[i], 0) / W;
  const my = ys.reduce((s, y, i) => s + y * ws[i], 0) / W;
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => {
    const dx = x - mx, dy = ys[i] - my;
    sxy += ws[i] * dx * dy; sxx += ws[i] * dx * dx; syy += ws[i] * dy * dy;
  });
  return { r: sxy / Math.sqrt(sxx * syy), n: xs.length };
}

const held = (a) => (a.rec || 0) + (a.ra || 0);
const RATES = [
  ['cat  catches per target', a => a.tgt ? a.rec / a.tgt : NaN, a => a.tgt || 0, 25],
  ['ypt  yards per touch', a => held(a) ? ((a.recy || 0) + (a.ry || 0)) / held(a) : NaN, held, 25],
  ['tdr  TDs per touch', a => held(a) ? ((a.rectd || 0) + (a.rtd || 0)) / held(a) : NaN, held, 25],
  ['ypa  yards per attempt', a => a.pa ? a.py / a.pa : NaN, a => a.pa || 0, 100],
  ['tpa  TDs per attempt', a => a.pa ? a.ptd / a.pa : NaN, a => a.pa || 0, 100],
];
console.log('\n  year-to-year correlation of each rate, within position, 2021-2025');
console.log('  (this is the fraction of his own rate the model should keep)\n');
console.log('  ' + 'rate'.padEnd(26) + POSITIONS.map(p => p.padStart(10)).join(''));
for (const [label, rate, vol, min] of RATES) {
  const cells = POSITIONS.map(pos => {
    const k = keep(pos, rate, vol, min);
    return Number.isFinite(k.r) ? (k.r.toFixed(2) + '/' + k.n).padStart(10) : '        --';
  });
  console.log('  ' + label.padEnd(26) + cells.join(''));
}
console.log('\n  value/count — the count is how many season pairs backed it');
