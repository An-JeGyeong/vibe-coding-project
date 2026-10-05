# 망가브릿지 — ProjectBootstrap 로컬 실행

이 단계는 `/api/health`와 로컬 기반 구성만 제공합니다. 인증·업무 도메인·AI·외부 배포는 포함하지 않습니다.

## 준비

- Node 24, npm, JDK 17 (`JAVA_HOME`과 PATH 확인)
- Docker CLI / Docker Compose와 실행 중인 Docker Desktop Linux 데몬
- 포트 5432(DB), 8080(API), 3000(프런트엔드)
- 버전: Spring Boot 3.5.16, Gradle Wrapper 8.14.3, Next.js 16.3.8, React 19.3.0, PostgreSQL 이미지 17.6

모든 명령은 Windows PowerShell 기준입니다. 저장소 루트에서 시작합니다.

```powershell
Set-Location C:\Project_File\vibe-coding-project
node --version
npm --version
java -version
docker --version
docker compose version
docker info
```

Docker 데몬이 없으면 사용자가 Docker Desktop을 실행하고 Linux 엔진이 준비될 때까지 기다린 뒤 `docker info`를 다시 확인하세요. 설치되지 않았다면 사용자가 Docker를 설치해야 합니다. Docker 없이 프런트엔드 빌드와 백엔드 기본 자동 테스트는 실행할 수 있지만 실제 PostgreSQL 검증은 할 수 없습니다.

## 1. Docker Compose의 환경변수와 DB

Compose는 **루트 `.env`**를 자체 변수 치환에 사용합니다. 이 파일을 Spring이 읽는 것은 아닙니다. 기본 개발용 DB 이름·사용자·비밀번호는 Compose와 `backend/.env.example`에 일치하므로 `.env` 없이도 실행됩니다. 값 변경이 필요할 때만 예시를 복사하세요.

```powershell
# 선택: Compose 기본값을 바꾸려는 경우만 실행 (Git에서 제외됨)
# Copy-Item backend/.env.example .env
docker compose config --quiet
docker compose up -d
docker compose ps
docker compose exec -T postgres pg_isready -U mangabridge -d mangabridge
```

DB는 localhost에만 바인딩되며 named volume에 저장됩니다. 로컬 개발용 자격증명은 실제 운영 비밀값으로 사용하지 마세요. 기존 볼륨에 DB가 생성된 뒤 Compose 비밀번호를 바꾸어도 기존 PostgreSQL 계정 비밀번호는 자동 변경되지 않습니다.

## 2. Spring 프로세스에 환경변수 주입

Spring Boot는 `.env`나 `backend/.env.example`을 자동으로 읽지 않습니다. **백엔드를 실행하는 같은 PowerShell 창**에서 다음 환경변수를 주입합니다. 아래는 로컬 개발용 값입니다.

```powershell
$env:DB_URL = "jdbc:postgresql://localhost:5432/mangabridge"
$env:DB_USERNAME = "mangabridge"
$env:DB_PASSWORD = "mangabridge_local_only"
$env:CORS_ALLOWED_ORIGINS = "http://localhost:3000"
$env:SPRING_PROFILES_ACTIVE = "local"
$env:PORT = "8080"
Set-Location backend
.\gradlew.bat bootRun
```

필수 환경변수가 없거나 공백이면 변수 이름을 포함한 오류와 함께 종료합니다. CORS 값이 비었거나 `*`를 포함해도 종료합니다. 시작 시 DB 연결이나 Flyway가 실패하면 기동 실패가 정상입니다. 정상 기동 후에는 DB 장애가 생겨도 서버가 유지되며 헬스 API가 503을 반환합니다.

Flyway는 빈 기준선 `V1__baseline.sql`과 자체 이력 테이블만 적용합니다. 도메인 테이블과 자동 스키마 생성은 없습니다. Hikari/Flyway/Spring의 내부 예외와 Tomcat 버전 로그를 제한하고, 헬스 실패 로그에는 연결 문자열·자격증명·예외 문자열 없이 연결/쿼리 실패 사실만 남깁니다.

## 3. 프런트엔드 실행

별도의 PowerShell 창에서 저장소 루트로 이동합니다. Next.js는 `frontend/.env.local`을 읽을 수 있습니다. 예시에는 공개 API 주소만 있으며 DB 비밀값은 프런트엔드에 넣지 않습니다.

```powershell
Set-Location C:\Project_File\vibe-coding-project\frontend
Copy-Item .env.example .env.local
npm ci
npm run dev
```

`http://localhost:3000`에 접속하면 브라우저가 Spring API를 직접 호출합니다. UP, DOWN, 네트워크 오류를 표시하며 **다시 확인** 버튼으로 새 요청을 보냅니다. API 주소는 끝 슬래시 없이 설정합니다. 누락되거나 자격증명을 포함한 URL이면 Next.js 시작·빌드 시 변수 이름을 포함한 오류로 실패합니다. API 주소가 바뀌면 프런트엔드를 다시 시작하고 다시 빌드합니다.

