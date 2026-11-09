import type { NavTarget } from '../types';
import { t } from '../i18n';
import { h, clear, trapTab, isMobile } from './dom';
import { getState, setState, markTutorialDone } from './state';
import { navigate } from './navigate';
import type { CloseOpts } from './navigate';
import { announce } from './announce';

interface Step {
  key: 's1' | 's2' | 's3' | 's4' | 's5';
  target: NavTarget;
}

export const STEPS: Step[] = [
  { key: 's1', target: { id: 'overview', anchor: 'total-assets' } },
  { key: 's2', target: { id: 'sys:home' } },
  { key: 's3', target: { id: 'sys:wheel' } },
  { key: 's4', target: { id: 'returns', anchor: 'return-ytd' } },
  { key: 's5', target: { id: 'risk', anchor: 'concentration' } },
];

export interface Tutorial {
  open(trigger?: HTMLElement | null): void;
  close(o: CloseOpts): void;
  render(): void;
  isOpen(): boolean;
  /** The drawer title: where the butterfly perches. */
  readonly title: HTMLElement;
  /** The drawer (the scrollport the perch point is clamped inside). */
  readonly root: HTMLElement;
  /** A close started with `hold` finishes visually now. */
  release(): void;
}

export function createTutorial(deps: { input: HTMLInputElement; scrim: HTMLElement; button: HTMLElement; wheelButton: HTMLElement; settle: () => void }): Tutorial {
  const root = document.getElementById('tutorial') as HTMLElement;
  const title = document.getElementById('tut-title') as HTMLElement;
  const list = document.getElementById('tut-steps') as HTMLElement;
  const intro = document.getElementById('tut-intro') as HTMLElement;
  const progress = document.getElementById('tut-progress') as HTMLElement;
  const foot = progress.parentElement as HTMLElement;
  const closeBtn = document.getElementById('tut-close') as HTMLButtonElement;
  let trigger: HTMLElement | null = null;
  let held = false;

  /** `focusIdx`: the step that must keep keyboard focus (a click does not focus buttons in every browser). */
  function render(focusIdx?: number): void {
    const { tutorialDone, tutorialCurrent } = getState();
    title.textContent = t('tutorial.title');
    intro.textContent = t('tutorial.intro');
    closeBtn.setAttribute('aria-label', t('tutorial.close'));
    const focusedIdx = focusIdx ?? (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.step : undefined);
    clear(list);
    STEPS.forEach((st, i) => {
      const done = tutorialDone.includes(i);
      list.append(
        h(
          'li',
          null,
          h(
            'button',
            {
              type: 'button',
              class: `tut-step${done ? ' is-done' : ''}`,
              'data-step': i,
              'aria-current': tutorialCurrent === i ? 'step' : null,
              onclick: () => {
                markTutorialDone(i);
                render(i); // replaces the buttons: the touched step is the new one at the same place
                navigate(st.target, { source: 'tutorial', trigger: deps.wheelButton, origin: list.querySelector<HTMLElement>(`[data-step="${i}"]`) });
              },
            },
            h('span', { class: 'tut-num', 'aria-hidden': 'true' }, done ? '✓' : String(i + 1)),
            h('span', { class: 'tut-text' }, h('strong', null, t(`tutorial.${st.key}.title`)), h('span', null, t(`tutorial.${st.key}.desc`))),
            done ? h('span', { class: 'sr-only' }, t('tutorial.done')) : null,
          ),
        ),
      );
    });
    progress.textContent = t('tutorial.progress', { n: tutorialDone.length, total: STEPS.length });
    foot.style.setProperty('--p', `${(tutorialDone.length / STEPS.length) * 100}%`);
    if (focusedIdx !== undefined) list.querySelector<HTMLElement>(`[data-step="${focusedIdx}"]`)?.focus({ preventScroll: true });
  }

  /** Mobile: bottom sheet with a modal scrim. Desktop: docked, non-modal. Re-checked on breakpoint changes. */
  function syncModal(): void {
    if (getState().overlay !== 'tutorial') return;
    root.setAttribute('aria-modal', String(isMobile()));
    deps.scrim.hidden = !isMobile();
  }
  window.matchMedia('(max-width: 768px)').addEventListener('change', syncModal);

  function open(tr?: HTMLElement | null): void {
    if (getState().overlay === 'tutorial') return;
    trigger = tr ?? deps.button;
    held = false;
    root.removeAttribute('inert');
    setState({ overlay: 'tutorial', tutorialLeads: true });
    document.body.classList.add('overlay-tutorial');
    root.hidden = false;
    syncModal();
    deps.button.setAttribute('aria-expanded', 'true');
    render();
    title.focus({ preventScroll: true });
    announce(t('announce.tutorial'));
    deps.settle();
  }

  function finishClose(): void {
    held = false;
    document.body.classList.remove('overlay-tutorial');
    root.hidden = true;
    root.removeAttribute('inert');
    if (getState().overlay !== 'tutorial') deps.scrim.hidden = true;
  }

  function close(o: CloseOpts): void {
    if (getState().overlay !== 'tutorial') return;
    setState({ overlay: 'none' });
    deps.button.setAttribute('aria-expanded', 'false');
    // `hold` (mobile sheet): it stays on screen, inert, until the page shell appears (`release()`)
    if (o.hold) {
      held = true;
      root.setAttribute('inert', '');
    } else finishClose();
    if (o.restoreFocus) (trigger && trigger.isConnected ? trigger : deps.input).focus({ preventScroll: true });
    if (o.settle) deps.settle();
    trigger = null;
  }

  root.addEventListener('keydown', (e) => trapTab(e, root));
  closeBtn.addEventListener('click', () => close({ restoreFocus: true, settle: true }));
  deps.scrim.addEventListener('click', () => {
    if (getState().overlay === 'tutorial') close({ restoreFocus: true, settle: true });
  });

  return { open, close, title, root, release: () => held && finishClose(), render: () => getState().overlay === 'tutorial' && render(), isOpen: () => getState().overlay === 'tutorial' };
}
