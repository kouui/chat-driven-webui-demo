// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { bindNav, navigate } from '../navigate';
import { setState } from '../state';
import { initRouter } from '../router';

window.matchMedia = ((q: string) => ({ matches: false, addEventListener() {}, removeEventListener() {}, media: q })) as unknown as typeof window.matchMedia;

describe('navigate: close', () => {
  it('starts the visible close at once, before history catches up (the old operation is invalidated immediately)', () => {
    initRouter(() => {});
    const order: string[] = [];
    const back = vi.spyOn(history, 'back').mockImplementation(() => void order.push('history.back'));
    bindNav({
      touch() {},
      showPage() {},
      showHome: () => order.push('showHome'),
      openWheel() {},
      openTutorial() {},
      closeWheel() {},
      closeTutorial() {},
      cancelVoice() {},
    });
    history.pushState({ aurea: true }, '', '#/risk');
    setState({ route: 'risk' });
    navigate({ id: 'sys:home' }, { source: 'system' });
    expect(order).toEqual(['showHome', 'history.back']);
    back.mockRestore();
  });

  it('a page leaves the wheel / sheet in place (hold) so the screen is never empty', () => {
    const closes: unknown[] = [];
    bindNav({ touch() {}, showPage() {}, showHome() {}, openWheel() {}, openTutorial() {}, closeWheel: (o) => closes.push(o), closeTutorial() {}, cancelVoice() {} });
    setState({ route: null });
    navigate({ id: 'risk' }, { source: 'wheel' });
    expect(closes[0]).toMatchObject({ hold: true });
    navigate({ id: 'sys:home' }, { source: 'text' });
    expect(closes[1]).not.toMatchObject({ hold: true });
  });
});
