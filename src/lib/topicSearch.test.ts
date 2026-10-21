import { describe, expect, it } from "vitest";
import { matchTopics } from "./topicSearch";
import { sampleSynonyms } from "../data/sample";

describe("matchTopics", () => {
  it("maps a situation phrase to several topics", () => {
    const m = matchTopics("불안할 때", sampleSynonyms);
    expect(m.terms).toEqual(["불안"]);
    expect(m.topics.sort()).toEqual(["두려움", "염려"]);
  });

  it("matches through Korean verb endings", () => {
    expect(matchTopics("회사에서 지쳤을 때", sampleSynonyms).topics).toContain("지침");
  });

  it("ignores spacing", () => {
    expect(matchTopics("번 아웃", sampleSynonyms).topics).toContain("지침");
  });

  it("returns nothing for unknown phrases and empty input", () => {
    expect(matchTopics("우주 탐사", sampleSynonyms).topics).toEqual([]);
    expect(matchTopics("   ", sampleSynonyms).topics).toEqual([]);
  });
});
