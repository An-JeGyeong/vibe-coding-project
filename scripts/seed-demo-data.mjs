// Creates the pre-published demo data of DEMO_SCRIPT.md through the HTTP API: one work (cover, public, featured, banner)
// with two image episodes (the first one is rejected once and re-submitted), and one text-only episode.
// The translated images are uploaded by the typesetter after the translation is approved (CONTRACTS 29), so the backend must have V36.
// Usage (PowerShell, backend running; the passwords are read from the environment and never printed):
//   $env:DEMO_OPERATOR_PASSWORD = "..."; $env:DEMO_TRANSLATOR_PASSWORD = "..."; $env:DEMO_REVIEWER_PASSWORD = "..."; $env:DEMO_TYPESETTER_PASSWORD = "..."
//   node scripts/seed-demo-data.mjs            # API base: $env:API_BASE (default http://localhost:8080)
// The images are generated placeholders (plain gradients). Replace them with permitted artwork for a real demo.
// Run it once: it stops when the demo work already exists.
import zlib from "node:zlib";

const BASE = process.env.API_BASE ?? "http://localhost:8080";
const TITLE = "낯선 항구";
const PASSWORDS = { operator: process.env.DEMO_OPERATOR_PASSWORD, translator: process.env.DEMO_TRANSLATOR_PASSWORD, reviewer: process.env.DEMO_REVIEWER_PASSWORD, typesetter: process.env.DEMO_TYPESETTER_PASSWORD };
for (const [role, value] of Object.entries(PASSWORDS)) {
  if (!value) { console.error(`DEMO_${role.toUpperCase()}_PASSWORD is not set.`); process.exit(2); }
}

function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); }
/** A w x h PNG: a vertical gradient between two colours with a light speech-bubble box. */
function png(w, h, top, bottom) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    const t = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const bubble = x > w * 0.15 && x < w * 0.6 && y > h * 0.1 && y < h * 0.22;
      for (let k = 0; k < 3; k++) row[1 + x * 3 + k] = bubble ? 245 : Math.round(top[k] + (bottom[k] - top[k]) * t);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const ORIGINAL = [png(700, 990, [70, 70, 80], [20, 20, 30]), png(700, 990, [90, 80, 70], [30, 25, 20])]; // grey: the untranslated pages
const TRANSLATED = [png(700, 990, [60, 90, 170], [20, 30, 80]), png(700, 990, [170, 110, 60], [80, 40, 20])]; // colour: the typeset pages
const COVER = png(600, 800, [120, 90, 200], [30, 20, 70]);

const tokens = {}, ids = {};
async function call(role, method, path, body, headers = {}) {
  const h = { ...headers };
  if (role) h.Authorization = `Bearer ${tokens[role]}`;
  let payload;
  if (body instanceof Buffer) payload = body;
  else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const response = await fetch(BASE + path, { method, headers: h, body: payload });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json };
}
async function must(label, promise, ok = [200, 201, 204]) {
  const result = await promise;
  if (!ok.includes(result.status)) { console.error(`FAILED: ${label} -> HTTP ${result.status}`); process.exit(1); }
  console.log(`ok: ${label}`);
  return result;
}

for (const role of Object.keys(PASSWORDS)) {
  const login = await call(null, "POST", "/api/auth/login", { loginId: `demo.${role}`, password: PASSWORDS[role] });
  if (login.status !== 200) { console.error(`Login failed for demo.${role} (HTTP ${login.status}). Check the password and that the backend runs at ${BASE}.`); process.exit(1); }
  tokens[role] = login.json.accessToken; ids[role] = login.json.user.id;
}

const existing = await must("list works", call("operator", "GET", "/api/works?limit=100&offset=0"));
if (existing.json.items.some((work) => work.title === TITLE)) { console.log(`The work "${TITLE}" already exists; nothing was created.`); process.exit(0); }

