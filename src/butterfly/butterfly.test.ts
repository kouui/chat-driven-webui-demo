// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createButterfly } from './butterfly';
import type { Butterfly } from '../types';

// Manual rAF queue so we can count live loops and step frames deterministically.
let queue: Map<number, FrameRequestCallback>;
let nextId: number;
let now: number;
let maxPending: number;

function step(frames = 1): void {
  for (let i = 0; i < frames; i++) {
    const cbs = [...queue.values()];
    queue.clear();
    now += 16;
    for (const cb of cbs) cb(now);
    maxPending = Math.max(maxPending, queue.size);
  }
}

function mockRect(el: Element, r: { left: number; top: number; width: number; height: number }): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON() {} }) as DOMRect;
}

function box(parent: Element, perch: string, rect = { left: 100, top: 200, width: 200, height: 60 }): HTMLElement {
  const el = document.createElement('div');
  el.dataset.perch = perch;
  mockRect(el, rect);
  parent.appendChild(el);
  return el;
}

let layer: HTMLElement;
let bf: Butterfly;

beforeEach(() => {
  queue = new Map();
  nextId = 1;
  now = 1000;
  maxPending = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id));
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.body.innerHTML = '<div id="host"></div><div id="layer"></div>';
  layer = document.getElementById('layer') as HTMLElement;
});

afterEach(() => {
  bf?.destroy();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('single rAF loop', () => {
  it('never schedules a second loop when the perched element is removed mid-frame', () => {
    bf = createButterfly(layer, { reducedMotion: false, home: () => ({ x: 500, y: 400 }) });
    const host = document.getElementById('host') as HTMLElement;
    for (let i = 0; i < 10; i++) {
      const el = box(host, `a${i}`);
      void bf.flyTo(el, { side: 'top-left' });
      step(3);
      el.remove(); // perch target vanishes -> home flight
      step(6);
      expect(queue.size).toBeLessThanOrEqual(1);
    }
    step(40);
    expect(queue.size).toBe(1);
    expect(maxPending).toBe(1);
  });

  it('retargeting repeatedly keeps exactly one pending frame', () => {
    bf = createButterfly(layer, { reducedMotion: false });
    const host = document.getElementById('host') as HTMLElement;
    const els = Array.from({ length: 10 }, (_, i) => box(host, `e${i}`));
    for (const el of els) {
      void bf.flyTo(el);
      step(1);
      expect(queue.size).toBe(1);
    }
    void bf.home();
    step(5);
    expect(queue.size).toBe(1);
  });
});

describe('perch lifecycle', () => {
  it('re-attaches silently to a re-rendered element with the same data-perch', async () => {
    bf = createButterfly(layer, { reducedMotion: false, home: () => ({ x: 900, y: 700 }) });
    const host = document.getElementById('host') as HTMLElement;
    const a = box(host, 'kpi', { left: 100, top: 200, width: 200, height: 60 });
    const landed = bf.flyTo(a, { side: 'inside-top-left' });
    step(120);
    expect(await landed).toBe(true);
    a.remove();
    const b = box(host, 'kpi', { left: 400, top: 300, width: 200, height: 60 });
    step(120);
    const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec((layer.firstElementChild as HTMLElement).style.transform);
    // perched micro-motion is allowed to wander by x+-2 / y+-1
    expect(Math.abs(Number(m?.[1]) - 382)).toBeLessThanOrEqual(3);
    expect(Math.abs(Number(m?.[2]) - 312)).toBeLessThanOrEqual(2);
    expect(b.isConnected).toBe(true);
  });

  it('goes home when nothing replaces the removed element', async () => {
    bf = createButterfly(layer, { reducedMotion: false, home: () => ({ x: 900, y: 700 }) });
    const host = document.getElementById('host') as HTMLElement;
    const a = box(host, 'kpi');
    const landed = bf.flyTo(a);
    step(120);
    await landed;
    a.remove();
    step(300);
    const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec((layer.firstElementChild as HTMLElement).style.transform);
    expect(Math.abs(Number(m?.[1]) - 900)).toBeLessThan(60);
    expect(Math.abs(Number(m?.[2]) - 700)).toBeLessThan(60);
  });

  it('fades out when the target leaves `within` and back in when it returns', async () => {
    bf = createButterfly(layer, { reducedMotion: false });
    const host = document.getElementById('host') as HTMLElement;
    const within = box(host, 'scroller', { left: 0, top: 100, width: 600, height: 300 });
    const a = box(host, 'row', { left: 50, top: 150, width: 200, height: 40 });
    const landed = bf.flyTo(a, { side: 'inside-top-left', within });
    step(120);
    await landed;
    const root = layer.firstElementChild as HTMLElement;
    expect(root.style.opacity).not.toBe('0');
    mockRect(a, { left: 50, top: -300, width: 200, height: 40 });
    step(3);
    expect(root.style.opacity).toBe('0');
    mockRect(a, { left: 50, top: 120, width: 200, height: 40 });
    step(3);
    expect(root.style.opacity).toBe('1');
  });

  it('setMode("perched") clears listening', () => {
    bf = createButterfly(layer, { reducedMotion: false });
    const body = (): string => (layer.querySelector('.bf-sprite') as HTMLElement).style.transform;
    bf.setMode('listening');
    step(60);
    const listening = body();
    bf.setMode('perched');
    step(120);
    expect(body()).not.toBe(listening);
  });
});

describe('reduced motion', () => {
  it('retires the previous perch so a removed old target cannot cancel a newer flight', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    bf = createButterfly(layer, { reducedMotion: true, home: () => ({ x: 900, y: 700 }) });
    const host = document.getElementById('host') as HTMLElement;
    const a = box(host, 'a');
    const pa = bf.flyTo(a);
    await vi.advanceTimersByTimeAsync(400);
    step(3);
    expect(await pa).toBe(true);
    a.remove();
    const b = box(host, 'b', { left: 300, top: 300, width: 100, height: 40 });
    const pb = bf.flyTo(b);
    step(3);
    await vi.advanceTimersByTimeAsync(400);
    step(3);
    expect(await pb).toBe(true);
  });

  it('re-attaches to a same-key replacement made during the fade-out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    bf = createButterfly(layer, { reducedMotion: true, home: () => ({ x: 900, y: 700 }) });
    const host = document.getElementById('host') as HTMLElement;
    const a = box(host, 'kpi', { left: 100, top: 200, width: 200, height: 60 });
    const p = bf.flyTo(a, { side: 'inside-top-left' });
    await vi.advanceTimersByTimeAsync(50); // still fading out
    a.remove();
    const b = box(host, 'kpi', { left: 400, top: 300, width: 200, height: 60 });
    await vi.advanceTimersByTimeAsync(400);
    step(3);
    expect(await p).toBe(true);
    const pt = (): number[] => {
      const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec((layer.firstElementChild as HTMLElement).style.transform);
      return [Number(m?.[1]), Number(m?.[2])];
    };
    expect(pt()[0]).toBeCloseTo(382, 0); // not relocated home (900, 700)
    expect(pt()[1]).toBeCloseTo(312, 0);
    // and it is perched on b: moving b is followed
    mockRect(b, { left: 500, top: 500, width: 200, height: 60 });
    await vi.advanceTimersByTimeAsync(300);
    step(400);
    expect(pt()[0]).toBeCloseTo(482, 0);
  });

  it('stops the rAF loop when settled and wakes on scroll', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    bf = createButterfly(layer, { reducedMotion: true, home: () => ({ x: 500, y: 400 }) });
    expect(queue.size).toBe(1);
    step(400);
    expect(queue.size).toBe(0);
    window.dispatchEvent(new Event('resize'));
    expect(queue.size).toBe(1);
    step(400);
    expect(queue.size).toBe(0);
    // perched and following: moving the element is picked up by the poll
    const host = document.getElementById('host') as HTMLElement;
    const a = box(host, 'a');
    const p = bf.flyTo(a, { side: 'inside-top-left' });
    await vi.advanceTimersByTimeAsync(400);
    step(400);
    await p;
    expect(queue.size).toBe(0);
    mockRect(a, { left: 300, top: 500, width: 200, height: 60 });
    await vi.advanceTimersByTimeAsync(300);
    expect(queue.size).toBe(1);
    step(400);
    expect(queue.size).toBe(0);
    const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec((layer.firstElementChild as HTMLElement).style.transform);
    expect(Number(m?.[1])).toBeCloseTo(282, 0);
  });
});

