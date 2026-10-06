# 망가브릿지 — ProjectBootstrap 로컬 실행

ProjectBootstrap은 `/api/health`와 로컬 기반 구성을 제공합니다. 후속 DemoAuth 계약은 CONTRACTS.md 12절을 따릅니다. 업무 도메인·AI·외부 배포는 포함하지 않습니다.

## 준비

- Node 24, npm, JDK 17 (`JAVA_HOME`과 PATH 확인)
- Docker CLI / Docker Compose와 실행 중인 Docker Desktop Linux 데몬
- 포트 3306(DB), 8080(API), 3000(프런트엔드)
- 버전: Spring Boot 3.5.16, Gradle Wrapper 8.14.3, Next.js 16.3.8, React 19.3.0, MySQL 이미지 `mysql:8.4.11`
- Connector/J `9.7.0`, Flyway core/mysql `11.7.2`는 Spring Boot BOM으로 관리하며 `gradlew.bat dependencies --configuration runtimeClasspath`로 확인합니다.

모든 명령은 Windows PowerShell 5.1 기준입니다. 저장소 루트에서 시작합니다. Docker에 전달할 셸 스크립트는 단일 인용 here-string으로 작성하고 `docker compose exec -T mysql sh -s`의 stdin으로 보냅니다. `-T`는 TTY를 비활성화하고 stdin은 열어 둡니다. 따옴표가 포함된 스크립트를 `sh -c`의 명령 인자로 전달하지 않습니다. PowerShell 5.1 파이프가 덧붙이는 CRLF의 CR을 셸 구문으로 해석하지 않도록 각 단일 행 스크립트 끝에 ` #` 주석을 붙입니다. 네이티브 명령 직후 `$LASTEXITCODE`를 저장한 다음 판정합니다.

```powershell
Set-Location C:\Project_File\vibe-coding-project
node --version
npm --version
java -version
docker --version
docker compose version
docker info
```

Docker 데몬이 없으면 사용자가 Docker Desktop을 실행하고 Linux 엔진이 준비될 때까지 기다린 뒤 `docker info`를 다시 확인하세요. 설치되지 않았다면 사용자가 Docker를 설치해야 합니다. Docker 없이 프런트엔드 빌드와 백엔드 기본 자동 테스트는 실행할 수 있지만 실제 MySQL 검증은 할 수 없습니다.

기존 PostgreSQL 커밋·컨테이너·`postgres_data` 볼륨은 보존합니다. MySQL은 별도 `mysql_data` 볼륨에서 시작하며 데이터 이전은 하지 않습니다. 컨테이너·볼륨 삭제나 정리 명령을 실행하지 마세요. 기존 PostgreSQL 상태는 `docker ps -a`와 `docker volume ls`로 확인만 합니다. 아래 Compose 실행에는 `--remove-orphans`를 붙이지 않습니다.

## 1. Docker Compose의 환경변수와 DB

Compose는 **루트 `.env`**를 자체 변수 치환에 사용합니다. 이 파일을 Spring이 읽는 것은 아닙니다. 기본 개발용 DB 이름·사용자·비밀번호는 Compose와 `backend/.env.example`에 일치하므로 `.env` 없이도 실행됩니다. 값 변경이 필요할 때만 예시를 복사하세요.

```powershell
# 선택: Compose 기본값을 바꾸려는 경우만 실행 (Git에서 제외됨)
# Copy-Item backend/.env.example .env
docker compose config --quiet
docker compose up -d mysql
docker compose ps
$selectOne = @'
MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP --host=127.0.0.1 --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --connect-timeout=2 --batch --skip-column-names --execute="SELECT 1" #
'@
$selectOne | docker compose exec -T mysql sh -s
$selectOneExit = $LASTEXITCODE
if ($selectOneExit -ne 0) { throw "SELECT 1 failed (exit $selectOneExit)" }
Write-Output "SELECT 1 exit: $selectOneExit"
```

DB는 localhost에만 바인딩되며 named volume에 저장됩니다. 로컬 개발용 자격증명은 실제 운영 비밀값으로 사용하지 마세요. 기존 MySQL 볼륨에 DB가 생성된 뒤 Compose 비밀번호를 바꾸어도 기존 계정 비밀번호는 자동 변경되지 않습니다.

서버는 InnoDB, `utf8mb4`, `utf8mb4_0900_ai_ci`, UTC(`+00:00`)를 명시합니다. 최초 볼륨 초기화 시 `backend/docker/mysql/01-schema-options.sql`이 현재 스키마의 문자셋·collation을 명시적으로 설정합니다. 앱 계정은 해당 스키마 한정 전체 권한을 가지며 Flyway도 같은 계정을 사용합니다. root 비밀번호는 무작위 생성하지만 앱이나 진단 명령에서 사용하지 않습니다. 전체 Docker 로그에는 이 무작위 비밀번호가 들어갈 수 있으므로 출력하거나 보고문에 붙이지 마세요.

healthcheck는 앱 계정으로 TCP `SELECT 1`을 실행합니다. 비밀번호는 컨테이너 내부 `MYSQL_PWD` 환경변수로 전달하고 명령 인자에는 넣지 않습니다. healthcheck의 stdout/stderr는 버리며 실패 종료 코드를 유지합니다. `docker inspect`도 전체 출력 대신 필요한 필드만 조회합니다.

```powershell
$mysqlId = docker compose ps -q mysql
$mysqlIdExit = $LASTEXITCODE
if ($mysqlIdExit -ne 0 -or -not $mysqlId) { throw 'MySQL container lookup failed' }
docker inspect --format '{{.State.Health.Status}}' $mysqlId
$healthExit = $LASTEXITCODE
if ($healthExit -ne 0) { throw 'Health status lookup failed' }
$probeJson = docker inspect --format '{{json .Config.Healthcheck.Test}}' $mysqlId
$probeExit = $LASTEXITCODE
if ($probeExit -ne 0) { throw 'Healthcheck lookup failed' }
$probe = $probeJson | ConvertFrom-Json
# 프로브의 변수 참조만 확인하며 전체 컨테이너 환경변수는 출력하지 않습니다.
$probe
# 실제 healthcheck 명령에 잘못된 비밀번호를 주입한 일회성 실행: 종료 코드가 0이 아니어야 합니다.
$invalidProbe = 'MYSQL_PASSWORD="invalid-${MYSQL_PASSWORD}"; ' + $probe[1] + ' #'
$invalidProbe | docker compose exec -T mysql sh -s
$invalidProbeExit = $LASTEXITCODE
if ($invalidProbeExit -eq 0) { throw 'Invalid credentials unexpectedly succeeded' }
Write-Output "Invalid healthcheck exit: $invalidProbeExit"

# 프로브는 오류 출력을 버리므로, 같은 TCP 대상에 별도 일회성 클라이언트를 호출해 원인을 판별합니다.
# 오류 원문(접속 계정 포함)은 출력하지 않고 인증 오류 코드만 확인합니다.
$invalidSelect = @'
MYSQL_PWD="invalid-${MYSQL_PASSWORD}" mysql --protocol=TCP --host=127.0.0.1 --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --connect-timeout=2 --batch --skip-column-names --execute="SELECT 1" 2>&1 #
'@
$authOutput = $invalidSelect | docker compose exec -T mysql sh -s
$authExit = $LASTEXITCODE
$isAuthenticationError = ($authOutput | Out-String) -match 'ERROR 1045 \(28000\)'
if ($authExit -eq 0 -or -not $isAuthenticationError) { throw 'Negative control did not produce MySQL authentication error 1045 (28000)' }
Write-Output "Authentication error 1045 (28000) confirmed; exit: $authExit"
Remove-Variable authOutput

# 정상 자격증명으로 재확인: 1절의 $selectOne을 그대로 사용합니다.
$selectOne | docker compose exec -T mysql sh -s
$recheckExit = $LASTEXITCODE
if ($recheckExit -ne 0) { throw "Normal credential recheck failed (exit $recheckExit)" }
Write-Output "Normal credential recheck exit: $recheckExit"
```

위 일회성 검사는 실제 프로브의 인증 실패 종료 코드를 검증합니다. 기존 컨테이너 환경이나 계정을 바꾸지 않으므로 이 명령만으로 컨테이너 상태가 `unhealthy`로 변한 것으로 보고하지 않습니다. 실제 unhealthy 상태와 복구는 별도의 실행 관찰이 필요합니다.

실행 증빙(2026-10-05, Windows PowerShell `5.1.26100.9444`, 정상 응답 중인 `mysql:8.4.11`): 위 stdin 명령을 그대로 실행해 정상 `SELECT 1`은 `1`과 종료 코드 0, 잘못된 비밀번호의 실제 프로브는 종료 코드 1, 별도 원인 확인 호출은 인증 오류 `1045 (28000)`과 종료 코드 1, 이후 정상 재접속은 `1`과 종료 코드 0을 확인했습니다. 5절의 DB 상세 조회와 재확인용 `SELECT 1`도 정상 DB에서 종료 코드 0으로 실행했습니다. 이 검증 중 서비스 중단·재기동이나 계정·설정 변경은 수행하지 않았으며, 오류 원문과 비밀번호는 출력하지 않았습니다.

## 2. Spring 프로세스에 환경변수 주입

Spring Boot는 `.env`나 `backend/.env.example`을 자동으로 읽지 않습니다. **백엔드를 실행하는 같은 PowerShell 창**에서 다음 환경변수를 주입합니다. 아래는 로컬 개발용 값입니다.

```powershell
$env:DB_URL = "jdbc:mysql://localhost:3306/mangabridge"
$env:DB_USERNAME = "mangabridge"
$env:DB_PASSWORD = "mangabridge_local_only"
$env:CORS_ALLOWED_ORIGINS = "http://localhost:3000"
$env:SPRING_PROFILES_ACTIVE = "local"
$env:PORT = "8080"
Set-Location backend
.\gradlew.bat bootRun
```

필수 환경변수가 없거나 공백이면 변수 이름을 포함한 오류와 함께 종료합니다. CORS 값이 비었거나 `*`를 포함해도 종료합니다. `DB_USERNAME=root`는 금지하며 기동 전에 거부합니다. 시작 시 DB 연결이나 Flyway가 실패하면 기동 실패가 정상입니다. 정상 기동 후에는 DB 장애가 생겨도 서버가 유지되며 헬스 API가 503을 반환합니다.

공통 JDBC 설정은 `characterEncoding=UTF-8`, `connectionCollation=utf8mb4_0900_ai_ci`, `connectionTimeZone=UTC`, `forceConnectionTimeZoneToSession=true`입니다. `local` 프로필은 localhost Docker에 한해 `sslMode=DISABLED`, `allowPublicKeyRetrieval=true`를 사용합니다. `prod` 및 공통 기본값은 `sslMode=VERIFY_IDENTITY`이며 운영 프로필에는 공개 키 검색 옵션이 없습니다. 운영 접속·배포는 이번 작업 범위 밖입니다. 로컬 옵션을 운영 DB URL에 복사하지 마세요. `mysql_native_password`로 변경하지 않습니다.

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

`npm test`는 기존 `node:test` 4개(`npm run test:node`)와 Vitest 컴포넌트·인증 상태 테스트(`npm run test:ui`)를 차례로 실행합니다. 테스트 전용 devDependency는 `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom`이며 런타임 의존성은 늘지 않습니다. 이 테스트는 계약에 맞춘 API 모킹이므로 통과해도 실제 백엔드 연동 성공을 의미하지 않습니다. 실제 연동은 아래 절차로 별도 검증합니다.

백엔드 기본 테스트와 빌드(실제 DB 없이 실행 가능):

```powershell
Set-Location C:\Project_File\vibe-coding-project\backend
.\gradlew.bat build --no-daemon
```

기본 테스트는 HTTP 계약·모의 DB 상태·실제 TCP 지연 시 유한한 503 응답·환경변수·CORS·실제 YAML 설정 바인딩·TLS 프로필 분리·Compose 프로브 구성을 확인합니다. 이 테스트 성공이 실제 MySQL 연결·마이그레이션 성공을 의미하지는 않습니다. 결과는 `backend/build/reports/tests/test/index.html`에 있습니다.

실제 MySQL 통합 테스트는 별도로 실행합니다. Docker DB를 기동한 뒤 2절 환경변수를 **이 테스트를 실행하는 창에도** 주입합니다. DB가 없으면 성공/건너뛰기로 처리하지 않고 실패합니다. 이전 DB 엔진의 결과를 재사용하지 않으려면 `--rerun-tasks`를 지정합니다.

```powershell
.\gradlew.bat integrationTest --no-daemon --rerun-tasks
```

결과는 `backend/build/reports/tests/integrationTest/index.html`에 있습니다. 최초 DB에서는 Flyway 기준선 적용, 실제 200, 실제 JDBC 연결 실패 503, 프레임워크 오류 본문, 문자셋·collation·UTC·비root 계정·InnoDB 기본 엔진과 사용 가능 여부를 검증합니다. 검증 때문에 영구 도메인 테이블을 만들지 않습니다. 테스트 연결도 승인된 `socketTimeout=3000` ms를 사용하며, 이 값으로 Flyway가 실패하면 값을 늘리거나 별도 데이터소스로 우회하지 않고 변경 제안을 보고합니다.

