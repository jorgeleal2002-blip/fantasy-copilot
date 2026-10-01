/**
 * Emits the fixture as a map of API URL → JSON body, so the browser smoke test
 * can stub `fetch` with the exact payloads the app expects.
 *
 *   npx esbuild scripts/emit-fixture.ts --bundle --platform=node --outfile=<tmp>.cjs
 *   node <tmp>.cjs <out.json>
 */
import { writeFileSync } from 'node:fs';
import {
  DRAFT_ID, LEAGUE_ID, MY_USERNAME, makeDraft, makeFantasyCalc, makeLeague, makeMatchups,
  makePicks, makePlayers, makeProjections, makeRosters, makeStats, makeTraded,
  makeUsers, makeWeekStats,
} from '../src/test/fixture';

const { players, byPos } = makePlayers();
const league = makeLeague();

const routes: Record<string, unknown> = {
  [`/v1/user/${MY_USERNAME}`]: { user_id: 'u1', display_name: MY_USERNAME },
  /* Week four, which is the week the rosters' 3-0 and 0-3 records describe.
     A clock at week one under a table of three-game records is a league that
     cannot exist, and it also put every week of the season in the future — so
     the scoreboard's "Final" and "Upcoming" states had nothing to draw them. */
  '/v1/state/nfl': { season: '2026', week: 4, display_week: 4 },
  '/v1/user/u1/leagues/nfl/2026': [league, { ...league, league_id: '999', name: 'Leagues Cup', settings: { type: 0 }, total_rosters: 12 }],
  [`/v1/league/${LEAGUE_ID}`]: league,
  [`/v1/league/${LEAGUE_ID}/users`]: makeUsers(),
  [`/v1/league/${LEAGUE_ID}/rosters`]: makeRosters(byPos),
  [`/v1/league/${LEAGUE_ID}/drafts`]: [makeDraft()],
  [`/v1/league/${LEAGUE_ID}/traded_picks`]: makeTraded(),
  [`/v1/draft/${DRAFT_ID}`]: makeDraft(),
  [`/v1/draft/${DRAFT_ID}/picks`]: makePicks(),
  '/v1/players/nfl': players,
  // three seasons, so the expected-TD regression and the blend both have
  // something real to chew on
  '/v1/stats/nfl/regular/2025': makeStats(players),
  '/v1/stats/nfl/regular/2024': makeStats(players),
  '/v1/stats/nfl/regular/2023': makeStats(players),
  '__fantasycalc__': makeFantasyCalc(players),
};

// Every week the scoreboard can page to, so stepping back and forward is a
// real journey rather than one stubbed week and seventeen blanks.
for (let w = 1; w <= 18; w++) {
  routes[`/v1/league/${LEAGUE_ID}/matchups/${w}`] = makeMatchups(byPos, w);
  // What each man actually did, and what he was supposed to do. Without these
  // the matchup sheet draws with no stat lines, no projections, no bar and no
  // margin — which is to say it draws a different screen from the one that
  // ships, and a check against it proves nothing about the one that does.
  routes[`/v1/stats/nfl/regular/${league.season}/${w}`] = makeWeekStats(players, w);
  routes[`__proj__/${league.season}/${w}`] = makeProjections(players, w);
}

writeFileSync(process.argv[2], JSON.stringify(routes));
console.log('wrote', process.argv[2], Object.keys(routes).length, 'routes');
