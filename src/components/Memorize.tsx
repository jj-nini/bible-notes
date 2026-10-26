import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { repo } from "../data";
import type { MemoryPassage } from "../data/types";
import {
  KIND_LABEL, LEVEL_LABEL, RECALL, applyResult, gradeRecitation, makeQuestion, nextProgress, norm, pickPassage,
  splitVerses, subPassage, tokenize, verseLevel, type Grade, type Question, type VerseLine,
} from "../lib/memorize";
import { useToast } from "../lib/toast";

export type MemoMode = "drill" | "write" | "manage";

export function MemorizeBar({ mode, onMode }: { mode: MemoMode; onMode(m: MemoMode): void }) {
  return (
    <div className="controls">
      <div className="seg" role="group" aria-label="암송 방식">
        <button type="button" aria-pressed={mode === "drill"} onClick={() => onMode("drill")}>문제 풀기</button>
        <button type="button" aria-pressed={mode === "write"} onClick={() => onMode("write")}>외워 쓰기</button>
        <button type="button" aria-pressed={mode === "manage"} onClick={() => onMode("manage")}>본문 관리</button>
      </div>
    </div>
  );
}

interface ViewProps {
  mode: MemoMode;
  active: boolean;
  onMode(m: MemoMode): void;
}

export function MemorizeView({ mode, active, onMode }: ViewProps) {
  const [passages, setPassages] = useState<MemoryPassage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    repo.listMemoryPassages().then(setPassages, (e: Error) => setError(e.message));
  }, []);
  useEffect(reload, [reload]);

  /** Keeps the local copy in step with what the DB counted, without refetching after every answer. */
  const patch = useCallback((id: string, f: (p: MemoryPassage) => MemoryPassage) => {
    setPassages((ps) => ps && ps.map((p) => (p.id === id ? f(p) : p)));
  }, []);

  if (error) return <div className="empty"><p>암송 본문을 불러오지 못했습니다.</p><p className="sub">{error}</p></div>;
  if (!passages) return <div className="skeleton" />;
  if (mode === "manage") return <Manage passages={passages} onChange={reload} />;
  if (!passages.length) {
    return (
      <div className="empty">
        <p><strong>외울 말씀이 아직 없습니다.</strong></p>
        <p className="sub">본문 관리에서 장절과 본문을 직접 입력하면, 그 본문으로 문제를 만듭니다.</p>
        <button type="button" className="ghost go" onClick={() => onMode("manage")}>본문 넣기</button>
      </div>
    );
  }
  return mode === "drill"
    ? <Drill passages={passages} active={active} onPatch={patch} />
    : <WriteOut passages={passages} onPatch={patch} />;
}

// ---------------------------------------------------------------- drill

interface Retry { passageId: string; word?: number; due: number }
/** Which passages to drill: all, one, or a stretch of one passage's verses (positions, inclusive). */
interface Range { id: string; from: number; to: number }

type RecordFn = (id: string, ok: boolean, hit: number[], miss: number[], verses?: number[], recall?: boolean) => void;

function useRecord(onPatch: (id: string, f: (p: MemoryPassage) => MemoryPassage) => void): RecordFn {
  const toast = useToast();
  return useCallback((id, ok, hit, miss, verses = [], recall = false) => {
    onPatch(id, (p) => applyResult(p, ok, hit, miss, verses, recall));
    repo.recordMemoryResult(id, ok, hit, miss, verses, recall).catch((e: Error) => toast(`기록하지 못했습니다: ${e.message}`));
  }, [onPatch, toast]);
}

/** Where a question's word and verse positions sit in the stored passage (when drilling a stretch). */
interface Shift { words: number; verses: number }

