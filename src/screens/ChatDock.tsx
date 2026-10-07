import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { currentUid } from '../api/access';
import { chatEnabled, tagsMe, watchChat, type ChatMessage } from '../api/chat';
import { leagueAvatar } from '../api/sleeper';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { LeagueChat } from './LeagueChat';

const SEEN = 'fc.chat.seen:';
/** How far up (as a share of the sheet) a drag has to come to open it. */
const OPEN_AT = 0.22;
const isWide = () => typeof matchMedia !== 'undefined' && matchMedia('(min-width: 900px)').matches;

/**
 * The league chat the way Sleeper keeps it: a bar always docked above the
 * tabs with the latest message and the unread count. Slide it up and the
 * conversation follows your finger; let go past a quarter and it opens, short
 * of that it drops back. Slide the open sheet down by its top to close it. A
 * tap opens it too. On a laptop it is a floating bar and a side panel.
 */
export function ChatDock({ app, m }: { app: App; m: Model }) {
  const lid = m.league.league_id;
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpenState] = useState(false);
  /** The sheet's distance below fully open, in px; null when it is not shown. */
  const [pos, setPos] = useState<number | null>(null);
  /** A finger is holding it: follow, do not animate. */
  const [dragging, setDragging] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ y0: number; from: 'bar' | 'sheet'; moved: boolean; t0: number } | null>(null);
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

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  if (!chatEnabled()) return null;
  const me = currentUid();
  const fresh = (msgs || []).filter(x => x.at > seen && x.uid !== me);
  const unread = fresh.length;
  // Tagged in one of them: said apart, because that one is for you.
  const tagged = fresh.some(x => tagsMe(x.text, m.me.name));
  const who = last ? (last.uid === me ? 'You' : last.name) : '';

  // The sheet's full travel: its own height, or most of the window before it
  // has been drawn.
  const travel = () => sheet.current?.offsetHeight || window.innerHeight * 0.9;

  /* Opening and closing slide, from a tap as much as from a drag: the sheet
     is placed at the bottom, then let go to travel. */
  const setOpen = (on: boolean) => {
    // A laptop's side panel just appears and goes.
    if (isWide()) { setOpenState(on); setPos(null); return; }
    if (on) {
      setOpenState(true);
      setPos(p => (p == null ? travel() : p));
      requestAnimationFrame(() => requestAnimationFrame(() => setPos(0)));
    } else {
      setPos(travel());
      window.setTimeout(() => { setOpenState(false); setPos(null); }, 280);
    }
  };

  const down = (from: 'bar' | 'sheet') => (e: RPointerEvent<HTMLElement>) => {
    if (isWide()) return;
    gesture.current = { y0: e.clientY, from, moved: false, t0: Date.now() };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dy = e.clientY - g.y0;
    if (!g.moved && Math.abs(dy) < 6) return;
    if (!g.moved) { g.moved = true; setDragging(true); if (g.from === 'bar') setOpenState(true); }
    const H = travel();
    // From the bar the sheet rises from below; from the sheet it falls from open.
    setPos(g.from === 'bar' ? Math.max(0, Math.min(H, H + dy)) : Math.max(0, dy));
  };
  const up = (e: RPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (!g.moved) {
      // A tap: the bar opens, the sheet's grip closes.
      setOpen(g.from === 'bar');
      return;
    }
    setDragging(false);
    const H = travel();
    const dy = e.clientY - g.y0;
    const fast = Math.abs(dy) / Math.max(1, Date.now() - g.t0) > 0.6;
    const shown = g.from === 'bar' ? -dy : H - dy;
    setOpen(fast ? dy < 0 : shown > H * (g.from === 'bar' ? OPEN_AT : 1 - OPEN_AT));
  };

  const logo = leagueAvatar(m.league.avatar);
  const showing = open || pos != null;
  const offset = pos ?? 0;
  const fade = Math.max(0, 1 - offset / travel());

  return (
    <>
      <div
        className="chd-bar"
        role="button"
        tabIndex={0}
        aria-label="Open league chat"
        onPointerDown={down('bar')}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => { gesture.current = null; setDragging(false); setOpen(false); }}
        onClick={() => { if (isWide()) setOpen(true); }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setOpen(true); }}
      >
        <span className="chd-grip" aria-hidden="true" />
        <span className="chd-bar-row">
          {/* Who spoke last, or the league itself before anybody has. */}
          {last?.avatar ? <img className="chd-bar-av" src={last.avatar} alt="" />
            : logo ? <img className="chd-bar-av is-league" src={logo} alt="" />
              : <span className="chd-bar-av is-icon" aria-hidden="true">💬</span>}
          <span className="chd-bar-text">
            <span className="chd-row">
              <span className="chd-title">Chat</span>
              <span className="chd-live" aria-hidden="true" />
              {tagged ? <span className="chd-badge is-tag" title="You were tagged">@</span> : null}
              {unread ? <span className="chd-badge">{unread > 99 ? '99+' : unread}</span> : null}
            </span>
            <span className="chd-preview">
              {last ? <><b>{who}</b> {last.text}</> : 'Start the conversation with your league'}
            </span>
          </span>
          <span className="chd-open" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
              strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg>
          </span>
        </span>
      </div>

      {showing ? (
        <div className="chd-layer">
          <div className="chd-scrim" style={{ opacity: fade }} onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={sheet}
            className={'chd-sheet' + (dragging ? ' is-dragging' : '')}
            role="dialog"
            aria-label="League chat"
            style={{ transform: offset ? `translateY(${offset}px)` : undefined }}
          >
            <div
              className="chd-head"
              onPointerDown={down('sheet')}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => { gesture.current = null; setDragging(false); setOpen(true); }}
            >
              <span className="chd-grip" aria-hidden="true" />
              <div className="chd-head-row">
                {logo ? <img className="chd-logo" src={logo} alt="" /> : <span className="chd-logo is-icon">💬</span>}
                <span className="chd-head-text">
                  <span className="chd-head-name">{m.league.name}</span>
                  <span className="chd-head-sub">League chat · {m.teamCount} teams</span>
                </span>
                <button type="button" className="chd-x" aria-label="Close"
                  onPointerDown={e => e.stopPropagation()} onClick={() => setOpen(false)}>✕</button>
              </div>
            </div>
            <LeagueChat app={app} m={m} msgs={msgs} err={err}
              onProfile={rid => { setOpen(false); app.setDetail('team-' + rid); }} />
          </div>
        </div>
      ) : null}
    </>
  );
}
