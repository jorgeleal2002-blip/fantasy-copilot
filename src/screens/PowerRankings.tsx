import { useEffect, useMemo } from 'react';
import { BAD, GOOD } from '../model/constants';
import { powerRankings, type PowerTeam } from '../model/power';
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
  /* Every week up to and including the one showing. Which of them have
   * finished is worked out from the scores, not from the clock. */
  const done = Math.max(0, app.week ?? 1);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {teams.map(t => <Row key={t.id} t={t} />)}

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
        <div style={{ flex: 'none', width: 26, textAlign: 'center' }}>
          <div style={{
            fontSize: 15, fontWeight: 500, letterSpacing: '-0.02em',
            color: t.isMe ? 'var(--color-accent)' : dim(0.45),
          }}>
            {t.rank}
          </div>
          {/* Where they came from. A power ranking is read for the movement as
              much as for the order, and a rank with no history is a table. */}
          {t.move ? (
            <div style={{ fontSize: 9, marginTop: 1, color: t.move > 0 ? GOOD : BAD }}>
              {(t.move > 0 ? '▲' : '▼') + Math.abs(t.move)}
            </div>
          ) : t.was != null ? (
            <div style={{ fontSize: 9, marginTop: 1, color: dim(0.25) }}>–</div>
          ) : null}
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
          {/* The record the scoring earned, and how far a normal week lands
              from their average. Two numbers a standings table cannot hold. */}
          {t.weeks ? (
            <div style={{ fontSize: 9.5, color: dim(0.28), marginTop: 1, ...ellipsis }}>
              {[
                t.expected ? `earned ${t.expected.wins}-${t.expected.losses}` : '',
                t.swing != null ? `±${t.swing.toFixed(0)} a week` : '',
                t.ppg ? `${t.ppg.toFixed(1)} pts/gm` : '',
              ].filter(Boolean).join(' · ')}
            </div>
          ) : null}
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
          ) : null}
        </div>
      </div>

      {/* A tag, not a sentence: the figures a sentence would quote are in the
          row above it, and most teams get none at all — a tag on every row is
          a tag that says nothing. */}
      {t.read ? <div className="pw-tag">{t.read}</div> : null}
    </Card>
  );
}
