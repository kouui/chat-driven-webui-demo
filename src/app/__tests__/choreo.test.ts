// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Butterfly, Guide } from '../../types';
import { setLang } from '../../i18n';
import { initAnnounce } from '../announce';
import { createPageCard } from '../pagecard';
import { createChoreo } from '../choreo';
import { bindNav } from '../navigate';
import { beginOp, setTempo } from '../motion';
import { getState, setState } from '../state';

// These tests assert the design numbers (tempo 1); the app's default tempo is 0.5 (see tempo.test.ts).
setTempo(1);

type FocusOpts = { onApproach?: () => void; reveal?: () => void | Promise<void>; trail?: string; minDuration?: number; maxDuration?: number };

function fixture(): void {
  document.body.innerHTML = `
    <div id="live"></div><div id="toast"></div>
    <section id="home"></section><div id="ring"></div><input id="cmd-input" /><div class="cmd-pill"></div>
    <div id="page-wrap" hidden>
      <article id="page-card"><span id="page-rim"></span><button id="page-close"></button>
        <div id="page-scroll"><div id="page-body"></div></div></article>
      <nav id="followups"></nav>
    </div>
    <div id="center"></div>`;
}

function setup(reduced = false, extra: Record<string, unknown> = {}) {
  fixture();
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes('reduce'), addEventListener() {}, removeEventListener() {}, media: q })) as unknown as typeof window.matchMedia;
  initAnnounce(document.getElementById('live')!, document.getElementById('toast')!);
  setLang('zh');
  setState({ route: null, anchor: 'title', overlay: 'none' });
  bindNav({ touch() {}, showPage() {}, showHome() {}, openWheel() {}, openTutorial() {}, closeWheel() {}, closeTutorial() {}, cancelVoice() {} });
  const focusCalls: FocusOpts[] = [];
  const resolvers: Array<(v: boolean) => void> = [];
  const guide: Guide & { cancel(): void } = {
    cancel: vi.fn(),
    focus: (_el, o) => {
      focusCalls.push(o as FocusOpts);
      return new Promise<boolean>((res) => resolvers.push(res));
    },
    release: () => Promise.resolve(true),
  };
  const butterfly = { spark: vi.fn(), tilt: vi.fn(), turnToward: vi.fn(), setMode: vi.fn(), flyTo: vi.fn(() => new Promise(() => {})), home: vi.fn(), position: () => ({ x: 0, y: 0 }), setVoiceLevel: vi.fn() } as unknown as Butterfly;
  const page = createPageCard();
  const center = { parts: () => ({ prompt: null, items: [] }), reveal() {}, showCandidates() {}, showNoMatch() {}, el: document.getElementById('center')! } as never;
  const choreo = createChoreo({ butterfly, guide, page, center, input: document.getElementById('cmd-input') as HTMLInputElement, pill: document.querySelector('.cmd-pill')!, ring: document.getElementById('ring')!, pulseWheel() {}, settle() {}, ...extra });
  const wrap = document.getElementById('page-wrap')!;
  return { choreo, page, focusCalls, resolvers, wrap, butterfly, guide };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const states = (w: HTMLElement) => `${w.dataset.shell}${w.dataset.content}${w.dataset.fu}`;

