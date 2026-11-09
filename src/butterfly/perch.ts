// The exact perch geometry the butterfly lands at, as a pure function (no DOM reads): the app uses it to place
// landing pads at the same point. butterfly.ts measures the element and calls this every frame.
import type { PerchSide } from '../types';
import { DEFAULT_GAP, INSIDE_GUTTER, clampToRect, resolvePerch, type Pt, type RectLike } from './math';

/** Distance from the viewport edge that a perch point is kept inside. */
export const SAFE_MARGIN = 16;
/** Distance a perch point is kept inside a `within` rect. */
export const WITHIN_MARGIN = 12;
/**
 * `inside-top-left` puts the body centre INSIDE_GUTTER (18px) left of the element. To keep it in the gutter
 * (not on the first glyph) the element needs this much free room to the left of its content, both inside the
 * `within` scrollport (18 + WITHIN_MARGIN) and from the viewport edge (18 + SAFE_MARGIN = 34).
 */
export const PERCH_GUTTER_MIN = INSIDE_GUTTER + WITHIN_MARGIN;

export interface PerchView {
  /** Viewport size used for the flip / clamp. Default: window.innerWidth / innerHeight. */
  width?: number;
  height?: number;
}

/**
 * Where the butterfly body centre lands for an element `rect` and `side` (viewport coordinates).
 * `within` = the scrollport rect (the point is clamped inside it, like PerchOpts.within).
 */
export function perchPoint(rect: RectLike, side: PerchSide = 'top-right', within?: RectLike | null, view: PerchView = {}): Pt {
  const vw = view.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const vh = view.height ?? (typeof window !== 'undefined' ? window.innerHeight : 800);
  let p = resolvePerch(rect, side, vw, vh, SAFE_MARGIN, { gap: DEFAULT_GAP }).point;
  if (within && (within.width > 0 || within.height > 0)) p = clampToRect(p, within, WITHIN_MARGIN);
  return p;
}
