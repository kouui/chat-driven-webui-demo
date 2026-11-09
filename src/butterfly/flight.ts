// Pure flight planning (no DOM): single-bend arc, arc-length parameterisation, asymmetric pursuit
// speed profile, retarget continuity and the flap-glide rhythm. Unit-tested in flight.test.ts.
import { bezier, bezierTangent, clamp, distance, type Pt } from './math';

export const PEAK_CAP_DESKTOP = 1300; // px/s
export const PEAK_CAP_MOBILE = 1000; // px/s
export const MOBILE_MAX_W = 768; // viewport width <= this counts as mobile
export const ARC_CAP_DESKTOP = 90; // px
export const ARC_CAP_MOBILE = 36; // px
export const CARRY_MAX = 120; // chords shorter than this get a visible carry arc
export const APPROACH_MS = 300;
/** Largest start speed / mean speed a plan may begin with (keeps peak/mean <= 1.7 for retargets). */
export const A0_MAX = 1.45;
export const DUR_MIN = 380;
export const DUR_MAX = 850;

export type FlightKind = 'swoop' | 'carry' | 'home';

export interface PlanOpts {
  /** Current velocity (px/s). The new flight continues from it (no kink, no restart from rest). */
  startVel?: Pt;
  mobile?: boolean;
  minDuration?: number;
  /** Hard upper bound (ms): wins over the speed cap and over minDuration. */
  maxDuration?: number;
  kind?: FlightKind;
  /** Time budget (ms) to use instead of the spec duration; used to keep the timeline on a replan.
   *  It is only ever shortened, and only when the start speed would otherwise break peak/mean <= 1.7. */
  dur?: number;
  /** Peak speed (px/s) this plan may not exceed: the plan takes the shortest duration that keeps to it (replans of a
   *  running flight use it so the whole flight stays within peak/mean <= 1.7). With `dur` it only lengthens `dur`. */
  maxPeak?: number;
  /** Viewport size, used to pick the bend side for near-vertical moves. */
  vw?: number;
  /** Global tempo (default 1). Every duration below is in REAL ms and already scaled by the caller (`dur`, `minDuration`,
   *  `maxDuration`); the plan's own clamp bounds, speed caps and velocity-correction decay scale by 1/timeScale. */
  timeScale?: number;
}

export interface FlightSample {
  pos: Pt;
  /** Unit tangent of the path at this time. */
  tan: Pt;
  /** Speed along the path in px/s (plan only). */
  speed: number;
  /** Progress along the arc, 0..1. */
  s: number;
}

export interface FlightPlan {
  from: Pt;
  to: Pt;
  kind: FlightKind;
  /** Arc length in px. */
  L: number;
  /** Total duration in ms. */
  dur: number;
  /** Bend height in px (peak distance of the arc from the chord). */
  height: number;
  /** Peak / mean speed of the profile (<= 1.7). */
  peakRatio: number;
  /** Peak speed in px/s. */
  peak: number;
  at(tMs: number): FlightSample;
}

// ---- speed profile ----
// g(tau) is the speed normalised by the mean speed (integral over [0,1] is 1). Rising part: smoothstep from the
// start speed a0 to the peak P over the first TP of the time; braking part: P * (1 - w^M) over the remaining time,
// which gives ~30% accelerating / 70% braking and a peak/mean of about 1.44. A flight that already starts faster than
// that (a0 > P, only on retargets) brakes the whole time: g = a0 * (1 - tau^Mb), a0 = (Mb + 1) / Mb.
const TP = 0.3;
const M = 3.5;
const DENOM = TP / 2 + ((1 - TP) * M) / (M + 1);

interface Profile {
  g(tau: number): number;
  f(tau: number): number;
  /** Peak / mean speed. */
  ratio: number;
}

