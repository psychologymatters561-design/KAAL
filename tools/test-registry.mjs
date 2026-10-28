/* ══════════════════════════════════════════════════════════════════
   The registry (worker/registry.js, migrations/), tested without D1.

   Runs the real migrations in Node's own SQLite (node:sqlite, Node 22.13
   and later), behind a small stand-in for D1's prepare/bind/first/all/run,
   and drives the worker through it: holds, a payment delivered twice, a
   second payment for one watch, its refund, the staging guards.

   Node's standard library only, like the rest of tools/:
     node tools/test-registry.mjs
   Exits non-zero if anything fails. CI runs it on every pull request.
   ══════════════════════════════════════════════════════════════════ */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import w from "../worker/kaal-sold-sync.js";
import { d1, kv, ctx } from "./d1-shim.mjs";
import * as R from "../worker/registry.js";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };

/* ── 1. The data layer on its own ── */
{
  const env = { DB: d1() };
  const t = Date.parse("2026-10-23T06:00:00Z");
  let h = await R.holdPiece(env, "S01", 7, "buyerA", t);
  ok(h.ok && h.until === t + 10 * 60 * 1000, "hold: ten minutes for the first buyer");
  h = await R.holdPiece(env, "S01", 7, "buyerB", t + 1000);
  ok(!h.ok && h.reason === "held", "hold: a second buyer is told it is held");
  h = await R.holdPiece(env, "S01", 7, "buyerA", t + 60000);
  ok(h.ok && h.until === t + 60000 + 600000, "hold: the holder can extend their own");
  h = await R.holdPiece(env, "S01", 7, "buyerB", t + 60000 + 600000 + 1);
  ok(h.ok, "hold: an expired hold is no hold");
  let wins = 0;
  for (const r of await Promise.all(Array.from({ length: 25 }, (_, i) => R.holdPiece(env, "S01", 8, "rush" + i, t)))) if (r.ok) wins++;
  ok(wins === 1, "hold: twenty-five buyers reaching for No. 08 at once, exactly one wins");
  ok((await R.holdPiece(env, "S01", 9, "x", t)).reason === "sold", "hold: No. 09 is withheld, not for sale");
  ok((await R.holdPiece(env, "S01", 21, "x", t)).reason === "unknown", "hold: no No. 21");
  await R.releaseHold(env, "S01", 8, "someone-else");
  ok(!(await R.holdPiece(env, "S01", 8, "rush-late", t + 1000)).ok, "hold: only the holder can give it back");

  const pay = (id, n, over) => Object.assign({ series: "S01", n, paymentId: id, orderId: "order_" + id, amount: 599900, currency: "INR",
    email: "Buyer@Example.com", phone: "98765 43210", name: "Asha Rao", address: { line1: "1 Road", city: "Pune", state: "Maharashtra", pin: "411001" },
    paidAt: "2026-10-23T06:05:00.000Z" }, over || {});
  let f = await R.recordPayment(env, pay("pay_A", 7));
  ok(f.outcome === "placed" && f.fresh, "payment: places the piece");
  f = await R.recordPayment(env, pay("pay_A", 7));
  ok(f.outcome === "already" && !f.fresh, "payment: the same payment again changes nothing");
  const orders = env.DB.raw.prepare("SELECT COUNT(*) AS c FROM orders").get().c;
  const piece = env.DB.raw.prepare("SELECT status, order_ref, held_by FROM pieces WHERE id = 'S01-07'").get();
  ok(orders === 1 && piece.status === "placed" && piece.order_ref === f.order.id && piece.held_by === null, "payment: one order, one placed piece, the hold cleared");
  const row = env.DB.raw.prepare("SELECT email, phone, series FROM orders WHERE razorpay_payment_id = 'pay_A'").get();
  ok(row.email === "buyer@example.com" && row.phone === "919876543210" && row.series === "S01", "payment: email and phone kept in one form, with its series");

  f = await R.recordPayment(env, pay("pay_B", 7));
  ok(f.outcome === "duplicate" && f.fresh && f.order.status === "cancelled" && f.order.cancel_reason === "duplicate", "second payment for No. 07: cancelled as a duplicate");
  f = await R.recordPayment(env, pay("pay_B", 7));
  ok(f.outcome === "duplicate" && !f.fresh, "second payment, delivered again: still a duplicate, not 'fresh' twice");
  ok(env.DB.raw.prepare("SELECT order_ref FROM pieces WHERE id = 'S01-07'").get().order_ref !== f.order.id, "the first order keeps the watch");
  f = await R.recordPayment(env, pay("pay_C", 9));
  ok(f.outcome === "duplicate", "a payment for withheld No. 09 is never placed");

  const id = (await R.recordPayment(env, pay("pay_B", 7))).order.id;
  ok(await R.claimRefund(env, id) === true && await R.claimRefund(env, id) === false, "refund: exactly one caller may ask Razorpay");
  await R.refundFailed(env, id);
  ok(await R.claimRefund(env, id) === true, "refund: a failed ask gives the claim back");
  await R.refundDone(env, id, "rfnd_1", "S01");
  ok(await R.claimRefund(env, id) === false && (await R.paymentFate(env, "pay_B")).refunded, "refund: once done, never asked again");
  const audits = env.DB.raw.prepare("SELECT action FROM audit_log ORDER BY id").all().map(r => r.action).join();
  ok(/piece\.placed/.test(audits) && /order\.duplicate/.test(audits) && /order\.refunded/.test(audits), "audit: placed, duplicate and refund are written down");

  env.DB.raw.exec("INSERT INTO blocked_buyers (email, phone, reason) VALUES ('gone@example.com', '919811111111', 'returned No. 04')");
  ok(await R.isBlocked(env, " Gone@Example.com ", "") && await R.isBlocked(env, "", "098111 11111") && !(await R.isBlocked(env, "new@example.com", "9822222222")),
    "blocked buyers: matched by email in any case, or phone in any format, and nobody else");

  /* The public view: safe columns, a city only with consent. */
  const cols = env.DB.raw.prepare("SELECT * FROM public_registry LIMIT 1").columns().map(c => c.name);
  ok(cols.join() === "series,series_name,series_size,number,colorway,photo_url,state,owner_no,owner_since,owner_city", "public view: only the safe columns");
  env.DB.raw.exec(`INSERT INTO owners (email, name, phone, city, state, show_city_publicly) VALUES ('a@x.com','Asha Rao','919876543210','Pune','MH',0);
    INSERT INTO ownerships (series, piece_id, owner_id, owner_no, from_at, acquired_via) VALUES ('S01','S01-07',1,1,'2026-10-25T00:00:00Z','purchase')`);
  let pub = env.DB.raw.prepare("SELECT * FROM public_registry WHERE number = 7").get();
  ok(pub.state === "sold" && pub.owner_no === 1 && pub.owner_since === "2026-10" && pub.owner_city === null, "public view: Owner I since Oct 2026, city withheld");
  env.DB.raw.exec("UPDATE owners SET show_city_publicly = 1");
  pub = env.DB.raw.prepare("SELECT * FROM public_registry WHERE number = 7").get();
  ok(pub.owner_city === "Pune" && !JSON.stringify(pub).includes("Asha") && !JSON.stringify(pub).includes("9876"), "public view: the city once ticked, never the name or phone");
  ok(env.DB.raw.prepare("SELECT state FROM public_registry WHERE number = 9").get().state === "unavailable", "public view: No. 09 reads 'unavailable', never 'sold'");
  let dup = null;
  try { env.DB.raw.exec("INSERT INTO ownerships (series, piece_id, owner_id, owner_no, from_at, acquired_via) VALUES ('S01','S01-07',1,2,'2026-11-01T00:00:00Z','transfer')"); } catch (e) { dup = e; }
  ok(dup, "ownerships: a piece cannot have two open owners at once");
}