## 5. 수동 헬스·CORS·DB 장애 복구 검증

API와 DB가 실행 중인 상태에서 저장소 루트의 별도 PowerShell 창을 사용합니다. `curl.exe`는 PowerShell 별칭 `curl`과 다릅니다.

```powershell
curl.exe -i http://localhost:8080/api/health
curl.exe -I http://localhost:8080/api/health
curl.exe -i -H "Origin: http://localhost:3000" http://localhost:8080/api/health
curl.exe -i -H "Origin: https://unapproved.example" http://localhost:8080/api/health
curl.exe -i -X OPTIONS -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: Content-Type" http://localhost:8080/api/health
curl.exe -i -X POST http://localhost:8080/api/health
$dbDetails = @'
MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP --host=127.0.0.1 --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --connect-timeout=2 --batch --execute="SELECT version, script, success FROM flyway_schema_history; SELECT @@character_set_server, @@collation_server, @@session.time_zone, @@default_storage_engine;" #
'@
$dbDetails | docker compose exec -T mysql sh -s
$dbDetailsExit = $LASTEXITCODE
if ($dbDetailsExit -ne 0) { throw "DB details query failed (exit $dbDetailsExit)" }
docker compose stop mysql
curl.exe -i --max-time 15 http://localhost:8080/api/health
docker compose start mysql
$selectOne = @'
MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP --host=127.0.0.1 --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --connect-timeout=2 --batch --skip-column-names --execute="SELECT 1" #
'@
$selectOne | docker compose exec -T mysql sh -s
$recoveryExit = $LASTEXITCODE
if ($recoveryExit -ne 0) { throw "SELECT 1 after recovery failed (exit $recoveryExit)" }
Write-Output "SELECT 1 after recovery exit: $recoveryExit"
curl.exe -i --max-time 15 http://localhost:8080/api/health
```

DB 정상 시 200 `{status:"UP",db:"UP",time:"UTC ISO-8601"}`, 정상 기동 후 DB 중지 시 503 `db:"DOWN"`, 재기동 후 다시 200이어야 합니다. 중지된 컨테이너에서는 healthcheck가 실행되지 않으므로 `stopped`를 `unhealthy` 검증으로 대체하지 않습니다. 모든 헬스 응답에 `Cache-Control: no-store`가 있어야 합니다. HEAD는 본문이 없어야 하고 변경 메서드는 405, 비허용 Origin은 403이어야 합니다. 브라우저의 **다시 확인** 버튼으로 동일한 DB 중지·재기동 흐름과 화면 상태를 확인하세요. 네트워크 오류 화면은 API 프로세스를 종료한 뒤 버튼을 눌러 확인합니다.

## 6. 타임아웃과 비밀값 검사

| 실제 설정 | 값 | 단위 |
|---|---:|---|
| `spring.datasource.hikari.connection-timeout` | 2000 | ms |
| `spring.datasource.hikari.validation-timeout` | 1000 | ms |
| `spring.jdbc.template.query-timeout` | 2s | 초 (`JdbcTemplate`에는 2초로 바인딩) |
| `spring.datasource.hikari.data-source-properties.connectTimeout` | 2000 | ms (MySQL Connector/J) |
| `spring.datasource.hikari.data-source-properties.socketTimeout` | 3000 | ms (MySQL Connector/J, Flyway에도 적용) |
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

## 7. DemoAuth 실행·검증

역할별 ID는 `demo.operator`, `demo.translator`, `demo.reviewer`, `demo.reader`입니다. 비밀번호는 화면·소스·NEXT_PUBLIC 변수에 포함하지 않습니다. local 직접 접속만 이번 검증 대상이며 Vercel/API 외부 배포와 프록시 IP 정책은 별도 승인 전 미검증입니다.

2절처럼 DB·CORS 환경을 주입한 backend PowerShell 5.1 창에서 다음 초기화를 한 번 실행합니다. 기존 계정은 덮어쓰지 않으며 재실행은 같은 비밀번호를 입력해야 합니다. 실제 비밀번호를 셸 명령이나 Git에 기록하지 않습니다.

```powershell
$env:AUTH_CLIENT_IP_MODE = 'DIRECT'
$env:DEMO_AUTH_SEED_ENABLED = 'true'
try {
  foreach ($name in @('DEMO_OPERATOR_PASSWORD','DEMO_TRANSLATOR_PASSWORD','DEMO_REVIEWER_PASSWORD','DEMO_READER_PASSWORD')) {
    $secret = Read-Host $name -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { [Environment]::SetEnvironmentVariable($name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'Process') }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  }
  .\gradlew.bat bootRun --args='--demo-auth-seed=true --spring.main.web-application-type=none' --no-daemon
  $seedExit = $LASTEXITCODE
  if ($seedExit -ne 0) { throw "Demo account initialization failed (exit $seedExit)" }
} finally {
  foreach ($name in @('DEMO_OPERATOR_PASSWORD','DEMO_TRANSLATOR_PASSWORD','DEMO_REVIEWER_PASSWORD','DEMO_READER_PASSWORD','DEMO_AUTH_SEED_ENABLED')) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
  }
}
.\gradlew.bat bootRun --no-daemon
```

인증은 login/me/logout 3개 API만 제공합니다. 프런트 구현 후 /login → /demo를 확인하며 sessionStorage를 사용합니다. 인증 호출은 credentials: omit과 Authorization: Bearer를 사용합니다. 401은 인증 제거, 403은 유지, 503/통신 장애는 재시도, logout 통신 장애는 서버 logout 미확인으로 표시합니다. 실제 브라우저 403은 첫 업무 API까지 이월합니다.

토큰 수명은 기본 3600초이며 테스트는 AUTH_TOKEN_TTL_SECONDS로 조정합니다. 서버 재기동에도 미만료 토큰은 유지합니다. 보관 기간이 지난 인증 데이터의 수동 정리는 2절 환경 주입 후 `gradlew.bat bootRun --args='--demo-auth-cleanup=true --spring.main.web-application-type=none' --no-daemon`으로 실행합니다. 계정·Flyway·기존 DB 볼륨은 정리하지 않습니다. 새 스케줄러는 없습니다.

백엔드는 `gradlew.bat build integrationTest --no-daemon --rerun-tasks`로 기존 회귀·실제 MySQL·인증을 검증합니다. 프런트 테스트는 Claude Code가 수행하고, 통합 후 Codex가 실제 브라우저/API/MySQL 결과와 대상 커밋을 기록합니다. 실행 전에는 통과로 기록하지 않습니다.

백엔드 검증 기록(2026-10-05): 실제 MySQL에서 V2~V5 적용, 로그인/me/logout·만료·4개 역할 권한·위조 거부·동시 실패 제한·IP 제한 경계를 통합 테스트로 확인했습니다. 감사 저장 실패의 503/롤백과 계정 초기화 생성/재실행/덮어쓰기 금지는 단위 테스트로 확인했습니다. 운영 JAR에 테스트 전용 경로가 포함되지 않았습니다. PowerShell 5.1.26100.9444로 환경을 주입한 별도 8081 검증 서버에서 health 200, 미인증 me 401, 실패 login 401, 형식 오류 400, token 없는 logout 204, 잘못된 헤더 logout 400, Authorization preflight 200, 비허용 Origin 403을 확인했습니다. 기존 8080 서버는 변경하지 않았으므로 프런트 통합 때 새 백엔드를 사용할 포트를 맞춰야 합니다. 실제 데모 계정의 비밀번호는 사용자가 위 초기화 절차로 설정합니다. 프런트 구현·브라우저 통합·배포는 아직 검증하지 않았습니다.

### 67d1dae 통합 마무리 검증 기록

코드·계약 기준은 `67d1dae7fdbe700a055aa18567936e4ed2ac86b1`입니다(계약 `31dbc53`, backend `1e2fb4f`, frontend `96566da`, 추가 정책 `67d1dae`). 아래 기록은 2026-10-05 KST에 실행했으며, 앞선 기록과 검증자를 구분합니다. 이번 문서 커밋은 이 코드 기준에 검증 기록만 추가합니다.

| Codex 직접 실행 | 결과·범위 |
|---|---|
| `gradlew.bat build integrationTest --no-daemon --rerun-tasks` | 통과. 실제 MySQL 8.4.11 localhost:3306, 기본·회귀 20개 + 통합 12개, 실패/오류/건너뛰기 0, 37초. XML 생성 시각 22:21:16(기본)/22:21:35(통합). 기존 볼륨·컨테이너 보존 |
| 테스트 소스 `GET /__test/operator` | 실제 MySQL 테스트 통과. 미인증 401, OPERATOR 200, TRANSLATOR/REVIEWER/READER 403. READER의 X-Role/X-User-Id 위조는 403, login JSON의 role 주입은 400 |
| `jar tf backend/build/libs/mangabridge-backend-0.0.1-SNAPSHOT.jar` 및 bootRun 프로세스 classpath 확인 | 통과. 운영 JAR에 IntegrationTest/OperatorFixture/TestApplication 0개. bootRun은 main 클래스만 포함하고 test 클래스 경로 없음. 별도 역할 검증 API를 운영 코드에 추가하지 않음 |
| README 7절 seed/bootRun, Windows PowerShell 5.1.26100.9444 | 통과. 사용자가 Read-Host로 4개 비밀번호 직접 입력. seed 종료 0(22:23:04 KST), 새 API 8083 health 200. DB 환경은 기존 로컬 예시, CORS는 검증 사본의 http://localhost:3002. 값은 기록하지 않음 |
| 프런트 스모크 준비 | 백엔드는 README 2절 환경 주입 후 `$env:PORT='8083'; $env:CORS_ALLOWED_ORIGINS='http://localhost:3002'`를 설정하고 README 7절 명령 그대로 실행. 추적 파일의 격리 사본에서 NEXT_PUBLIC_API_BASE_URL=http://localhost:8083, `npm run dev -- --port 3002 --webpack`. 원본 frontend/.next를 변경하지 않음 |
| 비밀값·코드 변경 검사 | 수집한 테스트 출력의 비밀값/전체 JDBC 문자열 검사 0건, 실제 .env 추적 0개, backend/frontend 코드는 기준 커밋과 동일 |
| 기존 3000 next start 영향 확인 | /login 200, 참조 JS 15개 모두 200. 서버 시작 19:11:51 KST보다 BUILD_ID 갱신 21:56:16 KST가 늦어 최신 빌드 적용을 보장하려면 사용자 재시작 필요. 직접 종료하지 않음 |

Claude Code의 전달된 직접 검증 보고(Codex 재실행 결과 아님): 임시 MySQL :3307, API :8082, frontend :3001에서 네 역할 로그인·새로고침·TTL 90초 만료·서버 폐기 후 401·429/Retry-After·서버 중지 후 재시도 복구·정상 logout/이전 token 401·logout 통신 실패의 로컬 정리/서버 폐기 미확인 경고와 남은 token 200·sessionStorage 단일 키/localStorage·쿠키 미사용/credentials omit을 확인했다고 전달받았습니다. 셸 주입은 Git Bash였고 대부분 브라우저 스크립트 이벤트, 탭 활성은 hidden 패널의 visibilityState를 visible로 변경한 방식이었다는 한계도 전달받았습니다. 프런트 node 4개·Vitest 74개·타입 검사·빌드 및 늦은 /me 응답 방어 변이 시험/원복은 Claude의 보고이며 이번 Codex 실행에 합산하지 않습니다.

미검증 유지: 역할별 실제 브라우저 403(첫 업무 API로 이월), 외부 배포/Vercel, 프록시 IP 정책. PS5.1 서버의 브라우저 스모크(login → /demo → 새로고침 사용자·역할 복원 → logout)은 사용자가 직접 수행하고 같은 날 검증 완료를 회신했습니다. 도구 연결 탭이 사용자 인증 세션과 달라 Codex 직접 브라우저 관찰은 미검증입니다. 변경된 검증 설정은 새 프로세스 환경에만 주입했으며, 검증 후 이번 3002/8083 서버와 비밀번호 입력 창만 종료했습니다. 기존 8080/8081/3000 리스너의 프로세스 ID 유지와 검증 포트 해제를 확인했습니다. 추적 설정·기존 Docker 컨테이너·볼륨은 변경하거나 삭제하지 않았고 초기화한 데모 계정은 보존합니다.

Git 메모: 시작 HEAD는 위 기준과 일치. PROJECT_CONTEXT.md는 i/lf w/crlf, core.autocrlf=true이며 정규화 파일 해시가 HEAD와 같고 내용 diff는 없습니다. 요청에 따라 파일은 수정하거나 stage하지 않았습니다. 필요하면 사용자가 `git update-index --refresh -- PROJECT_CONTEXT.md`로 인덱스 메타데이터만 갱신하는 방법을 검토할 수 있으며, 내용 덮어쓰기/전체 restore/reset은 필요하지 않습니다.

### DemoAuth 선택 개선 1·2 검증 기록

