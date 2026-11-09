import type { DestId, NavTarget } from '../types';
import { getState } from './state';
import { leaveToHome, noteOverlayOpened, writeRoute } from './router';
import type { RouteCtx } from './router';
import { isMobile } from './dom';

export type NavSource = 'text' | 'voice' | 'capsule' | 'wheel' | 'tutorial' | 'followup' | 'system' | 'hash';

export interface NavOpts {
  source?: NavSource;
  /** Element that should regain focus when an overlay opened by this call closes. */
  trigger?: HTMLElement | null;
  /** Keep candidates / no-match content when going home. */
  keepCenter?: boolean;
}

export interface CloseOpts {
  restoreFocus: boolean;
  /** Let the butterfly go to its next owner. false when another navigation follows. */
  settle: boolean;
}

export interface NavHooks {
  showPage(id: DestId, anchor: string | undefined, source: NavSource): void;
  showHome(ctx: RouteCtx): void;
  openWheel(trigger?: HTMLElement | null): void;
  openTutorial(trigger?: HTMLElement | null): void;
  closeWheel(o: CloseOpts): void;
  closeTutorial(o: CloseOpts): void;
  /** A navigation supersedes any running microphone demo. */
  cancelVoice(): void;
}

let hooks: NavHooks;
export function bindNav(h: NavHooks): void {
  hooks = h;
}

const NO_SETTLE: CloseOpts = { restoreFocus: false, settle: false };

/** The ONE entry point for going anywhere: text, capsules, wheel, tutorial, follow-ups, system intents. */
export function navigate(target: NavTarget, opts: NavOpts = {}): void {
  const source = opts.source ?? 'system';
  hooks.cancelVoice();
  switch (target.id) {
    case 'sys:wheel':
      noteOverlayOpened();
      hooks.openWheel(opts.trigger);
      return;
    case 'sys:tutorial':
      noteOverlayOpened();
      hooks.openTutorial(opts.trigger);
      return;
    case 'sys:home': {
      hooks.closeWheel(NO_SETTLE);
      if (isMobile()) hooks.closeTutorial(NO_SETTLE);
      const ctx: RouteCtx = { source, keepCenter: opts.keepCenter };
      if (!getState().route || !leaveToHome(ctx)) hooks.showHome(ctx);
      return;
    }
    default: {
      hooks.closeWheel(NO_SETTLE);
      if (isMobile()) hooks.closeTutorial(NO_SETTLE);
      const anchor = target.anchor && target.anchor !== 'title' ? target.anchor : undefined;
      writeRoute({ id: target.id, anchor }, getState().route === null);
      hooks.showPage(target.id, anchor, source);
    }
  }
}

/** Called by the router for back/forward and the initial hash. */
export function applyRoute(route: { id: DestId | null; anchor?: string }, ctx: RouteCtx): void {
  hooks.cancelVoice();
  if (!ctx.keepOverlay) hooks.closeWheel(NO_SETTLE); // a newer overlay survives the completed close
  if (route.id) {
    if (isMobile()) hooks.closeTutorial(NO_SETTLE);
    hooks.showPage(route.id, route.anchor, ctx.source as NavSource);
  } else {
    hooks.showHome(ctx);
  }
}
