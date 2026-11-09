import { describe, expect, it } from 'vitest';
import { createIdle, HOVER_X, HOVER_Y, PERCH_X, PERCH_Y } from './idle';

function run(seed: number, secs: number, ctx: Parameters<ReturnType<typeof createIdle>['step']>[1]) {
  const idle = createIdle(seed);
  const o = { x: 0, y: 0, yaw: 0, roll: 0, head: 0, lift: 0, open: 0, minGlow: 1, maxHz: 0 };
  for (let t = 0; t < secs; t += 1 / 60) {
    const f = idle.step(1 / 60, ctx);
    o.x = Math.max(o.x, Math.abs(f.x));
    o.y = Math.max(o.y, Math.abs(f.y));
    o.yaw = Math.max(o.yaw, Math.abs(f.yaw));
    o.roll = Math.max(o.roll, Math.abs(f.roll));
    o.head = Math.max(o.head, Math.abs(f.head));
    o.lift = Math.max(o.lift, Math.abs(f.lift));
    o.open = Math.max(o.open, f.open);
    o.maxHz = Math.max(o.maxHz, f.flutterHz);
  }
  return o;
}

describe('idle bounds', () => {
  it('hover stays within x+-12 / y+-8, yaw +-20, roll +-10, glance <= 10, flutter lift <= 3, flutter 3-5Hz', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const o = run(seed, 120, { perched: false, listening: false, glance: () => ({ dx: 100, dy: 0 }) });
      expect(o.x).toBeLessThanOrEqual(HOVER_X + 1e-6);
      expect(o.y).toBeLessThanOrEqual(HOVER_Y + 1e-6);
      expect(o.yaw).toBeLessThanOrEqual(20);
      expect(o.roll).toBeLessThanOrEqual(10);
      expect(o.head).toBeLessThanOrEqual(10);
      expect(o.lift).toBeLessThanOrEqual(3);
      expect(o.maxHz).toBeGreaterThanOrEqual(3);
      expect(o.maxHz).toBeLessThanOrEqual(5);
    }
  });
  it('perched stays within x+-2 / y+-1 and opens the wings slowly now and then', () => {
    const o = run(7, 120, { perched: true, listening: false });
    expect(o.x).toBeLessThanOrEqual(HOVER_X);
    // amplitude eases from hover to perched; after the first seconds it must be within the perched box
    const idle = createIdle(7);
    let mx = 0;
    let my = 0;
    let open = 0;
    for (let t = 0; t < 120; t += 1 / 60) {
      const f = idle.step(1 / 60, { perched: true, listening: false });
      if (t > 8) {
        mx = Math.max(mx, Math.abs(f.x));
        my = Math.max(my, Math.abs(f.y));
      }
      open = Math.max(open, f.open);
    }
    expect(mx).toBeLessThanOrEqual(PERCH_X + 0.05);
    expect(my).toBeLessThanOrEqual(PERCH_Y + 0.05);
    expect(open).toBeGreaterThan(0.9);
  });
  it('glow breathes with a 4-6s period (below 1Hz) and listening lifts 3-6px at 3-4Hz', () => {
    const idle = createIdle(5);
    expect(idle.glowPeriod).toBeGreaterThanOrEqual(4);
    expect(idle.glowPeriod).toBeLessThanOrEqual(6);
    const o = run(5, 20, { perched: false, listening: true, glance: () => ({ dx: 50, dy: 80 }) });
    expect(o.maxHz).toBeGreaterThanOrEqual(3);
    expect(o.maxHz).toBeLessThanOrEqual(4);
    expect(o.lift).toBeGreaterThanOrEqual(3);
    expect(o.lift).toBeLessThanOrEqual(6.01);
  });
  it('is deterministic for a seed', () => {
    const a = createIdle(11);
    const b = createIdle(11);
    for (let i = 0; i < 600; i++) expect(a.step(1 / 60, { perched: false, listening: false }).x).toBe(b.step(1 / 60, { perched: false, listening: false }).x);
  });
});
