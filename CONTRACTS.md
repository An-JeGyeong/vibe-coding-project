# CONTRACTS.md

관리: ProjectBootstrap·EpisodeSource는 Claude Code, DemoAuth 공통 계약은 Codex / 최종 승인: 사용자
범위: ProjectBootstrap, 승인된 DemoAuth, 13절 EpisodeSource(APPROVED 2026-10-05), 14절 전체 도메인 스키마(APPROVED 2026-10-06), 15절 Assignment(APPROVED 2026-10-06), 16절 스키마 보정 2(APPROVED), 17절 Translation(APPROVED 2026-10-06), 18절 Review(APPROVED 2026-10-06). 아래 DemoAuth 절은 인증 제외·단일 API·빈 스키마 등 Bootstrap 단계 제한을 해당 기능에 한해 대체한다.
근거: `DECISIONS.md` D-001~D-003, D-006~D-008, D-010, D-012~D-018 (D-011, D-004의 DB 엔진 부분은 D-018로 대체)
DB 엔진: MySQL 8.4 LTS (D-018). 이전 PostgreSQL 기준 문구는 모두 대체되었다.
미결정(계약 대상 아님): D-004 관리형 MySQL 제품, D-005 백엔드 호스팅 제품, D-009 인증 방식
MySQL 세부(collation, 시각, 타임아웃, TLS, 권한, healthcheck): D-019 APPROVED

## 1. API 이름과 책임

| 이름 | 책임 |
|---|---|
| `GET /api/health` | 서버 프로세스가 응답하는지, DB에 접속해 `SELECT 1`이 성공하는지 보고한다. |

- 이 단계의 유일한 API다.
- 인증·역할 검사를 하지 않는다.
- DB 상태를 포함한 어떤 상태도 변경하지 않으며, 감사 이력을 기록하지 않는다.

## 2. 입력과 출력

**입력**: 없음. 쿼리 문자열, 본문, 커스텀 헤더를 읽지 않는다.

**지원 메서드**
- `GET`: 위 출력 계약대로 응답한다.
- `OPTIONS`: CORS preflight 용.
- `HEAD`: Spring MVC 기본 지원을 허용한다. 상태 코드와 헤더는 `GET`과 같고 **본문은 반환하지 않는다**.
- 그 외 변경 메서드(`POST`, `PUT`, `PATCH`, `DELETE`)는 405.

**출력**: `Content-Type: application/json`

| 필드 | 타입 | 값 |
|---|---|---|
| `status` | string | 응답을 만든 서버가 동작 중이므로 항상 `"UP"` |
| `db` | string | `"UP"` 또는 `"DOWN"` |
| `time` | string | 응답 생성 시각, UTC ISO-8601 (예: `2026-10-05T12:00:00Z`) |

- 위 세 필드 외의 필드를 추가하지 않는다.
- 응답 헤더 `Cache-Control: no-store`를 보낸다.

## 3. HTTP 상태 코드

| 코드 | 조건 | 본문 |
|---|---|---|
| 200 | DB `SELECT 1` 성공 | `{"status":"UP","db":"UP","time":"..."}` |
| 503 | 정상 기동 후 DB 접속 실패, 쿼리 실패, 연결 획득·쿼리 타임아웃 초과 | `{"status":"UP","db":"DOWN","time":"..."}` |
| 405 | 허용되지 않은 변경 메서드(`POST`/`PUT`/`PATCH`/`DELETE`) | 프레임워크 기본 오류, 아래 4절 비노출 규칙 적용 |
| 403 | 허용되지 않은 `Origin` (CORS 6절) | 프레임워크 기본 오류, 비노출 규칙 적용 |

- **403과 405의 구분**: 요청에 허용되지 않은 `Origin`이 있으면 CORS 거부가 먼저 적용되므로 메서드와 무관하게 403일 수 있다. 405는 `Origin`이 없거나 허용된 출처에서 온 변경 메서드 요청에 대한 응답이다.
- `HEAD`는 200/503 모두 본문 없이 응답한다.

## 4. 실패 조건과 비노출 규칙

- DB 확인이 실패하는 경우: 연결 거부, 인증 실패, 쿼리 예외, 연결 획득 타임아웃 초과, 쿼리 타임아웃 초과. 모두 503 `db:"DOWN"`으로 응답한다. 예외를 던져 500으로 내보내지 않는다.
- **타임아웃 설정** (D-019 승인값. 개별 한도이며, 타임아웃이 발생하는 순서와 전체 HTTP 응답 시간은 보장하지 않는다):
  - Hikari 연결 획득 타임아웃(`connectionTimeout`): 2000 ms
  - `SELECT 1` 쿼리 타임아웃: 2초
  - Connector/J `connectTimeout`: 2000 ms
  - Connector/J `socketTimeout`: 3000 ms
  - Connector/J의 두 값은 **밀리초 단위**이며 `0`(무한)은 금지한다. (이전 PostgreSQL 드라이버는 초 단위였으므로 값을 그대로 복사하지 않는다.)
  - **위험 기록**: Connector/J의 `socketTimeout`은 같은 데이터소스를 쓰는 Flyway 마이그레이션에도 적용된다. 마이그레이션이 이 값 때문에 실패하면 **임의로 값을 늘리거나 설정을 분리하지 말고** 실패 내용과 함께 변경 제안을 보고한다.
  - 구현 후 실제 적용한 설정 키, 값, 단위를 보고한다.
- 어떤 응답(정상·오류 모두)에도 다음을 넣지 않는다: 연결 문자열, DB 호스트명·사용자명, 예외 메시지와 스택트레이스, Spring·Java·Next.js 등 프레임워크 버전.
  - 다음 Spring 설정을 적용한다:
    - `server.error.include-message=never`
    - `server.error.include-stacktrace=never`
    - `server.error.include-binding-errors=never`
    - `server.error.include-exception=false`
  - `spring-boot-starter-actuator`는 이 단계에서 사용하지 않는다(자체 `HealthController` 사용).
- **기동·장애 시나리오**:
  - DB가 정상인 상태에서 Flyway 마이그레이션이 적용되고 서버가 기동한다.
  - 정상 기동 후 DB 접근이 실패하면 `/api/health`는 503을 반환한다(서버는 종료되지 않는다).
  - 시작 시점에 DB가 불가해 Flyway가 실패하면 서버 기동이 실패해도 된다. "DB 없이 서버가 반드시 기동해야 한다"는 요구는 두지 않는다.
- 실패 상세는 서버 로그에만 남기되, 로그에도 비밀값(비밀번호, 전체 연결 문자열)을 남기지 않는다.
- 결과 캐시를 사용하지 않는다. 요청마다 `SELECT 1`을 실행한다.

## 5. 환경변수 계약

### backend

| 변수 | 필수 | 비밀 | 설명 |
|---|---|---|---|
| `DB_URL` | ✔ | ✔ | MySQL JDBC URL(`jdbc:mysql://...`). 로컬 예: `jdbc:mysql://localhost:3306/mangabridge`. 로컬·운영 옵션은 아래 "데이터베이스 계약" 참고 |
| `DB_USERNAME` | ✔ | ✔ | 앱 전용 DB 계정. `root` 금지 |
| `DB_PASSWORD` | ✔ | ✔ | |
| `CORS_ALLOWED_ORIGINS` | ✔ | | 쉼표 구분 출처 목록. 비어 있거나 `*` 포함 시 기동 실패 |
| `SPRING_PROFILES_ACTIVE` | | | `local` / `prod` |
| `PORT` | | | 기본 8080. 호스팅이 주입하는 값을 따른다 |

### frontend

| 변수 | 필수 | 비밀 | 설명 |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | ✔ | ✘ | Spring API 기본 URL(끝 슬래시 없음). 브라우저에 노출되므로 비밀 금지 |

### 데이터베이스 계약 (D-018, D-019)

**엔진·드라이버**
- MySQL 8.4 LTS, 스토리지 엔진 InnoDB, 문자셋 `utf8mb4`.
- Docker 이미지는 `mysql:8.4.x` 형태로 **구현 시 정확한 패치 버전을 확인해 고정**한다. `latest`, `8`, `8.4` 같은 유동 태그는 금지한다.
- 데이터 접근은 Spring JDBC 유지(JPA 없음), 마이그레이션은 Flyway 유지.
- 드라이버: `com.mysql:mysql-connector-j`. Flyway: `flyway-core` + `flyway-mysql`. 버전은 Spring Boot 3.5.x BOM이 관리하는 Flyway 버전과 호환되는 것을 쓰고 확정한 버전을 보고한다.
- 제거 대상: `org.postgresql:postgresql`, `flyway-database-postgresql`, PostgreSQL 전용 URL·옵션·진단 명령(`pg_isready`, `psql` 등).

**계정**
- 앱은 `MYSQL_USER`로 만든 **전용 DB 계정**으로만 접속한다. `root`로 접속하지 않으며, `root` 자격증명을 `.env.example`·README·앱 설정에 넣지 않는다.
- 컨테이너의 root 비밀번호는 `MYSQL_RANDOM_ROOT_PASSWORD=yes`로 무작위 생성해 사용하지 않는다.
- 로컬 전용 앱 계정은 해당 스키마(`MYSQL_DATABASE`) 한정 전체 권한을 가진다(Flyway DDL 포함, D-019 승인). 전역 권한은 부여하지 않는다.
- 운영의 마이그레이션 계정과 앱 계정 분리는 **미결정**이다(D-004 확정 후 결정).

**문자셋·collation (명시 필수)**
- 서버(Docker `command` 옵션): `--character-set-server=utf8mb4`, `--collation-server=utf8mb4_0900_ai_ci`.
- 스키마·테이블 생성 시에도 문자셋과 collation을 명시한다. JDBC 연결에도 `characterEncoding`과 `connectionCollation`을 명시한다.
- 기본 collation: `utf8mb4_0900_ai_ci` (D-019 승인).
- **도메인 단계로 미루는 사항(확정하지 않음)**: 토큰·해시의 정확한 비교 방식. `utf8mb4_bin`을 무조건 쓴다고 확정하지 않으며, `VARBINARY` 등 적절한 이진 비교 방식도 검토 대상이다. 로그인 ID의 대소문자 정책도 이번 단계에서는 확정하지 않는다.

**시각 저장·조회 정책 (UTC 기준)**
- 시각 컬럼 타입은 `DATETIME(6)`에 UTC로 저장한다(D-019 승인). 도메인 스키마 노드에서 적용하며 이 단계에는 시각 컬럼이 없다.
- `DATETIME` 자체는 시간대 변환이나 UTC를 강제하지 않는다. 따라서 **애플리케이션과 연결 설정에서 UTC를 보장**한다.
  - 서버 `--default-time-zone=+00:00`
  - JDBC `connectionTimeZone=UTC`, `forceConnectionTimeZoneToSession=true`
  - 애플리케이션은 `Instant`/UTC로 읽고 쓴다.
- API 응답 시각은 UTC ISO-8601(`Z`).
- 시각만으로 버전 순서나 유일성을 보장하지 않는다. 버전 순서와 유일성은 도메인 단계에서 별도 컬럼(버전 번호)과 제약조건으로 정한다.

**연결 URL 옵션 (로컬과 운영을 구분)**
- PostgreSQL의 `sslmode` 등 전용 옵션을 복사하지 않는다.
- **로컬 개발(localhost Docker 한정)**: TLS 없이 접속한다. MySQL 8.4의 기본 인증(`caching_sha2_password`) 때문에 `allowPublicKeyRetrieval=true`가 필요할 수 있으며 **이 옵션은 로컬 개발에서만 허용**한다. `mysql_native_password`로 되돌리는 설정은 하지 않는다(8.4 기본 비활성).
- **운영(관리형 MySQL, D-004 확정 후)**: TLS 필수, 기본 `sslMode=VERIFY_IDENTITY`. 인증서 신뢰 구성(CA 신뢰 저장소)과 호스트명 검증을 요구한다. `allowPublicKeyRetrieval` 사용 금지. 운영 환경에서 완화(`VERIFY_CA` 등)가 필요하면 **별도 승인**을 받는다.
- 운영 TLS 값을 로컬 설정에, 로컬 옵션을 운영 설정에 넣지 않는다. 프로필이나 환경변수로 분리한다.

**Docker 구성**
- 서비스명 `mysql`, 포트 `127.0.0.1:3306:3306`(localhost 바인딩), 이름 있는 볼륨 `mysql_data`.
- 환경변수: `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`(로컬 개발 전용 값), `MYSQL_RANDOM_ROOT_PASSWORD=yes`.
- **healthcheck**: `mysqladmin ping`만으로는 인증 성공을 검증하지 못하므로 쓰지 않는다. **앱 전용 계정으로 대상 DB에 TCP로 접속해 `SELECT 1`을 실행**하고, 실패하면 비정상 종료 코드를 반환해야 한다. 비밀번호를 명령 인자나 출력에 노출하지 않는다(컨테이너 내부 환경변수 또는 설정 파일 방식 중 구현 시 선택하고 사용한 방식을 보고한다).
- **기존 자산 보존**: 기존 PostgreSQL 컨테이너·볼륨(`postgres_data`)·커밋을 보존한다. `docker compose down -v`, `docker volume rm`, `docker system prune`을 실행하지 않는다. 기존 PostgreSQL 컨테이너 중지 여부는 보고만 하고 삭제는 책임자가 결정한다. 전환 대상 소스와 설정의 수정은 허용하며, 테스트 파일 이름 변경이 필요하면 `git mv`를 사용할 수 있다. 사용자의 기존 작업을 임의로 덮어쓰지 않는다.
- 기존 PostgreSQL DB에는 도메인 데이터가 없고 Flyway 기준선(V1, 빈 파일)뿐이므로 데이터 이전은 하지 않는다. MySQL은 새 스키마에서 시작한다.

**마이그레이션 유의사항**
- MySQL의 DDL은 트랜잭션으로 롤백되지 않는다(암묵적 커밋). 마이그레이션 파일은 한 파일에 DDL 하나로 작게 나누는 것을 원칙으로 하고, 도메인 노드의 마이그레이션 작성 시 적용한다.
- `V1__baseline.sql`은 빈 기준선(주석만)을 유지하되, Flyway가 MySQL에서 이를 정상 적용하는지 확인한다.
- 이 단계의 SQL은 `SELECT 1`뿐이며 MySQL에서도 동일하게 동작한다.

### 공통 규칙
- 값은 환경변수로만 주입한다. 코드와 `application.yml`에 실제 비밀값을 넣지 않는다.
- **Spring Boot는 `.env` 파일을 자동으로 읽는다고 가정하지 않는다.** Spring 실행 환경에는 프로세스 환경변수로 값을 주입한다.
- **Docker Compose의 `.env` 처리와 Spring 실행 환경을 구분한다.** Compose는 자체 규칙으로 루트 `.env`를 읽어 컨테이너를 구성하고, Spring은 별개로 셸 환경변수를 읽는다. 두 경로를 문서에서 분리해 설명한다.
- `README.md`에는 **Windows PowerShell**에서 환경변수를 설정하고 Gradle Wrapper(`gradlew.bat bootRun`)로 백엔드를 실행하는 재현 가능한 절차를 포함한다(`$env:DB_URL = "..."` 형식, 실제 값은 로컬 개발용 예시만).
- `backend/.env.example`, `frontend/.env.example`을 커밋한다. 실제 `.env*`는 Git에서 제외한다.
- 로컬 Docker DB의 개발용 값(예: 사용자 `mangabridge`)은 `.env.example`과 `docker-compose.yml`에 둘 수 있다. 이는 로컬 전용이며 비밀이 아니다. 관리형 DB·배포 환경의 값은 절대 커밋하지 않는다.
- 기동 시 필수 변수가 없으면 명확한 오류(변수 이름만, 값 제외)와 함께 기동 실패한다.

## 6. CORS 계약

- 허용 출처는 `CORS_ALLOWED_ORIGINS`에 나열된 값만이다. 와일드카드(`*`, 패턴)를 금지한다.
- 로컬 값: `http://localhost:3000`. 배포 시 Vercel Production 도메인 1개를 추가한다(도메인 확정 후).
- Vercel Preview 도메인은 기본 불허.
- 허용 메서드: `GET, POST, PUT, PATCH, DELETE, OPTIONS`.
- 허용 요청 헤더: 이 단계에서는 `Content-Type`만.
- 자격 증명(쿠키) 허용 여부는 인증 방식(D-009) 확정 전까지 `false`.
- 동작:
  - 허용된 `Origin`: 정상 응답 + `Access-Control-Allow-Origin: <해당 출처>`
  - 허용되지 않은 `Origin`: 403, `Access-Control-Allow-Origin` 없음
  - `Origin` 헤더가 없는 요청(curl, 헬스 체크 모니터): 통과(브라우저 보호 장치일 뿐 접근 제어가 아님)

## 7. 변경 가능·금지 파일

### Codex가 생성·수정 가능
- `frontend/**`
- `backend/**` (Gradle Wrapper, 소스, `application*.yml`, `db/migration/**`, 테스트)
- 루트 `.gitignore`
- 루트 `docker-compose.yml` (로컬 MySQL)
- `frontend/.env.example`, `backend/.env.example`
- 루트 `README.md` (로컬 실행·테스트 방법만)
- Git: 로컬 `git init`과 로컬 커밋(Codex 담당)

### 변경 금지
- `PROJECT_CONTEXT.md`, `CONTRACTS.md`, `DECISIONS.md`
- 기존 파일 삭제, `git reset`, 원격 저장소 생성·연결, `git push`
- Docker 자동 설치
- 실제 `.env`, `.env.local` 등에 비밀값을 넣어 커밋하는 행위
- 이 계약에 없는 API, 테이블, 인증 코드 추가 (도메인 기능은 이후 노드)

### 계약 변경이 필요해질 때
구현을 멈추고 변경 제안을 보고한다. 계약을 우회하는 구현을 하지 않는다.

## 8. 로컬 완료 조건 (D-004, D-005와 무관)

전제: JDK 17, Node 24가 설치되어 있다. Docker는 Codex가 다음을 확인한다: Docker CLI 설치 여부, 데몬 실행 상태. Docker가 없거나 데몬이 실행 중이 아니면 **자동 설치하지 않고** 구현 가능한 부분까지만 진행한 뒤 해당 항목을 "미검증"으로 보고한다.

1. `docker compose up -d`로 로컬 MySQL 8.4(고정 패치 버전)가 기동하고 healthcheck가 통과한다. 앱은 root가 아닌 전용 계정으로 접속한다.
2. 셸 환경변수를 주입한 뒤 `backend`에서 `gradlew.bat bootRun`으로 기동하고, DB 정상 상태에서 Flyway가 `V1__baseline.sql`을 적용한다.
3. DB 정상 상태에서 `GET /api/health`가 200과 계약된 본문을 반환한다.
4. **정상 기동 후** DB 컨테이너를 중지하면 `GET /api/health`가 503 `db:"DOWN"`을 반환하고, 서버는 종료되지 않으며, DB 재기동 후 다시 200이 된다. (시작 시 DB 불가 상태에서의 기동은 요구하지 않는다.)
5. `frontend`에서 `npm run dev`로 기동하고 `NEXT_PUBLIC_API_BASE_URL`을 사용해 헬스 상태(UP/DOWN)를 화면에 표시한다.
6. `http://localhost:3000`에서 헬스 체크 호출이 CORS로 통과하고, 허용 목록에 없는 출처는 403이다.
7. `frontend`의 `npm run build`와 `backend`의 `./gradlew build`(테스트 포함)가 성공한다.
8. 저장소에 비밀값이 없고, `.env.example`만으로 로컬 환경을 재현할 수 있다.
9. 응답·로그에 4절의 비노출 항목이 없다.

## 9. 배포 완료 조건 (D-004, D-005 확정 후에만 진행)

선행: D-004(관리형 MySQL 제품, **MySQL 8.4 LTS 제공 여부 확인 포함**), D-005(백엔드 호스팅 제품) 확정. 그 전에는 이 절의 작업을 시작하지 않는다.

백엔드 호스팅이 만족해야 할 요구 조건:
- 상시 Java 17 프로세스 실행, HTTPS 공개 URL
- `PORT`와 5절 환경변수 주입
- 헬스 체크 경로로 `/api/health` 지정 가능
- 관리형 MySQL로의 아웃바운드 접속(TLS, 3306 또는 제품이 지정한 포트)
- 로컬 파일을 영속 저장소로 사용하지 않음
- 무료 티어 슬립 정책 확인 및 시연 전 워밍업 절차 정의

완료 조건:
1. 관리형 MySQL에 Flyway 마이그레이션이 적용된다. 앱 전용 계정을 쓰고, TLS(`sslMode=VERIFY_IDENTITY`, 인증서 신뢰 구성과 호스트명 검증 포함)로 접속하며, 문자셋·collation·시간대(UTC)가 계약과 일치하는지 확인한다.
2. 배포된 Spring의 `GET /api/health`가 HTTPS로 200을 반환한다.
3. Vercel(Root Directory `frontend`, Node 24)에 프런트가 배포되고 `NEXT_PUBLIC_API_BASE_URL`이 배포된 Spring URL을 가리킨다.
4. 배포된 프런트 화면에서 헬스 UP이 표시된다(브라우저 CORS 통과).
5. Vercel Production 도메인만 `CORS_ALLOWED_ORIGINS`에 포함되어 있고, 그 외 출처는 403이다.
6. 배포 환경 변수와 로그에 비밀값이 노출되지 않는다.
- 배포 환경변수 입력, 계정 연결, 도메인 설정은 프로젝트 책임자가 수행하거나 명시적으로 승인한 뒤 진행한다.

## 10. 필수 테스트

백엔드(자동):
1. **헬스 200**: 테스트용 MySQL 8.4(Testcontainers 또는 로컬 Docker DB, 실제 DB 필수·모의 DB로 대체 금지)에서 200과 본문 필드 3개, `status=UP`, `db=UP`, `time`이 UTC ISO-8601인지 확인.
2. **헬스 503**: DB 불가 상태에서 503, `db=DOWN`, `status=UP` 확인.
3. **타임아웃**: Hikari 연결 획득(2초)·쿼리(2초)·JDBC 네트워크 타임아웃이 유한한 값으로 설정되어 있는지 확인하고, DB 접속 불가 또는 지연 시 요청이 무한 대기하지 않고 유한한 시간 안에 503을 반환하는지 확인(전체 응답 시간이 2초 이내라는 단정은 하지 않는다).
4. **비노출**: 정상·실패 응답 본문에 `jdbc:`, DB 호스트명, 사용자명, `Exception`, 프레임워크 버전 문자열이 없는지 검사.
5. **캐시 없음**: 연속 호출 시 매번 DB 확인이 수행되고(DB 상태 변화가 즉시 반영) `Cache-Control: no-store`가 있다.
6. **CORS**: 허용 출처 요청은 통과 + `Access-Control-Allow-Origin` 일치, 비허용 출처는 403, preflight 동작, `Origin` 없는 요청은 통과.
7. **CORS 설정 검증**: `CORS_ALLOWED_ORIGINS`가 비었거나 `*`를 포함하면 기동 실패.
8. **Flyway**: 빈 DB에서 `V1__baseline.sql` 적용 후 기동 성공. (시작 시 DB 불가로 기동이 실패하는 것은 허용되며 테스트 대상이 아니다.)
8-1. **HEAD/메서드**: `HEAD /api/health`는 본문 없이 `GET`과 같은 상태 코드, `POST`/`PUT`/`PATCH`/`DELETE`는 405(허용 `Origin` 또는 `Origin` 없음 기준), 비허용 `Origin`의 요청은 403.
8-3. **MySQL 구성 검증(통합 테스트)**: 실제 연결에서 `@@character_set_server`, `@@collation_server`, 세션 시간대 UTC, 접속 계정이 `root`가 아님(`SELECT CURRENT_USER()`)을 확인한다. **엔진은 `default_storage_engine`이 InnoDB이고 InnoDB가 사용 가능(`information_schema.ENGINES`)한지만 확인**한다. 도메인 테이블이 없는 단계이므로 검증 때문에 영구 테이블을 만들지 않으며, 실제 테이블의 엔진 검증은 테이블 생성 단계에서 수행한다. 로컬 URL 옵션(`allowPublicKeyRetrieval`)이 운영 설정에 없는지, 운영 설정의 `sslMode`가 `VERIFY_IDENTITY`인지 설정 파일을 검사한다. `connectTimeout=2000`·`socketTimeout=3000`(ms)이 적용되었는지 확인한다.
8-4. **Docker healthcheck**: 앱 전용 계정으로 `SELECT 1`이 실행되는지, 잘못된 비밀번호나 DB 중지 시 unhealthy가 되는지 확인하고, 비밀번호가 `docker inspect`의 healthcheck 명령과 출력에 노출되지 않는지 확인한다.
8-5. **Flyway와 소켓 타임아웃**: Flyway 적용이 `socketTimeout=3000`에서 성공하는지 확인한다. 실패하면 값을 임의로 늘리지 말고 변경 제안을 보고한다.
8-2. **오류 설정**: `server.error.include-*` 4개 설정이 적용되어 있고 오류 응답에 메시지·스택트레이스가 없다.

프런트(자동/수동):
9. `npm run build`, 타입 체크 성공.
10. 헬스 응답이 UP/DOWN/네트워크 오류일 때 각각 화면에 표시(오류 시 앱이 깨지지 않음).

수동(로컬):
11. 8절 4번의 DB 중지·재기동 시나리오.
12. 비밀값 점검: `git status`/추적 파일에 실제 `.env`가 없음.

이 단계에는 역할, 상태 전이, 승인·발행 불변식이 없으므로 해당 테스트는 도메인 노드로 넘긴다.

## 11. Codex 작업 지시

**작업명**: ProjectBootstrap 로컬 구현 (배포는 범위 밖)

**먼저 읽을 것**: `PROJECT_CONTEXT.md`, `CONTRACTS.md`, `DECISIONS.md`. 읽기 전용이다.

**지시**
1. 루트에 `frontend/`와 `backend/`를 만든다. 모노레포 도구는 쓰지 않는다.
2. `backend`: Java 17, Spring Boot 3.5.x 최신 안정 패치(구현 시 확인 후 고정), Gradle Wrapper. 의존성은 `spring-boot-starter-web`, `spring-boot-starter-jdbc`, `com.mysql:mysql-connector-j`, `flyway-core`와 `flyway-mysql`, 테스트 의존성. PostgreSQL 드라이버와 `flyway-database-postgresql`은 제거한다. JPA와 actuator는 넣지 않는다.
3. `HealthController`로 `GET /api/health`를 2절~4절대로 구현한다(`GET`, `OPTIONS`, 기본 `HEAD`는 본문 없음, 변경 메서드는 405). DB 확인은 `SELECT 1`이며 Hikari 연결 획득 타임아웃 2초, 쿼리 타임아웃 2초, JDBC 네트워크 타임아웃은 유한한 값으로 설정한다. 정상 기동 후 DB 실패 시 예외를 밖으로 내지 않고 503을 반환한다. 시작 시 DB 불가로 인한 기동 실패는 허용되며 이를 우회하는 코드를 추가하지 않는다. 전체 응답 시간이 2초 이내라고 단정하지 않는다.
4. 6절대로 CORS를 구성한다. `CORS_ALLOWED_ORIGINS` 검증(빈 값·`*` 거부)을 포함한다.
5. 5절의 환경변수를 `application.yml`에서 읽는다. 기본값에 비밀값을 넣지 않는다. 4절의 `server.error.include-*` 설정 4개를 적용한다. Spring Boot가 `.env`를 자동으로 읽는다고 가정하지 않는다.
6. `db/migration/V1__baseline.sql`은 빈 기준선으로 둔다(도메인 테이블 금지). `ddl-auto` 등 자동 스키마 생성은 사용하지 않는다.
7. 루트 `docker-compose.yml`로 로컬 MySQL 8.4를 제공하고(이미지 패치 버전 정확히 고정, "데이터베이스 계약" 준수), `.env.example`에는 로컬 개발용 값만 둔다. 작업 시작 시 Docker CLI 설치 여부와 데몬 실행 상태를 확인한다. 없거나 실행 중이 아니면 자동 설치하지 말고 보고한다.
7-1. 루트에서 `git init`을 수행하고(Codex 담당) 작은 단위로 로컬 커밋한다. 원격 저장소 생성·연결, `git push`, `git reset`, 기존 파일 삭제는 하지 않는다.
7-2. `README.md`에 Windows PowerShell 기준으로 (a) Docker Compose의 `.env` 처리와 (b) Spring 실행용 환경변수 주입(`$env:...` 후 `gradlew.bat bootRun`)을 구분해 재현 가능한 절차로 쓴다.
8. `frontend`: Next.js 안정 버전, App Router, TypeScript, Node 24. 의존성은 `next`, `react`, `react-dom`과 TS 타입 패키지만. `src/lib/api.ts`에 `NEXT_PUBLIC_API_BASE_URL` 기반 호출 래퍼를 두고, 첫 화면에서 헬스 상태(UP/DOWN/오류)를 표시한다.
9. 10절의 자동 테스트를 작성하고, 8절의 로컬 완료 조건을 직접 실행해 결과를 보고한다.
10. `.gitignore`에 `.env*`(`.env.example` 제외), 빌드 산출물, `node_modules`, Gradle 산출물을 포함한다.
11. `README.md`에는 로컬 실행·테스트 방법만 쓴다.

**기존 구현 전환 (D-018)**: 저장소에는 이미 PostgreSQL 기준 구현이 커밋되어 있다(`backend/build.gradle`, `application.yml`, `docker-compose.yml`, `*.env.example`, `README.md`, `PostgresIntegrationTest` 등). 새로 만들지 말고 다음 순서로 **전환**한다.
1. 작업 전 `git status`로 작업 트리를 확인하고, 현재 Docker 컨테이너·볼륨 상태를 확인만 한다(삭제 금지).
2. 의존성을 MySQL로 교체하고, `application.yml`의 URL·타임아웃(`connectTimeout=2000`, `socketTimeout=3000` ms, Hikari `connectionTimeout=2000` ms, 쿼리 2초)을 계약대로 바꾼다. Flyway가 소켓 타임아웃 때문에 실패하면 값을 늘리지 말고 보고한다. 기존 사용자 작업을 덮어쓰지 않으며, 테스트 파일 이름 변경은 `git mv`로 한다.
3. `docker-compose.yml`을 MySQL 서비스(`mysql`, `mysql_data`, 3306)로 교체한다. 기존 `postgres_data` 볼륨은 건드리지 않는다.
4. `PostgresIntegrationTest`와 Gradle `integrationTest` 설정을 MySQL 기준으로 바꾼다(실제 DB 필수, 성공/건너뛰기로 처리하지 않음).
5. `.env.example`과 `README.md`에서 PostgreSQL 명령(`pg_isready`, `psql`)·포트·이미지·용어를 MySQL 기준으로 교체한다(MySQL 확인 명령은 `mysql` 클라이언트 사용, 비밀번호를 명령줄에 노출하지 않는 방식).
6. 8절·10절을 MySQL로 다시 실행해 결과를 보고한다. 이전 PostgreSQL 검증 결과는 무효다.
7. 작은 단위로 로컬 커밋한다(push 금지).

**금지**
- 문서 3종 수정, 도메인 테이블·API·인증 코드 추가, 와일드카드 CORS, 비밀값 커밋, UI·스타일 라이브러리 추가, 배포 작업(Vercel·호스팅·관리형 DB 접속).
- 기존 파일 삭제, `git reset`, 원격 저장소 생성·연결, `git push`, Docker 자동 설치.
- Docker 볼륨·컨테이너 삭제(`down -v`, `volume rm`, `system prune` 등), root 계정으로의 앱 접속, PostgreSQL 전용 옵션의 MySQL URL 복사.
- 계약과 어긋나는 상황(예: 버전 호환 문제, 요구 변경)이 생기면 우회하지 말고 구현을 멈추고 변경 제안을 보고한다.

**보고 형식**: 변경 파일 목록, 확정한 버전, **실제 적용한 타임아웃 설정(키·값·단위)**, Docker CLI/데몬 확인 결과, 8절 각 항목의 실행 결과(통과/실패/미검증과 실제 명령), 10절 테스트 결과, 계약 변경 제안 여부.

## 12. DemoAuth — APPROVED (2026-10-05, 사용자 보완 A~E 포함)

### 담당·범위
- Codex: backend, 공통 문서, 최종 실제 연동 검증. Claude Code: frontend, 자체 테스트, 마지막 통합 리뷰 1회. 공통 파일은 Codex만 수정한다. 병렬이면 별도 worktree, 같은 작업 트리면 순차 작업한다.
- 승인 계약은 별도 로컬 커밋으로 전달한다. push·배포·이력 재작성·기존 볼륨 삭제 금지. V1 수정 금지. Spring JDBC 유지, Controller → Service → DAO → MySQL.
- 승인 추가 의존성은 spring-boot-starter-security, spring-security-test(Boot BOM)뿐이다. 신규 인프라 없음.
- 네 역할 OPERATOR/TRANSLATOR/REVIEWER/READER, 계정당 단일 역할. 운영자는 원문·회차·배정·발행, 번역가는 배정된 번역 작성·제출, 감수자는 배정된 검수. 제작 참여자는 해당 버전 승인·반려 금지, 운영자가 다른 역할을 자동 상속하지 않는다. 공개본은 비로그인 열람 가능. 배정·공개본·자기 검수는 후속 업무 API 기준만 기록하며 이번에는 구현하지 않는다.
- 실제 브라우저 역할별 403은 첫 업무 API까지 이월한다. 이번에는 테스트 소스에만 있는 보호 경로로 실제 MySQL 포함 백엔드 권한 검증. 역할별 업무 페이지·별도 데모 API 금지.

### API·오류
| API | 입력 | 성공 |
|---|---|---|
| POST /api/auth/login | JSON {"loginId":"demo.operator","password":"<입력값>"} | 200 {"user":{"id":"1","displayName":"데모 운영자","role":"OPERATOR"},"accessToken":"<토큰>","tokenType":"Bearer","expiresAt":"<UTC ISO-8601>"} |
| GET /api/auth/me | Authorization: Bearer <token>, 본문 없음 | 200 {"user":{"id":"1","displayName":"데모 운영자","role":"OPERATOR"},"expiresAt":"<UTC ISO-8601>"} |
| POST /api/auth/logout | 선택적 Bearer, 본문 없음 | 204, 본문 없음 |
- 로그인 ID 정규식 ^[a-z0-9][a-z0-9._-]{2,63}$, trim·소문자 변환 없이 검증. 비밀번호 변환 없음, 비어 있으면 400, 최대 72 UTF-8 바이트. 미정의 필드(role/userId 등)는 400. 프런트 동일 규칙.
- 사용자 ID는 문자열. 클라이언트 역할·사용자 ID를 신뢰하지 않으며 매 인증 요청 DB 계정 상태·역할을 확인한다. 인증 응답은 Cache-Control: no-store.
- 인증 오류 JSON은 {"error":{"code":"<코드>","message":"<고정 안내>"}}. 400 INVALID_REQUEST, 실패 로그인 401 INVALID_CREDENTIALS(없는 계정·잘못된 비밀번호·비활성 동일), 보호 요청 401 AUTH_REQUIRED(없음·변조·만료·폐기 동일), 403 FORBIDDEN, 429 LOGIN_RATE_LIMITED + Retry-After(초), 503 AUTH_UNAVAILABLE, 500 INTERNAL_ERROR. 비밀·내부 예외·DB 식별 정보 제외. 없는 계정은 더미 BCrypt 검증.
- 잘못된 Authorization 형식: 보호 API는 401, logout은 400 INVALID_REQUEST. 토큰 없음·유효 형식이나 미등록·만료·이미 폐기된 토큰 logout은 204. 유효 토큰 폐기 여부를 DB 장애로 확인하지 못하면 503. 인증 DB 장애는 접근 거부.
- 기존 health 계약·405·비허용 Origin 403 동작은 유지. 인증 오류 형식은 새 인증 경로·보호 접근에 적용한다.

