// Layered, explainable intent matcher (zero dependencies).
//
// Signals per target (destination / system intent), all computed from a normalised query:
//   P  phrase   exact equality (1.0), content-equality (0.92), phrase-in-query / query-in-phrase containment
//   K  keyword  high (0.70) / med (0.30) hits; CJK by substring (aligned to Intl.Segmenter boundaries),
//               English on stemmed word boundaries; overlapping hits are counted once; noisy-or combined
//   B  bigram   character-bigram Dice vs SHORT phrases only, weight 0.5, capped at 0.38 (never navigates alone)
//   score = 1 - (1-P)(1-K)(1-B)
// Decision: see THRESHOLDS below.
import type {
  AnchorIntent,
  Destination,
  L10n,
  Lang,
  MatchCandidate,
  MatchResult,
  Matcher,
  SystemIntent,
  TargetId,
} from '../types';
import { LANGS } from '../types';
import { bigrams, dice } from './bigram';
import { foldKana, hasCjk, normalize, normalizeClauses, questionEnds } from './normalize';
import { cut, findNegations } from './negation';
import { segment } from './segment';
import { EN_STOP, stem, stripCjkStop } from './stopwords';

export const THRESHOLDS = {
  /** minimum score of the best target to navigate directly */
  conf: 0.6,
  /** minimum lead over the second-best target (destination or system) to navigate directly */
  margin: 0.15,
  /** minimum score of the best target to offer candidates at all */
  low: 0.25,
  /** minimum score for an extra candidate */
  cand: 0.18,
  /** minimum anchor score to perch on an anchor instead of the page title */
  anchor: 0.5,
  /** the best anchor must lead the runner-up by this much (unless very confident) */
  anchorGap: 0.08,
  /** in a conjunction request, a runner-up with strong evidence and at least this score blocks a confident jump */
  dual: 0.55,
  /** extra strictness when part of the query was negated */
  negExtra: 0.05,
} as const;

// high keyword weight grows slightly with length (longer = more specific); single char 0.62
const highWeight = (len: number): number => (len <= 1 ? 0.62 : Math.min(0.8, 0.62 + 0.04 * len));
const W_MED = 0.3;
const W_MED_1 = 0.2;
const W_ANCHOR = 0.55; // anchor keyword, when ranking anchors inside a chosen page
const W_ANCHOR_DEST = 0.3; // the same keyword, when ranking destinations
const UNALIGNED = 0.93;
const BIGRAM_W = 0.5;
const BIGRAM_CAP = 0.38;
/** other targets' score ceiling when the query exactly equals one target's phrase */
const EXACT_CAP = 0.75;

interface Tgt {
  id: TargetId;
  dest?: Destination;
  sys?: SystemIntent;
  label: L10n;
  anchors: AnchorIntent[];
}

interface PEnt {
  src: string;
  t: number;
  a: number; // anchor index or -1
  cjk: boolean;
  c: string; // compact (cjk)
  cc: string; // compact content (cjk)
  sp: string; // padded stemmed tokens (latin)
  scp: string; // padded stemmed content tokens (latin)
  lenR: number;
  lenC: number;
  bg: Set<string> | null;
  /** stripped content keeps enough of the phrase to be meaningful evidence */
  contentOk: boolean;
  /** number of content (non-stop) latin tokens */
  nTok: number;
}

interface KEnt {
  text: string;
  t: number;
  a: number;
  cjk: boolean;
  wD: number;
  wA: number;
  high: boolean;
  /** destination-level keyword that is also an anchor keyword of the same target (names an answer, not the page) */
  shared: boolean;
}

interface Prep {
  c: string;
  cc: string;
  s: string;
  sc: string;
  rawLen: number;
  contentLen: number;
  latContentLen: number;
  bg: Set<string>;
  bnd: Set<number> | null;
}

interface Eval {
  p: number[];
  pSrc: string[];
  b: number[];
  bSrc: string[];
  k: number[];
  kSrc: string[][];
  high: boolean[];
  score: number[];
  /** score from destination-own evidence only (page title / phrases / keywords not shared with an anchor) */
  own: number[];
  /** the query equals (normalised) a phrase / capsule of this target */
  exact: boolean[];
  aScore: number[][];
  aReason: string[][];
}

// `short` = fewer than 3 CJK chars / 5 latin chars: such a phrase is hardly specific evidence.
const phraseInQuery = (plen: number, qlen: number, short: boolean): number =>
  Math.min(0.95, 0.5 + 0.45 * Math.min(1, plen / qlen) - (short ? 0.12 : 0));
