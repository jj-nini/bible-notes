# 말씀 노트 — PRD · TRD

| 항목 | 값 |
|---|---|
| 문서 버전 | 1.0.1 (2026-10-21) |
| 서비스 | [jj-nini.github.io/bible-notes](https://jj-nini.github.io/bible-notes/) |
| 저장소 | [jj-nini/bible-notes](https://github.com/jj-nini/bible-notes) |
| 개발 과정 | [개발 저널](journal/00-overview.md) |

> 기능을 추가하거나 바꿀 때 이 문서를 함께 고칩니다. 맨 아래 [변경 이력](#변경-이력)에 한 줄을 남깁니다.

---

# Part 1. PRD (제품 요구사항)

## 1. 문제

AMP(Amplified Bible)는 `[ ]`·`( )`로 원어의 여러 뜻을 펼쳐 보여 주고, MSG(The Message)는 현대어로 의역합니다.
이 뉘앙스를 **한국어로 옮겨 개역한글과 나란히 비교**하며 읽을 도구가 없습니다. 기존 성경 앱은 번역본을 나란히 보여 줄 뿐, 영어 확장 번역의 한글 뜻은 보여 주지 않습니다.

## 2. 사용자와 범위

- **사용자:** 본인과 지인 몇 명 (개인용)
- **접근:** 로그인한 등록 사용자만 (가입 차단, 허용 목록)
- **비목표:** 공개 서비스, 다수 사용자, 상업적 이용, 성경 본문 재배포

## 3. 기능 요구사항

### F1. 성경읽기 (기본 화면)
- 66권·장 선택, 이전/다음 장 (책 경계 넘어감, 시편은 "편")
- 번역본 선택: 개역한글 · AMP · MSG · NIV (이 순서)
- **대조 보기:** 두 번역본 나란히. 번역본 이름은 맨 위 한 줄만, 모바일은 세로로 쌓고 두 번째에 세로선
- MSG 등 **절 묶음 번역**은 `4–5`로 표시, 묶인 절 자리에는 "↑ 4–5절에 함께 옮김"
- 글자 크기 4단계, 마지막 위치·번역본 기억(브라우저)
- 위로 스크롤할 때만 나타나는 "맨 위로" 버튼

### F2. 성구찾기
- **주제 검색:** 입력 → 동의어 사전 → 주제 → 가중치 순 구절. 매칭 경로 표시(`불안 → #염려 #두려움`)
- 사전에 없으면 안내 + **단어 검색**으로 대체, 미매칭 검색어 기록
- 단어 검색은 일치 부분 하이라이트
- 결과 카드: 번역본 탭, 복사, **읽기모드로 보기**(해당 장으로 이동, 절 하이라이트, "← 검색 결과로")
- 랜덤 한 구절 (태그된 구절 중)
- **런타임에 LLM을 쓰지 않음**

### F3. 한글 번역 (AMP · MSG · NIV)
- 상단 **[한글 번역]**: DB에 저장된 번역만 표시 (번역 실행 없음)
- 절의 **[한글]**: 그 절의 번역 영역 열기 (조회만)
- 절 안 **[+ Google v2] [+ Google v3] [+ Claude]**: 그 엔진으로 번역 실행·저장. 이미 있는 엔진은 버튼 숨김
- **엔진별 번역을 모두 보관**하고 한 절에 함께 표시
- **확정은 절마다 하나**. 다른 것을 확정하면 이전 확정은 기계 번역으로
- **수정/직접 입력**은 "직접 입력" 엔진으로 저장되고 확정됨

### F4. 데이터 관리 (로컬 스크립트)
- 개역한글 전체 적재
- API.Bible에서 NIV·AMP·MSG 수집, **14일 안에 정리**
- `claude -p`로 번역본 단위 일괄 번역 (이어 하기, 예상 사용량 표시)

## 4. 비기능 요구사항

| 항목 | 요구 |
|---|---|
| 보안 | 본문·번역은 로그인한 등록 사용자만. 비밀 키는 브라우저·저장소에 없음 |
| 비용 | 호스팅 무료(Pages + Supabase 무료 플랜). 번역은 사용자가 누를 때만 |
| 저작권 | 전체 본문은 저장소에 올리지 않음. API.Bible 데이터는 14일 정리 |
| 개발 | 외부 계정 없이도 샘플 모드로 앱·테스트 실행 |
| 접근성 | 키보드 포커스 표시, 라이트·다크 테마 |

## 5. 결정된 제약과 트레이드오프

| 결정 | 대가 |
|---|---|
| Supabase 무료 플랜 | 7일 미사용 시 일시정지 |
| 런타임 LLM 없는 검색 | 사전·태그를 만드는 수고, 사전에 없는 표현은 단어 검색으로 |
| API.Bible 본문을 DB에 저장 | 캐시 약관(연속 500절 미만)과 어긋남 → 14일 정리로 범위 제한 |
| 공개 저장소 | 코드 공개 (데이터는 RLS로 보호) |

---

# Part 2. TRD (기술 설계)

## 6. 아키텍처

```text
[브라우저: React SPA on GitHub Pages]
   │  supabase-js (anon 키, RLS)
   ▼
[Supabase] ─ Auth(이메일/비번, 가입 차단) ─ Postgres(RLS) ─ Edge Function "translate"
                                                            │
                                     ┌──────────────────────┼─────────────────────┐
                                     ▼                      ▼                     ▼
                               Google v2 (API 키)   Google v3 (서비스 계정)   Claude API

[내 PC (WSL) 스크립트] ── service_role 키 ──▶ Postgres
   import-krv (bolls.life) · fetch-apibible (API.Bible) · translate-claude-cli (claude -p)
```

화면은 `Repo` 인터페이스만 의존합니다. 환경변수가 없으면 `localRepo`(샘플), 있으면 `supabaseRepo`.

## 7. 기술 스택

| 영역 | 기술 |
|---|---|
| 프론트엔드 | Vite, React, TypeScript |
| 백엔드 | Supabase (Postgres, Auth, RLS, Edge Functions on Deno) |
| 번역 | Cloud Translation v2 / v3, Anthropic SDK (`claude-sonnet-5-5`), Claude Code CLI |
| 테스트 | Vitest, Testing Library, jsdom, PGlite(로컬 SQL 검증) |
| 배포 | GitHub Actions → GitHub Pages |

## 8. 데이터 모델

| 테이블 | 키 | 주요 열 | 비고 |
|---|---|---|---|
| `app_users` | `user_id` | | 허용 목록, 정책 없음(SQL로만 관리) |
| `versions` | `code` | `name, lang, translatable, sort, source(local/apibible), source_id, copyright` | |
| `verses` | `version, book, chapter, verse` | `text, verse_end, fetched_at` | `verse_end`: 절 묶음 끝, `fetched_at`: 14일 정리 기준 |
| `translations` | `version, book, chapter, verse, lang, engine` | `text, status(machine/fixed), edited, updated_at` | **부분 유니크: 절마다 fixed 하나** |
| `topics` | `id` | `description` | |
| `topic_synonyms` | `term, topic_id` | | |
| `verse_topics` | `book, chapter, verse, topic_id` | `weight` | 번역본과 무관 |
| `search_misses` | `id` | `query, created_at` | 사전 보강용 |

엔진 이름(`translations.engine`): `google-v2`, `google-v3-nmt`, `google-v3-llm`, `claude-sonnet-5-5`, `manual`, `chrome-builtin`, `legacy`, `sample`.

### RPC (모두 security invoker → RLS 적용)

| 함수 | 용도 |
|---|---|
| `is_app_user()` | (security definer) 허용 목록 확인 |
| `verses_for_refs(refs jsonb)` | 여러 구절의 모든 번역본 |
| `translations_for_refs(ver, refs)` | 여러 구절의 번역(엔진별) |
| `verses_by_topics(topic_ids, max)` | 주제 → 가중치 순 구절 + 태그 |
| `random_tagged_verse()` | 태그된 구절 중 하나 |
| `fix_translation(ver, b, c, v, eng)` | 확정 전환 (한 트랜잭션) |
| `save_manual_translation(ver, b, c, v, txt)` | 직접 입력 저장 + 확정 |

### 마이그레이션 순서

1. `20261020000000_init.sql` — 테이블, RLS, RPC
2. `20261020010000_sources.sql` — 출처, 저작권, 수집일
3. `20261020020000_verse_ranges.sql` — `verse_end`
4. `20261021000000_engines.sql` — 엔진별 보관, 확정 RPC

## 9. Edge Function `translate`

**요청:** `POST { version, refs: [{book, chapter, verse}] (≤200), engine: "google-v2" | "google-v3" | "claude" }` + 사용자 JWT

**처리:**
1. 사용자 JWT로 Supabase 클라이언트 생성 → 이후 모든 쿼리에 RLS 적용
2. 번역본이 `translatable`인지 확인
3. 그 **엔진 이름**의 번역이 없는 절만 추림
4. 엔진별 호출 (아래), 결과를 `machine`으로 upsert(`ignoreDuplicates`)

| 엔진 | 인증 | 배치 | 비고 |
|---|---|---|---|
| google-v2 | `GOOGLE_TRANSLATE_API_KEY`를 **헤더**로 | 100절 | 에러 메시지에서 키 마스킹 |
| google-v3 | `GOOGLE_SERVICE_ACCOUNT` → JWT 서명 → OAuth 토큰(캐시) | 50절·2만 자 | `GOOGLE_TRANSLATE_MODEL`=nmt(global) / llm(us-central1) |
| claude | `ANTHROPIC_API_KEY` | 장 단위, 40절·1.2만 자 | 앞뒤 3절 문맥 + 개역한글 표기 참고, JSON 스키마 출력, 서버 측 fallback, refusal 확인 |

**Claude 번역 원칙 (비교 연구용 직역):** 모든 단어·괄호 내용을 빠짐없이, 나열은 합치지 않음, 개역한글은 인명·지명 표기에만, 평이한 문어체(~하라, ~이다), LORD→여호와.

## 10. 로컬 스크립트

| 스크립트 | 입력 | 출력 | 특징 |
|---|---|---|---|
| `import.ts` | `--sample` 또는 JSON | versions·verses·사전·태그 | |
| `import-krv.ts` | bolls.life `KRV.json` | 개역한글 31,103절 | 완전성 검사(1,189장) |
| `fetch-apibible.ts` | API.Bible | NIV·AMP·MSG | `--list`, `--dry-run`, 이어 받기, 429 재시도 |
| `purge-apibible.ts` | | 삭제 | 14일 지난 것 / `--all` / `--translations` |
| `translate-claude-cli.ts` | `<VERSION> [NT|OT|BOOK|BOOK.CH]` | Claude 번역 | `--plan`, 이어 하기, 한도 감지, `--parallel` |

공통: Supabase URL은 `.env.local`, service_role 키는 **숨김 입력**(anon 키 거부, Ctrl+C/D 처리).

## 11. 보안

| 비밀 | 위치 | 절대 두지 않는 곳 |
|---|---|---|
| anon 키 | `.env.local`, GitHub Variables | (공개 키) |
| service_role 키 | 실행할 때 숨김 입력 | 저장소, 브라우저, 채팅 |
| Google API 키, 서비스 계정 JSON, Anthropic 키 | Supabase Secrets | 저장소, 브라우저, URL |

- `.gitignore`: `.env.*`(예시 제외), `data/private/`, `supabase/.temp/`, `*.pem`, `*.key`, `*service-account*.json` 등
- 커밋 작성자: GitHub noreply 이메일
- RLS: 모든 테이블, `app_users` 허용 목록

## 12. 테스트

| 범위 | 개수 | 예 |
|---|---|---|
| 화면 흐름 | 9 | 장 이동, 주제 검색 → 읽기모드, 절 단위 엔진 번역, 확정 전환, 빈 DB 안내 |
| 단위 | 35 | 주제 매칭, 파서, 묶음 번역, `claude -p` 파싱, v2/v3/Claude 엔진 모듈(JWT 서명 검증 포함) |

`npm test`는 항상 **샘플 모드**로 돌고(`vite.config.ts`의 `test.env`), 배포 파이프라인에서 빌드 전에 실행됩니다.

## 13. 알려진 한계와 다음 일

- Edge Function 본체(`index.ts`)는 Deno 전용이라 로컬 단위 테스트 밖 (엔진 모듈은 테스트됨)
- FUMS(API.Bible 사용 추적) 미적용: 본문을 DB에서 읽기 때문
- 다음 계획: AMP 신약·MSG 일괄 번역 완료, API.Bible 본문 정리, v3 Translation LLM 비교, 주제 사전 보강, 지인 공유, 로컬 브리지(`claude -p`를 앱에서), 구절 북마크

---

## 변경 이력

| 버전 | 날짜 | 변경 |
|---|---|---|
| 0.1 | 2026-10-20 | 목업: 두 메뉴, 대조, 번역 확정 흐름 |
| 0.2 | 2026-10-20 | 앱 뼈대, Repo 인터페이스, 샘플 모드, 스키마·RLS |
| 0.3 | 2026-10-20 | Supabase 연결, 빈 DB 안내 화면 |
| 0.4 | 2026-10-20 | 개역한글·API.Bible 수집, 절 묶음(`verse_end`), 14일 정리 |
| 0.5 | 2026-10-21 | 번역 엔진: Chrome → Google v2(헤더 키) → v3(서비스 계정) → Claude |
| 0.6 | 2026-10-21 | 엔진별 보관, 확정 RPC, 절 단위 엔진 버튼, 직역 프롬프트 |
| 0.7 | 2026-10-21 | `claude -p` 일괄 번역 스크립트 |
| 1.0 | 2026-10-21 | 공개 저장소, GitHub Pages 배포 |
| 1.0.1 | 2026-10-21 | 개발 저널, PRD-TRD 문서 |
