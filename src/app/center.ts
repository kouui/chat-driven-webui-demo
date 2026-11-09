import type { Capsule, DestId, MatchCandidate } from '../types';
import { destinations } from '../data/destinations';
import { l, t } from '../i18n';
import { h, clear } from './dom';
import { getState, setState } from './state';
import { navigate } from './navigate';
import { announce } from './announce';
import { ms } from './motion';

/** Capsules / candidates enter this far apart (design ms; capsules.css uses `60ms * var(--tm)`). */
const STAGGER_MS = 60;

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

export interface CenterOpts {
  /** Render the prompt and the items invisible; the choreography reveals them (`reveal`) as the butterfly arrives. */
  hold?: boolean;
  /** The choreography moves the butterfly itself: do not call `settle`. */
  own?: boolean;
}

export interface Center {
  /** Re-render in the current language. Reveal state (held / shown parts) is kept: a language switch never exposes held items. */
  render(animate?: boolean, delay?: number): void;
  /** New home capsules. `hold`: they stay invisible and inert until `revealHome` (the butterfly has landed on the ring);
   *  returns the epoch to pass to `revealHome`. */
  redraw(exclude: DestId | null, o?: { hold?: boolean }): number;
  /** The held home capsules stagger in (only if `epoch` is still the latest render). */
  revealHome(epoch: number): void;
  showCandidates(items: MatchCandidate[], o?: CenterOpts): void;
  showNoMatch(o?: CenterOpts): void;
  /** The held parts, in reading order. */
  parts(): { prompt: HTMLElement | null; items: HTMLElement[] };
  /** Fade a held part in. `stagger`: spread the items 60ms apart. */
  reveal(part: 'prompt' | 'items' | HTMLElement, stagger?: boolean): void;
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
      { type: 'button', class: 'capsule capsule-candidate', onclick: (e: Event) => navigate(c.target, { source: 'capsule', origin: e.currentTarget as HTMLElement }) },
      h('span', { class: 'cand-label' }, label),
      dest ? h('span', { class: 'cand-sum' }, `${where}${l(dest.summary)}`) : null,
    ),
  );
}

