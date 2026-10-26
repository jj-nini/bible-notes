import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { repo } from "../data";
import type { MemoryPassage } from "../data/types";
import {
  KIND_LABEL, applyResult, gradeRecitation, makeQuestion, pickPassage, tokenize, type Grade, type Question,
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

function useRecord(onPatch: (id: string, f: (p: MemoryPassage) => MemoryPassage) => void) {
  const toast = useToast();
  return useCallback((id: string, ok: boolean, hit: number[], miss: number[]) => {
    onPatch(id, (p) => applyResult(p, ok, hit, miss));
    repo.recordMemoryResult(id, ok, hit, miss).catch((e: Error) => toast(`기록하지 못했습니다: ${e.message}`));
  }, [onPatch, toast]);
}

function Drill({ passages, active, onPatch }: {
  passages: MemoryPassage[]; active: boolean; onPatch(id: string, f: (p: MemoryPassage) => MemoryPassage): void;
}) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState<Question | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [stats, setStats] = useState({ asked: 0, right: 0, streak: 0 });
  const retries = useRef<Retry[]>([]);
  const timer = useRef<number>(undefined);
  const record = useRecord(onPatch);

  const pool = useMemo(
    () => (filter === "all" ? passages : passages.filter((p) => p.id === filter)),
    [passages, filter],
  );
  // Pick from the latest stats, but don't regenerate the question when only the stats change
  const poolRef = useRef(pool);
  poolRef.current = pool;

  const next = useCallback((asked: number) => {
    window.clearTimeout(timer.current);
    const ps = poolRef.current;
    const due = retries.current.findIndex((r) => r.due <= asked && ps.some((p) => p.id === r.passageId));
    let q: Question | null = null;
    if (due >= 0) {
      const [r] = retries.current.splice(due, 1);
      q = makeQuestion(ps.find((p) => p.id === r.passageId)!, passages, Math.random, r.word);
    }
    for (let tries = 0; !q && tries < 5; tries++) {
      const p = pickPassage(ps, Math.random);
      if (p) q = makeQuestion(p, passages, Math.random);
    }
    setQ(q);
    setPicked(null);
  }, [passages]);

  // A new question only when the range changes (stats updates also change `next`)
  useEffect(() => { retries.current = []; next(0); }, [filter]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const answer = useCallback((i: number) => {
    if (!q || picked !== null) return;
    const ok = i === q.answer;
    setPicked(i);
    const asked = stats.asked + 1;
    setStats((s) => ({ asked: s.asked + 1, right: s.right + (ok ? 1 : 0), streak: ok ? s.streak + 1 : 0 }));
    record(q.passageId, ok, ok ? q.words : [], ok ? [] : q.words);
    if (ok) timer.current = window.setTimeout(() => next(asked), 900);
    // Missed it: the same word comes back in a different form a few questions later
    else retries.current.push({ passageId: q.passageId, word: q.words[0], due: asked + 3 });
  }, [q, picked, stats.asked, record, next]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (picked === null && q && q.kind !== "wrong" && /^[1-9]$/.test(e.key) && Number(e.key) <= q.choices.length) answer(Number(e.key) - 1);
      else if (picked !== null && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(stats.asked); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, picked, q, answer, next, stats.asked]);

  const p = q && passages.find((x) => x.id === q.passageId);
  const ok = picked !== null && q && picked === q.answer;
  const pct = stats.asked ? Math.round((100 * stats.right) / stats.asked) : 0;

  return (
    <div className="drill">
      <div className="drill-head">
        <p className="drill-stats" aria-live="polite">
          <b>{stats.asked}</b>문제 · 정답 <b>{stats.right}</b>{stats.asked > 0 && ` (${pct}%)`} · 연속 <b>{stats.streak}</b>
        </p>
        <select className="ver" aria-label="문제 범위" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">전체 본문 ({passages.length})</option>
          {passages.map((x) => <option key={x.id} value={x.id}>{x.ref}</option>)}
        </select>
      </div>

      {!q ? (
        <div className="empty"><p>이 본문으로는 문제를 만들 수 없습니다.</p><p className="sub">어절이 둘 이상인 본문을 넣어 주세요.</p></div>
      ) : (
        <section className="card quiz" aria-label="문제">
          <div className="card-top">
            <span className="tag on">{KIND_LABEL[q.kind]}</span>
            {q.kind !== "ref" && p && <span className="score">{p.ref}</span>}
          </div>
          <h2 className="quiz-prompt">{q.prompt}</h2>

          {q.context && (
            <p className="vtext quiz-context">
              {q.context.before}
              {q.context.blank && (
                <span className={"blank" + (picked !== null ? " filled" : "")}>
                  {picked !== null ? q.choices[q.answer] : "　　　"}
                </span>
              )}
              {q.context.after}
              {!q.context.blank && q.kind === "next" && <span className="blank">　…　</span>}
            </p>
          )}

          {q.kind === "wrong" ? (
            <p className="vtext word-pick">
              {q.choices.map((w, i) => (
                <button
                  key={i} type="button" disabled={picked !== null}
                  className={picked === null ? "" : i === q.answer ? "right" : i === picked ? "wrong" : ""}
                  onClick={() => answer(i)}
                >{w}</button>
              ))}
            </p>
          ) : (
            <ol className="choices">
              {q.choices.map((c, i) => (
                <li key={i}>
                  <button
                    type="button" disabled={picked !== null}
                    className={"choice" + (picked === null ? "" : i === q.answer ? " right" : i === picked ? " wrong" : "")}
                    onClick={() => answer(i)}
                  >
                    <span className="choice-num" aria-hidden>{i + 1}</span>
                    <span className={q.kind === "ref" ? "" : "vtext"}>{c}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}

          {picked !== null && (
            <div className={"feedback " + (ok ? "ok" : "no")} role="status">
              <p className="feedback-title">{ok ? "정답" : "오답 · 곧 다시 나옵니다"}</p>
              {!ok && <p className="vtext reveal">{q.reveal}</p>}
              <button type="button" className="btn-primary" onClick={() => next(stats.asked)}>다음 문제</button>
            </div>
          )}
        </section>
      )}
      <p className="sub hint">숫자 키 1–4로 고르고 Enter로 넘어갑니다. 맞히면 자동으로 다음 문제로 갑니다.</p>
    </div>
  );
}

// ---------------------------------------------------------------- write from memory

function WriteOut({ passages, onPatch }: {
  passages: MemoryPassage[]; onPatch(id: string, f: (p: MemoryPassage) => MemoryPassage): void;
}) {
  const [id, setId] = useState(passages[0].id);
  const [text, setText] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [initials, setInitials] = useState(false);
  const record = useRecord(onPatch);
  const p = passages.find((x) => x.id === id) ?? passages[0];

  const choose = (v: string) => { setId(v); setText(""); setGrade(null); };
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
        <select className="ver" aria-label="외울 본문" value={p.id} onChange={(e) => choose(e.target.value)}>
          {passages.map((x) => <option key={x.id} value={x.id}>{x.ref}</option>)}
        </select>
        <button type="button" className="ghost" aria-pressed={initials} onClick={() => setInitials((v) => !v)}>첫 글자 힌트</button>
      </div>
      {initials && <p className="vtext initials">{tokenize(p.body).map((w) => w[0] + "○".repeat(Math.max(0, [...w].length - 1))).join(" ")}</p>}
      <label className="sub" htmlFor="recite">{p.ref}을(를) 외운 대로 쓰세요. 띄어쓰기와 문장부호는 채점하지 않습니다.</label>
      <textarea
        id="recite" className="recite" value={text} rows={6}
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
          {!grade.perfect && (
            <>
              <p className="vtext diff">
                {grade.parts.map((x, i) =>
                  x.type === "same" ? <span key={i}>{x.text}</span>
                  : x.type === "missing" ? <ins key={i} title="빠졌거나 틀린 글자">{x.text}</ins>
                  : <del key={i} title="본문에 없는 글자">{x.text}</del>)}
              </p>
              <p className="sub legend"><ins>본문 글자</ins> 빠뜨리거나 틀린 곳 · <del>쓴 글자</del> 본문에 없는 것</p>
            </>
          )}
        </div>
      )}
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
        <textarea id="memo-body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={5000} placeholder="외울 본문을 그대로 입력하세요" />
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
            <p className="vtext memo-body">{x.body}</p>
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
