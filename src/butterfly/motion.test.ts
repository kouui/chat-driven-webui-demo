// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createButterfly } from './butterfly';
import type { ButterflyFx } from './butterfly';

let queue: Map<number, FrameRequestCallback>;
let nextId: number;
let now: number;
function step(frames = 1): void {
  for (let i = 0; i < frames; i++) {
    const cbs = [...queue.values()];
    queue.clear();
    now += 16.667;
    for (const cb of cbs) cb(now);
  }
}
const pos = (layer: HTMLElement): { x: number; y: number } => {
  const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec((layer.firstElementChild as HTMLElement).style.transform);
  return { x: Number(m?.[1]), y: Number(m?.[2]) };
};

let layer: HTMLElement;
let bf: ButterflyFx;
beforeEach(() => {
  queue = new Map();
  nextId = 1;
  now = 1000;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.set(nextId, cb);
    return nextId++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id));
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.body.innerHTML = '<div id="layer"></div>';
  layer = document.getElementById('layer') as HTMLElement;
  bf = createButterfly(layer, { reducedMotion: false, home: () => ({ x: 200, y: 600 }), seed: 1 });
});
afterEach(() => {
  bf.destroy();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('flight callbacks', () => {
  it('honours minDuration and calls onApproach exactly once, 300ms before landing', async () => {
    let landed = false;
    let approachAt = -1;
    let frames = 0;
    const onApproach = vi.fn(() => (approachAt = frames));
    const p = bf.flyTo({ x: 700, y: 300 }, { minDuration: 1000, onApproach }).then((v) => (landed = v));
    while (!landed && frames < 200) {
      frames++;
      step(1);
      await Promise.resolve();
    }
    expect(onApproach).toHaveBeenCalledTimes(1);
    expect(frames * 16.667).toBeGreaterThanOrEqual(1000 - 70); // first frame may count a clamped 50ms
    const remaining = frames * 16.667 - approachAt * 16.667;
    expect(remaining).toBeLessThanOrEqual(320);
    expect(remaining).toBeGreaterThanOrEqual(270);
    await p;
  });
  it('short flights call onApproach right away (at most one frame in)', () => {
    const onApproach = vi.fn();
    void bf.flyTo({ x: 202, y: 600 }, { onApproach });
    step(2);
    expect(onApproach).toHaveBeenCalledTimes(1);
  });
  it('never calls onApproach for a cancelled flight', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const pa = bf.flyTo({ x: 900, y: 100 }, { onApproach: a });
    step(5); // far from landing
    const pb = bf.flyTo({ x: 100, y: 100 }, { onApproach: b });
    expect(await pa).toBe(false);
    step(120);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(await pb).toBe(true);
  });
  it('retarget keeps the motion continuous (no jump, no restart from rest)', () => {
    void bf.flyTo({ x: 1100, y: 200 });
    step(18);
    const before = pos(layer);
    step(1);
    const mid = pos(layer);
    const v = { x: mid.x - before.x, y: mid.y - before.y };
    void bf.flyTo({ x: 300, y: 100 });
    step(1);
    const after = pos(layer);
    const v2 = { x: after.x - mid.x, y: after.y - mid.y };
    expect(Math.hypot(v.x, v.y)).toBeGreaterThan(3); // really moving
    expect(Math.hypot(v2.x - v.x, v2.y - v.y)).toBeLessThan(Math.hypot(v.x, v.y) * 0.6);
    // peak per-frame step <= max(entry speed, cap) * dt (+ slack) over the whole second flight
    let last = after;
    let maxStep = 0;
    for (let i = 0; i < 100; i++) {
      step(1);
      const p = pos(layer);
      maxStep = Math.max(maxStep, Math.hypot(p.x - last.x, p.y - last.y));
      last = p;
    }
    expect(maxStep).toBeLessThanOrEqual(Math.max(Math.hypot(v.x, v.y), 1100 * 0.01667) * 1.15);
  });
});

describe('voice mode and effects', () => {
  it('voice -> flyTo collapses ripples and still lands; level is accepted', async () => {
    bf.setMode('voice');
    bf.setVoiceLevel(0.8);
    step(60);
    const p = bf.flyTo({ x: 600, y: 300 });
    step(150);
    expect(await p).toBe(true);
    expect(bf.perfTier()).toBe(0);
  });
  it('spark and underline are safe, position() tracks the body', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    bf.spark(el);
    bf.spark({ x: 10, y: 10 });
    step(30);
    const p = bf.position();
    expect(Math.abs(p.x - 200)).toBeLessThan(40);
    bf.underline(el);
    step(10);
  });
  it('only one rAF is pending while effects run', () => {
    void bf.flyTo({ x: 800, y: 200 });
    bf.spark({ x: 5, y: 5 });
    bf.setMode('voice');
    for (let i = 0; i < 60; i++) {
      step(1);
      expect(queue.size).toBeLessThanOrEqual(1);
    }
  });
  it('reduced motion: no flight, no particles; onApproach still fires before the promise resolves', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    bf.setReducedMotion(true);
    const order: string[] = [];
    const p = bf.flyTo({ x: 700, y: 300 }, { onApproach: () => order.push('approach') }).then((v) => order.push('landed:' + v));
    bf.spark({ x: 1, y: 1 });
    await vi.advanceTimersByTimeAsync(400);
    await p;
    step(3);
    expect(order).toEqual(['approach', 'landed:true']);
    expect(bf.fxLive()).toBe(0);
    expect(pos(layer).x).toBeCloseTo(700, 0);
  });
});

