import type { Guide, Butterfly, PerchOpts } from '../types';

export interface GuideOptions {
  /** Element dimmed (one-shot CSS transition) when `focus(..., { dim: true })` is used. */
  dimLayer?: HTMLElement;
}

type FocusOpts = PerchOpts & {
  dim?: boolean;
  pulse?: boolean;
  underline?: boolean;
  reveal?: () => void | Promise<void>;
};

const PULSE_MS = 600;
/** The pulse lasts PULSE_MS at tempo 1 (`--tempo` scales the CSS animation the same way). A plain Butterfly (fake) has tempo 1. */
const tempoOf = (b: Butterfly): number => (b as Butterfly & { timeScale?: () => number }).timeScale?.() ?? 1;

// Only one element may hold the pulse at any time, across all guides.
let pulseEl: Element | null = null;
let pulseTimer = 0;

function clearPulse(): void {
  if (pulseTimer) clearTimeout(pulseTimer);
  pulseTimer = 0;
  pulseEl?.classList.remove('bf-pulse');
  pulseEl = null;
}

function startPulse(el: Element, ms: number): void {
  clearPulse();
  pulseEl = el;
  el.classList.add('bf-pulse');
  pulseTimer = window.setTimeout(clearPulse, ms);
}

/** createButterfly() returns this extension; a plain Butterfly (tests, fakes) simply has no underline. */
function drawUnderline(b: Butterfly, el: Element): void {
  (b as Butterfly & { underline?: (el: Element) => void }).underline?.(el);
}

/** The shared Guide plus `cancel()`: invalidate pending reveal / underline / pulse continuations (the app binds it to its operation token). */
export type CancellableGuide = Guide & { cancel(): void };

function clearUnderline(b: Butterfly): void {
  (b as Butterfly & { clearUnderline?: () => void }).clearUnderline?.();
}

export function createGuide(butterfly: Butterfly, opts: GuideOptions = {}): CancellableGuide {
  const dimLayer = opts.dimLayer;
  dimLayer?.classList.add('bf-dimlayer');
  let seq = 0;

  const setDim = (on: boolean): void => {
    dimLayer?.classList.toggle('bf-dim', on);
  };

  return {
    async focus(el: Element, o: FocusOpts = {}): Promise<boolean> {
      const id = ++seq;
      clearPulse();
      // Order: dim -> fly -> reveal (content) -> underline + one pulse. A newer focus/release cancels every later step.
      setDim(!!o.dim && !!dimLayer);
      const landed = await butterfly.flyTo(el, {
        side: o.side,
        within: o.within,
        minDuration: o.minDuration,
        maxDuration: o.maxDuration,
        onApproach: o.onApproach,
        trail: o.trail,
      });
      if (!landed || id !== seq || !el.isConnected) return false;
      if (o.reveal) {
        try {
          await o.reveal();
        } catch (e) {
          console.error(e);
        }
        if (id !== seq || !el.isConnected) return false;
      }
      if (o.underline) drawUnderline(butterfly, el);
      if (o.pulse !== false) startPulse(el, document.documentElement.classList.contains('bf-reduced') ? PULSE_MS : PULSE_MS / tempoOf(butterfly)); // reduced motion keeps its 600ms outline
      return true;
    },

    cancel(): void {
      seq++;
      setDim(false);
      clearPulse();
      clearUnderline(butterfly);
    },

    release(): Promise<boolean> {
      seq++;
      setDim(false);
      clearPulse();
      return butterfly.home();
    },
  };
}
