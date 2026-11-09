// @vitest-environment jsdom
// Final app-side fix round: ownership, landing boundary, voice, hint, hop, pads, router, notice.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Butterfly, Guide } from '../../types';
import { perchPoint } from '../../butterfly';
import { destinations } from '../../data/destinations';
import { setLang } from '../../i18n';
import { initAnnounce } from '../announce';
import { createPageCard } from '../pagecard';
import { createChoreo } from '../choreo';
import { createPads } from '../pads';
import { createVoice } from '../voice';
import { createMotionUi } from '../motionui';
import { bindNav } from '../navigate';
import { beginOp, setMotionPref, initMotionPref, setTempo } from '../motion';
import { setState } from '../state';
import { initRouter, leaveToHome, writeRoute } from '../router';
import type { Route, RouteCtx } from '../router';

// These tests assert the design numbers (tempo 1); the app's default tempo is 0.5 (see tempo.test.ts).
setTempo(1);

type FocusOpts = { onApproach?: () => void; reveal?: () => void | Promise<void>; trail?: string; maxDuration?: number; dim?: boolean; pulse?: boolean };

function setup(reduced = false, extra: Record<string, unknown> = {}) {
  document.body.innerHTML = `
    <div id="live"></div><div id="toast"></div>
    <section id="home"></section><div id="ring"></div>
    <div class="input-wrap"><input id="cmd-input" /></div><div class="cmd-pill"></div><button id="wheelbtn"></button>
    <div id="page-wrap" hidden>
      <article id="page-card"><span id="page-rim"></span><button id="page-close"></button>
        <div id="page-scroll"><div id="page-body"></div></div></article>
      <nav id="followups"></nav>
    </div>
    <div id="center"></div>`;
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes('reduce'), addEventListener() {}, removeEventListener() {}, media: q })) as unknown as typeof window.matchMedia;
  initMotionPref('');
  initAnnounce(document.getElementById('live')!, document.getElementById('toast')!);
  setLang('zh');
  setState({ route: null, anchor: 'title', overlay: 'none', center: { kind: 'capsules' } });
  bindNav({ touch() {}, showPage() {}, showHome() {}, openWheel() {}, openTutorial() {}, closeWheel() {}, closeTutorial() {}, cancelVoice() {} });
  const focusCalls: FocusOpts[] = [];
  const resolvers: Array<(v: boolean) => void> = [];
  const release = vi.fn(() => Promise.resolve(true));
  const guide: Guide & { cancel(): void } = {
    cancel: vi.fn(),
    focus: (_el, o) => {
      focusCalls.push(o as FocusOpts);
      return new Promise<boolean>((res) => resolvers.push(res));
    },
    release,
  };
  const butterfly = { spark: vi.fn(), tilt: vi.fn(), turnToward: vi.fn(), setMode: vi.fn(), flyTo: vi.fn(() => new Promise(() => {})), home: vi.fn(() => new Promise(() => {})), position: () => ({ x: 0, y: 0 }), setVoiceLevel: vi.fn() } as unknown as Butterfly & { position: () => { x: number; y: number } };
  const page = createPageCard();
  const center = { parts: () => ({ prompt: null, items: [] }), reveal() {}, showCandidates() {}, showNoMatch() {}, el: document.getElementById('center')! } as never;
  const settle = vi.fn();
  const pulseWheel = vi.fn();
  const input = document.getElementById('cmd-input') as HTMLInputElement;
  const pill = document.querySelector<HTMLElement>('.cmd-pill')!;
  const choreo = createChoreo({ butterfly, guide, page, center, input, pill, ring: document.getElementById('ring')!, pulseWheel, settle, ...extra });
  return { choreo, page, focusCalls, resolvers, wrap: document.getElementById('page-wrap')!, butterfly, guide, release, settle, pulseWheel, input, pill };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const states = (w: HTMLElement) => `${w.dataset.shell}${w.dataset.content}${w.dataset.fu}`;
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

