#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   WHAT IS ACTUALLY TRUE ON THE INTERNET RIGHT NOW.

   tools/check.mjs reads the repository. This reads the live site and
   the deployed worker, from outside, the way an attacker would — and
   every control it checks is one somebody can switch off in a dashboard
   without touching a line of code. A CSP you removed in Cloudflare, an
   "Enforce HTTPS" checkbox that came unticked, a WAF rule somebody
   deleted, a workers.dev URL left open: none of those produce a commit,
   a diff, or a failing build. They produce silence.

   So this turns the dashboard half of SECURITY.md into a command.

     node tools/verify-live.mjs
     node tools/verify-live.mjs --site https://thekaal.co --worker https://api.thekaal.co
     STRICT_HEADERS=1 node tools/verify-live.mjs      # after Cloudflare is on

   MUST checks fail the run. SHOULD checks warn, because several of them
   are only satisfiable once the site is behind a CDN — warning at you
   every day before you have done that is how a red light stops meaning
   anything. Set STRICT_HEADERS=1 the day you finish A6 and they become
   failures, which is the point at which a regression is real news.

   No dependencies. Node 18 or newer. Safe to run against production: it
   sends nine harmless requests and never a payment.
   ══════════════════════════════════════════════════════════════════ */
import { resolve as dnsResolve } from "node:dns/promises";

const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const SITE   = (arg("site",   process.env.SITE   || "https://thekaal.co")).replace(/\/+$/, "");
const WORKER = (arg("worker", process.env.WORKER || "")).replace(/\/+$/, "");
const STRICT = process.env.STRICT_HEADERS === "1" || process.argv.includes("--strict");

const rows = [];
const must   = (name, ok, detail) => rows.push({ tier: "MUST",   name, ok, detail });
const should = (name, ok, detail) => rows.push({ tier: "SHOULD", name, ok, detail });
const skip   = (name, why)        => rows.push({ tier: "SKIP",   name, ok: null, detail: why });

const get = async (url, init) => {
  try {
    const r = await fetch(url, Object.assign({ redirect: "manual", headers: { "User-Agent": "kaal-verify" } }, init));
    return { ok: true, status: r.status, headers: r.headers, text: await r.text().catch(() => "") };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 90) }; }
};
const h = (res, name) => (res.headers && res.headers.get(name)) || "";

/* ══════════ THE SITE ══════════ */
const host = new URL(SITE).hostname;
const root = await get(SITE + "/");

if (!root.ok) {
  console.log(`\n  ${SITE} is not reachable (${root.error}).`);
  console.log("  Nothing to verify yet. This is not a failure — the site may simply not be live.\n");
  process.exit(0);
}

/* A proxy, a captive network or a firewall between you and the site
   produces a page that is not the site, and then every check below fails
   for a reason that has nothing to do with the shop. Twelve false alarms
   are worse than none: they teach you to ignore this output. */
if (root.status !== 200 || !/<html/i.test(root.text || "")) {
  console.log(`\n  Could not read ${SITE}/ — HTTP ${root.status}, and the response is not an HTML page.`);
  console.log("  That is usually a proxy, a VPN or a corporate network between you and the site,");
  console.log("  not the site itself. Run this again from a machine with direct internet access");
  console.log("  before believing anything is wrong.\n");
  process.exit(2);
}
must("site answers over https", root.status === 200, `HTTP ${root.status}`);

const plain = await get(SITE.replace("https://", "http://") + "/");
must("plain http redirects to https",
  !plain.ok || (plain.status >= 300 && plain.status < 400 && /^https:/.test(h(plain, "location"))),
  plain.ok ? `HTTP ${plain.status} -> ${h(plain, "location") || "(no location)"}` : "no http listener, which is fine");

const body = root.text || "";

/* The page's own declarations — these live in the repo, so a failure
   here means the deploy is not serving what main says. */
const meta = body.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || "";
must("page carries its CSP meta", !!meta, meta ? meta.slice(0, 48) + "…" : "absent");
for (const d of ["default-src 'none'", "base-uri 'none'", "object-src 'none'", "form-action 'none'"])
  must(`CSP has ${d}`, meta.includes(d), meta.includes(d) ? "" : "missing");
