import { ACCENT, BAD, GOOD, MID, POS } from '../model/constants';
import { num } from '../model/math';
import type { Model, TeamSheet as Sheet } from '../model/types';
import type { App } from '../state/useApp';
import { ord } from '../ui/format';
import { Bar, Card, CardHead, DividedRow, Overlay } from '../ui/primitives';
import { cardTitle, dim } from '../ui/styles';

export function TeamSheet({ app, m, rosterId }: { app: App; m: Model; rosterId: number }) {
  const info = m.teamInfo(rosterId);
  if (!info) {
    return (
      <Overlay onClose={() => app.setDetail(null)} label="The league" z={6}>
        <div style={{ fontSize: 14, color: dim(0.6) }}>No data for this team.</div>
      </Overlay>
    );
  }

  const { row } = info;
  const w = row.window;
  const windowColor = !m.leagueHasRosters ? dim(0.4) : w === 'contender' ? GOOD : w === 'rebuild' ? BAD : MID;
  const windowLabel = !m.leagueHasRosters ? 'No roster'
    : !m.isDynasty ? (w === 'contender' ? 'Strong roster' : w === 'rebuild' ? 'Weak roster' : 'Average roster')
      : w === 'contender' ? 'Contending now' : w === 'rebuild' ? 'Rebuilding' : 'Mid-table';

  const sub = !m.leagueHasRosters
    ? `${row.isMe ? 'Your team' : 'Rival manager'} · empty roster, draft not started`
    : `${row.isMe ? 'Your team' : 'Rival manager'} · ${ord(row.rankNow)}` +
      (m.isDynasty ? ` today · ${ord(row.rankFut)} ahead` : ' in the league') +
      ` · age ${row.avgAge.toFixed(1)}`;

  const pickTotal = info.picks.reduce((a, b) => a + b.q, 0);
  const maxPos = (p: (typeof POS)[number]) =>
    Math.max(...m.leagueRows.map(x => x.posStrength[p] || 0), 0.01);

  return (
    <Overlay onClose={() => app.setDetail(null)} label="The league" z={6}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {row.avatar ? (
          <img
            src={row.avatar}
            alt=""
            style={{
              width: 46, height: 46, borderRadius: 11, flex: 'none', objectFit: 'cover',
              border: '1px solid var(--color-divider)',
            }}
          />
        ) : null}
        <div style={{ fontSize: 25, fontWeight: 500, letterSpacing: '-0.025em' }}>{row.name}</div>
      </div>
      <div style={{ fontSize: 12.5, color: dim(0.5), marginTop: 4 }}>{sub}</div>
      <div style={{
        display: 'inline-flex', marginTop: 10, fontSize: 11, padding: '4px 10px', borderRadius: 7,
        color: windowColor, border: '1px solid ' + windowColor, background: 'rgba(233,233,237,.04)',
      }}>
        {windowLabel}
      </div>

      <div style={{
        border: '1px solid rgba(145,132,217,.4)', borderRadius: 12, padding: '14px 13px', marginTop: 14,
        background: 'rgba(145,132,217,.06)',
      }}>
        <div style={{
          fontSize: 10, letterSpacing: '.11em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 8,
        }}>
          How to trade with them
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, textWrap: 'pretty' }}>{angle(info, m)}</div>
      </div>

      <Card style={{ marginTop: 12 }}>
        <div style={{ ...cardTitle, marginBottom: 12 }}>Their strength by position</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {POS.map(p => {
            const rank = info.ranks[p];
            const color = rank <= 3 ? GOOD : rank >= m.leagueRows.length - 2 ? BAD : MID;
            return (
              <div key={p}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                  <span style={{ fontWeight: 600, letterSpacing: '.06em', color: ACCENT }}>{p}</span>
                  <span style={{ color }}>{ord(rank)}</span>
                </div>
                <Bar
                  pct={Math.round((row.posStrength[p] || 0) / maxPos(p) * 100)}
                  color={rank <= 3 ? GOOD : rank >= m.leagueRows.length - 2 ? BAD : ACCENT}
                />
              </div>
            );
          })}
        </div>
      </Card>

      <div style={{ ...cardTitle, margin: '18px 0 8px' }}>Their best assets</div>
      {info.list.slice(0, 6).map(p => (
        <div
          key={p.id}
          className="row-tap"
          role="button"
          tabIndex={0}
          onClick={() => app.setDetail(p.id)}
          onKeyDown={e => { if (e.key === 'Enter') app.setDetail(p.id); }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            background: 'var(--color-surface)', borderRadius: 11, padding: '11px 12px',
            marginBottom: 8, cursor: 'pointer',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>{p.name}</div>
            <div style={{ fontSize: 11, color: dim(0.42), marginTop: 2 }}>
              {p.pos} · {p.age ?? '?'} yrs · {p.team}
            </div>
          </div>
          <div style={{ fontSize: 12, color: dim(0.55), flex: 'none' }}>{num(p.q * 100)}</div>
        </div>
      ))}

      {info.picks.length ? (
        <Card style={{ marginTop: 6 }}>
          <CardHead
            title="Their pick capital"
            right={<div style={{ fontSize: 12, color: ACCENT }}>{num(pickTotal * 100)}</div>}
          />
          {info.picks.slice(0, 6).map(p => (
            <DividedRow
              key={p.id}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', fontSize: 12.5 }}
            >
              <span>{p.name}</span>
              <span style={{ color: dim(0.5) }}>{num(p.q * 100)}</span>
            </DividedRow>
          ))}
        </Card>
      ) : null}
    </Overlay>
  );
}

/** What this manager will and will not do, given how their roster reads. */
function angle(info: Sheet, m: Model): string {
  if (info.row.isMe) return 'This is you: here is how the rest of the league reads your roster.';
  if (!m.leagueHasRosters) return 'They have not drafted yet. Once they have a roster I can tell you what they need and what they can spare.';
  const w = info.row.window;
  if (!m.isDynasty) {
    return w === 'contender'
      ? 'Strong roster: they only move for a clear upgrade to their starting lineup.'
      : w === 'rebuild'
        ? 'Weak roster: they accept almost any upgrade, even giving up their best piece for two starters.'
        : 'Balanced roster: they trade on pure value, position for position.';
  }
  return w === 'contender'
    ? 'They want to win now. They buy immediate production and let go of future picks. Offer veterans with a role; ask for draft capital.'
    : w === 'rebuild'
      ? 'They are accumulating. They will let veterans go cheap and they want youth and picks. Offer picks; ask for their 27-and-older producers.'
      : 'No clear direction: they move on pure value. Even offers with a slight premium work here.';
}