beforeEach(() => {
  beginOp();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('N2: a repeated request for the current anchor', () => {
  it('while the flight has not landed it joins the running sequence: no new operation, no early focus / announcement, confirmed at the landing', async () => {
    vi.useFakeTimers();
    const { choreo, focusCalls, wrap, settle } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    focusCalls[0].onApproach!();
    vi.advanceTimersByTime(230); // the early content fade is running (inert)
    expect(wrap.dataset.content).toBe('1');
    choreo.page('risk', undefined, 'text', null);
    expect(focusCalls).toHaveLength(1);
    expect(settle).not.toHaveBeenCalled();
    expect(wrap.querySelector('.bf-confirm')).toBeNull();
    expect(document.getElementById('live')!.textContent).toBe('');
    await focusCalls[0].reveal!(); // the ORIGINAL sequence is still current
    expect(wrap.querySelector('.bf-confirm')).not.toBeNull();
  });

  it('landed and sitting on the anchor: confirmation only; elsewhere (a wheel took it away): one settle', async () => {
    const { choreo, focusCalls, wrap, settle, butterfly, page } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    focusCalls[0].onApproach!();
    await flush();
    await focusCalls[0].reveal!();
    const tg = page.target()!;
    const at = perchPoint(tg.el.getBoundingClientRect(), tg.opts.side, tg.opts.within?.getBoundingClientRect() ?? null);
    butterfly.position = () => at;
    choreo.page('risk', undefined, 'text', null);
    expect(settle).not.toHaveBeenCalled();
    expect(focusCalls).toHaveLength(1);
    expect(wrap.querySelector('.bf-confirm')).not.toBeNull();
    butterfly.position = () => ({ x: at.x + 400, y: at.y + 300 });
    choreo.page('risk', undefined, 'text', null);
    expect(settle).toHaveBeenCalledOnce();
  });
});

describe('N4: no focus / announcement / pulse without a landing', () => {
  it('the watchdog and a failed flight make the page readable but do not announce or focus', async () => {
    vi.useFakeTimers();
    const { choreo, wrap, resolvers } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    await vi.advanceTimersByTimeAsync(2300); // no callback ever arrived
    expect(states(wrap)).toBe('111');
    expect(document.getElementById('page-scroll')!.hasAttribute('inert')).toBe(false);
    expect(document.getElementById('live')!.textContent).toBe('');
    expect(document.activeElement?.getAttribute('data-perch')).not.toBe('title');
    resolvers[0](false);
    await vi.advanceTimersByTimeAsync(100);
    expect(document.getElementById('live')!.textContent).toBe('');
  });

  it('a landing focuses and announces exactly once', async () => {
    const { choreo, focusCalls, resolvers } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    focusCalls[0].onApproach!();
    await flush();
    await focusCalls[0].reveal!();
    resolvers[0](true);
    await flush();
    await new Promise((r) => setTimeout(r, 60));
    expect(document.getElementById('live')!.textContent).not.toBe('');
  });
});

describe('N1: voice started right after a close', () => {
  it('acquires the ring (guide.release) before listening, owned by the voice operation', async () => {
    const { choreo, butterfly, release } = setup();
    const ring = document.getElementById('ring')!;
    ring.getBoundingClientRect = () => rect(100, 500, 200, 200);
    butterfly.position = () => ({ x: 883, y: 112 }); // still at the old page perch
    choreo.voiceStart();
    expect(release).toHaveBeenCalledOnce();
    expect(butterfly.setMode).not.toHaveBeenCalledWith('voice');
    await flush();
    expect(butterfly.setMode).toHaveBeenCalledWith('voice');
    const { isClaimed } = await import('../motion');
    expect(isClaimed()).toBe(true);
    choreo.voiceEnd();
  });

  it('already at the ring: listens at once, no flight', () => {
    const { choreo, butterfly, release } = setup();
    document.getElementById('ring')!.getBoundingClientRect = () => rect(100, 500, 200, 200);
    butterfly.position = () => ({ x: 200, y: 600 });
    choreo.voiceStart();
    expect(release).not.toHaveBeenCalled();
    expect(butterfly.setMode).toHaveBeenCalledWith('voice');
    choreo.voiceEnd();
  });
});

describe('N9 / N10: the voice nest', () => {
  it('follow-ups are inert while the nest is up and restored afterwards; the nest is a measurable element', async () => {
    const { choreo, focusCalls, butterfly, wrap } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    focusCalls[0].onApproach!();
    await flush();
    await focusCalls[0].reveal!();
    choreo.page('risk', 'concentration', 'text', null); // keeps fu state simple: reveal follow-ups
    wrap.dataset.fu = '1';
    document.getElementById('followups')!.removeAttribute('inert');
    setState({ route: 'risk' });
    choreo.voiceStart();
    expect(document.getElementById('followups')!.hasAttribute('inert')).toBe(true);
    const el = choreo.nestAnchor();
    expect(el).toBeInstanceOf(HTMLElement);
    const call = (butterfly.flyTo as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)!;
    expect(call[0]).toBe(el); // the butterfly measures the element (follows resize)
    expect((call[1] as { side: string }).side).toBe('top');
    choreo.voiceEnd();
    expect(document.getElementById('followups')!.hasAttribute('inert')).toBe(false);
    expect(choreo.nestAnchor()).toBeNull();
  });
});

describe('#10: flashes belong to the operation', () => {
  it('trigger and input flashes survive their own action and end with the next one', () => {
    const { choreo, pill } = setup();
    const btn = document.createElement('button');
    document.body.append(btn);
    choreo.touch({ x: 5, y: 5, w: 10, h: 10, el: btn });
    choreo.inputSent();
    choreo.page('risk', undefined, 'capsule', null); // the action the flashes belong to
    expect(btn.classList.contains('is-sent')).toBe(true);
    expect(pill.classList.contains('is-sent')).toBe(true);
    choreo.overlayOpened(); // a newer action
    expect(btn.classList.contains('is-sent')).toBe(false);
    expect(pill.classList.contains('is-sent')).toBe(false);
  });

  it('the Wheel pulse after a no-match landing is bound to that operation', async () => {
    const prompt = document.createElement('p');
    const center = { parts: () => ({ prompt, items: [] }), reveal() {}, showCandidates() {}, showNoMatch() {}, el: document.body } as never;
    const { choreo, focusCalls, resolvers, pulseWheel } = setup(true, { center });
    choreo.noMatch(null);
    await focusCalls[0].reveal!();
    resolvers[0](true);
    await flush();
    expect(pulseWheel).toHaveBeenCalledWith(expect.any(Number));
  });
});

describe('#11 hint', () => {
  it('turns toward the input, then a 24px arc; activity sends the butterfly home whatever the input holds', () => {
    vi.useFakeTimers();
    const { choreo, butterfly, input } = setup();
    input.getBoundingClientRect = () => rect(300, 700, 400, 44);
    butterfly.position = () => ({ x: 200, y: 400 });
    choreo.hint();
    expect(butterfly.turnToward).toHaveBeenCalledWith(input);
    vi.advanceTimersByTime(400);
    const to = (butterfly.flyTo as unknown as { mock: { calls: Array<[{ x: number; y: number }]> } }).mock.calls[0][0];
    const len = Math.hypot(to.x - 200, to.y - 400);
    expect(len).toBeGreaterThanOrEqual(20);
    expect(len).toBeLessThanOrEqual(28);
    input.value = 'trade'; // text in the input must not keep the flight alive
    choreo.cancelHint();
    expect(butterfly.home).toHaveBeenCalled();
    expect(butterfly.setMode).toHaveBeenLastCalledWith('listening');
  });
});

describe('#14: the sweep\'s final leg gets the remaining budget', () => {
  it('forced at 820ms: maxDuration is what is left of 1.4s', () => {
    vi.useFakeTimers();
    const prompt = document.createElement('p');
    const lis = [document.createElement('li'), document.createElement('li')];
    lis[0].getBoundingClientRect = () => rect(100, 400, 150, 60);
    lis[1].getBoundingClientRect = () => rect(300, 400, 150, 60);
    prompt.getBoundingClientRect = () => rect(150, 300, 200, 30);
    const center = { parts: () => ({ prompt, items: lis }), reveal() {}, showCandidates() {}, showNoMatch() {}, el: document.body } as never;
    const { choreo, focusCalls } = setup(false, { center });
    choreo.candidates([], null);
    expect(focusCalls).toHaveLength(0); // waypoints first
    vi.advanceTimersByTime(830);
    expect(focusCalls).toHaveLength(1);
    expect(focusCalls[0].maxDuration).toBeGreaterThan(520);
    expect(focusCalls[0].maxDuration).toBeLessThanOrEqual(600);
  });
});

describe('#15: interaction during the post-landing hop', () => {
  it('cancels the guide and sends the butterfly back to the anchor (short, no dim / pulse)', async () => {
    vi.useFakeTimers();
    const big = rect(0, 0, 900, 700);
    const small = rect(100, 200, 200, 40);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.id === 'page-scroll' ? big : small;
    });
    const { choreo, focusCalls, guide, butterfly } = setup();
    butterfly.position = () => ({ x: 82, y: 260 });
    choreo.page('risk', undefined, 'capsule', null);
    focusCalls[0].onApproach!();
    await focusCalls[0].reveal!();
    vi.advanceTimersByTime(1250); // the hop is in the air
    expect(focusCalls).toHaveLength(2);
    expect(focusCalls[1].dim).toBe(true);
    document.dispatchEvent(new Event('pointerdown'));
    expect(guide.cancel).toHaveBeenCalled();
    expect(focusCalls).toHaveLength(3); // back to the anchor
    expect(focusCalls[2].dim).toBeFalsy();
    expect(focusCalls[2].pulse).toBeFalsy();
    expect(focusCalls[2].maxDuration).toBeLessThanOrEqual(420);
  });
});

