import { readJson, writeJson } from "./storage";

// An anonymous vote identifier and the works this browser recommended (CONTRACTS 31.6). Neither is tied to an account.
export const VOTER_KEY = "mangabridge.voter.v1";
export const RECOMMENDED_KEY = "mangabridge.recommended.v1";
export const RECOMMENDED_MAX = 200;
export const VOTER_PATTERN = /^[0-9a-f]{32}$/;
const ID = /^[1-9][0-9]{0,17}$/;

let memoryKey: string | null = null; // used when the storage is blocked: the identifier then lives for this visit only

function newKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The identifier of this browser; created on first use. A stored value of the wrong shape is replaced. */
export function getVoterKey(): string {
  const stored = readJson(VOTER_KEY);
  if (typeof stored === "string" && VOTER_PATTERN.test(stored)) return stored;
  if (memoryKey !== null) return memoryKey;
  const created = newKey();
  writeJson(VOTER_KEY, created);
  if (readJson(VOTER_KEY) !== created) memoryKey = created;
  return created;
}

export function loadRecommended(): string[] {
  const raw = readJson(RECOMMENDED_KEY);
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter((item): item is string => typeof item === "string" && ID.test(item)))).slice(0, RECOMMENDED_MAX);
}

export function setRecommended(workId: string, on: boolean) {
  if (!ID.test(workId)) return;
  const rest = loadRecommended().filter((id) => id !== workId);
  writeJson(RECOMMENDED_KEY, (on ? [workId, ...rest] : rest).slice(0, RECOMMENDED_MAX));
}
