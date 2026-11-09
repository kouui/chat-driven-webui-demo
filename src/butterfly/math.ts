// Pure math helpers for the butterfly (no DOM access, unit-tested).
import type { PerchSide } from '../types';

export interface Pt {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function easeInOutCubic(t: number): number {
  const u = clamp(t, 0, 1);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

export function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Derivative of the cubic Bezier at t (direction of travel, not normalised). */
export function bezierTangent(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Flight duration in ms: clamp(350, distance-based, 1100). */
export function flightDuration(dist: number, min = 350, max = 1100): number {
  return clamp(260 + dist * 0.9, min, max);
}

/**
 * Control points offset perpendicular to the straight line p0 -> p3.
 * The arc bulges upward when possible (negative y), otherwise towards +x.
 * `bulge` is a fraction of the distance (0.15–0.3 looks natural).
 */
export function arcControlPoints(p0: Pt, p3: Pt, bulge = 0.22): [Pt, Pt] {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return [{ ...p0 }, { ...p3 }];
  let nx = -dy / dist;
  let ny = dx / dist;
  if (ny > 1e-6 || (Math.abs(ny) <= 1e-6 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const o1 = bulge * dist;
  const o2 = bulge * 0.6 * dist;
  return [
    { x: p0.x + dx * 0.33 + nx * o1, y: p0.y + dy * 0.33 + ny * o1 },
    { x: p0.x + dx * 0.66 + nx * o2, y: p0.y + dy * 0.66 + ny * o2 },
  ];
}

/** Body lean in degrees from the horizontal component of the tangent, |result| <= max. */
export function tiltFromTangent(dx: number, dy: number, max = 25): number {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return 0;
  return clamp((dx / len) * max, -max, max);
}

/** 0 at both ends of the flight, 1 in the middle. */
export function wobbleEnvelope(u: number): number {
  const t = clamp(u, 0, 1);
  return 4 * t * (1 - t);
}

export interface PerchOptions {
  /** Distance from element edge to butterfly centre (px). Includes ~8–12px clear gap + body radius. */
  gap?: number;
  /** Horizontal inset from the corner for top-left / top-right (px). */
  inset?: number;
}

export const DEFAULT_GAP = 24;
export const DEFAULT_INSET = 16;
/** Offset from the top-left corner for `inside-top-left` (px, both axes). */
export const INSIDE_OFFSET = 10;

/** Perch point (butterfly centre) outside the element edge for the given side. No viewport clamping. */
export function perchPoint(rect: RectLike, side: PerchSide = 'top-right', o: PerchOptions = {}): Pt {
  const gap = o.gap ?? DEFAULT_GAP;
  const inset = Math.min(o.inset ?? DEFAULT_INSET, rect.width / 2);
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  switch (side) {
    case 'top-left':
      return { x: rect.left + inset, y: rect.top - gap };
    case 'top-right':
      return { x: rect.right - inset, y: rect.top - gap };
    case 'top':
      return { x: cx, y: rect.top - gap };
    case 'bottom':
      return { x: cx, y: rect.bottom + gap };
    case 'left':
      return { x: rect.left - gap, y: cy };
    case 'right':
      return { x: rect.right + gap, y: cy };
    case 'inside-top-left':
      return {
        x: rect.left + Math.min(INSIDE_OFFSET, rect.width / 2),
        y: rect.top + Math.min(INSIDE_OFFSET, rect.height / 2),
      };
  }
}

/** Clamp a point inside `rect` shrunk by `margin` (the margin is reduced for tiny rects). */
export function clampToRect(p: Pt, rect: RectLike, margin = 12): Pt {
  const mx = Math.min(margin, Math.max(0, rect.width / 2));
  const my = Math.min(margin, Math.max(0, rect.height / 2));
  return {
    x: clamp(p.x, rect.left + mx, rect.right - mx),
    y: clamp(p.y, rect.top + my, rect.bottom - my),
  };
}

/** True when `rect` has no overlap (beyond `tolerance` px) with `container`. */
export function isOutsideRect(rect: RectLike, container: RectLike, tolerance = 0): boolean {
  return (
    rect.bottom <= container.top + tolerance ||
    rect.top >= container.bottom - tolerance ||
    rect.right <= container.left + tolerance ||
    rect.left >= container.right - tolerance
  );
}

export function clampToViewport(p: Pt, vw: number, vh: number, margin = 16): Pt {
  const m = Math.min(margin, vw / 2, vh / 2);
  return { x: clamp(p.x, m, Math.max(m, vw - m)), y: clamp(p.y, m, Math.max(m, vh - m)) };
}

const OPPOSITE: Record<PerchSide, PerchSide> = {
  'top-left': 'bottom',
  'top-right': 'bottom',
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
  'inside-top-left': 'inside-top-left',
};

function fits(p: Pt, vw: number, vh: number, margin: number): boolean {
  return p.x >= margin && p.x <= vw - margin && p.y >= margin && p.y <= vh - margin;
}

/** Perch point with flip-to-opposite-side (if the preferred side is off-screen) and viewport clamp. */
export function resolvePerch(
  rect: RectLike,
  side: PerchSide,
  vw: number,
  vh: number,
  margin = 16,
  o: PerchOptions = {},
): { point: Pt; side: PerchSide } {
  let used = side;
  let p = perchPoint(rect, side, o);
  if (OPPOSITE[side] !== side && !fits(p, vw, vh, margin)) {
    const alt = OPPOSITE[side];
    const q = perchPoint(rect, alt, o);
    if (fits(q, vw, vh, margin)) {
      used = alt;
      p = q;
    }
  }
  return { point: clampToViewport(p, vw, vh, margin), side: used };
}

/** Figure-8 Lissajous drift around the origin. `radius` in px, `period` in seconds. */
export function lissajous(tSec: number, radius: number, period: number): Pt {
  const w = (2 * Math.PI) / period;
  return { x: radius * Math.sin(w * tSec), y: radius * 0.55 * Math.sin(2 * w * tSec) };
}

/** Frame-rate independent exponential smoothing factor for a time constant `tau` (s). */
export function smoothing(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / Math.max(1e-6, tau));
}
