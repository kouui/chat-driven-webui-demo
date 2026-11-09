// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initRouter, leaveToHome, writeRoute } from '../router';
import type { Route, RouteCtx } from '../router';

const calls: { r: Route; ctx: RouteCtx }[] = [];
const popped = (): Promise<void> => new Promise((res) => window.addEventListener('popstate', () => setTimeout(res, 0), { once: true }));

beforeAll(() => {
  initRouter((r, ctx) => calls.push({ r, ctx }));
});
afterEach(() => {
  history.replaceState(null, '', '#/');
  calls.length = 0;
  vi.useRealTimers();
});

// The visible close starts before history is touched (navigate.ts); the router only reconciles history afterwards and
// never re-applies the home view: its completion is not a newer user action.
describe('router: history catches up with a close that has already started', () => {
  it('a plain close steps back and shows nothing when the popstate arrives', async () => {
    writeRoute({ id: 'risk' }, true); // home -> page pushes our entry
    const done = popped();
    expect(leaveToHome()).toBe(true);
    await done;
    expect(calls).toHaveLength(0);
    expect(location.hash === '' || location.hash === '#/').toBe(true);
  });

  it('a page opened during the close is re-pushed instead of leaving history on home', async () => {
    writeRoute({ id: 'risk' }, true);
    const done = popped();
    leaveToHome();
    writeRoute({ id: 'returns' }, false);
    await done;
    expect(calls).toHaveLength(0);
    expect(location.hash).toBe('#/returns');
    expect((history.state as { aurea?: boolean }).aurea).toBe(true);
  });

  it('a newer close cancels the page that was waiting to replace it', async () => {
    writeRoute({ id: 'risk' }, true);
    const done = popped();
    leaveToHome();
    writeRoute({ id: 'returns' }, false);
    leaveToHome(); // coalesces into the pending traversal
    await done;
    expect(calls).toHaveLength(0);
    expect(location.hash === '' || location.hash === '#/').toBe(true);
  });

  it('a popstate that never arrives is fixed by the safety timer (no UI call either way)', () => {
    vi.useFakeTimers();
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    writeRoute({ id: 'risk' }, true);
    leaveToHome();
    expect(location.hash).toBe('#/risk');
    vi.advanceTimersByTime(700);
    expect(calls).toHaveLength(0);
    expect(location.hash).toBe('#/');
    back.mockRestore();
    // navigation is not wedged afterwards: a new close starts a new traversal
    expect(leaveToHome()).toBe(false); // state was reset by the replaceState, so it rewrites to home
  });
});
