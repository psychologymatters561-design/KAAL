/* ══════════════════════════════════════════════════════════════════
   KAAL · WHAT IS LEFT, FOR READERS THAT RUN NO SCRIPT

   The shop's page knows what is left only once its script runs: it reads
   KAAL.sold and asks the worker every minute. Google runs the script.
   GPTBot, ClaudeBot, PerplexityBot and most answer engines do not: they
   read the HTML as it was committed. So every count printed in that HTML
   is made true here, in the same commit that marks a number sold:

     the <title>, the "N remain" lines (nav, statement, dock, hero),
     each dial's "N left" and "N of M remain", the twenty in the grid,
     the structured data (each number's availability, the group's
     availability and how many are left),
     llms.txt's "Live status", and edition.json, the same facts as data.

   One pure function per file, no I/O: the worker uses them when a sale
   commits (worker/kaal-sold-sync.js, rewriteSold), tools/sync-stock.mjs
   uses them to repair the files on disk, and tools/check.mjs fails any
   push where the files and KAAL.sold disagree. ASCII only in what this
   writes into HTML, apart from the title's existing separators.
   ══════════════════════════════════════════════════════════════════ */

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];
const DIALS = ["emerald", "midnight", "champagne", "ivory"];
const NAME = { emerald: "Emerald", midnight: "Midnight", champagne: "Champagne", ivory: "Ivory" };
const pad = (n) => (n < 10 ? "0" : "") + n;
const word = (n) => WORDS[n] || String(n);
const SCHEMA = "https://schema.org/";

/* The edition as the page's own config states it. */
export function configOf(html) {
  const sold = /sold:\s*\[([^\]]*)\]/.exec(html);
  const edition = parseInt((/edition:\s*(\d+)/.exec(html) || [])[1], 10) || 20;
  const price = parseInt(String((/price:\s*"([^"]+)"/.exec(html) || [])[1] || "5,999").replace(/[^0-9]/g, ""), 10) || 5999;
  const dials = {};
  const block = /dials:\s*\{([^}]*)\}/.exec(html);
  if (block) for (const m of block[1].matchAll(/(\d+)\s*:\s*"([a-z]+)"/g)) dials[parseInt(m[1], 10)] = m[2];
  if (!sold) return null;
  const list = sold[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => n >= 1 && n <= edition);
  return { sold: [...new Set(list)].sort((a, b) => a - b), edition, price, dials };
}

/* Everything the counts are made of. */
export function stockOf(cfg) {
  const soldSet = new Set(cfg.sold);
  const open = [], gone = [];
  for (let n = 1; n <= cfg.edition; n++) (soldSet.has(n) ? gone : open).push(n);
  const byDial = {};
  for (const d of DIALS) byDial[d] = { made: 0, open: [] };
  for (let n = 1; n <= cfg.edition; n++) {
    const d = byDial[cfg.dials[n]] ? cfg.dials[n] : "ivory";
    byDial[d].made++;
    if (!soldSet.has(n)) byDial[d].open.push(n);
  }
  return { edition: cfg.edition, price: cfg.price, dials: cfg.dials, gone, open, remaining: open.length, byDial };
}

/* ── index.html ── */
export function applyStockHtml(html) {
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

/* ── llms.txt: one section, replaced whole ── */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function longDate(day) {
  const [y, m, d] = String(day).split("-").map(n => parseInt(n, 10));
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : String(day);
}
function nos(list) {
  if (!list.length) return "none";
  return (list.length === 1 ? "No. " : "Nos. ") + list.map(pad).join(", ");
}
export function llmsStatus(st, day) {
  const dial = DIALS.map(d => {
    const b = st.byDial[d];
    return `${NAME[d]} ${b.open.length} of ${b.made}${b.open.length ? " (" + nos(b.open) + ")" : ""}`;
  }).join("; ");
  return [
    "## Live status",
    "",
    "Rewritten automatically in the same commit as every sale, so it always",
    "matches the shop. The same facts as data: https://thekaal.co/edition.json",
    "",
    `- **Available now**: ${st.remaining} of ${st.edition}${st.remaining ? " (" + nos(st.open) + ")" : ""}`,
    `- **No longer available**: ${st.gone.length} of ${st.edition}${st.gone.length ? " (" + nos(st.gone) + ")" : ""}`,
    `- **Available by dial**: ${dial}`,
    `- **Status**: ${st.remaining ? `on sale at thekaal.co, ₹${st.price.toLocaleString("en-IN")} each` : "retired: all twenty are gone and the design will not be made again"}`,
    `- **As of**: ${longDate(day)}`,
    ""
  ].join("\n");
}
/* The section goes after the opening summary and before the first other
   heading; on later runs it replaces itself. */
export function applyStockLlms(llms, st, day) {
  const block = llmsStatus(st, day);
  if (/^## Live status\n[\s\S]*?(?=^## )/m.test(llms)) return llms.replace(/^## Live status\n[\s\S]*?(?=^## )/m, block + "\n");
  const at = llms.search(/^## /m);
  return at < 0 ? llms.replace(/\s*$/, "\n\n" + block) : llms.slice(0, at) + block + "\n" + llms.slice(at);
}

/* ── edition.json ── */
export function editionJson(st, day) {
  const dials = {};
  for (const d of DIALS) dials[NAME[d]] = { made: st.byDial[d].made, available: st.byDial[d].open.length, availableNumbers: st.byDial[d].open };
  return JSON.stringify({
    brand: "KAAL",
    series: "Series 01",
    url: "https://thekaal.co/",
    edition: st.edition,
    priceINR: st.price,
    status: st.remaining ? "on sale" : "retired",
    available: st.remaining,
    gone: st.gone.length,
    availableNumbers: st.open,
    goneNumbers: st.gone,
    dials,
    asOf: day
  }, null, 2) + "\n";
}

/* The day in India, for "as of". */
export function istDay(ms) { return new Date((ms || Date.now()) + 5.5 * 3600000).toISOString().slice(0, 10); }

/* Does a file already say what the edition says? The date may differ. */
export function llmsAgrees(llms, st) {
  const m = /^## Live status\n[\s\S]*?(?=^## )/m.exec(llms);
  if (!m) return false;
  const day = (/\*\*As of\*\*: (.+)/.exec(m[0]) || [])[1];
  const iso = (() => { const x = /^(\d+) (\w+) (\d{4})$/.exec(day || ""); if (!x) return ""; const mi = MONTHS.indexOf(x[2]) + 1; return mi ? `${x[3]}-${pad(mi)}-${pad(parseInt(x[1], 10))}` : ""; })();
  return !!iso && m[0] === llmsStatus(st, iso) + "\n";
}
export function editionAgrees(json, st) {
  let o;
  try { o = JSON.parse(json); } catch (e) { return false; }
  return json === editionJson(st, o.asOf);
}
