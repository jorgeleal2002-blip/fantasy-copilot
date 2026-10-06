import { useEffect, useState, type ReactNode } from 'react';
import {
  clearAttempts, createInvite, listAttempts, listInvites, listMembers, myUid, revokeInvite,
  type Attempt, type Invite, type Member,
} from '../api/access';
import { BAD } from '../model/constants';
import { inviteLink, makeCode, prettyCode } from '../model/access';
import { Card } from '../ui/primitives';
import { cardNote, cardTitle, dim, ellipsis } from '../ui/styles';

/**
 * The owner's invite desk: make a code, send it, see who used theirs, and
 * shut a phone out. Only drawn on the owner's phone, and only the owner's
 * phone can do any of it — the database refuses everybody else.
 */
export function InvitePanel() {
  const [list, setList] = useState<Invite[] | null>(null);
  const [note, setNote] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const [members, setMembers] = useState<Record<string, Member>>({});
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [me, setMe] = useState('');
  const reload = () => Promise.all([
    listInvites().then(setList),
    // The log is extra: rules published before it existed refuse it, and the
    // codes must still work.
    listMembers().then(ms => setMembers(Object.fromEntries(ms.map(x => [x.uid, x])))).catch(() => {}),
    listAttempts().then(setAttempts).catch(() => {}),
    myUid().then(setMe).catch(() => {}),
  ]).catch(() => setMsg('Could not load the codes.'));
  useEffect(() => { void reload(); }, []);

  const make = async () => {
    setBusy(true);
    setMsg('');
    try {
      const code = makeCode();
      if (await createInvite(code, note.trim())) {
        setFresh(code);
        setNote('');
        await reload();
      } else setMsg('The database refused it. Are the invite rules published?');
    } catch {
      setMsg('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const send = async (code: string) => {
    const url = inviteLink(code, location.href);
    const text = 'Your Doctors invite code: ' + prettyCode(code) + ' (works once)';
    try {
      if (navigator.share) { await navigator.share({ title: 'Doctors', text, url }); return; }
    } catch { return; /* closed the share sheet */ }
    try {
      await navigator.clipboard.writeText(text + '\n' + url);
      setMsg('Link copied.');
    } catch {
      setMsg(url);
    }
  };

  const revoke = async (inv: Invite) => {
    const ask = inv.usedBy
      ? 'Shut out the phone that used ' + prettyCode(inv.code) + '? It will need a new code.'
      : 'Withdraw ' + prettyCode(inv.code) + '? Nobody will be able to use it.';
    if (!confirm(ask)) return;
    try {
      if (!(await revokeInvite(inv))) setMsg('The database refused it.');
      if (fresh === inv.code) setFresh(null);
      await reload();
    } catch {
      setMsg('Could not reach the server.');
    }
  };

  const unused = (list || []).filter(i => !i.usedBy).length;
  /* A person is an account, and an account can be several devices: the one
     that spent the code and any added to it with a device code. */
  const acct = (root: string): (Member & { devices: number }) | undefined => {
    const ds = Object.values(members).filter(x => x.uid === root || x.account === root);
    if (!ds.length) return undefined;
    const last = ds.slice().sort((a, b) => (b.seen || 0) - (a.seen || 0))[0];
    return {
      ...last, uid: root, devices: ds.length,
      seen: last.seen, opens: ds.reduce((n, x) => n + (x.opens || 0), 0),
      user: last.user || ds.find(x => x.user)?.user,
      at: Math.min(...ds.map(x => x.at || Infinity)),
    };
  };
  const ownerRoot = members[me]?.account || me;
  const inCount = (list || []).filter(i => i.usedBy && acct(i.usedBy)).length;

  return (
    <Card>
      <div style={{ ...cardTitle, marginBottom: 2 }}>Invite codes</div>
      <div style={{ ...cardNote, marginBottom: 12 }}>
        Each code lets one phone in, once. Only you can make them.
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Who is it for? (optional)"
          maxLength={40}
          style={{
            flex: 1, minWidth: 0, background: 'var(--color-surface)', color: 'var(--color-text)',
            border: 'var(--hairline) solid var(--color-divider)', borderRadius: 8, padding: '9px 12px',
            font: "400 16px 'Inter', system-ui", outline: 'none',
          }}
        />
        <button type="button" className="btn btn-primary" disabled={busy}
          onClick={() => void make()} style={{ flex: 'none', borderRadius: 8, minHeight: 42 }}>
          {busy ? '…' : '+ New code'}
        </button>
      </div>

      {fresh ? (
        <div style={{
          marginTop: 12, padding: 12, borderRadius: 12, textAlign: 'center',
          background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
        }}>
          <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: '.12em', color: 'var(--color-accent)' }}>
            {prettyCode(fresh)}
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => void send(fresh)}
            style={{ marginTop: 10, borderRadius: 8, minHeight: 38, width: '100%' }}>
            Send invite
          </button>
        </div>
      ) : null}

      {msg ? <div style={{ fontSize: 12, lineHeight: '18px', color: dim(0.75), marginTop: 10, wordBreak: 'break-all' }}>{msg}</div> : null}

      {list?.length || acct(ownerRoot) ? (
        <div style={{ marginTop: 14 }}>
          <div style={{
            fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.52), marginBottom: 6,
          }}>
            Who is in · {inCount} in · {unused} not yet
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {acct(ownerRoot) ? (
              <PersonRow dot="👑" title="You (owner)" sub={seenLine(acct(ownerRoot)!)} />
            ) : null}
            {(list || []).map(inv => {
              const mem = inv.usedBy ? acct(inv.usedBy) : undefined;
              const title = inv.note || (mem?.user ? '@' + mem.user : prettyCode(inv.code));
              const sub = inv.usedBy
                ? [inv.note && mem?.user ? '@' + mem.user : '', mem ? seenLine(mem) : 'removed', prettyCode(inv.code)]
                  .filter(Boolean).join(' · ')
                : (inv.note ? 'code ' + prettyCode(inv.code) + ' · ' : '') + 'not in yet · made ' + rel(inv.createdAt);
              return (
                <PersonRow key={inv.code} dot={inv.usedBy ? dotFor(mem?.seen) : '⏳'} title={title} sub={sub}>
                  {!inv.usedBy ? (
                    <button type="button" className="btn btn-ghost" onClick={() => void send(inv.code)}
                      style={{ flex: 'none', fontSize: 12, padding: 0 }}>
                      Send
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-ghost" onClick={() => void revoke(inv)}
                    style={{ flex: 'none', fontSize: 12, padding: 0, color: BAD }}>
                    {inv.usedBy ? 'Revoke' : 'Withdraw'}
                  </button>
                </PersonRow>
              );
            })}
          </div>
        </div>
      ) : null}

      {attempts.length ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.52) }}>
              Wrong codes tried · {attempts.length}
            </span>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: 0 }}
              onClick={() => void clearAttempts().then(reload)}>
              Clear
            </button>
          </div>
          {attempts.slice(0, 10).map(t => (
            <PersonRow key={t.id} dot="❌" title={prettyCode(t.code) || '—'}
              sub={rel(t.at) + (members[t.uid] ? ' · later got in' : '')} />
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/** "today 3:12 pm", "yesterday", "4 days ago", or the date. */
function rel(t?: number): string {
  if (!t) return '—';
  const d = new Date(t);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'today ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'yesterday';
  if (days < 7) return days + ' days ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Opened in the last week, longer ago, or never since spending the code. */
const dotFor = (seen?: number) =>
  !seen ? '⚪' : Date.now() - seen < 7 * 86400000 ? '🟢' : '🟡';

const seenLine = (m: Member & { devices?: number }) =>
  (m.seen ? 'opened ' + rel(m.seen) : 'joined ' + rel(m.at))
  + (m.opens ? ' · ' + m.opens + (m.opens === 1 ? ' open' : ' opens') : '')
  + (m.devices && m.devices > 1 ? ' · 📱 ' + m.devices + ' devices' : '');

function PersonRow({ dot, title, sub, children }: {
  dot: string; title: string; sub: string; children?: ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
      borderTop: 'var(--hairline) solid var(--color-divider)',
    }}>
      <span aria-hidden="true" style={{ flex: 'none', fontSize: 13 }}>{dot}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, ...ellipsis }}>{title}</div>
        <div style={{ fontSize: 12, lineHeight: '16px', color: dim(0.62) }}>{sub}</div>
      </div>
      {children}
    </div>
  );
}
