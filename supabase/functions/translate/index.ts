// Machine-translates verses with the requested engine and stores one row per (verse, engine) as "machine".
// Verses that already have a translation from that engine are skipped; nothing is ever overwritten.
//
// Engines and their secrets:
//   google-v2  GOOGLE_TRANSLATE_API_KEY
//   google-v3  GOOGLE_SERVICE_ACCOUNT (service account key JSON), GOOGLE_TRANSLATE_MODEL = nmt | llm
//   claude     ANTHROPIC_API_KEY  (model claude-sonnet-5-5)
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_ENGINE, ClaudeError, translateClaude } from "./claude.ts";
import { translateV2 } from "./googleV2.ts";
import { batches, GoogleError, type ServiceAccount, translateV3, type V3Model } from "./googleV3.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface Ref { book: string; chapter: number; verse: number }
interface Source extends Ref { version: string; text: string; verse_end?: number | null }
type Engine = "google-v2" | "google-v3" | "claude";
const ENGINES: Engine[] = ["google-v2", "google-v3", "claude"];
const MAX_REFS = 200;
const key = (r: Ref) => `${r.book}.${r.chapter}.${r.verse}`;

class ConfigError extends Error {}

function serviceAccount(): ServiceAccount {
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
  if (!raw) throw new ConfigError("GOOGLE_SERVICE_ACCOUNT가 설정되지 않았습니다");
  let sa;
  try { sa = JSON.parse(raw); } catch { throw new ConfigError("GOOGLE_SERVICE_ACCOUNT가 올바른 JSON이 아닙니다"); }
  if (!sa.project_id || !sa.client_email || !sa.private_key) throw new ConfigError("GOOGLE_SERVICE_ACCOUNT에 project_id, client_email, private_key가 없습니다");
  return sa;
}

/** The engine name stored with each row, specific enough to compare models. */
function storedName(engine: Engine) {
  if (engine === "google-v2") return "google-v2";
  if (engine === "google-v3") return `google-v3-${Deno.env.get("GOOGLE_TRANSLATE_MODEL") === "llm" ? "llm" : "nmt"}`;
  return CLAUDE_ENGINE;
}

