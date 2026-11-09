// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { after, anim, beginOp, bind, claim, isClaimed, isCurrent, release } from '../motion';
import { createEnvelope } from '../voice';

describe('operation token', () => {
  it('latest wins: older binds are cancelled and timers never fire', () => {
    vi.useFakeTimers();
    const a = beginOp();
    const cancelled = vi.fn();
    bind(a, cancelled);
    const fired = vi.fn();
    after(a, 100, fired);
    const b = beginOp();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(isCurrent(a)).toBe(false);
    expect(isCurrent(b)).toBe(true);
    vi.advanceTimersByTime(500);
    expect(fired).not.toHaveBeenCalled();
    // a stale token can not bind anything new
    expect(bind(a, () => {})).toBe(false);
    vi.useRealTimers();
  });

  it('a claim lasts until released or the next action', () => {
    const a = beginOp();
    claim(a);
    expect(isClaimed()).toBe(true);
    release(a);
    expect(isClaimed()).toBe(false);
    claim(a);
    beginOp();
    expect(isClaimed()).toBe(false);
  });
});

describe('anim', () => {
  it('consumes the cancel rejection and reports false', async () => {
    let rejectFn: (e: unknown) => void = () => {};
    const fake = { finished: new Promise((_, rej) => (rejectFn = rej)), cancel: vi.fn(() => rejectFn(new DOMException('x', 'AbortError'))) };
    const el = document.createElement('div');
    (el as unknown as { animate: unknown }).animate = () => fake;
    const op = beginOp();
    const a = anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 100 });
    beginOp(); // newer action cancels it
    expect(fake.cancel).toHaveBeenCalled();
    await expect(a.finished).resolves.toBe(false);
    // a stale token starts nothing
    expect(isCurrent(op)).toBe(false);
    await expect(anim(el, [], { duration: 1, op }).finished).resolves.toBe(false);
  });
});

describe('voice envelope', () => {
  it('stays in 0..1, rises within ~50ms and falls slower than it rises', () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const env = createEnvelope(rng);
    let max = 0;
    let min = 1;
    for (let i = 0; i < 600; i++) {
      const v = env.step(1 / 60);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (i > 30) {
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
    }
    expect(max).toBeGreaterThan(0.7); // syllable peaks
    expect(min).toBeLessThan(0.45); // word gaps / syllable valleys
  });
});