시작 기준 `3479f9c24b9b354fccfd4735417a35541f89686b`, 코드 커밋 `7040d2ee6173445d8f2826714cc885c72066c133`. 2026-10-05 KST에 Codex가 직접 실행했습니다. frontend 및 승인 문서 3종은 수정하지 않았습니다.

- 비JSON 로그인: HttpMediaTypeNotSupportedException을 기존 INVALID_REQUEST 처리에 포함했습니다. text/plain·application/x-www-form-urlencoded 모두 400, 고정 오류 JSON만 반환, Cache-Control: no-store. 실제 HTTP/MySQL 테스트에서 각 요청 전후 ID·IP 실패 카운터가 1로 유지됨을 확인했습니다. GET /api/auth/login의 405와 무토큰 POST /api/auth/me의 401도 통과했습니다.
- 제한 행 정리는 (a) 정확한 키 삭제를 선택했습니다. src/test의 등록 필터만 서버 측 request.getRemoteAddr를 매 테스트의 fixture.UUID 주소로 치환합니다. HTTP는 실제 임의 포트 서버를 호출하고 JDBC는 실제 MySQL을 사용합니다. 공유 127.0.0.1 키는 사용하거나 삭제하지 않으며 클라이언트 전달 헤더도 사용하지 않습니다. 직접 Service 호출의 fixture 주소·존재하지 않는 테스트 ID·생성 계정 ID도 추적해 @AfterEach에서 각 SHA-256 키만 삭제하고 0행을 확인합니다. 운영 JAR의 FixtureAddress/OperatorFixture/DemoAuthIntegrationTest 클래스는 0개였습니다. 환경·Compose·스키마·생산 IP 정책 변경은 없습니다.
- README 2절처럼 backend/.env.example의 DB/CORS/profile/PORT 환경을 주입하고 AUTH_CLIENT_IP_MODE=DIRECT로 실행했습니다. 비밀번호 값은 명령 인자나 기록에 넣지 않았습니다.

| 실제 실행 명령 | 실행 시각(KST) | 결과 |
|---|---|---|
| `gradlew.bat build integrationTest --no-daemon --rerun-tasks` 1회차 | 2026-10-05 23:07:29 시작 | 통과, 종료 0, BUILD SUCCESSFUL in 39s, 기본 20개 + 실제 MySQL 통합 14개(인증 9 + 기존 DB 5), 실패/오류/건너뛰기 0 |
| 같은 명령 2회차, 코드 변경 없이 연속 재실행 | 2026-10-05 23:08:57~23:09:37 | 통과, 종료 0, BUILD SUCCESSFUL in 39s, 같은 34개 전부 통과 |
| 읽기 전용 앱 계정 DB 집계: stdin 스크립트 → `docker compose exec -T mysql sh -s` | 실행 전·각 실행 후 | auth_login_limit 88 → 88 → 88, 데모 계정 4 → 4 → 4, 데모 토큰 8 → 8 → 8. 행 전체의 정렬 집계 SHA-256도 모두 동일 |
| 수집한 Gradle 로그·JUnit XML 비밀값 검사 | 두 실행 후 | DB 비밀번호·전체 JDBC URL·Bearer 토큰·root 비밀번호/비밀키 패턴 0건 |

DB 집계는 컨테이너 앱 계정의 MYSQL_PWD 환경으로 실행했으며 비밀번호를 명령 인자에 넣지 않았습니다. 집계 해시의 GROUP_CONCAT은 해당 조회 세션에만 group_concat_max_len=1048576을 적용했습니다. 첫 실행 뒤 조회 스크립트를 파일에서 읽으며 붙은 빈 CRLF로 sh 오류가 발생했으나 Gradle은 종료 0이었습니다. 스크립트의 TrimEnd() 적용 후 읽기 전용 조회를 재실행해 정상 종료와 동일 집계를 확인했습니다. 두 Gradle 실행 모두 실제 DB 검증을 수행했으며 건너뛰기나 모의 DB 대체는 없습니다.

기존 제한 행 88개는 이번 실행의 생성물로 식별할 수 없으므로 보존했습니다. PROJECT_CONTEXT.md의 기존 줄바꿈 M도 수정·stage·restore하지 않았습니다. 기존 컨테이너·볼륨·서비스는 중단하거나 삭제하지 않았고 push는 수행하지 않았습니다. 이번 범위에 미검증 항목은 없으며, 앞서 이월한 실제 브라우저 역할별 403·외부 배포/Vercel·프록시 IP 정책은 계속 미검증입니다.
## 8. EpisodeSource 회차·원문 API 실행·검증

승인 기준: CONTRACTS.md 13절, DECISIONS.md D-026~D-030, 시작 커밋 `582b5d0811a09d1cbeabaffb345f645388805e70`. 백엔드 코드·테스트 기준은 `9e43a99`이며 스키마 `115fdd2`, API `c4d47fd`를 포함합니다. 아래 문서 커밋은 검증 기록만 추가합니다.

여섯 API는 모두 OPERATOR Bearer 인증이 필요합니다. `POST /api/episodes`, `GET /api/episodes`, `GET /api/episodes/{id}`, `PUT /api/episodes/{id}/source`, `GET /api/episodes/{id}/source/versions`, `GET /api/episodes/{id}/source/versions/{version}`. 요청·응답과 입력 규칙은 계약 13.2~13.5를 따릅니다. source PUT은 expectedVersion을 보내며 새 버전 201, 동일 내용 200 changed:false, 충돌 409 error.latestVersion입니다. 제목·본문을 변환하지 않으며 과거 버전·블록은 INSERT만 합니다.

기존 서버를 임의 종료하지 마세요. 프런트 연동을 위해 새 서버가 필요하면 사용하지 않는 포트를 선택하고 별도 PowerShell 창에서 실행합니다. 아래는 **실행 예시이며 이번 검증에서 실행하지 않았습니다**. 예시 포트 8084의 사용 여부를 먼저 확인하세요. 환경 주입은 PowerShell 5.1 문법이며 기존 2절과 같습니다.

```powershell
Set-Location C:\Project_File\vibe-coding-project\backend
Get-Content .env.example | Where-Object { $_ -match '^(DB_URL|DB_USERNAME|DB_PASSWORD|CORS_ALLOWED_ORIGINS|SPRING_PROFILES_ACTIVE|PORT|AUTH_CLIENT_IP_MODE)=' } | ForEach-Object {
  $pair = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'Process')
}
$env:AUTH_CLIENT_IP_MODE = 'DIRECT'
$env:PORT = '8084'
$env:CORS_ALLOWED_ORIGINS = 'http://localhost:3000'
.\gradlew.bat bootRun --no-daemon
```

프런트의 NEXT_PUBLIC_API_BASE_URL은 선택한 API 포트와 일치해야 합니다(프런트 변경 담당 Claude Code). Flyway는 기동 때 V6~V9를 적용·검증합니다. 기존 실행 중인 서버가 새 API를 자동으로 제공하는 것은 아니므로 새 프로세스로 확인하세요. CORS는 기존 PUT·Content-Type·Authorization 허용과 credentials=false를 그대로 사용하며 설정 변경은 없습니다. DB/JDBC 타임아웃도 기존 connectTimeout=2000ms, socketTimeout=3000ms, Hikari connectionTimeout=2000ms, query timeout=2초를 유지했습니다.

### Codex 직접 검증 (2026-10-05 KST, 실제 MySQL 8.4.11 localhost:3306)

실제 실행은 backend/.env.example에서 위 DB/CORS/profile/PORT 환경을 프로세스에 주입하고 AUTH_CLIENT_IP_MODE=DIRECT로 수행했습니다. Gradle 출력은 ignored build/verification의 로그로 수집하고 네이티브 명령 직후 LASTEXITCODE를 보존했습니다. 기존 8080/8081/3000 서비스·컨테이너·볼륨은 중단하거나 삭제하지 않았습니다.

| 명령·검사 | 통과/실패/미검증 및 증빙 |
|---|---|
| 최초 `gradlew.bat build integrationTest --no-daemon --rerun-tasks` (23:35:05 시작) | 실패, 종료 1, 32초. 신규 테스트 TrackingAuthDao의 final 선언으로 Spring 프록시 생성 실패(통합 20개 실패). 실제 MySQL 마이그레이션·기존 DB 테스트 5개는 통과. final 제거 후 재검증 |
| 같은 명령, 수정 후 성공 1회차 (23:36:43 시작) | 통과, 종료 0, 48초. 기본 회귀 20개 + 실제 통합 25개(EpisodeSource 11, DemoAuth 9, MySQL 5), 총 45개, 실패/오류/건너뛰기 0 |
| 같은 명령, 코드 변경 없이 연속 성공 2회차 (23:39:08~23:39:59) | 통과, 종료 0, 50초. 같은 45개 모두 통과, 실패/오류/건너뛰기 0 |
| 4개 역할 × 6개 API + 미인증 | 실제 HTTP/MySQL 통과. 미인증 6개 모두 401, 비운영자 3역할의 18개 모두 403 및 ACCESS_DENIED 감사, OPERATOR 6개 성공·no-store. X-Role/X-User-Id·본문 role/userId 위조 거부 |
| 입력·프로토콜·저장 함수 | 제목/텍스트 코드포인트 상하한·공백/제어문자·배열 1~200·pageNo/expectedVersion 엄격 타입·경로 규칙·미정의 필드·깨진 JSON·비JSON/빈 본문 400/404 확인. 페이지네이션/내림차순/원문 없음 null·이력·과거 버전 불변·동일 내용 무쓰기·409 최신 번호·동시 저장 정확히 201 하나/409 하나 통과 |
| DB/감사 실패 | 실제 MySQL 트랜잭션에서 감사 쓰기 예외를 주입해 생성·저장 전체 롤백/503 확인. 읽기 DAO를 실제 연결 거부 대상 JDBC에 연결해 안전한 SERVICE_UNAVAILABLE 503 확인. 운영 DB를 중지하지 않음 |
| V6~V9 | Flyway 각 버전 1회 적용, 재기동 시 검증 성공. 파일당 CREATE TABLE DDL 하나, 실제 InnoDB/utf8mb4·ascii_bin 감사 event·PK 유일성·모든 FK·seq/pageNo CHECK·감사 actor NOT NULL 통과. socketTimeout=3000ms 유지 상태에서 적용 성공 |
| 테스트 데이터 정리 | 테스트 전용 서버 측 fixture.UUID 주소로 공유 127.0.0.1 제한 키를 사용하지 않음. 생성 계정 ID로 회차/블록/버전/도메인 감사/토큰을 정확히 정리하고 ID/IP 제한 키 삭제. 테스트 인증 감사는 GeneratedKeyHolder로 발급 ID만 추적해 익명 실패 감사까지 삭제. 사용자 데이터나 기존 행의 추정 삭제 없음 |
| 비밀값·범위 검사 | 성공 두 실행의 로그/XML과 최초 실행 로그에서 DB 비밀번호·전체 JDBC URL·Bearer 토큰/root 비밀번호/비밀키 패턴 0건. 운영 JAR에 TrackingAuthDao/FixtureAddress/IntegrationTest/OperatorFixture 0개. V1~V5·기존 인증 Service/DAO/Controller·CORS·frontend·승인 문서 내용 diff 0 |

읽기 전용 앱 계정 조회(`MYSQL_PWD` 환경, stdin → `docker compose exec -T mysql sh -s`)의 실행 전/성공 1회차 후/2회차 후 결과입니다. 기존 인증 테이블은 정렬한 전체 행 집계 SHA-256도 동일합니다. group_concat_max_len=1048576은 조회 세션에만 설정했습니다. 비밀번호·토큰·원문·개별 해시는 기록하지 않습니다.

| 테이블 | 실행 전 | 성공 1회 후 | 성공 2회 후 |
|---|---:|---:|---:|
| auth_login_limit | 88 | 88 | 88 |
| demo_account (네 demo.* 계정) | 4 | 4 | 4 |
| auth_token | 8 | 8 | 8 |
| auth_audit | 130 | 130 | 130 |
| episode | 미존재 | 0 | 0 |
| episode_source_version | 미존재 | 0 | 0 |
| source_block | 미존재 | 0 | 0 |
| domain_audit | 미존재 | 0 | 0 |

남은 미검증: EpisodeSource 프런트 구현 후의 실제 브라우저 전체 흐름(생성·저장·수정·과거 버전·새로고침·충돌·비운영자 403). 이는 Claude Code의 프런트 통합 후 Codex가 실행합니다. 외부 배포/Vercel·프록시 IP 정책도 계속 미검증입니다. PROJECT_CONTEXT.md의 기존 줄바꿈 M은 수정·stage·restore하지 않았습니다. push·이력 재작성·기존 컨테이너/볼륨 삭제는 수행하지 않았습니다.

### EpisodeSource 실제 연동 검증 준비 기록 (2026-10-06 KST)

대상은 frontend `81cc7bb`, backend `1464e8d`, 승인 계약 `582b5d0`입니다. Codex가 직접 실행한 준비 검증만 기록합니다. 시작 HEAD는 `81cc7bb5d00585c8341aead66a7f616a076ea972`이며 PROJECT_CONTEXT.md의 기존 줄바꿈 M 외 변경은 없었습니다. 아래 기록은 실제 연동 완료를 의미하지 않습니다.

