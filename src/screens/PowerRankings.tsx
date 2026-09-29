import { useEffect, useMemo } from 'react';
import { BAD, GOOD } from '../model/constants';
import { powerRankings, RECENT_WEEKS, WEIGHTS, type PowerTeam } from '../model/power';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { Card, Empty } from '../ui/primitives';
import { cardNote, dim, ellipsis } from '../ui/styles';

/**
 * The league by how good each team actually is.
 *
 * Points, roster and record, weighted — see `model/power`. Every part of the
 * score is printed on the row it produced, because a power ranking is for
 * arguing with and a number nobody can take apart is a number nobody can
 * argue with.
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
              Points {Math.round(WEIGHTS.points * 100)}%, roster {Math.round(WEIGHTS.roster * 100)}%,
              record {Math.round(WEIGHTS.record * 100)}%. Points is the all-play
              record — every team against every other team, every week,
              {' '}{weeks === 1 ? '1 week' : weeks + ' weeks'} of it — so the schedule has nothing left to say.
              Losing 130 to the league&apos;s best week and beating 78 with 81 count the same in the standings;
              they do not count the same here.
            </>
          : <>Nothing has finished yet, so this is the roster alone. Points and record join it after week one.</>}
      </div>

      {teams.map(t => <Row key={t.id} t={t} />)}

      {weeks ? (
        <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(0.33), textWrap: 'pretty' }}>
          Points leads because it is the best thing anyone has for what a team does next, and because it is
          a fact rather than a model — no market, nothing this app believes, just who outscored whom. The
          roster is the only part that looks forward: a trade or a starter back off injury is in it the day
          it happens. The record is the weakest of the three at saying how good a team is — over a season
          roughly half of it is who you were scheduled against — and the only one that banks a playoff
          place, so it gets the smallest share rather than none. Form over the last {RECENT_WEEKS} weeks
          stays in the sentence, where it says what is about to change without moving anybody up the page.
        </div>
      ) : null}
    </div>
  );
}

const ordinal = (n: number) => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
};

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
          {/* The score taken apart, in the order it is weighted. Three figures
              anybody can put back together rather than one to be trusted. */}
          <div style={{ fontSize: 10, color: dim(0.4), marginTop: 1, ...ellipsis }}>
            {t.weeks
              ? `${pct}% all-play · roster ${ordinal(t.rosterRank)} · ${t.record.label}`
              : `roster ${ordinal(t.rosterRank)} · no weeks played`}
          </div>
        </div>

        <div style={{ flex: 'none', textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(t.score)}
          </div>
          {/* The gap between the record and what the scoring earned, where
              there is one: something you can see rather than be told. */}
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
