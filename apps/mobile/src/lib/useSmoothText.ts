import { useEffect, useRef, useState } from 'react';

/** Steady reveal pace, in characters per second. */
const BASE_CPS = 45;
/** Catch up to a burst without jumping several words at once. */
const MAX_CPS = 100;
const MAX_LAG_S = 1.2;
/** ~30 updates a second is smooth for text and light on re-renders. */
const FRAME_MS = 33;
/** Once the whole answer has arrived, whatever is left is shown within this time: the data waits on it. */
const FINISH_MS = 300;

/**
 * Streamed text, revealed smoothly. Network chunks arrive in bursts; this
 * releases them at an even pace (faster when behind), so the answer grows like
 * typing instead of jumping. With `complete` (the answer has fully arrived) the
 * rest is shown within FINISH_MS rather than at typing speed. With `animate`
 * false (answers loaded from history) the text appears at once. `done` turns
 * true when everything is on screen.
 */
export function useSmoothText(target: string, animate: boolean, complete = false): { text: string; done: boolean } {
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
    // A fixed share per frame, so the rest lands within FINISH_MS however long it is.
    const finishPerFrame = complete ? ((target.length - shownRef.current.length) * FRAME_MS) / FINISH_MS : 0;
    const tick = () => {
      const now = Date.now();
      const elapsed = now - last;
      if (elapsed >= FRAME_MS) {
        last = now;
        const at = shownRef.current.length;
        const step = complete
          ? (finishPerFrame * elapsed) / FRAME_MS
          : (Math.min(MAX_CPS, Math.max(BASE_CPS, (target.length - at) / MAX_LAG_S)) * elapsed) / 1000;
        let end = Math.min(target.length, at + Math.max(1, Math.ceil(step)));
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
  }, [target, animate, complete]);

  return { text: shown, done: shown.length >= target.length };
}
