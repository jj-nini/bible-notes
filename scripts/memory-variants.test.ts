import { describe, expect, it } from "vitest";
import { splitVerses } from "../src/lib/memorize.ts";
import { buildVariantMessage, toVariants } from "./memory-variants.ts";

const vs = splitVerses("1 내 친구야 나의 말을 잊지 말고 네 마음에 새기라\n2 그리하면 그것이 너를 지키며 평안을 더하게 하리라");

describe("memory variants", () => {
  it("sends verses numbered from 1, without my own verse numbers", () => {
    const m = buildVariantMessage("연습 1장", vs);
    expect(m).toContain('<verse n="1">내 친구야 나의 말을 잊지 말고 네 마음에 새기라</verse>');
    expect(m).toContain('<verse n="2">그리하면');
  });

  it("keeps variants copied exactly from the verse, as word positions in the passage", () => {
    const out = toVariants(vs, [
      { verse: 1, from: "새기라", to: "간직하라" },
      { verse: 2, from: "너를 지키며", to: "너를 보호하며" },
      { verse: 2, from: "평안을 주며", to: "평강을 주며" }, // not in the text
      { verse: 1, from: "말고", to: "말고" }, // same
      { verse: 9, from: "새기라", to: "x" }, // no such verse
      { verse: 1, from: "새기라", to: "간직하라" }, // duplicate
    ]);
    expect(out).toEqual([
      { start: 8, end: 9, text: "간직하라" },
      { start: vs[1].start + 2, end: vs[1].start + 4, text: "너를 보호하며" },
    ]);
  });
});
