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
