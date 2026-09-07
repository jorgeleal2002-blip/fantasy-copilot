/**
 * Downloads the seasons the backtest scores the model against.
 *
 *     node scripts/fetch-nflverse.mjs 2021 2025
 *
 * Nothing here ships — the files land in a directory the repository ignores,
 * and only the backtest reads them. They are big (about eight megabytes a
 * season) and they are somebody else's data; the app itself never touches
 * them.
 *
 * Three sets, and the backtest needs all three:
 *
 *   · stats_player_week — targets, carries, receptions, yards, touchdowns and
 *     fantasy points, a row per player per week. The season totals the model
 *     consumes are summed out of this.
 *   · snap_counts — how much of his own offence a player was on the field for,
 *     which is the single biggest input to the floor metric and is not in the
 *     stats file.
 *   · players — birth dates and draft years, so a player has an age and an
 *     experience count in the season being scored rather than today's.
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://github.com/nflverse/nflverse-data/releases/download';
const DIR = process.env.NFLVERSE_DIR || join(process.cwd(), '.nflverse');
const from = Number(process.argv[2] || 2021);
const to = Number(process.argv[3] || new Date().getFullYear() - 1);

mkdirSync(DIR, { recursive: true });

async function grab(url, name) {
  const path = join(DIR, name);
  if (existsSync(path)) { console.log('have  ' + name); return; }
  const res = await fetch(url);
  if (!res.ok) { console.log('SKIP  ' + name + ' — http ' + res.status); return; }
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  console.log('got   ' + name);
}

await grab(BASE + '/players/players.csv', 'players.csv');
for (let y = from; y <= to; y++) {
  await grab(BASE + '/stats_player/stats_player_week_' + y + '.csv', 'week_' + y + '.csv');
  await grab(BASE + '/snap_counts/snap_counts_' + y + '.csv', 'snaps_' + y + '.csv');
}
console.log('\ninto ' + DIR + ' — now: BACKTEST=1 npx vitest run src/test/backtest.test.ts');
