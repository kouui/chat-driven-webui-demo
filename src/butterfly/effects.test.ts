// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createEffects, type Effects } from './effects';
import { mulberry32 } from './idle';

let layer: HTMLElement;
let fx: Effects;
beforeEach(() => {
  document.body.innerHTML = '<div id="l"></div>';
  layer = document.getElementById('l') as HTMLElement;
  fx = createEffects(layer, { rng: mulberry32(3), mobile: () => false });
});

function fly(f: Effects, px: number, frames = 120): void {
  for (let i = 0; i < frames; i++) {
    f.trail(100 + i * (px / frames), 300);
    f.frame(16.7, { x: 100 + i * (px / frames), y: 300 });
  }
}

describe('effects layer', () => {
  it('adds one aria-hidden canvas inside the layer', () => {
    expect(layer.querySelectorAll('canvas').length).toBe(1);
    expect(fx.canvas.getAttribute('aria-hidden')).toBe('true');
  });
  it('never exceeds the particle cap (160 desktop, 80 mobile) and clears after landing', () => {
    fx.beginFlight('full', true);
    let max = 0;
    for (let i = 0; i < 200; i++) {
      fx.trail(i * 40, 200 + (i % 7)); // very fast: heavy emission
      fx.frame(16.7, { x: i * 40, y: 200 });
      max = Math.max(max, fx.liveParticles());
    }
    expect(max).toBeLessThanOrEqual(160);
    expect(max).toBeGreaterThan(20);
    fx.endFlight(true);
    for (let i = 0; i < 80; i++) fx.frame(16.7, { x: 0, y: 0 }); // 1.3s
    expect(fx.liveParticles()).toBe(0);
    expect(fx.hasWork()).toBe(false);

    const m = createEffects(layer, { rng: mulberry32(4), mobile: () => true });
    m.beginFlight('full', false);
    let mm = 0;
    for (let i = 0; i < 200; i++) {
      m.trail(i * 40, 200);
      m.frame(16.7, { x: i * 40, y: 200 });
      mm = Math.max(mm, m.liveParticles());
    }
    expect(mm).toBeLessThanOrEqual(80);
  });
  it('particles live at most ~900ms', () => {
    fx.beginFlight('full', false);
    fly(fx, 300, 20);
    fx.endFlight(true);
    for (let i = 0; i < 56; i++) fx.frame(16.7, { x: 0, y: 0 }); // 935ms
    expect(fx.liveParticles()).toBe(0);
  });
  it('trail none / reduced motion emit nothing', () => {
    fx.beginFlight('none', false);
    fly(fx, 400);
    expect(fx.liveParticles()).toBe(0);
    fx.setEnabled(false);
    fx.beginFlight('full', false);
    fly(fx, 400);
    fx.spark({ x: 1, y: 1 }, () => ({ x: 50, y: 50 }));
    fx.frame(16, { x: 0, y: 0 });
    expect(fx.liveParticles()).toBe(0);
  });
  it('spark emits 10-16 particles that are gone ~200ms later', () => {
    fx.spark({ left: 10, top: 10, width: 80, height: 30 }, () => ({ x: 300, y: 200 }));
    fx.frame(1, { x: 300, y: 200 });
    expect(fx.liveParticles()).toBeGreaterThanOrEqual(10);
    expect(fx.liveParticles()).toBeLessThanOrEqual(16);
    for (let i = 0; i < 14; i++) fx.frame(16.7, { x: 300, y: 200 });
    expect(fx.liveParticles()).toBe(0);
  });
  it('perf governor: 20 slow frames -> tier 1 (half cap), 20 more -> tier 2; fast frames reset the run', () => {
    for (let i = 0; i < 19; i++) fx.reportFrame(30);
    fx.reportFrame(10);
    for (let i = 0; i < 19; i++) fx.reportFrame(30);
    expect(fx.tier).toBe(0);
    fx.reportFrame(30);
    expect(fx.tier).toBe(1);
    fx.beginFlight('full', false);
    let max = 0;
    for (let i = 0; i < 200; i++) {
      fx.trail(i * 40, 200);
      fx.frame(16.7, { x: i * 40, y: 200 });
      max = Math.max(max, fx.liveParticles());
    }
    expect(max).toBeLessThanOrEqual(80);
    for (let i = 0; i < 20; i++) fx.reportFrame(30);
    expect(fx.tier).toBe(2);
  });
  it('voice ripples sleep out after leaving voice', () => {
    fx.setVoice(true, 130);
    for (let i = 0; i < 90; i++) fx.frame(16.7, { x: 200, y: 200 });
    expect(fx.hasWork()).toBe(true);
    fx.leaveVoice('collapse');
    for (let i = 0; i < 20; i++) fx.frame(16.7, { x: 200, y: 200 });
    expect(fx.hasWork()).toBe(false);
  });
});

