// Recitation drills, generated in the browser from passages I typed in myself.
// No LLM: wrong choices come from Korean particle/ending swaps ("토씨"), honorific 시,
// a small list of easily confused Bible words, dropped and swapped words.

export interface DrillPassage {
  id: string;
  ref: string;
  body: string;
  /** Word position → how many times I missed it. */
  misses: Record<string, number>;
  /** Verse position → how well I know it (missing = level 1). */
  progress?: Record<string, VerseProgress>;
  /** Near misses made ahead of time (by Claude): words[start..end) misremembered as `text`. */
  variants?: Variant[];
}

export interface Variant { start: number; end: number; text: string }

export type QuizKind =
  | "blank" | "ox" | "exact" | "next" | "first" | "seam" | "verseOrder" | "chunkOrder" | "ref"
  | "wrong" | "pair" | "bank" | "type1"
  | "type"
  | "finish" | "quote";

export const KIND_LABEL: Record<QuizKind, string> = {
  blank: "빈칸", ox: "OX", exact: "정확한 본문", next: "이어지는 말", first: "첫마디", seam: "다음 절",
  verseOrder: "절 순서", chunkOrder: "절 안 순서", ref: "장절 맞히기",
  wrong: "틀린 곳 찾기", pair: "짝짓기", bank: "단어 놓기", type1: "빈칸 쓰기",
  type: "이어 쓰기",
  finish: "절 끝까지 쓰기", quote: "암송 쓰기",
};

