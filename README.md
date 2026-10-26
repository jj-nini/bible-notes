# 말씀 노트

개인용 성경 읽기 + 주제별 성구 찾기 웹앱.

- **성경읽기** (기본 화면): 책·장 이동, 번역본 전환(개역개정 / NIV / MSG / AMP), 대조 보기, 글자 크기
- **성구찾기**: 주제 검색(동의어 사전 → 주제 → 가중치) / 본문 단어 검색, 결과에서 **읽기모드로 보기**
- **MSG·AMP 한글 번역**: DB를 먼저 찾고, 없을 때만 기계 번역(Google) 후 `machine`으로 저장. **확정 저장**하면 `fixed`, 직접 수정도 가능
- **암송**: 내가 입력한 본문으로 객관식 문제를 끝없이 만들어 반복(빈칸 · 정확한 본문 · 틀린 곳 찾기 · 이어지는 말 · 첫마디 · 장절), 외워 쓰기는 글자 단위로 채점
- 런타임에 LLM 없음. 주제 사전과 구절 태그는 설계 단계에서 미리 만들어 DB에 넣음. 암송 문제도 브라우저에서 규칙으로 생성

## 문서

- [개발 저널](docs/journal/00-overview.md): 왜 그렇게 결정했는지, 선택지 비교, 디버깅 과정, 배운 것
- [PRD · TRD](docs/prd-trd.md): 요구사항과 기술 설계, 변경 이력
- 서비스: [jj-nini.github.io/bible-notes](https://jj-nini.github.io/bible-notes/)

## 바로 실행 (샘플 데이터)

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 단위 + UI 흐름 테스트
```

Supabase 환경변수가 없으면 내장 샘플(이사야 41:10, 마태복음 11:28–30, 빌립보서 4:4–9)로 동작합니다.
샘플 모드의 번역 저장은 이 브라우저의 localStorage에만 남습니다.

## 구조

```
src/
  data/
    types.ts          Repo 인터페이스 (화면은 이것만 사용)
    localRepo.ts      샘플 데이터 구현
    supabaseRepo.ts   Supabase 구현
    index.ts          환경변수 유무로 둘 중 하나 선택
    books.ts          66권, 장 수, 이전/다음 장 계산
    sample/           샘플 본문 · 주제 사전
  lib/
    topicSearch.ts    검색어 → 주제 매칭 (순수 함수)
    translations.tsx  번역 캐시 상태 (DB 우선 → 없으면 일괄 기계 번역)
    memorize.ts       암송 문제 생성(토씨·어미 바꾸기)과 외워 쓰기 채점 (순수 함수)
  components/         Reader, Search, Memorize, TranslationBlock, BookPicker, Login, ToTop
supabase/
  migrations/         테이블 · RLS · RPC
  functions/translate Google 번역 v3 호출 + machine 저장 (Edge Function)
scripts/import.ts     본문 · 주제 사전을 DB에 넣는 스크립트
```

## Supabase 연결

1. [supabase.com](https://supabase.com)에서 프로젝트를 만듭니다.
2. **SQL Editor**에서 `supabase/migrations/20261020000000_init.sql` 내용을 실행합니다.
3. **Authentication → Sign In / Providers → Email**에서 *Allow new users to sign up*을 끕니다.
   **Authentication → Users → Add user**로 내 계정을 만듭니다 (Auto confirm).
4. SQL Editor에서 내 계정을 허용 목록에 넣습니다. 이 표에 없는 계정은 로그인해도 아무것도 못 읽습니다.
   ```sql
   insert into app_users (user_id) values ('<Users 화면의 내 UID>');
   ```
5. 데이터를 넣습니다. service role 키는 **Project Settings → API**에 있고, 내 컴퓨터에서만 씁니다.
   ```bash
   node scripts/import.ts --sample   # 주소는 .env.local에서 읽고, 키는 실행 중에 물어봄 (화면에 표시 안 됨)
   # 실제 데이터: data/private/ 아래 JSON (git에 올라가지 않음). 형식은 scripts/import.ts 상단 주석 참고
   ```
6. 번역 함수를 배포합니다. 설정은 아래 **한글 번역** 절을 보세요.
7. `.env.example`을 `.env.local`로 복사해 URL과 **anon** 키를 넣고 `npm run dev`.

anon 키는 브라우저에 노출되는 공개 키입니다. 데이터 보호는 RLS(`app_users`)가 맡습니다.

무료 플랜은 일주일 동안 요청이 없으면 프로젝트가 일시정지됩니다. 대시보드에서 다시 켤 수 있고 데이터는 유지됩니다.

## 실제 데이터 넣기

먼저 SQL Editor에서 `supabase/migrations/`의 `20261020010000_sources.sql`(출처·수집일)과 `20261020020000_verse_ranges.sql`(MSG처럼 여러 절을 묶은 구간)을 순서대로 실행합니다.
각 스크립트는 Supabase 주소를 `.env.local`에서 읽고, service_role 키는 실행할 때 물어봅니다.

```bash
# 개역한글 전체 (bolls.life 공개 데이터, 31,103절)
node scripts/import-krv.ts

# NIV · AMP · MSG (API.Bible, 무료 플랜 하루 5,000회 중 약 3,600회 사용)
node scripts/fetch-apibible.ts --list            # 내 키로 쓸 수 있는 번역본과 bibleId
node scripts/fetch-apibible.ts --dry-run PHP.4   # 한 장만 받아서 출력 (DB에 안 씀)
node scripts/fetch-apibible.ts                   # 전체. 중단해도 다시 실행하면 이어서 받음

# API.Bible 약관: 캐시는 14일 이내에 비우기
node scripts/purge-apibible.ts                   # 14일 지난 것만
node scripts/purge-apibible.ts --all             # 전부
```

API.Bible 키는 `APIBIBLE_KEY` 환경변수로 줘도 됩니다.

## 한글 번역 (엔진 3종: Google v2 · Google v3 · Claude)

- 상단 **[한글 번역]**: DB에 저장된 번역만 보여 줍니다 (번역하지 않음).
- 절마다 **[한글]**: 그 절의 번역을 엽니다 (조회만). 저장된 번역이 **엔진별로 모두 함께** 보입니다.
- 절 안의 **[+ Google v2] [+ Google v3] [+ Claude]**: 그 엔진으로 번역해 `machine`으로 저장합니다. 이미 번역한 엔진은 버튼이 사라집니다.
- 각 번역의 **[확정]**: 절마다 확정은 1개이며, 다른 걸 확정하면 이전 확정은 `machine`으로 돌아갑니다.
- **수정**한 번역은 엔진 `manual`로 저장되고 확정됩니다.

먼저 SQL Editor에서 `supabase/migrations/20261021000000_engines.sql`을 실행합니다.

| 엔진 | Secret | 비고 |
|---|---|---|
| Google v2 | `GOOGLE_TRANSLATE_API_KEY` | API 키 (애플리케이션 제한 없음, API 제한은 Cloud Translation만) |
| Google v3 | `GOOGLE_SERVICE_ACCOUNT`, `GOOGLE_TRANSLATE_MODEL` (`nmt`/`llm`) | 서비스 계정 키 JSON, 역할 *Cloud Translation API 사용자* |
| Claude | `ANTHROPIC_API_KEY` | 모델 `claude-sonnet-5-5`, 개역체, 앞뒤 3절 문맥 + 개역한글 표기 참고, 서버 측 fallback 사용 |

```bash
npx supabase secrets set ANTHROPIC_API_KEY=... --project-ref <ref>
npx supabase secrets set GOOGLE_SERVICE_ACCOUNT="$(cat 키파일.json)" --project-ref <ref>   # 키 파일은 등록 후 삭제
npx supabase functions deploy translate --project-ref <ref> --use-api
```

비용: Claude Sonnet 5.5는 입력 $2 / 출력 $10 (100만 토큰당). 절 단위로 쓰면 소액이고, 번역본 전체를 일괄 번역하려면 먼저 분량으로 추정하세요.
Google v2/v3 NMT는 월 50만 자 무료 이후 100만 자당 약 $20. 정확한 요금은 각 가격 페이지를 확인하세요.

### Claude Code로 일괄 번역 (`claude -p`, 키 불필요)

이 PC의 Claude Code 로그인으로 번역해 `claude-sonnet-5-5` 엔진으로 저장합니다 (앱의 [+ Claude]와 같은 프롬프트·엔진).
같은 책의 여러 장을 약 1만 2천 자씩 묶어 호출하고, Claude 번역이 없는 절만 보내므로 다시 실행하면 이어서 합니다.

```bash
node scripts/translate-claude-cli.ts MSG --plan     # 분량과 예상 사용량만 확인
node scripts/translate-claude-cli.ts MSG            # 전체 (확인 후 시작)
node scripts/translate-claude-cli.ts MSG PHP JHN.3  # 일부 책·장만
```

사용량 한도에 걸리면 저장한 데까지 남기고 멈춥니다. 한도가 풀린 뒤 같은 명령을 다시 실행하세요.

`.env.local`에 `VITE_TRANSLATOR=chrome`을 넣으면 Chrome 내장 번역(PC Chrome 138+, 키 불필요)을 대신 씁니다.

## 암송

SQL Editor에서 `supabase/migrations/20261026000000_memorize.sql`을 실행합니다.

- **본문 관리**에서 장절과 본문을 직접 입력합니다. 본문은 `memory_passages`에 **입력한 계정만 볼 수 있게** 저장됩니다(RLS).
- **문제 풀기**: 넣은 본문 전체에서 섞어 냅니다. 틀린 어절은 몇 문제 뒤 다른 형태로 다시 나오고, 자주 틀린 어절과 본문이 더 자주 나옵니다.
- **외워 쓰기**: 외운 대로 쓰면 글자 단위로 비교합니다. 띄어쓰기와 문장부호는 채점하지 않습니다.
- 오답 보기는 규칙으로 만듭니다(조사 `께↔에게`, 어미 `하라↔하리라`, 높임 `하시고↔하고`, 헷갈리는 낱말, 빠뜨린 어절, 순서 바뀜). 외부 AI로 본문을 보내지 않습니다.

## GitHub Pages 배포

1. GitHub에 저장소를 만들고 push합니다.
2. **Settings → Pages → Source**를 *GitHub Actions*로 바꿉니다.
3. **Settings → Secrets and variables → Actions → Variables**에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 넣습니다.
   넣지 않으면 샘플 모드로 배포됩니다.

`main`에 push할 때마다 테스트 → 빌드 → 배포가 실행됩니다.

## 저작권 메모

개역개정, NIV, MSG, AMP는 모두 저작권이 있는 번역본입니다.

- 전체 본문은 **Supabase에만** 넣고 저장소에는 올리지 않습니다 (`data/private/`는 `.gitignore` 처리됨).
- `src/data/sample/`에는 화면 확인용으로 10개 구절이 들어 있습니다. 공개 저장소에 올리기 전에 유지할지 정하세요.
- 접근은 `app_users`에 등록한 계정으로만 제한됩니다.
- 암송 본문은 사용자가 직접 입력해 **자기 계정에만** 저장합니다. 저장소에도, 외부 서비스에도 가지 않습니다.