| 실행 명령·검사 | 결과 |
|---|---|
| `docker info`, 이미지 inspect | 통과. Docker Server 29.5.3, Linux. mysql:8.4.11의 digest는 `mysql@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242` |
| `docker run -d --rm --name mangabridge-episode-live-81cc7bb --publish 127.0.0.1:3308:3306 --tmpfs /var/lib/mysql:rw --env MYSQL_DATABASE --env MYSQL_USER --env MYSQL_PASSWORD --env MYSQL_RANDOM_ROOT_PASSWORD mysql:8.4.11 --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci --default-time-zone=+00:00` | 통과. 프로세스 환경으로 자격증명을 전달했고 값은 인자·기록에 넣지 않음. inspect에서 AutoRemove=true와 tmpfs 확인 |
| 격리 MySQL 앱 계정의 stdin 스크립트 `SELECT 1` 및 서버 설정 조회 | 통과, 종료 0, 07:06:55 KST. 실제 8.4.11, utf8mb4, utf8mb4_0900_ai_ci, +00:00 확인. 아직 시드·Flyway·API 기동 검증은 아님 |
| 추적 frontend 파일의 ignored 격리 사본에서 `npm run build` | 실패. node_modules junction이 Turbopack의 파일시스템 루트 밖을 가리키는 준비 환경 오류. 원본 frontend나 코드를 수정하지 않음 |
| 같은 사본에서 Windows PowerShell 5.1로 `NEXT_PUBLIC_API_BASE_URL=http://localhost:8085` 주입 후 `npm run build -- --webpack` | 통과, 종료 0. PowerShell 5.1.26100.9444, 07:09:52 KST. 원본 frontend/.next는 변경하지 않음 |
| README 7절 Read-Host 시드·Spring 기동, 프런트 기동 | 미실행. 사용자가 네 비밀번호를 나중에 직접 입력할 수 있다고 회신하여 입력 대기. 검증용 API 8085와 프런트 3004를 사용할 스크립트만 준비 |
| 실제 브라우저 시나리오 1~10 및 비운영자 UI/서버 403·ACCESS_DENIED 조회 | 전부 미검증. 로그인·원문 저장·충돌·실제 preflight·401·장애 복구를 아직 실행하지 않았으며 이전 백엔드 테스트 결과로 대체하지 않음 |
| 이번 임시 컨테이너 ID를 대조한 뒤 `docker stop --time 10 <이번 컨테이너 ID>` | 통과, 종료 0. --rm 컨테이너는 자동 정리됨. 이번에 띄운 API·프런트 서버는 없으며 기존 컨테이너·볼륨·서버는 보존 |
| 개발 DB 읽기 전용 집계, stdin → `docker compose exec -T mysql sh -s` | 준비 전후 차이 0. auth_login_limit 88, demo_account 4, auth_token 8, auth_audit 130, 도메인 네 테이블 각각 0 유지. 인증 네 테이블의 전체 행 정렬 집계 해시도 동일 |

기존 3000/3306/8080/8081/8084 리스너 PID는 유지됐습니다. frontend·backend/src·승인 문서의 내용은 기준 커밋과 동일하며 PROJECT_CONTEXT.md는 수정·stage·restore하지 않았습니다. 비밀번호 입력이 가능해지면 격리 DB를 다시 생성하고 README 7절 시드부터 재개해야 합니다. 코드 결함 판단은 실제 시나리오 실행 전까지 보류하며, 외부 배포/Vercel·프록시 IP 정책은 계속 미검증입니다.

### EpisodeSource 실제 연동 재개 결과 (2026-10-06 07:54~08:08 KST)

검증 기준은 frontend `81cc7bb`, backend `1464e8d`, 승인 계약 `582b5d0`입니다. 재개 HEAD `c9ef909`는 위 준비 기록만 추가한 문서 커밋입니다. 코드는 변경하지 않았습니다. 사용자는 네 비밀번호 입력과 역할별 로그인만 직접 수행했고, 아래 화면·저장·새로고침·로그아웃 확인은 Codex가 앱 내 브라우저에서 직접 수행했습니다. 앞선 Claude Code 보고나 백엔드 테스트를 이번 실제 브라우저 결과로 합산하지 않습니다.

격리 MySQL은 위와 같은 mysql:8.4.11 digest, --rm/tmpfs, localhost:3308의 episode_verify입니다. README 2절 환경 주입과 7절 Read-Host/시드 명령을 포함한 PowerShell 5.1 스크립트를 실행했습니다. DB_URL/PORT/CORS만 격리 DB·8085·http://localhost:3004로 지정했습니다. 비밀번호는 사용자 입력 후 프로세스 환경에서 지웠으며 값은 기록하지 않았습니다. seed 종료 0, PowerShell 5.1.26100.9444, 07:54:56 KST. `gradlew.bat bootRun --no-daemon`으로 기동한 API의 `GET /api/health`는 실제 200/UP/db UP입니다. 앱 계정의 읽기 전용 조회에서 Flyway V1~V9 각 success=1, 역할별 계정 각 1개를 확인했습니다. 격리 프런트 사본은 `npm run start -- --port 3004`로 실행했습니다.

| 요청 시나리오 | 직접 실행 결과 |
|---|---|
| 1. 운영자 로그인 → /demo → 회차 관리 링크 | 통과. 사용자 OPERATOR 로그인 후 Codex가 사용자·역할 표시와 링크 이동 확인 |
| 2. 공백 포함 제목 생성·원문 없음·빈 블록 1개 | 통과. 검증 회차 id=2, 제목 `  Codex 실제 연동 2026-10-06  `. 상세의 원문 없음과 빈 블록 1개 확인. DB에서 제목 길이 26 및 앞뒤 두 공백 보존 확인 |
| 3. 세 블록, 일부 페이지 없음, v1 | 통과. 페이지 1/null/3, v1 저장 안내·이력 1건·블록 수 3 확인 |
| 4. 수정 후 v2·과거 v1 불변 | 통과. 두 번째 블록 수정 후 v2·이력 2건. v1 보기의 원문은 이전 내용 유지 |
| 5. 동일 내용 저장 | 통과. 변경 사항이 없어 새 버전을 만들지 않았다는 안내, 최신 v2·이력 2건 유지 |
| 6. 상세·목록 새로고침 | 통과. 인증·최신 v2 원문·이력·목록 회차 유지 |
| 7. 같은 토큰 직접 PUT 후 화면 저장 409·초안·최신 불러오기 | 미검증. Windows 브라우저 제어의 창 소유자 오류가 재시도에도 발생했고, 앱 내 브라우저 도구는 콘솔 실행 기능을 제공하지 않음. 다른 방식의 DB 수정이나 이전 모킹 테스트로 대체하지 않음 |
| 8. 실제 브라우저 PUT preflight 네트워크 기록 | 미검증. 앱 내 브라우저 도구에 네트워크 기록 조회 기능 없음. 실제 화면 PUT 저장은 성공했으나 요구한 OPTIONS/Authorization 전달 기록은 확보하지 못함 |
| 9. 토큰 폐기 후 새로고침 401 | 통과. 격리 DB의 유효 운영자 토큰 1개만 revoked_at 설정 후 /episodes/2 새로고침. /login 이동 및 인증 만료/유효하지 않음 안내 확인. 토큰 값 출력 없음 |
| 10. 서버 중지 저장·초안 유지·복구 후 저장 | 통과. 이번 8085 Java PID만 대조 후 Stop-Process. 저장 통신 오류 및 입력 초안 유지. 같은 PS5.1 환경의 bootRun으로 복구, health 200 후 재저장 v3 성공 |
| 비운영자 세 역할의 직접 경로 안내·로그인 유지 | 통과한 부분: TRANSLATOR/REVIEWER/READER 각각 /episodes와 /episodes/2에 운영자 전용 안내, /demo 복귀 후 동일 역할 인증 유지. 회차 API 요청 미발생의 네트워크 기록은 미검증 |
| 비운영자 /demo 메뉴 비활성 표시 | 실패(프런트 계약 차이). 세 역할 모두 회차 관리 링크는 없지만, 비활성 회차·원문 관리 항목도 없음. 계약 13.8은 다른 역할에 비활성 유지 요구. 각 계정으로 /demo 로그인하면 재현. 코드 미수정, Claude Code 확인 필요 |
| 비운영자 콘솔 GET/POST/PUT 403·브라우저 응답 읽기·감사 | 미검증. 콘솔 실행 도구 없음. 읽기 전용 조회의 ACCESS_DENIED는 0이며 이를 서버 권한 통과로 해석하지 않음 |

보조 CORS 검사(브라우저 기록과 구분): PowerShell의 `Invoke-WebRequest -Method Options`로 /api/episodes/2/source에 Origin=http://localhost:3004, Access-Control-Request-Method=PUT, Access-Control-Request-Headers=authorization,content-type을 전달했습니다. 응답 200, Allow-Origin 정확히 http://localhost:3004, Allow-Methods에 PUT, Allow-Headers에 authorization/content-type, Allow-Credentials 없음. 이는 시나리오 8의 브라우저 기록 검증을 대체하지 않습니다.

격리 DB 최종 읽기 전용 집계: 회차 id=1은 사용자가 로그인 후 직접 만든 회차(v1), id=2는 Codex 검증 회차(v3)입니다. EPISODE_CREATED=2, SOURCE_SAVED=4. 개발 DB(3306)에는 검증 회차를 생성하지 않았습니다. 개발 DB 검증 전후 auth_login_limit=88, demo_account=4, auth_token=8, auth_audit=130, episode/episode_source_version/source_block/domain_audit 각각 0으로 동일하며 인증 네 테이블의 전체 행 정렬 집계 해시도 동일했습니다.

정리: 마지막 독자 로그아웃 확인 후 이번 브라우저 탭을 닫았습니다. 검증용 8085/3004 PID와 스크립트 소유 런처만 종료하고 컨테이너 ID 대조 후 `docker stop --time 10 <이번 ID>` 실행(--rm 자동 정리). 기존 3000/3306/8080/8081/8084 PID 유지 및 기존 MySQL healthy 확인. 원본 frontend/.next·코드·승인 문서 내용 변경 없음. 수집한 API/프런트 로그·시드 결과의 Bearer/비밀번호 대입/root 비밀번호 패턴 0건, 실제 .env 추적 0개. 입력한 비밀번호 값을 보관하지 않았으므로 값 자체의 전체 로그 대조 검사는 미실행입니다. PROJECT_CONTEXT.md의 기존 M은 그대로 보존했습니다.

전체 실제 연동 완료는 아직 미충족입니다. 시나리오 7·8, 비운영자 서버 403/네트워크 증빙을 실제 브라우저 DevTools 사용 가능 환경에서 재검증하고, 비활성 메뉴 차이를 Claude Code에 전달해야 합니다. 외부 배포/Vercel·프록시 IP 정책도 미검증입니다. 코드 수정·push·이력 재작성·기존 컨테이너/볼륨 삭제는 하지 않았습니다.

## 9. 전체 도메인 스키마 V10~V19 검증 (2026-10-06 KST)

승인 기준은 CONTRACTS.md 14절, DECISIONS.md D-031~D-038, 시작 HEAD `0e1bd92e048e4a2fdf2cc6aaefd5e4fbfc1d2095`입니다. Codex가 직접 실행했습니다. 마이그레이션 커밋 `e9610cf`, 실제 MySQL 테스트 커밋 `22925d6`. 변경은 신규 SQL 10개, 신규 테스트 2개, 기존 스키마 기대값 테스트 2개, 이 검증 기록뿐입니다. 운영 Java·API·서비스·frontend·승인 문서·V1~V9는 변경하지 않았습니다. 서비스가 강제할 상태 전이·원문 변경 시 무효화는 이번에 구현하지 않았습니다.

### 실행 환경과 명령

Windows PowerShell 5.1.26100.9444, Java 17/기존 Gradle Wrapper, Docker Server 29.5.3 Linux, 실제 MySQL 8.4.11. 검증용 DB는 `mangabridge-schema-0e1bd92`의 localhost:3310/schema_verify(--rm, /var/lib/mysql tmpfs)입니다. 별도 빈 DB·V9 데이터 업그레이드 테스트는 테스트마다 무작위 localhost 포트의 --rm/tmpfs MySQL을 생성하고 해당 컨테이너 ID만 종료합니다. Docker 이미지 mysql:8.4.11은 기존 로컬 이미지이며 --pull=never를 사용했습니다. 기존 컨테이너·볼륨은 삭제하지 않았습니다.

환경은 README 2절처럼 .env.example에서 프로세스에 주입하고, 전체 테스트에는 DB_URL=jdbc:mysql://localhost:3310/schema_verify, AUTH_CLIENT_IP_MODE=DIRECT를 지정했습니다. 비밀번호 값은 인자·출력에 넣지 않았습니다. 네 역할의 demo.* 기준 행은 격리 DB에만 삽입한 로그인용이 아닌 테스트 데이터입니다. 사용자 데모 계정이나 비밀번호를 재시드하지 않았습니다.

