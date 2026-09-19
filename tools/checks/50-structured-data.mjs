/* The one part of the page no reader will ever notice is broken, and
   the part an answer engine reads first. A JSON-LD block that does not
   parse is discarded in silence. */
export const title = "structured data";

export default function ({ html, pages, read, edition, dialOf, bad, soft }) {
  for (const f of pages) {
    const t = read(f);
    const blocks = [...t.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
    for (const [i, blk] of blocks.entries()) {
      try { JSON.parse(blk); }
      catch (e) { bad(`${f}: JSON-LD block ${i + 1} does not parse — ${String(e.message).slice(0, 80)}`); }
    }
    if (f === "index.html" && !blocks.length) soft("index.html carries no structured data");

    const robotsMetas = (t.match(/<meta\s+name="robots"/gi) || []).length;
    if (robotsMetas > 1) bad(`${f} has ${robotsMetas} robots meta tags — a crawler reads the most restrictive and the intent becomes a guess`);
    if (!/<link rel="canonical"/.test(t) && f !== "claimed.html") soft(`${f} has no canonical link`);
  }

  /* The ItemList names a dial for each of the twenty. That is a second
     copy of KAAL.dials, and a second copy is only safe while something
     compares them. */
  const ld = html.match(/"@type":\s*"ItemList"[\s\S]*?"itemListElement":\s*\[([\s\S]*?)\]/);
  if (!ld) return soft("index.html has no ItemList in its structured data");

  const NAMES = { emerald: "Emerald", midnight: "Midnight", champagne: "Champagne", ivory: "Ivory" };
  const listed = [...ld[1].matchAll(/"position":\s*(\d+),\s*"name":\s*"[^"]*No\.\s*(\d+)[^"]*?(Emerald|Midnight|Champagne|Ivory) dial"/g)];
  if (listed.length !== edition) bad(`ItemList names ${listed.length} pieces but the edition is ${edition}`);
  for (const [, pos, no, dial] of listed) {
    if (+pos !== +no) bad(`ItemList position ${pos} is labelled No. ${no}`);
    const want = NAMES[dialOf[+no]];
    if (want && want !== dial) bad(`ItemList says No. ${no} carries ${dial}; KAAL.dials says ${want}`);
  }
}
