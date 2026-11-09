import type { Butterfly, ButterflyMode, PerchOpts, PerchSide } from '../types';
import {
  DEFAULT_GAP,
  arcControlPoints,
  bezier,
  bezierTangent,
  clamp,
  clampToRect,
  distance,
  easeInOutCubic,
  flightDuration,
  isOutsideRect,
  lissajous,
  resolvePerch,
  smoothing,
  tiltFromTangent,
  wobbleEnvelope,
  type Pt,
} from './math';
import { buildButterflyDom } from './svg';

export interface ButterflyOptions {
  reducedMotion?: boolean;
  /** Home point (centre of the stage ring) in viewport coordinates. Called every frame while idle. */
  home?: () => { x: number; y: number };
}

const SAFE_MARGIN = 16;
const WITHIN_MARGIN = 12; // keep the perch point this far inside a `within` rect
const REATTACH_FRAMES = 2; // frames to wait for a re-rendered replacement before going home
const POLL_MS = 250; // reduced motion: how often to check whether a settled butterfly must move
const DRIFT_RADIUS = 36;
const DRIFT_PERIOD = 9; // seconds
const WOBBLE_AMP = 7; // px
const WOBBLE_HZ = 2;
const FADE_MS = 150;
const TILT_MS = 600;
const PERSPECTIVE = 220;

interface Flap {
  freq: number; // Hz
  lo: number; // min rotateY (deg) = widest open
  hi: number; // max rotateY (deg) = most closed
}

const FLAP = {
  flying: { freq: 8, lo: 6, hi: 72 },
  landing: { freq: 3, lo: 20, hi: 62 },
  idle: { freq: 2, lo: 10, hi: 50 },
  listening: { freq: 3.5, lo: 8, hi: 56 },
  perched: { freq: 0.4, lo: 50, hi: 68 }, // ~40% visible width
  tilt: { freq: 0.3, lo: 18, hi: 22 },
  reducedFree: { freq: 0.15, lo: 28, hi: 32 },
  reducedPerched: { freq: 0.15, lo: 58, hi: 60 },
} satisfies Record<string, Flap>;

/** Something the butterfly can fly to / follow. */
interface Target {
  /** Current perch point, or null when the target is gone. */
  point(): Pt | null;
  /** True when the target is scrolled fully out of its `within` container (butterfly fades out). */
  hidden(): boolean;
  /** Try to re-attach to a re-rendered replacement of a removed element. Returns true on success. */
  rebind(): boolean;
}

interface Flight {
  from: Pt;
  target: Target;
  dur: number;
  elapsed: number; // ms
  resolve: (v: boolean) => void;
  /** After landing: stay on this target (perch) or go idle (home). */
  perch: boolean;
  side: PerchSide;
}

interface Perch {
  target: Target;
  side: PerchSide;
  /** Consecutive frames the target has been missing. */
  missed: number;
}

const isSafari =
  typeof navigator !== 'undefined' && /^((?!chrome|chromium|android).)*safari/i.test(navigator.userAgent);

