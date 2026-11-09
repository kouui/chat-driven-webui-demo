import type { Capsule, DestId, MatchCandidate } from '../types';

export type Overlay = 'none' | 'wheel' | 'tutorial';
export type Center =
  | { kind: 'capsules' }
  | { kind: 'candidates'; items: MatchCandidate[] }
  | { kind: 'nomatch'; suggestions: Capsule[] };

export interface AppState {
  route: DestId | null;
  anchor: string;
  overlay: Overlay;
  center: Center;
  picks: Capsule[]; // the 3 home capsules
  lastVisited: DestId | null;
  tutorialDone: number[];
  tutorialCurrent: number | null;
  /** The open tutorial owns the butterfly until content (page / centre prompt) changes after it opened. */
  tutorialLeads: boolean;
  /** Home was reached from the tutorial: the butterfly points at the capsule group. */
  pointCapsules: boolean;
}

export type Owner = 'wheel' | 'tutorial' | 'page' | 'prompt' | 'capsules' | 'home';

/** Who owns the butterfly right now: overlay > page (the centre is hidden behind it) > centre prompt > home. */
export function butterflyOwner(s: Readonly<AppState> = state): Owner {
  if (s.overlay === 'wheel') return 'wheel';
  if (s.overlay === 'tutorial' && s.tutorialLeads) return 'tutorial';
  if (s.route) return 'page';
  if (s.center.kind !== 'capsules') return 'prompt';
  return s.pointCapsules ? 'capsules' : 'home';
}

const TUT_KEY = 'aurea.tutorial';

function readTutorial(): number[] {
  try {
    const raw = sessionStorage.getItem(TUT_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < 5) : [];
  } catch {
    return [];
  }
}

const state: AppState = {
  route: null,
  anchor: 'title',
  overlay: 'none',
  center: { kind: 'capsules' },
  picks: [],
  lastVisited: null,
  tutorialDone: readTutorial(),
  tutorialCurrent: null,
  tutorialLeads: false,
  pointCapsules: false,
};

const subs = new Set<(s: AppState, changed: (keyof AppState)[]) => void>();

export const getState = (): Readonly<AppState> => state;

export function setState(patch: Partial<AppState>): void {
  const changed = (Object.keys(patch) as (keyof AppState)[]).filter((k) => state[k] !== patch[k]);
  Object.assign(state, patch);
  if (changed.length) subs.forEach((fn) => fn(state, changed));
}

export function subscribe(fn: (s: AppState, changed: (keyof AppState)[]) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function markTutorialDone(i: number): void {
  const done = state.tutorialDone.includes(i) ? state.tutorialDone : [...state.tutorialDone, i];
  setState({ tutorialDone: done, tutorialCurrent: i });
  try {
    sessionStorage.setItem(TUT_KEY, JSON.stringify(done));
  } catch {
    /* ignore */
  }
}
