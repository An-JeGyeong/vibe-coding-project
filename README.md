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

역할별 ID는 `demo.operator`, `demo.translator`, `demo.reviewer`, `demo.reader`입니다. 비밀번호는 화면·소스·NEXT_PUBLIC 변수에 포함하지 않습니다. 로그인 실패 제한과 AUTH_CLIENT_IP_MODE는 제거됐습니다(D-047). 외부 공개 배포 전 비밀번호 강도와 제한 재도입 여부를 별도로 승인받아야 하며 Vercel/API 외부 배포는 미검증입니다. 아래 과거 검증 기록의 IP 설정·실패 제한 결과는 당시 동작에 대한 이력입니다.

2절처럼 DB·CORS 환경을 주입한 backend PowerShell 5.1 창에서 다음 초기화를 한 번 실행합니다. 기존 계정은 덮어쓰지 않으며 재실행은 같은 비밀번호를 입력해야 합니다. 실제 비밀번호를 셸 명령이나 Git에 기록하지 않습니다.

```powershell
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
Get-Content .env.example | Where-Object { $_ -match '^(DB_URL|DB_USERNAME|DB_PASSWORD|CORS_ALLOWED_ORIGINS|SPRING_PROFILES_ACTIVE|PORT)=' } | ForEach-Object {
  $pair = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'Process')
}
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

## 12. Translation 백엔드 및 V31 검증 (2026-10-06 KST)

Codex 직접 실행, 시작 기준 `9b0f9d3048029eff4ad7efdac8ce643f2449ffd8`, 승인 계약 17절 및 D-043/D-044. 작업 전 변경은 PROJECT_CONTEXT.md의 기존 줄바꿈 M뿐이었으며 해당 파일은 수정·stage·restore하지 않았습니다. SQL 커밋 `bf629c9`, 백엔드 커밋 `d377bfc`, 테스트 커밋 `a8b6e0a`입니다. V1~V30, 프런트, CONTRACTS.md·DECISIONS.md 및 기존 인증·EpisodeSource·Assignment 통합 테스트는 변경하지 않았습니다.

현재 배정된 TRANSLATOR 전용 API 5개(번역 버전 목록·생성·상세·전체 교체 저장·검수 제출)를 추가했습니다. 서버는 매 요청 현재 배정을 확인하고, 모든 변경에서 episode 행 잠금 후 상태·리비전을 검사합니다. 원문 신규 저장은 같은 트랜잭션에서 DRAFT/REVIEW_PENDING/APPROVED를 INVALIDATED로 바꾸며 승인 무효화·감사 실패 시 원문 저장까지 롤백합니다. 동일 원문 저장, REJECTED/INVALIDATED/PUBLISHED/ON_HOLD 및 공개 포인터는 그대로 유지합니다. 저장 API의 기존 요청·응답은 유지합니다. CORS는 기존 POST/PUT·Authorization/Content-Type 허용 설정으로 충분하여 변경하지 않았습니다.

### 격리 실제 MySQL 검증

Windows PowerShell **5.1.26100.9444**, 실제 MySQL **8.4.11**, Docker Linux. 주 검증 DB는 이번 소유 `mangabridge-translation-9b0f9d3`, localhost:3313/translation_verify(--rm, /var/lib/mysql tmpfs)이며 마이그레이션 경로 테스트는 각각 별도 일회용 MySQL을 사용했습니다. 주 DB의 demo.* 4계정은 보존 fixture로 로그인용 시드가 아니며, HTTP 테스트는 자체 계정·BCrypt·실제 Bearer 인증을 사용합니다. 개발 DB를 회귀 테스트 대상으로 사용하지 않았습니다.

| 직접 실행 명령 / 항목 | 결과 |
|---|---|
| `docker run -d --rm --pull=never --name mangabridge-translation-9b0f9d3 --publish 127.0.0.1:3313:3306 --tmpfs /var/lib/mysql:rw --env MYSQL_USER --env MYSQL_PASSWORD --env MYSQL_DATABASE --env MYSQL_RANDOM_ROOT_PASSWORD mysql:8.4.11 --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci --default-time-zone=+00:00` | 성공. 앱 계정의 실제 SELECT 1 확인. 비밀번호 값과 root 로그는 출력하지 않음 |
| `gradlew.bat compileJava compileTestJava --no-daemon` | 통과, 종료 0, 9초 |
| `gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon` | 통과, 종료 0, 9초. 빈 주 검증 DB V1~V31 31개 적용, current=31/validate=PASS |
| `gradlew.bat integrationTest --tests '*TranslationIntegrationTest' --no-daemon --rerun-tasks` | 당시 번역 테스트 10개 통과, 종료 0, 28초. 이후 동시 원문 저장 테스트와 입력 검증 보완은 아래 전체 실행에서 검증 |
| 첫 `gradlew.bat build integrationTest --no-daemon --rerun-tasks` | 실패, 종료 1, 1시간 56분 4초. 번역 11개 등은 통과했으나 기존 populatedV26Correction 테스트의 일회용 MySQL 앱 계정 SELECT 1 준비 확인이 1건 실패. 전체 실행 지연 원인은 확정하지 못했으며 마이그레이션 SQL 실패로 표시하지 않음. 준비 타임아웃을 늘리지 않고 재실행 |
| 같은 전체 명령, 최종 코드 연속 성공 1회 | 통과, 종료 0, 2분 11초. 기본 20 + 실제 MySQL 통합 63 = **83개**, 실패·오류·건너뛰기 0 |
| 같은 전체 명령, 코드 변경 없이 연속 성공 2회 | 통과, 종료 0, 2분 14초. 같은 **83개**, 실패·오류·건너뛰기 0. 두 번째 성공 결과 19:11 KST 확인 |
| 번역 입력·저장·제출 | 통과. 4000 코드포인트 경계·공백/제어문자·변환 없음·빈 배열·중복/없는 seq·JSON 타입·미정의 필드·깨진 JSON·비JSON 400, 전체 교체·동일 저장 무쓰기, 리비전 충돌 latestRevision, 상태 충돌 currentStatus, 누락 missingSeqs, 제출 후 불변성 |
| 권한·배정·오류 | 통과. 4역할 × 5API의 비로그인 401/역할 위반 403 및 번역가 성공, ACCESS_DENIED 감사, 헤더/본문 역할 위조, 미배정/교체된 번역가 404, 새 번역가의 기존 DRAFT 편집, 작성자/내부 ID·예외 비노출, 실제 접속 불가 DB에서 503 |
| 생성·복사·동시성 | 통과. 열린 버전/원문 없음 409, 직전 버전 상태 무관 seq 복사·삭제 seq 제외, 과거 버전 유지. 동시 생성 201/409, 동시 저장 200/409. 원문 잠금 선점 시 저장/제출 409 INVALIDATED, 제출 선행 후 원문 변경 시 INVALIDATED |
| 무효화·롤백·감사 | 통과. 7개 상태별 효과·공개 포인터 보존, 변경 없는 원문 저장 무효화 없음, 번역 없는 회차 정상, 복수 승인 무효화 시간/감사 actor·새 원문 버전·번역 ID, 생성/제출 감사 장애 및 부분 무효화 감사 장애의 전체 롤백 |
| V31 마이그레이션 | 통과. 빈 DB 최신 V31/validate/재실행 추가 적용 0개. 데이터가 있는 V30 DB에 V31 1개 적용, 13개 테이블의 기존 행 수·전체 기존 컬럼 내용 및 V1~V30 checksum 보존. 기존 번역 두 행에 revision=1, INT NOT NULL DEFAULT 1 확인 |
| 스키마·기존 회귀 | 통과. NULL 허용 목록 13개 그대로, FK 19개, foreign_key_checks 연결/전역 1. 이전 마이그레이션 경로·제약·인증·EpisodeSource·Assignment·health 회귀 유지. 과거 V26 보정 전용 테스트는 명시 target=30으로 범위를 유지 |
| API CORS | 통과. 실제 HTTP OPTIONS에서 PUT 저장과 POST 제출 허용 Origin·Authorization/Content-Type 확인. 브라우저 네트워크 검증 결과로 대체하지 않음 |

환경은 README 2절 방식으로 PS 프로세스에 주입하고 DB_URL만 격리 주소로 설정했습니다. 네이티브 명령 직후 LASTEXITCODE를 보존했습니다. 도구용 Gradle init/script·로그·JUnit 결과는 ignored build/verification에만 두었고 운영 의존성·설정은 추가하지 않았습니다.

| 테이블 | 주 격리 DB 전 / 성공 1회 후 / 성공 2회 후 | 개발 DB 전 / 테스트 후 (읽기 전용) |
|---|---|---|
| demo_account / demo.* | 4 / 4 / 4 | 4 / 4 |
| auth_token | 0 / 0 / 0 | 8 / 8 |
| auth_login_limit | 0 / 0 / 0 | 88 / 88 |
| auth_audit | 0 / 0 / 0 | 130 / 130 |
| episode / episode_source_version / source_block / domain_audit | 각각 0 / 0 / 0 | 각각 0 / 0 |
| episode_assignment / translation_version / translation_block / review_decision / publication | 각각 0 / 0 / 0 | 각각 0 / 0 |

각 테스트가 만든 행만 정확히 정리하며 고유 서버 측 fixture 주소를 사용합니다. 공유 127.0.0.1 제한 키는 정리하지 않습니다. 격리·개발 DB의 기존 인증 전체 행 정렬 집계 해시 차이 0, V1~V30 파일 SHA-256 차이 0입니다. 로그/JUnit XML 43개에서 실제 DB 비밀번호 일치·Bearer/root 출력 패턴 0건을 확인했습니다.

### 개발 DB3306 및 후속 연동

V31 개발 DB 적용은 별도 사용자 확인 대기 중이며 아직 실행하지 않았습니다. 브라우저·프런트 검증은 이번 백엔드 작업에서 미실행입니다. Claude Code의 프런트 구현 후 계약 17.7의 실제 브라우저 최종 연동을 격리 환경에서 수행해야 합니다. 외부 배포·Vercel·프록시 IP 정책도 미검증입니다.
이번 소유 3313 컨테이너는 저장한 ID를 대조한 뒤 `docker stop --timeout 10 mangabridge-translation-9b0f9d3`(종료 0)으로 정리했습니다(--rm 자동 정리). 테스트별 일회용 컨테이너도 종료됐으며 기존 개발 MySQL은 healthy입니다. 기존 컨테이너·볼륨을 삭제하거나 기존 서버를 중지하지 않았습니다. 실제 적용한 DB는 빈/업그레이드 경로 일회용 DB와 주 회귀 격리 DB이며, 개발 DB3306은 사용자 승인 답변 전까지 V30을 유지합니다. README의 이번 추가 diff에 DB 비밀번호 값이 없으며 프런트·계약 문서·PROJECT_CONTEXT.md를 stage하지 않습니다.

### Translation 최종 실제 연동 검증 (2026-10-06 KST)

Codex 직접 실행. 대상 frontend/통합 HEAD `1384139f266aa4b1e3dccae41d48e26027441b0b`, backend `8652c26`, 승인 계약 17절 `9b0f9d3`. 작업 전 HEAD와 status 조건이 일치했고 PROJECT_CONTEXT.md 기존 M뿐이었습니다. 이번에는 README 기록만 변경하며 제품 코드는 결함을 발견해도 수정하지 않습니다. Claude Code가 별도로 보고한 역할 매트릭스·생성/복사·저장/충돌/입력 거부·제출/누락/제출 후 409·원문/승인 무효화·감사·교체·동시성/직렬화는 **Claude Code 직접 실행(API, Codex 재실행 아님)**이며 브라우저 결과와 구분합니다.

실제 환경은 Windows PowerShell **5.1.26100.9444**, MySQL **8.4.11**, Docker **29.5.3/Linux**, API localhost:8086, 프런트 localhost:3005입니다. 이번 소유 `mangabridge-translation-browser-1384139`는 localhost:3314/translation_browser, --rm, /var/lib/mysql tmpfs이며 이미지 digest는 `mysql@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242`입니다. 프런트는 HEAD 추적 파일의 ignored 격리 사본에서 빌드했으며 원본 frontend/.next/BUILD_ID 해시는 전후 동일합니다. API의 CORS 출처는 http://localhost:3005 하나만 설정했습니다. 개발 DB는 연동 시나리오에 사용하지 않았습니다.

| 실제 준비 명령 / 실행 구분 | 결과 |
|---|---|
| `docker info`, `docker image inspect mysql:8.4.11` | 통과. Server 연결/Linux, 고정 digest 확인 |
| `docker run -d --rm --pull=never --name mangabridge-translation-browser-1384139 --publish 127.0.0.1:3314:3306 --tmpfs /var/lib/mysql:rw --env MYSQL_USER --env MYSQL_PASSWORD --env MYSQL_DATABASE --env MYSQL_RANDOM_ROOT_PASSWORD mysql:8.4.11 --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci --default-time-zone=+00:00` | 통과. 값은 프로세스 환경으로 전달하며 root 로그 조회 없음 |
| README 2절 환경 주입 + `gradlew.bat bootJar --no-daemon` | 통과, 종료 0. Java 17의 기존 백엔드 운영 JAR 사용 |
| README 7절 시드 `gradlew.bat bootRun --args='--demo-auth-seed=true --spring.main.web-application-type=none' --no-daemon` | 통과, 종료 0, 9초. PS5.1에서 사용자가 허용한 일회용 비밀번호 생성으로 Read-Host를 대체하고 seed 환경변수 정리. V1~V31 성공 31개·실패 0 |
| 격리 사본 `NEXT_PUBLIC_API_BASE_URL=http://localhost:8086` 주입, `npm.cmd run build -- --webpack` | 통과, 종료 0. 기존 node_modules를 junction으로 공유하므로 앞선 검증과 같은 webpack 빌드 사용. 원본 .next 변경 없음 |
| `java -jar .../mangabridge-backend-0.0.1-SNAPSHOT.jar`, 격리 사본 `node .../next/dist/bin/next start .../frontend --port 3005` | 통과. 새 소유 PID와 포트 사용, health 실제 200 |
| `gradlew.bat build integrationTest --no-daemon --rerun-tasks`, 프런트 자동 테스트 | **이번 실제 연동 작업에서 미실행**. 앞선 83개 연속 통과 및 Claude 보고를 이번 재실행으로 표시하지 않음 |

준비 과정에서 stdin PowerShell 마지막 메모리 전달 구간 및 .ps1 실행 정책 문제가 있었고, 실행 정책 변경 없이 PS5.1 인라인 Invoke-Expression으로 진행했습니다. 처음 생성한 이번 소유 환경만 다시 준비했고 기존 DB/서비스는 변경하지 않았습니다. 메모리 전달이 실패해 검증용 5계정의 임시 비밀번호를 PS5.1 BCrypt fixture로 다시 설정한 뒤 실제 로그인했습니다. 값은 파일·화면·로그·Git에 남기지 않았습니다. 첫 자동 입력은 브라우저 DOM의 비밀번호 마스킹 문자열을 실제 값으로 사용할 수 없어 로그인 실패했으며 제품 결함으로 집계하지 않습니다. 이후 localhost 보조 서버의 메모리 전달로 실제 로그인 화면을 조작했습니다. 보조 서버와 임시 환경은 종료 시 정리했습니다.

### 시나리오별 Codex 직접 결과 (브라우저 19:39~19:50 KST)

