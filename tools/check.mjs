#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   The whole test suite.

   This site has no build step, so there is no compiler to catch a typo
   and no bundler to notice a missing file. The push IS the deploy: a
   broken tag or a renamed asset is live on thekaal.co within a minute
   of the commit, in front of paid traffic.

   So the checks below are the only thing standing between a mistake and
   a buyer. They run on every push and pull request, in about a second,
   with no dependencies to install and nothing to keep up to date.

   Run it yourself before you push:  node tools/check.mjs
   ══════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const root = process.cwd();
const fail = [], warn = [];
const bad  = (m) => fail.push(m);
const soft = (m) => warn.push(m);

const html = readFileSync(join(root, "index.html"), "utf8");

/* ── 1. The deploy's own furniture. Losing either of these takes the
      custom domain or the whole assets directory off the internet, and
      neither failure looks like a code error when it happens. ────── */
for (const f of ["CNAME", ".nojekyll", "index.html"]) {
  if (!existsSync(join(root, f))) bad(`${f} is missing — GitHub Pages needs it`);
}

/* ── 2. The contract with the sold-sync worker.

      worker/kaal-sold-sync.js finds the edition state with the regex
      /sold:\s*\[([^\]]*)\]/ and rewrites the FIRST match. A second
      `sold:` anywhere earlier in this file — in a comment, in a new
      config block — silently redirects a live payment webhook into the
      wrong string. This check is the only thing that makes that regex
      safe to rely on. ───────────────────────────────────────────── */
const soldHits = (html.match(/sold:/g) || []).length;
if (soldHits !== 1) bad(`index.html contains ${soldHits} occurrences of "sold:" — the worker rewrites the first one and expects exactly 1`);

/* ── 3. The config, read the way the page reads it. ─────────────── */
const cfg = {};
for (const k of ["checkout", "price", "film", "frames", "filmFrames", "filmSeq"]) {
  const m = html.match(new RegExp(`${k}:\\s*"([^"]*)"`));
  if (m) cfg[k] = m[1];
}
const edition = +(html.match(/edition:\s*(\d+)/)?.[1] ?? NaN);
const sold = (html.match(/sold:\s*\[([^\]]*)\]/)?.[1] ?? "")
  .split(",").map(s => parseInt(s, 10)).filter(n => !isNaN(n));
const dialsBlock = html.match(/dials:\s*\{([\s\S]*?)\}/)?.[1] ?? "";
const dials = new Set([...dialsBlock.matchAll(/(\d+)\s*:/g)].map(m => +m[1]));
const dialOf = Object.fromEntries([...dialsBlock.matchAll(/(\d+)\s*:\s*"(\w+)"/g)].map(m => [+m[1], m[2]]));

if (!Number.isFinite(edition) || edition < 1) bad("edition is missing or not a number");
else {
  for (let i = 1; i <= edition; i++) if (!dials.has(i)) bad(`dials has no face for number ${i} — the grid would render it as ivory by default`);
  for (const n of sold) if (n < 1 || n > edition) bad(`sold contains ${n}, which is outside 1..${edition}`);
  if (new Set(sold).size !== sold.length) bad("sold contains a duplicate");
}
if (!cfg.price) bad("price is empty — every price on the page reads from it");
if (!cfg.checkout) soft("checkout is empty: the page will render, and it cannot take money");

/* ── 3b. The price, written down twice.

      Standard checkout is priced by the worker, never by the browser:
      the page is told what a watch costs and is not asked. That makes
      PRICE_PAISE in wrangler.toml a second copy of `price` up there, and
      a second copy of a number money depends on is only safe for as
      long as something compares them. A page reading ₹5,999 beside a
      worker charging ₹4,999 is a bug that nobody sees until it is in a
      bank statement. ───────────────────────────────────────────────── */
const payMode = html.match(/pay:\s*"([^"]*)"/)?.[1] ?? "";
const apiUrl  = html.match(/api:\s*"([^"]*)"/)?.[1] ?? "";
if (payMode && payMode !== "standard")
  bad(`pay is "${payMode}" — the only values are "" (hosted payment page) and "standard"`);
if (payMode === "standard" && !apiUrl)
  bad("pay is \"standard\" but api is empty — the page has no worker to create an order with, so every button fails");

