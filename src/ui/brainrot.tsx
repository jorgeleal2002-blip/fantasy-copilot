import { useEffect, useRef, useState } from 'react';
import type { SfxName } from '../model/sfx-map';

/**
 * The eight characters. They used to be the names of eight sound files; the
 * sounds are gone and the cards stayed, so the names live here now, with the
 * only thing that still reads them.
 */
export type ClipName =
  | 'siu' | 'gotthis' | 'patapim' | 'bombardino'
  | 'brainrot' | 'chillguy' | 'chimpanzini' | 'ballerina';

/**
 * The card that bursts onto the board when a clip plays.
 *
 * A NOTE ON WHAT IS BEING DRAWN. The game this is borrowed from shows the
 * character. The characters are somebody else's drawings and none of them are
 * in this repository, so what is drawn instead is each one's own colour, its
 * own mark and its own name in type big enough to read across a room — and the
 * motion is tuned per character, which is most of what makes one of these read
 * as itself anyway. Drop a real picture in `art` and it takes over the mark;
 * nothing else has to change.
 *
 * The card never intercepts a tap. It appears over the board while you are
 * looking at the board, and the Draft buttons stay live underneath it.
 */
export interface Look {
  /** what it says, in the app's loudest type */
  label: string;
  /** the stand-in for the character until there is a picture of one */
  mark: string;
  /** its colour, which is what the eye actually recognises at this size */
  tint: string;
  /**
   * How it moves. Each is a different entrance, because a shark, a ballerina
   * and a bomber crocodile do not arrive the same way.
   */
  move: 'slam' | 'spin' | 'swim' | 'twirl' | 'strut' | 'drop';
  /** an image, once there is one — it replaces the mark */
  art?: string;
}

/**
 * The eight, and how each one comes in.
 *
 * The Italian brainrot clip is left under its own name rather than guessed at:
 * the file says what it is and no more, and a card naming the wrong character
 * would be worse than one naming none.
 */
export const LOOKS: Record<ClipName, Look> = {
  siu:         { label: 'SIUUU',           mark: '⚽️', tint: '#f6d743', move: 'slam' },
  gotthis:     { label: 'I GOT THIS',      mark: '😤', tint: '#8eeded', move: 'strut' },
  patapim:     { label: 'BRR BRR PATAPIM', mark: '🌳', tint: '#8ec9a8', move: 'spin' },
  bombardino:  { label: 'BOMBARDINO',      mark: '🐊', tint: '#5ad17a', move: 'drop' },
  brainrot:    { label: 'ITALIAN BRAINROT', mark: '🦈', tint: '#59a7ff', move: 'swim' },
  chillguy:    { label: 'CHILL GUY',       mark: '😎', tint: '#c9a87c', move: 'strut' },
  chimpanzini: { label: 'CHIMPANZINI',     mark: '🍌', tint: '#f8b36c', move: 'spin' },
  ballerina:   { label: 'BALLERINA',       mark: '🩰', tint: '#f6a9c0', move: 'twirl' },
};

/**
 * Which moment brings out which card.
 *
 * The three that repeat — your pick, your turn, and being sniped — hold two
 * each, because one card shown fifteen times stops being a surprise somewhere
 * around the fourth, and two taking turns is the cheapest fix there is.
 * `tick` and `pipe` are deliberately absent: those two fire over and over, and
 * a card on every one of them is not a draft room, it is a wall.
 */
const CARDS: Partial<Record<SfxName, ClipName[]>> = {
  coin: ['siu', 'gotthis'],             // you took somebody
  horn: ['patapim', 'bombardino'],      // you are on the clock
  womp: ['brainrot', 'chillguy'],       // they took the one you were told to take
  boom: ['chimpanzini'],                // a reach, from well down the board
  tung: ['ballerina'],                  // three of a position in a row
  done: ['gotthis'],                    // the board is drafted out, and that is your team
};

/** How many times each moment has come up, so its cards take turns. */
const turn: Partial<Record<SfxName, number>> = {};

/** The card for this moment, or null for the moments that do not get one. */
export function cardFor(name: SfxName): ClipName | null {
  const list = CARDS[name];
  if (!list || !list.length) return null;
  const n = turn[name] || 0;
  turn[name] = n + 1;
  return list[n % list.length];
}

/** Long enough to read across a room and short enough not to sit on the board. */
const HOLD_MS = 1450;

/**
 * Show whichever clip last played.
 *
 * Keyed by a counter rather than by the clip's name: the same character can
 * land twice in a row — two of your picks, back to back at a turn — and React
 * reuses an element whose key has not changed, so the second one would appear
 * without ever playing its entrance.
 */
export function Brainrot({ clip, at }: { clip: ClipName | null; at: number }) {
  const [showing, setShowing] = useState<{ clip: ClipName; at: number } | null>(null);
  const timer = useRef(0);

  useEffect(() => {
    if (!clip || !at) return undefined;
    setShowing({ clip, at });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShowing(null), HOLD_MS);
    return () => window.clearTimeout(timer.current);
  }, [clip, at]);

  if (!showing) return null;
  const look = LOOKS[showing.clip];
  return (
    <div className="br-stage" aria-hidden="true">
      <div className={'br-card br-' + look.move} key={showing.at} style={{ '--br': look.tint } as React.CSSProperties}>
        <div className="br-burst" />
        {look.art
          ? <img className="br-art" src={look.art} alt="" />
          : <div className="br-mark">{look.mark}</div>}
        <div className="br-name">{look.label}</div>
      </div>
    </div>
  );
}