/* ── 2. Through the worker ── */
const sigOf = (b) => createHmac("sha256", "wh").update(b).digest("hex");
function world(extra) {
  const DB = d1(), KV = kv(), mails = [], refunds = [], puts = [], meta = [];
  let refundStatus = 200, file = "var KAAL = {\n  sold:     [1, 2],\n};";
  KV.store.set("sold", "[1,2]");
  const env = Object.assign({
    DB, KAAL_STATE: KV, EDITION: "20", OWNER_OPS: "off", PRICE_PAISE: "599900", CURRENCY: "INR", ALLOW_ORIGIN: "https://thekaal.co", SITE_URL: "https://thekaal.co",
    RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "wh", RESEND_API_KEY: "re", OWNER_EMAIL: "owner@thekaal.co",
    GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", META_PIXEL: "1607748840888926", META_CAPI_TOKEN: "tok",
    DIALS: JSON.stringify({ 7: "Midnight", 9: "Midnight" })
  }, extra || {});
  const fetchMock = async (url, init) => {
    url = String(url);
    if (url.includes("api.resend.com")) { mails.push(JSON.parse(init.body)); return new Response("{}"); }
    if (url.includes("graph.facebook.com")) { meta.push(url); return new Response("{}"); }
    if (url.includes("api.github.com")) {
      /* Remembers what was committed, the way the repository would. */
      if (init && init.method === "PUT") { puts.push(url); file = Buffer.from(JSON.parse(init.body).content, "base64").toString(); return new Response("{}"); }
      return new Response(JSON.stringify({ content: Buffer.from(file).toString("base64"), sha: "x" }));
    }
    let m = /\/v1\/payments\/(pay_\w+)\/refund$/.exec(url);
    if (m) { refunds.push(m[1]); return refundStatus === 200 ? new Response(JSON.stringify({ id: "rfnd_" + m[1] })) : new Response('{"error":{"description":"Server busy"}}', { status: refundStatus }); }
    if (/\/v1\/orders$/.test(url)) return new Response(JSON.stringify({ id: "order_NEW" + Math.random().toString(36).slice(2, 8), amount: 599900, currency: "INR" }));
    m = /\/v1\/orders\/(order_\w+)\/payments/.exec(url);
    if (m) return new Response(JSON.stringify({ items: [{ id: "pay_" + m[1].slice(6), status: "captured", email: "b@example.com", created_at: 1792700000 }] }));
    m = /\/v1\/orders\/(order_\w+)$/.exec(url);
    if (m) return new Response(JSON.stringify({ id: m[1], status: "paid", amount: 599900, currency: "INR", notes: { kaal_no: "07", ua: "UA" } }));
    if (/\/v1\/(payments|refunds|orders)\?/.test(url)) return new Response(JSON.stringify({ items: [] }));
    return new Response("{}", { status: 404 });
  };
  return { env, DB, KV, mails, refunds, puts, meta, fetchMock, setRefund: (s) => { refundStatus = s; } };
}
const webhook = async (W, entity) => {
  const b = JSON.stringify({ event: "payment.captured", payload: { payment: { entity } } });
  const k = ctx();
  const r = await w.fetch(new Request("https://w/", { method: "POST", headers: { "x-razorpay-signature": sigOf(b) }, body: b }), W.env, k);
  await k.done();
  return { status: r.status, text: await r.text() };
};
const post = (path, body, headers) => new Request("https://w" + path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json", Origin: "https://thekaal.co" }, headers || {}), body: JSON.stringify(body) });
const realFetch = globalThis.fetch;

{
  const W = world();
  globalThis.fetch = W.fetchMock;

  /* /order holds in the registry, atomically, before Razorpay is asked. */
  let r = await w.fetch(post("/order", { n: 7, by: "buyerA1" }), W.env, ctx());
  let d = await r.json();
  ok(d.ok && d.held_for === 600 && d.checkout_timeout === 570, "order: held ten minutes in the registry; the checkout window closes half a minute sooner");
  ok(W.DB.raw.prepare("SELECT status, held_by FROM pieces WHERE id = 'S01-07'").get().held_by === "buyerA1", "order: the registry holds No. 07 for this buyer");
  r = await w.fetch(post("/order", { n: 7, by: "buyerB1" }), W.env, ctx());
  ok(r.status === 409 && (await r.json()).reason === "held", "order: a second buyer cannot price a held number");
  r = await w.fetch(post("/order", { n: 9, by: "buyerB1" }), W.env, ctx());
  ok(r.status === 409 && (await r.json()).reason === "sold", "order: withheld No. 09 cannot be bought");
  W.DB.raw.exec("INSERT INTO blocked_buyers (email, reason) VALUES ('gone@example.com', 'returned')");
  r = await w.fetch(post("/order", { n: 11, by: "buyerC1", buyer: { name: "Gone Buyer", phone: "9811111111", email: "gone@example.com", line1: "1 Rd", city: "Delhi", state: "Delhi", pin: "110001" } }), W.env, ctx());
  ok(r.status === 403 && (await r.json()).reason === "unavailable" && W.DB.raw.prepare("SELECT status FROM pieces WHERE id = 'S01-11'").get().status === "available",
    "order: a blocked buyer is refused in neutral words, and nothing is held for them");
  globalThis.fetch = async (url, init) => /\/v1\/orders$/.test(String(url)) ? new Response('{"error":{}}', { status: 500 }) : W.fetchMock(url, init);
  r = await w.fetch(post("/order", { n: 12, by: "buyerD1" }), W.env, ctx());
  ok(r.status === 500 && W.DB.raw.prepare("SELECT status FROM pieces WHERE id = 'S01-12'").get().status === "available", "order: when Razorpay fails, the hold is given back");
  globalThis.fetch = W.fetchMock;

  /* /state: what the registry says is gone joins what the site says. */
  r = await w.fetch(new Request("https://w/state", { headers: { Origin: "https://thekaal.co" } }), W.env, ctx());
  d = await r.json();
  ok(d.sold.includes(9) && d.sold.includes(1) && d.held.includes(7), "state: withheld No. 09 is not offered, the site's sold list stands, No. 07 is held");

  /* The webhook, twice: placed exactly once. */
  const e1 = { id: "pay_FIRST1", order_id: "order_FIRST1", amount: 599900, currency: "INR", email: "first@example.com", contact: "+919800000001", created_at: 1792700000, notes: { kaal_no: "07" } };
  let h = await webhook(W, e1);
  const firstMails = W.mails.length, firstPuts = W.puts.length;
  h = await webhook(W, e1);
  const placed = W.DB.raw.prepare("SELECT COUNT(*) AS c FROM orders WHERE razorpay_payment_id = 'pay_FIRST1'").get().c;
  const p7 = W.DB.raw.prepare("SELECT status, order_ref FROM pieces WHERE id = 'S01-07'").get();
  ok(placed === 1 && p7.status === "placed" && W.mails.length === firstMails && W.puts.length === firstPuts && firstPuts === 1,
    "webhook fired twice: one order, No. 07 placed once, one commit, no second pair of emails");
  ok(W.mails.some(m => m.subject === "No. 07 is spoken for" && m.to[0] === "first@example.com") && !W.mails.some(m => m.subject === "No. 07 is yours"),
    "webhook: the first buyer gets the Placed letter, once, and not the old confirmation as well");

  /* A second payment for No. 07: refunded once, apologised for once. */
  W.mails.length = 0; W.meta.length = 0;
  const e2 = { id: "pay_SECOND1", order_id: "order_SECOND1", amount: 599900, currency: "INR", email: "second@example.com", contact: "+919800000002", created_at: 1792700100, notes: { kaal_no: "07" } };
  h = await webhook(W, e2);
  ok(h.status === 200 && /refunded/.test(h.text) && W.refunds.join() === "pay_SECOND1", "duplicate: the second payment is refunded through Razorpay");
  ok(W.mails.some(m => m.to[0] === "second@example.com" && /^No\. 07 went a moment before your payment$/.test(m.subject) && /refunded in full/.test(m.text) && /rfnd_pay_SECOND1/.test(m.text)),
    "duplicate: the second buyer gets the apology, with the refund reference");
  ok(W.mails.some(m => m.to[0] === "owner@thekaal.co" && /Two payments for No\. 07 · the second is refunded/.test(m.subject)), "duplicate: the owner is told it is handled");
  ok(!W.mails.some(m => /is yours/.test(m.subject)) && W.meta.length === 0 && W.puts.length === 1, "duplicate: never 'yours', never a Purchase to Meta, never a commit");
  ok(!/—/.test(W.mails.map(m => m.subject + m.text + (m.html || "")).join("")), "duplicate emails: no em dashes");
  W.mails.length = 0;
  h = await webhook(W, e2);
  ok(W.refunds.length === 1 && W.mails.length === 0 && /already refunded/.test(h.text), "duplicate delivered again: no second refund, no second email");

  /* Razorpay refuses the refund: 502 so it delivers again, then it goes through. */
  W.setRefund(500); W.mails.length = 0;
  const e3 = Object.assign({}, e2, { id: "pay_THIRD1", order_id: "order_THIRD1", email: "third@example.com" });
  h = await webhook(W, e3);
  ok(h.status === 502 && W.mails.length === 1 && /refund it by hand/.test(W.mails[0].subject) && /Server busy/.test(W.mails[0].text),
    "refund refused: 502 for Razorpay to retry, and the owner is told at once");
  W.setRefund(200); W.mails.length = 0;
  h = await webhook(W, e3);
  ok(h.status === 200 && W.refunds.filter(x => x === "pay_THIRD1").length === 2 && W.mails.some(m => m.to[0] === "third@example.com"),
    "refund retried on redelivery: refunded, and only now is the buyer written to");

  /* The receipt tells the second buyer the truth. */
  r = await w.fetch(new Request("https://w/receipt?o=order_SECOND1", { headers: { Origin: "https://thekaal.co" } }), W.env, ctx());
  d = await r.json();
  ok(d.duplicate === true && d.refunded === true, "receipt: a duplicate, already refunded");
  r = await w.fetch(new Request("https://w/receipt?o=order_FIRST1", { headers: { Origin: "https://thekaal.co" } }), W.env, ctx());
  ok((await r.json()).duplicate === false, "receipt: the first buyer's is not");
  const thanks = readFileSync(new URL("../claimed.html", import.meta.url), "utf8");
  ok(/if\(d\.duplicate\)\{/.test(thanks) && /went first\./.test(thanks), "claimed.html: a duplicate is never shown 'It is yours.'");

  /* Razorpay's own refund notice for that refund is not a returned watch. */
  W.mails.length = 0;
  const rb = JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_pay_SECOND1", payment_id: "pay_SECOND1", amount: 599900, status: "processed", notes: { reason: "duplicate" } } },
    payment: { entity: Object.assign({}, e2, { status: "refunded", amount_refunded: 599900 }) } } });
  const k = ctx();
  await w.fetch(new Request("https://w/", { method: "POST", headers: { "x-razorpay-signature": sigOf(rb) }, body: rb }), W.env, k); await k.done();
  ok(W.KV.store.has("refund:rfnd_pay_SECOND1") && !W.KV.store.has("refunded:7") && W.mails.length === 0,
    "refund notice: recorded, No. 07 not offered back for sale, nobody emailed twice");
  globalThis.fetch = realFetch;
}