/** `settle` moves the butterfly to its owner once the new content is in the DOM. */
export function createCenter(el: HTMLElement, settle: (o: { pulse: boolean }) => void): Center {
  const capsuleBtn = (text: string, onClick: (e: Event) => void, cls: string): HTMLElement =>
    h('li', null, h('button', { type: 'button', class: `capsule ${cls}`, onclick: onClick }, text));

  /** Which parts are held (invisible + inert) right now. Survives a re-render of the same content. */
  let heldPrompt = false;
  let heldItems: boolean[] = [];
  let epoch = 0;
  let lastKind = '';
  let lastCount = -1;

  /** `hold`: true = hold everything (new content); false = nothing held; undefined = keep what is held. */
  function render(animate = false, delay = 0, hold?: boolean): void {
    const { center, picks } = getState();
    clear(el);
    const count = center.kind === 'capsules' ? picks.length : center.kind === 'candidates' ? center.items.length : center.suggestions.length;
    const keep = hold === undefined && center.kind === lastKind && count === lastCount;
    if (!keep) epoch++; // new content; a language re-render keeps the epoch (and every reveal state)
    el.classList.toggle('enter', animate && !hold && !keep);
    el.classList.toggle('sweep', hold === true || (keep && (heldPrompt || heldItems.some(Boolean))));
    el.style.setProperty('--enter-delay', `${ms(delay)}ms`);
    el.dataset.kind = center.kind;
    if (el.parentElement) el.parentElement.dataset.center = center.kind;
    let prompt: HTMLElement | null = null;
    let items: HTMLElement[] = [];
    if (center.kind === 'capsules') {
      el.setAttribute('aria-label', t('home.capsules'));
      items = picks.map((c) => capsuleBtn(l(c.text), (e) => navigate(c.target, { source: 'capsule', origin: e.currentTarget as HTMLElement }), 'capsule-phrase'));
    } else if (center.kind === 'candidates') {
      prompt = h('p', { class: 'center-prompt', id: 'center-prompt', 'data-perch': 'center-prompt' }, t('center.candidates'));
      el.setAttribute('aria-labelledby', 'center-prompt');
      el.removeAttribute('aria-label');
      items = center.items.map(candidateBtn);
    } else {
      prompt = h('p', { class: 'center-prompt', id: 'center-prompt', 'data-perch': 'center-prompt' }, t('center.nomatch'));
      el.setAttribute('aria-labelledby', 'center-prompt');
      el.removeAttribute('aria-label');
      items = center.suggestions.map((c) => capsuleBtn(l(c.text), (e) => navigate(c.target, { source: 'capsule', origin: e.currentTarget as HTMLElement }), 'capsule-phrase'));
    }
    if (center.kind === 'capsules') el.removeAttribute('aria-labelledby');
    if (prompt) el.append(prompt);
    el.append(h('ul', { class: 'capsule-list', 'data-perch': 'center-list' }, items));
    if (center.kind === 'nomatch') el.append(h('p', { class: 'center-hint' }, t('center.nomatchHint')));
    items.forEach((li, i) => li.style.setProperty('--i', String(i)));
    if (!keep) {
      heldPrompt = hold === true && !!prompt;
      heldItems = items.map(() => hold === true);
    }
    lastKind = center.kind;
    lastCount = count;
    if (heldPrompt) prompt?.setAttribute('data-hold', '');
    items.forEach((li, i) => {
      if (heldItems[i]) setHeld(li, true);
    });
  }

  /** Held items are invisible AND inert: Tab and assistive technology cannot reach what the butterfly has not shown yet. */
  function setHeld(li: HTMLElement, on: boolean): void {
    if (on) {
      li.setAttribute('data-hold', '');
      li.setAttribute('inert', '');
    } else {
      li.removeAttribute('data-hold');
      li.removeAttribute('inert');
    }
  }

  const parts = (): { prompt: HTMLElement | null; items: HTMLElement[] } => ({
    prompt: el.querySelector<HTMLElement>('.center-prompt'),
    items: [...el.querySelectorAll<HTMLElement>('.capsule-list > li')],
  });

  return {
    el,
    render: (animate, delay) => render(animate, delay),
    redraw(exclude, o = {}) {
      setState({ picks: pickCapsules(3, exclude), center: { kind: 'capsules' } });
      render(true, 0, !!o.hold);
      return epoch;
    },
    revealHome(at) {
      if (at !== epoch) return;
      const { items } = parts();
      items.forEach((li, i) => {
        if (!li.hasAttribute('data-hold')) return;
        li.style.transitionDelay = `${ms(i * STAGGER_MS)}ms`;
        setHeld(li, false);
        heldItems[i] = false;
      });
    },
    showCandidates(items, o = {}) {
      setState({ center: { kind: 'candidates', items: items.slice(0, 3) }, tutorialLeads: false, pointCapsules: false });
      render(true, 0, !!o.hold);
      announce(t('announce.candidates', { n: Math.min(items.length, 3) }));
      if (!o.own && !getState().route) settle({ pulse: true }); // on a page, the coming showHome settles
    },
    showNoMatch(o = {}) {
      setState({ center: { kind: 'nomatch', suggestions: pickCapsules(3, null) }, tutorialLeads: false, pointCapsules: false });
      render(true, 0, !!o.hold);
      announce(t('announce.nomatch'));
      if (!o.own && !getState().route) settle({ pulse: true });
    },
    parts,
    reveal(part, stagger = false) {
      const { prompt, items } = parts();
      const list = part === 'prompt' ? [prompt] : part === 'items' ? items : [part];
      list.forEach((n, i) => {
        if (!n || !n.hasAttribute('data-hold')) return;
        n.style.transitionDelay = stagger ? `${ms(i * STAGGER_MS)}ms` : '0ms';
        setHeld(n, false);
        if (n === prompt) heldPrompt = false;
        else {
          const k = items.indexOf(n);
          if (k >= 0) heldItems[k] = false;
        }
      });
    },
  };
}
