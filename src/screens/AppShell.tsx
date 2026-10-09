import { useEffect } from 'react';
import { leagueAvatar } from '../api/sleeper';
import type { Model } from '../model/types';
import type { App, Tab } from '../state/useApp';
import { dim, ellipsis, tabStyle } from '../ui/styles';
import { Mark } from '../ui/Mark';
import { DraftTab } from './DraftTab';
import { LeagueTab } from './LeagueTab';
import { MockRoom } from './MockRoom';
import { PlayerSheet } from './PlayerSheet';
import { PlayAlerts } from './PlayAlerts';
import { NotifyPrompt } from './NotifyPrompt';
import { pushWho } from '../ui/push-who';
import { syncPush } from '../ui/alert-prefs';
import { ChatDock } from './ChatDock';
import { SettingsTab } from './SettingsTab';
import { TeamSheet } from './TeamSheet';
import { MatchupSheet } from './MatchupSheet';
import { CompareSheet } from './CompareSheet';
import { TeamTab } from './TeamTab';
import { TradesTab } from './TradesTab';

const HEADER: Record<Tab, { kicker: (m: Model) => string; title: (m: Model) => string }> = {
  /* Your own team is called something, and it is the one screen in here where
     the generic word was standing in for a name you chose. The league keeps the
     line above it, so nothing is lost. It falls back where there is nothing to
     fall forward to: an account that is not in this league has no team to name. */
  team: { kicker: m => m.league.name, title: m => m.myTeamName || 'Your team' },
  trades: { kicker: () => 'Trade engine', title: () => 'Suggested trades' },
  draft: { kicker: m => m.league.name, title: () => 'Draft AI' },
  league: { kicker: m => m.league.name, title: () => 'The league' },
  settings: { kicker: () => 'Account', title: () => 'Settings' },
};

const ICONS: Record<Tab, JSX.Element> = {
  team: <path d="M5 20v-1.5A3.5 3.5 0 0 1 8.5 15h3A3.5 3.5 0 0 1 15 18.5V20M10 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M17 20v-1.5a3.5 3.5 0 0 0-2-3.16" />,
  trades: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  draft: <path d="M12 3v18M5 8l7-5 7 5M5 8v8l7 5 7-5V8" />,
  league: <path d="M4 19h16M7 19V9M12 19V5M17 19v-7" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </>
  ),
};

/* Your team, then the league it plays in, then the two things you do to your
   team — which is the order the week is actually read in. League sat fourth,
   past Draft, although in season it is opened far more often than either. */
const TABS: { key: Tab; label: string }[] = [
  { key: 'team', label: 'Team' },
  { key: 'league', label: 'League' },
  { key: 'trades', label: 'Trades' },
  { key: 'draft', label: 'Draft' },
  { key: 'settings', label: 'You' },
];

