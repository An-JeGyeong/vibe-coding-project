// Replaces the images of the demo work through the HTTP API (passwords come from the environment and are never printed).
//
//   node scripts/replace-demo-images.mjs <folder> [--work "낯선 항구"] [--dry-run]
//
// File names in the folder (PNG, JPEG or WEBP, 5 MiB or less each):
//   cover.png                      the work cover (replaced at once)
//   ep1-original-1.png             original page 1 of episode number 1 (replaced at once, never shown to readers)
//   ep1-translated-1.png           translated page 1 of episode number 1
//   ep1-translated-2.png           ...
// "ep1" is the episode NUMBER inside the work (the number shown on the work page), not the database id.
//
// Translated images belong to a translation version, and a published version cannot change. For every episode that has
// translated files the script therefore creates a NEW translation version (the text of the published one is kept), submits it,
// approves it as the reviewer, uploads the images as the TYPESETTER (only an approved translation takes images, CONTRACTS 29)
// and publishes it, which replaces the current public version. The demo typesetter is assigned to the episode when it is not yet.
// An episode is skipped (nothing changed for it) when the files do not cover every numbered source page,
// or when a translation is already in progress for it. Use --dry-run to see the plan without changing anything.
//
// PowerShell:
//   $env:DEMO_OPERATOR_PASSWORD = Read-Host "operator"; $env:DEMO_TRANSLATOR_PASSWORD = Read-Host "translator"; $env:DEMO_REVIEWER_PASSWORD = Read-Host "reviewer"; $env:DEMO_TYPESETTER_PASSWORD = Read-Host "typesetter"
//   node scripts/replace-demo-images.mjs C:\path\to\images
//   Remove-Item Env:DEMO_OPERATOR_PASSWORD, Env:DEMO_TRANSLATOR_PASSWORD, Env:DEMO_REVIEWER_PASSWORD, Env:DEMO_TYPESETTER_PASSWORD
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.API_BASE ?? "http://localhost:8080";
const MAX_BYTES = 5 * 1024 * 1024;
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const workIndex = args.indexOf("--work");
const WORK_TITLE = workIndex >= 0 ? args[workIndex + 1] : "낯선 항구";
const folder = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--work");
if (!folder || !WORK_TITLE) { console.error('Usage: node scripts/replace-demo-images.mjs <folder> [--work "title"] [--dry-run]'); process.exit(2); }


// ---- the files ----
const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
function signatureOk(type, bytes) {
  const starts = (sig, at = 0) => sig.every((value, index) => bytes[at + index] === value);
  if (type === "image/png") return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (type === "image/jpeg") return starts([0xff, 0xd8, 0xff]);
  return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
}
function load(path, name) {
  const type = TYPES[name.split(".").pop().toLowerCase()];
  const bytes = readFileSync(path);
  if (bytes.length < 1 || bytes.length > MAX_BYTES) fatal(`${name}: the file must be between 1 byte and 5 MiB`);
  if (!signatureOk(type, bytes)) fatal(`${name}: the content does not match its extension`);
  return { type, bytes, name };
}
function fatal(message) { console.error(`ERROR: ${message}`); process.exit(1); }

let cover = null;
const originals = new Map(), translated = new Map(); // episodeNo -> Map(page -> file)
const ignored = [];
let entries;
try { entries = readdirSync(folder); } catch { fatal(`cannot read the folder: ${folder}`); }
for (const name of entries.sort()) {
  const path = join(folder, name);
  if (!statSync(path).isFile()) continue;
  const parsed = /^ep(\d{1,4})-(original|translated)-(\d{1,4})\.(png|jpe?g|webp)$/i.exec(name);
  if (parsed) {
    const target = parsed[2].toLowerCase() === "original" ? originals : translated;
    const no = Number(parsed[1]), page = Number(parsed[3]);
    if (!target.has(no)) target.set(no, new Map());
    target.get(no).set(page, load(path, name));
  } else if (/^cover\.(png|jpe?g|webp)$/i.test(name)) cover = load(path, name);
  else ignored.push(name);
}
if (!cover && originals.size === 0 && translated.size === 0) fatal(`no image files named like cover.png / ep1-original-1.png / ep1-translated-1.png were found in ${folder}`);
if (ignored.length) console.log(`ignored (name does not match): ${ignored.join(", ")}`);

// ---- the API ----
const PASSWORDS = { operator: process.env.DEMO_OPERATOR_PASSWORD, translator: process.env.DEMO_TRANSLATOR_PASSWORD, reviewer: process.env.DEMO_REVIEWER_PASSWORD, typesetter: process.env.DEMO_TYPESETTER_PASSWORD };
// translated images need the whole chain (translator, reviewer, typesetter); cover and original images only the operator
const NEEDED = translated.size > 0 ? Object.keys(PASSWORDS) : ["operator"];
for (const role of NEEDED) {
  if (!PASSWORDS[role]) { console.error(`DEMO_${role.toUpperCase()}_PASSWORD is not set.`); process.exit(2); }
}
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
  if (!ok.includes(result.status)) fatal(`${label} -> HTTP ${result.status}`);
  console.log(`ok: ${label}`);
  return result;
}

for (const role of NEEDED) {
  const login = await call(null, "POST", "/api/auth/login", { loginId: `demo.${role}`, password: PASSWORDS[role] });
  if (login.status !== 200) fatal(`login failed for demo.${role} (HTTP ${login.status}); check the password and that the backend runs at ${BASE}`);
  tokens[role] = login.json.accessToken;
  ids[role] = login.json.user.id;
}

