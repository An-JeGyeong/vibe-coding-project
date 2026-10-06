import { isRecord } from "@/lib/auth/client";
import { isStr, isTime } from "@/lib/episodes/client";

// A review decision as the server exposes it (CONTRACTS 18.1): the reason only exists for a rejection.
export type Decision = { decision: "APPROVED" | "REJECTED"; decidedAt: string; reason: string | null };

/** Absent or null means "no decision yet"; anything malformed is rejected. */
export function parseDecision(value: unknown): { ok: true; value: Decision | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!isRecord(value) || (value.decision !== "APPROVED" && value.decision !== "REJECTED") || !isTime(value.decidedAt)) return { ok: false };
  if (!(value.reason === null || value.reason === undefined || isStr(value.reason))) return { ok: false };
  return { ok: true, value: { decision: value.decision, decidedAt: value.decidedAt, reason: (value.reason as string | null | undefined) ?? null } };
}
