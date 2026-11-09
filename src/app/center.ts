import type { Capsule, DestId, MatchCandidate } from '../types';
import { destinations } from '../data/destinations';
import { l, t } from '../i18n';
import { h, clear } from './dom';
import { getState, setState } from './state';
import { navigate } from './navigate';
import { announce } from './announce';

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** `n` capsules from different destinations (never `exclude`). */
export function pickCapsules(n: number, exclude: DestId | null): Capsule[] {
  const pool = shuffle(destinations.filter((d) => d.id !== exclude && d.capsules.length));
  return pool.slice(0, n).map((d) => d.capsules[Math.floor(Math.random() * d.capsules.length)]);
}

export interface Center {
  render(animate?: boolean): void;
  redraw(exclude: DestId | null): void;
  showCandidates(items: MatchCandidate[]): void;
  showNoMatch(): void;
  readonly el: HTMLElement;
}

/** Candidate button: label plus the destination's one-line summary, so the user can tell them apart. */
function candidateBtn(c: MatchCandidate): HTMLElement {
  const dest = destinations.find((d) => d.id === c.target.id);
  const label = l(c.label);
  const where = dest && l(dest.title) !== label ? `${l(dest.title)} · ` : '';
  return h(
    'li',
    null,
    h(
      'button',
      { type: 'button', class: 'capsule capsule-candidate', onclick: () => navigate(c.target, { source: 'capsule' }) },
      h('span', { class: 'cand-label' }, label),
      dest ? h('span', { class: 'cand-sum' }, `${where}${l(dest.summary)}`) : null,
    ),
  );
}

/** `settle` moves the butterfly to its owner once the new content is in the DOM. */
export function createCenter(el: HTMLElement, settle: (o: { pulse: boolean }) => void): Center {
  const capsuleBtn = (text: string, onClick: () => void, cls: string): HTMLElement =>
    h('li', null, h('button', { type: 'button', class: `capsule ${cls}`, onclick: onClick }, text));

  function render(animate = false): void {
    const { center, picks } = getState();
    clear(el);
    el.classList.toggle('enter', animate);
    el.dataset.kind = center.kind;
    if (el.parentElement) el.parentElement.dataset.center = center.kind;
    let prompt: HTMLElement | null = null;
    let items: HTMLElement[] = [];
    if (center.kind === 'capsules') {
      el.setAttribute('aria-label', t('home.capsules'));
      items = picks.map((c) => capsuleBtn(l(c.text), () => navigate(c.target, { source: 'capsule' }), 'capsule-phrase'));
    } else if (center.kind === 'candidates') {
      prompt = h('p', { class: 'center-prompt', id: 'center-prompt', 'data-perch': 'center-prompt' }, t('center.candidates'));
      el.setAttribute('aria-labelledby', 'center-prompt');
      el.removeAttribute('aria-label');
      items = center.items.map(candidateBtn);
    } else {
      prompt = h('p', { class: 'center-prompt', id: 'center-prompt', 'data-perch': 'center-prompt' }, t('center.nomatch'));
      el.setAttribute('aria-labelledby', 'center-prompt');
      el.removeAttribute('aria-label');
      items = center.suggestions.map((c) => capsuleBtn(l(c.text), () => navigate(c.target, { source: 'capsule' }), 'capsule-phrase'));
    }
    if (center.kind === 'capsules') el.removeAttribute('aria-labelledby');
    if (prompt) el.append(prompt);
    el.append(h('ul', { class: 'capsule-list', 'data-perch': 'center-list' }, items));
    if (center.kind === 'nomatch') el.append(h('p', { class: 'center-hint' }, t('center.nomatchHint')));
    items.forEach((li, i) => li.style.setProperty('--i', String(i)));
  }

  return {
    el,
    render,
    redraw(exclude) {
      setState({ picks: pickCapsules(3, exclude), center: { kind: 'capsules' } });
      render(true);
    },
    showCandidates(items) {
      setState({ center: { kind: 'candidates', items: items.slice(0, 3) }, tutorialLeads: false, pointCapsules: false });
      render(true);
      announce(t('announce.candidates', { n: Math.min(items.length, 3) }));
      if (!getState().route) settle({ pulse: true }); // on a page, the coming showHome settles
    },
    showNoMatch() {
      setState({ center: { kind: 'nomatch', suggestions: pickCapsules(3, null) }, tutorialLeads: false, pointCapsules: false });
      render(true);
      announce(t('announce.nomatch'));
      if (!getState().route) settle({ pulse: true });
    },
  };
}
