/**
 * The identity the push services know this sender by.
 *
 * A VAPID keypair is a long-lived secret, and the usual way to get one is to
 * run a key generator and paste the halves into a dashboard. That route has
 * the private half passing through a terminal, a clipboard and whatever chat
 * window the instructions arrived in, which for a key that authorises waking
 * somebody's phone is more handling than it needs.
 *
 * So the worker makes its own on first use and keeps it. Nobody ever sees it,
 * there is nothing to paste, and the public half is served to the app from
 * `/vapid`.
 *
 * The cost is that losing the store loses the identity: the phones hold
 * subscriptions tied to the old public key and those stop being deliverable.
 * `/vapid` is read on every subscribe, so a phone that reopens the app
 * re-subscribes against the new key and recovers by itself.
 */
import { bytesToB64url, b64urlToBytes, type VapidKeys } from './webpush';
import type { KV } from './store';

const KEY = 'vapid:v1';

interface Stored { jwk: JsonWebKey; pub: string }

async function fromStored(s: Stored, subject: string): Promise<VapidKeys> {
  const privateKey = await crypto.subtle.importKey(
    'jwk', s.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  return { privateKey, publicRaw: b64urlToBytes(s.pub), subject };
}

async function mint(): Promise<Stored> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  return {
    jwk: await crypto.subtle.exportKey('jwk', kp.privateKey),
    pub: bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))),
  };
}

/**
 * The keypair, minted on the first call and read on every one after.
 *
 * Two requests arriving together can both find nothing and both mint — the
 * store has no compare-and-swap. The loser's key is overwritten, and because
 * the public half is handed out in the same breath, a phone could subscribe
 * against a key that is already gone. It re-subscribes on next launch and
 * fixes itself, which is a better trade than a lock.
 */
export async function vapidKeys(kv: KV, subject: string): Promise<VapidKeys> {
  const raw = await kv.get(KEY);
  if (raw) {
    try {
      return await fromStored(JSON.parse(raw) as Stored, subject);
    } catch {
      /* unreadable — mint a new one over it rather than stay broken forever */
    }
  }
  const fresh = await mint();
  await kv.put(KEY, JSON.stringify(fresh));
  return fromStored(fresh, subject);
}

/** Just the half the app needs, without importing the private one. */
export async function vapidPublic(kv: KV): Promise<string> {
  const raw = await kv.get(KEY);
  if (raw) {
    try {
      return (JSON.parse(raw) as Stored).pub;
    } catch {
      /* fall through and mint */
    }
  }
  const fresh = await mint();
  await kv.put(KEY, JSON.stringify(fresh));
  return fresh.pub;
}
