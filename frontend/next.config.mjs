const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
if (!baseUrl || baseUrl.trim() !== baseUrl || baseUrl.endsWith("/")) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL is required and must have no trailing slash.");
}
let apiOrigin;
try {
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("invalid URL");
  }
  apiOrigin = url.origin;
} catch {
  throw new Error("NEXT_PUBLIC_API_BASE_URL must be an HTTP(S) URL without credentials, query or fragment.");
}

// Security headers of every page (the API has its own). The CSP keeps inline scripts and styles because Next.js writes its
// hydration data inline and the theme script runs before the first paint; it still blocks framing, foreign form targets, plugins,
// a changed <base>, and any connection or image source other than this site and the API. Bootstrap and Pretendard come from jsDelivr.
const dev = process.env.NODE_ENV !== "production"; // the development server evaluates code, a production build does not
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' https://cdn.jsdelivr.net data:",
  `img-src 'self' data: blob: ${apiOrigin}`,
  `connect-src 'self' ${apiOrigin}${dev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

export default {
  poweredByHeader: false,
  async headers() { return [{ source: "/:path*", headers: securityHeaders }]; },
};
