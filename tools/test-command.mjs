/* ══════════════════════════════════════════════════════════════════
   The command centre's controls (worker/kaal-sold-sync.js, control.js,
   push.js): a sale recorded as paid whatever GitHub does, the On sale /
   Kept back switch, the owner's one-time requests, the repair run,
   phone alerts end to end (encrypted, signed, decrypted here), and the
   Activity feed. On the real migrations, in Node's SQLite.

     node --no-warnings tools/test-command.mjs
   Exits non-zero if anything fails. CI runs it on every pull request.
   ══════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
import { createHmac, webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import w, { Stats } from "../worker/kaal-sold-sync.js";
import { unb64u, b64u } from "../worker/push.js";
import { d1, kv, ctx } from "./d1-shim.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const subtle = webcrypto.subtle;

/* ── The world outside: GitHub (Git Data API and contents), Razorpay,
      Resend, and one phone's push service. ── */
const ROOT = new URL("../", import.meta.url);
const files = { "index.html": readFileSync(new URL("index.html", ROOT), "utf8"), "llms.txt": readFileSync(new URL("llms.txt", ROOT), "utf8") };
files["index.html"] = files["index.html"].replace(/sold:\s*\[[^\]]*\]/, "sold:     [1, 2, 3, 4, 7, 9, 10, 15]");
let ghDown = false, ghWrites = 0, head = "a".repeat(40), pendingTree = null;
const soldOnGitHub = () => JSON.parse("[" + /sold:\s*\[([^\]]*)\]/.exec(files["index.html"])[1] + "]");
const payments = [], orders = {}, mails = [], pushes = [];
let pushStatus = 201, rzpListings = 0;

globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const method = (init.method || "GET").toUpperCase();
  if (url.includes("api.resend.com")) { mails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url.includes("api.github.com")) {
    if (ghDown) return new Response("down", { status: 500 });
    const path = url.replace(/^https:\/\/api\.github\.com\/repos\/o\/r/, "");
    if (path === "/git/ref/heads/main") return Response.json({ object: { sha: head } });
    let m = /^\/contents\/([\w.]+)\?ref=/.exec(path);
    if (m && method === "GET") {
      const raw = String((init.headers || {}).Accept || "").includes("raw");
      if (!(m[1] in files)) return new Response("no", { status: 404 });
      return raw ? new Response(files[m[1]]) : Response.json({ content: Buffer.from(files[m[1]]).toString("base64"), sha: head });
    }
    if (/^\/git\/commits\/\w+$/.test(path)) return Response.json({ tree: { sha: "tree" } });
    if (path === "/git/trees") { pendingTree = JSON.parse(init.body).tree; return Response.json({ sha: "t2" }); }
    if (path === "/git/commits") return Response.json({ sha: "b".repeat(40) });
    if (path === "/git/refs/heads/main" && method === "PATCH") {
      for (const f of pendingTree || []) files[f.path] = f.content;
      ghWrites++; head = String(ghWrites).padStart(40, "c"); return Response.json({});
    }
    if (/^\/contents\/index\.html$/.test(path) && method === "PUT") {
      files["index.html"] = Buffer.from(JSON.parse(init.body).content, "base64").toString("utf8"); ghWrites++; return Response.json({});
    }
    return new Response("unexpected " + path, { status: 404 });
  }
  if (url.includes("api.razorpay.com")) {
    const u = new URL(url);
    if (u.pathname === "/v1/payments") { rzpListings++; return Response.json({ items: payments.slice(+u.searchParams.get("skip") || 0, (+u.searchParams.get("skip") || 0) + 100) }); }
    if (u.pathname === "/v1/orders") return Response.json({ items: [] });
    const o = /^\/v1\/orders\/(order_\w+)$/.exec(u.pathname);
    if (o) return orders[o[1]] ? Response.json(orders[o[1]]) : new Response("{}", { status: 404 });
    return Response.json({ items: [] });
  }
  if (url.startsWith("https://fcm.googleapis.com/")) { pushes.push({ url, headers: init.headers, body: new Uint8Array(init.body) }); return new Response("", { status: pushStatus }); }
  if (url.includes("graph.facebook.com") || url.includes("bing.com") || url.includes("indexnow")) return Response.json({});
  return new Response("{}", { status: 404 });
};

