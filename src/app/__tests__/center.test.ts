// @vitest-environment jsdom
import { setTempo } from '../motion';
import { beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { initAnnounce } from '../announce';
import { createCenter } from '../center';
import { bindNav } from '../navigate';
import { setState } from '../state';
import { destinations } from '../../data/destinations';

// These tests assert the design numbers (tempo 1); the app's default tempo is 0.5 (see tempo.test.ts).
setTempo(1);

function setup() {
  document.body.innerHTML = '<div id="live"></div><div id="toast"></div><div><div id="center"></div></div>';
  initAnnounce(document.getElementById('live')!, document.getElementById('toast')!);
  bindNav({ touch() {}, showPage() {}, showHome() {}, openWheel() {}, openTutorial() {}, closeWheel() {}, closeTutorial() {}, cancelVoice() {} });
  setLang('zh');
  setState({ route: null, center: { kind: 'capsules' }, picks: destinations.slice(0, 3).map((d) => d.capsules[0]) });
  return createCenter(document.getElementById('center')!, () => {});
}
const cands = () => destinations.slice(0, 2).map((d) => ({ target: { id: d.id }, label: d.title, score: 1 }) as never);

describe('center: held candidates', () => {
  beforeEach(() => setLang('zh'));

  it('held items are inert (not tabbable, hidden from AT) until revealed', () => {
    const c = setup();
    c.showCandidates(cands(), { hold: true, own: true });
    const { items, prompt } = c.parts();
    expect(items.every((li) => li.hasAttribute('data-hold') && li.hasAttribute('inert'))).toBe(true);
    expect(prompt!.hasAttribute('data-hold')).toBe(true);
    c.reveal(items[0]);
    expect(items[0].hasAttribute('inert')).toBe(false);
    expect(items[1].hasAttribute('inert')).toBe(true);
  });

  it('a language switch re-renders without exposing the held items', () => {
    const c = setup();
    c.showCandidates(cands(), { hold: true, own: true });
    c.reveal(c.parts().items[0]);
    setLang('en');
    c.render(false);
    const { items, prompt } = c.parts();
    expect(prompt!.textContent).toBe('Did you mean…?');
    expect(items[0].hasAttribute('data-hold')).toBe(false); // stays revealed
    expect(items[1].hasAttribute('data-hold') && items[1].hasAttribute('inert')).toBe(true); // stays held
    expect(prompt!.hasAttribute('data-hold')).toBe(true);
  });

  it('home capsules wait for the landing: revealHome staggers them, a stale epoch does nothing', () => {
    const c = setup();
    const ep = c.redraw(null, { hold: true });
    expect(c.parts().items.every((li) => li.hasAttribute('inert'))).toBe(true);
    c.revealHome(ep - 1);
    expect(c.parts().items.some((li) => !li.hasAttribute('inert'))).toBe(false);
    c.revealHome(ep);
    const { items } = c.parts();
    expect(items.every((li) => !li.hasAttribute('inert') && !li.hasAttribute('data-hold'))).toBe(true);
    expect(items[2].style.transitionDelay).toBe('120ms');
  });
});