function Drill({ passages, active, onPatch }: {
  passages: MemoryPassage[]; active: boolean; onPatch(id: string, f: (p: MemoryPassage) => MemoryPassage): void;
}) {
  const toast = useToast();
  const [range, setRange] = useState<Range>({ id: "all", from: 0, to: 0 });
  const [q, setQ] = useState<Question | null>(null);
  const [shift, setShift] = useState<Shift>({ words: 0, verses: 0 });
  const [picked, setPicked] = useState<number | null>(null);
  const [tapped, setTapped] = useState<number[]>([]);
  const [wrongTap, setWrongTap] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [hinted, setHinted] = useState(false);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [outcome, setOutcome] = useState<boolean | null>(null);
  const [stats, setStats] = useState({ asked: 0, right: 0, streak: 0 });
  const retries = useRef<Retry[]>([]);
  const timer = useRef<number>(undefined);
  const record = useRecord(onPatch);

  const one = passages.find((p) => p.id === range.id);
  const verses = useMemo(() => (one ? splitVerses(one.body) : []), [one?.body]);
  const pool = useMemo(() => {
    const none = { words: 0, verses: 0 };
    if (!one) return passages.map((p) => ({ passage: p, shift: none }));
    if (range.from === 0 && range.to >= verses.length - 1) return [{ passage: one, shift: none }];
    const s = subPassage(one, range.from, range.to);
    return [{ passage: s.passage, shift: { words: s.offset, verses: s.verseOffset } }];
  }, [passages, one, range.from, range.to, verses.length]);
  // Pick from the latest stats and levels, but don't regenerate the question when only those change
  const poolRef = useRef(pool);
  poolRef.current = pool;

  const next = useCallback((asked: number) => {
    window.clearTimeout(timer.current);
    const ps = poolRef.current;
    const all = ps.map((x) => x.passage);
    const due = retries.current.findIndex((r) => r.due <= asked && ps.some((x) => x.passage.id === r.passageId));
    let made: { q: Question; shift: Shift } | null = null;
    if (due >= 0) {
      const [r] = retries.current.splice(due, 1);
      const x = ps.find((y) => y.passage.id === r.passageId)!;
      const q = makeQuestion(x.passage, all, Math.random, r.word);
      if (q) made = { q, shift: x.shift };
    }
    for (let tries = 0; !made && tries < 5; tries++) {
      const p = pickPassage(all, Math.random);
      const x = p && ps.find((y) => y.passage === p);
      const q = x && makeQuestion(x.passage, all, Math.random);
      if (q) made = { q, shift: x.shift };
    }
    setQ(made?.q ?? null);
    setShift(made?.shift ?? { words: 0, verses: 0 });
    setPicked(null);
    setTapped([]);
    setWrongTap(null);
    setTyped("");
    setHinted(false);
    setGrade(null);
    setOutcome(null);
  }, []);

  // A new question only when the range changes (stats updates also change the pool)
  useEffect(() => { retries.current = []; next(0); }, [range, next]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const finish = useCallback((ok: boolean, hit: number[], miss: number[], usedHint = false) => {
    if (!q) return;
    setOutcome(ok);
    const asked = stats.asked + 1;
    setStats((s) => ({ asked: s.asked + 1, right: s.right + (ok ? 1 : 0), streak: ok ? s.streak + 1 : 0 }));
    const recall = RECALL.has(q.kind);
    // Like a recitation contest, a hint costs the credit: no level progress for that answer
    const vs = usedHint ? [] : q.verses.map((v) => v + shift.verses);
    record(q.passageId, ok, hit.map((w) => w + shift.words), miss.map((w) => w + shift.words), vs, recall);
    const stored = passages.find((x) => x.id === q.passageId);
    const up = stored && vs.map((v) => nextProgress(stored.progress?.[v], ok, recall).lv).find((lv, k) => lv > verseLevel(stored, vs[k]));
    if (up) toast(`${up}단계 ${LEVEL_LABEL[up]}로 올랐습니다`);
    if (ok) timer.current = window.setTimeout(() => next(asked), q.input ? 1400 : 900);
    // Missed it: the same spot comes back in a different form a few questions later
    else retries.current.push({ passageId: q.passageId, word: miss[0] ?? q.words[0], due: asked + 3 });
  }, [q, stats.asked, record, next, shift, passages, toast]);

  const answer = useCallback((i: number) => {
    if (!q || outcome !== null || q.input) return;
    if (!q.order) {
      setPicked(i);
      const ok = i === q.answer;
      finish(ok, ok ? q.words : [], ok ? [] : q.words);
      return;
    }
    if (tapped.includes(i)) return;
    const want = q.order.sequence[tapped.length];
    // Two identical pieces are interchangeable
    if (i === want || norm(q.choices[i]) === norm(q.choices[want])) {
      const t = [...tapped, i];
      setTapped(t);
      if (t.length === q.order.sequence.length) finish(true, q.words, []);
    } else {
      setWrongTap(i);
      finish(false, tapped.map((c) => q.order!.firstWord[c]).filter((w) => w >= 0), [q.order.firstWord[want]]);
    }
  }, [q, outcome, tapped, finish]);

  const submitTyped = (e?: FormEvent) => {
    e?.preventDefault();
    if (!q?.input || outcome !== null || !typed.trim()) return;
    const g = gradeRecitation(q.input.answer, typed);
    setGrade(g);
    const wrong = new Set(g.wrongWords.map((k) => q.words[k]));
    finish(g.perfect, q.words.filter((w) => !wrong.has(w)), [...wrong].filter((w) => w !== undefined), hinted);
  };
  const giveUp = () => {
    if (!q?.input || outcome !== null) return;
    setGrade(null);
    finish(false, [], q.words);
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (outcome === null && q && !q.input && q.kind !== "wrong" && /^[1-9]$/.test(e.key) && Number(e.key) <= q.choices.length) answer(Number(e.key) - 1);
      else if (outcome !== null && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(stats.asked); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, outcome, q, answer, next, stats.asked]);

  const p = q && passages.find((x) => x.id === q.passageId);
  const pct = stats.asked ? Math.round((100 * stats.right) / stats.asked) : 0;
  const choiceClass = (i: number) => {
    if (!q || outcome === null) return "";
    if (q.order) return i === wrongTap ? " wrong" : "";
    return i === q.answer ? " right" : i === picked ? " wrong" : "";
  };
  /** Bank: the words tapped so far fill the blanks; pair: the right pair fills them once answered. */
  const clozeFill = (k: number) => {
    if (!q) return "";
    if (q.kind === "bank") return tapped[k] !== undefined ? q.choices[tapped[k]] : outcome !== null ? q.choices[q.order!.sequence[k]] : "";
    if (q.kind === "pair" && outcome !== null) return q.choices[q.answer].split(" · ")[k]?.replace(/^\([가나]\) /, "") ?? "";
    return "";
  };
  const slotLabel = (k: number) => (q?.kind === "pair" ? (k ? "(나)" : "(가)") : "①②③④⑤⑥"[k]);
  const long = q?.kind === "finish" || q?.kind === "quote";

  return (
    <div className="drill">
      <div className="drill-head">
        <p className="drill-stats" aria-live="polite">
          <b>{stats.asked}</b>문제 · 정답 <b>{stats.right}</b>{stats.asked > 0 && ` (${pct}%)`} · 연속 <b>{stats.streak}</b>
        </p>
        <div className="range">
          <select
            className="ver" aria-label="문제 범위" value={range.id}
            onChange={(e) => {
              const x = passages.find((y) => y.id === e.target.value);
              setRange({ id: e.target.value, from: 0, to: x ? splitVerses(x.body).length - 1 : 0 });
            }}
          >
            <option value="all">전체 본문 ({passages.length})</option>
            {passages.map((x) => <option key={x.id} value={x.id}>{x.ref}</option>)}
          </select>
          {one && verses.length >= 3 && (
            <span className="range-verses">
              <select className="ver" aria-label="구간 시작" value={range.from} onChange={(e) => { const f = +e.target.value; setRange((r) => ({ ...r, from: f, to: Math.max(f, r.to) })); }}>
                {verses.map((v, i) => <option key={i} value={i}>{v.n}</option>)}
              </select>
              ~
              <select className="ver" aria-label="구간 끝" value={range.to} onChange={(e) => { const t = +e.target.value; setRange((r) => ({ ...r, to: t, from: Math.min(t, r.from) })); }}>
                {verses.map((v, i) => <option key={i} value={i}>{v.n}</option>)}
              </select>
              절
            </span>
          )}
        </div>
      </div>

      {!q ? (
        <div className="empty"><p>이 본문으로는 문제를 만들 수 없습니다.</p><p className="sub">어절이 둘 이상인 본문을 넣어 주세요.</p></div>
      ) : (
        <section className="card quiz" aria-label="문제">
          <div className="card-top">
            <span className="tags">
              <span className="tag on">{KIND_LABEL[q.kind]}</span>
              <span className="tag" title="문제 단계">{q.level}단계 {LEVEL_LABEL[q.level]}</span>
            </span>
            {q.kind !== "ref" && p && <span className="score">{p.ref}</span>}
          </div>
          <h2 className="quiz-prompt">{q.prompt}</h2>

          {q.context && (
            <p className={"vtext quiz-context" + (q.order || q.kind === "seam" || q.input ? " anchor" : "") + (q.kind === "ox" ? " ox-text" : "")}>
              {q.context.before}
              {q.context.blank && !q.input && (
                <span className={"blank" + (outcome !== null ? " filled" : "")}>
                  {outcome !== null ? q.choices[q.answer] : "　　　"}
                </span>
              )}
              {q.context.blank && q.input && <span className="blank">{outcome !== null ? q.input.answer : "　？　"}</span>}
              {q.context.after && " "}
              {q.context.after}
              {!q.context.blank && (q.kind === "next" || q.kind === "seam") && <span className="blank">　…　</span>}
            </p>
          )}

          {q.cloze && (
            <p className="vtext quiz-context">
              {q.cloze.map((part, k) => (
                <span key={k}>
                  {part}
                  {k < q.cloze!.length - 1 && (
                    <span className={"blank" + (clozeFill(k) ? " filled" : "")}>{clozeFill(k) || slotLabel(k)}</span>
                  )}
                </span>
              ))}
            </p>
          )}

          {q.order && q.kind !== "bank" && (
            <ol className="order-slots" aria-label="고른 순서">
              {q.order.sequence.map((_, k) => (
                <li key={k} className={tapped[k] !== undefined ? "filled" : ""}>
                  {tapped[k] !== undefined ? <span className="vtext">{q.choices[tapped[k]]}</span> : <span className="slot-num">{k + 1}</span>}
                </li>
              ))}
            </ol>
          )}

          {q.input ? (
            <form className="typed" onSubmit={submitTyped}>
              {long ? (
                <textarea
                  className="recite" aria-label="답 쓰기" value={typed} rows={q.kind === "quote" ? 6 : 3} disabled={outcome !== null}
                  onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false}
                />
              ) : (
                <input
                  className="recite" aria-label="답 쓰기" value={typed} disabled={outcome !== null} enterKeyHint="done"
                  onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false}
                />
              )}
              {hinted && outcome === null && <p className="sub hint-text">힌트: {q.input.hint}</p>}
              {outcome === null && (
                <div className="card-actions">
                  <button type="button" className="ghost" onClick={() => setHinted(true)} disabled={hinted}>초성 힌트</button>
                  <button type="button" className="ghost" onClick={giveUp}>모르겠어요</button>
                  <button type="submit" className="btn-primary" disabled={!typed.trim()}>확인</button>
                </div>
              )}
            </form>
          ) : q.kind === "wrong" ? (
            <p className="vtext word-pick">
              {q.choices.map((w, i) => (
                <button key={i} type="button" disabled={outcome !== null} className={choiceClass(i).trim()} onClick={() => answer(i)}>{w}</button>
              ))}
            </p>
          ) : (
            <ol className={"choices" + (q.order ? " pieces" : "") + (q.kind === "ox" ? " ox" : "") + (q.kind === "bank" ? " bank" : "")}>
              {q.choices.map((c, i) => (
                <li key={i}>
                  <button
                    type="button" disabled={outcome !== null || tapped.includes(i)}
                    className={"choice" + choiceClass(i) + (tapped.includes(i) ? " used" : "")}
                    onClick={() => answer(i)}
                  >
                    {q.kind !== "bank" && <span className="choice-num" aria-hidden>{i + 1}</span>}
                    <span className={q.kind === "ref" || q.kind === "ox" ? "" : "vtext"}>{c}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}

          {outcome !== null && (
            <div className={"feedback " + (outcome ? "ok" : "no")} role="status">
              <p className="feedback-title">
                {outcome ? (hinted ? "정답 · 힌트를 써서 단계에는 반영하지 않습니다" : "정답") : "오답 · 곧 다시 나옵니다"}
              </p>
              {grade && !grade.perfect && <DiffView grade={grade} />}
              {!outcome && <p className="vtext reveal">{q.reveal}</p>}
              <button type="button" className="btn-primary" onClick={() => next(stats.asked)}>다음 문제</button>
            </div>
          )}
        </section>
      )}
      <p className="sub hint">숫자 키로 고르고 Enter로 넘어갑니다. 많이 맞힐수록 절마다 단계가 올라 쓰는 문제가 늘어납니다.</p>
    </div>
  );
}

// ---------------------------------------------------------------- write from memory

const initialsOf = (ws: string[]) => ws.map((w) => w[0] + "○".repeat(Math.max(0, [...w].length - 1))).join(" ");

function DiffView({ grade }: { grade: Grade }) {
  return (
    <>
      <p className="vtext diff">
        {grade.parts.map((x, i) =>
          x.type === "same" ? <span key={i}>{x.text}</span>
          : x.type === "missing" ? <ins key={i} title="빠졌거나 틀린 글자">{x.text}</ins>
          : <del key={i} title="본문에 없는 글자">{x.text}</del>)}
      </p>
      <p className="sub legend"><ins>본문 글자</ins> 빠뜨리거나 틀린 곳 · <del>쓴 글자</del> 본문에 없는 것</p>
    </>
  );
}

function VerseChips({ items }: { items: { n: number; wrong: number }[] }) {
  return (
    <p className="verse-chips" aria-label="절별 결과">
      {items.map((v, i) => (
        <span key={i} className={"vchip" + (v.wrong ? " bad" : "")} title={v.wrong ? `${v.wrong}어절 다름` : "정확"}>
          {v.n}{v.wrong ? ` ✗${v.wrong}` : " ✓"}
        </span>
      ))}
    </p>
  );
}

function WriteOut({ passages, onPatch }: {
  passages: MemoryPassage[]; onPatch(id: string, f: (p: MemoryPassage) => MemoryPassage): void;
}) {
  const [id, setId] = useState(passages[0].id);
  const [byVerse, setByVerse] = useState(false);
  const p = passages.find((x) => x.id === id) ?? passages[0];
  const verses = useMemo(() => splitVerses(p.body), [p.body]);
  const record = useRecord(onPatch);

  return (
    <div className="drill">
      <div className="drill-head">
        <select className="ver" aria-label="외울 본문" value={p.id} onChange={(e) => setId(e.target.value)}>
          {passages.map((x) => <option key={x.id} value={x.id}>{x.ref}</option>)}
        </select>
        {verses.length >= 2 && (
          <div className="seg" role="group" aria-label="쓰기 방식">
            <button type="button" aria-pressed={!byVerse} onClick={() => setByVerse(false)}>통으로</button>
            <button type="button" aria-pressed={byVerse} onClick={() => setByVerse(true)}>한 절씩</button>
          </div>
        )}
      </div>
      {byVerse && verses.length >= 2
        ? <VerseByVerse key={p.id} p={p} verses={verses} record={record} />
        : <Whole key={p.id} p={p} verses={verses} record={record} />}
    </div>
  );
}

function Whole({ p, verses, record }: { p: MemoryPassage; verses: VerseLine[]; record: RecordFn }) {
  const [text, setText] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [initials, setInitials] = useState(false);

  const check = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const g = gradeRecitation(p.body, text);
    setGrade(g);
    const wrong = new Set(g.wrongWords);
    record(p.id, g.perfect, tokenize(p.body).map((_, i) => i).filter((i) => !wrong.has(i)), g.wrongWords);
  };

  return (
    <form className="card write" onSubmit={check} aria-label="외워 쓰기">
      <div className="card-top">
        <h3 className="ref">{p.ref}</h3>
        <button type="button" className="ghost" aria-pressed={initials} onClick={() => setInitials((v) => !v)}>첫 글자 힌트</button>
      </div>
      {initials && <p className="vtext initials">{verses.map((v) => initialsOf(v.words)).join("\n")}</p>}
      <label className="sub" htmlFor="recite">{p.ref}을(를) 외운 대로 쓰세요. 띄어쓰기·문장부호·절 번호는 채점하지 않습니다.</label>
      <textarea
        id="recite" className="recite" value={text} rows={Math.min(14, Math.max(6, verses.length + 2))}
        onChange={(e) => { setText(e.target.value); setGrade(null); }}
        autoComplete="off" autoCorrect="off" spellCheck={false}
      />
      <div className="card-actions">
        <button type="button" className="ghost" onClick={() => { setText(""); setGrade(null); }}>지우기</button>
        <button type="submit" className="btn-primary" disabled={!text.trim()}>채점</button>
      </div>
      {grade && (
        <div className={"feedback " + (grade.perfect ? "ok" : "no")} role="status">
          <p className="feedback-title">
            {grade.perfect ? "토씨 하나 틀리지 않았습니다" : `${grade.total}어절 중 ${grade.wrongWords.length}어절이 다릅니다`}
          </p>
          {verses.length >= 2 && <VerseChips items={grade.byVerse} />}
          {!grade.perfect && <DiffView grade={grade} />}
        </div>
      )}
    </form>
  );
}

/** One verse at a time: write it, see it graded at once, go on. Good for a long chapter on a phone. */
function VerseByVerse({ p, verses, record }: { p: MemoryPassage; verses: VerseLine[]; record: RecordFn }) {
  const [k, setK] = useState(0);
  const [text, setText] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [done, setDone] = useState<{ n: number; wrong: number }[]>([]);
  const [initials, setInitials] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const v = verses[k];

  const restart = (from: number) => { setK(from); setText(""); setGrade(null); setDone([]); };
  const advance = (g: Grade) => {
    setDone((d) => [...d, { n: v.n, wrong: g.wrongWords.length }]);
    setK((x) => x + 1);
    setText("");
    setGrade(null);
    box.current?.focus();
  };
  const check = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || !v) return;
    if (grade) { advance(grade); return; }
    const g = gradeRecitation(v.words.join(" "), text);
    const wrong = new Set(g.wrongWords);
    record(p.id, g.perfect, v.words.map((_, i) => i).filter((i) => !wrong.has(i)).map((i) => i + v.start), g.wrongWords.map((i) => i + v.start), [k], true);
    if (g.perfect) advance(g);
    else setGrade(g);
  };

  if (!v) {
    const right = done.filter((d) => !d.wrong).length;
    return (
      <div className="card write">
        <div className={"feedback " + (right === done.length ? "ok" : "no")} role="status">
          <p className="feedback-title">{done.length}절 중 {right}절을 토씨 하나 틀리지 않고 썼습니다</p>
          <VerseChips items={done} />
          <button type="button" className="btn-primary" onClick={() => restart(0)}>처음부터 다시</button>
        </div>
      </div>
    );
  }

  return (
    <form className="card write" onSubmit={check} aria-label="한 절씩 쓰기">
      <div className="card-top">
        <h3 className="ref">{p.ref}</h3>
        <span className="score">{k + 1} / {verses.length}</span>
      </div>
      {done.length > 0 && <VerseChips items={done} />}
      <div className="card-top">
        <label className="sub">
          시작{" "}
          <select className="ver" aria-label="시작 절" value={k} onChange={(e) => restart(+e.target.value)}>
            {verses.map((x, i) => <option key={i} value={i}>{x.n}</option>)}
          </select>
        </label>
        <button type="button" className="ghost" aria-pressed={initials} onClick={() => setInitials((x) => !x)}>첫 글자 힌트</button>
      </div>
      {k > 0 && <p className="vtext quiz-context anchor">{(verses[k - 1].words.length > 6 ? "… " : "") + verses[k - 1].words.slice(-6).join(" ")}</p>}
      {initials && <p className="vtext initials">{initialsOf(v.words)}</p>}
      <label className="sub" htmlFor="recite-verse">이어지는 절을 쓰고 Enter</label>
      <textarea
        id="recite-verse" ref={box} className="recite" value={text} rows={3}
        onChange={(e) => { if (!grade) setText(e.target.value); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); check(); } }}
        readOnly={!!grade} autoComplete="off" autoCorrect="off" spellCheck={false}
      />
      {grade && (
        <div className="feedback no" role="status">
          <p className="feedback-title">{grade.total}어절 중 {grade.wrongWords.length}어절이 다릅니다</p>
          <DiffView grade={grade} />
        </div>
      )}
      <div className="card-actions">
        {grade && <button type="button" className="ghost" onClick={() => { setGrade(null); setText(""); box.current?.focus(); }}>이 절 다시</button>}
        <button type="submit" className="btn-primary" disabled={!text.trim()}>{grade ? "다음 절" : "채점"}</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- manage

