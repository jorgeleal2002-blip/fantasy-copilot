import { useEffect, useRef, useState } from 'react';
import { playerName } from '../model/math';
import { playText, playsBetween, type Play } from '../model/plays';
import { scoreProjection, scoringKind } from '../model/projections';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { notify, readAlerts, watcherHandles, type AlertPrefs } from '../ui/alert-prefs';

interface Shown { key: string; pid: string; title: string; body: string; td: boolean; mine: boolean }

/** How long a banner stays before it slides away by itself. */
const SHOW_MS = 7000;

/**
 * Banners for touchdowns and big plays by your starters — and your
 * opponent's, in another colour — as the live stat feed brings them in. See
 * `model/plays` for what counts. Read from the same feed the scoreboard is
 * already polling during games, so it costs no extra request.
 */
export function PlayAlerts({ app, m }: { app: App; m: Model }) {
  const [prefs, setPrefs] = useState<AlertPrefs>(readAlerts);
  const [shown, setShown] = useState<Shown[]>([]);
  const prev = useRef<{ wk: number | null; map: Record<string, Record<string, number | undefined>> }>({ wk: null, map: {} });

  useEffect(() => {
    const on = () => setPrefs(readAlerts());
    window.addEventListener('fc-alerts', on);
    return () => window.removeEventListener('fc-alerts', on);
  }, []);

  const stats = app.weekStats as unknown as Record<string, Record<string, number | undefined>>;
  useEffect(() => {
    const was = prev.current;
    prev.current = { wk: app.week, map: stats };
    if (!prefs.on || was.wk !== app.week || !Object.keys(was.map).length) return;

    const meId = m.leagueRows.find(r => r.isMe)?.id;
    const mine = app.matchups.find(r => r.roster_id === meId);
    const theirs = mine?.matchup_id != null
      ? app.matchups.find(r => r.matchup_id === mine.matchup_id && r.roster_id !== meId) : undefined;
    const starters = (r: typeof mine) => (r?.starters || []).filter(id => id && id !== '0');
    const myIds = new Set(starters(mine));
    const watch = new Set([...myIds, ...(prefs.opp ? starters(theirs) : [])]);
    if (!watch.size) return;

    const scoring = m.league.scoring_settings;
    const kind = scoringKind(scoring);
    const pts = (l: Record<string, number | undefined>) => scoreProjection(l as Record<string, number>, scoring, kind);
    const plays: Play[] = playsBetween(was.map, stats, watch, pts);
    if (!plays.length) return;

    const now = Date.now();
    const fresh = plays.map((p, i) => {
      const pl = app.data?.players[p.pid];
      const name = pl ? playerName(pl) : p.pid;
      const both = myIds.has(p.pid) && starters(theirs).includes(p.pid);
      const t = playText(p, name, both ? 'both' : myIds.has(p.pid) ? 'mine' : 'theirs');
      return { key: now + ':' + i + ':' + p.pid, pid: p.pid, ...t, td: p.kind === 'td', mine: myIds.has(p.pid) };
    });
    setShown(s => [...fresh, ...s].slice(0, 3));
    for (const f of fresh) {
      window.setTimeout(() => setShown(s => s.filter(x => x.key !== f.key)), SHOW_MS);
      /* Not when the watcher has this phone: it pushes every touchdown by a
         starter already, and a local notification for the same play would
         arrive beside it as a second bubble. The banner above still shows —
         that is instant, off the live feed, and is why the app is open. Big
         plays and the opponent's players are nobody else's job, so those
         still go to the phone from here. */
      if (prefs.phone && !watcherHandles(prefs, f.td, f.mine)) void notify(f.title, f.body, f.key, app.photoFor(f.pid) || undefined);
    }
    // Only a new read of the feed is news.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]);

  if (!shown.length) return null;
  return (
    <div className="pa-stack" role="status" aria-live="polite">
      {shown.map(s => {
        const photo = app.photoFor(s.pid);
        return (
          <button
            key={s.key}
            type="button"
            className={'pa-banner' + (s.td ? ' is-td' : '') + (s.mine ? '' : ' is-opp')}
            onClick={() => { app.setDetail(s.pid); setShown(x => x.filter(y => y.key !== s.key)); }}
          >
            {photo ? <img className="pa-face" src={photo} alt="" /> : <span className="pa-face" />}
            <span className="pa-text">
              <span className="pa-title">{s.title}</span>
              <span className="pa-body">{s.body}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
