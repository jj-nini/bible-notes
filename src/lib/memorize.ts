// Recitation drills, generated in the browser from passages I typed in myself.
// No LLM: wrong choices come from Korean particle/ending swaps ("토씨"), honorific 시,
// a small list of easily confused Bible words, dropped and swapped words.

export interface DrillPassage {
  id: string;
  ref: string;
  body: string;
  /** Word position → how many times I missed it. */
  misses: Record<string, number>;
}

export type QuizKind = "blank" | "exact" | "next" | "wrong" | "ref" | "first" | "verseOrder" | "chunkOrder" | "seam";

export const KIND_LABEL: Record<QuizKind, string> = {
  blank: "빈칸",
  exact: "정확한 본문",
  next: "이어지는 말",
  wrong: "틀린 곳 찾기",
  ref: "장절 맞히기",
  first: "첫마디",
  verseOrder: "절 순서",
  chunkOrder: "절 안 순서",
  seam: "다음 절",
};

export interface Question {
  kind: QuizKind;
  passageId: string;
  prompt: string;
  /** Text shown with the question. For "blank", `blank` marks where the missing word goes. */
  context?: { before: string; after: string; blank: boolean };
  choices: string[];
  answer: number;
  /** Word positions this question tests (for weak-word tracking). */
  words: number[];
  /** The original text, shown after answering. */
  reveal: string;
  /**
   * Put-in-order questions: tap `choices` in this order (`answer` is -1).
   * `firstWord[c]` is where choice c starts in the passage, for weak-word tracking.
   */
  order?: { sequence: number[]; firstWord: number[] };
}

export type Rng = () => number;

/** Small seedable RNG (mulberry32), so tests get the same questions every run. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng: Rng, n: number) => Math.floor(rng() * n);
const pick = <T>(rng: Rng, xs: readonly T[]) => xs[randInt(rng, xs.length)];
function shuffle<T>(rng: Rng, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function weighted<T>(rng: Rng, items: { item: T; w: number }[]): T | null {
  const total = items.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const x of items) if ((r -= x.w) < 0) return x.item;
  return items[items.length - 1].item;
}

// ---------------------------------------------------------------- text

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const VERSE_NO = /^(\d{1,3})[.)]?$/;

export interface VerseLine {
  /** The number I typed, or its position when I typed none. Only used to split and label. */
  n: number;
  words: string[];
  /** Position of its first word in the whole passage. */
  start: number;
}

/**
 * Splits a passage into verses: one per line, a leading verse number optional ("1   내 아들아 …").
 * A single pasted line is split at inline numbers counting up from the first ("1 … 2 … 3 …").
 * Verse numbers are dropped from the text: they are never drilled or graded.
 */
export function splitVerses(body: string): VerseLine[] {
  const lines = body.split(/\r?\n/).map((l) => words(l)).filter((l) => l.length);
  let raw: { n: number | null; words: string[] }[];
  if (lines.length > 1) {
    raw = lines.map((l) => {
      const m = VERSE_NO.exec(l[0]);
      return m && l.length > 1 ? { n: Number(m[1]), words: l.slice(1) } : { n: null, words: l };
    });
  } else {
    const ws = lines[0] ?? [];
    const first = VERSE_NO.exec(ws[0] ?? "");
    raw = [];
    if (first && ws.length > 1) {
      let next = Number(first[1]);
      for (const w of ws) {
        const m = VERSE_NO.exec(w);
        if (m && Number(m[1]) === next) { raw.push({ n: next, words: [] }); next++; }
        else raw[raw.length - 1].words.push(w);
      }
      raw = raw.filter((v) => v.words.length);
    } else if (ws.length) raw = [{ n: null, words: ws }];
  }
  const out: VerseLine[] = [];
  let start = 0;
  for (const v of raw) {
    out.push({ n: v.n ?? (out.length ? out[out.length - 1].n + 1 : 1), words: v.words, start });
    start += v.words.length;
  }
  return out;
}

/** The passage's words, verse numbers left out. */
export const tokenize = (body: string) => splitVerses(body).flatMap((v) => v.words);
/** Letters and digits only: punctuation and spacing are not graded. */
export const norm = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");

function splitPunct(token: string) {
  const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(token)!;
  return { lead: m[1], core: m[2], trail: m[3] };
}

