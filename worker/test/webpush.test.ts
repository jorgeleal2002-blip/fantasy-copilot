/**
 * The encryption is checked by undoing it.
 *
 * A push body cannot be eyeballed and the one party able to tell us it is
 * wrong — the handset — reports nothing back. So the test plays the handset:
 * it holds the subscription's private key, pulls the header apart, derives the
 * keys the way RFC 8291 says a user agent does, and decrypts. If the result is
 * the message, every step in between was right.
 *
 * The HKDF here is written out by hand rather than imported from the module
 * under test. Sharing it would hide exactly the mistake worth catching: an
 * HKDF-Expand missing its counter byte agrees with itself perfectly and
 * produces a key no real phone can derive.
 */
import { describe, expect, it } from 'vitest';
import {
  audienceOf, b64urlToBytes, bytesToB64url, encryptPayload, isGone, vapidAuth,
} from '../src/webpush';
import { fakeHandset, hkdfByHand, join, openAsHandset } from './handset';

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('the encrypted push body', () => {
  it('decrypts, on the other side, to the message that went in', async () => {
    const h = await fakeHandset();
    const msg = JSON.stringify({ title: 'Javonte Williams', body: 'Touchdown — 6 pts' });
    const body = await encryptPayload(msg, h.sub);
    const { clear } = await openAsHandset(body, h);
    // The trailing byte is the record delimiter, not part of the message.
    expect(clear[clear.length - 1]).toBe(2);
    expect(new TextDecoder().decode(clear.slice(0, -1))).toBe(msg);
  });

  it('carries the header RFC 8188 describes: salt, record size, then the key', async () => {
    const h = await fakeHandset();
    const body = await encryptPayload('hi', h.sub);
    const { idlen, recordSize } = await openAsHandset(body, h);
    expect(idlen).toBe(65);
    expect(recordSize).toBe(4096);
    expect(body.length).toBe(16 + 4 + 1 + 65 + (2 + 1 + 16));
  });

  it('never repeats a salt, which is what would break the cipher', async () => {
    const h = await fakeHandset();
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      seen.add(bytesToB64url((await encryptPayload('x', h.sub)).slice(0, 16)));
    }
    expect(seen.size).toBe(20);
  });

  it('refuses a payload too long for one record instead of truncating it', async () => {
    const h = await fakeHandset();
    await expect(encryptPayload('x'.repeat(4080), h.sub)).rejects.toThrow(/too long/);
  });

  /* The two public keys are the same length and the same kind of thing, so a
     swap is invisible everywhere except on the handset. */
  it('is not decryptable when the two keys go into the info the other way round', async () => {
    const h = await fakeHandset();
    const body = await encryptPayload('hi', h.sub);
    const salt = body.slice(0, 16);
    const asPublic = body.slice(21, 86);
    const asKey = await crypto.subtle.importKey('raw', asPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, h.priv, 256));
    const wrong = join(utf8('WebPush: info'), new Uint8Array([0]), asPublic, h.pub);
    const ikm = await hkdfByHand(b64urlToBytes(h.sub.keys.auth), shared, wrong, 32);
    const cek = await hkdfByHand(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdfByHand(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['decrypt']);
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, body.slice(86) as BufferSource))
      .rejects.toThrow();
  });
});

describe('the VAPID assertion', () => {
  const keys = async () => {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
    ) as CryptoKeyPair;
    return { kp, pub: new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)) };
  };

  it('verifies against the public key it ships alongside', async () => {
    const { kp, pub } = await keys();
    const header = await vapidAuth('https://push.example.com/send/abc', kp.privateKey, pub, 'mailto:a@b.c');
    const [, t, k] = header.match(/^vapid t=([^,]+), k=(.+)$/) as RegExpMatchArray;
    expect(bytesToB64url(b64urlToBytes(k as string))).toBe(bytesToB64url(pub));

    const [head, claim, sig] = (t as string).split('.');
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      kp.publicKey,
      b64urlToBytes(sig as string) as BufferSource,
      utf8(head + '.' + claim) as BufferSource,
    );
    expect(ok).toBe(true);
    // Raw r‖s, not DER — a DER signature here is the classic silent rejection.
    expect(b64urlToBytes(sig as string).length).toBe(64);
  });

  it('names the push service origin as the audience, not the whole endpoint', async () => {
    const { kp, pub } = await keys();
    const header = await vapidAuth('https://push.example.com/send/abc?x=1', kp.privateKey, pub, 'mailto:a@b.c');
    const claim = JSON.parse(new TextDecoder().decode(
      b64urlToBytes((header.match(/t=([^,]+)/) as RegExpMatchArray)[1]?.split('.')[1] as string),
    ));
    expect(claim.aud).toBe('https://push.example.com');
    expect(claim.sub).toBe('mailto:a@b.c');
  });

  it('expires, and within the day the spec allows', async () => {
    const { kp, pub } = await keys();
    const now = 1_700_000_000_000;
    const header = await vapidAuth('https://p.example.com/x', kp.privateKey, pub, 'mailto:a@b.c', now);
    const claim = JSON.parse(new TextDecoder().decode(
      b64urlToBytes((header.match(/t=([^,]+)/) as RegExpMatchArray)[1]?.split('.')[1] as string),
    ));
    expect(claim.exp).toBeGreaterThan(now / 1000);
    expect(claim.exp - now / 1000).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it('refuses a subject no push service would accept', async () => {
    const { kp, pub } = await keys();
    await expect(vapidAuth('https://p.example.com/x', kp.privateKey, pub, 'jorge'))
      .rejects.toThrow(/mailto:/);
  });

  it('reads the audience off any endpoint shape', () => {
    expect(audienceOf('https://fcm.googleapis.com/fcm/send/abc:def')).toBe('https://fcm.googleapis.com');
    expect(audienceOf('https://web.push.apple.com/Q123')).toBe('https://web.push.apple.com');
  });
});

describe('a subscription that is finished', () => {
  /* Deleting on anything else silently unsubscribes a phone that is fine. */
  it('is only the two statuses that mean gone', () => {
    expect(isGone(404)).toBe(true);
    expect(isGone(410)).toBe(true);
    for (const s of [0, 201, 400, 401, 403, 413, 429, 500, 502, 503]) expect(isGone(s)).toBe(false);
  });
});
