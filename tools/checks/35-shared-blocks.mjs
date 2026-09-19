/* ══════════════════════════════════════════════════════════════════
   FOUR COPIES OF THREE BLOCKS.

   There is no build step here, so the security blocks every page needs
   — the CSP, the referrer policy, the frame guard — cannot be included
   from one file without paying for a request on the critical path. They
   are copied instead. That is a deliberate trade and it is the right one
   for a page whose LCP is the product.

   What is NOT acceptable is the copies drifting. A CSP tightened on
   index.html and forgotten on claimed.html is the weakest page becoming
   the way in, and nothing about the site looks any different.

   So when you cannot be DRY by reference, be DRY by assertion: one page
   is the source, the rest must match it byte for byte, and
   `node tools/sync-shared.mjs` propagates rather than asking you to
   paste. The stylesheet blocks are deliberately NOT checked — each page
   carries the tokens it actually uses, and forcing those to match would
   be enforcing sameness rather than correctness.
   ══════════════════════════════════════════════════════════════════ */
export const title = "shared blocks";

export const SOURCE = "index.html";

/* Each block is found by a pattern and must be identical everywhere. */
export const BLOCKS = [
  { name: "CSP meta",      re: /<meta http-equiv="Content-Security-Policy" content="[^"]*">/ },
  { name: "referrer meta", re: /<meta name="referrer" content="[^"]*">/ },
  { name: "frame guard",   re: /<script>\n\(function\(\)\{\n  "use strict";\n  var framed;[\s\S]*?\n<\/script>/ }
];

export default function ({ pages, read, bad }) {
  const source = read(SOURCE);

  for (const block of BLOCKS) {
    const canonical = source.match(block.re)?.[0];
    if (!canonical) { bad(`${SOURCE} has no ${block.name} — it is the source every other page is compared against`); continue; }

    for (const f of pages) {
      if (f === SOURCE) continue;
      const here = read(f).match(block.re)?.[0];
      if (!here) { bad(`${f} has no ${block.name}`); continue; }
      if (here !== canonical)
        bad(`${f} has a ${block.name} that differs from ${SOURCE} — run \`node tools/sync-shared.mjs\``);
    }
  }
}
