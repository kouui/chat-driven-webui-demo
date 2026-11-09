// @vitest-environment jsdom
// Regression: the wheel (and the mobile tutorial sheet) must leave on every selection path, including page -> page,
// where the page frame is already on screen and so never "appears" (the held overlay used to wait for that).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Butterfly, Guide } from '../../types';
import { setLang } from '../../i18n';
import { initAnnounce } from '../announce';
import { createPageCard } from '../pagecard';
import { createChoreo } from '../choreo';
import { createWheel } from '../wheel';
import { createTutorial } from '../tutorial';
import type { Tutorial } from '../tutorial';
import type { Wheel } from '../wheel';
import { bindNav, navigate } from '../navigate';
import { beginOp, setTempo } from '../motion';
import { getState, setState } from '../state';

type FocusOpts = { onApproach?: () => void; reveal?: () => void | Promise<void> };

function setup(reduced: boolean, mobile = false) {
  document.body.innerHTML = `
    <div id="live"></div><div id="toast"></div>
    <section id="home"></section><div id="ring"></div><input id="cmd-input" /><div class="cmd-pill"></div>
    <button id="btn-wheel"></button><div id="scrim" hidden></div>
    <div id="wheel" hidden><h2 id="wheel-title"></h2><p id="wheel-hint"></p><div id="wheel-svg-host"></div><button id="wheel-close"></button><span id="wheel-rim"></span></div>
    <div id="page-wrap" hidden>
      <article id="page-card"><span id="page-rim"></span><button id="page-close"></button>
        <div id="page-scroll"><div id="page-body"></div></div></article>
      <nav id="followups"></nav>
    </div>
    <div id="center"></div><button id="btn-tutorial"></button>
    <aside id="tutorial" hidden><h2 id="tut-title" tabindex="-1"></h2><p id="tut-intro"></p><ol id="tut-steps"></ol>
      <div><span id="tut-progress"></span></div><button id="tut-close"></button></aside>`;
  window.matchMedia = ((q: string) => ({ matches: (reduced && q.includes('reduce')) || (mobile && q.includes('max-width')), addEventListener() {}, removeEventListener() {}, media: q })) as unknown as typeof window.matchMedia;
  initAnnounce(document.getElementById('live')!, document.getElementById('toast')!);
  setLang('en');
  setState({ route: null, anchor: 'title', overlay: 'none' });
  const focusCalls: FocusOpts[] = [];
  const resolvers: Array<(v: boolean) => void> = [];
  const guide: Guide & { cancel(): void } = {
    cancel: vi.fn(),
    focus: (_el, o) => {
      focusCalls.push(o as FocusOpts);
      return new Promise<boolean>((res) => resolvers.push(res)); // the test drives approach / reveal / landing
    },
    release: () => Promise.resolve(true),
  };
  const butterfly = { spark: vi.fn(), tilt: vi.fn(), turnToward: vi.fn(), setMode: vi.fn(), flyTo: vi.fn(() => new Promise(() => {})), home: vi.fn(), position: () => ({ x: 0, y: 0 }), setVoiceLevel: vi.fn() } as unknown as Butterfly;
  const page = createPageCard();
  const center = { parts: () => ({ prompt: null, items: [] }), reveal() {}, showCandidates() {}, showNoMatch() {}, el: document.getElementById('center')! } as never;
  const input = document.getElementById('cmd-input') as HTMLInputElement;
  const wheelBtn = document.getElementById('btn-wheel')!;
  let wheel!: Wheel;
  let tutorial!: Tutorial;
  const choreo = createChoreo({
    butterfly, guide, page, center, input, pill: document.querySelector('.cmd-pill')!, ring: document.getElementById('ring')!,
    pulseWheel() {}, settle() {}, releaseOverlays: () => {
      wheel.release();
      tutorial.release();
    },
  });
  wheel = createWheel({ input, scrim: document.getElementById('scrim')!, button: wheelBtn, settle() {} });
  tutorial = createTutorial({ input, scrim: document.getElementById('scrim')!, button: document.getElementById('btn-tutorial')!, wheelButton: wheelBtn, settle() {} });
  bindNav({
    touch() {},
    showPage: (id, anchor, source, origin) => choreo.page(id, anchor, source, origin),
    showHome() {},
    openWheel: (tr) => {
      choreo.overlayOpened(); // as in app.ts: opening the dial begins an operation
      wheel.open(tr);
    },
    openTutorial: (tr) => {
      choreo.overlayOpened();
      wheel.close({ restoreFocus: false, settle: false });
      tutorial.open(tr);
    },
    closeWheel: (o) => wheel.close(o),
    closeTutorial: (o) => tutorial.close(o),
    cancelVoice() {},
  });
  return { choreo, wheel, tutorial, focusCalls, resolvers, wheelBtn };
}

