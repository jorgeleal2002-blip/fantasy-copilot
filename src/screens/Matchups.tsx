import { clockFor, phaseFor } from '../model/game-clock';
import { leaderOf, pairMatchups, type Matchup, type MatchupSide } from '../model/matchups';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { dim } from '../ui/styles';

const LAST_WEEK = 18;

/** Sleeper reports 0 before kickoff, which is a score; null means no row. */
const score = (p: number | null) => (p == null ? '—' : p.toFixed(2));

/**
 * The week's head-to-heads, laid out the way a scoreboard is: the two teams
 * facing each other on one card, yours at the top.
 *
 * Points come from the same feed the app already reads and refresh themselves
 * while games are on, so this is the one screen that changes under you.
 */
export function Matchups({ app, m }: { app: App; m: Model }) {
  const week = app.week;
  const games = pairMatchups(m.leagueRows, app.matchups, app.projections,
    clockFor(app.data?.players || {}, week, m.league.season, Date.now(), app.nflGames));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Previous week"
          disabled={!week || week <= 1}
          onClick={() => week && app.setWeek(week - 1)}
          style={{ fontSize: 15, padding: '0 4px' }}
        >
          ‹
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 500 }}>
          {week ? 'Week ' + week : 'Matchups'}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Next week"
          disabled={!week || week >= LAST_WEEK}
          onClick={() => week && app.setWeek(week + 1)}
          style={{ fontSize: 15, padding: '0 4px' }}
        >
          ›
        </button>
      </div>

      {app.matchupState === 'fail' ? (
        <Note>Sleeper did not return this week&apos;s scores. It retries on its own.</Note>
      ) : !games.length ? (
        <Note>
          {app.matchupState === 'loading'
            ? 'Reading the scoreboard…'
            : 'No schedule published for this week yet.'}
        </Note>
      ) : games.map((g, i) => <Game key={(g.id ?? 'bye') + '-' + i} app={app} g={g} />)}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--color-surface)', borderRadius: 12, padding: '14px 13px',
      fontSize: 12, color: dim(0.62),
    }}>
      {children}
    </div>
  );
}

/** The id a game is opened under. Both rosters, so it survives a refresh and
 *  a bye has one of them. */
export const matchupId = (g: Matchup) =>
  'matchup-' + [g.a.rosterId, g.b?.rosterId].filter(n => n != null).join('-');

function Game({ app, g }: { app: App; g: Matchup }) {
  const lead = leaderOf(g);
  const open = () => app.setDetail(matchupId(g));

  return (
    <div className={'mu-card' + (g.hasMe ? ' is-mine' : '')}>
      <div
        className="mu-head"
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      >
        <Side s={g.a} winning={lead === 'a'} />
        {/* A badge rather than a chevron: the two teams are squaring up, and
            the card is still the button. Green and breathing while anybody
            in the game is on the field. */}
        {g.b
          ? <div className={'mu-vs-badge' + (isLive(app, g) ? ' is-live' : '')} aria-hidden="true"><span>VS</span></div>
          : <div className="mu-vs">bye</div>}
        {g.b ? <Side s={g.b} winning={lead === 'b'} align="right" /> : <div style={{ flex: 1 }} />}
      </div>
      <Detail app={app} g={g} />
    </div>
  );
}

/** Whether anybody starting in this game is on the field right now. */
function isLive(app: App, g: Matchup): boolean {
  const week = app.week;
  if (!week) return false;
  const players = app.data?.players || {};
  const season = Number(app.data?.league.season);
  const now = Date.now();
  return [g.a, g.b].some(s => (s?.starters || []).some(id =>
    id && id !== '0' && phaseFor(players[id]?.team, week, season, now, app.nflGames) === 'live'));
}

/**
 * Under the score line: the two projections against each other as a bar, and
 * for each side how much of the lineup is playing and how much is still to
 * play — the second thing anybody reads off a scoreboard, after the score.
 */
function Detail({ app, g }: { app: App; g: Matchup }) {
  const week = app.week;
  if (!week || !g.b) return null;
  const players = app.data?.players || {};
  const season = Number(app.data?.league.season);
  const now = Date.now();
  const tally = (s: MatchupSide) => {
    let live = 0, left = 0;
    for (const id of s.starters || []) {
      if (!id || id === '0') continue;
      const ph = phaseFor(players[id]?.team, week, season, now, app.nflGames);
      if (ph === 'live') live++;
      else if (ph === 'pre') left++;
    }
    return { live, left };
  };
  const words = ({ live, left }: { live: number; left: number }) => (
    <>
      {live ? <b className="mu-live">{live} playing</b> : null}
      {live && left ? ' · ' : ''}
      {left ? left + ' to play' : live ? '' : 'done'}
    </>
  );
  const pa = g.a.projected, pb = g.b.projected;
  const split = pa != null && pb != null && pa + pb > 0 ? pa / (pa + pb) : null;
  return (
    <div className="mu-detail">
      {split != null ? (
        <div className="mu-bar" role="img" aria-label={'projected split ' + Math.round(split * 100) + ' to ' + Math.round((1 - split) * 100)}>
          <div className={'mu-bar-a' + (g.a.isMe ? ' is-me' : '')} style={{ width: (split * 100).toFixed(1) + '%' }} />
        </div>
      ) : null}
      <div className="mu-left">
        <span>{words(tally(g.a))}</span>
        <span>{words(tally(g.b))}</span>
      </div>
    </div>
  );
}

function Side({ s, winning, align }: { s: MatchupSide; winning: boolean; align?: 'right' }) {
  const right = align === 'right';
  // The handle and the record read as one line of small print under the team
  // name. Two lines of it would push the score, which is what the card is for,
  // a third of the way down the card.
  const sub = [s.user ? '@' + s.user : '', s.record].filter(Boolean).join(' · ');
  return (
    <div className={'mu-side' + (right ? ' is-right' : '')}>
      {s.avatar
        ? <img className="mu-av" src={s.avatar} alt="" />
        : <div className="mu-av mu-av-blank" />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className={'mu-name' + (s.isMe ? ' is-me' : '')}>{s.name}</div>
        {sub ? <div className="mu-rec">{sub}</div> : null}
        {/* Bold on the leader rather than a colour: at 0-0 nobody is winning,
            and a green score before kickoff would say otherwise. */}
        <div className={'mu-pts' + (winning ? ' is-up' : '')}>
          {score(s.points)}
          {s.projected != null ? (
            <span className="mu-proj">{'proj ' + s.projected.toFixed(1)}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