// ---- helpers for measured flights ----
function mockRect(el: Element, r: { left: number; top: number; width: number; height: number }): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON() {} }) as DOMRect;
}
function mkTarget(rect: { left: number; top: number; width: number; height: number }, perch = 't'): HTMLElement {
  const el = document.createElement('div');
  el.dataset.perch = perch;
  mockRect(el, rect);
  document.body.appendChild(el);
  return el;
}
/** Fly to `el`, moving it via `move(frame)` before each frame; returns peak/mean of the per-frame steps. */
async function measure(el: HTMLElement, move: (frame: number) => void, opts: Record<string, unknown> = {}) {
  let landed = false;
  void bf.flyTo(el, { side: 'inside-top-left', ...opts }).then(() => (landed = true));
  let last = pos(layer);
  let len = 0;
  let peak = 0;
  let frames = 0;
  let maxJump = 0;
  while (!landed && frames < 200) {
    move(frames);
    frames++;
    step(1);
    await Promise.resolve();
    const p = pos(layer);
    const d = Math.hypot(p.x - last.x, p.y - last.y);
    len += d;
    peak = Math.max(peak, d / 0.016667);
    maxJump = Math.max(maxJump, d);
    last = p;
  }
  const mean = len / (frames * 0.016667);
  return { ratio: peak / mean, peak, mean, frames, len, maxJump };
}

describe('A3 timing: peak/mean <= 1.7 for every flight', () => {
  it('a plain flight', async () => {
    const el = mkTarget({ left: 900, top: 200, width: 200, height: 40 });
    const m = await measure(el, () => {});
    expect(m.ratio).toBeLessThanOrEqual(1.7);
  });
  it('a target that slides 90px while the butterfly flies (shell / content slide): no replan spike', async () => {
    const r = { left: 900, top: 200, width: 200, height: 40 };
    const el = mkTarget(r);
    const m = await measure(el, (f) => {
      r.left = 900 + Math.min(90, f * 4);
      mockRect(el, r);
    });
    expect(m.ratio).toBeLessThanOrEqual(1.7);
    expect(m.maxJump).toBeLessThan(30);
  });
  it('a target that jumps 300px mid-flight: replans from the current state, smooth, <= 1.7 for the new leg', async () => {
    const r = { left: 900, top: 200, width: 200, height: 40 };
    const el = mkTarget(r);
    const m = await measure(el, (f) => {
      if (f === 25) {
        r.left = 1100;
        r.top = 420;
        mockRect(el, r);
      }
    });
    expect(m.maxJump).toBeLessThan(1300 * 0.017 * 1.6); // no teleport
    expect(m.ratio).toBeLessThanOrEqual(1.7);
  });
  it('a retarget during a flight (new flyTo) keeps peak/mean <= 1.7 for the second flight', async () => {
    void bf.flyTo({ x: 1100, y: 200 });
    step(20);
    const el = mkTarget({ left: 500, top: 300, width: 100, height: 30 });
    const m = await measure(el, () => {});
    expect(m.ratio).toBeLessThanOrEqual(1.7);
  });
});

