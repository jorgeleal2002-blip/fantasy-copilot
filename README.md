# Doctors Fantasy

A Sleeper-connected dynasty assistant for fantasy football. Sign in with your
Sleeper username, pick a league, and the app reads your real rosters, draft
picks and league rules live from the browser — there is no server and no
account to create.

Built from the Claude Design prototype in [`project/`](project/), on the
Nocturne design system. The original design handoff notes are kept in
[`project/HANDOFF.md`](project/HANDOFF.md) and the conversation that produced
the design in [`chats/`](chats/).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # model unit tests
npm run build      # static bundle in dist/
```

`dist/` is plain static files: drop it on Vercel, Netlify, GitHub Pages or any
static host. On iOS, "Add to Home Screen" installs it as a standalone app.

## What it does

**Team** — your place in the league today and two seasons out, your rank at
each position against the other nine managers, your optimal lineup with the
changes against what you actually have set in Sleeper, your roster with
filters and real usage, and your tradeable assets (rookie picks, NFL-team
correlation, sell window, bench value).

**Trades** — offers simulated on both sides. Your optimal lineup and theirs are
recomputed with the swap applied, and an offer only appears if you gain and
they would plausibly accept. Each one says whether you are buying under
market, paying fair, or overpaying for a lineup jump — and why it works for
them.

**Draft** — the rookie board ranked by Fit Score for the specific pick you
select, a search across Sleeper's whole catalog for anyone not on it, the
reasoning behind the top recommendation, and pick-movement offers
(trade up to consolidate, trade down to collect swings). While a draft is
live it re-reads picks every 20 seconds and recomputes everything.

**League** — all ten teams under four orderings: strength today, future value,
Fit today and Fit two years out (a team's Fit being the average of its optimal
starters). Each row carries its window, weighted age, weakest position and pick
capital, and flags how many Fit points the roster sheds as it ages. Below it, the
best players in the league through three lenses — how good he is, how much he
would help *you*, and who he becomes in two years. Tap a team for their
positional strengths, best assets and how to trade with them.

**You** — the strategy selector (Balanced / Safe floor / Upside) genuinely
rewrites the Fit Score weights and reorders the board, plus the positional
premium derived from your league's real scoring rules.

Redraft leagues drop everything about the future: no pick capital, no age
curve, no sell window, no future-value column.

## The Fit Score

`Fit = Σ wᵢ × metricᵢ`, over nine metrics, each independently normalised to
0..1 so the breakdown in a player sheet reads as *metric × weight =
contribution*:

| Metric | Where it comes from |
| --- | --- |
| Player quality | market value blended 60/40 with real production, quantile-mapped into the same unit |
| Positional need | your starters at that position, ranked against every other roster |
| Value vs. availability | board position against the pick you are actually making |
| Floor | snaps (62%) and volume (38%), then discounted for injury and depth-chart demotion |
| Explosiveness | yards per touch (70%) and long-touchdown rate (30%) — both as within-position percentiles |
| Floor AND ceiling | the geometric mean of the two, so the lopsided player cannot average his way through |
| Age curve | a prime *window* per position; a star holds it 1.5 years longer and decays 45% slower |
| NFL team correlation | stacking a QB adds; sharing a backfield subtracts — measured inside the owner's roster |
| Red zone and TDs | share of the chances inside the 20, plus **expected** touchdowns per game |

Two of those deserve their own note.

**Expected touchdowns.** Scored touchdowns carry luck with them, and luck does
not repeat. So each season is fitted by least squares, per position, over the
opportunities that produced it — `td ≈ b₁·(red-zone touches) + b₂·(the rest)` —
and the Fit uses the expectation rather than the result. The coefficients come
out of the same feed being scored, so there is no invented constant and no
second source to reconcile. Where the sample cannot support a fit, no number is
published at all.

**Three seasons, not one.** A single year is a small sample: one injury or a new
coordinator moves every number in it. The player's own rates are blended across
three seasons at 50/30/20 toward the present, with a season he missed having its
weight redistributed rather than counted as a bad year — and with older seasons
fading further the longer he is past his prime. Shares stay on the most recent
season, because they are measured against today's offence and do not travel
backwards.

A player you already own is scored on renormalised weights with the need term
removed — you cannot fill your own hole, and leaving it in grades your whole
roster a flat C. Redraft leagues reshape the weights again: what gets paid this
Sunday goes up, what only pays with time goes down.

## Data sources

| Source | What it provides |
| --- | --- |
| [Sleeper API](https://docs.sleeper.com/) | league, managers, rosters, draft order, picks, traded picks, NFL catalog, prior-season stats |
| [FantasyCalc](https://fantasycalc.com/) | dynasty values from millions of real manager trades, requested in your league's own format (superflex, team count, PPR) and joined by `sleeperId` |

Both feeds degrade loudly rather than silently faking numbers: if the market
is unreachable the app says so and falls back to its own ADP-and-age model,
and the same goes for usage.

## Layout

```
src/
  api/         Sleeper client and the API's shapes
  model/       the engine — scoring, lineup solver, pick capital, trade engine
  state/       useApp: session, live loading, draft polling, photo overrides
  screens/     one file per tab, plus the two detail sheets
  ui/          design-system primitives and style helpers
  styles/      Nocturne tokens, verbatim from the design system
  test/        league fixture and the model tests
```

The model is a pure function of live data: nothing is cached between renders,
so a roster move, a completed pick or a refreshed market re-derives every
number on screen. That is what keeps the trade offers honest.

## Notes

- Read-only. The app never writes to Sleeper; "Propose" copies the terms for
  you to send in the Sleeper app yourself.
- Session and custom player photos live in `localStorage`; photos are
  square-cropped to 160px before storing so a camera-roll image cannot blow
  the quota.
- The NFL player catalog is several MB. It is fetched once per session and
  held in memory, which is why the first load takes a moment.
