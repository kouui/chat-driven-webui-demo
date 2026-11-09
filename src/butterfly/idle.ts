// Pure idle state machine for the butterfly (no DOM, seeded RNG, unit-tested).
//
// Hover: small targets within x+-12 / y+-8 px, approach 0.5-1.2 s, rest 0.7-1.6 s.
// Flutter: 2-4 beats at 3-5 Hz with a 1-3 px lift. Glide/turn: yaw +-20 deg, roll +-10 deg.
// Glance: 6-10 deg toward the input or a still pointer. Glow breathes with a 4-6 s period.
// Perched: x+-2 / y+-1 px, mostly resting, a slow full wing open every 8-14 s.
// Listening: lift 3-6 px, 3-4 Hz flaps, lean toward the input.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const HOVER_X = 12;
export const HOVER_Y = 8;
export const PERCH_X = 2;
export const PERCH_Y = 1;

export interface IdleCtx {
  perched: boolean;
  listening: boolean;
  /** Vector from the butterfly to the glance target (input, or a still pointer within 260px); null if none. */
  glance?: () => { dx: number; dy: number } | null;
}

export interface IdleOut {
  /** Offset from the home / perch point (px). */
  x: number;
  y: number;
  /** Vertical lift (px, negative = up): flutter and listening. */
  lift: number;
  /** Pseudo-3D turn (deg) and roll (deg). */
  yaw: number;
  roll: number;
  /** Head turn toward a glance target / the input while listening (deg, + = clockwise). */
  head: number;
  /** Flutter beat frequency in Hz while a flutter (or listening) is active, else 0. */
  flutterHz: number;
  /** Breathing phase 0..1 (period 4-6 s). */
  glow: number;
  /** Slow full wing open while perched: 0..1. */
  open: number;
}

export interface Idle {
  step(dt: number, ctx: IdleCtx): IdleOut;
  readonly out: IdleOut;
  /** Breathing period (s). */
  readonly glowPeriod: number;
}

const smooth = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

