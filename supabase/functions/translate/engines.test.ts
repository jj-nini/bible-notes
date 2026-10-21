import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { buildRequest, buildUserMessage, ClaudeError, translateClaude, type ClaudeJob } from "./claude";
import { googleReason, translateV2 } from "./googleV2";
import { GoogleError } from "./googleV3";

const job: ClaudeJob = {
  version: "AMP", book: "PHP", chapter: 4,
  targets: [
    { verse: 6, text: "Do not be anxious <or> worried about anything", krv: "아무 것도 염려하지 말고" },
    { verse: 7, verseEnd: 8, text: "And the peace of God [that peace]", krv: "그리하면 하나님의 평강이" },
  ],
  context: [{ verse: 5, text: "The Lord is near." }],
};

const fakeClient = (reply: Partial<Anthropic.Beta.BetaMessage> | Error) => {
  const create = vi.fn(async () => {
    if (reply instanceof Error) throw reply;
    return { stop_reason: "end_turn", content: [], ...reply };
  });
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
};
const textReply = (obj: unknown) => ({ content: [{ type: "text", text: JSON.stringify(obj), citations: null }] }) as unknown as Partial<Anthropic.Beta.BetaMessage>;

describe("Claude engine", () => {
  it("builds a Sonnet 5.5 request with JSON output, low effort and server-side fallback", () => {
    const r = buildRequest(job);
    expect(r.model).toBe("claude-sonnet-5-5");
    expect(r.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(r.fallbacks).toBe("default");
    expect(r.output_config.effort).toBe("low");
    expect(r.output_config.format.type).toBe("json_schema");
    expect(r.system).toMatch(/close study/);
    expect(r.system).toMatch(/여호와/);
  });

  it("puts context, targets and the 개역한글 reference in the message, escaped", () => {
    const m = buildUserMessage(job);
    expect(m).toContain('<context>\n<verse n="5">The Lord is near.</verse>');
    expect(m).toContain('<verse n="6">Do not be anxious &lt;or&gt; worried about anything</verse>');
    expect(m).toContain('<verse n="7" covers="7-8">');
    expect(m).toContain('<verse n="7-8">그리하면 하나님의 평강이</verse>');
  });

  it("returns translations keyed by verse", async () => {
    const { client, create } = fakeClient(textReply({ translations: [{ verse: 7, text: " 그리하면 평강이 " }, { verse: 6, text: "염려하지 말라" }] }));
    const out = await translateClaude(client, job);
    expect([...out]).toEqual([[6, "염려하지 말라"], [7, "그리하면 평강이"]]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("fails when a target verse is missing from the reply", async () => {
    const { client } = fakeClient(textReply({ translations: [{ verse: 6, text: "염려하지 말라" }] }));
    await expect(translateClaude(client, job)).rejects.toThrow("번역이 빠진 절: 7");
  });

  it("checks for a refusal before reading content", async () => {
    const { client } = fakeClient({ stop_reason: "refusal", content: [] });
    await expect(translateClaude(client, job)).rejects.toBeInstanceOf(ClaudeError);
  });

  it("maps SDK API errors to ClaudeError with the status", async () => {
    const err = new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid x-api-key", new Headers());
    const { client } = fakeClient(err);
    await expect(translateClaude(client, job)).rejects.toMatchObject({ status: 401 });
  });
});

describe("Google v2 engine", () => {
  it("sends the key in a header, not the URL", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: { translations: [{ translatedText: "안녕" }] } })));
    expect(await translateV2(["hi"], { key: "K123", source: "en", target: "ko" }, f as unknown as typeof fetch)).toEqual(["안녕"]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://translation.googleapis.com/language/translate/v2");
    expect(url).not.toContain("K123");
    expect((init.headers as Record<string, string>)["X-goog-api-key"]).toBe("K123");
  });

  it("masks the key in error messages", async () => {
    const f = vi.fn(async () => new Response("<html><title>Error 404 (Not Found)!!1</title>?key=K123</html>", { status: 404 }));
    const p = translateV2(["hi"], { key: "K123", source: "en", target: "ko" }, f as unknown as typeof fetch);
    await expect(p).rejects.toBeInstanceOf(GoogleError);
    await expect(p).rejects.toThrow("Error 404 (Not Found)!!1");
    expect(googleReason("bad K123", "K123")).toBe("bad ***");
  });
});
