// The single effects layer of the butterfly: one Canvas 2D under the SVG, pointer-events none, aria-hidden.
// It has no loop of its own: butterfly.ts calls trail()/frame() from its one rAF, and the layer sleeps when empty.
//
//   stardust  distance-emitted points from a pooled Float32Array, pre-rendered bokeh + 4-point glint sprites
//   silk      2-3 strands built from ~400ms of path history; at landing they settle into a gold underline
//   spark     10-16 particles flowing from a source rect/point into the butterfly (~160ms); from a far source
//             (> 200px) a thin bright streak is drawn source -> butterfly over ~180ms (the pick-up)
//   ripples   wavy voice rings with an echo line and a few twinkle motes
//   perf      20 consecutive frames > 24ms: DPR 1, half particles, one strand; again: stardust only
import type { Pt } from './math';

export type TrailMode = 'full' | 'light' | 'none';
export type Tier = 0 | 1 | 2;

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface EffectsOptions {
  /** Viewport counts as mobile (smaller particle cap). Default: width <= 768. */
  mobile?: () => boolean;
  /** Deterministic RNG for tests. */
  rng?: () => number;
}

export interface Effects {
  readonly canvas: HTMLCanvasElement;
  readonly tier: Tier;
  /** false = reduced motion: no particles, no ripples (static rings only). */
  setEnabled(on: boolean): void;
  /** `length` = planned path length in px; short flights (< 200px) get a denser trail. */
  beginFlight(mode: TrailMode, long: boolean, length?: number): void;
  /** Call every frame while flying with the body position. */
  trail(x: number, y: number): void;
  endFlight(landed: boolean): void;
  spark(from: RectLike | Pt, target: () => Pt, far?: boolean): void;
  /** Pick-up streak from a far source to the butterfly over `ms` (default 180). */
  streak(from: RectLike | Pt, target: () => Pt, ms?: number): void;
  underline(rect: RectLike): void;
  clearUnderline(): void;
  /** Start/stop emitting ripples. `maxR` is the outer radius (130 at home, ~90 elsewhere). */
  setVoice(on: boolean, maxR?: number): void;
  setVoiceLevel(level: number): void;
  leaveVoice(how: 'collapse' | 'fade'): void;
  /** Reduced motion: static rings around the butterfly, alpha by level. */
  setStaticRing(on: boolean): void;
  /** Advance and draw. Returns true while anything is still alive (the caller keeps its loop anyway). */
  frame(dtMs: number, pos: Pt): boolean;
  /** Feed the raw frame time to the perf governor (call while effects are active). */
  reportFrame(ms: number): void;
  liveParticles(): number;
  hasWork(): boolean;
  clear(): void;
  /** Global tempo (1 = design speed, 0.5 = twice as long). Particle / silk / spark / streak / underline lifetimes run on a
   *  design clock (real dt x scale), so the trail keeps its shape in slow motion. Voice ripple cadence stays real-time. */
  setTimeScale(scale: number): void;
  destroy(): void;
}

// ---- pool layout ----
const STRIDE = 13;
const X = 0, Y = 1, VX = 2, VY = 3, AGE = 4, LIFE = 5, SIZE = 6, SPR = 7, TWP = 8, TWH = 9, A0 = 10, CURVE = 11, SPARK = 12;

const CAP_DESKTOP = 160;
const CAP_MOBILE = 80;
const MAX_DPR = 1.5;
const SLOW_MS = 24;
const SLOW_RUN = 20;

const STRAND_W = 400; // ms of history a strand covers
const STRAND_PTS = 14;
const HIST = 192;
const SNAP_HOLD = 80; // ms a landed silk strand stays at full strength
const SNAP_MS = 400; // landed silk is gone 400ms after landing (spec: fades over 300-450ms)

const GOLD = '245,199,106';
const WARM = '255,243,196';
const WARM_RGB = `rgb(${WARM})`;
const GOLD_RGB = `rgb(${GOLD})`;

interface Ring {
  age: number;
  life: number;
  r1: number;
  a: number;
  phi: number;
  phi2: number;
  mode: 0 | 1 | 2; // live, fade, collapse
  modeT: number;
  rAtLeave: number;
}
interface Mote {
  ang: number;
  rad: number;
  age: number;
  life: number;
  ph: number;
}
interface Snap {
  pts: Float32Array[];
  age: number;
  landed: boolean;
}
interface Underline {
  age: number;
  x0: number;
  x1: number;
  y: number;
  pts: Float32Array[] | null;
}

const HAS_CANVAS = typeof document !== 'undefined' && !(typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent));

