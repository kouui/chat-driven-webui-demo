// Word segmentation via Intl.Segmenter (zh / ja / en), with a regex fallback.
import type { Lang } from '../types';

export interface Seg {
  segment: string;
  index: number;
  wordLike: boolean;
}

const cache = new Map<string, Intl.Segmenter | null>();

function getSegmenter(locale: Lang): Intl.Segmenter | null {
  if (cache.has(locale)) return cache.get(locale)!;
  let seg: Intl.Segmenter | null = null;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      seg = new Intl.Segmenter(locale, { granularity: 'word' });
    }
  } catch {
    seg = null;
  }
  cache.set(locale, seg);
  return seg;
}

/** Han-only -> zh (unless the UI hint says ja), any kana -> ja, otherwise en. */
export function detectLocale(text: string, hint?: Lang): Lang {
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/[㐀-鿿]/.test(text)) return hint === 'ja' ? 'ja' : 'zh';
  return 'en';
}

const FALLBACK_RE = /[a-z0-9]+|[぀-ヿ]+|[㐀-鿿]|[^\s]/giu;

export function segment(text: string, hint?: Lang): Seg[] {
  const seg = getSegmenter(detectLocale(text, hint));
  const out: Seg[] = [];
  if (seg) {
    for (const s of seg.segment(text)) {
      out.push({ segment: s.segment, index: s.index, wordLike: !!s.isWordLike });
    }
    return out;
  }
  for (const m of text.matchAll(FALLBACK_RE)) {
    out.push({ segment: m[0], index: m.index ?? 0, wordLike: /[\p{L}\p{N}]/u.test(m[0]) });
  }
  return out;
}

/** Word-like tokens only. */
export function tokens(text: string, hint?: Lang): string[] {
  return segment(text, hint)
    .filter((s) => s.wordLike)
    .map((s) => s.segment);
}
