/* ══════════════════════════════════════════════════════════════════
   Going live: the registry on the real shop. The import of the orders
   Razorpay already holds, the past-sale record for the numbers it does
   not, the dated correction, and the off switch.

     node --no-warnings tools/test-live.mjs
   ══════════════════════════════════════════════════════════════════ */
import { createHash } from "node:crypto";
import w from "../worker/kaal-sold-sync.js";
import { d1, kv, ctx } from "./d1-shim.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const ORIGIN = "https://kaal-edition.kaal-edition-hq.workers.dev";
const at = (iso) => Math.floor(Date.parse(iso) / 1000);

const DB = d1(), KV = kv(), mails = [], refunds = [];
KV.store.set("sold", "[1,2,7,9,10]");
KV.store.set("sent:order_I10", JSON.stringify({ at: "2026-10-21T09:00:00.000Z", courier: "Delhivery", tracking: "DL10", url: "https://www.delhivery.com/track/package/DL10" }));
KV.store.set("ship:order_I07", JSON.stringify({ src: "checkout", name: "Rahul Sharma", line1: "1 Road", city: "Delhi", state: "Delhi", pin: "110001", buyer: { name: "Rahul Sharma", email: "rahul@example.com", phone: "+919800000007" } }));
const env = {
  DB, KAAL_STATE: KV, EDITION: "20", OWNER_OPS: "off", PRICE_PAISE: "599900", CURRENCY: "INR", SITE_URL: "https://thekaal.co", WORKER_URL: ORIGIN, REGISTRY: "on",
  ALLOW_ORIGIN: "https://thekaal.co", RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "sek", RESEND_API_KEY: "re", OWNER_EMAIL: "arjun@example.com",
  AUTH_SECRET: "b".repeat(48), GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r"
};
const pays = [
  { id: "pay_I09", order_id: "order_I09", status: "captured", amount: 599900, currency: "INR", email: "arjun@example.com", created_at: at("2026-10-02T14:40:00Z") },
  { id: "pay_I10", order_id: "order_I10", status: "captured", amount: 599900, currency: "INR", email: "ten@example.com", contact: "+919800000010", created_at: at("2026-10-20T08:54:00Z") },
  { id: "pay_I07", order_id: "order_I07", status: "captured", amount: 599900, currency: "INR", email: "rahul@example.com", contact: "+919800000007", created_at: at("2026-10-22T08:55:00Z") },
  { id: "pay_IREF", order_id: "order_IREF", status: "refunded", amount: 599900, currency: "INR", email: "gone@example.com", created_at: at("2026-10-10T08:00:00Z") },
  { id: "pay_ISMALL", order_id: "order_ISMALL", status: "captured", amount: 100, currency: "INR", email: "rupee@example.com", created_at: at("2026-10-11T08:00:00Z") },
  { id: "pay_I10b", order_id: "order_I10b", status: "captured", amount: 599900, currency: "INR", email: "twice@example.com", created_at: at("2026-10-21T08:00:00Z") }
];
const numOf = { order_I09: "09", order_I10: "10", order_I07: "07", order_IREF: "05", order_ISMALL: "06", order_I10b: "10" };
let rzpUp = true;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes("api.resend.com")) { mails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url.includes("api.github.com")) return new Response(JSON.stringify({ content: Buffer.from("var KAAL = {\n  sold:     [1, 2, 7, 9, 10],\n};").toString("base64"), sha: "x" }));
  if (/\/v1\/payments\?from=/.test(url)) return rzpUp ? new Response(JSON.stringify({ items: /skip=0/.test(url) ? pays : [] })) : new Response("{}", { status: 500 });
  if (/\/v1\/(refunds|orders)\?/.test(url)) return new Response(JSON.stringify({ items: [] }));
  let m = /\/v1\/payments\/(pay_\w+)\/refund$/.exec(url);
  if (m) { refunds.push(m[1]); return new Response(JSON.stringify({ id: "rfnd_" + m[1] })); }
  m = /\/v1\/orders\/(order_\w+)$/.exec(url);
  if (m) return new Response(JSON.stringify({ id: m[1], status: "paid", amount: m[1] === "order_ISMALL" ? 100 : 599900, currency: "INR", notes: { kaal_no: numOf[m[1]], ua: "UA" } }));
  return new Response("{}", { status: 404 });
};