function makeProfile(a0: number): Profile {
  const P = (1 - (TP * a0) / 2) / DENOM;
  if (P >= a0) {
    return {
      ratio: Math.max(P, a0),
      g(tau) {
        if (tau <= 0) return a0;
        if (tau >= 1) return 0;
        if (tau < TP) {
          const x = tau / TP;
          return a0 + (P - a0) * (3 * x * x - 2 * x * x * x);
        }
        const w = (tau - TP) / (1 - TP);
        return P * (1 - Math.pow(w, M));
      },
      f(tau) {
        if (tau <= 0) return 0;
        if (tau >= 1) return 1;
        if (tau < TP) {
          const x = tau / TP;
          return a0 * tau + (P - a0) * TP * (x * x * x - (x * x * x * x) / 2);
        }
        const w = (tau - TP) / (1 - TP);
        const rise = (TP * (a0 + P)) / 2;
        return rise + P * (1 - TP) * (w - Math.pow(w, M + 1) / (M + 1));
      },
    };
  }
  const Mb = 1 / (a0 - 1);
  return {
    ratio: a0,
    g: (tau) => (tau <= 0 ? a0 : tau >= 1 ? 0 : a0 * (1 - Math.pow(tau, Mb))),
    f: (tau) => (tau <= 0 ? 0 : tau >= 1 ? 1 : a0 * (tau - Math.pow(tau, Mb + 1) / (Mb + 1))),
  };
}
const BASE_PROFILE = makeProfile(0);
/** Peak / mean of a flight that starts from rest (about 1.44). */
export const BASE_PEAK_RATIO = BASE_PROFILE.ratio;

