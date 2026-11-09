import { currentOp } from './motion';

let live: HTMLElement;
let announceSeq = 0;
let toastEl: HTMLElement;
let toastTimer = 0;

export function initAnnounce(liveEl: HTMLElement, toast: HTMLElement): void {
  live = liveEl;
  toastEl = toast;
}

/** Screen-reader announcement (polite live region). */
export function announce(msg: string): void {
  const id = ++announceSeq;
  const op = currentOp();
  live.textContent = '';
  requestAnimationFrame(() => {
    // cancellable: a newer announcement, or a newer user action (operation), makes this one stale
    if (id !== announceSeq || op !== currentOp()) return;
    live.textContent = msg;
  });
}

/** Short visual toast (aria-hidden: the same news goes through `announce`). */
export function toast(msg: string, ms = 2600): void {
  toastEl.textContent = msg;
  toastEl.classList.add('is-show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('is-show'), ms);
}