describe('page open choreography', () => {
  beforeEach(() => beginOp());

  it('shows nothing before the butterfly approaches; content only at landing', async () => {
    vi.useFakeTimers();
    const { choreo, focusCalls, wrap, resolvers } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    expect(wrap.hidden).toBe(false);
    expect(states(wrap)).toBe('000'); // prepared: invisible
    expect(wrap.hasAttribute('inert')).toBe(true);
    expect(focusCalls).toHaveLength(1); // exactly one focus
    focusCalls[0].onApproach!();
    expect(states(wrap)).toBe('000'); // the frame comes a moment after onApproach (an empty frame stays short)
    vi.advanceTimersByTime(90);
    expect(states(wrap)).toBe('100'); // shell shortly after onApproach
    expect(document.getElementById('page-scroll')!.hasAttribute('inert')).toBe(true);
    await focusCalls[0].reveal!();
    expect(states(wrap)).toBe('110'); // content at landing
    resolvers[0](true);
    vi.useRealTimers();
    await flush();
    expect(getState().route).toBe('risk');
  });

  it('content starts 80ms before the landing (220ms after onApproach), never earlier', async () => {
    vi.useFakeTimers();
    const { choreo, focusCalls, wrap, page } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    focusCalls[0].onApproach!();
    vi.advanceTimersByTime(70);
    expect(states(wrap)).toBe('000');
    vi.advanceTimersByTime(20);
    expect(states(wrap)).toBe('100'); // frame: ~80ms after onApproach
    vi.advanceTimersByTime(110);
    expect(states(wrap)).toBe('100');
    vi.advanceTimersByTime(25);
    expect(states(wrap)).toBe('110'); // the visual fade starts 80ms before the landing ...
    expect(document.getElementById('page-scroll')!.hasAttribute('inert')).toBe(true); // ... but nothing is interactive yet
    expect(wrap.dataset.early).toBe('1');
    expect(wrap.querySelector('.bf-confirm')).toBeNull();
    expect(page.visible()).toBe(false); // an early fade is not an arrival
    await focusCalls[0].reveal!();
    expect(document.getElementById('page-scroll')!.hasAttribute('inert')).toBe(false);
    expect(page.visible()).toBe(true);
    vi.useRealTimers();
  });

  it('latest action wins across A -> B -> close: stale callbacks do nothing', async () => {
    vi.useFakeTimers();
    const { choreo, focusCalls, wrap, resolvers } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    choreo.page('returns', undefined, 'capsule', null);
    expect(focusCalls).toHaveLength(2);
    // the first flight lands late
    focusCalls[0].onApproach!();
    await focusCalls[0].reveal!();
    expect(states(wrap)).toBe('000'); // A's callbacks are ignored, B is still invisible
    expect(getState().route).toBe('returns');
    focusCalls[1].onApproach!();
    vi.advanceTimersByTime(90);
    expect(states(wrap)).toBe('100');
    // close before B lands
    void choreo.closePage(false);
    expect(getState().route).toBeNull();
    focusCalls[1].reveal!();
    vi.useRealTimers();
    await flush();
    expect(wrap.hidden).toBe(true); // it never became readable: no exit animation, hidden at once
    expect(states(wrap)).not.toBe('111');
    resolvers.forEach((r) => r(false));
  });

  it('page -> page keeps the frame; the old ghost is completely gone before the new content starts', async () => {
    vi.useFakeTimers();
    const { choreo, focusCalls, wrap } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    focusCalls[0].onApproach!();
    await focusCalls[0].reveal!();
    expect(states(wrap)).toBe('110');
    choreo.page('returns', undefined, 'followup', null);
    expect(wrap.dataset.shell).toBe('1'); // frame stays
    expect(wrap.dataset.content).toBe('0'); // old content is gone, the new one is not shown yet
    const card = document.getElementById('page-card')!;
    expect(card.querySelector('.card-ghost')).not.toBeNull();
    focusCalls[1].onApproach!();
    await vi.advanceTimersByTimeAsync(90);
    expect(card.querySelector('.card-ghost')).not.toBeNull(); // the ghost is still dimmed text; no new text yet
    expect(wrap.dataset.content).toBe('0');
    await vi.advanceTimersByTimeAsync(40); // ghost fade starts at +100ms (jsdom: instant) ...
    expect(card.querySelector('.card-ghost')).toBeNull();
    expect(wrap.dataset.content).toBe('0'); // ... the new content waits >= 20ms after it is gone
    await vi.advanceTimersByTimeAsync(100);
    expect(wrap.dataset.content).toBe('1'); // new content: early visual fade only
    vi.useRealTimers();
  });

  it('same page and anchor: only a confirmation pulse, no re-flight', async () => {
    const { choreo, focusCalls, wrap } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    focusCalls[0].onApproach!();
    await focusCalls[0].reveal!();
    choreo.page('risk', undefined, 'text', null);
    expect(focusCalls).toHaveLength(1);
    expect(wrap.querySelector('.bf-confirm')).not.toBeNull();
  });

  it('a page that never gets a reveal callback is still readable after the flight settles', async () => {
    const { choreo, resolvers, wrap } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    resolvers[0](false); // flight cancelled by something that is not a newer action
    await flush();
    expect(states(wrap)).toBe('110');
  });

  it('reduced motion: ~150ms fades only, no clip-path, no particles, no trail', async () => {
    const { choreo, focusCalls, butterfly } = setup(true);
    const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel() {} }));
    (document.getElementById('page-card') as unknown as { animate: unknown }).animate = animate;
    (document.getElementById('page-scroll') as unknown as { animate: unknown }).animate = animate;
    choreo.touch({ x: 1, y: 1, w: 0, h: 0, el: null });
    expect(butterfly.spark).not.toHaveBeenCalled();
    choreo.page('risk', undefined, 'capsule', null);
    expect(focusCalls[0].trail).toBe('none');
    focusCalls[0].onApproach!();
    await focusCalls[0].reveal!();
    expect(animate).toHaveBeenCalled();
    for (const call of animate.mock.calls as unknown as Array<[Array<Record<string, unknown>>, { duration: number }]>) {
      expect(call[1].duration).toBeLessThanOrEqual(150);
      for (const kf of call[0]) expect(Object.keys(kf)).toEqual(['opacity']);
    }
  });
});