/** Whole-flight peak/mean from the first movement to landing, for a target that slides while the butterfly flies. */
async function slideRatio(
  from: { x: number; y: number },
  slide: { dx: number; dy: number; delay: number; frames?: number },
  opts: Record<string, unknown> = {},
): Promise<{ ratio: number; ms: number }> {
  bf.destroy();
  queue.clear();
  bf = createButterfly(layer, { reducedMotion: false, home: () => from, seed: 1 });
  step(5);
  const r = { left: 700, top: 300, width: 200, height: 40 };
  const el = mkTarget(r);
  let landed = false;
  void bf.flyTo(el, { side: 'inside-top-left', ...opts }).then(() => (landed = true));
  let last = pos(layer);
  let started = -1;
  let len = 0;
  let peak = 0;
  for (let f = 0; !landed && f < 300; f++) {
    const u = Math.min(1, Math.max(0, (f - slide.delay) / (slide.frames ?? 13)));
    const e = 1 - (1 - u) * (1 - u);
    r.left = 700 + slide.dx * e;
    r.top = 300 + slide.dy * e;
    mockRect(el, r);
    step(1);
    await Promise.resolve();
    const p = pos(layer);
    const d = Math.hypot(p.x - last.x, p.y - last.y);
    if (started < 0 && d > 0.5) started = f;
    if (started >= 0) {
      len += d;
      peak = Math.max(peak, d / 0.016667);
    }
    last = p;
    if (landed) {
      el.remove();
      return { ratio: (peak * (f - started + 1) * 0.016667) / len, ms: (f - started + 1) * 16.667 };
    }
  }
  el.remove();
  throw new Error('did not land');
}

