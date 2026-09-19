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
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const root = process.cwd();
const fail = [], warn = [];
const bad  = (m) => fail.push(m);
const soft = (m) => warn.push(m);

const html = readFileSync(join(root, "index.html"), "utf8");
const pagesAll = () => ["index.html", "manifesto.html", "legal.html", "claimed.html"].filter(f => existsSync(join(root, f)));

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
for (const k of ["checkout", "price", "film", "frames", "filmFrames"]) {
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
if (cfg.filmFrames && !(cfg.filmFrames.includes("{W}") && cfg.filmFrames.includes("{H}") && cfg.filmFrames.includes("{T}")))
  bad("filmFrames must carry {T}, {W} and {H} — the hero sizes its own request");
if (cfg.frames && !(cfg.frames.includes("{T}") && cfg.frames.includes("{W}")))
  bad("frames must carry {T} and {W}");
if (cfg.frames && cfg.frames.includes("{H}"))
  bad("frames is the photograph fallback and is used without {H} — an {H} here ships a literal '{H}' in the URL");

/* ── 3b. THE SECURITY GATES.

      Everything here is a control that is worthless the moment somebody
      edits it out by accident, so each one is asserted rather than
      trusted. These are the checks that stand between a mistake and a
      buyer's money, which is a different category from a broken layout.
      ──────────────────────────────────────────────────────────────── */

/* The checkout URL. A buyer clicking Claim leaves this site with their
   card; where they land is decided by this one string. The page refuses
   at runtime to link anywhere outside checkoutHosts — this refuses to
   deploy it at all, which is the half that happens before the traffic. */
const hostsRaw = html.match(/checkoutHosts:\s*\[([^\]]*)\]/)?.[1] ?? "";
const checkoutHosts = [...hostsRaw.matchAll(/"([^"]+)"/g)].map(m => m[1].toLowerCase());
if (!checkoutHosts.length) bad("checkoutHosts is missing or empty — the page would refuse every checkout link");
for (const h of checkoutHosts) {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) bad(`checkoutHosts contains "${h}", which is not a bare hostname`);
  if (h === "com" || h === "io" || h.split(".").length < 2) bad(`checkoutHosts entry "${h}" is too broad`);
}
if (cfg.checkout) {
  let u = null;
  try { u = new URL(cfg.checkout); } catch (e) { bad("checkout is not a valid URL"); }
  if (u) {
    if (u.protocol !== "https:") bad("checkout is not https — a payment link must never be plain http");
    const ok = checkoutHosts.some(h => u.hostname === h || u.hostname.endsWith("." + h));
    if (!ok) bad(`checkout points at ${u.hostname}, which is not in checkoutHosts — the live page will refuse to link to it`);
  }
}

/* The Content-Security-Policy. GitHub Pages sends no headers, so the
   meta tag is the entire policy; a page that loses it loses every
   restriction at once and nothing about the page looks different. */
const MUST_HAVE = ["default-src 'none'", "base-uri 'none'", "object-src 'none'", "frame-src 'none'", "form-action 'none'"];
for (const f of ["index.html", "manifesto.html", "legal.html", "claimed.html"]) {
  if (!existsSync(join(root, f))) continue;
  const t = readFileSync(join(root, f), "utf8");
  const csp = t.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  if (!csp) { bad(`${f} has no Content-Security-Policy meta tag`); continue; }
  for (const d of MUST_HAVE) if (!csp.includes(d)) bad(`${f} CSP is missing ${d}`);
  if (/script-src[^;]*\bhttps?:(?!\/)/.test(csp) || /script-src[^;]*\*/.test(csp))
    bad(`${f} CSP allows scripts from a wildcard or a bare scheme`);
  if (!/window\.self !== window\.top/.test(t))
    bad(`${f} has no frame guard — frame-ancestors cannot be set from a meta tag, so the script is the only clickjacking defence`);
}

/* connect-src and the worker. The page's one cross-origin call is
   KAAL.api. Set it without naming its origin in the CSP and the browser
   blocks /state silently: the page keeps working on a stale sold array
   and nothing anywhere says why. */
const apiUrl = html.match(/api:\s*"([^"]*)"/)?.[1] ?? "";
if (apiUrl) {
  let a = null;
  try { a = new URL(apiUrl); } catch (e) { bad("api is set but is not a valid URL"); }
  if (a) {
    if (a.protocol !== "https:") bad("api is not https");
    const csp = html.match(/content="([^"]*connect-src[^"]*)"/)?.[1] ?? "";
    const connect = csp.match(/connect-src([^;]*)/)?.[1] ?? "";
    if (!connect.includes(a.origin)) bad(`api is ${a.origin} but the CSP connect-src does not allow it — the live page would fail to read the edition state`);
  }
}

/* Outbound links and plain http. A target="_blank" without rel="noopener"
   hands the opened page a handle on this one. */
for (const f of pagesAll()) {
  const t = readFileSync(join(root, f), "utf8");
  for (const m of t.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g))
    if (!/rel="[^"]*noopener/.test(m[0])) bad(`${f} has a target="_blank" link without rel="noopener": ${m[0].slice(0, 80)}`);
  for (const m of t.matchAll(/(?:src|href)="(http:\/\/[^"]+)"/g))
    if (!m[1].startsWith("http://www.w3.org/")) bad(`${f} loads ${m[1]} over plain http`);
}

/* The worker's own money check. AMOUNT_CHECK=off is a documented escape
   hatch; it is not something that should ever be committed. */
if (existsSync(join(root, "wrangler.toml"))) {
  const w = readFileSync(join(root, "wrangler.toml"), "utf8");
  if (/^\s*AMOUNT_CHECK\s*=\s*["']off/mi.test(w)) bad("wrangler.toml turns AMOUNT_CHECK off — any cheap payment on the Razorpay account could then mark a number sold");
  if (/RAZORPAY_WEBHOOK_SECRET\s*=/.test(w) || /GITHUB_TOKEN\s*=/.test(w) || /ALERT_TOKEN\s*=/.test(w))
    bad("wrangler.toml assigns a secret — secrets belong in `wrangler secret put`, never in a file that is committed");
}

/* ── 4. Markup that a browser will silently forgive and a reader will
      not: a duplicated id breaks every $() lookup after it. ─────── */
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const dupe = ids.filter((v, i) => ids.indexOf(v) !== i);
if (dupe.length) bad(`duplicate id(s): ${[...new Set(dupe)].join(", ")}`);

/* ── 5. Every local file ANY page asks for must exist, case exactly.
      Pages is case sensitive; a Mac is not. ─────────────────────── */
const pages = ["index.html", "manifesto.html", "legal.html", "claimed.html"].filter(f => existsSync(join(root, f)));
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
for (const f of [...pages, "worker/kaal-sold-sync.js", "wrangler.toml", "README.md", ".github/workflows/check.yml"]) {
  if (!existsSync(join(root, f))) continue;
  const t = readFileSync(join(root, f), "utf8");
  for (const [name, re] of [
    ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
    ["Razorpay key", /\brzp_(live|test)_[A-Za-z0-9]{10,}/],
    ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
    ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    /* Razorpay's key secret and webhook secret have no fixed prefix, so
       the only honest check is "a secret-shaped value assigned to a name
       that says secret". It will nag about a placeholder one day; that is
       a far better failure than the other one. */
    ["hardcoded secret", /\b(secret|token|password|passwd|api[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_\-\/+=]{16,}["']/i],
    ["Stripe key", /\bsk_(live|test)_[A-Za-z0-9]{16,}/],
    ["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
    ["Google API key", /\bAIza[0-9A-Za-z_\-]{35}\b/]
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
