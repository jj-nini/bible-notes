# 04. 데이터 파이프라인 — 외부 데이터를 믿을 수 있게 만들기

## 배경

앱은 완성됐는데 넣을 본문이 없었습니다. 필요한 것은 두 종류였습니다.

- **한국어 전체 본문:** 통독과 단어 검색용
- **NIV · AMP · MSG:** 비교와 번역의 원문

## 1. 결정: 본문을 어디서 가져오나

| 출처 | 대상 | 장점 | 제약 | 판단 |
|---|---|---|---|---|
| 사이트 크롤링 (BibleGateway 등) | 무엇이든 | 다 있음 | **이용약관 위반**, 차단 위험 | ❌ |
| 구매한 전자책 추출 | 보유 번역본 | 정식 구매 | 라이선스가 전체 추출 금지 | ❌ |
| **bolls.life 공개 데이터** | 개역한글 | 전체 JSON 한 번에, 무료 | 저작권 상태 해석이 엇갈림 | ✅ 개역한글 |
| **API.Bible** (무료 플랜) | 계정에 허용된 번역본 3개 | 정식 API | 하루 5,000회, 캐시 14일·연속 500절 미만 | ✅ NIV·AMP·MSG |

bolls.life는 저자가 `get-text`로 성경 전체를 긁지 말고 **전체 파일 다운로드**를 쓰라고 안내합니다. 그 안내대로 `KRV.json` 하나만 받았습니다.

```text
31,103절 · 66권 · 1,189장 · HTML 태그 0개
book 번호 1~66이 정경 순서 → src/data/books.ts의 BOOKS 배열과 그대로 대응
```

## 2. API.Bible과 14일 규칙: 솔직한 기록

API.Bible FAQ의 캐시 규칙은 **연속 500절 미만, 14일마다 비우기, 화면에 FUMS 추적 스크립트**입니다.
원래 설계는 "DB에 저장하지 않고 장을 열 때마다 실시간 조회"였습니다. 하지만 사용자는 이렇게 정했습니다.

> "일단 만들어서 보고 14일 이내에 DB를 지우든지 할게. 영어성경도 일단은 DB에 저장."

**이 결정의 트레이드오프를 그대로 남깁니다.**

| | 실시간 조회 | DB 저장 + 14일 정리 (선택) |
|---|---|---|
| 약관 | 부합 | 14일은 지키지만 **연속 500절 조건과는 맞지 않음** |
| 번역 파이프라인 | 원문을 매번 받아야 함 | 원문이 DB에 있어 일괄 번역 가능 |
| 구현 | Edge Function 프록시 + FUMS | 수집기 + 정리 스크립트 |

그래서 **잊지 않게 장치를 만들었습니다.**
- `verses.fetched_at` 열로 언제 받았는지 기록
- `scripts/purge-apibible.ts`: 14일 지난 것만, 또는 `--all`로 전부 삭제

> **시니어의 태도:** 규칙과 다른 결정을 할 수도 있습니다. 다만 **결정한 사람이 그 사실을 알고 하도록** 한 번은 분명히 말하고, 되돌릴 수단을 같이 만듭니다.

## 3. 파서: 한 장만 먼저 받아 보기

API.Bible의 `content-type=json` 응답은 중첩된 노드 트리입니다. 문서만 보고 파서를 쓴 뒤, **전체를 받기 전에 `--dry-run`으로 한 장씩** 확인했습니다. 세 번 고쳤습니다.

### 1회차: 빌립보서 4장 → MSG의 절 묶음

```text
MSG PHP.4: 11절   (NIV·AMP는 23절)
6       Don't fret or worry. ... (6–7절을 한 단락으로)
```

MSG는 여러 절을 하나로 옮깁니다(`verseId: "PHP.4.6-PHP.4.7"`). 첫 절에만 저장하면 대조 화면 7절 자리에 "본문이 없습니다"가 떠서 오해를 부릅니다.

**해결:** `verses.verse_end` 열을 추가하고, 화면에 `6–7`과 "↑ 6–7절에 함께 옮김"을 표시했습니다.

```sql
-- supabase/migrations/20261020020000_verse_ranges.sql
alter table verses add column verse_end int check (verse_end is null or verse_end > verse);
```

### 2회차: 같은 장 → AMP 끝의 참조 구절

```text
3  ... whose names are in the Book of Life. [Dan 12:1; Mal 3:16, 17; Rev 3:5; 21:27]
4  Rejoice in the Lord always [delight, take pleasure in Him]; again I will say, rejoice! [Ps 37:4]
```

둘 다 대괄호인데, 하나는 **지워야 할 각주**이고 하나는 **지켜야 할 AMP의 확장 설명**입니다. 구분 기준을 "장:절 숫자가 들어 있는가"로 잡았습니다.

