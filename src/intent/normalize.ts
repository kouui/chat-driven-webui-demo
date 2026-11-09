// Text normalisation shared by the index builder and the query path.

const KATAKANA = /[ァ-ヶ]/g;

/** Katakana -> hiragana (1:1 per UTF-16 unit, so string indexes stay stable). */
export function foldKana(s: string): string {
  return s.replace(KATAKANA, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * NFKC + lowercase; apostrophes dropped ("don't" -> "dont"); clause punctuation
 * becomes "|"; every other punctuation/symbol/space run becomes one space.
 * Kana are NOT folded here (segmentation prefers the original script).
 */
export function normalizeClauses(s: string): string {
  let t = s.normalize('NFKC').toLowerCase();
  t = t.replace(/['’‘`´]/g, '');
  t = t.replace(/[,.;!?。、…\n\r|]+/g, '|');
  t = t.replace(/[\p{P}\p{S}\p{Z}\p{C}_]+/gu, (m) => (m.includes('|') ? '|' : ' '));
  t = t.replace(/ *\|[ |]*/g, '|').replace(/ +/g, ' ');
  return t.replace(/^[ |]+|[ |]+$/g, '');
}

/** Normalised comparison form: NFKC, lowercase, kana folded, punctuation -> single spaces. */
export function normalize(s: string): string {
  return foldKana(normalizeClauses(s)).replace(/\|/g, ' ').replace(/ +/g, ' ').trim();
}

/** `normalize` with all whitespace removed (what CJK matching works on). */
export function compact(s: string): string {
  return normalize(s).replace(/ /g, '');
}

const CJK_RE = /[぀-ヿ㐀-鿿豈-﫿]/;
export function hasCjk(s: string): boolean {
  return CJK_RE.test(s);
}

/**
 * Offsets (in `normalizeClauses(s)`) where a clause ends with a question mark. `normalizeClauses`
 * turns "?" into a plain clause break, so the interrogative force is recovered here.
 * Returns an empty set if the clause structure cannot be aligned.
 */
export function questionEnds(s: string): Set<number> {
  const out = new Set<number>();
  const raw = s.normalize('NFKC');
  const norm = normalizeClauses(s);
  const clauses: { text: string; q: boolean }[] = [];
  for (const m of raw.matchAll(/([^,.;!?。、…\n\r|]*)([,.;!?。、…\n\r|]*)/gu)) {
    const text = normalizeClauses(m[1]!);
    if (text) clauses.push({ text, q: m[2]!.includes('?') });
    else if (m[2]!.includes('?') && clauses.length) clauses[clauses.length - 1]!.q = true;
  }
  if (clauses.map((c) => c.text).join('|') !== norm) return out;
  let pos = 0;
  for (const c of clauses) {
    pos += c.text.length;
    if (c.q) out.add(pos);
    pos += 1;
  }
  return out;
}
