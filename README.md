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

## Drafting together

The mock draft can be a room: you send a link, your friends walk in, and
everybody picks in turn on the same board. Seats nobody claims are drafted by
the app, and the draft waits at a seat a person is holding rather than picking
for them.

This is the one feature that needs something the app cannot supply itself. A
shared turn has to live somewhere both phones can see, and the app is a static
bundle. **With nothing configured the room simply does not appear** — the older
invite stays, which sends the same board to each of you to draft alone.

Turning it on takes about two minutes and costs nothing:

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Build → **Realtime Database** → Create database. Any region. Start in
   **locked mode**.
3. Under **Rules**, allow reads and writes to rooms only:

   ```json
   {
     "rules": {
       "rooms": {
         "$room": {
           ".read": true,
           ".write": true,
           ".validate": "newData.hasChildren(['seed','leagueId'])"
         }
       }
     }
   }
   ```

   Anyone holding a room code can read and write that room. For a mock draft
   among friends that is the right trade; it is not a place for anything you
   would mind a stranger seeing, and there is nothing personal in a room — a
   seed, a league id, some seat names and a list of player ids.
4. Copy the database URL from the top of that page. It looks like
   `https://your-project-default-rtdb.firebaseio.com`.
5. Locally, put it in `.env`:

   ```
   VITE_RTDB_URL=https://your-project-default-rtdb.firebaseio.com
   ```

   For the deployed copy, add it as a repository **variable** (Settings →
   Secrets and variables → Actions → Variables) named `VITE_RTDB_URL`. A
   variable rather than a secret because the URL is public by design: it ships
   to every browser that loads the app. The database rules are what protect it.

6. **Run the deploy again.** A repository variable is read when the site is
   COMPILED, so adding one does not rebuild anything: Actions → Deploy to
   GitHub Pages → Run workflow. Then open the app, **You → Shared draft rooms
   → Test**. It writes a room, reads it back and deletes it, and names whatever
   went wrong.

### If it asks you to upgrade to a paid plan

Nothing in this setup needs one, and the free Spark plan asks for no card.
Stay on it. **Blaze is the only way any of this could ever bill you**, and
nothing here needs a single thing it adds.

If the console asks anyway, you are somewhere you do not need to be. The three
that catch people:

- **"Create database" a second time.** A project gets one Realtime Database
  free; a second instance is a Blaze feature. The ⋮ menu on the database page
  lists it greyed out, worded as though the database has to be created before
  anything can happen — but yours already exists, and its URL is printed on
  that same screen. Nothing below it needs doing.

  Two items above it in that menu is **Disable database**, which is the one
  destructive thing on the page and sits one thumb-width from the one that
  looks like the way forward. It is not.

  Everything the room needs is on the **Rules** tab of that page, and the Rules
  tab is free.
- **The wrong product.** Cloud Firestore, Storage, Functions and Hosting all
  have their own gates. This app uses **Realtime Database** and nothing else.
- **A different region.** Realtime Database lives in a handful of places —
  Iowa, Belgium, Singapore — and that is the whole list. There is no picking
  one near you unless you happen to live near one of them, and reaching for a
  region outside the default is one of the things that can want a paid plan.

  Take the default. The app builds every request by pasting paths onto whatever
  URL it is handed, so it does not know or care where the database is, and the
  two URL shapes the console hands out — `<name>.firebaseio.com` for the
  default region and `<name>.<region>.firebasedatabase.app` for the others —
  both work unchanged. What the distance costs is tens of milliseconds on a
  pick, against the 420ms the room already leaves between one pick and the
  next. It is not a thing anybody can feel.

Publishing rules never asks for a plan. Reading and writing never asks for a
plan. If you are being asked, you are not on the path this app needs.

### What it costs

Nothing, by a wide margin, and the design is what keeps it that way.

Measured against the shape the app actually writes — a 12-team, 16-round draft
with all twelve people in the room:

| | used | free allowance |
| --- | --- | --- |
| A room at its biggest | 3.2 KB | 1 GB stored |
| One whole draft, all twelve clients | 3.7 MB | 10 GB downloaded a month |
| People connected at once | 12 | 100 |

That is roughly **2,800 complete drafts a month** before the download allowance
is in sight. Two things in the client protect it: a working stream cancels the
polling fallback rather than running beside it, and a backgrounded phone stops
asking entirely — a room left open overnight used to poll about twenty thousand
times with nobody looking.

Stay on the **Spark** plan, which is the default and asks for no card. Do not
upgrade to Blaze: pay-as-you-go is the only way this could ever bill you, and
nothing here needs it.

(The allowances above are Firebase's published Spark limits as I know them;
they are not something this repository can check for you, so glance at the
console's usage tab once if you want to be sure.)

There is no SDK. A room is one small JSON document — the seed, who is in which
seat, and a map of "pick N went to player X" — read and written over plain HTTP
and streamed with the browser's own `EventSource`, falling back to polling when
that connection drops. The mock is a pure function of the seed and that map, so
every phone in the room derives the identical draft, bots included, without any
of it being sent.

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