function Manage({ passages, onChange }: { passages: MemoryPassage[]; onChange(): void }) {
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const reset = () => { setEditing(null); setRef(""); setBody(""); };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!ref.trim() || !body.trim()) return;
    setBusy(true);
    try {
      await repo.saveMemoryPassage({ id: editing ?? undefined, ref: ref.trim(), body: body.trim() });
      toast(editing ? "고쳤습니다" : "추가했습니다. 문제에 바로 섞입니다");
      reset();
      onChange();
    } catch (err) {
      toast(`저장하지 못했습니다: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await repo.deleteMemoryPassage(id);
      setConfirmDel(null);
      if (editing === id) reset();
      onChange();
    } catch (err) {
      toast(`삭제하지 못했습니다: ${(err as Error).message}`);
    }
  };

  return (
    <div className="results">
      <form className="card memo-form" onSubmit={save} aria-label={editing ? "암송 본문 고치기" : "암송 본문 추가"}>
        <h2 className="quiz-prompt">{editing ? "본문 고치기" : "외울 말씀 추가"}</h2>
        <label className="sub" htmlFor="memo-ref">장절</label>
        <input id="memo-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="예: 빌립보서 4:6-7" maxLength={100} />
        <label className="sub" htmlFor="memo-body">본문</label>
        <textarea
          id="memo-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={5000}
          placeholder={"한 줄에 한 절. 절 번호는 있어도 없어도 됩니다\n1   내 아들아 …\n2   그리하면 …"}
        />
        {body.trim() && <VersePreview body={body} />}
        {editing && <p className="sub">본문을 바꾸면 이 본문의 약한 어절 기록이 처음부터 다시 쌓입니다.</p>}
        <div className="card-actions">
          {editing && <button type="button" className="ghost" onClick={reset}>취소</button>}
          <button type="submit" className="btn-primary" disabled={busy || !ref.trim() || !body.trim()}>{editing ? "저장" : "추가"}</button>
        </div>
        <p className="sub">입력한 본문은 내 계정에만 저장되고, 문제는 이 기기 안에서 만들어집니다(외부 AI로 보내지 않음).</p>
      </form>

      {passages.length > 0 && (
        <div className="result-head"><h2><strong>{passages.length}</strong>개 본문 · 문제는 전체에서 섞여 나옵니다</h2></div>
      )}
      {passages.map((x) => {
        const seen = x.correct + x.wrong;
        const words = tokenize(x.body);
        const weak = Object.entries(x.misses).sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([i]) => words[Number(i)]).filter(Boolean);
        return (
          <article key={x.id} className="card memo-item">
            <div className="card-top">
              <h3 className="ref">{x.ref}</h3>
              <span className="score">{seen ? `${seen}회 · 정답률 ${Math.round((100 * x.correct) / seen)}%` : "아직 안 풀어 봄"}</span>
            </div>
            <p className="vtext memo-body">{splitVerses(x.body).map((v) => v.words.join(" ")).join("\n")}</p>
            <VerseBar p={x} />
            {weak.length > 0 && (
              <div className="tags" aria-label="자주 틀리는 어절">
                <span className="sub">자주 틀림</span>
                {weak.map((w, i) => <span key={i} className="tag">{w}</span>)}
              </div>
            )}
            <div className="card-actions">
              <button type="button" className="ghost" onClick={() => { setEditing(x.id); setRef(x.ref); setBody(x.body); window.scrollTo(0, 0); }}>고치기</button>
              {confirmDel === x.id ? (
                <>
                  <button type="button" className="ghost" onClick={() => setConfirmDel(null)}>취소</button>
                  <button type="button" className="ghost danger" onClick={() => remove(x.id)}>정말 삭제</button>
                </>
              ) : (
                <button type="button" className="ghost" onClick={() => setConfirmDel(x.id)}>삭제</button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** How the text will be split into verses, before saving: a wrong split shows up right away. */
function VersePreview({ body }: { body: string }) {
  const vs = splitVerses(body);
  if (vs.length < 2) return <p className="sub">한 덩어리로 저장합니다. 절 순서 문제를 풀려면 한 줄에 한 절씩 넣으세요.</p>;
  return (
    <div className="preview">
      <p className="sub"><b>{vs.length}절</b>로 나눴습니다 · {vs.reduce((s, v) => s + v.words.length, 0)}어절</p>
      <ol>
        {vs.map((v, i) => <li key={i}><span className="vnum-sm">{v.n}</span> {v.words.slice(0, 6).join(" ")}{v.words.length > 6 ? " …" : ""}</li>)}
      </ol>
    </div>
  );
}

/** One cell per verse, filled by level (1 알아보기 … 4 암송하기); outlined where I still miss a lot. */
function VerseBar({ p }: { p: MemoryPassage }) {
  const vs = splitVerses(p.body);
  const miss = vs.map((v) => {
    let n = 0;
    for (let i = v.start; i < v.start + v.words.length; i++) n += p.misses[i] ?? 0;
    return n;
  });
  const lv = vs.map((_, i) => verseLevel(p, i));
  const done = lv.filter((x) => x === 4).length;
  return (
    <div className="verse-bar-wrap">
      <div className="verse-bar" role="img" aria-label={`절별 단계: ${vs.map((v, i) => `${v.n}절 ${lv[i]}단계`).join(", ")}`}>
        {vs.map((v, i) => (
          <span key={i} className={`cell lv${lv[i]}` + (miss[i] >= 3 ? " bad" : "")} title={`${v.n}절 · ${lv[i]}단계 ${LEVEL_LABEL[lv[i]]} · 틀림 ${miss[i]}`} />
        ))}
      </div>
      <p className="verse-bar-legend">
        {vs.length > 1 ? `${vs.length}절 중 ${done}절 암송하기 단계` : `${lv[0]}단계 ${LEVEL_LABEL[lv[0]]}`} · 칸이 진할수록 높은 단계
      </p>
    </div>
  );
}
