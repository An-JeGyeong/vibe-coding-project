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
| **B. 클라우드에 백엔드 + MySQL (선택됨)** | Railway 등에 백엔드(`backend/Dockerfile`)와 MySQL 8.4를 둔다 | 상시 접속 가능. 이미지·프로필·시드 절차는 준비되어 있고 **8절에 Railway 기준 절차**가 있다 |

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
1. 저장소는 이미 GitHub(`https://github.com/An-JeGyeong/vibe-coding-project`)의 `main` 브랜치에 push되어 있다(2026-10-13, 로컬 `master`를 `main`으로 올림). 이후 변경은 `git push`로 올린다. push 전에 `STATUS.md` 7절 체크리스트(비밀 정보 점검)를 확인한다.
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

## 8. 방법 B 절차 (Railway 기준)

준비된 것(저장소): `backend/Dockerfile`(JDK 17 빌드 → JRE 17 실행, 비루트 사용자, 포트는 `PORT`), `backend/.dockerignore`, `application-demo.yml`(클라우드 시연용 프로필). **이 이미지·프로필·시드 흐름은 로컬 Docker에서 실제로 검증했다**: 일회용 MySQL 8.4.11과 이미지를 같은 네트워크에 띄워 `demo` 프로필로 기동 → Flyway 37개 적용, `/api/health` UP(DB UP) → 일회용 컨테이너로 데모 계정 시드 → 로그인 200 → CORS(허용 출처 200, 다른 출처 403) → `scripts/seed-demo-data.mjs`로 작품 2개·회차·이미지 발행 → 공개 API와 이미지 200, 메모리 약 430 MiB. **Railway 화면에서의 실제 배포는 아직 해 보지 않았으므로** 아래 화면·변수 이름은 일반적인 사용법이며 달라졌다면 Railway 문서를 따른다.

### 8.1 구성 (한 프로젝트 안의 서비스 2개)

1. **MySQL 서비스** — 새 서비스를 Docker 이미지 `mysql:8.4.11`로 만든다. 로컬 `docker-compose.yml`과 같은 구성이라 **root가 아닌 앱 계정이 자동으로 만들어진다**(백엔드는 `root` 계정을 거부한다).
   - 변수: `MYSQL_DATABASE=mangabridge`, `MYSQL_USER=mangabridge_app`, `MYSQL_PASSWORD=<길고 무작위인 값>`, `MYSQL_RANDOM_ROOT_PASSWORD=yes`
   - 시작 명령(Custom Start Command): `docker-entrypoint.sh mysqld --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci --default-time-zone=+00:00 --default-storage-engine=InnoDB`
   - **Volume을 `/var/lib/mysql`에 붙인다**(없으면 재배포 때 데이터가 사라진다). 공개 도메인·TCP 프록시는 만들지 않는다(내부 네트워크로만 접근).
2. **백엔드 서비스** — `backend/` 폴더를 올린다(CLI `railway up`을 `backend`에서 실행하면 `Dockerfile`을 쓴다. Git 연동이면 Root Directory를 `backend`로).
   - 변수:

     | 이름 | 값 |
     |---|---|
     | `SPRING_PROFILES_ACTIVE` | `demo` |
     | `DB_URL` | `jdbc:mysql://${{MySQL.RAILWAY_PRIVATE_DOMAIN}}:3306/mangabridge` (MySQL 서비스 이름이 `MySQL`일 때의 참조 문법) |
     | `DB_USERNAME` / `DB_PASSWORD` | MySQL 서비스의 `MYSQL_USER` / `MYSQL_PASSWORD`와 같은 값 |
     | `CORS_ALLOWED_ORIGINS` | Vercel 프로덕션 주소(예: `https://mangabridge.vercel.app`), 끝 `/`·와일드카드 금지 |
     | `PORT` | Railway가 자동 설정(수동 입력 불필요) |

   - **Generate Domain**으로 https 주소를 만든다. 헬스 체크 경로는 `/api/health`.
   - 메모리는 **1 GB 이상**을 권한다(JVM이 컨테이너 메모리의 70%까지 힙으로 쓰고, 로컬 실측은 약 430 MiB).
   - **`demo` 프로필**은 DB 연결을 `sslMode=REQUIRED`(암호화는 하되 호스트 이름 검증은 안 함)로 둔다. MySQL 8.4 컨테이너는 자체 서명 인증서로 TLS를 제공하고, 같은 프로젝트의 내부 네트워크로만 접속하므로 이 수준이면 충분하다. 인증서가 호스트 이름과 맞는 관리형 DB를 쓴다면 `DB_SSL_MODE=VERIFY_IDENTITY`를 추가한다.

### 8.2 데모 계정 만들기 (최초 1회)

계정은 백엔드를 "시드 모드"로 한 번 실행해서 만든다. 백엔드 서비스에 아래 변수를 **임시로** 추가하고 재배포한다.

```
DEMO_AUTH_SEED=true
DEMO_AUTH_SEED_ENABLED=true
SPRING_MAIN_WEB_APPLICATION_TYPE=none
DEMO_OPERATOR_PASSWORD=...   DEMO_TRANSLATOR_PASSWORD=...   DEMO_REVIEWER_PASSWORD=...
DEMO_TYPESETTER_PASSWORD=... DEMO_READER_PASSWORD=...
```