| 번호 | 통과 / 실패 / 미검증 및 관찰 |
|---|---|
| 1 준비 | 통과. 운영자 실제 로그인, A(id=1) 3블록·페이지 1/없음/2와 번역가/감수자 배정. B(id=2) 원문 1블록·미배정. 생성 행은 모두 격리 DB에만 존재 |
| 2 번역 시작 | 통과. /demo → 배정된 회차 → A, 번역 없음 안내와 새 번역 시작. v1 DRAFT의 왼쪽 원문/페이지·오른쪽 블록 N 번역 입력 확인 |
| 3 저장·입력 검증 | 통과. 앞뒤 공백·줄바꿈 두 블록 저장/새로고침 후 문자열 정확히 일치. 빈 블록 전체 교체 저장. 공백만/4001자 거부와 실제 PUT 증가 0. 동일 상태 저장 비활성, 미저장 시 제출·다른 버전 보기 비활성 |
| 4 리비전 충돌 | 통과. 같은 토큰을 가진 검증 탭에서 실제 브라우저 PUT으로 revision=4 증가, 편집 화면 저장 409 안내·local draft 유지. 최신 내용 불러오기를 눌렀을 때만 remote translation으로 교체 |
| 5 제출 | 통과. 확인 문구/취소/재확정, 누락 2블록 안내와 실제 submit 요청 증가 0. 완성 저장 후 확정, v1 REVIEW_PENDING·읽기 전용·새 번역 시작 없음, 새로고침 유지 |
| 6 원문 변경·복사 | 통과. 변경 없는 원문 저장은 v1 REVIEW_PENDING 유지. A 원문 변경과 seq3 삭제 후 원문 v2, 번역 v1 INVALIDATED·읽기 전용·새 번역 시작. v2 생성은 seq1/2 번역만 복사, seq3 제외 |
| 7 편집 중 무효화 | 핵심 흐름 통과. v2 편집 중 운영자 원문 v3 저장, 저장 409 무효화 안내·초안 유지, 최신 불러오기 후 읽기 전용/새 번역 시작. **최신 원문 번호 표시 불일치 1건 실패**: 상단 v2가 남지만 이후 v3 새 번역의 표에는 원문 v3(최신) 표시. 아래 재현 참고 |
| 8 승인 무효화 | 통과. 격리 DB의 v3에 APPROVED/review_decision fixture(감수자)를 INSERT 후 운영자 원문 v4 저장. 번역 INVALIDATED, invalidated_at 설정, APPROVAL_INVALIDATED(actor=1,episode=1,source=4,translation=3) 정확히 1건 |
| 9 번역가 교체 | 통과. v4 DRAFT 상태에서 Extra translator(account=5)로 교체. 이전 번역가 목록 비움·A 상세 404·원문/번역 비노출. 새 번역가 실제 로그인하여 v4 이어서 저장·제출 성공 |
| 10 역할·서버 강제 | 통과. 배정 감수자는 읽기 전용 원문만 표시, /translations 요청 0건(해당 구간 /auth/me·/my/episodes/1만). 운영자/독자 /assigned 역할 안내·로그인 유지. 같은 역할별 세션의 실제 브라우저 GET/POST/PUT 모두 403 FORBIDDEN 읽기 성공, ACCESS_DENIED 각각 3건(총9). 미배정 번역가 B 생성 404 |
| 11 CORS | 통과(서버 접근 기록 증빙). 브라우저의 생성·PUT·submit OPTIONS 200, Allow-Origin=http://localhost:3005. PUT/submit과 보조 페이지 생성의 authorization,content-type 허용 확인. 본문 없는 앱 생성은 Content-Type을 보내지 않아 authorization만 preflight하며 정상 201 |
| 12 감사 | 통과. TRANSLATION_CREATED v1~v4 각각1건(4), TRANSLATION_SUBMITTED v1·v4 각각1건(2; 시나리오9 추가 제출 포함), APPROVAL_INVALIDATED 1건. 모두 translation_version_id 포함. 감사 종류는 EPISODE_CREATED2/SOURCE_SAVED5/ASSIGNED3 및 위3종뿐, DRAFT 저장·승인 아닌 무효화의 별도 이벤트 없음 |
| 13 장애·세션 | 통과. 이번 소유 8086 API 중지 → 저장 통신 오류·offline draft retained 입력 유지 → 같은 설정 복구/health200 → 재저장 성공. 새 번역가 토큰 서버 폐기204 후 /assigned/A 로드 → /me401 → /login 및 인증 만료/무효 안내 |
| 14 저장소 | **부분 확인**. 편집·저장 후 같은 편집 탭의 보조 페이지에서 sessionStorage 토큰 키 하나, localStorage 빈 목록, 쿠키 없음 확인. 편집기를 그대로 유지한 시점의 저장소 직접 관찰은 도구 제한으로 **미검증**이며 이 결과로 대체하지 않음 |

DevTools 콘솔 명령 자체 및 Network 패널 관찰은 **미실행**입니다. 4·10·13의 직접 호출은 격리 사본 public의 검증 페이지에서 같은 탭 sessionStorage 토큰으로 fetch(credentials omit)를 실행했습니다. 충돌 검증용 복사 탭은 토큰 값을 메모리에서만 전달하고 임시 clipboard를 바로 비웠으며 값은 출력하지 않았습니다. 응답 403을 브라우저 DOM에서 읽어 CORS 성공을 확인했습니다. 네트워크 증빙은 Tomcat 접근 기록(메서드·경로·상태·Origin·preflight 요청/응답 헤더만 기록)이며 Authorization 값·본문·IP는 포함하지 않습니다. 검사 전후 PUT/submit 수와 감수자 구간 요청 수를 읽기 전용 비교했습니다. 보조 페이지는 운영 코드나 Git에 포함하지 않았습니다.

### 발견한 프런트 표시 문제: 수정하지 않음

재현: /assigned/1에서 원문 v2 기반 DRAFT를 편집 → 다른 운영자 탭에서 원문 v3 저장 → 저장 409 STATE_CONFLICT → 최신 내용 불러오기 → 새 번역 시작. 무효화·읽기 전용·v3 생성은 정상이나 상단은 `최신 원문 v2`, 번역 표는 `원문 v3 (최신)`으로 서로 다릅니다. 전체 페이지 새로고침 후에는 상단도 최신 값으로 복구됩니다. `frontend/src/components/AssignedViews.tsx:116`은 최초 detail.source.version을 쓰고 TranslationWorkspace의 load는 부모 detail을 다시 조회하지 않습니다. 담당 Claude Code에 이 조건으로 표시 상태 갱신을 요청해야 하며 이번에는 직접 수정하지 않았습니다. 백엔드 동작 결함은 발견하지 않았습니다.

### 개발 DB 보존 및 사용자 승인 후 V31 별도 적용

실제 연동 전후 읽기 전용 비교에서 demo_account/demo.* 4→4, auth_token8→8, auth_login_limit88→88, auth_audit130→130, 9개 도메인 테이블 각각0→0이며 기존 인증 전체 행 정렬 집계 해시 차이0입니다. 연동 종료 시 Flyway는 V30과 기존 checksum/FK/NULL 허용 목록 그대로였습니다. 이후 표시 문제를 알린 별도 질문에 사용자가 **개발 DB에 V31 적용**을 승인했고 적용 직전 데이터가 그대로임을 다시 확인했습니다. 이전 12절의 개발 DB 승인 대기 기록은 그 당시 상태이며 다음 결과로 갱신됩니다.

| 별도 실제 개발 DB 명령 / 조회 (2026-10-06 19:54 KST) | 결과 |
|---|---|
| PS5.1 README 2절 환경 주입·localhost:3306 URL 검사 후 `gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon` | 통과, 종료0, 7초. **V31 1개 적용**, current=31, validate=PASS |
| 같은 명령 재실행 | 통과, 종료0, 7초. **추가 적용0개**, current=31, validate=PASS |
| Flyway/스키마 | 성공31개·최대31·실패0, draft_revision=int/NOT NULL/default1. V1~V30 checksum 차이0, FK19/NULL 허용13개 및 foreign_key_checks 연결·전역1 유지 |
| 기존 데이터 | 계정4·토큰8·제한88·인증 감사130·모든 도메인0 그대로, 전체 기존 내용 집계 해시 차이0. 개발 DB에 검증 fixture 생성·삭제 없음 |

검증 후 소유 PID/포트를 대조해 이번 API·프런트·자격증명 보조 프로세스만 종료하고, 컨테이너 ID를 대조한 뒤 `docker stop --timeout 10 mangabridge-translation-browser-1384139`(종료0, --rm 자동 정리)만 실행했습니다. 기존 MySQL은 healthy이며 기존 컨테이너·볼륨 삭제나 기존 서버 종료 명령은 실행하지 않았습니다. 기존 3000/8080/8081 프로세스 ID의 전후 동일성은 초기 조회 증빙이 부족해 미검증으로 남깁니다. 실제 임시 비밀번호·Bearer/root 출력 패턴은 로그/격리 정적 JS40개에서 검출0건, 값은 파일에 보존하지 않았고 브라우저 변수·임시 clipboard·소유 서버 메모리는 정리했습니다. 외부 배포·Vercel·프록시 IP 정책은 계속 미검증입니다. 남은 제품 수정은 위 표시 문제이며, 저장소의 편집 중 직접 관찰 및 DevTools 콘솔/Network 패널 검증은 별도 미검증으로 남깁니다.
### Review 백엔드 검증 기록 (2026-10-06, Codex 직접 실행)

승인 기준은 CONTRACTS.md 18절(정정 `f2b9304`), DECISIONS.md D-045·D-046입니다. 시작 HEAD는 프런트 구현 `293337c0d7452a1aa6f9c28b60af939741002aa9`이며, 검증한 운영 코드 커밋은 `3952018`, 테스트 포함 코드 기준은 `f056fc92d11ee16ff007c842f47332a0a07f426c`입니다. 이번 문서 커밋은 아래 실행 증빙만 추가합니다. frontend/, 승인 문서 3종, V1~V31은 변경하지 않았습니다. 마이그레이션과 의존성 추가는 없습니다.

격리 환경: MySQL `8.4.11`, `mysql@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242`, `--rm`, `/var/lib/mysql` tmpfs, `localhost:3315/review_verify`. Windows PowerShell `5.1.26100.9444`에서 README의 Spring 환경변수를 프로세스에 주입하고 실행했습니다. 앱 계정의 실제 `SELECT 1` 성공 후 기존 Flyway V1~V31을 빈 격리 DB에 적용했고 validate가 통과했습니다. 7절의 일회용 시드 명령으로 프로세스 안에서 생성한 임시 비밀번호를 사용하여 데모 4계정을 초기화했습니다. 값은 출력하거나 파일에 저장하지 않았으며 시드 후 프로세스 환경변수를 정리했습니다.

| 실제 실행 명령 (backend/) | 결과 |
|---|---|
| `gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon` (로컬 무추적 검증 도구) | 종료 0. 기존 31개 적용, current=31, Flyway validate 통과 |
| `gradlew.bat bootRun --args='--demo-auth-seed=true --spring.main.web-application-type=none' --no-daemon` | 종료 0. 격리 DB의 데모 4계정 시드 |
| `gradlew.bat integrationTest --tests "*ReviewIntegrationTest" --no-daemon` | 종료 0. 초기 감수 테스트 11개 통과. 이후 추가한 이력 테스트를 포함한 12개는 아래 전체 실행 두 번에서 검증 |
| `gradlew.bat build integrationTest --no-daemon --rerun-tasks` 첫 실행 | 20:40~20:42 KST, 종료 0, 2분 33초. 단위 20 + 통합 75 = 95개, 실패·오류·건너뜀 0 |
| 같은 전체 명령 두 번째 연속 실행 | 20:43~20:45 KST, 종료 0, 2분 32초. 같은 95개, 실패·오류·건너뜀 0 |

감수 통합 테스트 12개는 대기 목록의 배정·상태·정렬·페이지 경계, 감수자의 가시 상태 3종과 병기·결정·decidable, 현재 배정 및 교체 후 인계, 운영자의 모든 상태 조회, 반려 사유의 코드포인트 경계·제어문자·공백 보존·공개 범위, 반려 후 새 DRAFT 복사, 승인 결정/감사 정합, 중복 처리와 상태/원문 충돌, 자기 검수 403과 ACCESS_DENIED 감사, 승인·반려 동시 요청 중 정확히 하나만 성공, 감사 저장 실패 시 실제 DB 트랜잭션 전체 롤백, 승인 후 원문 변경의 INVALIDATED/invalidated_at/APPROVAL_INVALIDATED 결합을 확인합니다. API 7개 × 4역할·비로그인 매트릭스, 위조 헤더·본문 role 거부, no-store, 비JSON/깨진 JSON/미정의 필드/approve 본문 400, 오류의 비밀·내부 정보 비노출도 확인했습니다. 감사 장애는 DAO 장애 주입과 실제 MySQL 롤백으로 검증했으며, 별도의 접속 불가 MySQL 주소로 7개 서비스 함수의 503 변환을 확인했습니다. POST preflight는 실제 HTTP에서 허용 Origin·Authorization·Content-Type과 credentials=false를 확인했으며, 브라우저 검증으로 간주하지 않습니다. 기존 CORS 설정은 변경하지 않았습니다.

기존 TranslationIntegrationTest 변경은 정확히 두 응답 필드 목록(상세·목록 항목)에 `decision` 추가와 각각의 `decision:null` 검증 추가뿐입니다. 기본 커밋으로부터 예상하는 이 변경과 실제 파일을 대조하여 일치함을 확인했고, 나머지 단언은 유지했습니다. 기존 EpisodeSource·Assignment·인증 통합 테스트는 수정 없이 통과했습니다. 기존 스키마/제약·health 회귀도 통과했습니다.

| 읽기 전용 전후 비교 | 첫 전체 실행 전 → 첫 실행 후 → 두 번째 실행 후 |
|---|---|
| 격리 DB demo_account / 데모 계정 | 4 → 4 → 4 (내용 해시 동일) |
| 격리 DB auth_token / auth_login_limit / auth_audit | 각 0 → 0 → 0 |
| 격리 DB 도메인 테이블 9개 | 각 0 → 0 → 0 |
| 개발 DB(3306) demo_account / auth_token / auth_login_limit / auth_audit | 검증 전후 4 / 8 / 88 / 130, 내용 해시 모두 동일 |
| 개발 DB 도메인 테이블 9개 | 검증 전후 각 0 |

테스트는 생성한 계정·회차 ID와 추적한 감사 ID만 정리하고, 제한 행은 테스트 서버 필터가 정한 고유 주소와 테스트 로그인 ID의 해시만 정리합니다. 공유 `127.0.0.1` 제한 키와 데모 계정은 건드리지 않습니다. 개발 DB는 읽기 전용 비교만 수행했으며 스키마·데이터 변경은 하지 않았습니다. 검증 후 이번에 만든 격리 컨테이너만 ID를 확인하여 종료했고 기존 서버·컨테이너·볼륨은 보존했습니다. 변경 소스의 비밀 리터럴 검사에서 후보 0개, 추적 환경 파일은 예시 파일뿐이며 `git diff --check`가 통과했습니다.

미실행: 18.6의 실제 브라우저 통합 시나리오와 프런트 테스트 재실행. 이번 요청의 백엔드 구현·검증 범위에 포함되지 않으며 통과로 기록하지 않습니다. Claude Code의 백엔드 리뷰·API 점검 후 별도 실제 연동 요청으로 진행합니다. PROJECT_CONTEXT.md의 기존 줄바꿈 M 상태는 수정·stage·restore하지 않았습니다.

### Review 실제 브라우저 연동 기록 (2026-10-06 21:08~21:27 KST)

대상 통합 HEAD는 `f80df2b4a03e4388dc39e045434844ee7d1b02a0`, 포함된 프런트는 `293337c`, 계약은 CONTRACTS.md 18절/D-045·D-046입니다. 아래는 Codex가 실제 브라우저 UI로 직접 실행한 결과이며, 로그인 비밀번호 입력·로그인 제출은 사용자가 수행했습니다. 코드·마이그레이션·승인 문서는 변경하지 않았습니다. 이전 백엔드 테스트 통과를 이번 브라우저 검증으로 대체하지 않습니다.

환경은 Codex In-app Browser, 격리 MySQL `8.4.11`(`mysql@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242`), `--rm`/tmpfs, `127.0.0.1:3316/review_browser`, API `8087`, 격리 프런트 사본 `3006`입니다. CORS 허용 출처는 `http://localhost:3006` 하나, local 프로파일/DIRECT입니다. PowerShell `5.1.26100.9444`에서 README 2절 환경변수와 7절 시드 방식을 적용하고 V1~V31을 적용했습니다. 데모 4계정과 교체 감수자 `demo.reviewer2`(Extra reviewer, id=5)를 격리 DB에만 준비했습니다. 추가 감수자는 검증용 Java BCrypt 도구로 해시를 만들어 직접 INSERT했으며, 비밀번호 전달 제약 때문에 사용자가 Read-Host로 입력한 임시 비밀번호의 해시로 격리 5계정만 갱신했습니다. 값·해시는 출력/기록하지 않았고 운영 코드·마이그레이션 변경은 없습니다.

| 실제 실행 명령/작업 | 결과 |
|---|---|
| `powershell.exe -NoProfile` 안에서 README 환경 주입, `docker run -d --rm --pull=never --name mangabridge-review-browser-f80df2b --publish 127.0.0.1:3316:3306 --tmpfs /var/lib/mysql:rw --env MYSQL_USER --env MYSQL_PASSWORD --env MYSQL_DATABASE --env MYSQL_RANDOM_ROOT_PASSWORD mysql:8.4.11 --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci --default-time-zone=+00:00` | 통과, 격리 컨테이너 생성. 환경변수 값 출력 없음 |
| `gradlew.bat bootJar --no-daemon`, `gradlew.bat bootRun --args='--demo-auth-seed=true --spring.main.web-application-type=none' --no-daemon` | 통과, 기존 JAR 빌드·격리 DB 마이그레이션/시드 |
| 격리 프런트 사본에서 `npm.cmd run build -- --webpack`, `next start --port 3006` | 통과, 검증 API 주소로 빌드·기동. 원본 .next/next-env.d.ts 보존 |
| `java -jar .../mangabridge-backend-0.0.1-SNAPSHOT.jar`, `GET http://localhost:8087/api/health` | 통과, 실제 DB UP. 장애 검증 때 소유 PID만 중지한 뒤 같은 PS5.1 설정으로 재기동, health UP |
| SQL stdin 스크립트 `docker exec -i <격리 또는 개발 컨테이너> sh -s` | 종료 0, 앱 계정의 읽기 전용 결정/감사 조회 및 개발 DB 전후 비교 |
| `docker stop --timeout 10 <ID 대조한 이번 컨테이너>` | 종료 0, --rm 자동 정리. 삭제 명령·기존 컨테이너 중지 없음 |

