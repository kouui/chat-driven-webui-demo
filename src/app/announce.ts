let live: HTMLElement;
let toastEl: HTMLElement;
let toastTimer = 0;

export function initAnnounce(liveEl: HTMLElement, toast: HTMLElement): void {
  live = liveEl;
  toastEl = toast;
}

/** Screen-reader announcement (polite live region). */
export function announce(msg: string): void {
  live.textContent = '';
  requestAnimationFrame(() => {
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
