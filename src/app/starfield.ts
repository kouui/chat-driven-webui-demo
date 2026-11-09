/** ≤ 60 tiny stars; only ~1/3 twinkle (CSS opacity animation). Deterministic positions. */
export function buildStarfield(host: HTMLElement, count = 56): void {
  let seed = 20261109;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const frag = document.createDocumentFragment();
  for (let i = 0; i < Math.min(count, 60); i++) {
    const star = document.createElement('i');
    star.className = i % 3 === 0 ? 'star tw' : 'star';
    const size = 1 + rnd() * 1.6;
    star.style.cssText = `left:${(rnd() * 100).toFixed(2)}%;top:${(rnd() * 100).toFixed(2)}%;--s:${size.toFixed(2)}px;--o:${(0.25 + rnd() * 0.55).toFixed(2)};--d:${(3 + rnd() * 4).toFixed(1)}s;--dl:${(-rnd() * 6).toFixed(1)}s`;
    frag.appendChild(star);
  }
  host.appendChild(frag);
}
