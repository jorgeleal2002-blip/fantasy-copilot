import { PUSH_URL, disablePush, enablePush, pushSupported, refreshPush, type PushWho } from '../api/push';

export type { PushWho };

/** Whether a build has a touchdown watcher behind it at all. */
export const pushConfigured = () => !!PUSH_URL && pushSupported();

/** What the touchdown and big-play alerts are set to, kept on this phone. */
export interface AlertPrefs {
  /** in-app banners at all */
  on: boolean;
  /** the opponent's players too, not only yours */
  opp: boolean;
  /** also as a phone notification, where the browser allows it */
  phone: boolean;
  /**
   * Subscribed to the watcher, so alerts arrive with the app CLOSED.
   *
   * Separate from `phone` because the two are different mechanisms with
   * different reach: `phone` shows a notification from the app's own polling,
   * which iOS suspends the moment the app leaves the screen; this one is a
   * real push, delivered by the phone's push service whether or not anything
   * of ours is running. Kept here so `PlayAlerts` can tell, without an await,
   * that the phone is already being taken care of from outside.
   */
  push: boolean;
  /** messages in the league chat, pushed by the watcher */
  chat: boolean;
  /** only the ones that name you */
  chatTags: boolean;
}

/** The slice of the settings the watcher is told about. */
const wantsOf = (p: AlertPrefs) => ({ chat: p.chat, tagsOnly: p.chatTags });

const KEY = 'fc.alerts';
/* Chat on by default, but only ever reaching a phone that went and
   subscribed — `push` is the gate, and it is off until somebody asks. */
export const DEFAULT_ALERTS: AlertPrefs =
  { on: true, opp: true, phone: false, push: false, chat: true, chatTags: false };

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
 *
 * `who` is what the watcher needs to push to this phone with the app shut. It
 * is optional because the prompt can be answered from a screen that has no
 * model yet; without it the alerts still work the way they always did, which
 * is to say while the app is open.
 */
export async function turnOnPhone(who?: PushWho): Promise<boolean> {
  if (notifyState() === 'unsupported') return false;
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
  if (perm !== 'granted') return false;

  /* The subscription is attempted after permission and before anything is
     written, so the switch reports what is actually true: a watcher that is
     down leaves `push` false and the older, app-open alerts in place, rather
     than promising a lock screen that will stay empty. */
  let push = false;
  if (who && pushConfigured()) {
    push = (await enablePush(who, wantsOf(readAlerts()))) === 'on';
  }
  writeAlerts({ ...readAlerts(), on: true, phone: true, push });
  void notify(
    '🔔 Alerts are on',
    push
      ? 'Touchdowns reach you even with the app closed.'
      : 'Touchdowns and big plays will show up here during games.',
    'alerts-on',
  );
  return true;
}

/** Off, and off at the watcher too — otherwise it keeps pushing at a phone
 *  that has stopped asking. */
export async function turnOffPhone(): Promise<void> {
  if (readAlerts().push) await disablePush();
  writeAlerts({ ...readAlerts(), phone: false, push: false });
}

/**
 * Change what the watcher is told to send, and tell it.
 *
 * The filtering happens at the watcher, not on the phone — a push that
 * arrives and is thrown away has already lit the screen — so a setting
 * changed here is useless until it has been sent. Written locally either
 * way, so the switch moves even with no signal and the next app open
 * carries it.
 */
export async function setChatPrefs(who: PushWho, over: Partial<AlertPrefs>): Promise<void> {
  const next = { ...readAlerts(), ...over };
  writeAlerts(next);
  if (next.push) await refreshPush(who, wantsOf(next));
}

/**
 * Put the stored flag back in step with the browser, and leave today's names.
 *
 * A subscription can be dropped from outside the app — the permission
 * revoked, the push service expiring it, the home-screen copy reinstalled —
 * and a `push` flag left true after that silences the in-app notification in
 * favour of one nobody is sending. Called when the app opens.
 */
export async function syncPush(who: PushWho): Promise<void> {
  if (!pushConfigured()) {
    if (readAlerts().push) writeAlerts({ ...readAlerts(), push: false });
    return;
  }
  const live = await refreshPush(who, wantsOf(readAlerts()));
  if (readAlerts().push !== live) writeAlerts({ ...readAlerts(), push: live });
}

/**
 * Whether this play's phone notification belongs to the watcher rather than
 * to the app.
 *
 * The watcher pushes every touchdown by one of YOUR STARTERS and nothing
 * else. So those three conditions are exactly the overlap, and only there
 * would the app's own notification land beside a pushed one as a second
 * bubble for the same play. A big play, or an opponent's man, is nobody
 * else's job and still goes out from here.
 */
export const watcherHandles = (p: AlertPrefs, td: boolean, mine: boolean): boolean =>
  p.push && td && mine;

const ASKED = 'fc.alerts.asked';
export const promptDismissed = () => { try { return localStorage.getItem(ASKED) === '1'; } catch { return true; } };
export const dismissPrompt = () => { try { localStorage.setItem(ASKED, '1'); } catch { /* fine */ } };
