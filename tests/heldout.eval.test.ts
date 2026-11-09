import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createMatcher } from '../src/intent/index';
import { destinations, systemIntents } from '../src/data/destinations';
import type { Lang, MatchResult, TargetId } from '../src/types';

type Expect = TargetId | 'none' | 'ambiguous';
interface HeldoutItem {
  text: string;
  lang: Lang;
  expect: Expect;
  anchor?: string;
}
interface HeldoutFile {
  version: number;
  items: HeldoutItem[];
}

const fixturePath = fileURLToPath(new URL('./fixtures/heldout.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as HeldoutFile;

interface Row {
  item: HeldoutItem;
  result: MatchResult;
  status: MatchResult['status'];
  bestId?: TargetId;
  bestAnchor?: string;
  top3Ids: TargetId[];
  isTarget: boolean;
  autoJump: boolean; // confident && best id == expect (target items)
  wrongJump: boolean; // confident && best id != expect (target items)
  falseJump: boolean; // confident (none / ambiguous items)
  top3Hit: boolean;
  anchorItem: boolean; // has anchor and correct jump
  anchorHit: boolean;
}

interface Agg {
  label: string;
  targetN: number;
  autoJumpOk: number;
  wrongJumps: number;
  top3Hit: number;
  anchorN: number;
  anchorOk: number;
  noneN: number;
  noneFalseJumps: number;
  noneStatusNone: number;
  ambN: number;
  ambFalseJumps: number;
  total: number;
}

const matcher = createMatcher(destinations, systemIntents);

function runItem(item: HeldoutItem): Row {
  const result = matcher.match(item.text, item.lang);
  const isTarget = item.expect !== 'none' && item.expect !== 'ambiguous';
  const confident = result.status === 'confident';
  const bestId = result.status === 'confident' ? result.best.target.id : undefined;
  const bestAnchor = result.status === 'confident' ? result.best.target.anchor : undefined;
  const top3Ids: TargetId[] = [];
  if (result.status === 'confident') top3Ids.push(result.best.target.id);
  for (const c of result.candidates.slice(0, 3)) top3Ids.push(c.target.id);

  const autoJump = isTarget && confident && bestId === item.expect;
  const wrongJump = isTarget && confident && bestId !== item.expect;
  const falseJump = !isTarget && confident;
  return {
    item,
    result,
    status: result.status,
    bestId,
    bestAnchor,
    top3Ids,
    isTarget,
    autoJump,
    wrongJump,
    falseJump,
    top3Hit: isTarget && top3Ids.includes(item.expect as TargetId),
    anchorItem: autoJump && item.anchor !== undefined,
    anchorHit: autoJump && item.anchor !== undefined && bestAnchor === item.anchor,
  };
}

function aggregate(label: string, rows: Row[]): Agg {
  const a: Agg = {
    label,
    targetN: 0,
    autoJumpOk: 0,
    wrongJumps: 0,
    top3Hit: 0,
    anchorN: 0,
    anchorOk: 0,
    noneN: 0,
    noneFalseJumps: 0,
    noneStatusNone: 0,
    ambN: 0,
    ambFalseJumps: 0,
    total: rows.length,
  };
  for (const r of rows) {
    if (r.isTarget) {
      a.targetN++;
      if (r.autoJump) a.autoJumpOk++;
      if (r.wrongJump) a.wrongJumps++;
      if (r.top3Hit) a.top3Hit++;
      if (r.anchorItem) {
        a.anchorN++;
        if (r.anchorHit) a.anchorOk++;
      }
    } else if (r.item.expect === 'none') {
      a.noneN++;
      if (r.falseJump) a.noneFalseJumps++;
      if (r.status === 'none') a.noneStatusNone++;
    } else {
      a.ambN++;
      if (r.falseJump) a.ambFalseJumps++;
    }
  }
  return a;
}

const pct = (num: number, den: number): string =>
  den === 0 ? 'n/a' : `${((num / den) * 100).toFixed(1)}%`;

function fmtRow(a: Agg): string {
  return [
    a.label.padEnd(8),
    String(a.targetN).padStart(4),
    pct(a.autoJumpOk, a.targetN).padStart(8),
    String(a.wrongJumps).padStart(6),
    pct(a.top3Hit, a.targetN).padStart(8),
    `${a.anchorOk}/${a.anchorN}`.padStart(8),
    pct(a.anchorOk, a.anchorN).padStart(8),
    String(a.noneN).padStart(4),
    String(a.noneFalseJumps).padStart(6),
    pct(a.noneStatusNone, a.noneN).padStart(8),
    String(a.ambN).padStart(4),
    String(a.ambFalseJumps).padStart(6),
  ].join(' ');
}

const header = [
  'group'.padEnd(8),
  'tgt'.padStart(4),
  'autoOK'.padStart(8),
  'wrong'.padStart(6),
  'top3'.padStart(8),
  'anchorOK'.padStart(8),
  'anchor%'.padStart(8),
  'none'.padStart(4),
  'falseJ'.padStart(6),
  'noneSt%'.padStart(8),
  'amb'.padStart(4),
  'falseJ'.padStart(6),
].join(' ');

function describeGot(r: Row): string {
  if (r.status === 'confident') {
    return `${r.bestId}${r.bestAnchor ? `#${r.bestAnchor}` : ''} (confident)`;
  }
  return `${r.status}`;
}

describe('heldout eval', () => {
  it('reports intent-matcher metrics on held-out fixture', () => {
    const rows = fixture.items.map(runItem);
    const langs: Lang[] = ['zh', 'en', 'ja'];
    const groups: Agg[] = [
      ...langs.map((l) => aggregate(l, rows.filter((r) => r.item.lang === l))),
      aggregate('overall', rows),
    ];

    const lines: string[] = [];
    lines.push('');
    lines.push(`Heldout eval: version=${fixture.version} items=${fixture.items.length}`);
    lines.push(header);
    for (const g of groups) lines.push(fmtRow(g));

    const wrongList = rows.filter((r) => r.wrongJump);
    const falseList = rows.filter((r) => r.falseJump);
    lines.push('');
    lines.push(`WRONG auto-jumps (${wrongList.length}):`);
    for (const r of wrongList) {
      lines.push(`  [${r.item.lang}] ${r.item.text} -> expect=${r.item.expect}, got ${describeGot(r)}`);
    }
    lines.push(`False jumps on none/ambiguous (${falseList.length}):`);
    for (const r of falseList) {
      lines.push(`  [${r.item.lang}] ${r.item.text} (expect=${r.item.expect}) -> ${describeGot(r)}`);
    }
    lines.push('');
    console.log(lines.join('\n'));

    const overall = groups[groups.length - 1];
    const wrongJumpRate =
      (overall.wrongJumps + overall.noneFalseJumps + overall.ambFalseJumps) / overall.total;
    console.log(`wrongJumpRate (overall) = ${wrongJumpRate.toFixed(4)}`);
    expect(wrongJumpRate).toBeLessThan(0.15);
  });
});
