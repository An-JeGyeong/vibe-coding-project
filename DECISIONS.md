# DECISIONS.md

관리: Claude Code / 최종 승인: 프로젝트 책임자
DemoAuth 공통 문서 담당: Codex (사용자 승인, 2026-10-05)
상태 표기: PROPOSED(승인 대기) · APPROVED · UNDECIDED(미결정 유지) · REJECTED

## ProjectBootstrap

승인일: 2026-10-05

### D-001 저장소 구조 — APPROVED
- `frontend/`, `backend/` 구조의 모노레포. 워크스페이스 도구(Turborepo 등)는 쓰지 않는다.
- Vercel Root Directory는 `frontend`.

### D-002 Spring Boot / Java 버전 — APPROVED
- Java 17, Spring Boot 3.5.x 최신 안정 패치, 빌드는 Gradle Wrapper(`gradlew`).
- 정확한 패치 버전은 구현 시작 시 확인해 고정한다.

### D-003 Next.js 버전 — APPROVED
- Next.js 안정 버전, App Router, TypeScript, Node 24.
- 의존성은 `next`, `react`, `react-dom`(+ TypeScript 타입 패키지)만. UI 키트와 스타일 라이브러리는 확정하지 않는다.

### D-004 관리형 DB 제품 — UNDECIDED (엔진은 D-018로 PostgreSQL → MySQL 변경)
- 미결정 유지. 대상 엔진은 D-018에 따라 **관리형 MySQL**이다.
- 선정 기준(갱신): 무료 티어, JDBC 직접 접속, TLS 필수(`VERIFY_IDENTITY` 가능, D-019), **MySQL 8.4 LTS 제공 여부**(제공하지 않으면 8.0 등 대체 버전 허용 여부를 별도 결정), 앱 전용 계정 생성 가능.
- (이력) 이전 기준 "SSL 필수, 풀러 사용 시 마이그레이션은 direct 연결"은 PostgreSQL 기준이었으며 D-018로 대체됨.
- 로컬 완료 기준과 배포 완료 기준을 분리했으므로 로컬 구현은 이 결정에 의존하지 않는다.

### D-005 Spring 백엔드 호스팅 제품 — UNDECIDED
- 미결정 유지. 요구 조건은 `CONTRACTS.md` 9절 참고.
- 로컬 구현은 이 결정에 의존하지 않는다.

### D-006 DB 마이그레이션 — APPROVED
- Flyway SQL 마이그레이션(`db/migration/V{n}__*.sql`). 스키마 자동 생성 금지.

### D-007 데이터 접근 — APPROVED
- ProjectBootstrap에서는 JPA를 도입하지 않고 Spring JDBC를 사용한다.
- 도메인 노드에서의 JPA 도입 여부는 해당 노드에서 별도 결정한다.

### D-008 프런트엔드의 API 호출 — APPROVED
- 브라우저가 `NEXT_PUBLIC_API_BASE_URL`을 이용해 Spring API를 직접 호출한다.

### D-009 인증 방식 — SUPERSEDED by D-020 (DemoAuth)
- 미결정 유지. ProjectBootstrap에서는 인증 없이 `/api/health`만 공개한다.

### D-010 CORS — APPROVED
- 환경변수 기반 명시적 허용 출처 목록. 와일드카드 금지.

### D-011 로컬 개발 DB — SUPERSEDED by D-018 (엔진 부분)
- (이력) Docker PostgreSQL. D-004 미결정과 무관하게 로컬 개발에 사용.
- "로컬은 Docker DB를 쓴다"는 원칙은 유지되며, 엔진만 D-018에 따라 MySQL로 대체되었다.

### D-012 헬스 체크 계약 — APPROVED
- `GET /api/health`. 인증·역할 검사 없음, 상태 변경·감사 기록 없음.
- DB에 `SELECT 1` 실행. DB 정상 시 200 `{status:UP, db:UP, time}`, 실패 시 503 `{status:UP, db:DOWN, time}`.
- `time`은 UTC ISO-8601. 결과 캐시 없음, `Cache-Control: no-store`.
- 연결 문자열, 호스트명, 내부 예외, 프레임워크 버전은 응답하지 않는다.
- 지원 메서드: `GET`, `OPTIONS`, Spring MVC 기본 `HEAD`(본문 없음). 변경 메서드는 405. 허용되지 않은 `Origin`은 CORS 거부가 먼저 적용되어 403일 수 있다.
- 상세 계약은 `CONTRACTS.md` 참고.

