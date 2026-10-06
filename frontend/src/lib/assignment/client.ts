import { isRecord } from "@/lib/auth/client";
import { call, fail, INVALID_RESPONSE, isInt, isStr, isTime } from "@/lib/episodes/client";
import type { EpisodeResult, SourceBlock } from "@/lib/episodes/types";
import type {
  AssignableAccount, AssignedPerson, AssignOutcome, AssigneeRole, Assignments, MyEpisode, MyEpisodeDetail, MyEpisodeList, SlotKey,
} from "./types";

const isAssigneeRole = (value: unknown): value is AssigneeRole => value === "TRANSLATOR" || value === "REVIEWER";

function account(value: unknown): { id: string; displayName: string } | null {
  return isRecord(value) && isStr(value.id) && isStr(value.displayName) ? { id: value.id, displayName: value.displayName } : null;
}

function person(value: unknown): AssignedPerson | null {
  const who = isRecord(value) ? account(value.account) : null;
  return who && isRecord(value) && isTime(value.assignedAt) ? { account: who, assignedAt: value.assignedAt } : null;
}

function blocks(value: unknown): SourceBlock[] | null {
  if (!Array.isArray(value)) return null;
  const result: SourceBlock[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isInt(item.seq) || !isStr(item.text) || !(item.pageNo === null || isInt(item.pageNo))) return null;
    result.push({ seq: item.seq, pageNo: item.pageNo as number | null, text: item.text });
  }
  return result;
}

function myEpisode(value: unknown): MyEpisode | null {
  if (!isRecord(value) || !isStr(value.id) || !isStr(value.title) || !isAssigneeRole(value.assignedRole)
    || !isInt(value.latestSourceVersion) || !isTime(value.assignedAt) || !isTime(value.updatedAt)) return null;
  return { id: value.id, title: value.title, assignedRole: value.assignedRole, latestSourceVersion: value.latestSourceVersion,
    assignedAt: value.assignedAt, updatedAt: value.updatedAt };
}

const id = (value: string) => encodeURIComponent(value);

export async function listAssignableAccounts(role: AssigneeRole, signal?: AbortSignal): Promise<EpisodeResult<AssignableAccount[]>> {
  const result = await call({ path: `/api/assignable-accounts?role=${role}`, method: "GET", signal, ok: [200] });
  if (!result.ok) return result;
  const items = isRecord(result.value) && Array.isArray(result.value.items) ? result.value.items : null;
  if (!items) return fail(INVALID_RESPONSE);
  const parsed: AssignableAccount[] = [];
  for (const item of items) {
    const who = account(item);
    if (!who || !isRecord(item) || item.role !== role) return fail(INVALID_RESPONSE);
    parsed.push({ ...who, role });
  }
  return { ok: true, value: parsed };
}

export async function getAssignments(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<Assignments>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}/assignments`, method: "GET", signal, ok: [200] });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body)) return fail(INVALID_RESPONSE);
  const read = (slot: unknown) => (slot === null ? null : person(slot));
  const translator = read(body.translator);
  const reviewer = read(body.reviewer);
  if ((body.translator !== null && !translator) || (body.reviewer !== null && !reviewer)) return fail(INVALID_RESPONSE);
  return { ok: true, value: { translator, reviewer } };
}

export async function setAssignment(episodeId: string, slot: SlotKey, accountId: string, signal?: AbortSignal): Promise<EpisodeResult<AssignOutcome>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}/assignments/${slot}`, method: "PUT", body: { accountId }, signal, ok: [200, 201] });
  if (!result.ok) return result;
  const body = result.value;
  const who = isRecord(body) ? account(body.account) : null;
  if (!isRecord(body) || !isAssigneeRole(body.role) || !who || !isTime(body.assignedAt) || typeof body.changed !== "boolean") return fail(INVALID_RESPONSE);
  return { ok: true, value: { role: body.role, person: { account: who, assignedAt: body.assignedAt }, changed: body.changed, created: result.status === 201 } };
}

export async function listMyEpisodes(limit: number, offset: number, signal?: AbortSignal): Promise<EpisodeResult<MyEpisodeList>> {
  const result = await call({ path: `/api/my/episodes?limit=${limit}&offset=${offset}`, method: "GET", signal, ok: [200] });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !Array.isArray(body.items) || !isInt(body.total)) return fail(INVALID_RESPONSE);
  const items = body.items.map(myEpisode);
  return items.every((item): item is MyEpisode => item !== null) ? { ok: true, value: { items, total: body.total } } : fail(INVALID_RESPONSE);
}

export async function getMyEpisode(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<MyEpisodeDetail>> {
  const result = await call({ path: `/api/my/episodes/${id(episodeId)}`, method: "GET", signal, ok: [200] });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !isStr(body.id) || !isStr(body.title) || !isAssigneeRole(body.assignedRole) || !isInt(body.latestSourceVersion)) return fail(INVALID_RESPONSE);
  let source: MyEpisodeDetail["source"] = null;
  if (body.source !== null) {
    const list = isRecord(body.source) ? blocks(body.source.blocks) : null;
    if (!isRecord(body.source) || !isInt(body.source.version) || !isTime(body.source.savedAt) || !list) return fail(INVALID_RESPONSE);
    source = { version: body.source.version, savedAt: body.source.savedAt, blocks: list };
  }
  return { ok: true, value: { id: body.id, title: body.title, assignedRole: body.assignedRole, latestSourceVersion: body.latestSourceVersion, source } };
}
