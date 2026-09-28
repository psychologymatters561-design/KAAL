#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   Dates sitemap.xml from git, so nobody has to.

   A <lastmod> is a claim about when a page last changed, and a crawler
   decides whether to come back on the strength of it. These were typed
   by hand and had drifted stale within days: pages changed, the dates
   did not, and a sitemap that is wrong about freshness teaches a crawler
   to stop reading its dates at all.

   So each URL's lastmod is now the date of the last commit that touched
   its file — `git log -1 --format=%cs -- <file>` — which is the one
   record of change that cannot be forgotten. The sold-sync worker's
   commits count: a number going is a change to the page.

   indexnow.yml runs this on every push to main and commits the result,
   before it tells the crawlers anything. Run it by hand if you like:

     node tools/gen-sitemap.mjs

   It refuses a shallow clone. There, every file's last commit is the
   only commit there is, and every page would claim to have changed
   today — which is worse than a stale date, because it looks right.
   ══════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

if (git("rev-parse", "--is-shallow-repository") === "true") {
  console.error("gen-sitemap: this is a shallow clone, so every page would date to the newest commit.\n" +
                "Fetch full history first (actions/checkout: fetch-depth: 0, or git fetch --unshallow).");
  process.exit(1);
}

const file = join(root, "sitemap.xml");
const before = readFileSync(file, "utf8");
const problems = [];

const after = before.replace(/<url>([\s\S]*?)<\/url>/g, (block, inner) => {
  const loc = inner.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
  if (!loc) { problems.push("a <url> with no <loc>"); return block; }
  const page = loc.replace(/^https?:\/\/[^/]+\//, "") || "index.html";
  if (!existsSync(join(root, page))) { problems.push(`${loc} names ${page}, which is not in the repo`); return block; }
  const day = git("log", "-1", "--format=%cs", "--", page);
  if (!day) { problems.push(`${page} has never been committed`); return block; }
  return /<lastmod>/.test(inner)
    ? block.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${day}</lastmod>`)
    : block.replace(/(<loc>[^<]*<\/loc>)/, `$1\n    <lastmod>${day}</lastmod>`);
});

if (problems.length) {
  for (const p of problems) console.error(`gen-sitemap: ${p}`);
  process.exit(1);
}
if (after === before) {
  console.log("sitemap.xml already matches git history");
} else {
  writeFileSync(file, after);
  console.log("sitemap.xml re-dated from git history");
}