/** Deterministic pseudo random in [0,1) from two numbers (no global RNG, so plans are reproducible). */
function hash01(a: number, b: number): number {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

export function peakCap(mobile: boolean): number {
  return mobile ? PEAK_CAP_MOBILE : PEAK_CAP_DESKTOP;
}

/** Spec duration (A4): clamp(260 + 0.7 L, 380, 850) ms. */
export function baseDuration(L: number, timeScale = 1): number {
  return clamp((260 + 0.7 * L) / timeScale, DUR_MIN / timeScale, DUR_MAX / timeScale);
}

const SAMPLES = 40;
const DELTA_TAU = 0.12; // seconds, decay of the velocity-correction term
const L_EPS = 0.5;

export function planFlight(from: Pt, to: Pt, o: PlanOpts = {}): FlightPlan {
  const mobile = !!o.mobile;
  const ts = o.timeScale && o.timeScale > 0 ? o.timeScale : 1;
  const chord = distance(from, to);
  const kind: FlightKind = o.kind ?? (chord < CARRY_MAX ? 'carry' : 'swoop');
  const arcCap = mobile ? ARC_CAP_MOBILE : ARC_CAP_DESKTOP;

  // ---- geometry ----
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ux = chord > 1e-6 ? dx / chord : 0;
  const uy = chord > 1e-6 ? dy / chord : -1;
  let nx = -uy;
  let ny = ux;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  if (kind === 'home') {
    // Home flights bend below the chord (a low glide back to the ring).
    nx = -nx;
    ny = -ny;
  }
  if (kind !== 'home' && Math.abs(ny) < 0.35 && o.vw) {
    // Near-vertical move: bend towards the viewport centre.
    const mid = (from.x + to.x) / 2;
    if (nx * (o.vw / 2 - mid) < 0) {
      nx = -nx;
      ny = -ny;
    }
  }
  const frac = 0.12 + 0.06 * hash01(from.x + to.x, from.y + to.y); // 12..18%
  // 12-18% of the chord, capped (90px / 36px on mobile): long paths are flat in relative terms because the cap binds.
  let height = chord * frac * (kind === 'home' ? 0.65 : 1);
  if (kind === 'carry') height = Math.max(height, (mobile ? 22 : 34) * Math.min(1, chord / 40));
  height = Math.min(height, arcCap);
  if (chord < 2) height = 0;
  const off = height / 0.75; // control point offset giving `height` at the apex of a symmetric cubic

  const v0 = o.startVel ?? { x: 0, y: 0 };
  const sp0 = Math.hypot(v0.x, v0.y) / ts; // speed in tempo-normalised px/s: the thresholds below are design numbers
  // Start tangent: the arc's natural tangent, blended towards the current velocity direction.
  let t0x = ux * 0.33 * chord + nx * off;
  let t0y = uy * 0.33 * chord + ny * off;
  const tl = Math.hypot(t0x, t0y) || 1;
  t0x /= tl;
  t0y /= tl;
  if (sp0 > 60 && chord > 1e-6) {
    const w = clamp((sp0 - 60) / 300, 0, 1);
    const bx = t0x * (1 - w) + (v0.x / (sp0 * ts)) * w;
    const by = t0y * (1 - w) + (v0.y / (sp0 * ts)) * w;
    const bl = Math.hypot(bx, by);
    if (bl > 1e-6) {
      t0x = bx / bl;
      t0y = by / bl;
    }
  }
  // A fast start swings wide (overshoots and curves back) instead of braking to a stop: the path gets long
  // enough to keep a sensible duration at peak/mean <= 1.7.
  const vSwing = sp0 > 60 ? clamp((sp0 - 60) / 300, 0, 1) * Math.min(sp0 * 0.25, 420) : 0;
  const reach = Math.max(chord * 0.36, vSwing);
  const p1: Pt = { x: from.x + t0x * reach, y: from.y + t0y * reach };
  const p2: Pt = { x: to.x - ux * chord * 0.33 + nx * off, y: to.y - uy * chord * 0.33 + ny * off };

  // Arc-length table.
  const cum = new Float64Array(SAMPLES + 1);
  let prev = from;
  for (let i = 1; i <= SAMPLES; i++) {
    const p = bezier(from, p1, p2, to, i / SAMPLES);
    cum[i] = cum[i - 1] + distance(prev, p);
    prev = p;
  }
  const L = cum[SAMPLES];

  const pathAt = (s: number): { pos: Pt; tan: Pt } => {
    const sc = clamp(s, 0, L);
    let lo = 0;
    let hi = SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= sc) lo = mid;
      else hi = mid;
    }
    const seg = cum[hi] - cum[lo];
    const u = (lo + (seg > 1e-9 ? (sc - cum[lo]) / seg : 0)) / SAMPLES;
    const pos = bezier(from, p1, p2, to, u);
    const tg = bezierTangent(from, p1, p2, to, u);
    const tn = Math.hypot(tg.x, tg.y);
    return { pos, tan: tn > 1e-9 ? { x: tg.x / tn, y: tg.y / tn } : { x: ux, y: uy } };
  };
  const start = pathAt(0);

  // ---- duration ----
  const along0 = Math.max(0, v0.x * start.tan.x + v0.y * start.tan.y); // start speed along the path
  const baseDur = (): number => {
    // The spec duration; stretched (never beyond the 850ms cap) when the speed cap would otherwise be broken.
    const speedDur = (1000 * BASE_PROFILE.ratio * L) / (peakCap(mobile) * ts);
    return clamp(Math.max((260 + 0.7 * L) / ts, speedDur), DUR_MIN / ts, DUR_MAX / ts);
  };
  const minDur = o.minDuration ?? 0;
  let dur: number;
  if (o.maxPeak !== undefined && L > L_EPS) {
    // Shortest duration whose peak stays within maxPeak: peak = (L/D - TP*v0/2) / DENOM in the rising branch.
    const dNeed = (1000 * L) / (DENOM * Math.max(o.maxPeak, 1) + (TP * along0) / 2);
    dur = Math.max(o.dur ?? 0, dNeed, minDur);
  } else {
    dur = o.dur ?? Math.max(baseDur(), minDur);
  }
  // Retargets: never begin faster than A0_MAX times the mean speed (shorten the budget instead of breaking
  // peak/mean). minDuration is a contract: it stays, and the start-speed mismatch is bridged by the velocity
  // correction below instead.
  if (L > L_EPS && along0 > 0) dur = Math.min(dur, Math.max((A0_MAX * 1000 * L) / along0, minDur));
  // maxDuration is the hard limit: it beats the speed cap's stretch, minDuration and the peak bound.
  if (o.maxDuration !== undefined) dur = Math.min(dur, Math.max(o.maxDuration, 60 / ts));
  dur = Math.max(dur, 60 / ts);
  const a0 = L > L_EPS ? clamp((along0 * dur) / 1000 / L, 0, A0_MAX) : 0;
  const prof = makeProfile(a0);
  const meanSpeed = L > L_EPS ? (L / dur) * 1000 : 0;
  const peak = prof.ratio * meanSpeed;

  // Velocity correction: makes the start velocity equal to `startVel` even when the profile starts slower.
  const planV0 = (a0 * L * 1000) / dur;
  const dvx = v0.x - start.tan.x * planV0;
  const dvy = v0.y - start.tan.y * planV0;

  const at = (tMs: number): FlightSample => {
    const t = clamp(tMs, 0, dur);
    const tau = dur > 0 ? t / dur : 1;
    const s = L * prof.f(tau);
    const pp = pathAt(s);
    const tSec = t / 1000;
    const k = tSec * Math.exp(-tSec / (DELTA_TAU / ts)) * (1 - tau * tau * tau * tau);
    return {
      pos: { x: pp.pos.x + dvx * k, y: pp.pos.y + dvy * k },
      tan: pp.tan,
      speed: dur > 0 ? (L * prof.g(tau) * 1000) / dur : 0,
      s: L > L_EPS ? s / L : 1,
    };
  };

  return { from: { ...from }, to: { ...to }, kind, L, dur, height, peakRatio: prof.ratio, peak, at };
}

