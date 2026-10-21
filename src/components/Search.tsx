import { useEffect, useState, type FormEvent } from "react";
import { repo } from "../data";
import { formatRef } from "../data/books";
import { type Synonym, type Verse, type VerseRef, type Version, refKey } from "../data/types";
import type { SearchMode, SearchQuery } from "../lib/state";
import { useToast } from "../lib/toast";
import { matchTopics, type TopicMatch } from "../lib/topicSearch";
import { useTranslations } from "../lib/translations";
import { TranslationBlock } from "./TranslationBlock";

const CHIPS = ["염려", "두려움", "지쳤을 때", "감사", "기쁨"];

interface BarProps {
  q: string;
  mode: SearchMode;
  onQ(q: string): void;
  onSubmit(q: string, mode: SearchMode): void;
}

export function SearchBar({ q, mode, onQ, onSubmit }: BarProps) {
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(q, mode); };
  return (
    <div className="search-bar">
      <form className="search" role="search" onSubmit={submit}>
        <input
          id="q" type="search" value={q} onChange={(e) => onQ(e.target.value)}
          placeholder="주제나 상황을 입력하세요 (예: 지쳤을 때, 감사)" aria-label="검색어"
        />
        <button className="btn-primary" type="submit">찾기</button>
      </form>
      <div className="controls">
        <div className="seg" role="group" aria-label="검색 방식">
          <button type="button" aria-pressed={mode === "topic"} onClick={() => onSubmit(q, "topic")}>주제 검색</button>
          <button type="button" aria-pressed={mode === "keyword"} onClick={() => onSubmit(q, "keyword")}>단어 검색</button>
        </div>
        <div className="chips" aria-label="자주 찾는 주제">
          {CHIPS.map((c) => (
            <button key={c} type="button" className="chip" onClick={() => { onQ(c); onSubmit(c, mode); }}>{c}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Item extends VerseRef {
  score: number | null;
  tags: Record<string, number>;
}

type Result =
  | { kind: "search"; query: SearchQuery; match: TopicMatch | null; items: Item[]; texts: Map<string, Record<string, Verse>> }
  | { kind: "random"; items: Item[]; texts: Map<string, Record<string, Verse>> };

let synonymsCache: Promise<Synonym[]> | null = null;
const getSynonyms = () => (synonymsCache ??= repo.getSynonyms());

async function textsFor(refs: VerseRef[]) {
  const map = new Map<string, Record<string, Verse>>();
  for (const v of await repo.getVersesForRefs(refs)) {
    const k = refKey(v);
    map.set(k, { ...map.get(k), [v.version]: v });
  }
  return map;
}

interface ViewProps {
  query: SearchQuery | null;
  randomNonce: number;
  versions: Version[];
  onRandom(): void;
  onSwitchToKeyword(): void;
  onRead(ref: VerseRef, version: string, ko: boolean): void;
}

export function SearchView({ query, randomNonce, versions, onRandom, onSwitchToKeyword, onRead }: ViewProps) {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query) return;
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      let match: TopicMatch | null = null;
      let items: Item[];
      if (query.mode === "topic") {
        match = matchTopics(query.q, await getSynonyms());
        if (!match.topics.length) {
          repo.logSearchMiss(query.q).catch(() => {});
          items = [];
        } else {
          items = await repo.versesByTopics(match.topics);
        }
      } else {
        items = (await repo.searchKeyword(query.q)).map((r) => ({ ...r, score: null, tags: {} }));
      }
      const texts = await textsFor(items);
      if (alive) setResult({ kind: "search", query, match, items, texts });
    })()
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [query]);

  useEffect(() => {
    if (!randomNonce) return;
    let alive = true;
    setLoading(true);
    (async () => {
      const r = await repo.randomTaggedVerse();
      const items = r ? [{ ...r, score: null, tags: {} }] : [];
      const texts = await textsFor(items);
      if (alive) setResult({ kind: "random", items, texts });
    })()
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [randomNonce]);

  if (loading) return <div className="results"><div className="skeleton" /><div className="skeleton" /></div>;
  if (error) return <div className="empty"><p>검색하지 못했습니다.</p><p className="sub">{error}</p></div>;
  if (!result) return null;

  if (result.kind === "random") {
    return (
      <div className="results">
        <div className="result-head">
          <h2><strong>랜덤 한 구절</strong></h2>
          <button type="button" className="link-btn" onClick={onRandom}>다시 뽑기</button>
        </div>
        {result.items.map((it) => (
          <VerseCard key={refKey(it)} item={it} texts={result.texts.get(refKey(it)) ?? {}} versions={versions} label="랜덤" topics={[]} onRead={onRead} />
        ))}
      </div>
    );
  }

  const { query: rq, match, items } = result;
  const modeLabel = rq.mode === "topic" ? "주제 검색" : "단어 검색";
  return (
    <div className="results">
      <div className="result-head">
        <h2><strong>“{rq.q}”</strong> {items.length ? `관련 구절 ${items.length}개 · ` : ""}{modeLabel}</h2>
        <button type="button" className="link-btn" onClick={onRandom}>랜덤 한 구절</button>
      </div>
      {match && match.topics.length > 0 && (
        <p className="match-line">동의어 사전 매칭: <b>{match.terms.join(", ")}</b> → {match.topics.map((t) => `#${t}`).join(" ")}</p>
      )}
      {!items.length && rq.mode === "topic" && (
        <div className="empty">
          <p>주제 사전에 없는 표현입니다.</p>
          <p className="sub">“{rq.q}”을(를) 미매칭 검색어로 기록했습니다. 나중에 사전을 보강할 때 씁니다.</p>
          <button type="button" className="ghost" onClick={onSwitchToKeyword}>본문 단어 검색으로 다시 찾기</button>
        </div>
      )}
      {!items.length && rq.mode === "keyword" && (
        <div className="empty"><p>“{rq.q}”이(가) 들어간 구절이 없습니다.</p></div>
      )}
      {items.map((it) => (
        <VerseCard
          key={refKey(it)} item={it} texts={result.texts.get(refKey(it)) ?? {}} versions={versions}
          label={it.score != null ? `주제 가중치 ${it.score.toFixed(2)}` : "본문 일치"}
          topics={match?.topics ?? []} highlight={rq.mode === "keyword" ? rq.q : undefined} onRead={onRead}
        />
      ))}
    </div>
  );
}

function Highlighted({ text, q }: { text: string; q?: string }) {
  if (!q) return <>{text}</>;
  const parts: (string | { m: string })[] = [];
  const lower = text.toLowerCase(), needle = q.toLowerCase();
  let i = 0;
  for (let j = lower.indexOf(needle); needle && j >= 0; j = lower.indexOf(needle, i)) {
    parts.push(text.slice(i, j), { m: text.slice(j, j + needle.length) });
    i = j + needle.length;
  }
  parts.push(text.slice(i));
  return <>{parts.map((p, k) => (typeof p === "string" ? p : <mark key={k}>{p.m}</mark>))}</>;
}

interface CardProps {
  item: Item;
  texts: Record<string, Verse>;
  versions: Version[];
  label: string;
  topics: string[];
  highlight?: string;
  onRead(ref: VerseRef, version: string, ko: boolean): void;
}

function VerseCard({ item, texts, versions, label, topics, highlight, onRead }: CardProps) {
  const tr = useTranslations();
  const toast = useToast();
  const available = versions.filter((v) => texts[v.code]);
  const [ver, setVer] = useState(available[0]?.code ?? "");
  const [ko, setKo] = useState(false);
  const cur = versions.find((v) => v.code === ver);
  const ref = { book: item.book, chapter: item.chapter, verse: item.verse };

  const copy = () => {
    const end = texts[ver]?.verse_end;
    const text = `${texts[ver]?.text} (${formatRef(ref)}${end ? `–${end}` : ""}, ${cur?.name ?? ver})`;
    try {
      navigator.clipboard.writeText(text).then(() => toast("복사했습니다"), () => toast("이 환경에서는 복사할 수 없습니다"));
    } catch {
      toast("이 환경에서는 복사할 수 없습니다");
    }
  };

  return (
    <article className="card">
      <div className="card-top">
        <h3 className="ref">{formatRef(ref)}</h3>
        <span className="score">{label}</span>
      </div>
      {Object.keys(item.tags).length > 0 && (
        <div className="tags">
          {Object.keys(item.tags).map((t) => <span key={t} className={`tag ${topics.includes(t) ? "on" : ""}`}>#{t}</span>)}
        </div>
      )}
      <div className="tabs" role="tablist" aria-label="번역본">
        {available.map((v) => (
          <button key={v.code} type="button" role="tab" aria-selected={v.code === ver} onClick={() => { setVer(v.code); setKo(false); }}>
            {v.name}
          </button>
        ))}
      </div>
      <p className="vtext" lang={cur?.lang ?? "ko"}><Highlighted text={texts[ver]?.text ?? ""} q={highlight} /></p>
      {texts[ver]?.verse_end && (
        <p className="range-note">{cur?.name}은 {item.verse}–{texts[ver].verse_end}절을 한 단락으로 옮겼습니다</p>
      )}
      {cur?.translatable && ko && <TranslationBlock version={ver} verseRef={ref} />}
      <div className="card-actions">
        {cur?.translatable && (
          <button
            type="button" className="ghost" aria-pressed={ko}
            onClick={() => {
              if (!ko) tr.load(ver, [ref]);
              setKo(!ko);
            }}
          >{ko ? "번역 숨기기" : "한글 번역 보기"}</button>
        )}
        <button type="button" className="ghost" onClick={copy}>복사</button>
        <button type="button" className="ghost go" onClick={() => onRead(ref, ver, ko && !!cur?.translatable)}>읽기모드로 보기</button>
      </div>
    </article>
  );
}
