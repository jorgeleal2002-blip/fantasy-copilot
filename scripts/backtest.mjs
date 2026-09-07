/**
 * Does the Rating actually predict anything?
 *
 * Every weight in this model was chosen by hand and none of them was ever
 * checked against a result. This is the check: feed the model one real NFL
 * season, ask it to order the players, and score that order against what those
 * players actually did the NEXT season. A weight that helps shows up as a
 * better order; a weight that is decoration shows up as nothing.
 *
 * It runs the REAL scoring code — `seasonUsage`, `blendSeasons`, `scorePlayer`
 * and the shipped weights — rather than a copy of it, because a backtest of a
 * reimplementation measures the reimplementation.
 *
 * WHAT IT CANNOT SEE. Two of the heaviest metrics, talent and replaceability,
 * are built on FantasyCalc's market values, and there is no historical archive
 * of those to replay. So the market is held at a stand-in — where a player
 * ranked in the season BEFORE the one being scored, which is public knowledge
 * at the time and is roughly what a market is — and the same stand-in is used
 * as the baseline to beat. That makes this a fair test of everything the model
 * derives from real usage, and no test at all of the market half. It is the
 * half the numbers said was mispriced.
 *
 * Not part of the test suite: it needs sixty megabytes of downloads that the
 * repository does not carry, so it is a tool you run rather than a test that
 * runs itself.
 *
 *     node scripts/fetch-nflverse.mjs 2021 2025
 *     npx vite-node scripts/backtest.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STRATS } from '../src/model/constants.ts';
import { talentScale } from '../src/model/math.ts';
import { ownedWeights, redraftWeights, scorePlayer } from '../src/model/score.ts';
import { blendSeasons, seasonUsage } from '../src/model/usage.ts';

const DIR = process.env.NFLVERSE_DIR || join(process.cwd(), '.nflverse');
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

/* ── the data ─────────────────────────────────────────────────────────────── */