const work = await must("create work", call("operator", "POST", "/api/works", {
  title: TITLE, author: "시연 작가", description: "낯선 항구에 도착한 소년의 이야기.\n종소리와 낡은 지도가 그를 기다린다.", readingDirection: "RTL", genres: ["판타지", "액션"],
}));
const workId = work.json.id;
await must("work cover", call("operator", "PUT", `/api/works/${workId}/cover`, COVER, { "Content-Type": "image/png" }));
await must("publish work (public, featured, banner)", call("operator", "PUT", `/api/works/${workId}`, {
  expectedRevision: work.json.revision, title: TITLE, author: "시연 작가", description: "낯선 항구에 도착한 소년의 이야기.\n종소리와 낡은 지도가 그를 기다린다.",
  readingDirection: "RTL", genres: ["판타지", "액션"], isPublic: true, isFeatured: true, isBanner: true,
}));

const SOURCE = ["어느 날 아침, 소년은 낯선 항구에 서 있었다.", "「여기가... 어디지?」", "바다 너머에서 종소리가 울렸다.", "그는 주머니 속의 낡은 지도를 펼쳤다.", "지도에는 단 하나의 별 표시만 있었다."];
const TRANSLATION = ["어느 날 아침, 소년은 낯선 항구에 서 있었다.", "\"여기가... 어디지?\"", "바다 너머에서 종소리가 울렸다.", "그는 주머니 속 낡은 지도를 펼쳤다.", "지도에는 별 표시 하나뿐이었다."];
const PAGE_OF = [1, 1, 2, 2, null];

async function episode(title, no, { images, reject = false, withImagesOnSource = true }) {
  const created = await must(`create episode "${title}"`, call("operator", "POST", "/api/episodes", { title }));
  const id = created.json.id;
  await must("source", call("operator", "PUT", `/api/episodes/${id}/source`, { expectedVersion: 0, blocks: SOURCE.map((text, i) => ({ pageNo: PAGE_OF[i], text })) }));
  await must("assign translator", call("operator", "PUT", `/api/episodes/${id}/assignments/translator`, { accountId: ids.translator }));
  await must("assign reviewer", call("operator", "PUT", `/api/episodes/${id}/assignments/reviewer`, { accountId: ids.reviewer }));
  await must("assign typesetter", call("operator", "PUT", `/api/episodes/${id}/assignments/typesetter`, { accountId: ids.typesetter }));
  if (withImagesOnSource) for (const [i, page] of [1, 2].entries()) await must(`original image page ${page}`, call("operator", "PUT", `/api/episodes/${id}/pages/${page}/image`, ORIGINAL[i], { "Content-Type": "image/png" }));

  async function version(texts) {
    const started = await must("translation", call("translator", "POST", `/api/my/episodes/${id}/translations`));
    const v = started.json.versionNo;
    const saved = await must("save translation", call("translator", "PUT", `/api/my/episodes/${id}/translations/${v}`, { expectedRevision: started.json.revision, blocks: texts.map((text, i) => ({ seq: i + 1, text })) }));
    await must("submit", call("translator", "POST", `/api/my/episodes/${id}/translations/${v}/submit`, { expectedRevision: saved.json.revision }));
    return v;
  }
  let v = await version(TRANSLATION);
  if (reject) {
    await must("reject with a block comment", call("reviewer", "POST", `/api/my/episodes/${id}/reviews/${v}/reject`, { reason: "첫 문장의 어투를 더 담담하게 다듬어 주세요.", comments: [{ seq: 1, text: "문장 끝을 짧게" }] }));
    v = await version(TRANSLATION.map((text, i) => (i === 0 ? "어느 날 아침, 소년은 낯선 항구에 홀로 서 있었다." : text)));
  }
  await must("approve", call("reviewer", "POST", `/api/my/episodes/${id}/reviews/${v}/approve`));
  if (images) for (const [i, page] of [1, 2].entries()) await must(`translated image page ${page} (typesetter)`, call("typesetter", "PUT", `/api/my/episodes/${id}/translations/${v}/page-images/${page}`, TRANSLATED[i], { "Content-Type": "image/png" }));
  await must("publish", call("operator", "POST", `/api/episodes/${id}/translations/${v}/publish`));
  await must(`link to the work as episode ${no}`, call("operator", "PUT", `/api/episodes/${id}/work`, { workId, episodeNo: no }));
  return id;
}

await episode("1화 낯선 항구", 1, { images: true, reject: true });
await episode("2화 종소리", 2, { images: true });
await episode("3화 번외 (텍스트)", 3, { images: false, withImagesOnSource: false });
console.log(`Done. Work "${TITLE}" (id ${workId}) with 3 public episodes. Open /, /works/${workId} and /read.`);