### 토큰·CORS·배포
- 32바이트 난수의 base64url 불투명 토큰, DB SHA-256 BINARY(32) 해시만 저장. 비밀번호 BCrypt. sessionStorage에 토큰 저장, 요청 Authorization 헤더 전달, credentials: omit. 토큰은 JS 접근 가능하므로 XSS 노출 제한이 있는 데모 선택이다.
- 기본 절대 수명 3600초, AUTH_TOKEN_TTL_SECONDS(1~86400)로 테스트 조정 가능. 자동 연장·refresh token 없음. 여러 토큰 허용, 현재 토큰만 폐기. 재기동 뒤 DB의 미만료 토큰 유지. 만료 경계 now >= expiresAt는 401.
- 쿠키·HTTP Basic·자동 Servlet 인증 세션 없음. 명시적 Bearer만 인증하므로 CSRF 토큰은 사용하지 않는다. 쿠키 인증 추가 시 재승인. Origin 없는 요청 허용, CORS는 인증·권한 대체 수단이 아니다.
- CORS_ALLOWED_ORIGINS 명시 목록, credentials=false 유지. 허용 헤더 Content-Type/Authorization, 노출 헤더 Retry-After. 비허용 Origin 있는 교차 출처는 인증보다 먼저 403, preflight는 인증 없이 처리.
- 로컬 http://localhost:3000 → http://localhost:8080. 배포 계획은 Vercel 기본 도메인 + 별도 HTTPS API. 실제 API 호스트·Origin과 프록시 IP 정책은 배포 승인 대상이며 배포 검증 완료로 기록하지 않는다.

### 제한·정리·감사
- 로그인 ID(존재 여부 무관)별 15분 창에서 5회 실패 시 그 실패 시점부터 15분 차단. 직접 접속 IP별 15분 창 30회 실패도 같은 방식. 차단 요청은 카운터·차단 시간을 늘리지 않는다. now >= blockedUntil이면 차단 해제와 새 창, now >= windowStart+15분이면 새 창. 성공은 ID 실패 카운터를 초기화하되 IP 누적 실패는 유지.
- 제한 키는 SHA-256 이진 해시로 저장. MySQL 행 잠금과 트랜잭션으로 동시 카운터·차단·로그인 성공 판정을 원자 처리. IP 키 → ID 키 순으로 잠금. 실패 결과는 제한·감사 저장을 커밋한 뒤 응답한다.
- AUTH_CLIENT_IP_MODE=DIRECT는 local만 허용, request remote address만 사용하고 Forwarded/X-Forwarded-For를 신뢰하지 않는다. demo/prod에서는 IP 안전 판별/미적용 보완책 승인이 먼저 필요하다. 미결정 프록시 설정으로 조용히 IP 제한을 끄거나 공용 프록시 IP를 사용자 IP로 사용하지 않으며 기동을 거부한다. 이번 검증은 local DIRECT만 수행한다.
- 감사: LOGIN_SUCCESS/LOGIN_FAILURE/LOGIN_LIMITED/LOGOUT/ACCESS_DENIED. UTC 시각·알려진 사용자 ID·이벤트·고정 사유만 저장. 비밀번호·해시·토큰·헤더·원문 요청·실패 ID·원시 IP는 감사/로그에서 제외.
- 로그인 성공 토큰 발급+감사, 실패 제한+감사, logout 폐기+감사는 각각 원자 처리. 실패 로그인 또는 권한 거부 감사 저장 실패도 503 AUTH_UNAVAILABLE; 허용하지 않는다. 이미 폐기·없는 토큰 logout은 감사 중복 저장 없이 204.
- 토큰은 만료/폐기 뒤 24시간, 제한 데이터는 마지막 갱신 뒤 24시간(활성 차단 제외), 감사는 7일 보관. 명시적 수동 정리 실행 인자 --demo-auth-cleanup=true로 삭제하며 스케줄러 없음. 기존 계정·Flyway·컨테이너·볼륨은 정리하지 않는다.

### 초기화·프런트 계약
- 고정 ID demo.operator/demo.translator/demo.reviewer/demo.reader. 초기화 전용 --demo-auth-seed=true, DEMO_AUTH_SEED_ENABLED=true, local/demo 프로필만 허용. DEMO_OPERATOR_PASSWORD/DEMO_TRANSLATOR_PASSWORD/DEMO_REVIEWER_PASSWORD/DEMO_READER_PASSWORD를 셸 환경으로 주입한다. 값은 화면·소스·NEXT_PUBLIC·로그에 기록하지 않는다.
- 기존 계정 비밀번호·역할을 덮어쓰지 않는다. 기존 ID의 역할/이름/활성 상태/주입 비밀번호가 다르면 원자적으로 실패. 초기화는 한 번 실행 후 프로세스 종료, prod 거부. demo 실행의 프록시 IP 미결정은 위 기동 규칙을 따른다.
- 기존 DB/CORS/PORT 변수 유지, local 프로필, frontend NEXT_PUBLIC_API_BASE_URL=http://localhost:8080. PowerShell 5.1 셸 주입 절차 사용. Compose 변경 없음.
- /login 로그인 화면, /demo 모든 인증 역할의 보호 화면. 성공 후 /demo. 로그인 화면에는 역할별 ID만 안내. /demo에 서버 확인 사용자·역할·권한 안내, 미구현 메뉴 비활성. 비밀번호 UI 안내·소스 저장 금지.
- 저장 토큰이 있으면 초기 /me 완료 전 보호 내용 숨김. /me 및 API 401이면 토큰 제거. expiresAt 도달과 탭 재활성 때 만료 재확인, polling 없음. 서버 판정 최종. 403은 로그인 유지. 통신 장애·503은 재시도, 임의 logout 금지. logout 통신 실패는 서버 logout 미확인 표시. 인증 변경 전 시작한 /me 응답이 상태를 복원하지 않도록 세대 번호/요청 취소 처리.
- 프런트 추가 정책 A·B·C — APPROVED (사용자 승인, D-025). 구현 기준 커밋 96566da.
  - A. sessionStorage에 토큰을 쓰지 못하면 로그인을 실패로 처리하고, 서버가 방금 발급한 토큰의 폐기(logout) 요청을 최선 노력으로 보낸다. localStorage·쿠키·메모리 등 다른 저장 방식으로 임의 전환하지 않는다.
  - B. logout 요청이 통신 실패·503·500 등으로 204가 아니면 로컬 토큰·사용자·보호 데이터는 삭제하고 서버 폐기 미확인으로 안내한다. 안내에는 "서버 토큰은 만료 전까지 유효할 수 있다"는 점을 반드시 포함한다.
  - C. 탭이 다시 보일 때 expiresAt 도달 여부를 확인해 도달했으면 로컬 인증 정보를 정리하고, 도달하지 않았으면 /me로 재확인한다. 재확인의 통신 장애·503은 로그아웃하지 않는다. 401이면 정리한다. 주기적 polling은 없다.
  - 프런트 테스트: 기존 node:test 4개와 Vitest(jsdom, Testing Library) 컴포넌트·인증 상태 테스트. 모킹 테스트 통과는 실제 백엔드 연동 성공이 아니다. 실제 연동은 Codex가 검증한다.

### 처리 함수·검증
| 함수 | 입력 → 출력 | 실패·트랜잭션 | 필수 검사 |
|---|---|---|---|
| loginDemoAccount | loginId/password/remoteAddress → user/token/expiresAt | 400/401/429/503; 제한 행 잠금, 성공 token+audit 또는 실패 제한+audit 커밋 | 실패 동일 응답, 병렬 경계, 비밀 비저장, 성공 ID 초기화 |
| getCurrentUser | token → user/expiresAt | 401/503; 읽기 | 만료·폐기·활성·서버 역할 |
| logout | 선택적 token → 없음 | malformed 400/DB 503; revoke+audit 원자 | 반복·없는·만료 204, 다른 token 보존 |
| 공통 인증/역할 검사 | 요청 → CurrentUser/허용 | 401/403/503; 인증 DB 읽기, 거부 감사 쓰기 | 역할 위조·쿠키 거부·감사 장애 거부 |
- backend: 정상/실패 로그인, /me, 테스트 전용 보호 경로 401/403, 만료/logout, 역할 위조, 실제 MySQL 원자 제한·마이그레이션·통합 검사, CORS/CSRF 정책, 감사 장애·DB 장애, 비노출, 기존 회귀·빌드, PS5.1 절차.
- frontend(Claude Code): /login-/demo, 초기/갱신/만료, 오류별 처리·이전 응답 무시·logout, sessionStorage, 타입/빌드/자체 테스트.
- 최종 실제 연동(Codex): 통합 커밋 고정, 실제 frontend/API/MySQL에서 로그인·사용자역할·새로고침·만료/401·통신 장애·logout 확인. 브라우저 역할별 403은 첫 업무 API까지 이월. 결과·커밋을 Claude Code의 마지막 통합 리뷰에 전달한다.

## 13. EpisodeSource — 회차·원문 관리 — APPROVED (2026-10-05, 사용자 승인)

작성: Claude Code(계약). 구현: backend=Codex, frontend=Claude Code. 이 절의 확정 근거는 DECISIONS.md D-026~D-029(승인)와 D-030(세부, 계약과 함께 2026-10-05 승인). 인증·역할·오류 형식·CORS·Bearer 규칙은 12절을 그대로 따른다. 이 절은 12절의 "업무 API 금지" 제한을 이 기능에 한해 대체한다.

### 범위
- 포함: 회차 생성·목록·상세, 원문 블록 저장(= 새 원문 버전 생성), 버전 이력·버전 조회, 낙관적 충돌 방지, 감사 기록. 운영자(OPERATOR) 전용.
- 제외: 번역, 감수, 발행, 독자 열람, 배정, 이미지, AI, 승인·무효화 구현(연결 기반만 13.6), 회차 삭제·제목 수정, 번역가·감수자 조회(배정 노드에서 추가).

### 13.1 데이터 모델 (Flyway V6~V9, 파일당 DDL 하나, V1~V5 수정 금지, InnoDB·utf8mb4·UTC DATETIME(6))
| 파일 | 테이블 | 컬럼·제약 |
|---|---|---|
| V6 | episode | id BIGINT AI PK, title VARCHAR(100), latest_source_version INT NOT NULL DEFAULT 0, created_by BIGINT FK demo_account, created_at·updated_at DATETIME(6) |
| V7 | episode_source_version | PK(episode_id, version_no), FK episode, created_by FK demo_account, created_at, block_count INT |
| V8 | source_block | PK(episode_id, version_no, seq), FK(episode_id, version_no)→version, page_no INT NULL, body VARCHAR(2000), CHECK(seq>=1), CHECK(page_no IS NULL OR page_no BETWEEN 1 AND 9999) |
| V9 | domain_audit | id BIGINT AI PK, occurred_at, actor_account_id BIGINT NOT NULL FK, event VARCHAR(32) ascii_bin, episode_id BIGINT NULL, source_version INT NULL, INDEX(occurred_at) |
- 원문 버전과 블록 행은 INSERT만 한다. UPDATE·DELETE 금지(버전 불변). `latest_source_version`은 episode 행에서만 갱신한다.
- 순서·유일성은 시각이 아니라 `version_no`와 `UNIQUE(episode_id, version_no)`로 보장한다(D-028).

### 13.2 API (모두 OPERATOR 전용, `Cache-Control: no-store`, JSON UTF-8, ID는 문자열, 시각은 UTC ISO-8601 `Z`)
| API | 요청 | 성공 응답 |
|---|---|---|
| POST /api/episodes | {"title":"…"} | 201 {"id":"1","title":"…","latestSourceVersion":0,"createdAt":"…"} |
| GET /api/episodes?limit=&offset= | limit 1~100(기본 50), offset ≥0(기본 0) | 200 {"items":[{"id","title","latestSourceVersion","updatedAt"}],"total":n} (id 내림차순) |
| GET /api/episodes/{id} | — | 200 {"id","title","latestSourceVersion","createdAt","updatedAt","source":null 또는 {"version","savedAt","savedBy":{"id","displayName"},"blocks":[{"seq","pageNo","text"}]}} |
| PUT /api/episodes/{id}/source | {"expectedVersion":0,"blocks":[{"pageNo":1,"text":"…"}]} | 새 버전이면 201 {"version":n,"changed":true,"savedAt"}, 내용이 최신과 같으면 200 {"version":n,"changed":false} |
| GET /api/episodes/{id}/source/versions | — | 200 {"items":[{"version","savedAt","savedBy":{"id","displayName"},"blockCount"}]} (version 내림차순) |
| GET /api/episodes/{id}/source/versions/{version} | — | 200 {"version","savedAt","savedBy":{…},"blocks":[…]} |
- 경로의 id·version이 `^[1-9][0-9]{0,17}$`가 아니거나 없으면 404 NOT_FOUND.
- 미정의 필드(role·userId·seq 등), 깨진 JSON, 비JSON Content-Type은 400 INVALID_REQUEST. 서버는 클라이언트의 역할·사용자 ID를 신뢰하지 않고 작성자는 인증된 사용자로 정한다.

### 13.3 입력 규칙 (변환 없음: trim·정규화·대소문자 변환 금지, 프런트 동일 검증)
- title: 1~100 코드포인트, 공백만으로 구성 금지, 제어문자 금지.
- blocks: 1~200개. 배열 순서가 seq(1..n)이며 클라이언트가 seq를 보낼 수 없다.
- text: 1~2000 코드포인트, 공백만으로 구성 금지, 제어문자는 탭·개행(\t \n \r)만 허용.
- pageNo: 생략·null 또는 1~9999 정수. expectedVersion: 0 이상 정수.

### 13.4 저장 동작 (PUT source, 하나의 트랜잭션)
1. episode 행을 `SELECT … FOR UPDATE`로 잠근다. 없으면 404.
2. `expectedVersion != latest_source_version`이면 409 VERSION_CONFLICT(error 객체에 `latestVersion` 포함). 아무것도 쓰지 않는다.
3. 최신 버전과 블록 목록(pageNo·text 순서까지)이 같으면 200 changed:false. 새 버전·감사를 만들지 않는다.
4. 다르면 version_no=latest+1로 버전·블록을 INSERT하고 episode.latest_source_version·updated_at을 갱신하며 SOURCE_SAVED를 감사에 기록한다. 감사 저장이 실패하면 전체 롤백하고 503이다.
- 동시에 같은 expectedVersion으로 저장하면 정확히 하나만 201, 나머지는 409이다.
- POST /api/episodes도 episode INSERT와 EPISODE_CREATED 감사를 한 트랜잭션으로 처리한다.

### 13.5 오류 (12절 형식 {"error":{"code","message"}}, 비밀·내부 예외 비노출)
400 INVALID_REQUEST / 401 AUTH_REQUIRED / 403 FORBIDDEN(OPERATOR 아님, ACCESS_DENIED 감사) / 404 NOT_FOUND / 409 VERSION_CONFLICT / 503 SERVICE_UNAVAILABLE(DB 장애, 접근 허용 아님) / 500 INTERNAL_ERROR. 비JSON Content-Type은 500이 아니라 400이다.

### 13.6 감사와 승인 무효화 기반 (D-029)
- domain_audit 이벤트: EPISODE_CREATED, SOURCE_SAVED(episode_id, source_version, 행위자 ID, UTC 시각). 원문 본문·제목·토큰·IP는 저장하지 않는다. 이번 노드는 보관 기간 정리를 만들지 않는다.
- 번역·승인 노드의 제약: 번역 버전과 승인은 `source_version`(어느 원문 버전에 대한 것인지)을 반드시 기록하고, 현재 `latest_source_version`과 다르면 발행 근거로 쓸 수 없다. 이번에는 구현하지 않는다.

### 13.7 처리 함수
| 이름 | 입력 → 출력 | 권한 | 상태 변경 | 실패 | 필수 테스트 |
|---|---|---|---|---|---|
| createEpisode | title, actor → episode | OPERATOR | episode+감사 INSERT | 400/401/403/503 | 정상, 제목 경계, 감사 장애 롤백, 역할 매트릭스 |
| listEpisodes | limit, offset → items,total | OPERATOR | 없음 | 400/401/403/503 | 정렬, 페이지 경계 |
| getEpisode | id → episode+현재 원문 | OPERATOR | 없음 | 404/401/403/503 | 원문 없음 null, 존재하지 않는 id |
| saveSourceVersion | id, expectedVersion, blocks, actor → version | OPERATOR | version·blocks INSERT, episode 갱신, 감사 | 400/404/409/503 | 정상, 충돌, 동일 내용 200, 동시 저장, 불변성, 롤백 |
| listSourceVersions / getSourceVersion | id(,version) → 이력/내용 | OPERATOR | 없음 | 404/401/403/503 | 이력 순서, 과거 버전이 변하지 않음 |

### 13.8 프런트 계약 (Claude Code)
- 경로 /episodes(목록·생성), /episodes/{id}(상세·편집·버전 이력). 기존 (auth) 그룹과 인증 상태를 재사용하고 /demo의 운영자 메뉴 "회차·원문 관리"를 서버가 확인한 OPERATOR에게만 링크로 활성화한다. 다른 역할에는 이 메뉴 항목이 없으며(업무 메뉴는 역할별), 그 역할의 기존 메뉴는 비활성을 유지한다(2026-10-06 문구 명확화, 동작 변경 없음). 역할 표시는 편의 기능이며 서버가 강제한다.
- 서버 역할이 OPERATOR가 아니면 접근 안내를 보이고 API는 호출하지 않는다. API가 401이면 12절의 인증 정리, 403이면 로그인 유지와 권한 안내, 409면 충돌 안내와 "최신 버전 불러오기", 503·통신 장애는 재시도.
- 편집기: 블록 추가·삭제·위/아래 이동, pageNo 입력, 클라이언트 검증은 13.3과 동일. 중복 제출 방지. 초안은 서버 저장 전까지 메모리에만 두고 localStorage 등에 저장하지 않는다. 입력은 변환하지 않는다.

