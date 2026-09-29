import { useEffect, useState } from 'react';
import { type CmpRow, type CmpUse, aheadBy, compareMetrics, compareNumbers, compareSeasons } from '../model/compare';
import { METRIC_LABEL } from '../model/constants';
import { POS } from '../model/constants';
import type { Pos } from '../api/types';
import { resolve } from './PlayerSheet';
import { WeekBars } from '../ui/charts';
import { Segmented, type SegOption } from '../ui/primitives';
import type { Model, PlayerFit } from '../model/types';
import type { App } from '../state/useApp';
import { Face, Overlay } from '../ui/primitives';
import { dim, ellipsis } from '../ui/styles';

/**
 * Two players' seasons against each other.
 *
 * Laid out the way the matchup screen lays out a game, because it is the same
 * question: two sides, a spine down the middle naming what is being compared,
 * and the winner of each line marked. Reading two cards and doing the
 * subtraction in your head is the work this is supposed to have done.
 *
 * The other man is picked from his own position only. A quarterback against a
 * tight end compares two numbers that were never in competition — you cannot
 * start one instead of the other — and a screen that offers the comparison is
 * inviting a conclusion it cannot support.
 */
export function CompareSheet({ app, m, ids }: { app: App; m: Model; ids: string[] }) {
  const [aId, bId] = ids;
  const a = m.allFits.find(x => x.id === aId);

  if (!a) {
    return (
      <Overlay onClose={() => app.setDetail(null)} label="Back" z={7}>
        <div style={{ fontSize: 13, color: dim(0.75) }}>No data for this player.</div>
      </Overlay>
    );
  }

  const b = bId ? m.allFits.find(x => x.id === bId) : undefined;
  return (
    <Overlay onClose={() => app.setDetail(null)} label="Back" z={7}>
      {b
        ? <Side a={a} b={b} app={app} m={m} />
        : <Pick app={app} m={m} a={a} />}
    </Overlay>
  );
}