/* ── The worker's bindings ── */
const DB = d1(), KV = kv();
const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...b) {
  const rows = /^\s*SELECT/i.test(q) ? db.prepare(q).all(...b) : (b.length ? (db.prepare(q).run(...b), []) : (db.exec(q), []));
  return { toArray: () => rows.map(r => Object.assign({}, r)) };
} };
const box = new Map();
const so = new Stats({ storage: { sql, async get(k) { return Array.isArray(k) ? new Map(k.filter(x => box.has(x)).map(x => [x, box.get(x)])) : box.get(k); },
  async put(k, v) { box.set(k, JSON.parse(JSON.stringify(v))); }, async delete(k) { box.delete(k); }, async setAlarm() {} } });
const STATS = { idFromName: () => "kaal", get: () => ({ fetch: (u, i) => so.fetch(new Request(u, i)) }) };
const ORIGIN = "https://kaal-edition.kaal-edition-hq.workers.dev";
const env = {
  DB, KAAL_STATE: KV, STATS, STAGING: "", EDITION: "20", OWNER_OPS: "off", PRICE_PAISE: "599900", CURRENCY: "INR", SITE_URL: "https://thekaal.co", WORKER_URL: ORIGIN,
  ALLOW_ORIGIN: "https://thekaal.co", RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "wh", RESEND_API_KEY: "re",
  OWNER_EMAIL: "arjun@example.com", ADMIN_2FA: "off", AUTH_SECRET: "a".repeat(48), DESK_PASSCODE: "brass quiet lantern 42",
  GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", REGISTRY: "on", DIGEST: "off"
};
let jar = "";
async function call(method, path, body, extra, e = env) {
  const h = Object.assign({ "X-KAAL": "1", "X-Desk": "1", Origin: ORIGIN, Cookie: jar, "cf-connecting-ip": "203.0.113.5", "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36" }, extra || {});
  const k = ctx();
  const r = await w.fetch(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), e, k);
  await k.done();
  const set = r.headers.get("Set-Cookie");
  if (set) { const c = /^kaal_s=([^;]*)/.exec(set); if (c) jar = c[1] ? "kaal_s=" + c[1] : ""; }
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (x) { j = null; }
  return { status: r.status, j, text };
}
async function cron(e = env) { const k = ctx(); await w.scheduled({}, e, k); await k.done(); }
async function hook(entity) {
  const b = JSON.stringify({ event: "payment.captured", payload: { payment: { entity } } });
  const k = ctx();
  const r = await w.fetch(new Request(ORIGIN + "/", { method: "POST", headers: { "x-razorpay-signature": createHmac("sha256", "wh").update(b).digest("hex") }, body: b }), env, k);
  const text = await r.text(); await k.done();
  return { status: r.status, text };
}
const piece = (n) => DB.raw.prepare("SELECT * FROM pieces WHERE number = ?").get(n);
const kvSold = () => JSON.parse(KV.store.get("sold") || "[]");

/* Sign in the way the owner does: the passcode. */
{
  KV.store.set("sold", "[1,2,3,4,7,9,10,15]");
  const r = await call("POST", "/auth/passcode", { passcode: "brass quiet lantern 42" });
  ok(r.j && r.j.ok && jar, "sign-in: the passcode opens the command centre");
}

