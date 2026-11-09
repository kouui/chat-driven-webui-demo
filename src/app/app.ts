import type { Lang } from '../types';
import { createButterfly, createGuide } from '../butterfly';
import type { CancellableGuide } from '../butterfly';
import { createMatcher } from '../intent';
import { destinations, systemIntents } from '../data/destinations';
import { getLang, initLang, onLangChange, setLang, t } from '../i18n';
import { $, isMobile, raf2 } from './dom';
import { butterflyOwner, getState, setState, subscribe } from './state';
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
import { createChoreo } from './choreo';
import { watchHesitation } from './hints';
import { feedback, getTempo, initMotionPref, initTempo, isClaimed, ms, onMotionChange, onOpBegin, onTempoChange, prefersReducedMotion } from './motion';
import { createMotionUi } from './motionui';
import { createPads } from './pads';
import type { PadSpec } from './pads';

/** The Wheel button's one-off pulse (matches `.pulse-once` in chatbar.css, design ms). */
const PULSE_ONCE_MS = 1100;
/** Watchdog: the home capsules appear at the latest this long after a close (design ms). */
const HOME_REVEAL_WATCHDOG_MS = 1400;

export function startApp(): void {
  initLang();
  initMotionPref(); // URL ?motion= > localStorage > OS; sets html.motion-reduced
  initTempo(); // URL ?speed= > localStorage > 0.5; sets --tempo on <html>; every choreography time goes through ms()
  initAnnounce($('#live'), $('#toast'));
  buildStarfield($('#starfield'));

  const input = $<HTMLInputElement>('#cmd-input');
  const mic = $('#btn-mic');
  const wheelBtn = $('#btn-wheel');
  const tutorialBtn = $('#btn-tutorial');
  const scrim = $('#scrim');
  const ring = $('#ring');

  const pads = createPads($('#pad-layer'));
  const butterfly = createButterfly($('#butterfly-layer'), {
    reducedMotion: prefersReducedMotion(), // the app owns the preference: the butterfly never reads the OS query
    onTarget: (el, phase) => pads.target(el, phase),
    home: () => {
      const r = ring.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
  });
  butterfly.setTimeScale(getTempo());
  onTempoChange((tempo) => butterfly.setTimeScale(tempo));
  onMotionChange((reduced) => {
    butterfly.setReducedMotion(reduced);
    pads.wake();
  });
  const baseGuide: CancellableGuide = createGuide(butterfly, { dimLayer: $('#dim') });
  // The pad of the target brightens when the flight gets close; the ring is the home pad.
  const guide: CancellableGuide = {
    focus: (el, o = {}) =>
      baseGuide.focus(el, {
        ...o,
        onApproach: () => {
          pads.approach(el);
          o.onApproach?.();
        },
      }),
    release: () => {
      const p = baseGuide.release();
      pads.light('home', 'near');
      return p.then((ok) => {
        if (ok && butterflyOwner() === 'home') pads.light('home', 'lit');
        return ok;
      });
    },
    cancel: () => baseGuide.cancel(),
  };
  // Pending reveals / underlines / pulses of the guide belong to the operation that started them.
  onOpBegin(() => baseGuide.cancel());
  const matcher = createMatcher(destinations, systemIntents);
  const motionUi = createMotionUi($('#motion-toggle'), $('#motion-notice'));

  const center = createCenter($('#center'), (o) => settle(o));
  let lookTimer = 0;
  // Any new operation ends a pending / running glance (a flight ignores turnToward anyway).
  onOpBegin(() => {
    window.clearTimeout(lookTimer);
    butterfly.turnToward(null);
  });
  const page = createPageCard({
    // hover / focus on a follow-up for 450ms: the butterfly turns toward it (no timed flights to follow-ups)
    look: (el) => {
      window.clearTimeout(lookTimer);
      if (el) lookTimer = window.setTimeout(() => el.isConnected && butterfly.turnToward(el), 450);
      else butterfly.turnToward(null);
    },
  });
  const choreo = createChoreo({
    butterfly,
    guide,
    page,
    center,
    input,
    pill: $('.cmd-pill'),
    ring,
    pulseWheel: (op) => {
      feedback(wheelBtn, 'pulse-once', ms(PULSE_ONCE_MS), op); // timeout cleanup (also when the animation is off); a newer action clears it
      butterfly.turnToward(wheelBtn);
    },
    settle: (o) => settle(o),
    rest: () => chat.restMode(),
    releaseOverlays: () => {
      wheel.release();
      tutorial.release();
    },
    syncPads: () => syncPads(),
    lightPad: (key, state) => pads.light(key, state),
  });

  // ---- landing pads: one per perch owner (A2) ----------------------------------------------------------
  function padSpecs(): PadSpec[] {
    const st = getState();
    const specs: PadSpec[] = [{ key: 'home', el: ring, self: true }];
    if (st.overlay === 'wheel') specs.push({ key: 'wheel', ident: 'wheel', el: wheel.rim, side: 'top-right' });
    if (st.overlay === 'tutorial') specs.push({ key: 'tutorial', ident: 'tutorial', el: tutorial.title, side: 'inside-top-left', within: tutorial.root });
    if (st.route) {
      const visible = (): boolean => page.padsVisible() && getState().overlay !== 'wheel';
      const cur = page.target();
      const first = destinations.find((d) => d.id === st.route)?.anchors[0];
      const kpi = first ? page.target(first) : null;
      if (cur) specs.push({ key: 'anchor', ident: `${st.route}:${st.anchor}`, el: cur.el, side: cur.opts.side, within: cur.opts.within, show: visible });
      if (kpi && kpi.el !== cur?.el) specs.push({ key: 'kpi', ident: `${st.route}:kpi`, el: kpi.el, side: kpi.opts.side, within: kpi.opts.within, show: visible });
    } else if (st.center.kind !== 'capsules') {
      const prompt = center.el.querySelector<HTMLElement>('[data-perch="center-prompt"]');
      if (prompt) specs.push({ key: 'prompt', ident: st.center.kind, el: prompt, side: 'top', show: () => !prompt.hasAttribute('data-hold') });
    }
    const nest = choreo.nestAnchor();
    if (nest) specs.push({ key: 'nest', ident: 'nest', el: nest, side: 'top' }); // measured: follows resize / rotation
    return specs;
  }
  let padSyncQueued = false;
  function syncPads(): void {
    if (padSyncQueued) return;
    padSyncQueued = true;
    queueMicrotask(() => {
      padSyncQueued = false;
      pads.sync(padSpecs());
    });
  }
  subscribe(() => syncPads());

  /** The ONE place that decides where the butterfly belongs, derived from state (see `butterflyOwner`):
   *  wheel rim / tutorial title > page anchor > centre prompt / capsule group > home. Call it after every
   *  state change. `scroll`: bring the page anchor into view (only for a navigation, never for a language switch).
   *  Calls landing within the same two-frame window coalesce into one; their options are OR-ed together, so a
   *  navigation's `scroll` / `pulse` survives a language switch that follows it (the owner is read at run time). */
  let settleSeq = 0;
  let pendingOpts: { pulse: boolean; scroll: boolean } | null = null;
  let homeEpoch = 0;
  function settle(o: { pulse?: boolean; scroll?: boolean } = {}): void {
    const merged = { pulse: !!(pendingOpts?.pulse || o.pulse), scroll: !!(pendingOpts?.scroll || o.scroll) };
    pendingOpts = merged;
    const seq = ++settleSeq;
    raf2(() => {
      if (seq !== settleSeq) return; // a newer state change took over (and carries our options)
      pendingOpts = null;
      const { pulse } = merged;
      // A choreography (page open, sweep, the voice nest ...) owns the flight: a second focus would restart it.
      if (isClaimed()) {
        chat.restMode();
        return;
      }
      const landedHome = (ok: boolean): void => {
        if (ok) center.revealHome(homeEpoch); // the capsules stagger in from the butterfly's landing on the ring
      };
      switch (butterflyOwner()) {
        case 'wheel':
          void guide.focus(wheel.rim, { side: 'top-right', pulse: false, trail: 'light' });
          break;
        case 'tutorial':
          void guide.focus(tutorial.title, { side: 'inside-top-left', within: tutorial.root, pulse: false });
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
          void guide.focus(list, { side: 'bottom', pulse }).then(landedHome);
          break;
        }
        default:
          void guide.release().then(landedHome);
      }
      // After the flight has started: leaving the 'voice' mode earlier would fade the rings instead of folding them in.
      chat.restMode();
    });
  }

  const wheel = createWheel({ input, scrim, button: wheelBtn, settle: () => settle(), turn: (el) => butterfly.turnToward(el) });
  const tutorial = createTutorial({ input, scrim, button: tutorialBtn, wheelButton: wheelBtn, settle: () => settle() });
  const chat = createChatbar({ input, mic, wheelBtn, tutorialBtn, matcher, butterfly, center, choreo, settle: () => settle() });

  // After closing a page: desktop returns to the input; touch devices must not pop the soft keyboard, so the home heading gets focus.
  const coarse = window.matchMedia('(pointer: coarse)');
  const returnFocus = (): void => (coarse.matches ? $('#home-title').focus({ preventScroll: true }) : chat.focusInput());

  // ---- navigation hooks
  bindNav({
    touch: (origin) => choreo.touch(origin),
    showPage(id, anchor, source, origin) {
      choreo.page(id, anchor, source, origin);
    },
    showHome({ source, keepCenter }) {
      const wasOpen = page.isOpen();
      // The close starts at once: it invalidates the running operation, the frame leaves (content, then a shrinking
      // circle toward the ring) and `hidden` comes last. Also ends any older sequence (a hint, a sweep) unless this
      // close belongs to one (keepCenter: candidates / no match). History catches up asynchronously (navigate.ts).
      void choreo.closePage(!!keepCenter);
      if (wasOpen) choreo.homeVisit();
      // The new capsules stay invisible and inert until the butterfly has landed on the ring, then they stagger in
      // (`settle` -> landedHome). A watchdog covers the owners that never land there (wheel, tutorial).
      if (!keepCenter && (wasOpen || getState().center.kind !== 'capsules')) {
        const hold = !prefersReducedMotion() && getState().overlay !== 'wheel';
        homeEpoch = center.redraw(getState().lastVisited, { hold });
        const ep = homeEpoch;
        if (hold) window.setTimeout(() => center.revealHome(ep), ms(HOME_REVEAL_WATCHDOG_MS));
      }
      // Owner rule: the open tutorial keeps the butterfly until the content changes. Home reached from a page
      // or from a tutorial step is such a change; a no-op "home" typed while already at home is not.
      const contentChanged = wasOpen || source === 'tutorial';
      setState({ ...(contentChanged ? { tutorialLeads: false } : {}), pointCapsules: contentChanged ? source === 'tutorial' : getState().pointCapsules });
      settle({ pulse: true });
      if (source === 'tutorial') {
        // Mobile: the sheet closed and the clicked step vanished with it; focus must not fall to BODY.
        if (isMobile()) $('#home-title').focus({ preventScroll: true });
      } else if (wasOpen) {
        announce(t('announce.home'));
        returnFocus();
      }
    },
    openWheel: (trigger) => {
      choreo.overlayOpened();
      tutorial.close({ restoreFocus: false, settle: false }); // wheel and tutorial are mutually exclusive
      wheel.open(trigger);
    },
    openTutorial: (trigger) => {
      choreo.overlayOpened();
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
    motionUi.render();
    center.render(false); // keeps every reveal state: held candidates stay hidden and inert
    wheel.render();
    tutorial.render();
    page.rerender();
    // No settle(): a language switch only re-attaches. The butterfly follows its element by `data-perch`, nothing
    // is replayed, no flight starts, nothing is pulsed.
    syncPads();
  };
  onLangChange(() => {
    renderLang();
    announce(t('announce.lang'));
  });

  // ---- (j) hesitation hint: 8s without any activity, at home, nothing open
  watchHesitation({
    canHint: () => butterflyOwner() === 'home' && getState().overlay === 'none' && getState().route === null && !chat.voice.isActive(),
    fire: () => choreo.hint(),
    cancel: () => choreo.cancelHint(), // activity ends a running hint (its flight, its border breath, its return)
  });

  // ---- boot
  setState({ picks: pickCapsules(3, null) });
  applyStaticText();
  syncLangButtons();
  center.render(true);
  pads.sync(padSpecs());
  pads.light('home', 'lit'); // the butterfly starts on the ring
  const first = initRouter((route, ctx) => applyRoute(route, ctx));
  if (first.id) applyRoute(first, { source: 'hash' });
}
