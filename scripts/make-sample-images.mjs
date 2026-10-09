// Writes placeholder images for scripts/replace-demo-images.mjs: a cover and, for episodes 1 and 2, original and translated pages 1 and 2.
// The images are plain gradients with the episode and page number drawn on them, so they are easy to tell apart on screen:
// originals are grey, translated pages are coloured and have a light speech-bubble box. Replace them with permitted artwork for a real demo.
//
//   node scripts/make-sample-images.mjs C:\demo-images          # the folder is created; existing files are kept
//   node scripts/make-sample-images.mjs C:\demo-images --force   # overwrite existing files
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const force = args.includes("--force");
const folder = args.find((arg) => !arg.startsWith("--"));
if (!folder) { console.error("Usage: node scripts/make-sample-images.mjs <folder> [--force]"); process.exit(2); }

function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); }

// a 5x7 bitmap font for the characters we need ("1-2" style labels)
const GLYPHS = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"], "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"], "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"], "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
};

/** w x h PNG: a vertical gradient, an optional bubble box and a big label made of GLYPHS. */
function image(w, h, top, bottom, label, bubble) {
  const rows = Array.from({ length: h }, (_, y) => {
    const row = Buffer.alloc(1 + w * 3);
    const t = y / (h - 1);
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) row[1 + x * 3 + k] = Math.round(top[k] + (bottom[k] - top[k]) * t);
    return row;
  });
  const set = (x, y, rgb) => { if (x >= 0 && x < w && y >= 0 && y < h) for (let k = 0; k < 3; k++) rows[y][1 + x * 3 + k] = rgb[k]; };
  if (bubble) for (let y = Math.round(h * 0.08); y < Math.round(h * 0.2); y++) for (let x = Math.round(w * 0.12); x < Math.round(w * 0.62); x++) set(x, y, [245, 245, 245]);
  const scale = Math.max(Math.floor(w / 60), 4), charW = 6 * scale;
  let x0 = Math.round((w - label.length * charW) / 2);
  const y0 = Math.round(h * 0.45);
  for (const ch of label) {
    (GLYPHS[ch] ?? GLYPHS["-"]).forEach((line, gy) => [...line].forEach((bit, gx) => {
      if (bit === "1") for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) set(x0 + gx * scale + dx, y0 + gy * scale + dy, [255, 255, 255]);
    }));
    x0 += charW;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

const PAGE = { w: 700, h: 990 };
const files = [["cover.png", image(600, 800, [120, 90, 200], [30, 20, 70], "1", false)]];
const greys = [[[70, 70, 80], [20, 20, 30]], [[90, 80, 70], [30, 25, 20]]];
const colours = [[[60, 90, 170], [20, 30, 80]], [[170, 110, 60], [80, 40, 20]]];
for (const episode of [1, 2]) {
  for (const page of [1, 2]) {
    files.push([`ep${episode}-original-${page}.png`, image(PAGE.w, PAGE.h, greys[page - 1][0], greys[page - 1][1], `${episode}-${page}`, false)]);
    files.push([`ep${episode}-translated-${page}.png`, image(PAGE.w, PAGE.h, colours[page - 1][0], colours[page - 1][1], `${episode}-${page}`, true)]);
  }
}

mkdirSync(folder, { recursive: true });
let written = 0, kept = 0;
for (const [name, bytes] of files) {
  const path = join(folder, name);
  if (existsSync(path) && !force) { kept++; console.log(`kept (exists): ${name}`); continue; }
  writeFileSync(path, bytes);
  written++;
  console.log(`written: ${name} (${bytes.length} bytes)`);
}
console.log(`Done: ${written} written, ${kept} kept in ${folder}`);
