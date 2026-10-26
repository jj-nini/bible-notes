import { describe, expect, it } from "vitest";
import {
  applyResult, chunkVerse, gradeRecitation, makeQuestion, norm, seeded, splitVerses, subPassage, tokenize, wordVariants,
  type DrillPassage, type Question,
} from "./memorize";

const PHP = "아무 것도 염려하지 말고 다만 모든 일에 기도와 간구로, 너희 구할 것을 감사함으로 하나님께 아뢰라. 그리하면 모든 지각에 뛰어난 하나님의 평강이 그리스도 예수 안에서 너희 마음과 생각을 지키시리라.";
const JHN = "하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 그를 믿는 자마다 멸망하지 않고 영생을 얻게 하려 하심이라";
const p1: DrillPassage = { id: "a", ref: "빌립보서 4:6-7", body: PHP, misses: {} };
const p2: DrillPassage = { id: "b", ref: "요한복음 3:16", body: JHN, misses: {} };
// A made-up "chapter" shaped like Proverbs 3: numbered lines, and openings shared by several verses
const CHAPTER = `1   내 친구야 나의 말을 잊지 말고 네 마음에 새기라
2   그리하면 그것이 너를 지키며 평안을 더하게 하리라
3   진실과 사랑이 너를 떠나지 말게 하고 그것을 네 손에 매라
4   그리하면 네가 모든 사람 앞에서 칭찬을 받으리라
5   너는 아침마다 일어나 감사하고 저녁마다 쉬라
6   너는 길을 걸을 때에 조심하라 그리하면 넘어지지 아니하리라
7   그리하면 네 집이 든든하고 네 밭이 풍성하리라
8   내 친구야 게으르지 말라 부지런히 일하라`;
const ch: DrillPassage = { id: "c", ref: "연습 1장", body: CHAPTER, misses: {} };

/** For put-in-order questions: the pieces in the right order. */
const inOrder = (q: Question) => q.order!.sequence.map((i) => q.choices[i]);

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
      expect(q.choices.length).toBeGreaterThanOrEqual(3);
      const body = norm(p.body);
      if (q.order) {
        expect(body).toContain(norm(inOrder(q).join("")));
        continue;
      }
      expect(q.answer).toBeGreaterThanOrEqual(0);
      const right = q.choices[q.answer];
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
    expect([...kinds].sort()).toEqual(["blank", "chunkOrder", "exact", "first", "next", "ref", "wrong"]);
  });

  it("aims at a word I just missed", () => {
    const rng = seeded(3);
    for (let k = 0; k < 30; k++) {
      const q = makeQuestion(p1, [p1], rng, 27, "blank")!;
      expect(q.words).toEqual([27]);
      expect(q.choices[q.answer]).toBe("지키시리라");
    }
  });

  it("asks for references only to tell my passages apart", () => {
    expect(makeQuestion(p2, [p2], seeded(1), undefined, "ref")!.kind).not.toBe("ref");
    const q = makeQuestion(p2, [p1, p2], seeded(1), undefined, "ref")!;
    expect(q.kind).toBe("ref");
    expect(q.choices).toEqual(expect.arrayContaining(["요한복음 3:16", "빌립보서 4:6-7"]));
  });
});

