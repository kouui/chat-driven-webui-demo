import type { Butterfly, ButterflyMode, PerchOpts, PerchSide } from '../types';
import { clamp, distance, isOutsideRect, smoothing, type Pt } from './math';
import { perchPoint } from './perch';
import { APPROACH_MS, BASE_PEAK_RATIO, MOBILE_MAX_W, baseDuration, bankFromTurn, planFlight, rhythmAt, type FlightKind, type FlightPlan } from './flight';
import { createEffects, type RectLike, type TrailMode } from './effects';
import { createIdle } from './idle';
import { buildButterflyDom } from './svg';

/** Why `onTarget` fired: the butterfly left for `el` ('takeoff') or arrived there ('landed'). */
export type TargetPhase = 'takeoff' | 'landed';

/** A far source is farther than this from the butterfly (px). */
export const SPARK_FAR_PX = 200;
/** Duration of the pick-up streak from a far source (ms). */
export const SPARK_STREAK_MS = 180;
/** A flyTo within this many ms after a far spark waits for the streak. */
const SPARK_JOIN_MS = 250;
/** A flyTo takes off once the far streak is this far along (70%)... */
export const SPARK_TAKEOFF_FRAC = 0.7;
/** ...but never holds longer than this (ms). */
export const SPARK_HOLD_MAX_MS = 120;
const TURN_TAU = 0.1; // s, turnToward ease (settles within ~450ms)
const TURN_YAW_MAX = 30; // deg
const TURN_NEAR_PX = 160; // a glance target this close turns the body only a little (the wheel rim)...
const TURN_YAW_NEAR = 10; // ...at most this many degrees of yaw
/** A voice submit folds the ripples into the body for this long before the butterfly moves (ms, inside the flight). */
export const VOICE_COLLAPSE_MS = 200;
const TURN_LEAN_MAX = 14; // deg

export interface ButterflyOptions {
  /** Motion preference owned by the app. Once supplied here or through setReducedMotion(), the OS
   *  `prefers-reduced-motion` media query is never read or listened to again. Omit it only to follow the OS. */
  reducedMotion?: boolean;
  /** The element the butterfly is flying to / has landed on (null for a viewport point, or home).
   *  Called on take-off (the destination) and on landing. The app lights its landing pads from this. */
  onTarget?: (el: Element | null, phase: TargetPhase) => void;
  /** Home point (centre of the stage ring) in viewport coordinates. Called every frame while idle. */
  home?: () => { x: number; y: number };
  /** Element the butterfly glances at / leans toward (command input). Default: #cmd-input. */
  input?: () => Element | null;
  /** Seed for the idle state machine (tests / reproducible lab runs). */
  seed?: number;
}

/** The contract plus a few lab/guide hooks. Everything in `Butterfly` is unchanged. */
export interface ButterflyFx extends Butterfly {
  /** Silk settles into a short gold underline along the top edge of `el` (guide.ts calls it after reveal). */
  underline(el: Element): void;
  /** Perf tier of the effects layer: 0 full, 1 reduced, 2 stardust only. */
  perfTier(): 0 | 1 | 2;
  /** Live stardust count (lab / tests). */
  fxLive(): number;
  /** Remove the underline (guide.cancel). */
  clearUnderline(): void;
  /** Milliseconds of far-spark streak left (0 when none): a flyTo started now waits this long before take-off. */
  sparkEta(): number;
  /** The element the butterfly is flying to or perched on, or null. */
  target(): Element | null;
  /** Current global tempo (1 = design speed). The guide scales its pulse by it. */
  timeScale(): number;
}

const REPLAN_PX = 120; // the target moved farther than this since planning: replan from the current state
const AIM_TAU = 0.05; // s, smoothing of small target moves (shell slide, scroll) while flying
const AIM_MAX_SPEED = 900; // px/s, cap of the re-aim velocity
const REPLAN_MIN_PX = 28; // ...and a drift shorter than this is always absorbed
const REPLAN_REL = 0.12; // drift / path length above which a drift is replanned
const REPLAN_GAP_MS = 50; // at most one such replan per this many ms
const EARLY_PX = 40; // a flight that has covered less than this, and under EARLY_FRAC of its way, re-plans from its start
const EARLY_FRAC = 0.2;
const OFF_TAU = 0.1; // s, fade-out of the position difference an early replan leaves
const MIN_REPLAN_MS = 260;
const REPLAN_RATIO = 1.55; // whole-flight peak/mean a replan aims for (the bound is 1.7)
const LAND_SNAP = 24; // px: farther than this from the target at landing -> snap, nearer -> ease in as a perch
const ATTITUDE_MAX = 20; // deg, combined body rotation
const WING_ASYM = 0.35; // deg of wing-angle difference per degree of bank
const REATTACH_FRAMES = 2; // frames to wait for a re-rendered replacement before going home
const POLL_MS = 250; // reduced motion: how often to check whether a settled butterfly must move
const WOBBLE_AMP = 2.2; // px, lateral flight wobble
const WOBBLE_HZ = 2.2;
const FADE_MS = 150;
const TILT_MS = 600;
const SHORT_L = 24; // px: flights shorter than this fire onApproach immediately
const LOOP_MS = 720;
const LOOP_R = 22; // confused loop, 44px across
const PERSPECTIVE = 220;
const POINTER_STILL_MS = 500;
const POINTER_NEAR = 260;
const LISTEN_MIN_HZ = 2.5; // listening / idle flutter: scaled flaps never drop below this (they are still flaps)

interface Flap {
  freq: number; // Hz
  lo: number; // min rotateY (deg) = widest open
  hi: number; // max rotateY (deg) = most closed
}

const FLAP = {
  hover: { freq: 0.7, lo: 16, hi: 46 },
  flutter: { freq: 4, lo: 8, hi: 58 },
  landing: { freq: 3, lo: 20, hi: 62 },
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
  /** The element behind this target (null for points / home). */
  el?(): Element | null;
}

