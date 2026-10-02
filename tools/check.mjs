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
for (const k of ["checkout", "price", "frames", "filmFrames", "filmSeq"]) {
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
if (payMode !== "standard" && !cfg.checkout)
  soft("pay is not \"standard\" and checkout is empty: the page will render, and it cannot take money");

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
/* ── 3b-ii. The dial map the sale emails use, against the page's own. ── */
if (existsSync(join(root, "wrangler.toml"))) {
  const toml = readFileSync(join(root, "wrangler.toml"), "utf8");
  const raw = toml.match(/^\s*DIALS\s*=\s*'([^']*)'/m)?.[1];
  if (raw) {
    let map = null;
    try { map = JSON.parse(raw); } catch { bad("wrangler.toml DIALS is not valid JSON"); }
    if (map) for (let i = 1; i <= edition; i++) {
      const want = dialOf[i] ? dialOf[i][0].toUpperCase() + dialOf[i].slice(1) : "";
      if (map[String(i)] !== want) bad(`wrangler.toml DIALS says No. ${i} is ${map[String(i)]}; KAAL.dials says ${want} — the sale email would name the wrong dial`);
    }
  }
}

/* The thank-you page names the dial too, from its own mirror of the map. */
if (existsSync(join(root, "claimed.html"))) {
  const c = readFileSync(join(root, "claimed.html"), "utf8");
  const raw = c.match(/var DIALS = \{([^}]*)\}/)?.[1];
  if (!raw) soft("claimed.html carries no DIALS map — the receipt cannot name the dial");
  else {
    const map = Object.fromEntries([...raw.matchAll(/(\d+):"(\w+)"/g)].map(m => [+m[1], m[2]]));
    for (let i = 1; i <= edition; i++) {
      const want = dialOf[i] ? dialOf[i][0].toUpperCase() + dialOf[i].slice(1) : "";
      if (map[i] !== want) bad(`claimed.html DIALS says No. ${i} is ${map[i]}; KAAL.dials says ${want}`);
    }
  }
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
    const counts = { tall:        +(html.match(/frameCountSmall:\s*(\d+)/)?.[1] ?? NaN),
                     plate:       +(html.match(/frameCount:\s*(\d+)/)?.[1] ?? NaN),
                     "plate-low": +(html.match(/frameCountLow:\s*(\d+)/)?.[1] ?? NaN) };
    const size = { tall: [608, 1080], plate: [1080, 1080], "plate-low": [720, 720] };
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
      if (extra > 0) bad(`${cfg.filmSeq}${tier}/ holds ${extra} more .webp than its frame count says — the page will never request them`);

      /* What a device downloads before the film is whole. The loader goes
         coarse to fine, so the scrub works after the first ~26 files and
         this total only decides how long the last passes take — but it is
         still paid on cellular, so it is a loud number the moment somebody
         re-bakes at a higher quality or a bigger size. The ceilings are the
         October 2026 bake (q72: 8.82, 14.51 and 4.61MB) plus 8%. */
      const budget = { tall: 9.5e6, plate: 15.7e6, "plate-low": 5.0e6 }[tier];
      if (bytes > budget)
        soft(`${tier} sequence is ${(bytes / 1e6).toFixed(2)}MB over ${n} frames — above the ${(budget / 1e6).toFixed(1)}MB this hero budgets`);

      /* The page holds every frame ENCODED and decodes only a window of
         them (frameWindow: ±8..24 frames), so bitmap memory caps the
         window, not the count — the old "too many frames to hold" failure
         no longer describes anything. What can still go wrong is the
         window outgrowing the most generous budget it is given. */
      const [w, h] = size[tier], perFrame = w * h * 4;
      if (49 * perFrame > 280e6)
        bad(`${tier} frames are ${w}x${h}: a ±24 decoded window is ${(49 * perFrame / 1e6).toFixed(0)}MB, over the 280MB ceiling frameWindow() allows`);

      /* n-1 is the stride's denominator: an evenly spaced subset can only
         exist if it has whole divisors, and without one a weak device
         gets a film whose motion speeds up and slows down. */
      const span = n - 1;
      if (span % 2 && span % 3)
        bad(`${tier} has ${n} frames, so n-1 = ${span} divides by neither 2 nor 3 — a reduced device cannot take an evenly spaced subset`);
    }
    /* The low plate is every second frame of the film, and the cut map
       depends on that being exact. */
    if (Number.isFinite(counts.plate) && Number.isFinite(counts["plate-low"]) &&
        (counts.plate - 1) % (counts["plate-low"] - 1))
      bad(`plate-low has ${counts["plate-low"]} frames, which is not an even subset of the plate's ${counts.plate} — the cut map would land between frames`);

    /* The sharp frames a phone lays over the film at rest. One file for
       every frame of the phone tier, at the film's own size, or a pause
       asks for a file that is not there and the picture stays soft. */
    if (/tall-hd\//.test(html) && Number.isFinite(counts.tall)) {
      const dir = join(root, cfg.filmSeq, "tall-hd");
      if (!existsSync(dir)) bad(`${cfg.filmSeq}tall-hd/ is missing — run ONLY=tall-hd tools/bake-hero-seq.sh`);
      else {
        const missing = [];
        for (let i = 0; i < counts.tall; i++) if (!existsSync(join(dir, String(i).padStart(3, "0") + ".webp"))) missing.push(i);
        if (missing.length) bad(`${cfg.filmSeq}tall-hd/ is missing ${missing.length} frame(s): ${missing.slice(0, 6).join(", ")}`);
        const big = readdirSync(dir).filter(f => statSync(join(dir, f)).size > 90e3);
        if (big.length) soft(`${big.length} tall-hd frame(s) over 90KB — each is one whole download on a pause`);
      }
    }

    /* The cuts. The painter never dissolves across one, so a cut index
       outside the film, or out of order, silently re-enables a double
       exposure of two different rooms. */
    const cutsRaw = html.match(/filmCuts:\s*\[([^\]]*)\]/)?.[1];
    if (cutsRaw === undefined) soft("filmCuts is not configured — the scrub will dissolve across the film's hard cuts");
    else {
      const cuts = cutsRaw.split(",").map(x => parseInt(x, 10)).filter(x => !isNaN(x));
      for (let i = 0; i < cuts.length; i++) {
        if (cuts[i] < 1 || cuts[i] > counts.plate - 1) bad(`filmCuts has ${cuts[i]}, outside the film's 1..${counts.plate - 1}`);
        if (i && cuts[i] <= cuts[i - 1]) bad("filmCuts must be in ascending order");
      }
    }

    /* The poster is frame 000 of each tier, served by a <picture> and
       preloaded by a media-matched <link>. If either names a file that is
       not the tier's first frame, the canvas takes over from a different
       picture and the handover jumps. */
    for (const t of ["tall", "plate"]) {
      const f = `${cfg.filmSeq}${t}/000.webp`;
      if (!html.includes(`<link rel="preload" href="${f}"`)) bad(`no preload for the ${t} poster (${f})`);
      if (!html.includes(`srcset="${f} `)) bad(`the hero <picture> does not serve ${f}`);
    }
  }
} else {
  soft("filmSeq is empty: the hero never loads the film and the still is the hero");
}
if (cfg.filmFrames)
  bad("filmFrames is back in the config — the hero is served from filmSeq now and must not reach for another origin");