describe('A3 moving targets (docked tutorial / wheel rim): whole-flight peak/mean <= 1.7', () => {
  it('a target that slides sideways over 220ms (stage width animation) from the corners, the rim and the middle', async () => {
    let worst = 0;
    for (const from of [{ x: 130, y: 760 }, { x: 720, y: 640 }, { x: 1300, y: 760 }]) {
      for (const dx of [-300, -240, -150, 150, 240, 400]) {
        for (const delay of [0, 8]) {
          const m = await slideRatio(from, { dx, dy: 0, delay });
          worst = Math.max(worst, m.ratio);
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(1.7);
  });
  it('a target that also drops 120px while it slides', async () => {
    let worst = 0;
    for (const from of [{ x: 130, y: 760 }, { x: 720, y: 640 }, { x: 1300, y: 760 }]) {
      for (const dx of [-240, 240, 400]) {
        const m = await slideRatio(from, { dx, dy: 120, delay: 0 });
        worst = Math.max(worst, m.ratio);
      }
    }
    expect(worst).toBeLessThanOrEqual(1.7);
  });
  it('a replan keeps the clock: an early re-aim does not restart the take-off (no standing still for 200ms)', async () => {
    const m = await slideRatio({ x: 600, y: 360 }, { dx: -240, dy: 0, delay: 0 });
    expect(m.ms).toBeLessThan(750);
  });
});

describe('N6/N7 replans keep the flight-level budgets', () => {
  async function slidingFlight(opts: Record<string, unknown>, jumpAt: number, jump: { dx: number; dy: number }): Promise<number> {
    const r = { left: 700, top: 300, width: 200, height: 40 };
    const el = mkTarget(r);
    let landed = false;
    void bf.flyTo(el, { side: 'inside-top-left', ...opts }).then(() => (landed = true));
    let f = 0;
    while (!landed && f < 300) {
      if (f === jumpAt) {
        r.left += jump.dx;
        r.top += jump.dy;
        mockRect(el, r);
      }
      f++;
      step(1);
      await Promise.resolve();
    }
    el.remove();
    return f * 16.667;
  }
  it('maxDuration bounds the whole flight: a 300px move at 300ms does not stretch a 420ms hop', async () => {
    bf.destroy();
    bf = createButterfly(layer, { reducedMotion: false, home: () => ({ x: 500, y: 400 }), seed: 1 });
    step(5);
    const ms = await slidingFlight({ maxDuration: 420 }, 18, { dx: 300, dy: 0 });
    expect(ms).toBeLessThanOrEqual(420 + 70);
  });
  it('maxDuration counts a far-spark pick-up wait', async () => {
    bf.spark({ x: 1300, y: 80 });
    const ms = await slidingFlight({ maxDuration: 420 }, 999, { dx: 0, dy: 0 });
    expect(ms).toBeLessThanOrEqual(420 + 70);
  });
  it('minDuration is the total: a replan after 300ms does not end the flight early', async () => {
    const ms = await slidingFlight({ minDuration: 1000 }, 18, { dx: 300, dy: 100 });
    expect(ms).toBeGreaterThanOrEqual(1000 - 70);
  });
  it('a retarget flyTo with a fast start keeps minDuration', async () => {
    void bf.flyTo({ x: 1300, y: 100 });
    step(20);
    const t0 = now;
    let landed = false;
    void bf.flyTo({ x: pos(layer).x + 60, y: pos(layer).y + 60 }, { minDuration: 900 }).then(() => (landed = true));
    while (!landed && now - t0 < 3000) {
      step(1);
      await Promise.resolve();
    }
    expect(now - t0).toBeGreaterThanOrEqual(900 - 70);
  });
});

describe('N5 far-source pick-up hold survives a short flight and retargets', () => {
  it('a short flight whose onApproach retargets still waits for the streak', async () => {
    const start = pos(layer);
    bf.spark({ x: 1100, y: 100 }); // far
    const approach = vi.fn(() => void bf.flyTo({ x: 700, y: 300 }));
    void bf.flyTo({ x: start.x + 5, y: start.y }, { onApproach: approach });
    step(3); // 50ms: still inside the hold
    expect(approach).not.toHaveBeenCalled();
    expect(Math.hypot(pos(layer).x - start.x, pos(layer).y - start.y)).toBeLessThan(1);
    step(10);
    expect(approach).toHaveBeenCalledTimes(1);
  });
  it('a flyTo that replaces a flight still waiting for the streak inherits the wait', () => {
    const start = pos(layer);
    bf.spark({ x: 1100, y: 100 });
    void bf.flyTo({ x: 700, y: 300 });
    step(3);
    void bf.flyTo({ x: 800, y: 200 });
    step(3); // 100ms after the spark: the streak is not ready before ~126ms
    expect(Math.hypot(pos(layer).x - start.x, pos(layer).y - start.y)).toBeLessThan(1);
    step(8);
    expect(Math.hypot(pos(layer).x - start.x, pos(layer).y - start.y)).toBeGreaterThan(1);
  });
});

describe('voice submit: ripples collapse before the butterfly moves', () => {
  it('holds ~200ms in place, then flies; onApproach and maxDuration count the wait', async () => {
    bf.setMode('voice');
    bf.setVoiceLevel(0.7);
    step(40);
    const start = pos(layer);
    let landedAt = -1;
    let approachAt = -1;
    let tookOff = -1;
    let f = 0;
    void bf
      .flyTo({ x: 800, y: 300 }, { maxDuration: 600, onApproach: () => (approachAt = f) })
      .then(() => (landedAt = f));
    while (landedAt < 0 && f < 200) {
      f++;
      step(1);
      await Promise.resolve();
      if (tookOff < 0 && Math.hypot(pos(layer).x - start.x, pos(layer).y - start.y) > 1) tookOff = f;
    }
    expect(tookOff * 16.667).toBeGreaterThanOrEqual(190);
    expect(landedAt * 16.667).toBeLessThanOrEqual(600 + 70); // hold + flight inside maxDuration
    expect((landedAt - approachAt) * 16.667).toBeLessThanOrEqual(320);
    expect(approachAt * 16.667).toBeGreaterThanOrEqual(200); // never during the collapse
  });
  it('a home flight out of voice does not wait', () => {
    bf.setMode('voice');
    step(30);
    void bf.flyTo({ x: 700, y: 300 });
    step(80);
    void bf.home();
    const p = pos(layer);
    step(4);
    expect(Math.hypot(pos(layer).x - p.x, pos(layer).y - p.y)).toBeGreaterThan(1);
  });
});

describe('reduced motion: one cross-fade of at most 150ms', () => {
  it('relocates at the start, lands after 150ms, and leaves no copy behind', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    bf.setReducedMotion(true);
    const order: string[] = [];
    const before = layer.children.length;
    const p = bf.flyTo({ x: 700, y: 300 }, { onApproach: () => order.push('approach') }).then((v) => order.push('landed:' + v));
    expect(order).toEqual(['approach']); // the shell appears with the butterfly, at once
    expect(layer.children.length).toBe(before + 1); // the fading copy at the old position
    await vi.advanceTimersByTimeAsync(140);
    expect(order).toEqual(['approach']);
    await vi.advanceTimersByTimeAsync(20);
    await p;
    expect(order).toEqual(['approach', 'landed:true']);
    expect(layer.children.length).toBe(before);
    step(3);
    expect(pos(layer).x).toBeCloseTo(700, 0);
  });
  it('cancelling the cross-fade removes the copy', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    bf.setReducedMotion(true);
    const before = layer.children.length;
    void bf.flyTo({ x: 700, y: 300 });
    const second = bf.flyTo({ x: 300, y: 300 });
    expect(layer.children.length).toBe(before + 1); // only the newer flight's copy
    await vi.advanceTimersByTimeAsync(200);
    expect(await second).toBe(true);
    expect(layer.children.length).toBe(before);
  });
});

describe('A3 onApproach lead', () => {
  it('fires once, when <= 300ms remain (long flight), and not earlier than 250ms before landing', async () => {
    let landedAt = -1;
    let approachAt = -1;
    let f = 0;
    const p = bf.flyTo({ x: 1100, y: 200 }, { onApproach: () => (approachAt = f) }).then(() => (landedAt = f));
    while (landedAt < 0 && f < 200) {
      f++;
      step(1);
      await Promise.resolve();
    }
    await p;
    const lead = (landedAt - approachAt) * 16.667;
    expect(lead).toBeLessThanOrEqual(320);
    expect(lead).toBeGreaterThanOrEqual(270);
  });
});

describe('A3 far-source spark pick-up', () => {
  it('a flyTo started right after a far spark takes off at 70% of the 180ms streak (hold <= 120ms); onApproach counts the wait', async () => {
    let tookOff = -1;
    let approachAt = -1;
    let landedAt = -1;
    const start = pos(layer);
    bf.spark({ x: 1100, y: 100 }); // far from the butterfly at (200, 600)
    expect(bf.sparkEta()).toBeGreaterThan(100);
    expect(bf.sparkEta()).toBeLessThanOrEqual(120);
    let f = 0;
    void bf.flyTo({ x: 700, y: 300 }, { onApproach: () => (approachAt = f) }).then(() => (landedAt = f));
    while (landedAt < 0 && f < 200) {
      f++;
      step(1);
      await Promise.resolve();
      const p = pos(layer);
      if (tookOff < 0 && Math.hypot(p.x - start.x, p.y - start.y) > 0.5) tookOff = f;
    }
    expect(tookOff * 16.667).toBeGreaterThanOrEqual(100); // held still until 70% of the streak
    expect(tookOff * 16.667).toBeLessThanOrEqual(185); // hold <= 120ms, plus the frames the ease-out of rest needs to exceed 0.5px
    // landing = hold + duration (the hold is inside the flight timeline); approach 300ms before it
    const lead = (landedAt - approachAt) * 16.667;
    expect(lead).toBeGreaterThanOrEqual(270);
    expect(lead).toBeLessThanOrEqual(320);
    expect(bf.sparkEta()).toBe(0);
  });
  it('a near spark (<= 200px) never delays take-off', async () => {
    const start = pos(layer);
    bf.spark({ x: start.x + 80, y: start.y });
    void bf.flyTo({ x: 700, y: 300 });
    step(4);
    const p = pos(layer);
    expect(Math.hypot(p.x - start.x, p.y - start.y)).toBeGreaterThan(1);
  });
  it('a flyTo more than 250ms after the spark does not wait', async () => {
    bf.spark({ x: 1100, y: 100 });
    step(18); // 300ms
    const start = pos(layer);
    void bf.flyTo({ x: 700, y: 300 });
    step(4);
    expect(Math.hypot(pos(layer).x - start.x, pos(layer).y - start.y)).toBeGreaterThan(1);
  });
  it('draws a visible streak (canvas work) for a far source and none for reduced motion', () => {
    bf.spark({ x: 1100, y: 100 });
    expect(bf.fxLive()).toBeGreaterThan(10);
  });
});

describe('A1 motion preference ownership', () => {
  function stubMql(initial: boolean) {
    const listeners = new Set<(e: { matches: boolean }) => void>();
    const mq = {
      matches: initial,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.delete(cb),
    };
    const fn = vi.fn(() => mq);
    vi.stubGlobal('matchMedia', fn);
    window.matchMedia = fn as unknown as typeof window.matchMedia;
    return { listeners, fn, fire: (m: boolean) => [...listeners].forEach((l) => l({ matches: m })) };
  }
  it('opts.reducedMotion given: the OS query is never read or listened to; bf-reduced follows the app', () => {
    const os = stubMql(true);
    bf.destroy();
    document.body.innerHTML = '<div id="layer"></div>';
    layer = document.getElementById('layer') as HTMLElement;
    bf = createButterfly(layer, { reducedMotion: false, home: () => ({ x: 200, y: 600 }) });
    expect(os.fn).not.toHaveBeenCalled();
    expect(os.listeners.size).toBe(0);
    expect(document.documentElement.classList.contains('bf-reduced')).toBe(false);
    os.fire(true);
    expect(document.documentElement.classList.contains('bf-reduced')).toBe(false);
    bf.setReducedMotion(true);
    expect(document.documentElement.classList.contains('bf-reduced')).toBe(true);
    bf.setReducedMotion(false);
    expect(document.documentElement.classList.contains('bf-reduced')).toBe(false);
  });
  it('no preference: follows the OS until setReducedMotion() is called, then ignores it', () => {
    const os = stubMql(true);
    bf.destroy();
    document.body.innerHTML = '<div id="layer"></div>';
    layer = document.getElementById('layer') as HTMLElement;
    bf = createButterfly(layer, { home: () => ({ x: 200, y: 600 }) });
    expect(os.fn).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('bf-reduced')).toBe(true); // OS auto-init
    os.fire(false);
    expect(document.documentElement.classList.contains('bf-reduced')).toBe(false); // still following
    bf.setReducedMotion(true); // the app takes over
    expect(os.listeners.size).toBe(0); // listener removed
    os.fire(false);
    expect(document.documentElement.classList.contains('bf-reduced')).toBe(true); // OS ignored
  });
});

