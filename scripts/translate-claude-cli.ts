// Batch-translates a version into Korean with the local Claude Code CLI (`claude -p`, Sonnet) and stores
// the rows as engine "claude-sonnet-5-5", the same engine the app's [+ Claude] button uses.
//
//   node scripts/translate-claude-cli.ts MSG              # whole version
//   node scripts/translate-claude-cli.ts MSG PHP JHN.3    # some books / chapters
//   node scripts/translate-claude-cli.ts AMP NT           # New Testament (OT = Old Testament)
//   node scripts/translate-claude-cli.ts MSG --plan       # only show what would be translated
//   node scripts/translate-claude-cli.ts MSG --yes        # skip the confirmation
//   node scripts/translate-claude-cli.ts MSG --parallel=5 # claude -p processes at once (default 1, max 8)
//
// Only verses with no Claude translation yet are sent, so a rerun continues where it stopped
// (e.g. after hitting the Claude usage limit). Existing translations, confirmed ones included, are never changed.
import { createInterface } from "node:readline/promises";
import { BOOKS } from "../src/data/books.ts";
import { CLAUDE_ENGINE, CLAUDE_MODEL } from "../supabase/functions/translate/claude.ts";
import { type CliTarget, cliKey, runClaudeCli, UsageLimitError } from "./claude-cli.ts";
import { adminClient, fail } from "./lib.ts";

const MAX_CHARS = 12_000; // English characters per call, several chapters of one book
const MAX_VERSES = 150;

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith("--"));
if (!version) fail("usage: node scripts/translate-claude-cli.ts <VERSION> [NT | OT | BOOK | BOOK.CH ...] [--plan] [--yes]");
const scope = args.filter((a) => !a.startsWith("--") && a !== version);
const planOnly = args.includes("--plan");
const yes = args.includes("--yes");
const parallelArg = args.find((a) => a.startsWith("--parallel"));
const parallel = Math.max(1, Math.min(8, Number(parallelArg?.split("=")[1] ?? 1) || 1));
const testament = new Map(BOOKS.map((b) => [b.id, b.testament]));
const inScope = (book: string, chapter: number) =>
  !scope.length || scope.some((s) => s === book || s === `${book}.${chapter}` || s === testament.get(book));

