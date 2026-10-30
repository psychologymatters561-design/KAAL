/* What is left, for readers that run no script (worker/stock.js): the
   edges a sale can reach. node tools/test-stock.mjs */
import { readFileSync } from "node:fs";
import { applyStockHtml, applyStockLlms, editionJson, configOf, stockOf, llmsAgrees, editionAgrees } from "../worker/stock.js";

let failed = 0;
/* The page update as it was written first (twenty replace() calls in a
   row), kept here only to prove the one-pass version writes the same page. */
const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];
const DIALS = ["emerald", "midnight", "champagne", "ivory"];
const NAME = { emerald: "Emerald", midnight: "Midnight", champagne: "Champagne", ivory: "Ivory" };
const pad = (n) => (n < 10 ? "0" : "") + n;
const word = (n) => WORDS[n] || String(n);
const SCHEMA = "https://schema.org/";
/* ── index.html ── */
function referenceApply(html) {
  const cfg = configOf(html);
  if (!cfg) return html;
  const st = stockOf(cfg);
  const w = word(st.remaining), total = word(st.edition).toLowerCase();
  let out = html;

  out = out.replace(/(<title>KAAL Watches India · Series 01 · )[^<]*(<\/title>)/, `$1${w.toLowerCase()} of ${total} remain$2`);
  for (const id of ["navRem", "remWord", "dockRem"]) out = out.replace(new RegExp(`(<span id="${id}">)[^<]*(</span>)`), `$1${w}$2`);
  out = out.replace(/(<span id="heroLeft">)[^<]*(<\/span>)/, `$1${st.remaining}$2`);

  /* Each dial: the early pick ("4 left" / "Gone") and the story's link. */
  for (const d of DIALS) {
    const n = st.byDial[d].open.length, made = st.byDial[d].made;
    out = out.replace(new RegExp(`(<button type="button" class="early-pick" data-face="${d}" aria-pressed="false")(?: disabled)?>`),
      `$1${n ? "" : " disabled"}>`);
    out = out.replace(new RegExp(`(<span class="ep-left" data-early-left="${d}">)[^<]*(</span>)`), `$1${n ? n + " left" : "Gone"}$2`);
    out = out.replace(new RegExp(`<a class="ctx(?: placed)?" href="#twenty" data-ctx="${d}"[^>]*>[^<]*</a>`),
      n ? `<a class="ctx" href="#twenty" data-ctx="${d}">${NAME[d]} &middot; ${n} of ${made} remain &rarr; Choose yours</a>`
        : `<a class="ctx placed" href="#twenty" data-ctx="${d}" aria-disabled="true" tabindex="-1">${NAME[d]} &middot; placed</a>`);
  }

  /* The twenty, as printed for a reader that never runs the script. */
  const gone = new Set(st.gone);
  out = out.replace(/<li><button type="button" class="pick" data-n="(\d+)" aria-pressed="false"(?: disabled)?\n(\s+)style="([^"]*)" aria-label="[^"]*">(\d+)(<span class="dot"[^>]*><\/span>)(?:<span class="placed">Placed<\/span>)?<\/button><\/li>/g,
    (all, n, indent, style, label, dot) => {
      const k = parseInt(n, 10), name = NAME[st.dials[k]] || NAME.ivory, g = gone.has(k);
      return `<li><button type="button" class="pick" data-n="${n}" aria-pressed="false"${g ? " disabled" : ""}\n${indent}style="${style}" aria-label="` +
        (g ? `Number ${pad(k)}, ${name} dial, already gone` : `Choose number ${pad(k)}, ${name} dial`) + `">${label}${dot}${g ? '<span class="placed">Placed</span>' : ""}</button></li>`;
    });

  /* The structured data: the same graph the script builds, so the two
     agree from the first byte. */
  out = out.replace(/(<script type="application\/ld\+json" id="ld">\n?)([\s\S]*?)(<\/script>)/, (all, open, raw, close) => {
    let g;
    try { g = JSON.parse(raw); } catch (e) { return all; }
    const group = (g["@graph"] || []).find(x => x["@type"] === "ProductGroup");
    if (!group || !group.offers) return all;
    const o = group.offers, rest = Object.assign({}, o);
    for (const k of ["@type", "price", "priceCurrency", "availability", "inventoryLevel"]) delete rest[k];
    group.offers = Object.assign({ "@type": o["@type"] || "Offer", price: o.price, priceCurrency: o.priceCurrency,
      availability: SCHEMA + (st.remaining ? "InStock" : "OutOfStock"),
      inventoryLevel: { "@type": "QuantitativeValue", value: st.remaining } }, rest);
    group.hasVariant = (group.hasVariant || []).map(v => {
      const k = parseInt(String(v.sku || "").replace(/\D/g, ""), 10);
      if (!k || !v.offers) return v;
      const vo = v.offers, vrest = Object.assign({}, vo);
      for (const key of ["@type", "price", "priceCurrency", "availability"]) delete vrest[key];
      return Object.assign({}, v, { offers: Object.assign({ "@type": vo["@type"] || "Offer", price: vo.price, priceCurrency: vo.priceCurrency,
        availability: SCHEMA + (gone.has(k) ? "SoldOut" : "InStock") }, vrest) });
    });
    return open + JSON.stringify(g, null, 2) + "\n" + close;
  });
  return out;
}


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

/* One pass writes exactly what twenty replacements in a row wrote, for
   every kind of list: none gone, all gone, each dial emptied, and random. */
{
  const lists = [[], Array.from({ length: 20 }, (_, i) => i + 1), [1, 2, 3, 4, 5, 6], [7, 8, 9, 10], [11, 12, 13, 14, 15], [16, 17, 18, 19, 20], [1, 2, 3, 4, 7, 9, 10, 15]];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 120; i++) lists.push(Array.from({ length: 20 }, (_, k) => k + 1).filter(() => rnd() < 0.45));
  const differ = lists.filter(l => { const h = html.replace(/sold:\s*\[[^\]]*\]/, `sold:     [${l.join(", ")}]`); return applyStockHtml(h) !== referenceApply(h); });
  ok(!differ.length, `one pass writes the same page as the old twenty replacements, on ${lists.length} sold lists` + (differ.length ? " (differs: " + JSON.stringify(differ[0]) + ")" : ""));
  const stale = withSold([1, 2]).replace(/<span id="heroLeft">\d+</, '<span id="heroLeft">99<');
  ok(applyStockHtml(stale) === referenceApply(stale) && /<span id="heroLeft">18</.test(applyStockHtml(stale)), "and mends a page whose counts were wrong, the same way");
}
/* Fast enough for a worker on the free plan (10 ms of CPU for the whole run). */
{
  const h = html.replace(/sold:\s*\[[^\]]*\]/, "sold:     [1, 2, 3]");
  applyStockHtml(h);
  const t0 = process.hrtime.bigint(); for (let i = 0; i < 10; i++) applyStockHtml(h);
  const ms = Number(process.hrtime.bigint() - t0) / 1e7;
  ok(ms < 4, `the page update takes ${ms.toFixed(2)} ms warm`);
}

console.log(failed ? `\n${failed} failed.` : "\nAll stock tests passed.");
process.exit(failed ? 1 : 0);
