/**
 * Web Push, by hand.
 *
 * A push message is not a POST with a body. The push service — Apple's, or
 * Google's, or Mozilla's — relays bytes it is forbidden to read, so the body
 * has to arrive already encrypted to a key only the phone holds, and the
 * request has to prove who sent it without any account or token. That is two
 * specifications: RFC 8291 for the encryption and RFC 8292 for the proof.
 *
 * Every library that does this is a dependency with a build step, and all of
 * it is Web Crypto, which the runtime already has. So it is here, about two
 * hundred lines, and the test decrypts what it produces with the subscription's
 * own private key rather than trusting that it looks right.
 */

/** A subscription exactly as `PushSubscription.toJSON()` hands it over. */
export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/* ── base64url, which is the only encoding anything here speaks ─────────── */

export function b64urlToBytes(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(b: Uint8Array | ArrayBuffer): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i] as number);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const utf8 = (s: string) => new TextEncoder().encode(s);

const join = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/* ── RFC 8291: encrypting the payload ───────────────────────────────────── */

/**
 * One HKDF step. `deriveBits` is used rather than two HMACs by hand because
 * the hand-rolled version is where this goes wrong: HKDF-Expand appends a
 * counter byte that is easy to forget, and forgetting it produces a key that
 * is perfectly well-formed and simply does not decrypt.
 */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/**
 * How big a record the phone must be prepared to reassemble. Everything sent
 * from here is one short record well under this, and the field exists in the
 * header whether or not it is interesting.
 */
const RECORD_SIZE = 4096;

/** Room for the 16-byte GCM tag and the one-byte padding delimiter. */
const OVERHEAD = 17;

/**
 * The encrypted body of a push, ready to be the request's bytes.
 *
 * `salt` and `asKeys` are parameters only so a test can pin them; in use they
 * are fresh every message, which is not optional — a repeated salt with the
 * same key is what breaks AES-GCM.
 */
export async function encryptPayload(
  plaintext: string,
  sub: PushSub,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
  asKeys?: CryptoKeyPair,
): Promise<Uint8Array> {
  const body = utf8(plaintext);
  if (body.length + OVERHEAD > RECORD_SIZE) {
    throw new Error('push payload too long: ' + body.length);
  }

  const uaPublic = b64urlToBytes(sub.keys.p256dh);
  const authSecret = b64urlToBytes(sub.keys.auth);

  const as = asKeys ?? await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  ) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));

  const uaKey = await crypto.subtle.importKey(
    'raw', uaPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaKey }, as.privateKey, 256,
  ));

  /* The phone's key comes first and the server's second. They are the same
     length and the same kind of thing, so swapping them yields a key that is
     structurally perfect and decrypts to noise — on the handset, where nothing
     here can see it. */
  const keyInfo = join(utf8('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  // 0x02 marks the last record. A 0x01 here says "more follows" and the phone
  // waits for a record that never comes.
  const record = join(body, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, record as BufferSource,
  ));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE);
  return join(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed);
}

/* ── RFC 8292: proving who sent it ──────────────────────────────────────── */

/** How long a signed assertion is good for. The spec's ceiling is 24 hours. */
const VAPID_TTL_S = 12 * 60 * 60;

/** The origin a push service expects to be named as the audience. */
export const audienceOf = (endpoint: string): string => new URL(endpoint).origin;

/**
 * The `Authorization` header for one push.
 *
 * `subject` is a mailto: or https: the push service can use to complain to a
 * human. It is required, it is never checked, and leaving it empty gets the
 * request rejected by some services and not others — which is the worst of
 * both, so it is required here too.
 */
export async function vapidAuth(
  endpoint: string,
  priv: CryptoKey,
  publicRaw: Uint8Array,
  subject: string,
  now: number = Date.now(),
): Promise<string> {
  if (!/^(mailto:|https:)/.test(subject)) throw new Error('VAPID subject must be mailto: or https:');
  const head = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claim = bytesToB64url(utf8(JSON.stringify({
    aud: audienceOf(endpoint),
    exp: Math.floor(now / 1000) + VAPID_TTL_S,
    sub: subject,
  })));
  const signed = head + '.' + claim;
  /* Web Crypto returns the raw r‖s pair a JWS wants. Node's older sign() and
     most OpenSSL paths return DER instead, which is why a VAPID header built
     off an example from the wrong runtime fails with no useful error. */
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, priv, utf8(signed) as BufferSource,
  ));
  return 'vapid t=' + signed + '.' + bytesToB64url(sig) + ', k=' + bytesToB64url(publicRaw);
}

/* ── Sending ────────────────────────────────────────────────────────────── */

export interface VapidKeys {
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
  subject: string;
}

export type PushResult =
  | { ok: true; status: number }
  /** the subscription is dead and should be forgotten — see `isGone` */
  | { ok: false; status: number; gone: boolean; detail: string };

/**
 * A push service says a subscription is finished with 404 or 410, and nothing
 * else. Every other failure is this minute's problem — a timeout, a 429, a bad
 * gateway — and deleting a subscription over one would silently unsubscribe
 * somebody whose phone is fine.
 */
export const isGone = (status: number): boolean => status === 404 || status === 410;

export async function sendPush(
  sub: PushSub,
  payload: string,
  vapid: VapidKeys,
  ttlSeconds = 600,
): Promise<PushResult> {
  const body = await encryptPayload(payload, sub);
  const auth = await vapidAuth(sub.endpoint, vapid.privateKey, vapid.publicRaw, vapid.subject);
  let res: Response;
  try {
    res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttlSeconds),
        // Without this iOS holds the message until the phone feels like it,
        // which for a touchdown is the same as not sending it.
        Urgency: 'high',
      },
      body: body as BufferSource,
    });
  } catch (e) {
    return { ok: false, status: 0, gone: false, detail: String((e as Error)?.message || e) };
  }
  if (res.ok) return { ok: true, status: res.status };
  const detail = await res.text().catch(() => '');
  return { ok: false, status: res.status, gone: isGone(res.status), detail: detail.slice(0, 200) };
}
