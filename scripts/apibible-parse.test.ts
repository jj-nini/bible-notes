import { describe, expect, it } from "vitest";
import { parseChapter, type ApiNode } from "./apibible-parse";

const verseTag = (n: number): ApiNode => ({ type: "tag", name: "verse", attrs: { number: String(n), style: "v" }, items: [{ type: "text", text: String(n) }] });
const text = (verseId: string, t: string): ApiNode => ({ type: "text", text: t, attrs: { verseId } });
const para = (...items: ApiNode[]): ApiNode => ({ type: "tag", name: "para", attrs: { style: "p" }, items });

describe("parseChapter", () => {
  it("collects text per verse across paragraphs and skips verse-number tags", () => {
    const m = parseChapter([
      para(verseTag(4), text("PHP.4.4", "Rejoice in the Lord always."), verseTag(5), text("PHP.4.5", "Let your gentleness")),
      { type: "tag", name: "para", attrs: { style: "q1" }, items: [text("PHP.4.5", "be evident to all. ")] },
    ]);
    expect([...m.keys()]).toEqual([4, 5]);
    expect(m.get(5)).toEqual({ text: "Let your gentleness be evident to all." });
  });

  it("stores a combined verse range on its first verse", () => {
    const m = parseChapter([para(text("PHP.4.6-PHP.4.7", "Don't fret or worry."))]);
    expect(m.get(6)).toEqual({ text: "Don't fret or worry.", end: 7 });
    expect(m.has(7)).toBe(false);
  });

  it("drops trailing cross-references but keeps amplifying brackets", () => {
    const m = parseChapter([para(
      text("PHP.4.3", "whose names are in the Book of Life. [Dan 12:1; Mal 3:16, 17; Rev 3:5; 21:27]"),
      text("PHP.4.4", "Rejoice in the Lord always [delight, take pleasure in Him]; again I will say, rejoice! [Ps 37:4]"),
      text("PHP.4.7", "in Christ Jesus [is yours]. [John 14:27]"),
      text("PHP.4.13", "through Him [to fulfill His purpose—I am ready for anything.]"),
      text("PHP.4.20", "it is written [1 Cor 2:9] [Is 64:4]"),
    )]);
    expect(m.get(3)!.text).toBe("whose names are in the Book of Life.");
    expect(m.get(4)!.text).toBe("Rejoice in the Lord always [delight, take pleasure in Him]; again I will say, rejoice!");
    expect(m.get(7)!.text).toBe("in Christ Jesus [is yours].");
    expect(m.get(13)!.text).toBe("through Him [to fulfill His purpose—I am ready for anything.]");
    expect(m.get(20)!.text).toBe("it is written");
  });

  it("skips cross-reference and footnote character styles", () => {
    const m = parseChapter([para(
      text("PHP.4.4", "Rejoice!"),
      { type: "tag", name: "char", attrs: { style: "rq" }, items: [text("PHP.4.4", "Ps 37:4")] },
    )]);
    expect(m.get(4)!.text).toBe("Rejoice!");
  });

  it("joins pieces inside a paragraph without inventing spaces", () => {
    const nd = (id: string, t: string): ApiNode => ({ type: "tag", name: "char", attrs: { style: "nd" }, items: [text(id, t)] });
    const m = parseChapter([
      para(text("PSA.3.1", "O "), nd("PSA.3.1", "L"), { type: "tag", name: "char", attrs: { style: "sc" }, items: [text("PSA.3.1", "ord")] }, text("PSA.3.1", ", how my enemies have increased!")),
      para(text("PSA.3.3", "¶But You, O "), nd("PSA.3.3", "Lord"), text("PSA.3.3", ", are a shield.")),
      para(text("MAT.17.5", "a voice said, “"), { type: "tag", name: "char", attrs: { style: "wj" }, items: [text("MAT.17.5", " This is My beloved Son")] }, text("MAT.17.5", "!”")),
    ]);
    expect(m.get(1)!.text).toBe("O Lord, how my enemies have increased!");
    expect(m.get(3)!.text).toBe("But You, O Lord, are a shield.");
    expect(m.get(5)!.text).toBe("a voice said, “This is My beloved Son!”");
  });

  it("separates poetry lines and drops MSG section breaks", () => {
    const q = (...items: ApiNode[]): ApiNode => ({ type: "tag", name: "para", attrs: { style: "q1" }, items });
    const m = parseChapter([
      q(text("PSA.3.1-PSA.3.2", "Enemies sprouting like mushrooms,")),
      q(text("PSA.3.1-PSA.3.2", "Mobs of them all around me")),
      para(text("MAT.17.22-MAT.17.23", "The disciples felt scared to death. * * *")),
    ]);
    expect(m.get(1)).toEqual({ text: "Enemies sprouting like mushrooms, Mobs of them all around me", end: 2 });
    expect(m.get(22)!.text).toBe("The disciples felt scared to death.");
  });
});