| 요청 시나리오 | Codex 실제 결과 |
|---|---|
| 1 운영자 준비 | 통과. 회차 A(id=1), 원문 2블록(첫 페이지 1, 둘째 NULL), 번역가/감수자 배정. 미배정 감수자 검증용 B(id=2)도 UI로 생성·원문 저장·번역가 배정·번역 제출, 감수자 미배정 |
| 2 번역 작성·제출 | 통과. A v1 생성, 공백·개행 포함 번역 저장, UI 확인 단계 후 제출, REVIEW_PENDING 읽기 전용 |
| 3 검수 목록·대조 | 통과. 감수자 /demo 링크로 /reviews, A만 표시, 원문·번역 병기 일치. 결정 입력 전 input/textarea 0개 |
| 4 반려 | 통과. 빈 사유·501자 화면 검증, 유효 사유 앞뒤 공백/개행 보존, 반려 결정 표시·버튼 사라짐. 실제 reject POST는 유효 요청 1건뿐 |
| 5 반려 후 새 번역 | **부분 실패**. 상세 사유 표시·새 v2에 기존 내용 복사·수정/저장/제출 통과. 목록 요약에 사유가 없고 '반려'만 표시됨(18.4와 불일치) |
| 6 승인 | 통과. 새 v2 대기 목록, 되돌릴 수 없음 확인·취소 때 approve POST 0→0, 재확정 200·승인 표시 |
| 7 운영자 조회 | 통과. 버전별 상태·기준 원문·제출 시각·결정, v1 반려 사유와 v2 승인 상세 확인 |
| 8 승인 무효화 | **부분 실패**. 원문 변경 후 서버 INVALIDATED/무효화 시각, 감수자 상세 404·대기 목록 비움, 번역가 무효화 반영 통과. 운영자 번역 목록은 원문 저장 직후 이전 상태를 유지, 상세 재조회는 무효화됨, 페이지 새로고침 후 목록 정상 |
| 9 재처리·원문 충돌 | **부분 실패**. 두 감수 탭의 v3에서 먼저 승인 200, 다른 탭 반려 409·이미 처리 안내·결과 반영 통과(순차 오래된 화면 검증이며 실제 동시 요청으로 간주하지 않음). v4 화면을 연 채 원문 변경 후 승인 409이지만 후속 상세 GET 404가 무효화 안내를 가림 |
| 10 감수자 교체 | 서버·인계 통과, **표시 문제 있음**. v5 교체 전 열린 이전 감수자의 승인/반려 각각 404, 새로고침 상세 404·목록 비움. 미배정 B 상세 404. 교체 감수자 로그인 후 A v5 인계·반려 성공. 다만 action 404 직후 이전에 읽은 병기/결정 버튼은 새로고침 전까지 남음 |
| 11 역할·서버 강제 | **부분 확인/미검증**. 번역가·운영자·독자의 /reviews와 상세에 역할 안내·로그인 유지. 독자 두 화면 이동 전후 전체 감수 GET/POST 수 40→40으로 미호출 확인. 번역가·운영자의 미호출은 개별 구간 수 비교가 없어 미검증. 콘솔 fetch의 역할별 403·비로그인 401·응답 사유 비노출은 도구 제약으로 미실행 |
| 12 CORS | **부분 확인**. 실제 브라우저 approve/reject OPTIONS 200, Allow-Origin=http://localhost:3006. reject는 authorization,content-type, 본문 없는 approve는 authorization만 요청/허용. 비허용 Origin(http://127.0.0.1:3006)의 실제 로그인 OPTIONS 403·POST 차단. 감수 경로 자체의 비허용 Origin POST는 미검증 |
| 13 장애·세션 | **부분 확인**. 검증 API 중지→반려 통신 오류와 사유 정확 보존→복구→같은 사유 재시도 200. 만료 토큰으로 승인 401/로그인 이동은 미실행 |
| 14 DB 정합·사유 비노출 | DB 정합 통과. 결정 4행(승인2/반려2), 버전당 정확히1행. REVIEW_APPROVED2/REVIEW_REJECTED2/APPROVAL_INVALIDATED2, 결정·감사 연결 불일치0, 중복 결정0. 반려 사유 공백·개행 보존. domain_audit에 reason/body/title/token/ip 컬럼 없음. 독자·비배정자 전체 API 응답의 비노출 직접 검증은 미실행 |

발견한 프런트 문제는 수정하지 않았습니다. 재현·담당자(Claude Code) 전달 사항:

1. `/assigned/1`에서 v1 반려 사유가 상세에 표시되나 버전 표의 결정 셀은 '반려'뿐입니다. `TranslationWorkspace.tsx`의 목록 셀은 decisionLabel만 렌더링합니다. 계약 18.4의 목록 사유 요약 누락입니다.
2. 승인된 v2를 운영자 `/episodes/1`에서 보고 원문을 변경·저장하면 번역 목록은 '승인됨/최신 원문 v1'이 남습니다. 같은 화면 '번역 v2 보기'를 다시 누르면 상세는 '무효화됨/무효화 시각'이며 전체 새로고침 후 목록도 정상입니다. `EpisodeDetailView` 원문 저장과 `TranslationOverviewPanel` 목록 재조회 연결을 검토해야 합니다.
3. 감수자가 v4 REVIEW_PENDING 화면을 연 상태에서 운영자 원문 변경→승인 확정. 접근 기록은 approve 409 다음 상세 GET 404이며, 화면에는 404 안내만 남고 계약의 '원문이 변경되어 ... 무효화되었습니다' 안내는 보이지 않습니다.
4. 감수자 v5 화면에서 승인 또는 반려 확인을 연 상태로 다른 운영자가 담당자를 교체→확정하면 서버 404와 안내는 정상이나 이전 병기·버튼이 남습니다. 전체 새로고침하면 제거됩니다. 권한 상실 이후 화면 데이터 정리 검토가 필요합니다(새로운 서버 데이터 노출은 확인되지 않음).

브라우저 자동화는 문서화된 locator 클릭/fill/선택과 실제 페이지 이동을 사용했고, evaluate는 표시된 DOM의 input 개수와 사유 동일 여부 읽기에만 사용했습니다. 스크립트로 visibilityState나 이벤트를 바꾸지 않았습니다. 두 번째 탭은 Ctrl+클릭 후 독립 로그인(사용자 입력)했습니다. 실제 동시 요청, DevTools 콘솔 실행 및 Network 패널 관찰은 미실행입니다. 콘솔 실행 capability가 없고 키 조작으로도 콘솔 접근을 확인하지 못했으며 read-only evaluate로 fetch를 우회하지 않았습니다. 네트워크 증빙은 Tomcat 접근 기록(메서드·경로·상태·Origin·preflight 헤더만, Authorization 값·본문·IP 제외)입니다. 탭 세션이 교체되어 마지막 사용자 탭을 재바인딩했으나 매번 실제 사용자·역할을 확인했습니다. 비밀번호 입력 마스킹으로 초기 보조 입력이 실패한 것은 도구 제약이며 제품 결함으로 기록하지 않습니다.

Claude Code가 알려 준 격리 API 점검(역할 매트릭스·404·사유400·동시 결정·승인 무효화/감사)은 **Claude Code 직접 실행(API, Codex 재실행 아님)**으로만 구분합니다. 이번 브라우저 미검증 항목을 그 결과로 통과 처리하지 않았습니다.

정리: 이번 소유 Java/API·격리 Next·자격증명 보조 Node PID와 실행 명령을 대조해 종료했고, 소유 컨테이너 ID를 대조해 종료했습니다. 3006/3007/8087/3316 리스너 각0, 기존 개발 MySQL healthy 유지. 개발 DB 전후 계정4/토큰8/제한88/인증 감사130, 도메인9개 각0 및 기존 내용 집계 해시 차이0. 원본 next-env.d.ts 해시와 .next/BUILD_ID 동일. 기존 8080/8081/3000 PID 전후 동일성은 최초 실행 중 PID 증빙이 없어 미검증이며 해당 포트 프로세스를 조작하지 않았습니다. 실제 비밀번호·토큰은 채팅/README/Git에 기록하지 않았습니다. 저장소 변경은 이 README 기록뿐이며 PROJECT_CONTEXT.md의 줄바꿈 M은 그대로입니다. 남은 검증은 표의 미실행 항목, 제품 수정은 위 표시 문제입니다. 외부 배포/Vercel·프록시 IP 정책은 미검증 유지입니다.

### 로그인 제한 제거 검증 — CONTRACTS 19절 / D-047

Codex 직접 실행, 2026-10-07 07:12~07:24 KST. 승인 기준 ef060f5이며 후속 0cb736c(발행 계약)와 9b828dd(Claude Code 프런트)이 추가된 상태에서도 이번 백엔드 변경 범위는 로그인 제한 제거뿐입니다. 코드 dbb21e3, 테스트 커밋은 이 기록 직전 커밋입니다. Review 프런트 4건 재검증은 A~D 실행 전 중단·소유 환경 정리했고, 브라우저 로그인 제한 검증과 함께 마지막 통합 검증으로 이월했습니다.

격리 MySQL 8.4.11, 127.0.0.1:3317/login_no_limit, --rm/tmpfs 사용. 개발 DB 3306과 기존 8080/8081/3000 서비스는 사용하거나 조작하지 않았습니다. PowerShell 5.1.26100.9444에서 환경변수를 프로세스에만 주입했습니다. 데모 계정 4개는 무작위 임시 비밀번호로 시드했고 즉시 비밀번호 환경변수를 정리했습니다. 기존 MySqlIntegrationTest의 compose ps/exec 회귀를 그대로 실행하기 위해 ignored 검증용 Compose 설정과 프로젝트 레이블로 이번 컨테이너만 조회하도록 지정했습니다. 앱 계정 SELECT 1과 Docker healthy를 확인했습니다.

| 실제 실행 명령 | 결과 |
|---|---|
| gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon | V1~V31 적용, Flyway validate 통과. 신규 마이그레이션 없음 |
| gradlew.bat build integrationTest --no-daemon --rerun-tasks (1회, AUTH_CLIENT_IP_MODE 미설정) | 20 단위 + 76 통합 = 96개 통과, 실패/오류/건너뛰기 0, exit 0, 2분36초 |
| 동일 명령 (2회, AUTH_CLIENT_IP_MODE=ARBITRARY_IGNORED) | 96개 연속 통과, 실패/오류/건너뛰기 0, exit 0, 2분33초 |
| gradlew.bat integrationTest --tests '*DemoAuthIntegrationTest.failedLoginIsUniformAndNeverRateLimited' --no-daemon --rerun-tasks | 별도 API 반복 검증 1개 통과, exit 0. 실제 HTTP 동일 ID/출처로 35회 연속 실패 모두 401 INVALID_CREDENTIALS, Retry-After 없음, 직후 정상 비밀번호 200. 실패 감사 38건(없는 계정·오입력·비활성 3건 포함), 성공 감사 1건, LOGIN_LIMITED 증가 0 |

병렬 HTTP 실패 8건 모두 401·5xx 없음. 기존 차단 행 2개를 테스트 고유 키로 삽입한 경우에도 로그인 가능하고 제한 행 전체 내용 불변. 실제 MySQL 트랜잭션에서 DAO 감사 저장 장애를 주입해 실패·성공 로그인 모두 503 AUTH_UNAVAILABLE이며 토큰·감사 전체 롤백을 확인했습니다. CORS Retry-After 노출 헤더, 토큰·만료·로그아웃·권한·시드·수동 cleanup은 유지했습니다.

읽기 전용 비교: auth_login_limit 0→0→0→0(전/1회/2회/API), 데모 계정 4→4→4→4 및 계정 내용 집계 동일. 토큰·인증 감사·회차·원문 버전·블록·도메인 감사·배정·번역 버전·번역 블록·결정·발행 각각 0 유지. Flyway 성공 31 유지. 테스트 행만 정확히 정리했습니다. 기존 비어 있지 않은 제한 행 불변은 고유 키 픽스처 테스트로 별도 확인했고 개발 DB의 기존 88행은 조회·수정하지 않았습니다.

변경·삭제한 기존 단언(제한 정책 대체만):
- AuthUnitTest.localIpAndFiniteLifetimeAreRequired → finiteLifetimeAndIgnoredClientIpSetting: IP 정책 미승인 기동 거부를 미설정/임의 값 허용으로 대체, TTL 경계 유지. auditFailureRollsBackFailedLoginAndLogout 및 databaseAndDeniedAuditFailureCannotAllowAccess는 login 함수의 remoteAddress 제거에 따른 호출 변경과 더 이상 존재하지 않는 lockLimit mock 제거뿐이며 503/롤백 단언 유지.
- DemoAuthIntegrationTest.failedLoginIsUniformAndLimitBoundariesReset → failedLoginIsUniformAndNeverRateLimited: 5회 차단·429·Retry-After=900·899/900초 경계·성공 ID 카운터 초기화를 반복 401/직후200·제한 행 불변·요청별 감사로 대체. 기존 없는 계정/오입력 응답 동일 검증 유지.
- simultaneousFailuresAreAtomic → simultaneousFailuresAreNeverRateLimited: 5건401+3건429·ID 카운터5를 8건 모두401·제한 행 불변·실패 감사8로 대체.
- ipLimitIsIndependentAndSuccessOnlyClearsId → existingBlockedLimitRowsRemainUntouched: IP30회 차단·시간 창·성공 시 ID만 초기화 단언을 기존 차단 행 무시 및 내용 불변으로 대체.
- unsupportedLoginMediaTypesDoNotChangeLimitsOrLeakDetails: ID/IP 카운터가1이라는 단언을 제한 테이블 전체 스냅샷 불변으로 대체. 비JSON400·정확한 오류JSON·no-store 단언 유지.
- 그 밖의 인증 단언과 EpisodeSource·Assignment·Translation·Review 테스트는 변경 없음. 신규 LoginAuditFailureIntegrationTest는 감사 장애503 및 실제 DB 롤백 검증.

초기 실행 실패도 구분합니다: 2026-10-06 사전 스키마 적용 누락으로 제약 테스트 11건 실패, 2026-10-07 재개 초기에는 Docker 데몬 연결 실패, 이후 첫 준비 실행은 MySqlIntegrationTest의 격리 Compose 대상 미지정으로 1건 실패했습니다. 검증 환경을 보정한 뒤 위 전체 명령이 연속 2회 통과했으며, 실패를 통과로 대체하지 않았습니다. 로그·XML·집계는 ignored backend/build/verification/login-no-limit-ef060f5에 보관했습니다. 비밀번호·토큰을 출력·README·Git에 기록하지 않았습니다. PROJECT_CONTEXT.md 줄바꿈 M과 상대 변경은 보존했습니다.

정리: 소유 컨테이너 ID를 대조해 docker stop --timeout 10으로 종료했으며 --rm으로 남은 컨테이너 0입니다. 별도 API·프런트 프로세스는 기동하지 않았습니다. 브라우저 검증은 사용자 결정에 따라 미실행·최종 통합으로 이월합니다.

### Publication 백엔드 검증 — CONTRACTS 20절 / D-048

Codex 직접 실행, 2026-10-07 07:28~07:36 KST. 승인 계약 0cb736c, 구현 시작 HEAD 5fb1992(로그인 제한 제거 검증·커밋 완료 이후). 프런트 9b828dd는 Claude Code가 별도 구현한 커밋이며 이번 프런트 테스트·브라우저 검증 결과로 간주하지 않습니다. Publication 코드 ba72394, 신규 통합 테스트 da8efba. 신규 마이그레이션 없으며 V1~V31·기존 인증/회차/원문/배정/번역/감수 테스트와 기존 API 응답 필드는 변경하지 않았습니다.

추가 API는 운영자의 POST /api/episodes/{id}/translations/{versionNo}/publish(본문 없음), GET /api/episodes/{id}/publication 및 인증 불필요 GET /api/public/episodes, GET /api/public/episodes/{id}입니다. 공개 경로는 Bearer 판정을 건너뛰고 CORS Origin 정책을 유지합니다. 발행은 회차 행 잠금 후 승인·결정·최신 원문 조건 검사, 상태/이력/포인터/감사를 한 트랜잭션으로 기록합니다. 독자 응답은 포인터의 번역 text·seq·pageNo, 회차 ID·제목·발행 시각만 반환합니다.

격리 MySQL 8.4.11, 127.0.0.1:3318/publication_verify, --rm/tmpfs 사용. PowerShell 5.1.26100.9444에서 DB/CORS/local 환경과 검증 전용 Compose 프로젝트를 주입했습니다. 스키마 준비는 기존 test classpath의 schemaMigrate 보조 task를 사용했으며 Flyway V31/validate 통과·추가 적용 0을 확인했습니다. 데모 4계정은 격리 DB에만 무작위 일회용 비밀번호로 시드하고 비밀번호 환경변수를 즉시 정리했습니다. 개발 DB 3306과 기존 8080/8081/3000·원본 frontend/.next·next-env.d.ts는 사용하거나 조작하지 않았고 별도 프런트/API 서비스도 띄우지 않았습니다(통합 테스트가 임의 포트의 실제 Spring HTTP 서버를 기동).

