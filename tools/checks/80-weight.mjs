/* Not a budget anyone has to hit. A number nobody should change without
   noticing. */
export const title = "weight";

export default function (ctx) {
  const pageKb = ctx.kb("index.html");
  const fontKb = ["InstrumentSerif-latin", "Inter-wght"].reduce((a, f) => a + ctx.kb(`assets/fonts/${f}.woff2`), 0);
  if (pageKb > 140) ctx.soft(`index.html is ${pageKb}KB — it was around 90KB; worth knowing why`);
  ctx.notes.unshift(`index.html ${pageKb}KB · preloaded fonts ${fontKb}KB`);
}