export function createEffects(layer: HTMLElement, opts: EffectsOptions = {}): Effects {
  const rnd = opts.rng ?? Math.random;
  const between = (a: number, b: number): number => a + (b - a) * rnd();
  const isMobile = opts.mobile ?? ((): boolean => typeof window !== 'undefined' && window.innerWidth <= 768);

  const canvas = document.createElement('canvas');
  canvas.className = 'bf-fx';
  canvas.setAttribute('aria-hidden', 'true');
  layer.appendChild(canvas);
  const ctx: CanvasRenderingContext2D | null = HAS_CANVAS ? canvas.getContext('2d') : null;

  let enabled = true;
  let tier: Tier = 0;
  let slowRun = 0;
  let T = 0; // ms, own DESIGN clock (real time x timeScale)
  let ts = 1; // time scale
  let dpr = 1;
  let cw = 0;
  let ch = 0;
  let bbox: [number, number, number, number] | null = null; // last drawn bounds (css px)
  let drewSomething = false;

  // ---- sprites ----
  let atlas: HTMLCanvasElement | null = null;
  const SP = 32;
  function buildAtlas(): HTMLCanvasElement | null {
    if (!ctx) return null;
    const c = document.createElement('canvas');
    c.width = SP * 3;
    c.height = SP;
    const g = c.getContext('2d');
    if (!g) return null;
    const bokeh = (i: number, inner: string, mid: string, outer: string): void => {
      const rg = g.createRadialGradient(SP * i + SP / 2, SP / 2, 0, SP * i + SP / 2, SP / 2, SP / 2);
      rg.addColorStop(0, inner);
      rg.addColorStop(0.28, mid);
      rg.addColorStop(0.62, outer);
      rg.addColorStop(1, `rgba(${GOLD},0)`);
      g.fillStyle = rg;
      g.fillRect(SP * i, 0, SP, SP);
    };
    bokeh(0, `rgba(${WARM},1)`, `rgba(255,236,180,0.7)`, `rgba(${GOLD},0.16)`);
    bokeh(1, `rgba(255,222,140,1)`, `rgba(${GOLD},0.62)`, `rgba(${GOLD},0.12)`);
    // glint: small core + four tapering spikes
    const cx = SP * 2 + SP / 2;
    const cy = SP / 2;
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, 6);
    core.addColorStop(0, `rgba(${WARM},1)`);
    core.addColorStop(1, `rgba(${GOLD},0)`);
    g.fillStyle = core;
    g.fillRect(SP * 2, 0, SP, SP);
    const spike = (dx: number, dy: number, len: number): void => {
      const lg = g.createLinearGradient(cx, cy, cx + dx * len, cy + dy * len);
      lg.addColorStop(0, `rgba(${WARM},0.95)`);
      lg.addColorStop(1, `rgba(${WARM},0)`);
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(cx + dy * 1.1, cy - dx * 1.1);
      g.lineTo(cx + dx * len, cy + dy * len);
      g.lineTo(cx - dy * 1.1, cy + dx * 1.1);
      g.closePath();
      g.fill();
    };
    spike(1, 0, 15);
    spike(-1, 0, 15);
    spike(0, 1, 15);
    spike(0, -1, 15);
    return c;
  }

  // ---- stardust pool ----
  const pool = new Float32Array(CAP_DESKTOP * STRIDE);
  for (let i = 0; i < CAP_DESKTOP; i++) pool[i * STRIDE + AGE] = pool[i * STRIDE + LIFE] = 1; // dead
  let cursor = 0;
  let live = 0;
  const capNow = (): number => {
    const base = isMobile() ? CAP_MOBILE : CAP_DESKTOP;
    return tier >= 1 ? Math.max(8, base >> 1) : base;
  };

  function alloc(): number {
    live++; // conservative: recounted exactly in frame(); lets frame() skip the pool scan when nothing was emitted
    const cap = capNow();
    for (let n = 0; n < cap; n++) {
      const i = (cursor + n) % cap;
      if (pool[i * STRIDE + AGE] >= pool[i * STRIDE + LIFE]) {
        cursor = (i + 1) % cap;
        return i * STRIDE;
      }
    }
    const i = cursor % cap; // full: recycle round-robin (oldest-ish)
    cursor = (i + 1) % cap;
    return i * STRIDE;
  }

  function emitDust(x: number, y: number, nx: number, ny: number, mode: TrailMode): void {
    const o = alloc();
    const r = rnd();
    const kind = r < 0.09 ? 2 : r < 0.3 ? 1 : 0; // glints 9%, mid 21%, dim 70%
    const sign = rnd() < 0.5 ? -1 : 1;
    const off = sign * between(2, 9);
    pool[o + X] = x + nx * off;
    pool[o + Y] = y + ny * off;
    pool[o + VX] = nx * sign * between(5, 14) + between(-8, 8);
    pool[o + VY] = ny * sign * between(5, 14) + between(-8, 8) - 3;
    pool[o + AGE] = 0;
    pool[o + LIFE] = Math.min(900, 380 + 520 * Math.pow(rnd(), 1.15) + (kind === 2 ? 100 : 0));
    pool[o + SIZE] = kind === 2 ? between(5.5, 9) : kind === 1 ? between(1.8, 2.8) : between(1.1, 1.8);
    pool[o + SPR] = kind === 2 ? 2 : rnd() < 0.55 ? 0 : 1;
    pool[o + TWP] = rnd() * 6.283;
    pool[o + TWH] = between(1.5, 4);
    pool[o + A0] = (kind === 2 ? 1 : kind === 1 ? 0.85 : 0.55) * (mode === 'light' ? 0.55 : 1);
    pool[o + CURVE] = 0;
    pool[o + SPARK] = 0;
  }

  // ---- flight trail state ----
  let flying = false;
  let mode: TrailMode = 'none';
  let strandN = 0;
  let flightT = 0;
  let lastX = 0;
  let lastY = 0;
  let haveLast = false;
  let acc = 0;
  let step = 8;
  let density = 1; // step multiplier: < 1 on short flights (denser per pixel)
  let dirX = 0;
  let dirY = -1;
  const hx = new Float32Array(HIST);
  const hy = new Float32Array(HIST);
  const ht = new Float32Array(HIST);
  let hHead = 0;
  let hCount = 0;
  const strandBuf = new Float32Array(STRAND_PTS * 2); // scratch for the live strands (no per-frame allocation)
  const phiK = [0, 2.1, 4.2];
  const ampK = [7, 11, 15];
  const sgnK = [1, -1, 1];

  const stepLen = (): number => {
    let s = mode === 'light' ? between(12, 18) : between(5, 8.5);
    if (flightT < 150 && mode === 'full') s *= 0.6; // denser at take-off
    s *= density;
    if (tier >= 1) s *= 2;
    return s;
  };

  function beginFlight(m: TrailMode, long: boolean, length = 300): void {
    if (flying) endFlight(false);
    density = length < 200 ? 0.4 + 0.6 * Math.max(0, length) / 200 : 1; // 0.4 at 0px .. 1 at 200px
    if (length < 200 && m === 'light') density *= 0.8;
    flying = enabled && m !== 'none';
    mode = m;
    flightT = 0;
    haveLast = false;
    acc = 0;
    hCount = 0;
    hHead = 0;
    step = stepLen();
    strandN = m === 'none' ? 0 : m === 'light' ? 1 : long ? 3 : 2;
    if (length < 200 && m === 'full') strandN = 2;
    if (tier >= 1) strandN = Math.min(strandN, 1);
    if (tier >= 2) strandN = 0;
  }

  function pushHist(x: number, y: number): void {
    hx[hHead] = x;
    hy[hHead] = y;
    ht[hHead] = T;
    hHead = (hHead + 1) % HIST;
    if (hCount < HIST) hCount++;
  }

  function trail(x: number, y: number): void {
    if (!flying || !enabled) return;
    pushHist(x, y);
    if (!haveLast) {
      haveLast = true;
      lastX = x;
      lastY = y;
      return;
    }
    const dx = x - lastX;
    const dy = y - lastY;
    const d = Math.hypot(dx, dy);
    if (d > 0.01) {
      dirX = dx / d;
      dirY = dy / d;
      const nx = -dirY;
      const ny = dirX;
      let rem = d;
      let px = lastX;
      let py = lastY;
      let guard = 0;
      while (acc + rem >= step && guard++ < 12) {
        const e = step - acc;
        px += dirX * e;
        py += dirY * e;
        rem -= e;
        acc = 0;
        emitDust(px, py, nx, ny, mode);
        step = stepLen();
      }
      acc += rem;
    }
    lastX = x;
    lastY = y;
  }

  // ---- silk ----
  let snaps: Snap[] = [];
  let ul: Underline | null = null;

  /** Position along the history `age` ms ago (clamped to the oldest sample). */
  function strandPoints(k: number, out: Float32Array): void {
    const n = STRAND_PTS;
    if (hCount === 0) {
      out.fill(0);
      return;
    }
    // walk from the newest sample backwards
    const newest = (hHead - 1 + HIST) % HIST;
    let idx = newest;
    let used = 1;
    let nxv = 0;
    let nyv = 0;
    for (let j = 0; j < n; j++) {
      const frac = j / (n - 1);
      const a = frac * STRAND_W;
      const want = T - a;
      while (used < hCount && ht[idx] > want) {
        idx = (idx - 1 + HIST) % HIST;
        used++;
      }
      const older = idx;
      const newer = (idx + 1) % HIST;
      let px = hx[older];
      let py = hy[older];
      if (ht[idx] <= want && idx === newest) {
        px = hx[idx];
        py = hy[idx];
      } else if (ht[idx] <= want) {
        // interpolate between older and newer
        const t0 = ht[older];
        const t1 = ht[newer];
        const u = t1 > t0 ? Math.min(1, Math.max(0, (want - t0) / (t1 - t0))) : 0;
        const ex = hx[newer];
        const ey = hy[newer];
        px = hx[older] + (ex - hx[older]) * u;
        py = hy[older] + (ey - hy[older]) * u;
        const sx = ex - hx[older];
        const sy = ey - hy[older];
        const sl = Math.hypot(sx, sy);
        if (sl > 0.01) {
          nxv = -sy / sl;
          nyv = sx / sl;
        }
      }
      if (nxv === 0 && nyv === 0) {
        nxv = -dirY;
        nyv = dirX;
      }
      const w = sgnK[k] * ampK[k] * Math.pow(frac, 1.15) * Math.sin(frac * 7.5 + phiK[k] + T * 0.0035);
      let ox = 0;
      let oy = 0;
      if (j === 0) {
        ox = (k - 1) * 3;
        oy = 8;
      }
      out[j * 2] = px + nxv * w + ox;
      out[j * 2 + 1] = py + nyv * w + oy;
    }
  }

  function endFlight(landed: boolean): void {
    if (!flying) return;
    flying = false;
    if (strandN > 0 && hCount > 3 && enabled) {
      const pts: Float32Array[] = [];
      for (let k = 0; k < strandN; k++) {
        const a = new Float32Array(STRAND_PTS * 2);
        strandPoints(k, a);
        pts.push(a);
      }
      snaps.push({ pts, age: 0, landed });
      if (snaps.length > 2) snaps.shift();
    }
    strandN = 0;
  }

  // ---- spark ----
  function spark(from: RectLike | Pt, far = false): void {
    if (!enabled) return;
    const n = far ? Math.round(between(18, 24)) : Math.round(between(10, 16));
    const isRect = 'width' in from;
    for (let i = 0; i < n; i++) {
      const o = alloc();
      const sx = isRect ? from.left + rnd() * from.width : from.x + between(-4, 4);
      const sy = isRect ? from.top + rnd() * from.height : from.y + between(-4, 4);
      pool[o + X] = sx;
      pool[o + Y] = sy;
      pool[o + VX] = sx; // spark: start point
      pool[o + VY] = sy;
      pool[o + AGE] = -between(0, 40); // stagger = a stream
      pool[o + LIFE] = far ? between(150, 190) : between(115, 150);
      pool[o + SIZE] = rnd() < 0.12 ? between(4.5, 6) : between(1.4, 2.4);
      pool[o + SPR] = pool[o + SIZE] > 4 ? 2 : rnd() < 0.5 ? 0 : 1;
      pool[o + TWP] = rnd() * 6.283;
      pool[o + TWH] = 3;
      pool[o + A0] = 0.95;
      pool[o + CURVE] = between(-14, 14);
      pool[o + SPARK] = 1;
    }
  }
  let sparkTarget: () => Pt = () => ({ x: 0, y: 0 });
  const sparkApi = (from: RectLike | Pt, target: () => Pt, far = false): void => {
    sparkTarget = target;
    spark(from, far);
  };

  // ---- pick-up streak (far sources) ----
  interface Streak {
    sx: number;
    sy: number;
    age: number;
    life: number;
  }
  const STREAK_LINGER = 110; // ms the connected line stays and fades after the head arrives
  const streaks: Streak[] = [];
  function streak(from: RectLike | Pt, target: () => Pt, ms = 180): void {
    if (!enabled) return;
    sparkTarget = target;
    const isRect = 'width' in from;
    streaks.push({
      sx: isRect ? from.left + from.width / 2 : from.x,
      sy: isRect ? from.top + from.height / 2 : from.y,
      age: 0,
      life: ms,
    });
    if (streaks.length > 3) streaks.shift();
  }
  function drawStreaks(g: CanvasRenderingContext2D, tgt: Pt): void {
    for (const st of streaks) {
      const p = Math.min(1, st.age / st.life);
      const lin = st.age <= st.life ? 0 : Math.min(1, (st.age - st.life) / STREAK_LINGER);
      const head = 1 - Math.pow(1 - p, 2.2); // fast out of the source, easing into the butterfly
      const tail = Math.max(0, head - 0.5) + (1 - Math.max(0, head - 0.5)) * easeIO(lin) * (head >= 1 ? 1 : 0);
      const a = (1 - lin * lin) * Math.min(1, st.age / 24);
      if (a < 0.01 || tail >= 0.999) continue;
      const dx = tgt.x - st.sx;
      const dy = tgt.y - st.sy;
      const hx2 = st.sx + dx * head;
      const hy2 = st.sy + dy * head;
      const tx = st.sx + dx * tail;
      const ty = st.sy + dy * tail;
      const lg = g.createLinearGradient(tx, ty, hx2, hy2);
      lg.addColorStop(0, `rgba(${WARM},0)`);
      lg.addColorStop(0.7, `rgba(${WARM},0.55)`);
      lg.addColorStop(1, `rgba(255,255,255,1)`);
      g.lineCap = 'round';
      g.strokeStyle = lg;
      g.globalAlpha = a * 0.35; // soft glow pass
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(hx2, hy2);
      g.stroke();
      g.globalAlpha = a; // bright core
      g.lineWidth = 1.7;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(hx2, hy2);
      g.stroke();
      if (atlas) {
        g.globalAlpha = a;
        g.drawImage(atlas, 2 * SP, 0, SP, SP, hx2 - 11, hy2 - 11, 22, 22);
      }
      touch(Math.min(tx, hx2) - 14, Math.min(ty, hy2) - 14, Math.max(tx, hx2) + 14, Math.max(ty, hy2) + 14);
    }
    g.globalAlpha = 1;
  }

  // ---- voice ripples ----
  let voiceOn = false;
  let voiceMaxR = 130;
  let level = 0;
  let nextRing = 0;
  let staticRing = false;
  const rings: Ring[] = [];
  const motes: Mote[] = [];

  function setVoice(on: boolean, maxR = 130): void {
    voiceMaxR = maxR;
    if (on && !voiceOn) {
      voiceOn = true;
      nextRing = 0;
    } else if (!on) {
      voiceOn = false;
    }
  }
  function leaveVoice(how: 'collapse' | 'fade'): void {
    voiceOn = false;
    for (const r of rings) {
      if (r.mode === 2) continue;
      if (r.mode === 1 && how === 'fade') continue;
      r.mode = how === 'collapse' ? 2 : 1;
      r.modeT = 0;
      r.rAtLeave = ringRadius(r);
    }
    for (const m of motes) m.life = Math.min(m.life, m.age + 200);
  }
  function ringRadius(r: Ring): number {
    const p = Math.min(1, r.age / r.life);
    return 18 + (r.r1 - 18) * (1 - Math.pow(1 - p, 2.2));
  }
  function spawnRing(): void {
    rings.push({
      age: 0,
      life: between(1100, 1300),
      r1: voiceMaxR * between(0.92, 1.05),
      a: between(3, 6),
      phi: rnd() * 6.283,
      phi2: rnd() * 6.283,
      mode: 0,
      modeT: 0,
      rAtLeave: 0,
    });
    if (rings.length > 6) rings.shift();
  }
  function updateVoice(dt: number, dtd: number, tier2: boolean): void {
    if (voiceOn) {
      nextRing -= dt;
      if (nextRing <= 0) {
        spawnRing();
        nextRing = (460 - 140 * level) * between(0.94, 1.06); // 320-460ms, shorter when louder
      }
      if (!tier2 && motes.length < 6 && rnd() < dt / 160) {
        motes.push({ ang: rnd() * 6.283, rad: between(28, voiceMaxR * 0.95), age: 0, life: between(700, 1300), ph: rnd() * 6.283 });
      }
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.age += dt;
      if (r.mode !== 0) r.modeT += dtd;
      if (r.age >= r.life || (r.mode !== 0 && r.modeT >= 200)) rings.splice(i, 1);
    }
    for (let i = motes.length - 1; i >= 0; i--) {
      motes[i].age += dt;
      if (motes[i].age >= motes[i].life) motes.splice(i, 1);
    }
  }

  function ringPath(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, a: number, phi: number, phi2: number): void {
    const N = 56;
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * 6.2832;
      const r = R + a * (0.65 * Math.sin(5 * th + phi) + 0.35 * Math.cos(7 * th - phi2));
      const x = cx + Math.cos(th) * r;
      const y = cy + Math.sin(th) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  }

  // ---- bounds + canvas ----
  let bx0 = 0, by0 = 0, bx1 = 0, by1 = 0, bset = false;
  const touch = (x0: number, y0: number, x1: number, y1: number): void => {
    if (!bset) {
      bx0 = x0; by0 = y0; bx1 = x1; by1 = y1; bset = true;
    } else {
      if (x0 < bx0) bx0 = x0;
      if (y0 < by0) by0 = y0;
      if (x1 > bx1) bx1 = x1;
      if (y1 > by1) by1 = y1;
    }
  };

  function ensureSize(): boolean {
    if (typeof window === 'undefined') return false;
    const want = tier >= 1 ? 1 : Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (want === dpr && w === cw && h === ch && canvas.width > 0) return false;
    dpr = want;
    cw = w;
    ch = h;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    bbox = null;
    return true;
  }

  function wipe(): void {
    if (!ctx || !drewSomething) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (bbox) {
      const m = 4;
      ctx.clearRect(
        Math.floor((bbox[0] - m) * dpr),
        Math.floor((bbox[1] - m) * dpr),
        Math.ceil((bbox[2] - bbox[0] + 2 * m) * dpr),
        Math.ceil((bbox[3] - bbox[1] + 2 * m) * dpr),
      );
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    drewSomething = false;
    bbox = null;
  }

  const easeIO = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

  function hasWorkNow(): boolean {
    return live > 0 || streaks.length > 0 || snaps.length > 0 || ul !== null || rings.length > 0 || motes.length > 0 || voiceOn || staticRing || flying;
  }

  // ---- per frame ----
  function frame(dtMs: number, pos: Pt): boolean {
    const rdt = Math.min(Math.max(dtMs, 0), 50); // real ms: voice cadence
    const dt = rdt * ts; // design ms: everything else
    T += dt;
    if (flying) flightT += dt;
    // Nothing alive and nothing left on the canvas: skip the pool scan and the simulation entirely.
    if (!hasWorkNow() && !drewSomething) return false;

    // simulate particles (also without a 2D context, so the pool is testable)
    let nl = 0;
    const cap = capNow();
    for (let i = 0; i < CAP_DESKTOP && live > 0; i++) {
      const o = i * STRIDE;
      if (pool[o + AGE] >= pool[o + LIFE]) continue;
      if (i >= cap && !pool[o + SPARK]) {
        pool[o + LIFE] = 0;
        pool[o + AGE] = 1;
        continue;
      }
      pool[o + AGE] += dt;
      if (pool[o + AGE] >= pool[o + LIFE]) continue;
      nl++;
      if (pool[o + AGE] > 0 && !pool[o + SPARK]) {
        const k = Math.exp(-dt / 700);
        pool[o + X] += (pool[o + VX] * dt) / 1000;
        pool[o + Y] += (pool[o + VY] * dt) / 1000;
        pool[o + VX] *= k;
        pool[o + VY] *= k;
      }
    }
    live = nl;
    for (let i = snaps.length - 1; i >= 0; i--) {
      snaps[i].age += dt;
      if (snaps[i].age > SNAP_MS) snaps.splice(i, 1);
    }
    if (ul) {
      ul.age += dt;
      if (ul.age > 950) ul = null;
    }
    for (let i = streaks.length - 1; i >= 0; i--) {
      streaks[i].age += dt;
      if (streaks[i].age > streaks[i].life + STREAK_LINGER) streaks.splice(i, 1);
    }
    updateVoice(rdt, dt, tier >= 2);

    if (!ctx) return hasWorkNow();
    if (!hasWorkNow() && !drewSomething) return false;

    ensureSize();
    wipe();
    if (!hasWorkNow()) return false;
    const g = ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    bset = false;
    if (!atlas) atlas = buildAtlas();

    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // silk: live strands + settling snapshots
    const intensity = mode === 'light' ? 0.6 : 1;
    if (flying && strandN > 0 && hCount > 1) {
      for (let k = 0; k < strandN; k++) {
        strandPoints(k, strandBuf);
        drawStrand(g, strandBuf, intensity * Math.min(1, flightT / 120));
      }
    }
    for (const s of snaps) {
      const f = s.landed ? (s.age < SNAP_HOLD ? 0.9 : Math.max(0, 0.9 * (1 - (s.age - SNAP_HOLD) / (SNAP_MS - SNAP_HOLD)))) : Math.max(0, 0.9 * (1 - s.age / 380));
      if (f <= 0) continue;
      for (const p of s.pts) drawStrand(g, p, f * 0.9);
    }

    // stardust + spark
    if (streaks.length > 0) drawStreaks(g, sparkTarget());
    if (atlas && live > 0) {
      const tgt = sparkTarget();
      for (let i = 0; i < CAP_DESKTOP; i++) {
        const o = i * STRIDE;
        const age = pool[o + AGE];
        const life = pool[o + LIFE];
        if (age >= life || age < 0) continue;
        const p = age / life;
        let x = pool[o + X];
        let y = pool[o + Y];
        let a: number;
        if (pool[o + SPARK]) {
          const sx = pool[o + VX];
          const sy = pool[o + VY];
          const e = p * p * (3 - 2 * p);
          const dx = tgt.x - sx;
          const dy = tgt.y - sy;
          const dl = Math.hypot(dx, dy) || 1;
          const bend = pool[o + CURVE] * Math.sin(Math.PI * p);
          x = sx + dx * e + (-dy / dl) * bend;
          y = sy + dy * e + (dx / dl) * bend;
          a = pool[o + A0] * Math.min(1, p * 8) * (1 - p * p * p);
        } else {
          const tw = 1 - 0.18 * (0.5 + 0.5 * Math.sin(pool[o + TWH] * 6.2832 * (T / 1000) + pool[o + TWP]));
          a = pool[o + A0] * Math.min(1, age / 50) * Math.pow(1 - p, 1.4) * tw;
        }
        if (a < 0.01) continue;
        const spr = pool[o + SPR];
        const h = spr === 2 ? pool[o + SIZE] * 1.7 : pool[o + SIZE] * 2.3;
        g.globalAlpha = a;
        g.drawImage(atlas, spr * SP, 0, SP, SP, x - h, y - h, h * 2, h * 2);
        touch(x - h, y - h, x + h, y + h);
      }
      g.globalAlpha = 1;
    }

    // voice ripples / motes / static rings
    if (rings.length > 0 || motes.length > 0) drawVoice(g, pos);
    if (staticRing) drawStatic(g, pos);

    g.globalCompositeOperation = 'source-over';
    if (ul) drawUnderline(g);
    g.globalAlpha = 1;

    drewSomething = bset;
    bbox = bset ? [bx0, by0, bx1, by1] : null;
    return hasWorkNow();
  }

  function drawStrand(g: CanvasRenderingContext2D, p: Float32Array, intensity: number): void {
    const n = STRAND_PTS;
    g.strokeStyle = WARM_RGB;
    for (let j = 0; j < n - 1; j++) {
      const f = j / (n - 1);
      const a = 0.65 * Math.pow(1 - f, 1.05) * intensity;
      if (a < 0.01) continue;
      const cx = p[j * 2];
      const cy = p[j * 2 + 1];
      const sx = j === 0 ? cx : (p[j * 2 - 2] + cx) / 2;
      const sy = j === 0 ? cy : (p[j * 2 - 1] + cy) / 2;
      const ex = (cx + p[j * 2 + 2]) / 2;
      const ey = (cy + p[j * 2 + 3]) / 2;
      if (Math.abs(ex - sx) + Math.abs(ey - sy) < 0.3) continue;
      g.globalAlpha = a;
      g.lineWidth = 1.3 - 0.95 * f;
      g.beginPath();
      g.moveTo(sx, sy);
      g.quadraticCurveTo(cx, cy, ex, ey);
      g.stroke();
      touch(Math.min(sx, cx, ex) - 2, Math.min(sy, cy, ey) - 2, Math.max(sx, cx, ex) + 2, Math.max(sy, cy, ey) + 2);
    }
  }

  function drawVoice(g: CanvasRenderingContext2D, pos: Pt): void {
    const lv = 0.85 + 0.15 * level;
    for (const r of rings) {
      let R = ringRadius(r);
      const p = Math.min(1, r.age / r.life);
      let alpha = 0.5 * Math.pow(1 - p, 0.9) * Math.min(1, r.age / 100) * lv;
      if (r.mode !== 0) {
        const e = Math.min(1, r.modeT / 200);
        if (r.mode === 2) {
          R = r.rAtLeave * (1 - easeIO(e));
          alpha *= 1 - 0.6 * e;
        } else {
          alpha *= 1 - e;
        }
      }
      if (alpha < 0.01 || R < 1) continue;
      const rot = r.age * 0.0007;
      g.strokeStyle = WARM_RGB;
      g.globalAlpha = alpha;
      g.lineWidth = 1.15 + 0.15 * lv;
      ringPath(g, pos.x, pos.y, R, r.a * (0.75 + 0.25 * p), r.phi + rot, r.phi2 - rot * 0.7);
      g.stroke();
      if (tier < 2) {
        g.globalAlpha = alpha * 0.32;
        g.lineWidth = 0.7;
        ringPath(g, pos.x, pos.y, R * 0.935, r.a * 0.8, r.phi + 1.3 - rot, r.phi2 + 0.9 + rot * 0.5);
        g.stroke();
      }
      touch(pos.x - R - 10, pos.y - R - 10, pos.x + R + 10, pos.y + R + 10);
    }
    if (atlas) {
      for (const m of motes) {
        const p = m.age / m.life;
        const a = Math.sin(Math.PI * p) * (0.55 + 0.3 * Math.sin(m.ph + T * 0.018)) * 0.8;
        if (a < 0.02) continue;
        const x = pos.x + Math.cos(m.ang) * m.rad;
        const y = pos.y + Math.sin(m.ang) * m.rad;
        g.globalAlpha = a;
        g.drawImage(atlas, 0, 0, SP, SP, x - 3.6, y - 3.6, 7.2, 7.2);
        touch(x - 4, y - 4, x + 4, y + 4);
      }
    }
    g.globalAlpha = 1;
  }

  function drawStatic(g: CanvasRenderingContext2D, pos: Pt): void {
    g.strokeStyle = GOLD_RGB;
    g.lineWidth = 1;
    const radii = [42, 68, 94];
    for (let i = 0; i < radii.length; i++) {
      g.globalAlpha = (0.2 - i * 0.04) * (0.6 + 0.4 * level);
      g.beginPath();
      g.arc(pos.x, pos.y, radii[i], 0, 6.2832);
      g.stroke();
    }
    touch(pos.x - 100, pos.y - 100, pos.x + 100, pos.y + 100);
    g.globalAlpha = 1;
  }

  function drawUnderline(g: CanvasRenderingContext2D): void {
    const u = ul;
    if (!u) return;
    const age = u.age;
    const e = easeIO(age / 260);
    const lineA = age < 560 ? e : Math.max(0, 1 - (age - 560) / 390);
    if (lineA <= 0) return;
    const len = u.x1 - u.x0;
    const grow = u.pts ? 1 : easeIO(age / 220);
    const xe = u.x0 + len * grow;
    // silk strands settling into the line
    if (u.pts && age < 330) {
      g.globalCompositeOperation = 'lighter';
      for (const pts of u.pts) {
        const n = STRAND_PTS;
        const headNearRight = Math.abs(pts[0] - u.x1) < Math.abs(pts[0] - u.x0);
        const qx0 = headNearRight ? u.x1 : u.x0; // strand position f along the line: qx0 + qdir * len * f
        const qdir = headNearRight ? -1 : 1;
        g.strokeStyle = WARM_RGB;
        for (let j = 0; j < n - 1; j++) {
          const f0 = j / (n - 1);
          const f1 = (j + 1) / (n - 1);
          const ax = pts[j * 2] + (qx0 + qdir * len * f0 - pts[j * 2]) * e;
          const ay = pts[j * 2 + 1] + (u.y - pts[j * 2 + 1]) * e;
          const bx = pts[j * 2 + 2] + (qx0 + qdir * len * f1 - pts[j * 2 + 2]) * e;
          const by = pts[j * 2 + 3] + (u.y - pts[j * 2 + 3]) * e;
          g.globalAlpha = 0.5 * Math.pow(1 - f0, 1.1) * (1 - e) * 0.9;
          if (g.globalAlpha < 0.01) continue;
          g.lineWidth = 1.2 - 0.9 * f0 + 0.6 * e;
          g.beginPath();
          g.moveTo(ax, ay);
          g.lineTo(bx, by);
          g.stroke();
          touch(Math.min(ax, bx) - 2, Math.min(ay, by) - 2, Math.max(ax, bx) + 2, Math.max(ay, by) + 2);
        }
      }
      g.globalCompositeOperation = 'source-over';
    }
    const lg = g.createLinearGradient(u.x0, 0, xe, 0);
    lg.addColorStop(0, `rgba(${GOLD},0)`);
    lg.addColorStop(0.18, `rgba(255,214,128,${0.9 * lineA})`);
    lg.addColorStop(0.82, `rgba(255,214,128,${0.9 * lineA})`);
    lg.addColorStop(1, `rgba(${GOLD},0)`);
    g.globalAlpha = 1;
    g.strokeStyle = lg;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(u.x0, u.y);
    g.lineTo(xe, u.y);
    g.stroke();
    touch(u.x0 - 2, u.y - 3, xe + 2, u.y + 3);
  }

  function underline(rect: RectLike): void {
    if (!enabled) return;
    const w = Math.max(rect.width, 1);
    const len = Math.max(10, w * 0.6);
    let pts: Float32Array[] | null = null;
    const s = snaps.length ? snaps[snaps.length - 1] : null;
    if (s && s.landed && s.age < SNAP_MS) {
      pts = s.pts;
      snaps = snaps.filter((x) => x !== s);
    }
    ul = { age: 0, x0: rect.left, x1: rect.left + len, y: rect.top - 2, pts };
  }

  function reportFrame(ms: number): void {
    if (ms > 200) return; // hitch or throttled tab: not a signal
    if (ms > SLOW_MS) {
      if (++slowRun >= SLOW_RUN && tier < 2) {
        tier = (tier + 1) as Tier;
        slowRun = 0;
        if (tier === 1) {
          ensureSize();
          strandN = Math.min(strandN, 1);
        } else {
          strandN = 0;
        }
      }
    } else {
      slowRun = 0;
    }
  }

  function clear(): void {
    pool.forEach((_, i) => {
      if (i % STRIDE === AGE) pool[i] = 1;
      if (i % STRIDE === LIFE) pool[i] = 1;
    });
    live = 0;
    snaps = [];
    ul = null;
    streaks.length = 0;
    rings.length = 0;
    motes.length = 0;
    voiceOn = false;
    flying = false;
    staticRing = false;
    if (ctx && drewSomething) {
      wipe();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  return {
    canvas,
    get tier() {
      return tier;
    },
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      if (!on) {
        const keepStatic = staticRing;
        clear();
        staticRing = keepStatic;
      }
    },
    beginFlight,
    trail,
    endFlight,
    spark: sparkApi,
    streak,
    underline,
    clearUnderline() {
      ul = null;
    },
    setVoice,
    setTimeScale(s) {
      ts = Math.min(4, Math.max(0.1, s || 1));
    },
    setVoiceLevel(l) {
      level = Math.min(1, Math.max(0, l));
    },
    leaveVoice,
    setStaticRing(on) {
      staticRing = on;
    },
    frame,
    reportFrame,
    liveParticles: () => live,
    hasWork: hasWorkNow,
    clear,
    destroy() {
      clear();
      canvas.remove();
    },
  };
}