export interface Question {
  kind: QuizKind;
  passageId: string;
  /** Level this kind of question belongs to (1–4). */
  level: number;
  /** Verse positions this question tests (their levels move with the answer). */
  verses: number[];
  prompt: string;
  /** Text shown with the question. For "blank", `blank` marks where the missing word goes. */
  context?: { before: string; after: string; blank: boolean };
  /** Text around several blanks (pair, bank): blanks go between the parts. */
  cloze?: string[];
  choices: string[];
  answer: number;
  /** Word positions this question tests (for weak-word tracking). */
  words: number[];
  /** The original text, shown after answering. */
  reveal: string;
  /**
   * Put-in-order questions: tap `choices` in this order (`answer` is -1); choices not in it are decoys.
   * `firstWord[c]` is where choice c starts in the passage (-1 for a decoy), for weak-word tracking.
   */
  order?: { sequence: number[]; firstWord: number[] };
  /** Typed answers: graded letter by letter. `hint` is the first consonants. */
  input?: { answer: string; hint: string };
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

/**
 * Plausible misremembered forms of one word, grouped by kind of mistake.
 * `dropParticle: false` leaves out the bare stem; `endings` limits ending swaps to these forms.
 */
export function wordVariants(core: string, opts: { dropParticle?: boolean; endings?: Set<string> } = {}): string[] {
  if (!core || !isHangul(core[core.length - 1])) return [];
  const { stem, particle, ending } = parse(core);
  const groups: string[][] = [];
  if (particle) {
    groups.push(CONFUSE[particle].map((c) => stem + realize(P[c], stem)));
    if (opts.dropParticle !== false) groups.push([stem]);
  }
  if (ending) {
    // Past tense follows vowel harmony: 하였느니라, 보았느니라, 주었느니라
    const past = stem.endsWith("하") ? "였" : jung(stem) === 0 || jung(stem) === 8 ? "았" : "었";
    const forms = ending.group.filter((f) => f !== ending.form && (!/^[였었았]/.test(f) || f.startsWith(past)))
      .filter((f) => !opts.endings || opts.endings.has(f));
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

// ---------------------------------------------------------------- levels

/** How well I know one verse. r/w: right and wrong answers, s: recall answers right in a row, lv: 1–4. */
export interface VerseProgress { r: number; w: number; s: number; lv: number }
export const LEVEL_LABEL = ["", "알아보기", "구별하기", "떠올리기", "암송하기"];

/**
 * One answer's effect on a verse's level; same rules as the record_memory_result RPC.
 * 1 → 2 after 5 right, 2 → 3 at 80% over 10+ answers, 3 → 4 after 3 recalls right in a row.
 */
export function nextProgress(cur: VerseProgress | undefined, ok: boolean, recall: boolean): VerseProgress {
  const p = { r: 0, w: 0, s: 0, lv: 1, ...cur };
  p.r += ok ? 1 : 0;
  p.w += ok ? 0 : 1;
  if (recall) p.s = ok ? p.s + 1 : 0;
  const before = p.lv;
  if (p.lv === 1 && p.r >= 5) p.lv = 2;
  else if (p.lv === 2 && p.r + p.w >= 10 && p.r >= 0.8 * (p.r + p.w)) p.lv = 3;
  else if (p.lv === 3 && p.s >= 3) p.lv = 4;
  if (p.lv !== before) p.s = 0; // a streak counts at the new level only
  return p;
}

export const verseLevel = (p: DrillPassage, verse: number) => p.progress?.[verse]?.lv ?? 1;

/** Which level each question belongs to; a verse gets questions up to its level. */
const KIND_LEVEL: Record<QuizKind, number> = {
  blank: 1, ox: 1, exact: 1, next: 1, first: 1, seam: 1, verseOrder: 1, chunkOrder: 1, ref: 1,
  wrong: 2, pair: 2, bank: 2, type1: 2,
  type: 3,
  finish: 4, quote: 4,
};
/** Questions I answer by typing (from memory) rather than by choosing. */
export const RECALL = new Set<QuizKind>(["type1", "type", "finish", "quote"]);

// ---------------------------------------------------------------- the chapter as material

/**
 * Wrong choices come from the passage itself: a word or phrase from another verse with the same shape
 * (지키라 ↔ 새기라 ↔ 공경하라, 네 마음으로 나의 명령을 지키라 ↔ 네 마음판에 새기라).
 * They are always real Korean, and they are what actually gets mixed up.
 */
interface Word { i: number; token: string; core: string; tail: string; kind: "p" | "e" | ""; group: string }
interface Material {
  vs: VerseLine[];
  words: string[];
  info: Word[];
  /** Words of my other passages, when this one is too short to supply wrong choices. */
  extra: Word[];
  chunks: { start: number; words: string[]; verse: number }[];
  variants: Variant[];
}

function wordInfo(token: string, i: number): Word {
  const { core } = splitPunct(token);
  const { stem, particle, ending } = parse(core);
  const tail = particle || ending ? core.slice(stem.length) : "";
  return { i, token, core, tail, kind: particle ? "p" : ending ? "e" : "", group: ending ? (ending.group === FINAL ? "final" : "connect") : particle ?? "" };
}

const materialCache = new WeakMap<DrillPassage, Material>();
function material(p: DrillPassage, all: DrillPassage[]): Material {
  const hit = materialCache.get(p);
  if (hit) return hit;
  const vs = splitVerses(p.body);
  const words = vs.flatMap((v) => v.words);
  const info = words.map(wordInfo);
  const extra = all.filter((x) => x.id !== p.id).flatMap((x) => tokenize(x.body).map((w) => wordInfo(w, -1)));
  const chunks = vs.flatMap((v, k) => {
    let at = v.start;
    const cs = chunkVerse(v.words);
    return (cs.length ? cs : [v.words]).map((c) => { const x = { start: at, words: c, verse: k }; at += c.length; return x; });
  });
  const m = { vs, words, info, extra, chunks, variants: (p.variants ?? []).filter((v) => v.end <= words.length && v.start < v.end) };
  materialCache.set(p, m);
  return m;
}

/** Endings safe to use when the passage has too few similar words: the common 개역체 ones. */
const COMMON_FINAL = new Set(["라", "리라", "니라", "느니라", "도다"]);

/**
 * Up to `n` words that could stand where word `w` stands, most alike first.
 * `strict` (a swap inside the shown sentence): the very same ending or particle, and no one-syllable stems
 * (네가 → 진리가 reads as nonsense; 지키라 → 새기라, 의지하지 → 떠나지 read as real slips).
 */
function similarWords(m: Material, w: Word, n: number, rng: Rng, strict = false): string[] {
  const stemLen = (x: Word) => x.core.length - x.tail.length;
  if (strict && (!w.tail || stemLen(w) < 2)) return [];
  const score = (x: Word) =>
    (w.tail && x.tail === w.tail ? 4 : 0) + (w.kind && x.kind === w.kind ? 2 : 0) + (w.group && x.group === w.group ? 1 : 0)
    + (Math.abs(x.core.length - w.core.length) <= 1 ? 1 : 0) - (x.i < 0 ? 1 : 0);
  const seen = new Set([norm(w.core)]);
  const pool = shuffle(rng, [...m.info, ...m.extra])
    .filter((x) => x.core && /\p{L}/u.test(x.core))
    .filter((x) => !strict || (x.tail === w.tail && stemLen(x) >= 2))
    .map((x) => ({ x, s: score(x) }))
    .filter((c) => c.s >= 2)
    .sort((a, b) => b.s - a.s);
  const out: string[] = [];
  // Claude-made near misses for exactly this word go first
  for (const v of m.variants) if (v.start === w.i && v.end === w.i + 1) pushNew(out, seen, splitPunct(v.text).core);
  for (const c of pool) { if (out.length >= n) break; pushNew(out, seen, c.x.core); }
  if (out.length < n && !strict) {
    const tails = new Set([...m.info.map((x) => x.tail), ...COMMON_FINAL]);
    for (const v of wordVariants(w.core, { dropParticle: false, endings: tails })) { if (out.length >= n) break; pushNew(out, seen, v); }
  }
  return out.slice(0, n);
}

function pushNew(out: string[], seen: Set<string>, s: string) {
  const k = norm(s);
  if (k && !seen.has(k)) { seen.add(k); out.push(s); }
}

/** Little words that can drop out of a recitation and leave good Korean (네 마음판에 → 마음판에). */
const DROPPABLE = new Set(["네", "내", "나의", "너의", "그", "그의", "이", "저", "모든", "또", "다", "곧", "너는", "나는"]);

/**
 * Wrong versions of words[start..end): each one realistic change.
 * A Claude variant, a same-shaped word from the chapter, a same-shaped phrase from another verse, or a dropped little word.
 */
function changedVersions(m: Material, start: number, end: number, n: number, rng: Rng, focus?: number): { text: string[]; at: number }[] {
  const win = m.words.slice(start, end);
  const seen = new Set([norm(win.join(""))]);
  const out: { text: string[]; at: number }[] = [];
  const add = (text: string[], at: number) => {
    const k = norm(text.join(""));
    if (k && !seen.has(k)) { seen.add(k); out.push({ text, at }); }
  };
  for (const v of shuffle(rng, m.variants.filter((v) => v.start >= start && v.end <= end))) {
    add([...m.words.slice(start, v.start), ...words(v.text), ...m.words.slice(v.end, end)], v.start);
  }
  const swapWord = (i: number) => {
    const w = m.info[i];
    const sim = similarWords(m, w, 3, rng, true);
    if (!sim.length) return;
    const { lead, trail } = splitPunct(w.token);
    add(win.map((x, k) => (start + k === i ? lead + pick(rng, sim.slice(0, 2)) + trail : x)), i);
  };
  const swapPhrase = () => {
    const inside = m.chunks.filter((c) => c.start >= start && c.start + c.words.length <= end && c.words.length >= 2);
    if (!inside.length) return;
    const c = pick(rng, inside);
    const first = m.info[c.start], last = m.info[c.start + c.words.length - 1];
    // Same shape at both ends: 네 마음으로 나의 명령을 지키라 ↔ 네 마음판에 새기라
    const others = m.chunks.filter((o) => {
      if (o.start === c.start || o.words.length < 2 || o.words.length > c.words.length + 2) return false;
      const of = wordInfo(o.words[0], 0), ol = wordInfo(o.words[o.words.length - 1], 0);
      // A bare last word (가득히, 징계함) says nothing about shape
      const ends = last.tail ? ol.tail === last.tail && ol.kind === last.kind : norm(ol.core) === norm(last.core);
      return ends && (norm(o.words[0]) === norm(c.words[0]) || (!!first.tail && of.tail === first.tail && of.kind === first.kind));
    });
    if (!others.length) return;
    const o = pick(rng, others);
    add([...m.words.slice(start, c.start), ...o.words, ...m.words.slice(c.start + c.words.length, end)], c.start);
  };
  const drop = () => {
    const ks = win.map((_, k) => k).filter((k) => DROPPABLE.has(norm(win[k])));
    if (!ks.length || win.length < 3) return;
    const k = pick(rng, ks);
    add(win.filter((_, x) => x !== k), start + k);
  };
  if (focus !== undefined && focus >= start && focus < end) swapWord(focus);
  // Verb endings swap most convincingly (지키라 ↔ 새기라); nouns less so (아비가 ↔ 창고가)
  const spots = m.info.slice(start, end).map((w) => ({ item: w.i, w: w.kind === "e" ? 3 : w.kind === "p" ? 1 : 0 }));
  for (let tries = 0; out.length < n && tries < 24; tries++) {
    const r = rng();
    if (r < 0.5) { const at = weighted(rng, spots); if (at !== null) swapWord(at); }
    else if (r < 0.85) swapPhrase();
    else drop();
  }
  return out.slice(0, n);
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

/** The verse around word i, or a window of it when the verse is long. */
function verseWindow(m: Material, i: number, max: number, rng: Rng) {
  const v = m.vs[verseAt(m.vs, i)];
  if (v.words.length <= max) return { start: v.start, end: v.start + v.words.length };
  const w = windowAround(v.words.length, i - v.start, max, rng);
  return { start: v.start + w.start, end: v.start + w.end };
}

/** Which word to test: weak words and words with good wrong choices come up more often. */
export function pickWord(p: DrillPassage, rng: Rng, all: DrillPassage[] = [p]) {
  const m = material(p, all);
  return weighted(rng, m.info.map((w) => ({
    item: w.i,
    w: (w.kind ? 1 : 0.4) + 3 * (p.misses[String(w.i)] ?? 0),
  }))) ?? 0;
}

function finish(q: Omit<Question, "choices" | "answer">, right: string, wrong: string[], rng: Rng): Question | null {
  if (wrong.length < 2) return null;
  const choices = shuffle(rng, [right, ...wrong.slice(0, 3)]);
  return { ...q, choices, answer: choices.indexOf(right) };
}

type Builder = (p: DrillPassage, m: Material, i: number, rng: Rng, all: DrillPassage[]) => Question | null;
const base = (p: DrillPassage, m: Material, kind: QuizKind, i: number) =>
  ({ kind, passageId: p.id, level: KIND_LEVEL[kind], verses: [verseAt(m.vs, i)] });
const span = (m: Material, start: number, end: number) => dots(m.words.slice(start, end).join(" "), start, end, m.words.length);

const blankQ: Builder = (p, m, i, rng) => {
  const w = m.info[i];
  const { lead, trail } = splitPunct(w.token);
  const { start, end } = windowAround(m.words.length, i, 12, rng);
  const before = m.words.slice(start, i).join(" ") + (i > start ? " " : "") + lead;
  const after = trail + (i + 1 < end ? " " : "") + m.words.slice(i + 1, end).join(" ");
  return finish({
    ...base(p, m, "blank", i), prompt: "빈칸에 들어갈 말은?",
    context: { before: (start > 0 ? "… " : "") + before, after: after + (end < m.words.length ? " …" : ""), blank: true },
    words: [i], reveal: span(m, start, end),
  }, w.core, similarWords(m, w, 3, rng), rng);
};

const oxQ: Builder = (p, m, i, rng) => {
  const { start, end } = verseWindow(m, i, 14, rng);
  const same = rng() < 0.45;
  const changed = same ? null : changedVersions(m, start, end, 1, rng, i)[0];
  if (!same && !changed) return null;
  const text = changed ? changed.text : m.words.slice(start, end);
  const shown = dots(text.join(" "), start, end, m.words.length);
  return {
    ...base(p, m, "ox", i), prompt: "본문과 토씨까지 똑같나요?",
    context: { before: shown, after: "", blank: false },
    choices: ["O 똑같다", "X 다르다"], answer: same ? 0 : 1,
    words: [changed ? changed.at : i], reveal: span(m, start, end),
  };
};

const exactQ: Builder = (p, m, i, rng) => {
  const { start, end } = verseWindow(m, i, WINDOW, rng);
  const wrong = changedVersions(m, start, end, 3, rng, i).map((c) => dots(c.text.join(" "), start, end, m.words.length));
  const right = span(m, start, end);
  return finish({ ...base(p, m, "exact", i), prompt: "본문과 똑같은 것은?", words: [i], reveal: right }, right, wrong, rng);
};

const nextQ: Builder = (p, m, i, rng) => {
  if (i === 0) return firstQ(p, m, i, rng, []);
  const len = Math.min(3, m.words.length - i);
  const end = i + len;
  const right = m.words.slice(i, end).join(" ");
  const seen = new Set([norm(right)]);
  const wrong: string[] = [];
  // Skipping a word is the classic slip; then same-shaped words and phrases
  pushNew(wrong, seen, m.words.slice(i + 1, end + 1).join(" "));
  for (const c of changedVersions(m, i, end, 3, rng, i)) pushNew(wrong, seen, c.text.join(" "));
  const from = Math.max(0, i - 8);
  return finish({
    ...base(p, m, "next", i), prompt: "다음에 이어지는 말은?",
    context: { before: (from > 0 ? "… " : "") + m.words.slice(from, i).join(" "), after: "", blank: false },
    words: m.words.slice(i, end).map((_, k) => i + k), reveal: span(m, from, end),
  }, right, shuffle(rng, wrong).slice(0, 3), rng);
};

/** How the passage starts. Wrong choices: how its other verses, or my other passages, start. */
const firstQ: Builder = (p, m, _i, rng, all) => {
  const n = m.vs.length > 1 ? distinctStart(m.vs, 0) : Math.min(3, m.words.length);
  const right = m.words.slice(0, n).join(" ");
  const seen = new Set([norm(right)]);
  const wrong: string[] = [];
  for (const v of shuffle(rng, m.vs.slice(1))) pushNew(wrong, seen, v.words.slice(0, distinctStart(m.vs, m.vs.indexOf(v))).join(" "));
  for (const x of shuffle(rng, all.filter((x) => x.id !== p.id))) pushNew(wrong, seen, tokenize(x.body).slice(0, n).join(" "));
  for (const c of changedVersions(m, 0, n, 3, rng)) pushNew(wrong, seen, c.text.join(" "));
  return finish({
    ...base(p, m, "first", 0), prompt: `${p.ref}은(는) 어떻게 시작하나요?`,
    words: m.words.slice(0, n).map((_, k) => k), reveal: span(m, 0, Math.min(m.words.length, n + 4)),
  }, right, wrong.slice(0, 3), rng);
};

const wrongWordQ: Builder = (p, m, i, rng) => {
  const sim = similarWords(m, m.info[i], 2, rng, true);
  if (!sim.length) return null;
  const { start, end } = verseWindow(m, i, WINDOW, rng);
  const { lead, trail } = splitPunct(m.words[i]);
  const choices = m.words.slice(start, end).map((w, k) => (start + k === i ? lead + sim[0] + trail : w));
  return {
    ...base(p, m, "wrong", i), prompt: "한 군데가 본문과 다릅니다. 틀린 어절을 누르세요.",
    choices, answer: i - start, words: [i], reveal: span(m, start, end),
  };
};

/** 짝짓기: two blanks (가)(나), choose the right pair. */
const pairQ: Builder = (p, m, i, rng) => {
  const { start, end } = verseWindow(m, i, 14, rng);
  // Blanks apart from each other, on words that have real look-alikes
  const cands = m.info.slice(start, end).filter((w) => Math.abs(w.i - i) >= 2 && w.kind && similarWords(m, w, 1, rng, true).length);
  if (!cands.length || !m.info[i].kind) return null;
  const j0 = pick(rng, cands).i;
  const [a, b] = i < j0 ? [i, j0] : [j0, i];
  const sa = similarWords(m, m.info[a], 2, rng, true);
  const sb = similarWords(m, m.info[b], 2, rng, true);
  if (!sa.length || !sb.length) return null;
  const A = m.info[a].core, B = m.info[b].core;
  const pair = (x: string, y: string) => `(가) ${x} · (나) ${y}`;
  const wrong = [pair(sa[0], B), pair(A, sb[0]), pair(sa[1] ?? sa[0], sb[1] ?? sb[0])];
  const seg = (from: number, to: number) => m.words.slice(from, to).join(" ");
  const pa = splitPunct(m.words[a]), pb = splitPunct(m.words[b]);
  return finish({
    ...base(p, m, "pair", i), prompt: "(가)와 (나)에 들어갈 말로 맞게 짝지은 것은?",
    cloze: [
      (start > 0 ? "… " : "") + seg(start, a) + (a > start ? " " : "") + pa.lead,
      pa.trail + " " + seg(a + 1, b) + (b > a + 1 ? " " : "") + pb.lead,
      pb.trail + (b + 1 < end ? " " : "") + seg(b + 1, end) + (end < m.words.length ? " …" : ""),
    ],
    words: [a, b], reveal: span(m, start, end),
  }, pair(A, B), wrong.filter((w) => w !== pair(A, B)), rng);
};

/** 단어 놓기: several blanks, tap words from a bank in order (two of them don't belong). */
const bankQ: Builder = (p, m, i, rng) => {
  const { start, end } = verseWindow(m, i, 14, rng);
  if (end - start < 6) return null;
  const others = shuffle(rng, m.info.slice(start, end).filter((w) => w.i !== i && w.kind)).slice(0, 2).map((w) => w.i);
  const blanks = [i, ...others].sort((x, y) => x - y);
  if (blanks.length < 3) return null;
  const seen = new Set(blanks.map((b) => norm(m.info[b].core)));
  const decoys: string[] = [];
  for (const b of blanks) for (const s of similarWords(m, m.info[b], 2, rng)) if (decoys.length < 2) pushNew(decoys, seen, s);
  const bank = shuffle(rng, [...blanks.map((b) => ({ text: m.info[b].core, first: b })), ...decoys.map((d) => ({ text: d, first: -1 }))]);
  const cloze: string[] = [];
  let from = start;
  for (const b of blanks) {
    const { lead } = splitPunct(m.words[b]);
    const prevTrail = cloze.length ? splitPunct(m.words[from - 1]).trail : "";
    cloze.push((cloze.length ? prevTrail + " " : start > 0 ? "… " : "") + m.words.slice(from, b).join(" ") + (b > from ? " " : "") + lead);
    from = b + 1;
  }
  cloze.push(splitPunct(m.words[from - 1]).trail + (from < end ? " " : "") + m.words.slice(from, end).join(" ") + (end < m.words.length ? " …" : ""));
  return {
    ...base(p, m, "bank", i), prompt: "빈칸 순서대로 알맞은 말을 누르세요. (두 개는 쓰지 않습니다)",
    choices: bank.map((x) => x.text), answer: -1, cloze, words: blanks, reveal: span(m, start, end),
    order: { sequence: blanks.map((b) => bank.findIndex((x) => x.first === b)), firstWord: bank.map((x) => x.first) },
  };
};

/** First consonants of each syllable, as a typing hint (지키라 → ㅈㅋㄹ). */
export function chosung(s: string) {
  const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  return [...s].map((c) => (isHangul(c) ? CHO[Math.floor((c.charCodeAt(0) - 0xac00) / 588)] : c)).join("");
}

/** Type a short run from memory: one word (level 2) or to the end of the phrase (level 3). */
function typeQ(kind: "type1" | "type"): Builder {
  return (p, m, i) => {
    const c = m.chunks.find((x) => i >= x.start && i < x.start + x.words.length)!;
    let from = i, to = i + 1;
    if (kind === "type1") { if (m.info[i].core.length < 2 && i + 1 < m.words.length) to = i + 2; }
    else { from = Math.max(c.start, Math.min(i, c.start + c.words.length - 3)); to = Math.min(c.start + c.words.length, from + 5); if (to - from < 2) return null; }
    const answer = m.words.slice(from, to).join(" ");
    const lo = Math.max(0, from - 7);
    return {
      ...base(p, m, kind, i), prompt: kind === "type1" ? "빈칸을 쓰세요." : "이어지는 말을 쓰세요.",
      context: { before: (lo > 0 ? "… " : "") + m.words.slice(lo, from).join(" "), after: kind === "type1" ? m.words.slice(to, Math.min(m.words.length, to + 5)).join(" ") : "", blank: true },
      choices: [], answer: -1, words: m.words.slice(from, to).map((_, k) => from + k),
      reveal: span(m, lo, Math.min(m.words.length, to + 3)),
      input: { answer, hint: chosung(answer) },
    };
  };
}

/** Finish the Verse: the opening is given, type the rest of it. */
const finishQ: Builder = (p, m, i) => {
  const k = verseAt(m.vs, i);
  const v = m.vs[k];
  const n = m.vs.length > 1 ? Math.min(distinctStart(m.vs, k), v.words.length - 2) : Math.min(3, v.words.length - 2);
  if (n < 1) return null;
  const answer = v.words.slice(n).join(" ");
  return {
    ...base(p, m, "finish", i), prompt: "이 절을 끝까지 쓰세요.",
    context: { before: (k > 0 ? tail(m.vs[k - 1].words, 4) + "\n" : "") + v.words.slice(0, n).join(" "), after: "", blank: true },
    choices: [], answer: -1, words: v.words.slice(n).map((_, x) => v.start + n + x), reveal: v.words.join(" "),
    input: { answer, hint: chosung(answer) },
  };
};

/** Quote: several verses in a row from memory (the whole passage when it is short). */
const quoteQ: Builder = (p, m, i, rng) => {
  const k = verseAt(m.vs, i);
  const size = Math.min(m.vs.length - k, 2 + randInt(rng, 2));
  const from = m.vs.length <= 3 ? 0 : k;
  const vs = m.vs.slice(from, from + (m.vs.length <= 3 ? m.vs.length : size));
  const answer = vs.map((v) => v.words.join(" ")).join("\n");
  const first = vs[0].start;
  const count = vs.reduce((s, v) => s + v.words.length, 0);
  return {
    ...base(p, m, "quote", i), prompt: m.vs.length <= 3 || from === 0 ? `${p.ref}을(를) 처음부터 쓰세요.` : `이어지는 ${vs.length}절을 쓰세요.`,
    context: from > 0 ? { before: tail(m.vs[from - 1].words, 6), after: "", blank: true } : undefined,
    choices: [], answer: -1, verses: vs.map((_, x) => from + x),
    words: Array.from({ length: count }, (_, x) => first + x), reveal: answer,
    input: { answer, hint: vs.map((v) => chosung(v.words.slice(0, 2).join(" "))).join(" / ") + " …" },
  };
};

/** Nearby chapter:verse numbers, for telling my passages apart. */
function fakeRefs(ref: string, rng: Rng): string[] {
  const nums = [...ref.matchAll(/\d+/g)];
  if (!nums.length) return [];
  const out = new Set<string>();
  for (let tries = 0; out.size < 6 && tries < 30; tries++) {
    const mm = pick(rng, nums);
    const n = Number(mm[0]) + pick(rng, [-2, -1, 1, 2, 10]);
    if (n < 1) continue;
    const r = ref.slice(0, mm.index) + n + ref.slice(mm.index! + mm[0].length);
    if (r !== ref) out.add(r);
  }
  return [...out];
}

const refQ: Builder = (p, m, i, rng, all) => {
  // Only to tell my passages apart; made-up chapter numbers alone aren't worth drilling
  if (new Set(all.map((x) => x.ref.trim())).size < 2) return null;
  const others = shuffle(rng, [...new Set(all.map((x) => x.ref.trim()))].filter((r) => r && r !== p.ref.trim()));
  const wrong = [...others, ...fakeRefs(p.ref.trim(), rng)].filter((r, k, a) => a.indexOf(r) === k).slice(0, 3);
  const { start, end } = windowAround(m.words.length, i, WINDOW, rng);
  const text = span(m, start, end);
  return finish({
    ...base(p, m, "ref", i), prompt: "이 말씀은 어디에 있나요?",
    context: { before: text, after: "", blank: false }, words: [], reveal: `${p.ref} · ${text}`,
  }, p.ref.trim(), wrong, rng);
};

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
  q: Omit<Question, "choices" | "answer" | "order" | "words">, pieces: { text: string; first: number }[], rng: Rng,
): Question | null {
  if (pieces.length < 3) return null;
  let perm = shuffle(rng, pieces.map((_, i) => i));
  for (let t = 0; t < 5 && perm.every((x, i) => x === i); t++) perm = shuffle(rng, perm);
  if (perm.every((x, i) => x === i)) [perm[0], perm[1]] = [perm[1], perm[0]];
  return {
    ...q, choices: perm.map((i) => pieces[i].text), answer: -1, words: pieces.map((x) => x.first),
    order: { sequence: pieces.map((_, i) => perm.indexOf(i)), firstWord: perm.map((i) => pieces[i].first) },
  };
}

const tail = (ws: string[], n: number) => (ws.length > n ? "… " : "") + ws.slice(-n).join(" ");

const verseOrderQ: Builder = (p, m, i, rng) => {
  const vs = m.vs;
  if (vs.length < 3) return null;
  const size = Math.min(vs.length, 3 + randInt(rng, 3));
  const at = verseAt(vs, i);
  const from = Math.max(0, Math.min(vs.length - size, at - randInt(rng, size)));
  const win = vs.slice(from, from + size);
  return orderQ({
    ...base(p, m, "verseOrder", i), verses: win.map((_, k) => from + k), prompt: "절의 순서대로 누르세요.",
    context: from > 0 ? { before: tail(vs[from - 1].words, 5), after: "", blank: false } : undefined,
    reveal: win.map((v) => v.words.join(" ")).join("\n"),
  }, win.map((v) => ({ text: v.words.join(" "), first: v.start })), rng);
};

const chunkOrderQ: Builder = (p, m, i, rng) => {
  const vs = m.vs;
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
  const anchor = offset > 0 ? tail(v.words.slice(0, offset), 5) : before ? tail(before.words, 5) : "";
  return orderQ({
    ...base(p, m, "chunkOrder", i), prompt: "한 절을 나눠 섞었습니다. 순서대로 누르세요.",
    context: anchor ? { before: anchor, after: "", blank: false } : undefined,
    reveal: pieces.map((x) => x.text).join(" "),
  }, pieces, rng);
};

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

const seamQ: Builder = (p, m, i, rng) => {
  const vs = m.vs;
  if (vs.length < 2) return null;
  let k = verseAt(vs, i);
  if (k === 0) k = 1 + randInt(rng, vs.length - 1);
  const v = vs[k];
  const n = distinctStart(vs, k);
  const right = v.words.slice(0, n).join(" ");
  const seen = new Set([norm(right)]);
  const others: string[] = [];
  // Other verses' openings are what actually gets mixed up; ones sharing the first word most of all
  const sameFirst = shuffle(rng, vs.filter((x, j) => j !== k && norm(x.words[0]) === norm(v.words[0])));
  const rest = shuffle(rng, vs.filter((x, j) => j !== k && norm(x.words[0]) !== norm(v.words[0])));
  // Each at its own telling length, so no choice is just the start of another (그리하면 네 / 그리하면 네가)
  for (const x of [...sameFirst, ...rest].slice(0, 3)) {
    const t = x.words.slice(0, distinctStart(vs, vs.indexOf(x))).join(" ");
    if (!norm(right).startsWith(norm(t)) && !norm(t).startsWith(norm(right))) pushNew(others, seen, t);
  }
  for (const c of changedVersions(m, v.start, v.start + n, 2, rng)) pushNew(others, seen, c.text.join(" "));
  return finish({
    ...base(p, m, "seam", v.start), prompt: "다음 절은 어떻게 시작하나요?",
    context: { before: tail(vs[k - 1].words, 6), after: "", blank: false },
    words: v.words.slice(0, n).map((_, j) => v.start + j),
    reveal: tail(vs[k - 1].words, 6) + "\n" + v.words.slice(0, n + 3).join(" ") + (v.words.length > n + 3 ? " …" : ""),
  }, right, others.slice(0, 3), rng);
};

const BUILDERS: Record<QuizKind, Builder> = {
  blank: blankQ, ox: oxQ, exact: exactQ, next: nextQ, first: firstQ, seam: seamQ, verseOrder: verseOrderQ,
  chunkOrder: chunkOrderQ, ref: refQ, wrong: wrongWordQ, pair: pairQ, bank: bankQ, type1: typeQ("type1"),
  type: typeQ("type"), finish: finishQ, quote: quoteQ,
};

const KIND_WEIGHT: Record<QuizKind, number> = {
  blank: 4, ox: 3, exact: 2, next: 3, first: 1, ref: 1, seam: 2, verseOrder: 2, chunkOrder: 2,
  wrong: 3, pair: 3, bank: 3, type1: 3, type: 4, finish: 3, quote: 1,
};

/**
 * Kinds for a verse at `level`: new ones (this level) most, the level below next, older ones a little.
 * A whole chapter leans on verse order, piece order and verse seams.
 */
function kindWeights(level: number, verses: number): { item: QuizKind; w: number }[] {
  return (Object.keys(KIND_WEIGHT) as QuizKind[])
    .filter((k) => KIND_LEVEL[k] <= level)
    .filter((k) => (k !== "seam" || verses >= 2) && (k !== "verseOrder" || verses >= 3))
    .map((k) => {
      const age = level - KIND_LEVEL[k];
      const chapter = verses >= 4 && (k === "seam" || k === "verseOrder" || k === "chunkOrder") ? 2 : 1;
      return { item: k, w: KIND_WEIGHT[k] * chapter * (age === 0 ? 3 : age === 1 ? 2 : 1) };
    });
}

/** One question about passage `p`, optionally aimed at word `focus` (a word I just missed). */
export function makeQuestion(p: DrillPassage, all: DrillPassage[], rng: Rng, focus?: number, kind?: QuizKind): Question | null {
  const m = material(p, all);
  if (!m.words.length) return null;
  for (let tries = 0; tries < 10; tries++) {
    const i = focus !== undefined && focus < m.words.length && tries < 5 ? focus : pickWord(p, rng, all);
    const level = verseLevel(p, verseAt(m.vs, i));
    const k = (tries === 0 && kind) || weighted(rng, kindWeights(level, m.vs.length))!;
    const q = BUILDERS[k](p, m, i, rng, all);
    if (q) return q;
  }
  return null;
}

/**
 * Verses `from`..`to` (positions, inclusive) as a passage of their own, for drilling one stretch.
 * Word positions in it are `offset` less than in the whole passage.
 */
export function subPassage<T extends DrillPassage>(p: T, from: number, to: number): { passage: T; offset: number; verseOffset: number } {
  const vs = splitVerses(p.body).slice(from, to + 1);
  if (!vs.length) return { passage: p, offset: 0, verseOffset: 0 };
  const offset = vs[0].start;
  const end = offset + vs.reduce((s, v) => s + v.words.length, 0);
  const misses: Record<string, number> = {};
  for (const [k, n] of Object.entries(p.misses)) if (+k >= offset && +k < end) misses[+k - offset] = n;
  const progress: Record<string, VerseProgress> = {};
  for (const [k, v] of Object.entries(p.progress ?? {})) if (+k >= from && +k <= to) progress[+k - from] = v;
  const variants = (p.variants ?? []).filter((v) => v.start >= offset && v.end <= end)
    .map((v) => ({ ...v, start: v.start - offset, end: v.end - offset }));
  return {
    passage: { ...p, body: vs.map((v) => `${v.n} ${v.words.join(" ")}`).join("\n"), misses, progress, variants },
    offset, verseOffset: from,
  };
}

/** Passages I get wrong more often, and ones I haven't drilled yet, come up more. */
export function pickPassage<T extends DrillPassage & { correct: number; wrong: number }>(ps: T[], rng: Rng): T | null {
  return weighted(rng, ps.map((p) => {
    const seen = p.correct + p.wrong;
    const weak = Object.values(p.misses).reduce((s, n) => s + n, 0);
    return { item: p, w: 1 + (seen ? (3 * p.wrong) / seen : 1) + Math.min(weak, 10) * 0.2 };
  }));
}

/** One answer's effect on a passage's counts and verse levels; same arithmetic as the record_memory_result RPC. */
export function applyResult<T extends DrillPassage & { correct: number; wrong: number }>(
  p: T, ok: boolean, hit: number[], miss: number[], verses: number[] = [], recall = false,
): T {
  const misses = { ...p.misses };
  for (const w of hit) misses[w] = (misses[w] ?? 0) - 1;
  for (const w of miss) misses[w] = (misses[w] ?? 0) + 1;
  for (const k of Object.keys(misses)) if (misses[k] <= 0) delete misses[k];
  const progress = { ...p.progress };
  for (const v of verses) progress[v] = nextProgress(progress[v], ok, recall);
  return { ...p, misses, progress, correct: p.correct + (ok ? 1 : 0), wrong: p.wrong + (ok ? 0 : 1) };
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
