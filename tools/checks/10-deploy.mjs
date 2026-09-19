/* The deploy's own furniture. Losing either of these takes the custom
   domain or the whole assets directory off the internet, and neither
   failure looks like a code error when it happens. */
export const title = "deploy furniture";

export default function ({ exists, bad }) {
  for (const f of ["CNAME", ".nojekyll", "index.html"])
    if (!exists(f)) bad(`${f} is missing — GitHub Pages needs it`);
}