const queryInPhrase = (qlen: number, plen: number): number =>
  Math.min(0.58, 0.2 + 0.5 * Math.min(1, qlen / plen) - (qlen < 3 ? 0.1 : 0));

/** list / conjunction markers: "X and Y", "X和Y", "XとY", "X, Y" */
const CONJ_RE = /和|与|跟|及|并|还有|而且|同时|或|还是|と|や|および|また|\||\b(?:and|plus|also|with|or|vs|versus)\b/;

/**
 * The navigation VERB "return" ("return home", "return to the start", "return back") is not the
 * financial noun "returns": rewrite it to "go" before stemming can conflate the two.
 */
const NAV_RETURN = /\breturn(?:ing)?\s+(?=(?:me\s+)?(?:back\b|home\b|to\s+(?:the\s+)?(?:home|main|start|beginning|landing|front|top)\b))/g;

const TOKEN_RE = /[a-z0-9]+|[^a-z0-9 |]+|\|/g;

function latinKey(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter(Boolean)
    .map(stem);
}

function prepare(u: string, hint: Lang): Prep {
  const f = foldKana(u);
  const cmap = new Int32Array(u.length + 1);
  let n = 0;
  for (let i = 0; i < u.length; i++) {
    cmap[i] = n;
    if (u[i] !== ' ' && u[i] !== '|') n++;
  }
  cmap[u.length] = n;
  const c = f.replace(/[ |]/g, '');

  let bnd: Set<number> | null = null;
  const segs = segment(u, hint);
  if (segs.length) {
    bnd = new Set<number>();
    for (const sg of segs) {
      bnd.add(cmap[sg.index]!);
      bnd.add(cmap[Math.min(u.length, sg.index + sg.segment.length)]!);
    }
  }

  let cc = '';
  const lat: string[] = [];
  const latC: string[] = [];
  let latContentLen = 0;
  for (const tok of f.match(TOKEN_RE) ?? []) {
    if (tok === '|' || !/^[a-z0-9]/.test(tok)) {
      if (tok !== '|') cc += stripCjkStop(tok);
      lat.push('|');
      if (latC.length && latC[latC.length - 1] !== '|') latC.push('|');
      continue;
    }
    const st = stem(tok);
    lat.push(st);
    if (!EN_STOP.has(tok)) {
      latC.push(st);
      latContentLen += tok.length;
    }
  }
  while (latC.length && latC[latC.length - 1] === '|') latC.pop();
  const bgStr = cc + latC.filter((x) => x !== '|').join('');
  return {
    c,
    cc,
    s: ` ${lat.join(' ')} `,
    sc: ` ${latC.join(' ')} `,
    rawLen: c.length,
    contentLen: cc.length + latContentLen,
    latContentLen,
    bg: bgStr.length >= 3 ? bigrams(bgStr) : new Set(),
    bnd,
  };
}

/** The phrase is (equal to / contained in) the query: strong, targeted evidence. */
function phraseFull(q: Prep, e: PEnt): number {
  if (e.cjk) {
    if (q.c === e.c) return 1;
    let best = 0;
    if (e.lenR >= 3 && q.rawLen > e.lenR && q.c.includes(e.c)) best = phraseInQuery(e.lenR, q.rawLen, false);
    if (e.contentOk && e.lenC >= 2 && q.cc.length >= 2) {
      if (q.cc === e.cc) best = Math.max(best, 0.92);
      else if (e.lenC >= 3 && q.cc.length > e.lenC && q.cc.includes(e.cc)) best = Math.max(best, phraseInQuery(e.lenC, q.contentLen, false));
    }
    return best;
  }
  if (q.s === e.sp) return 1;
  let best = 0;
  if (e.lenR >= 5 && q.s.length > e.sp.length && q.s.includes(e.sp)) best = phraseInQuery(e.lenR, q.s.length - 2, false);
  if (e.contentOk && e.lenC >= 3 && q.latContentLen >= 3) {
    if (q.sc === e.scp) best = Math.max(best, 0.92);
    else if (e.nTok >= 2 && e.lenC >= 6 && q.sc.length > e.scp.length && q.sc.includes(e.scp)) best = Math.max(best, phraseInQuery(e.lenC, q.contentLen, false));
  }
  return best;
}