interface FlyOpts {
  minDuration?: number;
  maxDuration?: number;
  onApproach?: () => void;
  trail?: TrailMode;
  kind?: FlightKind;
}

interface Flight {
  from: Pt;
  v0: Pt;
  target: Target;
  plan: FlightPlan;
  /** ms since the flyTo call (includes the spark hold). */
  clockMs: number;
  /** clockMs at which the current plan started (> 0 while waiting for a spark streak, or after a replan). */
  t0: number;
  /** ms into the current plan (0 while holding). */
  t: number;
  /** Re-aim offset applied on top of the plan: follows (target - plan.to), weighted by progress. */
  aim: Pt;
  fxOn: boolean;
  resolve: (v: boolean) => void;
  /** After landing: stay on this target (perch) or go idle (home). */
  perch: boolean;
  side: PerchSide;
  approached: boolean;
  onApproach?: () => void;
  trail: TrailMode;
  kind?: FlightKind;
  /** Hard end of the WHOLE flight (clockMs, hold and replans included); undefined = unbounded. */
  deadline?: number;
  /** clockMs before which minDuration's total may not end (take-off + minDuration); 0 = none. */
  minEnd: number;
  /** clockMs of the first take-off (end of the hold). Never moves on a replan. */
  takeoff: number;
  /** Distance flown since take-off (px) and the fastest speed seen: a replan must keep the whole flight at peak/mean <= 1.7. */
  flown: number;
  peakSeen: number;
  /** clockMs of the last replan. */
  lastReplan: number;
  /** Position difference left by an early replan; fades out. */
  off: Pt;
}

interface Perch {
  target: Target;
  side: PerchSide;
  /** Consecutive frames the target has been missing. */
  missed: number;
}

const isSafari =
  typeof navigator !== 'undefined' && /^((?!chrome|chromium|android).)*safari/i.test(navigator.userAgent);

function safeCall(fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch (e) {
    console.error(e);
  }
}