const wheelEl = () => document.getElementById('wheel')!;
const scrim = () => document.getElementById('scrim')!;

for (const speed of [1, 0.5]) {
  for (const reduced of [false, true]) {
    describe(`wheel selection closes the wheel (speed ${speed}${reduced ? ', reduced motion' : ''})`, () => {
      beforeEach(() => {
        vi.useFakeTimers();
        setTempo(speed);
        beginOp();
      });
      afterEach(() => vi.useRealTimers());

      async function openPageFirst(s: ReturnType<typeof setup>): Promise<void> {
        navigate({ id: 'risk' }, { source: 'capsule' });
        s.focusCalls[0].onApproach!();
        await s.focusCalls[0].reveal!();
        s.resolvers[0](true); // landed: the operation ends (its pending bindings are dropped), as in the real app
        await vi.advanceTimersByTimeAsync(3000);
        expect(getState().route).toBe('risk');
      }

      async function pick(s: ReturnType<typeof setup>, id: 'returns' | 'risk'): Promise<void> {
        navigate({ id: 'sys:wheel' }, { trigger: s.wheelBtn });
        expect(s.wheel.isOpen()).toBe(true);
        expect(scrim().hidden).toBe(false);
        navigate({ id }, { source: 'wheel' });
        expect(s.wheel.isOpen()).toBe(false);
        expect(getState().overlay).toBe('none');
      }

      async function gone(): Promise<void> {
        await vi.advanceTimersByTimeAsync(2000);
        expect(wheelEl().hidden).toBe(true);
        expect(scrim().hidden).toBe(true);
        expect(document.body.classList.contains('overlay-wheel')).toBe(false);
      }

      it('home -> page', async () => {
        const s = setup(reduced);
        await pick(s, 'risk');
        s.focusCalls[0].onApproach!();
        await vi.advanceTimersByTimeAsync(1000);
        await gone();
      });

      it('page -> another page (the frame is already shown)', async () => {
        const s = setup(reduced);
        await openPageFirst(s);
        await pick(s, 'returns');
        const c = s.focusCalls[s.focusCalls.length - 1];
        c.onApproach!();
        await vi.advanceTimersByTimeAsync(1000);
        await gone();
      });

      it('page -> another page when the flight never reports (watchdog)', async () => {
        const s = setup(reduced);
        await openPageFirst(s);
        await pick(s, 'returns');
        await vi.advanceTimersByTimeAsync(6000);
        await gone();
      });

      it('same page, same anchor', async () => {
        const s = setup(reduced);
        await openPageFirst(s);
        await pick(s, 'risk');
        await gone();
      });
    });
  }
}

describe('mobile tutorial sheet closes when a step navigates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setTempo(1);
    beginOp();
  });
  afterEach(() => vi.useRealTimers());

  for (const reduced of [false, true]) {
    it(`page -> page${reduced ? ' (reduced motion)' : ''}`, async () => {
      const s = setup(reduced, true);
      navigate({ id: 'overview' }, { source: 'capsule' });
      s.focusCalls[0].onApproach!();
      await s.focusCalls[0].reveal!();
      s.resolvers[0](true);
      await vi.advanceTimersByTimeAsync(3000);
      navigate({ id: 'sys:tutorial' }, { trigger: document.getElementById('btn-tutorial') });
      expect(s.tutorial.isOpen()).toBe(true);
      const tut = document.getElementById('tutorial')!;
      expect(tut.hidden).toBe(false);
      document.querySelector<HTMLElement>('#tut-steps [data-step="4"]')!.click(); // -> risk
      expect(s.tutorial.isOpen()).toBe(false);
      s.focusCalls[s.focusCalls.length - 1].onApproach!();
      await vi.advanceTimersByTimeAsync(2000);
      expect(tut.hidden).toBe(true);
      expect(scrim().hidden).toBe(true);
      expect(document.body.classList.contains('overlay-tutorial')).toBe(false);
    });
  }
});
