// Standalone dev page for the butterfly. Open /butterfly-lab.html under `npm run dev`.
import './butterfly.css';
import { createButterfly, createGuide } from './index';
import type { PerchSide } from '../types';
import type { ButterflyFx } from './butterfly';

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
  #hud { position: fixed; right: 10px; bottom: 10px; z-index: 9999; background: rgba(5,7,15,.82); border: 1px solid rgba(245,199,106,.3);
    border-radius: 8px; padding: 6px 10px; font: 12px/1.4 ui-monospace, monospace; color: #FFF3C4; pointer-events: none; white-space: pre; }
  #srcbox { display: inline-block; padding: 10px 16px; border: 1px solid rgba(245,199,106,.5); border-radius: 999px; background: rgba(245,199,106,.08); }
  input[type=range] { width: 160px; }
  input[type=number] { width: 72px; background: rgba(14,19,31,.9); color: #E9E4D4; border: 1px solid rgba(245,199,106,.3); border-radius: 6px; padding: 6px; font: inherit; }
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
  <div class="row" id="fly">
    <button data-act="fly-long">Long flight (trail)</button>
    <button data-act="fly-back">Long flight back</button>
    <button data-act="fly-carry">Short carry (80px)</button>
    <button data-act="fly-light">Light trail</button>
    <button data-act="fly-none">No trail</button>
    <button data-act="nomatch">No match (loop + tilt)</button>
    <label>minDuration <input type="number" id="mind" value="0" step="100" min="0" /></label>
    <label><input type="checkbox" id="underline" checked /> Underline + reveal</label>
  </div>
  <div class="row">
    <span id="srcbox">spark source</span>
    <button data-act="spark">Spark</button>
    <button data-act="spark-fly">Spark + fly to Box B</button>
    <button data-act="far-spark-fly">Far spark (bottom-right) + fly to Box B</button>
    <button data-act="slide-fly">Fly to Box D while it slides 120px</button>
    <button data-act="voice">Voice mode on/off</button>
    <label>level <input type="range" id="level" min="0" max="1" step="0.01" value="0.5" /></label>
    <label><input type="checkbox" id="auto" checked /> auto envelope</label>
    <label>Perf tier: <b id="tier">0</b></label>
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
const minDur = document.getElementById('mind') as HTMLInputElement;
const underlineBox = document.getElementById('underline') as HTMLInputElement;
const levelEl = document.getElementById('level') as HTMLInputElement;
const autoEl = document.getElementById('auto') as HTMLInputElement;
const srcbox = document.getElementById('srcbox') as HTMLElement;
let voice = false;

let rafCount = 0;
let costSum = 0;
let stats = { rafPerSec: 0, frameMs: 0, tier: 0, live: 0 };
const nativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
  nativeRaf((t) => {
    const t0 = performance.now();
    rafCount++;
    cb(t);
    costSum += performance.now() - t0;
  });

const butterfly: ButterflyFx = createButterfly(layer, {
  reducedMotion: reducedBox.checked, // the lab owns the preference (never the OS query)
  onTarget: (el, phase) => ((window as unknown as { __targets?: string[] }).__targets ??= []).push(`${phase}:${el?.getAttribute('data-perch') ?? 'null'}`),
  home: () => {
    const r = ring.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },
});
const guide = createGuide(butterfly, { dimLayer: stage });
const hud = document.createElement('div');
hud.id = 'hud';
document.body.appendChild(hud);

// FPS + rAF counter + per-frame JS cost (the butterfly's single loop is the only rAF user in this page).
let lastT = performance.now();
let lastRaf = rafCount;
let lastCost = costSum;
setInterval(() => {
  const now = performance.now();
  const dtS = (now - lastT) / 1000;
  const n = rafCount - lastRaf;
  const cost = n > 0 ? (costSum - lastCost) / n : 0;
  stats = { rafPerSec: n / dtS, frameMs: cost, tier: butterfly.perfTier(), live: butterfly.fxLive() };
  hud.textContent = `rAF/s ${stats.rafPerSec.toFixed(0)}  frame ${cost.toFixed(2)}ms\ntier ${stats.tier}  particles ${stats.live}`;
  (document.getElementById('tier') as HTMLElement).textContent = String(stats.tier);
  lastT = now;
  lastRaf = rafCount;
  lastCost = costSum;
}, 500);

(window as unknown as { __lab: unknown }).__lab = { butterfly, guide, stats: () => stats };

async function focusBox(el: HTMLElement): Promise<boolean> {
  log.textContent = 'flying...';
  const within = el.closest<HTMLElement>('.scroller') ?? undefined;
  const ok = await guide.focus(el, {
    side: sideSel.value as PerchSide,
    dim: dimBox.checked,
    pulse: pulseBox.checked,
    within,
    minDuration: Number(minDur.value) || undefined,
    underline: underlineBox.checked,
    reveal: underlineBox.checked ? () => new Promise<void>((r) => setTimeout(r, 160)) : undefined,
    onApproach: () => (log.textContent = 'approach (<= 300ms left)'),
  });
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
      case 'fly-long':
      case 'fly-back': {
        const far = btn.dataset.act === 'fly-long';
        void butterfly.flyTo(
          { x: far ? window.innerWidth - 90 : 90, y: far ? window.innerHeight - 140 : 140 },
          { side: 'top', minDuration: Number(minDur.value) || undefined },
        );
        break;
      }
      case 'fly-carry': {
        const p = butterfly.position();
        void butterfly.flyTo({ x: p.x + 60, y: p.y + 55 });
        break;
      }
      case 'fly-light':
      case 'fly-none': {
        const p = butterfly.position();
        void butterfly.flyTo(
          { x: p.x > window.innerWidth / 2 ? 140 : window.innerWidth - 140, y: p.y > window.innerHeight / 2 ? 200 : window.innerHeight - 200 },
          { trail: btn.dataset.act === 'fly-light' ? 'light' : 'none' },
        );
        break;
      }
      case 'nomatch': {
        const r = ring.getBoundingClientRect();
        void butterfly.flyTo({ x: r.left + r.width / 2 + 120, y: r.top + 40 }, { trail: 'light' }).then((ok) => ok && undefined);
        butterfly.tilt();
        break;
      }
      case 'spark':
        butterfly.spark(srcbox);
        break;
      case 'spark-fly': {
        const b = document.querySelector<HTMLElement>('[data-perch="b"]');
        butterfly.spark(srcbox);
        if (b) void focusBox(b);
        break;
      }
      case 'far-spark-fly': {
        // A trigger far from the butterfly: a visible pick-up streak, take-off waits for it (see index.ts).
        const b = document.querySelector<HTMLElement>('[data-perch="b"]');
        butterfly.spark({ x: window.innerWidth - 80, y: window.innerHeight - 60 });
        if (b) void focusBox(b);
        break;
      }
      case 'slide-fly': {
        // The target moves while the butterfly flies: no replan spikes, peak/mean stays <= 1.7.
        const d = document.querySelector<HTMLElement>('[data-perch="d"]');
        if (!d) break;
        d.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(120px)' }], { duration: 500, easing: 'ease-out', fill: 'forwards' });
        void focusBox(d);
        break;
      }
      case 'voice':
        voice = !voice;
        if (voice) butterfly.setMode('voice');
        else butterfly.setMode('idle');
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
levelEl.addEventListener('input', () => butterfly.setVoiceLevel(Number(levelEl.value)));
// Fake voice envelope: syllables ~2.6 Hz with slow modulation and word gaps, attack 50ms / release 180ms.
let env = 0;
let envT = performance.now();
let gapUntil = 0;
setInterval(() => {
  if (!voice || !autoEl.checked) return;
  const now = performance.now();
  const dt = now - envT;
  envT = now;
  const t = now / 1000;
  if (now > gapUntil && Math.random() < 0.012) gapUntil = now + 120 + Math.random() * 140;
  const syl = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.6 * t + 0.8 * Math.sin(2 * Math.PI * 0.7 * t));
  const raw = now < gapUntil ? 0.08 : 0.15 + 0.85 * syl * (0.75 + 0.25 * Math.sin(t * 1.3));
  env += (raw - env) * (1 - Math.exp(-dt / (raw > env ? 50 : 180)));
  levelEl.value = env.toFixed(2);
  butterfly.setVoiceLevel(env);
}, 16);
// Typing in the lab (any key) shows the listening mode quickly.
window.addEventListener('keydown', (e) => {
  if (e.key === 'l') butterfly.setMode('listening');
  if (e.key === 'i') butterfly.setMode('idle');
});