| 실행 명령 | 직접 실행 결과 |
|---|---|
| gradlew.bat build integrationTest --no-daemon --rerun-tasks (1회) | 20 단위 + 85 통합 = 105개 통과, 실패/오류/건너뛰기 0, exit 0, 2분43초 |
| 같은 명령 (2회, 동일 코드) | 105개 연속 통과, 실패/오류/건너뛰기 0, exit 0, 2분41초 |

신규 PublicationIntegrationTest 9개: 정상 발행의 정확한 응답·포인터·publication/감사1건, 승인 조건/없는 결정/무효 승인/미승인·기발행409, 원문 변경 후 승인 무효화409, 새 초안·검수·승인 중 공개 응답 유지 및 원문 변경 후 공개본 불변, 공개본 교체·이전 PUBLISHED 유지·history 순서·오래된 APPROVED 교체, 감사 저장 장애503와 실제 DB 전체 롤백(이전 포인터·상태·이력 보존), 동일 버전 동시 요청 정확히200 1건/409 1건, 운영자 API의 4역할+미인증·위조 거부·ACCESS_DENIED 감사, 공개 상세의 익명/4역할/만료·변조·잘못된 Authorization 동일200, 공개 목록의 공개본만·정렬·페이지·경계/잘못된 인자400, 미발행/미존재 동일404·정확한 공개 필드·계정/원문/상태/사유 비노출, 본문/깨진 JSON/비JSON400·경로 형식404·POST/PUT/DELETE405·허용 preflight200/비허용Origin403을 확인했습니다. DB 장애 검증은 DAO 예외 주입이며 실제 DB를 중단한 장애 테스트로 보고하지 않습니다.

읽기 전용 전후 비교(전/1회/2회): demo_account 4→4→4 및 모든 계정 내용 집계 동일, auth_login_limit 0→0→0, auth_token/auth_audit/episode/episode_source_version/source_block/domain_audit/episode_assignment/translation_version/translation_block/review_decision/publication 각0→0→0, Flyway 성공31 유지. 테스트가 만든 회차·계정·토큰·감사만 정확히 삭제했습니다. 기존 계정·데이터·제한 행은 수정하지 않았습니다. 비밀번호·토큰은 출력·Git·README에 기록하지 않았습니다. 운영 코드에서 원문/반려 사유/토큰을 로그에 추가하지 않았습니다.

초기 준비 단계에서 신규 테스트의 package-private hash 접근으로 compileTestJava가 실패해 신규 테스트 내부 SHA-256 픽스처 함수로 수정했습니다(기존 인증 운영 코드나 테스트 접근 범위 변경 없음). 수정 후 위 전체 명령이 연속2회 통과했습니다. 로그·XML·집계는 ignored backend/build/verification/publication-0cb736c에 보관했습니다.

정리: 소유 컨테이너 ID를 대조해 docker stop --timeout 10으로 종료했고 --rm으로 해당 컨테이너는 남지 않았습니다. 별도 API·프런트 프로세스가 없으며 Gradle --no-daemon 실행의 테스트 서버는 종료됐습니다. 기존 컨테이너·볼륨 삭제 없음. 남은 작업은 Claude Code의 코드 리뷰·API 점검과 이후 별도 요청의 마지막 브라우저 통합 검증(Review 수정4건·로그인 제한 제거·발행/독자 열람)입니다. 이번 브라우저·외부 배포·Vercel 검증은 미실행입니다. PROJECT_CONTEXT.md 줄바꿈 M은 그대로 보존했습니다.

### 최종 통합 실제 브라우저 검증 — CONTRACTS 18·19·20절

Codex 직접 실행, 2026-10-07 KST(정리 완료 09:06). 검증 기준은 5110b6f79568f77787d46279da24506e4ac62480이며 frontend 9b828dd·efd55cf가 포함됩니다. 소스·마이그레이션·계약은 수정하지 않았습니다. 이전 Claude Code API 검증이나 백엔드 통합 테스트 결과를 이번 브라우저 실행 결과로 대체하지 않았습니다. 이번에는 전체 Gradle 통합 테스트를 다시 실행하지 않았습니다.

환경: 일회용 MySQL 8.4.11, 3319/final_browser, --rm/tmpfs, V1~V31 적용. Spring 8090, 요청 메타데이터 전용 프록시 8089, 새 Next.js 3008. 프록시는 요청을 그대로 전달하고 메서드·경로·상태·Origin/CORS·Authorization 존재 여부·오류 코드·공개 JSON 필드 이름만 기록했습니다. 비밀번호·토큰 값·본문은 기록하지 않았습니다. CORS 허용 출처는 http://localhost:3008 하나이며 AUTH_CLIENT_IP_MODE는 설정하지 않았습니다. 브라우저는 Codex In-app Browser입니다.

PowerShell 5.1.26100.9444에서 README 방식으로 환경변수를 프로세스에 주입해 bootJar·시드·서버 기동 및 npm.cmd run build -- --webpack / next start --port 3008을 수행했습니다. 프런트는 git archive 5110b6f frontend로 만든 ignored 격리 사본에서 새로 빌드했습니다. BUILD_ID는 8ZwzwXAYV6CVOQl4ay2yv이고 app-paths-manifest에 /(public)/read/page, /(public)/read/[id]/page 및 검수·회차 경로가 존재합니다. 원본 frontend/.next/BUILD_ID와 next-env.d.ts SHA-256은 전후 동일했습니다. 브라우저 콘솔 실행/Network 패널 도구가 없어 실제 요청 증거는 위 프록시 기록으로 대체했습니다. 별도 API 보완 요청은 PowerShell HTTP 요청이며 브라우저 콘솔 실행으로 기록하지 않습니다.

격리 DB에 데모 4계정을 시드하고 reviewer2는 검증용 Java BCrypt helper로 해시를 만들어 INSERT했습니다(운영 코드/마이그레이션 변경 없음). 처음에는 사용자가 비밀번호와 로그인을 직접 입력했고, 이후 사용자가 비밀번호 통일과 자동 검증을 요청하여 격리 5계정에만 반영하고 자동 로그인했습니다. 비밀번호·해시는 README/Git/로그에 저장하지 않았습니다. 개발 DB 3306은 연결하거나 변경하지 않았습니다.

| 항목 | 직접 실행 결과 |
|---|---|
| A1 | 통과. UI 자동 조작으로 7회 연속 오입력 각각 같은 안내(로그인 ID 또는 비밀번호가 올바르지 않습니다), 차단·대기 안내 없음, 직후 정상 로그인 /demo. 독립 반복을 포함해 실제 401 INVALID_CREDENTIALS 14건, 429 0건, 제한 행 0 유지. 최초 사용자 완료 보고에는 실패 요청 기록이 없어서 통과 근거로 사용하지 않았음 |
| B1 | 통과. A v1·B v1 반려 사유의 40자 말줄임, 첫 40자 내 개행을 공백으로 합친 한 줄 요약, 전체 상세의 앞뒤 공백·개행 보존. 승인/결정 없는 버전에는 요약 없음 |
| B2 | 부분 실패(시나리오 기대와 표시 위치 차이). 승인 A v4를 열어 둔 상태에서 원문 수정·저장: 새로고침 없이 목록이 무효화됨으로 갱신되고 상세 닫힘은 통과. 무효화 시각은 닫힌 목록에 즉시 표시되지 않고 번역 v4 보기를 다시 눌러야 상세에 표시됨. 변경 없는 원문 저장은 번역 목록 GET 전후 4건으로 추가 요청 없음 |
| B3 | 통과. 승인 확인 중 원문 변경은 A v5 approve 409 currentStatus=INVALIDATED, 반려 확인 중 변경은 A v6 reject 동일 409. 두 안내가 함께 남고 병기·버튼·사유 입력 제거 |
| B4 | 통과. A v7 두 화면에서 승인/반려 확인 준비 후 reviewer2로 교체. 이전 담당자의 각 POST 404, 안내·목록 링크만 남음. 새 담당자가 같은 v7을 인계받아 승인 200 |
| C1 | 통과. 발행 전 공개본 없음, 승인된 행에만 발행 버튼 |
| C2 | 통과. 확인·취소 시 POST 0건, 확정 후 A v2 발행 200, 공개 버전·시각·표시·이력 1건·발행됨 |
| C3 | 통과. A v3 초안·제출·승인 중에도 공개 상세는 v2 내용·시각 유지 |
| C4 | 통과. v2 대체 확인 문구, v3 발행 후 이력 2건, 이전 v2 발행됨 유지, 공개 중 표시는 v3만 |
| C5 | 통과. 두 운영자 탭을 같은 v3 확인 단계에 둔 뒤 순차 확정: 첫 200·둘째 409 PUBLISHED와 안내·상태 갱신. 승인 A v4 확인을 열어 둔 채 다른 탭에서 원문 변경 후 확정: 409 INVALIDATED와 발행 불가 안내 |
| C6 | 부분 검증. 번역가·감수자·독자의 실제 /episodes/1은 운영자 안내만(발행 UI 없음). PowerShell로 별도 로그인한 각 역할의 publish 403 FORBIDDEN, 익명 401 AUTH_REQUIRED 및 허용 CORS 확인. 브라우저 콘솔의 동일 세션 토큰 요청은 미실행 |
| C7 | 통과. A v7 발행 확인 중 이번 Spring만 중지: 통신 오류·확인/취소 유지. 같은 환경으로 재기동해 DB health UP 확인 후 재시도 200, 이력 3건 |
| D1 | 통과. 비로그인 공개 목록에 A만 표시, 원문만 있던 B 및 이후 APPROVED B v2도 숨김, 링크 이동 |
| D2 | 통과. 공개 상세에 순서·페이지·번역·개행만 표시, HTML 태그 문자열 그대로, 원문·초안·상태·계정·사유 필드 없음 |
| D3 | 통과. 새 초안·제출·승인 및 원문 v2/v3/v4 저장 뒤에도 교체 발행 전 공개본 유지 |
| D4 | 통과. v3 교체 발행 후 새 번역 내용·시각 반영 |
| D5 | 통과. /read/2, /read/99999, /read/abc 동일 비공개 안내·목록 링크. abc에 대응하는 API 요청 0건. 승인만 된 B도 404 |
| D6 | 통과. 독자 /demo 링크로 공개 목록·상세 이동, 익명과 동일 공개 내용. 실제 프런트 공개 GET에 Authorization 없음(프록시 기록) |
| D7 | 부분 검증. 실제 http://127.0.0.1:3008/read의 비허용 Origin GET 403. PowerShell 보완에서 잘못된 Bearer·실제로 만료시킨 검증 토큰의 공개 GET 200(같은 만료 토큰 /me 401), 공개 POST 405, 비허용 Origin 403·허용 preflight 200. 브라우저 콘솔에서 인증 헤더를 직접 붙이는 검증은 미실행 |
| E1 | 통과. 검수 목록·병기·빈/501자 사유 화면 검증·반려·번역가 사유·새 버전 복사·재제출·승인·취소 POST 0건·운영자 결정/사유 상세 조회 |
| F1 | 통과(읽기 전용 DB와 관찰한 공개 응답). 승인 결정 5·반려 결정 2, 각 결정 1행. REVIEW_APPROVED 5·REVIEW_REJECTED 2·APPROVAL_INVALIDATED 1·TRANSLATION_PUBLISHED 3, 관련 감사 불일치 0. publication 3=현재 PUBLISHED 버전 3, 최신 포인터 불일치 0. domain_audit에 사유/본문 컬럼 없음. LOGIN_LIMITED 0·제한 0. 관찰한 공개 JSON 필드는 blocks/episodeId/pageNo/publishedAt/seq/text/title만 |

B2 재현: 운영자가 승인 A v4 상세를 열고 원문을 바꿔 저장하면 목록은 무효화됨으로 자동 갱신되고 상세는 닫히지만 무효화 시각은 보이지 않습니다. 같은 v4의 보기로 상세를 다시 열면 무효화 시각이 표시됩니다. 자동 갱신/상세 닫힘 및 18절의 상세 invalidatedAt 응답은 확인됐으며, 이번 시나리오의 즉시 시각 표시 기대와 UI 표시 위치가 다릅니다. 프런트 수정 또는 기대 범위의 최종 판단은 Claude Code/사용자에게 남깁니다. 코드 수정 없음.

자동화 한계: 비밀번호 초기 입력은 사용자 수행, 이후 사용자 추가 승인으로 자동 입력. 대부분 의미 기반 UI click/fill, 사용자 탭 일부는 Playwright DOM이 비어 AX 숫자 조작으로 수행했습니다. 브라우저 상태/visibility를 강제로 바꾸거나 평가 코드로 앱 상태·스토리지·fetch를 주입하지 않았습니다. 두 탭 발행/교체 검증은 확인 단계를 먼저 열고 순차 처리한 오래된 화면 충돌이며 동시 네트워크 부하 시험이 아닙니다. C6/D7의 PowerShell 보완은 PS7 HTTP 응답 판독으로 실행했고 PS5.1 브라우저 콘솔 검증이라고 보고하지 않습니다. 초기 보완 요청의 HTTP 오류 응답 판독이 실패한 뒤 -SkipHttpErrorCheck로 재실행했습니다(제품 결함 아님). 최초 사용자 감수자/운영자 로그인은 요청한 자동화 탭 대신 사용자 탭에서 수행되어 실제 역할을 확인 후 연결했습니다.

정리: PID·컨테이너 ID를 대조해 이번 API(재기동 후 12936)·프록시(48456)·격리 Next(30400)만 종료하고 일회용 컨테이너를 docker stop --timeout 10으로 종료했습니다. --rm 컨테이너 잔존 0, 검증 포트 리스너 0, 자동화 생성 탭만 닫고 사용자 탭은 보존했습니다. 초기/종료 기존 3306·8080·8081·3000 리스너와 실행 컨테이너는 모두 없었으며 기존 볼륨·컨테이너 삭제 없음. 개발 DB 행 수는 이번에는 읽지 않았으므로 전후 동일 검증으로 표시하지 않습니다(연결/변경 없음). 원본 빌드 산출물 동일, PROJECT_CONTEXT.md M 보존. 증거·핵심 승인/발행/공개 스크린샷은 ignored backend/build/verification/final-browser-5110b6f에 보관했습니다. 외부 배포·Vercel은 미검증입니다. 이번 기록만 별도 로컬 문서 커밋으로 남깁니다.

### 발행 보류·재개 백엔드 검증 — 2026-10-07 (Codex 직접 실행)

기준 계약: 64e0bd6의 CONTRACTS.md 21절·D-049. 병행 프런트 커밋 6fa45cf와 다음 노드 계약 초안 f35fffd를 보존하고, 백엔드 코드 a9b4877 및 테스트 810f66b를 로컬 커밋했습니다. 프런트·운영 Java의 다른 패키지·기존 마이그레이션은 수정하지 않았습니다. 보안 및 공통 오류 설정은 기존 PublicationController 적용 범위로 충분하여 변경하지 않았습니다. 공개 목록·상세 SQL도 변경하지 않았습니다.

환경: PowerShell 5.1.26100.9444, Docker Linux, MySQL 8.4.11. 이번 일회용 컨테이너 mangabridge-publication-hold-64e0bd6(--rm, tmpfs), 127.0.0.1:3320, publication_hold_verify 스키마만 사용했습니다. V1~V31 적용·Flyway validate 및 앱 계정 SELECT 1/Docker healthy 확인 후 무작위 임시 비밀번호로 데모 4계정을 시드했습니다. AUTH_CLIENT_IP_MODE는 설정하지 않았습니다. 개발 DB(3306)에 연결하거나 적용하지 않았고, 별도 API·프런트 서버 및 브라우저는 실행하지 않았습니다.

실행 명령(backend/ 작업 경로, process 환경변수로 위 격리 DB와 COMPOSE_PROJECT_NAME/COMPOSE_FILE 지정):

```powershell
.\gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon
.\gradlew.bat bootRun --args='--demo-auth-seed=true --spring.main.web-application-type=none' --no-daemon
.\gradlew.bat build integrationTest --no-daemon --rerun-tasks
.\gradlew.bat build integrationTest --no-daemon --rerun-tasks
```

최종 코드로 13:06~13:13 KST에 연속 2회 실행했습니다. 각각 종료 코드 0, BUILD SUCCESSFUL(2m 49s / 2m 50s), 테스트 113개(단위 20 + 실제 MySQL 통합 93), 실패·오류·skipped 모두 0입니다. 이번 신규 PublicationLifecycleIntegrationTest 8개는 정상 보류·재개와 응답/시각/감사, 포인터 없는 상태 및 반복 충돌, 보류 중 원문 변경 후 재개, 다른 승인본으로 교체, 동시 hold/resume 각 1건 성공, 감사 장애 전체 롤백, 역할/위조/미인증, 경로·본문·비JSON·CORS를 검증합니다. 보류 시 공개 목록 제외 및 미발행과 동일한 상세 404, 재개 시 같은 본문과 새로운 publishedAt, history 증가를 실제 DB로 확인했습니다.

기존 테스트 변경은 PublicationIntegrationTest.publicationAndPublicFieldsMatchExactVersionAndAudit 한 곳의 필드 목록에 held 추가, 발행 전/후 held:null 검증 2개 추가뿐입니다. 그 외 기존 단언 및 인증·회차·배정·번역·감수 테스트는 변경하지 않았습니다.

