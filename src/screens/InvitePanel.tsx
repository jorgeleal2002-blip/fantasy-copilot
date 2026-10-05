import { useEffect, useState } from 'react';
import { createInvite, listInvites, revokeInvite, type Invite } from '../api/access';
import { BAD, GOOD } from '../model/constants';
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

  const reload = () => listInvites().then(setList).catch(() => setMsg('Could not load the codes.'));
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

  const date = (t?: number) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
  const unused = (list || []).filter(i => !i.usedBy).length;

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

      {list?.length ? (
        <div style={{ marginTop: 14 }}>
          <div style={{
            fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.52), marginBottom: 6,
          }}>
            {list.length} codes · {unused} unused
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {list.map(inv => (
              <div key={inv.code} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                borderTop: 'var(--hairline) solid var(--color-divider)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.06em', fontVariantNumeric: 'tabular-nums' }}>
                    {prettyCode(inv.code)}
                  </div>
                  <div style={{ fontSize: 12, color: dim(0.62), ...ellipsis }}>
                    {inv.note ? inv.note + ' · ' : ''}{inv.usedBy ? 'used ' + date(inv.usedAt) : 'made ' + date(inv.createdAt)}
                  </div>
                </div>
                <span style={{
                  flex: 'none', fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                  color: inv.usedBy ? GOOD : dim(0.75),
                  background: inv.usedBy ? 'color-mix(in srgb, var(--c-good) 12%, transparent)' : 'rgba(242, 253, 254, 0.07)',
                }}>
                  {inv.usedBy ? '✓ Used' : 'Unused'}
                </span>
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
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
