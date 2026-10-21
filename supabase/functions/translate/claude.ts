// Claude translation engine. The Anthropic SDK resolves from node_modules in tests and from
// deno.json's import map ("npm:@anthropic-ai/sdk") in the Edge Function.
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = "claude-sonnet-5-5";
export const CLAUDE_ENGINE = CLAUDE_MODEL;

export interface ClaudeTarget {
  verse: number;
  /** Last verse covered when the version renders several verses as one block (MSG). */
  verseEnd?: number | null;
  text: string;
  /** 개역한글 text of the same verse, for names, places and terms. */
  krv?: string;
}

export interface ClaudeJob {
  version: string;
  book: string; // USFM code
  chapter: number;
  targets: ClaudeTarget[];
  /** Neighbouring verses for context only; not translated. */
  context: { verse: number; text: string }[];
}

export class ClaudeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const SYSTEM = `You translate English Bible text into Korean for close study: the reader compares the Korean with the English to see exactly what each version says.

Faithfulness comes first:
- Translate every word and every clause. Do not shorten, merge, summarize, smooth over, or reorder ideas.
- The Amplified Bible's [ ] and ( ) amplifications are the point of the text: translate everything inside them in full, keep the brackets, and keep them in the same position.
- When the English lists several words or alternatives (e.g. "graciousness, unselfishness, mercy, tolerance, and patience"), give a Korean word for each one; never collapse them into fewer.
- Keep the English version's own wording and imagery, including paraphrase in versions like The Message. Do not substitute the wording of any Korean Bible.

Style: plain written Korean (~하라, ~이다, ~하리라), not the archaic 개역 endings (~하시니라, ~하옵소서).
Terms: "the LORD" (small capitals, the divine name) → 여호와; "God" → 하나님; "the Lord" for Jesus → 주; "Christ" → 그리스도.
Names and places: spell them as the 개역한글 reference text does. Use that reference for names, places and term spellings only — never for wording.
Translate each target verse separately and completely. Context verses are for understanding only; do not translate them.
Return only the translations, in the requested JSON format.`;

export const SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: { verse: { type: "integer" }, text: { type: "string" } },
        required: ["verse", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["translations"],
  additionalProperties: false,
};

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);

export function buildUserMessage(job: ClaudeJob) {
  const label = (t: ClaudeTarget) => (t.verseEnd ? `${t.verse}-${t.verseEnd}` : String(t.verse));
  const lines = [
    `<passage version="${job.version}" book="${job.book}" chapter="${job.chapter}">`,
    "<context>",
    ...job.context.map((c) => `<verse n="${c.verse}">${esc(c.text)}</verse>`),
    "</context>",
    "<targets>",
    ...job.targets.map((t) => `<verse n="${t.verse}"${t.verseEnd ? ` covers="${label(t)}"` : ""}>${esc(t.text)}</verse>`),
    "</targets>",
    "<korean_reference>",
    ...job.targets.filter((t) => t.krv).map((t) => `<verse n="${label(t)}">${esc(t.krv!)}</verse>`),
    "</korean_reference>",
    "</passage>",
    "",
    `Translate the ${job.targets.length} target verse(s) into Korean. Use each target's n as its "verse".`,
  ];
  return lines.join("\n");
}

export function buildRequest(job: ClaudeJob) {
  return {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    // Server-side fallback: if a request is declined, the API retries it on a suitable model
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    output_config: { effort: "low" as const, format: { type: "json_schema" as const, schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user" as const, content: buildUserMessage(job) }],
  };
}

/** Translates one chapter's target verses; returns verse number → Korean text. */
export async function translateClaude(client: Anthropic, job: ClaudeJob): Promise<Map<number, string>> {
  let res;
  try {
    res = await client.beta.messages.create(buildRequest(job));
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new ClaudeError(e.status ?? 502, e.message);
    throw e;
  }
  if (res.stop_reason === "refusal") throw new ClaudeError(422, "Claude가 이 요청을 거절했습니다");
  if (res.stop_reason === "max_tokens") throw new ClaudeError(502, "번역이 길이 제한에 걸려 잘렸습니다");
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new ClaudeError(502, "Claude 응답에 번역이 없습니다");

  let parsed: { translations?: { verse: number; text: string }[] };
  try {
    parsed = JSON.parse(text.text);
  } catch {
    throw new ClaudeError(502, "Claude 응답을 해석하지 못했습니다");
  }
  const out = new Map((parsed.translations ?? []).map((t) => [t.verse, t.text.trim()]));
  const missing = job.targets.filter((t) => !out.get(t.verse));
  if (missing.length) throw new ClaudeError(502, `번역이 빠진 절: ${missing.map((t) => t.verse).join(", ")}`);
  return new Map(job.targets.map((t) => [t.verse, out.get(t.verse)!]));
}
