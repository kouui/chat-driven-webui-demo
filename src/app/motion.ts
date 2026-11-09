// Motion helpers shared by every choreography (see docs/tasks/002-motion/spec.md).
//
//  * One operation token: the latest user action wins. Everything a sequence starts (WAAPI animations,
//    timers, frame loops, flight callbacks) is bound to the token that was current when it started, and is
//    cancelled (or ignored) as soon as a newer action begins.
//  * WAAPI helpers whose `finished` promise never rejects.
//  * Trigger geometry captured before the DOM changes.

// ---- motion preference (A1) -----------------------------------------------------------------------
//  Precedence: URL `?motion=full|reduced`  >  localStorage `aurea.motion`  >  the OS setting.
//  This module is the single source of truth: `html.motion-reduced`, the CSS, the app's WAAPI/timers and
//  `butterfly.setReducedMotion()` all follow `prefersReducedMotion()`.

export type MotionPref = 'full' | 'reduced' | 'system';
export const MOTION_KEY = 'aurea.motion';

let pref: MotionPref = 'system';
let prefFromUrl = false;
const motionListeners = new Set<(reduced: boolean) => void>();

const osQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
/** What the operating system asks for (live). */
export const osPrefersReduced = (): boolean => !!osQuery()?.matches;

/** The effective setting. 'system' reads the OS live. */
export function prefersReducedMotion(): boolean {
  return pref === 'reduced' ? true : pref === 'full' ? false : osPrefersReduced();
}
export const getMotionPref = (): MotionPref => pref;
/** True when the preference came from the URL (it is not stored, and the notice does not show). */
export const motionFromUrl = (): boolean => prefFromUrl;

export function readStoredMotion(): MotionPref | null {
  try {
    const v = localStorage.getItem(MOTION_KEY);
    return v === 'full' || v === 'reduced' ? v : null;
  } catch {
    return null;
  }
}

function applyMotionClass(): void {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('motion-reduced', prefersReducedMotion());
}

/** Choose the initial preference (URL > stored > OS) and apply it. Call once at start. */
export function initMotionPref(search: string = typeof location !== 'undefined' ? location.search : ''): MotionPref {
  const url = new URLSearchParams(search).get('motion');
  prefFromUrl = url === 'full' || url === 'reduced';
  pref = prefFromUrl ? (url as MotionPref) : (readStoredMotion() ?? 'system');
  applyMotionClass();
  osQuery()?.addEventListener?.('change', () => {
    if (pref === 'system') notifyMotion();
  });
  return pref;
}

function notifyMotion(): void {
  applyMotionClass();
  const r = prefersReducedMotion();
  motionListeners.forEach((fn) => fn(r));
}

/** The user's choice (toggle / notice button). `persist`: remember it in localStorage. */
export function setMotionPref(next: MotionPref, persist = true): void {
  const before = prefersReducedMotion();
  pref = next;
  prefFromUrl = false;
  if (persist) {
    try {
      if (next === 'system') localStorage.removeItem(MOTION_KEY);
      else localStorage.setItem(MOTION_KEY, next);
    } catch {
      /* storage may be blocked */
    }
  }
  applyMotionClass();
  if (before !== prefersReducedMotion() || next !== 'system') notifyMotion();
}

export function onMotionChange(fn: (reduced: boolean) => void): () => void {
  motionListeners.add(fn);
  return () => motionListeners.delete(fn);
}

// ---- motion tempo ---------------------------------------------------------------------------------
//  ONE global tempo: 1 = design speed, 0.5 (the default) = every choreography time is twice as long.
//  Precedence: URL `?speed=<0.25..2>` (also remembered in localStorage `aurea.speed`)  >  localStorage  >  DEFAULT_TEMPO.
//  Every choreography duration / delay in the app goes through `ms()` (JS) or `var(--tm)` (CSS: `calc(220ms * var(--tm))`,
//  --tm = 1 / --tempo, both set on <html>). The butterfly gets the same number through `setTimeScale`. Reduced motion is NOT
//  affected: its <=150ms cross-fades use REDUCED_MS and `html.motion-reduced { --tm: 1 }`.
//  Numbers passed to the butterfly (`minDuration`, `maxDuration`) stay DESIGN ms: the butterfly scales them itself.