must("page carries its frame guard", /window\.self !== window\.top/.test(body), "");

/* The checkout link, read off the live page rather than the repo. This
   is the check that catches a repointed payment URL even if it reached
   production some way this repository never saw. */
const checkout = body.match(/checkout:\s*"([^"]*)"/)?.[1] ?? null;
const hosts = [...(body.match(/checkoutHosts:\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(m => m[1]);
if (checkout === null) skip("live checkout URL", "no checkout: line found on the page");
else if (!checkout) skip("live checkout URL", "empty — the shop cannot take money yet");
else {
  let u = null; try { u = new URL(checkout); } catch (e) { /* reported below */ }
  must("live checkout is https on an allowed host",
    !!u && u.protocol === "https:" && hosts.some(x => u.hostname === x || u.hostname.endsWith("." + x)),
    u ? u.hostname : "unparseable");
}

/* Headers only a CDN in front of Pages can send. */
const hdr = [
  ["Strict-Transport-Security", /max-age=\d{6,}/, "HSTS with a real max-age"],
  ["X-Content-Type-Options",    /nosniff/i,       "nosniff"],
  ["Referrer-Policy",           /\S/,             "a referrer policy"],
  ["Permissions-Policy",        /\S/,             "a permissions policy"]
];
for (const [name, re, label] of hdr) {
  const v = h(root, name);
  (STRICT ? must : should)(`header: ${label}`, re.test(v), v ? v.slice(0, 40) : "absent — needs a CDN in front of Pages (A6)");
}
/* Both a header CSP and a meta CSP is not twice the policy — a browser
   enforces the INTERSECTION, so the strictest of the two wins on every
   directive. Set them to different things and the page breaks in a way
   that looks like neither of them. Keep them identical bar
   frame-ancestors, which only the header can carry. */
const hdrCsp = h(root, "Content-Security-Policy");
if (hdrCsp && meta) {
  const norm = (c) => c.split(";").map(x => x.trim()).filter(x => x && !x.startsWith("frame-ancestors")).sort().join("; ");
  should("header CSP and meta CSP agree", norm(hdrCsp) === norm(meta),
    norm(hdrCsp) === norm(meta) ? "" : "they differ — a browser enforces the strictest of the two, directive by directive");
}

const frameHdr = h(root, "Content-Security-Policy").includes("frame-ancestors") || /deny|sameorigin/i.test(h(root, "X-Frame-Options"));
(STRICT ? must : should)("header: frame-ancestors or X-Frame-Options", frameHdr, frameHdr ? "" : "absent — the in-page guard is carrying this alone (A6)");

/* Nothing on the page may be fetched over plain http. */
const insecure = [...body.matchAll(/(?:src|href)="(http:\/\/[^"]+)"/g)].map(m => m[1]).filter(u => !u.startsWith("http://www.w3.org/"));
must("no subresource loaded over plain http", insecure.length === 0, insecure.slice(0, 2).join(", "));

/* The furniture. */
for (const [path, why] of [["/robots.txt", "crawl surface"], ["/sitemap.xml", "crawl surface"], ["/legal.html", "terms and privacy"]]) {
  const r = await get(SITE + path);
  must(`${path} is served`, r.ok && r.status === 200, r.ok ? `HTTP ${r.status}` : r.error);
}
const sec = await get(SITE + "/.well-known/security.txt");
should("/.well-known/security.txt is served", sec.ok && sec.status === 200, sec.ok ? `HTTP ${sec.status}` : sec.error);
const claimed = await get(SITE + "/claimed.html");
must("claimed.html is noindex", /name="robots"\s+content="noindex/.test(claimed.text || ""), "");

/* ══════════ DNS ══════════ */
const txt = async (name) => { try { return (await dnsResolve(name, "TXT")).map(a => a.join("")); } catch (e) { return []; } };

try {
  const caa = await dnsResolve(host, "CAA").catch(() => []);
  should("CAA record limits who may issue certificates", caa.length > 0,
    caa.length ? caa.map(c => c.issue || c.issuewild).filter(Boolean).join(", ") : "absent (A8)");
} catch (e) { skip("CAA record", "lookup unavailable here"); }

const spf = (await txt(host)).filter(t => /^v=spf1/i.test(t));
should("SPF record published", spf.length > 0, spf[0]?.slice(0, 50) || "absent — anyone can send mail as this domain (A8)");

const dmarc = (await txt("_dmarc." + host)).filter(t => /^v=DMARC1/i.test(t));
const policy = dmarc[0]?.match(/\bp=(\w+)/)?.[1] || "";
should("DMARC record published", dmarc.length > 0, dmarc.length ? `p=${policy}` : "absent (A8)");
if (dmarc.length) should("DMARC policy is not p=none", policy && policy !== "none", `p=${policy || "?"} — p=none observes, it does not protect`);

/* ══════════ THE WORKER ══════════ */
if (!WORKER) {
  skip("worker checks", "no --worker URL given; pass one once it is deployed");
} else {
  const alive = await get(WORKER + "/");
  must("worker answers", alive.ok, alive.ok ? `HTTP ${alive.status}` : alive.error);

  if (alive.ok) {
    must("worker sends nosniff", /nosniff/i.test(h(alive, "X-Content-Type-Options")), h(alive, "X-Content-Type-Options") || "absent");

    const alerts = await get(WORKER + "/alerts");
    must("/alerts is closed without a token", alerts.ok && alerts.status === 404, `HTTP ${alerts.status}`);

    const bad = await get(WORKER + "/nope", { method: "PUT" });
    must("unknown routes are refused", bad.ok && bad.status === 405, `HTTP ${bad.status}`);

    const hostile = await get(WORKER + "/hold", {
      method: "POST", headers: { "Content-Type": "application/json", "Origin": "https://not-kaal.example" },
      body: JSON.stringify({ n: 1, by: "verifyprobe1" })
    });
    must("/hold refuses a foreign origin", hostile.ok && hostile.status === 403, `HTTP ${hostile.status}`);

    const forged = await get(WORKER + "/", {
      method: "POST", headers: { "x-razorpay-signature": "0".repeat(64), "Content-Type": "application/json" },
      body: JSON.stringify({ event: "payment.captured" })
    });
    must("webhook rejects a forged signature", forged.ok && forged.status === 400, `HTTP ${forged.status}`);

    const big = await get(WORKER + "/", {
      method: "POST", headers: { "x-razorpay-signature": "0".repeat(64) }, body: "x".repeat(200 * 1024)
    });
    must("webhook refuses an oversized body", big.ok && (big.status === 413 || big.status === 400), `HTTP ${big.status}`);

    const state = await get(WORKER + "/state", { headers: { "Origin": SITE } });
    must("/state answers the site's own origin", state.ok && state.status === 200, `HTTP ${state.status}`);
    const acao = h(state, "Access-Control-Allow-Origin");
    must("/state does not allow every origin", acao !== "*", acao || "absent");

    const devUrl = arg("workers-dev", process.env.WORKERS_DEV || "");
    if (!devUrl) skip("workers.dev back door", "pass --workers-dev <url> to confirm it is closed");
    else {
      const dev = await get(devUrl + "/");
      must("workers.dev URL is closed", !dev.ok || dev.status === 404 || dev.status >= 500,
        dev.ok ? `HTTP ${dev.status} — still open, set workers_dev = false (A6)` : "unreachable, as it should be");
    }
  }
}

/* ══════════ THE REPORT ══════════ */
const pad = (s, n) => String(s).padEnd(n);
console.log(`\n  ${SITE}${WORKER ? "  ·  " + WORKER : ""}${STRICT ? "  ·  strict" : ""}\n`);
let fails = 0, warns = 0;
for (const r of rows) {
  const mark = r.ok === null ? "  —  " : r.ok ? " ok  " : (r.tier === "MUST" ? "FAIL " : "warn ");
  if (r.ok === false && r.tier === "MUST") fails++;
  if (r.ok === false && r.tier === "SHOULD") warns++;
  console.log(`  ${mark} ${pad(r.name, 48)} ${r.detail || ""}`);
}
console.log("");
if (warns) console.log(`  ${warns} warning(s). These are the controls a CDN in front of the site provides — see SECURITY.md part two.`);
console.log(fails ? `  ${fails} FAILURE(S). Something that was protecting this shop is not protecting it now.\n`
                  : `  Everything that must hold, holds.\n`);
process.exit(fails ? 1 : 0);
