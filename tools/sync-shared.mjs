#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   Propagate the shared security blocks from index.html to every other
   page, so that nobody has to paste them and nobody can paste them
   slightly wrong.

   There is no build step here — the CSP, the referrer policy and the
   frame guard are copied into four files rather than included from one,
   because including them would cost a request on the critical path of
   the page that has to sell something. The copy is the right trade. The
   drift is not, so this closes it and tools/checks/35-shared-blocks.mjs
   fails the build when it opens again.

     node tools/sync-shared.mjs          write the pages
     node tools/sync-shared.mjs --check  say what would change, write nothing
   ══════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from "node:fs";
import { PAGES } from "./checks/context.mjs";
import { BLOCKS, SOURCE } from "./checks/35-shared-blocks.mjs";

const dry = process.argv.includes("--check");
const source = readFileSync(SOURCE, "utf8");
let changed = 0;

for (const page of PAGES) {
  if (page === SOURCE) continue;
  let text;
  try { text = readFileSync(page, "utf8"); } catch (e) { continue; }
  let next = text;

  for (const block of BLOCKS) {
    const canonical = source.match(block.re)?.[0];
    if (!canonical) { console.log(`  ${SOURCE} has no ${block.name} — nothing to copy from.`); process.exit(1); }
    if (!block.re.test(next)) { console.log(`  ${page} has no ${block.name} — add it by hand once, then this keeps it.`); continue; }
    next = next.replace(block.re, () => canonical);
  }

  if (next === text) continue;
  changed++;
  console.log(`  ${dry ? "would update" : "updated"}  ${page}`);
  if (!dry) writeFileSync(page, next);
}

console.log(changed ? `\n${changed} page(s) ${dry ? "differ from" : "brought back in line with"} ${SOURCE}.`
                    : `\nEvery page already matches ${SOURCE}.`);
process.exit(dry && changed ? 1 : 0);