### 13.9 파일 소유권
- Codex 변경: backend/src/main(신규 `episode` 패키지, 보안 규칙에 /api/episodes/** OPERATOR 전용 추가, 공통 오류 형식 재사용), db/migration V6~V9, backend/src/test, README 실행·검증 기록.
- Claude Code 변경: frontend/src, frontend/tests/ui.
- 변경 금지: V1~V5, 기존 인증 동작·계약, 기존 health·auth API, PROJECT_CONTEXT.md, 서로의 영역. 계약 변경이 필요하면 구현을 멈추고 제안한다.

### 13.10 필수 테스트·완료 조건
- backend: 위 처리 함수 테스트, 4개 역할×6개 API 401/403/성공 매트릭스(역할 위조 포함), 실제 MySQL 마이그레이션(V6~V9)·제약·동시 저장·불변성, 오류 비노출·비JSON 400, 기존 회귀·빌드, 통합 테스트가 개발 DB에 행을 남기지 않음(생성한 회차·버전·블록·감사를 정리하되 데모 계정·기존 데이터는 보존).
- frontend: 목록·생성, 편집·검증, 충돌(409), 401·403·503·통신 오류, 중복 제출, 비운영자 접근 안내, 기존 회귀, 타입·빌드. 모킹 테스트 통과는 실제 연동 성공이 아니다.
- 최종 실제 연동(Codex): 실제 frontend/API/MySQL에서 운영자 로그인 → 회차 생성 → 원문 저장 → 수정(버전 증가) → 과거 버전 조회 → 새로고침 후 유지 → 충돌 시나리오. 브라우저 역할별 403은 이번에 첫 업무 API가 생겼으므로 실제 브라우저에서 비운영자 역할의 403을 함께 확인한다(12절에서 이월된 항목).

## 14. 전체 도메인 스키마 — 번역·감수·발행·독자 열람 — APPROVED (2026-10-06, 사용자 승인)

작성: Claude Code. 근거: DECISIONS.md D-031~D-037(승인), D-038(계약과 함께 2026-10-06 승인). 이 절은 **스키마와 규칙만** 확정한다. API·화면은 노드별로 이후에 계약한다(14.7). 적용은 Codex가 한 번에 수행하고 제약을 실제 MySQL로 검증한다. 기존 V1~V9는 수정하지 않는다.

### 14.1 개념도 (기존 테이블은 굵게)
```
demo_account ─┬─< episode_assignment >─ episode            (번역가·감수자 각 1명)
              │
 episode ─< episode_source_version ─< source_block                     (기존, 불변)
    │            ▲  (episode_id, source_version_no)
    │            │
    ├─< translation_version ─< translation_block ──> source_block      (블록 단위 연결)
    │        │  1:0..1
    │        └── review_decision                                        (승인·반려 1건)
    ├─< publication ──> translation_version                            (발행 이력)
    └── published_translation_version_id ──> translation_version        (공개 중인 버전 포인터)
 domain_audit (기존 + translation_version_id)
```

### 14.2 마이그레이션 (V10~V19, 파일당 DDL 하나, InnoDB·utf8mb4·UTC DATETIME(6), 열거값은 ascii_bin VARCHAR + CHECK)
| 파일 | 변경 | 핵심 제약 |
|---|---|---|
| V10 | demo_account에 `UNIQUE(id, role)` 추가 | 역할 일치 외래키의 기반. 배정된 계정의 역할 변경을 막는다 |
| V11 | episode_assignment | PK(episode_id, assignee_role) → 회차당 역할별 1명. FK(episode_id)→episode, **FK(account_id, assignee_role)→demo_account(id, role)**(번역가 칸에는 TRANSLATOR 계정만), assigned_by FK, assigned_at DATETIME(6)(V21에서 추가), CHECK(assignee_role IN ('TRANSLATOR','REVIEWER')) |
| V12 | translation_version | id PK, episode_id, version_no, source_version_no, status, created_by, created_at, submitted_at NULL, 생성 컬럼 `open_slot`(status가 DRAFT·REVIEW_PENDING이면 1, 아니면 NULL). UNIQUE(episode_id, version_no), **UNIQUE(episode_id, open_slot)**(열린 버전 하나), UNIQUE(episode_id, id), UNIQUE(id, episode_id, source_version_no). **FK(episode_id, source_version_no)→episode_source_version**, created_by FK. CHECK(status IN ('DRAFT','REVIEW_PENDING','REJECTED','APPROVED','PUBLISHED','INVALIDATED','ON_HOLD')), CHECK(version_no>=1) |
| V13 | translation_block | PK(translation_version_id, source_seq), body VARCHAR(4000) NOT NULL. **FK(translation_version_id, episode_id, source_version_no)→translation_version(id, episode_id, source_version_no)**, **FK(episode_id, source_version_no, source_seq)→source_block** → 번역 블록은 자기 번역 버전의 원문 버전에 실제로 있는 블록에만 붙는다. CHECK(CHAR_LENGTH(body)>=1) |
| V14 | review_decision | id PK, translation_version_id **UNIQUE**, decision, reason VARCHAR(500) NULL, reviewer_id FK, source_version_no, decided_at, invalidated_at NULL. FK→translation_version, CHECK(decision IN ('APPROVED','REJECTED')), **CHECK(반려면 reason이 1~500자, 승인이면 reason NULL)**, CHECK(invalidated_at IS NULL OR decision='APPROVED') |
| V15 | episode에 latest_translation_version INT NOT NULL DEFAULT 0 | 번역 버전 번호 발급용(원문의 latest_source_version과 같은 방식) |
| V16 | episode에 published_translation_version_id BIGINT NULL | 공개 중인 번역 버전 포인터 |
| V17 | episode에 FK(id, published_translation_version_id)→translation_version(episode_id, id) | 포인터는 **같은 회차의 번역 버전만** 가리킨다(NULL 허용) |
| V18 | publication | id PK, episode_id, translation_version_id, source_version_no, published_by FK, published_at. FK(episode_id, translation_version_id)→translation_version(episode_id, id), FK(episode_id, source_version_no)→episode_source_version |
| V19 | domain_audit에 translation_version_id BIGINT NULL 추가 | 번역·감수·발행 이벤트 연결 |
- 순서·유일성은 시각이 아니라 `version_no`와 UNIQUE로 보장한다(D-028). 모든 FK는 ON DELETE/UPDATE RESTRICT(삭제 기능 없음).
- 기존 데이터(회차·원문·계정·토큰·감사)는 보존한다. 새 테이블은 비어 있다.
- **NOT NULL 규칙(2026-10-06 명확화·D-039)**: 위 표에서 NULL 허용을 명시하지 않은 컬럼은 모두 NOT NULL이다. NULL 허용은 `translation_version.submitted_at`, `review_decision.reason`, `review_decision.invalidated_at`, `episode.published_translation_version_id`, `domain_audit.translation_version_id`뿐이다(15절 V26에서 `domain_audit.subject_account_id` 추가). 이유: 복합 FK는 구성 컬럼 중 하나라도 NULL이면 검사되지 않고 CHECK도 NULL이면 통과하므로, NULL을 허용하면 "DB가 직접 막는 규칙"이 우회된다(일회용 DB에서 재현 확인).
- **보정 마이그레이션 V20~V25**: V11~V18은 이미 적용되어 수정할 수 없으므로 새 파일로 보정한다(파일당 DDL 하나, 해당 테이블은 비어 있다).
| 파일 | 변경 |
|---|---|
| V20 | episode_assignment: account_id, assigned_by NOT NULL |
| V21 | episode_assignment: assigned_at DATETIME(6) NOT NULL 추가(배정 시각) |
| V22 | translation_version: episode_id, version_no, source_version_no, status, created_by, created_at NOT NULL |
| V23 | translation_block: episode_id, source_version_no NOT NULL |
| V24 | review_decision: translation_version_id, decision, reviewer_id, source_version_no, decided_at NOT NULL (foreign_key_checks 래퍼 필요) |
| V25 | publication: episode_id, translation_version_id, source_version_no, published_by, published_at NOT NULL (foreign_key_checks 래퍼 필요) |
- **V24·V25의 적용 방식(2026-10-06 변경, D-039 보완)**: MySQL 8.4는 FK 검사가 켜진 상태에서 FK 컬럼을 NOT NULL로 바꾸면 오류 1832로 거부한다(`review_decision.reviewer_id`·`translation_version_id`로 재현, `ALGORITHM=COPY`로도 불가). 일회용 DB에서 아래 형태가 통과하고 FK·CHECK·UNIQUE가 보존되며 NULL 우회가 모두 거부됨을 확인했다. V24·V25 파일은 다음 구조로 쓴다(ALTER 문은 표의 컬럼 정의 그대로).
```sql
SET foreign_key_checks=0;
ALTER TABLE <table> MODIFY COLUMN ... NOT NULL, ...;
SET foreign_key_checks=1;
```
  `SET`은 DDL이 아니므로 "파일당 DDL 하나"를 지킨다. 이미 NULL 행이 있으면 NOT NULL 변경 자체가 실패하므로 데이터를 숨기지 않는다. 다른 방식(FK 삭제·재생성 등)이 필요하면 구현을 멈추고 변경 제안을 보고한다. 검증 때 파일 실행 후 `@@foreign_key_checks`가 1로 돌아왔는지, FK 개수·이름이 변경 전과 같은지 확인한다.
- 기존 FK·CHECK·UNIQUE·생성 컬럼(open_slot)은 그대로 유지하고, 컬럼 변경이 MySQL 8.4에서 막히면(예: 생성 컬럼이 참조하는 status) 우회하지 말고 변경 제안을 보고한다.

### 14.3 상태 전이 (서비스가 강제, 모든 전이는 episode 행 `FOR UPDATE` 후 기대 상태 확인, 불일치 409)
| 전이 | 행위자 | 조건 | 부가 효과 |
|---|---|---|---|
| (없음) → DRAFT | 배정된 TRANSLATOR | 원문 있음, 열린 버전 없음. 새 버전은 최신 원문 기준으로 직전 버전 내용을 source_seq가 같은 블록끼리 복사 | latest_translation_version+1, TRANSLATION_CREATED |
| DRAFT 편집 | 배정된 TRANSLATOR | DRAFT인 동안만 | 제출 후에는 수정·삭제 불가(불변) |
| DRAFT → REVIEW_PENDING | 배정된 TRANSLATOR | 모든 원문 블록에 번역(공백만 불가), 원문 버전이 최신 | submitted_at, TRANSLATION_SUBMITTED |
| REVIEW_PENDING → APPROVED | 배정된 REVIEWER | 작성자가 아님, 원문 버전이 최신 | review_decision 1건, REVIEW_APPROVED |
| REVIEW_PENDING → REJECTED | 배정된 REVIEWER | 사유 1~500자, 작성자가 아님 | review_decision 1건, REVIEW_REJECTED. 이후 번역가가 새 DRAFT를 만든다(REJECTED→DRAFT의 구현) |
| APPROVED → PUBLISHED | OPERATOR | 요청의 번역 버전이 승인된 바로 그 버전, 승인이 무효화되지 않음, 원문 버전이 최신 | 포인터 갱신, publication 1건, PUBLISHED 감사 |
| DRAFT·REVIEW_PENDING·APPROVED → INVALIDATED | 시스템(원문 저장 트랜잭션) | 원문이 새 버전으로 저장됨 | 승인이 있었으면 invalidated_at 설정+APPROVAL_INVALIDATED. **기존 saveSourceVersion 트랜잭션에 포함**(번역 노드에서 구현). 공개본·포인터는 그대로 |
| PUBLISHED ↔ ON_HOLD | OPERATOR | **예약만**(선택 기능, 구현 안 함) | — |
- REJECTED·INVALIDATED는 종결 상태이고 새 DRAFT 생성으로만 이어진다. 이전에 PUBLISHED였던 버전은 다른 버전이 발행되어도 PUBLISHED로 남고 현재 공개본은 포인터가 정한다.
- 서버가 매번 DB에서 역할·배정·작성자를 확인한다. 클라이언트가 보낸 역할·ID·상태를 신뢰하지 않는다.

### 14.4 접근 범위 (D-038)
| 대상 | OPERATOR | 배정된 TRANSLATOR | 배정된 REVIEWER | READER·비로그인 |
|---|---|---|---|---|
| 회차·원문 | 전체 | 배정된 회차의 원문 읽기 | 배정된 회차의 원문 읽기 | 불가 |
| 번역 버전·블록 | 읽기 전체 | 배정된 회차의 모든 번역 버전, DRAFT 편집·제출 | REVIEW_PENDING·APPROVED·REJECTED 버전 읽기, 승인·반려 | 불가 |
| 발행 | 실행 | 불가 | 불가 | — |
| 공개본(포인터가 가리키는 번역 버전) | 읽기 | 읽기 | 읽기 | 읽기(로그인 불필요) |
- 역할은 서로 상속하지 않는다(운영자가 번역·감수 권한을 갖지 않는다). 배정되지 않은 회차에 번역가·감수자가 접근하면 **404 NOT_FOUND**(존재 노출 방지), 역할 자체가 없으면 403 FORBIDDEN, 비로그인은 보호 API 401.
- 독자 공개 API는 `/api/public/**`(permitAll)에서 **번역 텍스트와 페이지·순서만** 반환하고 원문 텍스트·초안·비공개 회차·내부 ID(작성자 등)는 반환하지 않는다.

### 14.5 DB로 표현하지 않는 규칙 (서비스와 테스트로 막는다)
승인된 정확한 번역 버전만 발행 / 무효화된 승인은 발행 근거가 아님 / 감수자는 작성자가 아님 / 제출 후 번역 블록 불변 / 모든 원문 블록 번역 완료 후 제출 / 배정된 담당자만 행위 / 열린 버전 외의 상태 전이 순서. 이 규칙마다 서비스 테스트(실제 MySQL)가 있어야 하며, 마이그레이션 노드는 DB가 막는 항목(14.2의 굵은 제약, UNIQUE, CHECK, 복합 FK)만 검증한다.

### 14.6 마이그레이션 노드(Codex) 완료 조건·테스트
- V10~V19가 **빈 DB**와 **V1~V9가 적용된 기존 DB(데이터 있음)** 모두에서 적용되고, 기존 행 수·내용이 변하지 않으며, V1~V9 체크섬이 그대로이고 Flyway validate가 통과한다.
- **NULL 거부 테스트(보정 필수)**: 14.2의 NOT NULL 컬럼마다 NULL 삽입이 거부(MySQL 오류 1048)되는지, 그리고 NULL로 우회되던 시나리오(상태·원문 버전이 NULL인 번역 버전, 키가 NULL인 번역 블록, decision이 NULL인 감수 결정, 전부 NULL인 발행 이력, 담당자 없는 배정)가 모두 거부되는지 확인한다. 정상 값은 계속 허용되어야 한다.
- 제약별 실제 MySQL 테스트(위반 시 거부, 정상 시 허용): 배정 역할 불일치 FK, 역할당 1명 PK, 열린 버전 둘째 DRAFT·REVIEW_PENDING 거부와 REJECTED·INVALIDATED 다수 허용, 번역 버전의 원문 버전 FK, 번역 블록의 원문 블록 FK와 복합 FK 불일치 거부, 상태 CHECK, 반려 사유 CHECK(없음·501자 거부), 번역 버전당 결정 1건, 발행 이력과 포인터의 회차 불일치 거부, domain_audit 컬럼 추가.
- 테스트는 만든 행만 정확히 정리하고 데모 계정·기존 데이터·제한 행을 늘리거나 지우지 않는다. 연속 2회 통과·전후 행 수 비교를 보고한다. 이 노드에서 API·서비스 코드는 만들지 않는다.
- 변경 가능: backend/src/main/resources/db/migration(V10~V19 신규), backend/src/test, README 검증 기록. 변경 금지: V1~V9, 기존 서비스·API, frontend/, 문서 3종.

### 14.7 이후 노드 (각각 별도 계약, 스키마 변경이 필요하면 구현을 멈추고 14절 변경을 제안)
1. 배정 — 운영자의 배정·조회, 번역가·감수자의 배정 회차 목록. 2. 번역 — 버전 생성(복사)·편집·제출, 원문 변경 시 무효화(saveSourceVersion 수정 포함). 3. 감수 — 대기 목록·원문 대조 조회·승인·반려. 4. 발행 — 승인본 발행과 공개본 고정. 5. 독자 열람 — 공개 목록·상세. 각 노드는 CONTRACTS 계약 → 사용자 승인 → Codex 백엔드 / Claude Code 프런트 → 실제 연동 검증 → 리뷰 순서를 따른다.

## 15. Assignment — 담당자 배정·배정 회차 조회 — APPROVED (2026-10-06, 사용자 승인)

작성: Claude Code. 구현: backend=Codex, frontend=Claude Code. 근거: DECISIONS.md D-031(배정)·D-038(접근 범위)·D-040(승인)·D-041(계약과 함께 2026-10-06 승인). 인증·역할·오류 형식·CORS·Bearer 규칙은 12절, 회차 API 규칙은 13절을 그대로 따른다. 스키마는 14절(`episode_assignment`)을 쓰며 이 노드에서 마이그레이션 V26 하나만 추가한다.

### 범위
- 포함: 운영자의 번역가·감수자 지정·교체와 현재 배정 조회, 지정 후보 계정 목록, 번역가·감수자의 "내 배정 회차" 목록과 원문 읽기(읽기 전용), 감사 `ASSIGNED`.
- 제외: 번역·감수·발행, 배정 해제(D-040: 교체만), 계정 생성·수정, 배정 이력 조회 화면, 알림.

### 15.1 마이그레이션 (V26, DDL 하나)
- `ALTER TABLE domain_audit ADD COLUMN subject_account_id BIGINT NULL` — 감사 대상(배정받은) 계정. 14.2의 "NULL 허용 컬럼" 목록에 추가한다(FK 없음, `translation_version_id`와 같은 방식). 배정 이력(누가 어떤 역할을 누구에게)은 이 컬럼과 계정의 역할로 복원한다.
- V1~V25 수정 금지. 기존 데이터 보존.

### 15.2 API
| API | 권한 | 요청 | 성공 응답 |
|---|---|---|---|
| GET /api/assignable-accounts?role=TRANSLATOR\|REVIEWER | OPERATOR | role 필수 | 200 {"items":[{"id","displayName","role"}]} (활성 계정만, id 오름차순, loginId·비밀번호 미노출) |
| GET /api/episodes/{id}/assignments | OPERATOR | — | 200 {"translator":{"account":{"id","displayName"},"assignedAt"}\|null,"reviewer":{…}\|null} |
| PUT /api/episodes/{id}/assignments/{role} (role=translator\|reviewer) | OPERATOR | {"accountId":"2"} | 처음 지정 201, 교체·동일 200. {"role":"TRANSLATOR","account":{"id","displayName"},"assignedAt","changed":true\|false} |
| GET /api/my/episodes?limit=&offset= | TRANSLATOR 또는 REVIEWER | limit 1~100(기본 50), offset ≥0 | 200 {"items":[{"id","title","assignedRole","latestSourceVersion","assignedAt","updatedAt"}],"total":n} (회차 id 내림차순) |
| GET /api/my/episodes/{id} | TRANSLATOR 또는 REVIEWER | — | 200 {"id","title","assignedRole","latestSourceVersion","source":null\|{"version","savedAt","blocks":[{"seq","pageNo","text"}]}} (최신 원문, 읽기 전용) |
- 모두 `Cache-Control: no-store`, ID는 문자열, 시각은 UTC ISO-8601 `Z`. 경로의 id가 `^[1-9][0-9]{0,17}$`가 아니거나 role 세그먼트가 `translator`·`reviewer`가 아니면 404 NOT_FOUND. 배정 해제용 DELETE는 두지 않는다(405).
- 미정의 필드·깨진 JSON·비JSON Content-Type은 400 INVALID_REQUEST. `accountId`는 JSON 문자열이며 숫자 JSON은 400.
- 역할 요구 위반(운영자가 `/api/my/**`, 번역가·감수자·독자가 운영자 API, 독자가 `/api/my/**`)은 403 FORBIDDEN(ACCESS_DENIED 감사), 비로그인은 401 AUTH_REQUIRED.

### 15.3 규칙
- **지정(PUT)**: 하나의 트랜잭션에서 episode 행을 `FOR UPDATE`로 잠그고 → 대상 계정이 존재·활성이며 계정 역할이 요청 역할과 같은지 검사(아니면 400 INVALID_REQUEST) → 같은 계정이 이미 그 칸이면 `changed:false`로 200(쓰기·감사 없음) → 아니면 `INSERT … ON DUPLICATE KEY UPDATE`로 칸을 채우거나 교체(assigned_by=운영자, assigned_at=지금) → 감사 `ASSIGNED`(actor=운영자, episode_id, subject_account_id=배정받은 계정). 감사 저장이 실패하면 전체 롤백하고 503 SERVICE_UNAVAILABLE. DB의 복합 FK가 역할 불일치를 한 번 더 막는다. 존재하지 않는 회차는 404.
- **교체(D-040)**: 허용한다. 작성 중이던 번역 초안이 있어도 막지 않으며, 이후 번역 노드에서 "초안 편집 권한 = 현재 배정된 번역가"로 판정한다(기존 작성자는 기록으로 남는다). 감수 대기 중인 버전도 새 감수자가 이어받는다. 교체 즉시 이전 담당자는 `/api/my/**`에서 그 회차를 볼 수 없다.
- **내 배정(조회)**: 호출자 계정이 `episode_assignment`에 있는 회차만 반환한다. 매 요청 DB에서 확인하며 클라이언트가 보낸 역할·ID는 신뢰하지 않는다. 배정되지 않았거나 존재하지 않는 회차는 **404 NOT_FOUND**(존재 노출 방지, D-038). 원문이 없으면 `source:null`. 번역가·감수자에게 작성자·내부 ID는 노출하지 않는다.
- 동시에 같은 칸을 교체하면 둘 다 성공하고 마지막 커밋이 남으며 행은 항상 하나다(PK). 감사는 두 건 모두 남는다.
- 오류 형식은 12·13절과 같다(`{"error":{"code","message"}}`, 비밀·내부 예외 비노출). 코드: 400 INVALID_REQUEST, 401 AUTH_REQUIRED, 403 FORBIDDEN, 404 NOT_FOUND, 503 SERVICE_UNAVAILABLE, 500 INTERNAL_ERROR.

### 15.4 처리 함수
| 이름 | 입력 → 출력 | 권한 | 상태 변경 | 실패 | 필수 테스트 |
|---|---|---|---|---|---|
| listAssignableAccounts | role → 계정 목록 | OPERATOR | 없음 | 400/401/403/503 | 활성만, 역할별, loginId 미노출, 잘못된 role 400 |
| getAssignments | episodeId → 두 칸 | OPERATOR | 없음 | 404/401/403/503 | 미배정 null, 배정 후 값 |
| setAssignment | episodeId, role, accountId, actor → 결과 | OPERATOR | episode_assignment UPSERT+감사 | 400/404/503 | 신규 201, 교체 200, 동일 200 changed:false(감사 없음), 역할 불일치·비활성·없는 계정 400, 감사 장애 롤백, 동시 교체 |
| listMyEpisodes | 호출자, limit, offset → 목록 | TRANSLATOR·REVIEWER | 없음 | 400/401/403/503 | 본인 배정만, 다른 사람 배정 제외, 정렬·페이지 |
| getMyEpisode | 호출자, episodeId → 회차+최신 원문 | TRANSLATOR·REVIEWER | 없음 | 404/401/403/503 | 배정 시 본문 일치, 미배정·없는 회차 404, 교체 후 이전 담당자 404 |

### 15.5 프런트 계약 (Claude Code)
- 운영자 `/episodes/{id}`에 "담당자 배정" 영역을 추가한다: 역할(번역가·감수자)마다 현재 담당자(이름, 배정 시각 UTC)나 "미배정", 후보 선택 목록, "배정"/"교체" 버튼. 후보는 `assignable-accounts`에서 불러온다. 중복 제출 방지, 401은 인증 정리, 403은 권한 안내, 503·통신 오류는 재시도, 400은 고정 안내.
- `/demo`: 번역가·감수자 메뉴 맨 앞에 "배정된 회차"를 링크(`/assigned`)로 활성화한다. 기존 메뉴(배정된 번역 작성·검수 제출·검수 대기 목록·승인·반려)는 비활성 유지, 운영자·독자 메뉴는 변경 없음.
- `/assigned`(목록)와 `/assigned/{id}`(읽기 전용 원문: 제목, 내 담당 역할, 최신 원문 블록과 페이지 번호). 서버가 확인한 역할이 번역가·감수자가 아니면 안내만 보이고 API는 호출하지 않는다(편의 기능, 서버가 강제). 404는 "배정되지 않았거나 존재하지 않는 회차" 안내와 목록 링크. 편집·저장 UI는 만들지 않는다.

### 15.6 파일 소유권
- Codex 변경: backend/src/main(신규 `assignment` 패키지, 보안 규칙에 `/api/assignable-accounts` OPERATOR 전용·`/api/my/**` TRANSLATOR·REVIEWER 전용 추가, 공통 오류 처리 재사용), db/migration V26, backend/src/test, README 실행·검증 기록.
- Claude Code 변경: frontend/src, frontend/tests/ui.
- 변경 금지: V1~V25, 기존 인증·회차·원문 API 동작, PROJECT_CONTEXT.md, 서로의 영역. 계약 변경이 필요하면 구현을 멈추고 제안한다.

### 15.7 필수 테스트·완료 조건
- backend(실제 MySQL): 위 처리 함수 테스트, 4개 역할 × 5개 API의 401/403/성공 매트릭스(역할 위조 헤더·본문 포함), V26 적용·기존 감사 행 보존, 역할 불일치가 서비스 검사와 DB 복합 FK 양쪽에서 막힘, 오류 비노출·비JSON 400, 기존 회귀·빌드. 통합 테스트가 만든 회차·배정·감사·계정 행만 정확히 정리하고 데모 계정·기존 데이터·제한 행을 늘리거나 줄이지 않으며 연속 2회 통과·전후 행 수를 비교한다.
- frontend: 배정 영역(조회·지정·교체·오류), `/assigned` 목록·상세(404 포함), 비해당 역할 안내와 API 미호출, `/demo` 메뉴 변경, 중복 제출·늦은 응답 무시, 기존 회귀, 타입·빌드. 모킹 테스트 통과는 실제 연동 성공이 아니다.
- 최종 실제 연동(Codex, 격리 환경 권장 — 삭제 API가 없어 만든 회차·배정이 남음): 운영자가 회차에 번역가·감수자를 배정 → 번역가·감수자가 각자 로그인해 "배정된 회차"에서 해당 회차와 원문을 봄 → 배정되지 않은 두 번째 회차는 404 안내 → 교체 후 이전 담당자가 즉시 접근 불가, 새 담당자 접근 → 운영자·독자가 `/assigned` 접속 시 안내만, 같은 토큰으로 `/api/my/**`·운영자 API를 호출하면 브라우저에서 403을 읽을 수 있음 → PUT preflight·새로고침 유지·`ASSIGNED` 감사(subject 포함) 확인.

## 16. 스키마 보정 2 — V6~V9 NOT NULL — APPROVED (2026-10-06, 사용자 승인)

작성: Claude Code. 근거: DECISIONS.md D-039(NOT NULL 규칙)·D-042(계약과 함께 2026-10-06 승인). 14.2의 NOT NULL 규칙은 V10~V19 테이블에만 적용되어 있어, 더 일찍 만든 테이블(V6~V9)에 같은 NULL 허용 컬럼이 남았다(개발 DB `information_schema`로 확인). 애플리케이션은 항상 값을 넣어 지금 동작에는 영향이 없지만, DB 수준에서는 작성자 없는 회차·원문 버전, 본문이 NULL인 원문 블록, 이벤트가 없는 감사 행이 들어갈 수 있다. 번역 노드가 `source_block`·`domain_audit`에 의존하므로 구현 전에 맞춘다.

### 16.1 규칙 확장
NOT NULL 규칙은 **모든 도메인·인증 테이블**에 적용한다. NULL 허용은 아래 목록뿐이다(이유가 있는 선택적 값).
- `auth_audit.account_id`, `auth_login_limit.blocked_until`, `auth_token.revoked_at`
- `source_block.page_no`, `episode.published_translation_version_id`, `translation_version.submitted_at`
- `review_decision.reason`, `review_decision.invalidated_at`
- `domain_audit.episode_id`, `domain_audit.source_version`, `domain_audit.translation_version_id`, `domain_audit.subject_account_id`
- 생성 컬럼 `translation_version.open_slot`(정의상 NULL)
새 마이그레이션이 이 목록 밖의 NULL 허용 컬럼을 만들면 위반이다.

### 16.2 보정 마이그레이션 (V27~V30, 파일당 DDL 하나, V1~V26 수정 금지)
적용된 컬럼 정의(타입·charset·collation)는 **기존과 동일하게** 다시 쓴다(원문은 V6~V9). 대상 테이블은 개발 DB에서 행이 0개이며, NULL 행이 있으면 NOT NULL 변경 자체가 실패하므로 데이터를 숨기지 않는다.
| 파일 | 변경 | 방식 |
|---|---|---|
| V27 | episode: title, created_by, created_at, updated_at NOT NULL | `SET foreign_key_checks=0;` → ALTER → `SET foreign_key_checks=1;` (created_by가 FK 컬럼, 오류 1832 회피, D-039 보완과 동일) |
| V28 | episode_source_version: created_by, created_at, block_count NOT NULL | 같은 래퍼 |
| V29 | source_block: body NOT NULL (page_no는 NULL 유지) | 래퍼 불필요(FK 컬럼 아님) |
| V30 | domain_audit: occurred_at, event NOT NULL | 래퍼 불필요 |
- 기존 FK·CHECK·UNIQUE·인덱스는 그대로 유지한다. MySQL 8.4가 변경을 막으면 우회하지 말고 구현을 멈추고 변경 제안을 보고한다.

### 16.3 필수 테스트 (실제 MySQL, 건너뛰기 불가)
- 위 컬럼마다 NULL 삽입이 거부(1048 또는 기본값 없음 1364)되고 정상 값은 허용된다.
- **스키마 검사 테스트**: `information_schema`에서 현재 NULL 허용 컬럼 집합이 16.1 목록과 **정확히 일치**하는지 확인한다(이후 마이그레이션이 규칙을 어기면 실패).
- 적용 경로 2가지: 빈 DB(V1~V30)와 **데이터가 있는 V26 DB**(회차·원문 버전·블록·감사 행이 있는 상태)에 V27~V30을 올리는 경로. 기존 행 수·내용 보존, V1~V26 체크섬 불변, Flyway validate 통과, FK 개수·이름·규칙(전체 19개 이상) 변경 전과 동일, `@@foreign_key_checks`가 1로 복구됨.
- 기존 EpisodeSource·Assignment·인증 통합 테스트와 전체 회귀가 수정 없이 통과한다(애플리케이션 코드는 이미 값을 넣는다). 기존 Flyway 마이그레이션 테스트의 기대 버전은 30으로 갱신한다.
- 테스트 위생: 만든 행만 정확히 정리, 데모 계정·기존 데이터·제한 행 수 불변, 연속 2회 통과·전후 행 수 비교.

### 16.4 개발 DB 적용·파일 소유권
- 개발 DB(3306) 적용은 일회용 DB 검증이 모두 통과한 뒤 마지막에, **적용 전 사용자 확인**을 받는다. 적용 후 Flyway 이력 30 성공, 재실행 추가 적용 0개, 기존 행 수 유지, NULL 허용 컬럼이 16.1 목록과 일치함을 읽기 전용으로 확인한다.
- Codex 변경: db/migration V27~V30, backend/src/test, README 검증 기록. 금지: V1~V26, Java 운영 코드, frontend/, 문서 3종, PROJECT_CONTEXT.md.

## 17. Translation — 번역 작성·제출과 원문 변경 시 무효화 — APPROVED (2026-10-06, 사용자 승인)

작성: Claude Code. 구현: backend=Codex, frontend=Claude Code. 근거: DECISIONS.md D-032·D-033·D-035·D-038·D-040(승인), D-043(승인), D-044(계약과 함께 2026-10-06 승인). 인증·역할·오류 형식·CORS는 12절, 회차·원문은 13절, 스키마·NOT NULL 규칙은 14·16절, 배정은 15절을 따른다. 이 노드는 마이그레이션 V31 하나와 기존 `saveSourceVersion` 수정을 포함한다.

### 범위
- 포함: 번역가의 번역 버전 생성(복사), DRAFT 편집(전체 교체 저장), 검수 제출, 번역 버전 목록·상세 조회, 원문 저장 시 미발행 번역 버전 무효화.
- 제외: 감수(승인·반려)·발행·독자 열람(다음 노드), 운영자·감수자의 번역 조회(감수·발행 노드), 제출 철회(D-043: 두지 않음), AI 번역 초안(선택 기능), 번역 버전 삭제.

### 17.1 마이그레이션 (V31, DDL 하나)
`ALTER TABLE translation_version ADD COLUMN draft_revision INT NOT NULL DEFAULT 1` — DRAFT 저장의 충돌 방지용 리비전(14.2 NOT NULL 규칙·16.1 NULL 허용 목록 변경 없음). V1~V30 수정 금지, 기존 데이터 보존, 스키마 검사 테스트의 기대 버전은 31로 갱신한다.

### 17.2 API (모두 TRANSLATOR 전용이며 호출자는 그 회차의 **현재 배정된** 번역가여야 한다)
버전은 회차 안의 `versionNo`(정수)로 식별하며 DB id는 노출하지 않는다. 시각은 UTC ISO-8601 `Z`, `Cache-Control: no-store`.
| API | 요청 | 성공 응답 |
|---|---|---|
| GET /api/my/episodes/{id}/translations | — | 200 {"latestSourceVersion":n,"items":[{"versionNo","status","sourceVersion","revision","createdAt","submittedAt"\|null}]} (versionNo 내림차순) |
| POST /api/my/episodes/{id}/translations | 본문 없음 | 201 {"versionNo","status":"DRAFT","sourceVersion","revision":1} |
| GET /api/my/episodes/{id}/translations/{versionNo} | — | 200 {"versionNo","status","sourceVersion","revision","createdAt","submittedAt"\|null,"editable":bool,"blocks":[{"seq","pageNo","source":"원문","text":"번역"\|null}]} (그 번역 버전이 묶인 원문 버전의 모든 블록, seq 오름차순) |
| PUT /api/my/episodes/{id}/translations/{versionNo} | {"expectedRevision":1,"blocks":[{"seq":1,"text":"…"}]} | 200 {"revision":n,"changed":true\|false} |
| POST /api/my/episodes/{id}/translations/{versionNo}/submit | {"expectedRevision":n} | 200 {"versionNo","status":"REVIEW_PENDING","submittedAt"} |
- 경로의 id·versionNo가 `^[1-9][0-9]{0,17}$`(versionNo는 `^[1-9][0-9]{0,8}$`)가 아니거나, 존재하지 않거나, **배정되지 않은 회차**이면 404 NOT_FOUND(D-038). 역할 위반(운영자·감수자·독자)은 403 FORBIDDEN(ACCESS_DENIED 감사), 비로그인 401. 새 번역가로 교체되면 이전 번역가는 즉시 404, 새 번역가는 기존 DRAFT를 이어서 편집할 수 있다(D-040).
- 미정의 필드·깨진 JSON·비JSON Content-Type은 400 INVALID_REQUEST. 번역가에게 작성자·내부 ID는 노출하지 않는다.

### 17.3 규칙 (모든 변경은 episode 행 `SELECT … FOR UPDATE` 후 하나의 트랜잭션)
- **생성(POST)**: 원문이 있고(`latest_source_version ≥ 1`) 열린 버전(DRAFT·REVIEW_PENDING)이 없어야 한다(아니면 409 STATE_CONFLICT). `version_no=latest_translation_version+1`, `source_version_no=latest_source_version`, status `DRAFT`, `draft_revision=1`. 직전 번역 버전(상태 무관, 가장 큰 versionNo)이 있으면 그 번역 텍스트를 **새 원문 버전에도 존재하는 같은 `source_seq` 블록에만** 복사한다. 감사 `TRANSLATION_CREATED`(translation_version_id).
- **저장(PUT)**: status가 DRAFT여야 한다(아니면 409 STATE_CONFLICT, `currentStatus` 포함 — 예: 원문 변경으로 INVALIDATED). `expectedRevision`이 현재 리비전과 같아야 한다(아니면 409 VERSION_CONFLICT, `latestRevision` 포함). 요청의 `blocks`는 그 버전의 원문 버전에 있는 `seq`만(중복·없는 seq는 400)이며 **번역 블록 전체를 교체**한다(요청에 없는 seq는 번역 없음). 빈 배열은 허용한다(모든 번역 지움). 저장 결과가 현재와 같으면 200 `changed:false`(리비전·쓰기 없음), 다르면 리비전 +1로 200 `changed:true`. DRAFT 저장은 감사를 남기지 않는다.
- **제출(POST submit)**: DRAFT이고 `expectedRevision`이 일치하며 `source_version_no`가 최신 원문 버전과 같아야 한다. **모든 원문 블록에 번역이 있어야** 한다(공백만 불가). 부족하면 400 INCOMPLETE_TRANSLATION(error 객체에 `missingSeqs` 배열). 성공하면 status `REVIEW_PENDING`, `submitted_at`=지금, 감사 `TRANSLATION_SUBMITTED`. 제출 후에는 번역 블록·상태를 바꾸는 번역가 API가 없다(불변). 감사 저장 실패는 전체 롤백과 503.
- **입력 규칙(변환 없음, 프런트 동일 검증)**: 번역 텍스트 1~4000 코드포인트, 공백만 불가, 제어문자는 탭·개행(\t \n \r)만 허용, trim·정규화 금지. `expectedRevision`은 1 이상의 정수.
- **원문 변경 시 무효화(D-033, 기존 `saveSourceVersion`에 포함)**: 새 원문 버전을 저장하는 같은 트랜잭션에서 그 회차의 `DRAFT`·`REVIEW_PENDING`·`APPROVED` 번역 버전을 `INVALIDATED`로 바꾼다. 그중 `APPROVED`이던 버전마다 `review_decision.invalidated_at`을 지금으로 설정하고 감사 `APPROVAL_INVALIDATED`(episode_id, source_version=새 버전, translation_version_id)를 기록한다. `REJECTED`·`INVALIDATED`·`PUBLISHED`·`ON_HOLD`와 공개 포인터는 건드리지 않는다. 원문 내용이 같아 새 버전을 만들지 않는 저장(`changed:false`)은 아무것도 무효화하지 않는다. 무효화·감사 중 하나라도 실패하면 **원문 저장 전체를 롤백**하고 503이다. 기존 원문 저장 API의 요청·응답 형식과 기존 동작은 바뀌지 않는다.
- 같은 회차에 대한 번역 변경과 원문 저장은 episode 행 잠금으로 직렬화된다: 원문 저장이 먼저 커밋되면 이후 번역 저장·제출은 409 STATE_CONFLICT(INVALIDATED)이고, 번역 제출이 먼저면 그 REVIEW_PENDING 버전이 원문 저장으로 INVALIDATED가 된다.
- 오류 형식은 12·13절과 같다(`{"error":{"code","message"}}` + 위에 명시한 추가 필드만). 코드: 400 INVALID_REQUEST·INCOMPLETE_TRANSLATION, 401, 403, 404, 409 VERSION_CONFLICT·STATE_CONFLICT, 503 SERVICE_UNAVAILABLE, 500 INTERNAL_ERROR. 비밀·내부 예외·DB 식별 정보 비노출.

### 17.4 처리 함수
| 이름 | 입력 → 출력 | 권한 | 상태 변경 | 실패 | 필수 테스트 |
|---|---|---|---|---|---|
| listTranslations | 호출자, episodeId → 목록 | 배정된 TRANSLATOR | 없음 | 404/401/403/503 | 본인 배정 회차만, 미배정·교체 후 404 |
| createTranslation | 호출자, episodeId → DRAFT | 배정된 TRANSLATOR | translation_version INSERT, latest_translation_version+1, 블록 복사, 감사 | 404/409/503 | 첫 생성(빈), 이후 생성(seq 복사·삭제된 seq 제외), 열린 버전이 있으면 409, 원문 없음 409, 동시 생성 하나만 성공, 감사 장애 롤백 |
| getTranslation | 호출자, episodeId, versionNo → 상세 | 배정된 TRANSLATOR | 없음 | 404/401/403/503 | 원문+번역 병기 내용, editable 값, 없는 버전 404 |
| saveTranslationDraft | 호출자, versionNo, expectedRevision, blocks → 결과 | 배정된 TRANSLATOR | 블록 전체 교체, draft_revision+1 | 400/404/409/503 | 정상·동일 내용 changed:false, 리비전 충돌, DRAFT 아님 409, 없는 seq·중복 seq·검증 위반 400, 동시 저장 하나만 성공 |
| submitTranslation | 호출자, versionNo, expectedRevision → 결과 | 배정된 TRANSLATOR | status→REVIEW_PENDING, submitted_at, 감사 | 400/404/409/503 | 완전한 번역 제출 성공, 누락 seq 400+목록, 공백만 번역 불가, 리비전 불일치 409, 제출 후 저장·재제출 409, 감사 장애 롤백 |
| invalidateOnSourceSave | 회차, 새 원문 버전 → 없음 | 시스템(운영자의 원문 저장 안) | DRAFT·REVIEW_PENDING·APPROVED→INVALIDATED, 승인 무효화·감사 | 503(원문 저장 롤백) | 상태별 효과(REJECTED·PUBLISHED는 불변), 승인 무효화·감사, 번역 없는 회차 영향 없음, 변경 없는 저장은 무효화 없음, 장애 시 원문 저장도 롤백 |

### 17.5 프런트 계약 (Claude Code)
- 번역가의 `/assigned/{id}`를 확장한다. 서버가 확인한 역할이 TRANSLATOR일 때만 번역 API를 호출하고(감수자는 기존 읽기 전용 화면 그대로, 번역 API 미호출), 모든 판정은 편의 기능이며 서버가 강제한다.
- 번역 버전 목록(상태·원문 버전·시각)과 현재 열린 버전 안내. 열린 버전이 없고 원문이 있으면 "새 번역 시작" 버튼. DRAFT는 **원문과 번역 병기 편집기**(블록마다 원문 읽기 전용 + 번역 입력, 페이지 번호 표시)와 "저장"·"검수에 제출" 버튼. 입력 검증은 17.3과 동일(변환 없음), 제출 전 누락 블록을 표시하고 서버의 `missingSeqs`도 같은 방식으로 표시한다.
- 오류 처리: 401은 인증 정리, 403은 권한 안내(로그인 유지), 404는 "배정되지 않았거나 존재하지 않는 회차", 409 VERSION_CONFLICT는 충돌 안내와 "최신 내용 불러오기"(초안은 불러오기 전까지 유지), 409 STATE_CONFLICT는 현재 상태 안내(INVALIDATED면 원문이 바뀌어 무효화되었음을 알리고 새 번역 시작을 안내)와 새로고침, 503·통신 오류는 초안을 유지한 재시도. 중복 제출 방지, 늦은 응답 무시.
- REVIEW_PENDING·REJECTED·INVALIDATED 등 DRAFT 아닌 버전은 읽기 전용(`editable:false`)으로 병기 표시. 초안은 서버 저장 전까지 메모리에만 두고 localStorage 등에 저장하지 않는다. 운영자 화면은 이 노드에서 바뀌지 않는다.

### 17.6 파일 소유권
- Codex 변경: db/migration V31, backend/src/main(신규 `translation` 패키지, 기존 `EpisodeService.saveSourceVersion`의 무효화 추가, 보안 규칙에 `/api/my/episodes/*/translations/**` TRANSLATOR 전용 추가(기존 `/api/my/**` 규칙은 번역가·감수자 공용이므로 더 좁은 규칙이 먼저 적용되어야 한다), 공통 오류 처리 재사용), backend/src/test, README 실행·검증 기록.
- Claude Code 변경: frontend/src, frontend/tests/ui.
- 변경 금지: V1~V30, 기존 인증·회차·원문·배정 API의 요청·응답·동작(원문 저장의 무효화 부수 효과 제외), PROJECT_CONTEXT.md, 서로의 영역. 계약 변경이 필요하면 구현을 멈추고 제안한다.

### 17.7 필수 테스트·완료 조건
- backend(실제 MySQL): 17.4 표의 테스트, 4개 역할 × 5개 API의 401/403/성공 매트릭스(역할 위조·본문 role 포함), 배정 범위(미배정 번역가·교체된 이전 번역가 404, 새 번역가의 DRAFT 이어받기, 감수자가 배정 회차에서도 번역 API 403), V31 적용·기존 데이터 보존·스키마 검사 통과, 기존 EpisodeSource·Assignment·인증 통합 테스트가 **수정 없이** 통과, 오류 비노출·비JSON 400, 기존 회귀·빌드. 통합 테스트가 만든 회차·배정·번역·감사·계정 행만 정리하고 연속 2회 통과·전후 행 수를 비교한다.
- frontend: 17.5 전부(생성·병기 편집·저장·제출·누락 표시·409 두 종류·401·403·404·503·통신 오류·중복 제출·늦은 응답 무시·감수자의 번역 API 미호출·읽기 전용 상태), 기존 회귀, 타입·빌드. 모킹 테스트 통과는 실제 연동 성공이 아니다.
- 최종 실제 연동(Codex, 격리 환경): 운영자가 회차·원문·배정 → 번역가가 새 번역 시작·편집·저장·새로고침 유지·다른 탭/API로 리비전을 올린 뒤 저장해 충돌 → 일부 번역만 있는 상태에서 제출해 누락 표시 → 완성 후 제출(REVIEW_PENDING·읽기 전용) → 운영자가 원문을 수정해 번역 버전이 INVALIDATED가 되고 번역가 화면이 안내 → 새 번역 시작 시 이전 내용이 seq 기준으로 복사됨 → 번역가 교체 후 이전 번역가 404·새 번역가가 DRAFT를 이어받음 → 감수자·운영자·독자의 실제 브라우저 403(콘솔 fetch)·PUT/POST preflight·감사(TRANSLATION_CREATED·TRANSLATION_SUBMITTED·APPROVAL_INVALIDATED는 테스트 픽스처로 승인 상태를 만든 뒤)를 확인한다. 삭제 API가 없어 만든 행이 남으므로 격리 환경에서만 수행한다.

## 18. Review — 감수(검수 대기·대조·승인·반려)와 운영자의 번역 조회 — APPROVED (2026-10-06, 사용자 승인)

작성: Claude Code. 구현: backend=Codex, frontend=Claude Code. 근거: DECISIONS.md D-032·D-033·D-035·D-036·D-038(승인), D-045(승인), D-046(계약과 함께 2026-10-06 승인). 인증·역할·오류 형식·CORS는 12절, 회차·원문은 13절, 스키마는 14·16절, 배정은 15절, 번역은 17절을 따른다. **이 노드는 마이그레이션이 없다**(`review_decision`·감사 이벤트는 14절에 이미 있다).

### 범위
- 포함: 배정된 감수자의 검수 대기 목록, 원문·번역 대조 조회, 승인, 반려(사유 필수), 운영자의 번역 버전 읽기(목록·상세), 번역가의 반려 사유 조회(기존 17절 응답에 필드 추가).
- 제외: 발행·독자 열람(다음 노드), 승인 취소(D-045: 두지 않음), 감수 의견 수정·삭제, AI 검수 참고(선택 기능).

### 18.1 API
시각은 UTC ISO-8601 `Z`, ID는 문자열, 번역 버전은 회차 안의 `versionNo`(정수), `Cache-Control: no-store`. 감수자 API는 그 회차의 **현재 배정된** REVIEWER만 쓸 수 있다.
| API | 권한 | 요청 | 성공 응답 |
|---|---|---|---|
| GET /api/my/reviews?limit=&offset= | REVIEWER | limit 1~100(기본 50), offset ≥0 | 200 {"items":[{"episodeId","title","versionNo","sourceVersion","submittedAt"}],"total":n} — 내게 배정된 회차의 `REVIEW_PENDING` 버전만, 제출 시각 오름차순 |
| GET /api/my/episodes/{id}/reviews | 배정된 REVIEWER | — | 200 {"latestSourceVersion":n,"items":[{"versionNo","status","sourceVersion","submittedAt","decision":null\|{"decision","decidedAt","reason"}}]} — 상태 `REVIEW_PENDING`·`APPROVED`·`REJECTED`만, versionNo 내림차순 |
| GET /api/my/episodes/{id}/reviews/{versionNo} | 배정된 REVIEWER | — | 200 {"versionNo","status","sourceVersion","submittedAt","decidable":bool,"decision":null\|{…},"blocks":[{"seq","pageNo","source","text"}]} (그 버전이 묶인 원문 버전의 모든 블록) |
| POST /api/my/episodes/{id}/reviews/{versionNo}/approve | 배정된 REVIEWER | 본문 없음 | 200 {"versionNo","status":"APPROVED","decidedAt"} |
| POST /api/my/episodes/{id}/reviews/{versionNo}/reject | 배정된 REVIEWER | {"reason":"…"} | 200 {"versionNo","status":"REJECTED","decidedAt"} |
| GET /api/episodes/{id}/translations | OPERATOR | — | 200 {"latestSourceVersion":n,"items":[{"versionNo","status","sourceVersion","revision","createdAt","submittedAt","decision":null\|{…}}]} — **모든 상태**, versionNo 내림차순 |
| GET /api/episodes/{id}/translations/{versionNo} | OPERATOR | — | 200 {"versionNo","status","sourceVersion","createdAt","submittedAt","decision":null\|{…},"invalidatedAt":null\|"…","blocks":[{"seq","pageNo","source","text"}]} |
- `decision` 객체는 `{"decision":"APPROVED"\|"REJECTED","decidedAt":"…","reason":"…"\|null}`이며 `reason`은 반려일 때만 값이 있다. 작성자·감수자 이름 등 계정 정보는 노출하지 않는다.
- **번역가 응답에 필드 추가(17.2의 가산적 변경)**: `GET /api/my/episodes/{id}/translations`의 `items[]`와 `GET …/translations/{versionNo}`에 `decision`(위 형식, 없으면 null)을 추가한다. 기존 필드·동작은 바뀌지 않는다.
- 경로의 id·versionNo가 `^[1-9][0-9]{0,17}$`(versionNo는 `{0,8}`)가 아니거나, 존재하지 않거나, **배정되지 않은 회차**이거나, 감수자에게 보이지 않는 상태(`DRAFT`·`INVALIDATED`·`PUBLISHED`·`ON_HOLD`)이면 404 NOT_FOUND(D-038). 역할 위반은 403 FORBIDDEN(ACCESS_DENIED 감사), 비로그인 401. `/api/my/reviews`는 감수자 외(번역가 포함)에게 403이다.
- 미정의 필드·깨진 JSON·비JSON Content-Type은 400 INVALID_REQUEST. approve는 본문을 받지 않는다(있으면 400).

### 18.2 규칙 (모든 변경은 episode 행 `SELECT … FOR UPDATE` 후 하나의 트랜잭션)
- **승인·반려 공통 조건**: 호출자가 그 회차의 현재 배정된 감수자이고, 버전 상태가 `REVIEW_PENDING`이며, 버전의 `source_version_no`가 최신 원문 버전과 같아야 한다. 상태 불일치(이미 처리됨·원문 변경으로 무효화됨 등)는 409 STATE_CONFLICT(`currentStatus` 포함). 호출자가 번역 버전의 작성자(`created_by`)와 같으면 403 FORBIDDEN(D-035의 추가 방어, 계정당 단일 역할이라 정상 흐름에서는 발생하지 않는다).
- **동시 처리 검사는 별도로 두지 않는다(D-045)**: 제출된 버전은 불변이므로 `expectedRevision` 같은 검사 없이, 상태가 `REVIEW_PENDING`인지로만 판정한다. 감수자가 화면을 보는 사이 원문이 바뀌면 그 버전은 이미 `INVALIDATED`이므로 요청은 409이다. 같은 버전에 동시에 승인·반려가 오면 정확히 하나만 성공하고 나머지는 409이다.
- **승인**: `review_decision`을 INSERT(decision='APPROVED', reason NULL, reviewer_id, source_version_no, decided_at)하고 버전 상태를 `APPROVED`로 바꾸며 감사 `REVIEW_APPROVED`(actor=감수자, episode_id, source_version, translation_version_id)를 기록한다. **결정 행과 상태 변경은 반드시 같은 트랜잭션**이다(승인된 버전은 항상 결정 행이 정확히 하나 있다 — 17.3의 원문 변경 시 무효화가 이 전제를 쓴다).
- **반려**: 사유 필수(1~500 코드포인트, 공백만 불가, 제어문자는 탭·개행만, trim·정규화 금지, 아니면 400). `review_decision`(decision='REJECTED', reason)을 INSERT하고 상태를 `REJECTED`로 바꾸며 감사 `REVIEW_REJECTED`를 기록한다. 이후 번역가는 새 번역을 시작할 수 있다(`REJECTED`는 열린 버전이 아니며 새 DRAFT는 직전 번역을 같은 seq로 복사한다 — 17.3).
- **사유 공개 범위(D-045)**: 반려 사유는 그 회차의 현재 배정된 번역가·감수자와 운영자만 볼 수 있다(위 API들의 `decision.reason`). 독자·비배정 번역가·감수자에게는 어떤 경로로도 노출하지 않는다. 사유는 감사에 저장하지 않는다.
- **승인 취소는 없다(D-045)**: 승인된 버전을 되돌리는 API가 없다. 승인은 발행 전에 운영자가 원문을 바꿔 `INVALIDATED`가 되는 경우로만 무효화된다(17.3).
- 감사 저장 실패는 전체 롤백과 503 SERVICE_UNAVAILABLE. 오류 형식은 12·13절과 같고 추가 필드는 `currentStatus`뿐이다. 코드: 400 INVALID_REQUEST, 401, 403, 404, 409 STATE_CONFLICT, 503, 500. 비밀·내부 예외 비노출.
- **보안 규칙 순서**: `/api/my/reviews`와 `/api/my/episodes/*/reviews/**`는 REVIEWER 전용이며 기존 `/api/my/**`(번역가·감수자 공용)보다 **먼저** 평가되어야 한다(번역가가 403이어야 한다). 운영자 API는 기존 `/api/episodes/**` OPERATOR 전용 규칙이 이미 덮는다.

### 18.3 처리 함수
| 이름 | 입력 → 출력 | 권한 | 상태 변경 | 실패 | 필수 테스트 |
|---|---|---|---|---|---|
| listPendingReviews | 호출자, limit, offset → 목록 | REVIEWER | 없음 | 400/401/403/503 | 내게 배정된 회차의 REVIEW_PENDING만, 다른 감수자 배정 제외, 정렬·페이지·경계 |
| listEpisodeReviews / getReview | 호출자, episodeId(, versionNo) → 목록/상세 | 배정된 REVIEWER | 없음 | 404/401/403/503 | 보이는 상태 3종만, DRAFT·INVALIDATED 404, 미배정·교체 후 404, 병기 내용 일치, decidable 값, 결정 정보 |
| approveTranslation | 호출자, versionNo → 결과 | 배정된 REVIEWER | 결정 행 INSERT, 상태→APPROVED, 감사 | 404/409/403/503 | 정상(결정 행 1개·감사 1건), REVIEW_PENDING 아님 409, 원문 변경으로 INVALIDATED면 409, 중복 처리 409, 작성자 방어 403, 감사 장애 롤백, 동시 승인·반려 하나만 성공 |
| rejectTranslation | 호출자, versionNo, reason → 결과 | 배정된 REVIEWER | 결정 행 INSERT, 상태→REJECTED, 감사 | 400/404/409/503 | 정상, 사유 없음·공백만·501자·제어문자 400, 중복 409, 반려 후 번역가의 새 번역 생성·복사 |
| listTranslationsForOperator / getTranslationForOperator | episodeId(, versionNo) → 목록/상세 | OPERATOR | 없음 | 404/401/403/503 | 모든 상태, 결정·사유·invalidatedAt, 없는 버전 404, 다른 역할 403 |
| (번역가 응답 확장) | — | 배정된 TRANSLATOR | 없음 | — | 반려 버전의 사유 노출, 승인 버전, 결정 없는 버전 null, Translation 통합 테스트는 위 정정 규칙(필드 목록 단언 2곳만 `decision` 추가, 나머지 유지)으로 통과 |

### 18.4 프런트 계약 (Claude Code)
- **감수자** `/demo`: "검수 대기 목록"을 링크(`/reviews`)로 활성화한다(기존 "배정된 회차" 링크 유지, "승인·반려"는 별도 화면이 없는 동작이라 비활성 유지).
  - `/reviews`: 검수 대기 목록(회차 제목, 버전, 제출 시각, 20개씩 페이지 이동)과 `/reviews/{episodeId}/{versionNo}` 링크.
  - `/reviews/{episodeId}/{versionNo}`: 원문·번역 읽기 전용 병기 표시. `decidable`이면 "승인"과 "반려"를 보인다. 둘 다 되돌릴 수 없으므로 확인 단계를 거친다(승인은 확인 문구, 반려는 사유 입력(1~500자 검증)과 확인). 결정이 이미 있으면 결정·시각·반려 사유를 읽기 전용으로 보인다.
  - 감수자의 `/assigned/{id}`: 기존 읽기 전용 원문에 더해 "검수 버전" 목록(상태·제출 시각·결정)과 상세 링크를 추가한다. 번역가용 번역 API는 호출하지 않는다.
- **번역가** `/assigned/{id}`: `REJECTED` 버전에 반려 사유를 표시하고(목록 요약과 상세), 반려 후 "새 번역 시작"이 가능함을 안내한다. 승인된 버전은 승인됨으로 읽기 전용 표시.
- **운영자** `/episodes/{id}`: "번역 현황" 영역을 추가한다 — 버전 목록(상태·기준 원문·제출 시각·결정)과 "보기"로 읽기 전용 병기 상세(결정·반려 사유·무효화 시각 포함).
- 오류 처리: 401은 인증 정리, 403은 권한 안내(로그인 유지), 404는 "배정되지 않았거나 존재하지 않는 항목", 409 STATE_CONFLICT는 현재 상태 안내(이미 처리됨/원문 변경으로 무효화됨)와 새로고침, 503·통신 오류는 입력(반려 사유)을 유지한 재시도. 중복 제출 방지, 늦은 응답 무시. 역할 판정은 편의 기능이며 서버가 강제한다.

### 18.5 파일 소유권
- Codex 변경: backend/src/main(신규 `review` 패키지와 운영자 번역 조회, 번역가 응답의 `decision` 추가, 보안 규칙 순서, 공통 오류 처리), backend/src/test, README 실행·검증 기록. **마이그레이션 없음.**
- Claude Code 변경: frontend/src, frontend/tests/ui.
- 변경 금지: V1~V31, 기존 인증·회차·원문·배정·번역 API의 기존 필드·동작(번역가 응답의 `decision` 추가 제외), PROJECT_CONTEXT.md, 서로의 영역. 계약 변경이 필요하면 구현을 멈추고 제안한다.

### 18.6 필수 테스트·완료 조건
- backend(실제 MySQL): 18.3 표의 테스트, 역할 매트릭스(`GET /api/my/reviews`·감수 상세·승인·반려·운영자 번역 조회 × 4개 역할 + 비로그인, 역할 위조·본문 role 포함, 번역가가 `/api/my/reviews`에서 403), 배정 범위(미배정·교체된 이전 감수자 404, 새 감수자의 인계), 사유 노출 범위(독자·비배정자에게 비노출), 승인된 버전은 결정 행이 정확히 1개, 승인 후 운영자의 원문 변경 → INVALIDATED·`invalidated_at`·`APPROVAL_INVALIDATED`(17절 훅과 결합), 기존 EpisodeSource·Assignment·인증 통합 테스트는 수정 없이 통과하고, 기존 Translation 통합 테스트는 **응답 필드 목록 단언 2곳**(번역가 상세 응답, 번역가 목록 항목)에 `decision`을 추가하는 것과 `decision:null` 검증 추가만 허용하며 나머지 단언은 그대로 유지한다(2026-10-06 모순 정정: 가산적 필드 추가와 필드 목록 정확 일치 단언은 양립하지 않는다), 오류 비노출·비JSON 400, 기존 회귀·빌드. 통합 테스트가 만든 행만 정확히 정리하고 데모 계정·기존 데이터·제한 행 수를 바꾸지 않으며 연속 2회 통과·전후 행 수를 비교한다.
- frontend: 18.4 전부(검수 대기 목록·페이지 이동, 병기 조회, 승인·반려의 확인 단계와 사유 검증, 409·404·401·403·503·통신 오류, 중복 제출 방지, 늦은 응답 무시, 번역가의 사유 표시, 운영자 번역 현황, 역할별 미호출·안내), 기존 회귀, 타입·빌드. 모킹 테스트 통과는 실제 연동 성공이 아니다.
- 최종 실제 연동(Codex, 격리 환경 — 삭제 API가 없어 만든 행이 남음): 운영자 원문·배정 → 번역가가 제출 → 감수자가 대기 목록에서 열어 원문 대조 후 반려(사유) → 번역가가 사유를 보고 새 번역(복사)을 제출 → 감수자가 승인 → 운영자가 번역 현황에서 승인됨과 결정을 확인 → 운영자가 원문을 수정하면 승인된 버전이 무효화되고 감수자의 대기 목록·번역가 화면에 반영 → 처리된 버전 재처리 409·동시 승인/반려 하나만 성공 → 미배정 감수자 404·번역가·운영자·독자의 브라우저 403(콘솔 fetch)·승인/반려 POST preflight → 감사 `REVIEW_APPROVED`·`REVIEW_REJECTED`·`APPROVAL_INVALIDATED`와 결정 행 정합(승인 버전마다 결정 행 1개)을 확인한다.

## 19. 인증 보정 — 로그인 제한 제거 — APPROVED (2026-10-06, 사용자 승인)

작성: Claude Code. 구현: backend=Codex, frontend 변경 없음. 근거: DECISIONS.md D-047(사용자 결정: "로그인 제한은 없앤다", 범위 A). 12절의 인증·토큰·CORS·감사 규칙은 아래에서 **대체하는 부분만** 바뀌고 나머지는 그대로 유효하다. **이 노드는 마이그레이션이 없다**(제한 테이블은 스키마에 남기되 로그인이 읽거나 쓰지 않는다).

### 19.1 12절에서 대체되는 것 (이 목록에 없는 12절 규칙은 변경하지 않는다)
- "제한·정리·감사"의 **로그인 ID별 5회/15분 차단, IP별 30회/15분 차단, 차단 시간 판정, 제한 키 해시 저장, 행 잠금·카운터 원자 처리**를 모두 제거한다. 로그인은 실패 횟수와 무관하게 항상 자격 증명만 판정한다.
- "API·오류"의 **429 LOGIN_RATE_LIMITED와 Retry-After 응답**을 제거한다. 로그인이 반환하는 상태는 200·400·401(INVALID_CREDENTIALS)·503·500뿐이다. CORS 노출 헤더 목록(Retry-After 포함)은 바꾸지 않는다(무해하며 CORS 테스트를 건드리지 않기 위함).
- **AUTH_CLIENT_IP_MODE와 클라이언트 IP 판별**(DIRECT 모드, Forwarded/X-Forwarded-For 불신, "demo/prod는 IP 정책 승인 후 기동", 미결정 시 기동 거부)을 제거한다. 이 설정은 더 이상 필요 없으며, 값이 주어져도 무시하고 기동을 거부하지 않는다. 이 변수와 관련한 README·.env.example 문구는 정리한다.
- 감사 이벤트 `LOGIN_LIMITED`는 더 이상 기록하지 않는다(이벤트 값 자체는 스키마에 남는다). 기존 감사 행은 그대로 둔다.
- 처리 함수 `loginDemoAccount`의 입력에서 `remoteAddress`를 제거하고, 실패 시 "제한 행 잠금·카운터 커밋"을 하지 않는다.

### 19.2 유지되는 것 (바꾸지 않는다)
- 실패 로그인은 항상 동일한 401 INVALID_CREDENTIALS(없는 계정·잘못된 비밀번호·비활성 동일)이며, 없는 계정도 더미 BCrypt 검증을 수행한다(응답 시간 차이로 계정 존재를 알 수 없게 하는 기존 규칙).
- 감사 `LOGIN_SUCCESS`·`LOGIN_FAILURE`·`LOGOUT`·`ACCESS_DENIED`의 내용·원자성·"감사 저장 실패는 503 AUTH_UNAVAILABLE"은 그대로다. 실패 로그인은 감사를 커밋한 뒤 401을 응답한다.
- 토큰·만료·logout·CORS·역할 판정·초기화(seed)·프런트 계약은 모두 그대로다. 로그인 ID·비밀번호 형식 검증(400)도 그대로다.
- 정리 명령 `--demo-auth-cleanup=true`는 변경하지 않는다(이미 있는 제한 행을 보관 기간 규칙대로 지울 수 있고, 새 행은 생기지 않는다). 제한 테이블·V1~V31은 수정하지 않으며 개발 DB의 기존 제한 행도 삭제하지 않는다.
- 프런트는 변경하지 않는다. 429 안내 처리(`LOGIN_RATE_LIMITED`·Retry-After 표시)는 서버가 더 이상 429를 주지 않으므로 도달하지 않는 무해한 코드로 남는다.

### 19.3 보안 영향과 재검토 조건 (D-047에 기록)
- 실패 횟수 제한이 없으므로 로그인 엔드포인트에 대한 무차별 대입을 서버가 막지 않는다. 데모 계정 4개와 일회용 비밀번호를 쓰는 로컬·시연 범위에서 수용한다. **외부에 공개 배포하기 전에는 비밀번호 강도와 제한(또는 프록시·WAF 수준 완화) 재도입 여부를 다시 승인받는다.** 이 재검토 없이 배포 검증 완료로 기록하지 않는다.

### 19.4 필수 테스트·완료 조건
- backend(실제 MySQL): 같은 로그인 ID로 6회 이상, 같은 출처에서 30회 이상 연속 실패해도 매번 401 INVALID_CREDENTIALS이고 429·Retry-After가 없으며, 그 직후 올바른 비밀번호로 로그인이 200으로 성공한다. 병렬 실패 요청도 모두 401이고 5xx가 없다. 로그인 실패·성공이 제한 테이블에 행을 만들거나 바꾸지 않는다(전후 행 수 비교). `LOGIN_FAILURE`/`LOGIN_SUCCESS` 감사가 요청마다 정확히 1건 기록되고 `LOGIN_LIMITED`는 0건이다. AUTH_CLIENT_IP_MODE가 없거나 어떤 값이어도 기동한다. 감사 저장 장애는 여전히 503이다.
- 기존 인증 통합 테스트 중 **제한 동작(차단·429·Retry-After·IP 한도·창 경계·동시 카운터·성공 시 ID 초기화·LOGIN_LIMITED)을 검증하던 단언만** 삭제하거나 위 "제한 없음" 검증으로 바꾼다. 그 밖의 인증·EpisodeSource·Assignment·Translation·Review 테스트는 수정하지 않고 통과해야 한다. 변경한 단언의 목록을 보고한다. 통합 테스트가 만든 행만 정리하고 데모 계정·기존 데이터를 바꾸지 않으며 연속 2회 통과·전후 행 수를 비교한다.
- frontend: 변경 없음(기존 테스트 237개 통과 유지는 Claude Code가 확인).
- 실제 연동(Codex, 격리 환경): 브라우저 /login에서 잘못된 비밀번호를 연속 7회 이상 입력해도 "ID 또는 비밀번호가 올바르지 않습니다" 안내만 나오고 차단되지 않으며, 이어서 올바른 비밀번호로 로그인이 성공해 /demo로 이동한다. 서버 접근 기록에 429가 없다.
- 파일 소유권: Codex는 backend/src/main·test, README, backend/.env.example을 변경한다. 변경 금지: V1~V31, 12절 외 계약·결정 문서, frontend, PROJECT_CONTEXT.md.

## 20. Publication — 발행과 독자 열람(공개 API) — APPROVED (2026-10-07, 사용자 승인)

작성: Claude Code. 구현: backend=Codex, frontend=Claude Code. 근거: DECISIONS.md D-034(승인), D-048(이 절과 함께 승인 대기). 인증·역할·오류 형식·CORS는 12절(19절 보정 포함), 회차·원문은 13절, 스키마는 14·16절(`publication`·`episode.published_translation_version_id` 이미 있음), 번역은 17절, 감수는 18절을 따른다. **이 노드는 마이그레이션이 없다.** 발행과 독자 열람을 한 계약으로 묶는다(독자 열람은 읽기 전용이며 같은 상태 전이를 다룬다).

### 범위
- 포함: 운영자의 발행(승인된 정확한 버전만), 운영자의 발행 상태·이력 조회, 로그인 없는 독자의 공개 회차 목록·상세 열람, 감사.
- 제외(D-048): 발행 취소·보류·재공개(`ON_HOLD`는 상태값만 예약), 예약 발행, 독자 계정 기능(북마크 등), AI 기능.

### 20.1 API
시각은 UTC ISO-8601 `Z`, ID는 문자열, 모든 응답 `Cache-Control: no-store`. 경로의 id가 `^[1-9][0-9]{0,17}$`(versionNo는 `{0,8}`)가 아니면 404 NOT_FOUND.
| API | 권한 | 요청 | 성공 응답 |
|---|---|---|---|
| POST /api/episodes/{id}/translations/{versionNo}/publish | OPERATOR | 본문 없음(있으면 400) | 200 {"versionNo","status":"PUBLISHED","publishedAt"} |
| GET /api/episodes/{id}/publication | OPERATOR | — | 200 {"current":null\|{"versionNo","sourceVersion","publishedAt"},"history":[{"versionNo","sourceVersion","publishedAt"}]} — history는 발행 시각 내림차순(현재 공개본 포함) |
| GET /api/public/episodes?limit=&offset= | 누구나(로그인 불필요) | limit 1~100(기본 50), offset ≥0 | 200 {"items":[{"episodeId","title","publishedAt"}],"total":n} — 공개 중인 회차만, 회차 id 오름차순 |
| GET /api/public/episodes/{id} | 누구나 | — | 200 {"episodeId","title","publishedAt","blocks":[{"seq","pageNo","text"}]} — 공개 중인 번역 버전의 블록만, seq 오름차순 |
- 역할 위반은 403 FORBIDDEN(ACCESS_DENIED 감사), 비로그인 401(운영자 API). 존재하지 않는 회차·버전은 404. 공개 API에서 **공개 중이 아닌 회차**(발행된 적 없음·없는 회차·형식 오류 id)는 모두 같은 404 NOT_FOUND(존재 노출 방지). 오류 형식은 12절과 같고 추가 필드는 `currentStatus`뿐이다. 코드: 400 INVALID_REQUEST, 401, 403, 404, 409 STATE_CONFLICT, 503, 500. 비밀·내부 예외 비노출.
- **공개 API는 `Authorization` 헤더를 아예 판정하지 않는다**: 헤더가 없거나, 유효하거나, 만료·변조된 토큰이어도 결과가 같다(401 없음). 역할(READER 포함)에 따라 응답이 달라지지 않는다. `/api/public/**`는 `GET`만 허용하고 다른 메서드는 405.
- **공개 응답에는 번역 텍스트(`text`)·`seq`·`pageNo`·회차 제목·발행 시각만** 넣는다. 원문 텍스트, 초안·검수 중 버전, 번역·승인·발행 계정, 내부 버전 번호·상태, 반려 사유는 어떤 필드로도 반환하지 않는다. 요청 본문이 있는 GET은 무시한다.
- CORS는 기존 허용 Origin 목록을 그대로 쓴다(공개 API라도 와일드카드 금지). 비허용 Origin은 12절대로 403.

### 20.2 규칙 (발행은 episode 행 `SELECT … FOR UPDATE` 후 하나의 트랜잭션)
- **발행 조건**: 요청한 번역 버전의 상태가 `APPROVED`이고, 그 버전의 `review_decision`이 있으며 `invalidated_at`이 NULL이고(무효화된 승인 불가), 버전의 `source_version_no`가 최신 원문 버전과 같아야 한다. 하나라도 아니면 409 STATE_CONFLICT(`currentStatus` = 그 버전의 현재 상태). 회차나 버전이 없으면 404. 호출자는 OPERATOR뿐이다(번역가·감수자·독자 403).
- **효과(한 트랜잭션)**: ① 버전 상태 `PUBLISHED` ② `publication` INSERT(episode_id, translation_version_id, source_version_no, published_by, published_at) ③ `episode.published_translation_version_id`를 그 버전으로 갱신 ④ 감사 `TRANSLATION_PUBLISHED`(actor=운영자, episode_id, source_version, translation_version_id). 하나라도 실패하면 전체 롤백과 503. 이전에 공개 중이던 버전은 `PUBLISHED`로 남고 현재 공개본은 포인터가 정한다(14.3).
- **재발행·교체(D-048)**: 다른 `APPROVED` 버전을 발행하면 포인터가 그 버전으로 바뀐다(이전 공개본은 `PUBLISHED`로 남는다). 이미 `PUBLISHED`가 된 버전을 다시 발행하는 요청은 409(`currentStatus`=PUBLISHED). 같은 버전에 대한 동시 발행은 정확히 하나만 성공하고 나머지는 409이다.
- **원문 변경과 공개본(PROJECT_CONTEXT 6절, D-029)**: 원문 저장은 `PUBLISHED` 버전과 포인터를 건드리지 않는다. 공개본은 새 버전이 발행되기 전까지 그대로 유지된다. 공개본이 최신 원문보다 오래된 경우는 정상이다.
- **독자 열람 규칙**: 공개 응답은 항상 포인터가 가리키는 버전의 블록만 사용한다. 이후 새 DRAFT·검수·승인이 진행되어도 공개 응답은 바뀌지 않는다(초안과 공개본 분리). 포인터가 NULL인 회차는 목록에 나오지 않고 상세는 404이다. `total`은 공개 중인 회차 수이며 `offset`이 total 이상이면 빈 목록이다. `publishedAt`은 현재 공개본의 `publication.published_at`이다.
- **운영자 조회**: `publication`은 읽기 전용 이력이다. `GET .../publication`의 `current`는 포인터가 가리키는 버전(없으면 null)이다. 회차가 없으면 404.
- 승인 취소·발행 취소 API는 없다(D-045·D-048). 발행 후에도 번역가·감수자의 기존 API 동작은 바뀌지 않는다(감수자에게 `PUBLISHED` 버전은 18절대로 보이지 않는다).
- **보안 규칙 순서**: `/api/public/**`는 `permitAll`이며 기존 `/api/**` 인증 규칙·Bearer 필터보다 먼저 평가되어 토큰 판정이 일어나지 않는다. 발행·`publication` 조회는 기존 `/api/episodes/**` OPERATOR 전용 규칙이 이미 덮는다.

### 20.3 처리 함수
| 이름 | 입력 → 출력 | 권한 | 상태 변경 | 실패 | 필수 테스트 |
|---|---|---|---|---|---|
| publishTranslation | 호출자, episodeId, versionNo → 결과 | OPERATOR | 버전→PUBLISHED, publication 1건, 포인터, 감사 | 404/409/403/503 | 정상(publication 1행·포인터·감사 1건), 미승인 버전(DRAFT·REVIEW_PENDING·REJECTED·INVALIDATED) 409, 무효화된 승인(원문 변경 후) 409, 이미 PUBLISHED 409, 승인 후 원문이 바뀐 버전 409, 다른 승인 버전으로 교체(이전 PUBLISHED 유지·포인터 이동), 동시 발행 하나만 성공, 감사 장애 롤백(포인터·publication·상태 불변), 본문 있으면 400, 역할 매트릭스 |
| getPublication | episodeId → current/history | OPERATOR | 없음 | 404/401/403/503 | 발행 전 current null, 교체 후 history 순서, 없는 회차 404 |
| listPublicEpisodes / getPublicEpisode | limit, offset / episodeId → 목록/상세 | 없음(공개) | 없음 | 400(limit/offset)/404/503 | 공개본만, 미발행·없는 회차 동일 404, 초안·검수 중·승인만 된 버전 비노출, 응답 필드 정확 일치(원문·계정·상태 없음), 공개본이 새 승인·초안·원문 변경 후에도 불변, 교체 발행 후 새 내용, 정렬·페이지·경계, 모든 역할·비로그인·잘못된 토큰에서 동일 200, POST 등 405 |

### 20.4 프런트 계약 (Claude Code)
- **운영자** `/episodes/{id}` "번역 현황": "공개 상태"(현재 공개 버전과 발행 시각, 없으면 "공개 중인 번역 없음")와 발행 이력을 보인다. `APPROVED` 버전 행에 "발행" 버튼을 보이고, 되돌릴 수 없는 공개 동작이므로 확인 단계(공개 중인 버전이 있으면 "현재 공개 중인 vN을 대체합니다" 포함)를 거친다. 성공하면 번역 현황과 공개 상태를 다시 불러온다. 409는 현재 상태 안내(이미 발행됨/원문 변경으로 무효화됨/승인되지 않음)와 새로고침, 404·403·401·503·통신 오류는 기존 방식. 중복 제출 방지·늦은 응답 무시.
- **독자(공개, 로그인 불필요)** 새 경로 그룹: `/read`(공개 회차 목록, 20개씩 페이지 이동, 제목·발행 시각)과 `/read/{id}`(회차 제목과 번역 블록을 페이지·순서대로 표시, 번역 텍스트는 텍스트로만 렌더링). 공개 API 호출에는 **토큰을 붙이지 않는다**(`credentials: "omit"`, Authorization 없음). 404는 "공개되지 않았거나 존재하지 않는 회차입니다.", 503·통신 오류는 재시도. 로그인 상태나 역할로 화면이 달라지지 않는다.
- `/demo`: READER 메뉴에 "공개 회차 읽기"(`/read`) 링크를 활성화한다. 다른 역할의 메뉴는 바꾸지 않는다. 독자 화면에는 초안·원문·검수 상태를 어떤 형태로도 표시하지 않는다.

### 20.5 파일 소유권
- Codex 변경: backend/src/main(신규 `publication` 패키지, 보안 규칙 `/api/public/**`, 공통 오류 처리), backend/src/test, README 실행·검증 기록. **마이그레이션 없음.**
- Claude Code 변경: frontend/src, frontend/tests/ui.
- 변경 금지: V1~V31, 기존 인증·회차·원문·배정·번역·감수 API의 기존 필드·동작(발행으로 `PUBLISHED`가 된 버전을 번역가 API가 이미 표시하는 방식 포함), PROJECT_CONTEXT.md, 서로의 영역. 계약 변경이 필요하면 구현을 멈추고 제안한다.

### 20.6 필수 테스트·완료 조건
- backend(실제 MySQL): 20.3 표의 테스트, 역할 매트릭스(발행·publication 조회 × 4개 역할 + 비로그인, 역할 위조·본문 role 포함), 공개 API의 인증 무관 동작(헤더 없음·유효·만료·변조 토큰·READER 모두 200), 승인된 버전을 발행하면 감사 `TRANSLATION_PUBLISHED` 정확히 1건과 publication 1행·포인터 정합, 발행 후 운영자의 원문 변경이 공개 응답을 바꾸지 않음, 공개 응답에 원문·계정·상태·반려 사유가 없음, 기존 EpisodeSource·Assignment·Translation·Review·인증 통합 테스트는 수정 없이 통과(필드 추가가 없으므로 단언 변경 없음), 오류 비노출·비JSON 400, 기존 회귀·빌드. 통합 테스트가 만든 행만 정확히 정리하고 데모 계정·기존 데이터를 바꾸지 않으며 연속 2회 통과·전후 행 수를 비교한다.
- frontend: 20.4 전부(운영자의 공개 상태·발행 확인·409 처리·중복 제출 방지, 독자 목록·상세·페이지 이동, 토큰 미첨부 확인, 404·503·통신 오류, 역할별 메뉴, 독자 화면의 비노출), 기존 회귀, 타입·빌드. 모킹 테스트 통과는 실제 연동 성공이 아니다.
- **최종 통합 실제 연동(Codex, 격리 환경, 한 번에 수행 — 2026-10-07 사용자 결정으로 검증을 마지막에 합친다)**: ① Review 프런트 수정 4건(번역가 목록의 사유 요약, 원문 저장 후 운영자 번역 현황 갱신, 409+404 안내 병기, 교체된 감수자의 즉시 404 화면) ② 로그인 제한 제거(오입력 7회 이상 후에도 차단 없이 로그인 성공, 429 없음, 19절) ③ 발행: 운영자가 승인된 버전 발행(확인 단계) → 공개 상태 표시 → 비로그인 브라우저에서 `/read` 목록과 `/read/{id}`에 번역 블록만 보이고 원문·초안·상태가 없음 → 번역가가 새 번역을 제출·승인·미발행 상태일 때 공개 화면은 그대로 → 운영자가 원문을 수정해도 공개 화면은 그대로 → 새 승인본을 발행하면 공개 내용이 교체되고 이전 버전은 `PUBLISHED`로 남음 → 미발행 회차 URL은 404 안내 → 번역가·감수자·독자 계정으로 발행 시도 403(콘솔 fetch) → 만료·잘못된 토큰으로도 공개 API 200 → 감사 `TRANSLATION_PUBLISHED`와 publication 행·포인터 정합을 확인한다.

## 21. Publication 보강 — 발행 보류와 재발행 — APPROVED (2026-10-07, 사용자 승인)

작성: Claude Code. 구현: backend=Codex, frontend=Claude Code. 근거: PROJECT_CONTEXT.md 4절 선택 기능 4번(필수 기능 완료 후 사용자 지시), 6절 상태 전이(`PUBLISHED → ON_HOLD`, `ON_HOLD → PUBLISHED`), DECISIONS.md D-049(이 절과 함께 승인 대기). 20절의 발행·공개 API 규칙은 아래에서 **대체하는 부분만** 바뀐다. **이 노드는 마이그레이션이 없다**(`ON_HOLD`는 V12의 상태 CHECK에 이미 있고 `publication`·감사는 기존 구조를 쓴다).

### 범위
- 포함: 운영자의 공개 보류(공개 중인 회차를 독자에게서 내림), 공개 재개(같은 번역 버전을 다시 공개), 보류 상태 조회, 감사.
- 제외: 보류 사유 저장, 예약 보류·예약 발행, 독자에게 보류 사실 표시, 발행 이력 삭제.

### 21.1 20절에서 대체되는 것 (이 목록에 없는 20절 규칙은 변경하지 않는다)
- D-048의 "발행 취소·보류·재공개는 두지 않는다"와 20절 범위의 "발행 취소·보류·재공개 제외"는 보류·재개에 한해 대체된다. **발행 취소(공개본 삭제·이력 삭제)는 여전히 없다.**
- `GET /api/episodes/{id}/publication`의 응답에 `held` 필드를 추가한다(가산적 변경). 기존 필드와 동작은 바뀌지 않는다.

### 21.2 API
시각은 UTC ISO-8601 `Z`, ID는 문자열, 모든 응답 `Cache-Control: no-store`. 경로 id가 `^[1-9][0-9]{0,17}$`가 아니거나 회차가 없으면 404 NOT_FOUND. 권한은 OPERATOR뿐(다른 역할 403 FORBIDDEN·ACCESS_DENIED 감사, 비로그인 401). 본문이 있으면 400.
| API | 요청 | 성공 응답 |
|---|---|---|
| POST /api/episodes/{id}/publication/hold | 본문 없음 | 200 {"versionNo","status":"ON_HOLD","heldAt"} |
| POST /api/episodes/{id}/publication/resume | 본문 없음 | 200 {"versionNo","status":"PUBLISHED","publishedAt"} |
| GET /api/episodes/{id}/publication (확장) | — | 200 {"current":null\|{…},"held":null\|{"versionNo","sourceVersion","publishedAt"},"history":[…]} |
- `current`는 포인터가 가리키는 버전이 `PUBLISHED`일 때만 값이 있고, `held`는 그 버전이 `ON_HOLD`일 때만 값이 있다(둘 중 많아야 하나가 non-null). `held.publishedAt`은 그 버전의 가장 최근 발행·재개 시각이다. 포인터가 없으면 둘 다 null.
- 오류 코드: 400 INVALID_REQUEST, 401, 403, 404, 409 STATE_CONFLICT, 503, 500. 오류 형식은 12절과 같고 추가 필드는 `currentStatus`뿐이다.

### 21.3 규칙 (모든 변경은 episode 행 `SELECT … FOR UPDATE` 후 하나의 트랜잭션)
- **보류(hold)**: 회차의 `published_translation_version_id` 포인터가 있고 그 버전이 `PUBLISHED`일 때만 가능하다. 효과: 버전 상태 `ON_HOLD`, 감사 `PUBLICATION_HELD`(actor, episode_id, source_version, translation_version_id). **포인터는 바꾸지 않고 `publication` 행도 만들지 않는다.** 포인터가 없거나 이미 `ON_HOLD`이면 409 STATE_CONFLICT(`currentStatus`는 포인터 버전의 상태, 포인터가 없으면 필드 생략).
- **재개(resume)**: 포인터가 있고 그 버전이 `ON_HOLD`일 때만 가능하다. 효과: 버전 상태 `PUBLISHED`, **`publication` 행 INSERT**(같은 번역 버전, 그 버전의 `source_version_no`, published_by=운영자, published_at=지금 — 재공개 이력이며 `GET …/publication`의 `history`에 한 건 늘고, 공개 목록·상세의 `publishedAt`은 재개 시각이 된다), 감사 `PUBLICATION_RESUMED`. 포인터가 없거나 `PUBLISHED`이면 409(같은 규칙). 재개는 원문 버전이 최신인지 검사하지 않는다(공개본은 원문이 바뀌어도 유지된다는 20절 규칙과 같다).
- **독자 영향**: 보류 중인 회차는 공개 목록에서 빠지고 공개 상세는 20절의 미발행과 **같은 404 NOT_FOUND**이다(보류 사실을 독자에게 알리지 않는다). 공개 쿼리는 이미 "포인터 버전이 `PUBLISHED`"일 때만 공개하므로 별도 수정 없이 성립해야 하며, 테스트로 증명한다. 재개하면 같은 내용이 다시 보인다.
- **보류 중의 발행**: 20절의 발행 API로 다른 `APPROVED` 버전을 발행하면 포인터가 새 버전으로 바뀌고 보류 중이던 버전은 `ON_HOLD`로 남는다(다시 재개할 수 없고 포인터에서 떠난다). 보류 중인 버전 자체를 발행 API로 발행하면 409(`currentStatus`=ON_HOLD)이며, 되돌리려면 재개를 쓴다.
- **원문 변경과의 관계**: 원문 저장은 `PUBLISHED`와 `ON_HOLD` 버전을 건드리지 않는다(17.3은 DRAFT·REVIEW_PENDING·APPROVED만 무효화). 보류 중 원문이 바뀌어도 재개할 수 있다.
- 감수자·번역가 API의 기존 동작은 바뀌지 않는다(`ON_HOLD`는 감수자에게 보이지 않는다, 번역가에게는 "보류"로 보인다 — 기존 상태 표시 그대로).
- 동시 요청: 같은 회차에 hold·resume·publish가 동시에 오면 `FOR UPDATE`로 직렬화되고, 조건을 만족하지 못한 요청은 409이다. 같은 hold를 동시에 여러 번 보내면 정확히 하나만 성공한다.
- 감사 저장 실패는 전체 롤백과 503. 롤백 시 상태·`publication`·포인터가 모두 변하지 않아야 한다.

### 21.4 처리 함수
| 이름 | 입력 → 출력 | 권한 | 상태 변경 | 실패 | 필수 테스트 |
|---|---|---|---|---|---|
| holdPublication | 호출자, episodeId → 결과 | OPERATOR | 포인터 버전 PUBLISHED→ON_HOLD, 감사 | 404/409/403/503 | 정상(상태·감사 1건·포인터 불변·publication 행 불변), 포인터 없음 409, 이미 보류 409, 동시 hold 하나만 성공, 감사 장애 롤백 |
| resumePublication | 호출자, episodeId → 결과 | OPERATOR | ON_HOLD→PUBLISHED, publication INSERT, 감사 | 404/409/403/503 | 정상(상태·publication 1행 증가·감사·history 증가·publishedAt 갱신), 포인터 없음·PUBLISHED 409, 보류 중 원문 변경 후 재개 가능, 감사 장애 롤백 |
| getPublication (확장) | episodeId → current/held/history | OPERATOR | 없음 | 404/401/403/503 | 발행 전 둘 다 null, 발행 후 current, 보류 후 held, 재개 후 current·history 순서 |
| 공개 API 상호작용 | — | 누구나 | 없음 | — | 보류 중 목록에서 제외·상세 404(미발행과 동일 응답 본문), 재개 후 같은 내용·새 publishedAt, 보류 중 다른 승인 버전 발행 시 새 내용으로 교체 |

### 21.5 프런트 계약 (Claude Code)
- **운영자** `/episodes/{id}` "번역 현황"의 "공개 상태": 공개 중이면 "공개 보류" 버튼, 보류 중이면 "보류 중: 번역 vN (독자에게 보이지 않음)"과 "공개 재개" 버튼을 보인다. 번역 목록의 해당 버전에는 보류 중 표시를 붙인다. 보류·재개는 모두 확인 단계를 거친다(보류: "보류하면 독자에게 더 이상 보이지 않습니다. 나중에 공개를 재개할 수 있습니다.", 재개: "재개하면 다시 독자에게 공개됩니다."). 성공하면 공개 상태와 번역 목록을 다시 불러온다.
- 오류: 409는 현재 상태 안내(이미 보류됨·이미 공개 중·공개된 번역 없음)와 새로고침, 404·403·401·503·통신 오류는 기존 방식(입력·확인 단계 유지 재시도). 중복 제출 방지·늦은 응답 무시. 보류 중 다른 승인 버전을 발행하는 확인 문구에는 "보류 중인 vN 대신 공개됩니다"를 포함한다.
- **독자** 화면은 변경하지 않는다(보류 중 회차는 미공개와 같은 404 안내).

### 21.6 파일 소유권·완료 조건
- Codex 변경: backend/src/main(`publication` 패키지 확장, 보안·오류 처리 필요 시), backend/src/test, README 기록. **마이그레이션 없음.** 기존 EpisodeSource·Assignment·Translation·Review·인증 통합 테스트는 수정 없이 통과해야 하고, 기존 Publication 통합 테스트는 `GET …/publication` 응답 필드 목록 단언에 `held`를 추가하고 `held:null` 검증을 더하는 것만 허용한다(가산적 필드 추가와 필드 목록 정확 일치 단언은 양립하지 않는다 — 18절 정정과 같은 처리).
- Claude Code 변경: frontend/src, frontend/tests/ui. 변경 금지: V1~V31, 기존 API의 기존 필드·동작(`held` 추가 제외), PROJECT_CONTEXT.md, 서로의 영역.
- 테스트: 21.4 표, 역할 매트릭스(hold·resume × 4개 역할 + 비로그인), 본문 있으면 400, 없는 회차 404, 오류 비노출, 기존 회귀·빌드, 연속 2회 통과·전후 행 수 비교. frontend는 21.5 전부와 기존 회귀·타입·빌드.
- **실제 브라우저 검증은 한 번만, 최소 시나리오로**: 운영자 발행 → 공개 보류(확인 취소 시 요청 없음, 확정 후 `/read` 목록에서 사라지고 `/read/{id}`가 404 안내) → 보류 중 원문 수정 후 공개 재개 → `/read/{id}`가 같은 내용으로 복귀하고 발행 이력이 한 건 늘어남 → 보류 중 다른 승인 버전 발행 시 공개 내용 교체 → 번역가·감수자·독자의 hold/resume 403(HTTP 확인) → 감사 `PUBLICATION_HELD`·`PUBLICATION_RESUMED`와 상태·publication 행 정합.

## 22. Review 보강 — 블록별 감수 코멘트 — APPROVED (2026-10-07, 사용자 승인)

작성: Claude Code. 구현: backend=Codex, frontend=Claude Code. 근거: 사용자 채택(2026-10-07, 제출 완성도 향상), DECISIONS.md D-050(이 절과 함께 승인 대기). 18절 Review의 반려 규칙을 **반려에 한해 확장**한다. 인증·역할·오류 형식은 12·19절, 번역은 17절, 감수는 18절을 따른다. **이 노드는 마이그레이션 V32 하나가 있다**(새 테이블 1개, NOT NULL 규칙 적용).

### 범위
- 포함: 반려할 때 감수자가 문제 블록을 지정해 블록별 의견을 남기는 기능, 그 의견을 번역가·감수자·운영자가 읽는 것.
- 제외: 승인에 코멘트 붙이기, 코멘트 수정·삭제, 코멘트에 대한 답글, 독자 공개, 코멘트 알림, 반려 사유(`reason`)의 대체(`reason`은 그대로 필수).

### 22.1 스키마 — V32 (파일당 DDL 하나, InnoDB·utf8mb4·UTC DATETIME(6))
`review_block_comment`: id BIGINT AUTO_INCREMENT PK, review_decision_id BIGINT NOT NULL, translation_version_id BIGINT NOT NULL, source_seq INT NOT NULL, body VARCHAR(300) NOT NULL, created_at DATETIME(6) NOT NULL.
- **모든 컬럼 NOT NULL**(NULL 허용 목록 변경 없음, 스키마 lint 테스트 통과). `CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 300)`. `UNIQUE (review_decision_id, source_seq)`(한 결정에서 같은 블록에 의견 하나).
- FK: review_decision_id → review_decision(id), **(translation_version_id, source_seq) → translation_block(translation_version_id, source_seq)**(의견은 그 버전에 실제로 있는 블록만 가리킨다), 코멘트의 `translation_version_id`가 그 결정(`review_decision_id`)의 번역 버전과 같다는 것은 `review_decision`에 `UNIQUE(id, translation_version_id)`가 없으므로 **DB 제약 없이 서비스 검사(코멘트 INSERT 전에 결정 행의 번역 버전과 일치 확인)와 통합 테스트로 보장한다**(2026-10-07 Codex 질의에 대한 정정: 이 경우 구현을 멈추지 않는다). 모두 ON DELETE/UPDATE RESTRICT.
- 같은 결정에는 반려(REJECTED)에만 코멘트가 붙는다(서비스 규칙, 승인 결정에는 행이 생기지 않는다).

### 22.2 API 변경 (모두 가산적, 기존 필드·동작 유지)
- **반려 요청 확장** `POST /api/my/episodes/{id}/reviews/{versionNo}/reject`: 본문 `{"reason":"…","comments":[{"seq":1,"text":"…"}]}`. `comments`는 **선택**이며 없으면 `[]`과 같다. 미정의 필드는 여전히 400. `comments` 규칙(어기면 400 INVALID_REQUEST, 상세 필드 없음): 배열 길이 0~50, 각 항목은 정확히 `seq`(정수)와 `text`(문자열), `seq`는 그 번역 버전에 실제로 있는 블록의 seq이고 중복 불가, `text`는 1~300 코드포인트·공백만 불가·제어문자는 탭·개행만·trim/정규화 금지(18.2 `reason`과 같은 규칙).
- 반려 처리(18.2)는 그대로이며 **결정 행 INSERT·상태 변경·감사 `REVIEW_REJECTED`·코멘트 INSERT를 같은 트랜잭션**에서 한다. 코멘트 저장이 실패하면 전체 롤백(결정·상태·감사 불변)과 503. 코멘트 본문은 감사·로그에 저장하지 않는다.
- **응답에 `blockComments` 추가**(없으면 항상 `[]`): 번역가 `GET /api/my/episodes/{id}/translations/{versionNo}`, 감수자 `GET /api/my/episodes/{id}/reviews/{versionNo}`, 운영자 `GET /api/episodes/{id}/translations/{versionNo}`. 형식 `[{"seq":1,"text":"…","createdAt":"…"}]`, seq 오름차순. `REJECTED`가 아닌 버전에서는 `[]`. **목록 응답(번역가·감수자·운영자 목록 항목)에는 추가하지 않는다.**
- 공개 범위(D-045와 같음): 그 회차의 **현재 배정된** 번역가·감수자와 운영자만 본다. 독자·공개 API·비배정자(404)에게는 어떤 경로로도 노출하지 않는다. 계정 정보(작성자·감수자 이름)는 노출하지 않는다.
- 코멘트는 불변이다(수정·삭제 API 없음). 새 DRAFT를 만들어도 코멘트는 복사되지 않고, 직전 반려 버전의 상세에서 계속 읽을 수 있다.

### 22.3 처리 함수
| 이름 | 입력 → 출력 | 권한 | 상태 변경 | 실패 | 필수 테스트 |
|---|---|---|---|---|---|
| rejectTranslation (확장) | 호출자, versionNo, reason, comments → 결과 | 배정된 REVIEWER | 결정 행·상태·감사·코멘트 행 | 400/404/409/403/503 | 코멘트 없이 반려(기존 동작 그대로), 코멘트 N개 저장, 없는 seq·중복 seq·공백만·301자·제어문자·51개·잘못된 항목 형식 400(상태 불변·코멘트 행 0), 승인에는 코멘트 필드 자체를 받지 않음(approve는 본문 있으면 400 그대로), 저장 장애 롤백(결정·상태·감사·코멘트 모두 불변), 중복 반려 409(코멘트 행 증가 없음), 동시 반려·승인 하나만 성공 |
| 상세 조회 확장 | 호출자, versionNo → blockComments | 번역가·감수자·운영자 | 없음 | 404/401/403/503 | 반려 버전에서 코멘트 반환, 비반려 버전 `[]`, 목록 응답에는 없음, 교체된 감수자·번역가 404와 새 담당자의 인계 읽기, 독자·비배정자 비노출(공개 API 응답에 없음) |
| 스키마 | V32 | — | — | — | 컬럼 NOT NULL·CHECK·UNIQUE·FK 위반 거부와 정상 허용(제약별 실제 MySQL), 기존 NOT NULL lint 통과, V1~V31 불변 |

### 22.4 프런트 계약 (Claude Code)
- **감수자** `/reviews/{episodeId}/{versionNo}`: 반려 모드에서 각 블록 옆에 "이 블록에 의견 추가"를 둔다(블록당 300자 이하·최대 50개 검증, 입력은 텍스트로만 렌더링). 반려 확인 단계에서 입력한 의견 수를 보여 주고 `reason`과 함께 전송한다. 결정 후 읽기 전용 화면에는 블록별 의견을 해당 블록 옆에 표시한다. 오류·입력 유지·중복 제출 방지는 18.4와 같다.
- **번역가** `/assigned/{id}`: 반려된 버전의 상세에서 블록별 의견을 해당 블록 옆에 표시한다. 새 번역을 편집할 때는 직전 반려 버전의 의견을 "직전 반려 의견" 영역에서 읽기 전용으로 참조할 수 있게 한다(별도 API 없이 기존 상세 호출 재사용).
- **운영자** `/episodes/{id}` 번역 현황의 상세 보기: 반려 버전의 블록별 의견을 함께 표시한다.
- 독자 화면은 변경하지 않는다.

### 22.5 파일 소유권·완료 조건
- Codex 변경: `backend/src/main/resources/db/migration/V32__…`, backend/src/main(`review`·`translation` 패키지 확장), backend/src/test, README 기록. 기존 EpisodeSource·Assignment·Translation·Review·Publication·인증 통합 테스트는 수정 없이 통과해야 하고, **번역가 상세·감수자 상세·운영자 상세 응답의 필드 목록 단언(정확히 일치 단언)에 `blockComments`를 추가하는 것과 `blockComments:[]` 검증 추가만 허용**한다(가산적 필드 추가는 정확 일치 단언과 양립하지 않는다 — 18절 정정과 같은 처리, 변경한 단언 목록을 보고).
- Claude Code 변경: frontend/src, frontend/tests/ui. 변경 금지: V1~V31, 기존 API의 기존 필드·동작(`blockComments`·`comments` 추가 제외), PROJECT_CONTEXT.md, 서로의 영역.
- 테스트: 22.3 표, 역할 매트릭스(코멘트 포함 반려 × 4개 역할 + 비로그인, 역할 위조), 오류 비노출·비JSON 400, 기존 회귀·빌드, 연속 2회 통과·전후 행 수 비교(코멘트 테이블 포함 정확히 정리). frontend는 22.4 전부와 기존 회귀·타입·빌드.
- **실제 브라우저 검증은 한 번만, 마지막 통합 검증(10/12)에 합친다**: 감수자가 코멘트를 붙여 반려 → 번역가가 블록별 의견을 보고 새 번역 작성·제출 → 운영자 상세에서 의견 확인 → 독자·비배정 감수자에게 비노출 → 감사·결정·코멘트 행 정합.

## 23. 프런트 보강 묶음 — 버전 비교·번역 진행률·독자 리더 개선·역할별 대시보드 — APPROVED (2026-10-07, 사용자 승인)

작성: Claude Code. 구현: **frontend=Claude Code 전용(백엔드·마이그레이션·API 변경 없음)**. 근거: PROJECT_CONTEXT.md 4절 선택 기능 3·7번과 사용자 채택(D-050: 번역 진행률, 독자 리더 개선), DECISIONS.md D-051(이 절과 함께 승인 대기). 이 절의 네 기능은 기존 API(13·15·17·18·20·21절)만 호출하며 서버가 강제하는 권한·공개 범위·오류 형식은 바뀌지 않는다. 화면의 역할 판정은 편의 기능이고 서버가 최종 판정한다.

### 공통 규칙
- 새 API·새 응답 필드·마이그레이션 없음. 기존 호출의 요청·응답 형식은 변경하지 않는다.
- 서버가 준 모든 텍스트(제목·번역·의견)는 **글자로만** 렌더링한다(HTML 해석 금지). 오류는 기존 고정 문구 방식(서버 문구 비노출), 401은 인증 정리, 403은 안내(로그인 유지), 503·통신 오류는 재시도 제공, 늦은 응답은 무시하고 중복 요청은 막는다.
- 보조 정보(진행률·이웃 회차·대시보드 카드)의 조회 실패는 **본 화면을 막지 않는다**(해당 영역에만 안내 또는 숨김).
- 독자 화면(`/read/**`)은 로그인 없이 동작하며 토큰·Authorization을 붙이지 않고 서버에서 받은 공개 정보 외에는 아무것도 표시하지 않는다(원문·초안·상태 비노출, 20절 유지).

### 23.1 반려 후 버전 비교
- **대상**: 번역 버전을 읽을 수 있는 세 화면에서 같은 회차의 두 버전을 블록 단위로 비교한다. 번역가 `/assigned/{id}`(모든 버전, 17절), 운영자 `/episodes/{id}`의 번역 현황(모든 버전, 18절), 감수자 `/assigned/{id}`의 검수 버전(보이는 상태만, 18절). 각 화면은 **자기 역할의 기존 상세 API**만 호출한다(번역가→`/api/my/episodes/{id}/translations/{versionNo}`, 감수자→`…/reviews/{versionNo}`, 운영자→`/api/episodes/{id}/translations/{versionNo}`). 다른 역할의 API는 호출하지 않는다.
- **동작**: 목록에 버전이 둘 이상일 때 "버전 비교" 영역을 보인다. "이전 버전"·"새 버전"을 선택하면(기본값: 가장 최근 반려 버전과 그 다음 버전, 없으면 최신 두 버전) 두 상세를 불러와 `seq` 기준으로 정렬한다. 블록마다 상태를 표시한다 — **같음**·**변경됨**(이전 → 새 텍스트를 나란히)·**추가됨**(새 버전에만)·**삭제됨**(이전 버전에만). 번역이 없는 블록은 빈 텍스트로 비교한다. 상단에 변경·추가·삭제 개수를 요약하고, "변경된 블록만 보기" 토글을 둔다. 두 버전의 기준 원문 버전이 다르면 "기준 원문이 다릅니다(v{a} / v{b})"를 안내한다. 이전 버전이 반려 버전이면 그 버전의 `blockComments`(22절)를 같은 블록 옆에 읽기 전용으로 함께 보인다(없으면 생략).
- 같은 버전을 두 번 고르면 비교하지 않고 안내한다. 조회 실패는 비교 영역에만 오류와 재시도. 두 요청 중 하나가 실패하면 부분 결과를 보이지 않는다. 비교 계산은 순수 함수(`seq` 정렬·상태 분류)로 분리해 단위 테스트한다.

### 23.2 번역 진행률
- **정의**: 진행률 = 번역 텍스트가 **공백만이 아닌** 블록 수 / 전체 블록 수. 전체 블록 0개면 0%. 퍼센트는 반올림한 정수, 막대는 접근 가능한 `progressbar`(`aria-valuenow`, 라벨 "번역 진행률")와 "N/M 블록 (P%)" 텍스트로 표시한다. 제출 가능 조건(모든 블록 번역)과 같은 기준이다.
- **표시 위치**: ① 번역가 `/assigned/{id}`의 편집 중인 DRAFT — **입력 중인 값 기준으로 실시간**(저장 전 변경 포함), 저장된 진행률(서버 값)과 다르면 "저장하지 않은 변경 포함"을 표시. ② 번역가가 읽는 읽기 전용 버전 상세. ③ 감수자 검토 화면(`/reviews/{id}/{versionNo}`)과 ④ 운영자 번역 현황 상세 보기 — 각각 불러온 상세의 블록 기준.
- 진행률 계산은 순수 함수로 분리해 단위 테스트한다. 서버 상태·제출 규칙은 바꾸지 않는다(진행률 100%여도 제출은 기존 확인 단계를 거친다).

### 23.3 독자 리더 개선 (`/read`, `/read/{id}` — 공개 API만 사용)
- **제목 검색(`/read`)**: 검색어가 비어 있으면 기존 20개 페이지 이동을 그대로 쓴다. 검색어가 있으면 공개 목록을 `limit=100` 페이지로 순서대로 모두 불러와(최대 10회, 1000개 상한) 제목에 검색어를 **대소문자 구분 없이 부분 일치**로 거르고(앞뒤 공백은 비교에만 무시), 결과를 20개씩 클라이언트에서 나눠 보인다. 불러온 목록은 화면이 떠 있는 동안만 재사용한다. 결과가 없으면 "검색 결과가 없습니다". 상한을 넘으면 "처음 1000개 회차 안에서 검색했습니다"를 안내한다.
- **이전/다음 회차(`/read/{id}`)**: 같은 공개 목록(회차 id 오름차순, 20절)에서 현재 회차의 앞뒤 회차를 찾아 "← 이전 회차 {제목}" "다음 회차 {제목} →" 링크를 보인다. 목록 조회가 실패하거나 현재 회차가 목록에 없으면 이웃 링크만 조용히 숨긴다(본문은 정상 표시).
- **읽던 위치 기억**: 각 번역 블록에 "여기까지 읽음" 버튼을 둔다. 누르면 그 블록의 `seq`와 그 시점의 회차 `publishedAt`을 브라우저 `localStorage`(키 `mangabridge.reader.position.v1`, 값은 회차 id → `{seq, publishedAt}`)에 저장하고 해당 블록에 "읽던 위치" 표시를 붙인다. 회차를 다시 열었을 때 저장값이 있고 **저장된 `publishedAt`이 현재 공개본과 같으면** "이어 읽기: 블록 N로 이동" 버튼을 보이고(누르면 해당 블록으로 스크롤), 다르면(교체·재발행) 저장값을 폐기한다. `/read` 목록에서는 저장값이 있는 회차에 "이어 읽기" 표시를 붙인다. `localStorage`가 막혀 있거나 예외가 나도 모든 화면은 정상 동작해야 하고(try/catch, 저장 실패는 조용히 무시), 저장하는 정보는 회차 id·블록 번호·공개 시각뿐이다(계정·토큰·본문 저장 금지).
- 독자 화면은 로그인 상태·역할에 따라 달라지지 않는다.

### 23.4 역할별 대시보드 (`/demo`의 "내 할 일" 영역)
`/demo`의 사용자·메뉴 영역 아래에 서버가 확인한 역할에 맞는 요약 카드를 둔다. 각 카드는 독립적으로 불러오고 실패해도 다른 카드와 기존 화면에 영향이 없다(카드별 재시도).
- **운영자**: "회차 현황" — 회차 총수(`GET /api/episodes?limit=10&offset=0`의 `total`)와 **최근 10개 회차**별 진행 상태 한 줄(회차 제목 링크 → `/episodes/{id}`, 번역 현황 `GET /api/episodes/{id}/translations`와 공개 상태 `GET /api/episodes/{id}/publication`로 계산한 칩: "발행 대기(승인됨)"·"검수 대기"·"작성 중"·"공개 중"·"보류 중"·"번역 없음"). 회차별 조회는 동시에 최대 5개로 제한하고 하나가 실패해도 그 줄에만 "불러오지 못함"을 표시한다.
- **번역가**: "내 번역" — `GET /api/my/episodes`의 배정 회차(최대 10개)별 번역 상태 칩(`GET /api/my/episodes/{id}/translations`: "시작 전"·"작성 중"·"검수 대기"·"반려됨"·"승인됨"·"발행됨"·"무효화됨", 최신 버전 기준)과 상단 요약("반려 N건 · 작성 중 N건 · 시작 전 N건"). 반려된 회차는 `/assigned/{id}` 링크를 강조한다.
- **감수자**: "검수 대기" — `GET /api/my/reviews?limit=5&offset=0`의 `total`과 최근 5건 링크(`/reviews/{episodeId}/{versionNo}`). 0건이면 "검수할 번역이 없습니다".
- **독자**: "최근 공개 회차" — 공개 API `GET /api/public/episodes?limit=5&offset=0`의 최근 5건 링크(`/read/{id}`). 이 카드의 요청에는 토큰을 붙이지 않는다.
- 카드는 기존 `ROLE_INFO`/메뉴와 별개 컴포넌트로 만들고, 서버가 확인한 역할이 아닌 카드는 렌더링도 요청도 하지 않는다. 상태 칩 계산은 순수 함수로 분리해 단위 테스트한다.

### 23.5 파일 소유권·완료 조건
- 변경: frontend/src, frontend/tests/ui(신규 컴포넌트·순수 함수·페이지). 변경 금지: backend 전체, V1~V32, CONTRACTS의 다른 절, 기존 API의 요청·응답 형식, PROJECT_CONTEXT.md.
- 테스트(Vitest): ① 순수 함수 — 블록 비교 분류(같음·변경·추가·삭제·null 텍스트·원문 버전 차이), 진행률(공백만 블록·0블록·반올림), 대시보드 칩 계산, 읽던 위치 저장 규칙(`publishedAt` 불일치 폐기·저장소 예외 무시). ② 컴포넌트 — 각 화면의 정상·빈 상태·오류·재시도·늦은 응답 무시·중복 요청 방지, 비교 화면이 역할별로 자기 API만 호출하는지, 독자 화면에 토큰이 붙지 않고 원문·상태가 보이지 않는지, 검색의 페이지 모두 로드·상한, 이웃 링크 실패 시 본문 유지, 역할 외 카드의 미렌더·미호출. ③ 기존 296개 회귀·타입·빌드 통과, 핵심 보호 장치는 변이 검사로 테스트가 잡는지 확인한다. 모킹 테스트 통과는 실제 연동 성공이 아니다.
- **실제 브라우저 검증은 한 번만, 마지막 통합 검증(10/12)에 합친다**: 감수자가 코멘트로 반려 → 번역가가 새 버전을 쓰며 진행률 변화 확인 → 번역가·운영자·감수자 화면에서 두 버전 비교(변경 블록과 이전 의견 표시) → 발행 후 비로그인 `/read` 검색·이전/다음 회차·"여기까지 읽음"·이어 읽기(공개본 교체 후 저장값 폐기) → 네 역할의 `/demo` 대시보드 카드.

## 24. 작업 이력 조회 — 운영자의 업무 감사 이력 읽기 — APPROVED (2026-10-07, 사용자 승인)

작성: Claude Code. 구현: backend=Codex(읽기 API), frontend=Claude Code. 근거: PROJECT_CONTEXT.md 4절 선택 기능 5번(작업 이력 조회 화면)과 3.6절의 감사 기록, DECISIONS.md D-052(이 절과 함께 승인 대기). 인증·역할·오류 형식은 12·19절을 따른다. **이 노드는 마이그레이션이 없다**(`domain_audit`는 읽기만 하며 새 인덱스도 만들지 않는다 — 데모 규모를 가정하고 기존 `ix_domain_audit_time`만 쓴다).

### 범위
- 포함: 운영자가 업무 이벤트(회차·원문·배정·번역·감수·발행)의 이력을 최신순으로 읽는 API와 화면, 회차·이벤트 종류별 거르기, 페이지 이동.
- 제외: 로그인·접근 거부 등 **인증 감사(`auth_audit`)**, 이력의 수정·삭제·내보내기, 번역가·감수자·독자의 이력 조회, 실시간 갱신, 이벤트 상세(요청 본문·텍스트) 조회.

### 24.1 API (읽기 전용)
시각은 UTC ISO-8601 `Z`, ID는 문자열, `Cache-Control: no-store`.
| API | 권한 | 요청 | 성공 응답 |
|---|---|---|---|
| GET /api/history?episodeId=&event=&limit=&offset= | OPERATOR | `episodeId`(선택, `^[1-9][0-9]{0,17}$`), `event`(선택, 아래 허용 값 중 하나), limit 1~100(기본 50), offset ≥0 | 200 {"items":[{"id","occurredAt","event","actor":{"id","displayName"},"episodeId","episodeTitle","sourceVersion","translationVersionNo","subject"}],"total":n} |
- `items`는 `occurredAt` 내림차순, 같으면 `id` 내림차순(안정 정렬). `total`은 거르기를 적용한 전체 건수이며 `offset`이 `total` 이상이면 빈 목록이다.
- 필드: `actor`는 행위자 계정(`domain_audit.actor_account_id`)의 `id`·`displayName`. `sourceVersion`은 정수 또는 null, `translationVersionNo`는 그 이벤트가 가리키는 번역 버전의 **회차 안 버전 번호**(정수, 번역 이벤트가 아니면 null — 내부 `translation_version_id`는 반환하지 않는다). `subject`는 배정 이벤트의 대상 계정 `{"id","displayName"}` 또는 null. `episodeTitle`은 그 회차의 현재 제목.
- `event` 허용 값(현재 `domain_audit`가 기록하는 것): `EPISODE_CREATED`, `SOURCE_SAVED`, `ASSIGNED`, `TRANSLATION_CREATED`, `TRANSLATION_SUBMITTED`, `REVIEW_APPROVED`, `REVIEW_REJECTED`, `APPROVAL_INVALIDATED`, `TRANSLATION_PUBLISHED`, `PUBLICATION_HELD`, `PUBLICATION_RESUMED`. 목록에 없는 `event`, 형식이 틀린 `episodeId`, 범위 밖 `limit`·`offset`, 반복·미정의 쿼리 값은 400 INVALID_REQUEST. 존재하지 않는 `episodeId`는 오류가 아니라 빈 목록(200)이다.
- 응답 필드는 정확히 위 목록이며 **반려 사유·블록별 의견·번역/원문 텍스트·제목 외 회차 내용·토큰·IP·인증 이벤트·내부 ID(번역 버전·감사 행 외)는 어떤 경로로도 반환하지 않는다**(`id`는 감사 행 ID).
- 권한: OPERATOR만. 번역가·감수자·독자는 403 FORBIDDEN(ACCESS_DENIED 감사), 비로그인은 401, 역할 위조(헤더·본문)는 무시한다. 보안 규칙은 `/api/history`를 OPERATOR 전용으로 명시한다(기존 `/api/episodes/**` 규칙에 의존하지 않는다). 오류 코드: 400, 401, 403, 503, 500. 오류 형식은 12절과 같고 비밀·내부 예외는 노출하지 않는다. 본문이 있는 GET은 무시한다.

### 24.2 처리 함수
| 이름 | 입력 → 출력 | 권한 | 상태 변경 | 실패 | 필수 테스트 |
|---|---|---|---|---|---|
| listHistory | 호출자, 거르기, limit, offset → items·total | OPERATOR | 없음 | 400/401/403/503 | 정렬(시각 내림차순·동률 id 내림차순), 페이지·경계·offset 초과 빈 목록, `episodeId`·`event` 거르기와 조합, 없는 회차 빈 목록, 허용 밖 event·잘못된 쿼리 400, 모든 이벤트 종류가 정확한 필드로 나옴(배정의 subject, 번역 이벤트의 translationVersionNo, 원문 이벤트의 sourceVersion), 응답 필드 정확 일치, 사유·의견·텍스트·인증 이벤트 비노출, 역할 매트릭스(4개 역할 + 비로그인, 역할 위조), 읽기 전용(전후 감사 행 수 불변) |

### 24.3 프런트 계약 (Claude Code)
- **운영자** 새 화면 `/history`(운영자 게이트, 다른 역할은 안내만): 이력 표(시각 UTC, 작업, 회차 제목(링크 `/episodes/{id}`), 수행자, 대상)와 거르기. 작업 이름은 한국어 고정 문구로 보이고(예: `SOURCE_SAVED` → "원문 저장 (v{sourceVersion})", `ASSIGNED` → "담당자 배정 → {subject}", `TRANSLATION_SUBMITTED` → "번역 v{n} 제출", `REVIEW_REJECTED` → "번역 v{n} 반려", `TRANSLATION_PUBLISHED` → "번역 v{n} 발행", `PUBLICATION_HELD` → "공개 보류", `PUBLICATION_RESUMED` → "공개 재개" 등), 알 수 없는 이벤트는 "기타 작업"으로 표시한다. 서버 문자열은 모두 글자로만 렌더링한다.
- 거르기: "작업 종류" 선택(전체 + 허용 값)과 "회차" 선택 `?episodeId=`(회차 상세의 "이 회차의 작업 이력" 링크로 진입). 20개씩 페이지 이동, "새로고침" 버튼. 거르기를 바꾸면 첫 페이지로 돌아간다. 오류·재시도·늦은 응답 무시·401/403 처리는 기존 방식이다.
- `/demo` 운영자 메뉴에 "작업 이력 조회" 링크, `/episodes/{id}`에 "이 회차의 작업 이력" 링크를 둔다. 독자·번역가·감수자 메뉴는 바꾸지 않는다.

### 24.4 파일 소유권·완료 조건
- Codex 변경: backend/src/main(신규 `history` 패키지, 보안 규칙·오류 처리), backend/src/test, README 기록. **마이그레이션 없음.** 기존 통합 테스트는 수정 없이 통과해야 한다(기존 응답에 필드를 더하지 않는다).
- Claude Code 변경: frontend/src, frontend/tests/ui. 변경 금지: V1~V32, 기존 API의 기존 필드·동작, PROJECT_CONTEXT.md, 서로의 영역.
- 테스트: 24.2 표, 연속 2회 통과·전후 행 수 비교(통합 테스트가 만든 행만 정리). frontend는 24.3 전부(표 표시·한국어 문구·거르기·페이지 이동·빈 상태·오류·재시도·역할 안내, 링크)와 기존 회귀·타입·빌드.
- **실제 브라우저 검증은 한 번만, 마지막 통합 검증(10/12)에 합친다**: 운영자가 `/history`에서 원문 저장·배정·번역 제출·반려·승인·발행·보류·재개 이벤트가 최신순으로 보이는지, 회차·작업 종류 거르기와 페이지 이동, 다른 역할의 접근 차단(HTTP 403), 이력에 사유·의견·텍스트가 없음을 확인한다.

## 25. AI 번역 초안 — 번역가의 선택적 초안 제안 — APPROVED (2026-10-07, 사용자 승인)

작성: Claude Code. 구현: backend=Codex, frontend=Claude Code. 근거: PROJECT_CONTEXT.md 4절 선택 기능 1번(AI 번역 초안)과 AI 규칙("AI 호출은 Spring 서버를 통해", "초안·참고 정보만 제공", "AI 실패 시 사람이 수동으로 작업"), D-050(금요일 판단 항목을 사용자가 진행으로 결정), DECISIONS.md D-053(이 절과 함께 승인 대기). 인증·역할·오류 형식은 12·19절, 번역은 17절을 따른다. **이 노드는 마이그레이션이 없다**(AI 제안은 저장하지 않는다).

### 범위
- 포함: 배정된 번역가가 자기 DRAFT 번역에서 AI 번역 제안을 요청하는 API, 서버의 AI 호출(제공자 설정·타임아웃·출력 상한·결과 검증), 요청 감사, 프런트의 "AI 초안 불러오기"(비어 있는 블록에만 제안 적용).
- 제외: 제안의 서버 저장·자동 저장·자동 제출, AI의 승인·반려·발행(금지, PROJECT_CONTEXT 7절 10항), AI 검수 참고(별도 선택 기능), 다중 모델 선택(PROJECT_CONTEXT 5절 제외), 스트리밍, 대화형 수정 요청, 용어집.

### 25.1 API
시각은 UTC ISO-8601 `Z`, ID는 문자열, `Cache-Control: no-store`. 경로 id가 `^[1-9][0-9]{0,17}$`(versionNo는 `{0,8}`)가 아니거나, 회차가 없거나, **배정되지 않은 회차**이면 404 NOT_FOUND(D-038).
| API | 권한 | 요청 | 성공 응답 |
|---|---|---|---|
| POST /api/my/episodes/{id}/translations/{versionNo}/ai-draft | 배정된 TRANSLATOR | 본문 없음(있으면 400) | 200 {"versionNo","provider","suggestions":[{"seq","text"}]} |
- **제안 대상**: 그 버전의 블록 중 **번역이 비어 있는(공백만 포함) 블록**만이다. 비어 있는 블록이 없으면 200 {"suggestions":[]}이며 AI를 호출하지 않는다. 한 요청에 보내는 블록은 최대 50개(원문 순서로 앞에서부터)이고, 그보다 많으면 나머지는 다음 요청에서 처리한다. `suggestions`는 seq 오름차순이며 **결과가 검증을 통과한 블록만** 담긴다.
- `provider`는 `"mock"` 또는 `"anthropic"`(설정된 제공자 이름, 고정 문자열). 어느 쪽이든 응답 형식은 같다.
- 조건: 버전 상태가 `DRAFT`이고 원문 버전이 최신이어야 한다. 아니면 409 STATE_CONFLICT(`currentStatus`). 서버는 번역 블록·버전·상태를 **변경하지 않는다**(읽기 전용 호출, 제안은 응답으로만 나간다).
- 역할 위반(감수자·운영자·독자)은 403 FORBIDDEN(ACCESS_DENIED 감사), 비로그인 401. 같은 계정·같은 버전에 이미 요청이 처리 중이면 429가 아니라 **409 STATE_CONFLICT**(`currentStatus` 없음)로 거절한다(중복 호출·비용 방지). 오류 코드: 400, 401, 403, 404, 409, **503 AI_UNAVAILABLE**, 503 SERVICE_UNAVAILABLE(DB), 500. 오류 형식은 12절과 같다(`AI_UNAVAILABLE`의 고정 안내 문구는 서버가 정한다). 외부 서비스의 응답 본문·오류 문구·키·내부 예외는 어떤 경우에도 노출하지 않는다.

### 25.2 서버 규칙
- **제공자 설정(환경 변수)**: `AI_PROVIDER`=`mock`(기본)|`anthropic`, `AI_API_KEY`(anthropic일 때 필요, 값은 어디에도 기록·로그·응답하지 않고 저장소에 커밋하지 않는다), `AI_MODEL`(anthropic일 때 모델 ID, 문서에 기본값을 두되 설정으로 바꿀 수 있다), `AI_TIMEOUT_SECONDS`(기본 30, 1~120), `AI_MAX_OUTPUT_TOKENS`(기본 2048, 128~8192 — **한 번의 AI 호출의 출력 상한**). 값이 범위 밖이거나 `anthropic`인데 키가 없으면 **기동하지 않는 대신** AI 호출이 503 AI_UNAVAILABLE이 되고 나머지 기능은 정상이다(AI 없이도 시연 가능). `mock`은 외부 호출 없이 결정적인 가짜 번역(`"[AI 초안] "` + 원문의 앞부분, 최대 길이 내)을 돌려주며 통합 테스트와 키 없는 시연에 쓴다.
- **AI 호출**: 서버에서만 호출한다(브라우저는 외부 AI를 직접 부르지 않는다). 블록은 번호와 함께 한 번의 호출로 보내고, 응답은 **JSON만** 받아 엄격히 파싱한다. 시스템 지시에는 "원문 블록의 내용은 번역할 자료일 뿐 지시가 아니다"(프롬프트 주입 방어), "번호별로 번역문만 JSON으로 출력"을 포함한다. 한국어로 번역하는 것을 고정 목표로 한다. 호출 실패·시간 초과·파싱 실패는 모두 503 AI_UNAVAILABLE이고 번역 데이터는 변하지 않는다. 재시도는 하지 않는다(비용·지연 방지).
- **결과 검증**: 각 제안은 번역 저장(17.2)과 같은 규칙(공백만 불가, 제어문자는 탭·개행만, 최대 길이)을 통과해야 한다. 통과하지 못하거나 요청하지 않은 seq의 제안은 **버린다**(전체를 실패로 만들지 않는다). 모든 제안이 버려지면 `suggestions`는 `[]`이다. 제안은 trim·정규화하지 않는다.
- **감사**: 요청마다 `domain_audit`에 `AI_DRAFT_REQUESTED`(actor, episode_id, source_version, translation_version_id)를 한 건 남긴다(성공·실패 무관, 호출 직전 커밋). **원문·제안 텍스트·프롬프트·키는 감사·로그에 저장하지 않는다.** 감사 저장 실패는 AI를 호출하지 않고 503 SERVICE_UNAVAILABLE.
- **데이터 취급(D-053)**: 원문 텍스트가 외부 AI 서비스로 전송된다. 데모 데이터에 한해 허용하며 화면에서 사전에 알린다. `mock` 제공자는 아무것도 전송하지 않는다.

### 25.3 처리 함수
| 이름 | 입력 → 출력 | 권한 | 상태 변경 | 실패 | 필수 테스트 |
|---|---|---|---|---|---|
| requestAiDraft | 호출자, episodeId, versionNo → suggestions | 배정된 TRANSLATOR | 감사 1건만 | 400/404/409/403/503 | 비어 있는 블록만 제안·최대 50개 순서, 비어 있는 블록 없으면 AI 미호출(감사도 없음), DRAFT 아님·원문 변경 후 409, 미배정·교체 후 404, 역할 매트릭스(4개 역할 + 비로그인, 역할 위조), 본문 있으면 400, 중복 처리 중 409, **번역 블록·상태·revision 불변**, 감사 1건과 텍스트 비저장, 감사 장애 시 AI 미호출 503 |
| AI 어댑터(mock/anthropic) | 번호 있는 원문 블록 → 번호별 번역 | 서버 내부 | 없음 | AI_UNAVAILABLE | mock 결정성, 제공자 장애·시간 초과·잘못된 JSON·키 없음 → 503 AI_UNAVAILABLE(데이터 불변), 검증 실패·요청 밖 seq 제안 폐기, 키·외부 응답 비노출, 출력 상한 설정 적용(HTTP 클라이언트는 가짜 서버나 대체 구현으로 테스트하고 **실제 외부 호출은 자동 테스트에서 하지 않는다**) |

### 25.4 프런트 계약 (Claude Code)
- 번역가 `/assigned/{id}`의 **편집 중인 DRAFT**에 "AI 초안 불러오기" 버튼을 둔다(저장하지 않은 변경이 있어도 사용 가능, 제출 확인 중에는 비활성). 누르면 확인 단계를 거친다: "원문이 외부 AI 서비스로 전송됩니다(데모 데이터만 사용하세요). 번역이 비어 있는 블록에만 제안이 채워지며, 직접 검토·수정하고 저장해야 반영됩니다."
- 성공하면 제안을 **편집기에 채운다 — 사용자가 이미 입력한 블록은 덮어쓰지 않는다**(요청 사이에 사용자가 입력했다면 그 블록의 제안은 버린다). 채워진 블록은 "AI 초안" 표시를 붙이고 저장하지 않은 변경으로 취급한다(진행률·저장·제출 규칙은 기존 그대로, 사용자가 수정하면 표시는 사라진다). 저장은 기존 "저장" 버튼으로만 하며 AI 제안이 자동으로 저장·제출되지 않는다. 제안이 0개면 "채울 블록이 없거나 제안을 받지 못했습니다"를 안내한다.
- 실패(503 AI_UNAVAILABLE)는 "AI 초안을 만들지 못했습니다. 직접 번역할 수 있습니다."와 재시도를 보이고 입력은 그대로 둔다. 409는 현재 상태 안내와 새로고침, 404·403·401·통신 오류는 기존 방식. 요청 중에는 버튼을 막고(중복 방지), 다른 버전으로 이동했거나 화면이 닫힌 뒤 도착한 응답은 무시한다. 읽기 전용 버전·다른 역할에는 버튼을 보이지 않는다.
- 제안은 브라우저에 저장하지 않는다(메모리 상태만). 독자·감수자·운영자 화면은 바뀌지 않는다.

### 25.5 파일 소유권·완료 조건
- Codex 변경: backend/src/main(신규 `ai` 패키지 또는 `translation` 확장, 설정 검증, 보안·오류 처리), backend/src/test, backend/.env.example(변수 이름만, 값은 비움), README 기록. **마이그레이션 없음.** 기존 통합 테스트는 수정 없이 통과해야 한다(기존 응답 필드 추가 없음). 감사 이벤트 `AI_DRAFT_REQUESTED`는 새 값이며 14절 감사 목록 규칙(이벤트 문자열 길이 32 이하)을 따른다.
- Claude Code 변경: frontend/src, frontend/tests/ui. 변경 금지: V1~V32, 기존 API의 기존 필드·동작, PROJECT_CONTEXT.md, 서로의 영역.
- 키 취급: **실제 키는 사용자만 셸 환경에 넣는다**(채팅·문서·커밋·로그에 쓰지 않는다). 기본 `mock`이므로 키 없이 전체 테스트와 시연이 가능하다. 실제 제공자 연동 확인은 사용자가 키를 설정한 경우에만 한 번 수동으로 한다(자동 테스트 아님).
- 테스트: 25.3 표, 연속 2회 통과·전후 행 수 비교. frontend는 25.4 전부(확인 단계·덮어쓰지 않음·AI 표시·실패 안내와 재시도·늦은 응답 무시·중복 방지·역할/읽기 전용에서 버튼 없음·저장 전 변경 취급)와 기존 회귀·타입·빌드.
- **실제 브라우저 검증은 한 번만, 마지막 통합 검증(10/12)에 합친다**(mock 제공자 기준): 번역가가 DRAFT에서 AI 초안을 불러와 채워진 블록을 수정·저장·제출하고, 감사에 `AI_DRAFT_REQUESTED`만 남고 텍스트가 없으며, AI 호출 실패 시(제공자 설정 오류) 수동 번역이 계속 가능함을 확인한다.

## 26. 페이지 이미지와 페이지 단위 작업 화면 — APPROVED (2026-10-07, 사용자 승인)

작성: Claude Code. 구현: backend=Codex(마이그레이션 V33 포함), frontend=Claude Code. 근거: 사용자 결정(2026-10-07: 만화 번역·검수는 원본 이미지를 보며 해야 한다), PROJECT_CONTEXT.md 4절 선택 기능 2번(만화 페이지 이미지 업로드)을 이번 범위로 되돌림, DECISIONS.md D-054(이 절과 함께 승인 대기). 인증·역할·오류 형식은 12·19절, 회차·원문은 13절, 배정 범위는 15절·D-038을 따른다. **이 노드는 마이그레이션 V33 하나가 있다**(새 테이블 1개, NOT NULL 규칙 적용).

### 범위
- 포함: 운영자의 페이지 이미지 업로드(교체 가능), 배정된 번역가·감수자와 운영자의 이미지 열람, 페이지 단위 작업 화면(번역가 편집·감수자 검토·운영자 읽기에서 한 페이지씩 이미지와 텍스트를 나란히 보며 넘김).
- 제외: 이미지 삭제, 이미지 편집·자르기·OCR, 독자 공개(원본 이미지는 독자에게 절대 노출하지 않는다), 이미지의 버전 관리(교체하면 이전 이미지는 사라지고 감사만 남는다), 객체 스토리지·CDN(D-054: 로컬 시연은 DB 저장), 큰 파일·동영상.

### 26.1 스키마 — V33 (파일당 DDL 하나, InnoDB·utf8mb4·UTC DATETIME(6))
`source_page_image`: episode_id BIGINT NOT NULL, page_no INT NOT NULL, content_type VARCHAR(32) NOT NULL(ascii_bin), byte_size INT NOT NULL, image_data MEDIUMBLOB NOT NULL, uploaded_by BIGINT NOT NULL, updated_at DATETIME(6) NOT NULL. **PRIMARY KEY (episode_id, page_no)**(한 회차의 한 페이지에 이미지 하나). FK(ON DELETE/UPDATE RESTRICT): episode_id → episode(id), uploaded_by → demo_account(id). `CHECK (content_type IN ('image/png','image/jpeg','image/webp'))`, `CHECK (byte_size BETWEEN 1 AND 5242880)`, `CHECK (page_no BETWEEN 1 AND 9999)`. 모든 컬럼 NOT NULL(NULL 허용 목록 변경 없음, 스키마 lint 통과). 이미지는 원문 버전이 아니라 **회차 + 페이지 번호**에 묶인다(원문을 새로 저장해도 같은 페이지 이미지가 유지된다).

### 26.2 API
시각은 UTC ISO-8601 `Z`, ID는 문자열, 경로 id가 `^[1-9][0-9]{0,17}$`(pageNo는 `^[1-9][0-9]{0,3}$`)가 아니거나 회차가 없으면 404 NOT_FOUND. 이미지 응답과 목록 응답은 `Cache-Control: no-store`(배정이 바뀌면 즉시 막혀야 한다).
| API | 권한 | 요청 | 성공 응답 |
|---|---|---|---|
| PUT /api/episodes/{id}/pages/{pageNo}/image | OPERATOR | **본문이 이미지 바이트 그대로**, `Content-Type`은 `image/png`·`image/jpeg`·`image/webp` 중 하나, 1~5 MiB | 201(새로 저장) 또는 200(교체) {"pageNo","contentType","byteSize","updatedAt"} |
| GET /api/episodes/{id}/pages | OPERATOR | — | 200 {"items":[{"pageNo","contentType","byteSize","updatedAt"}]} — pageNo 오름차순, 이미지가 있는 페이지만 |
| GET /api/episodes/{id}/pages/{pageNo}/image | OPERATOR | — | 200, 본문이 이미지 바이트, 저장된 `Content-Type`, `X-Content-Type-Options: nosniff` |
| GET /api/my/episodes/{id}/pages | 배정된 TRANSLATOR·REVIEWER | — | 200 위 목록과 같은 형식 |
| GET /api/my/episodes/{id}/pages/{pageNo}/image | 배정된 TRANSLATOR·REVIEWER | — | 200 이미지 바이트(위와 같은 헤더) |
- **업로드 검증(어기면 400 INVALID_REQUEST, 저장 없음)**: `Content-Type`이 허용 3종이 아님, 본문이 비었거나 5 MiB 초과, **본문의 시작 바이트(매직 넘버)가 선언한 형식과 다름**(PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, WEBP `RIFF....WEBP`), `pageNo`가 1~9999 밖. SVG·GIF·기타 형식은 받지 않는다. 쿼리 문자열·미정의 헤더는 무시한다. 5 MiB 초과 본문은 전부 읽기 전에 거절하도록 서버가 크기 상한을 둔다(메모리 보호).
- **페이지 존재 조건**: `pageNo`는 그 회차의 **현재 최신 원문 버전의 블록 중 하나가 가진 `pageNo`**여야 한다. 아니면 404 NOT_FOUND(원문이 없는 회차 포함). 이후 원문이 바뀌어 그 페이지가 사라져도 저장된 이미지는 남고 목록에서는 계속 보인다(조회 API는 원문과 무관하게 저장된 행만 본다).
- **배정 범위(D-038, 15·17절과 같음)**: 번역가·감수자는 그 회차에 **현재 배정된** 경우에만 읽는다(미배정·교체된 이전 담당자는 404). 역할 위반은 403 FORBIDDEN(ACCESS_DENIED 감사), 비로그인 401. **독자·공개 API·비배정자에게는 어떤 경로로도 노출하지 않는다**(`/api/public/**` 응답에 이미지·이미지 존재 여부가 없다). 업로드는 운영자만(번역가·감수자·독자 403). 보안 규칙 순서: `/api/my/episodes/*/pages/**`는 TRANSLATOR·REVIEWER 전용이며 기존 `/api/my/**`와 번역 전용 규칙보다 먼저 평가되어야 한다.
- 오류 코드: 400, 401, 403, 404, 503, 500(413은 쓰지 않고 400으로 통일). 오류 형식은 12절과 같고 비밀·내부 예외는 노출하지 않는다.
- **감사**: 업로드·교체마다 `domain_audit`에 `PAGE_IMAGE_SAVED`(actor, episode_id, source_version=현재 최신 원문 버전)를 한 건 기록하고 이미지 바이트·파일명은 저장하지 않는다. 같은 트랜잭션에서 저장과 감사가 함께 성공해야 하며 실패하면 전체 롤백과 503. 24절 작업 이력의 허용 `event` 목록에 `PAGE_IMAGE_SAVED`를 **추가**한다(가산적 변경, 기존 응답 형식 불변).

### 26.3 처리 함수
| 이름 | 입력 → 출력 | 권한 | 상태 변경 | 실패 | 필수 테스트 |
|---|---|---|---|---|---|
| savePageImage | 호출자, episodeId, pageNo, 바이트, Content-Type → 메타 | OPERATOR | 이미지 행 저장(신규/교체), 감사 | 400/404/403/503 | PNG·JPEG·WEBP 정상(바이트 정확 왕복), 신규 201·교체 200, 허용 밖 형식·SVG·GIF 400, 선언과 매직 넘버 불일치 400, 빈 본문·5 MiB 초과(경계 5 MiB 허용, +1 거절) 400, pageNo 범위·원문에 없는 페이지 404, 원문 없는 회차 404, 역할 매트릭스(4개 역할 + 비로그인), 감사 1건에 바이트 비저장, 감사 장애 롤백(이미지 불변), 동시 교체(마지막 성공이 남고 오류 없음) |
| listPageImages / getPageImage | 호출자, 회차(, pageNo) → 목록/바이트 | OPERATOR 또는 배정된 번역가·감수자 | 없음 | 404/403/401/503 | 목록 정렬·형식, 바이트가 업로드와 정확히 같음·`Content-Type`·`nosniff`, 이미지 없는 페이지 404, 미배정·교체 후 이전 담당자 404와 새 담당자 인계, 독자 403, 공개 API에 이미지·존재 비노출, 원문이 바뀌어도 이미지 유지, `no-store` |

### 26.4 프런트 계약 (Claude Code)
- **인증된 이미지 불러오기**: 브라우저의 `<img src>`는 `Authorization`을 보낼 수 없으므로, 프런트는 기존 요청 방식(Bearer, `credentials: omit`)으로 바이트를 받아 `Blob` URL로 표시하고 화면이 닫히거나 이미지가 바뀌면 URL을 해제한다. 이미지 요청은 늦은 응답을 무시하고, 실패(404 포함)는 그 페이지의 이미지 영역에만 "이미지가 없습니다/불러오지 못했습니다"를 보이며 텍스트 작업은 계속된다. 역할 외 화면에서는 이미지를 요청하지 않는다. 이미지는 토큰·사용자 정보를 URL에 넣지 않는다.
- **운영자** `/episodes/{id}`: "페이지 이미지" 영역 — 원문 블록의 페이지 번호 목록을 보이고(페이지 번호가 없는 원문이면 안내) 페이지마다 이미지 유무·썸네일·"업로드/교체" 선택(파일 선택, 허용 3종·5 MiB를 로컬에서 먼저 검사)을 둔다. 업로드 중 중복 요청 방지, 오류는 고정 문구, 성공하면 목록과 썸네일을 갱신한다. 원문 저장으로 페이지 목록이 바뀌면 영역도 다시 불러온다.
- **페이지 단위 작업 화면(번역가 편집 DRAFT·읽기 전용 버전, 감수자 검토, 운영자 번역 현황 상세)**: 블록을 `pageNo`별로 묶어 **한 번에 한 페이지**를 보이고 상단에 "페이지 N / M", 이전·다음, 페이지 선택을 둔다. 한 페이지의 화면은 **왼쪽(좁은 화면에서는 위): 페이지 이미지(있을 때) — 맞춤 폭/원본 크기 전환**, 그 아래 원문 블록, **오른쪽(아래): 번역 입력**(번역가 편집)·번역 표시(읽기 전용)·감수 의견 입력(감수자 반려 모드)이다. `pageNo`가 없는 블록은 "페이지 미지정" 묶음으로 마지막에 보인다. 페이지를 넘겨도 입력 중인 번역·의견·AI 초안 표시는 유지되고(메모리 상태), 페이지별 번역 완료 개수와 기존 전체 진행률을 보인다. 저장·제출·승인·반려의 규칙과 확인 단계는 기존 그대로다. 이미지가 없거나 불러오지 못하면 텍스트만 같은 구조로 보인다(이미지 자리는 안내 문구).
- 독자 화면은 변경하지 않는다(원본 이미지를 독자에게 보이지 않는다).

### 26.5 파일 소유권·완료 조건
- Codex 변경: `backend/src/main/resources/db/migration/V33__…`, backend/src/main(신규 `page` 패키지, 보안 규칙·오류 처리, 이력 허용 event 추가), backend/src/test, README 기록. 기존 EpisodeSource·Assignment·Translation·Review·Publication·History·인증 통합 테스트는 수정 없이 통과해야 한다. **(정정 2026-10-07, 사용자 승인 — V33 적용에 따른 기계적 변경만 허용)**: `MySqlIntegrationTest`의 최신 마이그레이션 버전 32→33과 허용 테이블 목록에 `source_page_image` 추가, `DomainSchemaMigrationIntegrationTest`의 전체 적용·이력 수 32→33과 V9 업그레이드 적용 수 23→24만 바꾼다. `HistoryIntegrationTest`는 바꾸지 않고 `PAGE_IMAGE_SAVED` 이력 조회는 새 페이지 이미지 테스트에서 검증한다. 그 밖의 모든 단언은 그대로 유지하고, 변경한 단언 목록(파일·테스트명)을 보고한다. **개발 DB(3306)에는 승인과 백업 절차 후에만 적용한다.**
- Claude Code 변경: frontend/src, frontend/tests/ui. 변경 금지: V1~V32, 기존 API의 기존 필드·동작, PROJECT_CONTEXT.md, 서로의 영역.
- 테스트: 26.3 표, 연속 2회 통과·전후 행 수 비교(이미지 테이블 포함 정리). frontend는 26.4 전부(Blob URL 표시·해제, 역할별 요청 범위, 실패 시 텍스트 작업 유지, 업로드 로컬 검사와 중복 방지, 페이지 묶음·이동·입력 유지, 이미지 없는 페이지, 미지정 페이지)와 기존 회귀·타입·빌드.
- **실제 브라우저 검증은 한 번만, 마지막 통합 검증(10/12)에 합친다**: 운영자가 PNG·JPEG 업로드·교체 → 번역가가 한 페이지씩 이미지와 원문을 보며 번역·AI 초안 수정·저장 → 감수자가 페이지별로 대조하고 의견 → 독자 화면·공개 API에 이미지 비노출 → 교체된 번역가의 404 → 작업 이력에 `PAGE_IMAGE_SAVED`.

## 27. 번역본 페이지 이미지와 만화 뷰어 — APPROVED (2026-10-08, 사용자 승인)

작성: Claude Code. 구현: backend=Codex(마이그레이션 V34 포함), frontend=Claude Code. 근거: 사용자 결정(2026-10-08, 독자가 번역된 만화 이미지를 뷰어로 읽는 화면 추가, 권장안 승인), DECISIONS.md D-055. 인증·역할·오류 형식은 12·19절, 번역은 17절, 감수는 18절, 발행·공개 API는 20·21절, 원본 페이지 이미지는 26절을 따른다. **원본 이미지(26절)는 계속 독자에게 노출하지 않는다.** 이 절은 번역가가 올리는 **번역본(식자 완료) 이미지**를 다룬다. 마이그레이션 V34 하나가 있다(새 테이블 1개, NOT NULL 규칙 적용).

### 범위
- 포함: 번역가의 번역본 페이지 이미지 업로드(번역 버전별), 번역가·감수자·운영자 열람, 발행된 버전의 번역본 이미지 공개 API, 만화 뷰어(스크롤·페이지 넘김·읽기 방향 전환·이전화/다음화), 번역본 이미지가 없는 회차의 텍스트 리더 대체.
- 제외: 앱 안의 식자 편집기, 이미지 삭제·자르기·OCR, 버전 간 이미지 복사, 작품·표지·카테고리·메인(28절), 댓글·관심, 이미지 다운로드 제한(DRM).

### 27.1 스키마 — V34 (파일당 DDL 하나, InnoDB·utf8mb4·UTC DATETIME(6))
`translation_page_image`: translation_version_id BIGINT NOT NULL, page_no INT NOT NULL, content_type VARCHAR(32) NOT NULL(ascii_bin), byte_size INT NOT NULL, image_data MEDIUMBLOB NOT NULL, uploaded_by BIGINT NOT NULL, updated_at DATETIME(6) NOT NULL. **PRIMARY KEY (translation_version_id, page_no)**. FK(RESTRICT): translation_version_id → translation_version(id), uploaded_by → demo_account(id). CHECK: content_type IN ('image/png','image/jpeg','image/webp'), byte_size BETWEEN 1 AND 5242880, page_no BETWEEN 1 AND 9999. 모든 컬럼 NOT NULL(NULL 허용 목록 변경 없음). 이미지는 번역 버전과 페이지 번호에 묶이며, 페이지 번호는 그 버전이 묶인 원문 버전의 블록이 가진 `page_no`여야 한다(서비스 검사).

### 27.2 API (모든 응답 `Cache-Control: no-store`, 시각 UTC ISO-8601 `Z`, 경로 id `^[1-9][0-9]{0,17}$`, versionNo `{0,8}`, pageNo `{0,3}`, 위반 404)
| API | 권한 | 요청 | 성공 응답 |
|---|---|---|---|
| PUT /api/my/episodes/{id}/translations/{versionNo}/page-images/{pageNo} | 배정된 TRANSLATOR | 본문=이미지 바이트, Content-Type image/png·jpeg·webp, 1 B~5 MiB | 201(신규) 또는 200(교체) {"pageNo","contentType","byteSize","updatedAt"} |
| GET /api/my/episodes/{id}/translations/{versionNo}/page-images | 배정된 TRANSLATOR·REVIEWER | — | 200 {"items":[{"pageNo","contentType","byteSize","updatedAt"}]} (pageNo 오름차순) |
| GET …/page-images/{pageNo} (같은 경로) | 배정된 TRANSLATOR·REVIEWER | — | 200 이미지 바이트, 저장된 Content-Type, `X-Content-Type-Options: nosniff` |
| GET /api/episodes/{id}/translations/{versionNo}/page-images, …/{pageNo} | OPERATOR | — | 위와 같은 형식 |
| GET /api/public/episodes/{id}/pages | 누구나 | — | 200 {"items":[{"pageNo"}]} — 현재 공개 버전의 번역본 이미지가 있는 페이지, 오름차순. 이미지가 없으면 빈 배열 |
| GET /api/public/episodes/{id}/pages/{pageNo}/image | 누구나 | — | 200 이미지 바이트(위와 같은 헤더) |
- **업로드 규칙**: 버전 상태가 `DRAFT`일 때만 저장·교체(그 밖은 409 STATE_CONFLICT, `currentStatus` 포함). 번역가는 그 회차에 **현재 배정된** 경우만(미배정·교체된 이전 번역가·없는 버전 404, D-038). 검증은 26.2와 같다(허용 3종, 빈 본문·5 MiB 초과 400, 경계 5 MiB 허용, 선언과 시작 바이트 불일치 400, 상한은 본문 전체를 읽기 전에 거절). 페이지가 원문 버전 블록에 없으면 404. **제출·승인·발행 이후에는 수정할 수 없다.** 저장은 `domain_audit`에 `TRANSLATION_PAGE_IMAGE_SAVED`(actor, episode_id, source_version, translation_version_id) 한 건을 같은 트랜잭션으로 남기고 바이트·파일명은 저장하지 않는다. 실패 시 전체 롤백과 503.
- **열람 규칙**: 번역가는 자기 회차의 모든 번역 버전, 감수자는 18절에서 보이는 상태(`REVIEW_PENDING`·`APPROVED`·`REJECTED`)의 버전만(그 밖은 404), 운영자는 모든 버전. 역할 위반 403(ACCESS_DENIED 감사), 비로그인 401. 보안 규칙 순서: `/api/my/episodes/*/translations/*/page-images/**`는 TRANSLATOR·REVIEWER 허용이며 기존 번역가 전용 규칙(`/api/my/episodes/*/translations/**`)보다 **먼저** 평가되어야 한다. `/api/public/**`는 기존대로 permitAll·GET 전용.
- **공개 규칙(20·21절과 같은 기준)**: 회차의 공개 포인터가 가리키는 버전이 `PUBLISHED`일 때만 그 버전의 이미지를 돌려준다. 미발행·보류 중·없는 회차·이미지 없는 페이지는 동일한 404 NOT_FOUND(`/pages` 목록은 회차가 공개 중이 아니면 404, 공개 중인데 이미지가 없으면 200 `[]`). 독자에게는 pageNo와 바이트 외의 정보를 주지 않으며 **원본 이미지는 어떤 경로로도 노출하지 않는다**. 공개 이미지 응답에 `Cross-Origin-Resource-Policy: same-origin`을 붙이지 않는다(프런트가 다른 출처의 API 이미지를 `<img>`로 직접 표시). 인증 헤더는 판정하지 않는다.
- 오류: 400, 401, 403, 404, 409 STATE_CONFLICT, 503, 500. 형식은 12절과 같고 내부 예외·비밀은 노출하지 않는다. 24절 작업 이력의 허용 `event`에 `TRANSLATION_PAGE_IMAGE_SAVED`를 **추가**한다(가산적 변경).

### 27.3 처리 함수
| 이름 | 입력 → 출력 | 권한 | 상태 변경 | 실패 | 필수 테스트 |
|---|---|---|---|---|---|
| saveTranslationPageImage | 호출자, 회차, 버전, 페이지, 바이트, Content-Type → 메타 | 배정된 TRANSLATOR | 이미지 행 저장(신규/교체), 감사 | 400/403/404/409/503 | PNG·JPEG·WEBP 바이트 정확 왕복, 신규 201·교체 200, 허용 밖·선언 불일치·빈 본문·5 MiB+1 400(경계 허용), 원문에 없는 페이지 404, DRAFT 아닌 버전 409, 미배정·이전 번역가 404와 새 번역가 인계, 역할 매트릭스, 감사 1건·바이트 비저장, 감사 장애 롤백 |
| list/get 번역본 이미지 | 호출자, 회차, 버전(, 페이지) → 목록/바이트 | 번역가·감수자·운영자 | 없음 | 401/403/404/503 | 정렬·형식, 바이트·Content-Type·nosniff·no-store, 감수자는 보이는 상태만, 타 번역가 회차 404, 독자 403 |
| 공개 번역본 이미지 | 회차(, 페이지) → 목록/바이트 | 누구나 | 없음 | 404/503 | 발행된 버전의 이미지만, 발행 전·보류 중·없는 회차·이미지 없는 페이지 동일 404, 보류 후 재개 시 복귀, 새 DRAFT·승인·원문 변경이 공개 응답을 바꾸지 않음, 교체 발행 시 새 버전의 이미지, 원본 이미지 비노출, 인증 무관 동일 응답, POST 등 405, CORP 헤더 없음 |
| 스키마 | V34 | — | — | — | NOT NULL·CHECK·PK·FK 위반 거부와 정상 허용(실제 MySQL), NOT NULL lint 통과, V1~V33 불변 |

### 27.4 프런트 계약 (Claude Code)
- **번역가** `/assigned/{id}` 페이지 단위 편집(26.4): 페이지마다 원본 이미지와 번역본 이미지를 나란히(좁은 화면은 위아래) 보이고, "번역본 이미지" 영역에 업로드·교체(허용 3종·5 MiB·시작 바이트를 로컬에서 먼저 검사, 중복 방지, 고정 오류 문구)를 둔다. DRAFT에서만 올릴 수 있고 제출된 버전은 읽기 전용. 이미지는 Blob URL로 표시하고 해제한다.
- **감수자** 검토 화면과 **운영자** 번역 현황 상세: 같은 페이지 화면에 원본/번역본 이미지를 나란히 읽기 전용으로 보인다. 번역본 이미지가 없는 페이지는 안내만 보이고 텍스트 작업은 계속된다.
- **운영자 발행 확인**: 원문에 페이지 번호가 있는데 번역본 이미지가 없는 페이지가 있으면 확인 문구에 그 개수를 알린다(차단하지 않음).
- **뷰어** `/read/{id}`(로그인 불필요, 공개 API만, 토큰 없음): 공개 `/pages`로 이미지 페이지를 구성하고 공개 이미지 URL을 `<img>`로 직접 표시한다. 번역본 이미지가 없으면 기존 **텍스트 리더**(23.3)를 그대로 보인다.
  - 상단 바: 회차 제목, 회차 목록(`/read`) 링크, 이전화·다음화, 설정 버튼. 하단 바: 이전화·다음화.
  - **보기 방식**: ① 스크롤: 이미지를 세로로 이어 보임(폭 맞춤, 읽기 폭 상한). ② 페이지 넘김: 한 쪽 또는 **두 쪽 펼침**(넓은 화면에서만, 첫 페이지는 단독 표지). "N / M"과 페이지 선택, 마지막 도달 시 다음화 안내.
  - **읽기 방향**: **오른쪽→왼쪽(기본, 일본 만화)**과 왼쪽→오른쪽을 설정으로 전환. 오른쪽→왼쪽에서는 첫 페이지가 오른쪽에 놓이고 **왼쪽 영역 클릭 또는 ←키가 다음**, 오른쪽 영역·→키가 이전. 왼쪽→오른쪽은 반대. 화면 양쪽 가장자리의 화살표 버튼도 같은 규칙. 모바일은 좌우 스와이프도 같은 규칙(세로 스크롤과 충돌하지 않게).
  - **설정 패널**(보기 방식, 한 쪽/두 쪽, 읽기 방향)은 `localStorage`(키 `mangabridge.viewer.settings.v1`)에 저장하며 저장소가 막혀도 동작한다. 마지막 본 페이지는 회차 id·페이지 번호·공개 시각만 저장(`mangabridge.viewer.position.v1`)하고 공개본이 바뀌면 폐기한다.
  - **정정(D-061, 2026-10-13)**: 설정을 저장하지 않은 독자의 기본값은 **두 쪽 펼침**(넓은 화면)이다. 좁은 화면·스크롤 방식은 한 쪽이고 저장된 설정은 그대로 따른다.
  - **정정(D-062, 2026-10-13): 두 쪽 펼침은 첫 쪽부터 짝을 짓는다**(1–2, 3–4, …, 홀수 마지막 쪽은 단독). "첫 페이지는 단독 표시" 규칙을 대체한다. 위치 표시(예: `1–2 / 5`)·이어 읽기·읽기 방향(rtl이면 짝의 첫 쪽이 오른쪽)은 그대로이다.
  - **미리 불러오기**: 현재 위치의 앞뒤 1~2쪽. 이미지 로드 실패는 해당 쪽에만 "이미지를 불러오지 못했습니다"와 다시 시도를 보이고 나머지는 계속 읽을 수 있다. `<img alt="페이지 N">`. 모든 조작은 키보드로 가능하고 설정 패널은 포커스를 가둔 채 Esc로 닫힌다. 움직임 줄이기 설정을 존중한다.
  - 이전화/다음화는 공개 목록(20절)에서 찾고 실패하면 링크만 숨긴다. 독자 화면은 로그인 상태·역할에 따라 달라지지 않는다.

### 27.5 파일 소유권·완료 조건
- Codex 변경: `backend/src/main/resources/db/migration/V34__…`, backend/src/main(신규 패키지, 보안 규칙 순서, 이력 허용 event 추가), backend/src/test, README 기록.
  - **기존 통합 테스트는 수정 없이 통과해야 한다. 단, V34 적용에 따른 기계적 변경만 허용(26.5와 같은 처리)**: `MySqlIntegrationTest`의 최신 마이그레이션 버전 33→34와 허용 테이블 목록에 `translation_page_image` 추가, `DomainSchemaMigrationIntegrationTest`의 전체 적용·이력 수 33→34와 V9 업그레이드 적용 수 24→25. `HistoryIntegrationTest`는 바꾸지 않고 새 이벤트 조회는 새 테스트에서 검증한다. 변경한 단언 목록(파일·테스트명·사유)을 보고한다. 이 범위 밖의 기존 테스트가 깨지면 임의로 고치지 말고 멈춰 보고한다.
  - 개발 DB(3306)에는 승인·백업 절차 후에만 V34를 적용한다.
- Claude Code 변경: frontend/src, frontend/tests/ui. 변경 금지: V1~V33, 기존 API의 기존 필드·동작(이력 허용 event 추가 제외), PROJECT_CONTEXT.md, 서로의 영역.
- 테스트: 27.3 표, 연속 2회 통과·전후 행 수 비교. frontend는 27.4 전부(업로드·로컬 검사·중복 방지, 원본/번역본 병기, 뷰어의 스크롤·한 쪽·두 쪽·방향 전환과 클릭·키·스와이프 규칙, 설정 저장과 저장소 차단, 미리 불러오기, 이미지 실패 격리, 텍스트 리더 대체, 이전화/다음화)와 기존 회귀·타입·빌드.
- **실제 브라우저 검증은 28절과 합쳐 최종 1회, 짧게**: 번역가 번역본 이미지 업로드 → 감수자·운영자가 원본과 나란히 확인 → 승인·발행 → 비로그인 독자가 `/read/{id}`에서 스크롤·페이지 넘김·방향 전환(왼쪽 영역 클릭=다음 쪽)·이전화/다음화 → 보류 시 404 → 공개 화면·응답에 원본 이미지 없음.

## 28. 작품·표지·장르·메인 화면 — APPROVED (2026-10-08, 사용자 승인)

작성: Claude Code. 구현: backend=Codex(마이그레이션 V35 포함), frontend=Claude Code. 근거: 사용자 결정(2026-10-08, 독자용 상품형 메인과 작품 상세 추가, 권장안 승인), DECISIONS.md D-055·D-056. 인증·역할·오류 형식은 12·19절, 회차·원문은 13~15절, 발행·공개 API는 20·21절, 번역본 이미지와 뷰어는 27절을 따른다. **기존 API의 기존 필드·동작은 바꾸지 않는다**(회차 API·공개 회차 API 그대로). 마이그레이션 V35 하나가 있고 새 테이블만 만든다(기존 테이블 변경 없음, NOT NULL 규칙 적용).

### 범위
- 포함: 작품(제목·작가·소개·읽기 방향·장르 최대 3개·표지·공개 여부·메인 노출 표시), 회차의 작품 연결(회차 번호), 조회수, 공개 카탈로그 API(작품 목록·작품 상세·표지·메인 묶음·회차의 작품 정보), 운영자 작품 관리 화면, 독자용 메인 `/`, 작품 상세 `/works/{id}`, 뷰어의 읽기 방향 기본값·작품 안 이전화/다음화.
- 제외: 베스트 리뷰, 댓글, 관심, 태그 검색(장르만), 멤버십·결제, 작품·표지 삭제, 별도 배너 이미지(표지를 크게 보임), 조회수 중복 제거(어뷰징 방지), 개인화 추천, 작품 검색(제목 검색은 기존 회차 목록 검색을 유지).
- 작품에 연결되지 않은 기존 회차는 그대로 `/read`·`/read/{id}`에서 읽을 수 있다(작품 페이지에는 나오지 않고 메인의 "최신 공개 회차"에는 표지 없이 나온다).

### 28.1 스키마 — V35 (InnoDB·utf8mb4·UTC DATETIME(6), 모든 컬럼 NOT NULL; **정정 2026-10-09: 이 마이그레이션만 "파일당 DDL 하나"의 예외로, V35 한 파일에 CREATE TABLE 5개를 둔다**(테이블 5개를 만들려면 문장 5개가 필요하고, 새 테이블 묶음이라 V35 하나가 단순하다. 아래 순서대로 FK 대상이 먼저 만들어지게 쓴다. 기존 테이블 변경 DDL은 여전히 금지))
- `work`: id BIGINT AUTO_INCREMENT PK, title VARCHAR(100), author VARCHAR(100), description VARCHAR(2000)(빈 문자열 허용), reading_direction VARCHAR(3) ascii_bin CHECK IN ('RTL','LTR'), is_public TINYINT(1) CHECK IN (0,1), is_featured TINYINT(1) CHECK IN (0,1), is_banner TINYINT(1) CHECK IN (0,1), revision INT CHECK >= 1, created_by BIGINT → demo_account(id), created_at, updated_at. title·author는 공백만으로 둘 수 없다(서비스 검사).
- `work_genre`: work_id BIGINT, genre VARCHAR(20) **CHARACTER SET utf8mb4 COLLATE utf8mb4_bin**(정정 2026-10-09: 한글 장르 값은 ascii 컬럼에 저장할 수 없다. 영문 값 컬럼인 reading_direction·content_type은 ascii_bin 그대로), PRIMARY KEY (work_id, genre), FK work(id), CHECK genre IN ('판타지','액션','로맨스','코미디','일상','미스터리','스릴러','SF','스포츠','드라마'). 작품당 1~3개는 서비스가 검사한다.
- `work_cover`: work_id BIGINT PK(FK work), content_type VARCHAR(32) ascii_bin CHECK 허용 3종, byte_size INT CHECK BETWEEN 1 AND 5242880, image_data MEDIUMBLOB, uploaded_by → demo_account(id), updated_at.
- `work_episode`: episode_id BIGINT PK(FK episode(id)), work_id BIGINT(FK work), episode_no INT CHECK BETWEEN 1 AND 9999, **UNIQUE (work_id, episode_no)**. 회차는 최대 한 작품에만 속한다.
- `episode_view_count`: episode_id BIGINT PK(FK episode(id)), view_count BIGINT CHECK >= 0.
- 모든 FK는 RESTRICT. 기존 테이블·V1~V34는 변경하지 않는다.

### 28.2 공통 정의
- **공개 회차**: 20절과 같다(공개 포인터가 가리키는 버전이 PUBLISHED). **공개 작품**: `is_public=1`이면서 작품에 연결된 공개 회차가 1개 이상. 조건을 하나라도 잃으면(보류 등) 공개 응답에서 사라진다.
- **작품 요약**(공개): {"workId","title","author","genres":[장르 이름 오름차순],"hasCover","episodeCount"(공개 회차 수),"latestPublishedAt"(공개 회차 중 최신),"views"(공개 회차 조회수 합)}. 시각 UTC ISO-8601 `Z`, id는 문자열.
- 장르 목록(고정, 이 순서로 표시): 판타지, 액션, 로맨스, 코미디, 일상, 미스터리, 스릴러, SF, 스포츠, 드라마.
- 읽기 방향: `RTL`(오른쪽→왼쪽, 기본값)·`LTR`.
- 공개 응답은 `Cache-Control: no-store`. 공개 API는 인증 헤더를 판정하지 않는다. 경로 id 규칙은 27절과 같고 위반은 404.

### 28.3 운영자 API (OPERATOR 전용, 그 밖의 역할 403, 비로그인 401, 오류 형식은 12절)
| API | 요청 | 성공 응답 |
|---|---|---|
| POST /api/works | {"title","author","description","readingDirection","genres":[1~3개]} | 201 {"id","revision":1} (기본값: 비공개, 추천·배너 아님) |
| GET /api/works?limit&offset | limit 1~100(기본 20) | 200 {"items":[{"id","title","author","readingDirection","genres","isPublic","isFeatured","isBanner","hasCover","episodeCount"(연결된 전체 회차),"publicEpisodeCount","revision","updatedAt"}],"total"} id 내림차순 |
| GET /api/works/{id} | — | 200 위 항목 + "description" + "episodes":[{"episodeId","episodeNo","title","published"(공개 여부)}] (episodeNo 오름차순) |
| PUT /api/works/{id} | {"expectedRevision","title","author","description","readingDirection","genres","isPublic","isFeatured","isBanner"} | 200 {"revision","changed"} |
| PUT /api/works/{id}/cover | 본문=이미지 바이트, Content-Type 허용 3종, 1 B~5 MiB(27절·26.2와 같은 검증) | 201(신규)·200(교체) {"contentType","byteSize","updatedAt"} |
| GET /api/works/{id}/cover | — | 200 이미지 바이트(`nosniff`, `no-store`) — 비공개 작품 미리보기용 |
| PUT /api/episodes/{id}/work | {"workId","episodeNo"} | 200 {"workId","episodeNo"} (연결·재연결·번호 변경) |
| DELETE /api/episodes/{id}/work | — | 204 (연결 해제, 이미 없으면 204) |
| GET /api/episodes/{id}/work | — | 200 {"work":null} 또는 {"work":{"workId","title","episodeNo"}} (회차가 없으면 404) |
- **검증**: title·author 앞뒤 공백 제거 후 1~100자, description 0~2000자(제어 문자 금지, 줄바꿈 허용), genres는 고정 목록의 서로 다른 1~3개, readingDirection은 RTL/LTR. 위반 400. 알 수 없는 필드는 거절(기존 규칙).
- **규칙**: `isBanner=true`는 표지가 있는 작품만 가능하고 동시에 최대 5개(초과·표지 없음은 409 `STATE_CONFLICT`, `reason`: `BANNER_LIMIT`/`COVER_REQUIRED`). `expectedRevision`이 다르면 409 `REVISION_CONFLICT`(최신 revision 포함, 18·17절 형식). 변경이 없으면 `changed:false`, revision 유지. 작품을 연결하려면 작품·회차가 있어야 한다(없으면 404), (workId, episodeNo)가 이미 다른 회차에 쓰이면 409 `STATE_CONFLICT` `reason: EPISODE_NO_TAKEN`. 표지 검증 실패 400, 없는 작품 404.
- 작품 변경은 `domain_audit` 대상이 아니다(24절 이력은 회차 업무만, D-056). 대신 work.updated_at·revision이 변경을 나타낸다. 저장 실패는 전체 롤백과 503.

### 28.4 공개 API (GET 전용·누구나)
| API | 응답 |
|---|---|
| GET /api/public/home | 200 {"banners":[작품 요약 ≤5],"latest":[{"episodeId","title","publishedAt","workId"|null,"workTitle"|null,"episodeNo"|null}] ≤12 (공개일 내림차순, 같으면 id 내림차순),"popular":[작품 요약 ≤10 (views 내림차순, 같으면 workId 내림차순)],"featured":[작품 요약 ≤10 (is_featured인 공개 작품, updated_at 내림차순)]} — 비어 있어도 200이며 빈 배열 |
| GET /api/public/works?genre=&sort=&limit&offset | genre는 고정 목록(생략=전체), sort=`latest`(latestPublishedAt 내림차순, 기본)·`popular`, limit 1~50(기본 20), 200 {"items":[작품 요약],"total"}. 잘못된 genre·sort·limit·offset·알 수 없는 쿼리는 400 |
| GET /api/public/works/{id} | 공개 작품만, 200 {작품 요약 + "description","readingDirection","episodes":[{"episodeId","episodeNo","title","publishedAt"}] (공개 회차만, episodeNo 오름차순)} — 그 밖은 404 |
| GET /api/public/works/{id}/cover | 공개 작품이면서 표지가 있을 때만 200 이미지(`nosniff`, CORP 헤더 없음), 그 밖은 404 |
| GET /api/public/episodes/{id}/work | 공개 회차가 공개 작품에 속하면 200 {"workId","title","readingDirection","episodeNo"}. 그 밖(공개 회차가 아님, 작품에 속하지 않음, 작품이 공개가 아님, 없는 회차)은 모두 같은 **404 NOT_FOUND**이다(뷰어는 404를 "작품 없음"으로 처리한다) |
| POST /api/public/episodes/{id}/views | 공개 회차이면 조회수를 1 올리고 204(본문 없음), 그 밖은 404. **공개 API 중 유일한 쓰기**이며 인증을 판정하지 않는다. 같은 호출을 여러 번 받아도 매번 1씩 올린다(중복 제거 없음) |
- **조회수 의미**: 독자가 뷰어/리더에서 회차를 연 횟수의 근사값이며 어뷰징 방지는 범위 밖이다(D-056). 인기 순위는 이 값의 합이고 보류된 회차의 조회수는 합에 넣지 않는다.
- 기존 `/api/public/episodes`·`/api/public/episodes/{id}`·27절 공개 API는 바뀌지 않는다. 그 밖의 `/api/public/**` 쓰기(POST/PUT/PATCH/DELETE)는 기존대로 405이다. `views` 경로는 POST만 허용하고 GET·PUT·PATCH·DELETE는 405이다. 보안 규칙에서 `POST /api/public/episodes/*/views`만 새로 permitAll이다.

### 28.5 처리 함수와 필수 테스트
| 이름 | 권한 | 필수 테스트 |
|---|---|---|
| createWork / updateWork | OPERATOR | 필드 검증 전부(길이·공백·장르 0·4개·중복·알 수 없는 장르·방향), 기본값, revision 증가·충돌 409(최신 revision), 변경 없음 `changed:false`, 배너 5개 한도와 표지 필수 409, 역할 매트릭스, 롤백 |
| saveWorkCover | OPERATOR | PNG·JPEG·WEBP 바이트 정확 왕복, 신규 201·교체 200, 5 MiB 경계, 허용 밖·불일치·빈 본문 400, 없는 작품 404 |
| assignEpisodeWork / unassign / getEpisodeWork | OPERATOR | 연결·재연결·번호 변경, (작품, 번호) 중복 409, 없는 작품·회차 404, 해제 멱등 204, 한 회차 한 작품 |
| 공개 카탈로그(home·works·work·cover·episode work) | 누구나 | 공개 작품 정의(비공개·공개 회차 없음·보류 시 사라짐과 재개 시 복귀), 장르 필터·정렬·페이지·잘못된 파라미터 400, episodes 정렬과 공개 회차만, 표지 바이트·헤더·CORP 없음, 배너·최신·인기·추천 규칙과 한도·정렬, 작품에 속하지 않은 회차는 latest에 workId null, 인증 무관 동일 응답, 비공개 작품 정보(설명 등)가 응답에 없음 |
| recordView | 누구나 | 공개 회차 204와 +1, 미공개·보류·없는 회차 404, 보류된 회차는 인기 합 제외, GET/PUT 405, 인증 무관 |
| 스키마 | — | NOT NULL·CHECK·PK·FK·UNIQUE 위반 거부와 정상 허용(실제 MySQL), 기존 NOT NULL lint 통과, V1~V34 불변 |

### 28.6 프런트 계약 (Claude Code)
- **정정(D-058, 2026-10-10): 아래 ① 배너는 표시하지 않고 히어로만 둔다.** 운영자의 배너 설정과 홈 API의 `banners`는 그대로이며 메인에서 쓰지 않는다.
- **정정(D-061, 2026-10-13): 히어로는 캐러셀이다.** 첫 슬라이드는 소개, 이어서 홈 API의 `banners`(운영자가 정한 배너 작품)가 슬라이드로 나온다. 버튼·점으로 이동하고 6초마다 자동으로 넘어가며(일시정지 버튼, 포인터·초점 중에는 정지, 동작 줄이기 요청 시 자동 넘김 없음), 배너가 없으면 소개만 보인다. D-058의 "배너 없음"을 이 항목이 대체한다.
- **독자용 메인 `/`** (로그인 불필요, 공개 API만, 토큰 없음; 기존 `/` 헬스 체크 화면은 `/status`로 옮긴다): 위에서부터 ① 배너(표지 큰 이미지·제목·작가, 이전/다음 버튼과 현재 위치, **자동 넘김 없음**, 클릭하면 작품 상세) ② 최신 공개 회차 카드(작품 제목·회차 번호·제목·공개일, 표지는 작품이 있을 때만, 클릭하면 뷰어) ③ 인기 작품 ④ 운영자 추천 ⑤ 장르별 작품(장르 탭 10개 + "전체", 선택한 장르의 작품 카드, `/api/public/works?genre=`를 장르를 고를 때만 불러온다) ⑥ footer(서비스 소개 한 줄, 공개 회차 목록 `/read` 링크, 로그인 링크; 쓰지 않는 약관·고객센터 링크는 두지 않는다). 섹션이 비면 그 섹션을 감춘다. 모든 비어 있음·오류·로딩 상태는 고정 문구, 한 요청의 실패가 다른 섹션을 막지 않는다(홈은 한 번에 오므로 홈 실패는 전체 재시도, 장르 탭 실패는 그 영역만). 표지는 `<img src>`로 공개 URL을 직접 쓰고 `alt`는 작품 제목, 없으면 글자 자리표시.
- **작품 상세 `/works/{id}`**: 표지, 제목, 작가, 장르 배지, 소개(줄바꿈 유지), 읽기 방향 표시, 회차 목록(번호·제목·공개일, 오름/내림차순 전환, 기본 최신 회차가 위), "첫 화 보기"와 저장된 읽던 위치가 있으면 "이어 읽기"(27.4의 `mangabridge.viewer.position.v1`만 읽는다). 없는 작품은 고정 문구와 메인 링크. 메타 제목은 고정 문구(작품명은 화면에만).
- **뷰어 보강**: `/read/{id}`는 `/api/public/episodes/{id}/work`로 작품을 찾으면 ① 사용자가 아직 방향을 정하지 않았을 때만(저장된 설정이 없을 때) **작품의 읽기 방향을 기본값**으로 쓰고 ② 이전화/다음화를 **작품의 회차 목록**(episodeNo 순)에서 찾고 ③ 상단의 "목록" 링크를 작품 상세로 바꾸며 ④ 회차 진입 시 `POST …/views`를 **세션당 회차마다 한 번만** 보낸다(`sessionStorage` 키 `mangabridge.viewer.counted.v1`, 저장소가 막히면 열 때마다 보내도 된다, 실패는 화면에 영향 없음). 작품이 없으면(404) 기존 27.4 동작(전체 공개 목록 기준 이웃)을 그대로 쓴다. 텍스트 리더에도 조회수 호출을 붙인다.
- **운영자 작품 관리** `/works-admin` (OperatorGate, `(auth)` 그룹. 독자용 `/works/{id}`와 경로가 겹치지 않는다): 작품 목록(공개·추천·배너 배지, 표지 유무, 회차 수), 새 작품 만들기, 작품 편집 화면(`/works-admin/{id}`)에서 기본 정보·장르(체크박스, 3개 초과 시 입력 차단)·읽기 방향·공개·추천·배너 설정, 표지 업로드·교체(허용 3종·5 MiB·시작 바이트를 로컬에서 먼저 검사, 미리보기), 연결된 회차 목록. 변경 충돌(409)은 "다른 곳에서 변경되었습니다. 최신 내용을 불러오세요"로 안내하고 입력을 지우지 않는다. 배너 한도·표지 필수 위반은 고정 문구. 회차 상세(`/episodes/{id}`)에 **작품 연결 패널**(작품 선택·회차 번호 입력·연결·해제)을 추가한다.
- 헤더: 공개 화면 헤더에 "홈"(`/`)·"회차 목록"(`/read`)·로그인, 운영자 화면 헤더에 "작품 관리" 링크. 공개 화면은 로그인 상태·역할에 따라 달라지지 않는다.

### 28.7 파일 소유권·구현 순서·완료 조건
- Codex 변경: `backend/src/main/resources/db/migration/V35__…`, backend/src/main(신규 `work` 패키지 등, 보안 규칙, 오류 처리), backend/src/test, README 기록.
  - **기존 통합 테스트는 수정 없이 통과해야 한다. 단, V35 적용에 따른 기계적 변경만 허용(26.5·27.5와 같은 처리)**: `MySqlIntegrationTest`의 최신 마이그레이션 버전 34→35와 허용 테이블 목록에 `work`·`work_genre`·`work_cover`·`work_episode`·`episode_view_count` 추가, `DomainSchemaMigrationIntegrationTest`의 전체 적용·이력 수 34→35와 V9 업그레이드 적용 수 +1. 공개 API 405 테스트는 기존 경로에 대해 그대로 유지하고 `views` 경로는 새 테스트에서 검증한다. 변경한 단언 목록을 보고하고, 이 범위 밖의 기존 테스트가 깨지면 멈춰 보고한다.
  - **구현 순서(사용량이 부족하면 앞 단계까지 커밋하고 멈춰도 된다)**: ① V35 + 운영자 API(작품·표지·회차 연결) ② 공개 카탈로그 GET 5개 ③ 조회수 쓰기와 인기·보류 반영. 단계마다 테스트를 통과시키고 커밋한다.
  - 개발 DB(3306)에는 승인·백업 절차 후에만 V35를 적용한다.
- Claude Code 변경: frontend/src, frontend/tests/ui. 변경 금지: V1~V34, 기존 API의 기존 필드·동작, PROJECT_CONTEXT.md, 서로의 영역.
- **프런트 단계**: ⓐ(백엔드 없이 가능) 메인의 "간이판" — 기존 `/api/public/episodes`로 최신 공개 회차 카드만 보이는 `/`와 footer, 헬스 체크의 `/status` 이동 ⓑ 백엔드 ①~③ 이후 홈 API·작품 상세·뷰어 보강·운영자 작품 관리로 교체·확장. ⓐ는 ⓑ에서 홈 API 응답으로 대체되며 홈 API 실패 시의 대체 화면으로 남긴다.
- 테스트: 28.5 표(Codex), frontend는 28.6 전부(메인 섹션별 표시·비어 있음·오류·장르 탭 지연 호출, 배너 이동·자동 넘김 없음, 작품 상세 정렬·이어 읽기, 뷰어의 방향 기본값 우선순위·작품 안 이웃·조회수 1회, 운영자 관리의 검증·충돌·장르 한도·표지 로컬 검사·연결 패널)와 기존 회귀·타입·빌드. 연속 2회 통과.
- **실제 브라우저 검증은 최종 1회, 짧게**: 운영자가 작품 생성·표지·장르·배너/추천 설정·회차 연결 → 번역·발행(27절 흐름) → 비로그인 독자가 `/`에서 배너·최신·인기·추천·장르 탭 확인 → 작품 상세에서 회차 선택 → 뷰어(작품 방향 기본값, 이전/다음화, 조회수 증가) → 보류 시 작품·회차가 메인에서 사라짐 → 모바일 폭 확인.

## 29. 식자(TYPESETTER) 역할 — 승인된 번역의 완성 이미지 업로드 (27절 정정) — APPROVED (2026-10-09, 사용자 승인)

작성: Claude Code. 구현: backend=Codex(마이그레이션 V36 포함), frontend=Claude Code. 근거: 사용자 결정(2026-10-09: 번역가는 번역만 하고, 번역을 받아 원본 이미지에 글자를 넣는 **식자**가 따로 있다. B안 = 식자를 새 역할로 추가), DECISIONS.md D-057. 인증·역할·오류 형식은 12·19절, 배정은 15절, 번역·감수는 17·18절, 번역본 이미지와 공개 API는 27절을 따른다. **이 절은 27절의 업로드 주체와 시점만 바꾼다**: 번역본 이미지는 번역 버전에 묶이고, 독자에게는 발행된 버전의 것만 공개하며, 원본 이미지는 노출하지 않는다는 27절의 나머지 규칙은 그대로다. 번역 상태 머신(DRAFT → REVIEW_PENDING → APPROVED/REJECTED → PUBLISHED 등)은 바꾸지 않는다.

### 범위
- 포함: 식자 역할과 데모 계정, 회차별 식자 배정, 승인된 번역의 읽기 전용 열람, 승인된 번역에 대한 번역본 이미지 업로드·교체, 번역가의 번역본 이미지 업로드 폐지, 화면.
- 제외: 식자 결과물에 대한 별도 감수·승인 단계(발행 전에 운영자가 원본과 나란히 확인한다), 식자 완료 상태·알림, 이미지 삭제, 식자가 번역 텍스트를 고치는 기능, 이미지 편집 도구, 발행을 식자 완료에 묶는 규칙(이미지가 없어도 발행할 수 있고 발행 확인 문구가 부족한 페이지 수를 알린다).

### 29.1 흐름
번역가가 번역·제출 → 감수자 승인(`APPROVED`) → **식자가 승인된 번역의 텍스트를 보며 원본 이미지를 바탕으로 만든 완성 이미지를 페이지별로 업로드(교체 가능)** → 운영자가 원본과 번역본 이미지를 나란히 확인하고 발행. 식자는 승인된 번역을 읽기만 하고 고칠 수 없으며, 번역가는 번역본 이미지를 보지도 올리지도 않는다.

### 29.2 스키마 — V36 (이 마이그레이션만 "파일당 DDL 하나"의 예외: 한 파일에 ALTER TABLE 2개)
- `demo_account`의 역할 CHECK(`chk_demo_role`)와 `episode_assignment`의 역할 CHECK(`ck_assignment_role`)에 `'TYPESETTER'`를 추가한다. 각 테이블을 `ALTER TABLE … DROP CHECK …, ADD CONSTRAINT … CHECK (… IN (기존 값, 'TYPESETTER'))` 한 문장으로 바꾼다(MySQL이 제약 이름을 거부하면 보고하고 멈춘다). 새 테이블·컬럼은 없고, 기존 행·NOT NULL 규칙·V1~V35는 바뀌지 않는다. 이름이 계약과 다르면 실제 이름을 확인해 쓰고 보고한다.

### 29.3 인증·계정
- 역할 값 `TYPESETTER`를 추가한다(로그인·`/api/auth/me` 응답의 `role`). 운영자가 다른 역할의 권한을 자동으로 갖지 않는 기존 규칙과 서버가 매번 DB에서 권한·배정·상태를 확인하는 규칙은 같다.
- 데모 계정 `demo.typesetter`(표시 이름 "데모 식자")를 DemoAuth 시드에 추가한다. 비밀번호는 환경변수 `DEMO_TYPESETTER_PASSWORD`로만 주입하고 저장소·문서·로그·채팅에 쓰지 않는다. **`DEMO_TYPESETTER_PASSWORD`가 없으면 기존 4개 계정만 시드하고 식자 계정은 만들지 않는다**(기존 시드 호출과 호환). 기존 계정은 덮어쓰지 않는다.

### 29.4 배정 (15절의 가산적 변경)
- `GET /api/episodes/{id}/assignments` 응답에 `"typesetter"` 슬롯을 더한다(`translator`·`reviewer`와 같은 형식, 없으면 `null`). `PUT /api/episodes/{id}/assignments/typesetter` {"accountId"}는 translator·reviewer와 같은 규칙(후보는 role=TYPESETTER 계정, 같은 계정이면 `changed:false`, 교체하면 이전 식자는 즉시 접근 불가 404, `ASSIGNED` 감사 이벤트 재사용). `GET /api/assignable-accounts?role=TYPESETTER`를 허용한다(그 밖의 값은 기존대로 400).
- `GET /api/my/episodes`·`GET /api/my/episodes/{id}`는 TYPESETTER에게도 배정된 회차를 같은 형식으로 돌려준다(`assignedRole":"TYPESETTER"`). 미배정·교체된 이전 식자는 404(D-038).
- 기존 필드·동작은 바꾸지 않는다. 응답에 `typesetter`가 늘어나는 것은 가산적이다.

### 29.5 식자 API (TYPESETTER 전용·그 회차에 현재 배정된 경우만, 그 밖의 역할 403, 비로그인 401, 미배정·없는 회차 404, `Cache-Control: no-store`)
| API | 응답 |
|---|---|
| GET /api/my/episodes/{id}/typesetting | 200 {"items":[{"versionNo","sourceVersion","decidedAt"}]} — 상태가 `APPROVED`인 번역 버전만, versionNo 내림차순. 없으면 빈 배열 |
| GET /api/my/episodes/{id}/typesetting/{versionNo} | 200 {"versionNo","sourceVersion","blocks":[{"seq","pageNo","source","text"}]} — 읽기 전용. 그 버전이 `APPROVED`가 아니거나 없으면 404 |
| GET /api/my/episodes/{id}/pages, …/pages/{pageNo}/image | 원본 이미지 열람(26절)에 TYPESETTER를 더한다(GET만) |
| PUT /api/my/episodes/{id}/translations/{versionNo}/page-images/{pageNo} | **27.2 정정**: 업로드는 **TYPESETTER만**(번역가 PUT은 403). 버전이 **`APPROVED`일 때만** 저장·교체하고 그 밖(DRAFT·REVIEW_PENDING·REJECTED·PUBLISHED·INVALIDATED·ON_HOLD)은 409 STATE_CONFLICT(`currentStatus` 포함). 검증(허용 3종·1 B~5 MiB·시작 바이트·원문 버전에 있는 페이지)과 응답(201/200, 메타)은 27.2와 같다. 감사 `TRANSLATION_PAGE_IMAGE_SAVED`(actor=식자)는 같은 트랜잭션 |
| GET /api/my/episodes/{id}/translations/{versionNo}/page-images, …/{pageNo} | **27.2 정정**: **REVIEWER와 TYPESETTER만**(번역가 403). REVIEWER는 18절에서 보이는 상태(`REVIEW_PENDING`·`APPROVED`·`REJECTED`)의 버전만, TYPESETTER는 `APPROVED`만, 그 밖은 404 |
- 운영자 `GET /api/episodes/{id}/translations/{versionNo}/page-images[/{pageNo}]`와 공개 API(27.2)는 바뀌지 않는다. 발행된 버전은 어떤 역할도 수정할 수 없다(발행 이후·무효화 이후 PUT은 409).
- 보안 규칙 순서: `/api/my/episodes/*/typesetting/**`는 TYPESETTER 전용, `/api/my/episodes/*/translations/*/page-images/**`의 PUT은 TYPESETTER 전용·GET은 REVIEWER·TYPESETTER이며 둘 다 기존 번역가 전용 규칙(`/api/my/episodes/*/translations/**`)과 감수자 규칙보다 **먼저** 평가되어야 한다.
- 이력(24절): 새 이벤트는 없다. `TRANSLATION_PAGE_IMAGE_SAVED`의 주체가 식자일 뿐이다.

### 29.6 프런트 계약 (Claude Code)
- **식자 메뉴** `/typeset`(배정된 회차 목록: 제목, 승인된 번역이 있는지, 번역본 이미지가 몇 페이지 올라가 있는지)와 `/typeset/{id}`. 상세는 승인된 번역 버전 선택(여럿이면 최신 기본), **페이지 단위**(26.4의 페이지 이동 바)로 왼쪽에 **원본 이미지**, 오른쪽에 그 페이지의 **원문과 승인된 번역(읽기 전용)**, 그 아래에 **번역본 이미지 미리보기와 업로드·교체**(허용 3종·5 MiB·시작 바이트를 로컬에서 먼저 검사, 중복 방지, 고정 오류 문구). 승인된 번역이 없으면 "승인된 번역이 아직 없습니다" 안내와 업로드 없음. 번역본 이미지 진행 "N/M 페이지".
- **번역가 화면**: 번역본 이미지 칸·업로드 없음(원본 이미지 왼쪽, 번역 블록 오른쪽 — 이미 반영). **감수자 화면**: 번역본 이미지가 있으면 읽기 전용으로 보인다(승인 뒤에 올라오므로 대개 없다).
- **운영자**: 회차 상세의 담당자 배정 패널에 **식자** 슬롯을 더하고(후보는 식자 계정), 번역 현황의 읽기 전용 원본/번역본 확인과 발행 확인 문구는 그대로다. 역할 안내·메뉴·헤더·데모 계정 목록·역할별 "내 할 일" 카드(식자: 승인된 번역이 있고 번역본 이미지가 부족한 회차 수)에 식자를 더한다.
- 번역본 이미지 업로드 컨트롤(27.4)은 식자 화면으로 옮겨 재사용한다. 데모 스크립트(`scripts/seed-demo-data.mjs`, `scripts/replace-demo-images.mjs`)와 `DEMO_SCRIPT.md`는 식자 계정으로 올리도록 고친다(`DEMO_TYPESETTER_PASSWORD` 추가).

### 29.7 파일 소유권·테스트·완료 조건
- Codex 변경: `backend/src/main/resources/db/migration/V36__…`, backend/src/main(auth 역할·시드, assignment, translatedpage 규칙, 보안 규칙 순서, 새 식자 읽기 API), backend/src/test, README 검증 기록.
  - **기존 통합 테스트는 수정 없이 통과해야 한다. 단, 이 절이 직접 바꾸는 것만 허용**: ① 27절에서 만든 `TranslationPageIntegrationTest`(와 `TranslationPageBodyLimitTest`)는 번역가 업로드·DRAFT 기준에서 식자 업로드·`APPROVED` 기준으로 **다시 쓴다**(공개 API·운영자 열람·감사·검증 테스트는 의미를 유지), ② `MySqlIntegrationTest`의 최신 마이그레이션 버전 35→36(새 테이블 없음), `DomainSchemaMigrationIntegrationTest`의 전체 적용·이력 수 35→36과 V9 업그레이드 적용 수 +1, ③ 배정·계정·역할 매트릭스를 단언하는 기존 테스트에서 TYPESETTER 행·`typesetter` 응답 필드를 더하는 **가산적** 갱신. 단언의 의미를 바꾸는 수정은 금지이고, 변경한 파일·테스트명·사유 목록을 보고한다. 이 범위 밖의 기존 테스트가 깨지면 멈춰 보고한다.
  - 개발 DB(3306)에는 승인·백업 후에만 V36을 적용하고, 데모 식자 계정 시드는 사용자가 비밀번호를 환경변수로 주입해 따로 실행한다.
- Claude Code 변경: frontend/src, frontend/tests/ui, scripts, DEMO_SCRIPT.md, STATUS.md. 변경 금지: V1~V35, 기존 API의 기존 필드·동작(29.4·29.5가 명시한 것 제외), PROJECT_CONTEXT.md, 서로의 영역.
- 필수 테스트(Codex): 식자 배정·교체(이전 식자 404)·후보 목록·`my/episodes` 노출, 식자 읽기 API(승인 버전만, 읽기 전용, 미배정 404, 역할 매트릭스), 업로드 규칙(식자만·`APPROVED`만, 번역가·감수자·운영자·독자 403, 다른 상태 409, 검증·5 MiB 경계·불일치 400, 미배정·이전 식자 404, 감사 1건), 열람 규칙(감수자는 기존 가시 상태에서 허용, 식자는 APPROVED만 허용, 번역가 403, 운영자·독자 기존 규칙, 감수자의 PUT 403), 발행 후·무효화 후 업로드 409, 공개 API·보류·원본 비노출 불변(27.3), 스키마(역할 CHECK에 식자 허용·그 밖의 값 거부, 기존 행 불변), 시드(`DEMO_TYPESETTER_PASSWORD` 있을 때만 식자 계정, 기존 계정 보존).
- 필수 테스트(프런트): 식자 목록·상세(왼쪽 원본·오른쪽 번역, 승인 없음 안내, 업로드·교체·로컬 검사·오류 문구·중복 방지), 번역가·감수자 화면의 변경, 운영자 배정 패널의 식자 슬롯, 역할 안내·메뉴·카드, 기존 회귀·타입·빌드. 연속 2회 통과.
- **실제 브라우저 검증은 한 번, 짧게**: 운영자가 식자 배정 → 번역가 번역·제출 → 감수자 승인 → 식자가 승인된 번역을 보며 번역본 이미지 업로드 → 운영자가 원본과 나란히 확인·발행 → 독자가 뷰어에서 읽기 → 번역가는 번역본 이미지를 볼 수 없음·승인 전 식자는 업로드 불가.

## 30. 내 서재·마이페이지·작품 찾기·다크 모드 (프런트 전용) — APPROVED (2026-10-13, 사용자 요청 승인)

작성·구현: Claude Code(프런트만). 근거: 사용자 결정(2026-10-13, "내 서재, 마이페이지, 작품 제목 검색, 다크 모드 전환"), DECISIONS.md D-059. **백엔드·DB·API는 바꾸지 않는다.** 개인 데이터는 모두 **이 브라우저에만** 저장하며 계정·서버와 연결되지 않는다(서버에 북마크·기록을 두는 "관심" 기능은 계속 범위 밖). 공개 화면이 로그인 상태·역할에 따라 달라지지 않는 규칙(23.3·27.4)은 그대로이고, 로그인 상태를 보여 주는 곳은 마이페이지의 "계정" 영역 하나뿐이다.

### 30.1 브라우저 저장(`localStorage`, 모든 읽기·쓰기는 예외를 무시하고 막혀도 화면이 동작한다)
| 키 | 내용 | 한도 |
|---|---|---|
| `mangabridge.library.v1` | 내 서재: [{workId, addedAt}] 최신순 | 200개 |
| `mangabridge.recent.v1` | 최근 본 회차: [{episodeId, title, workId\|null, workTitle\|null, episodeNo\|null, readAt}] 최신순, 같은 회차는 하나로 합친다 | 20개 |
| `mangabridge.theme.v1` | `"light"` 또는 `"dark"` (없으면 라이트) | - |
기존 키(`mangabridge.viewer.settings.v1` 등)는 바꾸지 않고 마이페이지에서 같은 값을 읽고 쓴다. 최근 본 회차는 뷰어와 텍스트 리더가 회차를 연 뒤에(회차 응답 성공 후) 기록한다.

### 30.2 화면
> **정정(D-061, 2026-10-13)**: 아래 "메인의 히어로 아래 검색 입력"은 **헤더(공개·로그인 후 공통)의 검색 입력**으로 바뀐다(`/works?q=`). 메인에는 검색 입력을 두지 않는다.

> **정정(D-063, 2026-10-13): 헤더는 프로필 팝업을 쓴다.** 헤더(공개·로그인 후 공통)의 링크는 작품·랭킹·회차 목록·작업 공간(로그인 후에는 역할별 메뉴)과 검색창("홈" 링크는 없다: 로고가 홈이다), **프로필 버튼**이다. 내 서재·마이페이지·로그인·로그아웃·테마 버튼은 헤더에서 빼고 프로필 버튼을 눌러 여는 **팝업**(열림/닫힘은 `aria-expanded`, Esc·바깥 클릭으로 닫힘)에 둔다. 팝업의 내용: ① 계정(로그인하지 않았으면 "로그인" 링크, 로그인했으면 서버가 확인한 이름·역할과 "작업 공간"·"로그아웃") ② 마이페이지(내 서재 포함)·결제 내역·설정 링크 ③ 다크/라이트 모드 전환. **내 서재는 마이페이지 안의 영역**으로 들어가고(`/library` 주소는 그대로 열린다), 공개 화면은 이제 이 팝업에서 로그인 상태를 보인다(토큰이 있을 때만 `/api/auth/me`를 호출, 23.3·27.4의 "공개 화면은 로그인 상태에 따라 달라지지 않는다"를 이 팝업에 한해 대체).
> - **결제 내역 `/payments`**: 유료 기능이 아직 없어 목록이 없다. "결제 내역이 없습니다" 안내만 보이며 가짜 내역을 만들지 않는다(28절의 결제 제외는 그대로).
> - **설정 `/settings`**: 로그인 계정(서버 정보, 읽기 전용)과 **내 정보** 편집(표시 이름 최대 20자, 한 줄 소개 최대 100자, 공백 정리·제어문자 거부). 내 정보는 `localStorage` 키 `mangabridge.profile.v1`에만 저장하고 서버로 보내지 않으며, 로그인하지 않았을 때 프로필 버튼의 글자로 쓴다. 서버 계정(이름·역할) 수정과 비밀번호 변경은 범위 밖이다.
- **헤더(공개·로그인 후 공통)**: 링크 홈·작품·회차 목록·내 서재·마이페이지·작업 공간과 **테마 전환 버튼**(`aria-pressed`, 문구 "다크 모드"/"라이트 모드"). 테마는 `<html data-bs-theme>`로 적용하고, 첫 화면이 깜빡이지 않게 저장된 값을 렌더 전에 적용한다. 기본은 라이트이며 시스템 설정을 따르지 않는다.
- **작품 찾기 `/works`** (공개): 제목·작가 검색 입력(대소문자 무시 부분 일치), 장르 칩(전체 + 고정 10개), 정렬(최신·인기). 서버의 `GET /api/public/works`(limit 50)를 페이지별로 모두 불러와(최대 200개) 제목·작가는 화면에서 거른다. 검색어·장르·정렬은 주소(`?q=&genre=&sort=`)에 반영한다. 결과 수, 빈 결과 안내, 불러오기 실패와 재시도를 보인다. 메인의 히어로 아래에 검색 입력을 두어 `/works?q=`로 보낸다.
- **내 서재 `/library`** (공개): 북마크한 작품을 카드로 보인다(공개 작품 상세를 id별로 조회, 동시에 최대 4개). 더 이상 공개되지 않은 작품은 "공개되지 않은 작품"으로 보이고 서재에서 뺄 수 있다. 비어 있으면 안내와 `/works` 링크. 작품 카드와 작품 상세에 **하트 버튼**(`aria-pressed`, "내 서재에 담기/빼기")을 둔다. 하트는 카드 링크 바깥에 있어 링크 안에 버튼이 들어가지 않는다.
- **메인 `/` 보강**: 히어로 아래 검색 입력, 최근 본 회차가 있으면 "이어 읽기" 섹션(최근 4개, 없으면 섹션을 감춘다).
- **마이페이지 `/my`** (공개 주소, 독립된 영역들): ① **계정**: 토큰이 있으면 서버가 확인한 이름·역할, "작업 공간" 링크, 로그아웃(없으면 로그인 안내) — 이 영역만 로그인 상태를 쓴다 ② **내 서재 요약**(개수와 링크) ③ **최근 본 회차** 목록과 "기록 지우기" ④ **읽기 설정**(보기 방식·쪽 수·읽기 방향, 뷰어 설정과 같은 값) ⑤ **화면 테마**(라이트/다크) ⑥ **내 기록 지우기**(서재와 최근 본 회차, 확인 단계 후).

### 30.3 다크 모드 규칙
- 색은 변수로 바꾼다: 바탕 `#161616`·카드 `#1f1f1f`·테두리 `#333`·글자 `#f1f1ef`, 라임 강조는 그대로이며 링크·브랜드 글자는 라임 계열로 바꿔 어두운 바탕에서 4.5:1 이상을 지킨다. 라이트에서 쓰던 고정 색(보조 글자, 위험·성공 글자, 윤곽선 버튼, 장르 태그, 표 강조, 알림 상자)은 다크 값을 따로 둔다. 만화 뷰어는 라이트에서도 어두우므로 그대로 둔다.
- 기본값 라이트는 바뀌지 않는다.

### 30.4 파일 소유권·완료 조건
- 변경: frontend/src, frontend/tests/ui, DEMO_SCRIPT.md, STATUS.md. 변경 금지: backend, 기존 API, 계약 12~29절의 규칙(30.2의 헤더·메인 보강 제외), PROJECT_CONTEXT.md.
- 테스트: 저장소 모듈(손상된 값·한도·막힌 저장소), 하트·서재·최근 기록, `/works` 검색·장르·정렬·주소 반영·실패 재시도, `/library`(비공개 작품·빈 상태·제거), 마이페이지 영역별 동작(계정은 토큰이 있을 때만 서버 호출), 테마 전환과 저장, 기존 회귀·타입·빌드. 연속 2회 통과.
- 접근성(axe)은 **라이트와 다크 모두**에서 점검한다(공개 화면과 업무 화면 대표 페이지).

## 31. 추천과 기간별 랭킹 (주간·월간·연간) — APPROVED (2026-10-13, 사용자 승인)

작성: Claude Code. 구현: backend=Codex(마이그레이션 V37 포함), frontend=Claude Code. 근거: 사용자 요청(2026-10-13, "연간·월간·주간 랭킹", 점수는 추천 수와 조회수를 종합), DECISIONS.md D-060. 인증·역할·오류 형식은 12·19절, 공개 카탈로그와 조회수는 28절을 따른다. **기존 API의 기존 필드·동작은 바꾸지 않는다**(작품 요약에 `recommendCount` 필드만 더한다). 마이그레이션 V37 하나가 있고 새 테이블만 만든다(기존 테이블 변경 없음, 모든 컬럼 NOT NULL).

### 범위
- 포함: 작품 추천(익명 식별자 기준 1표, 취소 가능), 일별 조회수 집계, 기간별 랭킹 API(주간·월간·연간), 메인의 랭킹 섹션과 `/ranking` 화면, 작품 상세의 추천 버튼과 추천 수.
- 제외: 로그인 기반 추천(계정당 1표), 어뷰징 방지(봇·반복 호출·식별자 재생성), 회차 단위 추천, 추천 사유·댓글, 랭킹 순위 변동 표시, 지난 기간(과거 주·달·해)의 고정 랭킹, V37 이전 조회수의 기간 배분(날짜 정보가 없어 랭킹에 들어가지 않는다).

### 31.1 스키마 — V37 (InnoDB·utf8mb4·UTC, 모든 컬럼 NOT NULL; V35와 같은 예외로 **한 파일에 CREATE TABLE 2개**, 기존 테이블 변경 DDL 금지)
- `episode_view_daily`: episode_id BIGINT(FK episode(id)), view_date DATE(UTC 날짜), view_count BIGINT CHECK >= 1, PRIMARY KEY (episode_id, view_date).
- `work_recommend`: work_id BIGINT(FK work(id)), voter_key CHAR(32) CHARACTER SET ascii COLLATE ascii_bin CHECK 소문자 16진수 32자(`REGEXP '^[0-9a-f]{32}$'`), created_at DATETIME(6), PRIMARY KEY (work_id, voter_key). 같은 작품에 같은 식별자는 1행뿐이다.
- 모든 FK는 RESTRICT. V1~V36은 변경하지 않는다.

### 31.2 조회수 기록 변경
- `POST /api/public/episodes/{id}/views`(28.4)는 기존 `episode_view_count`를 올리는 것에 더해 **같은 트랜잭션에서** 오늘(UTC) 날짜의 `episode_view_daily` 행을 만들거나 1 올린다(`INSERT … ON DUPLICATE KEY UPDATE`). 응답·조건(공개 회차만 204, 그 밖은 404)은 그대로다. 두 쓰기 중 하나가 실패하면 둘 다 반영하지 않는다.
- V37 이전의 누적 조회수는 일별 행이 없으므로 기간별 랭킹에 들어가지 않는다(누적 `views`와 28절 `popular`는 그대로).

### 31.3 추천 API (POST 전용·누구나, 인증을 판정하지 않는다)
| API | 요청 | 응답 |
|---|---|---|
| POST /api/public/works/{id}/recommend | {"voterKey":"<소문자 16진수 32자>"} (정확히 이 필드 하나) | 공개 작품이면 200 {"recommended":true,"recommendCount":n}. 이미 추천한 식별자면 **같은 200**(멱등, 행을 늘리지 않는다) |
| POST /api/public/works/{id}/unrecommend | 같음 | 공개 작품이면 200 {"recommended":false,"recommendCount":n}. 추천한 적 없어도 같은 200(멱등) |
- 공개 작품이 아니거나 없거나 id 형식(`^[1-9][0-9]{0,17}$`)이 틀리면 404 NOT_FOUND. 본문이 JSON이 아니거나 필드가 없거나·많거나·`voterKey` 형식이 틀리면 400 INVALID_REQUEST(상세 필드 없음). GET·PUT·PATCH·DELETE는 405.
- `recommendCount`는 그 작품의 전체 추천 행 수이다. 보안 규칙에서 위 두 경로의 POST만 새로 permitAll이고, 그 밖의 `/api/public/**` 쓰기는 기존대로 405이다.
- **의미**: 같은 브라우저(식별자) 1표 이상의 방어는 하지 않는다. 식별자를 새로 만들면 다시 추천할 수 있다(D-060 한계).
- **작품 요약에 `recommendCount` 추가**(28.2 작품 요약, 모든 공개 응답의 요약: home·works·work·rankings). 기존 필드는 그대로이며, 필드 목록을 정확히 비교하는 기존 단언은 이 필드만 추가하는 기계적 변경이 허용된다(변경 목록 보고).

### 31.4 랭킹 API (GET 전용·누구나)
`GET /api/public/rankings?period=week|month|year&limit=` — period 필수, limit 1~50(기본 10). 그 밖의 쿼리·잘못된 값은 400. 응답 200:
`{"period":"week","items":[{…작품 요약, "rank":1,"score":n,"periodViews":n,"periodRecommends":n}]}` — 비어 있어도 200이며 빈 배열.
- **기간(이동 구간, UTC 날짜 기준, 오늘 포함)**: week=오늘 포함 지난 7일, month=30일, year=365일. 조회수는 `episode_view_daily.view_date`가, 추천은 `DATE(work_recommend.created_at)`이 구간 안에 있는 것만 센다.
- **점수** = `periodViews + periodRecommends × 10` (추천 1표 = 조회 10회). periodViews는 그 작품에 **연결된 공개 회차**의 구간 내 조회 합이고, 보류된 회차·공개가 아닌 작품의 값은 넣지 않는다(28.4와 같은 규칙).
- 대상은 공개 작품만이고 **점수가 0인 작품은 제외**한다. 정렬은 score 내림차순, 같으면 latestPublishedAt 내림차순, 같으면 workId 내림차순. `rank`는 정렬 순서대로 1부터 매기며 동점도 순서대로 다른 번호이다.
- 추천을 취소하면 그 추천은 점수에서 빠진다(행이 삭제되므로). 취소했다가 다시 추천하면 새 시각으로 기록된다.

### 31.5 처리 함수와 필수 테스트 (Codex)
| 이름 | 필수 테스트 |
|---|---|
| recordView 확장 | 오늘 행 생성 후 +1 누적, 날짜가 바뀌면 새 행(시각 주입), 미공개·보류·없는 회차 404이고 일별 행도 없음, 두 테이블이 함께 롤백, 기존 누적 동작·응답 불변 |
| recommend / unrecommend | 신규 추천 +1, 같은 식별자 반복은 멱등(수 불변), 다른 식별자는 별도 표, 취소 -1과 반복 취소 멱등, 비공개·보류 시 공개 아님이면 404, id·본문·voterKey 검증 400(미정의 필드·대문자·길이 31/33·비JSON), GET/PUT/DELETE 405, 인증 무관(토큰이 있어도 같은 결과) |
| 랭킹 | 기간 경계(6일 전 포함/7일 전 제외 등 7·30·365 각각, 시각 주입), 점수 공식(조회 + 추천×10), 보류된 회차 조회 제외와 재개 시 복귀, 비공개 작품 제외, 점수 0 제외, 정렬 3단계와 rank 번호, limit 경계 1·50·0·51 → 400, period 누락·잘못된 값·알 수 없는 쿼리 400, 비어 있을 때 200 빈 배열, 인증 무관, V37 이전 누적 조회는 점수에 없음 |
| 작품 요약 | 모든 공개 응답에 `recommendCount`, 값은 추천 행 수와 일치 |
| 스키마 | NOT NULL·CHECK(조회수 ≥1, voterKey 형식)·PK·FK 위반 거부와 정상 허용(실제 MySQL), 기존 NOT NULL lint 통과, V1~V36 불변 |

### 31.6 프런트 계약 (Claude Code)
- **브라우저 저장**(30.1에 추가): `mangabridge.voter.v1` = 소문자 16진수 32자 무작위 식별자(없으면 `crypto.getRandomValues`로 만든다), `mangabridge.recommended.v1` = 추천한 workId 배열(최대 200). 저장소가 막히면 추천 버튼은 그 방문 동안만 동작한다(식별자는 메모리에 둔다).
- **작품 상세**: 제목 옆에 "추천" 버튼(`aria-pressed`, 추천 수 표시, 누르면 `recommend`/`unrecommend` 호출, 응답의 `recommendCount`로 갱신). 중복 클릭 방지, 실패 시 고정 문구와 상태 되돌림. 작품 카드에는 추천 수를 보이기만 한다(버튼 없음).
- **랭킹 `/ranking`** (공개): 탭 3개(주간·월간·연간, 기본 주간, `?period=`를 주소에 반영), 순위 번호와 점수·조회·추천 요약이 붙은 카드 목록, 비어 있음·오류·재시도, 기간 설명("지난 7일 / 30일 / 365일, 조회 1점 · 추천 10점"). 헤더 링크 "랭킹"을 추가한다.
- **메인**: 28.6의 "인기 작품" 섹션을 **랭킹 섹션**(주간·월간·연간 탭, 상위 10)으로 바꾼다. 랭킹이 비어 있거나 실패하면 기존 `popular`(누적 조회)를 그대로 보인다. `/works`는 바뀌지 않는다.
- 테스트: 식별자 생성·저장, 추천 토글·중복 방지·실패 복구, 탭 전환 시 해당 period만 호출, 주소 반영, 비어 있음·재시도, 메인 폴백, 기존 회귀·타입·빌드, 연속 2회 통과. 접근성(axe)은 라이트·다크 모두.

### 31.7 파일 소유권·구현 순서·완료 조건
- Codex 변경: `backend/src/main/resources/db/migration/V37__…`, backend/src/main, backend/src/test, README 기록.
  - **기존 통합 테스트는 수정 없이 통과해야 한다. 단, V37 적용에 따른 기계적 변경만 허용(28.7과 같은 처리)**: 최신 마이그레이션 버전 36→37, 허용 테이블 목록에 `episode_view_daily`·`work_recommend` 추가, 전체 적용·이력 수 +1, V9 업그레이드 적용 수 +1, 작품 요약 필드 목록 단언에 `recommendCount` 추가. 변경한 단언 목록을 보고하고, 이 범위 밖의 기존 테스트가 깨지면 멈춰 보고한다.
  - **정정 2026-10-13 (사용자 승인)**: 기존 통합 테스트의 `@AfterEach` 정리 코드에서, 그 테스트가 만든 episode id에 한해 `episode_view_daily` 행(그리고 같은 이유로 RESTRICT FK에 걸리는 V37 신규 테이블 행)을 회차·작품 삭제 전에 먼저 지우는 변경을 허용한다. 근거: 31.2의 일별 기록과 V37의 RESTRICT FK 때문에 조회 API를 호출한 뒤 회차를 지우는 기존 테스트(`WorkIntegrationTest` 등)의 정리가 거부된다. `WorkIntegrationTest.cleanup()`을 포함해 같은 패턴의 다른 기존 통합 테스트에도 정리 코드 추가만 허용하며, 기존 단언·동작 검증은 바꾸지 않는다. 변경한 정리 코드 위치를 완료 보고에 목록으로 포함한다.
  - **구현 순서(사용량이 부족하면 앞 단계까지 커밋하고 멈춰도 된다)**: ① V37 + recordView 일별 기록 ② 추천·취소 API와 `recommendCount` ③ 랭킹 API. 단계마다 테스트를 통과시키고 커밋한다.
  - 개발 DB(3306)에는 백업과 사용자 확인 후에만 V37을 적용한다.
- Claude Code 변경: frontend/src, frontend/tests/ui, DEMO_SCRIPT.md, STATUS.md. 변경 금지: V1~V36, 기존 API의 기존 필드·동작, PROJECT_CONTEXT.md, 서로의 영역.
- 프런트는 백엔드 ③ 이후 연결한다(그 전에는 모의 응답으로 개발·테스트).
- 실제 브라우저 검증은 격리 스택에서 1회: 조회 기록 후 주간 랭킹에 반영 → 추천 +1·취소 -1과 순위 변화 → 보류한 회차의 조회가 랭킹에서 빠짐 → 탭 전환·메인 폴백 → 라이트·다크 axe.

## 32. 회원가입과 계정 기반 개인 데이터 (독자 계정) — APPROVED (2026-10-13, 사용자 승인)

작성·구현: Claude Code(백엔드와 프런트 모두; Codex 사용량 부족, D-065). 근거: 사용자 결정(2026-10-13, "회원가입과 서버 저장 기능까지", C안), DECISIONS.md D-065. 인증·토큰·오류 형식은 12·19절을 따른다. **기존 API의 기존 필드·동작은 바꾸지 않는다**(공개 추천 API는 로그인 시 계정 기준으로도 동작하도록 확장만 한다). 마이그레이션 V38 하나가 있고 새 테이블만 만든다(기존 테이블 변경 없음, 모든 컬럼 NOT NULL).

### 범위
- 포함: 독자 회원가입(역할 READER 고정), 프로필(표시 이름·소개) 수정, 비밀번호 변경, 계정에 저장되는 내 서재·최근 본 회차·추천, 로그인·가입 시 브라우저 기록 병합, `/signup` 화면과 기존 화면의 서버 연동.
- 제외: 이메일·휴대폰 인증과 비밀번호 찾기(연락처를 받지 않는다), 소셜 로그인, 계정 탈퇴·삭제, 관리자의 계정 관리 화면, 가입 계정에 READER 외 역할 부여(업무 역할은 계속 운영자가 시드로 만든다), 결제.
- 계정이 없는 독자는 지금처럼 **브라우저 저장과 익명 추천**을 그대로 쓴다(30·31절). 로그인한 독자만 서버 저장을 쓴다.

### 32.1 스키마 — V38 (InnoDB·utf8mb4·UTC, 모든 컬럼 NOT NULL; V35·V37과 같은 예외로 **한 파일에 CREATE TABLE 3개**, 기존 테이블 변경 DDL 금지)
- `account_profile`: account_id BIGINT PK(FK demo_account(id)), bio VARCHAR(100)(빈 문자열 허용), updated_at DATETIME(6).
- `account_library`: account_id BIGINT(FK demo_account(id)), work_id BIGINT(FK work(id)), added_at DATETIME(6), PRIMARY KEY (account_id, work_id).
- `account_recent`: account_id BIGINT(FK demo_account(id)), episode_id BIGINT(FK episode(id)), read_at DATETIME(6), PRIMARY KEY (account_id, episode_id).
- 모든 FK는 RESTRICT. V1~V37은 변경하지 않는다. 표시 이름은 기존 `demo_account.display_name`(최대 64자)을 쓰고 가입 시 1~20자로 제한한다.

### 32.2 가입 API (POST 전용·누구나, 로그인 상태를 판정하지 않는다)
`POST /api/auth/register` 본문 `{"loginId","password","displayName"}`(정확히 이 3개, 다른 필드는 400).
| 항목 | 규칙 (어기면 400 INVALID_REQUEST, 상세 필드·사유 없음) |
|---|---|
| loginId | `^[a-z0-9][a-z0-9._-]{3,19}$`(4~20자), **`demo.`로 시작하면 예약어로 거절** |
| password | UTF-8 72바이트 이하, **10자 이상**, loginId를 포함하지 않음, 한 글자만 반복하거나 `1234567890`·`password`·`qwerty` 같은 흔한 값이 아님(고정 목록 20개 안팎), 공백만으로 구성 불가 |
| displayName | trim 후 1~20 코드포인트, 제어문자 불가 |
- 성공: **201** `{"user":{"id","displayName","role":"READER"},"accessToken","tokenType":"Bearer","expiresAt"}`(로그인 응답과 같은 형식; 가입 즉시 로그인). 비밀번호는 기존과 같은 BCrypt(12)로 저장하고 감사 `REGISTER`를 남긴다.
- **409 LOGIN_ID_TAKEN**: 같은 loginId가 이미 있다(대소문자는 소문자만 허용되므로 구분 없음).
- **429 REGISTER_RATE_LIMITED**(+`Retry-After`): **같은 출처 IP당 1시간에 5회, 전체 하루 300회**를 넘으면 거절한다(성공·실패 모두 센다). 카운터는 서버 메모리이며 재시작하면 초기화된다(한계로 명시). IP는 서버 앞의 프록시가 붙이는 `X-Forwarded-For`의 **마지막 값**을 쓴다(없으면 연결 주소). 이 제한은 가입 API에만 적용하며 로그인 제한 없음(D-047)은 유지한다.
- 가입 계정의 역할은 항상 READER이며 업무 API(`/api/episodes`, `/api/works`, `/api/my/**`, `/api/history`, `/api/assignable-accounts`)는 기존 규칙대로 403이다.

### 32.3 내 정보 API (로그인한 모든 역할, 기존 `/api/my/**`와 별개 경로 `/api/me/**`; 비로그인 401)
| API | 요청 | 응답 |
|---|---|---|
| GET /api/me/profile | — | 200 {"loginId","displayName","bio","role"} |
| PATCH /api/me/profile | {"displayName","bio"}(정확히 둘; displayName 1~20자, bio 0~100자, 제어문자는 개행 불가) | 200 {"displayName","bio"} |
| POST /api/me/password | {"currentPassword","newPassword"}(새 값은 32.2 규칙) | 204. 현재 비밀번호가 틀리면 **400 INVALID_CURRENT_PASSWORD**. 성공하면 **이 요청의 토큰을 뺀 그 계정의 다른 토큰을 모두 폐기**한다 |

### 32.4 계정 기반 개인 데이터 API (로그인한 모든 역할, 비로그인 401, 경로의 id는 `^[1-9][0-9]{0,17}$`가 아니면 404)
| API | 규칙 |
|---|---|
| GET /api/me/library | 200 {"items":[{"workId","addedAt"}]} 최신순, 최대 200 |
| PUT /api/me/library/{workId} | **공개 작품이면** 204(멱등, 이미 있으면 그대로), 그 밖은 404. 200개를 넘으면 가장 오래된 것을 지운다 |
| DELETE /api/me/library/{workId} | 204(멱등, 없어도 204) |
| POST /api/me/library/merge | {"workIds":[최대 200개의 id 문자열]} → 공개 작품만 합치고(기존 항목은 유지, 새 항목은 가장 오래된 쪽으로) 200 {"items":[…]}. 잘못된 id는 400 |
| GET /api/me/recent | 200 {"items":[{"episodeId","readAt"}]} 최신순, 최대 20 |
| PUT /api/me/recent/{episodeId} | **공개 회차이면** 204(이미 있으면 읽은 시각만 갱신, 20개 초과 시 가장 오래된 것 삭제), 그 밖은 404 |
| DELETE /api/me/recent | 204(모두 삭제) |
| POST /api/me/recent/merge | {"items":[{"episodeId","readAt"}…최대 20]} → 공개 회차만 합치고 시각 기준 최신 20개만 남겨 200 {"items":[…]} |
| GET /api/me/recommendations | 200 {"workIds":[내가 추천한 공개 작품 id, 최대 200]} |
- 응답에는 제목 등 작품·회차 정보를 넣지 않는다(프런트가 공개 API로 조회한다). 서재·최근 기록은 **그 계정의 것만** 보이며 다른 계정 값은 어떤 경로로도 노출되지 않는다.

### 32.5 추천 API 확장 (31.3과 호환)
- `POST /api/public/works/{id}/recommend`·`/unrecommend`에 **유효한 Bearer 토큰이 있으면** 본문의 `voterKey`를 쓰지 않고(본문은 `{}`이거나 `voterKey`를 포함해도 무시) **계정 기준의 표 하나**로 처리한다. 서버가 `voter_key = SHA-256("acct:" + accountId)`의 앞 32자리 16진수로 `work_recommend`에 기록하므로 새 테이블이 필요 없고, 같은 계정은 여러 기기에서도 작품당 1표이다. 응답은 31.3과 같다. 토큰이 없으면 31.3의 익명 동작 그대로이고, **잘못된 토큰**이 있으면 401이다.
- 로그인·가입 시 프런트가 브라우저의 추천 목록을 계정 표로 옮기는 서버 API는 두지 않는다(프런트가 `recommend`를 작품별로 호출한다, 최대 200).

### 32.6 처리 함수와 필수 테스트 (실제 MySQL)
| 이름 | 필수 테스트 |
|---|---|
| register | 정상 201과 즉시 사용 가능한 토큰, 역할 READER 고정, 각 필드 검증(경계 포함: loginId 3·4·20·21자, `demo.` 예약어, 대문자·공백·한글, 비밀번호 9·10자·72바이트 초과·loginId 포함·흔한 값·공백만, displayName 0·1·20·21자·제어문자), 미정의 필드·본문 없음 400, 중복 409(동시 두 요청 중 하나만 성공), 제한(IP 5/시간, 전체 300/일, 시각 주입, `Retry-After`)과 429, 가입 직후 업무 API 403, 비밀번호 해시가 BCrypt이며 응답·로그·감사에 비밀번호가 없음, 오류 응답 비노출 |
| 프로필·비밀번호 | 조회·수정 검증, 다른 계정 불변, 비밀번호 변경 성공 시 다른 토큰만 폐기·현재 토큰 유지·새 비밀번호로 로그인, 틀린 현재 비밀번호 400, 새 비밀번호 규칙, 비로그인 401 |
| 서재 | 추가·중복·삭제 멱등, 비공개·없는 작품 404, 200개 한도, 계정 간 격리, 병합(중복·비공개·잘못된 id·200개 초과 400), 작품이 비공개로 바뀌면 목록에서 보이지 않거나 조회 시 제외(32.4에서 목록은 저장된 id 그대로이므로 프런트가 공개 API로 걸러 낸다) — 서버는 저장된 행을 돌려준다 |
| 최근 기록 | upsert 시각 갱신, 20개 한도, 삭제, 병합, 보류된 회차 404, 계정 간 격리 |
| 추천 확장 | 로그인 시 계정 표 1개(다른 토큰·다른 기기 동일), 취소, 익명 표와 별개로 센다, 잘못된 토큰 401, 본문 없이도 동작, 기존 익명 테스트 불변 |
| 권한 매트릭스 | `/api/me/**`는 모든 역할 200·비로그인 401, 가입 계정(READER)이 업무 API에서 403 |
| 스키마 | NOT NULL·PK·FK 위반 거부와 정상 허용, 기존 NOT NULL lint 통과, V1~V37 불변 |

### 32.7 프런트 계약
- **`/signup`**: 아이디·표시 이름·비밀번호·비밀번호 확인 입력, 규칙 안내와 실시간 검증(서버와 같은 규칙), 오류(중복·제한·형식) 고정 문구, 중복 제출 방지, 성공하면 자동 로그인 후 `/my`로 이동. 로그인 화면에 "회원가입" 링크를, 가입 화면에 "로그인" 링크를 둔다. 프로필 팝업의 로그인 안내에도 회원가입 링크를 둔다.
- **계정 상태에 따른 저장소 선택**: 로그인하지 않았으면 30절의 브라우저 저장, 로그인했으면 서버 저장(32.4). 로그인·가입 성공 직후 브라우저의 서재·최근 본 회차를 **한 번** 병합 API로 보내고(성공하면 브라우저 값은 지우지 않고 그대로 두되 이후에는 서버 값만 보인다), 추천 목록은 작품별 `recommend` 호출(토큰 포함)로 옮긴다. 서버 호출이 실패하면 화면에 알리고 브라우저 값은 유지한다.
- **마이페이지·설정**: 로그인했으면 설정의 "내 정보"가 서버 프로필(표시 이름·소개)을 수정하고(저장은 `PATCH /api/me/profile`), "비밀번호 변경"을 추가한다. 로그인하지 않았으면 30절과 같이 브라우저 프로필이다. 프로필 버튼의 이름은 로그인 시 서버 표시 이름이다.
- **추천 버튼**: 로그인했으면 토큰을 붙여 계정 표로 보내고, 눌림 상태는 `GET /api/me/recommendations`로 정한다.
- 공개 화면은 계속 로그인 없이 읽을 수 있다(23.3·27.4의 D-063 정정 범위를 넘지 않는다).
- 테스트: 가입 폼 검증·오류·성공 후 이동, 저장소 선택(로그인 유무), 병합 호출과 실패 복구, 프로필 수정, 비밀번호 변경, 추천 계정 표, 기존 회귀·타입·빌드, 연속 2회 통과. 접근성(axe) 라이트·다크.

### 32.8 파일 소유권·구현 순서·완료 조건
- 변경: backend/src(auth, 신규 `me` 패키지, 보안 규칙, 가입 제한 컴포넌트), backend/src/test, V38, frontend/src, frontend/tests/ui, README·STATUS·DEMO_SCRIPT. 변경 금지: V1~V37, 기존 API의 기존 필드·동작, PROJECT_CONTEXT.md.
- **기존 통합 테스트는 수정 없이 통과해야 한다. 단, V38 적용에 따른 기계적 변경만 허용(31.7과 같은 처리)**: 최신 마이그레이션 버전 37→38, 허용 테이블 목록에 `account_profile`·`account_library`·`account_recent` 추가, 전체 적용·이력 수 +1, V9 업그레이드 적용 수 +1, 계정을 만드는 통합 테스트의 정리 코드에 새 테이블 행 삭제 추가(정리 코드 추가만 허용).
- **구현 순서(각 단계마다 테스트를 통과시키고 커밋)**: ① V38 + 가입·제한 + 프로필·비밀번호 ② 서재·최근 기록·병합 ③ 추천 확장과 추천 목록 ④ 프런트(가입 → 저장소 선택·병합 → 프로필·비밀번호·추천) ⑤ 개발 DB V38 적용(백업 후, 사용자 확인) → 클라우드 재배포(Railway는 시작 시 Flyway 자동 적용) → 실제 브라우저 검증.
- 보안 점검 항목: 가입 남용 제한, 비밀번호 비노출, 토큰 폐기, 계정 간 데이터 격리, 응답 비노출을 테스트와 프로브로 확인한다.
- 알려진 한계(STATUS에 기록): 이메일 인증·비밀번호 찾기·탈퇴 없음, 가입 제한은 서버 메모리 카운터라 재시작·다중 서버에서 초기화되거나 분산되고 프록시 헤더 신뢰에 의존, 로그인 시도 제한은 여전히 없음(D-047), 공개 쓰기(조회·익명 추천) 제한 없음.