/* ── 1. Phone alerts: a real subscription, encrypted and signed ── */
const phone = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const phonePub = new Uint8Array(await subtle.exportKey("raw", phone.publicKey));
const phoneAuth = webcrypto.getRandomValues(new Uint8Array(16));
const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/dPhone123:APA91bTest", keys: { p256dh: b64u(phonePub), auth: b64u(phoneAuth) } };
async function hkdf(salt, ikm, info, len) {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}
/* The phone's side of RFC 8291, written from the RFC, not from push.js. */
async function decrypt(body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: asKey }, phone.privateKey, 256));
  const te = new TextEncoder(), cat = (...p) => { const o = new Uint8Array(p.reduce((t, x) => t + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
  const ikm = await hkdf(phoneAuth, secret, cat(te.encode("WebPush: info\0"), phonePub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));
  return JSON.parse(new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2))));
}
async function vapidOk(auth, aud) {
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(auth || "");
  if (!m) return false;
  const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
  const key = await subtle.importKey("raw", unb64u(m[4]), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const good = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64u(m[3]), new TextEncoder().encode(m[1] + "." + m[2]));
  return good && claims.aud === aud && claims.exp > Date.now() / 1000 && /^mailto:/.test(claims.sub);
}
{
  let r = await call("GET", "/control/api/push/state");
  ok(r.j.ok && unb64u(r.j.key).length === 65 && r.j.devices.length === 0 && r.j.prefs.sale === true, "alerts: the worker makes its own signing key, and no device is on yet");
  const key1 = r.j.key;
  r = await call("POST", "/control/api/push/subscribe", { sub: { endpoint: "https://evil.example/collect", keys: SUB.keys } });
  ok(r.status === 400 && !KV.store.has("push:subs"), "alerts: a subscription pointing anywhere but a browser's push service is refused");
  r = await call("POST", "/control/api/push/subscribe", { sub: SUB });
  ok(r.j.ok && r.j.devices === 1, "alerts: this phone is subscribed");
  r = await call("GET", "/control/api/push/state");
  ok(r.j.key === key1 && r.j.devices[0].device === "Android phone, Chrome", "alerts: the same key next time, and the device is named");
  r = await call("POST", "/control/api/push/test", {});
  const p = pushes[0];
  const note = p && await decrypt(p.body);
  ok(r.j.ok && r.j.sent === 1 && note && /phone alerts are on/.test(note.title) && note.url === "/control#today", "alerts: a test reaches the phone, encrypted to it alone, and decrypts to the message");
  ok(p && p.headers["Content-Encoding"] === "aes128gcm" && await vapidOk(p.headers.Authorization, "https://fcm.googleapis.com"), "alerts: signed by the worker (VAPID) for that push service, as RFC 8292 asks");
  ok(!new TextDecoder().decode(p.body).includes("phone alerts"), "alerts: the push service itself cannot read it");
  r = await call("POST", "/control/api/push/prefs", { prefs: { checkout: false, sale: false } });
  ok(r.j.prefs.checkout === false && r.j.prefs.sale === true, "alerts: kinds can be switched off, except a sale");
  await call("POST", "/control/api/push/prefs", { prefs: {} });
}

