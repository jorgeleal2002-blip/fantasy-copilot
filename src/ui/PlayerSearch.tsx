import { useState } from 'react';
import type { Pos } from '../api/types';
import { POS } from '../model/constants';
import { num } from '../model/math';
import type { Model, SearchEntry } from '../model/types';
import type { App } from '../state/useApp';
import { dim, ellipsis, fitColor } from './styles';
import { Segmented, type SegOption } from './primitives';
import { TradePackages } from './TradePackages';

const POS_FILTERS: SegOption<'ALL' | Pos>[] =
  [{ key: 'ALL', label: 'All' }, ...POS.map(p => ({ key: p, label: p }))];

export interface SearchScope {
  /** which entries this screen is allowed to show */
  keep: (e: SearchEntry) => boolean;
  /** what to say when the scope is what hid the hits */
  narrowed: string;
}

/**
 * Search across Sleeper's whole catalog rather than one screen's list: the
 * player you are looking up is usually exactly the one who is NOT in the 24 in
 * front of you. Hits are scored on demand, so nothing is computed until you
 * type, and each one arrives with its price — the first thing you want before
 * proposing anything.
 */
export function PlayerSearch(
  { app, m, placeholder, scope, byPos }: {
    app: App; m: Model; placeholder?: string; scope?: SearchScope;
    /** Show position chips, so the list can be browsed and not only typed at. */
    byPos?: boolean;
  },
) {
  const q = app.query.trim().toLowerCase();
  const [pos, setPos] = useState<'ALL' | Pos>('ALL');
  // With chips on, a position on its own is a query: picking RB should list
  // the backs rather than wait for two letters nobody wants to type.
  const hasQuery = q.length >= 2 || (!!byPos && pos !== 'ALL');
  const label = placeholder || 'Search any NFL player';
  // Only one row's packages at a time: pricing a target is a real computation,
  // and eight of them on every keystroke would make typing feel broken.
  const [openId, setOpenId] = useState<string | null>(null);

  // Counted before the scope is applied, so an empty list can tell you whether
  // the name is missing from the catalog or merely missing from THIS list.
  let hiddenByScope = 0;

  const results = hasQuery ? (() => {
    const out = [];
    for (const e of m.searchIndex) {
      if (q.length >= 2 && e.lower.indexOf(q) < 0) continue;
      if (byPos && pos !== 'ALL' && e.pos !== pos) continue;
      if (scope && !scope.keep(e)) { hiddenByScope++; continue; }
      out.push(e);
      if (out.length > 400) break;
    }
    return out.sort((a, b) => a.rank - b.rank).slice(0, 8).map(x => {
      const sc = m.scoreAny(x.id);
      return {
        id: x.id,
        name: x.name,
        meta: sc
          ? `${sc.pos} · ${sc.team || 'FA'} · ${sc.age ?? '?'} yrs · ` +
            (sc.owner ? (sc.owned ? 'yours' : 'on ' + sc.owner) : 'free agent')
          : '',
        fit: sc && Number.isFinite(sc.fit) ? sc.fit : null,
        val: m.marketValue(x.id),
        // Only a rival's player can be traded for; your own and free agents cannot.
        owner: sc && sc.owner && !sc.owned ? sc.owner : null,
      };
    });
  })() : [];

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9,
        background: 'var(--color-surface)', border: '1px solid var(--color-divider)',
        borderRadius: 10, padding: '9px 11px',
      }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(233,233,237,.4)" strokeWidth="1.8" style={{ flex: 'none' }}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          value={app.query}
          onChange={e => app.setQuery(e.target.value)}
          placeholder={label}
          aria-label={label}
          autoCapitalize="none"
          autoCorrect="off"
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none',
            color: 'var(--color-text)', font: "400 13px 'Inter', system-ui",
          }}
        />
        {app.query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => app.setQuery('')}
            style={{
              flex: 'none', color: dim(0.45), fontSize: 15, cursor: 'pointer',
              padding: '0 2px', background: 'transparent', border: 0,
            }}
          >
            ×
          </button>
        ) : null}
      </div>

      {byPos ? (
        <Segmented options={POS_FILTERS} value={pos} onChange={setPos} size="sm" />
      ) : null}

      {hasQuery ? (
        <div style={{ background: 'var(--color-surface)', borderRadius: 12, overflow: 'hidden' }}>
          {results.length === 0 ? (
            <div style={{ padding: '14px 12px', fontSize: 12.5, lineHeight: 1.5, color: dim(0.5) }}>
              {hiddenByScope && scope
                ? `${hiddenByScope === 1 ? '1 match is' : hiddenByScope + ' matches are'} ${scope.narrowed}`
                : 'Nobody by that name in the catalog.'}
            </div>
          ) : results.map((r, i) => (
            <div key={r.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-divider)' }}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => app.setDetail(r.id)}
                onKeyDown={e => { if (e.key === 'Enter') app.setDetail(r.id); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em', ...ellipsis }}>{r.name}</div>
                  <div style={{ fontSize: 10.5, color: dim(0.42), marginTop: 2, ...ellipsis }}>{r.meta}</div>
                </div>
                <div style={{ flex: 'none', textAlign: 'right' }}>
                  <div style={{
                    fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em',
                    // A modelled price is not a market price, and the app never
                    // pretends otherwise: it arrives dimmed and labelled.
                    color: r.val && r.val.real ? 'var(--color-text)' : dim(0.55),
                  }}>
                    {r.val ? num(r.val.pts) : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: dim(0.4), marginTop: 2, whiteSpace: 'nowrap' }}>
                    {r.val && !r.val.real ? 'modelled · ' : ''}
                    {r.val && r.val.posRank ? r.val.pos + String(r.val.posRank) + ' · ' : ''}
                    Rating <span style={{ color: r.fit != null ? fitColor(r.fit) : dim(0.5) }}>{r.fit ?? '—'}</span>
                  </div>
                </div>
              </div>

              {/* Shortlist him without leaving the search: the packages open
                  right here, with the same button the player sheet has. */}
              {r.owner ? (
                <>
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}
                    aria-expanded={openId === r.id}
                    style={{
                      width: '100%', textAlign: 'left', padding: '0 12px 10px', fontSize: 11,
                      color: 'var(--color-accent)', background: 'transparent', border: 0, cursor: 'pointer',
                    }}
                  >
                    {openId === r.id ? 'Hide what he would cost' : 'What he would cost ›'}
                  </button>
                  {openId === r.id ? (
                    <div style={{ padding: '0 12px 12px', background: 'rgba(233,233,237,.03)' }}>
                      <TradePackages app={app} m={m} targetId={r.id} targetName={r.name} compact />
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
