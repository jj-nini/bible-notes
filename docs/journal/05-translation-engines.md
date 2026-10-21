# 05. 번역 엔진의 진화 — Chrome → Google v2 → v3 → Claude → 엔진별 보관

## 배경

이 앱의 존재 이유는 **AMP의 `[ ]` 확장과 MSG의 의역을 한국어로 옮겨 비교**하는 것입니다.
번역 엔진은 다섯 번 바뀌었고, 바뀔 때마다 요구사항이 더 분명해졌습니다. 이 장은 그 과정을 그대로 따라갑니다.

## 전체 흐름

| 단계 | 엔진 | 바꾼 이유 |
|---|---|---|
| 1 | Google v2 (설계만) | 기본 선택 |
| 2 | **Chrome 내장 번역** | "Google API 키 꼭 있어야 해?" → 키·가입·비용 없음 |
| 3 | Chrome + 장 단위 묶음 | "절간 번역 일관성이 없어" |
| 4 | **Google v2** (다시) | "Chrome 번역이랑 구글 번역 사이트랑 느낌이 굉장히 달라" |
| 5 | **Google v3** | "v2를 v3로 바꿔봐" |
| 6 | **v2 · v3 · Claude 선택 + 엔진별 보관** | "엔진별로 모두 보관해서 비교" |
| 7 | 절 단위 엔진 버튼 | "한 절을 번역 여러 개 같이 볼 수 있게" |

## 1. 결정: 키 없는 번역 — Chrome 내장 번역

| 방법 | 비용·가입 | 품질 | 제약 |
|---|---|---|---|
| Chrome Translator API | 없음 | 사이트보다 낮음 (온디바이스 소형 모델) | PC Chrome 138+만 |
| Claude로 미리 일괄 번역 | 추가 없음 | 가장 좋음 | 실시간 아님 |
| 직접 입력 | 없음 | 내가 쓰는 대로 | 수고 |
| DeepL / Azure / Papago | 카드 등록 | 좋음 | 가입 필요 |

Chrome 내장 번역을 택했고, 모델 다운로드가 **사용자 클릭(제스처)을 요구**한다는 점을 반영했습니다.

```ts
// src/lib/browserTranslator.ts (요지)
// 첫 사용은 언어 모델을 내려받는데, Chrome은 사용자 제스처가 있을 때만 허용한다.
export function prepareTranslator(source = "en", target = "ko") { /* 클릭 핸들러 안에서 바로 호출 */ }
```

## 2. 겪은 문제: 절마다 문체가 다르다

- **증상:** 같은 장인데 어떤 절은 "~하라", 어떤 절은 "~하세요". "the Lord"가 주님/여호와/주로 제각각.
- **원인:** 한 절씩 따로 번역 → 번역기가 문맥을 모름.
- **시도:** 이어진 절을 줄바꿈으로 묶어 한 번에 보내고 줄 단위로 다시 나누기. 줄 수가 안 맞으면 그 묶음만 절별로 되돌림.

```ts
// src/lib/chunkTranslate.ts (요지)
const translated = await translate(block.join("\n"));
const split = translated.split("\n").map((l) => l.trim()).filter(Boolean);
const lines = split.length === block.length ? split : await Promise.all(block.map(translate));
```

솔직한 한계: 번역기가 내부에서 줄마다 따로 번역한다면 효과가 작을 수 있다고 미리 적어 두었습니다. 그리고 사용자 피드백으로 **엔진 자체의 품질 차이**가 더 큰 문제였음이 드러났습니다.

## 3. 결정: 다시 Google로 — 그리고 사고

Chrome 내장 번역은 PC에 받는 **작은 모델**이라, 서버의 구글 번역 사이트와 품질 차이가 컸습니다. Edge Function으로 Google v2를 불렀습니다.

### 사고: 404, 그리고 에러 메시지에 API 키

```text
Google 번역 오류 (404): <!DOCTYPE html> ... The requested URL
/language/translate_v2?key=AIzaSy… was not found on this server.
```

| 단계 | 내용 |
|---|---|
| 원인 1 | **제 코드의 주소 오타**: `/language/translate/v2`를 `/language/translate_v2`로 씀 |
| 원인 2 | 키를 **URL 쿼리**로 보냄 → Google 에러 페이지가 URL을 그대로 보여 줌 → 함수가 그 메시지를 브라우저·로그·채팅까지 전달 |
| 즉시 조치 | **키 재발급** 안내 (이미 대화·로그에 남았으므로) |
| 재발 방지 | 키를 **헤더**(`X-goog-api-key`)로 전송, 에러 메시지는 짧게 줄이고 **키 문자열을 `***`로 치환** |
| 검증 | 키 없이 새 주소 호출 → 404가 아니라 "API 키 필요" 응답 확인. 마스킹 함수 단위 확인 |

