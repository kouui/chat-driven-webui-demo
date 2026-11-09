// Character bigram sets + Dice coefficient (language independent, good for CJK).

export function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length === 1) out.add(s);
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

export function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let o = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const g of small) if (big.has(g)) o++;
  return (2 * o) / (a.size + b.size);
}

export function diceStrings(a: string, b: string): number {
  return dice(bigrams(a), bigrams(b));
}
