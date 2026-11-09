import type { Guide, Butterfly, PerchOpts } from '../types';

export interface GuideOptions {
  /** Element dimmed (one-shot CSS transition) when `focus(..., { dim: true })` is used. */
  dimLayer?: HTMLElement;
}

const PULSE_MS = 800;

// Only one element may hold the pulse at any time, across all guides.
let pulseEl: Element | null = null;
let pulseTimer = 0;

function clearPulse(): void {
  if (pulseTimer) clearTimeout(pulseTimer);
  pulseTimer = 0;
  pulseEl?.classList.remove('bf-pulse');
  pulseEl = null;
}

function startPulse(el: Element): void {
  clearPulse();
  pulseEl = el;
  el.classList.add('bf-pulse');
  pulseTimer = window.setTimeout(clearPulse, PULSE_MS);
}

export function createGuide(butterfly: Butterfly, opts: GuideOptions = {}): Guide {
  const dimLayer = opts.dimLayer;
  dimLayer?.classList.add('bf-dimlayer');
  let seq = 0;

  const setDim = (on: boolean): void => {
    dimLayer?.classList.toggle('bf-dim', on);
  };

  return {
    async focus(el: Element, o: PerchOpts & { dim?: boolean; pulse?: boolean } = {}): Promise<boolean> {
      const id = ++seq;
      clearPulse();
      // Order: dim -> fly -> content -> one pulse.
      setDim(!!o.dim && !!dimLayer);
      const landed = await butterfly.flyTo(el, { side: o.side, within: o.within });
      if (!landed || id !== seq || !el.isConnected) return false;
      if (o.pulse !== false) startPulse(el);
      return true;
    },

    release(): Promise<boolean> {
      seq++;
      setDim(false);
      clearPulse();
      return butterfly.home();
    },
  };
}
