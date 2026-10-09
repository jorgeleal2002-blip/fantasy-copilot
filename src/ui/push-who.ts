/**
 * Who the touchdown watcher is pushing to, read off the model.
 *
 * The names are here because the watcher has none: the whole Sleeper player
 * file is megabytes and it runs once a minute, so it knows player ids and
 * nothing else. The app holds that file anyway, so it leaves behind a map of
 * just its own roster — fifteen entries — and the lock screen gets a name
 * instead of a number.
 */
import type { Model } from '../model/types';
import type { PushWho } from './alert-prefs';

export const pushWho = (m: Model): PushWho => ({
  leagueId: m.league.league_id,
  userId: m.me.id,
  names: Object.fromEntries(m.myPlayers.map(p => [p.id, { n: p.name, p: p.pos, t: p.team || '' }])),
});
