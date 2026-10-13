# Vercel 배포 가이드 (프런트엔드)

Vercel에는 **프런트엔드(`frontend/`, Next.js)만** 올린다. Spring Boot 백엔드와 MySQL은 Vercel에서 실행할 수 없으므로 **브라우저에서 https로 접근할 수 있는 곳에 따로 있어야** 한다(아래 2절). 프런트는 빌드 시점에 `NEXT_PUBLIC_API_BASE_URL`로 백엔드 주소를 코드에 넣는다.

## 1. 준비된 것 (이 저장소)

| 파일 | 내용 |
|---|---|
| `frontend/vercel.json` | 프레임워크 `nextjs`, `npm ci`, `npm run build` |
| `frontend/.vercelignore` | CLI로 올릴 때 `node_modules`, `.next`, `.env*`, `tests`를 제외 |
| `frontend/next.config.mjs` | 빌드 시 `NEXT_PUBLIC_API_BASE_URL`을 검증(없거나 `/`로 끝나거나 http(s)가 아니면 빌드 실패)하고, 같은 값을 CSP의 `connect-src`·`img-src`에 넣는다 |
| `frontend/.env.example` | 변수 이름과 형식(자격 증명은 넣지 않는다) |

코드에 고정된 로컬 주소는 없다(`localhost`는 `.env.example`과 테스트에만 있다). Node는 `24.x`(`package.json`의 `engines`)이다.

## 2. 먼저 정해야 하는 것: 백엔드를 어디에 두는가

| 방법 | 설명 | 장단점 |
|---|---|---|
| **A. 터널로 로컬 백엔드 공개 (시연용 권장)** | 내 PC의 백엔드(8080)를 Cloudflare Tunnel 또는 ngrok으로 `https://…` 주소로 공개한다. DB는 로컬 Docker 그대로 | 가장 빠르다. **시연 동안 PC와 터널이 켜져 있어야** 한다. 무료 임시 주소는 재시작하면 바뀌므로 그때마다 Vercel 환경 변수를 고치고 재배포해야 한다(고정 주소를 쓰는 이름 있는 터널 권장) |
| **B. 클라우드에 백엔드 + MySQL** | Railway·Render·Fly.io 등에 백엔드, 관리형 MySQL 8을 둔다 | 상시 접속 가능. **추가 작업이 필요하다**: 백엔드 컨테이너 이미지(`Dockerfile`, 지금은 없음), DB 연결 정보 설정, 마이그레이션(Flyway가 시작 시 자동 적용), 시연 데이터 시드(`scripts/seed-demo-data.mjs`) |

어느 쪽이든 백엔드는 다음 환경 변수를 받는다(값은 저장소에 두지 않는다).
`DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `SPRING_PROFILES_ACTIVE`, `PORT`, **`CORS_ALLOWED_ORIGINS`**, 데모 계정 비밀번호(`DEMO_*_PASSWORD`)와 선택 사항인 AI 제공자 설정(`README.md` 참고).

### 2.1 CORS (가장 흔한 실패 원인)
백엔드의 `CORS_ALLOWED_ORIGINS`에 **Vercel 주소를 정확히** 넣는다(쉼표로 여러 개). 예: `https://mangabridge.vercel.app,http://localhost:3000`. 경로·끝의 `/`·와일드카드는 쓰지 않는다. Vercel의 **프리뷰 배포 주소는 배포마다 바뀌므로** 허용 목록에 없으면 프리뷰에서는 API 호출이 CORS로 막힌다 — 시연에는 고정된 프로덕션 주소만 쓴다.

### 2.2 https 필수
Vercel 주소는 https이므로 백엔드 주소도 **https**여야 한다(http 백엔드는 브라우저가 "혼합 콘텐츠"로 막는다). 터널과 클라우드 호스트는 https를 기본 제공한다.

## 3. Vercel 프로젝트 설정

1. Vercel에서 새 프로젝트를 만든다(저장소 연결 또는 CLI, 4절).
2. **Root Directory = `frontend`** (저장소가 모노레포이므로 필수).
3. Framework Preset = Next.js(자동 감지). Node.js Version = 24.x.
4. **Environment Variables** — Production(필요하면 Preview도):
   - `NEXT_PUBLIC_API_BASE_URL` = 백엔드의 https 주소, **끝에 `/` 없이** (예: `https://api.example.com`)
   - 자격 증명·비밀번호·토큰은 **절대 넣지 않는다**(`NEXT_PUBLIC_*`는 브라우저에 그대로 노출된다).
