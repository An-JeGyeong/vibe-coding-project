# DECISIONS.md

관리: Claude Code / 최종 승인: 프로젝트 책임자
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

### D-004 관리형 PostgreSQL 제품 — UNDECIDED
- 미결정 유지. 선정 기준(무료 티어, JDBC 직접 접속, SSL 필수, 풀러 사용 시 마이그레이션은 direct 연결)은 이전 제안을 참고용으로 둔다.
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

### D-009 인증 방식 — UNDECIDED
- 미결정 유지. ProjectBootstrap에서는 인증 없이 `/api/health`만 공개한다.

### D-010 CORS — APPROVED
- 환경변수 기반 명시적 허용 출처 목록. 와일드카드 금지.

### D-011 로컬 개발 DB — APPROVED
- Docker PostgreSQL. (D-004 미결정과 무관하게 로컬 개발에 사용)

### D-012 헬스 체크 계약 — APPROVED
- `GET /api/health`. 인증·역할 검사 없음, 상태 변경·감사 기록 없음.
- DB에 `SELECT 1` 실행. DB 정상 시 200 `{status:UP, db:UP, time}`, 실패 시 503 `{status:UP, db:DOWN, time}`.
- `time`은 UTC ISO-8601. 결과 캐시 없음, `Cache-Control: no-store`.
- 연결 문자열, 호스트명, 내부 예외, 프레임워크 버전은 응답하지 않는다.
- 지원 메서드: `GET`, `OPTIONS`, Spring MVC 기본 `HEAD`(본문 없음). 변경 메서드는 405. 허용되지 않은 `Origin`은 CORS 거부가 먼저 적용되어 403일 수 있다.
- 상세 계약은 `CONTRACTS.md` 참고.

### D-013 DB 타임아웃 — APPROVED (D-012의 "2초" 규정을 대체)
- Hikari 연결 획득 타임아웃 2초, `SELECT 1` 쿼리 타임아웃 2초, JDBC 네트워크 타임아웃은 유한한 값.
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

## 이월 항목 (부트스트랩 이후 노드에서 결정, 모두 PROPOSED)

- D-101 승인 무효화 후 회차/버전 상태 (`APPROVED` → ? 전이가 PROJECT_CONTEXT 6절 전이표에 없음)
- D-102 원문 변경 시 기존 번역 버전의 stale 처리 방식
- D-103 공개본 유지 중 새 버전 검수 진행 시 상태 모델(회차 단위 vs 버전 단위)
- D-104 감수자 자기 승인 허용 여부
- D-105 원문 블록과 페이지의 관계, 이미지 없는 텍스트 블록 시작 여부
