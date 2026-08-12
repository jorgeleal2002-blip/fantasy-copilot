import { AppShell } from './screens/AppShell';
import { BootScreen, ConnectScreen, LeaguesScreen } from './screens/Onboarding';
import { useApp } from './state/useApp';
import { Mark } from './ui/Mark';
import { ViewportProbe } from './ui/ViewportProbe';

export default function App() {
  const app = useApp();

  return (
    <div className="app-frame">
      <ViewportProbe />
      <div className="app-column">
        {app.stage === 'connect' && <ConnectScreen app={app} />}
        {app.stage === 'leagues' && <LeaguesScreen app={app} />}
        {app.stage === 'app' && !app.model && <BootScreen app={app} />}
        {app.stage === 'app' && app.model && <AppShell app={app} model={app.model} />}

        {app.toast ? (
          <div
            role="status"
            onClick={app.hideToast}
            style={{
              position: 'absolute', left: 18, right: 18, bottom: 'calc(var(--safe-bottom) + 96px)', zIndex: 20,
              background: '#2f3245', border: '1px solid var(--color-divider)', borderRadius: 12,
              padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 10,
              boxShadow: 'var(--shadow-lg)', cursor: 'pointer', animation: 'fadeUp .25s ease both',
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
