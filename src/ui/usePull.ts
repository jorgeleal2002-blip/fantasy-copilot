import { useCallback, useEffect, useRef, useState } from 'react';
import { type Pull, edgeAt, type PullEdge, pullArmed, pullFrom } from '../model/pull';

/**
 * The drag half of pull-to-refresh: listeners, state, and the hand-off.
 *
 * The listeners are attached by hand rather than through React's props because
 * React registers touchmove passively, and a passive listener cannot call
 * preventDefault — which is the whole job here. Without it the browser scrolls
 * its own rubber band under the gesture and the pull fights it.
 *
 * preventDefault is called only once a pull is actually running, so every drag
 * that is not one stays an ordinary scroll.
 */
export function usePullToRefresh(onRefresh?: () => void | Promise<void>) {
  const [pull, setPullState] = useState<Pull | null>(null);
  const [busy, setBusy] = useState(false);
  // The scroller is held in state, not a ref, so the listeners re-attach if
  // it is ever a different element.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const from = useRef<{ y: number; edge: PullEdge } | null>(null);
  // The pull is mirrored here so that letting go can read it without a state
  // updater: React may run an updater twice, and firing the refresh from
  // inside one would refresh twice under StrictMode.
  const held = useRef<Pull | null>(null);
  const setPull = useCallback((p: Pull | null) => { held.current = p; setPullState(p); }, []);
  // Read inside listeners that are attached once, so they must not close over
  // a stale one.
  const live = useRef({ busy, onRefresh });
  live.current = { busy, onRefresh };

  const ref = useCallback((n: HTMLDivElement | null) => setNode(n), []);

  useEffect(() => {
    if (!node || !onRefresh) return;

    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || live.current.busy || e.touches.length > 1) { from.current = null; return; }
      from.current = { y: t.clientY, edge: edgeAt(node.scrollTop, node.scrollHeight, node.clientHeight) };
    };

    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      const start = from.current;
      if (!t || !start) return;
      const p = pullFrom(start.edge, t.clientY - start.y);
      if (p) e.preventDefault();
      setPull(p);
    };

    const up = () => {
      const start = from.current;
      from.current = null;
      if (!start) return;
      if (!pullArmed(held.current)) { setPull(null); return; }
      // The pull is left where it was released while the refresh runs, so the
      // spinner has somewhere to sit; springing back first would flash it away
      // mid-update.
      setBusy(true);
      void Promise.resolve(live.current.onRefresh?.()).finally(() => {
        setBusy(false);
        setPull(null);
      });
    };

    node.addEventListener('touchstart', down, { passive: true });
    node.addEventListener('touchmove', move, { passive: false });
    node.addEventListener('touchend', up, { passive: true });
    node.addEventListener('touchcancel', up, { passive: true });
    return () => {
      node.removeEventListener('touchstart', down);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', up);
      node.removeEventListener('touchcancel', up);
    };
  }, [node, onRefresh]);

  return { ref, pull, busy };
}
