/**
 * Emits the fixture as a map of API URL → JSON body, so the browser smoke test
 * can stub `fetch` with the exact payloads the app expects.
 *
 *   npx esbuild scripts/emit-fixture.ts --bundle --platform=node --outfile=<tmp>.cjs
 *   node <tmp>.cjs <out.json>
 */
import { writeFileSync } from 'node:fs';
import {
  DRAFT_ID, LEAGUE_ID, MY_USERNAME, makeDraft, makeFantasyCalc, makeLeague, makePicks,
  makePlayers, makeRosters, makeStats, makeTraded, makeUsers,
} from '../src/test/fixture';

const { players, byPos } = makePlayers();
const league = makeLeague();

const routes: Record<string, unknown> = {
  [`/v1/user/${MY_USERNAME}`]: { user_id: 'u1', display_name: MY_USERNAME },
  '/v1/state/nfl': { season: '2026' },
  '/v1/user/u1/leagues/nfl/2026': [league, { ...league, league_id: '999', name: 'Leagues Cup', settings: { type: 0 }, total_rosters: 12 }],
  [`/v1/league/${LEAGUE_ID}`]: league,
  [`/v1/league/${LEAGUE_ID}/users`]: makeUsers(),
  [`/v1/league/${LEAGUE_ID}/rosters`]: makeRosters(byPos),
  [`/v1/league/${LEAGUE_ID}/drafts`]: [makeDraft()],
  [`/v1/league/${LEAGUE_ID}/traded_picks`]: makeTraded(),
  [`/v1/draft/${DRAFT_ID}`]: makeDraft(),
  [`/v1/draft/${DRAFT_ID}/picks`]: makePicks(),
  '/v1/players/nfl': players,
  '/v1/stats/nfl/regular/2025': makeStats(players),
  '__fantasycalc__': makeFantasyCalc(players),
};

writeFileSync(process.argv[2], JSON.stringify(routes));
console.log('wrote', process.argv[2], Object.keys(routes).length, 'routes');