export const TEMPO_KEY = 'aurea.speed';
export const DEFAULT_TEMPO = 0.5;
export const TEMPO_MIN = 0.25;
export const TEMPO_MAX = 2;

let tempo = DEFAULT_TEMPO;
const tempoListeners = new Set<(tempo: number) => void>();

/** A usable tempo (finite, within 0.25..2), else null. */
export function parseTempo(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= TEMPO_MIN && n <= TEMPO_MAX ? n : null;
}

export const getTempo = (): number => tempo;
/** The tempo that applies right now: reduced motion keeps real time (its short cross-fades are not stretched). */
const effectiveTempo = (): number => (prefersReducedMotion() ? 1 : tempo);
/** A design duration in ms -> the real one at the current tempo. */
export const ms = (designMs: number): number => designMs / effectiveTempo();
/** Real elapsed ms -> design ms (the unit `minDuration` / `maxDuration` and the sweep budgets are in). */
export const designMs = (realMs: number): number => realMs * effectiveTempo();

function applyTempo(): void {
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--tempo', String(tempo));
}

/** Set the tempo (clamped to 0.25..2), publish `--tempo` and tell the listeners (the app forwards it to the butterfly). */
export function setTempo(next: number, persist = false): number {
  tempo = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Number.isFinite(next) ? next : DEFAULT_TEMPO));
  if (persist) {
    try {
      localStorage.setItem(TEMPO_KEY, String(tempo));
    } catch {
      /* storage may be blocked */
    }
  }
  applyTempo();
  tempoListeners.forEach((fn) => fn(tempo));
  return tempo;
}

export function onTempoChange(fn: (tempo: number) => void): () => void {
  tempoListeners.add(fn);
  return () => tempoListeners.delete(fn);
}

/** Choose the initial tempo (URL > stored > default) and apply it. A tempo given by the URL is remembered. Call once at start. */
export function initTempo(search: string = typeof location !== 'undefined' ? location.search : ''): number {
  const url = parseTempo(new URLSearchParams(search).get('speed'));
  if (url !== null) return setTempo(url, true);
  let stored: number | null = null;
  try {
    stored = parseTempo(localStorage.getItem(TEMPO_KEY));
  } catch {
    /* storage may be blocked */
  }
  return setTempo(stored ?? DEFAULT_TEMPO);
}

// ---- operation token ----------------------------------------------------------------------------

let opSeq = 0;
/** Cancel hooks of everything bound to the current token. */
let bound = new Set<() => void>();
/** True while a choreography owns the butterfly's flight (settle() must not start a second focus). */
let claimedBy = 0;

export const currentOp = (): number => opSeq;
export const isCurrent = (op: number): boolean => op === opSeq;

/** A new user action begins: everything bound to older tokens is cancelled; their callbacks become no-ops. */
export function beginOp(): number {
  opSeq++;
  claimedBy = 0;
  const old = bound;
  bound = new Set();
  old.forEach((cancel) => cancel());
  opHooks.forEach((fn) => fn(opSeq));
  return opSeq;
}

/** Hooks run on every `beginOp` (the app binds `guide.cancel()` here: pending reveal / underline / pulse). */
const opHooks = new Set<(op: number) => void>();
export function onOpBegin(fn: (op: number) => void): () => void {
  opHooks.add(fn);
  return () => opHooks.delete(fn);
}

/** The sequence `op` owns the butterfly until `release(op)` (or the next `beginOp`). */
export function claim(op: number): void {
  if (isCurrent(op)) claimedBy = op;
}
export function release(op: number): void {
  if (claimedBy === op) claimedBy = 0;
}
export const isClaimed = (): boolean => claimedBy !== 0 && claimedBy === opSeq;

/** Bind a cancel hook to `op`. Returns false (and runs nothing) when `op` is already stale. */
export function bind(op: number, cancel: () => void): boolean {
  if (!isCurrent(op)) return false;
  bound.add(cancel);
  return true;
}