```ts
// supabase/functions/translate/googleV2.ts
export function googleReason(detail: string, key: string) {
  let reason: string;
  try { reason = JSON.parse(detail).error?.message ?? detail; }
  catch { reason = /<html/i.test(detail) ? (detail.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "HTML error page") : detail; }
  return reason.split(key).join("***").slice(0, 300);
}
```

> **이 사고에서 배울 것 세 가지**
> 1. 비밀 값은 URL에 넣지 않는다. URL은 로그·에러·리퍼러 곳곳에 복사된다.
> 2. 외부 에러 메시지를 사용자에게 **그대로** 전달하지 않는다. 무엇이 들어 있을지 모른다.
> 3. 사고가 나면 순서는 **차단(키 재발급) → 원인 수정 → 재발 방지 → 검증**.

### API 키 제한은 무엇으로?

| 애플리케이션 제한 | 이 프로젝트에서 |
|---|---|
| 웹사이트(HTTP 리퍼러) | ❌ 서버 호출에는 리퍼러가 없어 전부 거부됨 |
| IP 주소 | ❌ Supabase Edge Function은 고정 IP가 없음 |
| **없음** + API 제한(Cloud Translation만) + 하루 할당량 + 예산 알림 | ✅ |

## 4. 결정: Google v3와 서비스 계정

v3(Advanced)는 공식 문서상 **API 키가 아니라 서비스 계정** 인증입니다. Edge Function이 서비스 계정 키로 JWT를 서명해 OAuth 토큰을 받도록 했습니다.

```ts
// supabase/functions/translate/googleV3.ts (요지)
const claims = { iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-translation",
                 aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encode(`${header}.${claims}`));
// → POST oauth2.googleapis.com/token (grant_type=jwt-bearer) → access_token 캐시
```

테스트에서는 실제 RSA 키 쌍을 만들어 **서명한 JWT를 공개키로 검증**했습니다. 외부 서비스 없이 인증 코드를 확인하는 방법입니다.

### 겪은 문제: 조직정책 (사용자의 경험)

서비스 계정 키 발급이 **GCP 조직정책으로 막혀** 있었습니다. AWS의 역할 전환 같은 GCP 기능으로 우회하려다 원복했고, 조직정책을 수정한 뒤 키를 발급해 진행했습니다. 가장 오래 걸린 곳이 코드가 아니라 **계정과 권한**이었습니다.

### 겪은 문제: v2와 v3 결과가 완전히 같다

v3의 기본 모델(NMT)은 v2와 **같은 모델**입니다. 다르게 보려면 v3를 **Translation LLM**(`general/translation-llm`, us-central1)으로 돌려야 합니다. `GOOGLE_TRANSLATE_MODEL=llm` Secret 하나로 바꾸게 했고, 저장되는 엔진 이름도 `google-v3-nmt` / `google-v3-llm`으로 구분했습니다.

## 5. 결정: 엔진 셋을 고르고, 결과는 모두 보관

"too much일까?"라는 질문에 대한 판단:

| 설계 | 복잡도 | 판단 |
|---|---|---|
| 엔진 선택만, 절당 번역 1개 (덮어쓰기) | 낮음 | 비교 불가 |
| **엔진별 모두 보관 + 확정 1개** | 중간 (스키마 변경, 비교 UI) | ✅ 사용자 선택 |

```sql
-- supabase/migrations/20261021000000_engines.sql (요지)
alter table translations drop constraint translations_pkey;
alter table translations add primary key (version, book, chapter, verse, lang, engine);
create unique index translations_one_fixed on translations (version, book, chapter, verse, lang) where status = 'fixed';

create function fix_translation(ver text, b text, c int, v int, eng text) returns void language plpgsql as $$
begin
  update translations set status = 'machine' where … and status = 'fixed' and engine <> eng;
  update translations set status = 'fixed'   where … and engine = eng;
  if not found then raise exception 'translation not found'; end if;
end $$;
```

