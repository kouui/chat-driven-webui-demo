// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { perchPoint } from '../../butterfly';
import { createPads } from '../pads';

const R = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

let layer: HTMLElement;
let frames: FrameRequestCallback[];
const tick = (): void => frames.splice(0).forEach((f) => f(performance.now()));

function el(id: string, rect: DOMRect): HTMLElement {
  const e = document.createElement('div');
  e.dataset.perch = id;
  e.getBoundingClientRect = () => rect;
  document.body.append(e);
  return e;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="layer"></div>';
  layer = document.getElementById('layer')!;
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});
afterEach(() => vi.unstubAllGlobals());

describe('landing pads (A2)', () => {
  it('sits exactly at BF\'s perch point, clamped inside the scrollport, and hides when scrolled out', () => {
    const pads = createPads(layer);
    const target = el('a', R(300, 300, 200, 40));
    const within = el('w', R(200, 100, 800, 500));
    pads.sync([{ key: 'anchor', el: target, side: 'inside-top-left', within }]);
    tick();
    const pad = layer.querySelector<HTMLElement>('.pad')!;
    const p = perchPoint(R(300, 300, 200, 40), 'inside-top-left', R(200, 100, 800, 500));
    expect(pad.style.transform).toBe(`translate3d(${p.x}px, ${p.y}px, 0px)`);
    expect(pad.classList.contains('is-on')).toBe(true);
    target.getBoundingClientRect = () => R(300, 700, 200, 40); // scrolled below the scrollport
    pads.wake();
    tick();
    expect(pad.classList.contains('is-on')).toBe(false);
  });

  it('dim -> near (approach) -> lit + one ripple (landed) -> dim (take-off)', () => {
    const pads = createPads(layer);
    const a = el('a', R(300, 300, 200, 40));
    const b = el('b', R(300, 400, 200, 40));
    pads.sync([
      { key: 'anchor', el: a, side: 'inside-top-left' },
      { key: 'kpi', el: b, side: 'inside-top-left' },
    ]);
    const pa = layer.querySelector<HTMLElement>('[data-pad="anchor"]')!;
    const pb = layer.querySelector<HTMLElement>('[data-pad="kpi"]')!;
    pads.approach(a);
    expect(pa.classList.contains('is-near')).toBe(true);
    pads.target(a, 'landed');
    expect(pa.classList.contains('is-lit')).toBe(true);
    expect(pa.classList.contains('is-near')).toBe(false);
    expect(pa.classList.contains('is-ripple')).toBe(true);
    expect(pb.classList.contains('is-lit')).toBe(false);
    pads.target(b, 'takeoff');
    expect(pa.classList.contains('is-lit')).toBe(false);
  });

  it('the home ring is the home pad: it gets the states itself, no extra element', () => {
    const pads = createPads(layer);
    const ring = el('ring', R(500, 100, 200, 200));
    pads.sync([{ key: 'home', el: ring, self: true }]);
    expect(layer.querySelector('.pad')).toBeNull();
    pads.light('home', 'near');
    expect(ring.classList.contains('is-near')).toBe(true);
    pads.light('home', 'lit');
    expect(ring.classList.contains('is-lit')).toBe(true);
    pads.dimAll();
    expect(ring.classList.contains('is-lit')).toBe(false);
  });

  it('page -> page: the old pad stays dim at the departure point until the landing; a language switch re-attaches silently', () => {
    vi.useFakeTimers();
    const pads = createPads(layer);
    const old = el('title', R(300, 300, 200, 40));
    pads.sync([{ key: 'anchor', ident: 'risk:title', el: old, side: 'inside-top-left' }]);
    tick();
    old.remove();
    const rebuilt = el('title', R(300, 300, 200, 40));
    pads.sync([{ key: 'anchor', ident: 'risk:title', el: rebuilt, side: 'inside-top-left' }]); // same page, new language
    expect(layer.querySelectorAll('.pad')).toHaveLength(1);
    expect(layer.querySelector('.is-ghost')).toBeNull();
    rebuilt.remove();
    const next = el('title', R(300, 500, 200, 40));
    pads.sync([{ key: 'anchor', ident: 'returns:title', el: next, side: 'inside-top-left' }]);
    expect(layer.querySelectorAll('.pad')).toHaveLength(2);
    expect(layer.querySelectorAll('.is-ghost')).toHaveLength(1);
    pads.target(next, 'landed'); // the butterfly has arrived: the departure pad is done
    expect(layer.querySelectorAll('.pad')).toHaveLength(1);
    vi.useRealTimers();
  });
});
