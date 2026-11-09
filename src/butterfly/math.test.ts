import { describe, expect, it } from 'vitest';
import {
  arcControlPoints,
  bezier,
  bezierTangent,
  clampToRect,
  clampToViewport,
  easeInOutCubic,
  flightDuration,
  isOutsideRect,
  lissajous,
  perchPoint,
  resolvePerch,
  tiltFromTangent,
  wobbleEnvelope,
} from './math';

const rect = (l: number, t: number, w: number, h: number) => ({
  left: l, top: t, right: l + w, bottom: t + h, width: w, height: h,
});

describe('easeInOutCubic', () => {
  it('hits endpoints and midpoint and is monotonic', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = easeInOutCubic(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it('clamps out-of-range input', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe('bezier', () => {
  const p0 = { x: 0, y: 0 }, p1 = { x: 10, y: 40 }, p2 = { x: 60, y: 40 }, p3 = { x: 100, y: 0 };
  it('passes through endpoints', () => {
    expect(bezier(p0, p1, p2, p3, 0)).toEqual(p0);
    expect(bezier(p0, p1, p2, p3, 1)).toEqual(p3);
  });
  it('matches a known midpoint', () => {
    const m = bezier(p0, p1, p2, p3, 0.5);
    expect(m.x).toBeCloseTo(0.125 * 0 + 0.375 * 10 + 0.375 * 60 + 0.125 * 100, 10);
    expect(m.y).toBeCloseTo(0.375 * 40 + 0.375 * 40, 10);
  });
  it('tangent at the start points to p1', () => {
    const t = bezierTangent(p0, p1, p2, p3, 0);
    expect(t).toEqual({ x: 30, y: 120 });
  });
});

describe('flightDuration', () => {
  it('clamps to 350..1100', () => {
    expect(flightDuration(0)).toBe(350);
    expect(flightDuration(10)).toBe(350);
    expect(flightDuration(100000)).toBe(1100);
  });
  it('grows with distance', () => {
    expect(flightDuration(600)).toBeGreaterThan(flightDuration(300));
  });
});

describe('arcControlPoints', () => {
  it('bulges upward for a horizontal flight and is perpendicular offset', () => {
    const [c1, c2] = arcControlPoints({ x: 0, y: 100 }, { x: 400, y: 100 }, 0.2);
    expect(c1.y).toBeLessThan(100);
    expect(c2.y).toBeLessThan(100);
    expect(c1.x).toBeCloseTo(132, 5);
  });
  it('is stable for a zero-length flight', () => {
    const [c1, c2] = arcControlPoints({ x: 5, y: 5 }, { x: 5, y: 5 });
    expect(c1).toEqual({ x: 5, y: 5 });
    expect(c2).toEqual({ x: 5, y: 5 });
  });
});

describe('tiltFromTangent / wobble', () => {
  it('never exceeds 25 degrees', () => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [3, -4], [-100, 2]]) {
      expect(Math.abs(tiltFromTangent(dx, dy))).toBeLessThanOrEqual(25);
    }
    expect(tiltFromTangent(1, 0)).toBe(25);
    expect(tiltFromTangent(0, 5)).toBe(0);
    expect(tiltFromTangent(0, 0)).toBe(0);
  });
  it('wobble envelope fades at both ends', () => {
    expect(wobbleEnvelope(0)).toBe(0);
    expect(wobbleEnvelope(1)).toBe(0);
    expect(wobbleEnvelope(0.5)).toBe(1);
  });
});

describe('perchPoint', () => {
  const r = rect(100, 200, 300, 80);
  it('places the point outside the edge for every side', () => {
    expect(perchPoint(r, 'top-right', { gap: 20, inset: 10 })).toEqual({ x: 390, y: 180 });
    expect(perchPoint(r, 'top-left', { gap: 20, inset: 10 })).toEqual({ x: 110, y: 180 });
    expect(perchPoint(r, 'top', { gap: 20 })).toEqual({ x: 250, y: 180 });
    expect(perchPoint(r, 'bottom', { gap: 20 })).toEqual({ x: 250, y: 300 });
    expect(perchPoint(r, 'left', { gap: 20 })).toEqual({ x: 80, y: 240 });
    expect(perchPoint(r, 'right', { gap: 20 })).toEqual({ x: 420, y: 240 });
  });
  it('defaults to top-right and clamps inset for tiny elements', () => {
    const p = perchPoint(rect(100, 100, 10, 10));
    expect(p.x).toBe(105 + 0); // inset = min(16, 5) = 5 -> right(110) - 5
    expect(p.y).toBeLessThan(100);
  });
});

describe('clampToViewport / resolvePerch', () => {
  it('clamps with a safe margin', () => {
    expect(clampToViewport({ x: -50, y: 2000 }, 800, 600, 16)).toEqual({ x: 16, y: 584 });
    expect(clampToViewport({ x: 400, y: 300 }, 800, 600, 16)).toEqual({ x: 400, y: 300 });
  });
  it('flips to the bottom when the top is off-screen', () => {
    const r = rect(100, 10, 200, 40);
    const res = resolvePerch(r, 'top', 800, 600, 16);
    expect(res.side).toBe('bottom');
    expect(res.point.y).toBeGreaterThan(50);
  });
  it('keeps the side when it fits, and clamps when nothing fits', () => {
    const r = rect(100, 300, 200, 40);
    expect(resolvePerch(r, 'top', 800, 600).side).toBe('top');
    const huge = rect(-10, -10, 900, 700);
    const res = resolvePerch(huge, 'top-right', 800, 600, 16);
    expect(res.point.x).toBeLessThanOrEqual(784);
    expect(res.point.y).toBeGreaterThanOrEqual(16);
  });
});

describe('lissajous', () => {
  it('stays within the radius and is periodic', () => {
    for (let t = 0; t < 20; t += 0.37) {
      const p = lissajous(t, 36, 9);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(36 + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(36 + 1e-9);
    }
    const a = lissajous(1.3, 36, 9), b = lissajous(10.3, 36, 9);
    expect(a.x).toBeCloseTo(b.x, 8);
    expect(a.y).toBeCloseTo(b.y, 8);
  });
});

describe('inside-top-left / within helpers', () => {
  it('perches in the gutter: 18px left of the element, 12px below its top (less for short rects)', () => {
    expect(perchPoint(rect(100, 200, 300, 80), 'inside-top-left')).toEqual({ x: 82, y: 212 });
    expect(perchPoint(rect(100, 200, 8, 6), 'inside-top-left')).toEqual({ x: 82, y: 203 });
  });
  it('resolvePerch never flips inside-top-left, only clamps to the viewport', () => {
    const r = resolvePerch(rect(-50, -50, 300, 80), 'inside-top-left', 800, 600, 16);
    expect(r.side).toBe('inside-top-left');
    expect(r.point).toEqual({ x: 16, y: 16 });
  });
  it('clampToRect keeps the point inside the shrunk rect', () => {
    const w = rect(100, 100, 400, 300);
    expect(clampToRect({ x: 0, y: 0 }, w, 12)).toEqual({ x: 112, y: 112 });
    expect(clampToRect({ x: 900, y: 900 }, w, 12)).toEqual({ x: 488, y: 388 });
    expect(clampToRect({ x: 200, y: 200 }, w, 12)).toEqual({ x: 200, y: 200 });
  });
  it('isOutsideRect detects full separation only', () => {
    const w = rect(100, 100, 400, 300);
    expect(isOutsideRect(rect(120, 20, 50, 50), w)).toBe(true); // above
    expect(isOutsideRect(rect(120, 420, 50, 50), w)).toBe(true); // below
    expect(isOutsideRect(rect(120, 80, 50, 50), w)).toBe(false); // partially visible
    expect(isOutsideRect(rect(120, 150, 50, 50), w)).toBe(false);
  });
});
