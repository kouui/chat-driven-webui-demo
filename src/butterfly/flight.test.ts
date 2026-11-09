import { describe, expect, it } from 'vitest';
import { PEAK_CAP_DESKTOP, PEAK_CAP_MOBILE, planFlight, rhythmAt, baseDuration, ARC_CAP_MOBILE, APPROACH_MS } from './flight';

function sample(plan: ReturnType<typeof planFlight>, step = 4) {
  const pts = [];
  for (let t = 0; t <= plan.dur + step; t += step) pts.push({ t, ...plan.at(t) });
  return pts;
}
function maxSpeed(plan: ReturnType<typeof planFlight>): number {
  const s = sample(plan, 4);
  let m = 0;
  for (let i = 1; i < s.length; i++) {
    const d = Math.hypot(s[i].pos.x - s[i - 1].pos.x, s[i].pos.y - s[i - 1].pos.y);
    m = Math.max(m, (d / (s[i].t - s[i - 1].t)) * 1000);
  }
  return m;
}

/** Measured peak speed / mean speed (travelled length over the plan duration), sampled every 2ms. */
function measuredRatio(plan: ReturnType<typeof planFlight>): number {
  const s = sample(plan, 2);
  let len = 0;
  let peak = 0;
  for (let i = 1; i < s.length; i++) {
    const d = Math.hypot(s[i].pos.x - s[i - 1].pos.x, s[i].pos.y - s[i - 1].pos.y);
    len += d;
    peak = Math.max(peak, (d / (s[i].t - s[i - 1].t)) * 1000);
  }
  const mean = len / (plan.dur / 1000);
  return mean > 0 ? peak / mean : 0;
}
function velAt(plan: ReturnType<typeof planFlight>, t: number): { x: number; y: number } {
  const a = plan.at(t - 1).pos;
  const b = plan.at(t + 1).pos;
  return { x: ((b.x - a.x) / 2) * 1000, y: ((b.y - a.y) / 2) * 1000 };
}

