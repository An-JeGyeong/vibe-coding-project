// Page images (CONTRACTS 26): the original manga page of a page number, kept per episode.
export type PageImageMeta = { pageNo: number; contentType: string; byteSize: number; updatedAt: string };
/** "operator": /api/episodes/..., "mine": /api/my/episodes/... (the assigned translator or reviewer). */
export type PageImageScope = "operator" | "mine";

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