describe('reduced-motion onApproach retarget safety', () => {
  it('flight A whose onApproach starts flight B: B lands once, on time, A resolves false, no stray timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    bf.setReducedMotion(true);
    let pb: Promise<boolean> | undefined;
    const pa = bf.flyTo({ x: 700, y: 300 }, { onApproach: () => (pb = bf.flyTo({ x: 300, y: 400 })) });
    expect(pb).toBeDefined(); // the cross-fade starts at once: onApproach fires with it and B starts right there
    let bDone = false;
    void pb?.then(() => (bDone = true));
    await vi.advanceTimersByTimeAsync(100); // B needs 150ms from its own start
    expect(bDone).toBe(false); // A's stale timer must not resolve B early
    await vi.advanceTimersByTimeAsync(60);
    expect(await pb).toBe(true);
    expect(await pa).toBe(false);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1); // only the reduced-motion poll interval remains
    step(3);
    expect(pos(layer).x).toBeCloseTo(300, 0); // a point target has no gutter
  });
});

describe('onTarget + target()', () => {
  it('reports the destination element on take-off and landing, null for points', async () => {
    const seen: string[] = [];
    bf.destroy();
    document.body.innerHTML = '<div id="layer"></div>';
    layer = document.getElementById('layer') as HTMLElement;
    bf = createButterfly(layer, {
      reducedMotion: false,
      home: () => ({ x: 200, y: 600 }),
      onTarget: (el, phase) => seen.push(`${phase}:${el?.getAttribute('data-perch') ?? 'null'}`),
    });
    const el = mkTarget({ left: 500, top: 300, width: 100, height: 30 }, 'k1');
    const p = bf.flyTo(el, { side: 'inside-top-left' });
    expect(bf.target()).toBe(el);
    for (let i = 0; i < 90; i++) step(1);
    await p;
    expect(seen).toEqual(['takeoff:k1', 'landed:k1']);
    void bf.flyTo({ x: 100, y: 100 });
    expect(seen[2]).toBe('takeoff:null');
  });
});

