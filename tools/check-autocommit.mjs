#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   THE BLAST RADIUS OF A STOLEN TOKEN.

   The worker holds a GitHub token that writes index.html on main, and
   the push is the deploy. That is a credential on an internet-facing
   endpoint with commit access to the shop — an accepted trade, but only
   while the damage it can do is bounded by something other than trust.

   This is that bound. Every commit whose message says it was made by
   the worker must touch exactly one file, exactly one line, and that
   line must be the `sold:` array with exactly one new number in it.

   So if the token is ever stolen, the thief gets a choice of two moves:

     - mark a number sold, which is annoying and reversible, or
     - anything else, which fails this check inside a minute and is
       sitting in the Actions tab with a red cross on it.

   They cannot repoint `checkout:` at their own payment page. They
   cannot inject a script. They cannot quietly change the price. Not
   because the token forbids it — GitHub's Contents scope has no such
   granularity — but because the shape of the commit gives it away and
   something is watching the shape.

   WHAT THIS IS NOT. It does not revert anything. Reverting would need
   CI to hold a write credential of its own, which is a second token on
   a second surface to protect the first one — a worse trade than the
   one it is trying to improve. This fails loudly instead, which is the
   whole job: you cannot respond to what you do not know about.

   Run it yourself:  node tools/check-autocommit.mjs
   ══════════════════════════════════════════════════════════════════ */
import { execFileSync } from "node:child_process";

const git = (...a) => execFileSync("git", a, { encoding: "utf8" });
const die = (m) => { console.log(`  FAIL  ${m}`); process.exitCode = 1; };

const subject = git("log", "-1", "--format=%s").trim();
const AUTO = /^Auto: mark number (\d+) sold \(payment ([A-Za-z0-9_]+)\)$/;
const m = subject.match(AUTO);

if (!m) {
  console.log(`Not a worker commit ("${subject.slice(0, 60)}") — nothing to check.`);
  process.exit(0);
}
const claimed = +m[1];
console.log(`Worker commit: number ${claimed}, payment ${m[2]}`);

/* 1. One file. */
const files = git("diff", "--name-only", "HEAD~1", "HEAD").trim().split("\n").filter(Boolean);
if (files.length !== 1 || files[0] !== "index.html")
  die(`a worker commit touched ${files.length} file(s): ${files.join(", ")} — it may only ever touch index.html`);

/* 2. One line, and it is the sold array. -U0 gives changed lines only. */
const diff = git("diff", "-U0", "HEAD~1", "HEAD", "--", "index.html").split("\n");
const changed = diff.filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));

const SOLD_LINE = /^[+-]\s*sold:\s*\[[\d,\s]*\]\s*,?\s*$/;
for (const line of changed)
  if (!SOLD_LINE.test(line)) die(`a worker commit changed a line that is not the sold array: ${line.slice(0, 90)}`);

const removed = changed.filter(l => l.startsWith("-"));
const added   = changed.filter(l => l.startsWith("+"));
if (removed.length !== 1 || added.length !== 1)
  die(`a worker commit rewrote ${removed.length} line(s) into ${added.length} — it may only ever rewrite one`);

/* 3. Exactly one number appeared, it is the one the message claims, and
      nothing was taken away. A commit that UN-sells a number is not
      something this worker is capable of, so it is not something that
      should ever arrive wearing its name. */
if (removed.length === 1 && added.length === 1) {
  const nums = (s) => (s.match(/\[([^\]]*)\]/)?.[1] ?? "").split(",").map(x => parseInt(x, 10)).filter(n => !isNaN(n));
  const before = nums(removed[0]), after = nums(added[0]);
  const gained = after.filter(n => !before.includes(n));
  const lost   = before.filter(n => !after.includes(n));

  if (lost.length)        die(`a worker commit un-sold number(s) ${lost.join(", ")} — it is not capable of that, so something else made this commit`);
  if (gained.length !== 1) die(`a worker commit added ${gained.length} numbers (${gained.join(", ")}) — one payment, one number`);
  else if (gained[0] !== claimed) die(`the message says number ${claimed}, the diff sells number ${gained[0]}`);
  else console.log(`  ok    one line, one number (${claimed}), nothing else touched.`);
}

if (process.exitCode) console.log("\nA commit is wearing the worker's name and is not shaped like its work.\nTreat the GITHUB_TOKEN as compromised: rotate it now, then read the diff.");
else console.log("\nAuto-commit is within its blast radius.");
