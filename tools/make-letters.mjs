#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   The Letter of Provenance, one print-ready PDF per piece (the brief,
   section 12). Run by hand whenever the wording or a colourway changes:

     NODE_PATH=/opt/node-tools/node_modules node tools/make-letters.mjs [--verify]

   Writes letters/KAAL-S01-07-letter.pdf and its nineteen neighbours.

   A5 (148 x 210 mm), for cotton paper: black ink, no background fill, so
   the paper is the paper. Set in the site's own faces, embedded in the PDF
   (Instrument Serif and Inter, the files in assets/fonts). "No. ___ of 20"
   is left blank for hand-writing in ink. The QR code opens that piece's
   page in the public registry (thekaal.co/registry?n=07). There is no
   claim code on the letter: registering happens through the emailed link.

   --verify renders each QR code, reads it back with a decoder, and fails
   if it does not return the address it was drawn from.

   The closing line is the brief's, verbatim.
   ══════════════════════════════════════════════════════════════════ */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const qrcode = require("./vendor/qrcode-generator.cjs");
const { chromium } = require("playwright");
const verify = process.argv.includes("--verify");

const SITE = "https://thekaal.co";
const CLOSING = "Rare pieces find rare people. Twenty were made, and we will not make another. You are not one of many, you are the reason it stopped at twenty.";

/* The pieces, as the registry's own seed has them: number and colourway. */
const seed = readFileSync(join(root, "migrations/0002_seed_series_01.sql"), "utf8");
const manufactured = (/'S01',\s*'Series 01',\s*20,\s*\d+,\s*'INR',\s*\d+,\s*\d+,\s*'([^']+)'/.exec(seed) || [])[1] || "September 2026";
const pieces = [...seed.matchAll(/\('S01-(\d\d)', 'S01',\s*(\d+), '([A-Za-z]+)'/g)].map(m => ({ n: +m[2], colorway: m[3] }));
if (pieces.length !== 20) { console.error(`Expected twenty pieces in the seed, found ${pieces.length}.`); process.exit(1); }

const pad = (n) => (n < 10 ? "0" + n : String(n));
const font = (f) => pathToFileURL(join(root, "assets/fonts", f)).href;

/* The QR code as one SVG path of its dark modules, with a four module quiet zone. */
function qrSvg(url) {
  const q = qrcode(0, "M"); q.addData(url); q.make();
  const c = q.getModuleCount(), z = 4;
  let d = "";
  for (let r = 0; r < c; r++) for (let k = 0; k < c; k++) if (q.isDark(r, k)) d += `M${k + z},${r + z}h1v1h-1z`;
  const size = c + z * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${url}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
}

function html(p) {
  const url = `${SITE}/registry?n=${pad(p.n)}`;
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><title>KAAL Series 01, a letter of provenance</title><style>
@font-face{font-family:Instrument;src:url(${font("InstrumentSerif-latin.woff2")}) format("woff2");font-weight:400;font-style:normal}
@font-face{font-family:Instrument;src:url(${font("InstrumentSerif-italic-latin.woff2")}) format("woff2");font-weight:400;font-style:italic}
@font-face{font-family:InterV;src:url(${font("Inter-wght.woff2")}) format("woff2");font-weight:300 600}
@page{size:148mm 210mm;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:none;color:#141311}
body{width:148mm;height:210mm;padding:17mm 16mm 14mm;font-family:InterV,system-ui,sans-serif;font-weight:300;font-size:9.4pt;line-height:1.6;display:flex;flex-direction:column}
.mark{font-size:7pt;letter-spacing:.5em;text-transform:uppercase;margin:0 0 15mm;text-align:center}
h1{font-family:Instrument,serif;font-weight:400;font-style:italic;font-size:21pt;line-height:1.1;text-align:center;margin:0 0 3mm}
.sub{text-align:center;font-size:7pt;letter-spacing:.3em;text-transform:uppercase;margin:0 0 15mm}
.no{display:flex;align-items:baseline;justify-content:center;gap:3mm;font-family:Instrument,serif;font-size:27pt;line-height:1;margin:0 0 4mm}
.no .blank{display:inline-block;width:46mm;border-bottom:.35mm solid #141311;height:1em}
.no small{font-size:15pt}
.facts{text-align:center;margin:0 0 14mm}
.facts p{margin:0 0 1.2mm}
.warranty{text-align:center;max-width:100mm;margin:0 auto 14mm}
.close{font-family:Instrument,serif;font-style:italic;font-size:14.5pt;line-height:1.35;text-align:center;margin:0 auto;max-width:112mm}
.foot{margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between;gap:8mm;padding-top:8mm}
.qr{width:27mm;height:27mm;flex:none}
.qr svg{width:100%;height:100%;display:block}
.scan{font-size:7.2pt;line-height:1.5;max-width:70mm}
.scan b{font-weight:500;display:block;letter-spacing:.12em;text-transform:uppercase;font-size:6.6pt;margin-bottom:1mm}
.right{text-align:right;font-size:7pt;letter-spacing:.12em;text-transform:uppercase}
</style></head><body>
<p class="mark">KAAL</p>
<h1>Letter of provenance</h1>
<p class="sub">Series 01 &middot; ${p.colorway}</p>
<div class="no"><span>No.</span><span class="blank"></span><small>of 20</small></div>
<div class="facts">
  <p>Series 01, ${p.colorway}. Manufactured ${manufactured}.</p>
</div>
<p class="warranty">Two years' warranty on the movement, from the day it is delivered to you.</p>
<p class="close">${CLOSING}</p>
<div class="foot">
  <div class="qr">${qrSvg(url)}</div>
  <div class="scan"><b>Its place in the registry</b>Scan to see this piece in the public registry, or open ${url.replace("https://", "")}.</div>
  <div class="right">thekaal.co</div>
</div>
</body></html>`;
}

const out = join(root, "letters");
mkdirSync(out, { recursive: true });
const tmp = join(tmpdir(), "kaal-letters");
mkdirSync(tmp, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--allow-file-access-from-files"] });
const page = await browser.newPage();
let bad = 0;
for (const p of pieces) {
  const file = join(tmp, `letter-${pad(p.n)}.html`);
  writeFileSync(file, html(p));
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  const pdf = join(out, `KAAL-S01-${pad(p.n)}-letter.pdf`);
  await page.pdf({ path: pdf, width: "148mm", height: "210mm", printBackground: false, preferCSSPageSize: true });
  if (verify) {
    const { PNG } = require("pngjs"); const jsQR = require("jsqr");
    const el = await page.locator(".qr svg").screenshot({ scale: "device" });
    const png = PNG.sync.read(el);
    const got = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    const want = `${SITE}/registry?n=${pad(p.n)}`;
    const good = got && got.data === want;
    if (!good) bad++;
    console.log((good ? "PASS " : "FAIL ") + `No. ${pad(p.n)}: the QR code reads back as ${got ? got.data : "nothing"}`);
  }
  console.log(`  ${pad(p.n)} ${p.colorway.padEnd(9)} ${(statSync(pdf).size / 1024).toFixed(0)} KB  ${pdf.replace(root, "")}`);
}
await browser.close();
if (bad) { console.error(`${bad} QR code(s) did not read back.`); process.exit(1); }
console.log(`\nTwenty letters written to letters/. Print on cotton paper, A5, at 100%.`);