/* ── 3. Staging never touches the live site, a real inbox or Meta ── */
{
  const W = world({ STAGING: "on", ALLOW_ORIGIN: "https://kaal-edition-staging.kaal-edition-hq.workers.dev" });
  globalThis.fetch = W.fetchMock;
  const e = { id: "pay_STG1", order_id: "order_STG1", amount: 599900, currency: "INR", email: "real.person@example.com", contact: "+919800000009", created_at: 1792700000, notes: { kaal_no: "07" } };
  const h = await webhook(W, e);
  ok(/staging/.test(h.text) && W.puts.length === 0, "staging: a test payment is placed, and the live site's sold list is never written");
  ok(W.mails.length > 0 && W.mails.every(m => m.to.join() === "owner@thekaal.co" && /^\[Staging, for /.test(m.subject)), "staging: every email goes to the owner, marked, never to the buyer");
  ok(W.meta.length === 0, "staging: nothing goes to Meta, even with a token");
  const r = await w.fetch(new Request("https://w/staging"), W.env, ctx());
  const page = await r.text();
  ok(r.status === 200 && (page.match(/class="n /g) || []).length === 20 && /TEST mode/.test(page) && !/real\.person/.test(page), "staging: the test checkout lists the twenty and no buyer");
  const prod = await w.fetch(new Request("https://w/staging"), Object.assign({}, W.env, { STAGING: "" }), ctx());
  ok(!/staging checkout/.test(await prod.text()), "production: there is no /staging page");
  globalThis.fetch = realFetch;
}

console.log(failed ? `\n${failed} failed.` : "\nAll registry tests passed.");
process.exit(failed ? 1 : 0);
