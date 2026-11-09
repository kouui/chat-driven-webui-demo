# Aurea — a chat-driven dashboard demo

**Hypothesis:** the sidebar-navigation dashboard is outdated in the AI era. It only works if users already know what every button does. Instead, you say what you want, and a golden butterfly guides your eyes to the answer.

Aurea is a small personal-finance dashboard with no sidebar. You type (or "speak") a request, the butterfly flies from where you acted to where the answer will appear, and the page opens at the point where it lands. The aim is to test one idea: the interface should lead the user's attention, not wait for the user to find the right button.

<!-- DEMO VIDEO: drag the demo .mp4 here in the GitHub web editor; GitHub replaces this line with an inline player URL -->

*English UI at the default 0.5× tempo (31 s): 0:00 idle home → 0:02 a capsule opens Cash flow → 0:06 follow-up to Overview → 0:10 typed "how much did I make" flies to Returns → 0:14 Wheel opened from that page, Holdings selected → 0:20 voice demo with ripples, flight to the answer → 0:27 back home.*

## Features

**Intent navigation**
- A command bar understands free text in Chinese, English and Japanese. Any of the three is accepted at any time, whatever the UI language is.
- Three random capsules at the centre suggest things to ask. Clicking one navigates directly.
- A radial wheel (7 sectors) is the manual fallback. It supports mouse, touch, arrow keys, Enter and Esc.
- A tutorial drawer has clickable steps. A step click flies the butterfly to the real UI it teaches.
- The microphone is a placeholder demo: a fake waveform, then a sample command is typed and submitted. No audio is captured.
- Seven mock pages: Overview, Cash flow, Holdings, Returns, Risk check, Auto-invest, Trades. Queries can also land on a specific figure inside a page.

**The butterfly as a guide**
- Pick-up streak: a thin stardust line connects the control you touched to the butterfly before it takes off.
- Trajectory: a slow, followable flight with a stardust and silk trail.
- Landing pads: small gold rings mark where the butterfly sits and where it is going (page anchors, wheel rim, tutorial title, home ring).
- The page opens from the landing point (a circular clip-path reveal), then the content fades in.
- The answer gets a gold underline and one pulse.
- Idle behaviour: small hovers, flutters and glances at rest. After 8 seconds without input at home, it hints toward the input.
- Voice ripples: in the voice demo the wings vibrate and rings spread outward.

**Other**
- The language switcher (中 / EN / 日 — Chinese, English, Japanese) changes every UI string at runtime without replaying animations. The choice is stored in `localStorage` (`aurea.lang`).
- Accessibility: focus moves into the wheel and the tutorial, Tab is trapped there, and focus returns to the trigger on close. Everything works from the keyboard (Esc closes, Enter is ignored during IME composition). Content the butterfly has not revealed yet is `inert`. Reduced motion is respected (see below).

## Quick start

Requires Node **24.22.2+** (`>=24.22.2 <25 || >=26.12.1`, enforced via `engines` + `engine-strict`; these include the October 2026 Node.js security fixes for the eMudhra CA compromise and the Brotli RCE CVE-2026-111497). With nvm: `nvm install && nvm use` (reads `.nvmrc`).

```bash
npm install
npm run dev        # then open http://localhost:5173
```

| Script              | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Vite dev server                                |
| `npm run build`     | Type-check, then production build to `dist/`   |
| `npm run preview`   | Serve the production build                     |
| `npm run typecheck` | `tsc --noEmit`                                 |
| `npm test`          | Vitest unit tests and the held-out intent eval |

**Butterfly lab:** with the dev server running, open <http://localhost:5173/butterfly-lab.html>. It is a standalone page for tuning the butterfly (flights, perching, effects) without the app.

## Motion settings

- **Toggle:** a motion toggle in the top bar switches between full and simplified animation.
- **URL:** `?motion=full` or `?motion=reduced` overrides everything for that visit.
- **Order of precedence:** URL, then `localStorage` key `aurea.motion` (`full` or `reduced`), then the OS setting.
- **OS "reduce motion"** (for example Windows "Animation effects" turned off) is respected by default. You then get simplified cross-fades and no flight. A one-time notice explains this and offers a button to turn on full motion (remembered under `aurea.motion.noticed`).
- **Speed:** `?speed=0.25..2` sets a global tempo. The default is `0.5`, which makes every choreography time twice as long as the design speed. The value from the URL is remembered in `localStorage` key `aurea.speed`. Out-of-range values are ignored. Reduced motion is not slowed.

