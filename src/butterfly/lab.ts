// Standalone dev page for the butterfly. Open /butterfly-lab.html under `npm run dev`.
import './butterfly.css';
import { createButterfly, createGuide } from './index';
import type { PerchSide } from '../types';

const css = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: radial-gradient(ellipse at 50% 30%, #0C1220, #05070F 70%); color: #E9E4D4;
    font: 14px/1.4 system-ui, -apple-system, "Segoe UI", "Noto Sans CJK SC", sans-serif; min-height: 160vh; }
  #stage { padding: 16px 20px 60px; max-width: 980px; margin: 0 auto; transition: opacity .28s; }
  h1 { font: 600 20px "Noto Serif SC", "Songti SC", serif; color: #F5C76A; margin: 0 0 8px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; align-items: center; }
  button, select { background: rgba(14,19,31,.9); color: #E9E4D4; border: 1px solid rgba(245,199,106,.3);
    border-radius: 8px; padding: 8px 12px; font: inherit; cursor: pointer; min-height: 40px; }
  button:hover { border-color: #F5C76A; }
  label { display: inline-flex; gap: 6px; align-items: center; }
  .ring { position: relative; width: 220px; height: 220px; margin: 18px auto; border-radius: 50%;
    border: 1px solid rgba(245,199,106,.18); display: grid; place-items: center; color: #8A94A6; }
  .ring::after { content: ''; position: absolute; inset: 24px; border-radius: 50%; border: 1px dashed rgba(245,199,106,.12); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; margin-top: 14px; }
  .box { background: rgba(14,19,31,.78); border: 1px solid rgba(245,199,106,.18); border-radius: 12px;
    padding: 18px; min-height: 90px; cursor: pointer; }
  .box small { color: #8A94A6; display: block; margin-top: 4px; }
  .mover { animation: mover 4s ease-in-out infinite alternate; }
  @keyframes mover { from { transform: translateX(0) translateY(0); } to { transform: translateX(160px) translateY(40px); } }
  .tall { margin-top: 300px; }
  .kpi { display: block; min-height: 120px; }
  .kpi .val { font: 600 28px "Noto Serif SC", serif; color: #FFF3C4; font-variant-numeric: tabular-nums; }
  .scroller { height: 220px; overflow-y: auto; margin-top: 14px; border: 1px solid rgba(245,199,106,.3);
    border-radius: 12px; padding: 12px; background: rgba(14,19,31,.5); }
  .scroller .box { margin-bottom: 12px; min-height: 64px; }
  #log { color: #8A94A6; font-size: 12px; min-height: 18px; }
`;
const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);

const stage = document.getElementById('stage') as HTMLElement;
const layer = document.getElementById('bf-layer') as HTMLElement;
stage.innerHTML = `
  <h1>Butterfly Lab</h1>
  <div class="row">
    <button data-act="home">Home (release)</button>
    <button data-act="tilt">Tilt</button>
    <button data-act="idle">Mode: idle</button>
    <button data-act="listening">Mode: listening</button>
    <button data-act="perched">Mode: perched</button>
    <button data-act="rerender">Re-render boxes</button>
    <label><input type="checkbox" id="reduced" /> Reduced motion</label>
    <label><input type="checkbox" id="dim" checked /> Dim</label>
    <label><input type="checkbox" id="pulse" checked /> Pulse</label>
    <label>Side
      <select id="side">
        <option>top-right</option><option>top-left</option><option>top</option>
        <option>left</option><option>right</option><option>bottom</option><option>inside-top-left</option>
      </select>
    </label>
  </div>
  <div class="ring" id="ring">home ring</div>
  <div class="grid" id="grid">
    <div class="box kpi" data-perch="kpi">
      <small>Total assets (side: inside-top-left puts the butterfly next to the value)</small>
      <div class="val" data-perch="kpi-value">¥ 1,284,000</div>
    </div>
    <div class="box" data-perch="a">Box A<small>click to perch</small></div>
    <div class="box" data-perch="b">Box B<small>click to perch</small></div>
    <div class="box mover" data-perch="mover">Moving box<small>CSS animation: tests per-frame tracking</small></div>
    <div class="box" id="vanish">Vanishing box<small>click: perch, then it removes itself (butterfly goes home)</small></div>
    <div class="box" data-perch="c">Box C<small>click to perch</small></div>
    <div class="box" data-perch="d">Box D<small>click to perch</small></div>
  </div>
  <div class="scroller" id="scroller" data-testid="scroller">
    ${Array.from({ length: 8 }, (_, i) => `<div class="box" data-within="1" data-perch="row-${i}">Row ${i}<small>inside a scroll container: perch is clamped to it; fades out when scrolled away</small></div>`).join('')}
  </div>
  <div class="box tall" data-perch="far">Far box (scroll test: scroll the page while perched)<small>below the fold</small></div>
  <p id="log"></p>
`;

const ring = document.getElementById('ring') as HTMLElement;
const log = document.getElementById('log') as HTMLElement;
const reducedBox = document.getElementById('reduced') as HTMLInputElement;
const dimBox = document.getElementById('dim') as HTMLInputElement;
const pulseBox = document.getElementById('pulse') as HTMLInputElement;
const sideSel = document.getElementById('side') as HTMLSelectElement;

const butterfly = createButterfly(layer, {
  reducedMotion: reducedBox.checked,
  home: () => {
    const r = ring.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },
});
const guide = createGuide(butterfly, { dimLayer: stage });

(window as unknown as { __lab: unknown }).__lab = { butterfly, guide };

async function focusBox(el: HTMLElement): Promise<boolean> {
  log.textContent = 'flying...';
  const within = el.closest<HTMLElement>('.scroller') ?? undefined;
  const ok = await guide.focus(el, { side: sideSel.value as PerchSide, dim: dimBox.checked, pulse: pulseBox.checked, within });
  log.textContent = ok ? 'landed' : 'cancelled';
  return ok;
}

stage.addEventListener('click', async (ev) => {
  const t = ev.target as HTMLElement;
  const btn = t.closest('button');
  if (btn) {
    switch (btn.dataset.act) {
      case 'home':
        void guide.release();
        break;
      case 'tilt':
        butterfly.tilt();
        break;
      case 'idle':
        butterfly.setMode('idle');
        break;
      case 'listening':
        butterfly.setMode('listening');
        break;
      case 'perched':
        butterfly.setMode('perched');
        break;
      case 'rerender': {
        // Replace the grid's children with identical markup: the perched element is disconnected,
        // the butterfly should silently re-attach to the new element with the same data-perch.
        const grid = document.getElementById('grid') as HTMLElement;
        grid.innerHTML = grid.innerHTML;
        log.textContent = 'boxes re-rendered';
        break;
      }
    }
    return;
  }
  const box = t.closest<HTMLElement>('.box');
  if (!box) return;
  if (box.id === 'vanish') {
    const ok = await focusBox(box);
    if (!ok) return;
    setTimeout(() => {
      const parent = box.parentElement;
      const next = box.nextSibling;
      box.remove();
      log.textContent = 'target removed from DOM -> butterfly should go home';
      setTimeout(() => parent?.insertBefore(box, next), 2500);
    }, 1200);
    return;
  }
  void focusBox(box.classList.contains('kpi') ? (box.querySelector<HTMLElement>('.val') ?? box) : box);
});

reducedBox.addEventListener('change', () => butterfly.setReducedMotion(reducedBox.checked));
// Typing in the lab (any key) shows the listening mode quickly.
window.addEventListener('keydown', (e) => {
  if (e.key === 'l') butterfly.setMode('listening');
  if (e.key === 'i') butterfly.setMode('idle');
});
