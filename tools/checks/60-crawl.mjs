/* A sitemap naming a page that does not exist is worse than no sitemap,
   and robots.txt decides whether any of this is read at all. */
export const title = "crawl surface";

export default function ({ cfg, exists, read, bad, soft }) {
  if (!exists("robots.txt")) soft("no robots.txt");

  if (!exists("llms.txt")) soft("no llms.txt");
  else {
    const llms = read("llms.txt");
    if (!/thekaal\.co/.test(llms)) bad("llms.txt does not name the site");
    if (cfg.price && !llms.includes(cfg.price)) bad(`llms.txt does not carry the current price (${cfg.price})`);
  }

  if (!exists("sitemap.xml")) return soft("no sitemap.xml");

  const sm = read("sitemap.xml");
  const locs = [...sm.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
  if (!locs.length) bad("sitemap.xml lists no URLs");
  for (const loc of locs) {
    const path = loc.replace(/^https?:\/\/[^/]+\//, "");
    if (!exists(path === "" ? "index.html" : path)) bad(`sitemap.xml lists ${loc}, which does not exist in the repo`);
  }
  const robots = exists("robots.txt") ? read("robots.txt") : "";
  if (robots && !/^\s*Sitemap:/mi.test(robots)) soft("robots.txt does not point at the sitemap");
  if (/^\s*Disallow:\s*\/\s*$/mi.test(robots)) bad("robots.txt disallows the whole site");
}