| 실제 실행 명령·검사 | 결과 |
|---|---|
| `gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon` (격리 3310) | 통과, 종료 0, 9초. 빈 DB V1~V19 적용, current=19, validate=PASS. socketTimeout=3000ms 유지 |
| 초기 전체 명령 시도 | 미완료, PS5.1의 ErrorActionPreference=Stop이 기존 javac unchecked 경고를 NativeCommandError로 처리해 중단. 네이티브 명령 구간만 Continue로 실행하고 즉시 LASTEXITCODE 보존하도록 검증 스크립트 수정 |
| 그다음 `gradlew.bat build integrationTest --no-daemon --rerun-tasks` | 실패, 종료 1, 1분 8초. 테스트 4개 실패: FK 케이스에 PK 중복이 먼저 발생한 1개, Docker inspect 포트 템플릿 인자 오류 2개, V19 감사 컬럼을 반영하지 않은 기존 기대값 1개. 테스트만 수정. 실행 후 기준 행·집계 차이 0 |
| 같은 전체 명령, 수정 후 성공 1회차 | 통과, 종료 0, 1분 3초. 기본 20 + 실제 MySQL 통합 34 = 54개, 실패/오류/건너뛰기 0 |
| 같은 전체 명령, 코드 변경 없이 연속 성공 2회차 | 통과, 종료 0, 1분 5초. 같은 54개, 실패/오류/건너뛰기 0 |
| 빈 DB 마이그레이션 테스트 | 통과. 실제 일회용 MySQL에 19개 적용, validate, 재실행 0개, 다시 validate. 기존 테이블 비어 있음 확인 |
| 데이터 있는 V9 업그레이드 테스트 | 통과. 별도 일회용 DB에 V1~V9 적용 후 계정 4·토큰 1·제한 1·인증 감사 1·회차 1·원문 버전 1·블록 2·도메인 감사 1 삽입. V10~V19 적용 후 모든 기존 컬럼의 정렬 내용 SHA-256·행 수·V1~V9 Flyway 체크섬 동일. 새 테이블 5개 비어 있음, 새 기본값 0/NULL, 기존 domain_audit 행 보존. validate·재실행 0개 확인 |
| 배정·번역 버전 제약 | 통과. 역할 불일치 FK·역할 중복 PK·배정 계정 role 변경 거부. 둘째 DRAFT/REVIEW_PENDING 거부(기존 열린 상태 각각 확인), REJECTED/INVALIDATED 다수·나머지 승인된 상태 정상 허용. 원문 참조 FK·상태 값/대소문자 CHECK·버전 0/중복 거부 |
| 번역 블록·감수 결정 제약 | 통과. 원문에 없는 seq·다른 원문 버전/회차 복합 FK 거부, 빈/NULL/4001자 body 거부 및 1/4000자 허용. 결정 두 번째 거부, 반려 reason NULL/빈 값/501자 거부 및 1/500자 허용. 승인 reason·반려 invalidated_at·결정 대소문자 CHECK 거부, 승인 reason NULL/invalidated_at 정상 허용 |
| 발행·메타데이터 | 통과. 다른 회차 버전 publication/공개 포인터 및 없는 원문 FK 거부, 같은 버전 반복 발행 이력·NULL 포인터 허용. 새 테이블 InnoDB/utf8mb4, 열거 ascii_bin, DATETIME(6), 명시 RESTRICT, 감사 nullable 컬럼 확인 |

제약 테스트는 JDBC 한 트랜잭션에서 고유 테스트 계정·회차·원문·번역·감수·발행 행을 만들고 @AfterEach에서 rollback합니다. 실제 MySQL 오류 코드(1062 UNIQUE, 1452/1451 FK, 3819 CHECK, 1048 NOT NULL, 1406 길이)를 확인하여 다른 원인으로 실패한 것을 통과 처리하지 않습니다. 기존 HTTP 테스트는 기존의 서버 측 고유 fixture 주소와 정확한 생성 행 정리를 유지합니다. auth_login_limit 공유 키나 기존 계정·토큰은 삭제하지 않습니다. 롤백에 따라 AUTO_INCREMENT 번호에 공백이 생길 수 있지만 기존 행 내용은 변경하지 않습니다.

| 기존 테이블 | 격리 전체 테스트 전/1회 후/2회 후 | 개발 DB 적용 전/후 |
|---|---|---|
| demo_account | 4 / 4 / 4 | 4 / 4 |
| auth_login_limit | 0 / 0 / 0 | 88 / 88 |
| auth_token | 0 / 0 / 0 | 8 / 8 |
| auth_audit | 0 / 0 / 0 | 130 / 130 |
| episode / episode_source_version / source_block / domain_audit | 각각 0 / 0 / 0 | 각각 0 / 0 |

조회는 앱 계정의 MYSQL_PWD 환경과 stdin → `docker exec -i <이번 컨테이너> sh -s` 또는 `docker compose exec -T mysql sh -s`로 수행했습니다. 인증 네 테이블의 전체 행 정렬 집계 해시도 전후 동일합니다. 첫 격리 기준 행 삽입은 CRLF로 heredoc 종료 구분자 오류가 발생했으나 INSERT 4행은 수행됐습니다. 중복 삽입 없이 조회로 확인하고 기존 한 줄 stdin 방식으로 기준 집계를 저장한 뒤 테스트를 실행했습니다.

### 개발 DB 적용 (모든 격리 검증 통과 후 사용자 승인에 따라 마지막 실행)

README 2절의 기존 DB 환경을 주입하고 URL이 localhost/127.0.0.1:3306인지 검사한 뒤 위 schemaMigrate 명령을 실행했습니다. 10:11:36 KST에 V10~V19 10개 적용, 종료 0, current=19, validate=PASS(9초). 10:12:34 재실행은 0개 적용, 종료 0, validate=PASS(9초). 개발 DB에는 제약 테스트나 새 테스트 행 삽입을 실행하지 않았습니다. 적용 직전/직후/재실행 후 기존 행 집계 차이 0, V1~V9 Flyway 체크섬 차이 0, 신규 다섯 테이블 각각 0행입니다.

schemaMigrate는 운영 클래스가 아닌 `DomainSchemaMigrationIntegrationTest.main`을 테스트 classpath에서 실행하는 로컬 검증 작업입니다. 기존 build.gradle은 수정하지 않았으며 ignored build/verification/schema-tool.init.gradle의 내용은 아래와 같습니다. 실행 시 PS5.1의 네이티브 stderr 경고에서 중단되지 않도록 해당 명령 구간에만 ErrorActionPreference=Continue를 사용하고, 네이티브 명령 직후 LASTEXITCODE를 보존했습니다.

```groovy
allprojects {
    afterEvaluate {
        tasks.register('schemaMigrate', JavaExec) {
            dependsOn tasks.named('testClasses')
            classpath = sourceSets.test.runtimeClasspath
            mainClass = 'com.mangabridge.bootstrap.DomainSchemaMigrationIntegrationTest'
        }
    }
}
```

검증 후 이번 3310 컨테이너 ID를 대조해 docker stop(--rm 자동 정리)했고 테스트마다 만든 컨테이너도 정리됐습니다. 기존 MySQL healthy 및 3000/8080/8081 리스너 PID 유지 확인. 운영 JAR에 신규 테스트/검증 runner 클래스 0개. V1~V9 파일 해시 차이 0, 운영 Java/frontend/승인 문서 내용 diff 0. 수집한 Gradle 로그·JUnit XML의 실제 DB 비밀번호 일치와 Bearer/root 비밀번호 패턴 0건. PROJECT_CONTEXT.md의 기존 줄바꿈 M은 수정·stage·restore하지 않았고 push·이력 재작성은 하지 않았습니다.

이번 14.6 마이그레이션 노드의 미검증·미적용 항목은 없습니다. 기존 Flyway가 MySQL 8.4 지원 업그레이드를 권고하는 경고는 남지만 실제 8.4.11 적용·제약·validate 검증은 통과했습니다. 의존성을 변경하지 않았습니다. API·배정·번역·감수·발행·독자 서비스는 다음 승인 계약의 범위입니다. 이전 EpisodeSource 브라우저 미검증 항목은 이번 스키마 검증으로 대체하지 않습니다.

### V20~V25 보정 적용 차단 기록 (2026-10-06 10:31 KST)

시작 HEAD `ca4b69ca57abff6bf8d78a08e2ce4305eda730b4`, CONTRACTS.md 14.2/14.6 및 D-039 기준입니다. 시작 상태는 PROJECT_CONTEXT.md의 기존 M뿐이었습니다. Codex가 승인된 컬럼 정의 그대로 V20~V25 초안을 작성하고, 테스트 수정 전에 일회용 MySQL 8.4.11(--rm/tmpfs, localhost:3310/schema_verify)에서 문법·적용 가능 여부를 직접 확인했습니다.

PowerShell 5.1.26100.9444에서 `gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon` 실행: **실패**, 종료 1, 11초. V1~V23 성공 후 V24__review_required_columns.sql에서 MySQL SQLSTATE HY000 / 오류 1832: `Cannot change column 'reviewer_id': used in a foreign key constraint 'fk_review_reviewer'`. 읽기 전용 Flyway 이력 확인 결과 V20~V23 success=1, V24 success=0, V25 이력 없음입니다. FK 제거·검사 비활성화·알고리즘 변경 등 우회를 실행하지 않고 계약 지시에 따라 중단했습니다.

NULL 거부·정상 값·V19 업그레이드·최종 validate·전체 빌드/integrationTest 연속 2회는 **미실행/미검증**입니다. 컴파일 작업은 수행됐지만 전체 빌드 통과로 기록하지 않습니다. V1~V19 파일 해시 차이 0, 운영 Java·기존 테스트·frontend·승인 문서 내용 diff 0. V20~V25 파일은 실패 원인을 검토할 미커밋 초안으로 남겼으며, 적용 완료 마이그레이션 커밋을 만들지 않았습니다.

개발 DB(3306)는 이번 작업에서 변경하지 않았고 V20~V25 **미적용**입니다. 현시점 읽기 전용 조회: Flyway 최대 버전 19/성공 19개, 계정 4·토큰 8·제한 88·인증 감사 130, 회차·원문 버전·블록·도메인 감사 각각 0. 이번 시도는 개발 DB의 적용 전후 비교 단계에 도달하지 않았습니다. 이번 임시 컨테이너만 저장한 ID와 대조 후 docker stop(--rm 자동 정리)했고 기존 컨테이너·볼륨은 보존했습니다. PROJECT_CONTEXT.md는 수정·stage·restore하지 않았습니다.

승인 필요한 제안: V24에서 fk_review_reviewer를 제거하고 NOT NULL 보정 후 기존 이름·참조·RESTRICT 정의로 다시 생성하는 절차를 계약에 명시합니다. 한 ALTER TABLE 안에서 가능한지는 별도 일회용 DB 검증이 필요하며, 불가능하면 파일당 DDL 하나 원칙에 맞게 추가 버전/적용 순서 변경 승인이 필요합니다. V25에서도 유사 제한이 발생하는지 현재는 미검증입니다. 제안은 승인된 결정으로 기록하지 않았으며 승인 전 추가 구현·개발 DB 적용을 진행하지 않습니다.

### V20~V25 승인 보정 재개 검증 (2026-10-06 11:10~11:19 KST, Codex 직접 실행)

시작 기준 `797d54598d90fed1c7a9d63417eee4c51b4727a3`, CONTRACTS.md 14.2/14.6 및 D-039를 확인했습니다. 시작 상태는 PROJECT_CONTEXT.md의 기존 줄바꿈 M과 이전 V20~V25 미커밋 SQL 6개뿐이었습니다. V20~V23은 초안 그대로 유지하고, V24/V25는 승인된 `SET foreign_key_checks=0; ALTER TABLE ...; SET foreign_key_checks=1;` 구조로 적용했습니다. 각 파일의 DDL은 ALTER 하나이며 FK 삭제·재생성은 수행하지 않았습니다. 위 차단 기록은 과거 실행 결과이며 아래는 변경 승인 후 새로 수행한 결과입니다.

마이그레이션 커밋 `3064624`, 테스트 커밋 `c09b326`. 운영 Java/API·frontend·승인 문서·V1~V19는 변경하지 않았습니다. V1~V19 파일 SHA-256 차이 0입니다.

실행 환경: Windows PowerShell **5.1.26100.9444**, Docker 29.5.3 Linux, 실제 **MySQL 8.4.11**. 이번 소유 컨테이너 localhost:3310/schema_verify와 테스트별 일회용 --rm/tmpfs DB를 사용했습니다. 비밀번호는 프로세스 환경과 stdin으로 전달하고 값은 기록하지 않았습니다. README 2절의 환경 주입 후 검증용 DB_URL만 변경했으며, schemaMigrate 작업은 위에 기록한 test classpath 전용 init script를 사용했습니다. 네이티브 명령 직후 LASTEXITCODE를 보존했습니다.

