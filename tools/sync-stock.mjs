#!/usr/bin/env node
/* Make every printed count agree with KAAL.sold in index.html: the page
   itself, llms.txt's "Live status" and edition.json (worker/stock.js says
   what each holds). The worker does this in the commit of every sale;
   this is the same thing by hand, for a sold list edited directly.

     node tools/sync-stock.mjs           write the files, today's date
     node tools/sync-stock.mjs --check   change nothing; exit 1 if any disagrees
     node tools/sync-stock.mjs --live    first add to KAAL.sold what the live
                                         shop says is gone (the worker's /state;
                                         never removes one), then write the files;
                                         the stock workflow runs this */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { applyStockHtml, applyStockLlms, editionJson, configOf, stockOf, llmsAgrees, editionAgrees, istDay } from "../worker/stock.js";

const ROOT = new URL("../", import.meta.url);
const read = (f) => existsSync(new URL(f, ROOT)) ? readFileSync(new URL(f, ROOT), "utf8") : "";
let html = read("index.html");
const llms = read("llms.txt"), json = read("edition.json");

/* The live shop's own answer: what /state says is gone (the stored list and
   the registry together, exactly what the page shows). Anything odd, and
   the file is left as it is. */
export function soldFromState(j, edition) {
  if (!j || !Array.isArray(j.sold) || !j.sold.every(n => Number.isInteger(n) && n >= 1 && n <= edition)) return null;
  return [...new Set(j.sold)].sort((a, b) => a - b);
}
if (process.argv.includes("--live")) {
  const url = process.env.STATE_URL || "https://kaal-edition.kaal-edition-hq.workers.dev/state";
  const c0 = configOf(html);
  let j = null;
  try { const r = await fetch(url, { headers: { Origin: "https://thekaal.co" }, signal: AbortSignal.timeout(20000) }); j = r.ok ? await r.json() : null; } catch (e) { j = null; }
  const live = soldFromState(j, c0 ? c0.edition : 20);
  if (!live) { console.log("The live shop did not answer with a sold list; nothing changed."); process.exit(0); }
  /* Only ever adds: a number gone by either account stays gone in the file
     (the page itself merges the two the same way). Putting a number back on
     sale is the worker's own commit, never this. */
  const was = c0 ? c0.sold : [];
  const next = [...new Set(was.concat(live))].sort((a, b) => a - b);
  if (next.join(",") !== was.join(",")) console.log(`The live shop has also gone: ${next.filter(n => was.indexOf(n) < 0).join(", ")}.`);
  html = html.replace(/sold:\s*\[[^\]]*\]/, `sold:     [${next.join(", ")}]`);
}
const cfg = configOf(html);
if (!cfg) { console.error("index.html has no KAAL.sold list."); process.exit(1); }
const st = stockOf(cfg);

if (process.argv.includes("--check")) {
  const bad = [];
  if (applyStockHtml(html) !== html) bad.push("index.html");
  if (!llmsAgrees(llms, st)) bad.push("llms.txt");
  if (!editionAgrees(json, st)) bad.push("edition.json");
  if (bad.length) { console.error(`Stock out of step with KAAL.sold in: ${bad.join(", ")}. Run: node tools/sync-stock.mjs`); process.exit(1); }
  console.log(`Stock agrees everywhere: ${st.remaining} of ${st.edition} available.`);
} else {
  const day = istDay();
  if (process.argv.includes("--live") && applyStockHtml(html) === read("index.html") && llmsAgrees(llms, st) && editionAgrees(json, st)) { console.log("The site file already matches the live shop."); process.exit(0); }
  writeFileSync(new URL("index.html", ROOT), applyStockHtml(html));
  writeFileSync(new URL("llms.txt", ROOT), applyStockLlms(llms, st, day));
  writeFileSync(new URL("edition.json", ROOT), editionJson(st, day));
  console.log(`Written: ${st.remaining} of ${st.edition} available (${st.open.join(", ")}).`);
}
