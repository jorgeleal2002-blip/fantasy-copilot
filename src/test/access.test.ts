import { describe, expect, it } from 'vitest';
import { ACCESS_HASHES, checkCode, hashCode, normalizeCode } from '../model/access';

describe('the access code', () => {
  it('ignores case, spaces and dashes', async () => {
    expect(normalizeCode(' ab-c d ')).toBe('ABCD');
    expect(await hashCode('abcd')).toBe(await hashCode('A-B C D'));
  });

  it('opens with a code whose hash is listed, and only then', async () => {
    const h = await hashCode('OPEN1');
    expect(await checkCode('open1', [h])).toBe(h);
    expect(await checkCode('OPEN2', [h])).toBeNull();
    expect(await checkCode('   ', [h])).toBeNull();
  });

  it('ships hashes, never a code', () => {
    expect(ACCESS_HASHES.length).toBeGreaterThan(0);
    for (const h of ACCESS_HASHES) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('invite codes', () => {
  it('makes codes that survive being read out loud', async () => {
    const { makeCode } = await import('../model/access');
    for (let i = 0; i < 200; i++) {
      const c = makeCode();
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
  });

  it('writes a code in two halves and puts it in a link', async () => {
    const { inviteLink, prettyCode, normalizeCode: n } = await import('../model/access');
    expect(prettyCode('ABCDEFGH')).toBe('ABCD-EFGH');
    const link = inviteLink('ABCDEFGH', 'https://x.github.io/app/?code=OLD#tab');
    expect(link).toBe('https://x.github.io/app/?code=ABCD-EFGH');
    expect(n('abcd-efgh')).toBe('ABCDEFGH');
  });

  it('only lets a phone in on the shared code while invites are off', async () => {
    const { isUnlocked, rememberUnlock, forgetUnlock } = await import('../model/access');
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    } as Storage;
    rememberUnlock(ACCESS_HASHES[0]);
    expect(isUnlocked(false)).toBe(true);
    // Invites on: the shared code no longer counts, a database standing does.
    expect(isUnlocked(true)).toBe(false);
    rememberUnlock('member');
    expect(isUnlocked(true)).toBe(true);
    forgetUnlock();
    expect(isUnlocked(true)).toBe(false);
  });
});
