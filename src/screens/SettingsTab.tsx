import { liveEnabled } from '../api/live';
import { lastSound, setSoundOn, soundOn, stopBootSound, testSound } from '../ui/boot-sound';
import { ACCENT, BAD, GOOD, METRIC_LABEL, MID, STRATS, StratKey } from '../model/constants';
import { clamp } from '../model/math';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { Meter, SERIES, markFor } from '../ui/charts';
import { Card, Screen, Segmented, type SegOption } from '../ui/primitives';
import { useState } from 'react';
import { cardNote, cardTitle, dim, ellipsis } from '../ui/styles';

const STRAT_OPTIONS: SegOption<StratKey>[] =
  (Object.keys(STRATS) as StratKey[]).map(k => ({ key: k, label: STRATS[k].label }));

export function SettingsTab({ app, m }: { app: App; m: Model }) {
  const strat = STRATS[app.strat];
  const sc = m.league.scoring_settings || {};
  const settings = m.league.settings || {};

  const rules = [
    { label: 'Reception', value: (sc.rec || 0) + ' pts' },
    { label: 'TE bonus', value: '+' + (sc.bonus_rec_te || 0) + ' per catch' },
    { label: 'Rushing first down', value: '+' + (sc.rush_fd || 0) },
    { label: 'Receiving first down', value: sc.rec_fd ? '+' + sc.rec_fd : 'no points' },
    { label: 'Pass TD / yard', value: (sc.pass_td || 4) + ' / ' + (sc.pass_yd || 0.04) },
    { label: 'Startable QBs', value: m.sflx ? '2 (superflex)' : '1' },
    { label: 'Taxi / keepers', value: (settings.taxi_slots || 0) + ' taxi · ' + (settings.max_keepers || 0) + ' keepers' },
    { label: 'Rookie draft', value: (settings.draft_rounds || 0) + ' rounds · FAAB ' + (settings.waiver_budget || 0) },
  ];

  return (
    <Screen>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 13,
        background: 'var(--color-surface)', borderRadius: 13, padding: 14,
      }}>
        <div style={{
          width: 46, height: 46, flex: 'none', borderRadius: '50%', overflow: 'hidden',
          border: '1px solid var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 600, color: 'var(--color-accent)',
        }}>
          {m.me.avatar
            ? <img src={m.me.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : m.me.initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em', ...ellipsis }}>{m.me.teamName}</div>
          <div style={{ fontSize: 12, color: dim(0.45), marginTop: 2, ...ellipsis }}>{m.league.name}</div>
        </div>
      </div>

      {/* Directly under the account, because "which of these teams is mine"
          is an account question — and when it is wrong every other screen is
          empty, so it cannot sit below the weights and the league rules. */}
      <TeamPicker app={app} m={m} />

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => void app.switchLeague()}
          className="btn btn-primary"
          style={{ flex: 1, borderRadius: 10, minHeight: 42 }}
        >
          Change league
        </button>
        <button
          type="button"
          onClick={app.logout}
          className="btn btn-secondary"
          style={{ flex: 1, borderRadius: 10, minHeight: 42 }}
        >
          Sign out
        </button>
      </div>

      <SoundToggle />

      <div>
        <div style={{
          fontSize: 10.5, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.4), marginBottom: 9,
        }}>
          Algorithm strategy
        </div>
        <Segmented options={STRAT_OPTIONS} value={app.strat} onChange={app.setStrat} />
        <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5), marginTop: 10, textWrap: 'pretty' }}>
          {strat.copy}
        </div>
      </div>

      <Card>
        <div style={{ ...cardTitle, marginBottom: 4 }}>Fit Score weights</div>
        <div style={{ fontSize: 11.5, color: dim(0.45), marginBottom: 12 }}>Fit = Σ wᵢ × metricᵢ</div>
        {/* Heaviest first, scaled against this profile's own largest weight:
            ordered by size, the chart answers "what is this profile actually
            buying?" without the reader ranking nine numbers by eye. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...m.metricKeys].sort((a, b) => strat.w[b] - strat.w[a]).map(k => (
            <div key={k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                <span style={{ color: strat.w[k] ? undefined : dim(0.4) }}>{METRIC_LABEL[k]}</span>
                <span style={{ color: strat.w[k] ? ACCENT : dim(0.4) }}>{Math.round(strat.w[k] * 100)}%</span>
              </div>
              <Meter
                pct={strat.w[k] / Math.max(...m.metricKeys.map(x => strat.w[x])) * 100}
                color={SERIES}
                height={5}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div style={{ ...cardTitle, marginBottom: 2 }}>Your scoring changes value</div>
        {/* Be exact about what this drives. With the market feed up, prices come
            from it — asked for this league's format, but not for its every
            bonus — and this premium is the model that takes over if it drops.
            Claiming it sets the values outright would be flattering and wrong. */}
        <div style={{ ...cardNote, marginBottom: 12 }}>
          {app.marketState === 'ok'
            ? `From ${m.league.name}'s real rules. The market prices `
              + `${m.isDynasty ? 'dynasty' : 'redraft'}, ${m.sflx ? 'superflex' : '1QB'}, `
              + `${m.teamCount} teams and ${sc.rec || 0} per reception; everything else here — `
              + 'TE premium, first downs, passing scoring — is applied on top of it, on both '
              + 'sides of every trade.'
            : `Derived from ${m.league.name}'s real rules — and with no market feed right now, `
              + 'it is what every value on screen is built from.'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {m.multInfo.map(mi => {
            const color = mi.mult >= 1.05 ? GOOD : mi.mult <= 0.9 ? BAD : MID;
            return (
              <div key={mi.pos}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 5,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', color: ACCENT }}>{mi.pos}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color }}>×{mi.mult.toFixed(2)}</span>
                </div>
                {/* The reference is ×1.00 — no premium. Without it the bar only
                    says "some multiplier"; with it, it says which side of
                    neutral this position falls on and by how far. */}
                <Meter
                  pct={clamp(mi.mult / 1.4, 0.05, 1) * 100}
                  color={markFor(mi.mult >= 1.05 ? 'good' : mi.mult <= 0.9 ? 'bad' : 'mid')}
                  mark={100 / 1.4}
                  markLabel="no premium (×1.00)"
                  height={7}
                />
                <div style={{ ...cardNote, fontSize: 10.5, marginTop: 5 }}>{mi.why}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <div style={{ ...cardTitle, marginBottom: 10 }}>Rules read from your league</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }}>
              <span style={{ color: dim(0.5) }}>{r.label}</span>
              <span style={{ textAlign: 'right' }}>{r.value}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Which account the app is signed in as, and which roster it matched
          it to. When "your team" comes up empty this is the one fact that
          separates a broken match from a genuinely empty roster, and it saves
          a round trip to find out. */}
      {/* Whether shared drafting is switched on at all. Without it the room
          button simply is not there, which looks identical to a broken feature
          from the outside — this is the one line that tells the two apart. */}
      <div style={{ ...cardNote, textAlign: 'center', fontSize: 10.5 }}>
        Build {__BUILD__} UTC
        <br />
        {liveEnabled()
          ? 'Shared draft rooms: on'
          : 'Shared draft rooms: off — set VITE_RTDB_URL (see README)'}
      </div>

      <div style={{ height: 8 }} />
    </Screen>
  );
}