describe('A4 turnToward', () => {
  const sprite = (): string => (layer.querySelector('.bf-sprite') as HTMLElement).style.transform;
  const rot = (): number => Number(/rotate\(([-\d.]+)deg\)/.exec(sprite())?.[1] ?? 0);
  const yawOf = (): number => Number(/rotateY\(([-\d.]+)deg\)/.exec(sprite())?.[1] ?? 0);

  it('leans and yaws toward the target within 450ms, without moving the body, and returns to neutral on null', () => {
    step(60); // settle at home (200, 600); let the idle state machine run
    const before = pos(layer);
    bf.turnToward({ x: 800, y: 600 });
    step(28); // ~467ms
    const p = pos(layer);
    expect(Math.hypot(p.x - before.x, p.y - before.y)).toBeLessThan(6); // idle drift only, no translation
    expect(yawOf()).toBeGreaterThan(15);
    expect(rot()).toBeGreaterThan(5);
    bf.turnToward({ x: -400, y: 600 });
    step(28);
    expect(yawOf()).toBeLessThan(-10);
    expect(rot()).toBeLessThan(-3);
    bf.turnToward(null);
    step(60);
    expect(Math.abs(yawOf())).toBeLessThan(12); // back to the idle sway only
    expect(Math.abs(rot())).toBeLessThan(8);
  });
  it('turns at most 10 degrees toward something within 160px (wheel rim), the usual angle farther away', () => {
    step(60);
    const home = pos(layer);
    bf.turnToward({ x: home.x + 150, y: home.y });
    step(40);
    const near = yawOf();
    expect(near).toBeGreaterThan(4);
    expect(near).toBeLessThanOrEqual(10 + 6); // + idle sway
    bf.turnToward({ x: home.x + 400, y: home.y });
    step(40);
    expect(yawOf()).toBeGreaterThan(near + 8);
  });
  it('accepts an element target', () => {
    const el = mkTarget({ left: 900, top: 580, width: 100, height: 40 });
    step(60);
    bf.turnToward(el);
    step(28);
    expect(yawOf()).toBeGreaterThan(15);
  });
  it('is ignored during a flight and a flight drops an earlier glance', () => {
    step(60);
    void bf.flyTo({ x: 900, y: 200 });
    step(2);
    bf.turnToward({ x: 100, y: 100 });
    step(10);
    expect(yawOf()).toBe(0); // flights carry no yaw
    bf.turnToward({ x: 100, y: 100 }); // still ignored
    void bf.flyTo({ x: 300, y: 300 }, { side: 'top' });
    step(120);
    expect(Math.abs(rot())).toBeLessThan(8); // no leftover lean toward (100, 100) after landing
  });
  it('is a no-op in reduced motion', () => {
    bf.setReducedMotion(true);
    bf.turnToward({ x: 900, y: 600 });
    step(40);
    expect(yawOf()).toBe(0);
    expect(rot()).toBeCloseTo(0, 1);
  });
});
