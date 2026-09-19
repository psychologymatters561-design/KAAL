/* The commercial values, and the one contract the worker depends on. */
export const title = "config";

export default function (ctx) {
  const { html, cfg, edition, sold, dials, bad, soft } = ctx;

  /* worker/lib/edition.js finds the edition state with /sold:\s*\[([^\]]*)\]/
     and rewrites the FIRST match. A second `sold:` anywhere earlier in
     this file — in a comment, in a new config block — silently redirects
     a live payment webhook into the wrong string. This check is the only
     thing that makes that regex safe to rely on. */
  const soldHits = (html.match(/sold:/g) || []).length;
  if (soldHits !== 1) bad(`index.html contains ${soldHits} occurrences of "sold:" — the worker rewrites the first one and expects exactly 1`);

  if (!Number.isFinite(edition) || edition < 1) bad("edition is missing or not a number");
  else {
    for (let i = 1; i <= edition; i++)
      if (!dials.has(i)) bad(`dials has no face for number ${i} — the grid would render it as ivory by default`);
    for (const n of sold) if (n < 1 || n > edition) bad(`sold contains ${n}, which is outside 1..${edition}`);
    if (new Set(sold).size !== sold.length) bad("sold contains a duplicate");
  }

  /* The price is not only every price on the page: the worker reads this
     line to decide what a real payment is worth. */
  if (!cfg.price) bad("price is empty — every price on the page reads from it, and so does the worker's amount check");
  if (!cfg.checkout) soft("checkout is empty: the page will render, and it cannot take money");

  if (cfg.filmFrames && !(cfg.filmFrames.includes("{W}") && cfg.filmFrames.includes("{H}") && cfg.filmFrames.includes("{T}")))
    bad("filmFrames must carry {T}, {W} and {H} — the hero sizes its own request");
  if (cfg.frames && !(cfg.frames.includes("{T}") && cfg.frames.includes("{W}")))
    bad("frames must carry {T} and {W}");
  if (cfg.frames && cfg.frames.includes("{H}"))
    bad("frames is the photograph fallback and is used without {H} — an {H} here ships a literal '{H}' in the URL");

  ctx.note(`edition ${edition} · ${sold.length} sold`);
}
