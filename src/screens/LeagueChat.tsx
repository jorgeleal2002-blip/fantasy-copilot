import { useEffect, useRef, useState } from 'react';
import { currentUid } from '../api/access';
import { CHAT_MAX, chatEnabled, deleteChat, sendChat, type ChatMessage } from '../api/chat';
import { isOwnerHere } from '../model/access';
import type { Model } from '../model/types';

/**
 * The league's live chat. Your messages on the right in the accent, everyone
 * else's on the left under their team name and picture; a day's first
 * message carries the date. The newest stays in view as messages arrive,
 * unless you have scrolled up to read.
 */
export function LeagueChat({ m, msgs, err: feedErr }: { m: Model; msgs: ChatMessage[] | null; err: string }) {
  const lid = m.league.league_id;
  const [sendErr, setErr] = useState('');
  const err = sendErr || feedErr;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const me = currentUid();
  const owner = isOwnerHere();

  // Follow the newest message, unless you scrolled up to read older ones.
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const ok = await sendChat(lid, {
        name: m.myTeamName || m.me.teamName || m.me.name,
        user: m.me.name,
        avatar: m.me.avatar || undefined,
        text: t,
      });
      if (ok) { setText(''); setErr(''); stick.current = true; } else setErr('Your message was not sent. Try again.');
    } catch {
      setErr('Your message was not sent. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  if (!chatEnabled()) {
    return <div className="ch-empty">The chat needs the app's database set up (see You → Invite codes).</div>;
  }

  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="ch">
      <div
        className="ch-list"
        ref={list}
        onScroll={e => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {msgs == null ? <div className="ch-empty">Loading…</div>
          : !msgs.length ? <div className="ch-empty">No messages yet. Say something to the league 👋</div>
            : msgs.map((x, i) => {
              const mine = x.uid === me;
              const prev = msgs[i - 1];
              const newDay = !prev || day(prev.at) !== day(x.at);
              // Consecutive messages from one person within five minutes
              // are one block: one name, one picture.
              const grouped = !!prev && !newDay && prev.uid === x.uid && x.at - prev.at < 5 * 60 * 1000;
              return (
                <div key={x.id}>
                  {newDay ? <div className="ch-day">{day(x.at)}</div> : null}
                  <div className={'ch-row' + (mine ? ' is-me' : '') + (grouped ? ' is-grouped' : '')}>
                    {!mine ? (
                      grouped ? <span className="ch-av is-blank" /> : x.avatar
                        ? <img className="ch-av" src={x.avatar} alt="" />
                        : <span className="ch-av">{x.name.slice(0, 1).toUpperCase()}</span>
                    ) : null}
                    <div className="ch-bubble-wrap">
                      {!mine && !grouped ? (
                        <div className="ch-name">{x.name}{x.user ? <span> @{x.user}</span> : null}</div>
                      ) : null}
                      <div className="ch-bubble" title={time(x.at)}>
                        {x.text}
                        <span className="ch-time">{time(x.at)}</span>
                        {owner && !mine ? (
                          <button type="button" className="ch-del" aria-label="Delete message" onClick={() => {
                            if (confirm('Delete this message for everyone?')) void deleteChat(lid, x.id);
                          }}>
                            🗑
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
      </div>

      {err ? <div className="ch-err" role="alert">{err}</div> : null}

      <div className="ch-input">
        <textarea
          value={text}
          rows={1}
          maxLength={CHAT_MAX}
          placeholder="Message the league"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            // Enter sends; Shift+Enter is a new line, as in every chat.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
        />
        <button type="button" className="ch-send" disabled={busy || !text.trim()} onClick={() => void send()}
          aria-label="Send">
          ➤
        </button>
      </div>
    </div>
  );
}
