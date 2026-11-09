// @vitest-environment jsdom
// Global motion tempo: setTimeScale(0.5) makes every butterfly time twice as long (see Butterfly.setTimeScale).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createButterfly } from './butterfly';
import type { ButterflyFx } from './butterfly';
import { createGuide } from './guide';
import { baseDuration, peakCap, planFlight, rhythmAt } from './flight';

let queue: Map<number, FrameRequestCallback>;
let nextId: number;
let now: number;
const FRAME = 16.667;
function step(frames = 1): void {
  for (let i = 0; i < frames; i++) {
    const cbs = [...queue.values()];
    queue.clear();
    now += FRAME;
    for (const cb of cbs) cb(now);
  }
}
const posOf = (layer: HTMLElement): { x: number; y: number } => {
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

/** Fly to a point and record the frame count to landing, the frame onApproach fired and the speed samples (px/s). */
async function fly(scale: number, to = { x: 900, y: 150 }, opts: { minDuration?: number; maxDuration?: number } = {}) {
  bf.setTimeScale(scale);
  let landed = false;
  let frames = 0;
  let approachAt = -1;
  const speeds: number[] = [];
  let last = posOf(layer);
  void bf.flyTo(to, { ...opts, onApproach: () => (approachAt = frames) }).then(() => (landed = true));
  while (!landed && frames < 600) {
    frames++;
    step(1);
    await Promise.resolve();
    const p = posOf(layer);
    speeds.push((Math.hypot(p.x - last.x, p.y - last.y) / FRAME) * 1000);
    last = p;
  }
  return { ms: frames * FRAME, approachLead: (frames - approachAt) * FRAME, speeds };
}

describe('setTimeScale', () => {
  it('doubles the flight duration at 0.5 and puts onApproach 600ms before landing (300ms at 1)', async () => {
    const one = await fly(1);
    expect(one.approachLead).toBeGreaterThan(270);
    expect(one.approachLead).toBeLessThan(340);
    bf.home();
    step(200);
    const half = await fly(0.5);
    expect(half.ms / one.ms).toBeGreaterThan(1.85);
    expect(half.ms / one.ms).toBeLessThan(2.15);
    expect(half.approachLead).toBeGreaterThan(570);
    expect(half.approachLead).toBeLessThan(680);
  });

  it('scales minDuration and maxDuration (design ms) too', async () => {
    const r = await fly(0.5, { x: 700, y: 300 }, { minDuration: 500 });
    expect(r.ms).toBeGreaterThanOrEqual(1000 - 70);
    bf.home();
    step(200);
    const capped = await fly(0.5, { x: 900, y: 100 }, { maxDuration: 400 });
    expect(capped.ms).toBeLessThanOrEqual(800 + 40);
    expect(capped.ms).toBeGreaterThan(600);
  });

  it('keeps peak/mean <= 1.7 in tempo-normalised time and halves the peak speed', async () => {
    const one = await fly(1);
    bf.home();
    step(200);
    const half = await fly(0.5);
    const stats = (s: number[]): { peak: number; ratio: number } => {
      const moving = s.filter((v) => v > 1);
      const mean = moving.reduce((a, b) => a + b, 0) / moving.length;
      return { peak: Math.max(...moving), ratio: Math.max(...moving) / mean };
    };
    const a = stats(one.speeds);
    const b = stats(half.speeds);
    expect(b.ratio).toBeLessThanOrEqual(1.7);
    expect(b.peak / a.peak).toBeGreaterThan(0.4);
    expect(b.peak / a.peak).toBeLessThan(0.6);
  });

  it('is a no-op for bad values and reads back through timeScale()', () => {
    bf.setTimeScale(0.5);
    bf.setTimeScale(0);
    bf.setTimeScale(NaN);
    expect(bf.timeScale()).toBe(0.5);
  });

  it('keeps a single rAF loop while the tempo changes', () => {
    bf.setTimeScale(0.5);
    void bf.flyTo({ x: 700, y: 100 });
    step(3);
    bf.setTimeScale(1);
    step(3);
    expect(queue.size).toBe(1);
  });
});

describe('planFlight / rhythmAt at a time scale', () => {
  it('scales the clamp bounds and the speed cap', () => {
    expect(baseDuration(0, 0.5)).toBe(760);
    expect(baseDuration(5000, 0.5)).toBe(1700);
    const far = planFlight({ x: 0, y: 0 }, { x: 660, y: 0 }, { timeScale: 0.5 });
    const farOne = planFlight({ x: 0, y: 0 }, { x: 660, y: 0 });
    expect(far.dur).toBeCloseTo(2 * farOne.dur, 3);
    expect(far.peak).toBeLessThanOrEqual(peakCap(false) * 0.5 + 1);
    expect(far.peak / farOne.peak).toBeCloseTo(0.5, 2);
    expect(far.peakRatio).toBeCloseTo(farOne.peakRatio, 6);
  });
  it('flight flaps scale but never drop below ~4Hz while beating', () => {
    expect(rhythmAt(50, 800, 1).hz).toBe(9);
    expect(rhythmAt(50 * 2, 1600, 0.5).hz).toBe(4.5);
    const burst = rhythmAt(300, 1600, 0.5);
    expect(burst.kind).toBe('burst');
    expect(burst.hz).toBeGreaterThanOrEqual(4);
    expect(rhythmAt(1500, 1600, 0.5).kind).toBe('flare');
  });
});

describe('guide pulse', () => {
  it('lasts 600ms at tempo 1 and 1200ms at 0.5', async () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    document.body.append(el);
    for (const [scale, len] of [
      [1, 600],
      [0.5, 1200],
    ] as const) {
      bf.setTimeScale(scale);
      const g = createGuide({ flyTo: async () => true, home: async () => true, timeScale: () => scale } as never);
      await g.focus(el, { pulse: true });
      expect(el.classList.contains('bf-pulse')).toBe(true);
      vi.advanceTimersByTime(len - 20);
      expect(el.classList.contains('bf-pulse')).toBe(true);
      vi.advanceTimersByTime(40);
      expect(el.classList.contains('bf-pulse')).toBe(false);
    }
  });
});
