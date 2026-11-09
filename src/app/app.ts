import type { Lang } from '../types';
import { createButterfly, createGuide } from '../butterfly';
import { createMatcher } from '../intent';
import { destinations, systemIntents } from '../data/destinations';
import { getLang, initLang, onLangChange, setLang, t } from '../i18n';
import { $, isMobile, raf2 } from './dom';
import { butterflyOwner, getState, setState } from './state';
import { applyRoute, bindNav, navigate } from './navigate';
import { initRouter } from './router';
import { initAnnounce, announce } from './announce';
import { applyStaticText } from './staticText';
import { buildStarfield } from './starfield';
import { createCenter, pickCapsules } from './center';
import { createPageCard } from './pagecard';
import { createWheel } from './wheel';
import { createTutorial } from './tutorial';
import { createChatbar } from './chatbar';

export function startApp(): void {
  initLang();
  initAnnounce($('#live'), $('#toast'));
  buildStarfield($('#starfield'));

  const input = $<HTMLInputElement>('#cmd-input');
  const mic = $('#btn-mic');
  const wheelBtn = $('#btn-wheel');
  const tutorialBtn = $('#btn-tutorial');
  const scrim = $('#scrim');
  const ring = $('#ring');

  const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
  const butterfly = createButterfly($('#butterfly-layer'), {
    reducedMotion: mql.matches,
    home: () => {
      const r = ring.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
  });
  mql.addEventListener('change', () => butterfly.setReducedMotion(mql.matches));
  const guide = createGuide(butterfly, { dimLayer: $('#dim') });
  const matcher = createMatcher(destinations, systemIntents);

  const center = createCenter($('#center'), (o) => settle(o));
  const page = createPageCard();

  /** The ONE place that decides where the butterfly belongs, derived from state (see `butterflyOwner`):
   *  wheel rim / tutorial title > page anchor > centre prompt / capsule group > home. Call it after every
   *  state change. `scroll`: bring the page anchor into view (only for a navigation, never for a language switch).
   *  Calls landing within the same two-frame window coalesce into one; their options are OR-ed together, so a
   *  navigation's `scroll` / `pulse` survives a language switch that follows it (the owner is read at run time). */
  let settleSeq = 0;
  let pendingOpts: { pulse: boolean; scroll: boolean } | null = null;
  function settle(o: { pulse?: boolean; scroll?: boolean } = {}): void {
    const merged = { pulse: !!(pendingOpts?.pulse || o.pulse), scroll: !!(pendingOpts?.scroll || o.scroll) };
    pendingOpts = merged;
    const seq = ++settleSeq;
    raf2(() => {
      if (seq !== settleSeq) return; // a newer state change took over (and carries our options)
      pendingOpts = null;
      const { pulse } = merged;
      chat.restMode(); // once per settle: the butterfly leaves 'listening' and, at home, flies home exactly once
      switch (butterflyOwner()) {
        case 'wheel':
          void guide.focus(wheel.rim, { side: 'top-right', pulse: false });
          break;
        case 'tutorial':
          void guide.focus(tutorial.title, { side: 'inside-top-left', pulse: false });
          break;
        case 'page': {
          const tg = page.target();
          if (!tg) break;
          if (merged.scroll) page.reveal(tg.el);
          void guide.focus(tg.el, { ...tg.opts, dim: true, pulse });
          break;
        }
        case 'prompt': {
          // the prompt line itself (data-perch lets the butterfly re-attach when the centre re-renders)
          const prompt = center.el.querySelector<HTMLElement>('[data-perch="center-prompt"]') ?? center.el;
          void guide.focus(prompt, { side: 'top', pulse });
          break;
        }
        case 'capsules': {
          // Below the capsule group: above it sits the home hint line, which the butterfly must not cover.
          const list = center.el.querySelector<HTMLElement>('[data-perch="center-list"]') ?? center.el;
          void guide.focus(list, { side: 'bottom', pulse });
          break;
        }
        default:
          void guide.release();
      }
    });
  }

  const wheel = createWheel({ input, scrim, button: wheelBtn, settle: () => settle() });
  const tutorial = createTutorial({ input, scrim, button: tutorialBtn, wheelButton: wheelBtn, settle: () => settle() });
  const chat = createChatbar({ input, mic, wheelBtn, tutorialBtn, matcher, butterfly, center });

  // After closing a page: desktop returns to the input; touch devices must not pop the soft keyboard, so the home heading gets focus.
  const coarse = window.matchMedia('(pointer: coarse)');
  const returnFocus = (): void => (coarse.matches ? $('#home-title').focus({ preventScroll: true }) : chat.focusInput());

  // ---- navigation hooks
  bindNav({
    showPage(id, anchor) {
      page.show(id, anchor);
      settle({ pulse: true, scroll: true });
    },
    showHome({ source, keepCenter, keepOverlay }) {
      const wasOpen = page.isOpen();
      // An overlay opened while this close was pending is the newer action: it keeps its lead and its focus.
      const overlayWins = !!keepOverlay && getState().overlay !== 'none';
      if (wasOpen) page.hide();
      if (!keepCenter && (wasOpen || getState().center.kind !== 'capsules')) center.redraw(getState().lastVisited);
      // Owner rule: the open tutorial keeps the butterfly until the content changes. Home reached from a page
      // or from a tutorial step is such a change; a no-op "home" typed while already at home is not.
      const contentChanged = wasOpen || source === 'tutorial';
      setState({ ...(contentChanged && !overlayWins ? { tutorialLeads: false } : {}), pointCapsules: contentChanged ? source === 'tutorial' : getState().pointCapsules });
      settle({ pulse: true });
      if (overlayWins) return;
      if (source === 'tutorial') {
        // Mobile: the sheet closed and the clicked step vanished with it; focus must not fall to BODY.
        if (isMobile()) $('#home-title').focus({ preventScroll: true });
      } else if (wasOpen) {
        announce(t('announce.home'));
        returnFocus();
      }
    },
    openWheel: (trigger) => {
      tutorial.close({ restoreFocus: false, settle: false }); // wheel and tutorial are mutually exclusive
      wheel.open(trigger);
    },
    openTutorial: (trigger) => {
      wheel.close({ restoreFocus: false, settle: false });
      tutorial.open(trigger);
    },
    closeWheel: (o) => wheel.close(o),
    closeTutorial: (o) => tutorial.close(o),
    cancelVoice: () => chat.voice.cancel(),
  });

  // ---- buttons
  $('#page-close').addEventListener('click', () => navigate({ id: 'sys:home' }, { source: 'system' }));
  wheelBtn.addEventListener('click', () => {
    if (wheel.isOpen()) wheel.close({ restoreFocus: true, settle: true });
    else navigate({ id: 'sys:wheel' }, { trigger: wheelBtn });
  });
  tutorialBtn.addEventListener('click', () => {
    if (tutorial.isOpen()) tutorial.close({ restoreFocus: true, settle: true });
    else navigate({ id: 'sys:tutorial' }, { trigger: tutorialBtn });
  });

  // ---- Esc closes the top-most layer first
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    if (chat.voice.isActive()) {
      e.preventDefault();
      chat.voice.cancel();
    } else if (wheel.isOpen()) {
      e.preventDefault();
      wheel.close({ restoreFocus: true, settle: true });
    } else if (tutorial.isOpen()) {
      e.preventDefault();
      tutorial.close({ restoreFocus: true, settle: true });
    } else if (page.isOpen()) {
      e.preventDefault();
      navigate({ id: 'sys:home' }, { source: 'system' });
    }
  });

  // ---- language
  const langBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-lang]')];
  const syncLangButtons = (): void => langBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
  langBtns.forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang as Lang)));
  const renderLang = (): void => {
    chat.voice.cancel(); // the demo phrase is in the old language
    applyStaticText();
    syncLangButtons();
    center.render(false);
    wheel.render();
    tutorial.render();
    page.rerender();
    settle(); // the butterfly stays with its owner; no scroll, no pulse
  };
  onLangChange(() => {
    renderLang();
    announce(t('announce.lang'));
  });

  // ---- boot
  setState({ picks: pickCapsules(3, null) });
  applyStaticText();
  syncLangButtons();
  center.render(true);
  const first = initRouter((route, ctx) => applyRoute(route, ctx));
  if (first.id) applyRoute(first, { source: 'hash' });
}
