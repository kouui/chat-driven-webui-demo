// Shared contracts for the 001-demo. Owned by the leader — do not change without approval.

export type Lang = 'zh' | 'en' | 'ja';
export const LANGS: readonly Lang[] = ['zh', 'en', 'ja'] as const;
export type L10n = Record<Lang, string>;
export type L10nList = Record<Lang, string[]>;

export type DestId =
  | 'overview' | 'cashflow' | 'holdings' | 'returns' | 'risk' | 'plan' | 'trades';
export type SystemId = 'sys:home' | 'sys:wheel' | 'sys:tutorial';
export type TargetId = DestId | SystemId;

/** Where to go. `anchor` is a `data-perch` value inside the destination page (default 'title'). */
export interface NavTarget {
  id: TargetId;
  anchor?: string;
}

/** A sub-intent that points to a specific element inside a page ("perch on the answer"). */
export interface AnchorIntent {
  anchor: string;            // must match a data-perch value of the page
  label: L10n;               // human label, e.g. "Total assets"
  phrases: L10nList;         // phrases that should land on this anchor
  keywords?: L10nList;       // extra keywords that favour this anchor
}

export interface Capsule {
  text: L10n;                // sample user phrase shown in a capsule
  target: NavTarget;
}

export interface Destination {
  id: DestId;
  icon: string;              // single emoji or short glyph used in the wheel
  title: L10n;
  summary: L10n;             // one-line description (wheel tooltip, tutorial, candidates)
  anchors: string[];         // all data-perch values the page renders (besides 'title')
  phrases: L10nList;         // whole-page phrases
  keywords: Record<Lang, { high: string[]; med: string[] }>;
  anchorIntents: AnchorIntent[];
  capsules: Capsule[];       // >= 3 per destination
  followUps: Capsule[];      // exactly 2, pointing to OTHER destinations
}

export interface SystemIntent {
  id: SystemId;
  label: L10n;
  phrases: L10nList;
  keywords: L10nList;
}

export interface MatchCandidate {
  target: NavTarget;
  score: number;             // 0..1 ranking score (not a probability)
  label: L10n;               // destination title (or anchor label) for the candidate capsule
  reason: string;            // debug: which layer matched, e.g. "phrase:收益" / "bigram:0.42"
}

export type MatchResult =
  | { status: 'confident'; best: MatchCandidate; candidates: MatchCandidate[] }
  | { status: 'ambiguous'; candidates: MatchCandidate[] }   // 2..3 items
  | { status: 'none'; candidates: MatchCandidate[] };       // may be empty

export interface Matcher {
  /** `uiLang` is only a hint (Segmenter locale preference / tie-break); all languages are always matched. */
  match(input: string, uiLang: Lang): MatchResult;
}

// ---- Butterfly / guide ----
export type PerchSide = 'top-left' | 'top-right' | 'top' | 'left' | 'right' | 'bottom';
export type ButterflyMode = 'idle' | 'listening' | 'flying' | 'perched';

export interface Butterfly {
  /** Fly to an element (and keep following it while perched) or to a viewport point.
   *  Resolves `true` on landing, `false` if cancelled by a newer flight. */
  flyTo(target: Element | { x: number; y: number }, opts?: { side?: PerchSide }): Promise<boolean>;
  /** Return to the home position (center of the stage ring) and idle. */
  home(): Promise<boolean>;
  /** e.g. 'listening' while the user types (faster flap, slight lift). */
  setMode(mode: Exclude<ButterflyMode, 'flying'>): void;
  /** Short "confused head-tilt" gesture (no-match). */
  tilt(): void;
  setReducedMotion(on: boolean): void;
  destroy(): void;
}

export interface Guide {
  /** Single entry point for attention: optional dim, butterfly flies to el, then one gold pulse on el. */
  focus(el: Element, opts?: { side?: PerchSide; dim?: boolean; pulse?: boolean }): Promise<boolean>;
  /** Clear dim/pulse and send the butterfly home. */
  release(): Promise<boolean>;
}
