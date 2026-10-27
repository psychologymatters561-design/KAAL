#!/usr/bin/env node
/* Make every printed count agree with KAAL.sold in index.html: the page
   itself, llms.txt's "Live status" and edition.json (worker/stock.js says
   what each holds). The worker does this in the commit of every sale;
   this is the same thing by hand, for a sold list edited directly.

     node tools/sync-stock.mjs           write the files, today's date
     node tools/sync-stock.mjs --check   change nothing; exit 1 if any disagrees */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { applyStockHtml, applyStockLlms, editionJson, configOf, stockOf, llmsAgrees, editionAgrees, istDay } from "../worker/stock.js";

const ROOT = new URL("../", import.meta.url);
const read = (f) => existsSync(new URL(f, ROOT)) ? readFileSync(new URL(f, ROOT), "utf8") : "";
const html = read("index.html"), llms = read("llms.txt"), json = read("edition.json");
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
  writeFileSync(new URL("index.html", ROOT), applyStockHtml(html));
  writeFileSync(new URL("llms.txt", ROOT), applyStockLlms(llms, st, day));
  writeFileSync(new URL("edition.json", ROOT), editionJson(st, day));
  console.log(`Written: ${st.remaining} of ${st.edition} available (${st.open.join(", ")}).`);
}