describe('planFlight', () => {
  const lens = [60, 150, 300, 500, 800, 1300];
  it('duration is clamp(260+0.7L, 380, 850) (L up to 2000px) and peak/mean <= 1.7', () => {
    for (const L of [...lens, 1700, 2000]) {
      const p = planFlight({ x: 100, y: 500 }, { x: 100 + L, y: 300 });
      expect(p.dur).toBeLessThanOrEqual(850);
      expect(p.dur).toBeGreaterThanOrEqual(380);
      expect(p.peakRatio).toBeLessThanOrEqual(1.7);
      expect(measuredRatio(p)).toBeLessThanOrEqual(1.7);
    }
    expect(planFlight({ x: 0, y: 0 }, { x: 1500, y: 0 }).dur).toBe(850);
  });
  it('peak/mean <= 1.7 for every flight, including retargets from any point of a running flight', () => {
    let worst = 0;
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 300; i++) {
      const a = { x: rnd() * 1400, y: rnd() * 800 };
      const b = { x: rnd() * 1400, y: rnd() * 800 };
      const first = planFlight(a, b, { mobile: rnd() < 0.3 });
      worst = Math.max(worst, measuredRatio(first));
      const t = first.dur * (0.05 + 0.9 * rnd());
      const pos = first.at(t).pos;
      const v = velAt(first, t);
      const c = { x: rnd() * 1400, y: rnd() * 800 };
      const next = planFlight(pos, c, { startVel: v });
      worst = Math.max(worst, measuredRatio(next));
      // also a replan with a forced budget (the remaining time of the running flight)
      const re = planFlight(pos, { x: b.x + (rnd() - 0.5) * 200, y: b.y + (rnd() - 0.5) * 200 }, { startVel: v, dur: Math.max(first.dur - t, 260) });
      worst = Math.max(worst, measuredRatio(re));
    }
    expect(worst).toBeLessThanOrEqual(1.7);
  });
  it('a replan never lengthens its time budget and onApproach lead is 300ms', () => {
    expect(APPROACH_MS).toBe(300);
    const p = planFlight({ x: 100, y: 300 }, { x: 600, y: 300 }, { startVel: { x: 800, y: 0 }, dur: 500 });
    expect(p.dur).toBeLessThanOrEqual(500);
  });
  it('home flights bend below the chord, other flights above', () => {
    const sw = planFlight({ x: 100, y: 400 }, { x: 700, y: 400 });
    const hm = planFlight({ x: 100, y: 400 }, { x: 700, y: 400 }, { kind: 'home' });
    expect(sw.at(sw.dur / 2).pos.y).toBeLessThan(400);
    expect(hm.at(hm.dur / 2).pos.y).toBeGreaterThan(400);
  });
  it('speed cap holds where the duration permits (desktop <=500px, mobile <=300px)', () => {
    for (const L of [60, 150, 300, 420]) {
      const p = planFlight({ x: 100, y: 500 }, { x: 100 + L, y: 300 });
      expect(p.peak).toBeLessThanOrEqual(PEAK_CAP_DESKTOP + 1);
      expect(maxSpeed(p)).toBeLessThanOrEqual(PEAK_CAP_DESKTOP * 1.03);
    }
    for (const L of [60, 150, 290]) {
      const p = planFlight({ x: 20, y: 700 }, { x: 20 + L, y: 650 }, { mobile: true });
      expect(p.peak).toBeLessThanOrEqual(PEAK_CAP_MOBILE + 1);
    }
  });
  it('mobile arc is capped at 36px', () => {
    const p = planFlight({ x: 20, y: 800 }, { x: 370, y: 100 }, { mobile: true });
    expect(p.height).toBeLessThanOrEqual(ARC_CAP_MOBILE);
  });
  it('duration follows clamp(260+0.7L, 380, 850) where the speed cap allows it', () => {
    const p = planFlight({ x: 0, y: 0 }, { x: 400, y: 0 });
    expect(p.dur).toBeCloseTo(baseDuration(p.L), 0);
    const short = planFlight({ x: 0, y: 0 }, { x: 10, y: 0 });
    expect(short.dur).toBe(380);
  });
  it('minDuration is honoured and lowers the speed', () => {
    const a = planFlight({ x: 0, y: 0 }, { x: 300, y: 100 });
    const b = planFlight({ x: 0, y: 0 }, { x: 300, y: 100 }, { minDuration: 1000 });
    expect(b.dur).toBeGreaterThanOrEqual(1000);
    expect(b.peak).toBeLessThan(a.peak);
  });
  it('A4 durations for L=200/550/1000 (desktop and mobile)', () => {
    const at = (L: number, mobile: boolean) => planFlight({ x: 0, y: 0 }, { x: L, y: 0 }, { mobile });
    // desktop: peak cap 1300 px/s is not binding at these lengths except the stretch, which stops at 850
    expect(at(200, false).dur).toBeCloseTo(baseDuration(at(200, false).L), 0);
    expect(at(200, false).dur).toBeGreaterThanOrEqual(400); // ~408
    expect(at(200, false).dur).toBeLessThanOrEqual(420);
    expect(at(550, false).dur).toBeGreaterThanOrEqual(655); // ~667 (arc length 581px)
    expect(at(550, false).dur).toBeLessThanOrEqual(680);
    expect(at(550, false).peak).toBeLessThanOrEqual(PEAK_CAP_DESKTOP + 1);
    expect(at(550, true).dur).toBeGreaterThan(780); // mobile cap 1000 px/s stretches it to ~801
    expect(at(1000, false).dur).toBe(850);
    expect(at(1000, false).peak).toBeLessThanOrEqual(1800); // the 850ms ceiling wins over the 1300 px/s cap
    // mobile: cap 1000 px/s stretches the long flights, never beyond 850
    for (const L of [200, 550, 1000]) {
      const m = at(L, true);
      const d = at(L, false);
      expect(m.dur).toBeGreaterThanOrEqual(d.dur);
      expect(m.dur).toBeLessThanOrEqual(850);
      expect(m.peakRatio).toBeLessThanOrEqual(1.7);
    }
    expect(at(200, true).peak).toBeLessThanOrEqual(PEAK_CAP_MOBILE + 1);
    expect(PEAK_CAP_DESKTOP).toBe(1300);
    expect(PEAK_CAP_MOBILE).toBe(1000);
  });
  it('maxDuration is a hard limit: beats the speed stretch and minDuration, keeps peak/mean <= 1.7', () => {
    const a = planFlight({ x: 0, y: 0 }, { x: 500, y: 100 }, { maxDuration: 420 });
    expect(a.dur).toBeLessThanOrEqual(420);
    expect(measuredRatio(a)).toBeLessThanOrEqual(1.7);
    const b = planFlight({ x: 0, y: 0 }, { x: 300, y: 100 }, { minDuration: 1000, maxDuration: 500 });
    expect(b.dur).toBe(500);
    const m = planFlight({ x: 20, y: 700 }, { x: 600, y: 650 }, { mobile: true, maxDuration: 420 });
    expect(m.dur).toBeLessThanOrEqual(420);
    const c = planFlight({ x: 0, y: 0 }, { x: 300, y: 100 }, { maxDuration: 900 }); // above the natural duration: no stretch
    expect(c.dur).toBeCloseTo(planFlight({ x: 0, y: 0 }, { x: 300, y: 100 }).dur, 3);
    const r = planFlight({ x: 100, y: 300 }, { x: 600, y: 300 }, { startVel: { x: 800, y: 0 }, dur: 500, maxDuration: 300 });
    expect(r.dur).toBeLessThanOrEqual(300);
    expect(measuredRatio(r)).toBeLessThanOrEqual(1.7);
  });
  it('long arcs are not squeezed below 12% until the 90px cap binds', () => {
    const p = planFlight({ x: 0, y: 700 }, { x: 600, y: 300 }); // chord ~721
    expect(p.height).toBeGreaterThanOrEqual(Math.min(90, 0.119 * 721));
  });
  it('arc height is 12-18% of the distance, at most 90px, and ends exactly on target', () => {
    const p = planFlight({ x: 0, y: 600 }, { x: 400, y: 300 });
    expect(p.height / 500).toBeGreaterThanOrEqual(0.119);
    expect(p.height / 500).toBeLessThanOrEqual(0.181);
    const big = planFlight({ x: 0, y: 800 }, { x: 1400, y: 100 });
    expect(big.height).toBeLessThanOrEqual(90);
    const e = p.at(p.dur).pos;
    expect(Math.hypot(e.x - 400, e.y - 300)).toBeLessThan(0.5);
  });
  it('short hops get a visible carry arc', () => {
    const p = planFlight({ x: 100, y: 100 }, { x: 160, y: 140 });
    expect(p.kind).toBe('carry');
    expect(p.height).toBeGreaterThanOrEqual(30);
    expect(p.dur).toBeGreaterThanOrEqual(380);
  });
  it('is fast-in slow-out: ~30% of the time to the speed peak', () => {
    const p = planFlight({ x: 0, y: 0 }, { x: 400, y: 0 });
    let best = 0;
    let bt = 0;
    for (let t = 0; t <= p.dur; t += 2) {
      const sp = p.at(t).speed;
      if (sp > best) {
        best = sp;
        bt = t;
      }
    }
    expect(bt / p.dur).toBeGreaterThan(0.2);
    expect(bt / p.dur).toBeLessThan(0.4);
  });
  it('retarget continues from the current position and velocity (no kink, no restart from rest)', () => {
    const first = planFlight({ x: 100, y: 600 }, { x: 900, y: 200 });
    const t0 = first.dur * 0.4;
    const pos = first.at(t0).pos;
    const dt = 1;
    const a = first.at(t0 - dt).pos;
    const v0 = { x: ((pos.x - a.x) / dt) * 1000, y: ((pos.y - a.y) / dt) * 1000 };
    const next = planFlight(pos, { x: 300, y: 150 }, { startVel: v0 });
    const p1 = next.at(dt).pos;
    const vStart = { x: ((p1.x - pos.x) / dt) * 1000, y: ((p1.y - pos.y) / dt) * 1000 };
    expect(Math.hypot(vStart.x - v0.x, vStart.y - v0.y)).toBeLessThan(0.1 * Math.hypot(v0.x, v0.y));
    // no jump anywhere along the new path
    expect(maxSpeed(next)).toBeLessThanOrEqual(Math.max(PEAK_CAP_DESKTOP, Math.hypot(v0.x, v0.y)) * 1.2);
    expect(next.at(0).pos).toEqual(pos);
  });
});

