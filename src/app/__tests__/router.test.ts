// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initRouter, leaveToHome, noteOverlayOpened, writeRoute } from '../router';
import type { Route, RouteCtx } from '../router';

const calls: { r: Route; ctx: RouteCtx }[] = [];
const popped = (): Promise<void> => new Promise((res) => window.addEventListener('popstate', () => setTimeout(res, 0), { once: true }));

beforeAll(() => {
  initRouter((r, ctx) => calls.push({ r, ctx }));
});
afterEach(() => {
  calls.length = 0;
  vi.useRealTimers();
});

describe('router: the latest action wins over a pending close', () => {
  it('an overlay opened during the close survives the home completion (keepOverlay)', async () => {
    writeRoute({ id: 'risk' }, true); // home -> page pushes our entry
    const done = popped();
    expect(leaveToHome({ source: 'system' })).toBe(true);
    noteOverlayOpened(); // the wheel was opened before the popstate
    await done;
    expect(calls).toHaveLength(1);
    expect(calls[0].r.id).toBeNull();
    expect(calls[0].ctx.keepOverlay).toBe(true);
  });

  it('a plain close carries no keepOverlay', async () => {
    writeRoute({ id: 'risk' }, true);
    const done = popped();
    leaveToHome({ source: 'system' });
    await done;
    expect(calls[0].ctx.keepOverlay).toBeFalsy();
  });

  it('a newer close cancels the overlay the older one was keeping', async () => {
    writeRoute({ id: 'risk' }, true);
    const done = popped();
    leaveToHome({ source: 'system' });
    noteOverlayOpened();
    leaveToHome({ source: 'text' }); // coalesces, newest wins
    await done;
    expect(calls).toHaveLength(1);
    expect(calls[0].ctx.source).toBe('text');
    expect(calls[0].ctx.keepOverlay).toBeFalsy();
  });

  it('a page opened during the close is re-pushed instead of showing home', async () => {
    writeRoute({ id: 'risk' }, true);
    const done = popped();
    leaveToHome({ source: 'system' });
    writeRoute({ id: 'returns' }, false);
    await done;
    expect(calls).toHaveLength(0);
    expect(location.hash).toBe('#/returns');
    expect((history.state as { aurea?: boolean }).aurea).toBe(true);
  });

  it('a popstate that never arrives is applied by the safety timer', () => {
    vi.useFakeTimers();
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    writeRoute({ id: 'risk' }, true);
    leaveToHome({ source: 'system' });
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(700);
    expect(calls).toHaveLength(1);
    expect(calls[0].r.id).toBeNull();
    expect(location.hash).toBe('#/');
    back.mockRestore();
    // navigation is not wedged afterwards: a new close starts a new traversal
    expect(leaveToHome({ source: 'system' })).toBe(false); // state was reset by the replaceState, so it rewrites to home
  });
});