| 설계 포인트 | 이유 |
|---|---|
| PK에 `engine` | 엔진마다 한 행 |
| **부분 유니크 인덱스** `where status='fixed'` | "확정은 절마다 하나"를 DB가 보장 (앱 버그로도 두 개가 될 수 없음) |
| 확정 전환을 **함수 하나**로 | 두 UPDATE를 한 트랜잭션으로 → 중간 상태가 없음 |
| `security invoker`(기본) | RLS가 그대로 적용 |
| 직접 수정은 `engine='manual'` 행 | 기계 번역 원본이 남아 비교 가능 |

## 6. 결정: Claude 엔진과 프롬프트

- 공식 SDK(`@anthropic-ai/sdk`) 사용, Edge Function에서는 `deno.json` import map으로 같은 코드를 씀
- 모델: `claude-sonnet-5-5` (사용자 선택. 기본 추천은 Opus였지만 비용을 고려해 Sonnet)
- 구조화 출력: `output_config.format`에 JSON 스키마 → 절 번호별 결과
- 서버 측 fallback(`fallbacks: "default"`), `stop_reason === "refusal"` 확인 후 본문 읽기
- 앞뒤 3절(문맥용) + 같은 절의 개역한글(인명·지명 표기용)을 함께 보냄

### 겪은 문제: "개역한글처럼 축약하는 거 아냐?"

처음 프롬프트는 "개역한글 문체를 따르라"였습니다. 사용자의 진짜 목적은 **AMP의 괄호와 나열을 원어적으로 최대한 살려 비교**하는 것이었습니다. 문체 지시와 참고 본문이 번역을 간결한 쪽으로 끌 위험이 있었습니다.

| | 이전 | 이후 |
|---|---|---|
| 목적 | (없음) | "비교 연구용. 독자가 영어와 한국어를 대조한다" |
| 괄호 | 유지 | **괄호 안까지 전부 번역, 위치 그대로** |
| 나열 | (없음) | "여러 단어를 나열하면 **하나도 합치지 말 것**" |
| 개역한글 | 문체를 따르라 | **인명·지명 표기에만** 참고, 표현은 금지 |
| 문체 | 개역체(~하시니라) | 평이한 문어체(~하라, ~이다) |

빌립보서 4:5 결과: `[너희의 인자함, 이기심 없음, 자비, 관용, 인내]` — 다섯 개가 모두 살아남았습니다.

> **교훈:** 프롬프트에는 "어떻게"보다 **"왜(목적)"**를 먼저 쓰세요. 문체 지시만 있으면 모델은 그 문체의 관습(간결함)까지 따라갑니다.

## 7. 결정: 엔진 선택은 절 안에서

| 위치 | 문제 |
|---|---|
| 헤더의 전역 엔진 선택 | 한 절을 여러 엔진으로 보려면 계속 바꿔야 함 |
| **절 안 `[+ Google v2] [+ Google v3] [+ Claude]`** | 한 절에 엔진별 번역이 쌓이고 나란히 보임 |

동작 규칙도 정리했습니다. **상단 [한글 번역]과 절의 [한글]은 조회만**(DB select), **`[+ 엔진]`만 번역 실행**. 비용이 드는 동작과 들지 않는 동작을 버튼으로 분리한 것입니다.

## 배운 것

**주니어 관점**
- 같은 회사(Google)의 번역이라도 모델이 다르면 결과가 다르다(Chrome 온디바이스 vs 서버, v3 NMT vs LLM).
- 비밀 값은 URL에 넣지 않는다. 외부 에러 메시지를 그대로 노출하지 않는다.
- "확정은 하나" 같은 규칙은 앱 코드보다 **DB 제약**으로 지키는 게 확실하다.

**시니어 관점**
- 요구사항은 만들면서 분명해진다. 엔진이 다섯 번 바뀐 건 실패가 아니라 **탐색**이었다. 인터페이스 분리(02장) 덕분에 탐색 비용이 낮았다.
- 사고 대응은 차단 → 수정 → 재발 방지 → 검증. 사과보다 이 순서가 먼저다.
- 비용이 드는 동작(번역)과 공짜 동작(조회)을 UI에서 분리하면 사용자가 비용을 통제할 수 있다.

## 참고 자료

- [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api)
- [Cloud Translation v3 텍스트 번역](https://docs.cloud.google.com/translate/docs/advanced/translating-text-v3) · [v2/v3 개요](https://docs.cloud.google.com/translate/docs/intro-to-v3) · [가격](https://cloud.google.com/translate/pricing)
- [Google OAuth 2.0 서비스 계정](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Claude 구조화 출력](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [PostgreSQL 부분 인덱스](https://www.postgresql.org/docs/current/indexes-partial.html)
