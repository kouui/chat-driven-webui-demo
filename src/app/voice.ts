import type { Butterfly } from '../types';
import { destinations } from '../data/destinations';
import { l, t } from '../i18n';
import { announce } from './announce';
import { onMotionChange, prefersReducedMotion } from './motion';

const LISTEN_MS = 1500;
const CHAR_MS = 40;

export interface Voice {
  toggle(): void;
  cancel(): void;
  isActive(): boolean;
}

// ---- fake voice envelope --------------------------------------------------------------------------

export interface Envelope {
  /** Advance by `dt` seconds; returns the level 0..1. */
  step(dt: number): number;
  reset(): void;
}

const ATTACK_S = 0.05;
const RELEASE_S = 0.18;
const GAP_LEVEL = 0.12;

/** One level L(t) that drives both the input waveform and `butterfly.setVoiceLevel`: syllables at about 2.6Hz,
 *  slowly modulated, word gaps every 0.6-1.4s, attack 50ms / release 180ms. `rng` is injectable for tests. */
export function createEnvelope(rng: () => number = Math.random): Envelope {
  let t = 0;
  let level = 0;
  let gapStart = 0.6 + rng() * 0.8;
  let gapEnd = gapStart + 0.12 + rng() * 0.14;

  return {
    step(dt) {
      t += dt;
      if (t >= gapEnd) {
        gapStart = t + 0.6 + rng() * 0.8;
        gapEnd = gapStart + 0.12 + rng() * 0.14;
      }
      const inGap = t >= gapStart && t < gapEnd;
      const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.6 * t + 0.8 * Math.sin(2 * Math.PI * 0.7 * t));
      const target = inGap ? GAP_LEVEL : 0.2 + 0.8 * syllable + (rng() - 0.5) * 0.06;
      const tau = target > level ? ATTACK_S : RELEASE_S;
      level += (target - level) * (1 - Math.exp(-dt / tau));
      level = Math.min(1, Math.max(0, level));
      return level;
    },
    reset() {
      t = 0;
      level = 0;
      gapStart = 0.6 + rng() * 0.8;
      gapEnd = gapStart + 0.12 + rng() * 0.14;
    },
  };
}

export function createVoice(deps: {
  input: HTMLInputElement;
  mic: HTMLElement;
  overlay: HTMLElement;
  label: HTMLElement;
  butterfly: Butterfly;
  submit: (text: string) => void;
  restMode: () => void;
  /** The microphone demo started: the app puts the butterfly in voice mode (at the ring, or at the voice nest). */
  onStart: () => void;
  /** The user cancelled (Esc, mic, overlay): the butterfly goes back to its owner. */
  onCancel: () => void;
  /** The demo ended (submitted or cancelled). */
  onEnd?: () => void;
}): Voice {
  let active = false;
  let timer = 0;
  let raf = 0;
  const env = createEnvelope();
  let offMotion: (() => void) | null = null;
  const bars = [...deps.overlay.querySelectorAll<HTMLElement>('.voice-bars i')];

  const randomPhrase = (): string => {
    const d = destinations[Math.floor(Math.random() * destinations.length)];
    const c = d.capsules[Math.floor(Math.random() * d.capsules.length)];
    return l(c.text);
  };

  /** The waveform: bar heights follow the same level the butterfly gets, each with its own phase. */
  function paintBars(level: number, time: number): void {
    bars.forEach((b, k) => {
      const wobble = 0.6 + 0.4 * Math.sin(time * 9 + k * 1.7);
      b.style.transform = `scaleY(${(0.14 + 0.86 * level * wobble).toFixed(3)})`;
    });
  }

  /** Static level while the effective motion setting is reduced; the shared envelope loop otherwise. */
  function paintMode(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    if (prefersReducedMotion()) {
      deps.butterfly.setVoiceLevel(0.5); // static rings
      paintBars(0.5, 0);
    } else loop(performance.now());
  }

  function loop(from: number): void {
    let last = from;
    const frame = (now: number): void => {
      if (!active || prefersReducedMotion()) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const level = env.step(dt);
      deps.butterfly.setVoiceLevel(level);
      paintBars(level, now / 1000);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  function reset(cancelled: boolean): void {
    window.clearTimeout(timer);
    timer = 0;
    cancelAnimationFrame(raf);
    raf = 0;
    offMotion?.();
    offMotion = null;
    active = false;
    deps.input.readOnly = false;
    deps.overlay.hidden = true;
    deps.input.closest('.input-wrap')?.classList.remove('is-voice');
    deps.mic.setAttribute('aria-pressed', 'false');
    deps.mic.setAttribute('aria-label', t('mic.label'));
    bars.forEach((b) => (b.style.transform = ''));
    deps.onEnd?.();
    if (cancelled) {
      deps.butterfly.setVoiceLevel(0);
      deps.restMode(); // the rings fade over 200ms
      deps.onCancel();
    }
    // A submitted demo keeps the butterfly's voice state: the next flight collapses the rings into it and takes off
    // (the app's navigation starts that flight; `restMode` is NOT called here, which would fade the rings instead).
  }

  function cancel(): void {
    if (!active) return;
    deps.input.value = '';
    reset(true);
  }

  function start(): void {
    active = true;
    env.reset();
    deps.input.value = '';
    deps.input.readOnly = true;
    deps.label.textContent = t('mic.listening');
    deps.overlay.hidden = false;
    deps.input.closest('.input-wrap')?.classList.add('is-voice');
    deps.mic.setAttribute('aria-pressed', 'true');
    deps.mic.setAttribute('aria-label', t('mic.cancel'));
    deps.onStart();
    paintMode();
    offMotion = onMotionChange(() => active && paintMode()); // toggled while listening: the waveform follows at once
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
        reset(false);
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
