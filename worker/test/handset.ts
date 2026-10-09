/**
 * A pretend phone: a subscription with the private half kept, so a test can
 * open what the worker sealed.
 *
 * The HKDF below is written out by hand rather than imported from the module
 * under test. Sharing it would hide exactly the mistake worth catching — an
 * HKDF-Expand missing its counter byte agrees with itself perfectly and
 * produces a key no real handset can derive.
 */
import { b64urlToBytes, bytesToB64url, type PushSub } from '../src/webpush';

const utf8 = (s: string) => new TextEncoder().encode(s);

export const join = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
}

export async function hkdfByHand(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const prk = await hmac(salt, ikm);
  const t1 = await hmac(prk, join(info, new Uint8Array([1])));
  return t1.slice(0, len);
}

export interface Handset { sub: PushSub; priv: CryptoKey; pub: Uint8Array }

export async function fakeHandset(endpoint = 'https://push.example.com/send/abc123'): Promise<Handset> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  ) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    priv: kp.privateKey,
    pub,
    sub: { endpoint, keys: { p256dh: bytesToB64url(pub), auth: bytesToB64url(auth) } },
  };
}

/** Everything a user agent does on receipt, in order. */
export async function openAsHandset(body: Uint8Array, h: Handset) {
  const salt = body.slice(0, 16);
  const idlen = body[20] as number;
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);

  const asKey = await crypto.subtle.importKey(
    'raw', asPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, h.priv, 256));

  const keyInfo = join(utf8('WebPush: info'), new Uint8Array([0]), h.pub, asPublic);
  const ikm = await hkdfByHand(b64urlToBytes(h.sub.keys.auth), shared, keyInfo, 32);
  const cek = await hkdfByHand(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfByHand(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['decrypt']);
  const clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, sealed as BufferSource));
  return {
    idlen,
    recordSize: new DataView(body.buffer, body.byteOffset).getUint32(16),
    clear,
    text: new TextDecoder().decode(clear.slice(0, -1)),
  };
}

/** The key-value store, in a Map. */
export function fakeKv() {
  const map = new Map<string, string>();
  return {
    map,
    async get(key: string) { return map.get(key) ?? null; },
    async put(key: string, value: string) { map.set(key, value); },
    async delete(key: string) { map.delete(key); },
    async list({ prefix = '' }: { prefix?: string; cursor?: string } = {}) {
      return {
        keys: [...map.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })),
        list_complete: true as const,
      };
    },
  };
}
