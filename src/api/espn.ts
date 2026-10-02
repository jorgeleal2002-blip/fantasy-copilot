/**
 * ESPN's public NFL scoreboard: every game of a week with its score, quarter
 * and clock. No key, and it answers browsers directly. Parsed in
 * `model/nfl-games`, because the shape is theirs and not promised to anyone.
 */
export async function getNflScoreboard(season: string | number, week: number): Promise<unknown> {
  const r = await fetch(
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week='
      + week + '&dates=' + season,
    { cache: 'no-store' },
  );
  if (!r.ok) throw new Error('scoreboard ' + r.status);
  return r.json();
}
