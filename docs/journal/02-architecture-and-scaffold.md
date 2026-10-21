# 02. 아키텍처와 뼈대 — 계정 없이도 돌아가는 앱

## 배경

목업이 정해지자 실제 앱을 만들 차례였습니다. 이 시점에 Supabase 계정도, Google 계정도, 성경 데이터도 없었습니다.
그래서 **"외부 준비물이 하나도 없어도 앱과 테스트가 돌아가게"**를 첫 목표로 잡았습니다.

## 1. 결정: 프론트엔드 스택

| 선택지 | 장점 | 단점 | 이 프로젝트에서 |
|---|---|---|---|
| **Vite + React + TS** | 자료 많음, 상태가 많은 화면을 컴포넌트로 나누기 좋음 | 의존성이 조금 큼 | ✅ 선택 |
| Vite + 바닐라 TS | 목업 코드와 비슷, 가벼움 | 대조·번역 상태가 늘면 관리 어려움 | 화면 상태가 많아 제외 |
| SvelteKit (정적 빌드) | 코드 짧음 | 자료가 적음, 배우는 사람에게 부담 | 제외 |

화면 상태가 많습니다: 대조 여부, 번역본 2개, 한글 번역 표시, 절별 열림, 엔진별 번역 중 상태, 확정 상태.
상태가 많으면 **컴포넌트 + 타입**이 실수를 줄여 줍니다.

## 2. 결정: 데이터 계층을 인터페이스로 분리

가장 중요한 설계 결정입니다. 화면 코드는 Supabase를 직접 부르지 않고 `Repo` 인터페이스만 봅니다.

```ts
// src/data/types.ts (요약)
export interface Repo {
  mode: "local" | "supabase";
  listVersions(): Promise<Version[]>;
  getChapter(version: string, book: string, chapter: number): Promise<Verse[]>;
  getSynonyms(): Promise<Synonym[]>;
  versesByTopics(topics: string[], limit?: number): Promise<TopicHit[]>;
  searchKeyword(q: string, limit?: number): Promise<VerseRef[]>;
  getTranslations(version: string, refs: VerseRef[]): Promise<Translation[]>;
  translateMissing(version: string, refs: VerseRef[], onEach?, opts?: { engine?: EngineChoice }): Promise<Translation[]>;
  fixTranslation(version: string, ref: VerseRef, engine: string): Promise<void>;
  saveTranslationEdit(version: string, ref: VerseRef, text: string): Promise<void>;
  // …
}
```

구현은 두 개입니다.

```ts
// src/data/index.ts
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
export const repo: Repo = supabase ? createSupabaseRepo(supabase) : createLocalRepo();
```

| | `localRepo` (샘플 모드) | `supabaseRepo` |
|---|---|---|
| 언제 | 환경변수 없을 때 | 환경변수 있을 때 |
| 데이터 | 내장 10구절 + 주제 사전 | Supabase |
| 번역 | 가짜 번역기 (지연 700ms 흉내) | Edge Function |
| 로그인 | 없음 | 이메일 + 비밀번호 |

### 이 결정 덕분에 생긴 일

- 계정을 만들기 전부터 앱을 보고 테스트를 돌릴 수 있었습니다.
- 번역 엔진을 Chrome → Google → Claude로 **세 번 바꿨지만 화면 코드는 거의 그대로**였습니다(05장).
- 테스트는 항상 샘플 모드로 돌기 때문에 API 키 없이 CI에서도 통과합니다.

> **트레이드오프:** 인터페이스를 두 번 구현해야 합니다. 기능을 추가할 때마다 `localRepo`도 손봐야 하는 비용이 있습니다. 그래도 "외부 서비스 없이 개발·테스트"라는 이득이 훨씬 컸습니다.

## 3. 결정: 보안은 RLS로

Supabase의 anon 키는 **브라우저 코드에 들어가는 공개 키**입니다. 그래서 "키를 숨겨서 보호"가 아니라 **DB가 행 단위로 막는** RLS(Row Level Security)로 보호합니다.

```sql
-- supabase/migrations/20261020000000_init.sql
create table app_users (user_id uuid primary key references auth.users (id) on delete cascade);

create function is_app_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where user_id = auth.uid());
$$;

alter table verses enable row level security;
create policy "read" on verses for select using (is_app_user());
```

| 방식 | 문제 |
|---|---|
| RLS 없음 | 사이트 주소만 알면 누구나 DB 전체를 가져감 |
| "로그인한 사람이면 허용" | 가입이 열려 있으면 누구나 로그인 가능 |
| **허용 목록(`app_users`) + 가입 차단** | ✅ 내가 등록한 계정만 |