/* ── 2. A sale is paid: recorded, live and in the history, whatever GitHub does ── */
{
  /* The buyer's visit, linked at checkout as the page does it. */
  await so.fetch(new Request("https://stats/link", { method: "POST", body: JSON.stringify({ u: "buyerdevice01", o: "order_Buy05aaaa", n: 5, buyer: { name: "Riya Sen", email: "riya@example.com", phone: "9812345678" } }) }));
  orders.order_Buy05aaaa = { id: "order_Buy05aaaa", amount: 599900, status: "paid", notes: { kaal_no: "05" } };
  const pay = { id: "pay_Buy05aaaa", order_id: "order_Buy05aaaa", amount: 599900, currency: "INR", status: "captured", email: "riya@example.com", contact: "+919812345678", notes: { kaal_no: "05" }, created_at: Math.floor(Date.now() / 1000) };
  payments.push(pay);
  ghDown = true; pushes.length = 0;
  let r = await hook(pay);
  const live = (await (await so.fetch(new Request("https://stats/live"))).json());
  ok(r.status === 200 && kvSold().includes(5), "paid: with GitHub down, the sale is still recorded, and the shop (KV) shows No. 05 gone at once");
  ok(live.paid.length === 1 && live.paid[0].no === "05", "paid: the live view shows the sale");
  ok(piece(5).status === "placed" && DB.raw.prepare("SELECT COUNT(*) AS c FROM orders WHERE razorpay_payment_id = ?").get(pay.id).c === 1, "paid: the registry holds the order, ready to ship");
  const buyer = so.histOne(so.sql.exec("SELECT k FROM visitor WHERE id = 'buyerdevice01'").toArray()[0].k).v;
  ok(buyer.steps.filter(s => s.e === "paid").length === 1 && buyer.paid.includes("05"), "paid: the buyer's own history says when they paid, and for which number");
  const sale = await Promise.all(pushes.map(x => decrypt(x.body)));
  ok(sale.some(n => /^Sold: No\. 05/.test(n.title) && n.url === "/control#orders"), "paid: the owner's phone is told: Sold, No. 05, with the amount");
  ok(!soldOnGitHub().includes(5), "(the site file is behind while GitHub is down)");

  /* Razorpay delivers it again (its timeout), and now GitHub answers. */
  ghDown = false;
  r = await hook(pay);
  const live2 = (await (await so.fetch(new Request("https://stats/live"))).json());
  const buyer2 = so.histOne(buyer.k).v;
  ok(r.status === 200 && soldOnGitHub().includes(5), "retry: the second delivery writes the site file");
  ok(live2.paid.length === 1 && buyer2.steps.filter(s => s.e === "paid").length === 1, "retry: still one sale in the live view and one paid step in the history");
  r = await hook(pay);
  ok(/already recorded/.test(r.text) && kvSold().filter(n => n === 5).length === 1, "retry: a third delivery finds it already recorded, and changes nothing");

  /* A payment whose checkout the history never saw: found by email. */
  await so.fetch(new Request("https://stats/link", { method: "POST", body: JSON.stringify({ u: "otherdevice02", o: "order_Look06aaaa", n: 6, buyer: { name: "Kabir", email: "kabir@example.com" } }) }));
  orders.order_Paid06aaaa = { id: "order_Paid06aaaa", amount: 599900, status: "paid", notes: { kaal_no: "06" } };
  const pay6 = { id: "pay_Paid06aaaa", order_id: "order_Paid06aaaa", amount: 599900, currency: "INR", status: "captured", email: "Kabir@Example.com", contact: "", notes: { kaal_no: "06" }, created_at: Math.floor(Date.now() / 1000) };
  payments.push(pay6);
  await hook(pay6);
  const kabir = so.histOne(so.sql.exec("SELECT k FROM visitor WHERE id = 'otherdevice02'").toArray()[0].k).v;
  ok(kabir.paid.includes("06"), "paid: a payment on an order the history never linked still finds its visitor, by the email");
}

/* ── 3. The repair run: a paid number the site file still offers ── */
{
  files["index.html"] = files["index.html"].replace(/sold:\s*\[[^\]]*\]/, "sold:     [1, 2, 3, 4, 7, 9, 10, 15]");
  await cron();
  ok(soldOnGitHub().includes(5) && soldOnGitHub().includes(6), "repair: the half-hourly run writes paid numbers the site file is missing");
  const n = ghWrites;
  await cron();
  ok(ghWrites === n, "repair: and writes nothing when the file already agrees");
}

