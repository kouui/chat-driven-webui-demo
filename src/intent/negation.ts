// Simple negation detection. Works on folded, clause-marked text (see normalizeClauses).
// Returns the character ranges whose evidence must be ignored (the negated span).

const ZH_PREFIX =
  /(?:不要|不想|不用|不需要|不必|无需|无须|不看|并不是|并非|而不是|(?<![是区分辨识])不是|除了|(?<![区分辨识差告离惜特派性类])别(?![的人处名墅])|(?<![區分辨識差告離惜特派性類])別(?=[看查給给帮幫管顯显再拿讓让带帶去要想用說说]))(?:给我|給我|帮我|幫我|带我|帶我|让我|讓我|再)?(?:看看|查看|看|查|要|想)?/g;
const EN_PREFIX =
  /\b(?:do not|dont|not|no|never|without|except|excluding|instead of|rather than|other than|anything but|skip(?! (?:to|ahead|over to)\b)|ignore|forget about|forget|no need for|no need to|not interested in|not looking for|not looking at|dont care about)\b(?:\s+(?:show|see|view|open|display|check|give|take|want|need|look at|go to)(?:\s+me)?)?/g;
const ZH_SWITCH = /我?(?:想|要|需要)|只(?:要|看)|看|查看|而是|改看|给我|帮我|带我|请|是(?!不)/;
const EN_SWITCH =
  /\b(?:show|see|view|open|display|i want|want|need|give|take|go|check|let|look|tell|but|instead|just|only|rather|find)\b/;
// "X不要" / "Xは見たくない": the negator trails the span
const ZH_SUFFIX = /(?:不要(?:看)?了?|不用(?:看)?了?|用不着(?:看|了)?|不必(?:看)?了?|不看了?|先别看|先不看|先不要|算了)(?=\||$)/g;
const ZH_SUFFIX_CUT = /(?:但是|但|然后|不过|而且|只(?:要|看)?)/g;
// "X can wait" / "X isn't needed": the negator trails the span
const EN_SUFFIX =
  /\b(?:(?:can|could|will|should|may|might|must)\s+wait|(?:is\s+|are\s+)?(?:not|isnt|arent)\s+(?:needed|necessary|important)|(?:no|not)\s+(?:need|necessary)|not\s+now|no\s+thanks)\b(?=\s*(?:\||$)|\s+(?:for now|for a (?:bit|while|moment)|a (?:bit|while|little)|today|tomorrow|right now)\b)/g;
const EN_SUFFIX_CUT = /\b(?:but|while|then|though|however|whereas|so|because|otherwise)\b/g;
const JA_SUFFIX =
  /(?:[をはがも]?(?:見|み)(?:たくない|たくありません|たくなくて|ません|ない|なくていい|なくてもいい|なくていいです)|[をはがも]?(?:要らない|いらない|いりません|要りません|不要)|[はも](?:もう)?(?:いい(?:から|よ|や|って)|いいです(?![かのね])|いい(?=\||$)|結構(?:です)?|けっこう(?:です)?)|じゃなくて|じゃなく|ではなくて|ではなく|でなくて|じゃない|ではない|でなく|以外(?:で|の|は)?)/g;
const JA_CUT = /(?:を|が|は|たい|ください|見せて|みせて|けど|ですが|見たい|みたい)/g;

export type Range = [number, number];

function spanEnd(text: string, from: number, switchRe: RegExp): number {
  let end = text.indexOf('|', from);
  if (end < 0) end = text.length;
  const m = switchRe.exec(text.slice(from, end));
  if (m) end = from + m.index;
  return end;
}

/** Start of a trailing-negator span: the clause start, or just after the last contrast word before it. */
function suffixStart(text: string, at: number, cutRe: RegExp): number {
  const bar = text.lastIndexOf('|', at);
  let start = bar + 1;
  const seg = text.slice(start, at);
  cutRe.lastIndex = 0;
  for (let c = cutRe.exec(seg); c; c = cutRe.exec(seg)) start = bar + 1 + c.index + c[0].length;
  return start;
}

// "Xはいい(です)" closing a clause is a refusal when stated, but a positive question when asked:
// "収益はいいですか" / "リスクはいいの" (followed by a particle, so the clause-end rule never fires) and
// "成績はいい?" (question mark; `questions` holds the clause-end offsets that carried one).
const JA_GOOD_END = /いい(?:です)?$/;

/** `questions`: offsets in `text` where a clause ended with a question mark (see questionEnds). */
export function findNegations(text: string, questions: ReadonlySet<number> = new Set()): Range[] {
  const ranges: Range[] = [];
  for (const [re, sw] of [
    [ZH_PREFIX, ZH_SWITCH],
    [EN_PREFIX, EN_SWITCH],
  ] as const) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const start = m.index;
      const mEnd = start + m[0].length;
      // the switch word may sit right at the marker end (e.g. "dont show returns show holdings")
      const end = spanEnd(text, mEnd, sw);
      ranges.push([start, Math.max(end, mEnd)]);
    }
  }
  ZH_SUFFIX.lastIndex = 0;
  for (let m = ZH_SUFFIX.exec(text); m; m = ZH_SUFFIX.exec(text)) {
    ranges.push([suffixStart(text, m.index, ZH_SUFFIX_CUT), m.index + m[0].length]);
  }
  EN_SUFFIX.lastIndex = 0;
  for (let m = EN_SUFFIX.exec(text); m; m = EN_SUFFIX.exec(text)) {
    ranges.push([suffixStart(text, m.index, EN_SUFFIX_CUT), m.index + m[0].length]);
  }
  JA_SUFFIX.lastIndex = 0;
  for (let m = JA_SUFFIX.exec(text); m; m = JA_SUFFIX.exec(text)) {
    const mEnd = m.index + m[0].length;
    if (questions.has(mEnd) && JA_GOOD_END.test(m[0])) continue;
    const bar = text.lastIndexOf('|', m.index);
    let start = bar + 1;
    const seg = text.slice(start, m.index);
    JA_CUT.lastIndex = 0;
    for (let c = JA_CUT.exec(seg); c; c = JA_CUT.exec(seg)) start = bar + 1 + c.index + c[0].length;
    ranges.push([start, mEnd]);
  }
  return mergeRanges(ranges);
}

function mergeRanges(r: Range[]): Range[] {
  const s = r.filter((x) => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}

/** Replace the ranges with "|" in `text`; also return the removed pieces joined with "|". */
export function cut(text: string, ranges: Range[]): { kept: string; removed: string } {
  let kept = '';
  let removed = '';
  let pos = 0;
  for (const [s, e] of ranges) {
    kept += text.slice(pos, s) + '|';
    removed += text.slice(s, e) + '|';
    pos = e;
  }
  kept += text.slice(pos);
  return { kept, removed };
}
