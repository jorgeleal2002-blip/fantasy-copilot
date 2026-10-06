/** What the touchdown and big-play alerts are set to, kept on this phone. */
export interface AlertPrefs {
  /** in-app banners at all */
  on: boolean;
  /** the opponent's players too, not only yours */
  opp: boolean;
  /** also as a phone notification, where the browser allows it */
  phone: boolean;
}

const KEY = 'fc.alerts';
export const DEFAULT_ALERTS: AlertPrefs = { on: true, opp: true, phone: false };

export function readAlerts(): AlertPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_ALERTS, ...(JSON.parse(raw) as Partial<AlertPrefs>) } : DEFAULT_ALERTS;
  } catch {
    return DEFAULT_ALERTS;
  }
}

export function writeAlerts(p: AlertPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ }
  window.dispatchEvent(new Event('fc-alerts'));
}

/** Whether this browser can show a notification at all, and whether it may. */
export function notifyState(): 'unsupported' | 'default' | 'granted' | 'denied' {
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  return Notification.permission;
}

export async function notify(title: string, body: string, tag: string, icon?: string): Promise<void> {
  if (notifyState() !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag, icon: icon || undefined });
  } catch {
    try { new Notification(title, { body, tag, icon: icon || undefined }); } catch { /* no way to show it */ }
  }
}

/** Opened from the home-screen icon rather than a browser tab. */
export const installed = () =>
  (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches)
  || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Ask for permission and switch phone notifications on. Must run inside a tap:
 * a browser refuses a permission prompt nobody asked for. True when they are on.
 */
export async function turnOnPhone(): Promise<boolean> {
  if (notifyState() === 'unsupported') return false;
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
  if (perm !== 'granted') return false;
  writeAlerts({ ...readAlerts(), on: true, phone: true });
  void notify('🔔 Alerts are on', 'Touchdowns and big plays will show up here during games.', 'alerts-on');
  return true;
}

const ASKED = 'fc.alerts.asked';
export const promptDismissed = () => { try { return localStorage.getItem(ASKED) === '1'; } catch { return true; } };
export const dismissPrompt = () => { try { localStorage.setItem(ASKED, '1'); } catch { /* fine */ } };
