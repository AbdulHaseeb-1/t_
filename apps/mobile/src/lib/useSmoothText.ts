import { useEffect, useRef, useState } from 'react';

/** Steady reveal pace, in characters per second. */
const BASE_CPS = 45;
/** Catch up to a burst without jumping several words at once. */
const MAX_CPS = 100;
const MAX_LAG_S = 1.2;
/** ~30 updates a second is smooth for text and light on re-renders. */
const FRAME_MS = 33;

/**
 * Streamed text, revealed smoothly. Network chunks arrive in bursts; this
 * releases them at an even pace (faster when behind), so the answer grows like
 * typing instead of jumping. With `animate` false (answers loaded from history)
 * the text appears at once. `done` turns true when everything is on screen.
 */
export function useSmoothText(target: string, animate: boolean): { text: string; done: boolean } {
  const [shown, setShown] = useState(() => (animate ? '' : target));
  const shownRef = useRef(shown);
  const animated = useRef(animate);

  useEffect(() => {
    const set = (s: string) => {
      shownRef.current = s;
      setShown(s);
    };
    if (animate) animated.current = true;
    if (!animated.current) return set(target);
    // The text was replaced (a dropped preamble, a retry): start over.
    if (!target.startsWith(shownRef.current)) set('');
    if (shownRef.current.length >= target.length) return;

    let frame = 0;
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      const elapsed = now - last;
      if (elapsed >= FRAME_MS) {
        last = now;
        const at = shownRef.current.length;
        const cps = Math.min(MAX_CPS, Math.max(BASE_CPS, (target.length - at) / MAX_LAG_S));
        let end = Math.min(target.length, at + Math.max(1, Math.round((cps * elapsed) / 1000)));
        // Never split an emoji's surrogate pair.
        const code = target.charCodeAt(end - 1);
        if (code >= 0xd800 && code <= 0xdbff && end < target.length) end++;
        set(target.slice(0, end));
        if (end >= target.length) return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, animate]);

  return { text: shown, done: shown.length >= target.length };
}
