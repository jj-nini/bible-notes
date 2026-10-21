# 03. Supabase 연결과 첫 디버깅 — 어디부터 의심하나

## 배경

샘플 모드로 완성된 앱에 실제 Supabase를 연결하는 단계입니다. 코드는 거의 그대로였는데, **환경**에서 문제가 연달아 터졌습니다.
이 장은 네 번의 디버깅을 "증상 → 가설 → 확인 → 원인 → 해결" 순서로 기록합니다.

## 1. 결정: Supabase를 로컬로 띄울까, 클라우드로 쓸까

| 방식 | Docker | 비고 |
|---|---|---|
| 로컬 Supabase (`supabase start`) | 필요 | 컨테이너 10개 안팎, WSL 메모리 7GB로는 버거움 |
| **클라우드 무료 플랜** | 불필요 | 대시보드 + 필요할 때만 CLI(`npx supabase`) |

Docker 없이 클라우드로 갔습니다. Edge Function 배포도 `--use-api`(서버에서 번들링)로 Docker 없이 됩니다.

## 디버깅 1. "로컬 호스팅이 안 돼요"

| 단계 | 내용 |
|---|---|
| 증상 | `npm run dev` 후 Windows 브라우저에서 접속 불가 |
| 가설 | ① 서버가 안 떴다 ② 포트 충돌 ③ WSL 네트워크 |
| 확인 | WSL 안에서 `curl 127.0.0.1:5173` → **200**. `ss -ltnp` → `127.0.0.1:5173`에서만 LISTEN |
| 원인 | 서버는 정상. **WSL 내부 주소에만** 열려 있어 Windows에서 못 들어옴 |
| 해결 | `vite.config.ts`에 `server: { host: true }` |

> **사고 과정:** "안 된다"는 말을 들으면 **어느 구간이 안 되는지**부터 자릅니다. 서버 안에서 되는지(curl) → 바깥에서 되는지. 안에서 되면 코드는 무죄, 네트워크가 용의자입니다.

## 디버깅 2. "로그인하면 빈 화면"

| 단계 | 내용 |
|---|---|
| 증상 | 로그인 화면은 뜨고, 로그인하면 아무것도 안 보임. 에러도 없음 |
| 가설 | 에러가 없다 = 예외가 아니라 **"정상적으로 빈 결과"** |
| 확인 | 코드에서 `if (!versions.length) return null;` 발견 → 번역본 목록이 0개면 빈 화면 |
| 원인 후보 | ① RLS 허용 목록(`app_users`)에 내 UID가 없음 ② 데이터를 아직 안 넣음 |
| 확인 방법 | SQL: `select count(*) from versions;`와 `auth.users`↔`app_users` 조인 |
| 원인 | ② 데이터 미입력 |

**해결은 두 가지였습니다.**
1. 데이터를 넣었습니다.
2. **다음 사람이 같은 함정에 빠지지 않게** 빈 화면 대신 원인 안내 화면을 만들었습니다.

```tsx
// src/App.tsx (요지)
if (!versions) return <Loading />;                 // 아직 모름
if (!versions.length) return <NoVersions user={user} />; // 0개로 확인됨 → 원인 안내
```

안내 화면에는 두 원인, 확인 SQL, **내 UID와 복사 버튼**을 넣었습니다.

> **핵심 교훈:** RLS는 권한이 없으면 **에러가 아니라 0건**을 돌려줍니다. "조용한 실패"는 가장 찾기 어렵습니다. `null`(로딩 중)과 `[]`(결과 없음)을 구분하는 것만으로 진단이 쉬워집니다.

### 겪은 덤 문제: 테스트가 갑자기 전부 실패

`.env.local`을 만들자 화면 테스트가 전부 로그인 화면에서 실패했습니다. Vitest도 `.env.local`을 읽어서 Supabase 모드로 돌았기 때문입니다.

```ts
// vite.config.ts
test: { env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" } },
```

테스트는 항상 샘플 모드로 고정했습니다.

## 디버깅 3. 데이터 입력 스크립트가 불친절했다

