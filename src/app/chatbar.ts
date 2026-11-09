import type { Butterfly, Matcher } from '../types';
import { getLang, l, t } from '../i18n';
import { getState } from './state';
import { navigate } from './navigate';
import type { NavSource } from './navigate';
import { toast } from './announce';
import { isMobile } from './dom';
import type { Center } from './center';
import { createVoice } from './voice';
import type { Voice } from './voice';
import type { Choreo } from './choreo';
import { captureOrigin } from './motion';
import type { Origin } from './motion';

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
  choreo: Choreo;
  /** The butterfly goes back to its owner (state-derived). */
  settle(): void;
}): Chatbar {
  const { input, matcher, butterfly, choreo } = deps;
  let idleTimer = 0;

  /** Nobody is typing: the butterfly leaves 'listening'. The microphone demo keeps the 'voice' mode: nothing else may
   *  reset it. Flying home is the owner's job (`settle` -> `guide.release()`), never a side effect of this call, so it
   *  always asks for the quiet 'perched' mode (BF: "not listening any more", no flight). */
  const restMode = (): void => {
    if (voice.isActive()) return;
    butterfly.setMode('perched');
  };

  /** Where the typed text ends (viewport px): the spark leaves from there. Measured before the input is cleared. */
  function textEnd(): Origin | null {
    const r = input.getBoundingClientRect();
    if (!r.width) return null;
    const cs = getComputedStyle(input);
    const ctx = document.createElement('canvas').getContext('2d');
    let w = 0;
    if (ctx) {
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      w = ctx.measureText(input.value).width;
    }
    const x = Math.min(r.right - 12, r.left + (parseFloat(cs.paddingLeft) || 12) + w - input.scrollLeft);
    return captureOrigin({ x: Math.max(r.left + 12, x), y: r.top + r.height / 2 });
  }

  function submit(raw: string, source: NavSource): void {
    const text = raw.trim();
    if (!text) return;
    voice.cancel(); // typed Enter during the microphone demo wins; the demo's own submit is already done
    window.clearTimeout(idleTimer);
    const res = matcher.match(text, getLang());
    const onPage = getState().route !== null;
    // Voice: the butterfly is already the sender (ripples collapse into it); typed: the spark leaves the end of the text.
    const origin = source === 'voice' ? null : textEnd();
    if (source !== 'voice') choreo.inputSent();

    if (res.status === 'confident') {
      input.value = '';
      const target = res.best.target;
      navigate(target, { source, trigger: input, origin: origin ? { x: origin.x, y: origin.y } : null });
      // On a phone the card fills the screen: the toast would sit on its text, and the page itself is the news.
      if (!target.id.startsWith('sys:') && !isMobile()) toast(t('toast.go', { x: l(res.best.label) }));
      return;
    }

    // Owner rule: the centre prompt belongs to the home view. A page, or the wheel / tutorial sheet, is closed first
    // through navigate() (the single entry point), and only then does the sweep / confused detour start.
    const st = getState();
    if (onPage || st.overlay === 'wheel' || (st.overlay === 'tutorial' && isMobile())) navigate({ id: 'sys:home' }, { source, keepCenter: true });
    if (res.status === 'ambiguous' && res.candidates.length) choreo.candidates(res.candidates, origin);
    else choreo.noMatch(origin);
    if (source !== 'voice') restMode(); // a voice submit keeps its voice state: the sweep's first flight collapses the rings
  }

  const voice = createVoice({
    input,
    mic: deps.mic,
    overlay: document.getElementById('voice') as HTMLElement,
    label: document.getElementById('voice-label') as HTMLElement,
    butterfly,
    submit: (text) => submit(text, 'voice'),
    restMode,
    onStart: () => choreo.voiceStart(),
    onCancel: () => deps.settle(),
    onEnd: () => choreo.voiceEnd(),
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
