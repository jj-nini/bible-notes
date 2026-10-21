import { Fragment, useEffect, useMemo, useState } from "react";
import { repo } from "../data";
import { bookName, getBook, stepChapter } from "../data/books";
import type { Verse, Version } from "../data/types";
import { READER_SIZES, type ReaderState } from "../lib/state";
import { type LoadStats, useTranslations } from "../lib/translations";
import { BookPicker } from "./BookPicker";
import { TranslationBlock } from "./TranslationBlock";

interface ToolbarProps {
  state: ReaderState;
  versions: Version[];
  onChange(patch: Partial<ReaderState>): void;
}

const visibleTranslatable = (s: ReaderState, versions: Version[]) =>
  [...new Set(s.parallel ? [s.v1, s.v2] : [s.v1])].filter((c) => versions.find((v) => v.code === c)?.translatable);

export function ReaderToolbar({ state: s, versions, onChange }: ToolbarProps) {
  const [picker, setPicker] = useState(false);
  const prev = stepChapter(s.book, s.chapter, -1);
  const next = stepChapter(s.book, s.chapter, 1);
  const canKo = visibleTranslatable(s, versions).length > 0;
  const go = (to: { book: string; chapter: number } | null) => to && onChange({ ...to, hl: null, fromSearch: false });

  return (
    <div className="reader-bar">
      <div className="chap-nav">
        <button type="button" className="icon-btn" aria-label="이전 장" disabled={!prev} onClick={() => go(prev)}>‹</button>
        <button type="button" className="chapter-btn" onClick={() => setPicker(true)}>
          {bookName(s.book)} {s.chapter}{s.book === "PSA" ? "편" : "장"} <small>▾</small>
        </button>
        <button type="button" className="icon-btn" aria-label="다음 장" disabled={!next} onClick={() => go(next)}>›</button>
      </div>
      <div className="tools">
        <select className="ver" aria-label="번역본" value={s.v1} onChange={(e) => onChange({ v1: e.target.value })}>
          {versions.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
        </select>
        <button
          type="button" className="toggle" aria-pressed={s.parallel}
          onClick={() => onChange({
            parallel: !s.parallel,
            v2: s.v2 === s.v1 ? versions.find((v) => v.code !== s.v1)?.code ?? s.v2 : s.v2,
          })}
        >대조</button>
        {s.parallel && (
          <select className="ver" aria-label="대조 번역본" value={s.v2} onChange={(e) => onChange({ v2: e.target.value })}>
            {versions.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
          </select>
        )}
        <button
          type="button" className="toggle" aria-pressed={s.ko && canKo} disabled={!canKo}
          title={canKo ? "DB에 저장된 한글 번역을 모두 표시 (새로 번역하지 않음)" : "AMP·MSG·NIV를 고르면 쓸 수 있습니다"}
          onClick={() => onChange({ ko: !s.ko })}
        >한글 번역</button>
        <button
          type="button" className="toggle" aria-label="글자 크기"
          onClick={() => onChange({ size: (s.size + 1) % READER_SIZES.length })}
        >가<span className="small-ga">가</span></button>
      </div>
      {picker && (
        <BookPicker
          currentBook={s.book} currentChapter={s.chapter}
          onClose={() => setPicker(false)}
          onPick={(book, chapter) => { setPicker(false); go({ book, chapter }); window.scrollTo(0, 0); }}
        />
      )}
    </div>
  );
}

interface ViewProps {
  state: ReaderState;
  versions: Version[];
  onBackToSearch(): void;
}

export function ReaderView({ state: s, versions, onBackToSearch }: ViewProps) {
  const tr = useTranslations();
  const shown = useMemo(() => (s.parallel ? [s.v1, s.v2] : [s.v1]), [s.parallel, s.v1, s.v2]);
  const chapKey = `${s.book}.${s.chapter}|${shown.join(",")}`;
  const [data, setData] = useState<{ key: string; byVer: Record<string, Verse[]> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<(LoadStats & { vers: string[] }) | null>(null);
  const koVers = s.ko ? visibleTranslatable(s, versions) : [];
  const koKey = koVers.join(",");
  // Verses whose translation I opened one by one (with the top toggle off), as "VER|n"
  const [opened, setOpened] = useState<Set<string>>(new Set());
  useEffect(() => setOpened(new Set()), [chapKey]);
  const isTranslatable = (ver: string) => !!versions.find((v) => v.code === ver)?.translatable;
  const toggleVerse = (ver: string, n: number) => {
    const k = `${ver}|${n}`;
    const next = new Set(opened);
    if (next.has(k)) next.delete(k);
    else {
      next.add(k);
      tr.load(ver, [{ book: s.book, chapter: s.chapter, verse: n }]);
    }
    setOpened(next);
  };

  useEffect(() => {
    let alive = true;
    setError(null);
    Promise.all(shown.map((v) => repo.getChapter(v, s.book, s.chapter)))
      .then((lists) => alive && setData({ key: chapKey, byVer: Object.fromEntries(shown.map((v, i) => [v, lists[i]])) }))
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [chapKey, shown, s.book, s.chapter]);

  const ready = data?.key === chapKey;

  // Top toggle: show what the DB already has for this chapter; translating is per verse
  useEffect(() => {
    if (!ready || !koKey) { setBatch(null); return; }
    let alive = true;
    const vers = koKey.split(",");
    Promise.all(vers.map((v) => tr.load(v, data!.byVer[v] ?? []))).then((stats) => {
      if (!alive) return;
      setBatch({
        vers,
        total: stats.reduce((a, x) => a + x.total, 0),
        hit: stats.reduce((a, x) => a + x.hit, 0),
        miss: stats.reduce((a, x) => a + x.miss, 0),
      });
    });
    return () => { alive = false; };
    // tr.load is stable; re-run only when the chapter or the translated versions change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, chapKey, koKey]);

  useEffect(() => {
    if (!ready || s.hl == null) return;
    const el = document.getElementById(`v-${s.hl}`);
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
  }, [ready, s.hl]);

  const name = (code: string) => versions.find((v) => v.code === code)?.name ?? code;
  const unit = s.book === "PSA" ? "편" : "장";
  const numbers = ready
    ? [...new Set(shown.flatMap((v) => data!.byVer[v].map((x) => x.verse)))].sort((a, b) => a - b)
    : [];
  const verseOf = (ver: string, n: number) => data?.byVer[ver]?.find((x) => x.verse === n);
  const textOf = (ver: string, n: number) => verseOf(ver, n)?.text;
  /** The earlier verse whose combined block (e.g. MSG 4–5) already covers verse n. */
  const coveredBy = (ver: string, n: number) =>
    data?.byVer[ver]?.find((x) => x.verse < n && (x.verse_end ?? 0) >= n);
  const rangeLabel = (v?: Verse) => (v?.verse_end ? `${v.verse}–${v.verse_end}` : null);

  return (
    <section style={{ ["--reader-size" as string]: READER_SIZES[s.size] }}>
      {s.fromSearch && <button type="button" className="back-chip" onClick={onBackToSearch}>← 검색 결과로</button>}
      <div className="chapter-head">
        <h2>{getBook(s.book)?.ko} {s.chapter}{unit}</h2>
        <p>{shown.map(name).join(" · ")}</p>
      </div>

      {s.ko && batch && batch.total > 0 && (
        <div className="batch">
          {batch.vers.map(name).join("·")} 한글 번역: <b>{batch.hit}</b>/{batch.total}절 저장됨
          {batch.miss > 0 && " · 없는 절은 절마다 엔진을 골라 번역하세요"}
        </div>
      )}

      {error && <div className="empty"><p>본문을 불러오지 못했습니다.</p><p className="sub">{error}</p></div>}
      {!error && !ready && <div className="skeleton" />}
      {ready && numbers.length === 0 && (
        <div className="empty">
          <p>이 장의 본문 데이터가 아직 없습니다.</p>
          {repo.mode === "local" && <p className="sub">샘플 데이터에는 이사야 41장, 마태복음 11장, 빌립보서 4장의 일부 절만 있습니다.</p>}
        </div>
      )}

      {ready && numbers.length > 0 && (
        <div className="verses">
          {s.parallel && (
            <div className="par-head" aria-hidden="true">
              <span />
              <div className="cols two">
                <span className="col-label">{name(s.v1)}</span>
                <span className="col-label alt">{name(s.v2)}</span>
              </div>
            </div>
          )}
          {numbers.map((n, i) => {
            const prevN = i === 0 ? 0 : numbers[i - 1];
            const ref = { book: s.book, chapter: s.chapter, verse: n };
            return (
              <Fragment key={n}>
                {n > prevN + 1 && <div className="gap-row">{prevN + 1 === n - 1 ? prevN + 1 : `${prevN + 1}–${n - 1}`}절 · 본문 데이터 없음</div>}
                <div className={`verse-row ${s.hl === n ? "hl" : ""}`} id={`v-${n}`}>
                  <span className="vnum">{(!s.parallel && rangeLabel(verseOf(shown[0], n))) || n}</span>
                  <div className={`cols ${s.parallel ? "two" : ""}`}>
                    {shown.map((ver, ci) => (
                      <div key={ver + ci} className={`col ${ci === 1 ? "alt" : ""}`}>
                        <p className="vtext" lang={versions.find((v) => v.code === ver)?.lang ?? "ko"}>
                          {s.parallel && rangeLabel(verseOf(ver, n)) && <span className="range">{rangeLabel(verseOf(ver, n))}절 </span>}
                          {textOf(ver, n) ?? (coveredBy(ver, n)
                            ? <span className="missing">↑ {rangeLabel(coveredBy(ver, n))}절에 함께 옮김</span>
                            : <span className="missing">이 번역본에는 본문이 없습니다</span>)}
                        </p>
                        {textOf(ver, n) && isTranslatable(ver) && !koVers.includes(ver) && (
                          <button
                            type="button" className="verse-ko" aria-pressed={opened.has(`${ver}|${n}`)}
                            aria-label={`${n}절 ${name(ver)} 한글 번역`}
                            onClick={() => toggleVerse(ver, n)}
                          >한글</button>
                        )}
                        {textOf(ver, n) && (koVers.includes(ver) || opened.has(`${ver}|${n}`)) && <TranslationBlock version={ver} verseRef={ref} />}
                      </div>
                    ))}
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
      {ready && numbers.length > 0 && shown.some((c) => versions.find((v) => v.code === c)?.copyright) && (
        <div className="copyright">
          {[...new Set(shown)].map((c) => {
            const v = versions.find((x) => x.code === c);
            return v?.copyright ? <p key={c}><b>{v.name}</b> {v.copyright}</p> : null;
          })}
        </div>
      )}
    </section>
  );
}
