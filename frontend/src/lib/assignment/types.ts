import type { SourceBlock } from "@/lib/episodes/types";

export type AssigneeRole = "TRANSLATOR" | "REVIEWER";
/** The role segment used in the URL: PUT /api/episodes/{id}/assignments/{role}. */
export type SlotKey = "translator" | "reviewer";

export type AssignableAccount = { id: string; displayName: string; role: AssigneeRole };
export type AssignedPerson = { account: { id: string; displayName: string }; assignedAt: string };
export type Assignments = { translator: AssignedPerson | null; reviewer: AssignedPerson | null };
export type AssignOutcome = { role: AssigneeRole; person: AssignedPerson; changed: boolean; created: boolean };

export type MyEpisode = { id: string; title: string; assignedRole: AssigneeRole; latestSourceVersion: number; assignedAt: string; updatedAt: string };
export type MyEpisodeList = { items: MyEpisode[]; total: number };
export type MyEpisodeDetail = {
  id: string; title: string; assignedRole: AssigneeRole; latestSourceVersion: number;
  source: { version: number; savedAt: string; blocks: SourceBlock[] } | null;
};

export const ASSIGNEE_LABEL: Record<AssigneeRole, string> = { TRANSLATOR: "번역가", REVIEWER: "감수자" };
export const SLOT_ROLE: Record<SlotKey, AssigneeRole> = { translator: "TRANSLATOR", reviewer: "REVIEWER" };