### D-013 DB 타임아웃 — APPROVED (D-012의 "2초" 규정을 대체)
- Hikari 연결 획득 타임아웃 2초, `SELECT 1` 쿼리 타임아웃 2초, JDBC 네트워크 타임아웃은 유한한 값.
- (D-018 보완) 드라이버가 MySQL Connector/J로 바뀌어 `connectTimeout`·`socketTimeout`은 **밀리초** 단위다. 원칙(유한한 값)은 그대로이며 구체 값은 D-019에서 승인되었다(`connectTimeout=2000`, `socketTimeout=3000`).
- 전체 HTTP 응답 시간이 엄밀하게 2초 이내라고 보장하지 않는다.
- 실제 적용 설정과 단위는 구현 후 보고한다.

### D-014 기동·장애 동작 — APPROVED
- DB 정상 시 Flyway 적용과 기동 성공. 정상 기동 후 DB 장애 시 `/api/health` 503.
- 시작 시 DB 불가로 Flyway가 실패해 기동이 실패하는 것은 허용한다. DB 없이 기동해야 한다는 요구는 두지 않는다.

### D-015 CORS·오류·구성 세부 — APPROVED
- 허용 요청 헤더 `Content-Type`, `credentials=false`(D-009 확정 전까지).
- 비허용 `Origin` 403, `Origin` 없는 요청 허용.
- `CORS_ALLOWED_ORIGINS`가 비어 있거나 `*` 포함 시 기동 실패.
- 자체 `HealthController` 사용, actuator 제외.
- `server.error.include-message=never`, `include-stacktrace=never`, `include-binding-errors=never`, `include-exception=false`.
- 예시 파일에는 로컬 전용 개발 자격증명만 기록한다.

### D-016 환경변수 주입 — APPROVED
- Spring Boot가 `.env`를 자동으로 읽는다고 가정하지 않는다. Docker Compose의 `.env` 처리와 Spring 실행 환경을 구분한다.
- README에 Windows PowerShell 환경변수 주입 + Gradle Wrapper 실행 절차를 요구한다.

### D-017 Docker·Git 작업 — APPROVED
- Codex가 Docker CLI 설치 여부와 데몬 상태를 확인한다. 없거나 실행 중이 아니면 자동 설치하지 않고 보고한다.
- `git init`과 로컬 커밋은 Codex 담당. 원격 저장소 생성·push, `git reset`, 기존 파일 삭제는 금지.

### D-018 DB 엔진 변경: PostgreSQL → MySQL — APPROVED
- 변경 이유: MVP가 PostgreSQL 전용 기능을 쓰지 않으며 MySQL로도 필요한 트랜잭션·제약조건·버전 관리를 구현할 수 있다. 구현 전에 DB 구성을 통일한다.
- 승인: MySQL 8.4 LTS, InnoDB, utf8mb4, Spring JDBC 유지(D-007), Flyway 유지(D-006), MySQL Connector/J, 선택한 Flyway 버전과 호환되는 `flyway-mysql`, 로컬 Docker MySQL.
- 관리형 MySQL 제품(D-004)과 Spring 호스팅 제품(D-005)은 미결정 유지.
- 기존 API와 업무 규칙은 변경하지 않는다. `GET /api/health`의 `SELECT 1`은 MySQL에서도 동일하다.
- 추가 원칙: 앱은 root가 아닌 전용 DB 계정 사용 / 문자셋·collation 명시 / 시각은 UTC 기준 / PostgreSQL 전용 `sslmode`를 MySQL URL에 복사하지 않음 / 운영 TLS와 로컬 개발 설정 분리 / Docker 이미지 버전은 구현 시 정확히 고정 / 기존 DB 볼륨·데이터 임의 삭제 금지.
- **대체 관계**: D-011(Docker PostgreSQL)의 엔진 부분, D-004의 "PostgreSQL" 엔진과 풀러·SSL 기준, D-012·D-013의 PostgreSQL 드라이버 전제를 대체한다. 이전 항목은 이력으로 남긴다.
- **현황 메모**: 변경 시점에 PostgreSQL 기준 구현이 이미 로컬 커밋 3건으로 존재한다(`bf565c2`, `c2b94aa`, `f36b0b1`). 신규 작성이 아니라 전환 작업이며, 이전 PostgreSQL 기준 검증 결과는 무효로 본다. 절차는 `CONTRACTS.md` 11절 "기존 구현 전환".
- `PROJECT_CONTEXT.md`는 이번 변경에 한해 수정이 승인되었고 2절·9절의 DB 표기를 갱신했다.

