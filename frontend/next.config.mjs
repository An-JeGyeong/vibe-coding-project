const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
if (!baseUrl || baseUrl.trim() !== baseUrl || baseUrl.endsWith("/")) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL is required and must have no trailing slash.");
}
try {
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("invalid URL");
  }
} catch {
  throw new Error("NEXT_PUBLIC_API_BASE_URL must be an HTTP(S) URL without credentials, query or fragment.");
}
export default { poweredByHeader: false };
