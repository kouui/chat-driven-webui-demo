// Hesitation watcher (spec j): fires once when the user has done nothing for `ms`.
// Activity = pointer, key, focus, scroll, wheel or touch. It re-arms on the next activity.

const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'focusin', 'scroll', 'wheel', 'touchstart'] as const;

export function watchHesitation(o: { ms?: number; canHint(): boolean; fire(): void; /** Activity while a hint is running (its whole lifetime) cancels it. */ cancel?(): void }): () => void {
  const ms = o.ms ?? 8000;
  let last = performance.now();
  let timer = 0;
  let fired = false;

  const arm = (delay: number): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(check, delay);
  };
  function check(): void {
    const idle = performance.now() - last;
    if (idle < ms - 20) return arm(ms - idle);
    if (!fired && !document.hidden && o.canHint()) {
      fired = true;
      o.fire();
    }
    if (!fired) arm(ms); // not eligible right now (a page is open, ...): look again later
  }
  const onActivity = (): void => {
    last = performance.now();
    o.cancel?.();
    if (fired) {
      fired = false;
      arm(ms);
    }
  };
  EVENTS.forEach((e) => document.addEventListener(e, onActivity, { capture: true, passive: true }));
  arm(ms);
  return () => {
    window.clearTimeout(timer);
    EVENTS.forEach((e) => document.removeEventListener(e, onActivity, true));
  };
}
