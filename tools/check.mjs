#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   The whole test suite for the page, and the runner that finds it.

   This site has no build step, so there is no compiler to catch a typo
   and no bundler to notice a missing file. The push IS the deploy: a
   broken tag or a renamed asset is live on thekaal.co within a minute
   of the commit, in front of paid traffic.

   Every check lives in its own file under tools/checks/, is discovered
   by being there, and runs in the order its filename sorts. Adding one
   is writing a file; it needs no registration and nothing here changes.
   That matters more than it looks: the version of this that was one
   three-hundred-line script grew a new section every time the site
   learned something, and each section could see — and quietly depend on
   — every variable the ones above it had left lying around.

   A check module exports a default function taking the shared context
   and calls bad() or soft(). It returns nothing. It prints nothing.

   Run it yourself before you push:   node tools/check.mjs
   The rest of the suite:             node --test "tools/test/*.test.mjs"
   The live site and worker:          node tools/verify-live.mjs
   ══════════════════════════════════════════════════════════════════ */
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { buildContext } from "./checks/context.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ctx = buildContext(process.cwd());

const modules = readdirSync(join(here, "checks"))
  .filter(f => /^\d+-.*\.mjs$/.test(f))
  .sort();

for (const file of modules) {
  const mod = await import(pathToFileURL(join(here, "checks", file)).href);
  try { await mod.default(ctx); }
  catch (e) {
    /* A check that throws is a broken check, not a clean page. Say which
       one, and still fail — never pass because the gate fell over. */
    ctx.bad(`check "${mod.title || file}" threw: ${String(e.message || e).slice(0, 120)}`);
  }
}

console.log(ctx.notes.join(" · "));
for (const w of ctx.warn) console.log(`  note  ${w}`);
for (const f of ctx.fail) console.log(`  FAIL  ${f}`);
console.log(ctx.fail.length ? `\n${ctx.fail.length} problem(s). Not shippable.` : `\nAll checks passed. (${modules.length} checks)`);
process.exit(ctx.fail.length ? 1 : 0);