/* ── 4. On sale, or kept back ── */
{
  /* The owner's own test order for No. 09, from before. */
  orders.order_Test09aaaa = { id: "order_Test09aaaa", amount: 599900, status: "paid", notes: { kaal_no: "09" } };
  payments.push({ id: "pay_Test09aaaa", order_id: "order_Test09aaaa", amount: 599900, currency: "INR", status: "captured", email: "arjun@example.com", notes: { kaal_no: "09" }, created_at: Math.floor(Date.parse("2026-10-02T10:00:00Z") / 1000) });
  ok(piece(9).status === "withheld" && soldOnGitHub().includes(9), "(No. 09 starts kept back, and on the sold list)");
  let r = await call("POST", "/control/api/pieces/9/sale", { on: true });
  ok(r.j.ok && r.j.status === "available" && r.j.site === "ok", "sale: Put it on sale answers that the site file took it");
  ok(piece(9).status === "available" && !kvSold().includes(9) && !soldOnGitHub().includes(9), "sale: the registry, the shop (KV) and the site file all say No. 09 is open");
  ok(/No\. 09 [^\n]*available|available[^\n]*09|12 of 20|"inventoryLevel"/.test(files["index.html"]) && JSON.parse(files["edition.json"] || "{}").available >= 1, "sale: the same commit rewrote the counts and edition.json");
  r = await call("GET", "/state", undefined, { Origin: "https://thekaal.co" });
  ok(r.j && Array.isArray(r.j.sold) && !r.j.sold.includes(9), "sale: the live page's own check (/state) shows No. 09 open");
  r = await call("POST", "/control/api/import", {});
  ok(r.j.ok && r.j.released.includes(9) && DB.raw.prepare("SELECT COUNT(*) AS c FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE p.number = 9").get().c === 0 && piece(9).status === "available",
    "sale: the daily check against Razorpay never turns the old test payment back into a sale");
  r = await hook(payments.find(p => p.id === "pay_Test09aaaa"));
  ok(/before this number went back on sale/.test(r.text) && piece(9).status === "available", "sale: nor does a late webhook for it");
  r = await call("POST", "/control/api/pieces/12/sale", { on: false, reason: "kept for the founder" });
  ok(r.j.ok && r.j.status === "withheld" && piece(12).status === "withheld" && kvSold().includes(12) && soldOnGitHub().includes(12), "sale: Keep it back takes No. 12 off the shop, KV and the site file at once");
  r = await call("POST", "/control/api/pieces/5/sale", { on: true });
  ok(r.status === 409 && /Refund it or mark it returned/.test(r.j.why) && piece(5).status === "placed", "sale: a number with a paid order cannot be put back on sale from here");
  r = await call("POST", "/control/api/pieces/12/sale", { on: true });
  ok(r.j.ok && piece(12).status === "available" && !soldOnGitHub().includes(12), "sale: and back again");
  const a = DB.raw.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'piece.sale'").get().c;
  ok(a === 3, "sale: every change is in the audit log (" + a + ")");
}

/* ── 5. The owner's request, done once on the first run after deploy ── */
{
  const D2 = d1(), K2 = kv();
  K2.store.set("sold", "[1,2,3,4,7,9,10,15]");
  files["index.html"] = files["index.html"].replace(/sold:\s*\[[^\]]*\]/, "sold:     [1, 2, 3, 4, 7, 9, 10, 15]");
  const e2 = Object.assign({}, env, { DB: D2, KAAL_STATE: K2, OWNER_OPS: "" });
  K2.store.set("registry:imported", "{}");
  await cron(e2);
  const p9 = D2.raw.prepare("SELECT status FROM pieces WHERE number = 9").get();
  ok(p9.status === "available" && !soldOnGitHub().includes(9) && !JSON.parse(K2.store.get("sold")).includes(9) && K2.store.has("op:2026-10-28-release-09"),
    "owner's request: No. 09 goes on sale on the first run, everywhere, and is marked done");
  const n = ghWrites;
  D2.raw.prepare("UPDATE pieces SET status = 'withheld' WHERE number = 9").run();
  await cron(e2);
  ok(ghWrites === n && D2.raw.prepare("SELECT status FROM pieces WHERE number = 9").get().status === "withheld", "owner's request: never again, even if No. 09 is kept back later");
  const D3 = d1(), K3 = kv();
  D3.raw.prepare("UPDATE pieces SET status = 'placed' WHERE number = 9").run();
  K3.store.set("registry:imported", "{}");
  await cron(Object.assign({}, env, { DB: D3, KAAL_STATE: K3, OWNER_OPS: "" }));
  ok(D3.raw.prepare("SELECT status FROM pieces WHERE number = 9").get().status === "placed" && K3.store.has("op:2026-10-28-release-09"), "owner's request: skipped if No. 09 is no longer as it was asked about");
}

/* ── 6. Activity: everything on one line of time ── */
{
  let r = await call("GET", "/control/api/activity?since=0&f=all");
  const txt = (r.j.rows || []).map(x => x.txt);
  ok(r.j.ok && txt.some(t => /^Paid ₹5,999 for No\. 05/.test(t)) && txt.some(t => /^No\. 09 put on sale/.test(t)), "activity: a visitor's payment and your own change, on one line");
  ok(r.j.rows.every((x, i, a) => !i || a[i - 1].t >= x.t), "activity: newest first");
  const paid = r.j.rows.find(x => x.e === "paid" && x.no === "05");
  ok(paid && paid.name === "Riya" && paid.k > 0, "activity: each visitor line says who (first name only) and which visitor to open");
  r = await call("GET", "/control/api/activity?since=0&f=money");
  ok(r.j.rows.length && r.j.rows.every(x => x.src === "visitor" && /^(paid|pay_failed|pay_closed|checkout)$/.test(x.e)), "activity: Money shows only money");
  r = await call("GET", "/control/api/activity?since=0&f=you");
  ok(r.j.rows.length && r.j.rows.every(x => x.src === "you"), "activity: You shows only what you changed");
  jar = "";
  r = await call("GET", "/control/api/activity?since=0");
  ok(r.status === 401, "activity: signed out, nothing");
}