/** `setTimeout` bound to `op`: never fires after a newer action began. */
export function after(op: number, ms: number, fn: () => void): void {
  if (!isCurrent(op)) return;
  let done = false;
  const id = window.setTimeout(() => {
    done = true;
    bound.delete(cancel);
    if (isCurrent(op)) fn();
  }, ms);
  const cancel = (): void => {
    if (!done) window.clearTimeout(id);
  };
  bound.add(cancel);
}

/** A rAF loop bound to `op`. `step` returns false to stop. */
export function frames(op: number, step: (t: number) => boolean | void): void {
  if (!isCurrent(op)) return;
  let id = 0;
  const cancel = (): void => cancelAnimationFrame(id);
  const tick = (t: number): void => {
    if (!isCurrent(op)) return;
    if (step(t) === false) {
      bound.delete(cancel);
      return;
    }
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  bound.add(cancel);
}

// ---- WAAPI ----------------------------------------------------------------------------------------

export interface Anim {
  /** true = ran to the end, false = cancelled (or a newer action superseded it). Never rejects. */
  finished: Promise<boolean>;
  cancel(): void;
}

const NOOP: Anim = { finished: Promise.resolve(true), cancel: () => {} };

export interface AnimOpts extends KeyframeAnimationOptions {
  /** Keep the animation when a newer action begins (the owner cancels it explicitly). */
  own?: boolean;
  /** Bind to this token (default: the current one). A stale token starts nothing. */
  op?: number;
}

/** `el.animate` that is cancellable, bound to the operation token, and whose `finished` rejection is consumed.
 *  jsdom has no WAAPI: the animation then "finishes" at once. */
export function anim(el: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes, opts: AnimOpts): Anim {
  const { own, op = opSeq, ...timing } = opts;
  if (!own && !isCurrent(op)) return { finished: Promise.resolve(false), cancel: () => {} };
  if (typeof (el as HTMLElement).animate !== 'function') return NOOP;
  const a = (el as HTMLElement).animate(keyframes, timing);
  const cancel = (): void => {
    try {
      a.cancel();
    } catch {
      /* already gone */
    }
  };
  const finished = a.finished.then(
    () => true,
    () => false, // cancel() rejects `finished` with an AbortError: consumed
  );
  if (!own) {
    bound.add(cancel);
    void finished.then(() => bound.delete(cancel));
  }
  return { finished, cancel };
}

/** Cross-fade length in reduced-motion mode. */
export const REDUCED_MS = 150;

// ---- feedback classes ------------------------------------------------------------------------------

const feedbackState = new WeakMap<Element, Map<string, { gen: number; timer: number }>>();

/** Add class `cls` to `el` for `ms` (restarting it when it is already on). Each (element, class) has its own generation,
 *  so an older timer can never remove a newer flash; the removal is a timeout (it does not depend on `animationend`,
 *  which never fires when the animation is switched off). With `op`, a newer action clears it at once. */
export function feedback(el: Element, cls: string, ms: number, op?: number): () => void {
  let per = feedbackState.get(el);
  if (!per) feedbackState.set(el, (per = new Map()));
  const prev = per.get(cls);
  if (prev) window.clearTimeout(prev.timer);
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  const gen = (prev?.gen ?? 0) + 1;
  const clear = (): void => {
    const cur = per!.get(cls);
    if (cur && cur.gen === gen) {
      window.clearTimeout(cur.timer);
      per!.delete(cls);
      el.classList.remove(cls);
    }
  };
  per.set(cls, { gen, timer: window.setTimeout(clear, ms) });
  if (op !== undefined) bind(op, clear);
  return clear;
}

// ---- geometry captured before the DOM changes -----------------------------------------------------

export interface Origin {
  /** Centre of the trigger (viewport px). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The element that was touched, if any (it may be removed by the time the sequence runs). */
  el: Element | null;
}

export type OriginSrc = Element | { x: number; y: number } | null | undefined;

export function captureOrigin(src: OriginSrc): Origin | null {
  if (!src) return null;
  if (src instanceof Element) {
    const r = src.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, el: src };
  }
  return { x: src.x, y: src.y, w: 0, h: 0, el: null };
}

export interface Pt {
  x: number;
  y: number;
}
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const centerOf = (r: { left: number; top: number; width: number; height: number }): Pt => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
