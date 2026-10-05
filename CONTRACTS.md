# CONTRACTS.md

관리: ProjectBootstrap·EpisodeSource는 Claude Code, DemoAuth 공통 계약은 Codex / 최종 승인: 사용자
범위: ProjectBootstrap, 승인된 DemoAuth, 13절 EpisodeSource(APPROVED 2026-10-05). 아래 DemoAuth 절은 인증 제외·단일 API·빈 스키마 등 Bootstrap 단계 제한을 해당 기능에 한해 대체한다.
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