describe('L4: anchor scrolling', () => {
  it('puts the anchor just below the title band; the title is never half clipped', () => {
    setup();
    const page = createPageCard();
    page.prepare('risk', undefined);
    const body = document.getElementById('page-body')!;
    const scroll = document.getElementById('page-scroll')!;
    const title = body.querySelector<HTMLElement>('[data-perch="title"]')!;
    const anchor = body.querySelector<HTMLElement>(`[data-perch="${destinations.find((d) => d.id === 'risk')!.anchors[0]}"]`)!;
    scroll.getBoundingClientRect = () => rect(0, 0, 600, 500);
    const content = (t: number, h: number) => () => rect(0, t - scroll.scrollTop, 600, h);
    title.getBoundingClientRect = content(30, 50); // bottom 80
    anchor.getBoundingClientRect = content(900, 100);
    scroll.scrollTop = 0;
    page.reveal(anchor);
    expect(scroll.scrollTop).toBe(900 - (80 + 16)); // anchor starts where the title band ends
    expect(scroll.scrollTop).toBeGreaterThan(80); // the title is fully gone
    // an anchor close to the title: scrolled so the title is either whole or gone
    scroll.scrollTop = 0;
    anchor.getBoundingClientRect = content(560, 40);
    page.reveal(anchor);
    expect(scroll.scrollTop === 0 || scroll.scrollTop >= 80).toBe(true);
  });
});

