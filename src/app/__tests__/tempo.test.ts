// @vitest-environment jsdom
// Global motion tempo (src/app/motion.ts): default 0.5, ?speed= > localStorage `aurea.speed` > default, --tempo on <html>,
// ms() for every choreography time, reduced motion untouched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Butterfly, Guide } from '../../types';
import { setLang } from '../../i18n';
import { initAnnounce } from '../announce';
import { createPageCard } from '../pagecard';
import { createChoreo } from '../choreo';
import { bindNav } from '../navigate';
import { setState } from '../state';
import { DEFAULT_TEMPO, beginOp, designMs, getTempo, initMotionPref, initTempo, ms, onTempoChange, parseTempo, setMotionPref, setTempo } from '../motion';

const tempoVar = (): string => document.documentElement.style.getPropertyValue('--tempo');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.className = '';
  window.matchMedia = ((q: string) => ({ matches: false, addEventListener() {}, removeEventListener() {}, media: q })) as unknown as typeof window.matchMedia;
  initMotionPref('?motion=full');
});
afterEach(() => setTempo(DEFAULT_TEMPO));

describe('tempo: URL > localStorage > default 0.5', () => {
  it('defaults to 0.5 and publishes --tempo on <html>', () => {
    expect(DEFAULT_TEMPO).toBe(0.5);
    expect(initTempo('')).toBe(0.5);
    expect(getTempo()).toBe(0.5);
    expect(tempoVar()).toBe('0.5');
    expect(localStorage.getItem('aurea.speed')).toBeNull(); // the default is never stored
  });
  it('?speed= wins, is clamped to the valid range by parsing, and is remembered', () => {
    expect(initTempo('?speed=1')).toBe(1);
    expect(tempoVar()).toBe('1');
    expect(localStorage.getItem('aurea.speed')).toBe('1');
    expect(initTempo('?speed=0.25')).toBe(0.25);
    expect(initTempo('?speed=2')).toBe(2);
    // out of range / garbage: ignored (falls through to the stored value)
    expect(initTempo('?speed=3')).toBe(2);
    expect(initTempo('?speed=0.1')).toBe(2);
    expect(initTempo('?speed=fast')).toBe(2);
    expect(initTempo('?speed=')).toBe(2);
  });
  it('localStorage applies when the URL has no speed; the URL beats it', () => {
    localStorage.setItem('aurea.speed', '0.75');
    expect(initTempo('')).toBe(0.75);
    expect(initTempo('?speed=1.5')).toBe(1.5);
    expect(localStorage.getItem('aurea.speed')).toBe('1.5');
    localStorage.setItem('aurea.speed', 'nonsense');
    expect(initTempo('')).toBe(DEFAULT_TEMPO);
  });
  it('parseTempo accepts 0.25..2 only', () => {
    expect(parseTempo('0.25')).toBe(0.25);
    expect(parseTempo('2')).toBe(2);
    expect(parseTempo('0.24')).toBeNull();
    expect(parseTempo('2.01')).toBeNull();
    expect(parseTempo(null)).toBeNull();
    expect(parseTempo('NaN')).toBeNull();
  });
  it('setTempo notifies (the app forwards it to the butterfly)', () => {
    const seen: number[] = [];
    const off = onTempoChange((t) => seen.push(t));
    setTempo(1);
    setTempo(0.5);
    off();
    setTempo(1);
    expect(seen).toEqual([1, 0.5]);
  });
});

describe('ms()', () => {
  it('stretches design times by 1/tempo', () => {
    setTempo(0.5);
    expect(ms(300)).toBe(600);
    expect(designMs(600)).toBe(300);
    setTempo(1);
    expect(ms(300)).toBe(300);
    setTempo(2);
    expect(ms(300)).toBe(150);
  });
  it('reduced motion keeps real time', () => {
    setTempo(0.5);
    setMotionPref('reduced', false);
    expect(ms(300)).toBe(300);
    expect(designMs(300)).toBe(300);
    setMotionPref('full', false);
    expect(ms(300)).toBe(600);
  });
});

describe('choreography at tempo 0.5', () => {
  type FocusOpts = { onApproach?: () => void; reveal?: () => void | Promise<void> };
  function setup() {
    document.body.innerHTML = `
      <div id="live"></div><div id="toast"></div>
      <section id="home"></section><div id="ring"></div><input id="cmd-input" /><div class="cmd-pill"></div>
      <div id="page-wrap" hidden>
        <article id="page-card"><span id="page-rim"></span><button id="page-close"></button>
          <div id="page-scroll"><div id="page-body"></div></div></article>
        <nav id="followups"></nav>
      </div>
      <div id="center"></div>`;
    initAnnounce(document.getElementById('live')!, document.getElementById('toast')!);
    setLang('zh');
    setState({ route: null, anchor: 'title', overlay: 'none' });
    bindNav({ touch() {}, showPage() {}, showHome() {}, openWheel() {}, openTutorial() {}, closeWheel() {}, closeTutorial() {}, cancelVoice() {} });
    const focusCalls: FocusOpts[] = [];
    const guide: Guide & { cancel(): void } = {
      cancel: vi.fn(),
      focus: (_el, o) => {
        focusCalls.push(o as FocusOpts);
        return new Promise<boolean>(() => {});
      },
      release: () => Promise.resolve(true),
    };
    const butterfly = { spark: vi.fn(), tilt: vi.fn(), turnToward: vi.fn(), setMode: vi.fn(), flyTo: vi.fn(() => new Promise(() => {})), home: vi.fn(), position: () => ({ x: 0, y: 0 }), setVoiceLevel: vi.fn() } as unknown as Butterfly;
    const page = createPageCard();
    const center = { parts: () => ({ prompt: null, items: [] }), reveal() {}, showCandidates() {}, showNoMatch() {}, el: document.getElementById('center')! } as never;
    const choreo = createChoreo({ butterfly, guide, page, center, input: document.getElementById('cmd-input') as HTMLInputElement, pill: document.querySelector('.cmd-pill')!, ring: document.getElementById('ring')!, pulseWheel() {}, settle() {} });
    return { choreo, focusCalls, wrap: document.getElementById('page-wrap')! };
  }
  const states = (w: HTMLElement): string => `${w.dataset.shell}${w.dataset.content}${w.dataset.fu}`;

  it('the shell comes 160ms and the content 440ms after onApproach (80 / 220 at tempo 1)', () => {
    vi.useFakeTimers();
    beginOp();
    setTempo(0.5);
    const { choreo, focusCalls, wrap } = setup();
    choreo.page('risk', undefined, 'capsule', null);
    focusCalls[0].onApproach!();
    vi.advanceTimersByTime(150);
    expect(states(wrap)).toBe('000');
    vi.advanceTimersByTime(20);
    expect(states(wrap)).toBe('100'); // 170ms: the frame
    vi.advanceTimersByTime(260);
    expect(states(wrap)).toBe('100'); // 430ms
    vi.advanceTimersByTime(25);
    expect(states(wrap)).toBe('110'); // 455ms: the early content fade
    vi.useRealTimers();
  });
});