### D-019 MySQL 세부 선택 — APPROVED (보완 사항 포함)
승인일: 2026-10-05. 권장안 5개를 승인하되 아래 보완을 포함한다.

1. **기본 collation `utf8mb4_0900_ai_ci`**: 승인. 이유: MySQL 8.4 기본값과 같아 서버·스키마·연결 간 혼용을 피한다.
   - 미결정 유지(도메인 단계): 토큰·해시의 정확한 비교 방식. `utf8mb4_bin`을 무조건 쓴다고 확정하지 않으며 `VARBINARY` 등 적절한 이진 비교 방식도 검토 대상이다. 로그인 ID의 대소문자 정책도 이번 단계에서 확정하지 않는다.
2. **시각 `DATETIME(6)`에 UTC 저장**: 승인. `DATETIME` 자체는 시간대 변환이나 UTC를 강제하지 않으므로 애플리케이션과 연결 설정(`--default-time-zone=+00:00`, `connectionTimeZone=UTC`, `forceConnectionTimeZoneToSession=true`, `Instant` 사용)에서 UTC를 보장한다. 시각만으로 버전 순서나 유일성을 보장한다고 서술하지 않는다(도메인 단계에서 버전 번호와 제약조건으로 정한다).
3. **타임아웃**: `connectTimeout=2000` ms, `socketTimeout=3000` ms, Hikari `connectionTimeout=2000` ms, 쿼리 타임아웃 2초 — 승인. 타임아웃 발생 순서와 전체 HTTP 응답 시간은 보장하지 않는다.
   - 위험 기록: `socketTimeout`은 같은 데이터소스를 쓰는 Flyway에도 적용된다. 실패 시 임의로 값을 늘리지 않고 변경 제안을 보고한다.
4. **인증·TLS**: `allowPublicKeyRetrieval=true`는 로컬 개발에서만 허용. 운영 TLS 기본은 `sslMode=VERIFY_IDENTITY`이며 인증서 신뢰 구성과 호스트명 검증을 요구한다. 운영에서 완화가 필요하면 별도 승인을 받는다.
5. **권한**: 로컬 전용 앱 계정은 해당 스키마 한정 전체 권한 허용. 운영 마이그레이션 계정 분리는 **미결정 유지**(D-004 확정 후).
6. **Docker healthcheck**: `mysqladmin ping`만으로는 인증 성공을 검증하지 못하므로 사용하지 않는다. 앱 전용 계정으로 대상 DB에 `SELECT 1`을 실행하고 실패 시 비정상 종료하며, 비밀번호를 명령 인자나 출력에 노출하지 않는다.
7. **엔진 검증**: 도메인 테이블이 없는 단계에서는 InnoDB 사용 가능 여부와 `default_storage_engine`만 확인한다. 실제 도메인 테이블의 엔진 검증은 테이블 생성 단계에서 수행하며, 검증 때문에 영구 도메인 테이블을 만들지 않는다.
8. **기존 자산 보존**: 기존 PostgreSQL 컨테이너·볼륨·커밋을 보존한다. 전환 대상 소스와 설정의 수정은 허용하고, 테스트 파일 이름 변경이 필요하면 `git mv`를 허용한다. 기존 사용자 작업을 임의로 덮어쓰지 않는다.

미결정 유지: MySQL 8.4를 제공하지 않는 관리형 제품일 때 8.0 허용 여부(D-004와 함께 결정).

## DemoAuth 승인 결정

DemoAuth 승인 결정: D-020~D-024와 CONTRACTS.md 12절이 해당 인증 범위의 기존 미결정·Bootstrap 제한을 대체한다. D-104는 제작 참여자의 자기 검수 금지로 승인되었으며 업무 API에서 구현한다. D-107은 DemoAuth 로그인 ID에 한해 아래 규칙으로 승인되었고 다른 업무 식별자 정책은 이월한다.

