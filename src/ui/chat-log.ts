import { chatEnabled, sendChat, type ChatEvent } from '../api/chat';
import type { Model } from '../model/types';

/** What the event says, as plain text: the chat bar's preview and the
 *  message's text in the database. */
export function eventLine(e: ChatEvent): string {
  switch (e.kind) {
    case 'nick': return e.old
      ? `renamed ${e.player} from "${e.old}" to "${e.nick}"`
      : `nicknamed ${e.player} "${e.nick}"`;
    case 'unnick': return `took ${e.player}'s nickname away${e.old ? ` ("${e.old}")` : ''}`;
    case 'photo': return `changed ${e.player}'s photo`;
    case 'unphoto': return `put ${e.player}'s real photo back`;
  }
}

/**
 * Tell the league's chat that a player was renamed or given a new face, so
 * the change has a who and a when everybody can see. Quietly does nothing
 * where there is no chat.
 */
export function logToChat(m: Model, e: ChatEvent): void {
  if (!chatEnabled()) return;
  const rid = m.leagueRows.find(r => r.isMe)?.id;
  void sendChat(m.league.league_id, {
    name: m.myTeamName || m.me.teamName || m.me.name,
    user: m.me.name,
    avatar: m.me.avatar || undefined,
    ...(rid != null ? { rid } : {}),
    sys: e,
    text: eventLine(e),
  }).catch(() => { /* the change itself went through; the log is a courtesy */ });
}