const list = await must("list works", call("operator", "GET", "/api/works?limit=100&offset=0"));
const found = list.json.items.find((work) => work.title === WORK_TITLE);
if (!found) fatal(`the work "${WORK_TITLE}" does not exist`);
const work = (await must("read the work", call("operator", "GET", `/api/works/${found.id}`))).json;
const episodeOf = new Map(work.episodes.map((episode) => [episode.episodeNo, episode]));
for (const no of [...originals.keys(), ...translated.keys()]) {
  if (!episodeOf.has(no)) fatal(`the work "${WORK_TITLE}" has no episode number ${no} (it has: ${[...episodeOf.keys()].join(", ")})`);
}

if (dryRun) {
  console.log("--- dry run: nothing is changed ---");
  if (cover) console.log(`cover <- ${cover.name}`);
  for (const [no, files] of originals) console.log(`episode ${no} original pages ${[...files.keys()].join(", ")} <- replace`);
  for (const [no, files] of translated) console.log(`episode ${no} translated pages ${[...files.keys()].join(", ")} <- new translation version, approve, publish`);
  process.exit(0);
}

if (cover) await must(`cover <- ${cover.name}`, call("operator", "PUT", `/api/works/${work.id}/cover`, cover.bytes, { "Content-Type": cover.type }));

for (const [no, files] of originals) {
  const { episodeId } = episodeOf.get(no);
  for (const [page, file] of [...files].sort((a, b) => a[0] - b[0])) {
    await must(`episode ${no}: original page ${page} <- ${file.name}`, call("operator", "PUT", `/api/episodes/${episodeId}/pages/${page}/image`, file.bytes, { "Content-Type": file.type }));
  }
}

const skipped = [];
for (const [no, files] of translated) {
  const { episodeId } = episodeOf.get(no);
  const tag = `episode ${no}`;
  const versions = await must(`${tag}: read translations`, call("translator", "GET", `/api/my/episodes/${episodeId}/translations`));
  const published = versions.json.items.filter((item) => item.status === "PUBLISHED").sort((a, b) => b.versionNo - a.versionNo)[0];
  if (!published) { skipped.push(`${tag}: no published translation to copy the text from`); continue; }
  if (versions.json.items.some((item) => item.status === "DRAFT" || item.status === "REVIEW_PENDING")) { skipped.push(`${tag}: a translation is already in progress; finish or submit it first`); continue; }
  const base = (await must(`${tag}: read the published text`, call("translator", "GET", `/api/my/episodes/${episodeId}/translations/${published.versionNo}`))).json;
  const needed = [...new Set(base.blocks.filter((block) => block.pageNo !== null).map((block) => block.pageNo))].sort((a, b) => a - b);
  const missing = needed.filter((page) => !files.has(page));
  if (missing.length > 0) { skipped.push(`${tag}: translated image(s) missing for page(s) ${missing.join(", ")}`); continue; }
  const extra = [...files.keys()].filter((page) => !needed.includes(page));
  if (extra.length > 0) { skipped.push(`${tag}: page(s) ${extra.join(", ")} do not exist in the source (it has ${needed.join(", ")})`); continue; }

  const assignments = await must(`${tag}: read the assignments`, call("operator", "GET", `/api/episodes/${episodeId}/assignments`));
  if (assignments.json.typesetter?.account?.id !== ids.typesetter) await must(`${tag}: assign the demo typesetter`, call("operator", "PUT", `/api/episodes/${episodeId}/assignments/typesetter`, { accountId: ids.typesetter }));
  const created = await must(`${tag}: new translation version`, call("translator", "POST", `/api/my/episodes/${episodeId}/translations`));
  const v = created.json.versionNo;
  const fresh = (await must(`${tag}: read the new version`, call("translator", "GET", `/api/my/episodes/${episodeId}/translations/${v}`))).json;
  const texts = fresh.blocks.map((block) => (block.text !== null && block.text !== "" ? block.text : base.blocks.find((b) => b.seq === block.seq)?.text ?? ""));
  let revision = fresh.revision;
  if (fresh.blocks.some((block, index) => block.text !== texts[index])) {
    const saved = await must(`${tag}: copy the published text`, call("translator", "PUT", `/api/my/episodes/${episodeId}/translations/${v}`, { expectedRevision: revision, blocks: fresh.blocks.map((block, index) => ({ seq: block.seq, text: texts[index] })) }));
    revision = saved.json.revision;
  }
  await must(`${tag}: submit`, call("translator", "POST", `/api/my/episodes/${episodeId}/translations/${v}/submit`, { expectedRevision: revision }));
  await must(`${tag}: approve`, call("reviewer", "POST", `/api/my/episodes/${episodeId}/reviews/${v}/approve`));
  for (const [page, file] of [...files].sort((a, b) => a[0] - b[0])) {
    await must(`${tag}: translated page ${page} <- ${file.name} (typesetter)`, call("typesetter", "PUT", `/api/my/episodes/${episodeId}/translations/${v}/page-images/${page}`, file.bytes, { "Content-Type": file.type }));
  }
  await must(`${tag}: publish version ${v}`, call("operator", "POST", `/api/episodes/${episodeId}/translations/${v}/publish`));
}

if (skipped.length > 0) {
  console.log("--- skipped (nothing was changed for these episodes) ---");
  for (const line of skipped) console.log(line);
  process.exit(1);
}
console.log("Done.");