/**
 * Which of these teams is yours.
 *
 * The app infers it from the account you signed in with, which is right until
 * it is not: plenty of people are in a league under a different handle than
 * the one they typed, and then every number derived from "your team" comes
 * back empty while the rest of the league reads fine. A deliberate answer
 * beats an inferred one, so this lets you say it outright — and it is
 * remembered per league, because the answer differs from one to the next.
 */
function TeamPicker({ app, m }: { app: App; m: Model }) {
  const [open, setOpen] = useState<'team' | 'who' | null>(null);
  const picked = app.myRosterId != null;
  const mine = m.leagueRows.find(r => r.isMe);

  return (
    <Card>
      <div style={{ ...cardTitle, marginBottom: 8 }}>This account</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Row label="Signed in as" value={m.me.name} />
        <Row
          label="Your team here"
          value={m.foundMyTeam
            ? (mine?.name || m.me.teamName) + ' · ' + m.myPlayers.length + ' players'
            : 'no roster matched'}
          bad={!m.foundMyTeam}
        />
        {picked ? <Row label="Chosen" value="by hand, not from the account" /> : null}
      </div>

      <div style={{ display: 'flex', gap: 14, paddingTop: 10 }}>
        <button
          type="button"
          onClick={() => { setOpen(open === 'team' ? null : 'team'); }}
          aria-expanded={open === 'team'}
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: 0 }}
        >
          {open === 'team' ? 'Close' : m.foundMyTeam ? 'Not your team? ›' : 'Pick your team ›'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(open === 'who' ? null : 'who'); }}
          aria-expanded={open === 'who'}
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: 0 }}
        >
          {open === 'who' ? 'Close' : 'Switch account ›'}
        </button>
      </div>

      {/* More than one person uses a phone. Everyone who has signed in here is
          one tap away, so the second person does not have to type a username
          from memory or sign the first one out to look at their own team. */}
      {open === 'who' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
          {app.accounts.map(a => {
            const current = a.username.toLowerCase() === m.me.name.toLowerCase();
            return (
              <div
                key={a.username}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: current ? 'rgba(145,132,217,.14)' : 'transparent',
                  borderRadius: 9,
                }}
              >
                <button
                  type="button"
                  disabled={current}
                  onClick={() => { app.switchAccount(a); setOpen(null); }}
                  className="row-tap"
                  style={{
                    flex: 1, minWidth: 0, font: 'inherit', fontSize: 13, textAlign: 'left',
                    cursor: current ? 'default' : 'pointer', background: 'transparent',
                    border: 0, borderRadius: 9, padding: '9px 10px', color: 'inherit',
                  }}
                >
                  <span style={ellipsis}>{a.username}</span>
                </button>
                {current ? (
                  <span style={{ flex: 'none', fontSize: 11, color: ACCENT, paddingRight: 10 }}>signed in</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => app.forgetAccount(a.username)}
                    className="btn btn-ghost"
                    style={{ flex: 'none', fontSize: 11, padding: '0 10px 0 0', color: dim(0.4) }}
                  >
                    Forget
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={app.logout}
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '9px 0 0' }}
          >
            Add another account ›
          </button>
        </div>
      ) : null}

      {open === 'team' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
          {m.leagueRows.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => { app.setMyRoster(r.id); setOpen(null); }}
              className="row-tap"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                font: 'inherit', fontSize: 13, textAlign: 'left', cursor: 'pointer',
                background: r.isMe ? 'rgba(145,132,217,.14)' : 'transparent',
                border: 0, borderRadius: 9, padding: '9px 10px', color: 'inherit',
              }}
            >
              <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{r.name}</span>
              <span style={{ flex: 'none', fontSize: 11, color: r.isMe ? ACCENT : dim(0.4) }}>
                {r.isMe ? 'yours' : (r.now > 0 ? 'drafted' : 'no roster')}
              </span>
            </button>
          ))}
          {picked ? (
            <button
              type="button"
              onClick={() => { app.setMyRoster(null); setOpen(null); }}
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '9px 0 0' }}
            >
              Go back to matching it from my account
            </button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Row({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }}>
      <span style={{ color: dim(0.5) }}>{label}</span>
      <span style={{ textAlign: 'right', color: bad ? BAD : undefined }}>{value}</span>
    </div>
  );
}