describe('settle + attitude', () => {
  it('reduced motion with voice mode perched: the loop goes to sleep (shared settle targets)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    bf = createButterfly(layer, { reducedMotion: true, home: () => ({ x: 500, y: 400 }) });
    const host = document.getElementById('host') as HTMLElement;
    const a = box(host, 'a');
    const p = bf.flyTo(a, { side: 'inside-top-left' });
    await vi.advanceTimersByTimeAsync(400);
    step(5);
    await p;
    bf.setMode('voice');
    bf.setVoiceLevel(0.6);
    step(600);
    expect(queue.size).toBe(0);
  });
  it('combined body rotation never exceeds 20 degrees in flight, wings turn asymmetric', () => {
    bf = createButterfly(layer, { reducedMotion: false, home: () => ({ x: 100, y: 600 }), seed: 3 });
    bf.spark({ x: 0, y: 0 }); // head kick
    void bf.flyTo({ x: 160, y: 120 });
    const sprite = layer.querySelector('.bf-sprite') as HTMLElement;
    let maxRot = 0;
    let asym = 0;
    for (let i = 0; i < 80; i++) {
      step(1);
      const m = /rotate\(([-\d.]+)deg\)/.exec(sprite.style.transform);
      maxRot = Math.max(maxRot, Math.abs(Number(m?.[1] ?? 0)));
      const ws = layer.querySelectorAll<HTMLElement>('.bf-sprite [style*="rotateY"]');
      if (ws.length >= 2) {
        const a1 = Math.abs(Number(/rotateY\(([-\d.]+)deg\)/.exec(ws[0].style.transform)?.[1] ?? 0));
        const a2 = Math.abs(Number(/rotateY\(([-\d.]+)deg\)/.exec(ws[1].style.transform)?.[1] ?? 0));
        asym = Math.max(asym, Math.abs(a1 - a2));
      }
    }
    expect(maxRot).toBeLessThanOrEqual(20.01);
    expect(maxRot).toBeGreaterThan(1);
    expect(asym).toBeGreaterThan(0.5);
  });
});

