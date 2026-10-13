import type { WorkSummary } from "@/lib/catalog/types";

// Recommendations and period rankings (CONTRACTS 31).
export const PERIODS = ["week", "month", "year"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABEL: Record<Period, string> = { week: "주간", month: "월간", year: "연간" };
export const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30, year: 365 };
export const RECOMMEND_WEIGHT = 10; // one recommendation counts as ten views

export type RankedWork = WorkSummary & { rank: number; score: number; periodViews: number; periodRecommends: number };
export type Ranking = { period: Period; items: RankedWork[] };
export type RecommendState = { recommended: boolean; recommendCount: number };

export const isPeriod = (value: unknown): value is Period => (PERIODS as readonly unknown[]).includes(value);