검증 전/첫 성공 후/두 번째 성공 후: demo_account 4/4/4(전체 내용의 집계 해시 동일), auth_login_limit 0/0/0(내용 동일), auth_token·auth_audit·episode·episode_source_version·source_block·domain_audit·episode_assignment·translation_version·translation_block·review_decision·publication 모두 0/0/0. Flyway 성공 이력 31/31/31. 테스트 자체 생성 행만 정리했고 세 읽기 전용 스냅샷이 정확히 일치했습니다. 개발 DB 전후 행 수는 조회하지 않았으므로 미검증입니다(연결·변경 없음).

초기 신규 테스트 실행은 테스트의 JDBC 시각 단언에서 LocalDateTime을 Timestamp로 캐스팅해 1건 실패했습니다. 시각 조회 수정 중 compileTestJava 타입 추론 오류도 1회 발생했으며 해당 실행에는 테스트 결과가 없습니다. 명시적 Instant 조회로 테스트 코드를 수정한 뒤 위 2회 연속 통과를 새 XML 결과로 확인했습니다. 초기 실패와 컴파일 오류를 성공 결과로 재사용하지 않았습니다. 증빙은 ignored backend/build/verification/publication-hold-64e0bd6의 로그·XML·스냅샷에 보관했습니다.

정리: ID와 이름 대조 후 이번 컨테이너만 docker stop --timeout 10으로 종료(종료 코드 0, --rm 자동 정리). 검증 포트 3320 리스너 0, 기존 3306·8080·8081·3000 리스너도 종료 시 0. 기존 vibe-coding-project-mysql-1 컨테이너는 보존했고 기존 컨테이너·볼륨 삭제나 서비스 종료는 수행하지 않았습니다. 비밀번호·토큰 값은 문서/커밋에 포함하지 않았고 PROJECT_CONTEXT.md의 M 상태를 보존했습니다. 실제 브라우저 연동은 이번 범위에서 미실행이며 10/12 최종 통합 검증으로 이월합니다.

### 블록별 감수 코멘트 백엔드·V32 — 2026-10-07 (Codex 직접 실행)

승인 기준: 5a1da8d의 CONTRACTS.md 22절·D-050 및 1e2f20c의 22.1 정정. V32(276a79b)는 review_block_comment 한 테이블을 CREATE하는 DDL 하나이며, 6컬럼 모두 NOT NULL, InnoDB·utf8mb4·DATETIME(6), 본문 길이 CHECK와 결정/seq UNIQUE 및 요청한 RESTRICT FK 2개를 둡니다. V1~V31 파일은 변경하지 않았습니다.

결정과 코멘트의 번역 버전 일치는 **DB 복합 FK가 아닌 서비스 검사로 보장**합니다. INSERT 전에 실제 결정 행을 조회해 translation_version_id와 REJECTED 여부를 확인하며, 불일치는 쓰기 없이 전체 롤백/503입니다. 검증 테스트: ReviewBlockCommentIntegrationTest.serviceRejectsDecisionVersionMismatchBeforeAnyCommentInsert(다른 번역 버전의 실제 결정 ID를 주입, INSERT 미호출 및 결정·상태·감사·코멘트 불변 확인). 코멘트 N건은 결정 INSERT·상태·REVIEW_REJECTED 감사와 같은 트랜잭션이며, 일부 INSERT 후 장애도 모두 롤백합니다.

반려 요청의 선택 comments와 상세 3곳의 blockComments만 가산 확장했습니다. 본문 변환 없이 0~50개·실제 번역 블록 seq·중복 금지·1~300 코드포인트·공백/제어문자 제한을 검사합니다. 상세는 현재 배정된 번역가·감수자와 운영자에게만 seq 오름차순으로 반환하고, 비반려 버전은 항상 []입니다. 목록·공개 응답과 새 DRAFT에는 코멘트를 추가/복사하지 않았습니다. 승인 본문 금지·기존 보안/CORS/오류 설정은 그대로입니다. 입력/코멘트 DTO의 toString은 본문을 가립니다.

환경: PowerShell 5.1.26100.9444, Docker Linux, MySQL 8.4.11. mangabridge-review-comments-1e2f20c(--rm, tmpfs), 127.0.0.1:3321, review_comment_verify 스키마만 사용했습니다. 앱 계정 SELECT 1 및 Docker healthy 확인 후 V1~V32 적용·Flyway validate, 임시 무작위 비밀번호로 데모 4계정 시드. 개발 DB(3306)는 연결·조회·V32 적용하지 않았습니다. AUTH_CLIENT_IP_MODE 미설정. 실제 브라우저와 별도 프런트/API 서버는 이번 범위에서 미실행입니다.

backend/에서 격리 DB_URL 및 COMPOSE_PROJECT_NAME/COMPOSE_FILE을 process 환경에 주입해 실행한 명령:

```powershell
.\gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon
.\gradlew.bat bootRun --args='--demo-auth-seed=true --spring.main.web-application-type=none' --no-daemon
.\gradlew.bat build integrationTest --no-daemon --rerun-tasks
.\gradlew.bat build integrationTest --no-daemon --rerun-tasks
```

최종 테스트 코드로 13:27~13:34 KST에 연속 2회 실행: 각각 종료 코드 0, BUILD SUCCESSFUL(3m 18s / 3m 13s), 총 124개(단위 20 + 실제 MySQL 통합 104), 실패·오류·skipped 모두 0. 신규 코멘트 통합 테스트 10개: 선택/빈 의견, N개 및 50개·300코드포인트 경계와 원문만 있는 seq 거부, 검증 오류·상태 불변, 버전 일치 서비스 방어, 부분 저장 장애 롤백, 중복/동시 반려·승인, 상세·목록 범위, 새 DRAFT 복사 제외, 담당자 교체 인계/기존 담당자 404, 독자·비배정·공개 비노출, 역할/위조/비JSON 및 실제 NOT NULL·CHECK·UNIQUE·FK·RESTRICT 검사. 기존 NOT NULL lint도 그대로 통과했습니다. 빈 DB V1~V32 및 데이터가 있는 V31→V32에서 validate/재적용 0개·기존 행/내용·V1~V31 체크섬 보존을 검증했습니다.

기존 단언/설정 변경 목록(그 외 업무 테스트 단언은 유지):

- TranslationIntegrationTest.creationDetailListNoopRevisionAndSubmissionFollowExactContract: 번역가 상세 필드 목록 1곳에 blockComments 및 [] 검증 추가.
- ReviewIntegrationTest.reviewerVisibilityAndOperatorAllStatesAndPaths: 감수자·운영자 상세 필드 목록 2곳에 blockComments 및 [] 검증 추가.
- MySqlIntegrationTest.mysqlHealthAndBaseline: 최신 Flyway 기대값 31→32. mysqlCharsetCollationUtcDedicatedAccountAndInnoDb: 승인 테이블 목록에 review_block_comment만 추가.
- DomainSchemaMigrationIntegrationTest: 빈 DB 기대 이력/적용 수 31→32, populatedV9UpgradePreservesEveryOldColumnAndChecksum의 적용 수 22→23. v31PreservesAllPopulatedV30RowsAndAddsRequiredRevisionDefault는 target(31)을 명시해 기존 모든 단언 유지. v32PreservesAllPopulatedV31RowsAndChecksums를 신규 추가.

초기 전체 실행은 124개 중 4건 실패: Bootstrap의 V31 버전/테이블 기대값 2곳, 새 테스트의 auth_audit.reason(기존 고정 코드 컬럼) 오인 1곳, MySQL CHECK 3819가 UncategorizedSQLException으로 번역되는 경우의 예외 분류 1곳. 최신 스키마 기대값을 갱신하고 신규 테스트를 수정했으며 MySQL 오류 번호 단언은 유지했습니다. 수정 후 위 2회 성공만 완료 결과로 사용했습니다. 초기 실패 후에도 정리 스냅샷은 기준과 일치했습니다.

검증 전/첫 성공 후/두 번째 성공 후: demo_account 4/4/4(전체 내용의 집계 해시 동일), auth_login_limit 0/0/0(내용 동일), auth_token·auth_audit·episode·episode_source_version·source_block·domain_audit·episode_assignment·translation_version·translation_block·review_decision·publication·review_block_comment 모두 0/0/0. Flyway 성공 이력 32/32/32. 세 스냅샷이 정확히 같으며 테스트가 만든 행만 정리했습니다. 개발 DB 전후 행 수는 미검증(연결/변경 없음).

커밋 관계: V32는 276a79b, 테스트는 6cd5835. Codex가 작성해 stage한 백엔드 Java 6개(review/translation의 Dao·Models·Service)가 공유 작업 트리의 병행 프런트 커밋 1a75e64에 함께 포함됐습니다. 별도 코드 커밋을 시도할 때 이미 포함된 것을 확인했고, 이력 재작성 없이 해당 커밋을 보존했습니다. 프런트 파일은 Codex가 수정하지 않았으며 프런트 테스트 결과로 이 백엔드 검증을 대신하지 않았습니다. 이후 테스트/문서는 대상 파일만 stage·즉시 --only 커밋했습니다.

정리: ID·이름을 대조한 이번 MySQL만 docker stop --timeout 10으로 종료(코드 0, --rm 자동 정리). 검증 포트 3321 리스너 0, 기존 3306·8080·8081·3000 리스너도 종료 시 0. 기존 vibe-coding-project-mysql-1 컨테이너·볼륨은 보존했습니다. 임시 환경변수는 실행한 PS 프로세스 종료로 소멸, 비밀번호·토큰 값은 문서/Git에 포함하지 않았습니다. PROJECT_CONTEXT.md의 줄바꿈 M 보존. 증빙은 ignored backend/build/verification/review-comments-1e2f20c의 로그·XML·스냅샷에 보관했습니다. 실제 브라우저 연동은 10/12 통합 검증으로 이월, 개발 DB V32 적용은 별도 사용자 승인 전까지 미적용입니다.

### 작업 이력 조회 백엔드 — 2026-10-07 (Codex 직접 실행)

기준: 460ebf1의 CONTRACTS.md 24절·D-052. 병행 프런트 커밋 47e46a0은 보존했고 frontend/는 수정하거나 검증하지 않았습니다. 코드 519b611(신규 history의 Controller·Service·DAO·Models·Failure 및 AuthSecurity/AuthErrors 등록), 신규 테스트 a08a069. 기존 테스트·V1~V32·인덱스는 변경하지 않았습니다.

GET /api/history는 OPERATOR 전용이며 domain_audit의 허용된 메타데이터만 SELECT합니다. actor/ASSIGNED subject는 id·displayName만, 번역 이벤트는 내부 번역 ID 대신 회차 안 version_no를 반환하고, 제목은 현재 회차 제목입니다. 원문·번역 본문·반려 사유·블록 코멘트·토큰·IP·auth_audit를 조회 응답에 포함하지 않습니다. occurred_at DESC, id DESC로 정렬하고 회차·이벤트 필터 후 total/페이지를 계산합니다. 미정의/반복 쿼리·잘못된 값은 400, 없는 회차는 빈 목록 200. 본문 있는 GET은 JSON/비JSON 모두 무시합니다(24.1). readOnly 트랜잭션이며 조회 시 감사 행을 만들거나 갱신하지 않습니다. 다른 역할은 기존 ACCESS_DENIED 인증 감사를 기록한 뒤 403, 비로그인은 401. DB 장애는 상세 없는 503 SERVICE_UNAVAILABLE, Cache-Control: no-store 및 기존 오류 형식 유지.

환경: PowerShell 5.1.26100.9444, Docker Linux, MySQL 8.4.11. mangabridge-history-460ebf1(--rm, tmpfs), 127.0.0.1:3322, history_verify만 사용했습니다. 앱 계정 SELECT 1 및 Docker healthy 확인, 변경 없는 V1~V32 적용·validate 후 무작위 임시 비밀번호로 데모 4계정 시드. 개발 DB(3306) 연결·조회·변경 없음. AUTH_CLIENT_IP_MODE 미설정. 별도 API/프런트 서버나 실제 브라우저는 미실행이며 테스트 서버는 RANDOM_PORT입니다.

backend/에서 process 환경변수 DB_URL·DB_USERNAME·DB_PASSWORD·CORS_ALLOWED_ORIGINS 및 격리 COMPOSE_PROJECT_NAME/COMPOSE_FILE을 주입한 실제 명령:

```powershell
.\gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon
.\gradlew.bat bootRun --args='--demo-auth-seed=true --spring.main.web-application-type=none' --no-daemon
.\gradlew.bat build integrationTest --no-daemon --rerun-tasks
.\gradlew.bat build integrationTest --no-daemon --rerun-tasks
```

연속 전체 실행 2회: 첫 실행 14:14:13~14:17:35 KST, 사용자 재개 후 두 번째 18:55:22~18:58 KST. 각각 종료 코드 0, BUILD SUCCESSFUL(3m 22s / 3m 21s), 총 132개(단위 20 + 실제 MySQL 통합 112), 실패·오류·skipped 0. 두 실행 사이 백엔드 코드·테스트 내용 변경 없음. 신규 HistoryIntegrationTest 8개는 실제 생성→원문→배정→번역→반려/코멘트→재제출/승인→원문 변경/승인 무효화→새 승인본 발행→보류/재개로 11종 이벤트를 검증했습니다. 필드 정확 일치·현재 제목·계정 최소 필드·sourceVersion·translationVersionNo·subject·민감 내용/인증 감사 비노출 및 조회 전후 domain_audit/auth_audit 전체 행 내용 불변 확인. 정렬 동률·페이지 1/50/100·초과/매우 큰 offset·필터 조합·빈 목록·반복/미정의 쿼리·nullable 참조·역할 매트릭스/헤더·본문 위조·안전한 503(쿼리 장애 및 실제 연결 불가)·허용 CORS도 통과했습니다. GET 본문 검증은 JDK HttpClient로 실제 본문을 전송하여 JSON·text/plain·form 및 깨진 JSON도 무시되는지 확인했습니다. 기존 회귀 테스트 파일은 변경하지 않았습니다.

검증 전/첫 실행 후/두 번째 후: demo_account 4/4/4(전체 내용의 집계 해시 동일), auth_login_limit 0/0/0(내용 동일), auth_token·auth_audit·episode·episode_source_version·source_block·domain_audit·episode_assignment·translation_version·translation_block·review_decision·publication·review_block_comment 모두 0/0/0. Flyway 성공 이력 32/32/32. 스냅샷 정확 일치. 테스트가 만든 계정·회차·버전·블록·결정·코멘트·발행·감사·토큰만 정리하며 기존 데이터/공유 IP 제한 키를 변경하지 않습니다. 개발 DB 전후 행 수는 미검증(연결/변경 없음).

커밋 직전 git diff --cached --name-only 및 --check로 대상 목록/혼입 여부를 확인하고, 명시적으로 지정한 파일만 stage 후 즉시 git commit --only로 코드·테스트·README를 분리했습니다. 코드/테스트 staged 목록은 각각 7개/1개 대상과 일치했고 다른 파일 혼입 없음. PROJECT_CONTEXT.md M은 수정·stage·restore하지 않았습니다. 비밀번호·토큰 값은 문서/Git에 넣지 않았으며 임시 환경변수는 실행한 PS 프로세스 종료로 소멸했습니다.

정리: 이름·ID를 대조한 이번 MySQL만 docker stop --timeout 10으로 종료(코드 0, --rm 자동 정리), 3322 및 기존 3306·8080·8081·3000 리스너 0. 기존 vibe-coding-project-mysql-1 컨테이너·볼륨 보존, 기존 서비스 종료·push·이력 재작성 없음. 증빙은 ignored backend/build/verification/history-460ebf1의 로그·XML·스냅샷에 보관했습니다. 발견된 백엔드 결함/미해결 사항 없음. 실제 브라우저·프런트 연동은 이번 범위에서 미검증이며 10/12 최종 통합 검증으로 이월합니다.

### AI 번역 초안 설정 (CONTRACTS.md 25절, D-053)

서버의 `POST /api/my/episodes/{id}/translations/{versionNo}/ai-draft`는 현재 배정된 번역가의 최신 원문을 사용하는 DRAFT에서만 제안을 반환합니다. 제안은 저장·제출되지 않으며 번역 블록·상태·revision도 바꾸지 않습니다. 비어 있는 블록만 원문 순서로 최대 50개를 보내며, 채울 블록이 없으면 호출과 감사 없이 빈 제안을 반환합니다. 같은 계정·같은 버전의 처리 중 요청은 409로 거절합니다.

| 서버 환경변수 | 비어 있거나 미설정일 때 | 허용 범위·용도 |
|---|---|---|
| AI_PROVIDER | mock | mock 또는 anthropic |
| AI_API_KEY | 없음 | anthropic 호출에만 필요; 사용자만 서버 프로세스에 비공개로 주입 |
| AI_MODEL | claude-haiku-4-5-20251001 | anthropic 모델 ID; 설정으로 변경 가능 |
| AI_TIMEOUT_SECONDS | 30 | 1~120초; 연결·요청·응답 본문 전체 대기 제한 |
| AI_MAX_OUTPUT_TOKENS | 2048 | 128~8192; Messages 요청의 max_tokens |