/** Medial vowel of the last syllable (0 = ㅏ, 8 = ㅗ). */
const jung = (s: string) => Math.floor(((s.charCodeAt(s.length - 1) - 0xac00) % 588) / 28);
const isHangul = (ch: string) => {
  const c = ch.charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3;
};
/** Final consonant of the last syllable: 0 = none, 8 = ㄹ. -1 for non-Hangul. */
function jong(s: string) {
  const ch = s[s.length - 1];
  if (!ch || !isHangul(ch)) return -1;
  return (ch.charCodeAt(0) - 0xac00) % 28;
}

// ---------------------------------------------------------------- particles (토씨)

/** A particle class; pairs are [after a final consonant, after a vowel]. */
type Particle = string | [string, string];
const P: Record<string, Particle> = {
  topic: ["은", "는"], subj: ["이", "가"], obj: ["을", "를"], with: ["과", "와"], dir: ["으로", "로"],
  also: "도", only: "만", gen: "의", loc: "에", from: "에서", to: "에게", toH: "께", subjH: "께서", topicH: "께서는",
  until: "까지", since: "부터", than: "보다", like: "처럼", each: "마다", means: ["으로써", "로써"],
};
/** Which particles get mixed up with which, most confusable first. */
const CONFUSE: Record<string, string[]> = {
  topic: ["subj", "also", "obj", "gen"], subj: ["topic", "also", "obj", "subjH"], obj: ["topic", "subj", "also", "gen"],
  gen: ["loc", "subj", "topic", "obj"], loc: ["from", "dir", "gen", "to"], from: ["loc", "to", "dir"],
  to: ["toH", "loc", "from"], toH: ["to", "subjH", "loc"], subjH: ["subj", "topicH", "topic", "toH"],
  topicH: ["subjH", "topic", "subj"], with: ["gen", "also", "subj"], dir: ["loc", "from", "means"],
  also: ["topic", "subj", "only", "obj"], only: ["also", "topic", "subj"], until: ["since", "loc"],
  since: ["until", "from"], than: ["like", "only"], like: ["than", "also"], each: ["also", "loc"], means: ["dir", "loc"],
};

function realize(p: Particle, stem: string) {
  if (typeof p === "string") return p;
  const j = jong(stem);
  if (p[0] === "으로" || p[0] === "으로써") return j > 0 && j !== 8 ? p[0] : p[1];
  return j > 0 ? p[0] : p[1];
}

// ---------------------------------------------------------------- verb endings

/** Sentence endings that are easy to mix up in 개역체. */
const FINAL = ["였느니라", "었느니라", "았느니라", "느니라", "리로다", "지어다", "지니라", "시니라", "시리라", "리라", "니라", "도다", "로다", "노라", "소서", "라"];
/** Connecting endings. */
const CONNECT = ["므로", "시고", "시며", "시니", "시매", "고", "며", "니", "매", "면", "나", "되", "지", "게"];
/** Words that only look like they end in a particle (그리스+도, 다+만). */
const WHOLE = new Set([
  "다만", "아무", "오직", "만일", "도무지", "혹은", "또는", "가령", "기도", "성도", "사도", "전도", "정도",
  "교만", "오만", "충만", "불의", "같이", "많이", "깊이", "높이", "스스로", "서로", "새로", "홀로", "비로소", "실로",
]);
/** Stems that make "-는" a verb form (사랑하는, 있는) rather than the topic particle. */
const VERBISH = /[하되있없시]$/;

// ---------------------------------------------------------------- confusable words

const LEXICON: string[][] = [
  ["주", "주님", "여호와", "하나님", "그리스도", "예수"], ["너희", "우리", "그들", "저희"], ["나", "너", "그"], ["내", "네", "그의"],
  ["모든", "온", "온갖"], ["말씀", "말", "계명", "율법"], ["마음", "생각", "뜻", "영혼"], ["사랑", "은혜", "긍휼", "자비"],
  ["믿음", "소망", "인내"], ["평강", "평안", "화평"], ["영광", "찬송", "존귀"], ["구원", "생명", "영생"], ["세상", "땅", "천하"],
  ["죄", "허물", "악"], ["항상", "늘", "언제나"], ["범사", "모든 일"], ["진리", "빛", "길"], ["간구", "기도", "소원"], ["감사", "찬양", "기쁨"],
  ["아들", "자녀", "종"], ["하늘", "천국", "하늘나라"], ["능력", "권능", "힘"], ["지혜", "지식", "명철"], ["의", "공의", "정의"],
];
const LEX = new Map<string, string[]>();
for (const g of LEXICON) for (const w of g) LEX.set(w, g.filter((x) => x !== w));

