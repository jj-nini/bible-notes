import { describe, expect, it } from "vitest";
import { applyResult, gradeRecitation, makeQuestion, norm, seeded, tokenize, wordVariants, type DrillPassage } from "./memorize";

const PHP = "아무 것도 염려하지 말고 다만 모든 일에 기도와 간구로, 너희 구할 것을 감사함으로 하나님께 아뢰라. 그리하면 모든 지각에 뛰어난 하나님의 평강이 그리스도 예수 안에서 너희 마음과 생각을 지키시리라.";
const JHN = "하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 그를 믿는 자마다 멸망하지 않고 영생을 얻게 하려 하심이라";
const p1: DrillPassage = { id: "a", ref: "빌립보서 4:6-7", body: PHP, misses: {} };
const p2: DrillPassage = { id: "b", ref: "요한복음 3:16", body: JHN, misses: {} };

describe("word variants (토씨)", () => {
  it("swaps particles with the right form for the final consonant", () => {
    expect(wordVariants("평강이")).toEqual(expect.arrayContaining(["평강은", "평강을", "평강도"]));
    expect(wordVariants("하나님께")).toEqual(expect.arrayContaining(["하나님에게", "하나님께서"]));
    const v = wordVariants("우리가");
    expect(v).toContain("우리는");
    expect(v).not.toContain("우리은"); // 우리 has no final consonant
  });

  it("swaps verb endings, honorific 시 and past tense with vowel harmony", () => {
    expect(wordVariants("지키시리라")).toEqual(expect.arrayContaining(["지키리라", "지키시니라"]));
    expect(wordVariants("아뢰라")).toContain("아뢰시라");
    const v = wordVariants("하라");
    expect(v).toContain("하였느니라");
    expect(v).not.toContain("하었느니라");
  });

  it("leaves words alone that only look like particle + stem", () => {
    expect(wordVariants("그리스도")).not.toContain("그리스는");
    expect(wordVariants("다만")).toEqual([]);
    expect(wordVariants("기도")).not.toContain("기는");
    expect(wordVariants("그러므로").some((w) => w.startsWith("그러므"))).toBe(false); // 그러 + 므로
  });

  it("never offers the original word", () => {
    for (const w of tokenize(PHP + " " + JHN)) {
      const core = norm(w);
      for (const v of wordVariants(core)) expect(norm(v)).not.toBe(core);
    }
  });
});

describe("questions", () => {
  it("are always answerable: one right choice, distinct choices, right one matches the text", () => {
    const rng = seeded(7);
    const kinds = new Set<string>();
    for (let k = 0; k < 400; k++) {
      const p = k % 2 ? p1 : p2;
      const q = makeQuestion(p, [p1, p2], rng)!;
      expect(q).not.toBeNull();
      kinds.add(q.kind);
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.choices.length).toBeGreaterThanOrEqual(3);
      const right = q.choices[q.answer];
      const body = norm(p.body);
      if (q.kind === "wrong") {
        // the window with the tapped word fixed is the original; the shown window is not
        expect(body).not.toContain(norm(q.choices.join("")));
        expect(body).toContain(norm(q.reveal));
        continue;
      }
      expect(new Set(q.choices.map(norm)).size).toBe(q.choices.length);
      if (q.kind === "ref") expect(right).toBe(p.ref);
      else if (q.kind === "blank") expect(body).toContain(norm(q.context!.before + right + q.context!.after));
      else if (q.kind === "next") expect(body).toContain(norm(q.context!.before + right));
      else expect(body).toContain(norm(right));
    }
    expect([...kinds].sort()).toEqual(["blank", "exact", "first", "next", "ref", "wrong"]);
  });

  it("aims at a word I just missed", () => {
    const rng = seeded(3);
    for (let k = 0; k < 30; k++) {
      const q = makeQuestion(p1, [p1], rng, 27, "blank")!;
      expect(q.words).toEqual([27]);
      expect(q.choices[q.answer]).toBe("지키시리라");
    }
  });

  it("works with a single passage (made-up references to choose from)", () => {
    const q = makeQuestion(p2, [p2], seeded(1), undefined, "ref")!;
    expect(q.choices).toContain("요한복음 3:16");
    expect(q.choices.length).toBeGreaterThanOrEqual(3);
  });
});

describe("write-out grading", () => {
  it("passes an exact recitation, ignoring spacing and punctuation", () => {
    const g = gradeRecitation(PHP, PHP.replace(/[,.]/g, "").replace("아무 것도", "아무것도"));
    expect(g.perfect).toBe(true);
    expect(g.wrongWords).toEqual([]);
  });

  it("marks one wrong particle and a missing honorific", () => {
    const attempt = PHP.replace("평강이", "평강은").replace("지키시리라", "지키리라");
    const g = gradeRecitation(PHP, attempt);
    const words = tokenize(PHP);
    expect(g.wrongWords.map((i) => words[i])).toEqual(["평강이", "지키시리라."]);
    expect(g.parts).toContainEqual({ type: "missing", text: "이" });
    expect(g.parts).toContainEqual({ type: "extra", text: "은" });
    expect(g.parts).toContainEqual({ type: "missing", text: "시" });
  });

  it("marks a skipped word", () => {
    const g = gradeRecitation(JHN, JHN.replace("독생자를 ", ""));
    expect(g.wrongWords).toEqual([4]);
    expect(g.parts.find((x) => x.type === "missing")!.text).toBe("독생자를");
  });
});

describe("weak-word counting", () => {
  it("goes up on a miss, down on a hit, and disappears at zero", () => {
    let p = { id: "x", ref: "r", body: "a b c", correct: 0, wrong: 0, misses: {}, created_at: "" };
    p = applyResult(p, false, [], [1, 2]);
    p = applyResult(p, false, [1], [2]);
    p = applyResult(p, true, [0, 1, 2], []);
    p = applyResult(p, false, [], []); // a wrong reference: no particular word
    expect(p.wrong).toBe(3);
    p = { ...p, wrong: 2 };
    expect(p).toMatchObject({ correct: 1, wrong: 2, misses: { 2: 1 } });
  });
});