function csv(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const head = lines[0].split(',');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = [];
    let cur = '', q = false;
    for (const ch of line) {
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

const seasons = () => readdirSync(DIR)
  .map(f => /^week_(\d{4})\.csv$/.exec(f))
  .filter(Boolean)
  .map(m => Number(m[1]))
  .sort((a, b) => a - b);

/**
 * One season, in the shapes the model consumes.
 *
 * The app is fed Sleeper's season totals, so the weekly rows are summed into
 * exactly that shape and handed to the same `seasonUsage` the phone runs. Two
 * columns Sleeper has are not in this feed — red-zone carries and red-zone
 * targets — so the red-zone metric falls back to touchdowns per game, which is
 * what it does on a phone whenever those are missing.
 */
function load(year, bio) {
  const num = (r, k) => {
    const v = Number(r[k]);
    return Number.isFinite(v) ? v : 0;
  };
  const stats = {};
  const players = {};
  const team = {};
  const names = {};

  csv(join(DIR, 'week_' + year + '.csv')).forEach(r => {
    if (r.season_type !== 'REG') return;
    const pos = r.position;
    if (POSITIONS.indexOf(pos) < 0) return;
    const id = r.player_id;
    const s = (stats[id] = stats[id] || {});
    s.gp = (s.gp || 0) + 1;
    s.rec_tgt = (s.rec_tgt || 0) + num(r, 'targets');
    s.rec = (s.rec || 0) + num(r, 'receptions');
    s.rec_yd = (s.rec_yd || 0) + num(r, 'receiving_yards');
    s.rush_att = (s.rush_att || 0) + num(r, 'carries');
    s.rush_yd = (s.rush_yd || 0) + num(r, 'rushing_yards');
    s.pass_att = (s.pass_att || 0) + num(r, 'attempts');
    s.pass_yd = (s.pass_yd || 0) + num(r, 'passing_yards');
    s.rush_td = (s.rush_td || 0) + num(r, 'rushing_tds');
    s.rec_td = (s.rec_td || 0) + num(r, 'receiving_tds');
    s.pass_td = (s.pass_td || 0) + num(r, 'passing_tds');
    // Half PPR is the midpoint of the two the feed publishes.
    s.pts_half_ppr = (s.pts_half_ppr || 0)
      + (num(r, 'fantasy_points') + num(r, 'fantasy_points_ppr')) / 2;
    names[id] = r.player_display_name;
    (team[id] = team[id] || {})[r.team] = (team[id][r.team] || 0) + 1;
  });

  /* Snaps live in their own file and are keyed by name rather than by the id
     the stats use, so they are joined on the name and the season. */
  const snap = {};
  const snapPath = join(DIR, 'snaps_' + year + '.csv');
  if (existsSync(snapPath)) {
    csv(snapPath).forEach(r => {
      if (r.game_type !== 'REG') return;
      const k = (r.player || '').toLowerCase();
      const e = (snap[k] = snap[k] || { off: 0, team: {} });
      e.off += num(r, 'offense_snaps');
      e.team[r.team] = (e.team[r.team] || 0) + 1;
    });
  }
  /* A team's offensive snaps for the season: the most any one of its players
     was on the field for. Nobody plays every snap, so this understates a
     little and understates it the same way for everybody, which is all a share
     needs. */
  const teamSnaps = {};
  Object.keys(snap).forEach(k => {
    const e = snap[k];
    const t = Object.keys(e.team).sort((a, b) => e.team[b] - e.team[a])[0];
    if (t) teamSnaps[t] = Math.max(teamSnaps[t] || 0, e.off);
  });

  const ppg = {};
  Object.keys(stats).forEach(id => {
    const s = stats[id];
    const t = Object.keys(team[id]).sort((a, b) => team[id][b] - team[id][a])[0];
    const b = bio[id] || {};
    const born = b.birth_date ? new Date(b.birth_date) : null;
    const age = born && !Number.isNaN(born.getTime())
      ? Math.round(((new Date(year + '-09-01').getTime() - born.getTime()) / 3.15576e10) * 10) / 10
      : null;
    const drafted = Number(b.draft_year);
    players[id] = {
      player_id: id,
      position: csvPos(bio[id]) || guessPos(s),
      full_name: names[id],
      age,
      team: t || null,
      years_exp: Number.isFinite(drafted) && drafted > 1990 ? Math.max(year - drafted, 0) : null,
      active: true,
      status: 'Active',
      injury_status: null,
    };
    const my = snap[(names[id] || '').toLowerCase()];
    if (my && t && teamSnaps[t]) {
      s.off_snp = my.off;
      s.tm_off_snp = teamSnaps[t];
    }
    ppg[id] = (s.pts_half_ppr || 0) / Math.max(s.gp || 1, 1);
  });
  return { players, stats, ppg };
}

const csvPos = (b) => (b && POSITIONS.indexOf(b.position) >= 0 ? b.position : null);
const guessPos = (s) =>
  (s.pass_att || 0) > 40 ? 'QB' : (s.rush_att || 0) > (s.rec_tgt || 0) ? 'RB' : 'WR';

/* ── scoring an ordering ──────────────────────────────────────────────────── */

/** How much of one order survives into the other. 1 is perfect, 0 is nothing. */
function spearman(pairs) {
  const n = pairs.length;
  if (n < 8) return NaN;
  const rank = (get) => {
    const order = pairs.map((_, i) => i).sort((a, b) => get(pairs[a]) - get(pairs[b]));
    const r = new Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && get(pairs[order[j + 1]]) === get(pairs[order[i]])) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[order[k]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(p => p[0]);
  const rb = rank(p => p[1]);
  const ma = ra.reduce((a, b) => a + b, 0) / n;
  const mb = rb.reduce((a, b) => a + b, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : NaN;
}

/**
 * The market, stood in for.
 *
 * Where a player finished the season before, in points per game, turned into a
 * value on the same scale the real feed uses. It is public before the season
 * being scored, it is roughly what a market prices, and holding it fixed is
 * what makes the rest of the comparison fair — every candidate ordering below
 * gets the same one.
 */
function proxyMarket(prev) {
  const out = {};
  Object.keys(prev.ppg).forEach(id => {
    if ((prev.stats[id]?.gp || 0) < 4) return;
    out[id] = Math.max(prev.ppg[id], 0.1) * 100;
  });
  return out;
}

/** Run the shipped model over one season and hand back its order. */
function rate(prev, w, usage, dv) {
  const values = Object.keys(dv).map(k => dv[k]);
  const dvMax = Math.max.apply(null, values.concat([0.01]));
  // Replaceability, exactly as the app computes it: the gap to the last man
  // the league would still be starting at that position.
  const byPos = {};
  Object.keys(dv).forEach(id => {
    const p = prev.players[id]?.position;
    if (POSITIONS.indexOf(p) < 0) return;
    (byPos[p] = byPos[p] || []).push(dv[id]);
  });
  const DEPTH = { QB: 12, RB: 24, WR: 36, TE: 12 };
  const repl = {};
  let surplusMax = 0.01;
  POSITIONS.forEach(p => {
    const vs = (byPos[p] || []).sort((a, b) => b - a);
    repl[p] = vs.length ? (vs[DEPTH[p]] ?? vs[vs.length - 1]) : 0;
    if (vs.length) surplusMax = Math.max(surplusMax, vs[0] - repl[p]);
  });

  const order = Object.keys(dv).sort((a, b) => dv[b] - dv[a]);
  const marketRank = {};
  order.forEach((id, i) => { marketRank[id] = i + 1; });

  seenMetrics.length = 0;
  return order.map(id => {
    const pl = prev.players[id];
    const pos = pl.position;
    const s = scorePlayer(pl, {}, {
      dv: dv[id], dvMax,
      rank: marketRank[id],
      use: usage[id],
      redraft: true,
      vor: talentScale(Math.max(0, dv[id] - (repl[pos] ?? 0)), surplusMax),
    }, w);
    seenMetrics.push(s.m);
    return { id, pos, fit: s.fit };
  });
}

/**
 * The breakdowns from the last run, so the report can tell a metric that was
 * measured and found useless from one that was never fed anything.
 *
 * Stacks need a roster and the schedule table only covers the current season,
 * so neither is supplied here — they sit at their neutral for every player,
 * and a constant cannot change an order. Reporting them beside the ones that
 * really were varied would be reporting a result that was never run.
 */
const seenMetrics = [];
const wasConstant = (k) => {
  const first = seenMetrics[0]?.[k];
  return seenMetrics.every(m => m[k] === first);
};

/* ── the report ───────────────────────────────────────────────────────────── */

const bio = {};
csv(join(DIR, 'players.csv')).forEach(r => { if (r.gsis_id) bio[r.gsis_id] = r; });
const years = seasons();
const loaded = {};
years.forEach(y => { loaded[y] = load(y, bio); });

const pairs = years.slice(0, -1).map((y, i) => [y, years[i + 1]]);
const w = ownedWeights(redraftWeights(STRATS.balanced.w));

/** Score one ordering against what happened, over every pair of seasons. */
const run = (make) => {
  const all = [];
  const byPos = {};
  pairs.forEach(([a, b]) => {
    const prev = loaded[a], next = loaded[b];
    const dv = proxyMarket(prev);
    const usage = blendSeasons([{ year: 0, usage: seasonUsage(prev.stats, prev.players) }], prev.players);
    const scored = make(prev, usage, dv);
    // Only players who were there to be predicted, and who played enough of
    // the next season for the answer to mean anything.
    const live = scored.filter(x => next.ppg[x.id] != null && (next.stats[x.id]?.gp || 0) >= 6);
const p = live.map(x => [x.fit, next.ppg[x.id]]);
    const r = spearman(p);
    if (Number.isFinite(r)) all.push(r);
    POSITIONS.forEach(pos => {
  const q = live.filter(x => x.pos === pos).map(x => [x.fit, next.ppg[x.id]]);
      const rp = spearman(q);
      if (Number.isFinite(rp)) (byPos[pos] = byPos[pos] || []).push(rp);
    });
  });
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
  return { all: mean(all), pos: POSITIONS.map(p => mean(byPos[p] || [NaN])) };
};

const line = (name, r, base) => {
  const d = base == null ? '' : '   ' + (r.all - base >= 0 ? '+' : '') + (r.all - base).toFixed(3);
  console.log('  ' + name.padEnd(26) + r.all.toFixed(3)
    + '   ' + r.pos.map(x => (Number.isFinite(x) ? x.toFixed(2) : ' -- ')).join('  ') + d);
};

console.log('\n  seasons: ' + pairs.map(p => p[0] + '→' + p[1]).join('  '));
console.log('  how well an order predicts the NEXT season, half-PPR points per game');
console.log('\n  ' + 'ordering'.padEnd(26) + 'ALL      QB    RB    WR    TE');

// The floor any model has to clear: last season's points, in order.
const base = run((prev, _u, dv) => Object.keys(dv)
  .map(id => ({ id, pos: prev.players[id].position, fit: dv[id] }))
  .sort((a, b) => b.fit - a.fit));
line('last season, as-is', base);

const full = run((prev, usage, dv) => rate(prev, w, usage, dv));
line('the Rating, as shipped', full, base.all);

console.log('');
// Each metric taken out on its own: what does it actually buy?
const constant = [];
Object.keys(w)
  .filter(k => w[k] > 0)
  .sort((a, b) => w[b] - w[a])
  .forEach(k => {
    if (wasConstant(k)) { constant.push(k + ' (' + Math.round(w[k] * 100) + '%)'); return; }
    const without = { ...w, [k]: 0 };
    const r = run((prev, usage, dv) => rate(prev, without, usage, dv));
    line('without ' + k + ' (' + Math.round(w[k] * 100) + '%)', r, full.all);
  });
if (constant.length) {
  console.log('\n  not fed anything here, so not measured: ' + constant.join(', '));
}

