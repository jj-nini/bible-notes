import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareTranslator } from "../lib/browserTranslator";
import { translateInChunks } from "../lib/chunkTranslate";
import type { MemoryPassage, Repo, Translation, TranslationStatus, Verse, VerseRef, Version } from "./types";

interface TranslationRow {
  version: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  status: TranslationStatus;
  edited: boolean;
  engine: string;
}

const toRefs = (refs: VerseRef[]) => refs.map(({ book, chapter, verse }) => ({ book, chapter, verse }));
const toTranslation = (r: TranslationRow): Translation => ({ ...r });
// Escape LIKE wildcards so a "%" typed by the user is matched literally
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** "google" (default): Edge Function + Google Cloud Translation. "chrome": the browser's built-in translator. */
const TRANSLATOR = (import.meta.env.VITE_TRANSLATOR as string | undefined) === "chrome" ? "chrome" : "google";

/** The Edge Function puts a readable reason in its JSON body; surface that instead of "non-2xx status". */
async function functionError(err: { message: string; context?: unknown }) {
  const ctx = err.context as Response | undefined;
  try {
    const body = await ctx?.json();
    if (body?.error) return body.error as string;
  } catch {
    /* not JSON */
  }
  if (/Failed to send|fetch/i.test(err.message)) return "번역 함수(translate)를 찾을 수 없습니다. Edge Function을 배포했는지 확인하세요.";
  return err.message;
}

async function translateInBrowser(sb: SupabaseClient, version: string, refs: VerseRef[], onEach?: (t: Translation) => void) {
  const translator = await prepareTranslator("en", "ko");
  const sources = check<Verse[]>(await sb.rpc("verses_for_refs", { refs: toRefs(refs) }))
    .filter((v) => v.version === version)
    .sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);
  const made: Translation[] = [];
  // Blocks of consecutive verses, so the translator keeps register, names and pronouns consistent
  await translateInChunks(sources.map((v) => v.text), (s) => translator.translate(s), {
    onBlock: async (results) => {
      const rows = results.map(({ index, text }) => {
        const v = sources[index];
        return { version, book: v.book, chapter: v.chapter, verse: v.verse, lang: "ko", text, status: "machine" as const, edited: false, engine: "chrome-builtin" };
      });
      // ignoreDuplicates: another device may have stored some of these meanwhile; keep those
      check(await sb.from("translations").upsert(rows, { onConflict: "version,book,chapter,verse,lang,engine", ignoreDuplicates: true }));
      for (const row of rows) {
        const t = toTranslation(row);
        made.push(t);
        onEach?.(t);
      }
    },
  });
  return made;
}

const MEMORY_COLS = "id,ref,body,correct,wrong,misses,created_at";

export function createSupabaseRepo(sb: SupabaseClient): Repo {
  return {
    mode: "supabase",
    async listVersions() {
      return check<Version[]>(await sb.from("versions").select("code,name,lang,translatable,copyright").order("sort"));
    },
    async getChapter(version, book, chapter) {
      return check<Verse[]>(
        await sb.from("verses").select("version,book,chapter,verse,verse_end,text")
          .eq("version", version).eq("book", book).eq("chapter", chapter).order("verse"),
      );
    },
    async getVersesForRefs(refs) {
      if (!refs.length) return [];
      return check<Verse[]>(await sb.rpc("verses_for_refs", { refs: toRefs(refs) }));
    },
    async getSynonyms() {
      return check<{ term: string; topic_id: string }[]>(await sb.from("topic_synonyms").select("term,topic_id"))
        .map((r) => ({ term: r.term, topic: r.topic_id }));
    },
    async versesByTopics(topics, limit = 30) {
      if (!topics.length) return [];
      return check(await sb.rpc("verses_by_topics", { topic_ids: topics, max_results: limit }));
    },
    async searchKeyword(q, limit = 50) {
      const needle = q.trim();
      if (!needle) return [];
      const rows = check<VerseRef[]>(
        await sb.from("verses").select("book,chapter,verse").ilike("text", `%${escapeLike(needle)}%`).limit(limit * 4),
      );
      const seen = new Map(rows.map((r) => [`${r.book}.${r.chapter}.${r.verse}`, r]));
      return [...seen.values()].slice(0, limit);
    },
    async randomTaggedVerse() {
      const rows = check<VerseRef[]>(await sb.rpc("random_tagged_verse"));
      return rows[0] ?? null;
    },
    async logSearchMiss(q) {
      await sb.from("search_misses").insert({ query: q });
    },
    async getTranslations(version, refs) {
      if (!refs.length) return [];
      return check<TranslationRow[]>(await sb.rpc("translations_for_refs", { ver: version, refs: toRefs(refs) }))
        .map(toTranslation);
    },
    async translateMissing(version, refs, onEach, opts = {}) {
      if (!refs.length) return [];
      if (TRANSLATOR === "chrome") return translateInBrowser(sb, version, refs, onEach);
      // Google v2 / v3 or Claude via the "translate" Edge Function (it stores the rows itself)
      const res = await sb.functions.invoke<{ translations: TranslationRow[] }>("translate", {
        body: { version, refs: toRefs(refs), engine: opts.engine ?? "google-v3" },
      });
      if (res.error) throw new Error(await functionError(res.error));
      const made = (res.data?.translations ?? []).map(toTranslation);
      made.forEach((t) => onEach?.(t));
      return made;
    },
    async fixTranslation(version, ref, engine) {
      check(await sb.rpc("fix_translation", { ver: version, b: ref.book, c: ref.chapter, v: ref.verse, eng: engine }));
    },
    async unfixTranslation(version, ref, engine) {
      check(await sb.from("translations").update({ status: "machine" })
        .eq("version", version).eq("book", ref.book).eq("chapter", ref.chapter).eq("verse", ref.verse)
        .eq("lang", "ko").eq("engine", engine));
    },
    async saveTranslationEdit(version, ref, text) {
      check(await sb.rpc("save_manual_translation", { ver: version, b: ref.book, c: ref.chapter, v: ref.verse, txt: text }));
    },
    async listMemoryPassages() {
      return check<MemoryPassage[]>(await sb.from("memory_passages").select(MEMORY_COLS).order("created_at"));
    },
    async saveMemoryPassage({ id, ref, body }) {
      // user_id defaults to auth.uid(); a trigger clears misses when the body changes
      const q = id
        ? sb.from("memory_passages").update({ ref, body }).eq("id", id)
        : sb.from("memory_passages").insert({ ref, body });
      return check<MemoryPassage>(await q.select(MEMORY_COLS).single());
    },
    async deleteMemoryPassage(id) {
      check(await sb.from("memory_passages").delete().eq("id", id));
    },
    async recordMemoryResult(id, ok, hit, miss) {
      check(await sb.rpc("record_memory_result", { pid: id, ok, hit, miss }));
    },
  };
}