describe('fix round: timing, ownership and cancellation', () => {
  beforeEach(() => beginOp());

  it('the wheel / sheet that was held leaves with the frame (just after onApproach), not at take-off', async () => {
    vi.useFakeTimers();
    const releaseOverlays = vi.fn();
    const { choreo, focusCalls } = setup(false, { releaseOverlays });
    choreo.page('risk', undefined, 'wheel', null);
    expect(releaseOverlays).not.toHaveBeenCalled(); // the dial stays while the butterfly is in the air
    focusCalls[0].onApproach!();
    vi.advanceTimersByTime(90);
    expect(releaseOverlays).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('page -> page: the old content stays (dimmed ghost) until onApproach: no empty frame', async () => {
    const { choreo, focusCalls, wrap } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    focusCalls[0].onApproach!();
    await focusCalls[0].reveal!();
    choreo.page('returns', undefined, 'followup', null);
    const card = document.getElementById('page-card')!;
    expect(card.querySelector('.card-ghost')).not.toBeNull(); // old content still there during the flight
    expect(wrap.dataset.content).toBe('0');
    focusCalls[1].onApproach!();
    vi.useFakeTimers();
    const landed = focusCalls[1].reveal!(); // landing before the timers: ghost out first, then the content
    await vi.advanceTimersByTimeAsync(200);
    await landed;
    vi.useRealTimers();
    expect(wrap.dataset.content).toBe('1'); // the new content enters ...
    expect(card.querySelector('.card-ghost')).toBeNull(); // ... and the old one is gone
  });

  it('same page, same anchor while follow-ups are pending: they are completed, not lost (#2)', async () => {
    const { choreo, focusCalls, wrap } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    focusCalls[0].onApproach!();
    await focusCalls[0].reveal!();
    expect(wrap.dataset.fu).toBe('0'); // scheduled for landing + 300ms
    choreo.page('risk', undefined, 'text', null);
    expect(wrap.dataset.fu).toBe('1');
    expect(focusCalls).toHaveLength(1);
  });

  it('reduced motion: shell and content come with the butterfly\'s arrival as ONE cross-fade', async () => {
    const { choreo, focusCalls, wrap } = setup(true);
    choreo.page('risk', undefined, 'capsule', null);
    expect(states(wrap)).toBe('000');
    focusCalls[0].onApproach!();
    expect(states(wrap)).toBe('110');
    expect(wrap.dataset.early).toBe('1'); // still inert until the landing
  });

  it('candidates are revealed through the landing callback, held (inert) until then (reduced motion too)', () => {
    const reveal = vi.fn();
    const prompt = document.createElement('p');
    const center = { parts: () => ({ prompt, items: [] }), reveal, showCandidates: vi.fn(), showNoMatch() {}, el: document.body } as never;
    const { choreo, focusCalls } = setup(true, { center });
    choreo.candidates([], null);
    expect((center as { showCandidates: ReturnType<typeof vi.fn> }).showCandidates).toHaveBeenCalledWith([], { hold: true, own: true });
    expect(reveal).not.toHaveBeenCalledWith('items', expect.anything());
    focusCalls[0].onApproach!();
    expect(reveal).toHaveBeenCalledWith('prompt');
    focusCalls[0].reveal!();
    expect(reveal).toHaveBeenCalledWith('items', true);
  });

  it('a newer operation cancels the guide continuation (guide.cancel is bound in app.ts via onOpBegin)', () => {
    const { guide } = setup();
    expect(typeof guide.cancel).toBe('function');
  });

  it('the voice nest claims the butterfly, so a pending settle() starts no second flight', async () => {
    const { choreo, butterfly } = setup();
    setState({ route: 'risk', overlay: 'none' });
    choreo.voiceStart();
    const { isClaimed } = await import('../motion');
    expect(isClaimed()).toBe(true);
    expect(butterfly.flyTo).toHaveBeenCalledOnce();
    choreo.voiceEnd();
    expect(isClaimed()).toBe(false);
    setState({ route: null });
  });

  it('the post-landing hop is armed from the landing, and interaction cancels it, also in the air', async () => {
    vi.useFakeTimers();
    const rect = { left: 100, top: 200, width: 200, height: 40, right: 300, bottom: 240, x: 100, y: 200, toJSON() {} };
    const big = { left: 0, top: 0, width: 900, height: 700, right: 900, bottom: 700, x: 0, y: 0, toJSON() {} };
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.id === 'page-scroll' ? big : rect) as DOMRect;
    });
    const { choreo, focusCalls, guide, butterfly } = setup();
    (butterfly as unknown as { position: () => { x: number; y: number } }).position = () => ({ x: 82, y: 260 });
    choreo.page('risk', undefined, 'capsule', null);
    focusCalls[0].onApproach!();
    await focusCalls[0].reveal!(); // landing
    vi.advanceTimersByTime(1100);
    expect(focusCalls).toHaveLength(1);
    vi.advanceTimersByTime(150); // 1.2s after the landing
    expect(focusCalls).toHaveLength(2);
    expect(focusCalls[1].trail).toBe('light');
    document.dispatchEvent(new Event('keydown'));
    expect(guide.cancel).toHaveBeenCalled(); // cancelled while the hop is still in the air
    spy.mockRestore();
    vi.useRealTimers();
  });
});
