# CONTRACTS.md

관리: Claude Code / Codex는 변경 제안만 가능
범위: ProjectBootstrap (이 문서는 헬스 체크와 기반 설정만 다룬다)
근거: `DECISIONS.md` D-001~D-003, D-006~D-008, D-010~D-012
미결정(계약 대상 아님): D-004 관리형 DB 제품, D-005 백엔드 호스팅 제품, D-009 인증 방식

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
- **타임아웃 설정** (개별 한도이며, 전체 HTTP 응답 시간이 엄밀하게 2초 이내임을 보장하지 않는다):
  - Hikari 연결 획득 타임아웃(`connectionTimeout`): 2초(2000 ms)
  - `SELECT 1` 쿼리 타임아웃: 2초
  - PostgreSQL JDBC 네트워크 관련 타임아웃(`connectTimeout`, `socketTimeout` 등)도 무한대가 아닌 유한한 값으로 설정한다.
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
| `DB_URL` | ✔ | ✔ | JDBC URL. 로컬 예: `jdbc:postgresql://localhost:5432/mangabridge`. 배포 시 SSL 필수 |
| `DB_USERNAME` | ✔ | ✔ | |
| `DB_PASSWORD` | ✔ | ✔ | |
| `CORS_ALLOWED_ORIGINS` | ✔ | | 쉼표 구분 출처 목록. 비어 있거나 `*` 포함 시 기동 실패 |
| `SPRING_PROFILES_ACTIVE` | | | `local` / `prod` |
| `PORT` | | | 기본 8080. 호스팅이 주입하는 값을 따른다 |

### frontend

| 변수 | 필수 | 비밀 | 설명 |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | ✔ | ✘ | Spring API 기본 URL(끝 슬래시 없음). 브라우저에 노출되므로 비밀 금지 |

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
- 루트 `docker-compose.yml` (로컬 PostgreSQL)
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

1. `docker compose up -d`로 로컬 PostgreSQL이 기동한다.
2. 셸 환경변수를 주입한 뒤 `backend`에서 `gradlew.bat bootRun`으로 기동하고, DB 정상 상태에서 Flyway가 `V1__baseline.sql`을 적용한다.
3. DB 정상 상태에서 `GET /api/health`가 200과 계약된 본문을 반환한다.
4. **정상 기동 후** DB 컨테이너를 중지하면 `GET /api/health`가 503 `db:"DOWN"`을 반환하고, 서버는 종료되지 않으며, DB 재기동 후 다시 200이 된다. (시작 시 DB 불가 상태에서의 기동은 요구하지 않는다.)
5. `frontend`에서 `npm run dev`로 기동하고 `NEXT_PUBLIC_API_BASE_URL`을 사용해 헬스 상태(UP/DOWN)를 화면에 표시한다.
6. `http://localhost:3000`에서 헬스 체크 호출이 CORS로 통과하고, 허용 목록에 없는 출처는 403이다.
7. `frontend`의 `npm run build`와 `backend`의 `./gradlew build`(테스트 포함)가 성공한다.
8. 저장소에 비밀값이 없고, `.env.example`만으로 로컬 환경을 재현할 수 있다.
9. 응답·로그에 4절의 비노출 항목이 없다.

## 9. 배포 완료 조건 (D-004, D-005 확정 후에만 진행)

선행: D-004(관리형 PostgreSQL 제품), D-005(백엔드 호스팅 제품) 확정. 그 전에는 이 절의 작업을 시작하지 않는다.

백엔드 호스팅이 만족해야 할 요구 조건:
- 상시 Java 17 프로세스 실행, HTTPS 공개 URL
- `PORT`와 5절 환경변수 주입
- 헬스 체크 경로로 `/api/health` 지정 가능
- 관리형 PostgreSQL로의 아웃바운드 접속
- 로컬 파일을 영속 저장소로 사용하지 않음
- 무료 티어 슬립 정책 확인 및 시연 전 워밍업 절차 정의

완료 조건:
1. 관리형 PostgreSQL에 Flyway 마이그레이션이 적용된다(풀러 사용 시 direct 연결로 실행).
2. 배포된 Spring의 `GET /api/health`가 HTTPS로 200을 반환한다.
3. Vercel(Root Directory `frontend`, Node 24)에 프런트가 배포되고 `NEXT_PUBLIC_API_BASE_URL`이 배포된 Spring URL을 가리킨다.
4. 배포된 프런트 화면에서 헬스 UP이 표시된다(브라우저 CORS 통과).
5. Vercel Production 도메인만 `CORS_ALLOWED_ORIGINS`에 포함되어 있고, 그 외 출처는 403이다.
6. 배포 환경 변수와 로그에 비밀값이 노출되지 않는다.
- 배포 환경변수 입력, 계정 연결, 도메인 설정은 프로젝트 책임자가 수행하거나 명시적으로 승인한 뒤 진행한다.

## 10. 필수 테스트