/* ── 3d. The hero camera, and the planes the script drives by id.

      The camera pushes in from 1 and never goes below it, so unlike the
      old drift model it needs no overscale margin and there is no second
      number in the stylesheet to keep in step. What can still break
      silently is an id: every hero plane is driven by one, and a renamed
      id writes its transform to nothing, which looks like taste rather
      than a bug. ─────────────────────────────────────────────────── */
const push = parseFloat(html.match(/heroPush:\s*([\d.]+)/)?.[1] ?? "NaN");
if (!Number.isFinite(push)) bad("heroPush is missing or not a number — the hero camera reads it");
else if (push > 0.25) soft(`heroPush is ${push}; the script clamps it to 0.25`);
if (/heroDrift:/.test(html)) bad("heroDrift is back in the config — the drift model was replaced by the camera, and nothing reads it");
for (const id of ["cam", "seq", "still", "caps", "heroDim", "stage", "hero"])
  if (!new RegExp(`id="${id}"`).test(html)) bad(`#${id} is missing — a hero plane is driven by that id and would silently stop`);
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
      Pages is case sensitive; a Mac is not.

      The pages are whatever .html sits at the root, read off the disk.
      This was a hand-kept list, and a hand-kept list is the one place a
      new page is guaranteed to be forgotten — it had already missed
      404.html, so nothing below had ever looked at it. ─────────────── */