if (existsSync(join(root, "wrangler.toml"))) {
  const toml = readFileSync(join(root, "wrangler.toml"), "utf8");
  const paise = toml.match(/^\s*PRICE_PAISE\s*=\s*"(\d+)"/m)?.[1];
  const rupees = cfg.price ? +cfg.price.replace(/[^\d]/g, "") : NaN;
  if (!paise) {
    (payMode === "standard" ? bad : soft)("wrangler.toml sets no PRICE_PAISE — /order cannot price a watch without it");
  } else if (+paise < 100) {
    bad(`PRICE_PAISE is ${paise}; Razorpay rejects anything under 100 paise`);
  } else if (Number.isFinite(rupees) && rupees > 0 && +paise !== rupees * 100) {
    bad(`price is ₹${cfg.price} but wrangler.toml charges ${paise} paise (₹${+paise / 100}) — they must agree`);
  }
} else if (payMode === "standard") {
  bad("pay is \"standard\" but there is no wrangler.toml — nothing defines the price the buyer is charged");
}
/* ── 3c. The hero sequence.

      The frames are files now, not a transform someone else computes on
      request, and a file is the one kind of dependency that can go
      missing in a rename without anything complaining until a buyer sees
      a black hero. The page asks for `${filmSeq}${tier}/${000..n-1}.webp`
      and nothing else, so that is exactly what is checked: the count in
      the config IS the count on disk, and every index between is there.

      Run tools/bake-hero-seq.sh to regenerate them. ───────────────── */
