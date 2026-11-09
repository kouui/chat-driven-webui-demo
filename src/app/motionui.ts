// Motion toggle (top bar) and the one-time notice (A1).
import { t } from '../i18n';
import { announce } from './announce';
import { MOTION_KEY, getMotionPref, motionFromUrl, onMotionChange, osPrefersReduced, prefersReducedMotion, readStoredMotion, setMotionPref } from './motion';

const NOTICED_KEY = 'aurea.motion.noticed';
const NOTICE_MS = 14000;

const noticed = (): boolean => {
  try {
    return localStorage.getItem(NOTICED_KEY) === '1';
  } catch {
    return false;
  }
};
const markNoticed = (): void => {
  try {
    localStorage.setItem(NOTICED_KEY, '1');
  } catch {
    /* ignore */
  }
};

export interface MotionUi {
  /** Re-apply the labels (language switch). */
  render(): void;
}

export function createMotionUi(toggle: HTMLElement, notice: HTMLElement): MotionUi {
  const text = notice.querySelector<HTMLElement>('#motion-notice-text')!;
  const go = notice.querySelector<HTMLElement>('#motion-notice-go')!;
  const close = notice.querySelector<HTMLElement>('#motion-notice-x')!;
  let timer = 0;

  /** `seen`: the user dismissed it or chose; only then it never comes back (a timeout or a background tab does not count). */
  const hideNotice = (seen = false): void => {
    window.clearTimeout(timer);
    notice.hidden = true;
    if (seen) markNoticed();
  };

  function render(): void {
    const reduced = prefersReducedMotion();
    toggle.setAttribute('aria-pressed', String(!reduced)); // pressed = full motion
    toggle.setAttribute('aria-label', t('motion.label'));
    toggle.title = t(reduced ? 'motion.state.reduced' : 'motion.state.full');
    toggle.classList.toggle('is-reduced', reduced);
    text.textContent = t('motion.notice');
    go.textContent = t('motion.enable');
  }

  toggle.addEventListener('click', () => {
    const next = prefersReducedMotion() ? 'full' : 'reduced';
    setMotionPref(next);
    hideNotice(true);
    announce(t(next === 'full' ? 'announce.motion.full' : 'announce.motion.reduced'));
  });
  go.addEventListener('click', () => {
    setMotionPref('full');
    hideNotice(true);
    announce(t('announce.motion.full'));
  });
  close.addEventListener('click', () => hideNotice(true));
  onMotionChange(render);
  render();

  // The OS asks for reduced motion, and nobody has chosen yet (no URL setting, no stored choice, notice not seen).
  if (getMotionPref() === 'system' && osPrefersReduced() && !motionFromUrl() && readStoredMotion() === null && !noticed()) {
    notice.hidden = false;
    timer = window.setTimeout(() => hideNotice(), NOTICE_MS);
  }
  return { render };
}

export { MOTION_KEY };