Other keys: `aurea.lang` (language), and `aurea.tutorial` in `sessionStorage` (tutorial progress).

## How intent matching works

The matcher is in `src/intent/` and has no dependencies. It is a layered, explainable score, not a model.

1. **Normalisation:** case, width and kana folding, punctuation and filler removal.
2. **Phrase and synonym table:** exact and containment matches against example phrases per destination and per anchor (`src/data/destinations.ts`).
3. **Keyword hits:** `Intl.Segmenter` word boundaries for Chinese and Japanese, stemmed words for English. High-weight and medium-weight keywords are combined with noisy-or.
4. **Fallback:** character-bigram Dice similarity against short phrases, capped so it can never navigate on its own.
5. **Negation handling:** negated clauses ("not the risk page, show returns") are cut out and make the thresholds stricter.
6. **Decision:** `confident` (score ≥ 0.6 and a lead of ≥ 0.15 over the runner-up) navigates directly. `ambiguous` shows the top candidates as capsules. `none` shows suggestions and pulses the Wheel button.

**Held-out evaluation:** the set in `tests/fixtures/heldout.json` has 180 items (144 target queries, 24 no-match, 12 ambiguous, spread over zh/en/ja). It was written independently of the matcher. `npm test` prints the table (`tests/heldout.eval.test.ts`).

| Metric                            | Result            |
| --------------------------------- | ----------------- |
| Auto-jump correct (target items)  | 80.6%             |
| Correct page within top 3         | 96.5%             |
| Wrong auto-jumps                  | 2 of 180          |
| False jumps on none / ambiguous   | 0                 |

## Architecture

```
src/
  main.ts          entry: mounts the app
  types.ts         shared contract (Destination, Matcher, Butterfly, Guide, PerchOpts, ...)
  butterfly/       SVG butterfly, flight physics, canvas effects, idle state machine, perching,
                   Guide (one focal point at a time), standalone lab page
  intent/          matcher, normalisation, segmentation, bigram fallback, negation, stopwords
  app/             app shell: state, router (#/<id>?a=<anchor>), navigate(), choreography,
                   motion preference and tempo, chat bar, wheel, tutorial, voice demo,
                   landing pads, page card, starfield, hesitation hint
  pages/           the 7 mock pages and shared widgets
  data/            destinations, phrases and keywords (data/destinations.ts); mock finance data
  i18n/            zh / en / ja dictionary and runtime language switching
  styles/          design tokens and per-component CSS
tests/             held-out intent evaluation and its fixture
```

`navigate()` is the single entry point for every route (text, capsule, wheel, tutorial, follow-ups, back button).

**The butterfly leads, the UI follows.** Each action runs one sequence, driven by the flight's own callbacks rather than guessed timeouts:

1. **Spark:** the touched control brightens within about 80 ms and sends a stardust stream (or a pick-up streak, when the source is far away) into the butterfly.
2. **Flight:** the butterfly takes off, fast in and slow out, leaving its trail.
3. **`onApproach`:** shortly before landing, the page shell opens from the landing point. Outgoing UI (home, wheel) fades out at this moment.
4. **Landing:** the content fades in and the butterfly calms down.
5. **Underline and pulse:** the silk resolves into a gold underline under the answer and pulses once. Follow-up capsules appear last.

The latest action wins: a newer action cancels older flights, reveals and pulses, and their callbacks never fire later. Input stays live throughout.

## Tech

Vite + TypeScript (strict), vanilla DOM and Canvas 2D, no UI framework and no runtime dependencies (dev dependencies only: Vite, TypeScript, Vitest, jsdom). Tests run with Vitest.

## Status and limitations

- This is a hypothesis demo, not a product. All finance data is fictional, fixed mock data (`src/data/mock.ts`, with the "today" date pinned to 2026-11-09).
- Voice input is a placeholder with a fake waveform and a canned sample command.
- The matcher is tuned for this one domain with seven pages. It is not a general NLU, and it can still pick wrongly on long or unusual phrasing (2 wrong jumps in the 180-item eval).
- The eval set is small. The numbers show the approach works here, not that it generalises.
- Motion is tuned by eye. On slow devices the effects layer automatically lowers its resolution and particle count.

## License

No license yet.
