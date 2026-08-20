import { AppShell } from './screens/AppShell';
import { BootScreen, ConnectScreen, LeaguesScreen } from './screens/Onboarding';
import { useApp } from './state/useApp';
import { Mark } from './ui/Mark';

export default function App() {
  const app = useApp();
  // Only the app itself earns the full window on a laptop. Connect and the
  // league picker are one short form each — stretched across 1400px they would
  // read as a broken page, not a spacious one.
  const inApp = app.stage === 'app' && !!app.model;

  return (
    <div className="app-frame">
      <div className={inApp ? 'app-column app-column-wide' : 'app-column'}>
        {app.stage === 'connect' && <ConnectScreen app={app} />}
        {app.stage === 'leagues' && <LeaguesScreen app={app} />}
        {app.stage === 'app' && !app.model && <BootScreen app={app} />}
        {app.stage === 'app' && app.model && <AppShell app={app} model={app.model} />}

        {app.toast ? (
          <div
            role="status"
            onClick={app.hideToast}
            className="toast"
            style={{
              background: '#2f3245', border: '1px solid var(--color-divider)', borderRadius: 12,
              padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 10,
              boxShadow: 'var(--shadow-lg)', cursor: 'pointer', animation: 'fadeUp .25s ease backwards',
            }}
          >
            <Mark size={20} />
            <span style={{ fontSize: 13, lineHeight: 1.4 }}>{app.toast}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