/**
 * The opening sound, and the way out of it.
 *
 * Thirteen seconds on every launch is a lot to hand somebody with no way to
 * stop it, and the person who asked for the sound is not necessarily everyone
 * who opens the app. Turning it off silences whatever is playing right now as
 * well as every launch after — a switch that only takes effect next time reads
 * as a broken switch.
 */
function SoundToggle() {
  const [on, setOn] = useState(soundOn);
  const [tried, setTried] = useState('');
  return (
    <div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13 }}>Sound on open</div>
        <div style={{ fontSize: 11.5, color: dim(0.45), marginTop: 2 }}>
          Plays when the app loads, or at your first tap if the browser holds it back.
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Sound on open"
        onClick={() => {
          const next = !on;
          setOn(next);
          setSoundOn(next);
          if (!next) stopBootSound();
        }}
        className={'btn ' + (on ? 'btn-primary' : 'btn-secondary')}
        style={{ flex: 'none', borderRadius: 10, minWidth: 62, minHeight: 34 }}
      >
        {on ? 'On' : 'Off'}
      </button>
    </div>

    {/* A tap is a gesture, so this cannot be refused by the autoplay rules.
        Silence here means the phone or the file, not the browser. */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 9 }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          setTried('…');
          void testSound().then(r => setTried(
            r !== 'ok'
              ? (r === 'blocked'
                ? 'The browser held it back. Reload and tap anywhere.'
                : 'The sound file did not load. Close the app fully and reopen it.')
              // The test ignores the switch, so it plays while the app stays
              // quiet on open — which is a confusing pair unless it is said.
              : on
                ? 'Playing. If you hear nothing, check the side switch and the volume.'
                : 'Playing — but "Sound on open" is Off, so it stays quiet at launch.',
          ));
        }}
        style={{ flex: 'none', borderRadius: 10, minHeight: 34, fontSize: 12 }}
      >
        Test sound
      </button>
      {tried ? (
        <div style={{ fontSize: 11.5, color: dim(0.5), minWidth: 0 }}>{tried}</div>
      ) : null}
    </div>

    {/* What happened the last time it tried, on its own, without anybody
        watching. This is the line that ends an argument about why it is
        silent — it is the app's own account rather than a guess. */}
    <div style={{ fontSize: 11, color: dim(0.38), marginTop: 7 }}>
      {(() => {
        const l = lastSound();
        if (!l) return 'Last attempt: none recorded yet.';
        const text = l.outcome === 'played' ? 'it played'
          : l.outcome === 'waiting' ? 'held back, waiting for a tap'
            : l.outcome === 'off' ? 'skipped, the switch above is off'
              : l.outcome === 'blocked' ? 'the browser refused it'
                : 'the sound file did not load';
        return 'Last attempt: ' + text + '.';
      })()}
    </div>
    </div>
  );
}
