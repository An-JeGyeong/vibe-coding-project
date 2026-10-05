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