/* Markup a browser will silently forgive and a reader will not. */
export const title = "markup";

import { writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function (ctx) {
  const { html, pages, read, exists, at, bad, soft } = ctx;

  /* A duplicated id breaks every $() lookup after it. */
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const dupe = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dupe.length) bad(`duplicate id(s): ${[...new Set(dupe)].join(", ")}`);

  /* Every local file ANY page asks for must exist, case exactly. Pages
     is case sensitive; a Mac is not. */
  const refs = new Set();
  for (const f of pages)
    for (const m of read(f).matchAll(/(?:src|href)="([^"#?:]+)"/g)) {
      const u = m[1];
      if (u.startsWith("http") || u.startsWith("//") || u.startsWith("mailto") || u.startsWith("data:")) continue;
      if (u === "/") continue;
      refs.add(u.replace(/^\.\//, ""));
    }
  for (const r of refs) {
    if (exists(r)) continue;
    /* The eight photographs are a known pending state with a designed
       fallback, so they are a warning and never a failure. */
    if (r.startsWith("assets/img/")) soft(`asset not present (page falls back by design): ${r}`);
    else bad(`referenced file does not exist: ${r}`);
  }
  ctx.note(`${refs.size} local references`);

  /* The scripts actually parse. There is no bundler to find out first. */
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length) bad("no inline script found — did a tag get mangled?");
  const dir = mkdtempSync(join(tmpdir(), "kaal-"));
  blocks.forEach((b, i) => {
    const f = join(dir, `b${i}.js`);
    writeFileSync(f, b);
    try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
    catch (e) { bad(`inline script block ${i + 1} does not parse: ${String(e.stderr || e).split("\n").slice(0, 3).join(" ")}`); }
  });
  void at;
}