### D-020 DemoAuth 인증·배포 — APPROVED (2026-10-05)
- DB 저장형 불투명 Bearer(32바이트 난수), SHA-256 BINARY(32) 해시, sessionStorage, 기본 60분 절대 만료, refresh 없음, 현재 토큰만 logout. 이유: Vercel 기본 도메인 + 별도 HTTPS API 계획에서 쿠키의 교차 사이트 제약을 피하고 기존 credentials=false를 유지한다. XSS 노출 제한을 인정한 데모 선택.
- CORS Authorization 허용과 Retry-After 노출 승인. 쿠키/Basic 인증 없음, Bearer 전용 CSRF 정책. 실제 호스트·Origin·프록시 IP 정책과 배포 검증은 미완료이며 별도 승인.

### D-021 역할·입력 — APPROVED
- OPERATOR/TRANSLATOR/REVIEWER/READER 단일 역할. 배정 범위, 비로그인 공개본, 제작 참여자의 자기 검수 금지. 이유: 기존 흐름 보존 및 비공개 원고·승인 권한 분리. 업무 기능은 이번 범위 밖.
- 로그인 ID ^[a-z0-9][a-z0-9._-]{2,63}$, ID/비밀번호 변환 없음, 형식 오류 400. 토큰 해시 BINARY(32), 로그인 ID 정확 비교. D-106/D-107 중 이번 인증에 필요한 부분만 확정.

### D-022 제한·감사·장애 — APPROVED
- ID별 5회/15분·15분 차단, local 직접 IP별 30회/15분. 전달 헤더 무조건 신뢰 금지. 프록시에서 안전한 IP 판별/미적용 보완책은 배포 때 승인, 미결정 demo/prod 기동 거부.
- 카운터 원자성, 성공시 ID 초기화/IP 유지, 경계 now>=만료, 차단 중 연장 없음. 실패/거부 감사 실패도 503, 인증 DB 장애는 허용하지 않는다.
- 수동 정리만 사용: 만료/폐기 token 24시간, 비활성 제한 24시간, 감사 7일. 이유: MVP 최소 보관과 새 스케줄러 회피. 상세는 CONTRACTS.md 12절.

### D-023 데모 계정·프런트 — APPROVED
- 명시적 local/demo seed와 환경변수 비밀번호, prod seed 금지, 기존 계정 덮어쓰기 금지. /login → /demo, ID 안내만, 서버 사용자/역할 안내, 업무 메뉴 비활성. 초기 /me·만료·탭 활성 확인, polling 없음, 이전 /me 응답 무시, 403 유지·503 재시도·logout 미확인 처리.

### D-024 협업·검증 — APPROVED
- Codex backend·공통 문서·실제 연동, Claude Code frontend·마지막 리뷰. 별도 계약 로컬 커밋 승인, push 금지. Security starter/test 의존성과 후속 Flyway 승인, V1 보존.
- 실제 브라우저 역할별 403은 첫 업무 API로 이월. 운영 빌드에 없는 테스트 전용 경로로 backend 권한 검증, 별도 데모 API 금지.

## 이월 항목 (업무 노드에서 결정, DemoAuth 확정 부분 제외)

- D-106 토큰·해시의 비교 방식(`utf8mb4_bin` 확정 아님, `VARBINARY` 등 검토)
- D-107 로그인 ID의 대소문자 정책
- D-108 운영 마이그레이션 계정과 앱 계정의 분리
- D-109 버전 순서·유일성 보장 방식(시각이 아닌 버전 번호·제약조건)

- D-101 승인 무효화 후 회차/버전 상태 (`APPROVED` → ? 전이가 PROJECT_CONTEXT 6절 전이표에 없음)
- D-102 원문 변경 시 기존 번역 버전의 stale 처리 방식
- D-103 공개본 유지 중 새 버전 검수 진행 시 상태 모델(회차 단위 vs 버전 단위)
- D-104 감수자 자기 승인 허용 여부
- D-105 원문 블록과 페이지의 관계, 이미지 없는 텍스트 블록 시작 여부
