import { describe, expect, it, vi } from "vitest";
import { translateInChunks } from "./chunkTranslate";

const upper = async (s: string) => s.toUpperCase();

describe("translateInChunks", () => {
  it("sends consecutive verses as one block and maps lines back", async () => {
    const t = vi.fn(upper);
    const out = await translateInChunks(["a", "b", "c"], t);
    expect(out).toEqual(["A", "B", "C"]);
    expect(t).toHaveBeenCalledTimes(1);
    expect(t).toHaveBeenCalledWith("a\nb\nc");
  });

  it("splits into blocks by size", async () => {
    const t = vi.fn(upper);
    const verses = ["x".repeat(6), "y".repeat(6), "z".repeat(6)];
    await translateInChunks(verses, t, { maxChars: 14 });
    expect(t.mock.calls.map((c) => c[0])).toEqual([`${verses[0]}\n${verses[1]}`, verses[2]]);
  });

  it("falls back to verse-by-verse when the line count changes", async () => {
    // A translator that merges the two lines into one
    const t = vi.fn(async (s: string) => (s.includes("\n") ? s.replace("\n", " ").toUpperCase() : s.toUpperCase()));
    const out = await translateInChunks(["one", "two"], t);
    expect(out).toEqual(["ONE", "TWO"]);
    expect(t).toHaveBeenCalledTimes(3); // the block, then each verse
  });

  it("keeps a verse that contains a newline on one line", async () => {
    const out = await translateInChunks(["first\nline", "second"], upper);
    expect(out).toEqual(["FIRST LINE", "SECOND"]);
  });

  it("reports each block as it finishes", async () => {
    const seen: number[][] = [];
    await translateInChunks(["a", "b", "c"], upper, { maxChars: 4, onBlock: (r) => { seen.push(r.map((x) => x.index)); } });
    expect(seen).toEqual([[0, 1], [2]]);
  });
});
