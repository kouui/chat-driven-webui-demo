// Stop words: generic filler that contributes nothing to intent evidence.
// All entries are in *normalised* form (lowercase, kana folded to hiragana).
import { normalize } from './normalize';

const EN_STOP_LIST = [
  'a', 'an', 'the', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'am',
  'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'you', 'your', 'it', 'its', 'this', 'that', 'these', 'those',
  'do', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'please', 'show', 'see', 'view', 'check', 'give',
  'tell', 'take', 'open', 'go', 'want', 'need', 'like', 'let', 'lets', 'what', 'whats', 'how', 'hows', 'much', 'many',
  'about', 'any', 'some', 'there', 'here', 'get', 'got', 'have', 'has', 'had', 'then', 'just', 'now', 'ok', 'also', 'so',
  'im', 'ive', 'thats', 'its', 'if', 'when', 'where', 'which', 'who', 'know', 'look', 'find',
];

const CJK_STOP_LIST = [
  // zh
  '看看', '看一下', '看下', '看一看', '看', '查看', '查询', '查一下', '查下', '查', '我的', '我们', '我', '你', '的', '了',
  '吗', '呢', '啊', '吧', '呀', '嘛', '哦', '多少', '一下', '帮我', '给我', '帮忙', '请问', '请', '想要', '想', '要',
  '能不能', '可以', '可不可以', '一个', '一些', '这个', '那个', '有没有', '是不是', '是', '什么', '怎么样', '怎么',
  '如何', '咋样', '大概', '都', '就', '在', '和', '与', '跟', '带我', '去', '打开', '显示', '展示', '告诉我', '告诉',
  '知道', '呗', '一共', '总共', '哪些', '哪个', '哪只', '哪几', '到底', '究竟', '大约', '大概',
  // ja (hiragana-folded)
  'を', 'が', 'は', 'に', 'で', 'の', 'と', 'も', 'へ', 'や', 'か', 'ね', 'よ', 'ください', '下さい', 'たい', 'です', 'ます',
  '見たい', 'みたい', '見せて', 'みせて', '見る', 'みる', '見て', '教えて', 'おしえて', '確認', '表示', 'ちょっと',
  '私', 'わたし', '自分', 'どのくらい', 'どれくらい', 'どれだけ', 'いくら', 'どう', 'どんな', '何', 'ちぇっく',
  'ほしい', 'したい', '知りたい', 'しりたい',
].map((w) => normalize(w));

export const EN_STOP = new Set(EN_STOP_LIST);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CJK_STOP_RE = new RegExp(
  [...new Set(CJK_STOP_LIST)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|'),
  'g',
);

/** Remove CJK stop words from a compact (space-free) CJK string. */
export function stripCjkStop(s: string): string {
  return s.replace(CJK_STOP_RE, '');
}

/** Very light English stemmer (applied identically to data and queries). */
export function stem(w: string): string {
  if (w.length <= 3 || /[^a-z]/.test(w)) return w;
  let r = w;
  if (r.endsWith('sses')) r = r.slice(0, -2);
  else if (r.endsWith('ies') && r.length > 4) r = r.slice(0, -3) + 'y';
  else if (r.endsWith('s') && !/(ss|us|is)$/.test(r)) r = r.slice(0, -1);
  if (r.length > 5 && r.endsWith('ing')) r = r.slice(0, -3);
  else if (r.length > 4 && r.endsWith('ed')) r = r.slice(0, -2);
  return r;
}