const pages = readdirSync(root).filter(f => f.endsWith(".html")).sort();
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
  /* A film is fetched on a tap, on whatever connection the tap happens on.
     12MB is the ceiling for playing through on ordinary 4G without a stall;
     the box film was encoded to 6.5MB against it. */
  if (/\.(mp4|webm)$/i.test(r) && existsSync(p) && statSync(p).size > 12e6)
    soft(`${r} is ${(statSync(p).size / 1e6).toFixed(1)}MB — above the 12MB a phone on 4G plays through without stalling`);
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
      A JSON-LD block that does not parse is simply discarded in silence.

      The tag is found by its type wherever the attribute sits. This used
      to match only a tag that opened with type=, so a block written
      <script id="…" type="application/ld+json"> was never read at all —
      skipped rather than failed, which is the same silence one step
      earlier. Every ld+json tag is now counted separately, so one the
      parser cannot pair with a closing tag is a failure, not a pass. ── */
for (const f of pages) {
  const t = readFileSync(join(root, f), "utf8");
  const ldTag = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>/gi;
  const tags = (t.match(ldTag) || []).length;
  const blocks = [...t.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  if (tags !== blocks.length) bad(`${f}: ${tags} JSON-LD tag(s) but only ${blocks.length} readable block(s) — one is unclosed or malformed`);
  for (const [i, blk] of blocks.entries()) {
    let ld;
    try { ld = JSON.parse(blk); }
    catch (e) { bad(`${f}: JSON-LD block ${i + 1} does not parse — ${String(e.message).slice(0, 80)}`); continue; }
    /* Valid JSON is not yet structured data. Without a schema.org context
       every type in it is a bare word, and the block is read as nothing. */
    if (!/schema\.org/.test(JSON.stringify(ld && ld["@context"] || "")))
      bad(`${f}: JSON-LD block ${i + 1} has no schema.org @context — it parses and means nothing`);

    /* Media the structured data points at. These are absolute URLs, so the
       src/href sweep in §5 never sees them — and a VideoObject whose file or
       thumbnail is missing is dropped by every engine that fetches it, while
       the page itself still looks fine. A video also has to carry what a
       video result needs, or it is never shown as one. */
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      for (const k of ["contentUrl", "thumbnailUrl"]) {
        for (const u of [].concat(n[k] || [])) {
          const local = String(u).match(/^https:\/\/thekaal\.co\/(.+)$/)?.[1];
          if (local && !existsSync(join(root, local))) bad(`${f}: JSON-LD ${k} ${u} is not in the repo`);
        }
      }
      if (n["@type"] === "VideoObject") {
        for (const k of ["name", "description", "thumbnailUrl", "uploadDate", "contentUrl"])
          if (!n[k]) bad(`${f}: VideoObject ${n["@id"] || ""} has no ${k} — it cannot appear as a video result`);
        if (n.duration && !/^PT(\d+H)?(\d+M)?(\d+(\.\d+)?S)?$/.test(n.duration))
          bad(`${f}: VideoObject duration "${n.duration}" is not ISO 8601`);
      }
      Object.values(n).forEach(walk);
    };
    walk(ld);
  }
  if (f === "index.html" && !blocks.length) soft("index.html carries no structured data");
  const robotsMetas = (t.match(/<meta\s+name="robots"/gi) || []).length;
  if (robotsMetas > 1) bad(`${f} has ${robotsMetas} robots meta tags — a crawler reads the most restrictive and the intent becomes a guess`);
  if (!/<link rel="canonical"/.test(t) && f !== "claimed.html" && f !== "404.html") soft(`${f} has no canonical link`);
}