backend/.env.example의 AI 값은 모두 비어 있습니다. Spring은 이 파일을 자동으로 읽지 않으므로 README 2절과 같이 PowerShell 5.1 프로세스 환경에 필요한 값을 주입합니다. 기본 mock은 외부 연결 없이 결정적인 `[AI 초안] ` 제안을 만듭니다. 실제 키를 .env.example·NEXT_PUBLIC 변수·채팅·Git·로그에 넣지 마세요. anthropic은 사용자가 서버 프로세스에 키를 설정했을 때만 사용하며 원문이 외부로 전송되므로 데모 데이터로만 수동 확인합니다.

설정 범위 오류·미지원 제공자·anthropic 키 누락은 앱 기동을 막지 않으며 AI 요청만 503 AI_UNAVAILABLE입니다. 감사 저장 실패는 AI 호출 없이 503 SERVICE_UNAVAILABLE입니다. 호출 전 AI_DRAFT_REQUESTED를 별도 트랜잭션으로 커밋하고 DB 잠금을 해제한 뒤 한 번만 호출하며 재시도하지 않습니다. 원문·제안·프롬프트·키는 감사/로그에 넣지 않습니다. 번호 밖/검증 실패 제안은 개별 폐기하며 남은 제안은 변환 없이 seq 순서로 반환합니다.