describe('A3 effects additions', () => {
  it('short flights (< 200px) emit a denser trail per pixel', () => {
    const count = (px: number, length: number): number => {
      const f = createEffects(layer, { rng: mulberry32(11), mobile: () => false });
      f.beginFlight('full', false, length);
      for (let i = 0; i < 12; i++) {
        f.trail(100 + (i * px) / 12, 300);
        f.frame(16.7, { x: 100 + (i * px) / 12, y: 300 });
      }
      return f.liveParticles() / px;
    };
    expect(count(90, 90)).toBeGreaterThan(count(400, 400) * 1.3);
  });
  it('far spark: 18-24 particles plus a streak that stays visible ~180ms, then everything sleeps', () => {
    fx.spark({ x: 900, y: 100 }, () => ({ x: 200, y: 500 }), true);
    fx.streak({ x: 900, y: 100 }, () => ({ x: 200, y: 500 }), 180);
    fx.frame(1, { x: 200, y: 500 });
    expect(fx.liveParticles()).toBeGreaterThanOrEqual(18);
    expect(fx.liveParticles()).toBeLessThanOrEqual(24);
    for (let i = 0; i < 12; i++) fx.frame(16.7, { x: 200, y: 500 }); // 200ms
    expect(fx.hasWork()).toBe(true); // the connected line lingers
    for (let i = 0; i < 12; i++) fx.frame(16.7, { x: 200, y: 500 });
    expect(fx.hasWork()).toBe(false);
  });
  it('an empty layer returns immediately and a later emission is still simulated', () => {
    for (let i = 0; i < 5; i++) expect(fx.frame(16.7, { x: 0, y: 0 })).toBe(false);
    fx.spark({ x: 5, y: 5 }, () => ({ x: 50, y: 50 }));
    fx.frame(16.7, { x: 50, y: 50 });
    expect(fx.liveParticles()).toBeGreaterThan(9);
    for (let i = 0; i < 14; i++) fx.frame(16.7, { x: 50, y: 50 });
    expect(fx.liveParticles()).toBe(0);
  });
});


describe('effects at a time scale', () => {
  const mk = (scale: number): Effects => {
    const f = createEffects(layer, { rng: mulberry32(5), mobile: () => false });
    f.setTimeScale(scale);
    return f;
  };
  it('stardust and spark lifetimes are twice as long at 0.5, the trail keeps its density per pixel', () => {
    const live = (scale: number): { atFlight: number; after: number } => {
      const f = mk(scale);
      f.beginFlight('full', true);
      let n = 0;
      for (let i = 0; i < 40; i++) {
        f.trail(100 + i * 10, 300); // 10 px per frame, whatever the tempo (the butterfly flies half as fast per frame at 0.5, the emission is per pixel)
        f.frame(16.7, { x: 100 + i * 10, y: 300 });
        n = Math.max(n, f.liveParticles());
      }
      f.endFlight(true);
      for (let i = 0; i < 60; i++) f.frame(16.7, { x: 0, y: 0 }); // 1s real
      return { atFlight: n, after: f.liveParticles() };
    };
    const one = live(1);
    const half = live(0.5);
    expect(one.after).toBe(0); // all gone after 1s at tempo 1 (max life 900ms)
    expect(half.after).toBeGreaterThan(0); // 900ms design = 1.8s real
    expect(half.atFlight).toBeGreaterThanOrEqual(one.atFlight); // same emission per pixel; longer-lived, so never fewer alive
  });
  it('a spark lives 2x as long; the underline too', () => {
    const f1 = mk(1);
    const f2 = mk(0.5);
    for (const f of [f1, f2]) f.spark({ x: 50, y: 50 }, () => ({ x: 300, y: 300 }));
    for (let i = 0; i < 14; i++) {
      f1.frame(16.7, { x: 300, y: 300 }); // ~234ms
      f2.frame(16.7, { x: 300, y: 300 });
    }
    expect(f1.liveParticles()).toBe(0);
    expect(f2.liveParticles()).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) f2.frame(16.7, { x: 300, y: 300 });
    expect(f2.liveParticles()).toBe(0);
    f1.underline({ left: 10, top: 10, width: 200, height: 20 });
    f2.underline({ left: 10, top: 10, width: 200, height: 20 });
    for (let i = 0; i < 70; i++) {
      f1.frame(16.7, { x: 0, y: 0 }); // 1.17s: past the 950ms underline at tempo 1
      f2.frame(16.7, { x: 0, y: 0 }); // still inside 1.9s at 0.5
    }
    expect(f1.hasWork()).toBe(false);
    expect(f2.hasWork()).toBe(true);
  });
});
