/* ══════════════════════════════════════════════════════════════════
   A browser test bench with no servers: Chromium (Playwright) opens the
   real pages at https://thekaal.co/…, read straight from this repository
   the way GitHub Pages would serve them, and every call they make to the
   worker is answered in-process by the real worker on the real
   migrations in Node's SQLite. Nothing leaves the machine.

   Not part of CI (the repository has no npm); run by hand:
     NODE_PATH=/opt/node-tools/node_modules node --no-warnings tools/ui/<test>.mjs
   ══════════════════════════════════════════════════════════════════ */
import { createRequire } from "node:module";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import w from "../../worker/kaal-sold-sync.js";
import { d1, kv, ctx } from "../d1-shim.mjs";

const require = createRequire(import.meta.url);
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const SITE = "https://thekaal.co", WORKER = "https://kaal-edition.kaal-edition-hq.workers.dev";
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".txt": "text/plain" };

export function world(extra) {
  const DB = d1(), KV = kv(), mails = [];
  KV.store.set("sold", "[1,2]");
  const env = Object.assign({
    DB, KAAL_STATE: KV, EDITION: "20", PRICE_PAISE: "599900", CURRENCY: "INR", ALLOW_ORIGIN: SITE, SITE_URL: SITE, WORKER_URL: WORKER,
    RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "wh", RESEND_API_KEY: "re", OWNER_EMAIL: "owner@thekaal.co",
    ADMIN_EMAIL: "admin@thekaal.co", AUTH_SECRET: "a".repeat(48), SHIPROCKET_TOKEN: "shiprocket-secret-token",
    GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", DIALS: JSON.stringify({ 7: "Midnight", 8: "Midnight" })
  }, extra || {});
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes("api.resend.com")) { mails.push(JSON.parse(init.body)); return new Response("{}"); }
    if (url.includes("api.github.com")) return new Response(JSON.stringify({ content: Buffer.from("var KAAL = {\n  sold:     [1, 2],\n};").toString("base64"), sha: "x" }));
    if (/\/v1\/(payments|refunds|orders)\?/.test(url)) return new Response(JSON.stringify({ items: [] }));
    return new Response("{}", { status: 404 });
  };
  return { env, DB, KV, mails };
}

/* Serves the site from disk and the worker from memory to one page. */
export async function open(W, opts) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const context = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "en-IN", timezoneId: "Asia/Kolkata" }, opts || {}));
  const log = { console: [], errors: [], requests: [] };
  await context.route(/^https:\/\/thekaal\.co\//, async (route) => {
    const u = new URL(route.request().url());
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith("/")) p += "index.html";
    let f = join(ROOT, p);
    if (!existsSync(f) || statSync(f).isDirectory()) f = existsSync(f + ".html") ? f + ".html" : f;
    if (!existsSync(f) || statSync(f).isDirectory()) return route.fulfill({ status: 404, contentType: "text/html", body: "<h1>404</h1>" });
    return route.fulfill({ status: 200, contentType: TYPES[extname(f)] || "application/octet-stream", body: readFileSync(f) });
  });
  await context.route(new RegExp("^" + WORKER.replace(/[.]/g, "\\.") + "/"), async (route) => {
    const r = route.request();
    log.requests.push(r.method() + " " + new URL(r.url()).pathname + new URL(r.url()).search);
    const k = ctx();
    const body = r.postDataBuffer();
    const res = await w.fetch(new Request(r.url(), { method: r.method(), headers: r.headers(), body: body && r.method() !== "GET" ? body : undefined }), W.env, k);
    await k.done();
    const headers = {}; res.headers.forEach((v, n) => { headers[n] = v; });
    return route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
  });
  context.on("page", (pg) => {
    pg.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") log.console.push(m.type() + ": " + m.text()); });
    pg.on("pageerror", (e) => log.errors.push(String(e)));
  });
  return { browser, context, log, async page() { return context.newPage(); } };
}