```ts
// scripts/apibible-parse.ts
const TRAILING_REFS = /\s*\[(?:\s*(?:[1-3]\s?)?[A-Z][A-Za-z]*\.?\s+)?\d+:\d+[^\]]*\]\s*$/;
```

### 3회차: 시편 3장, 마태복음 17장 → 띄어쓰기

```text
NIV 시편 3:1   Lord , how many are my foes!
AMP 시편 3:1   O L ord , how my enemies have increased!
AMP 마 17:5    a voice ... said, “ This is My beloved Son
AMP 시편 3:3   ¶But You, O L ord ...
MSG 마 17:22   ... scared to death. * * *
```

**원인:** 작은 대문자 LORD가 `L` + `ord` 조각으로 따로 오는데, 조각을 이을 때 공백을 넣었기 때문입니다.
**해결:** 문단 안의 조각은 **그대로 잇고**, 문단·시행이 바뀔 때만 공백을 넣었습니다. `¶`와 `* * *`는 지웠습니다.

```ts
// scripts/apibible-parse.ts (요지)
if (n.name === "para" && last !== null) parts.get(last)!.push(" "); // 문단 경계에만 공백
// …
let text = p.join("")
  .replace(/¶/g, "")
  .replace(/(?:\s*\*){3,}\s*$/, "")          // MSG 구분선
  .replace(/\s+/g, " ")
  .replace(/([“‘(\[]) /g, "$1")              // "“ This" → "“This"
  .replace(/ ([,.;:!?’”)\]])/g, "$1")        // "Lord ," → "Lord,"
  .trim();
```

> **배운 점:** 외부 API의 형식을 문서만 보고 확신하지 말 것. **표본을 눈으로 보는 단계**를 파이프라인에 넣으세요. 세 번의 dry-run이 3,600번 호출 뒤에 발견했을 문제를 미리 막았습니다.

## 4. 수집기 설계: 중단에 강하게

```text
node scripts/fetch-apibible.ts --list            # 계정에 열린 번역본
node scripts/fetch-apibible.ts --dry-run PHP.4   # 한 장만 출력, DB 쓰기 없음
node scripts/fetch-apibible.ts                   # 전체, 이어 받기
```

| 설계 | 이유 |
|---|---|
| 장 단위 1회 호출 | 한 장은 거의 200절 이하라 한 번에 들어옴 |
| 동시 3개 | 하루 5,000회 한도 안에서 적당한 속도 |
| 429·5xx는 지수적 대기 후 재시도 | 일시적 오류에 강하게 |
| 401·403은 즉시 중단 | 키가 틀리면 3,600번 실패할 필요 없음 |
| 진행 기록을 `data/private/`에 | 중단 후 재실행하면 이어서 (git 제외) |
| bibleId 자동 매칭 + `--map` | 약어가 달라도 수동 지정 가능 |

## 겪은 문제

| 문제 | 원인 | 해결 |
|---|---|---|
| `NIV에 해당하는 번역본을 찾지 못했습니다` | 키 입력 옵션 문제(사용자 확인) | `--list`로 확인하도록 안내, 메시지에 해결책 포함 |
| 스크립트가 `node`에서 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` | Node의 타입 제거 모드는 생성자 매개변수 프로퍼티(`constructor(public status)`)를 지원하지 않음 | 일반 필드 선언으로 변경 |

## 배운 것

**주니어 관점**
- 데이터 출처를 고를 때 "구할 수 있나"보다 **"써도 되나"**를 먼저 본다.
- 외부 응답은 한 건만 먼저 받아서 눈으로 본다.
- 대괄호처럼 같은 기호가 다른 의미를 가질 수 있다. 정규식은 **의미를 구분하는 기준**을 먼저 말로 정하고 쓴다.

**시니어 관점**
- 대량 작업은 **dry-run → 소량 → 전체** 단계로. 실패가 비싼 작업일수록.
- 재시도할 오류(429, 5xx)와 즉시 멈출 오류(401, 403)를 구분한다.
- 규칙과 어긋나는 결정을 할 때는 기록하고, 되돌릴 도구를 함께 만든다.

## 참고 자료

- [bolls.life API 문서](https://github.com/Bolls-Bible/bain/blob/master/docs/API.md)
- [API.Bible Passages](https://docs.api.bible/guides/passages) · [Rate Limiting](https://docs.api.bible/getting-started/rate-limiting/) · [FAQ](https://scripture.api.bible/faq) · [Fair Use(FUMS)](https://docs.api.bible/guides/fair-use)
- [Node.js TypeScript 타입 제거](https://nodejs.org/api/typescript.html)
