/* ══════════════════════════════════════════════════════════════════
   Phase 3 of the registry: the Placed letter from the payment webhook,
   the order's /track page, the courier's webhook, and the quiet
   promises (late orders, the one reminder). Real migrations, the real
   worker, Node's own SQLite.

     node --no-warnings tools/test-ops.mjs
   Exits non-zero if anything fails. CI runs it on every pull request.
   ══════════════════════════════════════════════════════════════════ */
import { createHmac } from "node:crypto";
import w from "../worker/kaal-sold-sync.js";
import * as R from "../worker/registry.js";
import { numberOf } from "../worker/courier.js";
import { d1, kv, ctx } from "./d1-shim.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };

const SITE = "https://thekaal.co", WORKER = "https://kaal-edition.kaal-edition-hq.workers.dev";
const sigOf = (b) => createHmac("sha256", "wh").update(b).digest("hex");
function world(extra, mock) {
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
    let m = /\/v1\/orders\/(order_\w+)$/.exec(url);
    if (m) return new Response(JSON.stringify({ id: m[1], status: "paid", amount: 599900, currency: "INR", notes: { kaal_no: (mock && mock.orders && mock.orders[m[1]]) || (m[1].endsWith("T1") ? "08" : "07") } }));
    if (mock && mock.payments && /\/v1\/payments\?/.test(url)) return new Response(JSON.stringify({ items: mock.payments }));
    if (/\/v1\/(payments|refunds|orders)\?/.test(url)) return new Response(JSON.stringify({ items: [] }));
    return new Response("{}", { status: 404 });
  };
  return { env, DB, KV, mails };
}
const hook = async (W, entity) => {
  const b = JSON.stringify({ event: "payment.captured", payload: { payment: { entity } } });
  const k = ctx();
  const r = await w.fetch(new Request("https://w/", { method: "POST", headers: { "x-razorpay-signature": sigOf(b) }, body: b }), W.env, k);
  await k.done();
  return r.status;
};
const pay = (id, order, email) => ({ id, order_id: order, amount: 599900, currency: "INR", email, contact: "+919800000001", created_at: Math.floor(Date.now() / 1000), notes: {} });
const get = async (W, path, headers) => { const k = ctx(); const r = await w.fetch(new Request("https://w" + path, { headers: Object.assign({ Origin: SITE }, headers || {}) }), W.env, k); await k.done(); return { status: r.status, j: await r.json().catch(() => null) }; };
const post = async (W, path, body, headers) => { const k = ctx(); const r = await w.fetch(new Request("https://w" + path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json", Origin: SITE }, headers || {}), body: typeof body === "string" ? body : JSON.stringify(body) }), W.env, k); await k.done(); return { status: r.status, j: await r.json().catch(() => null) }; };
const seed = (W, id, n, email, extra) => R.recordPayment(W.env, Object.assign({ series: "S01", n, paymentId: id, orderId: "order_" + id, amount: 599900, email, phone: "9876543210", name: "Asha Rao",
  address: { line1: "1 Road", city: "Pune", state: "Maharashtra", pin: "411001" }, paidAt: new Date().toISOString() }, extra || {}));
const shiprocket = (W, body, key) => post(W, "/ship/shiprocket", body, key === null ? {} : { "x-api-key": key || "shiprocket-secret-token" });
const realFetch = globalThis.fetch;

/* ── 1. The Placed letter, from the verified payment ── */
{
  const W = world();
  KV_SHIP(W, "order_PAYSEVEN1", true);
  await hook(W, pay("pay_PAYSEVEN1", "order_PAYSEVEN1", "asha@example.com"));
  const placed = W.mails.filter(m => m.to.includes("asha@example.com"));
  const p = placed.find(m => m.subject === "No. 07 is spoken for");
  ok(placed.length === 1 && p, "Placed: the buyer gets exactly one email, 'No. 07 is spoken for'");
  ok(p && p.text.includes("Your payment is received and No. 07 of 20 is now set aside for you alone. Before it leaves, it will be inspected again, boxed by hand and sent to you within five days. You will hear from us at each step."),
    "Placed: the brief's words, verbatim");
  ok(p && /^Owner,/.test(p.text) && /\nKAAL\n/.test(p.text) && /Follow No\. 07's journey: https:\/\/thekaal\.co\/track\?o=\d+&s=[0-9a-f]{24}/.test(p.text), "Placed: addressed to Owner, signed KAAL, ending with the journey link");
  ok(!/—/.test(p.text + p.html) && !/[\u{1F300}-\u{1FAFF}]/u.test(p.text), "Placed: no em dash, no emoji");
  ok(!W.mails.some(m => m.subject === "No. 07 is yours"), "Placed: replaces the earlier confirmation, not beside it");
  ok(W.mails.some(m => m.to.includes("owner@thekaal.co")), "Placed: the owner is still told of the sale");
  const n = W.mails.length;
  await hook(W, pay("pay_PAYSEVEN1", "order_PAYSEVEN1", "asha@example.com"));
  ok(W.mails.length === n, "Placed: the webhook delivered twice sends nothing more");
  ok(W.DB.raw.prepare("SELECT status FROM email_outbox WHERE dedupe_key LIKE 'stage:%:placed'").get().status === "sent", "Placed: goes through the outbox and is marked sent");

  /* No address on file: asked for it, once, in the same voice. */
  const W2 = world();
  await hook(W2, pay("pay_PAYEIGHT1", "order_PAYEIGHT1", "ravi@example.com"));
  ok(W2.mails.some(m => m.subject === "No. 08 needs somewhere to go" && /claimed\.html\?o=order_PAYEIGHT1&n=08#ship/.test(m.text)), "Placed: a buyer whose address did not arrive is asked for it");

  /* Stage emails switched off: the earlier confirmation still goes, nobody is left without. */
  const W3 = world();
  W3.DB.raw.exec("UPDATE settings SET value = '0' WHERE key = 'stage_emails'");
  KV_SHIP(W3, "order_PAYSEVEN1", true);
  await hook(W3, pay("pay_PAYSEVEN1", "order_PAYSEVEN1", "kim@example.com"));
  ok(W3.mails.some(m => m.subject === "No. 07 is yours" && m.to.includes("kim@example.com")) && !W3.mails.some(m => m.subject === "No. 07 is spoken for"), "Placed: with stage emails off, the earlier confirmation is sent instead");
}
function KV_SHIP(W, orderId, yes) {
  if (yes) W.KV.store.set("ship:" + orderId, JSON.stringify({ src: "checkout", buyer: { name: "Asha Rao", phone: "9800000001", email: "x@example.com" }, line1: "1 Road", city: "Pune", state: "Maharashtra", pin: "411001" }));
}

/* ── 2. The order's page ── */
{
  const W = world();
  KV_SHIP(W, "order_PAYSEVEN1", true);
  await hook(W, pay("pay_PAYSEVEN1", "order_PAYSEVEN1", "asha@example.com"));
  const mail = W.mails.find(m => m.subject === "No. 07 is spoken for");
  const link = /track\?o=(\d+)&s=([0-9a-f]{24})/.exec(mail.text);
  const [, oid, sig] = link;
  let r = await get(W, `/track/data?o=${oid}&s=${sig}`);
  ok(r.status === 200 && r.j.ok && r.j.strong && r.j.piece.n === 7 && r.j.piece.size === 20, "track: the signed link opens the order");
  ok(r.j.stages.map(s => s.key).join() === "placed,inspected,packed,dispatched,delivered" && r.j.stages[0].state === "current" && r.j.stages[1].state === "todo", "track: five stages; Placed is current, the rest quiet");
  const body = JSON.stringify(r.j);
  ok(!/asha|example\.com|9876|9800|Road|Pune|411001|pay_PAYSEVEN1|order_PAYSEVEN1/i.test(body), "track: never the name, email, phone, address or payment ids");
  r = await get(W, `/track/data?o=${oid}&s=${"0".repeat(24)}`);
  ok(r.status === 404, "track: a wrong signature opens nothing");
  r = await get(W, `/track/data?o=${+oid + 1}&s=${sig}`);
  ok(r.status === 404, "track: a signature for one order does not open another");
  r = await post(W, "/track/lookup", { ref: "pay_PAYSEVEN1", email: " Asha@Example.com " });
  ok(r.status === 200 && r.j.ok && r.j.strong === false, "track: the payment reference and the email open it, as a weaker visit");
  r = await post(W, "/track/lookup", { ref: "KAAL-07", email: "asha@example.com" });
  ok(r.status === 200 && r.j.ok, "track: so do the number and the email");
  const wrong = await post(W, "/track/lookup", { ref: "pay_PAYSEVEN1", email: "someone@else.com" });
  const none = await post(W, "/track/lookup", { ref: "pay_NOPE", email: "asha@example.com" });
  ok(wrong.status === 404 && none.status === 404 && JSON.stringify(wrong.j) === JSON.stringify(none.j), "track: a wrong email and an unknown order get the same answer");

  /* Registration is not given to a weak visit. */
  r = await post(W, "/track/register", { o: oid, s: sig });
  ok(r.status === 409, "track: registration is not offered before delivery");
  W.DB.raw.prepare("UPDATE orders SET status = 'delivered', dispatched_at = ?, courier = 'Delhivery', tracking_number = 'DL1', tracking_url = 'https://x.example/t', delivered_on = '2026-10-20', return_window_ends_at = '2099-01-01T00:00:00Z' WHERE id = ?").run(new Date().toISOString(), oid);
  r = await get(W, `/track/data?o=${oid}&s=${sig}`);
  ok(r.j.delivered && r.j.canRegister && r.j.courier === "Delhivery" && r.j.trackingUrl === "https://x.example/t", "track: after delivery it leads to registration, with the courier's link");
  r = await post(W, "/track/register", { o: oid, s: sig });
  ok(r.status === 200 && /^https:\/\/thekaal\.co\/claim\?t=[A-Za-z0-9_-]{43}$/.test(r.j.claimUrl), "track: the signed link yields a registration link");
  r = await post(W, "/track/register", { o: oid, s: "f".repeat(24) });
  ok(r.status === 404, "track: a guessed signature yields nothing");
  W.mails.length = 0;
  r = await post(W, "/track/email-link", { ref: "pay_PAYSEVEN1", email: "asha@example.com" });
  const wrongE = await post(W, "/track/email-link", { ref: "pay_PAYSEVEN1", email: "no@example.com" });
  ok(r.j.ok && wrongE.j.ok && JSON.stringify(r.j) === JSON.stringify(wrongE.j), "track: asking for the link by email answers the same whether or not it matched");
  ok(W.mails.length === 1 && W.mails[0].to.includes("asha@example.com") && /claim\?t=/.test(W.mails[0].text), "track: the link goes to the order's own inbox, and only there");
  for (let i = 0; i < 3; i++) await post(W, "/track/email-link", { ref: "pay_PAYSEVEN1", email: "asha@example.com" });
  ok(W.mails.length === 1, "track: asking again within the hour sends nothing more");
  ok((await get(W, `/track/data?o=${oid}&s=${sig}`, { Origin: "https://evil.example" })).status === 200, "track: answers carry CORS for thekaal.co only");
  const cors = await w.fetch(new Request(`https://w/track/data?o=${oid}&s=${sig}`, { headers: { Origin: "https://evil.example" } }), W.env, ctx());
  ok(cors.headers.get("Access-Control-Allow-Origin") === SITE, "track: another site is not given its own origin back");
}

/* ── 3. The courier ── */
{
  const W = world();
  const o7 = (await seed(W, "pay_C7", 7, "asha@example.com")).order.id;
  const sr = { awb: "SR123456789", courier_name: "Delhivery", current_status: "PICKED UP", current_status_id: 42, current_timestamp: "23 10 2026 11:43:53", order_id: "KAAL-07", is_return: 0 };

  let r = await shiprocket(W, sr, null);
  ok(r.status === 401, "courier: no key, refused");
  r = await shiprocket(W, sr, "wrong-key-wrong-key");
  ok(r.status === 401, "courier: a wrong key, refused");
  const off = { env: Object.assign({}, W.env, { SHIPROCKET_TOKEN: "" }) };
  r = await shiprocket(off, sr);
  ok(r.status === 503 && r.j.reason === "off", "courier: switched off until the secret is set");
  r = await shiprocket(W, "{not json");
  ok(r.status === 400, "courier: bad JSON, refused");
  r = await shiprocket(W, Object.assign({}, sr, { current_status: "AWB ASSIGNED", current_status_id: 1 }));
  ok(r.status === 200 && r.j.ignored, "courier: a status it has no use for is ignored, not guessed at");

  W.mails.length = 0;
  r = await shiprocket(W, sr);
  const row = () => W.DB.raw.prepare("SELECT status, courier, tracking_number, tracking_url, inspected_at, packed_at, dispatched_at FROM orders WHERE id = ?").get(o7);
  ok(r.status === 200 && r.j.dispatched && row().status === "dispatched" && row().courier === "Delhivery" && row().tracking_number === "SR123456789" && /^https:\/\/shiprocket\.co\/tracking\/SR123456789$/.test(row().tracking_url),
    "courier: picked up -> Dispatched, found by the KAAL-07 reference, courier and AWB filled in");
  const sent = W.mails.filter(m => m.to.includes("asha@example.com"));
  ok(sent.length === 1 && sent[0].subject === "No. 07 is on its way to you" && sent[0].text.includes("It travels with Delhivery, tracking number SR123456789."), "courier: the buyer gets Dispatched, and only Dispatched (no 'boxed' after 'on its way')");
  ok(row().inspected_at && row().packed_at, "courier: the stages it proves were passed are filled in silently");
  r = await shiprocket(W, sr);
  ok(r.j.duplicate && W.mails.filter(m => m.to.includes("asha@example.com")).length === 1, "courier: the same event twice does nothing and sends nothing");

  r = await shiprocket(W, Object.assign({}, sr, { current_status: "OUT FOR DELIVERY", current_status_id: 17, current_timestamp: "24 10 2026 08:00:00" }));
  const ofd = W.mails.filter(m => m.subject === "No. 07 is out for delivery");
  ok(r.j.headsUp && ofd.length === 1 && ofd[0].text.includes("Delhivery's rider"), "courier: out for delivery sends the one short heads-up");
  await shiprocket(W, Object.assign({}, sr, { current_status: "OUT FOR DELIVERY", current_status_id: 17, current_timestamp: "24 10 2026 12:00:00" }));
  ok(W.mails.filter(m => m.subject === "No. 07 is out for delivery").length === 1, "courier: a second out-for-delivery is not a second email");

  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  const nowStamp = (() => { const d = new Date(Date.now() + 5.5 * 3600000); const p = (x) => String(x).padStart(2, "0"); return `${p(d.getUTCDate())} ${p(d.getUTCMonth() + 1)} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; })();
  r = await shiprocket(W, Object.assign({}, sr, { current_status: "DELIVERED", current_status_id: 7, current_timestamp: nowStamp }));
  const d = W.DB.raw.prepare("SELECT status, delivered_on, return_window_ends_at FROM orders WHERE id = ?").get(o7);
  ok(r.j.delivered && d.status === "delivered" && d.delivered_on === today && d.return_window_ends_at, "courier: delivered -> Delivered today, the return window set");
  const dm = W.mails.find(m => m.subject === "No. 07 is with you. One step makes it yours.");
  ok(dm && /claim\?t=[A-Za-z0-9_-]{43}/.test(dm.text) && dm.text.includes("Once you register, the 7-day return option closes"), "courier: delivered -> the registration email, with the return-window notice");
  ok(W.DB.raw.prepare("SELECT status FROM pieces WHERE id = 'S01-07'").get().status === "delivered", "courier: the piece is delivered too");
  const count = W.mails.length;
  await shiprocket(W, Object.assign({}, sr, { current_status: "DELIVERED", current_status_id: 7, current_timestamp: nowStamp }));
  await shiprocket(W, Object.assign({}, sr, { current_status: "DELIVERED", current_status_id: 7, current_timestamp: "01 01 2030 00:00:00" }));
  ok(W.mails.length === count, "courier: a delivered event again, even with a new time, sends no second email");

  /* A parcel the courier delivers though nobody tapped Dispatched. */
  const o8 = (await seed(W, "pay_C8", 8, "ravi@example.com")).order.id;
  W.mails.length = 0;
  r = await shiprocket(W, { awb: "SR999", courier_name: "Bluedart", current_status: "DELIVERED", current_status_id: 7, current_timestamp: nowStamp, order_id: "KAAL-S01-08" });
  const r8 = W.DB.raw.prepare("SELECT status, courier, tracking_number FROM orders WHERE id = ?").get(o8);
  ok(r.j.delivered && r8.status === "delivered" && r8.courier === "Bluedart" && W.mails.filter(m => m.to.includes("ravi@example.com")).length === 1, "courier: delivered with no earlier tap -> filled in silently, one email");

  /* Trouble and strangers reach the owner, once, and change nothing. */
  W.mails.length = 0;
  const o10 = (await seed(W, "pay_C10", 10, "kim@example.com")).order.id;
  r = await shiprocket(W, { awb: "SRRTO", courier_name: "Delhivery", current_status: "RTO INITIATED", current_status_id: 9, current_timestamp: "24 10 2026 10:00:00", order_id: "KAAL-10" });
  ok(r.j.alert && W.DB.raw.prepare("SELECT status FROM orders WHERE id = ?").get(o10).status === "placed", "courier: a return-to-origin changes no order");
  const al = W.mails.filter(m => m.to.includes("admin@thekaal.co"));
  ok(al.length === 1 && /No\. 10: the courier reports RTO INITIATED/.test(al[0].subject) && !W.mails.some(m => m.to.includes("kim@example.com")), "courier: the owner is told once, the buyer is not");
  await shiprocket(W, { awb: "SRRTO", courier_name: "Delhivery", current_status: "RTO INITIATED", current_status_id: 9, current_timestamp: "24 10 2026 10:00:00", order_id: "KAAL-10" });
  ok(W.mails.filter(m => m.to.includes("admin@thekaal.co")).length === 1, "courier: the same alert is not sent twice");
  W.mails.length = 0;
  r = await shiprocket(W, { awb: "NOBODY1", courier_name: "X", current_status: "DELIVERED", current_status_id: 7, current_timestamp: nowStamp, order_id: "SOMEONE-ELSE-5" });
  ok(r.j.unmatched && W.mails.filter(m => m.to.includes("admin@thekaal.co")).length === 1 && /could not be matched/.test(W.mails.at(-1).subject), "courier: an event for no known order is recorded and told to the owner");
  ok(W.DB.raw.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE actor = 'system:courier'").get().c >= 6, "courier: every move it makes is in the audit log, by 'system:courier'");
  r = await shiprocket(W, Object.assign({}, sr, { awb: "SRRET", current_status: "DELIVERED", is_return: 1, current_timestamp: "25 10 2026 10:00:00" }));
  ok(r.j.ignored, "courier: a return shipment is not a delivery");
  ok(numberOf("KAAL-07") === 7 && numberOf("KAAL-S01-12") === 12 && numberOf("kaal 3") === 3 && numberOf("KAAL-S01") === 0 && numberOf("ORDER-7") === 0, "courier: the order reference is read as a KAAL number, or not at all");
}

/* ── 4. The quiet promises ── */
{
  const W = world();
  const old = (id, n, hoursAgo, status, extra) => {
    const o = seed(W, id, n, `b${n}@example.com`);
    return o.then(r => {
      const at = new Date(Date.now() - hoursAgo * 3600000).toISOString();
      W.DB.raw.prepare("UPDATE orders SET paid_at = ?, status = ? WHERE id = ?").run(at, status, r.order.id);
      if (extra) W.DB.raw.prepare(`UPDATE orders SET ${Object.keys(extra).map(k => k + " = ?").join(", ")} WHERE id = ?`).run(...Object.values(extra), r.order.id);
      return r.order.id;
    });
  };
  await old("pay_S1", 3, 10, "placed");                                             /* fine */
  await old("pay_S2", 4, 60, "placed");                                             /* past 48h */
  await old("pay_S3", 5, 110, "packed");                                            /* past day 4 */
  const s4 = await old("pay_S4", 6, 24 * 12, "dispatched", { dispatched_at: new Date(Date.now() - 8 * 86400000).toISOString() });   /* dispatched 8 days ago */
  W.mails.length = 0;
  const run = async () => { const k = ctx(); await w.scheduled({}, W.env, k); await k.done(); };
  await run();
  const staff = W.mails.filter(m => m.to.includes("admin@thekaal.co") && /is late/.test(m.subject));
  ok(staff.length >= 3 && staff.some(m => /No\. 04 is late: Placed more than 48 hours ago, not inspected/.test(m.subject)) && staff.some(m => /No\. 05 is late: Not dispatched by day 4/.test(m.subject)) && staff.some(m => /No\. 06 is late: Dispatched more than 7 days ago, not delivered/.test(m.subject)),
    "late: each broken promise reaches the owner, named");
  ok(!staff.some(m => /No\. 03/.test(m.subject)), "late: an order inside its promise is left alone");
  const n = W.mails.length;
  await run();
  ok(W.mails.length === n, "late: running again emails nothing more");
  const ov = await (async () => { W.DB.raw.exec("UPDATE owners SET role = 'owner'"); return null; })();

  /* The reminder: 72 hours after delivery, unregistered, once. */
  W.mails.length = 0;
  const day = (d) => new Date(Date.now() + 5.5 * 3600000 - d * 86400000).toISOString().slice(0, 10);
  const open = new Date(Date.now() + 5 * 86400000).toISOString();
  await old("pay_R1", 11, 24 * 6, "delivered", { delivered_on: day(4), return_window_ends_at: open });          /* due */
  await old("pay_R2", 12, 24 * 3, "delivered", { delivered_on: day(1), return_window_ends_at: open });          /* too soon */
  await old("pay_R3", 13, 24 * 6, "registered", { delivered_on: day(4), registered_at: new Date().toISOString() });
  await old("pay_R4", 14, 24 * 20, "delivered", { delivered_on: day(15), return_window_ends_at: new Date(Date.now() - 86400000).toISOString() });   /* window closed */
  await run();
  const rem = W.mails.filter(m => /has no name beside it yet/.test(m.subject));
  ok(rem.length === 1 && rem[0].subject === "No. 11 has no name beside it yet" && /claim\?t=/.test(rem[0].text), "reminder: one, to the unregistered owner 72 hours on, with a fresh link");
  ok(rem[0].text.includes("Registering closes the return option and opens your warranty dashboard.") && !/—/.test(rem[0].text), "reminder: the brief's words");
  await run(); await run();
  ok(W.mails.filter(m => /has no name beside it yet/.test(m.subject)).length === 1, "reminder: never a second");
  void s4; void ov;
}

/* ── 5. The daily check against Razorpay, and the health ping ── */
{
  const missed = { id: "pay_MISSED0001", order_id: "order_MISSED01", amount: 599900, currency: "INR", status: "captured", email: "late@example.com", contact: "+919800000009", created_at: Math.floor(Date.now() / 1000) - 3600, notes: {} };
  const W = world({}, { payments: [missed], orders: { order_MISSED01: "11" } });
  let r = await get(W, "/health");
  ok(r.status === 200 && r.j.ok && r.j.db === true && r.j.registry === "on", "health: the worker and its database answer");
  const bad = await w.fetch(new Request("https://w/health"), Object.assign({}, W.env, { DB: { prepare() { throw new Error("down"); } } }), ctx());
  ok(bad.status === 503 && (await bad.json()).db === false, "health: a database that does not answer is a 503, for the ping to see");
  W.KV.store.set("registry:imported", "{}");                  /* the go-live import is long done */
  const run = async () => { const k = ctx(); await w.scheduled({}, W.env, k); await k.done(); };
  await run();
  const o = W.DB.raw.prepare("SELECT o.id, o.status FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE p.number = 11").get();
  ok(o && o.status === "placed", "daily check: a payment the webhook never reported is recorded");
  ok(W.mails.some(m => m.to.includes("late@example.com") && m.subject === "No. 11 is spoken for"), "daily check: its buyer still gets the Placed letter");
  const al = W.mails.filter(m => m.to.includes("owner@thekaal.co") && /daily check against Razorpay/.test(m.subject));
  ok(al.length === 1 && /No\. 11 was paid for, and Razorpay's webhook never told us/.test(al[0].text), "daily check: and the owner is told the webhook missed it");
  const n = W.mails.length;
  await run();
  ok(W.mails.length === n, "daily check: it runs once a day, not every half hour");
  W.KV.store.delete("recon:" + new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10));
  await run();
  ok(W.mails.length === n, "daily check: and a second run finds nothing new to say");
}

globalThis.fetch = realFetch;
console.log(failed ? `\n${failed} failed.` : "\nAll Phase 3 tests passed.");
process.exit(failed ? 1 : 0);
