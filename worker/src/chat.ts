/**
 * Who gets told about a message in the league chat.
 *
 * Unlike a touchdown, a message is not something the worker goes looking for.
 * It cannot: the chat's rules require a signed-in member to read it, and the
 * worker holds no credentials — deliberately, because the one property worth
 * protecting here is that losing this worker loses nothing but the pushing.
 *
 * So the sender's own app tells it, and the worker verifies by reading the
 * message back with the SENDER'S token. That reduces forgery to exactly the
 * chat's own threat model: anyone able to fake a notification already had to
 * be a member able to post the message for real, in which case the
 * notification is honest.
 *
 * Everything in this file is a pure function of a message and one person's
 * settings, which is the only reason any of it is testable.
 */

/** A message as the database holds it, cut down to what a push needs. */
export interface ChatSaid {
  uid: string;
  name: string;
  text: string;
  /** present on a GIF, which has no words of its own worth reading out */
  gif?: unknown;
  /** present on an automated log entry — a nickname changed, a photo set */
  sys?: unknown;
}

/** What one subscriber asked for. */
export interface ChatPrefs {
  /** messages at all */
  chat?: boolean;
  /** only the ones that name me */
  tagsOnly?: boolean;
  /** this person's Sleeper username, which is what a tag spells */
  user?: string;
  /** this person's account id, for not telling them about their own message */
  uid?: string;
}

/** The same rule the app uses in `api/chat.ts`, kept in step by its tests. */
const TAG = /@([A-Za-z0-9_.]+)/g;

/**
 * Whether this line names this person.
 *
 * The two halves are deliberately not one condition. A tag by name can only
 * match when the name is known, but `@everyone` means everyone whether or not
 * the worker was ever told who this subscriber is — and it is told by the
 * app, which can be an old build or have been opened before the field
 * existed. Folding the two together drops the message that was addressed to
 * the whole league, which is the one most likely to matter.
 */
export function tagsUser(text: string, user: string): boolean {
  const me = (user || '').toLowerCase();
  for (const [, h] of text.matchAll(TAG)) {
    const k = (h as string).toLowerCase().replace(/\.+$/, '');
    if (k === 'everyone') return true;
    if (me && k === me) return true;
  }
  return false;
}

/**
 * Whether this person should be woken for this message.
 *
 * The order of the checks is the order they matter in. Your own message never
 * notifies you — the commonest bug in any chat, and the most irritating. An
 * automated log entry never notifies anybody: "Jorge set a photo for Javonte
 * Williams" is a thing to find when you look, not a thing to be interrupted
 * by.
 */
export function wantsMessage(m: ChatSaid, p: ChatPrefs): boolean {
  if (!p.chat) return false;
  if (p.uid && m.uid === p.uid) return false;
  if (m.sys) return false;
  if (p.tagsOnly) return tagsUser(m.text, p.user || '');
  return true;
}

/** How long a preview may be before the lock screen cuts it anyway. */
const PREVIEW = 140;

export interface Alert { title: string; body: string; tag: string; renotify?: boolean }

/**
 * The message as a lock screen shows it.
 *
 * One bubble per league, not per message. A league chat that gets going
 * produces twenty of these in a minute, and twenty bubbles is a thing people
 * turn off rather than read — so they collapse onto the same tag and
 * `renotify` makes each new one still announce itself. The bubble always
 * holds the latest, which is the one worth reading.
 */
export function chatAlert(m: ChatSaid, leagueId: string, leagueName?: string): Alert {
  const text = m.gif && !m.text.trim() ? 'GIF' : m.text.trim().slice(0, PREVIEW);
  return {
    title: m.name + (leagueName ? ' · ' + leagueName : ''),
    body: text,
    tag: 'chat:' + leagueId,
    renotify: true,
  };
}