/* ── 6b-ii. The edition, in the structured data, against the config.

      The ProductGroup carries a hasVariant entry per number, seeded into
      the HTML so that crawlers which do not run JavaScript still see the
      twenty. That makes it a second copy of KAAL.dials and KAAL.sold, and
      a second copy of the edition is only safe for as long as something
      compares it to the first. driveSchema() overwrites it at runtime, so
      a drift here is invisible in a browser and visible to every crawler
      that matters — which is the worst possible place to put a mistake.

      Run tools/check.mjs after editing dials or sold. ───────────────── */
{
  const ld = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!ld) soft("index.html has no JSON-LD block to check the edition against");
  else {
    let graph;
    try { graph = JSON.parse(ld[1]); } catch { graph = null; }
    const group = graph && (graph["@graph"] || []).find(n => n["@type"] === "ProductGroup");
    if (!group) soft("index.html has no ProductGroup in its structured data");
    else {
      const NAMES = { emerald: "Emerald", midnight: "Midnight", champagne: "Champagne", ivory: "Ivory" };
      const vs = group.hasVariant || [];
      if (!vs.length)
        bad("ProductGroup.hasVariant is empty — it is seeded so that crawlers which do not execute JavaScript still see the twenty; an empty array ships the edition to none of them");
      else if (vs.length !== edition)
        bad(`ProductGroup.hasVariant holds ${vs.length} pieces but the edition is ${edition}`);
      /* The parent's static value is LimitedAvailability, which is true from
         the first piece to the nineteenth. driveSchema() narrows it to the
         exact answer wherever JavaScript runs. InStock baked here would be
         a guess and SoldOut would be a lie. */
      const parent = group.offers && group.offers.availability || "";
      if (sold.length < edition && !parent.endsWith("LimitedAvailability"))
        bad(`ProductGroup.offers.availability is ${parent.split("/").pop() || "missing"}; while the edition is open the static value should be LimitedAvailability`);
      for (const v of vs) {
        const n = +String(v.sku || "").replace(/\D/g, "");
        if (!n || n < 1 || n > edition) { bad(`hasVariant has sku "${v.sku}", which is not a number in 1..${edition}`); continue; }
        const want = NAMES[dialOf[n]];
        if (want && v.color !== want) bad(`hasVariant says No. ${n} is ${v.color}; KAAL.dials says ${want}`);
        if (want && !String(v.name || "").includes(want)) bad(`hasVariant name for No. ${n} does not name its dial: "${v.name}"`);
        /* The seeded variants must NOT carry an availability.
           worker/kaal-sold-sync rewrites exactly one thing in index.html —
           the `sold:` array — so a baked availability is stale from the
           first sale and there is nothing in this system that would ever
           correct it. driveSchema() supplies it at runtime instead. The
           next person to add one will have a good reason and no way to
           know that, so the build says it here. */
        if (v.offers && v.offers.availability)
          bad(`hasVariant No. ${n} carries an availability. The worker rewrites only the sold: array, so a baked one is stale from the first sale — leave it to driveSchema()`);
        const paid = v.offers && String(v.offers.price || "");
        const want$ = cfg.price ? cfg.price.replace(/[^0-9]/g, "") : "";
        if (want$ && paid !== want$) bad(`hasVariant No. ${n} is priced ${paid}; the config says ${want$}`);
      }
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
  /* The dates are written by tools/gen-sitemap.mjs from git history, on
     every push to main (indexnow.yml), never by hand. What is checked here
     is only that each one is a real W3C date and not in the future — a
     lastmod a crawler cannot parse or cannot believe is ignored, and a
     sitemap whose dates are ignored has told the crawler nothing. */
  const today = new Date().toISOString().slice(0, 10);
  for (const [, block] of sm.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = block.match(/<loc>\s*([^<\s]+)/)?.[1] ?? "?";
    const mods = [...block.matchAll(/<lastmod>\s*([^<\s]*)\s*<\/lastmod>/g)].map(m => m[1]);
    if (mods.length !== 1) { bad(`sitemap.xml: ${loc} has ${mods.length} <lastmod> — run node tools/gen-sitemap.mjs`); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mods[0]) || isNaN(Date.parse(mods[0])))
      bad(`sitemap.xml: ${loc} has lastmod "${mods[0]}", which is not a date`);
    else if (mods[0] > today) bad(`sitemap.xml: ${loc} is dated ${mods[0]}, which is in the future`);
  }
  const robots = existsSync(join(root, "robots.txt")) ? readFileSync(join(root, "robots.txt"), "utf8") : "";
  if (robots && !/^\s*Sitemap:/mi.test(robots)) soft("robots.txt does not point at the sitemap");
  if (/^\s*Disallow:\s*\/\s*$/mi.test(robots)) bad("robots.txt disallows the whole site");
}

/* ── 6d. The canonical matches the file it is in.

      Two pages on this site were generated from one template, and the single
      most likely way that goes wrong is a canonical left pointing at the page
      it was copied from. A page naming another page as its canonical asks
      every search engine to drop it, silently, and the symptom is
      indistinguishable from a page that simply is not ranking. ────── */
for (const f of pages) {
  const t = readFileSync(join(root, f), "utf8");
  const c = t.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  if (!c) continue;
  const want = f === "index.html" ? "https://thekaal.co/" : `https://thekaal.co/${f}`;
  if (c !== want) bad(`${f} declares its canonical as ${c}; it should be ${want}`);
  const og = t.match(/<meta property="og:url" content="([^"]+)"/)?.[1];
  if (og && og !== want) bad(`${f} declares og:url as ${og}; it should be ${want}`);
}