describe("verses", () => {
  it("splits numbered lines, inline numbers and plain lines; numbers are not words", () => {
    const vs = splitVerses(CHAPTER);
    expect(vs.map((v) => v.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(vs[1].words.slice(0, 2)).toEqual(["그리하면", "그것이"]);
    expect(vs[1].start).toBe(vs[0].words.length);
    expect(tokenize(CHAPTER)).not.toContain("1");
    expect(splitVerses("3. 가 나\n4) 다 라").map((v) => [v.n, v.words.join(" ")])).toEqual([[3, "가 나"], [4, "다 라"]]);
    expect(splitVerses("1 가 나 2 다 라 3 마").map((v) => v.words.join(" "))).toEqual(["가 나", "다 라", "마"]);
    expect(splitVerses("가 나\n다 라").map((v) => v.n)).toEqual([1, 2]);
    expect(splitVerses("사람 40 명이 왔다")).toHaveLength(1); // a number inside the text stays
    expect(tokenize("사람 40 명이 왔다")).toContain("40");
  });

  it("cuts a verse into 3–6 pieces at sense breaks, losing nothing", () => {
    for (const v of splitVerses(CHAPTER)) {
      const cs = chunkVerse(v.words);
      expect(cs.length).toBeGreaterThanOrEqual(3);
      expect(cs.length).toBeLessThanOrEqual(6);
      expect(cs.flat()).toEqual(v.words);
    }
    const first = chunkVerse(splitVerses(CHAPTER)[0].words).map((c) => c.join(" "));
    expect(first[0]).toBe("내 친구야");
    expect(first.some((c) => c.includes("잊지 말고"))).toBe(true); // -지 stays with 말고
  });

  it("order questions: a real permutation, never already in order, rebuilding the text", () => {
    const rng = seeded(11);
    for (const kind of ["verseOrder", "chunkOrder"] as const) {
      for (let k = 0; k < 250; k++) {
        const q = makeQuestion(ch, [ch], rng, undefined, kind)!;
        if (q.kind !== kind) continue;
        expect([...q.order!.sequence].sort()).toEqual(q.choices.map((_, i) => i));
        expect(q.order!.sequence.every((x, i) => x === i)).toBe(false);
        expect(norm(inOrder(q).join(""))).toBe(norm(q.reveal));
        expect(norm(CHAPTER.replace(/\d/g, ""))).toContain(norm(q.reveal));
      }
    }
  });

  it("next-verse questions: the opening is long enough to tell verses apart", () => {
    const vs = splitVerses(CHAPTER);
    const openings = vs.map((v) => norm(v.words.join("")));
    const rng = seeded(2);
    const seen = new Set<string>();
    for (let k = 0; k < 300; k++) {
      const q = makeQuestion(ch, [ch], rng, undefined, "seam")!;
      if (q.kind !== "seam") continue;
      const right = norm(q.choices[q.answer]);
      seen.add(q.choices[q.answer]);
      expect(openings.filter((o) => o.startsWith(right))).toHaveLength(1);
      expect(new Set(q.choices.map(norm)).size).toBe(q.choices.length);
    }
    expect(seen).toContain("그리하면 네 집이"); // not just "그리하면 네" (4절 opens 그리하면 네가)
  });

  it("whole chapters get verse-order, piece-order and next-verse questions about half the time", () => {
    const rng = seeded(9);
    let chapterKinds = 0;
    for (let k = 0; k < 400; k++) {
      const q = makeQuestion(ch, [ch], rng)!;
      if (q.kind === "verseOrder" || q.kind === "chunkOrder" || q.kind === "seam") chapterKinds++;
    }
    expect(chapterKinds).toBeGreaterThan(120);
    expect(chapterKinds).toBeLessThan(260);
  });

  it("a stretch of verses drills on its own, with word positions shifted back", () => {
    const { passage, offset } = subPassage({ ...ch, misses: { 0: 2, 20: 1 } }, 2, 3);
    const vs = splitVerses(CHAPTER);
    expect(offset).toBe(vs[2].start);
    expect(tokenize(passage.body)).toEqual([...vs[2].words, ...vs[3].words]);
    expect(passage.misses).toEqual({ [20 - offset]: 1 });
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

  it("grades a chapter verse by verse, ignoring verse numbers I write", () => {
    const attempt = CHAPTER.replace("넘어지지 아니하리라", "넘어지지 않으리라");
    expect(gradeRecitation(CHAPTER, CHAPTER).perfect).toBe(true);
    expect(gradeRecitation(CHAPTER, CHAPTER.replace(/^\d+\s+/gm, "")).perfect).toBe(true);
    const g = gradeRecitation(CHAPTER, attempt);
    expect(g.byVerse.filter((v) => v.wrong).map((v) => v.n)).toEqual([6]);
    expect(g.parts.some((x) => x.text.includes("\n"))).toBe(true); // a line per verse
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