백엔드(자동):
1. **헬스 200**: 테스트용 PostgreSQL(Testcontainers 또는 로컬 Docker DB)에서 200과 본문 필드 3개, `status=UP`, `db=UP`, `time`이 UTC ISO-8601인지 확인.
2. **헬스 503**: DB 불가 상태에서 503, `db=DOWN`, `status=UP` 확인.
3. **타임아웃**: Hikari 연결 획득(2초)·쿼리(2초)·JDBC 네트워크 타임아웃이 유한한 값으로 설정되어 있는지 확인하고, DB 접속 불가 또는 지연 시 요청이 무한 대기하지 않고 유한한 시간 안에 503을 반환하는지 확인(전체 응답 시간이 2초 이내라는 단정은 하지 않는다).
4. **비노출**: 정상·실패 응답 본문에 `jdbc:`, DB 호스트명, 사용자명, `Exception`, 프레임워크 버전 문자열이 없는지 검사.
5. **캐시 없음**: 연속 호출 시 매번 DB 확인이 수행되고(DB 상태 변화가 즉시 반영) `Cache-Control: no-store`가 있다.
6. **CORS**: 허용 출처 요청은 통과 + `Access-Control-Allow-Origin` 일치, 비허용 출처는 403, preflight 동작, `Origin` 없는 요청은 통과.
7. **CORS 설정 검증**: `CORS_ALLOWED_ORIGINS`가 비었거나 `*`를 포함하면 기동 실패.
8. **Flyway**: 빈 DB에서 `V1__baseline.sql` 적용 후 기동 성공. (시작 시 DB 불가로 기동이 실패하는 것은 허용되며 테스트 대상이 아니다.)
8-1. **HEAD/메서드**: `HEAD /api/health`는 본문 없이 `GET`과 같은 상태 코드, `POST`/`PUT`/`PATCH`/`DELETE`는 405(허용 `Origin` 또는 `Origin` 없음 기준), 비허용 `Origin`의 요청은 403.
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
2. `backend`: Java 17, Spring Boot 3.5.x 최신 안정 패치(구현 시 확인 후 고정), Gradle Wrapper. 의존성은 `spring-boot-starter-web`, `spring-boot-starter-jdbc`, PostgreSQL 드라이버, `flyway-core`와 `flyway-database-postgresql`, 테스트 의존성. JPA와 actuator는 넣지 않는다.
3. `HealthController`로 `GET /api/health`를 2절~4절대로 구현한다(`GET`, `OPTIONS`, 기본 `HEAD`는 본문 없음, 변경 메서드는 405). DB 확인은 `SELECT 1`이며 Hikari 연결 획득 타임아웃 2초, 쿼리 타임아웃 2초, JDBC 네트워크 타임아웃은 유한한 값으로 설정한다. 정상 기동 후 DB 실패 시 예외를 밖으로 내지 않고 503을 반환한다. 시작 시 DB 불가로 인한 기동 실패는 허용되며 이를 우회하는 코드를 추가하지 않는다. 전체 응답 시간이 2초 이내라고 단정하지 않는다.
4. 6절대로 CORS를 구성한다. `CORS_ALLOWED_ORIGINS` 검증(빈 값·`*` 거부)을 포함한다.
5. 5절의 환경변수를 `application.yml`에서 읽는다. 기본값에 비밀값을 넣지 않는다. 4절의 `server.error.include-*` 설정 4개를 적용한다. Spring Boot가 `.env`를 자동으로 읽는다고 가정하지 않는다.
6. `db/migration/V1__baseline.sql`은 빈 기준선으로 둔다(도메인 테이블 금지). `ddl-auto` 등 자동 스키마 생성은 사용하지 않는다.
7. 루트 `docker-compose.yml`로 로컬 PostgreSQL을 제공하고, `.env.example`에는 로컬 개발용 값만 둔다. 작업 시작 시 Docker CLI 설치 여부와 데몬 실행 상태를 확인한다. 없거나 실행 중이 아니면 자동 설치하지 말고 보고한다.
7-1. 루트에서 `git init`을 수행하고(Codex 담당) 작은 단위로 로컬 커밋한다. 원격 저장소 생성·연결, `git push`, `git reset`, 기존 파일 삭제는 하지 않는다.
7-2. `README.md`에 Windows PowerShell 기준으로 (a) Docker Compose의 `.env` 처리와 (b) Spring 실행용 환경변수 주입(`$env:...` 후 `gradlew.bat bootRun`)을 구분해 재현 가능한 절차로 쓴다.
8. `frontend`: Next.js 안정 버전, App Router, TypeScript, Node 24. 의존성은 `next`, `react`, `react-dom`과 TS 타입 패키지만. `src/lib/api.ts`에 `NEXT_PUBLIC_API_BASE_URL` 기반 호출 래퍼를 두고, 첫 화면에서 헬스 상태(UP/DOWN/오류)를 표시한다.
9. 10절의 자동 테스트를 작성하고, 8절의 로컬 완료 조건을 직접 실행해 결과를 보고한다.
10. `.gitignore`에 `.env*`(`.env.example` 제외), 빌드 산출물, `node_modules`, Gradle 산출물을 포함한다.
11. `README.md`에는 로컬 실행·테스트 방법만 쓴다.

**금지**
- 문서 3종 수정, 도메인 테이블·API·인증 코드 추가, 와일드카드 CORS, 비밀값 커밋, UI·스타일 라이브러리 추가, 배포 작업(Vercel·호스팅·관리형 DB 접속).
- 기존 파일 삭제, `git reset`, 원격 저장소 생성·연결, `git push`, Docker 자동 설치.
- 계약과 어긋나는 상황(예: 버전 호환 문제, 요구 변경)이 생기면 우회하지 말고 구현을 멈추고 변경 제안을 보고한다.

**보고 형식**: 변경 파일 목록, 확정한 버전, **실제 적용한 타임아웃 설정(키·값·단위)**, Docker CLI/데몬 확인 결과, 8절 각 항목의 실행 결과(통과/실패/미검증과 실제 명령), 10절 테스트 결과, 계약 변경 제안 여부.
