// Shared helpers for the data scripts (run with plain `node`, Node 22+).
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Reads a line without echoing it, so secrets stay off the screen and out of shell history. */
export async function askHidden(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write(prompt);
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
  // Ctrl+C / Ctrl+D would otherwise leave the question pending and Node exits mid-await
  rl.on("SIGINT", () => {
    process.stdout.write("\n취소했습니다.\n");
    process.exit(130);
  });
  let answered = false;
  const answer = await new Promise<string>((resolve) => {
    rl.question("", (a) => { answered = true; resolve(a); });
    rl.on("close", () => { if (!answered) resolve(""); });
  });
  rl.close();
  process.stdout.write("\n");
  return answer.trim();
}

export function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** Env var, else a hidden prompt when run from a terminal. */
export async function secret(envName: string, prompt: string): Promise<string> {
  const v = process.env[envName];
  if (v) return v.trim();
  if (!process.stdin.isTTY) fail(`${envName}를 지정하세요 (터미널에서 직접 실행하면 입력을 물어봅니다).`);
  const answer = await askHidden(prompt);
  if (!answer) fail("값이 비어 있습니다.");
  return answer;
}

/** Rejects the public (anon/publishable) key, which RLS would block from writing anyway. */
function looksPublic(key: string) {
  if (key.startsWith("sb_publishable_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()).role !== "service_role";
  } catch {
    return false;
  }
}

/** Service-role client. URL from SUPABASE_URL or .env.local; key from env or a hidden prompt. */
export async function adminClient(): Promise<SupabaseClient> {
  if (!process.env.SUPABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!url) fail("Supabase 주소를 찾지 못했습니다. .env.local에 VITE_SUPABASE_URL을 넣거나 SUPABASE_URL을 지정하세요.");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) console.log(`Supabase 대상: ${url}`);
  const key = await secret("SUPABASE_SERVICE_ROLE_KEY", "Supabase service_role(secret) 키를 붙여넣고 Enter (화면에 표시되지 않음): ");
  if (looksPublic(key)) fail("anon/publishable 키입니다. Project Settings → API Keys의 service_role(secret) 키가 필요합니다.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function upsert(sb: SupabaseClient, table: string, rows: object[], onConflict: string, quiet = false) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  if (!quiet) console.log(`${table}: ${rows.length}`);
}