처음 스크립트는 `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import.ts`처럼 환경변수를 요구했고, 사용자가 "따옴표는 어떻게 처리해?"라고 물었습니다. **사용자가 헷갈리는 건 사용자 탓이 아니라 도구 탓**입니다.

개선:
- URL은 `.env.local`에서 자동으로 읽기
- service_role 키는 **화면에 표시되지 않는 입력**으로 묻기 (셸 히스토리에도 안 남음)
- anon 키를 잘못 넣으면 DB에 가기 전에 거르기 (JWT의 `role` 클레임이나 `sb_publishable_` 접두사 확인)

## 디버깅 4. "Detected unsettled top-level await"

| 단계 | 내용 |
|---|---|
| 증상 | 키 입력 단계에서 Node가 경고를 내고 종료 |
| 가설 | 입력 대기 중인 Promise가 해결되지 않은 채 이벤트 루프가 비었다 |
| 재현 | Python `pty`로 가짜 터미널을 만들어 **Ctrl+C, Ctrl+D를 보내 재현** |
| 원인 | readline은 SIGINT 리스너가 없으면 스트림을 멈추고, EOF면 close만 함 → `question()` 콜백이 영원히 안 불림 |
| 해결 | SIGINT와 close를 처리 |

```ts
// scripts/lib.ts
rl.on("SIGINT", () => { process.stdout.write("\n취소했습니다.\n"); process.exit(130); });
let answered = false;
const answer = await new Promise<string>((resolve) => {
  rl.question("", (a) => { answered = true; resolve(a); });
  rl.on("close", () => { if (!answered) resolve(""); });
});
```

수정 후 같은 방법으로 Ctrl+C → "취소했습니다.", Ctrl+D → "값이 비어 있습니다.", 붙여넣기 + Enter → 정상(가짜 키로 API까지 도달해 403)을 확인했습니다.

> **사고 과정:** 사용자 환경의 버그는 **재현부터**. 대화형 입력 버그는 `pty`로 재현할 수 있습니다. 재현이 되면 수정 후 같은 방법으로 검증할 수 있습니다.

## 디버깅 5. "12분째 결과가 안 나와요" (나중 일이지만 같은 계열)

같은 PC라서 프로세스를 직접 봤습니다.

```bash
ps -eo pid,etime,pcpu,args | grep translate-claude-cli   # 12:30 경과, CPU 0%
cat /proc/<pid>/wchan                                      # do_epoll_wait (무언가 대기)
ss -tnp | grep "pid=<pid>"                                 # TCP 연결 없음 → 네트워크 대기 아님
readlink /proc/<pid>/fd/0                                  # /dev/pts/3 → 터미널 입력 대기
```

**결론:** 숨김 키 입력을 기다리고 있었습니다. 화면에 아무것도 안 보이게 만든 설계가 "멈춘 것처럼" 보이게 했습니다.

> **배운 점:** 숨김 입력은 보안에는 좋지만 **"지금 입력을 기다린다"는 신호**가 분명해야 합니다. 그리고 프로세스 상태(CPU, 대기 지점, 소켓, 표준입력)를 보면 "멈춘 이유"를 추측이 아니라 관찰로 알 수 있습니다.

## 배운 것

**주니어 관점**
- "안 돼요"를 들으면 구간을 나눈다: 서버 안 → 서버 밖 → 브라우저.
- 에러가 없는 실패가 제일 어렵다. `null`과 `[]`을 구분하자.
- 환경변수 파일은 테스트에도 영향을 준다.

**시니어 관점**
- 같은 실수를 두 번 하지 않도록 **진단을 제품에 넣는다**(빈 화면 → 원인 안내 화면).
- 도구의 사용성은 보안만큼 중요하다. 사용자가 헷갈리면 키를 채팅에 붙여넣는 등 더 위험한 우회를 한다.
- 대화형 입력, 신호 처리 같은 "가장자리"는 테스트하기 어렵지만 `pty`로 재현할 수 있다.

## 참고 자료

- [Vite server.host](https://vite.dev/config/server-options#server-host)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Node.js readline](https://nodejs.org/api/readline.html)
- [WSL 네트워킹](https://learn.microsoft.com/windows/wsl/networking)