/* An admin who has signed in and given the authenticator's code. */
const token = "T".repeat(43);
DB.raw.exec("INSERT INTO owners (email, role) VALUES ('arjun@example.com', 'admin')");
DB.raw.prepare("INSERT INTO sessions (id, owner_id, expires_at, mfa_at) VALUES (?, 1, '2099-01-01T00:00:00Z', '2026-10-22T00:00:00Z')")
  .run(createHash("sha256").update(token).digest("hex"));
async function call(method, path, body, e) {
  const h = { "X-KAAL": "1", Origin: ORIGIN, Cookie: "kaal_s=" + token, "cf-connecting-ip": "203.0.113.9" };
  if (body !== undefined) h["Content-Type"] = "application/json";
  const k = ctx();
  const r = await w.fetch(new Request(ORIGIN + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }), e || env, k);
  await k.done();
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (x) { j = null; }
  return { status: r.status, j, t };
}
const piece = (n) => DB.raw.prepare("SELECT status, order_ref, notes FROM pieces WHERE number = ?").get(n);

/* ── 1. The import ── */
{
  rzpUp = false;
  let r = await call("POST", "/control/api/import", {});
  ok(r.status === 502 && !r.j.ok && DB.raw.prepare("SELECT COUNT(*) AS c FROM orders").get().c === 0, "import: Razorpay down, nothing half-written, a clear failure");
  rzpUp = true;
  r = await call("POST", "/control/api/import", {});
  const j = r.j;
  ok(j.ok && j.imported.join() === "10,7", "import: the two real sales, No. 10 and No. 07");
  ok(j.withheld.join() === "9" && piece(9).status === "withheld" && !DB.raw.prepare("SELECT 1 FROM orders WHERE razorpay_payment_id = 'pay_I09'").get(), "import: No. 09 (the owner's test) stays withheld, no order");
  ok(j.duplicates.length === 1 && j.duplicates[0].payment === "pay_I10b" && refunds.length === 0, "import: a second payment for No. 10 is reported, never refunded by the import");
  ok(!DB.raw.prepare("SELECT 1 FROM orders WHERE razorpay_payment_id IN ('pay_IREF','pay_ISMALL')").get() && j.skipped === 2, "import: refunded and below-price payments are left out");
  const o10 = DB.raw.prepare("SELECT status, courier, tracking_number, tracking_url FROM orders WHERE razorpay_payment_id = 'pay_I10'").get();
  ok(o10.status === "dispatched" && o10.courier === "Delhivery" && o10.tracking_number === "DL10" && j.dispatched.join() === "10", "import: the old desk's dispatch comes with it, courier and tracking");
  const o7 = DB.raw.prepare("SELECT status, buyer_name, city, email FROM orders WHERE razorpay_payment_id = 'pay_I07'").get();
  ok(o7.status === "placed" && o7.buyer_name === "Rahul Sharma" && o7.city === "Delhi" && o7.email === "rahul@example.com", "import: No. 07 placed, with the name and address given at checkout");
  ok(j.needsRecord.join() === "1,2" && piece(1).status === "placed" && piece(2).status === "placed" && /Record a past sale/.test(piece(1).notes), "import: Nos. 01 and 02 are sold, not available, and named for a past-sale record");
  ok(mails.length === 0, "import: nobody is emailed");
  r = await call("POST", "/control/api/import", {});
  ok(r.j.imported.length === 0 && r.j.already.join() === "10,7" && DB.raw.prepare("SELECT COUNT(*) AS c FROM orders").get().c === 3, "import again: nothing new, nothing doubled");
  r = await call("GET", "/control/api/overview");
  ok(r.j.imported && r.j.imported.r && r.j.imported.r.needsRecord.join() === "1,2", "overview: shows what came in, and what to record by hand");
}

