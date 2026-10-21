// Deletes text copied from API.Bible (versions with source = 'apibible').
//
//   node scripts/purge-apibible.ts                       # rows fetched more than 14 days ago
//   node scripts/purge-apibible.ts --all                 # every API.Bible row, regardless of age
//   node scripts/purge-apibible.ts --all --translations  # also the Korean translations made from them
//
// Clears data/private/apibible-progress.json for the purged versions so a later fetch refills them.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { adminClient, fail } from "./lib.ts";

const PROGRESS = "data/private/apibible-progress.json";
const all = process.argv.includes("--all");
const withTranslations = process.argv.includes("--translations");

const sb = await adminClient();
const { data: versions, error } = await sb.from("versions").select("code").eq("source", "apibible");
if (error) fail(error.message);
const codes = (versions ?? []).map((v) => v.code as string);
if (!codes.length) fail("API.Bible에서 가져온 번역본이 없습니다.");

const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
let q = sb.from("verses").delete({ count: "exact" }).in("version", codes);
if (!all) q = q.lt("fetched_at", cutoff);
const { count, error: delErr } = await q;
if (delErr) fail(delErr.message);
console.log(`본문 삭제: ${count ?? 0}절 (${codes.join(", ")}${all ? ", 전체" : ", 14일 지난 것"})`);

if (withTranslations) {
  const { count: tc, error: tErr } = await sb.from("translations").delete({ count: "exact" }).in("version", codes);
  if (tErr) fail(tErr.message);
  console.log(`한글 번역 삭제: ${tc ?? 0}절`);
}

// Purged chapters must be fetched again next time
if ((count ?? 0) > 0 && existsSync(PROGRESS)) {
  const p = JSON.parse(readFileSync(PROGRESS, "utf8"));
  for (const c of codes) delete p[c];
  writeFileSync(PROGRESS, JSON.stringify(p));
}
console.log("done");