/** Returns Korean text per source, in the same order. */
async function translate(engine: Engine, sources: Source[], lang: string, sb: SupabaseClient): Promise<string[]> {
  if (engine === "google-v2") {
    const apiKey = Deno.env.get("GOOGLE_TRANSLATE_API_KEY");
    if (!apiKey) throw new ConfigError("GOOGLE_TRANSLATE_API_KEY가 설정되지 않았습니다");
    const out: string[] = [];
    for (const b of batches(sources, 100)) out.push(...await translateV2(b.map((v) => v.text), { key: apiKey, source: lang, target: "ko" }));
    return out;
  }
  if (engine === "google-v3") {
    const sa = serviceAccount();
    const model: V3Model = Deno.env.get("GOOGLE_TRANSLATE_MODEL") === "llm" ? "llm" : "nmt";
    const out: string[] = [];
    for (const b of batches(sources)) out.push(...await translateV3(b.map((v) => v.text), { sa, model, source: lang, target: "ko" }));
    return out;
  }

  // Claude: per chapter, with neighbouring verses as context and the 개역한글 text for names and terms
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new ConfigError("ANTHROPIC_API_KEY가 설정되지 않았습니다");
  const client = new Anthropic({ apiKey });
  const result = new Map<string, string>();
  const chapters = new Map<string, Source[]>();
  for (const s of sources) {
    const k = `${s.book}.${s.chapter}`;
    chapters.set(k, [...(chapters.get(k) ?? []), s]);
  }
  for (const group of chapters.values()) {
    const { book, chapter, version } = group[0];
    const nums = group.map((s) => s.verse);
    const lo = Math.min(...nums) - 3, hi = Math.max(...nums) + 3;
    const { data: around, error } = await sb.from("verses").select("version,verse,text")
      .in("version", [version, "KRV"]).eq("book", book).eq("chapter", chapter).gte("verse", lo).lte("verse", hi);
    if (error) throw new Error(error.message);
    const krv = new Map((around ?? []).filter((v) => v.version === "KRV").map((v) => [v.verse as number, v.text as string]));
    const krvFor = (s: Source) => {
      const last = s.verse_end ?? s.verse;
      const parts = [];
      for (let n = s.verse; n <= last; n++) if (krv.has(n)) parts.push(krv.get(n));
      return parts.join(" ") || undefined;
    };
    const context = (around ?? [])
      .filter((v) => v.version === version && !nums.includes(v.verse as number))
      .map((v) => ({ verse: v.verse as number, text: v.text as string }))
      .sort((a, b) => a.verse - b.verse);
    for (const part of batches(group, 40, 12_000)) {
      const out = await translateClaude(client, {
        version, book, chapter, context,
        targets: part.map((s) => ({ verse: s.verse, verseEnd: s.verse_end, text: s.text, krv: krvFor(s) })),
      });
      for (const s of part) result.set(key(s), out.get(s.verse)!);
    }
  }
  return sources.map((s) => result.get(key(s))!);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "로그인이 필요합니다" }, 401);
  // Acts as the signed-in user, so RLS (app_users only) applies to every query below
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "로그인이 필요합니다" }, 401);

  let version: string, refs: Ref[], engine: Engine;
  try {
    const body = await req.json();
    ({ version, refs } = body);
    engine = body.engine ?? "google-v3";
    if (typeof version !== "string" || !Array.isArray(refs) || refs.length > MAX_REFS || !ENGINES.includes(engine)) throw new Error();
    refs = refs.map((r) => ({ book: String(r.book), chapter: Number(r.chapter), verse: Number(r.verse) }));
  } catch {
    return json({ error: `version, refs(최대 ${MAX_REFS}개), engine(${ENGINES.join(" | ")})이 필요합니다` }, 400);
  }

  const { data: ver, error: verErr } = await sb.from("versions").select("lang,translatable").eq("code", version).maybeSingle();
  if (verErr) return json({ error: verErr.message }, 500);
  if (!ver?.translatable) return json({ error: "번역 대상이 아닌 번역본입니다" }, 400);

  const name = storedName(engine);
  const { data: existing, error: exErr } = await sb.rpc("translations_for_refs", { ver: version, refs });
  if (exErr) return json({ error: exErr.message }, 500);
  const have = new Set((existing ?? []).filter((t: { engine: string }) => t.engine === name).map(key));
  const missing = refs.filter((r) => !have.has(key(r)));
  if (!missing.length) return json({ translations: [] });

  const { data: src, error: srcErr } = await sb.rpc("verses_for_refs", { refs: missing });
  if (srcErr) return json({ error: srcErr.message }, 500);
  const sources = ((src ?? []) as Source[]).filter((v) => v.version === version);
  if (!sources.length) return json({ translations: [] });

  let texts: string[];
  try {
    texts = await translate(engine, sources, ver.lang, sb);
  } catch (e) {
    if (e instanceof ConfigError) return json({ error: e.message }, 500);
    const status = e instanceof GoogleError || e instanceof ClaudeError ? e.status : 0;
    const who = engine === "claude" ? "Claude" : "Google";
    console.error(`${name} ${status}: ${(e as Error).message}`);
    return json({ error: `${who} 번역 오류${status ? ` (${status})` : ""}: ${(e as Error).message}` }, 502);
  }

  const rows = sources.map((v, i) => ({
    version, book: v.book, chapter: v.chapter, verse: v.verse, lang: "ko",
    text: texts[i], status: "machine", edited: false, engine: name,
  }));
  // ignoreDuplicates: a concurrent request may have stored some of these already; keep that one
  const { data: saved, error: saveErr } = await sb.from("translations")
    .upsert(rows, { onConflict: "version,book,chapter,verse,lang,engine", ignoreDuplicates: true })
    .select("version,book,chapter,verse,text,status,edited,engine");
  if (saveErr) return json({ error: saveErr.message }, 500);

  return json({ translations: saved ?? [] });
});