// ---- flap-glide rhythm ----
export type BeatKind = 'takeoff' | 'burst' | 'glide' | 'flare';
export interface Beat {
  kind: BeatKind;
  hz: number;
  /** Wing angle range in degrees (lo = widest open). */
  lo: number;
  hi: number;
}

const TAKEOFF_MS = 120; // 100-140
const BURST_BEATS = 3;
const BURST_HZ = 7.5;
const BURST_MS = (BURST_BEATS / BURST_HZ) * 1000; // 400
const FLARE_MAX_MS = 160;

/** Wing rhythm for a flight at `ms` after take-off with total duration `dur`. */
export const FLY_FLAP_MIN_HZ = 4;
/** `rhythmAt` frequencies at tempo `ts`: scaled, but a flight's flapping (take-off, burst) never drops below ~4 Hz, so it still
 *  reads as flying. Glide and flare simply scale. */
function scaledHz(b: Beat, ts: number): Beat {
  const hz = b.kind === 'takeoff' || b.kind === 'burst' ? Math.max(b.hz * ts, Math.min(b.hz, FLY_FLAP_MIN_HZ)) : b.hz * ts;
  return ts === 1 ? b : { ...b, hz };
}

/** Wing rhythm for a flight at `ms` (real) after take-off with total duration `dur` (real) at tempo `ts`. The rhythm itself is
 *  laid out in tempo-normalised time (ms*ts), so the beat pattern is the same, just slower. */
export function rhythmAt(ms: number, dur: number, ts = 1): Beat {
  return scaledHz(rhythmDesign(ms * ts, dur * ts), ts);
}

function rhythmDesign(ms: number, dur: number): Beat {
  const flare = Math.min(FLARE_MAX_MS, dur * 0.22);
  if (ms < TAKEOFF_MS && dur > 2 * TAKEOFF_MS) return { kind: 'takeoff', hz: 9, lo: 5, hi: 76 };
  if (ms >= dur - flare) return { kind: 'flare', hz: 3, lo: 20, hi: 62 };
  let t = ms - TAKEOFF_MS;
  for (let i = 0; i < 64; i++) {
    const glide = 100 + 60 * hash01(i, 3.7); // 100-160ms
    if (t < BURST_MS) return { kind: 'burst', hz: BURST_HZ, lo: 8, hi: 68 };
    t -= BURST_MS;
    if (t < glide) return { kind: 'glide', hz: 1.2, lo: 14, hi: 30 };
    t -= glide;
  }
  return { kind: 'burst', hz: BURST_HZ, lo: 8, hi: 68 };
}

/** Body bank (deg) from heading change: turning right leans right. `speed` px/s, `omega` rad/s. */
export function bankFromTurn(speed: number, omega: number, max = 12): number {
  return clamp((speed * omega) / 160, -max, max);
}