if (cfg.filmSeq) {
  if (/^https?:|^\/\//.test(cfg.filmSeq))
    bad("filmSeq points at another origin — the hero sequence is meant to be served from this repo");
  else if (!cfg.filmSeq.endsWith("/"))
    bad("filmSeq must end in a slash — the page appends the tier directory to it");
  else {
    const counts = { tall: +(html.match(/frameCountSmall:\s*(\d+)/)?.[1] ?? NaN),
                     wide: +(html.match(/frameCount:\s*(\d+)/)?.[1] ?? NaN) };
    for (const [tier, n] of Object.entries(counts)) {
      const dir = join(root, cfg.filmSeq, tier);
      if (!Number.isFinite(n) || n < 2) { bad(`no frame count configured for the ${tier} tier`); continue; }
      if (!existsSync(dir)) { bad(`hero sequence missing: ${cfg.filmSeq}${tier}/ — run tools/bake-hero-seq.sh`); continue; }
      const missing = [];
      let bytes = 0;
      for (let i = 0; i < n; i++) {
        const f = join(dir, `${String(i).padStart(3, "0")}.webp`);
        if (existsSync(f)) bytes += statSync(f).size; else missing.push(i);
      }
      if (missing.length)
        bad(`${cfg.filmSeq}${tier}/ is missing ${missing.length} frame(s): ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "…" : ""}`);
      const extra = readdirSync(dir).filter(f => f.endsWith(".webp")).length - n;
      if (extra > 0) bad(`${cfg.filmSeq}${tier}/ holds ${extra} more .webp than frameCount says — the page will never request them`);

      /* A phone pays for these on cellular before it sees anything move.
         Not a failure — it is a judgement call, and it should be a loud
         one the moment somebody re-bakes at a higher quality. */
      const budget = tier === "tall" ? 1.4e6 : 4.0e6;
      if (bytes > budget)
        soft(`${tier} sequence is ${(bytes / 1e6).toFixed(2)}MB over ${n} frames — above the ${(budget / 1e6).toFixed(1)}MB this hero budgets`);

      /* n-1 is the stride's denominator: an evenly spaced subset can only
         exist if it has whole divisors, and without one a weak device
         gets a film whose motion speeds up and slows down. */
      const span = n - 1;
      if (span % 2 && span % 3)
        bad(`${tier} has ${n} frames, so n-1 = ${span} divides by neither 2 nor 3 — a reduced device cannot take an evenly spaced subset`);
    }
  }
} else {
  soft("filmSeq is empty: the hero never loads the film and the still is the hero");
}
if (cfg.filmFrames)
  bad("filmFrames is back in the config — the hero is served from filmSeq now and must not reach for another origin");

/* ── 3d. The hero's depth planes, and the one number two files share.

      The film is scaled up so the parallax drift has margin to move
      inside it. The stylesheet sets that scale on .stage canvas/.still
      and the script derives the same number from KAAL.heroDrift. If the
      stylesheet's is the smaller of the two, the ends of the scrub run
      the picture out of itself and put a black band across the hero —
      on a phone, in front of paid traffic, and only at the ends, which
      is exactly the kind of thing that survives a desk review.

      So the arithmetic is checked here rather than trusted to the two
      comments that ask a reader to keep them in step. ─────────────── */
const drift = parseFloat(html.match(/heroDrift:\s*([\d.]+)/)?.[1] ?? "NaN");
const push  = parseFloat(html.match(/heroPush:\s*([\d.]+)/)?.[1] ?? "0");
const cssLift = parseFloat(
  html.match(/\.stage canvas,\.stage \.still\{[\s\S]*?transform:scale\(([\d.]+)\)/)?.[1] ?? "NaN");

if (!Number.isFinite(drift)) {
  bad("heroDrift is missing or not a number — the hero depth planes read it");
} else if (drift > 0) {
  if (!Number.isFinite(cssLift)) {
    bad("could not read the base scale off .stage canvas/.still — the depth check cannot verify the drift has margin");
  } else {
    /* Mirrors FILM_LIFT in the script: ceil to 2dp of 1 + drift + 0.005. */
    const jsLift = Math.ceil(+((1 / (1 - Math.min(drift, 0.12)) + 0.02) * 100).toFixed(4)) / 100;
    if (Math.abs(cssLift - jsLift) > 0.0001)
      bad(`heroDrift ${drift} needs a base scale of ${jsLift}, but the stylesheet sets scale(${cssLift}) — at the ends of the scrub the hero shows an edge`);
  }
  if (drift > 0.12) soft(`heroDrift is ${drift}; the script clamps it to 0.12, so the stylesheet and the script will disagree`);
  if (push > 0.06)  soft(`heroPush is ${push}; the script clamps it to 0.06`);
}

/* The caption plane is driven by id, and a renamed id fails silently:
   the transform is written to nothing and one of the three planes just
   stops, which looks like taste rather than a bug. */
if (drift > 0 && !/id="caps"/.test(html))
  bad('#caps is missing — the hero caption depth plane is driven by that id and would silently stop');
if (cfg.frames && !(cfg.frames.includes("{T}") && cfg.frames.includes("{W}")))
  bad("frames must carry {T} and {W}");
if (cfg.frames && cfg.frames.includes("{H}"))
  bad("frames is the photograph fallback and is used without {H} — an {H} here ships a literal '{H}' in the URL");

/* ── 4. Markup that a browser will silently forgive and a reader will
      not: a duplicated id breaks every $() lookup after it. ─────── */
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const dupe = ids.filter((v, i) => ids.indexOf(v) !== i);
if (dupe.length) bad(`duplicate id(s): ${[...new Set(dupe)].join(", ")}`);

/* ── 5. Every local file ANY page asks for must exist, case exactly.
      Pages is case sensitive; a Mac is not. ─────────────────────── */
const pages = ["index.html", "manifesto.html", "about.html", "legal.html", "claimed.html"].filter(f => existsSync(join(root, f)));
const refs = new Set();
for (const f of pages) {
  for (const m of readFileSync(join(root, f), "utf8").matchAll(/(?:src|href)="([^"#?:]+)"/g)) {
    const u = m[1];
    if (u.startsWith("http") || u.startsWith("//") || u.startsWith("mailto") || u.startsWith("data:")) continue;
    if (u === "/") continue;
    refs.add(u.replace(/^\.\//, ""));
  }
}
for (const r of refs) {
  const p = join(root, r);
  if (!existsSync(p)) {
    /* The eight photographs are a known pending state with a designed
       fallback, so they are a warning and never a failure. */
    if (r.startsWith("assets/img/")) soft(`asset not present (page falls back by design): ${r}`);
    else bad(`referenced file does not exist: ${r}`);
  }
}

/* ── 6. The script actually parses. ─────────────────────────────── */
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!blocks.length) bad("no inline script found — did a tag get mangled?");
const dir = mkdtempSync(join(tmpdir(), "kaal-"));
blocks.forEach((b, i) => {
  const f = join(dir, `b${i}.js`);
  writeFileSync(f, b);
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { bad(`inline script block ${i + 1} does not parse: ${String(e.stderr || e).split("\n").slice(0, 3).join(" ")}`); }
});

/* ── 6b. Structured data. It is the one part of the page no reader will
      ever notice is broken, and the part an answer engine reads first.
      A JSON-LD block that does not parse is simply discarded in silence. */
for (const f of pages) {
  const t = readFileSync(join(root, f), "utf8");
  const blocks = [...t.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  for (const [i, blk] of blocks.entries()) {
    try { JSON.parse(blk); }
    catch (e) { bad(`${f}: JSON-LD block ${i + 1} does not parse — ${String(e.message).slice(0, 80)}`); }
  }
  if (f === "index.html" && !blocks.length) soft("index.html carries no structured data");
  const robotsMetas = (t.match(/<meta\s+name="robots"/gi) || []).length;
  if (robotsMetas > 1) bad(`${f} has ${robotsMetas} robots meta tags — a crawler reads the most restrictive and the intent becomes a guess`);
  if (!/<link rel="canonical"/.test(t) && f !== "claimed.html") soft(`${f} has no canonical link`);
}

/* ── 6b-ii. The ItemList in the structured data names a dial for each of the
      twenty. That is a second copy of KAAL.dials, and a second copy is only
      safe while something compares them. */
{
  const ld = html.match(/"@type":\s*"ItemList"[\s\S]*?"itemListElement":\s*\[([\s\S]*?)\]/);
  if (!ld) soft("index.html has no ItemList in its structured data");
  else {
    const NAMES = { emerald: "Emerald", midnight: "Midnight", champagne: "Champagne", ivory: "Ivory" };
    const listed = [...ld[1].matchAll(/"position":\s*(\d+),\s*"name":\s*"[^"]*No\.\s*(\d+)[^"]*?(Emerald|Midnight|Champagne|Ivory) dial"/g)];
    if (listed.length !== edition) bad(`ItemList names ${listed.length} pieces but the edition is ${edition}`);
    for (const [, pos, no, dial] of listed) {
      if (+pos !== +no) bad(`ItemList position ${pos} is labelled No. ${no}`);
      const want = NAMES[dialOf[+no]];
      if (want && want !== dial) bad(`ItemList says No. ${no} carries ${dial}; KAAL.dials says ${want}`);
    }
  }
}

/* ── 6c. Crawl surface. A sitemap naming a page that does not exist is
      worse than no sitemap, and robots.txt is the file that decides
      whether any of this is read at all. ───────────────────────────── */
if (!existsSync(join(root, "robots.txt"))) soft("no robots.txt");
if (!existsSync(join(root, "llms.txt"))) soft("no llms.txt");
else {
  const llms = readFileSync(join(root, "llms.txt"), "utf8");
  if (!/thekaal\.co/.test(llms)) bad("llms.txt does not name the site");
  if (cfg.price && !llms.includes(cfg.price)) bad(`llms.txt does not carry the current price (${cfg.price})`);
}
if (!existsSync(join(root, "sitemap.xml"))) soft("no sitemap.xml");
else {
  const sm = readFileSync(join(root, "sitemap.xml"), "utf8");
  const locs = [...sm.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
  if (!locs.length) bad("sitemap.xml lists no URLs");
  for (const loc of locs) {
    const path = loc.replace(/^https?:\/\/[^/]+\//, "");
    const target = path === "" ? "index.html" : path;
    if (!existsSync(join(root, target))) bad(`sitemap.xml lists ${loc}, which does not exist in the repo`);
  }
  const robots = existsSync(join(root, "robots.txt")) ? readFileSync(join(root, "robots.txt"), "utf8") : "";
  if (robots && !/^\s*Sitemap:/mi.test(robots)) soft("robots.txt does not point at the sitemap");
  if (/^\s*Disallow:\s*\/\s*$/mi.test(robots)) bad("robots.txt disallows the whole site");
}

/* ── 7. Nothing that looks like a credential. ───────────────────── */
for (const f of [...pages, "worker/kaal-sold-sync.js"]) {
  if (!existsSync(join(root, f))) continue;
  const t = readFileSync(join(root, f), "utf8");
  for (const [name, re] of [
    ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
    ["Razorpay key", /\brzp_(live|test)_[A-Za-z0-9]{10,}/],
    ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
    ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/]
  ]) if (re.test(t)) bad(`${f} looks like it contains a ${name}`);
}

/* ── 8. Weight of the first screen. Not a budget anyone has to hit,
      a number nobody should change without noticing. ───────────── */
const kb = (p) => existsSync(p) ? Math.round(statSync(p).size / 1024) : 0;
const pageKb = kb(join(root, "index.html"));
const fontKb = ["InstrumentSerif-latin", "Inter-wght"].reduce((a, f) => a + kb(join(root, `assets/fonts/${f}.woff2`)), 0);
if (pageKb > 140) soft(`index.html is ${pageKb}KB — it was around 90KB; worth knowing why`);

console.log(`index.html ${pageKb}KB · preloaded fonts ${fontKb}KB · edition ${edition} · ${sold.length} sold · ${refs.size} local references`);
for (const w of warn) console.log(`  note  ${w}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(fail.length ? `\n${fail.length} problem(s). Not shippable.` : `\nAll checks passed.`);
process.exit(fail.length ? 1 : 0);
