# 07. GitHub 공개와 배포 — 올리기 전에 무엇을 보나

## 배경

"이제 github에 올려보자. 중요정보 민감정보 안올라가게 조심 좀 하자."
공개 저장소는 한 번 올라가면 사실상 회수할 수 없습니다(포크, 캐시, 크롤러). 그래서 **올리기 전 점검**에 가장 많은 시간을 썼습니다.

## 1. 결정: 공개 vs 비공개

| | 공개 | 비공개 |
|---|---|---|
| GitHub Pages 무료 | ✅ | ❌ (Pro 필요) |
| 코드 노출 | 있음 | 없음 |
| 데이터 노출 | 없음 (본문·키는 저장소에 없음, DB는 RLS) | 없음 |

데이터가 저장소가 아니라 Supabase에 있고 RLS로 지켜지기 때문에, 공개해도 노출되는 건 **코드뿐**입니다. 공개로 결정했습니다.

샘플 10구절(NIV·AMP·MSG·개역개정)은 저작권이 있는 번역본이라 선택지를 드렸고, 사용자는 **그대로 올리기**를 골랐습니다(출판사 인용 허용 범위 판단). 실제 전체 본문은 `data/private/`와 Supabase에만 있습니다.

## 2. 공개 전 점검: 무엇을, 어떻게

### ① 무엇이 올라가는지 목록으로 본다

```bash
git status --short --untracked-files=all
git status --ignored --short          # 제외되는 것도 확인
```

여기서 **`supabase/.temp/`가 올라갈 뻔한 것**을 발견했습니다. Supabase CLI가 `link`할 때 만드는 폴더로, 프로젝트 ref와 조직 ID가 들어 있습니다. 비밀번호는 아니지만 올릴 이유가 없습니다.

### ② 내용에서 키 모양을 찾는다

```bash
git diff --cached -U0 | grep -nE \
  'AIza[0-9A-Za-z_-]{20,}|sb_secret_|sb_publishable_[0-9A-Za-z]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|sk-ant-|BEGIN (RSA )?PRIVATE KEY|<프로젝트 ref>|<개인 이메일>'
```

| 패턴 | 무엇 |
|---|---|
| `AIza…` | Google API 키 |
| `sb_secret_` / `sb_publishable_` | Supabase 새 형식 키 |
| `eyJ….…` | JWT (Supabase 예전 형식 키 포함) |
| `sk-ant-` | Anthropic API 키 |
| `BEGIN PRIVATE KEY` | 서비스 계정 키 등 개인키 |
| 프로젝트 ref, 개인 이메일 | 식별 정보 |

**스테이징 후에 한 번 더** 돌렸습니다. 점검과 커밋 사이에 파일이 바뀔 수 있기 때문입니다.

### ③ 미래의 실수까지 막는다

```gitignore
# Supabase CLI link state (project ref, org id)
supabase/.temp/
supabase/.branches/

# Never commit credentials, even by accident
.env.*
!.env.example
*.pem
*.key
*.p12
*service-account*.json
*serviceaccount*.json
*-credentials.json
```

서비스 계정 키 파일(JSON)을 받아 둔 적이 있으니, 누가 실수로 프로젝트 폴더에 넣어도 올라가지 않게 했습니다.

### ④ 커밋 작성자 이메일

git 사용자 정보가 비어 있었고, 공개 저장소의 커밋 이메일은 누구나 볼 수 있습니다.
GitHub 공개 API로 계정 ID를 확인해 **noreply 주소**(`<ID>+<아이디>@users.noreply.github.com`)를 **이 저장소에만** 설정했습니다(`git config`, `--global` 아님).

## 3. 배포: GitHub Actions → Pages

```yaml
# .github/workflows/deploy.yml (요지)
- run: npm ci
- run: npm test
- run: npm run build
  env:
    VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
    VITE_SUPABASE_ANON_KEY: ${{ vars.VITE_SUPABASE_ANON_KEY }}
- uses: actions/upload-pages-artifact@v3
- uses: actions/deploy-pages@v4
```

| 값 | 어디에 | 이유 |
|---|---|---|
| Supabase URL, **anon 키** | GitHub **Variables** | 원래 브라우저에 공개되는 값 |
| service_role 키 | **내 PC에서만** (숨김 입력) | RLS를 우회하는 관리자 키 |
| Google·Claude 키, 서비스 계정 | **Supabase Secrets** | Edge Function만 사용 |

`vite.config.ts`의 `base: "./"`(상대 경로) 덕분에 `/bible-notes/` 하위 경로에서도 그대로 동작합니다.

### push에서 걸리기 쉬운 곳

- GitHub 비밀번호는 git push에 쓸 수 없음 → Personal Access Token
- 저장소에 **워크플로 파일**이 있으면 토큰에 **Workflows 권한**이 있어야 push가 거부되지 않음
- 토큰은 터미널에만, 채팅에는 붙이지 않기

결과: 에러 없이 배포, [jj-nini.github.io/bible-notes](https://jj-nini.github.io/bible-notes/)에서 정상 동작 확인.

## 배운 것

**주니어 관점**
- 올리기 전에 `git status`로 **목록**을, `grep`으로 **내용**을 본다. 둘 다.
- 도구가 몰래 만든 폴더(`.temp`, `.cache`)가 함정이다.
- "공개 키"(anon)와 "비밀 키"(service_role)를 구분하면, 어디에 둘지가 자연스럽게 정해진다.

**시니어 관점**
- `.gitignore`는 현재가 아니라 **미래의 실수**를 막는 도구다. 키 파일 패턴은 미리 막는다.
- 신원 정보(커밋 이메일)도 민감정보다. noreply를 저장소 단위로 설정해 다른 프로젝트에 영향을 주지 않는다.
- 배포 파이프라인에 테스트를 넣어 두면, 깨진 코드는 Pages까지 가지 않는다.

## 참고 자료

- [GitHub noreply 이메일 설정](https://docs.github.com/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-email-preferences/setting-your-commit-email-address)
- [Personal access tokens](https://docs.github.com/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [GitHub Pages with Actions](https://docs.github.com/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Supabase API keys](https://supabase.com/docs/guides/api/api-keys)
