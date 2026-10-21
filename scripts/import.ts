// Loads versions, verses, and the topic dictionary into Supabase.
//
//   node scripts/import.ts --sample            # the bundled 10-verse sample
//   node scripts/import.ts data/private/x.json # your own data (keep it out of git)
//
// The Supabase URL comes from .env.local; the service-role key is asked for (or SUPABASE_SERVICE_ROLE_KEY).
// That key bypasses RLS: use it only on your own machine and never put it in the web app or in git.
//
// JSON shape (every key optional):
// {
//   "versions":    [{ "code": "KRV", "name": "개역개정", "lang": "ko", "translatable": false }],
//   "verses":      [{ "version": "KRV", "book": "PHP", "chapter": 4, "verse": 6, "text": "..." }],
//   "topics":      [{ "id": "염려", "description": "걱정과 불안" }],
//   "synonyms":    [{ "term": "걱정", "topic": "염려" }],
//   "verseTopics": [{ "book": "PHP", "chapter": 4, "verse": 6, "topic": "염려", "weight": 0.95 }]
// }
import { readFileSync } from "node:fs";
import { adminClient, upsert } from "./lib.ts";

interface Data {
  versions?: { code: string; name: string; lang: string; translatable: boolean }[];
  verses?: { version: string; book: string; chapter: number; verse: number; text: string }[];
  topics?: { id: string; description?: string }[];
  synonyms?: { term: string; topic: string }[];
  verseTopics?: { book: string; chapter: number; verse: number; topic: string; weight: number }[];
}

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/import.ts --sample | <file.json>");
  process.exit(1);
}

let data: Data;
if (arg === "--sample") {
  const s = await import("../src/data/sample/index.ts");
  data = {
    versions: s.sampleVersions,
    verses: s.sampleVerses,
    synonyms: s.sampleSynonyms,
    verseTopics: s.sampleVerseTopics,
  };
} else {
  data = JSON.parse(readFileSync(arg, "utf8"));
}

// Every topic referenced by synonyms or tags must exist
const topicIds = new Set([
  ...(data.topics ?? []).map((t) => t.id),
  ...(data.synonyms ?? []).map((s) => s.topic),
  ...(data.verseTopics ?? []).map((v) => v.topic),
]);
const topics = [...topicIds].map((id) => ({ id, description: data.topics?.find((t) => t.id === id)?.description ?? null }));

const sb = await adminClient();

await upsert(sb, "versions", (data.versions ?? []).map((v, i) => ({ ...v, sort: i })), "code");
await upsert(sb, "verses", data.verses ?? [], "version,book,chapter,verse");
await upsert(sb, "topics", topics, "id");
await upsert(sb, "topic_synonyms", (data.synonyms ?? []).map((s) => ({ term: s.term, topic_id: s.topic })), "term,topic_id");
await upsert(
  sb,
  "verse_topics",
  (data.verseTopics ?? []).map(({ topic, ...v }) => ({ ...v, topic_id: topic })),
  "book,chapter,verse,topic_id",
);
console.log("done");
