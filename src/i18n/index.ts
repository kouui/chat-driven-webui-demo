import type { Lang, L10n } from '../types';
import { LANGS } from '../types';
import { dict } from './dict';

const KEY = 'aurea.lang';
const LOCALES: Record<Lang, string> = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP' };
const IDX: Record<Lang, 0 | 1 | 2> = { zh: 0, en: 1, ja: 2 };

function readStored(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (LANGS as readonly string[]).includes(v)) return v as Lang;
  } catch {
    /* storage may be blocked */
  }
  return 'zh';
}

let lang: Lang = readStored();
const listeners = new Set<(l: Lang) => void>();

export function getLang(): Lang {
  return lang;
}

export function locale(): string {
  return LOCALES[lang];
}

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = next;
  listeners.forEach((fn) => fn(next));
}

/** Apply the stored language to <html lang> (call once at start). */
export function initLang(): void {
  document.documentElement.lang = lang;
}

export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const row = dict[key];
  let s = row ? row[IDX[lang]] : key;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

/** Pick the current-language string of an L10n object. */
export function l(v: L10n): string {
  return v[lang];
}

// ---- number / date formatting (one currency: USD, narrow symbol "$")
export function money(n: number, digits = 0): string {
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function signedMoney(n: number, digits = 2): string {
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    signDisplay: 'exceptZero',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** `n` is already in percent units (11.8 → "11.8%"). */
export function pct(n: number, digits = 1, signed = false): string {
  return new Intl.NumberFormat(locale(), {
    style: 'percent',
    signDisplay: signed ? 'exceptZero' : 'auto',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n / 100);
}

export function num(n: number, digits = 0): string {
  return new Intl.NumberFormat(locale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** ISO date (YYYY-MM-DD) → localized, timezone-independent. */
export function fmtDate(iso: string, style: 'short' | 'long' | 'weekday' = 'short'): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions =
    style === 'long'
      ? { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }
      : style === 'weekday'
        ? { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' }
        : { month: 'short', day: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(locale(), opts).format(d);
}

/** 0-based month → short month name. */
export function monthName(m: number): string {
  return new Intl.DateTimeFormat(locale(), { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m, 1)));
}
