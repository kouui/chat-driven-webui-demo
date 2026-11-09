import type { DestId, PerchOpts } from '../types';
import { destinations } from '../data/destinations';
import { renderPage } from '../pages';
import { l, t } from '../i18n';
import { h, clear, isMobile } from './dom';
import { getState, setState } from './state';
import { navigate } from './navigate';
import { announce } from './announce';

export interface PageCard {
  show(id: DestId, anchor: string | undefined): void;
  hide(): void;
  /** Re-render in the current language; keeps the scroll position. */
  rerender(): void;
  isOpen(): boolean;
  /** Where the butterfly belongs: the current anchor (or the title) and how to perch on it. */
  target(): { el: HTMLElement; opts: PerchOpts } | null;
  /** Scroll the anchor into view (only when a navigation asked for it). */
  reveal(el: HTMLElement): void;
}

export function createPageCard(): PageCard {
  const wrap = document.getElementById('page-wrap') as HTMLElement;
  const card = document.getElementById('page-card') as HTMLElement;
  const scroll = document.getElementById('page-scroll') as HTMLElement;
  const body = document.getElementById('page-body') as HTMLElement;
  const followups = document.getElementById('followups') as HTMLElement;
  const home = document.getElementById('home') as HTMLElement;

  const anchorEl = (): HTMLElement | null => {
    const { anchor } = getState();
    const byAnchor = anchor && anchor !== 'title' ? body.querySelector<HTMLElement>(`[data-perch="${anchor}"]`) : null;
    return byAnchor ?? body.querySelector<HTMLElement>('[data-perch="title"]');
  };

  function renderFollowups(id: DestId): void {
    const dest = destinations.find((d) => d.id === id)!;
    clear(followups);
    followups.setAttribute('aria-label', t('page.followups'));
    followups.append(
      h('span', { class: 'followups-label', 'aria-hidden': 'true' }, t('page.followups')),
      ...dest.followUps.map((c) => h('button', { type: 'button', class: 'capsule capsule-follow', onclick: () => navigate(c.target, { source: 'followup' }) }, l(c.text))),
    );
  }

  const focusTitle = (): void => body.querySelector<HTMLElement>('[data-perch="title"]')?.focus({ preventScroll: true });

  function fill(id: DestId): void {
    clear(body);
    body.append(renderPage(id));
    renderFollowups(id);
  }

  return {
    show(id, anchor) {
      const dest = destinations.find((d) => d.id === id)!;
      const wasOpen = getState().route !== null;
      setState({ route: id, anchor: anchor ?? 'title', lastVisited: id, tutorialLeads: false, pointCapsules: false });
      fill(id);
      scroll.scrollTop = 0;
      wrap.hidden = false;
      card.setAttribute('aria-labelledby', 'page-title');
      home.setAttribute('inert', '');
      document.body.classList.add('has-page');
      wrap.classList.toggle('is-switch', wasOpen);
      // restart the entrance animation
      wrap.classList.remove('is-enter');
      void wrap.offsetWidth;
      wrap.classList.add('is-enter');
      // A docked tutorial (desktop) keeps keyboard focus on its step list.
      if (!(getState().overlay === 'tutorial' && !isMobile())) focusTitle();
      announce(t('announce.opened', { x: l(dest.title) }));
    },
    hide() {
      wrap.hidden = true;
      wrap.classList.remove('is-enter');
      home.removeAttribute('inert');
      document.body.classList.remove('has-page');
      setState({ route: null, anchor: 'title' });
    },
    rerender() {
      const { route } = getState();
      if (!route) return;
      const focusInside = body.contains(document.activeElement);
      const top = scroll.scrollTop;
      fill(route);
      scroll.scrollTop = top;
      if (focusInside) focusTitle();
    },
    isOpen: () => getState().route !== null,
    target() {
      const el = anchorEl();
      // The title and anchors perch inside their own top-left corner (the CSS leaves a gutter there),
      // clamped to the card's scrollport, so the butterfly never lands on the close button or a neighbour.
      return el ? { el, opts: { side: 'inside-top-left', within: scroll } } : null;
    },
    reveal: (el) => el.dataset.perch !== 'title' && el.scrollIntoView({ block: 'center', inline: 'nearest' }),
  };
}
