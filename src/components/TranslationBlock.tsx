import { useState } from "react";
import { choiceOf, ENGINE_CHOICES, engineLabel, type VerseRef } from "../data/types";
import { useToast } from "../lib/toast";
import { type Entry, useTranslations } from "../lib/translations";

interface Props {
  version: string;
  verseRef: VerseRef;
}

// Confirmed first, then in engine order; manual and older rows last
const ORDER = ["google-v2", "google-v3", "claude"];
const rank = (t: Entry) => (t.status === "fixed" ? -1 : (() => {
  const i = ORDER.indexOf(choiceOf(t.engine) ?? "");
  return i < 0 ? ORDER.length : i;
})());

/** Every engine's translation of one verse, plus buttons to add the engines not tried yet. */
export function TranslationBlock({ version, verseRef }: Props) {
  const tr = useTranslations();
  const toast = useToast();
  const all = [...tr.list(version, verseRef)].sort((a, b) => rank(a) - rank(b));
  const checked = tr.isChecked(version, verseRef);
  const pending = ENGINE_CHOICES.filter((c) => tr.isLoading(version, verseRef, c.id));
  const untried = ENGINE_CHOICES.filter((c) => !all.some((x) => choiceOf(x.engine) === c.id) && !pending.includes(c));
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(`저장하지 못했습니다: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!checked) {
    return (
      <div className="ko-trans">
        <div className="trans-meta"><span className="badge pending">불러오는 중</span><span className="trans-src">DB 확인 중…</span></div>
        <div className="line-skel" />
      </div>
    );
  }

  return (
    <div className="ko-trans">
      {all.length === 0 && pending.length === 0 && draft === null && (
        <div className="trans-meta"><span className="badge pending">번역 없음</span><span className="trans-src">아래에서 엔진을 골라 번역하세요</span></div>
      )}

      {all.length > 0 && (
        <ul className={`trans-list ${all.some((t) => t.status === "fixed") ? "has-fixed" : ""}`}>
          {all.map((t) => (
            <li key={t.engine} className={t.status === "fixed" ? "is-fixed" : ""}>
              <div className="trans-meta">
                <span className="engine-chip">{engineLabel(t.engine)}</span>
                {t.status === "fixed"
                  ? <span className="badge fixed">확정됨{t.edited ? " · 직접 수정" : ""}</span>
                  : <span className="badge machine">기계 번역</span>}
                {t.fresh && <span className="trans-src">방금 번역</span>}
                <span className="row-actions">
                  {t.status === "fixed"
                    ? <button type="button" className="mini" disabled={busy} onClick={() => run(() => tr.unfix(version, verseRef, t.engine))}>확정 해제</button>
                    : <button type="button" className="mini strong" disabled={busy} onClick={() => run(() => tr.fix(version, verseRef, t.engine))}>확정</button>}
                  <button type="button" className="mini" disabled={busy} onClick={() => setDraft(t.text)}>수정</button>
                </span>
              </div>
              <p>{t.text}</p>
            </li>
          ))}
        </ul>
      )}

      {pending.map((c) => (
        <div key={c.id} className="trans-meta">
          <span className="engine-chip">{c.label}</span><span className="trans-src">번역 중…</span>
        </div>
      ))}

      {draft !== null ? (
        <div className="trans-edit">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="한글 번역 수정" autoFocus />
          <div className="trans-actions">
            <button
              type="button" className="mini strong" disabled={busy || !draft.trim()}
              onClick={() => run(async () => { await tr.saveEdit(version, verseRef, draft.trim()); setDraft(null); })}
            >직접 입력으로 확정</button>
            <button type="button" className="mini" disabled={busy} onClick={() => setDraft(null)}>취소</button>
          </div>
        </div>
      ) : (
        <div className="trans-actions">
          {untried.map((c) => (
            <button
              key={c.id} type="button" className="mini engine-add"
              onClick={() => tr.load(version, [verseRef], { translate: true, engine: c.id })}
            >+ {c.label}</button>
          ))}
          {!all.some((t) => t.engine === "manual") && (
            <button type="button" className="mini" onClick={() => setDraft("")}>직접 입력</button>
          )}
        </div>
      )}
    </div>
  );
}
