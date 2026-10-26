import { applyResult } from "../lib/memorize";
import {
  sampleMachineTranslations,
  sampleSynonyms,
  sampleTranslationSeed,
  sampleVerseTopics,
  sampleVerses,
  sampleVersions,
} from "./sample";
import { type EngineChoice, type MemoryPassage, type Repo, type Translation, type VerseRef, refKey, sameRef, trKey } from "./types";

const STORE_KEY = "bible-notes:sample-translations:v2";
const MEMORY_KEY = "bible-notes:sample-memory:v1";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** One row per verse per engine, like the DB. */
const rowKey = (t: Translation) => `${trKey(t.version, t)}|${t.engine}`;
/** What each engine "returns" in sample mode, so engines are told apart in the UI. */
const SAMPLE_ENGINE: Record<EngineChoice, { name: string; prefix: string }> = {
  "google-v3": { name: "google-v3-nmt", prefix: "" },
  "google-v2": { name: "google-v2", prefix: "[v2] " },
  claude: { name: "claude-sonnet-5-5", prefix: "[Claude] " },
};

function loadMemory(): MemoryPassage[] {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (raw) return JSON.parse(raw) as MemoryPassage[];
  } catch {
    /* storage unavailable */
  }
  return [];
}

/** Translation "DB" for sample mode, kept in this browser's localStorage. */
function loadStore(): Map<string, Translation> {
  const m = new Map(sampleTranslationSeed.map((t) => [rowKey(t), t]));
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) for (const t of JSON.parse(raw) as Translation[]) m.set(rowKey(t), t);
  } catch {
    /* storage unavailable: start from the seed */
  }
  return m;
}

export function createLocalRepo(): Repo {
  const store = loadStore();
  const persist = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify([...store.values()]));
    } catch {
      /* ignore */
    }
  };
  const missLog: string[] = [];
  let memory = loadMemory();
  const persistMemory = () => {
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
    } catch {
      /* ignore */
    }
  };

  return {
    mode: "local",
    async listVersions() {
      return sampleVersions;
    },
    async getChapter(version, book, chapter) {
      return sampleVerses
        .filter((v) => v.version === version && v.book === book && v.chapter === chapter)
        .sort((a, b) => a.verse - b.verse);
    },
    async getVersesForRefs(refs) {
      return sampleVerses.filter((v) => refs.some((r) => sameRef(r, v)));
    },
    async getSynonyms() {
      return sampleSynonyms;
    },
    async versesByTopics(topics, limit = 30) {
      const byRef = new Map<string, { ref: VerseRef; score: number; tags: Record<string, number> }>();
      for (const vt of sampleVerseTopics) {
        const k = refKey(vt);
        const e = byRef.get(k) ?? { ref: { book: vt.book, chapter: vt.chapter, verse: vt.verse }, score: 0, tags: {} };
        e.tags[vt.topic] = vt.weight;
        if (topics.includes(vt.topic)) e.score = Math.max(e.score, vt.weight);
        byRef.set(k, e);
      }
      return [...byRef.values()]
        .filter((e) => e.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((e) => ({ ...e.ref, score: e.score, tags: e.tags }));
    },
    async searchKeyword(q, limit = 50) {
      const needle = q.trim().toLowerCase();
      if (!needle) return [];
      const seen = new Map<string, VerseRef>();
      for (const v of sampleVerses) {
        if (v.text.toLowerCase().includes(needle)) seen.set(refKey(v), { book: v.book, chapter: v.chapter, verse: v.verse });
      }
      return [...seen.values()].slice(0, limit);
    },
    async randomTaggedVerse() {
      const refs = [...new Map(sampleVerseTopics.map((v) => [refKey(v), v])).values()];
      const r = refs[Math.floor(Math.random() * refs.length)];
      return r ? { book: r.book, chapter: r.chapter, verse: r.verse } : null;
    },
    async logSearchMiss(q) {
      if (!missLog.includes(q)) missLog.push(q);
    },
    async getTranslations(version, refs) {
      return [...store.values()].filter((t) => t.version === version && refs.some((r) => sameRef(r, t)));
    },
    async translateMissing(version, refs, onEach, opts = {}) {
      const eng = SAMPLE_ENGINE[opts.engine ?? "google-v3"];
      const has = (r: VerseRef) => store.has(`${trKey(version, r)}|${eng.name}`);
      const missing = refs.filter((r) => !has(r));
      if (!missing.length) return [];
      await delay(700); // pretend to call the translation API once for the batch
      const made = missing.map((r): Translation => ({
        version, book: r.book, chapter: r.chapter, verse: r.verse,
        status: "machine", edited: false, engine: eng.name,
        text: eng.prefix + (sampleMachineTranslations[trKey(version, r)] ?? "(샘플 데이터에 번역이 없습니다)"),
      }));
      made.forEach((t) => { store.set(rowKey(t), t); onEach?.(t); });
      persist();
      return made;
    },
    async fixTranslation(version, ref, engine) {
      const target = store.get(`${trKey(version, ref)}|${engine}`);
      if (!target) throw new Error("저장된 번역이 없습니다");
      for (const t of store.values()) {
        if (t.version === version && sameRef(t, ref) && t.status === "fixed") store.set(rowKey(t), { ...t, status: "machine" });
      }
      store.set(rowKey(target), { ...target, status: "fixed" });
      persist();
    },
    async unfixTranslation(version, ref, engine) {
      const t = store.get(`${trKey(version, ref)}|${engine}`);
      if (!t) throw new Error("저장된 번역이 없습니다");
      store.set(rowKey(t), { ...t, status: "machine" });
      persist();
    },
    async saveTranslationEdit(version, ref, text) {
      for (const t of store.values()) {
        if (t.version === version && sameRef(t, ref) && t.status === "fixed") store.set(rowKey(t), { ...t, status: "machine" });
      }
      const { book, chapter, verse } = ref;
      const t: Translation = { version, book, chapter, verse, text, status: "fixed", edited: true, engine: "manual" };
      store.set(rowKey(t), t);
      persist();
    },
    async listMemoryPassages() {
      return memory.map((p) => ({ ...p }));
    },
    async saveMemoryPassage({ id, ref, body }) {
      const old = id ? memory.find((p) => p.id === id) : undefined;
      if (id && !old) throw new Error("암송 본문을 찾을 수 없습니다");
      const p: MemoryPassage = old
        ? { ...old, ref, body, misses: old.body === body ? old.misses : {} }
        : { id: crypto.randomUUID(), ref, body, correct: 0, wrong: 0, misses: {}, created_at: new Date().toISOString() };
      memory = old ? memory.map((x) => (x.id === id ? p : x)) : [...memory, p];
      persistMemory();
      return { ...p };
    },
    async deleteMemoryPassage(id) {
      memory = memory.filter((p) => p.id !== id);
      persistMemory();
    },
    async recordMemoryResult(id, ok, hit, miss) {
      memory = memory.map((p) => (p.id === id ? applyResult(p, ok, hit, miss) : p));
      persistMemory();
    },
  };
}
