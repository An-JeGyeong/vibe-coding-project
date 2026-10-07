import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "./types";

// Advisory local checks mirroring CONTRACTS 26.2 (the server validates again, including the file signature).
const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((value, index) => bytes[index] === value);

/** The declared type must match the first bytes: PNG, JPEG or WEBP ("RIFF" .... "WEBP"). */
export function signatureMatches(type: string, bytes: Uint8Array): boolean {
  if (type === "image/png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (type === "image/jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (type === "image/webp") return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12 && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]);
  return false;
}

export async function validateImageFile(file: Blob): Promise<string | null> {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) return "PNG, JPEG, WEBP 이미지만 올릴 수 있습니다.";
  if (file.size < 1) return "비어 있는 파일입니다.";
  if (file.size > MAX_IMAGE_BYTES) return "이미지는 5 MiB 이하여야 합니다.";
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return signatureMatches(file.type, head) ? null : "파일 내용이 선택한 이미지 형식과 맞지 않습니다.";
}