describe('retarget budgets', () => {
  it('minDuration holds for a retarget that starts fast (the start speed is bridged, not traded for time)', () => {
    const p = planFlight({ x: 100, y: 300 }, { x: 200, y: 300 }, { startVel: { x: 900, y: 0 }, minDuration: 1000 });
    expect(p.dur).toBeGreaterThanOrEqual(1000);
    expect(p.at(0).pos.x).toBeCloseTo(100, 0);
    const v = velAt(p, 20);
    expect(Math.hypot(v.x, v.y)).toBeLessThan(1000); // continuous with the 900px/s entry, no new burst
  });
  it('maxDuration still beats minDuration and the start speed', () => {
    const p = planFlight({ x: 100, y: 300 }, { x: 500, y: 300 }, { startVel: { x: 900, y: 0 }, minDuration: 1000, maxDuration: 300 });
    expect(p.dur).toBeLessThanOrEqual(300);
  });
  it('maxPeak lengthens the plan until its peak speed fits, never beyond maxDuration', () => {
    const free = planFlight({ x: 100, y: 300 }, { x: 700, y: 300 }, { dur: 260 });
    const capped = planFlight({ x: 100, y: 300 }, { x: 700, y: 300 }, { dur: 260, maxPeak: 900 });
    expect(free.peak).toBeGreaterThan(900);
    expect(capped.peak).toBeLessThanOrEqual(905);
    expect(capped.dur).toBeGreaterThan(free.dur);
    const bounded = planFlight({ x: 100, y: 300 }, { x: 700, y: 300 }, { dur: 260, maxPeak: 900, maxDuration: 300 });
    expect(bounded.dur).toBeLessThanOrEqual(300);
  });
});

describe('rhythmAt', () => {
  it('take-off 100-140ms at 8-10Hz, cruise alternates bursts and glides, landing flares to ~3Hz', () => {
    expect(rhythmAt(50, 700).kind).toBe('takeoff');
    expect(rhythmAt(50, 700).hz).toBeGreaterThanOrEqual(8);
    expect(rhythmAt(50, 700).hz).toBeLessThanOrEqual(10);
    const kinds = new Set<string>();
    for (let t = 130; t < 540; t += 10) kinds.add(rhythmAt(t, 700).kind);
    expect(kinds.has('burst')).toBe(true);
    expect(kinds.has('glide')).toBe(true);
    expect(rhythmAt(690, 700)).toMatchObject({ kind: 'flare', hz: 3 });
  });
});
