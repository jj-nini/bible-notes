// Near-miss variants for memorize drills, made once per passage with the local Claude Code CLI (`claude -p`).
// "Grammatical but not the text": what someone reciting from memory might actually say instead.
// The drills use them as wrong choices before falling back to look-alike words from the chapter.
//
//   node scripts/memory-variants.ts            passages that have none yet
//   node scripts/memory-variants.ts --force    every passage again
//   node scripts/memory-variants.ts --plan     list what would be sent, send nothing
//
// Reads and writes memory_passages with the service_role key (hidden prompt). No API key: Claude Code login.
import { createInterface } from "node:readline/promises";
import { splitVerses, norm, type Variant, type VerseLine } from "../src/lib/memorize.ts";
import { cliArgs, parseCliJson, spawnClaude, UsageLimitError } from "./claude-cli.ts";
import { adminClient } from "./lib.ts";

export const VARIANT_SYSTEM = `당신은 성경 암송 퀴즈 출제자입니다. 사용자가 직접 입력한 본문을 받아, 암송하는 사람이 실제로 헷갈려 말할 법한 "그럴듯한 오답"을 만듭니다.

규칙:
- from: 원문 절에 있는 연속된 어절을 글자 하나 바꾸지 말고 그대로 복사합니다(1~4어절).
- to: from 대신 잘못 외워 말할 법한 표현. 문법적으로 자연스러운 한국어여야 하고, 원문과 글자가 달라야 합니다.
- 실제 암송 실수처럼: 비슷한 뜻의 다른 낱말(지키라→간직하라), 같은 장 다른 절의 표현이 섞임, 조사·어미가 다르지만 말이 되는 것(네게서→너에게서), 어순 바뀜, 높임·시제 차이.
- 문법이 깨지는 변형(말노라, 명령 지키라)은 만들지 않습니다. 너무 쉽게 틀린 줄 아는 엉뚱한 말도 피합니다.
- 절마다 3~5개. 절 번호는 주어진 n 그대로 씁니다.`;

const SCHEMA = {
  type: "object",
  properties: {
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: { verse: { type: "integer" }, from: { type: "string" }, to: { type: "string" } },
        required: ["verse", "from", "to"],
        additionalProperties: false,
      },
    },
  },
  required: ["variants"],
  additionalProperties: false,
};

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);

export function buildVariantMessage(ref: string, vs: VerseLine[]) {
  return [
    `<passage ref="${esc(ref)}">`,
    ...vs.map((v, k) => `<verse n="${k + 1}">${esc(v.words.join(" "))}</verse>`),
    "</passage>",
    "",
    `Make near-miss variants for each of the ${vs.length} verse(s).`,
  ].join("\n");
}

/**
 * Keeps only variants whose `from` is really a run of words in that verse, and whose `to` differs from it.
 * Returns them as word positions in the whole passage.
 */
export function toVariants(vs: VerseLine[], raw: { verse: number; from: string; to: string }[]): Variant[] {
  const out: Variant[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const v = vs[r.verse - 1];
    const from = r.from.trim().split(/\s+/).filter(Boolean);
    const to = r.to.trim();
    if (!v || !from.length || !to || norm(to) === norm(from.join(""))) continue;
    if (to.split(/\s+/).length > from.length + 3) continue;
    let at = -1;
    for (let i = 0; i + from.length <= v.words.length && at < 0; i++) {
      if (from.every((w, k) => v.words[i + k] === w)) at = i;
    }
    if (at < 0) continue; // not copied exactly: can't place it
    const key = `${v.start + at}:${from.length}:${norm(to)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ start: v.start + at, end: v.start + at + from.length, text: to });
  }
  return out;
}

async function main() {
  const force = process.argv.includes("--force");
  const plan = process.argv.includes("--plan");
  const sb = await adminClient();
  const { data, error } = await sb.from("memory_passages").select("id,ref,body,variants").order("created_at");
  if (error) throw new Error(error.message);
  const todo = data.filter((p) => force || !(p.variants as Variant[]).length);
  const chars = todo.reduce((s, p) => s + p.body.length, 0);
  console.log(`대상 ${todo.length}개 본문 (전체 ${data.length}개), 본문 ${chars.toLocaleString()}자 · claude -p ${todo.length}회`);
  for (const p of todo) console.log(`  - ${p.ref}: ${splitVerses(p.body).length}절`);
  if (plan || !todo.length) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const yes = /^y/i.test(await rl.question("시작할까요? (y/N) "));
  rl.close();
  if (!yes) return;

  let cost = 0;
  for (const p of todo) {
    const vs = splitVerses(p.body);
    try {
      const j = await spawnClaude(cliArgs(VARIANT_SYSTEM, SCHEMA), buildVariantMessage(p.ref, vs), parseCliJson);
      const raw = j.structured_output?.variants ?? [];
      const variants = toVariants(vs, raw);
      cost += j.total_cost_usd ?? 0;
      const { error: e } = await sb.from("memory_passages").update({ variants }).eq("id", p.id);
      if (e) throw new Error(e.message);
      console.log(`${p.ref}: ${variants.length}개 저장 (받은 ${raw.length}개 중 원문과 맞는 것) · $${(j.total_cost_usd ?? 0).toFixed(3)}`);
      for (const v of variants.slice(0, 4)) console.log(`    ${vs.flatMap((x) => x.words).slice(v.start, v.end).join(" ")} → ${v.text}`);
    } catch (e) {
      if (e instanceof UsageLimitError) { console.error(`사용량 한도: ${e.message}\n한도가 풀린 뒤 다시 실행하면 남은 본문부터 이어서 합니다.`); break; }
      console.error(`${p.ref}: 실패 — ${(e as Error).message}`);
    }
  }
  console.log(`끝 · 사용량 환산 약 $${cost.toFixed(3)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