export function createIdle(seed = 1): Idle {
  const rnd = mulberry32(seed);
  const between = (a: number, b: number): number => a + (b - a) * rnd();
  const sgn = (): number => (rnd() < 0.5 ? -1 : 1);

  let t = 0;
  const glowPeriod = between(4, 6);
  const glowPhase = rnd() * Math.PI * 2;

  // hover (normalised -1..1 box, scaled by the current amplitude)
  let fromX = 0;
  let fromY = 0;
  let toX = 0;
  let toY = 0;
  let moving = false;
  let phaseT = 0;
  let phaseDur = between(0.7, 1.6);
  let ampX = HOVER_X;
  let ampY = HOVER_Y;

  // flutter
  let flutterAt = between(1.2, 3);
  let flutterT = -1;
  let flutterDur = 0;
  let flutterHz = 0;
  let flutterLift = 0;

  // glide / turn
  let turnAt = between(3, 7);
  let turnT = -1;
  let turnDur = 0;
  let turnYaw = 0;

  // glance
  let glanceAt = between(3, 6);
  let glanceT = -1;
  let glanceDur = 0;
  let glanceDeg = 0;

  // perched open
  let openAt = between(8, 14);
  let openT = -1;
  let openDur = 0;

  // listening lean
  let leanTarget = 0;
  let leanAt = 0;
  let lean = 0;
  let liftSm = 0;
  const listenLift = between(3, 6);

  const out: IdleOut = { x: 0, y: 0, lift: 0, yaw: 0, roll: 0, head: 0, flutterHz: 0, glow: 0.5, open: 0 };

  function step(dt: number, ctx: IdleCtx): IdleOut {
    dt = Math.min(Math.max(dt, 0), 0.1);
    t += dt;

    // amplitude follows the perched / hover state
    const tx = ctx.perched ? PERCH_X : HOVER_X;
    const ty = ctx.perched ? PERCH_Y : HOVER_Y;
    const ka = 1 - Math.exp(-dt / 0.5);
    ampX += (tx - ampX) * ka;
    ampY += (ty - ampY) * ka;

    // hover move / rest
    phaseT += dt;
    if (phaseT >= phaseDur) {
      phaseT = 0;
      if (moving) {
        moving = false;
        fromX = toX;
        fromY = toY;
        phaseDur = ctx.perched ? between(2, 5) : between(0.7, 1.6);
      } else {
        moving = true;
        fromX = toX;
        fromY = toY;
        toX = between(-1, 1);
        toY = between(-1, 1);
        phaseDur = ctx.perched ? between(1.2, 2.2) : between(0.5, 1.2);
      }
    }
    const u = moving ? smooth(phaseT / phaseDur) : 1;
    const nx = moving ? fromX + (toX - fromX) * u : toX;
    const ny = moving ? fromY + (toY - fromY) * u : toY;
    out.x = nx * ampX;
    out.y = ny * ampY;

    // flutter (never while perched: it rests)
    let lift = 0;
    let fHz = 0;
    if (flutterT >= 0) {
      flutterT += dt;
      if (flutterT >= flutterDur) {
        flutterT = -1;
        flutterAt = t + between(1.2, 3.5);
      } else {
        fHz = flutterHz;
        lift = -flutterLift * Math.sin(Math.PI * (flutterT / flutterDur));
      }
    } else if (!ctx.perched && t >= flutterAt) {
      flutterT = 0;
      flutterHz = between(3, 5);
      flutterDur = Math.round(between(2, 4.49)) / flutterHz;
      flutterLift = between(1, 3);
    }

    // glide / turn
    let yaw = 0;
    let roll = 0;
    if (turnT >= 0) {
      turnT += dt;
      if (turnT >= turnDur) {
        turnT = -1;
        turnAt = t + between(3, 7);
      } else {
        const e = Math.sin(Math.PI * (turnT / turnDur));
        yaw = turnYaw * e;
        roll = -turnYaw * 0.5 * e; // |roll| <= 10
      }
    } else if (!ctx.perched && t >= turnAt) {
      turnT = 0;
      turnDur = between(0.9, 1.4);
      turnYaw = sgn() * between(8, 20);
    }

    // glance
    let head = 0;
    if (glanceT >= 0) {
      glanceT += dt;
      if (glanceT >= glanceDur) {
        glanceT = -1;
        glanceAt = t + between(8, 14);
      } else {
        head = glanceDeg * Math.sin(Math.PI * (glanceT / glanceDur));
      }
    } else if (!ctx.perched && t >= glanceAt) {
      const g = ctx.glance?.() ?? null;
      if (g && Math.hypot(g.dx, g.dy) > 8) {
        glanceT = 0;
        glanceDur = between(0.4, 0.7);
        glanceDeg = (g.dx >= 0 ? 1 : -1) * between(6, 10);
      } else {
        glanceAt = t + between(1.5, 3);
      }
    }

    // perched: slow full wing open
    let open = 0;
    if (openT >= 0) {
      openT += dt;
      if (openT >= openDur) {
        openT = -1;
        openAt = t + between(8, 14);
      } else {
        open = Math.sin(Math.PI * (openT / openDur));
      }
    } else if (ctx.perched && t >= openAt) {
      openT = 0;
      openDur = between(1.6, 2.4);
    }

    // listening: lifted, 3-4 Hz flaps, lean toward the input
    const kl = 1 - Math.exp(-dt / 0.25);
    if (ctx.listening) {
      if (t >= leanAt) {
        leanAt = t + 0.5;
        const g = ctx.glance?.() ?? null;
        leanTarget = g ? (g.dx >= 0 ? 1 : -1) * Math.min(6, 2 + Math.abs(g.dx) / 40) : 0;
      }
      fHz = 3.5;
      liftSm += (-listenLift - liftSm) * kl;
    } else {
      leanTarget = 0;
      liftSm += (0 - liftSm) * kl;
    }
    lean += (leanTarget - lean) * kl;

    out.lift = (ctx.listening ? 0 : lift) + liftSm;
    out.yaw = yaw;
    out.roll = roll;
    out.head = head + lean;
    out.flutterHz = fHz;
    out.glow = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / glowPeriod + glowPhase);
    out.open = open;
    return out;
  }

  return { step, out, glowPeriod };
}