// ---------------------------------------------------------------- word variants

interface Parsed { stem: string; particle?: string; ending?: { form: string; group: string[] } }

function parse(core: string): Parsed {
  let best: Parsed = { stem: core };
  let bestLen = 0;
  if (WHOLE.has(core) || LEX.has(core)) return best;
  for (const [cls, p] of Object.entries(P)) {
    for (const form of typeof p === "string" ? [p] : p) {
      const stem = core.slice(0, -form.length);
      if (form.length <= bestLen || !core.endsWith(form) || !stem || jong(stem) < 0) continue;
      if (typeof p !== "string" && realize(p, stem) !== form) continue; // "하나님는" isn't a word
      if (cls === "topic" && form === "는" && VERBISH.test(stem)) continue;
      best = { stem, particle: cls };
      bestLen = form.length;
    }
  }
  for (const group of [FINAL, CONNECT]) {
    for (const form of group) {
      const stem = core.slice(0, -form.length);
      // Prefer the longer match: "그러므로" is 그러 + 므로, not 그러므 + 로
      if (form.length <= bestLen || !core.endsWith(form) || !stem || jong(stem) < 0) continue;
      best = { stem, ending: { form, group } };
      bestLen = form.length;
    }
  }
  if (!best.particle && !best.ending && /[하되있없시]는$/.test(core)) {
    best = { stem: core.slice(0, -1), ending: { form: "는", group: ["는", "던"] } };
  }
  return best;
}

