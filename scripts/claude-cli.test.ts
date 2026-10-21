import { describe, expect, it } from "vitest";
import { buildCliMessage, CLI_ARGS, parseCliOutput, UsageLimitError, type CliJob } from "./claude-cli";

const job: CliJob = {
  version: "MSG", book: "PHP",
  targets: [
    { chapter: 3, verse: 21, text: "He'll make us beautiful & whole", krv: "그가 만물을 복종케 하실 수 있는" },
    { chapter: 4, verse: 6, verseEnd: 7, text: "Don't fret or worry.", krv: "아무 것도 염려하지 말고" },
  ],
};
// Shape of a real `claude -p --output-format json --json-schema …` result
const ok = (translations: unknown[]) => JSON.stringify({
  type: "result", subtype: "success", is_error: false, total_cost_usd: 0.0123,
  structured_output: { translations }, modelUsage: { "claude-sonnet-5-5": {} },
});

describe("claude -p batch", () => {
  it("packs several chapters into one message, addressed by chapter and verse", () => {
    const m = buildCliMessage(job);
    expect(m).toContain('<passage version="MSG" book="PHP" chapter="3">');
    expect(m).toContain('<passage version="MSG" book="PHP" chapter="4">');
    expect(m).toContain('<verse n="6" covers="6-7">Don\'t fret or worry.</verse>');
    expect(m).toContain('<verse n="21">He\'ll make us beautiful &amp; whole</verse>');
    expect(m).toContain('<verse n="6-7">아무 것도 염려하지 말고</verse>');
  });

  it("runs with tools, settings, MCP servers and skills off", () => {
    for (const flag of ["--tools", "--setting-sources", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--json-schema"]) {
      expect(CLI_ARGS).toContain(flag);
    }
    expect(CLI_ARGS[CLI_ARGS.indexOf("--tools") + 1]).toBe("");
  });

  it("parses structured output, cost and model", () => {
    const r = parseCliOutput(ok([{ chapter: 4, verse: 6, text: " 염려하지 말라 " }, { chapter: 3, verse: 21, text: "아름답게" }]), job);
    expect(r.texts.get("4:6")).toBe("염려하지 말라");
    expect(r.costUsd).toBe(0.0123);
    expect(r.model).toEqual(["claude-sonnet-5-5"]);
  });

  it("rejects a reply that misses a verse", () => {
    expect(() => parseCliOutput(ok([{ chapter: 4, verse: 6, text: "염려하지 말라" }]), job)).toThrow("번역이 빠진 절: 3:21");
  });

  it("recognizes the usage limit so the batch can stop and resume later", () => {
    const limit = JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Claude usage limit reached. Your limit will reset at 5pm." });
    expect(() => parseCliOutput(limit, job)).toThrow(UsageLimitError);
  });
});