/* ── 7. Speed: the desk asks Razorpay once, not on every screen ── */
{
  await call("POST", "/auth/passcode", { passcode: "brass quiet lantern 42" });
  await call("POST", "/control/api/push/prefs", { prefs: {} });
  const n0 = rzpListings;
  await call("GET", "/desk/data");
  await call("GET", "/desk/data");
  const n1 = rzpListings;
  await call("POST", "/control/api/pieces/12/sale", { on: true });
  await call("GET", "/desk/data");
  ok(n1 - n0 === 1 && rzpListings - n1 === 1, "speed: two screens in a row share one Razorpay listing; a change reads it fresh");
  pushStatus = 410;
  await call("POST", "/control/api/push/test", {});
  const st = await call("GET", "/control/api/push/state");
  ok(st.j.devices.length === 0, "alerts: a phone the push service says is gone is dropped");
}

/* ── 8. Every owner's page, from the command centre ── */
{
  const day = new Date(Date.now() + 5.5 * 3600000 - 3 * 86400000).toISOString().slice(0, 10);
  DB.raw.prepare("UPDATE orders SET status = 'registered', delivered_on = ?, registered_at = ? WHERE razorpay_payment_id = 'pay_Buy05aaaa'").run(day, new Date().toISOString());
  DB.raw.prepare("UPDATE pieces SET status = 'registered' WHERE number = 5").run();
  DB.raw.prepare("INSERT INTO owners (email, name, phone, city, state, show_city_publicly, show_name_publicly, data_consent_at, created_at, updated_at) VALUES ('riya@example.com', 'Riya Sen', '919812345678', 'Kolkata', 'West Bengal', 1, 0, ?1, ?1, ?1)").run(new Date().toISOString());
  const oid = DB.raw.prepare("SELECT id FROM owners WHERE email = 'riya@example.com'").get().id;
  const ord = DB.raw.prepare("SELECT id FROM orders WHERE razorpay_payment_id = 'pay_Buy05aaaa'").get().id;
  DB.raw.prepare("INSERT INTO ownerships (series, piece_id, owner_id, owner_no, from_at, acquired_via, order_id) VALUES ('S01', 'S01-05', ?, 1, ?, 'purchase', ?)").run(oid, new Date().toISOString(), ord);
  let r = await call("GET", "/control/api/owners/live");
  const o5 = (r.j.owners || []).find(o => o.n === 5);
  ok(r.j.ok && o5 && o5.name === "Riya Sen" && o5.ownerNo === 1 && o5.warranty && o5.warranty.endMs > Date.now() && o5.cityPublic && !o5.initialsPublic, "owners, live: each owner with their number, place in the line, warranty clock and what the shop shows");
  r = await call("GET", "/control/api/owners/" + oid + "/dossier");
  ok(r.j.ok && r.j.pieces.length === 1 && r.j.pieces[0].n === 5 && r.j.pieces[0].warranty && r.j.owner.initials === "R\u2022\u2022\u2022 S\u2022\u2022", "owners: the admin sees an owner's own page, exactly as they do");
  r = await call("GET", "/control/api/owners/99999/dossier");
  ok(r.status === 404, "owners: an owner who does not exist, nothing");
  const keep = jar; jar = "";
  r = await call("GET", "/control/api/owners/" + oid + "/dossier");
  ok(r.status === 401, "owners: signed out, nobody's page");
  jar = keep;
}

console.log(failed ? `\n${failed} failed.` : "\nAll command centre control tests passed.");
process.exit(failed ? 1 : 0);