| 실제 실행 명령 / 검증 | 결과 |
|---|---|
| `gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon` (빈 격리 DB) | 통과, 종료 0, 16초. V1~V25 25개 적용, current=25, validate=PASS |
| 최초 `gradlew.bat build integrationTest --no-daemon --rerun-tasks` | 실패, 종료 1, 1분 30초. CHECK 정의 비교 1건: ALTER가 같은 ASCII 열거 리터럴의 introducer를 _utf8mb4에서 _ascii로 바꿈. ASCII 문자열임을 먼저 검사하고 이 introducer만 정규화하는 테스트 수정. SQL은 변경하지 않음 |
| 같은 전체 명령, 수정 후 연속 성공 1회차 | 통과, 종료 0, 1분 30초. 기본 20 + 실제 MySQL 통합 38 = 58개, 실패·오류·건너뛰기 0 |
| 같은 전체 명령, 코드 변경 없이 연속 성공 2회차 | 통과, 종료 0, 1분 30초. 같은 58개, 실패·오류·건너뛰기 0 |
| 빈 DB V1~V25 / 데이터 있는 V19→V25 / 기존 V9→V25 | 통과. 각 별도 일회용 DB에서 적용·validate·재실행 추가 0개. 기존 행 수·모든 기존 컬럼의 정렬 내용 해시·기존 Flyway 체크섬 유지 |
| V24/V25 직후 FK 검사 복구 | 통과. Flyway AFTER_EACH_MIGRATE callback이 **실제 마이그레이션 연결**에서 @@foreign_key_checks=1을 각각 확인 |
| FK·UNIQUE·CHECK·생성 컬럼 보존 | 통과. V19 전후 FK 이름·개수·참조·RESTRICT 규칙, UNIQUE 인덱스·컬럼 순서, CHECK 이름·조건식, open_slot 생성식 비교. CHECK/생성식 ASCII 리터럴 introducer 외 SQL 내용은 그대로 비교 |
| NULL 거부·정상 삽입·기존 제약 | 통과. 보정 필수 컬럼을 포함한 26개 명시 컬럼 각각 NULL 삽입 시 MySQL 1048 확인, 정상 삽입 허용. 역사적 NULL 우회 5종 모두 거부. assigned_at 정상 삽입, 기존 제약 테스트 전부 유지 |
| information_schema | 통과. 새 도메인 5개 테이블 NOT NULL 29개, nullable submitted_at/reason/invalidated_at 및 생성 open_slot만 유지. 기존 episode 공개 포인터와 domain_audit 번역 ID는 nullable 유지. 열거 ascii_bin, assigned_at DATETIME(6), FK 총 19개(새 도메인 5개 테이블 12개)의 기존 규칙 유지. 새 도메인 FK 12개와 episode 공개 포인터 FK는 RESTRICT이며 기존 V1~V9 FK의 NO ACTION도 변경 없음 |

| 기존 데이터 | 격리 전체 테스트 전 / 1회 후 / 2회 후 | 개발 DB 검증 전 / 격리 테스트 후 |
|---|---|---|
| demo_account (demo.* 4계정 유지) | 4 / 4 / 4 | 4 / 4 |
| auth_token | 0 / 0 / 0 | 8 / 8 |
| auth_login_limit | 0 / 0 / 0 | 88 / 88 |
| auth_audit | 0 / 0 / 0 | 130 / 130 |
| episode / episode_source_version / source_block / domain_audit | 각각 0 / 0 / 0 | 각각 0 / 0 |
| episode_assignment / translation_version / translation_block / review_decision / publication | 각각 0 / 0 / 0 | 각각 0 / 0 |

기존 인증 네 테이블의 정렬 집계 해시도 동일합니다. 새 제약 fixture는 전용 JDBC 트랜잭션을 rollback하며, 기존 HTTP 테스트의 서버 측 고유 주소·정확한 생성 행 정리를 유지했습니다. 공유 127.0.0.1 제한 키를 정리하지 않았습니다. 업그레이드 fixture는 일회용 DB에만 계정 4·토큰 1·제한 1·인증 감사 1·회차 1·원문 버전 1·블록 2·도메인 감사 1을 삽입하고 기존 컬럼 내용을 비교했습니다. AUTO_INCREMENT 번호의 공백은 생길 수 있습니다.

검증 로그·JUnit XML의 실제 DB 비밀번호 일치 0건, Bearer/root 비밀번호 출력 패턴 0건. 운영 JAR의 검증 runner/신규 통합 테스트 클래스 0개. 기존 Flyway의 MySQL 8.4 지원 업그레이드 권고 경고는 남지만 실제 적용·validate·제약 테스트는 통과했습니다. 의존성은 변경하지 않았습니다.

11:21 기록 시점에는 개발 DB 적용 확인 답변 대기였으며 V20~V25 미적용(V19 유지), 개발 DB 적용·재실행·적용 후 NOT NULL/FK 조회는 미실행이었습니다. 이후 사용자 승인에 따른 결과는 아래에 기록합니다. 11:21 KST에 이번 3310 tmpfs 컨테이너만 저장한 ID와 대조 후 docker stop(--rm 자동 정리)했습니다. 테스트별 일회용 컨테이너도 각 테스트에서 종료했으며 기존 컨테이너·볼륨은 보존했습니다. PROJECT_CONTEXT.md의 기존 줄바꿈 M은 수정·stage·restore하지 않았습니다.
### V20~V25 개발 DB 적용 완료 (2026-10-06 11:22~11:24 KST, Codex 직접 실행)

사용자의 별도 “개발 DB에 적용” 승인을 받은 뒤 마지막 단계로 localhost:3306/mangabridge에 적용했습니다. 적용 직전 기존 데이터·메타데이터를 다시 조회했고 격리 검증 시작 전 기준과 차이 0을 확인했습니다. PowerShell 5.1.26100.9444에서 README 2절 환경 주입 및 URL 3306 확인 후 다음 명령을 실행했습니다.

| 실제 명령 / 확인 | 결과 |
|---|---|
| `gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon` | 통과, 종료 0, 11초. V20~V25 6개 적용, current=25, validate=PASS |
| 같은 명령 재실행 | 통과, 종료 0, 10초. 추가 적용 0개, current=25, validate=PASS |
| Flyway 읽기 전용 조회 | 성공 이력 25개 / 최대 버전 25 / 실패 이력 0개. V1~V19 checksum 차이 0 |
| 기존 데이터 적용 전후 | 계정 4→4, 토큰 8→8, 제한 88→88, 인증 감사 130→130. demo.* 4개 유지, 기존 인증 전체 행 정렬 집계 해시 차이 0 |
| 기존/신규 도메인 행 | episode·원문 버전·블록·domain_audit 및 신규 도메인 5개 테이블 각각 0→0. 개발 DB에 테스트 fixture 삽입·정리 없음 |
| information_schema | 신규 도메인 NOT NULL 29개, nullable submitted_at/reason/invalidated_at/open_slot만 유지. 기존 두 포인터 nullable 유지. 전체 FK 19개 이름·참조·삭제/갱신 규칙 전후 차이 0, 새 도메인 12개 RESTRICT 유지 |
| FK 검사 | 조회 연결 @@foreign_key_checks=1, @@GLOBAL.foreign_key_checks=1. 각 V24/V25의 실제 Flyway 연결 복구는 위 일회용 DB callback 테스트에서 별도로 확인 |

마이그레이션·NULL 우회·기존 제약·데이터 보존·전체 회귀 연속 2회·개발 DB 적용의 요청 항목은 모두 실행했고 통과했습니다. 검증 전용 빈 DB와 V19/V9 업그레이드 DB 및 개발 DB3306에 V25까지 적용했습니다. 다른 기존 DB·서비스는 적용하거나 중단하지 않았습니다. 로그/XML의 실제 비밀번호 일치 및 Bearer/root 출력 패턴 0건을 적용 후 다시 확인했습니다. SQL 커밋 `3064624`, 테스트 커밋 `c09b326`, 격리 결과 문서 커밋 `9a8a7df`입니다. 남는 변경은 PROJECT_CONTEXT.md의 기존 줄바꿈 M뿐이며 수정·stage·restore하지 않았습니다. 기존 Flyway MySQL 8.4 권고 경고는 유지됩니다. 이 스키마 검증은 브라우저·외부 배포 검증 결과를 대신하지 않습니다.
## 10. Assignment 담당자 배정 API 실행·검증 (2026-10-06 KST)

승인 계약 CONTRACTS.md 15절 및 D-031/D-038/D-040/D-041, 시작 기준 `e25131740fc68848147abf4158245535ce672fc2`. 시작 git status는 PROJECT_CONTEXT.md의 기존 줄바꿈 M뿐이었습니다. Codex가 backend만 구현했고 frontend와 승인 문서 3종은 변경하지 않았습니다. SQL 커밋 `9dba89d`, 백엔드 구현 `83cc243`, 테스트 `27b05fc`입니다.

README 2절의 PowerShell 환경 주입·Spring 실행, 7절의 기존 데모 계정 시드 방법을 그대로 사용합니다. 새 환경변수·의존성·Compose 변경은 없습니다. V26은 `ALTER TABLE domain_audit ADD COLUMN subject_account_id BIGINT NULL` 하나이며 FK를 추가하지 않습니다. Spring 실행 시 Flyway가 적용하므로, 개발 DB 적용 전에는 이번 검증처럼 격리 DB_URL을 사용해야 합니다. 이번 개발 DB 적용은 모든 격리 검증 통과 후 사용자에게 별도로 확인받았습니다.

| API | 허용 역할 / 동작 |
|---|---|
| `GET /api/assignable-accounts?role=TRANSLATOR` 또는 `REVIEWER` | OPERATOR. 활성 계정 id·displayName·role만, id 오름차순 |
| `GET /api/episodes/{id}/assignments` | OPERATOR. 번역가·감수자 현재 칸 또는 null |
| `PUT /api/episodes/{id}/assignments/translator` 또는 `reviewer` | OPERATOR. JSON accountId 문자열. 신규 201, 교체·동일 200 |
| `GET /api/my/episodes?limit=50&offset=0` | TRANSLATOR/REVIEWER. 본인 배정만, 회차 id 내림차순 |
| `GET /api/my/episodes/{id}` | TRANSLATOR/REVIEWER. 현재 본인 배정의 최신 원문만. 미배정·없는 회차 404 |

모든 응답은 기존 Bearer·no-store·오류 JSON 계약을 따릅니다. 역할 위반 403은 기존 ACCESS_DENIED 감사에 기록합니다. 서버 인증 사용자·역할로 배정을 매번 DB에서 확인하며 작성자·loginId·비밀번호 해시는 새 조회 응답에 없습니다. 교체만 제공하고 DELETE는 405입니다. 같은 계정 지정은 쓰기·감사 없이 기존 assignedAt을 반환합니다. 지정·교체는 episode FOR UPDATE → 대상 검사 → UPSERT → ASSIGNED(subject_account_id 포함)를 한 트랜잭션으로 수행합니다. 감사 실패는 전체 롤백/503입니다. CORS의 기존 PUT/Content-Type/Authorization 허용·credentials=false를 유지했습니다.

### Codex 직접 실행 결과 (12:19~12:30 KST)

실행 환경 Windows PowerShell **5.1.26100.9444**, Docker **29.5.3 Linux**, MySQL **8.4.11**. 이미지 digest `mysql@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242`. 주 검증 DB는 이번 소유 --rm/tmpfs 컨테이너 localhost:3310/assignment_verify였고, 마이그레이션 경로 테스트도 각각 별도 일회용 MySQL을 사용했습니다. 환경변수와 stdin으로 자격증명을 전달했으며 값을 출력하지 않았습니다. 격리 기준 4계정은 로그인용 시드가 아닌 데이터 보존 fixture이고, HTTP 테스트는 고유 로그인 ID·무작위 비밀번호·BCrypt로 만든 테스트 계정을 실제 로그인시켜 실행했습니다.

