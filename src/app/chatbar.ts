import type { Butterfly, Matcher } from '../types';
import { getLang, l, t } from '../i18n';
import { butterflyOwner, getState } from './state';
import { navigate } from './navigate';
import type { NavSource } from './navigate';
import { toast } from './announce';
import type { Center } from './center';
import { createVoice } from './voice';
import type { Voice } from './voice';

export interface Chatbar {
  voice: Voice;
  focusInput(): void;
  /** Butterfly mode for nobody-is-typing: idle only when nothing else owns the butterfly. */
  restMode(): void;
}

export function createChatbar(deps: {
  input: HTMLInputElement;
  mic: HTMLElement;
  wheelBtn: HTMLElement;
  tutorialBtn: HTMLElement;
  matcher: Matcher;
  butterfly: Butterfly;
  center: Center;
}): Chatbar {
  const { input, matcher, butterfly, center } = deps;
  let idleTimer = 0;

  const restMode = (): void => butterfly.setMode(butterflyOwner() === 'home' ? 'idle' : 'perched');

  function pulseWheel(): void {
    deps.wheelBtn.classList.remove('pulse-once');
    void deps.wheelBtn.offsetWidth;
    deps.wheelBtn.classList.add('pulse-once');
  }
  deps.wheelBtn.addEventListener('animationend', () => deps.wheelBtn.classList.remove('pulse-once'));

  function submit(raw: string, source: NavSource): void {
    const text = raw.trim();
    if (!text) return;
    voice.cancel(); // typed Enter during the microphone demo wins; the demo's own submit is already done
    window.clearTimeout(idleTimer);
    const res = matcher.match(text, getLang());
    const onPage = getState().route !== null;

    if (res.status === 'confident') {
      input.value = '';
      const target = res.best.target;
      navigate(target, { source, trigger: input });
      if (!target.id.startsWith('sys:')) toast(t('toast.go', { x: l(res.best.label) }));
      return;
    }

    if (res.status === 'ambiguous' && res.candidates.length) {
      center.showCandidates(res.candidates);
    } else {
      center.showNoMatch();
      butterfly.tilt();
      pulseWheel();
    }
    restMode();
    if (onPage) navigate({ id: 'sys:home' }, { source, keepCenter: true });
  }

  const voice = createVoice({
    input,
    mic: deps.mic,
    overlay: document.getElementById('voice') as HTMLElement,
    label: document.getElementById('voice-label') as HTMLElement,
    butterfly,
    submit: (text) => submit(text, 'voice'),
    restMode,
  });

  input.addEventListener('input', () => {
    window.clearTimeout(idleTimer);
    if (input.value.trim()) {
      butterfly.setMode('listening');
      idleTimer = window.setTimeout(restMode, 1800);
    } else restMode();
  });
  input.addEventListener('blur', () => {
    window.clearTimeout(idleTimer);
    if (!voice.isActive()) restMode();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.isComposing || e.keyCode === 229) return; // IME is still composing
    e.preventDefault();
    submit(input.value, 'text');
  });
  deps.mic.addEventListener('click', () => voice.toggle());
  document.getElementById('voice')?.addEventListener('click', () => voice.cancel());

  return {
    voice,
    focusInput: () => input.focus({ preventScroll: true }),
    restMode,
  };
}