/** Plausible misremembered forms of one word, grouped by kind of mistake. */
export function wordVariants(core: string): string[] {
  if (!core || !isHangul(core[core.length - 1])) return [];
  const { stem, particle, ending } = parse(core);
  const groups: string[][] = [];
  if (particle) {
    groups.push(CONFUSE[particle].map((c) => stem + realize(P[c], stem)));
    groups.push([stem]); // dropped particle
  }
  if (ending) {
    // Past tense follows vowel harmony: 하였느니라, 보았느니라, 주었느니라
    const past = stem.endsWith("하") ? "였" : jung(stem) === 0 || jung(stem) === 8 ? "았" : "었";
    const forms = ending.group.filter((f) => f !== ending.form && (!/^[였었았]/.test(f) || f.startsWith(past)));
    // Closest forms first: 시리라 → 리라, 시니라 before 도다
    const shared = (f: string) => { let k = 0; while (k < f.length && f.at(-1 - k) === ending.form.at(-1 - k)) k++; return k; };
    forms.sort((x, y) => shared(y) - shared(x) || Math.abs(x.length - ending.form.length) - Math.abs(y.length - ending.form.length));
    groups.push(forms.map((f) => stem + f));
    // honorific 시: 하시고 ↔ 하고
    if (stem.length >= 2 && stem.endsWith("시")) groups.push([stem.slice(0, -1) + ending.form]);
    else if (jong(stem) === 0 && !ending.form.startsWith("시")) groups.push([stem + "시" + ending.form]);
  }
  const syn = LEX.get(stem);
  // Word swaps only for nouns: 말+고 is a verb, not 말씀+고
  if (syn && !ending) groups.push(syn.map((s) => (particle ? s + realize(P[particle], s) : s)));

  // Round-robin across mistake kinds, so the four choices aren't all particle swaps
  const out: string[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++) {
    for (const g of groups) if (i < g.length) out.push(g[i]);
  }
  const seen = new Set([norm(core)]);
  return out.filter((w) => {
    const k = norm(w);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function varyToken(token: string, rng: Rng, skip = 0): string | null {
  const { lead, core, trail } = splitPunct(token);
  const vs = wordVariants(core);
  if (!vs.length) return null;
  const v = vs[(skip + randInt(rng, Math.min(vs.length, 3))) % vs.length];
  return lead + v + trail;
}

type Mutation = "vary" | "drop" | "swap";

/** One small change to a run of words; null if this kind of change isn't possible here. */
function mutate(words: string[], kind: Mutation, at: number, rng: Rng): string[] | null {
  if (kind === "vary") {
    const v = varyToken(words[at], rng);
    return v ? words.map((w, i) => (i === at ? v : w)) : null;
  }
  if (kind === "drop") return words.length > 2 ? words.filter((_, i) => i !== at) : null;
  if (at + 1 >= words.length || norm(words[at]) === norm(words[at + 1])) return null;
  const out = [...words];
  [out[at], out[at + 1]] = [out[at + 1], out[at]];
  return out;
}

/** `n` distinct wrong versions of `words`, each differing from it by one change. */
function wrongVersions(words: string[], n: number, rng: Rng, prefer?: number): string[][] {
  const seen = new Set([norm(words.join(""))]);
  const out: string[][] = [];
  const kinds: Mutation[] = ["vary", "vary", "vary", "drop", "swap"];
  for (let tries = 0; out.length < n && tries < 60; tries++) {
    const kind = tries < 3 ? "vary" : pick(rng, kinds);
    const at = prefer !== undefined && tries < 6 ? prefer : randInt(rng, words.length);
    const m = mutate(words, kind, at, rng);
    if (!m) continue;
    const k = norm(m.join(""));
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------- questions

const WINDOW = 10;

function windowAround(n: number, i: number, size: number, rng: Rng) {
  if (n <= size) return { start: 0, end: n };
  const start = Math.max(0, Math.min(n - size, i - Math.floor(size / 2) + randInt(rng, 5) - 2));
  return { start, end: start + size };
}
const dots = (s: string, start: number, end: number, n: number) =>
  (start > 0 ? "… " : "") + s + (end < n ? " …" : "");

/** Which word to test: weak words and words with good wrong forms come up more often. */
export function pickWord(p: DrillPassage, rng: Rng, words = tokenize(p.body)) {
  return weighted(rng, words.map((w, i) => ({
    item: i,
    w: (wordVariants(splitPunct(w).core).length >= 2 ? 1 : 0.15) + 3 * (p.misses[String(i)] ?? 0),
  }))) ?? 0;
}

function finish(q: Omit<Question, "choices" | "answer">, right: string, wrong: string[], rng: Rng): Question | null {
  if (wrong.length < 2) return null;
  const choices = shuffle(rng, [right, ...wrong.slice(0, 3)]);
  return { ...q, choices, answer: choices.indexOf(right) };
}

function blankQ(p: DrillPassage, words: string[], i: number, rng: Rng): Question | null {
  const { lead, core, trail } = splitPunct(words[i]);
  const wrong = wordVariants(core);
  // Not enough wrong forms of this word: borrow other words from the passage
  for (const w of shuffle(rng, words.map((x) => splitPunct(x).core))) {
    if (wrong.length >= 3) break;
    if (w && norm(w) !== norm(core) && !wrong.some((x) => norm(x) === norm(w))) wrong.push(w);
  }
  const { start, end } = windowAround(words.length, i, 12, rng);
  const before = words.slice(start, i).join(" ") + (i > start ? " " : "") + lead;
  const after = trail + (i + 1 < end ? " " : "") + words.slice(i + 1, end).join(" ");
  return finish({
    kind: "blank", passageId: p.id, prompt: "빈칸에 들어갈 말은?",
    context: { before: (start > 0 ? "… " : "") + before, after: after + (end < words.length ? " …" : ""), blank: true },
    words: [i], reveal: dots(words.slice(start, end).join(" "), start, end, words.length),
  }, core, shuffle(rng, wrong.slice(0, 3)), rng);
}

function exactQ(p: DrillPassage, words: string[], i: number, rng: Rng): Question | null {
  const { start, end } = windowAround(words.length, i, WINDOW, rng);
  const win = words.slice(start, end);
  const wrong = wrongVersions(win, 3, rng, i - start).map((w) => dots(w.join(" "), start, end, words.length));
  const right = dots(win.join(" "), start, end, words.length);
  return finish({
    kind: "exact", passageId: p.id, prompt: "본문과 똑같은 것은?",
    words: [i], reveal: right,
  }, right, wrong, rng);
}

function nextQ(p: DrillPassage, words: string[], i: number, rng: Rng): Question | null {
  if (i === 0) return firstQ(p, words, rng);
  const len = Math.min(3, words.length - i);
  if (len < 1) return null;
  const chunk = words.slice(i, i + len);
  const wrong = wrongVersions(chunk, 3, rng, 0).map((w) => w.join(" "));
  // A run that skips a word is a classic recitation slip
  const skipped = words.slice(i + 1, i + 1 + len).join(" ");
  if (skipped && norm(skipped) !== norm(chunk.join("")) && !wrong.some((w) => norm(w) === norm(skipped))) wrong.unshift(skipped);
  const from = Math.max(0, i - 8);
  return finish({
    kind: "next", passageId: p.id, prompt: "다음에 이어지는 말은?",
    context: { before: (from > 0 ? "… " : "") + words.slice(from, i).join(" "), after: "", blank: false },
    words: chunk.map((_, k) => i + k), reveal: dots(words.slice(from, i + len).join(" "), from, i + len, words.length),
  }, chunk.join(" "), shuffle(rng, wrong.slice(0, 3)), rng);
}

function firstQ(p: DrillPassage, words: string[], rng: Rng): Question | null {
  const len = Math.min(4, words.length);
  const chunk = words.slice(0, len);
  const wrong = wrongVersions(chunk, 3, rng).map((w) => w.join(" ") + " …");
  return finish({
    kind: "first", passageId: p.id, prompt: `${p.ref}은(는) 어떻게 시작하나요?`,
    words: chunk.map((_, k) => k), reveal: dots(chunk.join(" "), 0, len, words.length),
  }, chunk.join(" ") + " …", wrong, rng);
}

function wrongWordQ(p: DrillPassage, words: string[], i: number, rng: Rng): Question | null {
  const v = varyToken(words[i], rng);
  if (!v) return null;
  const { start, end } = windowAround(words.length, i, WINDOW, rng);
  const choices = words.slice(start, end).map((w, k) => (start + k === i ? v : w));
  return {
    kind: "wrong", passageId: p.id, prompt: "한 군데가 본문과 다릅니다. 틀린 어절을 누르세요.",
    choices, answer: i - start, words: [i],
    reveal: dots(words.slice(start, end).join(" "), start, end, words.length),
  };
}

/** Nearby chapter:verse numbers, for when there aren't enough of my own passages to choose from. */
function fakeRefs(ref: string, rng: Rng): string[] {
  const nums = [...ref.matchAll(/\d+/g)];
  if (!nums.length) return [];
  const out = new Set<string>();
  for (let tries = 0; out.size < 6 && tries < 30; tries++) {
    const m = pick(rng, nums);
    const n = Number(m[0]) + pick(rng, [-2, -1, 1, 2, 10]);
    if (n < 1) continue;
    const r = ref.slice(0, m.index) + n + ref.slice(m.index! + m[0].length);
    if (r !== ref) out.add(r);
  }
  return [...out];
}

function refQ(p: DrillPassage, words: string[], i: number, all: DrillPassage[], rng: Rng): Question | null {
  // Only to tell my passages apart; made-up chapter numbers alone aren't worth drilling
  if (new Set(all.map((x) => x.ref.trim())).size < 2) return null;
  const others = shuffle(rng, [...new Set(all.map((x) => x.ref.trim()))].filter((r) => r && r !== p.ref.trim()));
  const wrong = [...others, ...fakeRefs(p.ref.trim(), rng)].filter((r, k, a) => a.indexOf(r) === k).slice(0, 3);
  const { start, end } = windowAround(words.length, i, WINDOW, rng);
  const text = dots(words.slice(start, end).join(" "), start, end, words.length);
  return finish({
    kind: "ref", passageId: p.id, prompt: "이 말씀은 어디에 있나요?",
    context: { before: text, after: "", blank: false }, words: [], reveal: `${p.ref} · ${text}`,
  }, p.ref.trim(), wrong, rng);
}

// ---------------------------------------------------------------- whole-chapter questions

/**
 * Splits one verse into 3–6 pieces for put-in-order questions, cutting where the sense breaks:
 * after punctuation, a connecting ending (말고, 매며, 하여) or a vocative (아들아).
 */
export function chunkVerse(ws: string[]): string[][] {
  if (ws.length < 3) return [];
  // 잊어버리지 말고, 떠나지 말게 하고: -지/-게 lean on the next word
  const leans = (w: string) => /[지게]$/.test(splitPunct(w).core);
  const breaks = (w: string) => {
    const { core, trail } = splitPunct(w);
    if (trail) return true;
    const e = parse(core).ending?.form;
    return (e && CONNECT.includes(e) && !leans(w)) || /(?:하여|하사|아|야)$/.test(core);
  };
  let chunks: string[][] = [[]];
  for (const w of ws) {
    const cur = chunks[chunks.length - 1];
    cur.push(w);
    if ((cur.length >= 2 && breaks(w)) || (cur.length >= 4 && !leans(w)) || cur.length >= 6) chunks.push([]);
  }
  chunks = chunks.filter((c) => c.length);
  // A trailing single word reads better with the piece before it
  if (chunks.length > 1 && chunks[chunks.length - 1].length === 1) chunks[chunks.length - 2].push(...chunks.pop()!);
  while (chunks.length > 6) {
    let best = 0;
    for (let i = 1; i < chunks.length - 1; i++) {
      if (chunks[i].length + chunks[i + 1].length < chunks[best].length + chunks[best + 1].length) best = i;
    }
    chunks.splice(best, 2, [...chunks[best], ...chunks[best + 1]]);
  }
  if (chunks.length < 3) {
    // Too few natural breaks: even pieces of about two words
    const size = Math.max(1, Math.floor(ws.length / 3));
    chunks = [];
    for (let i = 0; i < ws.length; i += size) chunks.push(ws.slice(i, i + size));
    while (chunks.length > 6) chunks.splice(chunks.length - 2, 2, [...chunks[chunks.length - 2], ...chunks[chunks.length - 1]]);
  }
  return chunks.length >= 3 ? chunks : [];
}

const verseAt = (vs: VerseLine[], i: number) => {
  let k = 0;
  while (k + 1 < vs.length && vs[k + 1].start <= i) k++;
  return k;
};

/** Shuffled pieces to tap in order. Never shown already in order. */
function orderQ(
  p: DrillPassage, kind: "verseOrder" | "chunkOrder", prompt: string, pieces: { text: string; first: number }[],
  context: string, reveal: string, rng: Rng,
): Question | null {
  if (pieces.length < 3) return null;
  let perm = shuffle(rng, pieces.map((_, i) => i));
  for (let t = 0; t < 5 && perm.every((x, i) => x === i); t++) perm = shuffle(rng, perm);
  if (perm.every((x, i) => x === i)) [perm[0], perm[1]] = [perm[1], perm[0]];
  const choices = perm.map((i) => pieces[i].text);
  return {
    kind, passageId: p.id, prompt, choices, answer: -1,
    context: context ? { before: context, after: "", blank: false } : undefined,
    words: pieces.map((x) => x.first), reveal,
    order: { sequence: pieces.map((_, i) => perm.indexOf(i)), firstWord: perm.map((i) => pieces[i].first) },
  };
}

const tail = (ws: string[], n: number) => (ws.length > n ? "… " : "") + ws.slice(-n).join(" ");

function verseOrderQ(p: DrillPassage, vs: VerseLine[], i: number, rng: Rng): Question | null {
  if (vs.length < 3) return null;
  const size = Math.min(vs.length, 3 + randInt(rng, 3));
  const at = verseAt(vs, i);
  const from = Math.max(0, Math.min(vs.length - size, at - randInt(rng, size)));
  const win = vs.slice(from, from + size);
  return orderQ(
    p, "verseOrder", "절의 순서대로 누르세요.",
    win.map((v) => ({ text: v.words.join(" "), first: v.start })),
    from > 0 ? tail(vs[from - 1].words, 5) : "", win.map((v) => v.words.join(" ")).join("\n"), rng,
  );
}

function chunkOrderQ(p: DrillPassage, vs: VerseLine[], i: number, rng: Rng): Question | null {
  const v = vs[verseAt(vs, i)];
  let chunks = chunkVerse(v.words);
  let offset = 0;
  // One long unbroken passage: a run of five pieces around the word
  if (chunks.length === 6 && v.words.length > 24) {
    const all = chunks;
    let acc = 0;
    const firsts = all.map((c) => { const f = acc; acc += c.length; return f; });
    const k = Math.max(0, Math.min(all.length - 5, firsts.findIndex((f, j) => i - v.start < f + all[j].length) - 2));
    chunks = all.slice(k, k + 5);
    offset = firsts[k];
  }
  if (chunks.length < 3) return null;
  let first = v.start + offset;
  const pieces = chunks.map((c) => { const x = { text: c.join(" "), first }; first += c.length; return x; });
  const before = vs[verseAt(vs, i) - 1];
  return orderQ(
    p, "chunkOrder", "한 절을 나눠 섞었습니다. 순서대로 누르세요.", pieces,
    offset > 0 ? tail(v.words.slice(0, offset), 5) : before ? tail(before.words, 5) : "",
    pieces.map((x) => x.text).join(" "), rng,
  );
}

/**
 * How many words it takes before no other verse opens the same way
 * (그리하면 그것이 / 그리하면 네가 / 그리하면 네 창고가: "그리하면 네" alone would also be how 4절 opens).
 */
function distinctStart(vs: VerseLine[], k: number) {
  const opening = (v: VerseLine) => norm(v.words.slice(0, 8).join(""));
  let n = Math.min(2, vs[k].words.length);
  const clash = () => {
    const mine = norm(vs[k].words.slice(0, n).join(""));
    return vs.some((v, j) => j !== k && opening(v).startsWith(mine));
  };
  while (n < Math.min(6, vs[k].words.length) && clash()) n++;
  return n;
}

function seamQ(p: DrillPassage, vs: VerseLine[], i: number, rng: Rng): Question | null {
  if (vs.length < 2) return null;
  let k = verseAt(vs, i);
  if (k === 0) k = 1 + randInt(rng, vs.length - 1);
  const v = vs[k];
  const n = distinctStart(vs, k);
  const right = v.words.slice(0, n).join(" ");
  const seen = new Set([norm(right)]);
  const add = (s: string, out: string[]) => { const x = norm(s); if (x && !seen.has(x)) { seen.add(x); out.push(s); } };
  // Other verses' openings are what actually gets mixed up; ones sharing the first word most of all
  const others: string[] = [];
  const sameFirst = shuffle(rng, vs.filter((x, j) => j !== k && norm(x.words[0]) === norm(v.words[0])));
  const rest = shuffle(rng, vs.filter((x, j) => j !== k && norm(x.words[0]) !== norm(v.words[0])));
  for (const x of [...sameFirst, ...rest].slice(0, 2)) add(x.words.slice(0, n).join(" "), others);
  for (const w of wrongVersions(v.words.slice(0, n), 3, rng)) add(w.join(" "), others);
  return finish({
    kind: "seam", passageId: p.id, prompt: "다음 절은 어떻게 시작하나요?",
    context: { before: tail(vs[k - 1].words, 6), after: "", blank: false },
    words: v.words.slice(0, n).map((_, j) => v.start + j),
    reveal: tail(vs[k - 1].words, 6) + "\n" + v.words.slice(0, n + 3).join(" ") + (v.words.length > n + 3 ? " …" : ""),
  }, right, others.slice(0, 3), rng);
}

const KIND_WEIGHT: { item: QuizKind; w: number }[] = [
  { item: "blank", w: 4 }, { item: "exact", w: 3 }, { item: "wrong", w: 3 }, { item: "next", w: 3 }, { item: "first", w: 1 }, { item: "ref", w: 1 },
];
/** A whole chapter falls apart at verse order, piece order and verse seams: about half the questions. */
function kindWeights(verses: number): { item: QuizKind; w: number }[] {
  const big = verses >= 4;
  return [
    ...KIND_WEIGHT,
    { item: "chunkOrder", w: big ? 4 : 2 },
    ...(verses >= 2 ? [{ item: "seam" as const, w: big ? 4 : 2 }] : []),
    ...(verses >= 3 ? [{ item: "verseOrder" as const, w: big ? 4 : 1 }] : []),
  ];
}

/** One question about passage `p`, optionally aimed at word `focus` (a word I just missed). */
export function makeQuestion(p: DrillPassage, all: DrillPassage[], rng: Rng, focus?: number, kind?: QuizKind): Question | null {
  const vs = splitVerses(p.body);
  const words = vs.flatMap((v) => v.words);
  if (!words.length) return null;
  const kinds = kindWeights(vs.length);
  for (let tries = 0; tries < 8; tries++) {
    const k = (tries === 0 && kind) || weighted(rng, kinds)!;
    const i = focus !== undefined && focus < words.length && tries < 4 ? focus : pickWord(p, rng, words);
    const q =
      k === "blank" ? blankQ(p, words, i, rng)
      : k === "exact" ? exactQ(p, words, i, rng)
      : k === "next" ? nextQ(p, words, i, rng)
      : k === "wrong" ? wrongWordQ(p, words, i, rng)
      : k === "first" ? firstQ(p, words, rng)
      : k === "verseOrder" ? verseOrderQ(p, vs, i, rng)
      : k === "chunkOrder" ? chunkOrderQ(p, vs, i, rng)
      : k === "seam" ? seamQ(p, vs, i, rng)
      : refQ(p, words, i, all, rng);
    if (q) return q;
  }
  return null;
}

/**
 * Verses `from`..`to` (positions, inclusive) as a passage of their own, for drilling one stretch.
 * Word positions in it are `offset` less than in the whole passage.
 */
export function subPassage<T extends DrillPassage>(p: T, from: number, to: number): { passage: T; offset: number } {
  const vs = splitVerses(p.body).slice(from, to + 1);
  if (!vs.length) return { passage: p, offset: 0 };
  const offset = vs[0].start;
  const end = offset + vs.reduce((s, v) => s + v.words.length, 0);
  const misses: Record<string, number> = {};
  for (const [k, n] of Object.entries(p.misses)) if (+k >= offset && +k < end) misses[+k - offset] = n;
  return { passage: { ...p, body: vs.map((v) => `${v.n} ${v.words.join(" ")}`).join("\n"), misses }, offset };
}

/** Passages I get wrong more often, and ones I haven't drilled yet, come up more. */
export function pickPassage<T extends DrillPassage & { correct: number; wrong: number }>(ps: T[], rng: Rng): T | null {
  return weighted(rng, ps.map((p) => {
    const seen = p.correct + p.wrong;
    const weak = Object.values(p.misses).reduce((s, n) => s + n, 0);
    return { item: p, w: 1 + (seen ? (3 * p.wrong) / seen : 1) + Math.min(weak, 10) * 0.2 };
  }));
}

/** One answer's effect on a passage's counts; same arithmetic as the record_memory_result RPC. */
export function applyResult<T extends DrillPassage & { correct: number; wrong: number }>(
  p: T, ok: boolean, hit: number[], miss: number[],
): T {
  const misses = { ...p.misses };
  for (const w of hit) misses[w] = (misses[w] ?? 0) - 1;
  for (const w of miss) misses[w] = (misses[w] ?? 0) + 1;
  for (const k of Object.keys(misses)) if (misses[k] <= 0) delete misses[k];
  return { ...p, misses, correct: p.correct + (ok ? 1 : 0), wrong: p.wrong + (ok ? 0 : 1) };
}

// ---------------------------------------------------------------- write-out grading

export interface DiffPart {
  type: "same" | "missing" | "extra";
  text: string;
}

export interface Grade {
  parts: DiffPart[];
  /** Word positions in the original with any mistake. */
  wrongWords: number[];
  total: number;
  perfect: boolean;
  /** Mistakes per verse (verse number as typed, or its position). */
  byVerse: { n: number; words: number; wrong: number }[];
}

/**
 * Compares what I wrote from memory with the passage, letter by letter.
 * Spacing and punctuation are ignored; every other letter counts.
 * Verse numbers I write along are ignored too (unless the text itself has digits).
 */
export function gradeRecitation(body: string, attempt: string): Grade {
  const vs = splitVerses(body);
  const words = vs.flatMap((v) => v.words);
  const verseStarts = new Set(vs.slice(1).map((v) => v.start));
  const orig: { ch: string; w: number }[] = [];
  words.forEach((w, i) => { for (const ch of norm(w)) orig.push({ ch, w: i }); });
  const hasDigits = orig.some((o) => /\d/.test(o.ch));
  const mine = [...norm(hasDigits ? attempt : attempt.replace(/\d/g, ""))];
  const a = orig.map((o) => o.ch);
  const n = a.length;
  const m = mine.length;

  // Longest common subsequence table, filled from the end
  const W = m + 1;
  const L = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * W + j] = a[i] === mine[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const wrong = new Set<number>();
  let lastWord = -1;
  const push = (type: DiffPart["type"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  const origChar = (i: number, type: "same" | "missing") => {
    if (lastWord >= 0 && orig[i].w !== lastWord) push("same", verseStarts.has(orig[i].w) ? "\n" : " ");
    lastWord = orig[i].w;
    push(type, orig[i].ch);
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === mine[j]) { origChar(i, "same"); i++; j++; }
    else if (j < m && (i >= n || L[i * W + j + 1] >= L[(i + 1) * W + j])) {
      wrong.add(i < n ? orig[i].w : Math.max(0, words.length - 1));
      push("extra", mine[j]); j++;
    } else { wrong.add(orig[i].w); origChar(i, "missing"); i++; }
  }
  const wrongWords = [...wrong].filter((w) => w >= 0 && w < words.length).sort((x, y) => x - y);
  const byVerse = vs.map((v) => ({
    n: v.n, words: v.words.length,
    wrong: wrongWords.filter((w) => w >= v.start && w < v.start + v.words.length).length,
  }));
  return { parts, wrongWords, total: words.length, perfect: n > 0 && wrongWords.length === 0, byVerse };
}
