/**
 * Who the touchdown watcher is pushing to, read off the model.
 *
 * The names are here because the watcher has none: the whole Sleeper player
 * file is megabytes and it runs once a minute, so it knows player ids and
 * nothing else. The app holds that file anyway, so it leaves behind a map of
 * just its own roster — fifteen entries — and the lock screen gets a name
 * instead of a number.
 */
import { currentUid } from '../api/access';
import type { Model } from '../model/types';
import type { PushWho } from '../api/push';

export const pushWho = (m: Model): PushWho => ({
  leagueId: m.league.league_id,
  userId: m.me.id,
  names: Object.fromEntries(m.myPlayers.map(p => [p.id, { n: p.name, p: p.pos, t: p.team || '' }])),
  /* The chat's account id, which is not the Sleeper one: a message must never
     come back to the person who wrote it, and the chat knows its writers by
     this. Null before this phone has been let in. */
  ...(currentUid() ? { uid: currentUid() as string } : {}),
  user: m.me.name,
});
