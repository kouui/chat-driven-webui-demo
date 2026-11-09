// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGuide } from './guide';
import type { Butterfly, PerchOpts } from '../types';

function fake(): { b: Butterfly & { underline: ReturnType<typeof vi.fn> }; land: (ok: boolean) => void; opts: PerchOpts[]; calls: string[] } {
  let resolve: (v: boolean) => void = () => {};
  const opts: PerchOpts[] = [];
  const calls: string[] = [];
  const b = {
    flyTo: vi.fn((_t: unknown, o?: PerchOpts) => {
      opts.push(o ?? {});
      return new Promise<boolean>((r) => (resolve = r));
    }),
    home: vi.fn(async () => true),
    underline: vi.fn(() => calls.push('underline')),
  } as unknown as Butterfly & { underline: ReturnType<typeof vi.fn> };
  return { b, land: (ok) => resolve(ok), opts, calls };
}

let el: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
  el = document.getElementById('a') as HTMLElement;
});
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('guide.focus', () => {
  it('forwards PerchOpts and orders landing -> reveal -> underline -> pulse', async () => {
    const f = fake();
    const g = createGuide(f.b);
    const onApproach = vi.fn();
    let revealed = false;
    const p = g.focus(el, {
      minDuration: 500,
      trail: 'light',
      onApproach,
      underline: true,
      reveal: async () => {
        f.calls.push('reveal');
        await tick();
        revealed = true;
      },
    });
    expect(f.opts[0]).toMatchObject({ minDuration: 500, trail: 'light', onApproach });
    await tick();
    expect(f.calls).toEqual([]);
    expect(el.classList.contains('bf-pulse')).toBe(false);
    f.land(true);
    await tick();
    expect(f.calls).toEqual(['reveal']);
    expect(el.classList.contains('bf-pulse')).toBe(false); // not before reveal resolved
    await tick();
    expect(revealed).toBe(true);
    expect(await p).toBe(true);
    expect(f.calls).toEqual(['reveal', 'underline']);
    expect(el.classList.contains('bf-pulse')).toBe(true);
  });
  it('a cancelled flight never reveals or pulses', async () => {
    const f = fake();
    const g = createGuide(f.b);
    const reveal = vi.fn();
    const p = g.focus(el, { reveal, underline: true });
    f.land(false);
    expect(await p).toBe(false);
    expect(reveal).not.toHaveBeenCalled();
    expect(f.b.underline).not.toHaveBeenCalled();
    expect(el.classList.contains('bf-pulse')).toBe(false);
  });
  it('a newer focus during reveal cancels the underline and the pulse of the older one', async () => {
    const f = fake();
    const g = createGuide(f.b);
    let finish: () => void = () => {};
    const p = g.focus(el, { underline: true, reveal: () => new Promise<void>((r) => (finish = r)) });
    f.land(true);
    await tick();
    void g.focus(document.getElementById('b') as HTMLElement); // newer action
    finish();
    expect(await p).toBe(false);
    expect(f.b.underline).not.toHaveBeenCalled();
    expect(el.classList.contains('bf-pulse')).toBe(false);
  });
  it('release during reveal also cancels', async () => {
    const f = fake();
    const g = createGuide(f.b);
    let finish: () => void = () => {};
    const p = g.focus(el, { reveal: () => new Promise<void>((r) => (finish = r)) });
    f.land(true);
    await tick();
    void g.release();
    finish();
    expect(await p).toBe(false);
    expect(el.classList.contains('bf-pulse')).toBe(false);
  });
});

describe('guide.cancel (bound to the app operation token)', () => {
  it('cancel during reveal: no underline, no pulse, focus resolves false; the butterfly is not touched', async () => {
    const f = fake();
    const g = createGuide(f.b);
    let finish: () => void = () => {};
    const p = g.focus(el, { underline: true, reveal: () => new Promise<void>((r) => (finish = r)) });
    f.land(true);
    await tick();
    g.cancel();
    finish();
    expect(await p).toBe(false);
    expect(f.b.underline).not.toHaveBeenCalled();
    expect(el.classList.contains('bf-pulse')).toBe(false);
    expect(f.b.home).not.toHaveBeenCalled();
  });
  it('cancel clears a running pulse and the underline, and a later focus works normally', async () => {
    const f = fake();
    const clearUnderline = vi.fn();
    (f.b as unknown as { clearUnderline: () => void }).clearUnderline = clearUnderline;
    const g = createGuide(f.b);
    const p = g.focus(el, {});
    f.land(true);
    await p;
    expect(el.classList.contains('bf-pulse')).toBe(true);
    g.cancel();
    expect(el.classList.contains('bf-pulse')).toBe(false);
    expect(clearUnderline).toHaveBeenCalled();
    const p2 = g.focus(document.getElementById('b') as HTMLElement, {});
    f.land(true);
    expect(await p2).toBe(true);
  });
  it('cancel while the flight is still in the air: the landing triggers nothing', async () => {
    const f = fake();
    const g = createGuide(f.b);
    const reveal = vi.fn();
    const p = g.focus(el, { reveal, underline: true });
    g.cancel();
    f.land(true);
    expect(await p).toBe(false);
    expect(reveal).not.toHaveBeenCalled();
    expect(el.classList.contains('bf-pulse')).toBe(false);
  });
});

describe('A4 guide pace', () => {
  it('forwards maxDuration and holds the pulse for 600ms', async () => {
    vi.useFakeTimers();
    try {
      const f = fake();
      const g = createGuide(f.b);
      const p = g.focus(el, { maxDuration: 420 });
      expect(f.opts[0]).toMatchObject({ maxDuration: 420 });
      f.land(true);
      await p;
      expect(el.classList.contains('bf-pulse')).toBe(true);
      vi.advanceTimersByTime(599);
      expect(el.classList.contains('bf-pulse')).toBe(true);
      vi.advanceTimersByTime(2);
      expect(el.classList.contains('bf-pulse')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
