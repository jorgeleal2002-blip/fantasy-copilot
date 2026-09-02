import type { SfxName } from '../ui/sfx';
import type { MockPick } from './types';

/**
 * How deep a pick has to be to count as a reach.
 *
 * Measured, not chosen — and re-measured, because the room it was measured in
 * no longer exists. It used to be 15, on a bot that re-sorted the next
 * twenty-five names by need-weighted trade value and drew almost evenly from
 * the top five of that: its picks came from an average of 7.6 places down the
 * board with spikes past 20, so 15 caught the spikes and nothing else.
 *
 * That bot was replaced for being unrealistic, and the spikes went with it.
 * The draw is now geometric over the next six names in board order, and across
 * a played-out draft the places land
 *
 *     #1 × 67   #2 × 27   #3 × 16   #4 × 12   #5 × 6   #6 × 7
 *
 * At 15 the sound could never fire again. At 6 it is the tail — seven times in
 * a full draft, every one of them the deepest name anybody took — which is
 * about what 15 used to catch, and the loudest thing in the set stays rare.
 */
export const REACH = 6;

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
/** Three of the same position in a row is a run, and a run is the thing a
 *  draft room reacts to out loud. Three, not two: two is a coincidence. */
export const RUN = 3;

export function sfxFor(pick: MockPick, suggested: string[], before: MockPick[] = []): SfxName {
  // You took somebody. The one unambiguously good thing that happens in here.
  if (pick.mine) return 'coin';
  const pos = pick.player?.pos;
  // A kicker or a team defence came off the board.
  if (pos === 'K' || pos === 'DEF') return 'pipe';
  // Somebody took a player the app had just told you to take.
  if (pick.player && suggested.indexOf(pick.player.id) >= 0) return 'womp';
  // A reach: taken from well down the board, ahead of better players.
  if (pick.boardAt >= REACH) return 'boom';
  /* A run: this pick and the two before it, all the same position. It is the
   * only thing on this list that is about the shape of the draft rather than
   * about one pick, and it is the one that changes what you should do next —
   * three backs gone in a row is the room telling you the position is drying
   * up. Three hits on a drum for three of a kind. */
  if (pos && before.length >= RUN - 1
    && before.slice(-(RUN - 1)).every(p => p.player?.pos === pos)) return 'tung';
  return 'tick';
}