const sb = await adminClient();

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) fail(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

interface V { book: string; chapter: number; verse: number; verse_end: number | null; text: string }
console.log(`${version} 본문과 개역한글, 기존 Claude 번역을 불러오는 중…`);
const [src, krv, done] = await Promise.all([
  all<V>((a, b) => sb.from("verses").select("book,chapter,verse,verse_end,text").eq("version", version).order("book").order("chapter").order("verse").range(a, b)),
  all<V>((a, b) => sb.from("verses").select("book,chapter,verse,text").eq("version", "KRV").order("book").order("chapter").order("verse").range(a, b)),
  all<{ book: string; chapter: number; verse: number }>((a, b) =>
    sb.from("translations").select("book,chapter,verse").eq("version", version).eq("engine", CLAUDE_ENGINE).range(a, b)),
]);
if (!src.length) fail(`${version} 본문이 DB에 없습니다.`);

const krvMap = new Map(krv.map((v) => [`${v.book}.${v.chapter}.${v.verse}`, v.text]));
const doneSet = new Set(done.map((d) => `${d.book}.${d.chapter}.${d.verse}`));
const krvFor = (v: V) => {
  const parts = [];
  for (let n = v.verse; n <= (v.verse_end ?? v.verse); n++) {
    const t = krvMap.get(`${v.book}.${v.chapter}.${n}`);
    if (t) parts.push(t);
  }
  return parts.join(" ") || undefined;
};

// Calls: consecutive chapters of the same book, up to MAX_CHARS / MAX_VERSES each, in canonical order
const order = new Map(BOOKS.map((b, i) => [b.id, i]));
const todo = src
  .filter((v) => inScope(v.book, v.chapter) && !doneSet.has(`${v.book}.${v.chapter}.${v.verse}`))
  .sort((a, b) => order.get(a.book)! - order.get(b.book)! || a.chapter - b.chapter || a.verse - b.verse);
const calls: { book: string; targets: (CliTarget & { v: V })[] }[] = [];
for (const v of todo) {
  let cur = calls[calls.length - 1];
  const size = cur ? cur.targets.reduce((n, t) => n + t.text.length, 0) : 0;
  if (!cur || cur.book !== v.book || cur.targets.length >= MAX_VERSES || size + v.text.length > MAX_CHARS) {
    cur = { book: v.book, targets: [] };
    calls.push(cur);
  }
  cur.targets.push({ chapter: v.chapter, verse: v.verse, verseEnd: v.verse_end, text: v.text, krv: krvFor(v), v });
}

const chars = todo.reduce((n, v) => n + v.text.length, 0);
const chapters = new Set(todo.map((v) => `${v.book}.${v.chapter}`)).size;
console.log(`\n번역할 것: ${chapters}장 · ${todo.length}절 · 영어 ${chars.toLocaleString()}자 → claude -p ${calls.length}회 (${CLAUDE_MODEL})`);
console.log(`이미 Claude 번역이 있는 절: ${doneSet.size.toLocaleString()}절 (건너뜀)`);
// Measured: 2 MSG verses, ~600 English characters → $0.012 (output dominates)
console.log(`예상 사용량: API 요금 환산 약 $${(chars / 1000 * 0.02).toFixed(0)} (시험 호출 기준, 실제와 다를 수 있음)`);
if (!calls.length) { console.log("할 일이 없습니다."); process.exit(0); }
if (planOnly) process.exit(0);
if (!yes) {
  if (!process.stdin.isTTY) fail("확인이 필요합니다. 터미널에서 실행하거나 --yes를 붙이세요.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Claude Code 사용량을 씁니다. 진행할까요? (y/N) ");
  rl.close();
  if (answer.trim().toLowerCase() !== "y") fail("취소했습니다.");
}

// Several `claude -p` processes at once; each result is saved as soon as it arrives
let spent = 0, saved = 0, finished = 0, failed = 0;
let limitHit: string | null = null;
let next = 0;
const t0 = Date.now();
console.log(`동시 실행: ${parallel}개`);

async function worker() {
  while (!limitHit && next < calls.length) {
    const i = next++;
    const call = calls[i];
    const first = call.targets[0], last = call.targets[call.targets.length - 1];
    const label = `[${i + 1}/${calls.length}] ${call.book} ${first.chapter}${last.chapter !== first.chapter ? `–${last.chapter}` : ""}장 ${call.targets.length}절`;
    try {
      const r = await runClaudeCli({ version, book: call.book, targets: call.targets });
      if (!r.model.includes(CLAUDE_MODEL)) fail(`${label}: 예상과 다른 모델로 응답했습니다 (${r.model.join(", ")}). 중단합니다.`);
      const rows = call.targets.map((t) => ({
        version, book: call.book, chapter: t.chapter, verse: t.verse, lang: "ko",
        text: r.texts.get(cliKey(t.chapter, t.verse))!, status: "machine", edited: false, engine: CLAUDE_ENGINE,
      }));
      const { error } = await sb.from("translations")
        .upsert(rows, { onConflict: "version,book,chapter,verse,lang,engine", ignoreDuplicates: true });
      if (error) fail(`${label}: 저장 실패: ${error.message}`);
      spent += r.costUsd;
      saved += rows.length;
      finished++;
      const mins = (Date.now() - t0) / 60_000;
      const eta = finished ? Math.round((mins / finished) * (calls.length - finished - failed)) : 0;
      console.log(`${label} 저장 · $${r.costUsd.toFixed(3)} (누적 $${spent.toFixed(2)} · 남은 시간 약 ${eta}분)`);
    } catch (e) {
      if (e instanceof UsageLimitError) {
        limitHit ??= e.message; // other workers finish their current call, then stop
        return;
      }
      failed++;
      console.log(`${label} 실패: ${(e as Error).message} (다음 실행 때 다시 시도)`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(parallel, calls.length) }, worker));
if (limitHit) {
  console.log(`\nClaude 사용량 한도: ${limitHit}\n여기까지 ${saved}절 저장했습니다. 한도가 풀린 뒤 같은 명령을 다시 실행하면 이어서 합니다.`);
  process.exit(2);
}
console.log(`\n완료: ${saved}절 저장${failed ? ` · 실패 ${failed}묶음 (다시 실행하면 재시도)` : ""} · 사용량 환산 $${spent.toFixed(2)}`);
