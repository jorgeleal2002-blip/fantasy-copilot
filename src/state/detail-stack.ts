/** How the stack of open sheets moves.
 *
 * Kept apart from the hook so the rule can be tested on its own: a player
 * opened from a rival's team has to step back to that team, and only then to
 * the tab underneath. */
export function nextDetailStack(stack: string[], id: string | null): string[] {
  if (id === null) return stack.slice(0, -1);
  // Re-opening whatever is already on top is a no-op, so a double tap cannot
  // bury a sheet under a copy of itself and cost two taps to leave.
  if (stack[stack.length - 1] === id) return stack;
  return [...stack, id];
}

export function topDetail(stack: string[]): string | null {
  return stack.length ? stack[stack.length - 1] : null;
}
