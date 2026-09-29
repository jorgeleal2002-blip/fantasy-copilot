import { aheadBy, compareSeasons } from '../model/compare';
import { barHeights } from '../model/season';
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
        <div style={{ fontSize: 14, color: dim(0.6) }}>No data for this player.</div>
      </Overlay>
    );
  }

  const b = bId ? m.allFits.find(x => x.id === bId) : undefined;
  return (
    <Overlay onClose={() => app.setDetail(null)} label="Back" z={7}>
      {b
        ? <Side a={a} b={b} app={app} />
        : <Pick app={app} m={m} a={a} />}
    </Overlay>
  );
}

/** The list of men he could be compared with: his position, best first. */
function Pick({ app, m, a }: { app: App; m: Model; a: PlayerFit }) {
  const field = m.allFits
    .filter(x => x.pos === a.pos && x.id !== a.id)
    .map(x => ({ x, s: app.seasonOf(x.id) }))
    .sort((p, q) => (q.s?.ppg ?? -1) - (p.s?.ppg ?? -1));

  return (
    <>
      <div style={{ fontSize: 19, fontWeight: 500, letterSpacing: '-0.02em' }}>
        Compare {a.name} with
      </div>
      <div style={{ fontSize: 11.5, color: dim(0.45), marginTop: 4, textWrap: 'pretty' }}>
        The {a.pos}s in this league, by what they have averaged. Only his own
        position: you cannot start a {a.pos} instead of anything else, so
        nothing else is a comparison.
      </div>
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
              <div style={{ fontSize: 13.5, ...ellipsis }}>{x.name}</div>
              <div style={{ fontSize: 10.5, color: dim(0.4), marginTop: 2, ...ellipsis }}>
                {x.team || 'FA'} · {x.mine ? 'yours' : x.owner}
              </div>
            </div>
            <div style={{ flex: 'none', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
              {s ? s.ppg.toFixed(1) : '—'}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Side({ a, b, app }: { a: PlayerFit; b: PlayerFit; app: App }) {
  const sa = app.seasonOf(a.id);
  const sb = app.seasonOf(b.id);
  const rows = compareSeasons(sa, sb);
  const ahead = aheadBy(rows);

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

      <div style={{ marginTop: 14 }}>
        {rows.map(r => (
          <div className="cmp-row" key={r.key}>
            <div className={'cmp-val' + (r.win === 'a' ? ' is-win' : '')}>
              {r.a == null ? '—' : r.a.toFixed(r.key === 'games' ? 0 : 1)}
            </div>
            <div className="cmp-label">{r.label}</div>
            <div className={'cmp-val is-right' + (r.win === 'b' ? ' is-win' : '')}>
              {r.b == null ? '—' : r.b.toFixed(r.key === 'games' ? 0 : 1)}
            </div>
          </div>
        ))}
      </div>

      {/* The shape of each season under the totals: two men on the same average
          can have got there in ways that mean different things next Sunday. */}
      <div className="cmp-charts">
        <Bars app={app} id={a.id} name={a.name} />
        <Bars app={app} id={b.id} name={b.name} />
      </div>
    </>
  );
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
  const hs = barHeights(games);
  return (
    <div className="cmp-chart">
      {/* Named, because two sets of bars in a row with nothing between them
          read as one chart of seven weeks. */}
      <div className="cmp-chart-h">{name}</div>
      <div className="ps-bars">
        {games.map((g, i) => (
          <div className="ps-bar" key={g.week}>
            <div className="ps-bar-n">{g.pts.toFixed(0)}</div>
            <div className="ps-bar-fill" style={{ height: ((hs[i] as number) * 100) + '%' }} />
          </div>
        ))}
      </div>
      <div className="ps-wks" aria-hidden="true">
        {games.map(g => <div className="ps-wk" key={g.week}>W{g.week}</div>)}
      </div>
    </div>
  );
}