export function createButterfly(layer: HTMLElement, opts: ButterflyOptions = {}): ButterflyFx {
  layer.classList.add('bf-layer');
  layer.setAttribute('aria-hidden', 'true');

  const dom = buildButterflyDom();
  layer.appendChild(dom.root);
  const fx = createEffects(layer);

  // A1: the OS media query is only consulted while the app has not supplied a preference.
  let prefSupplied = opts.reducedMotion !== undefined;
  let mql: MediaQueryList | null =
    !prefSupplied && typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

  let destroyed = false;
  // Global tempo: 1 = design speed, 0.5 = everything twice as long. Every duration in this file is a DESIGN time unless
  // named otherwise; `ts` converts. Reduced motion (FADE_MS cross-fade) and the voice vibration are exempt.
  let ts = 1;
  let reduced = opts.reducedMotion ?? mql?.matches ?? false;
  fx.setEnabled(!reduced);
  const flapMode3d = !isSafari;
  const idle = createIdle(opts.seed ?? ((Math.random() * 2 ** 31) | 0));
  /** Smoothing step with a design-time constant `tau` (s). */
  const sm = (dt: number, tau: number): number => smoothing(dt, tau / ts);
  /** Flap rate at tempo ts; never below `floor` (but never raised above the design rate either). */
  const hz = (f: number, floor = 0): number => Math.max(f * ts, Math.min(f, floor));

  const homePoint = (): Pt => {
    if (opts.home) {
      const h = opts.home();
      return { x: h.x, y: h.y };
    }
    return { x: window.innerWidth / 2, y: window.innerHeight * 0.45 };
  };
  const isMobile = (): boolean => window.innerWidth <= MOBILE_MAX_W;

  // ---- state ----
  let pos: Pt = homePoint();
  let vel: Pt = { x: 0, y: 0 }; // px/s, measured from the actual motion (retarget continuity)
  let listening = false;
  let voiceOn = false;
  let voiceLevel = 0;
  let voiceSm = 0;
  let flight: Flight | null = null;
  let perch: Perch | null = null;
  let clock = 0; // seconds
  let flap: Flap = { ...FLAP.hover };
  let phase = 0;
  let bobPhase = 0;
  let bobAmp = 2;
  let bank = 0; // deg, lean / bank by curvature
  let heading = 0;
  let haveHeading = false;
  let sink = 0;
  let lift = 0;
  let scale = 1;
  let perchedFor = 0; // seconds since landing
  let tiltStart = -1; // clock seconds, -1 when not tilting
  let head = 0;
  let loopStart = -1; // confused loop (part of tilt())
  let loopOff: Pt = { x: 0, y: 0 };
  let turn: { el: Element } | { x: number; y: number } | null = null; // turnToward target (not in flight)
  let turnYaw = 0; // deg
  let turnLean = 0; // deg
  let headKick = 0; // deg, decays: turn toward a spark source
  let flare = 0; // landing flare 1 -> 0
  let sparkGlow = 0; // brightness pulse when a spark arrives
  let glowS = 1;
  let glowA = 0.85;
  let cross = 1; // tails: 1 crossed X, 0 streaming
  let ghostA = 0;
  let fxDirty = false; // reduced motion: a static ring needs a redraw
  let lastRing = -1;

  let raf = 0;
  let inFrame = false; // true while frame() runs: it alone reschedules itself (single-loop guard)
  let pendingHome = false; // set by update(); consumed after render() so no flight starts mid-frame
  let goal: Pt = { ...pos }; // where the body is heading while not in a flight (for settle detection)
  let hiddenNow = false;
  let pollTimer = 0;
  let last = 0;
  let fadeTimer = 0;
  let crossGhost: HTMLElement | null = null; // reduced motion: the old-position copy that fades out during the cross-fade
  let moveResolve: ((v: boolean) => void) | null = null;
  let flightGen = 0; // bumped by every startFlight: stale reduced-motion timers compare against it
  let sparkPick: { t: number; eta: number } | null = null; // far spark: clock seconds of start / arrival
  let drawPos: Pt = { ...pos };

  // pointer (for glances)
  let pointer: { x: number; y: number; t: number } | null = null;
  const onPointer = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    pointer = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  const inputEl = (): Element | null => (opts.input ? opts.input() : document.getElementById('cmd-input'));
  const glanceVec = (): { dx: number; dy: number } | null => {
    const now = performance.now();
    if (pointer && now - pointer.t > POINTER_STILL_MS && now - pointer.t < 6000) {
      const dx = pointer.x - pos.x;
      const dy = pointer.y - pos.y;
      if (Math.hypot(dx, dy) <= POINTER_NEAR) return { dx, dy };
    }
    const el = inputEl();
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { dx: r.left + r.width / 2 - pos.x, dy: r.top + r.height / 2 - pos.y };
  };

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
      let w: DOMRect | null = null;
      lastHidden = false;
      if (within && within.isConnected) {
        const wr = within.getBoundingClientRect();
        if (wr.width > 0 || wr.height > 0) {
          w = wr;
          lastHidden = isOutsideRect(r, wr);
        }
      }
      lastPt = perchPoint(r, side, w); // the same pure geometry the app uses for its landing pads
    };

    return {
      el: () => el,
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
  const pointTarget = (p: Pt): Target => ({ point: () => p, hidden: () => false, rebind: () => false, el: () => null });
  const HOME: Target = { point: () => homePoint(), hidden: () => false, rebind: () => false };
  /** Point of a target, trying a silent re-attach if the element vanished. */
  const resolveTarget = (t: Target): Pt | null => t.point() ?? (t.rebind() ? t.point() : null);

  // ---- flight control ----
  function fireApproach(f: { approached: boolean; onApproach?: () => void }): void {
    if (f.approached) return;
    f.approached = true;
    safeCall(f.onApproach);
  }

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
      fx.endFlight(false);
      f.resolve(false);
    }
    if (crossGhost) {
      crossGhost.remove();
      crossGhost = null;
    }
    dom.fade.style.opacity = '1';
  }

  function notifyTarget(target: Target, phase: TargetPhase): void {
    if (!opts.onTarget) return;
    const cb = opts.onTarget;
    const el = target.el?.() ?? null;
    safeCall(() => cb(el, phase));
  }

  function land(): void {
    const f = flight;
    if (!f) return;
    flight = null;
    const t = f.target.point();
    // Re-aimed flights arrive within a few px: keep the position and let the perch ease in. Far off -> snap.
    if (t && distance(pos, t) > LAND_SNAP) pos = { ...t };
    vel = { x: 0, y: 0 };
    haveHeading = false;
    if (f.perch && t) {
      perch = { target: f.target, side: f.side, missed: 0 };
      perchedFor = 0;
    } else {
      perch = null;
    }
    flare = 1;
    fx.endFlight(true);
    fireApproach(f); // short / skipped flights: approach is never missed
    if (!flight) notifyTarget(f.perch && t ? f.target : HOME, 'landed'); // a flight started by onApproach owns the pads now
    f.resolve(true);
  }

  function leaveVoice(how: 'collapse' | 'fade'): void {
    if (!voiceOn) return;
    voiceOn = false;
    fx.setVoice(false);
    fx.setStaticRing(false);
    fx.leaveVoice(how);
    fxDirty = true;
  }

  function startFlight(target: Target, isPerch: boolean, side: PerchSide, design: FlyOpts = {}): Promise<boolean> {
    if (destroyed) return Promise.resolve(false);
    // minDuration / maxDuration are design ms (PerchOpts): the real bounds are 1/ts longer.
    const o: FlyOpts = {
      ...design,
      minDuration: design.minDuration === undefined ? undefined : design.minDuration / ts,
      maxDuration: design.maxDuration === undefined ? undefined : design.maxDuration / ts,
    };
    fx.clearUnderline();
    const prevHold = flight && flight.clockMs < flight.t0 ? flight.t0 - flight.clockMs : 0; // pick-up wait still pending
    const wasVoice = voiceOn;
    cancelCurrent();
    turn = null; // a glance never survives a flight
    leaveVoice('collapse'); // ripples fold into the body (the flight waits for them: see `hold`)
    // Retire the previous perch on every path (also reduced motion), so a removed old
    // target can never cancel this newer flight from the frame loop.
    perch = null;
    pendingHome = false;
    const gen = ++flightGen; // flight-local identity: timers of an older flight check it before touching anything
    const end = target.point() ?? homePoint();
    notifyTarget(target, 'takeoff');

    if (reduced) {
      const gate = { approached: false, onApproach: o.onApproach };
      ensureLoop();
      return new Promise<boolean>((resolve) => {
        moveResolve = resolve;
        // One cross-fade (FADE_MS): a copy of the butterfly fades out where it was while the real one fades in at
        // the destination. The shell appears with the butterfly (onApproach), the landing follows the fade.
        const old = dom.root.cloneNode(true) as HTMLElement;
        const oldFade = old.querySelector<HTMLElement>('.bf-fade');
        layer.appendChild(old);
        crossGhost = old;
        const place = (): Pt | null => {
          const t = resolveTarget(target); // a same-key replacement made during the fade is re-attached
          pos = t ? { ...t } : homePoint();
          vel = { x: 0, y: 0 };
          if (isPerch && t) {
            perch = { target, side, missed: 0 };
            perchedFor = 0;
          } else {
            perch = null;
          }
          return t;
        };
        place();
        dom.fade.style.transition = 'none';
        dom.fade.style.opacity = '0';
        void dom.fade.offsetWidth;
        dom.fade.style.transition = '';
        dom.fade.style.opacity = '1';
        if (oldFade) oldFade.style.opacity = '0';
        fireApproach(gate);
        if (gen !== flightGen) return; // onApproach started a newer flight: it owns the resolver and the timer now
        fadeTimer = window.setTimeout(() => {
          fadeTimer = 0;
          if (gen !== flightGen) return;
          const t = place();
          old.remove();
          if (crossGhost === old) crossGhost = null;
          if (moveResolve === resolve) moveResolve = null;
          notifyTarget(isPerch && t ? target : HOME, 'landed');
          resolve(true);
        }, FADE_MS);
      });
    }

    // The flight starts from the actual current position and velocity.
    const v0 = { ...vel };
    // A far spark streak is still travelling: wait for it (inside this flight's own timeline). A flight that is
    // itself still waiting for the streak passes the remaining wait on to its successor.
    let hold = prevHold;
    if (sparkPick && o.kind !== 'home' && Math.hypot(vel.x, vel.y) < 150 * ts && (clock - sparkPick.t) * 1000 <= SPARK_JOIN_MS / ts) {
      hold = Math.max(hold, (sparkPick.eta - clock) * 1000);
    }
    sparkPick = null;
    // Voice submit: the ripples fold into the body first (VOICE_COLLAPSE_MS), then the butterfly moves. The wait is
    // part of the flight's timeline, so onApproach and maxDuration count it.
    if (wasVoice && o.kind !== 'home') hold = Math.max(hold, VOICE_COLLAPSE_MS / ts);
    hold = Math.max(0, hold);
    const plan = planFlight(pos, end, {
      startVel: v0,
      mobile: isMobile(),
      minDuration: o.minDuration,
      maxDuration: o.maxDuration === undefined ? undefined : Math.max(o.maxDuration - hold, 0),
      kind: o.kind,
      vw: window.innerWidth,
      timeScale: ts,
    });
    const trail: TrailMode = o.trail ?? 'full';
    return new Promise<boolean>((resolve) => {
      flight = {
        from: { ...pos },
        v0,
        target,
        plan,
        clockMs: 0,
        t0: hold,
        t: 0,
        aim: { x: 0, y: 0 },
        fxOn: false,
        resolve,
        perch: isPerch,
        side,
        approached: false,
        onApproach: o.onApproach,
        trail,
        kind: o.kind,
        deadline: o.maxDuration,
        minEnd: o.minDuration ? hold + o.minDuration : 0,
        takeoff: hold,
        flown: 0,
        peakSeen: 0,
        lastReplan: -1e9,
        off: { x: 0, y: 0 },
      };
      if (hold <= 0) {
        flight.fxOn = true;
        fx.beginFlight(trail, plan.L > 500, plan.L);
      }
      if (document.visibilityState === 'hidden') land();
      else ensureLoop();
    });
  }

  // ---- targets shared by update() and settled(), so a reduced-motion loop can really sleep ----
  const scaleGoal = (): number => (perch && !flight && !voiceOn ? 0.78 : 1);
  const sinkGoal = (): number => (perch && !flight && perchedFor > 0.12 ? 4 : 0);
  const crossGoal = (): number => (flight ? 0 : perch && !voiceOn ? 0.7 : 1);

  /** Yaw / lean goals (deg) of turnToward(): neutral without a target, in flight or in reduced motion. */
  function turnGoal(): [number, number] {
    if (!turn || flight || reduced) return [0, 0];
    let tx: number;
    let ty: number;
    if ('el' in turn) {
      if (!turn.el.isConnected) return [0, 0];
      const r = turn.el.getBoundingClientRect();
      tx = r.left + r.width / 2;
      ty = r.top + r.height / 2;
    } else {
      tx = turn.x;
      ty = turn.y;
    }
    const dx = tx - pos.x;
    // A glance at something right beside the body (the wheel rim) is a small turn, never a swing of the wings.
    const yawMax = Math.hypot(dx, ty - pos.y) < TURN_NEAR_PX ? TURN_YAW_NEAR : TURN_YAW_MAX;
    return [clamp(dx / 6, -yawMax, yawMax), clamp(dx / 14, -TURN_LEAN_MAX, TURN_LEAN_MAX)];
  }

  // ---- per-frame update ----
  function flapTarget(): Flap & { tau: number } {
    if (tiltStart >= 0 && !reduced) return { ...FLAP.tilt, freq: hz(FLAP.tilt.freq), tau: 0.12 };
    if (reduced) return { ...(perch && !flight ? FLAP.reducedPerched : FLAP.reducedFree), tau: 0.12 };
    if (flight) {
      const b = rhythmAt(flight.t, flight.plan.dur, ts); // beats are laid out in design time, rates scaled (>= ~4Hz while flapping)
      return { freq: b.hz, lo: b.lo, hi: b.hi, tau: 0.045 };
    }
    if (voiceOn) {
      const a = 6 + 6 * voiceSm;
      return { freq: 13 + 3 * voiceSm, lo: 38 - a, hi: 38 + a, tau: 0.05 };
    }
    if (perch) {
      if (listening) return { ...FLAP.listening, freq: hz(FLAP.listening.freq, LISTEN_MIN_HZ), tau: 0.12 };
      const o = idle.out.open;
      return { freq: hz(FLAP.perched.freq), lo: FLAP.perched.lo - 40 * o, hi: FLAP.perched.hi - 20 * o, tau: 0.12 };
    }
    if (listening) return { ...FLAP.listening, freq: hz(FLAP.listening.freq, LISTEN_MIN_HZ), tau: 0.12 };
    if (idle.out.flutterHz > 0) return { ...FLAP.flutter, freq: hz(idle.out.flutterHz, LISTEN_MIN_HZ), tau: 0.08 };
    return { ...FLAP.hover, freq: hz(FLAP.hover.freq), tau: 0.2 };
  }

  /**
   * The target really moved (re-layout, scroll). Early in the flight (barely off the ground) the flight is re-planned
   * from its start with the clock kept, so the take-off ramp is not restarted and the small position difference
   * fades out. Later it is re-planned from the current position and velocity, as the shortest plan that is no faster
   * than anything flown and keeps the whole flight at peak/mean <= 1.7. minDuration's total and the maxDuration
   * deadline span replans.
   */
  function replan(f: Flight, to: Pt): void {
    const left = f.deadline === undefined ? undefined : Math.max(f.deadline - f.clockMs, 0);
    const mobile = isMobile();
    const vw = window.innerWidth;
    f.aim = { x: 0, y: 0 };
    if (f.clockMs < f.t0) {
      // Still waiting for the pick-up streak / ripple collapse: a fresh plan, the wait stays.
      f.plan = planFlight(pos, to, {
        startVel: vel,
        mobile,
        kind: f.kind,
        minDuration: f.minEnd ? f.minEnd - f.t0 : undefined,
        maxDuration: left === undefined ? undefined : Math.max(left - (f.t0 - f.clockMs), 0),
        vw,
        timeScale: ts,
      });
      f.v0 = { ...vel };
      return;
    }
    const elapsed = f.clockMs - f.takeoff;
    if (f.flown < EARLY_PX && f.flown < EARLY_FRAC * distance(f.from, to)) {
      const plan = planFlight(f.from, to, {
        startVel: f.v0,
        mobile,
        kind: f.kind,
        minDuration: f.minEnd ? f.minEnd - f.takeoff : undefined,
        maxDuration: f.deadline === undefined ? undefined : Math.max(f.deadline - f.takeoff, 0),
        vw,
        timeScale: ts,
      });
      if (elapsed < plan.dur * 0.5) {
        f.plan = plan;
        f.t0 = f.takeoff;
        f.t = elapsed;
        const here = plan.at(elapsed).pos;
        f.off = { x: pos.x - here.x, y: pos.y - here.y };
        return;
      }
    }
    const base = {
      startVel: vel,
      mobile,
      kind: f.kind,
      dur: MIN_REPLAN_MS / ts,
      minDuration: f.minEnd ? Math.max(f.minEnd - f.clockMs, 0) : undefined,
      maxDuration: left,
      vw,
      timeScale: ts,
    };
    // Candidates over a range of peak speeds. The whole-flight ratio is max(peak so far, plan peak) / (path / time);
    // a longer replan lowers it when the new leg's own peak dominates, a shorter one when the earlier peak does.
    // Take the feasible one nearest to a fresh flight's duration, else the best ratio.
    const W = f.flown + distance(pos, to);
    const fresh = (1000 * BASE_PEAK_RATIO * W) / baseDuration(W, ts);
    const speed = Math.hypot(vel.x, vel.y);
    const p0 = Math.max(f.peakSeen, speed, fresh, 1);
    const wantDur = Math.max(baseDuration(W, ts) - elapsed, MIN_REPLAN_MS / ts);
    let best: FlightPlan | null = null;
    let bestScore = Infinity;
    let fallback: FlightPlan | null = null;
    let fallbackRatio = Infinity;
    for (let P = Math.max(speed, p0 * 0.4); P <= p0 * 2.5; P *= 1.12) {
      const cand = planFlight(pos, to, { ...base, maxPeak: P });
      const ratio = (Math.max(f.peakSeen, cand.peak) * (elapsed + cand.dur)) / 1000 / Math.max(f.flown + cand.L, 1);
      if (ratio < fallbackRatio) {
        fallback = cand;
        fallbackRatio = ratio;
      }
      const score = Math.abs(cand.dur - wantDur);
      if (ratio <= REPLAN_RATIO && score < bestScore) {
        best = cand;
        bestScore = score;
      }
    }
    f.plan = best ?? fallback ?? planFlight(pos, to, base);
    f.t0 = f.clockMs;
    f.t = 0;
    f.v0 = { ...vel };
  }

  function update(dt: number): void {
    clock += dt;
    const prev = pos;
    let bankTarget = 0;
    const out = idle.step(dt * ts, { perched: !!perch && !flight, listening: listening && !voiceOn, glance: glanceVec });

    // voice level smoothing (attack fast, release slower)
    voiceSm += (voiceLevel - voiceSm) * smoothing(dt, voiceLevel > voiceSm ? 0.03 : 0.09);

    if (flight) {
      const f = flight;
      f.clockMs += dt * 1000;
      f.t = Math.max(0, f.clockMs - f.t0);
      if (!f.fxOn && f.clockMs >= f.t0) {
        f.fxOn = true; // the spark streak has arrived: take off
        fx.beginFlight(f.trail, f.plan.L > 500, f.plan.L);
      }
      const to = resolveTarget(f.target) ?? homePoint();
      const drift = distance(to, f.plan.to);
      // A drift is only absorbed by the eased aim offset while it is small against the way left to fly: aim scales the
      // remaining path, so on a short flight even a modest drift would push the speed over peak/mean 1.7.
      if (drift > REPLAN_PX || (drift > REPLAN_MIN_PX && drift > REPLAN_REL * f.plan.L && f.clockMs - f.lastReplan >= REPLAN_GAP_MS / ts)) {
        f.lastReplan = f.clockMs;
        replan(f, to);
      } else {
        const wx = to.x - f.plan.to.x;
        const wy = to.y - f.plan.to.y;
        let sx = (wx - f.aim.x) * sm(dt, AIM_TAU);
        let sy = (wy - f.aim.y) * sm(dt, AIM_TAU);
        const sl = Math.hypot(sx, sy);
        const lim = AIM_MAX_SPEED * ts * dt;
        if (sl > lim) {
          sx *= lim / sl;
          sy *= lim / sl;
        }
        f.aim.x += sx;
        f.aim.y += sy;
      }
      const u = clamp(f.t / f.plan.dur, 0, 1);
      const smp = f.plan.at(f.t);
      const env = 4 * u * (1 - u);
      const wob = WOBBLE_AMP * env * Math.sin(2 * Math.PI * WOBBLE_HZ * ((f.t * ts) / 1000));
      const ko = 1 - sm(dt, OFF_TAU);
      f.off.x *= ko;
      f.off.y *= ko;
      pos = { x: smp.pos.x + f.aim.x * smp.s + f.off.x - smp.tan.y * wob, y: smp.pos.y + f.aim.y * smp.s + f.off.y + smp.tan.x * wob };
      // Nothing visible to lead (already there): the approach is immediate.
      // (never while the take-off is still held back: the pick-up wait / ripple collapse is part of the lead-in)
      if (f.fxOn) f.flown += distance(prev, pos);
      if (!f.approached && f.clockMs >= f.t0 && (f.plan.L < SHORT_L || f.t0 + f.plan.dur - f.clockMs <= APPROACH_MS / ts)) fireApproach(f);
      if (flight === f && f.t >= f.plan.dur) land();
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
        const k = sm(dt, 0.08);
        const ox = reduced ? 0 : out.x;
        const oy = reduced ? 0 : out.y;
        pos = { x: pos.x + (t.x + ox - pos.x) * k, y: pos.y + (t.y + oy - pos.y) * k };
        bankTarget = perch.side === 'top-right' ? 10 : perch.side === 'top-left' ? -10 : 0;
      }
    } else if (!moveResolve || !reduced) {
      const h = homePoint();
      let tx = h.x;
      let ty = h.y;
      if (!reduced) {
        tx += out.x;
        ty += out.y;
      }
      goal = { x: h.x, y: h.y };
      const k = reduced ? smoothing(dt, 0.05) : sm(dt, 0.3);
      pos = { x: pos.x + (tx - pos.x) * k, y: pos.y + (ty - pos.y) * k };
    }

    // Measured velocity (px/s) and bank / lean by curvature.
    if (dt > 0.001) {
      const k = smoothing(dt, 0.03);
      vel = {
        x: vel.x + ((pos.x - prev.x) / dt - vel.x) * k,
        y: vel.y + ((pos.y - prev.y) / dt - vel.y) * k,
      };
    }
    const speed = Math.hypot(vel.x, vel.y);
    if (flight && flight.fxOn) flight.peakSeen = Math.max(flight.peakSeen, speed);
    if (flight && speed > 80 * ts && !reduced) {
      const h = Math.atan2(vel.y, vel.x);
      if (haveHeading && dt > 0.001) {
        let d = h - heading;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        bankTarget = clamp(bankFromTurn(speed / ts, d / dt / ts, 12) + clamp((vel.x / ts) * 0.006, -6, 6), -20, 20);
      }
      heading = h;
      haveHeading = true;
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
    const kf = smoothing(dt, ft.tau);
    flap = { freq: flap.freq + (ft.freq - flap.freq) * kf, lo: flap.lo + (ft.lo - flap.lo) * kf, hi: flap.hi + (ft.hi - flap.hi) * kf };
    phase += dt * flap.freq * 2 * Math.PI;

    // Body motion.
    const bobTarget = reduced ? 0 : flight ? 1.6 : perch ? 0.8 : 2;
    bobAmp += (bobTarget - bobAmp) * smoothing(dt, 0.2);
    bobPhase = flight ? phase + 1.2 : bobPhase + dt * ts * 2 * Math.PI * (perch ? 0.4 : 0.31);
    sink += (sinkGoal() - sink) * sm(dt, 0.18);
    const liftTarget = reduced || flight ? 0 : out.lift - (voiceOn ? 1 + 2 * voiceSm : 0);
    lift += (liftTarget - lift) * sm(dt, 0.12);
    flare *= Math.exp((-dt * ts) / 0.25);
    sparkGlow *= Math.exp((-dt * ts) / 0.3);
    headKick *= Math.exp((-dt * ts) / 0.3);
    {
      const [gy, gl] = turnGoal();
      const kt = sm(dt, TURN_TAU);
      turnYaw += (gy - turnYaw) * kt;
      turnLean += (gl - turnLean) * kt;
    }
    const scaleTarget = scaleGoal() + 0.1 * flare;
    scale += (scaleTarget - scale) * sm(dt, 0.25);
    bank += ((reduced ? 0 : bankTarget) - bank) * smoothing(dt, 0.1);

    // Tails: crossed X while hovering, streaming and swaying in flight.
    cross += (crossGoal() - cross) * sm(dt, 0.2);

    // Glow: breathing 4-6 s, lowered when perched, up with the voice level.
    let gS: number;
    let gA: number;
    if (reduced) {
      gS = perch ? 0.9 : 1;
      gA = perch && !flight ? 0.55 : 0.85;
    } else if (voiceOn && !flight) {
      gS = 1 + 0.5 * voiceSm;
      gA = 0.8 + 0.2 * voiceSm;
    } else if (flight) {
      gS = 1.1;
      gA = 0.95;
    } else if (perch) {
      gS = 0.88 + 0.07 * out.glow;
      gA = 0.5 + 0.08 * out.glow;
    } else {
      gS = 1 + 0.12 * out.glow;
      gA = 0.8 + 0.2 * out.glow;
    }
    const kg = sm(dt, 0.15);
    glowS += (gS + 0.2 * flare + 0.25 * sparkGlow - glowS) * kg;
    glowA += (Math.min(1, gA + 0.3 * flare + 0.35 * sparkGlow) - glowA) * kg;
    ghostA += ((voiceOn && !flight && !reduced ? 0.24 : 0) - ghostA) * smoothing(dt, 0.1);

    // Head-tilt gesture + the confused loop (visual offset only: the body keeps following its target).
    if (tiltStart >= 0) {
      const u = (clock - tiltStart) / (TILT_MS / ts / 1000);
      if (u >= 1) {
        tiltStart = -1;
        head = 0;
      } else {
        head = -18 * Math.sin(Math.PI * u);
      }
    }
    if (loopStart >= 0) {
      const u = (clock - loopStart) / (LOOP_MS / ts / 1000);
      if (u >= 1) {
        loopStart = -1;
        loopOff = { x: 0, y: 0 };
      } else {
        const th = 2 * Math.PI * u;
        loopOff = { x: LOOP_R * Math.sin(th), y: -LOOP_R * (1 - Math.cos(th)) }; // a 44px circle that starts and ends at the body
      }
    }
  }

  function render(rawMs: number): void {
    const out = idle.out;
    const jx = voiceOn && !reduced ? 0.8 * Math.sin(clock * 195) * voiceSm : 0;
    const jy = voiceOn && !reduced ? 0.8 * Math.sin(clock * 143 + 1) * voiceSm : 0;
    drawPos = { x: pos.x + loopOff.x + jx, y: pos.y + loopOff.y + jy };
    dom.root.style.transform = `translate3d(${drawPos.x.toFixed(2)}px,${drawPos.y.toFixed(2)}px,0)`;
    const bob = bobAmp * Math.sin(bobPhase);
    const rot = clamp(bank + head + headKick + turnLean + (reduced ? 0 : out.roll + out.head), -ATTITUDE_MAX, ATTITUDE_MAX);
    const yaw = reduced ? 0 : flight ? 0 : out.yaw + turnYaw;
    dom.sprite.style.transform =
      `translate3d(0,${(bob + sink + lift).toFixed(2)}px,0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})` +
      (Math.abs(yaw) > 0.05 ? ` perspective(500px) rotateY(${yaw.toFixed(2)}deg)` : '');

    const amp = (ph: number): number => flap.lo + (flap.hi - flap.lo) * (0.5 + 0.5 * Math.cos(ph));
    const upper = amp(phase);
    const lower = amp(phase - 0.6); // lower wings lag slightly
    // Turn-dependent asymmetry: the inner wing (the side we turn toward) closes more than the outer one.
    const asym = flight && !reduced ? clamp(bank, -ATTITUDE_MAX, ATTITUDE_MAX) * WING_ASYM : 0;
    const uR = Math.max(2, upper + asym);
    const uL = Math.max(2, upper - asym);
    const lR = Math.max(2, lower + asym);
    const lL = Math.max(2, lower - asym);
    const w = dom.wings;
    if (flapMode3d) {
      w.ur.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${uR.toFixed(2)}deg)`;
      w.ul.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${(-uL).toFixed(2)}deg)`;
      w.lr.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${lR.toFixed(2)}deg)`;
      w.ll.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${(-lL).toFixed(2)}deg)`;
    } else {
      const cs = (a: number): string => Math.cos((a * Math.PI) / 180).toFixed(3);
      w.ur.style.transform = `scaleX(${cs(uR)})`;
      w.ul.style.transform = `scaleX(${cs(uL)})`;
      w.lr.style.transform = `scaleX(${cs(lR)})`;
      w.ll.style.transform = `scaleX(${cs(lL)})`;
    }
    if (ghostA > 0.01) {
      dom.ghostGroup.setAttribute('opacity', ghostA.toFixed(3));
      const gu = amp(phase + 1.6) - 4;
      const gl = amp(phase + 1.0) - 4;
      const g = dom.ghost;
      g.ur.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${gu.toFixed(2)}deg)`;
      g.ul.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${(-gu).toFixed(2)}deg)`;
      g.lr.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${gl.toFixed(2)}deg)`;
      g.ll.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${(-gl).toFixed(2)}deg)`;
    } else if (dom.ghostGroup.getAttribute('opacity') !== '0') {
      dom.ghostGroup.setAttribute('opacity', '0');
    }
    dom.glow.style.opacity = glowA.toFixed(3);
    dom.glow.style.transform = `scale(${glowS.toFixed(3)})`;
    dom.setTails(cross, reduced ? 0 : (flight ? 1 : 0.15) * Math.sin(clock * ts * 2 * Math.PI * 1.6));

    // Effects: trail while flying, ripples while in voice mode.
    if (voiceOn && !reduced) {
      fx.setVoice(true, distance(pos, homePoint()) < 48 ? 130 : 90);
      fx.setVoiceLevel(voiceSm);
    }
    if (flight && !reduced) fx.trail(drawPos.x, drawPos.y);
    if (!reduced) {
      if (fx.hasWork() && rawMs > 0) fx.reportFrame(rawMs);
      fx.frame(Math.min(rawMs, 50), drawPos);
    } else {
      if (fxDirty || voiceOn) fx.frame(16, drawPos);
      fxDirty = false;
    }
  }

  /** Reduced motion only: nothing is moving, so the loop may stop. */
  function settled(): boolean {
    if (flight || moveResolve || fadeTimer || tiltStart >= 0 || pendingHome || fxDirty) return false;
    if (perch && perch.missed > 0) return false;
    if (distance(pos, goal) > 0.4) return false;
    const ft = flapTarget();
    return (
      Math.abs(flap.freq - ft.freq) < 0.01 &&
      Math.abs(flap.lo - ft.lo) < 0.1 &&
      Math.abs(flap.hi - ft.hi) < 0.1 &&
      Math.abs(sink - sinkGoal()) < 0.05 &&
      Math.abs(scale - scaleGoal()) < 0.002 &&
      Math.abs(lift) < 0.05 &&
      Math.abs(bank) < 0.05 &&
      Math.abs(bobAmp) < 0.02 &&
      Math.abs(glowS - (perch ? 0.9 : 1)) < 0.004 &&
      Math.abs(glowA - (perch ? 0.55 : 0.85)) < 0.004 &&
      Math.abs(cross - crossGoal()) < 0.01
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
      const raw = now - last;
      const dt = clamp(raw / 1000, 0, 0.05);
      last = now;
      update(dt);
      render(raw);
      if (pendingHome) {
        pendingHome = false;
        void startFlight(HOME, false, 'top', { trail: 'light', kind: 'home' });
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
    if (!prefSupplied) applyReduced(e.matches); // OS auto-follow only while the app has given no preference
  };
  mql?.addEventListener?.('change', onMql);

  function applyReduced(on: boolean): void {
    if (destroyed || on === reduced) return;
    reduced = on;
    document.documentElement.classList.toggle('bf-reduced', on);
    if (on) {
      turn = null;
      turnYaw = 0;
      turnLean = 0;
    }
    fx.setEnabled(!on);
    if (on && voiceOn) {
      fx.setStaticRing(true);
      fxDirty = true;
    }
    if (!on) fx.setStaticRing(false);
    if (on && flight) land();
    syncPoll();
    ensureLoop();
  }

  const rectOf = (el: Element): RectLike => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };

  // ---- public API ----
  const api: ButterflyFx = {
    flyTo(target, o?: PerchOpts) {
      const side = o?.side ?? 'top-right';
      const fo: FlyOpts = { minDuration: o?.minDuration, maxDuration: o?.maxDuration, onApproach: o?.onApproach, trail: o?.trail };
      if (target instanceof Element) return startFlight(elementTarget(target, side, o?.within), true, side, fo);
      return startFlight(pointTarget({ x: target.x, y: target.y }), true, side, fo);
    },

    home() {
      return startFlight(HOME, false, 'top', { trail: 'light', kind: 'home' });
    },

    setMode(mode: Exclude<ButterflyMode, 'flying'>) {
      if (destroyed) return;
      if (mode === 'voice') {
        if (!voiceOn) {
          voiceOn = true;
          listening = false;
          if (reduced) {
            fx.setStaticRing(true);
            fxDirty = true;
          }
        }
        wake();
        ensureLoop();
        return;
      }
      if (voiceOn) leaveVoice('fade'); // cancel: ripples fade over 200ms
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
      loopStart = clock;
      ensureLoop();
    },

    spark(from) {
      if (destroyed || reduced) return;
      const src: RectLike | Pt = from instanceof Element ? rectOf(from) : from;
      const sx = 'width' in src ? src.left + src.width / 2 : src.x;
      const sy = 'width' in src ? src.top + src.height / 2 : src.y;
      const far = Math.hypot(sx - drawPos.x, sy - drawPos.y) > SPARK_FAR_PX;
      sparkGlow = 1;
      if (far) {
        // Pick-up: a visible streak source -> butterfly; the butterfly turns toward it, and a flyTo started
        // within SPARK_JOIN_MS holds its take-off until the streak arrives.
        headKick = clamp((sx - pos.x) / 8, -16, 16);
        fx.spark(src, () => drawPos, true);
        fx.streak(src, () => drawPos, SPARK_STREAK_MS);
        sparkPick = { t: clock, eta: clock + Math.min(SPARK_HOLD_MAX_MS, SPARK_TAKEOFF_FRAC * SPARK_STREAK_MS) / 1000 / ts };
      } else {
        headKick = clamp((sx - pos.x) / 12, -10, 10);
        fx.spark(src, () => drawPos);
      }
      ensureLoop();
    },

    turnToward(target) {
      if (destroyed || reduced) return;
      if (target === null) turn = null;
      else if (flight || moveResolve) return; // ignored during a flight
      else turn = target instanceof Element ? { el: target } : { x: target.x, y: target.y };
      ensureLoop();
    },

    sparkEta() {
      return sparkPick ? Math.max(0, (sparkPick.eta - clock) * 1000) : 0;
    },

    timeScale: () => ts,

    setTimeScale(scale) {
      if (destroyed || !Number.isFinite(scale) || scale <= 0) return;
      ts = clamp(scale, 0.1, 4);
      fx.setTimeScale(ts);
    },

    target() {
      const t = flight ? flight.target : perch ? perch.target : null;
      return t?.el?.() ?? null;
    },

    clearUnderline() {
      fx.clearUnderline();
    },

    setVoiceLevel(level) {
      voiceLevel = clamp(level, 0, 1);
      if (reduced && voiceOn) {
        const q = Math.round(voiceLevel * 2);
        if (q !== lastRing) {
          lastRing = q;
          fx.setVoiceLevel(q / 2);
          fxDirty = true;
          ensureLoop();
        }
      }
    },

    position() {
      return { x: pos.x + loopOff.x, y: pos.y + loopOff.y };
    },

    underline(el) {
      if (destroyed || reduced) return;
      fx.underline(rectOf(el));
      ensureLoop();
    },

    perfTier: () => fx.tier,
    fxLive: () => fx.liveParticles(),

    setReducedMotion(on) {
      if (destroyed) return;
      // A1: from now on the app owns the preference; the OS media query is neither read nor listened to.
      prefSupplied = true;
      if (mql) {
        mql.removeEventListener?.('change', onMql);
        mql = null;
      }
      applyReduced(on);
    },

    destroy() {
      if (destroyed) return;
      cancelCurrent();
      destroyed = true;
      stopLoop();
      syncPoll();
      window.removeEventListener('scroll', wake, true);
      window.removeEventListener('resize', wake);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      mql?.removeEventListener?.('change', onMql);
      mql = null;
      document.documentElement.classList.remove('bf-reduced');
      fx.destroy();
      dom.root.remove();
    },
  };

  document.documentElement.classList.toggle('bf-reduced', reduced);
  syncPoll();
  render(0);
  ensureLoop();
  return api;
}