describe('pads', () => {
  const layerOf = (): HTMLElement => {
    document.body.innerHTML = '<div id="layer"></div>';
    return document.getElementById('layer')!;
  };
  const mk = (id: string, r: DOMRect): HTMLElement => {
    const e = document.createElement('div');
    e.dataset.perch = id;
    e.getBoundingClientRect = () => r;
    document.body.append(e);
    return e;
  };

  it('destroy also removes retiring pads and clears the home ring state', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const layer = layerOf();
    const pads = createPads(layer);
    const a = mk('a', rect(300, 300, 100, 30));
    const ring = mk('ring', rect(0, 0, 100, 100));
    pads.sync([{ key: 'anchor', el: a }, { key: 'home', el: ring, self: true }]);
    pads.light('home', 'lit');
    expect(ring.classList.contains('is-lit')).toBe(true);
    pads.sync([{ key: 'home', el: ring, self: true }]); // the anchor pad is retiring (320ms)
    expect(layer.querySelectorAll('.pad')).toHaveLength(1);
    pads.destroy();
    expect(layer.querySelectorAll('.pad')).toHaveLength(0);
    expect(ring.classList.contains('is-lit')).toBe(false);
    vi.advanceTimersByTime(2000); // no stray timer touches the DOM afterwards
    vi.unstubAllGlobals();
  });

  it('a title scrolled half out of the scrollport hides its pad instead of clamping it to the corner', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const layer = layerOf();
    const pads = createPads(layer);
    const within = mk('w', rect(200, 100, 800, 500));
    const title = mk('t', rect(300, 130, 200, 40));
    pads.sync([{ key: 'anchor', el: title, side: 'inside-top-left', within }]);
    frames.splice(0).forEach((f) => f(0));
    const pad = layer.querySelector<HTMLElement>('.pad')!;
    expect(pad.classList.contains('is-on')).toBe(true);
    title.getBoundingClientRect = () => rect(300, 80, 200, 40); // top above the scrollport, bottom still inside
    pads.wake();
    frames.splice(0).forEach((f) => f(0));
    expect(pad.classList.contains('is-on')).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('N8: motion preference changes during the voice demo', () => {
  it('reduced stops the waveform loop and paints a static level; full resumes it', () => {
    document.body.innerHTML = '<input id="i"/><div id="m"></div><div id="o" hidden><span class="voice-bars"><i></i><i></i></span></div><span id="l"></span>';
    window.matchMedia = ((q: string) => ({ matches: false, addEventListener() {}, removeEventListener() {}, media: q })) as unknown as typeof window.matchMedia;
    initMotionPref('?motion=full');
    initAnnounce(document.getElementById('o')!, document.getElementById('o')!);
    const rafs: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafs.push(cb));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => void (rafs[id - 1] = () => {}));
    const level = vi.fn();
    const voice = createVoice({
      input: document.getElementById('i') as HTMLInputElement,
      mic: document.getElementById('m')!,
      overlay: document.getElementById('o')!,
      label: document.getElementById('l')!,
      butterfly: { setVoiceLevel: level } as unknown as Butterfly,
      submit() {},
      restMode() {},
      onStart() {},
      onCancel() {},
    });
    const run = (): void => rafs.splice(0).forEach((f) => f(performance.now() + 16));
    voice.toggle();
    run();
    expect(level).toHaveBeenCalled(); // the envelope loop drives the butterfly
    setMotionPref('reduced', false);
    expect(level).toHaveBeenLastCalledWith(0.5); // static level
    level.mockClear();
    run(); // frames that were already queued do nothing any more
    run();
    expect(level).not.toHaveBeenCalled();
    setMotionPref('full', false);
    run();
    expect(level).toHaveBeenCalled(); // the loop is back
    voice.cancel();
    vi.unstubAllGlobals();
  });
});

