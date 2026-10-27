/* What is left, for readers that run no script (worker/stock.js): the
   edges a sale can reach. node tools/test-stock.mjs */
import { readFileSync } from "node:fs";
import { applyStockHtml, applyStockLlms, editionJson, configOf, stockOf, llmsAgrees, editionAgrees } from "../worker/stock.js";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const llms = readFileSync(new URL("../llms.txt", import.meta.url), "utf8");
const withSold = (list) => applyStockHtml(html.replace(/sold:\s*\[[^\]]*\]/, `sold:     [${list.join(", ")}]`));

ok(applyStockHtml(html) === html, "the committed page already agrees with its own sold list");
const once = withSold([1, 2, 3]);
ok(applyStockHtml(once) === once, "applying twice changes nothing");

/* Every emerald gone. */
const em = withSold([1, 2, 3, 4, 5, 6]);
ok(/<span class="ep-left" data-early-left="emerald">Gone<\/span>/.test(em) && /data-face="emerald" aria-pressed="false" disabled>/.test(em) &&
  /<a class="ctx placed" href="#twenty" data-ctx="emerald" aria-disabled="true" tabindex="-1">Emerald &middot; placed<\/a>/.test(em),
  "a dial with nothing left reads Gone, its pick is disabled, its link says placed");
const back = withSold([1, 2]);
ok(/data-face="emerald" aria-pressed="false">/.test(back) && /Emerald &middot; 4 of 6 remain &rarr; Choose yours/.test(back), "and when a number comes back it opens again");

/* All twenty gone. */
const all = withSold(Array.from({ length: 20 }, (_, i) => i + 1)), st = stockOf(configOf(all));
const ld = JSON.parse(/<script type="application\/ld\+json" id="ld">\n?([\s\S]*?)<\/script>/.exec(all)[1]);
const group = ld["@graph"].find(x => x["@type"] === "ProductGroup");
ok(/<title>KAAL Watches India · Series 01 · zero of twenty remain<\/title>/.test(all) && /<span id="heroLeft">0<\/span>/.test(all), "sold out: the title and the hero say zero");
ok(group.offers.availability === "https://schema.org/OutOfStock" && group.offers.inventoryLevel.value === 0 && group.hasVariant.every(v => /SoldOut$/.test(v.offers.availability)),
  "sold out: the group is OutOfStock with none left, every number SoldOut");
ok(/retired: all twenty are gone/.test(applyStockLlms(llms, st, "2027-01-01")) && JSON.parse(editionJson(st, "2027-01-01")).status === "retired", "sold out: llms.txt and edition.json say retired");
const grid = /<ul class="twenty" id="grid"[\s\S]*?<\/ul>/.exec(all)[0];
ok((grid.match(/already gone/g) || []).length === 20 && (grid.match(/ disabled\n/g) || []).length === 20 && !/Choose number/.test(grid), "sold out: all twenty in the grid read already gone, disabled");

/* The checks that guard a push. */
const st3 = stockOf(configOf(once));
ok(llmsAgrees(applyStockLlms(llms, st3, "2026-11-05"), st3) && !llmsAgrees(applyStockLlms(llms, st3, "2026-11-05"), stockOf(configOf(em))), "llms.txt agrees whatever the date, and only with the right list");
ok(editionAgrees(editionJson(st3, "2026-11-05"), st3) && !editionAgrees(editionJson(st3, "2026-11-05"), stockOf(configOf(em))), "edition.json the same");
ok(applyStockLlms(applyStockLlms(llms, st3, "2026-11-05"), st3, "2026-11-05") === applyStockLlms(llms, st3, "2026-11-05"), "llms.txt's section replaces itself, never doubles");
ok(!/[—–]/.test(applyStockLlms(llms, st, "2027-01-01").split("## The facts")[0]) && !/[—–]/.test(editionJson(st, "2027-01-01")), "no em or en dashes in what it writes");

console.log(failed ? `\n${failed} failed.` : "\nAll stock tests passed.");
process.exit(failed ? 1 : 0);