/* ── 2. Recording a past sale ── */
{
  let r = await call("POST", "/control/api/orders/manual", { n: 10, name: "X", email: "x@example.com", paid_on: "2026-10-01" });
  ok(r.status === 409, "past sale: refused for a number that already has an order");
  r = await call("POST", "/control/api/orders/manual", { n: 1, name: "Owner One", email: "not-an-email", paid_on: "2026-09-20" });
  ok(r.status === 400, "past sale: the buyer's email has to be real (it becomes their sign-in)");
  r = await call("POST", "/control/api/orders/manual", { n: 1, name: "Owner One", email: "one@example.com", paid_on: "2026-09-20", delivered_on: "2026-09-18" });
  ok(r.status === 400, "past sale: not delivered before it was paid");
  r = await call("POST", "/control/api/orders/manual", { n: 1, name: "Owner One", email: "One@Example.com", phone: "98111 00001", city: "Mumbai", state: "Maharashtra", paid_on: "2026-09-20", delivered_on: "2026-09-25" });
  const o1 = DB.raw.prepare("SELECT * FROM orders WHERE id = ?").get(r.j.id);
  ok(r.j.ok && o1.status === "delivered" && o1.delivered_on === "2026-09-25" && o1.return_window_ends_at === "2026-10-02T18:29:59.000Z" && o1.amount_paise === 599900 && o1.email === "one@example.com",
    "past sale: No. 01, delivered 25 Sep, return window to 2 Oct 23:59:59 India time, the series price");
  ok(piece(1).status === "delivered" && piece(1).order_ref === o1.id && /^manual:/.test(o1.razorpay_payment_id), "past sale: the piece is delivered, and the order marked as recorded by hand");
  r = await call("POST", "/control/api/orders/manual", { n: 2, name: "Owner Two", email: "two@example.com", paid_on: "2026-09-21" });
  ok(r.j.ok && piece(2).status === "placed", "past sale: No. 02, paid, delivery date to come");
  r = await call("POST", `/control/api/orders/${o1.id}/refund`, { confirm: "01" });
  ok(r.status === 409 && refunds.length === 0, "past sale: never refunded from here (it was not paid through this checkout)");
  const id2 = DB.raw.prepare("SELECT order_ref FROM pieces WHERE number = 2").get().order_ref;
  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  r = await call("POST", `/control/api/orders/${id2}/stage`, { to: "delivered", silent: true, reason: "Delivered before the registry", day: "2026-09-27" });
  ok(r.j.ok && DB.raw.prepare("SELECT delivered_on FROM orders WHERE id = ?").get(id2).delivered_on === "2026-09-27" && mails.length === 0, "correction: delivered on a past day, no email");
  ok(today >= "2026-09-27", "(sanity) the test's dates are in the past");
}

/* ── 3. On its own, once ── */
{
  const D2 = d1(), K2 = kv();
  K2.store.set("sold", "[1,2,7,9,10]");
  const e2 = Object.assign({}, env, { DB: D2, KAAL_STATE: K2 });
  const realNow = Date.now; Date.now = () => Date.parse("2026-10-23T05:00:00Z");
  let k = ctx(); await w.scheduled({}, e2, k); await k.done();
  ok(D2.raw.prepare("SELECT COUNT(*) AS c FROM orders").get().c === 3 && K2.store.has("registry:imported"), "cron: the first run after going live brings the orders in (07, 10, and 10's second payment kept as a duplicate)");
  D2.raw.exec("DELETE FROM orders WHERE razorpay_payment_id = 'pay_I07'");
  k = ctx(); await w.scheduled({}, e2, k); await k.done();
  ok(D2.raw.prepare("SELECT COUNT(*) AS c FROM orders").get().c === 2, "cron: and never again on its own (the button is there for that)");
  Date.now = realNow;
}

/* ── 4. The off switch ── */
{
  const off = Object.assign({}, env, { REGISTRY: "off" });
  let r = await call("GET", "/control", undefined, off);
  ok(r.status === 503, "REGISTRY off: the control room is not there");
  r = await call("GET", "/state", undefined, off);
  ok(r.j && !r.j.held.includes(8), "REGISTRY off: /state reads only what it read before");
  const before = DB.raw.prepare("SELECT COUNT(*) AS c FROM orders").get().c;
  const b = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_OFF1", order_id: "order_I07", amount: 599900, currency: "INR", email: "z@example.com", notes: { kaal_no: "07" } } } } });
  const { createHmac } = await import("node:crypto");
  const k = ctx();
  await w.fetch(new Request(ORIGIN + "/", { method: "POST", headers: { "x-razorpay-signature": createHmac("sha256", "wh").update(b).digest("hex") }, body: b }), Object.assign({}, off, { RAZORPAY_WEBHOOK_SECRET: "wh" }), k);
  await k.done();
  ok(DB.raw.prepare("SELECT COUNT(*) AS c FROM orders").get().c === before && refunds.length === 0, "REGISTRY off: a payment touches no database and refunds nothing");
  r = await call("POST", "/order", { n: 15, by: "someone" }, off);
  ok(DB.raw.prepare("SELECT status FROM pieces WHERE number = 15").get().status === "available", "REGISTRY off: checkout holds go back to KV only");
}

console.log(failed ? `\n${failed} failed.` : "\nAll go-live tests passed.");
process.exit(failed ? 1 : 0);
