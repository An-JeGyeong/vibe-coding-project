export type HealthResult =
  | { kind: "UP" | "DOWN"; time: string }
  | { kind: "ERROR"; message: string };

export async function checkHealth(signal?: AbortSignal): Promise<HealthResult> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) return { kind: "ERROR", message: "NEXT_PUBLIC_API_BASE_URL 환경변수가 필요합니다." };
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      cache: "no-store",
      credentials: "omit",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
    if (response.status !== 200 && response.status !== 503) throw new Error("invalid status");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") throw new Error("invalid body");
    const health = body as Record<string, unknown>;
    if (Object.keys(health).length !== 3 || health.status !== "UP" ||
        health.db !== (response.status === 200 ? "UP" : "DOWN") ||
        typeof health.time !== "string" || !health.time.endsWith("Z") || Number.isNaN(Date.parse(health.time))) {
      throw new Error("invalid health response");
    }
    return { kind: health.db as "UP" | "DOWN", time: health.time };
  } catch {
    return { kind: "ERROR", message: "헬스 체크 요청에 실패했습니다. API 실행 상태와 CORS 설정을 확인하세요." };
  }
}

export function healthLabel(result: HealthResult): string {
  if (result.kind === "ERROR") return `오류 — ${result.message}`;
  return result.kind === "UP" ? "UP — 서버와 DB 연결 정상" : "DOWN — 서버 응답 정상, DB 연결 실패";
}
