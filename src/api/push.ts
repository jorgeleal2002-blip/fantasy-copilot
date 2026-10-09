/**
 * Turning touchdown notifications on, from the phone's side.
 *
 * The app is a static bundle and cannot watch a game it is not open for, so
 * the watching is done by a small worker elsewhere — see /worker. All this
 * file does is hand that worker a subscription: an address the phone's own
 * push service will deliver to, and the keys to encrypt to.
 *
 * With no worker configured every export here is inert and the setting does
 * not appear, exactly as the shared draft room behaves without a database.
 */

/** Where the watcher lives. Absent in a normal checkout, which is the point. */
export const PUSH_URL: string = (import.meta.env?.VITE_PUSH_URL || '').replace(/\/+$/, '');

export type PushState = 'off' | 'on' | 'denied' | 'unsupported';

/**
 * Whether this browser can do any of it.
 *
 * On iOS the answer is no until the app has been added to the home screen —
 * Safari exposes `PushManager` only to an installed web app — so a phone that
 * reads 'unsupported' here is usually one tap from being supported, which is
 * what the setting has to say rather than "your browser cannot".
 */
export function pushSupported(): boolean {
  return !!PUSH_URL
    && typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/** True where the only thing standing in the way is the home screen. */
export function needsInstall(): boolean {
  if (!PUSH_URL || typeof window === 'undefined') return false;
  /* Read as a property rather than with `in`: the DOM types declare
     `PushManager` on every Window, so `'PushManager' in window` narrows the
     negative branch to `never` and the lines below stop compiling — on a
     platform where that branch is exactly the case being handled. */
  if ((window as Window & { PushManager?: unknown }).PushManager) return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !window.matchMedia('(display-mode: standalone)').matches;
}

/* The application server key goes into `subscribe` as bytes, not as the
   base64url the worker serves it in. */
function keyBytes(b64url: string): Uint8Array {
  const pad = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  return sub ? 'on' : 'off';
}

/** Who to name on a lock screen, for the players this person holds. */
export type PushNames = Record<string, { n: string; p?: string; t?: string }>;

async function tell(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(PUSH_URL + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ask for permission, subscribe, and register with the watcher.
 *
 * Returns what the setting should now read. The permission prompt must be
 * raised from a real tap — a browser ignores one that is not — so this is
 * only ever called from the switch itself.
 */
export async function enablePush(
  leagueId: string, userId: string, names: PushNames,
): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const ok = await Notification.requestPermission();
  if (ok !== 'granted') return ok === 'denied' ? 'denied' : 'off';

  const reg = await registration();
  if (!reg) return 'off';

  let key: string;
  try {
    const res = await fetch(PUSH_URL + '/vapid');
    key = ((await res.json()) as { key?: string }).key || '';
  } catch {
    return 'off';
  }
  if (!key) return 'off';

  let sub: PushSubscription;
  try {
    /* An existing subscription may be against a key this worker no longer
       has — the store was reset, or it was moved. Resubscribing with a
       different key throws, so the old one goes first. */
    const had = await reg.pushManager.getSubscription();
    if (had) await had.unsubscribe().catch(() => undefined);
    sub = await reg.pushManager.subscribe({
      // Required, and genuinely true: every push shows a notification.
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key) as BufferSource,
    });
  } catch {
    return 'off';
  }

  const sent = await tell('/subscribe', { sub: sub.toJSON(), leagueId, userId, names });
  if (!sent) {
    // Leaving a subscription the watcher never heard of would read as "on"
    // for ever while nothing was ever sent to it.
    await sub.unsubscribe().catch(() => undefined);
    return 'off';
  }
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return 'off';
  // The watcher is told first: if it is unreachable, the phone stays
  // subscribed and the switch can be tried again, which is recoverable. The
  // other order leaves the watcher pushing at an address nobody listens to.
  await tell('/unsubscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => undefined);
  return 'off';
}

/**
 * Hand over today's names, if this phone is already subscribed.
 *
 * The worker reads the LINEUP from Sleeper every minute, so a start/sit does
 * not need the app. What it cannot read is who these player ids are — the
 * whole player file is megabytes and this runs sixty times an hour — so the
 * app, which has the file anyway, leaves a small map of its own roster
 * behind. Quiet, idempotent, and skipped entirely when notifications are off.
 *
 * Returns whether this phone still holds a subscription at all, which is the
 * one thing the app cannot know without asking.
 */
export async function refreshPush(
  leagueId: string, userId: string, names: PushNames,
): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return false;
  /* Still subscribed even if the watcher cannot be reached this second — the
     phone's push service is what holds the subscription, not us, and
     reporting it gone over one failed request would turn the setting off
     under somebody on a bad signal. */
  await tell('/subscribe', { sub: sub.toJSON(), leagueId, userId, names });
  return true;
}
