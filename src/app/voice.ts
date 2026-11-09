import type { Butterfly } from '../types';
import { destinations } from '../data/destinations';
import { l, t } from '../i18n';
import { announce } from './announce';

const LISTEN_MS = 1500;
const CHAR_MS = 40;

export interface Voice {
  toggle(): void;
  cancel(): void;
  isActive(): boolean;
}

export function createVoice(deps: { input: HTMLInputElement; mic: HTMLElement; overlay: HTMLElement; label: HTMLElement; butterfly: Butterfly; submit: (text: string) => void; restMode: () => void }): Voice {
  let active = false;
  let timer = 0;

  const randomPhrase = (): string => {
    const d = destinations[Math.floor(Math.random() * destinations.length)];
    const c = d.capsules[Math.floor(Math.random() * d.capsules.length)];
    return l(c.text);
  };

  function reset(): void {
    window.clearTimeout(timer);
    timer = 0;
    active = false;
    deps.input.readOnly = false;
    deps.overlay.hidden = true;
    deps.input.closest('.input-wrap')?.classList.remove('is-voice');
    deps.mic.setAttribute('aria-pressed', 'false');
    deps.mic.setAttribute('aria-label', t('mic.label'));
    deps.restMode();
  }

  function cancel(): void {
    if (!active) return;
    deps.input.value = '';
    reset();
  }

  function start(): void {
    active = true;
    deps.input.value = '';
    deps.input.readOnly = true;
    deps.label.textContent = t('mic.listening');
    deps.overlay.hidden = false;
    deps.input.closest('.input-wrap')?.classList.add('is-voice');
    deps.mic.setAttribute('aria-pressed', 'true');
    deps.mic.setAttribute('aria-label', t('mic.cancel'));
    deps.butterfly.setMode('listening');
    announce(t('mic.announce'));
    timer = window.setTimeout(typeOut, LISTEN_MS);
  }

  function typeOut(): void {
    deps.overlay.hidden = true;
    deps.input.closest('.input-wrap')?.classList.remove('is-voice');
    const chars = Array.from(randomPhrase());
    let i = 0;
    const step = (): void => {
      if (!active) return;
      if (i < chars.length) {
        deps.input.value += chars[i++];
        timer = window.setTimeout(step, CHAR_MS);
      } else {
        const text = deps.input.value;
        reset();
        deps.submit(text);
      }
    };
    step();
  }

  return {
    toggle: () => (active ? cancel() : start()),
    cancel,
    isActive: () => active,
  };
}
