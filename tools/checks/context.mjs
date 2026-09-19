/* ══════════════════════════════════════════════════════════════════
   Everything every check needs, read once.

   The old check.mjs read index.html four times and re-derived the
   config with the same three regexes in three places. Not slow — it
   runs in a second either way — but three copies of "how the config is
   parsed" is three chances for a check to be quietly asking about a
   different file than the one it thinks it is.
   ══════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export const PAGES = ["index.html", "manifesto.html", "legal.html", "claimed.html"];

export function buildContext(root) {
  const fail = [], warn = [];
  const at = (f) => join(root, f);
  const exists = (f) => existsSync(at(f));
  const read = (f) => readFileSync(at(f), "utf8");
  const html = read("index.html");

  /* The config, read the way the page reads it. */
  const cfg = {};
  for (const k of ["checkout", "price", "film", "frames", "filmFrames", "api"]) {
    const m = html.match(new RegExp(`${k}:\\s*"([^"]*)"`));
    if (m) cfg[k] = m[1];
  }
  const edition = +(html.match(/edition:\s*(\d+)/)?.[1] ?? NaN);
  const sold = (html.match(/sold:\s*\[([^\]]*)\]/)?.[1] ?? "")
    .split(",").map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  const dialsBlock = html.match(/dials:\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const dials = new Set([...dialsBlock.matchAll(/(\d+)\s*:/g)].map(m => +m[1]));
  const dialOf = Object.fromEntries([...dialsBlock.matchAll(/(\d+)\s*:\s*"(\w+)"/g)].map(m => [+m[1], m[2]]));
  const checkoutHosts = [...(html.match(/checkoutHosts:\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)]
    .map(m => m[1].toLowerCase());

  return {
    root, at, exists, read, html,
    kb: (f) => (exists(f) ? Math.round(statSync(at(f)).size / 1024) : 0),
    pages: PAGES.filter(exists),
    cfg, edition, sold, dials, dialOf, checkoutHosts,
    notes: [],
    fail, warn,
    bad:  (m) => fail.push(m),
    soft: (m) => warn.push(m),
    /* A check reports a fact for the summary line rather than printing
       it, so the runner decides what the output looks like. */
    note: function (m) { this.notes.push(m); }
  };
}