HTTP 구현은 Java 17 HttpClient와 기존 Jackson을 사용합니다(추가 의존성 없음). API 경로·버전 헤더·max_tokens 및 모델 ID는 [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)와 [공식 API 안내](https://platform.claude.com/docs/en/claude_api_primer)를 대조했습니다. 이 대조는 문서 확인이며 실제 제공자 호출 검증이 아닙니다.
### AI 번역 초안 백엔드 검증 — 2026-10-07 (Codex 직접 실행)

승인 기준: ecbde74의 CONTRACTS.md 25절·D-053. 구현 코드 9ba4fdc, 테스트 269d06d를 포함한 백엔드로 검증했습니다. 새 ai 패키지 6개와 AuthErrors의 새 컨트롤러/오류 등록, backend/.env.example의 빈 변수 5개 및 신규 테스트 3개만 변경했습니다. 기존 보안 규칙 `/api/my/episodes/*/translations/**`가 TRANSLATOR만 허용하므로 보안/CORS는 변경하지 않았습니다. 기존 통합 테스트 파일·API 응답·V1~V32·계약 문서·frontend는 변경하지 않았고, PROJECT_CONTEXT.md의 기존 줄바꿈 M도 수정·stage·restore하지 않았습니다.

환경: PowerShell 5.1.26100.9444, Docker Linux, 실제 MySQL 8.4.11. mangabridge-ai-draft-ecbde74(--rm, tmpfs), 127.0.0.1:3323, ai_draft_verify만 사용했습니다. 앱 계정의 실제 SELECT 1과 Docker healthy 확인 후 변경 없는 V1~V32 적용·Flyway validate, 프로세스에서 생성한 비공개 임시 비밀번호로 데모 계정 4개 시드. 개발 DB(3306)는 연결·조회·변경하지 않았으며 별도 API·프런트 서버는 띄우지 않았습니다(통합 테스트는 RANDOM_PORT).

backend/에서 격리 DB_URL·DB_USERNAME·DB_PASSWORD·CORS_ALLOWED_ORIGINS·local 프로파일과 격리 COMPOSE_PROJECT_NAME/COMPOSE_FILE을 PowerShell 프로세스 환경에 주입해 실행한 실제 명령:

```powershell
.\gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon
.\gradlew.bat bootRun --args='--demo-auth-seed=true --spring.main.web-application-type=none' --no-daemon
.\gradlew.bat build integrationTest --no-daemon --rerun-tasks
.\gradlew.bat build integrationTest --no-daemon --rerun-tasks
```

최종 코드로 연속 2회: 19:51:37~19:55:19 KST(3m 40s), 19:56:05~19:59:42 KST(3m 37s). 각각 종료 코드 0, BUILD SUCCESSFUL, **152개(단위 29 + 실제 MySQL 통합 123)**, 실패·오류·skipped 모두 0. 두 실행 사이 코드·테스트 내용 변경 없음. 앞서 예비 전체 실행 150개도 통과했으나, 응답 본문 전체 제한시간과 잘못된 설정의 실제 기동 테스트를 추가했으므로 완료 기준은 위 최종 152개 연속 2회입니다.

신규 AiIntegrationTest 10개: 빈/공백 번역만·원문 순서 50개 상한, 채울 블록이 없으면 AI/감사 미호출(anthropic 키 없이도 빈 응답), 버전 상태·최신 원문 검사, 잘못된 경로·없는 버전·미배정/교체 후 404, 4역할/비로그인·헤더/본문 위조·ACCESS_DENIED 감사, 본문/비JSON 400, 처리 중 중복 409와 currentStatus 생략·중복 감사 없음·종료 후 재요청, DB/감사 장애 503 및 AI 미호출, 잘못된 설정/제공자 실패의 안전한 503와 성공/실패 요청별 감사, 잘못된/요청 밖 제안 개별 폐기·seq 정렬·공백/줄바꿈 보존을 실제 HTTP·MySQL로 확인했습니다. 번역 버전 전체 행·블록 전체 행을 전후 대조해 상태/revision/본문 불변과 감사의 메타데이터만 저장됨을 확인했습니다.

AiConfigurationIntegrationTest 1개: anthropic 키 누락 및 범위 밖 값으로 실제 Spring 앱을 기동하고 DB health 200, AI 설정 접근 시 AI_UNAVAILABLE를 확인했습니다. AiAdapterTest 9개는 loopback 가짜 HTTP 서버만 사용해 mock 결정성/Unicode 최대 길이, 실제 요청의 모델·max_tokens·번호별 원문·한국어/주입 방어 지시, 설정 경계, 외부 장애/연결 실패·시간 초과(헤더 지연 및 본문 지연)·잘못된/중복/후행 JSON의 안전한 실패, 재시도 없음, 항목별 형식 검증과 텍스트/키 레코드 toString 가림을 확인했습니다. 실제 외부 AI 요청·실제 API 키 사용은 **미실행**입니다.

검증 전/최종 첫 성공 후/최종 두 번째 후: demo_account 4/4/4(전체 기존 내용의 집계 해시 동일), auth_login_limit 0/0/0(내용 동일), auth_token·auth_audit·episode·episode_source_version·source_block·domain_audit·episode_assignment·translation_version·translation_block·review_decision·publication·review_block_comment 모두 0/0/0, Flyway 성공 이력 32/32/32. 세 스냅샷 정확 일치. 테스트가 만든 계정·회차·번역·토큰·감사 등만 정리했으며 데모 계정과 기존 데이터는 보존했습니다. 개발 DB 전후 행 수는 미검증(연결/변경 없음).

코드 8개·테스트 3개·README 각각의 커밋 직전 git diff --cached --name-only 및 --check로 명시한 대상과 혼입 여부를 확인했습니다. 실제 키는 입력·사용·저장하지 않았고 변경 파일/빌드 로그의 실제 키 패턴 검사 0건, AI 예시 변수의 비어 있지 않은 값 0개, 테스트용 가짜 키의 빌드 로그 출력도 없었습니다. 가짜 키는 실제 인증 정보가 아닌 테스트 픽스처입니다. 임시 시드 비밀번호는 finally에서 환경변수 삭제 후 PS 프로세스 종료로 소멸했습니다.

정리: 이름·ID가 일치하는 이번 컨테이너만 docker stop --timeout 10으로 종료(코드 0, --rm 자동 정리). 3323 리스너 0, 기존 3306·8080·8081·3000 리스너도 종료 확인 시 0이며 기존 서비스 종료 조작 없음. 기존 vibe-coding-project-mysql-1 컨테이너·볼륨 보존. 증빙은 ignored backend/build/verification/ai-draft-ecbde74의 로그·XML·스냅샷에 보관했습니다. push·이력 재작성 없음. 백엔드 미해결 사항 없음. 실제 브라우저/mock 연동은 10/12 통합 검증, 실제 anthropic 연동은 사용자 키 설정 후 수동 검증으로 이월합니다.

### 페이지 이미지 백엔드 검증 — 2026-10-07 실행 / 2026-10-08 기록 (Codex 직접 실행)

승인 기준: c016d34의 CONTRACTS.md 26절·D-054 및 사용자가 추가 승인한 V32 업그레이드 테스트의 target("32") 고정. 마이그레이션 1df4626, 백엔드 코드 9ac3c53, 테스트 88c4891로 분리했습니다. 프런트의 병행 커밋 20e4424·b4bae04는 보존했으며 이번에 프런트 빌드·브라우저 검증은 실행하지 않았습니다.

V33은 CREATE TABLE 한 문장으로 source_page_image를 추가합니다. 7개 컬럼 모두 NOT NULL, PK(episode_id,page_no), 형식·바이트 크기·페이지 범위 CHECK 3개, episode와 demo_account를 참조하는 RESTRICT FK 2개, InnoDB·utf8mb4·DATETIME(6), content_type은 ascii/ascii_bin입니다. V1~V32 파일 변경 0개이며 기존 스키마 NULL 허용 목록 lint도 통과했습니다.

신규 page 패키지 5개는 운영자 업로드·목록·바이트 조회와 현재 배정된 번역가·감수자의 목록·바이트 조회를 제공합니다. PNG·JPEG·WEBP 매직 넘버와 1~5 MiB를 검사하며, 업로드는 최신 원문에 있는 페이지에만 허용합니다. 원문에서 페이지가 사라져도 기존 이미지는 읽을 수 있습니다. 저장·교체와 PAGE_IMAGE_SAVED 감사는 회차 잠금 이후 같은 트랜잭션에서 수행합니다. 보안 규칙·공통 오류 등록·이력 event 허용 목록만 확장했고 기존 API 필드와 CORS 설정은 유지했습니다. 응답은 no-store, 이미지에는 nosniff가 적용됩니다.

환경: PowerShell 5.1.26100.9444, Docker Linux, 실제 MySQL 8.4.11. 이번 일회용 mangabridge-page-c016d34(--rm, tmpfs), 127.0.0.1:3324/page_verify만 사용했습니다. 앱 계정 SELECT 1·healthy 확인, V1~V33 적용과 Flyway validate 후 프로세스에서 생성한 비공개 임시 비밀번호로 데모 4계정을 시드했습니다. 개발 DB(3306)는 연결·조회·변경하지 않았고 V33을 적용하지 않았습니다. 별도 API·프런트 서버는 띄우지 않았습니다(통합 테스트 RANDOM_PORT).

README 2절과 같이 PowerShell 5.1 프로세스 환경에 격리 DB_URL·DB_USERNAME·DB_PASSWORD·CORS_ALLOWED_ORIGINS·local 프로파일과 격리 COMPOSE_PROJECT_NAME/COMPOSE_FILE을 주입했습니다. 실제 실행 명령(backend/):

```powershell
.\gradlew.bat -I build/verification/schema-tool.init.gradle schemaMigrate --no-daemon
.\gradlew.bat bootRun --args='--demo-auth-seed=true --spring.main.web-application-type=none' --no-daemon
.\gradlew.bat integrationTest --tests "*PageIntegrationTest" --no-daemon --rerun-tasks
.\gradlew.bat build integrationTest --no-daemon --rerun-tasks
.\gradlew.bat build integrationTest --no-daemon --rerun-tasks
```

최종 코드로 2026-10-07 22:25:51~22:29:39 KST(3m 47s), 22:29:47~22:33:32 KST(3m 45s) 연속 2회 성공했습니다. 각각 종료 코드 0, BUILD SUCCESSFUL, **165개(단위 32 + 실제 MySQL 통합 133)**, 실패·오류·skipped 모두 0입니다. 두 실행 사이 소스·테스트 내용 변경은 없었습니다. 앞선 예비 실행은 V32 테스트 대상 미고정 및 초과 요청 클라이언트 전송 오류로 실패했고, 다음 시도는 Gradle의 stop command received로 중단됐습니다. 이들은 완료 결과에 포함하지 않았습니다.

신규 PageIntegrationTest 10개와 PageBodyLimitTest 3개가 PNG·JPEG·WEBP 바이트 왕복, 신규 201·교체 200, 정렬·정확한 메타 필드, 4역할/비로그인·헤더 위조·ACCESS_DENIED 감사, 미배정/교체 후 404와 새 담당자 인계, 공개 응답의 이미지·존재 비노출, 원문 변경 후 이미지 유지, 감사 장애 롤백·안전한 DB 장애 503, 동시 교체, 실제 NOT NULL·CHECK·PK·FK 제약을 확인했습니다. 실제 업로드 픽스처로 GET /api/history?event=PAGE_IMAGE_SAVED를 확인했고 HistoryIntegrationTest는 변경하지 않았습니다. 빈 DB 전체 적용 및 데이터가 있는 V9 업그레이드에서 기존 행·체크섬 보존, validate·재실행 추가 적용 0개를 기존 마이그레이션 테스트로 확인했습니다.

5 MiB(5,242,880바이트) 실제 HTTP 업로드는 201이며 조회 바이트가 정확히 같습니다. 5 MiB+1의 Content-Length는 본문 전송 전에 400 INVALID_REQUEST이며 기존 이미지·감사 불변을 확인했습니다. 이 사전 거부는 HTTP 소켓에서 헤더를 먼저 보내 응답을 읽는 방식으로 검증했습니다. 고수준 HTTP 클라이언트는 큰 본문 전송 중 서버가 먼저 거부하면 전송 오류를 낼 수 있어 해당 방식으로 대체했습니다. 본문 스트림 미개방과 길이 미정 스트림의 최대 5 MiB+1 읽기는 별도 단위 테스트로 확인했습니다. 실제 브라우저의 초과 파일 전송은 미검증입니다. 격리 DB의 max_allowed_packet은 67,108,864바이트였으며 설정 변경은 하지 않았습니다.

기존 테스트 변경 목록(이 외 기존 단언 변경 없음):

| 파일·테스트 | 변경·이유 |
|---|---|
| MySqlIntegrationTest.mysqlHealthAndBaseline | 최신 버전 32→33 |
| MySqlIntegrationTest.mysqlCharsetCollationUtcDedicatedAccountAndInnoDb | 허용 테이블에 source_page_image 추가 |
| DomainSchemaMigrationIntegrationTest.emptyDatabaseMigratesAllThirtyTwoAndValidatesTwice | 전체 적용·이력 수 32→33(기존 메서드명 유지) |
| DomainSchemaMigrationIntegrationTest.populatedV9UpgradePreservesEveryOldColumnAndChecksum | 적용 수 23→24 |
| DomainSchemaMigrationIntegrationTest.v32PreservesAllPopulatedV31RowsAndChecksums | 추가 사용자 승인에 따라 upgrade에 target("32")만 추가; 적용 1개 및 모든 기존 단언 유지 |

검증 전/최종 첫 성공 후/최종 두 번째 후 스냅샷은 정확히 일치합니다. demo_account 4/4/4(전체 기존 내용 집계 해시 동일), auth_login_limit 0/0/0(내용 동일), auth_token·auth_audit·episode·episode_source_version·source_block·domain_audit·episode_assignment·translation_version·translation_block·review_decision·publication·review_block_comment·source_page_image 모두 0/0/0, Flyway 성공 이력 33/33/33입니다. 테스트가 만든 행과 정확한 임시 토큰만 정리했고 데모 계정·기존 데이터는 보존했습니다.

각 커밋 직전 명시한 파일 목록과 git diff --cached --name-only 및 --check를 대조했습니다. 변경 파일의 실제 키 패턴 검사 0건, 비밀번호·이미지·파일명 감사 저장 없음, 이미지 레코드 toString 가림을 확인했습니다. 시드 비밀번호는 프로세스 환경에서만 사용하고 정리했으며 기록·Git에 포함하지 않았습니다. PROJECT_CONTEXT.md의 기존 줄바꿈 M, 공통 계약·결정 문서, frontend는 수정·stage·restore하지 않았습니다.

정리: 이름·ID를 대조한 이번 컨테이너만 docker stop --timeout 10으로 종료(코드 0, --rm 자동 정리), 3324 리스너 0. 기존 vibe-coding-project-mysql-1(ID 접두사 49c9b14620e0)은 healthy, 3306 리스너 1로 보존했습니다. 8080·8081·3000 리스너는 정리 확인 시 0이며 종료 조작하지 않았습니다. 기존 볼륨·컨테이너 삭제, push·이력 재작성 없음. 증빙은 ignored backend/build/verification/page-c016d34의 로그·XML·스냅샷입니다. 개발 DB V33 적용은 별도 승인·백업 후 수행해야 하며, 실제 브라우저 연동은 10/12 최종 통합 검증으로 이월합니다.

### 최종 실제 브라우저 통합 검증 — f360f5a (2026-10-08)

검증자: Codex 직접 실행. 사용자에게서 격리 계정 비밀번호 입력 완료와 자동 로그인 허가를 받은 뒤 수행했습니다. 기존 Claude Code API/자동 테스트 결과를 이번 브라우저 검증으로 재사용하지 않았습니다. 대상은 CONTRACTS 18~26절과 사용자 제공 최종 통합 시나리오 A1~L1입니다. 소스 수정 없이 README만 기록했습니다.

환경: MySQL 8.4.11, 임시 컨테이너 mangabridge-final-browser-f360f5a(--rm, /var/lib/mysql tmpfs), DB final_browser_oct8/3325, Spring 8093, 메타데이터 프록시 8092, Next.js 3010, Codex In-app Browser. CORS 출처는 http://localhost:3010 하나입니다. AUTH_CLIENT_IP_MODE 미설정, 정상 AI 검증은 mock이며 실제 외부 AI 호출은 하지 않았습니다. 선택 장애 검증 때만 본인 API를 anthropic/키 없음으로 재기동했습니다. 이미지 digest는 sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242입니다.

빌드 확인: git archive f360f5a의 frontend 격리 사본에서 NEXT_PUBLIC_API_BASE_URL=http://localhost:8092로 npm.cmd run build -- --webpack 성공, /history·/read 및 페이지 이미지 UI 존재 확인. source-commit.txt=f360f5a, 격리 .next/BUILD_ID 파일 SHA-256=B8B65C248C262E88CA16615BF1423A873F9DDBA94651F80741DFB565F69862F6. 기존 frontend/.next·next-env.d.ts는 변경하지 않았습니다. Spring bootJar 및 격리 시드 실행 성공, Flyway V1~V33 적용. 환경 주입·시드는 PowerShell 5.1(5.1.26100.9444), 선택 장애 검증의 실제 API 재기동도 PowerShell 5.1입니다(추가 PowerShell 7.6.5 재기동 시도는 기존 8093 프로세스와 충돌해 종료되었고 검증 서버로 사용하지 않음).

| 항목 | 결과와 직접 확인 범위 |
|---|---|
| A1 | 통과: 역할별 공통 헤더·메뉴·사용자·뱃지·화면별 제목, 헤더 로그아웃 후 /login 및 안내 |
| A2 | 통과: 회차 A의 5블록(p1/p2/미지정), 배정, 5개 구역 링크의 hash 이동, 원문·이력 접힘/펼침 |
| A3 | 통과: PNG 신규 201·JPEG 교체 200·썸네일, GIF/가짜 PNG/5 MiB+1 로컬 거부 및 추가 PUT 없음; 원문에 존재하는 페이지만 업로드 UI; 회차 B의 페이지 번호 없는 원문 안내 |
| A4 | 통과: 운영자 번역 상세에 페이지 이미지 표시 |
| B1 | 통과: 시작 전 1/작성 중 1 대시보드 숫자·칩·링크 |
| B2 | 통과: 페이지 이동·선택·전체 보기, p1 이미지, p2 이미지 없음, 미지정 이미지 영역 없음, 원본 크기/폭 맞춤 |
| B3 | 통과: 페이지 간 입력 유지, 실시간 진행률·미저장 표시, action-bar computed position=sticky/bottom=0 |
| B4 | 통과: 취소 시 AI POST 없음, 빈 4블록만 mock 채움·수동 입력 유지·수정 시 AI 표시 제거·자동 저장 없음·명시 저장/제출; 성공 AI 감사 1건 |
| C1 | 통과: 감수자 대기 건수·목록·읽기 전용 병기·페이지 이미지 |
| C2 | 통과: 두 페이지 의견 2개, 301자/공백만 로컬 거부·취소 시 POST 없음·확정 후 읽기 전용 의견 |
| D1 | 통과: 40자 초과 사유 한 줄 요약/줄바꿈 병합/말줄임, 상세 전체 사유·개행·의견; 승인/무결정 버전 요약 없음 |
| D2 | 통과: v2 복사·직전 반려 의견 읽기 전용·수정/저장/제출 |
| D3 | 통과: 기본 v1/v2 비교, 변경 1/같음 4·변경만 보기·이전 의견·동일 버전 안내 |
| E1 | 통과: 승인 취소 시 POST 없음·승인 확정, 감수자 /assigned 비교 |
| F1 | 통과: 승인된 v2 발행 확인/성공·공개 상태, 운영자 비교·진행률; 추가 v3 교체 발행도 확인 |
| F2 | 통과: 보류 취소·확정·독자 차단·재개·동일 버전 복귀, 재개로 publication 이력 1건 증가 |
| F3 | 통과(실제 동작 기록): 최신순·한국어 기존 이벤트·회차/종류 필터·25건의 20/5 페이지 이동. 이미지/AI 이벤트는 화면에서 모두 ‘기타 작업’; 둘 다 UI 종류 필터에는 없음. PAGE_IMAGE_SAVED API 필터 200(total 2), AI_DRAFT_REQUESTED 필터 400. 사유·의견·텍스트 없음 |
| F4 | 통과: 운영자 현황 카드에 공개 중/번역 없음 칩 |
| G1 | 통과: 보류 중 목록 제외·상세 동일 404 안내·재개 후 복귀. 번역문/페이지/발행 시각만 표시, 원문 이미지·결정·사유·상태 없음, HTML 문자열을 문자 그대로 표시 |
| G2 | 미검증 일부: 검색 부분 일치/대소문자 무시/결과 없음, 블록 3 북마크·목록 이어 읽기·복원 확인. v3 교체 후 이전 위치 표시 없음. 공개 브라우저 요청 Authorization 없음 확인. 공개 회차가 하나여서 이전/다음 회차 링크는 미검증 |
| G3 | 통과: 독자 로그인 후 공개 회차 읽기 링크·최근 공개 회차 카드·동일 공개 화면 |
| H1 | 통과: 번역가/감수자/독자 × 발행/보류/재개/이미지 PUT/이력 GET 모두 403, 비로그인 모두 401(격리 HTTP 직접 확인) |
| H2 | 통과: 독자 이미지 403·미배정 reviewer2 404·교체 이전 번역가 404·새 번역가 200·nosniff/no-store. 공개 JSON 필드는 episodeId/title/publishedAt/blocks 및 seq/pageNo/text뿐 |
| H3 | 통과: 만료/변조 토큰 공개 GET 200·비허용 Origin 403·허용 이미지 PUT preflight 200 및 authorization/content-type 허용 |
| I1 | 실패: 375px에서 운영자 상세 document.scrollWidth=462, 번역가 상세=428(화면 clientWidth 360~375). 감수 상세/공개 상세/이력은 scrollWidth<=clientWidth. 아래 재현 참고 |
| I2 | 미검증 일부: 헤더 rgb(44,58,140)·본문 링크 rgb(61,79,184), 여러 상태 색 및 빈/로딩 UI 관찰. 모든 상태 뱃지·버튼 색의 전 화면 일치까지는 검증하지 않음 |
| I3 | 미검증 일부: 첫 Tab에 본문 건너뛰기 링크 포커스, Enter 후 #main-content 및 실제 main 대상 존재, 사용한 입력의 라벨 확인. 전체 포커스 흐름·axe-core는 미실행 |
| J1 | 통과: anthropic/키 없음으로 503 AI_UNAVAILABLE, 안전한 오류·다시 시도·입력 유지, 수동 저장 및 이후 제출/승인/발행 성공; 외부 호출 없음 |
| K1 | 통과: 결정 3행(v1 반려/v2·v3 승인 각각 1), 의견 2행·결정/번역 버전 불일치 0, publication 3행(발행 2+재개 1), 포인터 v3/최근 발행 일치, 이미지 1행·JPEG 파일과 DB 바이트 SHA-256 일치 |
| K2 | 통과: REVIEW_APPROVED 2/REVIEW_REJECTED 1/TRANSLATION_PUBLISHED 2/PUBLICATION_HELD 1/PUBLICATION_RESUMED 1/PAGE_IMAGE_SAVED 2/AI_DRAFT_REQUESTED 2(성공 1+선택 실패 1). 승인 무효화 시나리오는 이번 흐름에서 미실행, APPROVAL_INVALIDATED 0. 감사에는 텍스트 컬럼 없음, auth_login_limit 0/LOGIN_LIMITED 0 |
| L1 | 미검증 일부: 2~7·9절 화면 대조 수행. 8절 승인 후 원문 변경 등 별도 실패 시나리오는 이번 실행에서 재현하지 않음. 문구 차이는 아래 기록, 대본 수정 없음 |

추가 확인: 브라우저에서 같은 ID로 잘못된 로그인 7회가 모두 401 고정 안내, 바로 정상 로그인 200, 전체 프록시 기록 429=0. 기존 사용자 확인 보고와 구분해 Codex가 직접 수행했습니다.

발견한 결함(수정하지 않음): 회차에 위와 같은 5블록·3번역 버전(긴 UTC 제출 시각·반려 사유 포함)을 만든 뒤 폭 375로 /episodes/1 또는 /assigned/1을 열면 표가 화면 폭을 넘어 문서에 가로 스크롤이 생깁니다. 번역가 버전 표의 DOM 폭 약 441px, 오른쪽 약 470px를 관측했습니다. failure-mobile-operator.jpg·failure-mobile-translator.jpg에 재현 화면이 있습니다. 감수/공개/이력은 같은 폭에서 통과했으므로 전 화면 모바일 통과로 표시하지 않습니다.

대본 / 실제: ‘원문 버전 1로 저장했습니다.’ / ‘원문 버전 1으로 저장했습니다.’; ‘페이지 1 / 3’ / ‘p.1 (1 / 3)’; ‘이미지 저장·AI 요청이 한국어 문구로’ / 두 이벤트 모두 ‘기타 작업’. 새 이벤트 필터 UI가 없다는 사실은 F3 실제 결과로 남겼으며 계약/코드를 변경하지 않았습니다.

증거/한계: Network 패널 대신 자체 메타데이터 프록시의 method/path/status/Origin/CORS 헤더/Authorization 존재 여부/오류 코드/공개 필드 이름만 기록했습니다(값·본문·토큰·비밀번호 미기록). UI는 문서화된 Playwright locator의 click/fill/check/select로 조작했고 evaluate는 DOM 읽기만 사용했습니다. 파일은 브라우저 filechooser.setFiles로 선택했고 일부 호출 지연이 있었습니다. 숨김 탭 visibilityState 변경·스크립트 이벤트 주입·실제 동시 클릭은 하지 않았습니다. 375px 검증은 새 탭에서 실제 innerWidth를 확인한 결과만 사용했습니다. 브라우저 로그인은 사용자 승인으로 임시 비밀번호 자동 입력, 계정 준비는 PS5.1 Read-Host와 격리 BCrypt 시드입니다. reviewer2 및 이미지 접근 인계용 translator2는 격리 DB에서만 추가; HTTP 검증 임시 토큰은 생성한 해시만 정확히 삭제했습니다. 회차 A·반려/승인/발행은 UI로 수행, 회차 B 최초 생성만 API로 수행했습니다. B 원문 API 픽스처의 400은 잘못된 검증 요청을 UI 저장으로 교정한 것이며 제품 결함으로 기록하지 않았습니다.

검증 파일/메타데이터/스크린샷은 ignored backend/build/verification/final-browser-f360f5a에 있습니다. 핵심 화면 6장과 모바일 실패 증거 2장입니다. 공개본 교체 전의 일부 즉시 isVisible 조회는 로딩 중이었으므로 통과 근거로 사용하지 않았습니다. 개발 DB(3306)는 연결·변경하지 않았으며 기존 8080/8081/3000 및 기존 컨테이너·볼륨에는 종료·삭제 작업을 하지 않았습니다. 정리 결과는 아래에 이어 기록합니다.
정리 확인: 실제 검증 API PID 43936, 프런트 66704, 프록시 12200을 소유 확인 후 종료했습니다. 임시 입력 창은 이미 종료된 상태였습니다. 일회용 컨테이너 ID ede92f3e777afc038dd0ff9a09a5ca4da1ca147181e3744962dce4a6cf9cb829를 대조한 뒤 docker stop --timeout 10(종료 코드 0), --rm 자동 정리 확인. 3325/8093/8092/3010 리스너 모두 0. 기존 개발 컨테이너 ID 49c9b14620e0939b29af2b10cd881ae7273ff17e8317d629f44400997a2e7daf와 vibe-coding-project_mysql_data 볼륨 유지, running/healthy. 8080/8081/3000은 종료 조작하지 않았으며 최종 리스너 0. 남은 제품 문제는 모바일 두 상세 화면 가로 스크롤이며 코드 수정 없이 Claude Code에 전달할 재현 기록을 남겼습니다.

### 번역본 페이지 이미지 백엔드 — CONTRACTS 27절 (2026-10-08)

검증자: Codex 직접 실행. 승인 계약 70a6a78 기준의 별도 worktree에서 구현·검증했습니다. 검증한 코드·테스트 커밋은 290790e이며, 주 작업 트리에 통합한 백엔드 기준은 96b6b21입니다(동일 backend 파일 내용 확인). Claude Code의 프런트 커밋 ab907b5·cc308d7을 보존했습니다. 실제 브라우저·뷰어 검증은 이번에 실행하지 않았으며 28절과 함께 최종 검증으로 이월합니다.

환경: PowerShell 5.1.26100.9444, MySQL 8.4.11, 일회용 컨테이너 mangabridge-translated-27(--rm, /var/lib/mysql tmpfs), DB translated27_verify/3326. 시드로 만든 데모 계정 4개와 V1~V34를 사용했습니다. 테스트 서버는 Spring random port이며 별도 프런트·상시 API 서버는 기동하지 않았습니다. 기존 개발 DB(3306)는 연결·변경하지 않았고 V34도 적용하지 않았습니다.

실행 명령: 환경변수를 프로세스에만 주입한 PowerShell 5.1에서 `gradlew.bat build integrationTest --no-daemon --rerun-tasks`를 연속 2회 실행했습니다. 1회차(15:56~16:01 KST)는 BUILD SUCCESSFUL/종료 코드 0, 2회차(16:03~16:08 KST)도 BUILD SUCCESSFUL/종료 코드 0입니다. 각 회차 **Test Files 25 / Tests 180**, 실패·오류·건너뛰기 모두 0(단위 테스트 8개 클래스/35개, 실제 MySQL 통합 테스트 17개 클래스/145개). 신규 테스트는 2개 클래스/15개입니다. 테스트 중 외부 AI 호출은 하지 않았습니다.

| CONTRACTS 27.3 항목 | 결과 |
|---|---|
| saveTranslationPageImage | 통과: PNG·JPEG·WEBP 정확 왕복, 신규 201·교체 200, 선언/시작 바이트·빈 본문·미지원 형식 거부, 5 MiB 허용·+1은 400, 알려진 초과 길이는 스트림 열기 전 거부/미상 길이는 상한+1까지만 읽음. 원문 버전에 없는 페이지·미배정·이전 담당자 404, 비DRAFT 상태 409/currentStatus, 역할 강제·위조 거부·ACCESS_DENIED, 이미지/감사 실패 롤백·안전한 503, 동시 교체 직렬화, 감사와 새 이력 이벤트 조회 |
| list/get 번역본 이미지 | 통과: pageNo 정렬·정확한 메타 필드, 저장 바이트·Content-Type·nosniff·no-store, 감수자 가시 상태 3종만, 타 번역가/교체 이전 담당자 404·새 담당자 인계, 독자 403, DB 장애 503 |
| 공개 번역본 이미지 | 통과: 공개 포인터의 PUBLISHED 이미지만 반환. 미발행·보류·없는 회차·없는 페이지 동일 404, 공개 중 이미지 없는 목록은 items:[], 보류/재개·교체 발행·공개본 불변·새 버전 이미지 미복사, 원본 이미지 비노출, 인증 헤더 무시·GET 외 405, 허용 CORS preflight·비허용 Origin 403, CORP 헤더 없음 |
| 스키마 | 통과: V34의 7개 NOT NULL, PK·CHECK 3개·RESTRICT FK 2개·ascii_bin, 정상 삽입 및 NULL/CHECK/PK/FK 위반 거부, 기존 NOT NULL lint·빈 DB/V9 업그레이드·Flyway validate. V1~V33 파일 불변 |

기존 단언 변경은 승인 범위의 다음 4곳뿐이며 HistoryIntegrationTest와 나머지 기존 테스트는 변경하지 않았습니다.

- MySqlIntegrationTest.mysqlHealthAndBaseline: 최신 버전 33→34.
- MySqlIntegrationTest.mysqlCharsetCollationUtcDedicatedAccountAndInnoDb: 허용 테이블에 translation_page_image 추가.
- DomainSchemaMigrationIntegrationTest.emptyDatabaseMigratesAllThirtyTwoAndValidatesTwice: 전체 적용 수·성공 이력 수 33→34(기존 테스트 이름 유지).
- DomainSchemaMigrationIntegrationTest.populatedV9UpgradePreservesEveryOldColumnAndChecksum: V9 이후 적용 수 24→25.

테스트 전·1회차 후·2회차 후 스냅샷은 모두 동일합니다. demo_account 4행 및 전체 내용 집계 SHA-256 불변, auth_login_limit 0행, auth_token·auth_audit·episode·episode_source_version·source_block·domain_audit·episode_assignment·translation_version·translation_block·review_decision·publication·review_block_comment·source_page_image·translation_page_image 각각 0행, Flyway 성공 이력 34행. 테스트가 만든 행만 정리했습니다. 이미지·파일명·비밀번호·토큰을 응답 오류/감사/로그에 기록하지 않았으며 변경 파일에 비밀값을 추가하지 않았습니다.

정리: 소유 컨테이너 ID bd72156d5ba557e2e807a5ec6dc3752f5fab0d0d3f3695564a1601664deb7ac5를 대조한 뒤 docker stop --timeout 10(종료 코드 0), --rm 자동 정리 및 3326 리스너 0 확인. 테스트 프로세스 종료, 기존 개발 컨테이너 ID 49c9b14620e0939b29af2b10cd881ae7273ff17e8317d629f44400997a2e7daf와 vibe-coding-project_mysql_data 볼륨은 running/healthy로 유지했습니다. 기존 8080·8081·3000 및 frontend/.next·next-env.d.ts에는 조작하지 않았습니다. 증빙은 worktree의 ignored backend/build/verification/translated-27(로그·XML·전후 스냅샷)에 있습니다. 계약과 다른 구현이나 추가 정책 결정은 없습니다. 개발 DB V34 적용과 실제 브라우저 검증은 미실행입니다.

### 작품·표지·공개 카탈로그·조회수 백엔드 — CONTRACTS 28절 (2026-10-09)

검증자: Codex 직접 실행. 정정 승인 계약 b480168 기준의 별도 worktree에서 구현했습니다. 단계별 주 작업 트리 커밋은 ① 61f6541(V35·운영자 API), ② 2ce32b9(공개 카탈로그), ③ 0070674(조회수·인기 합계)이며, d16881c에서 저장 제약 오류의 안전한 503 처리와 신규 테스트를 보완했습니다. 최종 테스트 대상 worktree 커밋 76f4f28과 주 작업 트리 d16881c의 backend 내용이 동일함을 확인했습니다. 병행된 Claude Code 프런트·STATUS 커밋은 보존했습니다.

환경: PowerShell 5.1.26100.9444, 실제 MySQL 8.4.11, 일회용 mangabridge-work28(--rm, /var/lib/mysql tmpfs), work28_verify/3335, 데모 계정 4개, V1~V35. Docker healthy는 앱 계정의 실제 SELECT 1로 확인했습니다. Spring 테스트는 random port를 사용했고 별도 프런트·상시 API 서버는 기동하지 않았습니다. 개발 DB(3306)는 연결하지 않았으며 V35를 적용하지 않았습니다. 실제 브라우저·외부 AI 검증은 미실행입니다.

명령: 프로세스 환경변수로 격리 DB를 주입한 PS 5.1에서 `gradlew.bat build integrationTest --no-daemon --rerun-tasks`를 연속 2회 실행했습니다. 최종 1회차 08:45:45~08:49:58 KST, 2회차 08:50:14~08:54:26 KST 모두 BUILD SUCCESSFUL/종료 코드 0입니다. 각 실행 **Test Files 27 / Tests 202**, 실패·오류·건너뛰기 0(단위 9개 클래스/38개, 실제 MySQL 통합 18개 클래스/164개). 신규 테스트는 2개 클래스/22개입니다. 단계별 테스트는 `gradlew.bat test integrationTest --tests "*Work*Test" --no-daemon --rerun-tasks`로 ① 47개, ② 51개, ③ 보강 후 57개가 통과했습니다. 초기 신규 테스트의 잘못된 픽스처 컬럼명·URI 이중 인코딩은 테스트를 교정해 재실행했으며 기존 테스트는 허용 범위 외 변경하지 않았습니다.

| CONTRACTS 28.5 항목 | 결과 |
|---|---|
| createWork / updateWork | 통과: 전체 입력 경계·기본값·revision 증가/충돌·동일 내용 무변경, 표지 필수/배너 5개 및 동시 경쟁, 역할 강제, 쓰기 후 장애 롤백·안전한 503 |
| saveWorkCover | 통과: PNG/JPEG/WEBP 정확 왕복·201/200, 5 MiB 허용/+1 거부, 초과 길이 본문 읽기 전 거부, 형식/시작 바이트/빈 본문/없는 작품 검사 |
| assignEpisodeWork / unassign / getEpisodeWork | 통과: 연결·재연결·번호 변경·중복 409·없는 대상 404·해제 멱등 204·한 회차 한 작품 |
| 공개 카탈로그 5개 | 통과: 공개 정의·보류/재개·장르/정렬/페이지/입력 검증·공개 회차만·표지 헤더/CORP 없음·홈 섹션 한도와 정렬·미연결 latest의 workId:null·인증 무관·비공개 정보 비노출 |
| recordView | 통과: 공개 회차 204/+1·병렬 증가·보류/미공개 404·인기에서 보류 제외·인증 무관·POST 외 405·허용/비허용 CORS·장애 롤백 |
| 스키마 | 통과: V35의 5 CREATE TABLE(승인 예외), 25개 NOT NULL 컬럼·10 CHECK·7 RESTRICT FK·PK/UNIQUE, 정상 및 위반 삽입, 10개 한글 장르 utf8mb4_bin 저장/조회·허용 밖 값 거부, 기존 nullable lint·빈 DB/V9 업그레이드·Flyway validate. V1~V34 불변 |

기존 단언 변경 목록(승인된 기계적 변경만):

- MySqlIntegrationTest.mysqlHealthAndBaseline: 최신 버전 34→35.
- MySqlIntegrationTest.mysqlCharsetCollationUtcDedicatedAccountAndInnoDb: 허용 테이블에 work·work_genre·work_cover·work_episode·episode_view_count 추가.
- DomainSchemaMigrationIntegrationTest.emptyDatabaseMigratesAllThirtyTwoAndValidatesTwice: 전체 적용/성공 이력 34→35(기존 테스트 이름 유지).
- DomainSchemaMigrationIntegrationTest.populatedV9UpgradePreservesEveryOldColumnAndChecksum: V9 이후 적용 수 25→26.

HistoryIntegrationTest와 기존 공개 API 405 테스트를 포함한 나머지 기존 단언은 변경하지 않았습니다. 테스트 전·최종 1회차 후·2회차 후 스냅샷은 동일합니다. demo_account 4행과 전체 내용 집계 SHA-256 불변, auth_login_limit 0행, 나머지 데이터 테이블(신규 5개 포함) 모두 0행, Flyway 성공 이력 35행. 테스트 생성 행만 정리했습니다. 비밀번호·토큰·AI 키를 변경 파일에 추가하지 않았습니다.

정리: 소유 ID cd347a36d713f8052bc1882d4e23d33b330d10d8d5195a322324a3c3a7e2210e를 대조해 docker stop --timeout 10(종료 코드 0), --rm 자동 정리와 3335 리스너 0을 확인했습니다. 테스트 프로세스는 종료됐습니다. 기존 개발 컨테이너 ID 49c9b14620e0939b29af2b10cd881ae7273ff17e8317d629f44400997a2e7daf·vibe-coding-project_mysql_data 볼륨은 보존했습니다(개발 컨테이너는 검증 전후 exited; 기동/종료 조작 없음). 기존 8080/8081/3000·frontend/.next·next-env.d.ts는 조작하지 않았습니다. 증빙은 worktree의 ignored backend/build/verification/work28에 있습니다. 계약과 다른 구현이나 미해결 계약 모호성은 없습니다. 개발 DB 적용과 브라우저 검증은 별도 승인 작업입니다.

### 식자 역할 백엔드 — CONTRACTS 29절 (2026-10-09)

검증자: Codex 직접 실행. 정정 승인 계약 1326521 기준의 별도 worktree에서 단계별 구현했습니다. 검증 대상 1073cd0(① V36·역할·선택 시드·배정), fdd5555(② 승인 번역 읽기), 9c8ee63(③ 식자 이미지 규칙·스키마·역할 검증)를 master에 cherry-pick한 커밋은 각각 d3ade0c, 14c18fa, 266bc00입니다. master의 병행 프런트·스크립트·문서 커밋을 보존했으며, 최종 266bc00과 테스트 대상 9c8ee63의 backend 내용이 동일함을 `git diff --quiet 9c8ee63 HEAD -- backend`로 확인했습니다. 단계별 테스트 70·39·40·50·61개가 각각 통과했습니다. 실제 브라우저·프런트 테스트는 이번 작업에서 실행하지 않았습니다.

환경: PowerShell 5.1.26100.9444, 실제 MySQL 8.4.11, 일회용 mangabridge-typesetter29(--rm, /var/lib/mysql tmpfs), typesetter29_verify/3336, 데모 계정 4개 및 Flyway V1~V36. 별도 상시 API·프런트 서버 없이 Spring random port 통합 테스트를 실행했습니다. 개발 DB(3306)는 연결·변경하지 않았고 V36을 적용하지 않았습니다. 선택 환경변수 `DEMO_TYPESETTER_PASSWORD`가 있을 때만 demo.typesetter를 시드합니다. 테스트에서는 소유한 별도 계정으로 4→5개 시드와 기존 계정 보존을 검증하고 정리했습니다.

최초 전체 회귀는 207개 중 30개 실패(Translation·Work 컨텍스트 기동 실패)였으며 MySQL `Too many connections`가 원인이었습니다. 이 결과를 통과로 대체하지 않았습니다. 사용자 승인(2026-10-09)에 따라 **격리 일회용 컨테이너의 기동 옵션 `--max-connections=300` 하나만 추가**하여 전체 회귀를 다시 실행했습니다. 기존 테스트 코드·application 설정·개발/운영 DB 설정은 이 재실행을 위해 변경하지 않았습니다. 실제 `@@max_connections=300`을 조회했습니다.

실행 명령: 격리 DB 환경을 프로세스에 주입한 PS 5.1에서 `gradlew.bat build integrationTest --no-daemon --rerun-tasks`를 연속 2회 실행했습니다. 검증 스크립트는 해당 프로세스에만 `-ExecutionPolicy Bypass`로 실행했습니다(중간에 정책 때문에 스크립트가 실행되지 않은 호출은 테스트 실행으로 세지 않음).

| 실행 | 실행 일시(KST) | 결과 | Test Files / Tests | 실패 / 오류 / 건너뛰기 |
|---|---|---|---|---|
| 1회차(증빙 run 10) | 2026-10-09 18:25:07~18:29:43 | BUILD SUCCESSFUL, 종료 코드 0 | 30 / 207 | 0 / 0 / 0 |
| 2회차(증빙 run 11) | 2026-10-09 18:30:28~18:35:03 | BUILD SUCCESSFUL, 종료 코드 0 | 30 / 207 | 0 / 0 / 0 |

각 회차 단위 테스트 9개 클래스/38개, 실제 MySQL 통합 테스트 21개 클래스/169개입니다. 테스트 XML을 회차별로 보존해 집계했습니다. `SHOW GLOBAL STATUS`의 Max_used_connections는 1회차 후 181, 2회차 후에도 181이며, 각 회차 종료 후 Threads_connected는 조회 연결을 포함해 1입니다. 300에 근접하지 않고 종료 시 연결이 반환됨을 확인했습니다. 회귀 실행 중 컨텍스트/풀들이 누적되는 현상은 있었지만 이 관측만으로 모든 연결 누수 가능성이 배제된다고 단정하지 않습니다.

| CONTRACTS 29.7 필수 테스트(Codex) | 결과 |
|---|---|
| 인증·후보·식자 배정·교체·my/episodes | 통과: TYPESETTER 로그인/me, 활성 후보만, typesetter 슬롯, 신규/동일/교체와 ASSIGNED 감사, 이전 식자 404·새 식자 인계 |
| 식자 읽기 API | 통과: APPROVED만, 버전 내림차순·병기 필드 정확 일치·읽기 전용, 미배정/없는 버전/다른 상태 404, 역할 매트릭스·비로그인·위조 거부 |
| 업로드 규칙 | 통과: TYPESETTER/APPROVED만, 다른 역할 403·다른 상태 409/currentStatus, PNG/JPEG/WEBP 정확 왕복·201/200, 5 MiB 허용/+1 거부·시작 바이트/형식/빈 본문 검증, 미배정/이전 식자 404, 감사와 저장 실패 롤백·동시 교체 |
| 열람 규칙 | 통과: 감수자 가시 상태 REVIEW_PENDING/APPROVED/REJECTED, 식자 APPROVED만, 번역가 403·감수자 PUT 403, 운영자 열람 불변 |
| 발행·무효화·공개 회귀 | 통과: 발행/무효화 이후 PUT 409, 공개 포인터·보류/재개·교체·원본 비노출·인증 무관·기존 응답/헤더 불변 |
| V36 스키마 | 통과: 실제 제약 이름 chk_demo_role·ck_assignment_role 일치, 승인 예외의 ALTER 2개, TYPESETTER 허용/다른 값 CHECK 거부, 데이터가 있는 V35→V36 후 기존 내용·FK·체크섬 보존, validate·재실행 추가 적용 0, nullable lint 통과 |
| 선택 시드 | 통과: 비밀번호 변수 없음은 기존 4개, 있을 때만 식자 추가, 표시 이름·BCrypt·멱등·기존 계정 보존 |

기존 단언 변경 목록(29.7 승인 범위):

- MySqlIntegrationTest.mysqlHealthAndBaseline: 최신 버전 35→36. 새 테이블은 없어 목록 변경 없음.
- DomainSchemaMigrationIntegrationTest.emptyDatabaseMigratesAllThirtyTwoAndValidatesTwice: 전체 적용/이력 수 35→36. populatedV9UpgradePreservesEveryOldColumnAndChecksum: V9 이후 적용 수 26→27. 기존 테스트 이름은 유지했습니다.
- AuthUnitTest.seedCreatesAllRolesAndMatchingAccountsAreIdempotent: TYPESETTER를 포함한 5개 시드·표시 이름을 가산적으로 갱신했습니다.
- AssignmentIntegrationTest.replacementImmediatelyMovesAccessForBothAssignmentRoles, fourRolesAcrossFiveApisAndForgedIdentityAreEnforced: TYPESETTER 배정/역할 행 추가. 기존 테스트 이름 유지. typesetterLoginAssignmentCandidatesAndHandoffAreEnforced는 신규 테스트입니다.
- PageIntegrationTest.roleMatrixAndCurrentAssignmentProtectAllFiveApisIncludingReplacement: TYPESETTER의 현재 배정·GET 원본 이미지 허용·미배정 404 행 추가. 원래 4개 역할의 ACCESS_DENIED 13건 단언은 그대로 유지했습니다.
- TranslationPageIntegrationTest는 승인된 재작성 범위에서 공통 픽스처/업로드 주체를 식자·APPROVED로 바꿨습니다. 대상 테스트: threeFormatsRoundTripAndAuditHistoryMetadataRevisionRemainCorrect, listSortingMetadataAndMissingImages, invalidFormatsSignaturesEmptyOversizeAndFiveMiBBoundary, allNonApprovedStatesAreImmutableAndReadersHaveDistinctVisibility(기존 allNonDraft 상태 테스트를 정정 규칙에 맞춰 이름/기대 상태 갱신), roleMatrixRejectsForgedRoleAndUnauthenticatedRequests, pageAndVersionPathMissingSourceAndAssignmentReplacement, sourceChangeUsesVersionBoundPagesAndNewDraftDoesNotCopyImages, auditAndImageFailuresRollBackAndReadDatabaseErrorsAreSafe503, concurrentUploadsSerializeWithOneRowAndTwoAudits, publicPointerOnlyHoldResumeSourceChangesAndReplacementNeverExposeOriginal, publicAuthenticationIgnoredAllMethodsAndCorsRules, schemaNotNullChecksPrimaryForeignKeysRestrictAndCollation. 공개·운영자 열람·감사·바이트 검증의 의미는 유지했습니다. TranslationPageBodyLimitTest는 변경하지 않았습니다.

새 테스트 파일은 TypesetterSeedIntegrationTest, TypesettingIntegrationTest, TypesetterSchemaIntegrationTest입니다. V1~V35와 그 밖의 기존 테스트 파일은 변경하지 않았습니다. 재실행 전·1회차 후·2회차 후 스냅샷은 동일: demo_account 4행/내용 SHA-256 불변, auth_login_limit 0행, 나머지 데이터 테이블 모두 0행, Flyway 성공 이력 36행. 테스트 생성 행만 정리했습니다. 비밀번호·토큰·AI 키를 변경 파일·보고에 추가하지 않았습니다.

정리: 소유 컨테이너 ID 86f3e0963cabde8edfc57d29887b8626da503b8312cd5ee4d8ed9509edcf48b3를 대조해 docker stop --timeout 10(종료 코드 0), --rm 자동 정리·3336 리스너 0을 확인했습니다. 테스트 프로세스 종료, 기존 개발 컨테이너 ID 49c9b14620e0939b29af2b10cd881ae7273ff17e8317d629f44400997a2e7daf·vibe-coding-project_mysql_data 볼륨은 running/healthy로 유지됐습니다. 기존 8080/8081/3000·frontend/.next·next-env.d.ts·PROJECT_CONTEXT.md의 줄바꿈 M은 건드리지 않았습니다. 증빙은 주 작업 트리의 ignored `backend/build/verification/typesetter29-evidence`에 복사 보존했고, 통합 완료 worktree는 아카이브 완료 상태를 확인했습니다. 계약과 다른 구현은 없으며 개발 DB V36 적용·실제 브라우저 검증은 미실행입니다.
