// Landing pads (A2): a small, subtle pad at every place the butterfly can perch, so the user always sees where it is
// and where it is going. The app describes the owners (`PadSpec[]`), this module draws the pads at the exact perch
// point (BF's `perchPoint`), in a layer under the butterfly, following scroll / resize / `within` clipping.
//
//   dim  ->  brighten + slow rotation (`approach`)  ->  one soft ripple on landing  ->  lit while perched  ->  dim on take-off
//
// Take-off / landing come from `createButterfly({ onTarget })` through `target(el, phase)`.

import type { PerchSide } from '../types';
import { perchPoint } from '../butterfly';
import { feedback, ms } from './motion';
import type { Pt } from './motion';

export interface PadSpec {
  key: string;
  /** Logical identity of the owner: a replaced element with the same `ident` (language switch) is re-attached silently;
   *  with another `ident` (page -> page) the old pad stays dim at the departure point until the butterfly lands. */
  ident?: string;
  /** The element the butterfly perches on. */
  el?: Element | null;
  /** Or a fixed viewport point (the voice nest). */
  at?: () => Pt | null;
  side?: PerchSide;
  /** The scrollport: the pad is clamped inside it and hidden when `el` is scrolled out of it. */
  within?: Element | null;
  /** Visible at all? (false while the owner is not on screen); evaluated every frame while the pads are awake. */
  show?: boolean | (() => boolean);
  /** Draw the states on `el` itself instead of a new pad element (the home ring is the home pad). */
  self?: boolean;
}

interface Pad {
  key: string;
  spec: PadSpec;
  dom: HTMLElement;
  /** Last drawn position (ghosts keep it). */
  x: number;
  y: number;
  state: 'dim' | 'near' | 'lit';
  ghost: boolean;
  gone: number;
}

export interface Pads {
  /** Re-derive the pad set. Cheap; call after any state change. */
  sync(specs: PadSpec[]): void;
  /** `onTarget` from the butterfly. */
  target(el: Element | null, phase: 'takeoff' | 'landed'): void;
  /** The butterfly is about to land on `el` (≤300ms): brighten and rotate its pad. */
  approach(el: Element | null): void;
  /** Light a pad by key (point pads such as the voice nest and the home ring have no `onTarget`). */
  light(key: string, state: 'dim' | 'near' | 'lit'): void;
  /** Every pad dims (take-off). */
  dimAll(): void;
  /** Redraw soon (something that decides visibility changed). */
  wake(): void;
  destroy(): void;
}

// Design ms; every use goes through ms() (the pad CSS durations use `var(--tm)`).
const SETTLE_MS = 900; // the redraw loop stays awake this long after a change
const MOVE_AWAKE_MS = 250;
const GHOST_MS = 1000;
const RETIRE_MS = 320; // a retired pad fades away this long (pads.css 260ms + slack)
const RIPPLE_MS = 760;