/** The list of men he could be compared with: his position, best first. */
function Pick({ app, m, a }: { app: App; m: Model; a: PlayerFit }) {
  /* His own position first, because that is the comparison that can act on
     something — you start one of them instead of the other. The rest are here
     because people ask anyway, and a screen that refuses the question is worse
     than one that answers it and says what the answer is worth. */
  const [pos, setPos] = useState<'ALL' | Pos>(a.pos);
  const field = m.allFits
    .filter(x => x.id !== a.id && (pos === 'ALL' || x.pos === pos))
    .map(x => ({ x, s: app.seasonOf(x.id) }))
    .sort((p, q) => (q.s?.ppg ?? -1) - (p.s?.ppg ?? -1));

  const options: SegOption<'ALL' | Pos>[] =
    [{ key: 'ALL', label: 'All' }, ...POS.map(k => ({ key: k, label: k }))];

  return (
    <>
      <div style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.02em' }}>
        Compare {a.name} with
      </div>
      <div style={{ fontSize: 12, color: dim(0.62), marginTop: 4, marginBottom: 12 }}>
        By points a game
      </div>
      <Segmented options={options} value={pos} onChange={setPos} size="sm" />
      <div style={{ marginTop: 14 }}>
        {field.map(({ x, s }) => (
          <div
            key={x.id}
            className="cmp-pick"
            role="button"
            tabIndex={0}
            onClick={() => app.setDetail('compare-' + a.id + '~' + x.id)}
            onKeyDown={e => { if (e.key === 'Enter') app.setDetail('compare-' + a.id + '~' + x.id); }}
          >
            <Face {...app.photoSet(x.id)} pos={x.pos} size={34} round />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, ...ellipsis }}>{x.name}</div>
              <div style={{ fontSize: 10, color: dim(0.52), marginTop: 2, ...ellipsis }}>
                {x.pos} · {x.team || 'FA'} · {x.mine ? 'yours' : x.owner}
              </div>
            </div>
            <div style={{ flex: 'none', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {s ? s.ppg.toFixed(1) : '—'}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Side({ a, b, app, m }: { a: PlayerFit; b: PlayerFit; app: App; m: Model }) {
  /* One request a week for the stat lines behind the touchdown count. A week
     of stats is the whole league of football, so both men come out of the same
     payload — and it is the same cache the player card and the scoreboard
     fill, so arriving here from either of them costs nothing. */
  const upTo = Math.min(18, Math.max(0, app.nflWeek ?? app.week ?? 0));
  const { fetchGameStats } = app;
  useEffect(() => {
    if (upTo) void fetchGameStats(Array.from({ length: upTo }, (_, i) => i + 1));
  }, [fetchGameStats, upTo]);

  const sa = app.seasonOf(a.id);
  const sb = app.seasonOf(b.id);
  const rows = compareSeasons(sa, sb);
  /* Appended to the season rather than sitting with the rates below it: it is
     a count of what happened this year, which is what the rows around it are. */
  const ta = app.seasonTds(a.id);
  const tb = app.seasonTds(b.id);
  if (ta != null || tb != null) {
    rows.push({
      key: 'tds', label: 'Touchdowns', a: ta, b: tb,
      win: ta != null && tb != null && ta !== tb ? (ta > tb ? 'a' : 'b') : null,
    });
  }
  const ahead = aheadBy(rows);
  const nums = compareNumbers(useOf(m, a, a.fit), useOf(m, b, b.fit));
  /* What the Rating is made of, ordered by how far apart they are — so the
     reason one of them is ahead is the first line rather than somewhere in
     eleven rows of mostly nothing. */
  /* Out of the list's own scoring, not a fresh one. Scoring a player again
     here gave a different answer — an un-owned man came back on the draft
     board's weights and against YOUR stack rather than his owner's — so the
     breakdown was explaining a Rating nothing had ordered by, and its rows
     did not add up to the Rating printed over them. */
  const why = compareMetrics(
    m.metricKeys as string[],
    k => METRIC_LABEL[k as keyof typeof METRIC_LABEL] || k,
    { m: a.m as unknown as Record<string, number>, weights: a.weights as unknown as Record<string, number> },
    { m: b.m as unknown as Record<string, number>, weights: b.weights as unknown as Record<string, number> },
  );

  return (
    <>
      <div className="cmp-head">
        <Who app={app} p={a} />
        <div className="cmp-vs">vs</div>
        <Who app={app} p={b} align="right" />
      </div>

      {ahead ? (
        <div className="cmp-verdict">
          <b>{(ahead.side === 'a' ? a : b).name}</b> takes {ahead.rows} of the {rows.length} —
          on this season alone, and not counting who either of them plays next.
        </div>
      ) : null}

      <Rows rows={rows} />

      {/* The shape of each season under the totals: two men on the same average
          can have got there in ways that mean different things next Sunday. */}
      <div className="cmp-charts">
        <Bars app={app} id={a.id} name={a.name} />
        <Bars app={app} id={b.id} name={b.name} />
      </div>

      {nums.length ? (
        <>
          <div className="cmp-sec">The numbers</div>
          <Rows rows={nums} />
        </>
      ) : null}

      {why.length ? (
        <>
          <div className="cmp-sec">Why the Rating</div>
          <Rows rows={why} />
        </>
      ) : null}
    </>
  );
}

/** How a figure is written, which the row cannot know from its value alone. */
const DIGITS: Record<string, number> = { games: 0, value: 0, rating: 0, tds: 0, td: 2 };
const SUFFIX: Record<string, string> = { snap: '%', rz: '%' };

function Rows({ rows }: { rows: CmpRow[] }) {
  const write = (v: number | null, key: string) =>
    (v == null ? '—' : v.toFixed(DIGITS[key] ?? 1) + (SUFFIX[key] || ''));
  return (
    <div style={{ marginTop: 14 }}>
      {rows.map(r => (
        <div className="cmp-row" key={r.key}>
          <div className={'cmp-val' + (r.win === 'a' ? ' is-win' : '')}>{write(r.a, r.key)}</div>
          <div className="cmp-label">{r.label}</div>
          <div className={'cmp-val is-right' + (r.win === 'b' ? ' is-win' : '')}>{write(r.b, r.key)}</div>
        </div>
      ))}
    </div>
  );
}

/** What of a player's card two of them can be asked together. */
function useOf(m: Model, p: PlayerFit, rating: number): CmpUse {
  const id = p.id;
  const u = resolve(m, id, m.wUsed)?.use;
  const val = m.marketValue(id);
  return {
    rating,
    value: val ? val.pts : null,
    snap: u?.snap ?? null,
    share: u && Number.isFinite(u.tgt) ? (u.tgt as number) : null,
    shareLabel: u?.shareLabel ?? null,
    eff: u && Number.isFinite(u.eff) ? (u.eff as number) : null,
    tdPerGame: u?.tdPerGame ?? null,
    rzShare: u?.rzShare ?? null,
  };
}

function Who({ app, p, align }: { app: App; p: PlayerFit; align?: 'right' }) {
  return (
    <div className={'cmp-who' + (align ? ' is-right' : '')}>
      <Face {...app.photoSet(p.id)} pos={p.pos} size={46} round />
      <div style={{ minWidth: 0 }}>
        <div className="cmp-name">{p.name}</div>
        <div className="cmp-sub">{p.pos} · {p.team || 'FA'} · {p.mine ? 'yours' : p.owner}</div>
      </div>
    </div>
  );
}

/** His weeks, each chart on its own scale — see `barHeights`. */
function Bars({ app, id, name }: { app: App; id: string; name: string }) {
  const games = app.seasonLog(id);
  if (!games.length) return <div className="cmp-chart" />;
  return (
    <div className="cmp-chart">
      {/* Named, because two sets of bars in a row with nothing between them
          read as one chart of seven weeks. */}
      <div className="cmp-chart-h">{name}</div>
      <WeekBars games={games} digits={0} />
    </div>
  );
}