로그에 `DemoAuth command completed`가 나오고 프로세스가 끝나면 **위 변수를 모두 지우고 다시 배포**한다(웹 서버가 정상으로 뜨고, 비밀번호가 설정에 남지 않는다). 비밀번호는 **길고 무작위인 값**으로 정한다(로그인 시도 제한이 없다, 6절). 이 시드는 `demo`·`local` 프로필에서만 허용되고 `prod`에서는 거부된다.

### 8.3 시연 데이터 넣기

계정이 만들어지고 백엔드가 정상으로 뜬 뒤, **내 PC**에서 공개된 백엔드 주소로 시드 스크립트를 실행한다(이미지는 스크립트가 생성하고 HTTPS API로 올린다).

```powershell
$env:API_BASE = "https://<백엔드 도메인>"
$env:DEMO_OPERATOR_PASSWORD = "..."; $env:DEMO_TRANSLATOR_PASSWORD = "..."; $env:DEMO_REVIEWER_PASSWORD = "..."; $env:DEMO_TYPESETTER_PASSWORD = "..."
node scripts/seed-demo-data.mjs                            # 작품 "낯선 항구"
$env:SEED_VARIANT = "2"; node scripts/seed-demo-data.mjs   # 작품 "달빛 정원"
```

랭킹에 값이 보이도록 회차를 몇 번 열어 조회를 만들어 둔다(`POST /api/public/episodes/{id}/views`).

### 8.4 마지막으로 Vercel과 연결

1. 8.1의 백엔드 https 주소를 Vercel의 `NEXT_PUBLIC_API_BASE_URL`(끝 `/` 없이)에 넣고 재배포한다(3절).
2. 백엔드의 `CORS_ALLOWED_ORIGINS`가 Vercel 프로덕션 주소와 정확히 같은지 확인한다.
3. 5절 점검을 수행한다.

### 8.5 비용·운영 메모

- Railway는 사용량 과금이며 무료 체험 한도가 있다. 시연이 끝나면 서비스를 중지하거나 삭제한다(DB 볼륨이 남으면 과금될 수 있다).
- DB 백업: 클라우드 볼륨은 자동 백업이 없다. 중요한 데이터가 생기면 `mysqldump`로 직접 받아 둔다.
- 개발 PC의 DB 데이터는 클라우드로 옮기지 않는다(시연 데이터는 8.3의 스크립트로 새로 만든다).

## 9. 실제 배포에서 겪은 문제와 해결 (2026-10-13)

| 증상 | 원인 | 해결 |
|---|---|---|
| Railway 빌드가 6초 만에 `Railpack failed to prepare the build` | 모노레포라 저장소 루트를 빌드하려 함 | 서비스 Settings → Source → **Root Directory = `/backend`**(그러면 `Dockerfile`을 자동 사용) |
| MySQL 로그에 `Version: '26.7.0'`, 이후 `Cannot downgrade from 260700 to 80411` | 이미지 이름에 태그가 없어 최신판이 설치되었고, 그 데이터가 든 볼륨을 8.4.11이 열지 못함 | 이미지를 **`mysql:8.4.11`로 고정**, 비어 있는 **볼륨을 삭제하고 새로 연결** |
| 변수 참조가 서비스 이름에 따라 달라짐 | 서비스 이름이 `mysql`(소문자)이면 `${{mysql.RAILWAY_PRIVATE_DOMAIN}}` | 8.1절의 `MySQL`은 서비스 이름과 같게 맞출 것 |
| Vercel 빌드가 `NEXT_PUBLIC_API_BASE_URL is required` | 환경 변수 없이 빌드(의도한 검사) | Settings → Environment Variables(또는 Environments → Production)에 **Config 타입**으로 추가, 끝 `/` 없이, 저장 후 새로 배포 |
| 화면은 열리는데 데이터가 비어 있음 | 백엔드 `CORS_ALLOWED_ORIGINS`에 Vercel **프로덕션 도메인**이 없었음(예상 주소와 실제 `…-pearl.vercel.app`이 달랐음) | 대시보드 Domains에서 실제 주소를 확인해 정확히 입력 |
| Railway `Redeploy` 후에도 이전 동작 | **Redeploy는 직전 배포와 같은 커밋을 다시 빌드**함 | 새 커밋은 GitHub 연결이 복구되면 push로 자동 배포되고(`Auto deploys when pushed to GitHub`), 아니면 연결을 끊고 다시 연결 |
| `/api/auth/register`가 401 | 이전 코드가 응답 중(새 컨테이너가 뜨기 전) | 새 컨테이너가 Online이 될 때까지 대기(약 3~4분), 400이면 새 코드 |
| 검증 중 커버 이미지가 안 보임(브라우저 창이 숨겨져 있을 때) | `loading="lazy"` 이미지는 화면에 그려지는 창에서만 로드됨 | 실제 브라우저에서는 정상, 확인할 때는 창을 보이게 하거나 이미지를 eager로 바꿔 로드 확인 |
| 스크립트 실행 시 `Remove-Item`이 구문 오류 | 한 줄에 합치면서 `;`가 빠짐 | PowerShell 명령은 한 줄씩 실행 |
