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

## 7. DemoAuth 실행·검증 (승인 계약, 구현 후 실행)

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
