import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { repo, supabase } from "./data";
import type { VerseRef, Version } from "./data/types";
import { Login } from "./components/Login";
import { ReaderToolbar, ReaderView } from "./components/Reader";
import { MemorizeBar, MemorizeView, type MemoMode } from "./components/Memorize";
import { SearchBar, SearchView } from "./components/Search";
import { ToTop } from "./components/ToTop";
import { useToast } from "./lib/toast";
import { loadReader, saveReader, type ReaderState, type SearchMode, type SearchQuery } from "./lib/state";

type Tab = "read" | "search" | "memo";
type User = { id: string; email: string | null };

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (supabase && session === undefined) return null;
  if (supabase && !session) return <Login supabase={supabase} />;
  return <Main user={session ? { id: session.user.id, email: session.user.email ?? null } : null} />;
}

function Main({ user }: { user: User | null }) {
  const [tab, setTab] = useState<Tab>("read");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reader, setReader] = useState<ReaderState>(loadReader);
  const [q, setQ] = useState("불안할 때");
  const [mode, setMode] = useState<SearchMode>("topic");
  const [query, setQuery] = useState<SearchQuery | null>(null);
  const [randomNonce, setRandomNonce] = useState(0);
  const [memoMode, setMemoMode] = useState<MemoMode>("drill");
  const [memoSeen, setMemoSeen] = useState(false);
  useEffect(() => { if (tab === "memo") setMemoSeen(true); }, [tab]);

  useEffect(() => {
    repo.listVersions().then((vs) => {
      setVersions(vs);
      const has = (c: string) => vs.some((v) => v.code === c);
      if (vs.length) setReader((s) => ({
        ...s,
        v1: has(s.v1) ? s.v1 : vs[0].code,
        v2: has(s.v2) ? s.v2 : (vs.find((v) => v.translatable) ?? vs[vs.length - 1]).code,
      }));
    }, (e: Error) => setLoadError(e.message));
  }, []);
  useEffect(() => saveReader(reader), [reader]);

  const patchReader = useCallback((p: Partial<ReaderState>) => setReader((s) => ({ ...s, ...p })), []);

  const submit = (text: string, m: SearchMode) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMode(m);
    setQuery((prev) => ({ q: trimmed, mode: m, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  const openTab = (t: Tab) => {
    setTab(t);
    if (t === "search" && !query) submit(q, mode);
  };

  const readFromSearch = (ref: VerseRef, version: string, ko: boolean) => {
    setReader((s) => ({ ...s, book: ref.book, chapter: ref.chapter, v1: version, parallel: false, ko, hl: ref.verse, fromSearch: true }));
    setTab("read");
  };

  if (loadError) return <div className="wrap"><div className="empty"><p>앱 데이터를 불러오지 못했습니다.</p><p className="sub">{loadError}</p></div></div>;
  if (!versions) return <div className="wrap"><main><div className="skeleton" /></main></div>;
  if (!versions.length) return <NoVersions user={user} />;

  return (
    <>
      {repo.mode === "local" && <div className="mock-note">샘플 데이터 모드 · Supabase 환경변수를 넣으면 실제 DB로 바뀝니다</div>}
      <header className="top">
        <div className="wrap top-inner">
          <div className="brand-row">
            <div className="brand-left">
              <h1 className="brand">말씀 노트</h1>
              <nav className="nav-tabs" role="tablist" aria-label="메뉴">
                <button type="button" role="tab" aria-selected={tab === "read"} onClick={() => openTab("read")}>성경읽기</button>
                <button type="button" role="tab" aria-selected={tab === "search"} onClick={() => openTab("search")}>성구찾기</button>
                <button type="button" role="tab" aria-selected={tab === "memo"} onClick={() => openTab("memo")}>암송</button>
              </nav>
            </div>
            <div className="brand-right">
              {user ? (
                <button type="button" className="user" title={user.email ?? user.id} onClick={() => supabase?.auth.signOut()}>로그아웃</button>
              ) : (
                <span className="user">나만 보기</span>
              )}
            </div>
          </div>
          {tab === "read" ? <ReaderToolbar state={reader} versions={versions} onChange={patchReader} />
            : tab === "search" ? <SearchBar q={q} mode={mode} onQ={setQ} onSubmit={submit} />
            : <MemorizeBar mode={memoMode} onMode={setMemoMode} />}
        </div>
      </header>

      <div className="wrap">
        <main>
          <div hidden={tab !== "read"}>
            <ReaderView
              state={reader} versions={versions}
              onBackToSearch={() => { patchReader({ fromSearch: false, hl: null }); setTab("search"); window.scrollTo(0, 0); }}
            />
          </div>
          <div hidden={tab !== "search"}>
            <SearchView
              query={query} randomNonce={randomNonce} versions={versions}
              onRandom={() => setRandomNonce((n) => n + 1)}
              onSwitchToKeyword={() => submit(q, "keyword")}
              onRead={readFromSearch}
            />
          </div>
          {/* Mounted on first visit only, then kept so an unfinished drill survives tab switches */}
          {(tab === "memo" || memoSeen) && (
            <div hidden={tab !== "memo"}>
              <MemorizeView mode={memoMode} active={tab === "memo"} onMode={setMemoMode} />
            </div>
          )}
        </main>
        <footer>
          {repo.mode === "local"
            ? "샘플 본문은 화면 확인용이며 실제 번역본과 다를 수 있습니다."
            : "개인용 · 본문 저작권은 각 번역본 저작권자에게 있습니다."}
        </footer>
      </div>
      <ToTop />
    </>
  );
}

/** Signed in, but RLS returned no versions: the account isn't in app_users, or no data was imported. */
function NoVersions({ user }: { user: User | null }) {
  const toast = useToast();
  const copy = () => {
    if (!user) return;
    try {
      navigator.clipboard.writeText(user.id).then(() => toast("UID를 복사했습니다"), () => toast("복사할 수 없습니다. 직접 선택해 복사하세요"));
    } catch {
      toast("복사할 수 없습니다. 직접 선택해 복사하세요");
    }
  };
  return (
    <div className="wrap">
      <main>
        <div className="empty no-versions">
          <p><strong>볼 수 있는 번역본이 없습니다.</strong></p>
          <p className="sub">로그인은 됐지만 DB에서 읽어 온 데이터가 0건입니다. 원인은 보통 둘 중 하나입니다.</p>
          <ol className="sub">
            <li>
              <b>이 계정이 허용 목록(app_users)에 없음</b> · SQL Editor에서 실행:
              <code>insert into app_users (user_id) values ('{user?.id ?? "<UID>"}');</code>
            </li>
            <li>
              <b>데이터를 아직 넣지 않음</b> · 터미널에서 <code>node scripts/import.ts --sample</code> 실행 (README 5단계)
            </li>
          </ol>
          {user && (
            <p className="sub">
              로그인한 계정: {user.email ?? "(이메일 없음)"} · UID <code className="uid">{user.id}</code>{" "}
              <button type="button" className="mini" onClick={copy}>UID 복사</button>
            </p>
          )}
          <p className="sub">처리한 뒤 새로고침하세요.</p>
          {supabase && <button type="button" className="ghost" onClick={() => supabase!.auth.signOut()}>로그아웃</button>}
        </div>
      </main>
    </div>
  );
}
