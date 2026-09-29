import { useEffect, useMemo } from 'react';
import { BAD, GOOD } from '../model/constants';
import { powerRankings, RECENT_WEEKS, type PowerTeam } from '../model/power';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { Card, Empty } from '../ui/primitives';
import { cardNote, dim, ellipsis } from '../ui/styles';

/**
 * The league by who has actually been the best, with the schedule taken out.
 *
 * Ordered by the all-play record and nothing else — see `model/power` for why
 * the roster and the recent form are in the sentence rather than in the sort.
 */
export function PowerRankings({ app, m }: { app: App; m: Model }) {
  // Strictly before the week on the clock: a week in progress is not a result.
  const done = Math.max(0, (app.week ?? 1) - 1);
  useEffect(() => { void app.fetchWeekScores(done); }, [app.fetchWeekScores, done]);

  const teams = useMemo(
    () => powerRankings(m.leagueRows, app.weekScores),
    [m.leagueRows, app.weekScores],
  );

  if (app.powerState === 'loading' && !app.weekScores.length) {
    return <div style={{ ...cardNote, padding: '4px 2px' }}>Reading every week of the season…</div>;
  }
  if (app.powerState === 'fail') {
    return <div style={{ ...cardNote, padding: '4px 2px' }}>Sleeper did not return this season&apos;s scores.</div>;
  }
  if (!teams.length) {
    return <Empty title="No teams to rank" body="This league has no rosters yet." />;
  }

  const weeks = Math.max(...teams.map(t => t.weeks), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5), textWrap: 'pretty' }}>
        {weeks
          ? <>
              Every team against every other team, every week — {weeks === 1 ? '1 week' : weeks + ' weeks'} of
              it, so the schedule has nothing left to say. Losing 130 to the league&apos;s best week and beating
              78 with 81 count the same in the standings; they do not count the same here.
            </>
          : <>Nothing has finished yet, so this is the roster. It becomes a record the week after week one.</>}
      </div>

      {teams.map(t => <Row key={t.id} t={t} />)}

      {weeks ? (
        <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(0.33), textWrap: 'pretty' }}>
          Ordered by the all-play record alone, which is a fact rather than a model — no weights, no market
          values, just who outscored whom. What the roster is worth and how a team has scored over the
          last {RECENT_WEEKS} weeks are in the line under each row, where they say what is about to change
          without quietly moving anybody up the page.
        </div>
      ) : null}
    </div>
  );
}

function Row({ t }: { t: PowerTeam }) {
  const pct = Math.round(t.allPlay.pct * 100);
  const lucky = t.luck >= 1.2;
  const unlucky = t.luck <= -1.2;

  return (
    <Card style={t.isMe ? { border: '1px solid rgba(145, 132, 217, 0.45)' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          flex: 'none', width: 22, textAlign: 'center', fontSize: 15, fontWeight: 500,
          letterSpacing: '-0.02em', color: t.isMe ? 'var(--color-accent)' : dim(0.45),
        }}>
          {t.rank}
        </div>
        {t.avatar
          ? <img src={t.avatar} alt="" style={{ width: 26, height: 26, borderRadius: 7, flex: 'none', objectFit: 'cover' }} />
          : <div style={{ width: 26, height: 26, borderRadius: 7, flex: 'none', background: 'rgba(233,233,237,0.06)' }} />}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12.5, fontWeight: 500, ...ellipsis,
            color: t.isMe ? 'var(--color-accent)' : 'var(--color-text)',
          }}>
            {t.name}
          </div>
          <div style={{ fontSize: 10, color: dim(0.4), marginTop: 1 }}>
            {t.weeks
              ? `${t.allPlay.wins}-${t.allPlay.losses}${t.allPlay.ties ? '-' + t.allPlay.ties : ''} all-play · ${pct}%`
              : 'no weeks played'}
          </div>
        </div>

        {/* The real record beside the honest one, so the gap between them is
            something you can see rather than something you have to be told. */}
        <div style={{ flex: 'none', textAlign: 'right' }}>
          <div style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{t.record.label}</div>
          {lucky || unlucky ? (
            <div style={{ fontSize: 9.5, marginTop: 1, color: lucky ? BAD : GOOD }}>
              {(t.luck > 0 ? '+' : '−') + Math.abs(t.luck).toFixed(1) + ' vs earned'}
            </div>
          ) : t.ppg ? (
            <div style={{ fontSize: 9.5, marginTop: 1, color: dim(0.35) }}>{t.ppg.toFixed(1)} pts/gm</div>
          ) : null}
        </div>
      </div>

      <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(0.55), marginTop: 7, textWrap: 'pretty' }}>
        {t.read}
      </div>
    </Card>
  );
}