export function createPads(layer: HTMLElement): Pads {
  const pads = new Map<string, Pad>();
  const ghosts = new Set<Pad>();
  /** Pads that left the set and fade away (their DOM and timer are still alive). */
  const retiring = new Set<Pad>();
  let raf = 0;
  let awakeUntil = 0;

  const sameEl = (a: Element | null | undefined, b: Element | null | undefined): boolean => {
    if (!a || !b) return false;
    if (a === b) return true;
    const ka = a.getAttribute('data-perch');
    return ka !== null && ka === b.getAttribute('data-perch') && !a.isConnected;
  };

  function make(key: string, spec: PadSpec): Pad {
    const dom = document.createElement('div');
    dom.className = 'pad';
    dom.dataset.pad = key;
    dom.append(document.createElement('i'));
    if (!spec.self) layer.append(dom);
    return { key, spec, dom, x: -99, y: -99, state: 'dim', ghost: false, gone: 0 };
  }

  const ownerEl = (p: Pad): HTMLElement | null => (p.spec.self ? ((p.spec.el as HTMLElement | null) ?? null) : p.dom);

  function paintState(p: Pad): void {
    const el = ownerEl(p);
    if (!el) return;
    el.classList.toggle('is-near', p.state === 'near');
    el.classList.toggle('is-lit', p.state === 'lit');
  }

  function setState(p: Pad, state: Pad['state']): void {
    p.state = state;
    paintState(p);
    wake();
  }

  function kill(p: Pad): void {
    window.clearTimeout(p.gone);
    ghosts.delete(p);
    retiring.delete(p);
    p.dom.remove();
  }

  function ghostify(p: Pad): void {
    p.ghost = true;
    p.state = 'dim';
    p.dom.classList.remove('is-near', 'is-lit', 'is-ripple');
    p.dom.classList.add('is-on', 'is-ghost');
    ghosts.add(p);
    p.gone = window.setTimeout(() => kill(p), ms(GHOST_MS));
  }

  function fadeAway(p: Pad): void {
    const el = ownerEl(p);
    if (p.spec.self) el?.classList.remove('is-near', 'is-lit', 'is-ripple');
    else {
      p.dom.classList.remove('is-on', 'is-near', 'is-lit');
      retiring.add(p);
      window.clearTimeout(p.gone);
      p.gone = window.setTimeout(() => kill(p), ms(RETIRE_MS));
    }
  }

  function sync(specs: PadSpec[]): void {
    const keys = new Set(specs.map((s) => s.key));
    for (const [key, p] of pads) {
      if (keys.has(key)) continue;
      pads.delete(key);
      fadeAway(p);
    }
    for (const spec of specs) {
      let p = pads.get(spec.key);
      if (p && !p.spec.self && !spec.self && p.spec.el && spec.el && p.spec.el !== spec.el && !p.spec.el.isConnected && (p.spec.ident ?? '') !== (spec.ident ?? '')) {
        // the element was replaced (page -> page): the old pad stays dim at the departure point until the butterfly lands
        pads.delete(spec.key);
        ghostify(p);
        p = undefined;
      }
      if (!p) {
        p = make(spec.key, spec);
        pads.set(spec.key, p);
      } else {
        p.spec = spec;
      }
      if (spec.self) p.dom.style.display = 'none';
      if (!spec.self) p.dom.classList.toggle('is-on', visible(spec));
      paintState(p);
    }
    wake();
  }

  const visible = (s: PadSpec): boolean => (typeof s.show === 'function' ? s.show() : s.show !== false);

  function pointOf(p: Pad): { pt: Pt; hidden: boolean } | null {
    const s = p.spec;
    if (s.at) {
      const pt = s.at();
      return pt ? { pt, hidden: false } : null;
    }
    const el = s.el;
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    const w = s.within && s.within.isConnected ? s.within.getBoundingClientRect() : null;
    let hidden = !!w && (w.width > 0 || w.height > 0) && (r.bottom <= w.top || r.top >= w.bottom || r.right <= w.left || r.left >= w.right);
    const side = s.side ?? 'top-right';
    // A pad whose perch point lies outside the scrollport (the title scrolled half out) would be clamped to the card's
    // corner and look stray: it hides instead, until the anchor is back inside.
    const pt = perchPoint(r, side, w);
    if (!hidden && w && (w.width > 0 || w.height > 0)) hidden = Math.abs(pt.y - perchPoint(r, side, null).y) > 1;
    return { pt, hidden };
  }

  function frame(): void {
    raf = 0;
    let moved = false;
    for (const p of pads.values()) {
      if (p.spec.self) continue;
      const q = pointOf(p);
      const show = !!q && !q.hidden && visible(p.spec);
      p.dom.classList.toggle('is-on', show);
      if (!q) continue;
      if (Math.abs(q.pt.x - p.x) > 0.3 || Math.abs(q.pt.y - p.y) > 0.3) {
        p.x = q.pt.x;
        p.y = q.pt.y;
        p.dom.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
        moved = true;
      }
    }
    if (moved) awakeUntil = Math.max(awakeUntil, performance.now() + ms(MOVE_AWAKE_MS));
    if (performance.now() < awakeUntil && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function wake(): void {
    awakeUntil = performance.now() + ms(SETTLE_MS);
    if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
  }

  const find = (el: Element | null): Pad | undefined => {
    if (!el) return undefined;
    for (const p of pads.values()) if (sameEl(p.spec.el, el)) return p;
    return undefined;
  };

  const onWake = (): void => wake();
  window.addEventListener('scroll', onWake, { capture: true, passive: true });
  window.addEventListener('resize', onWake);
  document.addEventListener('transitionrun', onWake, true);
  document.addEventListener('animationstart', onWake, true);

  return {
    sync,
    target(el, phase) {
      if (phase === 'takeoff') {
        dimAll();
        return;
      }
      for (const g of [...ghosts]) kill(g); // the departure pad of a page -> page flight is done
      const hit = find(el);
      for (const p of pads.values()) {
        if (p !== hit && p.state !== 'dim') setState(p, 'dim');
      }
      if (hit) {
        setState(hit, 'lit');
        const el2 = ownerEl(hit);
        if (el2) feedback(el2, 'is-ripple', ms(RIPPLE_MS));
      }
    },
    approach(el) {
      const p = find(el);
      if (p && p.state !== 'lit') setState(p, 'near');
    },
    light(key, state) {
      const p = pads.get(key);
      if (!p) return;
      for (const q of pads.values()) if (q !== p && q.state !== 'dim') setState(q, 'dim');
      setState(p, state);
      if (state === 'lit') {
        const el2 = ownerEl(p);
        if (el2) feedback(el2, 'is-ripple', ms(RIPPLE_MS));
      }
    },
    dimAll,
    wake,
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onWake, true);
      window.removeEventListener('resize', onWake);
      document.removeEventListener('transitionrun', onWake, true);
      document.removeEventListener('animationstart', onWake, true);
      for (const p of [...pads.values(), ...ghosts, ...retiring]) {
        if (p.spec.self) ownerEl(p)?.classList.remove('is-near', 'is-lit', 'is-ripple'); // the home ring keeps no state
        kill(p);
      }
      pads.clear();
    },
  };

  function dimAll(): void {
    for (const p of pads.values()) if (p.state !== 'dim') setState(p, 'dim');
  }
}
