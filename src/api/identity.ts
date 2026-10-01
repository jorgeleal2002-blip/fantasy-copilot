/**
 * Signing in with Google, so your setup follows you off this phone.
 *
 * WHAT THIS CANNOT DO, because it is the first thing anybody expects of it:
 * Sleeper has no Google sign-in. There is no exchange anywhere that turns a
 * Google account into a Sleeper one, so nothing here can work out which Sleeper
 * team is yours. The app still asks for your Sleeper username once, and it
 * always will until Sleeper itself offers something else.
 *
 * What it does instead is remember the answer. Signing in with Google gives
 * this app one stable identifier for you and a place to keep two strings
 * against it — your Sleeper username and the league you had open — so a new
 * phone, a reinstall or a second browser arrives already set up instead of
 * asking you to remember a username you chose in 2019.
 *
 * No SDK, for the same reason the draft room has none: Google's own sign-in
 * script is one file the browser already knows how to cache, Firebase's auth
 * API is two POSTs, and the official client for either is larger than this
 * whole application.
 *
 * With nothing configured every export below is inert and the username box is
 * the only way in — the feature is off, not broken.
 */

/** Google's OAuth web client, from the Firebase console's Google provider. */
const CLIENT_ID: string = import.meta.env?.VITE_GOOGLE_CLIENT_ID || '';
/** The Firebase project's web API key — public by design; it identifies the
 *  project and authorises nothing on its own. */
const FIREBASE_KEY: string = import.meta.env?.VITE_FIREBASE_KEY || '';

export const googleEnabled = () => !!CLIENT_ID && !!FIREBASE_KEY;

const IDP = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp';
const TOKEN = 'https://securetoken.googleapis.com/v1/token';
const GIS = 'https://accounts.google.com/gsi/client';

export interface Session {
  /** Firebase's own id for this person. Not their email, and not Google's. */
  uid: string;
  /** Short-lived, and what the database checks. */
  idToken: string;
  /** Long-lived, and the only thing worth keeping between launches. */
  refreshToken: string;
  /** When `idToken` stops being accepted, in epoch milliseconds. */
  expiresAt: number;
}

/**
 * One session out of either shape Google answers with.
 *
 * The two endpoints that produce one do not agree on their own field names —
 * the sign-in returns `idToken` and the refresh returns `id_token` — so this
 * reads both rather than two near-identical functions drifting apart.
 */
export function sessionFrom(raw: unknown, now: number): Session | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (...keys: string[]) => {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === 'string' && v) return v;
    }
    return '';
  };
  const uid = str('localId', 'user_id');
  const idToken = str('idToken', 'id_token');
  const refreshToken = str('refreshToken', 'refresh_token');
  if (!uid || !idToken || !refreshToken) return null;
  // Both endpoints send the lifetime as a string of seconds. A missing or
  // unreadable one is treated as already expired rather than as forever: the
  // cost of refreshing early is one request, and the cost of refreshing late
  // is a database call that fails for no reason the screen can explain.
  const secs = Number(str('expiresIn', 'expires_in'));
  return {
    uid,
    idToken,
    refreshToken,
    expiresAt: now + (Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0) * 1,
  };
}

/**
 * Is this token too old to send?
 *
 * With a minute of slack, because the token is checked by a server whose clock
 * is not this phone's, and a token that expires in transit fails in the one
 * place the app cannot retry cleanly.
 */
export const SKEW_MS = 60_000;
export const stale = (s: Session | null, now: number) =>
  !s || s.expiresAt - SKEW_MS <= now;

/* ── talking to Google ────────────────────────────────────────────────────── */

let gisLoading: Promise<void> | null = null;

/** Google's sign-in script, fetched once and only when somebody asks to use it.
 *  Nothing is loaded for the people who never tap the button. */
export function loadGoogle(): Promise<void> {
  if (!googleEnabled()) return Promise.reject(new Error('off'));
  const w = window as unknown as { google?: { accounts?: unknown } };
  if (w.google?.accounts) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise<void>((ok, fail) => {
    const el = document.createElement('script');
    el.src = GIS;
    el.async = true;
    el.onload = () => ok();
    el.onerror = () => { gisLoading = null; fail(new Error('script')); };
    document.head.appendChild(el);
  });
  return gisLoading;
}

interface GisId {
  initialize(o: { client_id: string; callback: (r: { credential?: string }) => void;
    auto_select?: boolean; cancel_on_tap_outside?: boolean; ux_mode?: string }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
  prompt(): void;
  disableAutoSelect(): void;
}
const gis = (): GisId | null =>
  (window as unknown as { google?: { accounts?: { id?: GisId } } }).google?.accounts?.id ?? null;

/**
 * Draw Google's own button into `host` and hand back whatever it signs in.
 *
 * Their button and not one of ours: the branding rules are theirs, it carries
 * the account chooser, and a button that looks hand-made is the one nobody
 * trusts with a password.
 */
export function mountGoogleButton(
  host: HTMLElement,
  onToken: (googleIdToken: string) => void,
  onError: (e: Error) => void,
): void {
  loadGoogle().then(() => {
    const id = gis();
    if (!id) throw new Error('script');
    id.initialize({
      client_id: CLIENT_ID,
      callback: r => { if (r.credential) onToken(r.credential); },
      cancel_on_tap_outside: true,
    });
    host.replaceChildren();
    id.renderButton(host, {
      type: 'standard', theme: 'filled_black', size: 'large',
      text: 'continue_with', shape: 'pill', logo_alignment: 'left',
      width: Math.min(Math.round(host.getBoundingClientRect().width) || 320, 400),
    });
  }).catch(e => onError(e as Error));
}

/** Stop Google signing the same person straight back in after they sign out. */
export function forgetGoogle(): void {
  try { gis()?.disableAutoSelect(); } catch { /* the script may never have loaded */ }
}

/* ── talking to Firebase ──────────────────────────────────────────────────── */

async function post(url: string, body: Record<string, string>): Promise<unknown> {
  const res = await fetch(url + '?key=' + encodeURIComponent(FIREBASE_KEY), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('auth ' + res.status);
  return res.json();
}

/** A Google token for a Firebase one. Google has already said who this is;
 *  this is the step that gets a credential the database will accept. */
export async function exchange(googleIdToken: string, now = Date.now()): Promise<Session> {
  const raw = await post(IDP, {
    postBody: 'id_token=' + encodeURIComponent(googleIdToken) + '&providerId=google.com',
    requestUri: window.location.origin,
    returnSecureToken: 'true',
  });
  const s = sessionFrom(raw, now);
  if (!s) throw new Error('auth shape');
  return s;
}

/** A fresh token from the long-lived one, which is all that is kept on disk. */
export async function refresh(refreshToken: string, now = Date.now()): Promise<Session> {
  const raw = await post(TOKEN, { grant_type: 'refresh_token', refresh_token: refreshToken });
  const s = sessionFrom(raw, now);
  if (!s) throw new Error('auth shape');
  return s;
}
