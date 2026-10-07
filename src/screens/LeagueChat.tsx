import { useEffect, useMemo, useRef, useState } from 'react';
import { currentUid } from '../api/access';
import { CHAT_MAX, chatEnabled, deleteChat, sendChat, tagsMe, type ChatMessage, type ChatTrade } from '../api/chat';
import { isOwnerHere } from '../model/access';
import { colorOf } from '../model/constants';
import type { Pos } from '../api/types';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { Overlay } from '../ui/primitives';
import { Balance, TradeBuilder, assessTrade } from './TradeBuilder';

/**
 * The league's live chat. Your messages on the right in the accent, everyone
 * else's on the left under their team name and picture; a day's first
 * message carries the date. The newest stays in view as messages arrive,
 * unless you have scrolled up to read.
 */
export function LeagueChat({ app, m, msgs, err: feedErr, onProfile }: {
  app: App; m: Model; msgs: ChatMessage[] | null; err: string;
  /** open a manager's team, from his picture or name */
  onProfile: (rid: number) => void;
}) {
  const lid = m.league.league_id;
  const [sendErr, setErr] = useState('');
  const err = sendErr || feedErr;
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  /** The name being typed after an @, while there is one at the caret. */
  const [tagQ, setTagQ] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const me = currentUid();
  const owner = isOwnerHere();
  const myRid = m.leagueRows.find(r => r.isMe)?.id ?? null;
  /* Proposing a trade: first who with, then the builder itself. */
  const [proposing, setProposing] = useState<null | 'pick' | 'build'>(null);
  /** The writer's team: the one he wrote from, or for older messages the one
   *  his Sleeper name runs. */
  const rowOf = (x: ChatMessage) =>
    (x.rid != null ? m.leagueRows.find(r => r.id === x.rid) : undefined)
    || (x.user ? m.leagueRows.find(r => r.user === x.user) : undefined);

  // Follow the newest message, unless you scrolled up to read older ones.
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const post = async (t: string, trade?: ChatTrade) => {
    if (!t || busy) return false;
    setBusy(true);
    try {
      const ok = await sendChat(lid, {
        name: m.myTeamName || m.me.teamName || m.me.name,
        user: m.me.name,
        avatar: m.me.avatar || undefined,
        ...(myRid != null ? { rid: myRid } : {}),
        ...(trade ? { trade } : {}),
        text: t,
      });
      if (ok) { setErr(''); stick.current = true; } else setErr('Your message was not sent. Try again.');
      return ok;
    } catch {
      setErr('Your message was not sent. Check your connection.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (await post(text.trim())) setText('');
  };

  /* Tagging: @ brings up the league, filtered as you type; a pick puts the
     manager's Sleeper name in. */
  const readTag = (value: string, caret: number) => {
    const hit = /(^|\s)@([A-Za-z0-9_.]*)$/.exec(value.slice(0, caret));
    setTagQ(hit ? hit[2].toLowerCase() : null);
  };
  const tagRows = tagQ == null ? [] : [
    ...m.leagueRows.filter(r => !r.isMe && r.user)
      .filter(r => !tagQ || r.user.toLowerCase().includes(tagQ) || r.name.toLowerCase().includes(tagQ))
      .map(r => ({ key: String(r.id), handle: r.user, name: r.name, avatar: r.avatar })),
    ...('everyone'.startsWith(tagQ) ? [{ key: 'all', handle: 'everyone', name: 'Everyone in the league', avatar: null }] : []),
  ].slice(0, 6);
  const putTag = (handle: string) => {
    const el = box.current;
    const caret = el ? el.selectionStart : text.length;
    const before = text.slice(0, caret).replace(/@[A-Za-z0-9_.]*$/, '@' + handle + ' ');
    const next = before + text.slice(caret);
    setText(next);
    setTagQ(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(before.length, before.length); });
  };
  /** A message's text with its tags drawn as tags: a known manager opens his team. */
  const withTags = (t: string) => t.split(/(@[A-Za-z0-9_.]+)/).map((part, i) => {
    if (i % 2 === 0) return part;
    const h = part.slice(1).replace(/\.+$/, '').toLowerCase();
    const row = m.leagueRows.find(r => r.user && r.user.toLowerCase() === h);
    if (h === 'everyone') return <span key={i} className="ch-at">{part}</span>;
    return row ? (
      <button key={i} type="button" className={'ch-at' + (row.isMe ? ' is-me' : '')} onClick={() => onProfile(row.id)}>
        {part}
      </button>
    ) : part;
  });

  const teamName = (rid: number) => {
    const r = m.leagueRows.find(x => x.id === rid);
    return r ? (r.isMe ? 'You' : r.name) : 'A team';
  };
  /* The builder's trade as a message: what moves, with names, so it still
     reads after the players have moved on. */
  const proposal = (): ChatTrade | null => {
    const moves = Object.entries(app.tradeAssets).map(([id, a]) => {
      const info = m.teamInfo(a.from);
      const p = info?.list.find(x => x.id === id);
      const pick = info?.picks.find(x => x.id === id);
      return { id, from: a.from, to: a.to, name: p?.name || pick?.name || id, ...(p?.pos ? { pos: p.pos } : {}) };
    });
    return app.tradeTeams.length >= 2 && moves.length ? { teams: app.tradeTeams.slice(), moves } : null;
  };
  const sendProposal = async () => {
    const t = proposal();
    if (!t) return;
    const line = t.teams.map(rid => {
      const got = t.moves.filter(x => x.to === rid).map(x => x.name);
      return (rid === myRid ? (m.myTeamName || 'Me') : teamName(rid)) + ' gets ' + (got.join(', ') || 'nothing');
    }).join(' · ');
    if (await post(('⇄ Trade proposal: ' + line).slice(0, CHAT_MAX), t)) setProposing(null);
  };
  const openTrade = (t: ChatTrade) => {
    app.loadTrade(t.teams, Object.fromEntries(t.moves.map(x => [x.id, { from: x.from, to: x.to }])));
    setProposing('build');
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
                    {(() => {
                      // Everyone's picture, yours too: whoever wrote it, at a glance.
                      if (grouped) return <span className="ch-av is-blank" />;
                      const row = rowOf(x);
                      const pic = x.avatar || row?.avatar;
                      const open = row ? () => onProfile(row.id) : undefined;
                      return pic
                        ? <img className={'ch-av' + (open ? ' is-tap' : '')} src={pic} alt={x.name} onClick={open} />
                        : <span className={'ch-av' + (open ? ' is-tap' : '')} onClick={open}>{x.name.slice(0, 1).toUpperCase()}</span>;
                    })()}
                    <div className={'ch-bubble-wrap' + (x.trade ? ' is-trade' : '')}>
                      {!grouped ? (() => {
                        const row = rowOf(x);
                        return (
                          <button type="button" className="ch-name" disabled={!row}
                            onClick={row ? () => onProfile(row.id) : undefined}>
                            {mine ? 'You' : x.name}{x.user && !mine ? <span> @{x.user}</span> : null}
                          </button>
                        );
                      })() : null}
                      {x.trade ? (
                        <TradeCard app={app} m={m} t={x.trade} from={rowOf(x)?.id ?? null} myRid={myRid}
                          time={time(x.at)} onOpen={() => openTrade(x.trade as ChatTrade)}
                          onReply={r => void post(r)} />
                      ) : (
                      <div className={'ch-bubble' + (!mine && tagsMe(x.text, m.me.name) ? ' is-tagged' : '')}
                        title={time(x.at)}>
                        {withTags(x.text)}
                        <span className="ch-time">{time(x.at)}</span>
                        {owner && !mine ? (
                          <button type="button" className="ch-del" aria-label="Delete message" onClick={() => {
                            if (confirm('Delete this message for everyone?')) void deleteChat(lid, x.id);
                          }}>
                            🗑
                          </button>
                        ) : null}
                      </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
      </div>

      {err ? <div className="ch-err" role="alert">{err}</div> : null}

      <div className="ch-input">
        {tagRows.length ? (
          <div className="ch-tags" role="listbox" aria-label="Tag someone">
            {tagRows.map(r => (
              <button key={r.key} type="button" role="option" className="ch-tag-row"
                onMouseDown={e => e.preventDefault()} onClick={() => putTag(r.handle)}>
                {r.avatar ? <img src={r.avatar} alt="" /> : <span className="ch-tag-blank">@</span>}
                <span className="ch-tag-name">{r.name}</span>
                <span className="ch-tag-handle">@{r.handle}</span>
              </button>
            ))}
          </div>
        ) : null}
        <button type="button" className="ch-trade-btn" aria-label="Propose a trade" title="Propose a trade"
          onClick={() => setProposing('pick')}>
          ⇄
        </button>
        <textarea
          value={text}
          rows={1}
          maxLength={CHAT_MAX}
          ref={box}
          placeholder="Message · @ to tag"
          onChange={e => { setText(e.target.value); readTag(e.target.value, e.target.selectionStart); }}
          onSelect={e => readTag(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => window.setTimeout(() => setTagQ(null), 150)}
          onKeyDown={e => {
            // With the list up, Enter or Tab takes its first name.
            if (tagRows.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); putTag(tagRows[0].handle); return; }
            if (e.key === 'Escape' && tagQ != null) { e.stopPropagation(); setTagQ(null); return; }
            // Enter sends; Shift+Enter is a new line, as in every chat.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
        />
        <button type="button" className="ch-send" disabled={busy || !text.trim()} onClick={() => void send()}
          aria-label="Send">
          ➤
        </button>
      </div>

      {proposing === 'pick' ? (
        <Overlay onClose={() => setProposing(null)} label="Chat" z={40}>
          <div className="fb-pick-title">Propose a trade to…</div>
          {m.leagueRows.filter(r => !r.isMe).map(r => (
            <button key={r.id} type="button" className="fb-pick-row" onClick={() => {
              app.loadTrade(myRid != null ? [myRid, r.id] : [r.id], {});
              setProposing('build');
            }}>
              {r.avatar ? <img className="fb-face" src={r.avatar} alt="" /> : <span className="fb-face fb-face-blank" />}
              <span className="fb-card-body">
                <span className="fb-card-name">{r.name}</span>
                <span className="fb-card-meta"><span className="fb-val">@{r.user}{r.worst ? ' · weak at ' + r.worst : ''}</span></span>
              </span>
            </button>
          ))}
        </Overlay>
      ) : null}
      {proposing === 'build' ? (
        <Overlay onClose={() => setProposing(null)} label="Chat" z={40}>
          <TradeBuilder app={app} m={m} footer={
            <button type="button" className="btn btn-primary ch-propose" disabled={busy || !proposal()}
              onClick={() => void sendProposal()}>
              {busy ? 'Sending…' : proposal() ? 'Send to the chat ⇄' : 'Add players to propose it'}
            </button>
          } />
        </Overlay>
      ) : null}
    </div>
  );
}

/**
 * A trade put to the league, as the calculator sees it: who gets what, the
 * verdict and the tug-of-war bar. Open it to see the whole analysis, change
 * it and send it back as a counter.
 */
function TradeCard({ app, m, t, from, myRid, time, onOpen, onReply }: {
  app: App; m: Model; t: ChatTrade; from: number | null; myRid: number | null; time: string;
  onOpen: () => void; onReply: (text: string) => void;
}) {
  const moves = useMemo(() => Object.fromEntries(t.moves.map(x => [x.id, { from: x.from, to: x.to }])), [t]);
  const a = useMemo(() => assessTrade(app, m, t.teams, moves),
    // The verdict is the trade's; the app's other state does not change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m, moves]);
  const pivot = t.teams.includes(myRid ?? -1) ? myRid : from ?? t.teams[0];
  // Put to you, by someone else: you can answer it from here.
  const forMe = myRid != null && t.teams.includes(myRid) && from !== myRid;
  return (
    <div className="ch-trade">
      <div className="ch-trade-kick">⇄ Trade proposal <span>{time}</span></div>
      <Balance v={a.v} pivot={pivot} head={a.head} />
      <div className="ch-trade-cols">
        {t.teams.map(rid => {
          const row = m.leagueRows.find(r => r.id === rid);
          return (
            <div key={rid} className="ch-trade-col">
              <div className="ch-trade-who">
                {row?.avatar ? <img src={row.avatar} alt="" /> : <span className="ch-trade-blank" />}
                <span>{row ? (row.isMe ? 'You' : row.name) : 'Team'} <i>get</i></span>
              </div>
              {t.moves.filter(x => x.to === rid).map(x => {
                const photo = /^\d+$/.test(x.id) ? app.photoFor(x.id) : null;
                return (
                  <div key={x.id} className="ch-trade-p">
                    {photo ? <img src={photo} alt="" /> : <span className="ch-trade-blank">🎟</span>}
                    <span className="ch-trade-name">{x.name}</span>
                    {x.pos ? <b style={{ color: colorOf(x.pos as Pos) }}>{x.pos}</b> : null}
                  </div>
                );
              })}
              {!t.moves.some(x => x.to === rid) ? <div className="ch-trade-none">Nothing</div> : null}
            </div>
          );
        })}
      </div>
      <div className="ch-trade-acts">
        <button type="button" className="ch-trade-open" onClick={onOpen}>Open in calculator ›</button>
        {forMe ? (
          <>
            <button type="button" className="ch-trade-yes" onClick={() => onReply('✅ I\'m in on that trade')}>👍</button>
            <button type="button" className="ch-trade-no" onClick={() => onReply('❌ Pass on that trade')}>👎</button>
          </>
        ) : null}
      </div>
    </div>
  );
}
