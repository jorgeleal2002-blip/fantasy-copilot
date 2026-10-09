import { describe, expect, it } from 'vitest';
import { chatAlert, tagsUser, wantsMessage, type ChatPrefs, type ChatSaid } from '../src/chat';

const said = (over: Partial<ChatSaid> = {}): ChatSaid =>
  ({ uid: 'u-jorge', name: 'Doctors', text: 'hola', ...over });
const prefs = (over: Partial<ChatPrefs> = {}): ChatPrefs =>
  ({ chat: true, uid: 'u-me', user: 'jorge2002', ...over });

describe('who gets woken for a message', () => {
  it('tells a member of the league', () => {
    expect(wantsMessage(said(), prefs())).toBe(true);
  });

  /* The commonest bug in any chat, and the most irritating one. */
  it('never tells the person who wrote it', () => {
    expect(wantsMessage(said({ uid: 'u-me' }), prefs({ uid: 'u-me' }))).toBe(false);
  });

  it('says nothing to somebody who asked for no messages', () => {
    expect(wantsMessage(said(), prefs({ chat: false }))).toBe(false);
    expect(wantsMessage(said(), prefs({ chat: undefined }))).toBe(false);
  });

  /* "Jorge set a photo for Javonte Williams" is a thing to find when you
     look, not a thing to be interrupted by. */
  it('says nothing about an automated log entry, even to everyone', () => {
    const log = said({ sys: { kind: 'nick', id: '1', player: 'X' }, text: 'nicknamed X' });
    expect(wantsMessage(log, prefs())).toBe(false);
    expect(wantsMessage(log, prefs({ tagsOnly: false }))).toBe(false);
  });

  describe('when they only want to be tagged', () => {
    const only = (over: Partial<ChatPrefs> = {}) => prefs({ tagsOnly: true, ...over });

    it('tells them when their name is in it', () => {
      expect(wantsMessage(said({ text: 'oye @jorge2002 cambia tu QB' }), only())).toBe(true);
    });
    it('tells them when the message is for everyone', () => {
      expect(wantsMessage(said({ text: '@everyone trade deadline tonight' }), only())).toBe(true);
    });
    it('leaves them alone otherwise', () => {
      expect(wantsMessage(said({ text: 'nice win' }), only())).toBe(false);
      expect(wantsMessage(said({ text: '@someone else entirely' }), only())).toBe(false);
    });
    it('is not fooled by a tag that merely starts the same', () => {
      expect(wantsMessage(said({ text: '@jorge2002x hola' }), only())).toBe(false);
    });
    /* The worker is told the username by the app, so an old build or a
       subscription made before the field existed leaves it blank. A tag by
       name cannot match then — but `@everyone` still has to, because it was
       addressed to the whole league and is the one most likely to matter. */
    it('cannot match a name it was never told', () => {
      expect(wantsMessage(said({ text: '@jorge2002 hola' }), only({ user: '' }))).toBe(false);
      expect(wantsMessage(said({ text: '@jorge2002 hola' }), only({ user: undefined }))).toBe(false);
    });
    it('still passes on @everyone with no name to match', () => {
      expect(wantsMessage(said({ text: '@everyone junta hoy' }), only({ user: '' }))).toBe(true);
      expect(wantsMessage(said({ text: '@everyone junta hoy' }), only({ user: undefined }))).toBe(true);
    });
  });
});

describe('reading a tag', () => {
  it('ignores case and a full stop that ended the sentence', () => {
    expect(tagsUser('gracias @Jorge2002.', 'jorge2002')).toBe(true);
  });
  it('finds one anywhere in the line, not only at the start', () => {
    expect(tagsUser('a b c @jorge2002 d', 'jorge2002')).toBe(true);
  });
  it('is false for a line with no tags at all', () => {
    expect(tagsUser('buen juego', 'jorge2002')).toBe(false);
  });
  /* `@...` matches the tag pattern and then loses its every character to the
     trailing-full-stop trim. Without the guard on a known name, that empty
     string equals the empty username and the whole league gets pushed a
     message addressed to nobody. */
  it('is false for a tag that trims away to nothing, name or no name', () => {
    expect(tagsUser('@... hola', '')).toBe(false);
    expect(tagsUser('@... hola', 'jorge2002')).toBe(false);
  });
});

describe('the message on the lock screen', () => {
  it('leads with who wrote it and carries the league', () => {
    const a = chatAlert(said({ name: 'Doctors', text: 'cambio a Javonte?' }), '777', 'Liga de Doctors');
    expect(a.title).toBe('Doctors · Liga de Doctors');
    expect(a.body).toBe('cambio a Javonte?');
  });

  /* Twenty bubbles is a thing people turn off rather than read. One per
     league, holding the latest — but each new one still has to announce
     itself, which is what renotify is for. */
  it('collapses a league onto one bubble that still buzzes', () => {
    const a = chatAlert(said({ text: 'uno' }), '777');
    const b = chatAlert(said({ text: 'dos' }), '777');
    expect(a.tag).toBe(b.tag);
    expect(b.renotify).toBe(true);
    // A different league is a different conversation.
    expect(chatAlert(said(), '888').tag).not.toBe(a.tag);
  });

  it('says GIF rather than nothing for a message that is only a picture', () => {
    expect(chatAlert(said({ text: ' ', gif: { url: 'x' } }), '777').body).toBe('GIF');
  });

  it('cuts a long message instead of sending the whole essay', () => {
    const a = chatAlert(said({ text: 'x'.repeat(500) }), '777');
    expect(a.body.length).toBe(140);
  });
});
