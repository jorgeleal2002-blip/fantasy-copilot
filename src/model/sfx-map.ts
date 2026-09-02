import type { SfxName } from '../ui/sfx';
import type { MockPick } from './types';

/**
 * How deep a pick has to be to count as a reach.
 *
 * Measured, not chosen. A bot draws from the best five on its own list, and its
 * list is the board re-weighted by what it is short of — so most picks land in
 * the first handful and only a need-weighted promotion pulls anybody far down.
 * Across a played-out draft the places came out
 *
 *     4 8 5 3 3 4 2 2 1 22 6 12 2 1 12 4 4 1 21 4 1 5 3 12 14
 *
 * which is a floor of small numbers with occasional spikes. At 8 the boom fires
 * on a fifth of all picks — one every two seconds through the reveal, and it is
 * the loudest thing in the set by three and a half times, so a fifth of the
 * board makes the room unlistenable. At 15 it is those spikes and nothing else:
 * twice in twenty-five picks, about ten times in a full draft, every one of
 * them a pick that genuinely made no sense.
 */
export const REACH = 15;

/**
 * What a revealed pick sounds like.
 *
 * Kept out of the screen and out of the audio so it can be read, argued with
 * and tested on its own: the question "when does the room shout" is a rule
 * about a draft, not a fact about oscillators.
 *
 * The order is the priority. A pick is only ever one thing, and the first true
 * line wins — your own selection is your own selection even if it was also a
 * reach, and a kicker taken sixteenth off the board is funnier as a kicker.
 */
export function sfxFor(pick: MockPick, suggested: string[]): SfxName {
  // You took somebody. The one unambiguously good thing that happens in here.
  if (pick.mine) return 'coin';
  // A kicker or a team defence came off the board.
  const pos = pick.player?.pos;
  if (pos === 'K' || pos === 'DEF') return 'pipe';
  // Somebody took a player the app had just told you to take.
  if (pick.player && suggested.indexOf(pick.player.id) >= 0) return 'womp';
  // A reach: taken from well down the board, ahead of better players.
  if (pick.boardAt >= REACH) return 'boom';
  return 'tick';
}
