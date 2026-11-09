// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feedback, getMotionPref, initMotionPref, onMotionChange, onOpBegin, beginOp, prefersReducedMotion, setMotionPref } from '../motion';
import { initAnnounce, announce } from '../announce';
import { watchHesitation } from '../hints';

const os = (reduced: boolean): void => {
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes('reduce'), addEventListener() {}, removeEventListener() {}, media: q })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

describe('motion preference: URL > localStorage > OS (A1)', () => {
  it('follows the OS when nothing else is set, and the html class follows it', () => {
    os(true);
    expect(initMotionPref('')).toBe('system');
    expect(prefersReducedMotion()).toBe(true);
    expect(document.documentElement.classList.contains('motion-reduced')).toBe(true);
    os(false);
    initMotionPref('');
    expect(prefersReducedMotion()).toBe(false);
    expect(document.documentElement.classList.contains('motion-reduced')).toBe(false);
  });

  it('localStorage beats the OS, the URL beats localStorage', () => {
    os(true);
    localStorage.setItem('aurea.motion', 'full');
    initMotionPref('');
    expect(getMotionPref()).toBe('full');
    expect(prefersReducedMotion()).toBe(false);
    initMotionPref('?motion=reduced');
    expect(prefersReducedMotion()).toBe(true);
    os(false);
    initMotionPref('?motion=full');
    expect(prefersReducedMotion()).toBe(false);
    localStorage.setItem('aurea.motion', 'reduced');
    initMotionPref('?motion=bogus'); // an invalid URL value is ignored
    expect(getMotionPref()).toBe('reduced');
  });

  it('the toggle stores the choice, updates the class and notifies once', () => {
    os(true);
    initMotionPref('');
    const seen: boolean[] = [];
    const off = onMotionChange((r) => seen.push(r));
    setMotionPref('full');
    expect(localStorage.getItem('aurea.motion')).toBe('full');
    expect(document.documentElement.classList.contains('motion-reduced')).toBe(false);
    setMotionPref('reduced');
    expect(document.documentElement.classList.contains('motion-reduced')).toBe(true);
    expect(seen).toEqual([false, true]);
    off();
  });
});

describe('feedback classes', () => {
  it('an older timer never removes a newer flash on the same element', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    feedback(el, 'is-sent', 400);
    vi.advanceTimersByTime(300);
    feedback(el, 'is-sent', 400); // restarts
    vi.advanceTimersByTime(200); // the first timer would have fired here
    expect(el.classList.contains('is-sent')).toBe(true);
    vi.advanceTimersByTime(250);
    expect(el.classList.contains('is-sent')).toBe(false);
    vi.useRealTimers();
  });

  it('is cleared by the timeout (no animationend needed) and by a newer operation', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const op = beginOp();
    feedback(el, 'pulse-once', 1000, op);
    beginOp();
    expect(el.classList.contains('pulse-once')).toBe(false);
    feedback(el, 'pulse-once', 1000);
    vi.advanceTimersByTime(1100);
    expect(el.classList.contains('pulse-once')).toBe(false);
    vi.useRealTimers();
  });
});

describe('operation hooks and announcements', () => {
  it('guide.cancel() is bound to beginOp via onOpBegin', () => {
    const cancel = vi.fn();
    const off = onOpBegin(cancel);
    beginOp();
    beginOp();
    expect(cancel).toHaveBeenCalledTimes(2);
    off();
    beginOp();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('a queued announcement is dropped when a newer operation begins', () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const live = document.createElement('p');
    initAnnounce(live, document.createElement('div'));
    announce('old');
    beginOp();
    frames.splice(0).forEach((f) => f(0));
    expect(live.textContent).toBe('');
    announce('new');
    frames.splice(0).forEach((f) => f(0));
    expect(live.textContent).toBe('new');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});

describe('hesitation watcher', () => {
  it('activity cancels a running hint', () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fire = vi.fn();
    const off = watchHesitation({ ms: 1000, canHint: () => true, fire, cancel });
    vi.advanceTimersByTime(1100);
    expect(fire).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event('pointermove'));
    expect(cancel).toHaveBeenCalled();
    off();
    vi.useRealTimers();
  });
});

afterEach(() => vi.useRealTimers());