describe('N3: a late close popstate after the fallback', () => {
  const calls: Route[] = [];
  let ctx: RouteCtx[] = [];
  it('is bookkeeping: it never overrides the newer route', () => {
    vi.useFakeTimers();
    history.replaceState(null, '', '#/');
    initRouter((r, c) => (calls.push(r), ctx.push(c)));
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    writeRoute({ id: 'risk' }, true);
    leaveToHome();
    writeRoute({ id: 'returns' }, false); // opened while the traversal is pending
    vi.advanceTimersByTime(700); // the fallback ran
    expect(location.hash).toBe('#/returns');
    back.mockRestore();
    history.replaceState(null, '', '#/'); // what the delayed traversal does to the location
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(calls).toHaveLength(0); // not applied as a new user action
    expect(location.hash).toBe('#/returns'); // history restored to the latest intended route
    // afterwards a real back button works again
    history.replaceState(null, '', '#/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(calls).toHaveLength(1);
  });
});

describe('notice is marked seen only on dismiss or choice', () => {
  const mount = () => {
    document.body.innerHTML = `<button id="t"></button><div id="n" hidden><span id="motion-notice-text"></span><button id="motion-notice-go"></button><button id="motion-notice-x"></button></div>`;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {}, media: q })) as unknown as typeof window.matchMedia;
    localStorage.clear();
    initMotionPref('');
    initAnnounce(document.getElementById('toast') ?? document.body, document.body);
    createMotionUi(document.getElementById('t')!, document.getElementById('n')!);
    return document.getElementById('n')!;
  };
  it('showing it (or a timeout) does not mark it; the x button does', () => {
    vi.useFakeTimers();
    const n = mount();
    expect(n.hidden).toBe(false);
    expect(localStorage.getItem('aurea.motion.noticed')).toBeNull();
    vi.advanceTimersByTime(15000);
    expect(n.hidden).toBe(true);
    expect(localStorage.getItem('aurea.motion.noticed')).toBeNull();
    const n2 = mount();
    document.getElementById('motion-notice-x')!.click();
    expect(n2.hidden).toBe(true);
    expect(localStorage.getItem('aurea.motion.noticed')).toBe('1');
  });
});