5. 이 값은 **빌드 때 코드에 박히므로 바꾸면 재배포해야** 한다.

## 4. 배포 방법

### 방법 1: Git 연동 (자동 배포)
1. 원격 저장소(GitHub 등)를 만들고 push한다. **지금까지 이 저장소는 push한 적이 없고, push는 사용자가 직접 결정한다.** push 전에 `STATUS.md` 7절 체크리스트(비밀 정보 점검)를 확인한다. 현재 브랜치 이름은 `master`이다.
2. Vercel에서 그 저장소를 가져오고 3절대로 설정한다. 이후 push마다 배포된다.

### 방법 2: CLI (원격 저장소 없이)
```powershell
cd frontend
npx vercel login
npx vercel link                       # 새 프로젝트 만들기, Root Directory는 이미 frontend
npx vercel env add NEXT_PUBLIC_API_BASE_URL production   # 프롬프트에 https 주소 입력
npx vercel --prod
```
CLI는 `.vercelignore`에 따라 파일을 올린다. 로그인은 사용자가 직접 해야 한다.

## 5. 배포 후 점검

1. `https://<프로젝트>.vercel.app/` 이 열리고 히어로·최신 회차·랭킹이 보인다(백엔드가 켜져 있어야 한다).
2. `/status`에서 백엔드 상태가 UP이다. 아니면 4가지를 순서대로 본다: 백엔드 실행 여부, `NEXT_PUBLIC_API_BASE_URL` 값, `CORS_ALLOWED_ORIGINS`에 Vercel 주소가 있는지, 백엔드가 https인지.
3. 브라우저 개발자 도구 콘솔에 `Content Security Policy` 위반이나 CORS 오류가 없다(CSP는 빌드된 API 주소만 허용한다).
4. 작품 상세·뷰어에서 표지와 번역본 이미지가 보인다.
5. `/login`으로 데모 계정 로그인이 된다(운영자 화면 이미지 미리보기 포함).
6. 헤더 확인: `curl.exe -I https://<프로젝트>.vercel.app/`에 `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`가 있다.

## 6. 공개 전 반드시 확인 (보안)

- **로그인 시도 제한이 없다**(D-047, 사용자 결정). 인터넷에 공개한다면 **데모 계정 비밀번호를 길고 무작위인 값으로** 바꾸고(시드 시 환경 변수로 주입), 시연이 끝나면 터널을 닫거나 백엔드를 내린다.
- 조회·추천 공개 쓰기에도 요청 제한이 없다(`STATUS.md` 보안 점검의 한계). 공개 범위를 넓힐수록 랭킹이 조작될 수 있다.
- 개발 DB 비밀번호(`README.md`의 로컬 값)를 클라우드 DB에 쓰지 않는다.
- 시연 데이터의 이미지는 생성된 시험용 이미지이다. 실제 작품 이미지를 올릴 때는 사용 허락을 확인한다.

## 7. 문제 해결

| 증상 | 원인과 조치 |
|---|---|
| 빌드가 "NEXT_PUBLIC_API_BASE_URL is required…"로 실패 | 환경 변수가 없거나 `/`로 끝난다. 3절 4번 확인 |
| 화면은 열리는데 데이터가 비어 있고 콘솔에 CORS 오류 | 백엔드 `CORS_ALLOWED_ORIGINS`에 Vercel 주소 추가 후 백엔드 재시작 |
| 콘솔에 "Mixed Content" | 백엔드 주소가 http이다. https 주소로 바꾸고 환경 변수 수정 후 재배포 |
| 이미지가 안 보이고 CSP 위반 | 배포에 쓴 `NEXT_PUBLIC_API_BASE_URL`과 실제 API 주소가 다르다(재배포 필요) |
| 터널 주소가 바뀜 | 환경 변수를 새 주소로 바꾸고 재배포, 백엔드 CORS는 Vercel 주소 기준이라 그대로 |
| 롤백 | Vercel 대시보드 Deployments에서 이전 배포를 Promote |