export function createButterfly(layer: HTMLElement, opts: ButterflyOptions = {}): Butterfly {
  layer.classList.add('bf-layer');
  layer.setAttribute('aria-hidden', 'true');

  const dom = buildButterflyDom();
  layer.appendChild(dom.root);

  const mql: MediaQueryList | null =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

  let destroyed = false;
  let reduced = opts.reducedMotion ?? mql?.matches ?? false;
  const flapMode3d = !isSafari;

  const homePoint = (): Pt => {
    if (opts.home) {
      const h = opts.home();
      return { x: h.x, y: h.y };
    }
    return { x: window.innerWidth / 2, y: window.innerHeight * 0.45 };
  };

  // ---- state ----
  let pos: Pt = homePoint();
  let listening = false;
  let flight: Flight | null = null;
  let perch: Perch | null = null;
  let clock = 0; // seconds
  let driftAmp = 0;
  let phase = 0;
  let flap: Flap = { ...FLAP.idle };
  let bobPhase = 0;
  let bobAmp = 3;
  let tilt = 0;
  let sink = 0;
  let lift = 0;
  let scale = 1;
  let perchedFor = 0; // seconds since landing
  let tiltStart = -1; // clock seconds, -1 when not tilting
  let head = 0;
  let flightU = 0;

  let raf = 0;
  let inFrame = false; // true while frame() runs: it alone reschedules itself (single-loop guard)
  let pendingHome = false; // set by update(); consumed after render() so no flight starts mid-frame
  let goal: Pt = { ...pos }; // where the body is heading while not in a flight (for settle detection)
  let hiddenNow = false;
  let pollTimer = 0;
  let last = 0;
  let fadeTimer = 0;
  let moveResolve: ((v: boolean) => void) | null = null;

  // ---- target helpers ----
  const elementTarget = (start: Element, side: PerchSide, within?: Element): Target => {
    let el = start;
    const key = start.getAttribute('data-perch');
    // Ancestors at creation time; used to find the container that survives a re-render.
    const chain: Element[] = [];
    for (let a = start.parentElement; a; a = a.parentElement) chain.push(a);
    let lastPt: Pt | null = null;
    let lastHidden = false;

    const measure = (): void => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0 && lastPt) return;
      let p = resolvePerch(r, side, window.innerWidth, window.innerHeight, SAFE_MARGIN, { gap: DEFAULT_GAP }).point;
      lastHidden = false;
      if (within && within.isConnected) {
        const w = within.getBoundingClientRect();
        if (w.width > 0 || w.height > 0) {
          lastHidden = isOutsideRect(r, w);
          p = clampToRect(p, w, WITHIN_MARGIN);
        }
      }
      lastPt = p;
    };

    return {
      point() {
        if (!el.isConnected) return null;
        measure();
        return lastPt;
      },
      hidden() {
        return el.isConnected && lastHidden;
      },
      rebind() {
        if (!key) return false;
        const anchor = chain.find((a) => a.isConnected);
        if (!anchor || anchor === document.body || anchor === document.documentElement) return false;
        const next = Array.from(anchor.querySelectorAll('[data-perch]')).find(
          (c) => c !== el && c.getAttribute('data-perch') === key && (!within || !within.isConnected || within.contains(c)),
        );
        if (!next) return false;
        el = next;
        chain.length = 0;
        for (let a = next.parentElement; a; a = a.parentElement) chain.push(a);
        return true;
      },
    };
  };
  const pointTarget = (p: Pt): Target => ({ point: () => p, hidden: () => false, rebind: () => false });
  const HOME: Target = { point: () => homePoint(), hidden: () => false, rebind: () => false };
  /** Point of a target, trying a silent re-attach if the element vanished. */
  const resolveTarget = (t: Target): Pt | null => t.point() ?? (t.rebind() ? t.point() : null);

  // ---- flight control ----
  function cancelCurrent(): void {
    if (fadeTimer) {
      clearTimeout(fadeTimer);
      fadeTimer = 0;
    }
    if (moveResolve) {
      const r = moveResolve;
      moveResolve = null;
      r(false);
    }
    if (flight) {
      const f = flight;
      flight = null;
      f.resolve(false);
    }
    dom.fade.style.opacity = '1';
  }

  function land(): void {
    const f = flight;
    if (!f) return;
    flight = null;
    const t = f.target.point();
    if (t) pos = { ...t };
    if (f.perch && t) {
      perch = { target: f.target, side: f.side, missed: 0 };
      perchedFor = 0;
    } else {
      perch = null;
      driftAmp = 0;
    }
    f.resolve(true);
  }

  function startFlight(target: Target, isPerch: boolean, side: PerchSide): Promise<boolean> {
    if (destroyed) return Promise.resolve(false);
    cancelCurrent();
    // Retire the previous perch on every path (also reduced motion), so a removed old
    // target can never cancel this newer flight from the frame loop.
    perch = null;
    pendingHome = false;
    driftAmp = 0;
    const end = target.point() ?? homePoint();

    if (reduced) {
      ensureLoop();
      return new Promise<boolean>((resolve) => {
        moveResolve = resolve;
        dom.fade.style.opacity = '0';
        fadeTimer = window.setTimeout(() => {
          const t = resolveTarget(target); // a same-key replacement made during the fade is re-attached
          pos = t ? { ...t } : homePoint();
          if (isPerch && t) {
            perch = { target, side, missed: 0 };
            perchedFor = 0;
          } else {
            perch = null;
          }
          dom.fade.style.opacity = '1';
          fadeTimer = window.setTimeout(() => {
            fadeTimer = 0;
            const r = moveResolve;
            moveResolve = null;
            r?.(true);
          }, FADE_MS);
        }, FADE_MS);
      });
    }

    // The flight starts from the actual current position.
    const dist = distance(pos, end);
    return new Promise<boolean>((resolve) => {
      flight = {
        from: { ...pos },
        target,
        dur: flightDuration(dist),
        elapsed: 0,
        resolve,
        perch: isPerch,
        side,
      };
      flightU = 0;
      if (document.visibilityState === 'hidden') land();
      else ensureLoop();
    });
  }

  // ---- per-frame update ----
  function flapTarget(): Flap {
    if (tiltStart >= 0 && !reduced) return FLAP.tilt;
    if (reduced) return perch && !flight ? FLAP.reducedPerched : FLAP.reducedFree;
    if (flight) return flightU > 0.8 ? FLAP.landing : FLAP.flying;
    if (perch) return listening ? FLAP.listening : FLAP.perched;
    return listening ? FLAP.listening : FLAP.idle;
  }

  function update(dt: number): void {
    clock += dt;
    let tiltTarget = 0;

    if (flight) {
      const f = flight;
      f.elapsed += dt * 1000;
      const u = clamp(f.elapsed / f.dur, 0, 1);
      flightU = u;
      const e = easeInOutCubic(u);
      const to = resolveTarget(f.target) ?? homePoint();
      const [c1, c2] = arcControlPoints(f.from, to, 0.22);
      const p = bezier(f.from, c1, c2, to, e);
      const tan = bezierTangent(f.from, c1, c2, to, e);
      const tl = Math.hypot(tan.x, tan.y) || 1;
      const env = wobbleEnvelope(u);
      const wob = WOBBLE_AMP * env * Math.sin(2 * Math.PI * WOBBLE_HZ * (f.elapsed / 1000));
      pos = { x: p.x + (-tan.y / tl) * wob, y: p.y + (tan.x / tl) * wob };
      tiltTarget = tiltFromTangent(tan.x, tan.y, 25) * Math.sin(Math.PI * u);
      if (u >= 1) land();
    } else if (perch) {
      perchedFor += dt;
      let t = perch.target.point();
      if (!t && perch.target.rebind()) t = perch.target.point();
      if (!t) {
        // Gone (maybe mid re-render): hold still for a frame or two, then go home.
        if (++perch.missed >= REATTACH_FRAMES) {
          perch = null;
          pendingHome = true;
        }
      } else {
        perch.missed = 0;
        goal = t;
        const k = smoothing(dt, 0.08);
        pos = { x: pos.x + (t.x - pos.x) * k, y: pos.y + (t.y - pos.y) * k };
        tiltTarget = perch.side === 'top-right' ? 10 : perch.side === 'top-left' ? -10 : 0;
      }
    } else if (!moveResolve || !reduced) {
      const h = homePoint();
      let tx = h.x;
      let ty = h.y;
      if (!reduced) {
        driftAmp += (1 - driftAmp) * smoothing(dt, 1.2);
        const d = lissajous(clock, DRIFT_RADIUS * driftAmp, DRIFT_PERIOD);
        tx += d.x;
        ty += d.y;
      }
      goal = { x: h.x, y: h.y };
      const k = smoothing(dt, reduced ? 0.05 : 0.3);
      pos = { x: pos.x + (tx - pos.x) * k, y: pos.y + (ty - pos.y) * k };
    }

    // Fade out while the active target is scrolled out of its `within` container.
    const activeTarget = flight ? flight.target : perch ? perch.target : null;
    const wantHidden = !!activeTarget && activeTarget.hidden();
    if (wantHidden !== hiddenNow) {
      hiddenNow = wantHidden;
      dom.root.style.opacity = wantHidden ? '0' : '1';
    }

    // Wing flap parameters (smoothly follow the target mode).
    const ft = flapTarget();
    const kf = smoothing(dt, 0.12);
    flap = { freq: flap.freq + (ft.freq - flap.freq) * kf, lo: flap.lo + (ft.lo - flap.lo) * kf, hi: flap.hi + (ft.hi - flap.hi) * kf };
    phase += dt * flap.freq * 2 * Math.PI;

    // Body motion.
    const bobTarget = reduced ? 0 : flight ? 2 : perch ? 0.8 : 3;
    bobAmp += (bobTarget - bobAmp) * smoothing(dt, 0.2);
    bobPhase += dt * 2 * Math.PI * (flight ? flap.freq : perch ? 0.4 : 0.31);
    const sinkTarget = perch && !flight && perchedFor > 0.12 ? 4 : 0;
    sink += (sinkTarget - sink) * smoothing(dt, 0.18);
    const liftTarget = listening && !flight && !reduced ? -6 : 0;
    lift += (liftTarget - lift) * smoothing(dt, 0.25);
    const scaleTarget = perch && !flight ? 0.78 : 1;
    scale += (scaleTarget - scale) * smoothing(dt, 0.25);
    tilt += ((reduced ? 0 : tiltTarget) - tilt) * smoothing(dt, 0.12);

    // Head-tilt gesture.
    if (tiltStart >= 0) {
      const u = (clock - tiltStart) / (TILT_MS / 1000);
      if (u >= 1) {
        tiltStart = -1;
        head = 0;
      } else {
        head = -18 * Math.sin(Math.PI * u);
      }
    }
  }

  function render(): void {
    dom.root.style.transform = `translate3d(${pos.x.toFixed(2)}px,${pos.y.toFixed(2)}px,0)`;
    const bob = bobAmp * Math.sin(bobPhase);
    dom.sprite.style.transform = `translate3d(0,${(bob + sink + lift).toFixed(2)}px,0) rotate(${(tilt + head).toFixed(2)}deg) scale(${scale.toFixed(3)})`;

    const amp = (ph: number): number => flap.lo + (flap.hi - flap.lo) * (0.5 + 0.5 * Math.cos(ph));
    const upper = amp(phase);
    const lower = amp(phase - 0.6); // lower wings lag slightly
    const w = dom.wings;
    if (flapMode3d) {
      w.ur.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${upper.toFixed(2)}deg)`;
      w.ul.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${(-upper).toFixed(2)}deg)`;
      w.lr.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${lower.toFixed(2)}deg)`;
      w.ll.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${(-lower).toFixed(2)}deg)`;
    } else {
      const su = Math.cos((upper * Math.PI) / 180).toFixed(3);
      const sl = Math.cos((lower * Math.PI) / 180).toFixed(3);
      w.ur.style.transform = w.ul.style.transform = `scaleX(${su})`;
      w.lr.style.transform = w.ll.style.transform = `scaleX(${sl})`;
    }
  }

  /** Reduced motion only: nothing is moving, so the loop may stop. */
  function settled(): boolean {
    if (flight || moveResolve || fadeTimer || tiltStart >= 0 || pendingHome) return false;
    if (perch && perch.missed > 0) return false;
    if (distance(pos, goal) > 0.4) return false;
    const ft = flapTarget();
    return (
      Math.abs(flap.freq - ft.freq) < 0.01 &&
      Math.abs(flap.lo - ft.lo) < 0.1 &&
      Math.abs(flap.hi - ft.hi) < 0.1 &&
      Math.abs(sink - (perch && perchedFor > 0.12 ? 4 : 0)) < 0.05 &&
      Math.abs(scale - (perch ? 0.78 : 1)) < 0.002 &&
      Math.abs(lift) < 0.05 &&
      Math.abs(tilt) < 0.05 &&
      Math.abs(bobAmp) < 0.02
    );
  }

  function wantsLoop(): boolean {
    if (destroyed || document.visibilityState === 'hidden') return false;
    return !reduced || !settled();
  }

  /** The only place a frame is ever scheduled. `inFrame` + `raf` make a second loop impossible. */
  function frame(now: number): void {
    raf = 0;
    if (destroyed || document.visibilityState === 'hidden') return;
    inFrame = true;
    try {
      const dt = clamp((now - last) / 1000, 0, 0.05);
      last = now;
      update(dt);
      render();
      if (pendingHome) {
        pendingHome = false;
        void startFlight(HOME, false, 'top');
      }
    } finally {
      inFrame = false;
    }
    if (wantsLoop()) raf = requestAnimationFrame(frame);
  }

  function ensureLoop(): void {
    if (raf || inFrame || destroyed || document.visibilityState === 'hidden') return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stopLoop(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  // Reduced motion: the loop sleeps when settled. Wake it when the layout may have changed.
  const wake = (): void => {
    if (reduced) ensureLoop();
  };
  const poll = (): void => {
    if (raf || destroyed || !reduced || document.visibilityState === 'hidden') return;
    if (perch) {
      const t = perch.target.point();
      if (!t || distance(t, pos) > 0.4 || perch.target.hidden() !== hiddenNow) ensureLoop();
    } else if (!flight && !moveResolve) {
      if (distance(homePoint(), pos) > 0.4) ensureLoop();
    }
  };
  function syncPoll(): void {
    if (reduced && !destroyed) {
      if (!pollTimer) pollTimer = window.setInterval(poll, POLL_MS);
    } else if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = 0;
    }
  }
  window.addEventListener('scroll', wake, { capture: true, passive: true });
  window.addEventListener('resize', wake, { passive: true });

  // ---- listeners ----
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      stopLoop();
      if (flight) land(); // do not leave callers waiting on a paused flight
    } else {
      ensureLoop();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const onMql = (e: MediaQueryListEvent): void => {
    if (opts.reducedMotion === undefined) api.setReducedMotion(e.matches);
  };
  mql?.addEventListener?.('change', onMql);

  // ---- public API ----
  const api: Butterfly = {
    flyTo(target, o?: PerchOpts) {
      const side = o?.side ?? 'top-right';
      if (target instanceof Element) return startFlight(elementTarget(target, side, o?.within), true, side);
      return startFlight(pointTarget({ x: target.x, y: target.y }), true, side);
    },

    home() {
      return startFlight(HOME, false, 'top');
    },

    setMode(mode: Exclude<ButterflyMode, 'flying'>) {
      if (destroyed) return;
      if (mode === 'listening') {
        listening = true;
      } else if (mode === 'idle') {
        listening = false;
        if (perch || flight || moveResolve) void api.home();
      } else {
        // 'perched' is entered by flyTo(); here it only means "not listening any more".
        listening = false;
      }
      wake();
    },

    tilt() {
      if (destroyed || reduced) return;
      tiltStart = clock;
    },

    setReducedMotion(on) {
      if (destroyed || on === reduced) return;
      reduced = on;
      document.documentElement.classList.toggle('bf-reduced', on);
      if (on && flight) land();
      if (!on) driftAmp = 0;
      syncPoll();
      ensureLoop();
    },

    destroy() {
      if (destroyed) return;
      cancelCurrent();
      destroyed = true;
      stopLoop();
      syncPoll();
      window.removeEventListener('scroll', wake, true);
      window.removeEventListener('resize', wake);
      document.removeEventListener('visibilitychange', onVisibility);
      mql?.removeEventListener?.('change', onMql);
      document.documentElement.classList.remove('bf-reduced');
      dom.root.remove();
    },
  };

  document.documentElement.classList.toggle('bf-reduced', reduced);
  syncPoll();
  render();
  ensureLoop();
  return api;
}
