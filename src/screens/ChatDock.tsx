import { useEffect, useState } from 'react';
import { currentUid } from '../api/access';
import { chatEnabled, watchChat, type ChatMessage } from '../api/chat';
import type { Model } from '../model/types';
import { LeagueChat } from './LeagueChat';

const SEEN = 'fc.chat.seen:';

/**
 * The league chat the way Sleeper keeps it: a bar always docked above the
 * tabs, showing the latest message and how many you have not read, that
 * opens the conversation over whatever screen you are on. One feed for both,
 * so the bar is never behind the open chat.
 */
export function ChatDock({ m }: { m: Model }) {
  const lid = m.league.league_id;
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => {
    try { return Number(localStorage.getItem(SEEN + lid)) || 0; } catch { return 0; }
  });

  useEffect(() => {
    if (!chatEnabled()) return;
    setMsgs(null);
    return watchChat(lid, ms => { setMsgs(ms); setErr(''); }, why => {
      setErr(/40[13]/.test(why)
        ? 'The chat is not open yet: the owner has to publish the latest database rules.'
        : 'Could not reach the chat. Retrying…');
    });
  }, [lid]);

  // Reading the chat marks everything in it read.
  const last = msgs?.length ? msgs[msgs.length - 1] : null;
  useEffect(() => {
    if (!open || !last) return;
    setSeen(last.at);
    try { localStorage.setItem(SEEN + lid, String(last.at)); } catch { /* fine */ }
  }, [open, last, lid]);

  // Close on Escape, as any sheet does.
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  if (!chatEnabled()) return null;
  const me = currentUid();
  const unread = (msgs || []).filter(x => x.at > seen && x.uid !== me).length;
  const preview = last ? (last.uid === me ? 'You' : last.name) + ': ' + last.text : 'Say something to the league';

  return (
    <>
      <button type="button" className="chd-bar" onClick={() => setOpen(true)} aria-label="Open league chat">
        <span className="chd-grip" aria-hidden="true" />
        <span className="chd-row">
          <span className="chd-title"><span aria-hidden="true">💬</span> Chat</span>
          {unread ? <span className="chd-badge">{unread > 99 ? '99+' : unread}</span> : null}
        </span>
        <span className="chd-preview">{preview}</span>
      </button>

      {open ? (
        <div className="chd-layer">
          <div className="chd-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="chd-sheet" role="dialog" aria-label="League chat">
            <div className="chd-head">
              <button type="button" className="chd-grab" aria-label="Close chat" onClick={() => setOpen(false)}>
                <span className="chd-grip" aria-hidden="true" />
              </button>
              <div className="chd-head-row">
                <span className="chd-title"><span aria-hidden="true">💬</span> {m.league.name}</span>
                <button type="button" className="chd-x" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
              </div>
            </div>
            <LeagueChat m={m} msgs={msgs} err={err} />
          </div>
        </div>
      ) : null}
    </>
  );
}