## 4. 빌드와 자동 테스트

프런트엔드(실제 API/DB 없이 실행 가능):

```powershell
Set-Location C:\Project_File\vibe-coding-project\frontend
$env:NEXT_PUBLIC_API_BASE_URL = "http://localhost:8080"
npm ci
npm test
npm run typecheck
npm run build
```

백엔드 기본 테스트와 빌드(실제 DB 없이 실행 가능):

```powershell
Set-Location C:\Project_File\vibe-coding-project\backend
.\gradlew.bat build --no-daemon
```

기본 테스트는 HTTP 계약·모의 DB 상태·실제 TCP 지연 시 유한한 503 응답·환경변수·CORS·실제 YAML 설정 바인딩을 확인합니다. 이 테스트 성공이 실제 PostgreSQL 연결·마이그레이션 성공을 의미하지는 않습니다. 결과는 `backend/build/reports/tests/test/index.html`에 있습니다.

실제 PostgreSQL 통합 테스트는 별도로 실행합니다. Docker DB를 기동한 뒤 2절 환경변수를 **이 테스트를 실행하는 창에도** 주입합니다. DB가 없으면 성공/건너뛰기로 처리하지 않고 실패합니다.

```powershell
.\gradlew.bat integrationTest --no-daemon
```

결과는 `backend/build/reports/tests/integrationTest/index.html`에 있습니다. 최초 DB에서는 Flyway 기준선 적용, 실제 200, 실제 JDBC 연결 실패 503, 프레임워크 오류 본문을 검증합니다.

## 5. 수동 헬스·CORS·DB 장애 복구 검증

API와 DB가 실행 중인 상태에서 저장소 루트의 별도 PowerShell 창을 사용합니다. `curl.exe`는 PowerShell 별칭 `curl`과 다릅니다.

```powershell
curl.exe -i http://localhost:8080/api/health
curl.exe -I http://localhost:8080/api/health
curl.exe -i -H "Origin: http://localhost:3000" http://localhost:8080/api/health
curl.exe -i -H "Origin: https://unapproved.example" http://localhost:8080/api/health
curl.exe -i -X OPTIONS -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: Content-Type" http://localhost:8080/api/health
curl.exe -i -X POST http://localhost:8080/api/health
docker compose exec -T postgres psql -U mangabridge -d mangabridge -c 'SELECT version, script, success FROM flyway_schema_history;'
docker compose stop postgres
curl.exe -i --max-time 15 http://localhost:8080/api/health
docker compose start postgres
docker compose exec -T postgres pg_isready -U mangabridge -d mangabridge
curl.exe -i --max-time 15 http://localhost:8080/api/health
```

DB 정상 시 200 `{status:"UP",db:"UP",time:"UTC ISO-8601"}`, 정상 기동 후 DB 중지 시 503 `db:"DOWN"`, 재기동 후 다시 200이어야 합니다. 모든 헬스 응답에 `Cache-Control: no-store`가 있어야 합니다. HEAD는 본문이 없어야 하고 변경 메서드는 405, 비허용 Origin은 403이어야 합니다. 브라우저의 **다시 확인** 버튼으로 동일한 DB 중지·재기동 흐름과 화면 상태를 확인하세요. 네트워크 오류 화면은 API 프로세스를 종료한 뒤 버튼을 눌러 확인합니다.

## 6. 타임아웃과 비밀값 검사

| 실제 설정 | 값 | 단위 |
|---|---:|---|
| `spring.datasource.hikari.connection-timeout` | 2000 | ms |
| `spring.datasource.hikari.validation-timeout` | 1000 | ms |
| `spring.jdbc.template.query-timeout` | 2s | 초 (`JdbcTemplate`에는 2초로 바인딩) |
| `spring.datasource.hikari.data-source-properties.connectTimeout` | 2 | 초 (PostgreSQL JDBC) |
| `spring.datasource.hikari.data-source-properties.socketTimeout` | 2 | 초 (PostgreSQL JDBC) |
| 프런트엔드 `AbortSignal.timeout` | 10000 | ms |

각 DB 타임아웃은 개별 한도입니다. 전체 HTTP 응답이 엄밀하게 2초 이내라는 보장은 하지 않습니다.

```powershell
git status --short
git ls-files
git ls-files -- '.env' '**/.env' '**/.env.local'
git check-ignore frontend/.env.local backend/.env .env
git diff --cached --check
```

`.env*`는 `.env.example`만 제외하고 무시됩니다. 로컬 개발 전용 값 외의 실제 비밀값을 추적 파일이나 클라이언트 번들에 넣지 마세요. 로컬 커밋 전 파일 목록과 staged diff를 검사합니다. 빌드 산출물과 의존성 폴더는 추적하지 않습니다.