/** The query is a fragment of the phrase: weak evidence (never strong on its own). */
function phrasePart(q: Prep, e: PEnt): number {
  let best = 0;
  if (e.cjk) {
    if (q.cc.length >= 2 && e.contentOk && e.lenC > q.cc.length && e.cc.includes(q.cc)) best = queryInPhrase(q.cc.length, e.lenC);
    if (q.rawLen >= 2 && e.lenR > q.rawLen && e.c.includes(q.c)) best = Math.max(best, queryInPhrase(q.rawLen, e.lenR));
  } else if (e.contentOk && q.latContentLen >= 6 && e.scp.length > q.sc.length && e.scp.includes(q.sc)) {
    best = queryInPhrase(q.latContentLen, e.lenC);
  }
  return best;
}

export function createMatcher(dests: Destination[], sys: SystemIntent[]): Matcher {
  // ---- build targets and indexes -------------------------------------------------------------
  const tgts: Tgt[] = [
    ...dests.map((d): Tgt => ({ id: d.id, dest: d, label: d.title, anchors: d.anchorIntents })),
    ...sys.map((s): Tgt => ({ id: s.id, sys: s, label: s.label, anchors: [] })),
  ];
  const pEnts: PEnt[] = [];
  const kEnts: KEnt[] = [];
  const kSeen = new Map<string, KEnt>();

  const addPhrase = (raw: string, t: number, a: number): void => {
    const n = normalize(raw);
    if (!n) return;
    if (hasCjk(n)) {
      const c = n.replace(/ /g, '');
      const cc = stripCjkStop(c);
      pEnts.push({
        src: raw, t, a, cjk: true, c, cc, sp: '', scp: '', lenR: c.length, lenC: cc.length,
        bg: cc.length >= 3 && cc.length <= 10 ? bigrams(cc) : null,
        contentOk: cc.length >= 0.3 * c.length,
        nTok: 0,
      });
    } else {
      const raws = n.split(' ');
      const st = raws.map(stem);
      const sc = raws.map((w, i) => (EN_STOP.has(w) ? '' : st[i]!)).filter(Boolean);
      const scj = raws.filter((w) => !EN_STOP.has(w)).join(''); // original (unstemmed) letters
      pEnts.push({
        src: raw, t, a, cjk: false, c: '', cc: '', sp: ` ${st.join(' ')} `, scp: ` ${sc.join(' ')} `,
        lenR: n.replace(/ /g, '').length, lenC: scj.length,
        bg: scj.length >= 3 && scj.length <= 14 ? bigrams(scj) : null,
        contentOk: scj.length >= 0.3 * n.replace(/ /g, '').length,
        nTok: sc.length,
      });
    }
  };

  const addKw = (raw: string, t: number, a: number, wD: number, wA: number, high: boolean): void => {
    const n = normalize(raw);
    if (!n) return;
    const cjk = hasCjk(n);
    const text = cjk ? n.replace(/ /g, '') : latinKey(raw).join(' ');
    if (!text) return;
    const key = `${t}|${a}|${text}`;
    const old = kSeen.get(key);
    if (old) {
      old.wD = Math.max(old.wD, wD);
      old.wA = Math.max(old.wA, wA);
      old.high = old.high || high;
      return;
    }
    const e: KEnt = { text, t, a, cjk, wD, wA, high, shared: false };
    kSeen.set(key, e);
    kEnts.push(e);
  };

  const highW = (s: string): number => highWeight(hasCjk(s) ? normalize(s).replace(/ /g, '').length : 2);
  const medW = (s: string): number => (hasCjk(s) && normalize(s).length === 1 ? W_MED_1 : W_MED);

  tgts.forEach((tg, t) => {
    for (const lang of LANGS) {
      tg.label[lang] && addPhrase(tg.label[lang], t, -1);
      if (tg.dest) {
        const d = tg.dest;
        d.phrases[lang].forEach((p) => addPhrase(p, t, -1));
        d.keywords[lang].high.forEach((k) => addKw(k, t, -1, highW(k), highW(k), true));
        d.keywords[lang].med.forEach((k) => addKw(k, t, -1, medW(k), medW(k), false));
        d.anchorIntents.forEach((ai, a) => {
          addPhrase(ai.label[lang], t, a);
          ai.phrases[lang].forEach((p) => addPhrase(p, t, a));
          (ai.keywords?.[lang] ?? []).forEach((k) => addKw(k, t, a, W_ANCHOR_DEST, W_ANCHOR, false));
        });
      } else if (tg.sys) {
        tg.sys.phrases[lang].forEach((p) => addPhrase(p, t, -1));
        tg.sys.keywords[lang].forEach((k) => addKw(k, t, -1, highW(k), highW(k), true));
      }
    }
    // capsule texts are known-good sample queries for their own target
    tg.dest?.capsules.forEach((cp) => {
      if (cp.target.id !== tg.id) return;
      const a = cp.target.anchor ? tg.anchors.findIndex((x) => x.anchor === cp.target.anchor) : -1;
      for (const lang of LANGS) addPhrase(cp.text[lang], t, a);
    });
  });

  const nT = tgts.length;
  const pByT: number[][] = tgts.map(() => []);
  const pByTA: number[][][] = tgts.map((tg) => tg.anchors.map(() => []));
  pEnts.forEach((e, i) => {
    pByT[e.t]!.push(i);
    if (e.a >= 0) pByTA[e.t]![e.a]!.push(i);
  });
  const anchorKw = new Set(kEnts.filter((e) => e.a >= 0).map((e) => `${e.t}|${e.text}`));
  for (const e of kEnts) if (e.a < 0 && anchorKw.has(`${e.t}|${e.text}`)) e.shared = true;
  const pOwnByT: number[][] = tgts.map((_, t) => pByT[t]!.filter((i) => pEnts[i]!.a < 0));
  const kByT: number[][] = tgts.map(() => []);
  const kOwnByT: number[][] = tgts.map(() => []);
  const kByTA: number[][][] = tgts.map((tg) => tg.anchors.map(() => []));
  kEnts.forEach((e, i) => {
    kByT[e.t]!.push(i);
    if (e.a < 0 && !e.shared) kOwnByT[e.t]!.push(i);
    if (e.a >= 0) kByTA[e.t]![e.a]!.push(i);
  });

  // ---- evaluation ----------------------------------------------------------------------------
  interface Hit { s: number; e: number; w: number; high: boolean; text: string }

  function noisyOr(hits: Hit[]): { k: number; high: boolean; texts: string[] } {
    hits.sort((x, y) => y.w - x.w || y.e - y.s - (x.e - x.s));
    const taken: Hit[] = [];
    let miss = 1;
    let high = false;
    for (const h of hits) {
      if (taken.some((o) => h.s < o.e && o.s < h.e)) continue;
      taken.push(h);
      miss *= 1 - h.w;
      high ||= h.high;
    }
    return { k: 1 - miss, high, texts: taken.map((h) => `${h.text}${h.high ? '*' : ''}`) };
  }

  function evaluate(q: Prep): Eval {
    // per-entry signals
    const pS = new Float64Array(pEnts.length); // dest-level: full or partial
    const pF = new Float64Array(pEnts.length); // anchor-level: full only
    const bS = new Float64Array(pEnts.length);
    for (let i = 0; i < pEnts.length; i++) {
      const e = pEnts[i]!;
      pF[i] = phraseFull(q, e);
      pS[i] = Math.max(pF[i]!, phrasePart(q, e));
      if (e.bg && q.bg.size) {
        const d = dice(q.bg, e.bg);
        if (d >= (e.cjk ? 0.4 : 0.55) && (e.cjk || e.lenC >= 5)) bS[i] = Math.min(BIGRAM_CAP, BIGRAM_W * d);
      }
    }
    const kPos: number[] = [];
    const kAl: number[] = [];
    for (let i = 0; i < kEnts.length; i++) {
      const e = kEnts[i]!;
      let pos: number;
      let al = 1;
      if (e.cjk) {
        pos = q.c.indexOf(e.text);
        if (pos >= 0 && q.bnd && !(q.bnd.has(pos) && q.bnd.has(pos + e.text.length))) al = UNALIGNED;
      } else {
        pos = q.s.indexOf(` ${e.text} `);
        if (pos >= 0) pos += 1_000_000;
      }
      kPos.push(pos);
      kAl.push(al);
    }
    const kHits = (ids: number[], anchorLevel: boolean): Hit[] => {
      const hits: Hit[] = [];
      for (const i of ids) {
        const pos = kPos[i]!;
        if (pos < 0) continue;
        const e = kEnts[i]!;
        const w = (anchorLevel ? e.wA : e.wD) * kAl[i]!;
        hits.push({ s: pos, e: pos + e.text.length, w, high: !anchorLevel && e.high, text: e.text });
      }
      return hits;
    };
    const best = (ids: number[], arr: Float64Array): { v: number; src: string } => {
      let v = 0;
      let src = '';
      for (const i of ids) if (arr[i]! > v) { v = arr[i]!; src = pEnts[i]!.src; }
      return { v, src };
    };

    const ev: Eval = {
      p: [], pSrc: [], b: [], bSrc: [], k: [], kSrc: [], high: [], score: [], own: [], exact: [], aScore: [], aReason: [],
    };
    for (let t = 0; t < nT; t++) {
      const p = best(pByT[t]!, pS);
      const b = best(pByT[t]!, bS);
      const kk = noisyOr(kHits(kByT[t]!, false));
      ev.p.push(p.v); ev.pSrc.push(p.src);
      ev.b.push(b.v); ev.bSrc.push(b.src);
      ev.k.push(kk.k); ev.kSrc.push(kk.texts); ev.high.push(kk.high);
      ev.score.push(1 - (1 - p.v) * (1 - kk.k) * (1 - (p.v >= 0.5 ? 0 : b.v)));
      const po = best(pOwnByT[t]!, pS);
      const bo = best(pOwnByT[t]!, bS);
      // own keyword hits that overlap an answer-level hit ("total" in "total assets") are not page evidence
      const ansHits = kHits(kByT[t]!.filter((i) => kEnts[i]!.a >= 0 || kEnts[i]!.shared), false);
      const ko = noisyOr(kHits(kOwnByT[t]!, false).filter((h) => !ansHits.some((o) => h.s < o.e && o.s < h.e)));
      ev.own.push(1 - (1 - po.v) * (1 - ko.k) * (1 - (po.v >= 0.5 ? 0 : bo.v)));
      ev.exact.push(pByT[t]!.some((i) => pF[i] === 1));
      const as: number[] = [];
      const ar: string[] = [];
      tgts[t]!.anchors.forEach((ai, a) => {
        // anchors: full phrase hits + keywords only (fragments / bigrams are too weak to pick a sub-element)
        const ap = best(pByTA[t]![a]!, pF);
        const ak = noisyOr(kHits(kByTA[t]![a]!, true));
        as.push(1 - (1 - ap.v) * (1 - ak.k));
        ar.push(
          [
            ap.v > 0 && `phrase:${ap.src}(${ap.v.toFixed(2)})`,
            ak.k > 0 && `kw:${ak.texts.join(',')}`,
          ]
            .filter(Boolean)
            .join('+') || ai.anchor,
        );
      });
      ev.aScore.push(as);
      ev.aReason.push(ar);
    }
    return ev;
  }

  // ---- result construction -------------------------------------------------------------------
  function resolveAnchor(ev: Eval, t: number): { anchor: string; score: number; reason: string } {
    const as = ev.aScore[t]!;
    let bi = -1;
    let bv = 0;
    let sv = 0;
    as.forEach((v, i) => {
      if (v > bv) { sv = bv; bv = v; bi = i; } else if (v > sv) sv = v;
    });
    if (bi >= 0 && bv >= THRESHOLDS.anchor && (bv - sv >= THRESHOLDS.anchorGap || bv >= 0.85)) {
      return { anchor: tgts[t]!.anchors[bi]!.anchor, score: bv, reason: `anchor ${ev.aReason[t]![bi]}` };
    }
    return { anchor: 'title', score: 0, reason: '' };
  }

  function candidate(ev: Eval, t: number, scoreOverride?: number): MatchCandidate {
    const tg = tgts[t]!;
    const score = scoreOverride ?? ev.score[t]!;
    const parts = [
      ev.p[t]! > 0 && `phrase:${ev.pSrc[t]}(${ev.p[t]!.toFixed(2)})`,
      ev.k[t]! > 0 && `kw:${ev.kSrc[t]!.join(',')}`,
      ev.b[t]! > 0 && `bigram:${ev.bSrc[t]}(${ev.b[t]!.toFixed(2)})`,
    ].filter(Boolean) as string[];
    if (!tg.dest) {
      return { target: { id: tg.id }, score: round(score), label: tg.label, reason: parts.join('+') || 'weak' };
    }
    const a = resolveAnchor(ev, t);
    if (a.reason) parts.push(a.reason);
    return {
      target: { id: tg.id, anchor: a.anchor },
      score: round(score),
      label: tg.label,
      reason: parts.join('+') || 'followup',
    };
  }

  const round = (x: number): number => Math.round(x * 1000) / 1000;
  const none = (candidates: MatchCandidate[] = []): MatchResult => ({ status: 'none', candidates });

  function match(input: string, uiLang: Lang): MatchResult {
    const base = normalizeClauses(input ?? '');
    const u0 = base.replace(NAV_RETURN, 'go ');
    if (!u0) return none();

    // negation: drop the negated span's evidence, and never suggest what was negated
    const f0 = foldKana(u0);
    const ranges = findNegations(f0, u0.length === base.length ? questionEnds(input ?? '') : undefined);
    let u = u0;
    let excluded: boolean[] | null = null;
    let negAnchors: Set<number>[] | null = null;
    let negated = false;
    if (ranges.length) {
      negated = true;
      const kept = cut(u0, ranges);
      u = kept.kept;
      const removed = cut(f0, ranges).removed;
      const rq = prepare(removed.replace(/^\|+|\|+$/g, ''), uiLang);
      if (rq.contentLen > 0) {
        const rev = evaluate(rq);
        // The page is excluded only when the negated span names the page itself. Naming one of its
        // answers ("not total assets") only blocks that anchor: another anchor may still be requested.
        negAnchors = rev.score.map(() => new Set<number>());
        excluded = rev.score.map((s, t) => {
          if (s < 0.4) return false;
          // A span that carries a specific answer cue ("returns" + "trend") names that answer, even
          // though it also contains the page's own vocabulary: block the anchor only.
          rev.aScore[t]!.forEach((v, a) => { if (v >= 0.4) negAnchors![t]!.add(a); });
          return negAnchors![t]!.size === 0;
        });
      }
    }
    const q = prepare(u, uiLang);
    if (q.contentLen === 0) return none();
    const ev = evaluate(q);
    if (excluded) excluded.forEach((x, t) => { if (x) ev.score[t] = 0; });
    negAnchors?.forEach((set, t) => set.forEach((a) => { ev.aScore[t]![a] = 0; }));

    // an exact (normalised) phrase / capsule of exactly one target beats containment-only evidence
    const exactT = ev.exact.flatMap((x, t) => (x ? [t] : []));
    const exactWins = !negated && exactT.length === 1;
    if (exactWins) ev.score.forEach((_, t) => { if (t !== exactT[0]) ev.score[t] = Math.min(ev.score[t]!, EXACT_CAP); });

    const rank = ev.score.map((_, t) => t).sort((a, b) => ev.score[b]! - ev.score[a]! || a - b);
    const top = rank[0]!;
    const topScore = ev.score[top]!;
    if (topScore < 0.1) return none();
    const second = rank[1]!;
    const margin = topScore - ev.score[second]!;
    const strong = ev.p[top]! >= 0.6 || ev.high[top]!;
    const extra = negated ? THRESHOLDS.negExtra : 0;

    const others = rank.slice(1).filter((t) => ev.score[t]! >= THRESHOLDS.cand);

    // two independent strong pages in one request ("returns and holdings") -> let the user choose
    const dual =
      !exactWins && CONJ_RE.test(foldKana(u)) && ev.score[second]! >= THRESHOLDS.dual && (ev.p[second]! >= 0.6 || ev.high[second]!);

    if (strong && !dual && topScore >= THRESHOLDS.conf + extra && margin >= THRESHOLDS.margin + extra) {
      const best = candidate(ev, top);
      return {
        status: 'confident',
        best,
        candidates: [best, ...others.slice(0, 2).map((t) => candidate(ev, t))],
      };
    }
    if (topScore >= THRESHOLDS.low) {
      const picked = [top, ...others].slice(0, 3).map((t) => candidate(ev, t));
      if (picked.length < 2) {
        // pad with the pages most naturally adjacent to the only plausible one
        for (const fu of tgts[top]!.dest?.followUps ?? []) {
          if (picked.length >= 2) break;
          const ti = tgts.findIndex((x) => x.id === fu.target.id);
          if (ti >= 0 && !excluded?.[ti] && !picked.some((c) => c.target.id === fu.target.id)) {
            picked.push(candidate(ev, ti, 0.1));
          }
        }
      }
      if (picked.length >= 2) return { status: 'ambiguous', candidates: picked };
      return none(picked);
    }
    return none(rank.filter((t) => ev.score[t]! >= 0.12).slice(0, 3).map((t) => candidate(ev, t)));
  }

  return { match };
}
