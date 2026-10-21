// Copies NIV / AMP / MSG from API.Bible into Supabase, one chapter per request.
//
//   node scripts/fetch-apibible.ts --list                 # Bibles your key can access
//   node scripts/fetch-apibible.ts --dry-run PHP.4        # fetch one chapter and print it (no DB write)
//   node scripts/fetch-apibible.ts                        # all of NIV, AMP, MSG (resumes where it stopped)
//   node scripts/fetch-apibible.ts --only MSG             # one version
//   node scripts/fetch-apibible.ts --map NIV=<bibleId>    # override automatic bibleId matching
//
// API.Bible asks that cached text be cleared within 14 days: run scripts/purge-apibible.ts.
// Free plan: 5,000 requests/day; 3 versions × 1,189 chapters = 3,567 requests.
// Progress is kept in data/private/apibible-progress.json (git-ignored), so a rerun skips finished chapters.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { BOOKS } from "../src/data/books.ts";
import { type ApiNode, parseChapter } from "./apibible-parse.ts";
import { adminClient, fail, secret, upsert } from "./lib.ts";

const API = "https://rest.api.bible/v1";
// sort: display order after 개역한글 (0)
const VERSIONS = [
  { code: "AMP", name: "AMP", match: /^AMP|amplified/i, sort: 1 },
  { code: "MSG", name: "MSG", match: /^MSG|message/i, sort: 2 },
  { code: "NIV", name: "NIV", match: /^NIV/i, sort: 3 },
];
const PROGRESS = "data/private/apibible-progress.json";
const CONCURRENCY = 3;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const key = await secret("APIBIBLE_KEY", "API.Bible 키를 붙여넣고 Enter (화면에 표시되지 않음): ");

async function api<T>(path: string, attempt = 1): Promise<T> {
  const res = await fetch(API + path, { headers: { "api-key": key } });
  if (res.status === 401 || res.status === 403) fail(`API.Bible 인증 실패 (${res.status}). 키와 번역본 접근 권한을 확인하세요.`);
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const wait = 2000 * attempt;
    console.warn(`  ${res.status} → ${wait / 1000}초 후 재시도`);
    await new Promise((r) => setTimeout(r, wait));
    return api(path, attempt + 1);
  }
  if (res.status === 404) throw Object.assign(new Error("not found"), { notFound: true });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

interface Bible { id: string; abbreviation: string; abbreviationLocal: string; name: string; nameLocal: string; language: { id: string } }

const bibles = (await api<{ data: Bible[] }>("/bibles")).data;
if (flag("--list")) {
  for (const b of bibles) console.log(`${b.id}  ${b.abbreviationLocal || b.abbreviation}  ${b.nameLocal || b.name}  [${b.language.id}]`);
  process.exit(0);
}

// Resolve bibleIds: --map overrides, else match by abbreviation (English Bibles only)
const overrides = Object.fromEntries((opt("--map") ?? "").split(",").filter(Boolean).map((p) => p.split("=")));
const targets = VERSIONS.filter((v) => !opt("--only") || v.code === opt("--only")).map((v) => {
  const id = overrides[v.code] ?? bibles.find((b) => b.language.id === "eng" &&
    (v.match.test(b.abbreviationLocal) || v.match.test(b.abbreviation) || v.match.test(b.name)))?.id;
  if (!id) fail(`${v.code}에 해당하는 번역본을 찾지 못했습니다. --list로 확인한 뒤 --map ${v.code}=<bibleId>로 지정하세요.`);
  return { ...v, bibleId: id };
});

async function fetchChapter(bibleId: string, chapterId: string) {
  const q = "content-type=json&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=false&include-verse-spans=false";
  const r = await api<{ data: { content: ApiNode[]; copyright?: string } }>(`/bibles/${bibleId}/chapters/${chapterId}?${q}`);
  return { verses: parseChapter(r.data.content), copyright: r.data.copyright };
}

if (flag("--dry-run")) {
  const chapterId = args[args.indexOf("--dry-run") + 1] ?? "PHP.4";
  for (const t of targets) {
    const { verses, copyright } = await fetchChapter(t.bibleId, chapterId);
    console.log(`\n== ${t.code} (${t.bibleId}) ${chapterId}: ${verses.size}절`);
    for (const [n, v] of verses) console.log(`${v.end ? `${n}-${v.end}` : n}\t${v.text}`);
    console.log(`© ${copyright ?? "(없음)"}`);
  }
  process.exit(0);
}

// --- full copy -------------------------------------------------------------
const progress: Record<string, string[]> = existsSync(PROGRESS) ? JSON.parse(readFileSync(PROGRESS, "utf8")) : {};
const saveProgress = () => { mkdirSync("data/private", { recursive: true }); writeFileSync(PROGRESS, JSON.stringify(progress)); };

const sb = await adminClient();
const chapters = BOOKS.flatMap((b) => Array.from({ length: b.chapters }, (_, i) => ({ book: b.id, chapter: i + 1 })));

for (const t of targets) {
  const done = new Set(progress[t.code] ?? []);
  const todo = chapters.filter((c) => !done.has(`${c.book}.${c.chapter}`));
  console.log(`\n${t.code}: ${chapters.length - todo.length}/${chapters.length}장 완료됨, ${todo.length}장 남음`);
  let copyright: string | undefined;
  let count = 0;

  const worker = async () => {
    for (let c = todo.shift(); c; c = todo.shift()) {
      const id = `${c.book}.${c.chapter}`;
      try {
        const r = await fetchChapter(t.bibleId, id);
        copyright ??= r.copyright;
        const now = new Date().toISOString();
        const rows = [...r.verses].map(([verse, v]) => ({
          version: t.code, book: c.book, chapter: c.chapter, verse, text: v.text, verse_end: v.end ?? null, fetched_at: now,
        }));
        if (rows.length) await upsert(sb, "verses", rows, "version,book,chapter,verse", true);
      } catch (e) {
        if (!(e as { notFound?: boolean }).notFound) { console.error(`  ${t.code} ${id} 실패: ${(e as Error).message}`); continue; }
        console.warn(`  ${t.code} ${id}: 이 번역본에 없는 장`);
      }
      (progress[t.code] ??= []).push(id);
      if (++count % 50 === 0) { saveProgress(); console.log(`  ${t.code} ${count}장…`); }
    }
  };

  // versions row first so verses' foreign key holds
  await upsert(sb, "versions", [{ code: t.code, name: t.name, lang: "en", translatable: true, sort: t.sort, source: "apibible", source_id: t.bibleId }], "code", true);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  saveProgress();
  if (copyright) await sb.from("versions").update({ copyright }).eq("code", t.code);
  console.log(`${t.code}: 완료`);
}
console.log("\n다 됐습니다. 14일 안에 node scripts/purge-apibible.ts 로 지우세요.");
