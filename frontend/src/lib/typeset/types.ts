// Approved translations as the typesetter sees them (CONTRACTS 29.5): read-only.
export type TypesetVersion = { versionNo: number; sourceVersion: number; decidedAt: string };
export type TypesetBlock = { seq: number; pageNo: number | null; source: string; text: string };
export type TypesetVersionDetail = { versionNo: number; sourceVersion: number; blocks: TypesetBlock[] };
