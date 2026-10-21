// Runs one translation request through the local Claude Code CLI (`claude -p`) and parses the result.
// Uses the Claude Code login on this machine — no API key. Same prompt as the Edge Function's Claude engine.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { SYSTEM } from "../supabase/functions/translate/claude.ts";

export interface CliTarget { chapter: number; verse: number; verseEnd?: number | null; text: string; krv?: string }
export interface CliJob { version: string; book: string; targets: CliTarget[] }
export interface CliResult { texts: Map<string, string>; costUsd: number; model: string[] }

export class UsageLimitError extends Error {}

const SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: { chapter: { type: "integer" }, verse: { type: "integer" }, text: { type: "string" } },
        required: ["chapter", "verse", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["translations"],
  additionalProperties: false,
};

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
export const cliKey = (chapter: number, verse: number) => `${chapter}:${verse}`;

/** Several chapters of one book in one message; each verse is addressed by chapter + n. */
export function buildCliMessage(job: CliJob) {
  const byChapter = new Map<number, CliTarget[]>();
  for (const t of job.targets) byChapter.set(t.chapter, [...(byChapter.get(t.chapter) ?? []), t]);
  const label = (t: CliTarget) => (t.verseEnd ? `${t.verse}-${t.verseEnd}` : String(t.verse));
  const out: string[] = [];
  for (const [chapter, ts] of byChapter) {
    out.push(`<passage version="${job.version}" book="${job.book}" chapter="${chapter}">`, "<targets>");
    for (const t of ts) out.push(`<verse n="${t.verse}"${t.verseEnd ? ` covers="${label(t)}"` : ""}>${esc(t.text)}</verse>`);
    out.push("</targets>", "<korean_reference>");
    for (const t of ts) if (t.krv) out.push(`<verse n="${label(t)}">${esc(t.krv)}</verse>`);
    out.push("</korean_reference>", "</passage>");
  }
  out.push("", `Translate all ${job.targets.length} target verse(s) into Korean. Give each its passage's chapter and its n as "verse".`);
  return out.join("\n");
}

/** Parses `claude -p --output-format json` output. */
export function parseCliOutput(stdout: string, job: CliJob): CliResult {
  let j;
  try {
    j = JSON.parse(stdout);
  } catch {
    throw new Error(`claude 출력이 JSON이 아닙니다: ${stdout.slice(0, 200)}`);
  }
  const reason = `${j.result ?? ""} ${j.terminal_reason ?? ""}`;
  if (j.api_error_status === 429 || /usage limit|rate limit|limit reached|resets? at/i.test(reason)) {
    throw new UsageLimitError(String(j.result ?? "사용량 한도에 도달했습니다").slice(0, 200));
  }
  if (j.is_error || j.subtype !== "success") throw new Error(`claude 오류 (${j.subtype}): ${String(j.result ?? "").slice(0, 200)}`);
  const list: { chapter: number; verse: number; text: string }[] = j.structured_output?.translations ?? [];
  const texts = new Map(list.map((t) => [cliKey(t.chapter, t.verse), t.text.trim()]));
  const missing = job.targets.filter((t) => !texts.get(cliKey(t.chapter, t.verse)));
  if (missing.length) throw new Error(`번역이 빠진 절: ${missing.slice(0, 8).map((t) => cliKey(t.chapter, t.verse)).join(", ")}${missing.length > 8 ? " …" : ""}`);
  return { texts, costUsd: j.total_cost_usd ?? 0, model: Object.keys(j.modelUsage ?? {}) };
}

/** Minimal context: no tools, settings, MCP servers or skills, so each call carries ~1.2k tokens of overhead. */
export const CLI_ARGS = [
  "-p", "--model", "sonnet", "--tools", "", "--no-session-persistence", "--output-format", "json",
  "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands",
  "--system-prompt", SYSTEM, "--json-schema", JSON.stringify(SCHEMA),
];

export function runClaudeCli(job: CliJob, timeoutMs = 10 * 60_000): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    // Neutral working directory, so no project files or CLAUDE.md are picked up
    const child = spawn("claude", CLI_ARGS, { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("claude 응답 시간 초과")); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(parseCliOutput(out, job));
      } catch (e) {
        if (!out.trim() && err.trim()) reject(new Error(`claude 실행 실패: ${err.trim().slice(0, 300)}`));
        else reject(e);
      }
    });
    child.stdin.end(buildCliMessage(job));
  });
}