/* ── 6f. The IndexNow key file, against the workflow that submits it.

      IndexNow authenticates by fetching https://thekaal.co/<key>.txt and
      checking it contains <key>. The key is written in two places — the
      filename at the repo root and the workflow that posts it — and if
      they stop agreeing every submission is rejected with a 403 that
      nobody sees, because nothing on the site changes when the crawlers
      simply do not come. ──────────────────────────────────────────────── */
{
  const wf = join(root, ".github/workflows/indexnow.yml");
  if (existsSync(wf)) {
    const key = readFileSync(wf, "utf8").match(/^\s*KEY=([0-9a-zA-Z-]{8,128})\s*$/m)?.[1];
    if (!key) bad("indexnow.yml defines no KEY — the submission cannot authenticate");
    else {
      const f = join(root, `${key}.txt`);
      if (!existsSync(f)) bad(`indexnow.yml submits key ${key} but ${key}.txt is not in the repo — every submission will be rejected`);
      else if (readFileSync(f, "utf8").trim() !== key) bad(`${key}.txt does not contain ${key} — IndexNow verifies by reading it`);
    }
  }
}

/* ── 6e. The movement, in both of the places that state it.

      The named movement is the most load-bearing fact on this site: it is the
      trust argument, the reason the warranty means anything, and the thing
      answer engines are actually asked for. llms.txt is written by hand and
      the pages are not, so the two drift apart the moment one is edited
      alone — and a summary contradicting the page it summarises is worse
      than no summary at all. ──────────────────────────────── */
if (existsSync(join(root, "llms.txt"))) {
  const llms = readFileSync(join(root, "llms.txt"), "utf8");
  if (!/Seiko/.test(llms)) bad("llms.txt does not name the movement the pages name");
  if (!/twenty four months/i.test(llms)) bad("llms.txt does not state the warranty term");
}
if (!/Seiko/.test(html)) bad("index.html does not name the movement — the page's strongest fact, and the one it used to leave out");

/* ── 6g. Whether the site can take money, in both places that say so.

      The config decides it. llms.txt is written by hand and repeats it,
      and on the one question an assistant is most often asked about a
      shop — can I buy this there, now — the two disagreed: checkout went
      live in index.html and llms.txt went on telling every agent that
      read it that it was not, which turned each of them into a voice
      saying come back later. The rule below is the page's own payMode():
      live when pay is "standard" with a worker behind it, or when a
      Payment Page URL is set. The llms.txt sentence must say
      "Checkout is live" or "checkout is not yet live", and must name the
      route that is actually wired. ─────────────────────────────────── */
if (existsSync(join(root, "llms.txt"))) {
  const llms = readFileSync(join(root, "llms.txt"), "utf8").replace(/\s+/g, " ");
  const live = (payMode === "standard" && !!apiUrl) || !!cfg.checkout;
  const saysLive = /\bcheckout is live\b/i.test(llms);
  const saysDead = /\bcheckout is not (?:yet )?live\b|\bcannot (?:currently )?take a payment\b/i.test(llms);
  if (live && saysDead)
    bad(`llms.txt says the checkout is not live, but index.html takes payments (pay "${payMode}") — every assistant reading it tells a buyer to come back later`);
  else if (live && !saysLive)
    bad(`index.html takes payments (pay "${payMode}") but llms.txt never says "Checkout is live"`);
  else if (!live && saysLive)
    bad('llms.txt says "Checkout is live", but index.html has neither pay "standard" with an api nor a checkout URL — it cannot take a payment');
  else if (!live && !saysDead)
    bad('index.html cannot take a payment, and llms.txt does not say "checkout is not yet live"');
  if (live && payMode === "standard" && !/Standard Checkout/.test(llms))
    bad('pay is "standard" but llms.txt does not name Razorpay Standard Checkout');
  if (live && payMode !== "standard" && !/Payment Page/i.test(llms))
    bad("checkout is a hosted Payment Page but llms.txt does not say so");
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
if (pageKb > 180) soft(`index.html is ${pageKb}KB — it was around 90KB; worth knowing why`);

console.log(`index.html ${pageKb}KB · preloaded fonts ${fontKb}KB · edition ${edition} · ${sold.length} sold · ${refs.size} local references`);
for (const w of warn) console.log(`  note  ${w}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(fail.length ? `\n${fail.length} problem(s). Not shippable.` : `\nAll checks passed.`);
process.exit(fail.length ? 1 : 0);