| 실제 명령 / 검증 | 통과·실패·미검증 |
|---|---|
| `gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon` (빈 격리 DB) | 통과, 종료 0, 12초. V1~V26 26개 적용, validate=PASS |
| 최초 `gradlew.bat build integrationTest --no-daemon --rerun-tasks` | 실패, 종료 1, 1분 42초. 신규 배정 10개·마이그레이션 4개는 통과했으나 기존 EpisodeSource 감사 컬럼 기대 목록이 subject_account_id를 포함하지 않아 1건 실패. 해당 테스트 기대 컬럼만 갱신. 실행 후 데이터 차이 0 |
| 같은 전체 명령, 수정 후 연속 성공 1회 | 통과, 종료 0, 1분 45초. 기본 20 + 실제 MySQL 통합 49 = 69개, 실패·오류·건너뛰기 0 |
| 같은 전체 명령, 코드 변경 없이 연속 성공 2회 | 통과, 종료 0, 1분 53초. 같은 69개, 실패·오류·건너뛰기 0 |
| 후보·지정·조회 처리 함수 | 통과. 역할별 활성 후보·id 정렬·최소 필드·잘못된 role 400. 미배정 null, 신규 201·교체 200·동일 200/changed:false. 동일 요청은 실제 행·시각 유지 및 UPSERT/감사 호출 0 확인 |
| 대상 검사·DB 복합 FK | 통과. 역할 불일치·비활성·없는 계정은 동일 400 본문. 서비스를 우회한 역할 불일치 직접 INSERT는 실제 MySQL 1452로 거부 |
| 내 배정·최신 원문 | 통과. 본인 것만, 다른 담당자 제외, 정렬·페이지·큰 offset·입력 경계. source:null 및 최신 v2 본문·pageNo 일치, 작성자·내부 계정 필드 비노출. 미배정·없는 회차 404. 번역가/감수자 모두 교체 후 이전 담당자 즉시 404·새 담당자 200 |
| 4역할×5API 보안 | 통과. 각 API 무토큰 401, 허용 역할 200/201, 나머지 403 및 ACCESS_DENIED 실제 행 확인. X-Role/X-User-Id·본문 role 위조 거부, 입력 accountId 숫자·미정의 필드 400 |
| 동시 교체·감사 장애 | 통과. 같은 칸 두 교체 모두 200, 행 1개·감사 2개 추가·마지막 감사 대상=현재 담당자. 신규/교체 감사 장애 시 503 및 전체 롤백·이전 담당자 접근 유지 |
| 오류·프로토콜·CORS | 통과. 깨진 JSON·빈 본문·text/plain·form 요청 400, 잘못된 경로 404, DELETE 405. 실제 연결 불가 쿼리 503, 오류 본문에 내부 예외·비밀값 없음. PUT preflight의 허용 Origin·Authorization/Content-Type·credentials 미허용 확인. CORS 설정 변경 없음 |
| V26 기존 감사 보존 | 통과. 별도 V25 DB에 계정·토큰·제한·회차·원문·감사 fixture를 넣은 뒤 V26 1개 적용. 모든 기존 컬럼 정렬 내용 해시·행 수·V1~V25 Flyway checksum 동일. subject_account_id는 BIGINT nullable, 기존 감사 1행 NULL, FK 없음. validate·재실행 추가 0개 |
| 기존 회귀 | 통과. 기존 auth/health/episode/도메인 제약과 V19→V25 보정 검증 유지. 빈 DB 최신 버전 기대는 26으로 갱신 |

PS5.1 네이티브 명령 구간만 ErrorActionPreference=Continue로 기존 javac/VM 경고를 허용하고, 명령 직후 LASTEXITCODE를 보존해 판정했습니다. schemaMigrate는 9절에 기록한 test classpath 전용 init script와 runner를 사용합니다. 운영 JAR에는 AssignmentController가 포함되고 통합 테스트·fixture·runner 클래스는 0개입니다.

| 테이블 | 격리 테스트 전 / 1회 후 / 2회 후 | 개발 DB 적용 전 / 후 |
|---|---|---|
| demo_account / demo.* 계정 수 | 4 / 4 / 4 | 4 / 4 |
| auth_token | 0 / 0 / 0 | 8 / 8 |
| auth_login_limit | 0 / 0 / 0 | 88 / 88 |
| auth_audit | 0 / 0 / 0 | 130 / 130 |
| episode / episode_source_version / source_block / domain_audit | 각각 0 / 0 / 0 | 각각 0 / 0 |
| episode_assignment / translation_version / translation_block / review_decision / publication | 각각 0 / 0 / 0 | 각각 0 / 0 |

앱 계정의 읽기 전용 조회로 비교했고 기존 인증 전체 행 정렬 집계 해시도 동일합니다. 새 HTTP 테스트는 fixture.assignment.<고유값> 서버 측 주소를 사용합니다. 생성한 회차·배정·원문·감사·계정·토큰과 정확한 로그인 ID/IP 제한 해시만 정리하고 공유 127.0.0.1 키나 기존 행은 정리하지 않습니다. 마이그레이션 fixture는 일회용 DB에만 있습니다. AUTO_INCREMENT 번호 공백은 생길 수 있습니다.

### 개발 DB V26 적용 (사용자 별도 승인 후 마지막 단계)

PowerShell 5.1에서 기존 환경 주입과 localhost:3306 URL 검사를 거쳐 위 schemaMigrate 명령을 실행했습니다. 12:28:41 KST에 V26 **1개 적용**, 종료 0, 9초, current=26/validate=PASS. 12:29:04 같은 명령 재실행은 **0개 적용**, 종료 0, 9초, validate=PASS. 실제 Flyway 성공 이력 26개·실패 0개, 기존 V1~V25 checksum 차이 0, 기존 감사 컬럼은 유지되고 subject_account_id BIGINT NULL만 추가됐으며 해당 컬럼 FK 0개입니다. 개발 DB에 테스트 행은 삽입하지 않았습니다.

12:30 KST에 이번 3310 tmpfs 컨테이너만 저장한 ID를 대조 후 docker stop(--rm 자동 정리)했습니다. 테스트별 컨테이너도 각 테스트에서 종료됐습니다. 기존 MySQL healthy, 기존 컨테이너·볼륨·서버는 보존했습니다. 수집한 Gradle 로그·JUnit XML의 실제 DB 비밀번호 일치 및 Bearer/root 출력 패턴 0건, V1~V25 파일 SHA-256 차이 0입니다. PROJECT_CONTEXT.md의 기존 M은 수정·stage·restore하지 않았고 push·이력 재작성도 하지 않았습니다.

백엔드 구현·자동 테스트·격리/개발 DB 마이그레이션은 완료했습니다. **Assignment 프런트 구현과 실제 브라우저 연동은 미검증**이며 Claude Code의 같은 계약 구현 후 Codex가 격리 환경에서 15.7 시나리오를 수행합니다. 외부 배포·Vercel·프록시 IP 정책 검증도 이번 범위 밖입니다. 기존 Flyway의 MySQL 8.4 지원 업그레이드 권고 경고는 남으며 의존성을 변경하지 않았습니다.

### Assignment 최종 실제 브라우저 연동 검증 — Codex 직접 실행

검증 대상은 frontend/통합 HEAD `7bd23a76f4ded4328492e261166e48c01a302628`, 포함된 backend `e303509`, 승인 계약 15절 `e251317`입니다. 위 백엔드 구현 시점의 브라우저 미검증 기록을 이번 결과로 보완합니다. 브라우저 확인은 **2026-10-06 13:14~16:19 KST**, 정리·보존 비교는 **16:23 KST**에 수행했습니다. 시작 상태는 PROJECT_CONTEXT.md의 기존 줄바꿈 M뿐이었으며 해당 파일을 수정·stage·restore하지 않았습니다. 운영 코드·프런트 코드·계약은 변경하지 않았습니다.

격리 환경은 MySQL **8.4.11**, `mangabridge-assignment-browser-7bd23a7` (--rm, `/var/lib/mysql` tmpfs, localhost:3311/assignment_browser), Spring :8084, Next :3004였습니다. V1~V26 성공 이력 26개를 실제 DB에서 확인했습니다. `CORS_ALLOWED_ORIGINS=http://localhost:3004` 하나, `NEXT_PUBLIC_API_BASE_URL=http://localhost:8084`, local/DIRECT, 토큰 기본 TTL 3600초를 사용했습니다. 원본 frontend/.next 대신 HEAD의 격리 사본을 빌드했습니다. Windows PowerShell **5.1.26100.9444** 프로세스에서 임시 비밀번호를 생성하고 README 7절 방식으로 네 계정을 시드했습니다. 교체 검증용 `demo.translator2`는 격리 DB에만 기존 BCrypt 의존성으로 만든 해시를 INSERT했습니다. 비밀번호·해시·토큰 값은 실행 결과나 이 문서에 기록하지 않았습니다.

| 직접 실행한 명령 / 확인 | 결과 |
|---|---|
| `docker run -d --rm --pull=never --name mangabridge-assignment-browser-7bd23a7 --publish 127.0.0.1:3311:3306 --tmpfs /var/lib/mysql:rw --env MYSQL_USER --env MYSQL_PASSWORD --env MYSQL_DATABASE --env MYSQL_RANDOM_ROOT_PASSWORD mysql:8.4.11 --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci --default-time-zone=+00:00` | 통과. 환경변수로 전달, root 로그 조회 없음 |
| `gradlew.bat bootJar --no-daemon` | 통과, 종료 0 |
| `gradlew.bat bootRun --args='--demo-auth-seed=true --spring.main.web-application-type=none' --no-daemon` | 통과, 종료 0. PS5.1, 시드 후 비밀번호 환경변수 제거 |
| 격리 프런트 `npm.cmd run build -- --webpack`, 이어서 `node <Next CLI> start <격리 frontend 경로> -p 3004` | 빌드 통과, 종료 0; 실제 브라우저 접속 성공. 원본 .next 사용·덮어쓰기 없음 |
| `java -jar backend/build/libs/mangabridge-backend-0.0.1-SNAPSHOT.jar` (PS5.1 환경 주입 후 별도 프로세스) | 실제 Spring/MySQL 헬스 200 및 브라우저 연동 성공 |
| 전체 `gradlew.bat build integrationTest --no-daemon --rerun-tasks`, 프런트 자동 테스트 | **이번 최종 연동 작업에서는 미실행**. 앞선 자동 테스트 기록을 재실행 결과로 표시하지 않음 |

| 요청 시나리오 | Codex 직접 실행 결과 |
|---|---|
| 1 운영자 로그인·A 원문 저장·B 미배정 생성 | 통과. A(id=1)는 앞뒤 공백 제목, 두 블록(한글·이모지·줄바꿈·공백), 페이지 3/없음으로 v1 저장. B(id=2)는 원문·배정 없음. 모두 격리 DB에만 생성 |
| 2 미배정 표시·역할별 후보·번역가/감수자 지정 | 통과. 번역가 후보 2명, 감수자 후보 1명으로 역할 구분. 두 지정 알림·담당자·UTC 배정 시각 표시, 현재 담당자 선택 시 교체 버튼 비활성 |
| 3 새로고침 배정 유지 | 통과. 최초 지정 및 교체 후 담당자·시각 유지 |
| 4 번역가 메뉴·목록·읽기 전용·미배정 404 | 통과. 배정된 회차 링크와 나머지 비활성 메뉴, A만 목록 표시. 제목·두 블록·페이지 읽기 전용, 편집/저장 UI 없음. B 직접 접근 404 안내·목록 링크·로그인 유지 |
| 5 감수자 동일 확인 | 통과. 내 담당 감수자, A만 목록 및 읽기 전용 표시. B 404, 운영자 화면 게이트 유지 |
| 6 교체 후 접근 이전 | 통과. 운영자 교체 알림, 이전 번역가 목록 비어 있음·A 상세 404·원문 비노출. 새 번역가 실제 로그인 후 A 목록·원문 열람 성공 |
| 7 역할별 UI 게이트·불필요한 API 요청 방지 | 통과. 운영자/독자의 /assigned 및 상세는 역할 안내·로그인 유지. 번역가/감수자/독자의 /episodes/1도 운영자 안내, 배정 영역 없음. 해당 게이트 구간의 API 접근 기록은 /api/auth/me이며 회차·assignments 요청 없음 |
| 8 같은 브라우저 토큰의 서버 권한 강제 | 통과. 번역가·감수자·독자의 후보 GET/배정 GET·PUT 각각 403 FORBIDDEN, 운영자·독자의 내 회차 GET 403. 브라우저에서 상태·코드 읽기 성공. ACCESS_DENIED 실제 감사 11건(운영자 1, 번역가 3, 감수자 3, 독자 4) |
| 9 실제 PUT preflight | 통과. 브라우저가 보낸 translator/reviewer OPTIONS 200, Allow-Origin=http://localhost:3004, 요청/응답 허용 헤더 authorization·content-type 확인 |
| 10 지정·교체·변경 없음 감사 | 통과. ASSIGNED 정확히 3건, actor=1/episode=1/subject=2·3·5. 동일 담당자 재지정 200 changed:false 후에도 3건 유지 |
| 11 배정 저장 통신 장애·복구 | 통과. 본인이 띄운 8084 PID만 확인 후 중지. 교체 저장 시 통신 오류·선택값 유지, 동일 설정 복구 후 재시도 성공. 최초 시도 전 세션 만료로 로그인 이동한 것은 배정 장애 결과에서 제외하고 새 로그인으로 재실행 |
| 12 토큰 폐기 후 401 | 통과. 현재 브라우저 토큰을 서버에서 폐기(204)하고 로컬 토큰만 확인용으로 남긴 뒤 /assigned 로드, /me 401 → /login 및 인증 만료/무효 안내 |

브라우저 도구의 읽기 전용 평가 범위에는 fetch/sessionStorage가 없어 **DevTools 콘솔 명령 자체는 미실행**입니다. 8·10의 재지정·12의 폐기는 격리 프런트 public의 테스트 페이지에서 같은 탭 sessionStorage 토큰으로 실제 fetch(credentials omit)를 실행했습니다. 운영 프런트 파일을 수정하거나 토큰 값을 추출·출력하지 않았습니다. **DevTools Network 패널 기록도 미실행**이며, 7·9의 네트워크 증빙은 실제 Spring/Tomcat 접근 기록(메서드·경로·상태·Origin·preflight 요청/응답 헤더만 기록)입니다. Authorization 값·본문·쿼리·IP는 해당 기록에 포함하지 않았습니다. 이 도구상의 차이를 문자 그대로의 콘솔/Network 패널 검증 완료로 표시하지 않습니다.