export function AppShell({ app, model }: { app: App; model: Model }) {
  const logo = leagueAvatar(model.league.avatar);
  const detail = app.detail;
  const isTeamDetail = typeof detail === 'string' && detail.startsWith('team-');
  const isMatchupDetail = typeof detail === 'string' && detail.startsWith('matchup-');
  const isCompare = typeof detail === 'string' && detail.startsWith('compare-');

  /* Leave today's roster with the touchdown watcher, and put the stored
   * "subscribed" flag back in step with what the browser actually holds.
   *
   * The watcher reads the LINEUP from Sleeper itself every minute, so a
   * start/sit made on the phone counts with the app shut. Names it cannot
   * read — the player file is megabytes — so they come from here. Keyed on
   * the roster's ids because a trade is the only thing that changes the
   * answer. Does nothing at all in a build with no watcher behind it. */
  const rosterIds = model.myPlayers.map(p => p.id).join(',');
  useEffect(() => {
    void syncPush(pushWho(model));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterIds, model.league.league_id, model.me.id]);

  return (
    <div className="shell">
      <PlayAlerts app={app} m={model} />
      <NotifyPrompt who={pushWho(model)} />
      <header
        className="shell-head"
        style={{
          padding: 'calc(var(--safe-top) + 11px) 15px 9px',
          display: 'flex', alignItems: 'center', gap: 11,
          background: 'linear-gradient(to bottom, var(--scrim-head), transparent)',
        }}
      >
        {logo ? (
          <img
            src={logo}
            alt="Change league"
            className="shell-head-logo"
            role="button"
            tabIndex={0}
            onClick={() => void app.switchLeague()}
            onKeyDown={e => { if (e.key === 'Enter') void app.switchLeague(); }}
            style={{
              width: 34, height: 34, borderRadius: 8, flex: 'none', objectFit: 'cover',
              border: 'var(--hairline) solid var(--color-divider)', cursor: 'pointer',
            }}
          />
        ) : null}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: dim(0.62), ...ellipsis }}>
            {HEADER[app.tab].kicker(model)}
          </div>
          <div style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.02em', marginTop: 2, ...ellipsis }}>
            {HEADER[app.tab].title(model)}
          </div>
        </div>
        <button
          type="button"
          aria-label="Settings"
          className="shell-head-me"
          onClick={() => app.setTab('settings')}
          style={{
            width: 34, height: 34, flex: 'none', borderRadius: '50%', overflow: 'hidden', padding: 0,
            background: 'var(--color-surface)', border: 'var(--hairline) solid var(--color-divider)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 600, color: 'var(--color-accent)', cursor: 'pointer',
          }}
        >
          {model.me.avatar
            ? <img src={model.me.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : model.me.initials}
        </button>
      </header>

      <main className="shell-main">
        {app.tab === 'team' && <TeamTab app={app} m={model} />}
        {app.tab === 'trades' && <TradesTab app={app} m={model} />}
        {app.tab === 'draft' && <DraftTab app={app} m={model} />}
        {app.tab === 'league' && <LeagueTab app={app} m={model} />}
        {app.tab === 'settings' && <SettingsTab app={app} m={model} />}
      </main>

      <ChatDock app={app} m={model} />

      <nav className="shell-nav">
        {/* A laptop's rail carries who and where: the app, the league, you.
            On a phone the header already does, so these stay hidden there. */}
        <button type="button" className="rail-brand" onClick={() => void app.switchLeague()} title="Change league">
          {logo ? <img src={logo} alt="" className="rail-logo" /> : <Mark size={36} />}
          <span className="rail-brand-text">
            <span className="rail-app">Doctors</span>
            <span className="rail-league">{model.league.name}</span>
          </span>
        </button>
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => app.setTab(t.key)}
            aria-current={app.tab === t.key ? 'page' : undefined}
            className="tab-btn ghost-tap"
            style={tabStyle(app.tab === t.key)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ flex: 'none' }}>
              {ICONS[t.key]}
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
        <button type="button" className="rail-me" onClick={() => app.setTab('settings')}>
          <span className="rail-me-av">
            {model.me.avatar ? <img src={model.me.avatar} alt="" /> : model.me.initials}
          </span>
          <span className="rail-me-text">
            <span className="rail-me-name">{model.myTeamName || model.me.teamName}</span>
            <span className="rail-me-sub">{model.me.name}</span>
          </span>
        </button>
      </nav>

      {app.mockOpen ? <MockRoom app={app} m={model} /> : null}
      {isTeamDetail ? <TeamSheet app={app} m={model} rosterId={Number(detail!.slice(5))} /> : null}
      {isMatchupDetail ? (
        <MatchupSheet app={app} m={model} ids={detail!.slice(8).split('-').map(Number)} />
      ) : null}
      {isCompare ? <CompareSheet app={app} m={model} ids={detail!.slice(8).split('~')} /> : null}
      {detail && !isTeamDetail && !isMatchupDetail && !isCompare
        ? <PlayerSheet app={app} m={model} playerId={detail} /> : null}
    </div>
  );
}