`is_app_user()`를 `security definer`로 만든 이유: `app_users` 테이블에는 정책이 없어서 일반 사용자가 직접 읽을 수 없습니다. 함수만 그 테이블을 볼 수 있게 한 것입니다.

## 4. 결정: SQL을 어떻게 검증하나 — PGlite

Supabase 계정이 없을 때 마이그레이션 SQL이 맞는지 어떻게 알까요? **PGlite**(WASM으로 돌아가는 Postgres)로 로컬에서 실행했습니다.

```js
// 검증 스크립트 요지 (scratchpad, 저장소에는 없음)
const db = new PGlite({ extensions: { pg_trgm } });
await db.exec(`create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
await db.exec(migrationSql);
// 등록된 사용자 / 미등록 사용자로 역할을 바꿔 가며 SELECT·INSERT 시도
```

확인한 것: 등록 사용자는 읽기·쓰기 가능, 미등록 사용자는 **조회 0건, RPC 0건, INSERT는 RLS 위반**. Supabase의 `auth` 스키마는 흉내 냈습니다.

> **배운 점:** 클라우드 서비스의 SQL도 대부분 로컬 Postgres로 먼저 검증할 수 있습니다. "배포해 봐야 안다"를 줄이면 디버깅 시간이 줄어듭니다.

## 5. 결정: 주제 검색 로직은 순수 함수로

```ts
// src/lib/topicSearch.ts
const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export function matchTopics(query: string, synonyms: Synonym[]): TopicMatch {
  const q = normalize(query);
  const terms = new Set<string>(), topics = new Set<string>();
  if (!q) return { terms: [], topics: [] };
  for (const { term, topic } of synonyms) {
    if (q.includes(normalize(term))) { terms.add(term); topics.add(topic); }
  }
  return { terms: [...terms], topics: [...topics] };
}
```

- **부분 문자열 매칭**을 고른 이유: 한국어 조사·어미("지쳤**을 때**", "불안**해요**")를 형태소 분석 없이 견딜 수 있습니다.
- **공백 제거**: "번 아웃"도 "번아웃"으로 찾습니다.
- 순수 함수라 DB 없이 단위 테스트가 됩니다.

## 6. 테스트 전략

| 종류 | 도구 | 무엇을 |
|---|---|---|
| 단위 | Vitest | 주제 매칭, 파서, 묶음 번역, 엔진 모듈 |
| 화면 흐름 | Testing Library + jsdom | "장 이동", "주제 검색 → 읽기모드 → 하이라이트 → 돌아오기" 같은 사용자 시나리오 |
| SQL | PGlite | 스키마, RPC, RLS |

화면 테스트는 **사용자가 보는 것**으로 찾습니다(`getByRole("button", { name: "다음 장" })`). 구현을 바꿔도 테스트가 덜 깨집니다.

### 겪은 문제: 테스트끼리 간섭

- **증상:** 혼자 돌리면 통과하는 테스트가 같이 돌리면 "Found multiple elements"로 실패
- **원인:** Vitest에서 globals를 끄면 Testing Library의 자동 정리가 동작하지 않아, 앞 테스트의 화면이 남아 있었음
- **해결:** `afterEach(() => { cleanup(); localStorage.clear(); })`
- **또 하나:** 샘플 repo가 모듈 단위 싱글턴이라 앞 테스트에서 번역한 결과가 남음 → 테스트마다 서로 안 겹치는 번역본(AMP, NIV)을 쓰도록 설계

## 배운 것

**주니어 관점**
- 외부 서비스가 준비되기 전에도 개발은 시작할 수 있다. 인터페이스 하나가 그걸 가능하게 한다.
- 공개 키(anon)와 비밀 키(service_role)는 다르다. 공개 키를 숨기려 애쓰지 말고, 데이터를 RLS로 지킨다.
- 테스트가 "가끔 실패"하면 테스트끼리 상태를 공유하고 있지 않은지 의심한다.

**시니어 관점**
- 의존성 역전(화면 → 인터페이스 ← 구현)은 거창한 패턴이 아니라 **"나중에 바뀔 것"을 한 곳에 가두는 일**이다. 실제로 번역 엔진이 세 번 바뀌었다.
- 보안 설계는 "막을 대상"부터 정한다. 여기서는 "가입 가능한 아무나"였고, 그래서 허용 목록이 답이었다.
- 클라우드 SQL을 로컬에서 검증하는 비용은 작고, 잡아 주는 버그는 크다.

## 참고 자료

- [Vite](https://vite.dev/) · [React](https://react.dev/) · [Vitest](https://vitest.dev/) · [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [PGlite](https://pglite.dev/)