Claude Code가 별도로 보고한 역할 매트릭스·지정/교체/동일·미배정 404·교체 후 접근 이전·입력 거부·감사 3건은 **Claude Code 직접 실행(API, Codex 재실행 아님)**입니다. 그 보고에는 브라우저 연동이 포함되지 않으며, 이번 Codex 브라우저 결과와 구분합니다. 이번 기능 검증에서 제품 코드 결함은 발견하지 않았습니다. 준비 과정의 로컬 셸/선택자 문제는 수정하여 진행했으며 제품 결함이나 테스트 통과로 집계하지 않았습니다.

| 개발 DB3306 읽기 전용 비교 | 검증 전 → 후 |
|---|---|
| demo_account / demo.* | 4 → 4 / 4 → 4 |
| auth_token / auth_login_limit / auth_audit | 8 → 8 / 88 → 88 / 130 → 130 |
| episode / episode_source_version / source_block / domain_audit | 각각 0 → 0 |
| episode_assignment / translation_version / translation_block / review_decision / publication | 각각 0 → 0 |
| 기존 인증 전체 행 정렬 집계 해시 | 전후 차이 0 |
| 원본 frontend/.next/BUILD_ID SHA-256 | 동일 |

정리 시점에는 저장했던 격리 프런트/API PID가 이미 종료되어 있었고, 이번 컨테이너 ID를 대조한 뒤 `docker stop --timeout 10 mangabridge-assignment-browser-7bd23a7`(종료 0)만 실행했습니다(--rm 자동 정리). 기존 MySQL은 healthy이며 기존 컨테이너·볼륨은 삭제하지 않았습니다. **기존 3000/8080/8081의 저장된 PID와 리스너도 정리 시점에 부재**했습니다. 해당 기존 프로세스에 종료 명령을 내리지 않았으나 종료 원인은 확인되지 않아 실행 유지 검증은 통과로 표시하지 않습니다. 기존 서비스 이용에는 사용자 재시작이 필요합니다.

종료 후 로그와 격리 프런트 정적 JS 총 40개 파일에서 실제 임시 비밀번호·DB 비밀번호 일치 0건, 로그의 Bearer 토큰/root 비밀번호 출력 패턴 0건을 확인했습니다. 도구 입력용 임시 자격증명 파일은 삭제했고 브라우저 변수와 PS 프로세스 환경변수도 정리했습니다. Git에 시드 비밀번호나 검증 전용 페이지를 추가하지 않았습니다. 외부 배포·Vercel·프록시 IP 정책은 계속 미검증입니다. 이번 기록은 README만 별도 로컬 문서 커밋하며 PROJECT_CONTEXT.md 기존 M은 그대로 둡니다.

## 11. V6~V9 NOT NULL 보정 V27~V30 검증 (2026-10-06 KST)

Codex 직접 실행, 시작 기준 `3e3dc03a1cbfffbfa5b698d3635a4e40368e747e`, 승인 계약 16절 및 D-039/D-042. 작업 전 변경은 PROJECT_CONTEXT.md의 기존 줄바꿈 M뿐이었고 해당 파일을 수정·stage·restore하지 않았습니다. V27~V30 신규 SQL 4개, 스키마 테스트 3개 파일 및 이번 README 기록만 변경했습니다. V1~V26과 운영 Java 코드·프런트·계약 문서는 변경하지 않았습니다. SQL 커밋 `159b74d`, 테스트 커밋 `8391b2e`입니다.

V27은 episode의 title/created_by/created_at/updated_at, V28은 episode_source_version의 created_by/created_at/block_count, V29는 source_block.body, V30은 domain_audit.occurred_at/event를 NOT NULL로 변경합니다. 기존 타입·charset·collation을 유지하고 각 파일에 ALTER TABLE 하나만 있습니다. V27/V28은 승인된 SET foreign_key_checks=0 → ALTER → SET foreign_key_checks=1 구조를 사용합니다. 기존 FK를 삭제·재생성하거나 기존 마이그레이션을 수정하지 않았습니다.

### 격리 검증: Codex 직접 실행, 16:35~16:43 KST

Windows PowerShell **5.1.26100.9444**, 실제 MySQL **8.4.11**, Docker Linux를 사용했습니다. 고정 이미지 digest는 `mysql@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242`입니다. 주 회귀 DB는 이번 소유 `mangabridge-source-notnull-3e3dc03` (--rm, `/var/lib/mysql` tmpfs), localhost:3312/source_correction_verify입니다. 마이그레이션 경로 테스트는 각각 별도 일회용 MySQL을 사용하고 소유 컨테이너만 종료합니다. DB 비밀번호는 환경변수로 전달하고 값을 출력하지 않았으며 root 로그를 조회하지 않았습니다.

| 실제 명령 / 확인 | 결과 |
|---|---|
| `docker run -d --rm --pull=never --name mangabridge-source-notnull-3e3dc03 --publish 127.0.0.1:3312:3306 --tmpfs /var/lib/mysql:rw --env MYSQL_USER --env MYSQL_PASSWORD --env MYSQL_DATABASE --env MYSQL_RANDOM_ROOT_PASSWORD mysql:8.4.11 --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci --default-time-zone=+00:00` | 성공, 앱 계정의 실제 SELECT 1 확인 |
| `gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon` | 통과, 종료 0, 11초. 빈 주 검증 DB V1~V30 30개 적용, current=30/validate=PASS |
| 최초 `gradlew.bat build integrationTest --no-daemon --rerun-tasks` | 실패, 종료 1, 1분 51초. 신규 테스트에서 모든 기존 FK 규칙 문자열이 RESTRICT라는 잘못된 단정 1건. 기존 19개는 RESTRICT 13개/NO ACTION 6개이므로 계약 16.3의 전후 정의 동일 비교로 테스트만 보정. SQL 변경 없음, 실패 실행 후 데이터 차이 0 |
| 같은 전체 명령, 보정 후 연속 성공 1회 | 통과, 종료 0, 1분 48초. 기본 20 + 실제 MySQL 통합 51 = 71개, 실패·오류·건너뛰기 0 |
| 같은 전체 명령, 코드 변경 없이 연속 성공 2회 | 통과, 종료 0, 1분 48초. 같은 71개, 실패·오류·건너뛰기 0 |
| 필수 컬럼 NULL 및 정상 INSERT | 통과. 보정 대상 10개 컬럼의 NULL은 실제 MySQL 1048로 거부, 정상 회차·원문 버전·블록·감사 INSERT 허용, 선택적 page_no NULL 유지. 기존 도메인 NULL·UNIQUE·FK·CHECK 거부 테스트도 유지 |
| 전체 스키마 NULL 허용 집합 | 통과. flyway_schema_history만 제외하고 information_schema 전체를 조회, 계약 16.1의 13개(생성 open_slot 포함)와 정확히 일치. 추가·누락 모두 실패하도록 검사 |
| 빈 DB 경로 | 통과. 일회용 DB V1~V30 30개 적용, validate 및 재실행 추가 적용 0개. 실제 Flyway 연결에서 V24/V25/V27/V28 실행 직후 foreign_key_checks=1 확인 |
| 데이터가 있는 V26 업그레이드 경로 | 통과. 일회용 V26 DB에 4계정·토큰·제한·인증 감사·회차·원문 버전·2블록·도메인 감사 fixture를 저장한 뒤 V27~V30 4개 적용, validate/재실행 추가 적용 0개. 13개 업무·인증 테이블의 행 수·전체 컬럼 정렬 내용 해시 및 V1~V26 Flyway checksum 동일 |
| FK·CHECK·인덱스·컬럼 정의 보존 | 통과. 전체 FK 19개의 이름·참조 컬럼/순서·기존 UPDATE/DELETE 규칙 동일(기존 NO ACTION 포함). UNIQUE를 포함한 모든 인덱스·CHECK·생성 컬럼·컬럼 타입/charset/collation/기본값/정밀도 유지. 최종 연결 및 전역 foreign_key_checks=1 |
| 기존 회귀 | 통과. 인증·EpisodeSource·Assignment·health 및 기존 V9/V19/V25 경로 검사 유지. 최신 Flyway 기대 버전만 30으로 갱신, V25→V26 전용 테스트는 명시 target=26 유지 |

PS5.1 네이티브 실행 직후 LASTEXITCODE를 보존했고, 기존 VM 경고가 PowerShell 예외로 결과를 바꾸지 않도록 해당 명령 구간만 ErrorActionPreference=Continue를 사용했습니다. 실행용 스크립트·로그·결과 XML은 ignored build/verification 아래에 두며 운영 의존성·설정은 추가하지 않았습니다.

| 테이블 | 주 격리 DB 실행 전 / 성공 1회 후 / 성공 2회 후 | 개발 DB 검증 전 / 테스트 후 (읽기 전용) |
|---|---|---|
| demo_account / demo.* | 4 / 4 / 4 | 4 / 4 |
| auth_token | 0 / 0 / 0 | 8 / 8 |
| auth_login_limit | 0 / 0 / 0 | 88 / 88 |
| auth_audit | 0 / 0 / 0 | 130 / 130 |
| episode / episode_source_version / source_block / domain_audit | 각각 0 / 0 / 0 | 각각 0 / 0 |
| episode_assignment / translation_version / translation_block / review_decision / publication | 각각 0 / 0 / 0 | 각각 0 / 0 |

주 격리 DB의 4계정은 로그인용 시드가 아닌 보존 fixture입니다. 기존 HTTP 테스트는 자체 계정과 고유 서버 측 주소를 사용하고 공유 127.0.0.1 제한 키를 정리하지 않습니다. 각 테스트가 만든 행만 롤백·정리했습니다. 앱 계정의 읽기 전용 비교에서 격리·개발 DB 기존 인증 전체 행 정렬 집계 해시 차이 0, V1~V26 SQL 파일 SHA-256 차이 0입니다. 로그/JUnit XML 37개 파일에서 실제 DB 비밀번호 일치 및 Bearer/root 출력 패턴 0건을 확인했습니다.

### 개발 DB3306 적용 상태

격리 검증이 모두 통과한 후 사용자가 **개발 DB에 V27~V30 적용**을 별도로 승인했습니다. 적용 직전 V26 성공 이력 26개·대상 컬럼 NULL 데이터 0건·기존 행 수/내용 차이 0을 읽기 전용 확인한 뒤, PowerShell 5.1에서 README 2절 환경 주입과 localhost:3306 URL 검사를 거쳐 다음 명령을 실행했습니다. 회귀 테스트는 끝까지 격리 DB만 대상으로 했습니다.

| 실제 개발 DB 명령 / 최종 조회 (2026-10-06, 16:46 KST 확인) | 결과 |
|---|---|
| `gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon` | 통과, 종료 0, 7초. V27~V30 **4개 적용**, current=30, validate=PASS |
| 같은 명령 재실행 | 통과, 종료 0, 7초. **추가 적용 0개**, current=30, validate=PASS |
| Flyway 이력 | 성공 30개·최대 버전 30·실패 0개, V1~V26 checksum 차이 0 |
| 데이터·제약 보존 | 위 표의 개발 DB 행 수 그대로(계정 4·토큰 8·제한 88·인증 감사 130·모든 도메인 0), 기존 인증 전체 행 정렬 집계 해시 차이 0. 개발 DB에 fixture 삽입/정리 없음 |
| information_schema | 대상 10개 컬럼 모두 NOT NULL. NULL 허용 13개가 16.1과 정확히 일치. FK 19개의 이름·참조·규칙 전후 차이 0 |
| FK 검사 | 최종 조회 연결 및 전역 foreign_key_checks=1. 실제 마이그레이션 연결의 V27/V28 복구는 위 일회용 DB callback 테스트에서 별도 확인 |

이번 소유 3312 컨테이너는 저장한 ID를 대조한 뒤 `docker stop --timeout 10 mangabridge-source-notnull-3e3dc03`(종료 0)으로 정리했습니다(--rm 자동 정리). 테스트별 일회용 컨테이너도 각 테스트에서 종료했습니다. 기존 MySQL healthy, 기존 컨테이너·볼륨은 보존했습니다. V1~V30을 적용한 DB는 빈/업그레이드 경로의 일회용 DB, 주 회귀 격리 DB, 사용자 승인 후 개발 DB3306입니다. 다른 기존 DB에는 적용하지 않았습니다. 적용 후 로그/XML 총 39개 파일의 실제 DB 비밀번호 일치·Bearer/root 출력 패턴은 0건이고 이번 README 추가 diff에도 해당 비밀번호 값이 없습니다. 전체 README에서는 .env.example과 같은 로컬 예시 값이 검출됐지만 시작 커밋에도 있던 내용으로 이번에 추가하지 않았습니다(값은 보고하지 않음). V1~V26 파일 해시·운영 코드·프런트·계약 문서는 그대로이며 PROJECT_CONTEXT.md의 기존 M은 남겨 둡니다. 외부 배포·브라우저 검증은 이번 스키마 노드 범위가 아니며 실행하지 않았습니다.
