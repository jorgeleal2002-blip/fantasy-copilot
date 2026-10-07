import { describe, expect, it } from 'vitest';
import { tagsMe } from '../api/chat';

describe('tagsMe', () => {
  it('finds a tag of your Sleeper name, in any case, ending a sentence', () => {
    expect(tagsMe('oye @Lil2002 te doy a Nabers', 'lil2002')).toBe(true);
    expect(tagsMe('trade? @lil2002.', 'lil2002')).toBe(true);
  });
  it('counts @everyone', () => {
    expect(tagsMe('@everyone draft hoy', 'lil2002')).toBe(true);
  });
  it('does not match a longer name or a plain mention without @', () => {
    expect(tagsMe('@lil20022 hola', 'lil2002')).toBe(false);
    expect(tagsMe('lil2002 hola', 'lil2002')).toBe(false);
  });
});
