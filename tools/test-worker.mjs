#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   The worker, exercised end to end with Razorpay, GitHub and Meta faked.

   No dependencies, same as check.mjs: Node 22 already has fetch, Request,
   Response and WebCrypto, which is everything a Cloudflare Worker uses.
   Every outbound call the worker makes is caught by the fake fetch below
   and answered the way the real service would; everything it sends to
   Meta is recorded so the tests can read exactly what Meta would receive.

   What this proves is the money path and the measurement path together:
   a Purchase is sent once per order, only after a signature, under the
   same event id the browser is given, with the fields Meta needs — and a
   test payment is never recorded as a sale.

   Run it yourself:  node tools/test-worker.mjs
   ══════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac, createHash } from "node:crypto";

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "kaal-worker-"));
const file = join(dir, "worker.mjs");
writeFileSync(file, readFileSync(join(root, "worker/kaal-sold-sync.js"), "utf8"));
const mod = await import(file);
const worker = mod.default;
const { Edition } = mod;

/* The Durable Object, as Cloudflare runs it: one instance, one request at
   a time. The queue is that guarantee; the instance is the real class. */
function lockNamespace() {
  const store = new Map();
  const inst = new Edition({ storage: {
    async get(k) { return store.has(k) ? JSON.parse(store.get(k)) : undefined; },
    async put(k, v) { store.set(k, JSON.stringify(v)); }
  } });
  let queue = Promise.resolve();
  return {
    store,
    idFromName: (name) => name,
    get: () => ({ fetch: (url, init) => {
      const run = queue.then(() => inst.fetch(new Request(url, init)));
      queue = run.catch(() => {});
      return run;
    } })
  };
}

const sha = (s) => createHash("sha256").update(s).digest("hex");
const hmac = (s, k) => createHmac("sha256", k).update(s).digest("hex");

/* ── The fakes ─────────────────────────────────────────────────────── */
let world;
function reset(opts = {}) {
  world = {
    orders: {}, payments: {}, meta: [], commits: [], metaStatus: opts.metaStatus || [],
    githubPut: opts.githubPut || 200, refunds: [], refundStatus: [], orderStatus: 200,
    file: 'var KAAL = {\n  edition:  20,\n  sold:     [1, 2],\n};\n', sha: "s1"
  };
}
const kv = () => {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v == null ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; }
  };
};
const reply = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

globalThis.fetch = async (input, init = {}) => {
  const url = String(input), method = (init.method || "GET").toUpperCase();
  let r = url.match(/^https:\/\/api\.razorpay\.com\/v1\/payments\/(.+)\/refund$/);
  if (r && method === "POST") {
    const status = world.refundStatus.length ? world.refundStatus.shift() : 200;
    world.refunds.push({ payment: r[1], status, body: JSON.parse(init.body) });
    return reply(status === 200 ? { id: "rfnd_" + r[1], status: "processed" } : { error: { description: "nope" } }, status);
  }
  if (url === "https://api.razorpay.com/v1/orders" && method === "POST" && world.orderStatus !== 200) {
    return reply({ error: { description: "refused" } }, world.orderStatus);
  }
  if (url === "https://api.razorpay.com/v1/orders" && method === "POST") {
    const b = JSON.parse(init.body);
    const id = "order_T" + (Object.keys(world.orders).length + 1);
    world.orders[id] = { id, amount: b.amount, currency: b.currency, notes: b.notes, receipt: b.receipt };
    return reply(world.orders[id]);
  }
  let m = url.match(/^https:\/\/api\.razorpay\.com\/v1\/orders\/(.+)$/);
  if (m) return world.orders[m[1]] ? reply(world.orders[m[1]]) : reply({}, 404);
  m = url.match(/^https:\/\/api\.razorpay\.com\/v1\/payments\/(.+)$/);
  if (m) return world.payments[m[1]] ? reply(world.payments[m[1]]) : reply({}, 404);
  if (url.startsWith("https://api.github.com/")) {
    if (method === "GET") return reply({ sha: world.sha, content: Buffer.from(world.file).toString("base64") });
    if (world.githubPut !== 200) return reply({ message: "nope" }, world.githubPut);
    const b = JSON.parse(init.body);
    world.file = Buffer.from(b.content, "base64").toString();
    world.commits.push(b.message);
    return reply({ ok: true });
  }
  if (url.startsWith("https://graph.facebook.com/")) {
    const status = world.metaStatus.length ? world.metaStatus.shift() : 200;
    world.meta.push({ url, body: JSON.parse(init.body), status });
    return reply(status === 200 ? { events_received: 1 } : { error: { message: "x" } }, status);
  }
  throw new Error("unexpected fetch " + method + " " + url);
};

const LIVE = () => ({
  RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "ks", RAZORPAY_WEBHOOK_SECRET: "whs",
  GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", GITHUB_BRANCH: "main",
  EDITION: "20", CURRENCY: "INR", PRICE_PAISE: "599900",
  ALLOW_ORIGIN: "https://thekaal.co,https://www.thekaal.co",
  META_CAPI_TOKEN: "EAAtoken", KAAL_STATE: kv()
});
const TEST = () => ({
  RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "ks", RAZORPAY_WEBHOOK_SECRET: "whs",
  EDITION: "20", CURRENCY: "INR", PRICE_PAISE: "599900", COMMIT_SOLD: "0",
  SITE_URL: "https://test.kaal-preview.pages.dev",
  ALLOW_ORIGIN: "https://*kaal-preview*.pages.dev,http://localhost:8080,http://127.0.0.1:8080",
  META_CAPI_TOKEN: "EAAtoken"
});

async function call(env, method, path, { body, headers = {}, raw } = {}) {
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const req = new Request("https://kaal-edition.example.workers.dev" + path, {
    method,
    headers: Object.assign({ "user-agent": "Mozilla/5.0 (iPhone) Test", "cf-connecting-ip": "203.0.113.9" }, headers),
    body: raw != null ? raw : body != null ? JSON.stringify(body) : undefined
  });
  const res = await worker.fetch(req, env, ctx);
  await Promise.all(pending);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, json };
}
const json = { "Content-Type": "application/json", Origin: "https://thekaal.co" };

/* A buyer on thekaal.co: order for No. 07, with attribution, then the
   payment Razorpay would record against it. */
async function order(env, extra = {}) {
  const r = await call(env, "POST", "/order", { headers: json, body: Object.assign({
    n: 7, by: "tok", fbp: "fb.1.1700000000000.123456789", fbc: "fb.1.1700000000000.AbC_click-id",
    attr: { utm_source: "meta", utm_medium: "paid", utm_campaign: "launch", utm_content: "reel-1", utm_term: "watch",
            fbclid: "AbC_click-id", xid: sha("tok") }
  }, extra) });
  return r.json;
}
function pay(orderId, paymentId, notes = { kaal_no: "07" }) {
  const p = { id: paymentId, order_id: orderId, amount: 599900, currency: "INR", status: "captured",
              email: "  Buyer@Example.COM ", contact: "+91 98765 43210", created_at: 1790000000, notes };
  world.payments[paymentId] = p;
  return p;
}
function webhookBody(p, event = "payment.captured") {
  return JSON.stringify({ event, payload: { payment: { entity: p } } });
}
const hook = (env, raw, secret = "whs") =>
  call(env, "POST", "/", { raw, headers: { "x-razorpay-signature": hmac(raw, secret) } });

/* ── The tests ─────────────────────────────────────────────────────── */
const results = [];
async function test(name, fn) {
  reset();
  try { await fn(); results.push([true, name]); }
  catch (e) { results.push([false, name, e && e.stack || String(e)]); }
}
function eq(a, b, what) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${what}: expected ${B}, got ${A}`);
}
function ok(v, what) { if (!v) throw new Error(what); }

await test("/order prices from config, writes attribution into ≤15 notes", async () => {
  const env = LIVE();
  const o = await order(env, { price: 1 });
  ok(o && o.ok, "order ok");
  const ord = world.orders[o.order_id];
  eq(ord.amount, 599900, "amount comes from PRICE_PAISE, not the body");
  const n = ord.notes;
  eq([n.kaal_no, n.utm_source, n.utm_campaign, n.fbclid, n.xid, n.fbp, n.fbc, n.ip],
     ["07", "meta", "launch", "AbC_click-id", sha("tok"), "fb.1.1700000000000.123456789", "fb.1.1700000000000.AbC_click-id", "203.0.113.9"], "notes");
  ok(Object.keys(n).length <= 15, "Razorpay allows at most 15 notes, got " + Object.keys(n).length);
  ok(Object.values(n).every(v => String(v).length <= 256), "every note ≤ 256 chars");
});

await test("/order drops malformed attribution instead of storing it", async () => {
  const env = LIVE();
  const o = await order(env, { fbp: "evil", fbc: "fb.1.1." + "x".repeat(300), attr: { fbclid: "no spaces allowed", xid: "abc", utm_source: "x".repeat(250) } });
  const n = world.orders[o.order_id].notes;
  ok(!n.fbp && !n.fbc && !n.fbclid && !n.xid && !n.utm_source, "bad values dropped: " + JSON.stringify(n));
});

await test("/verify rejects a forged signature and returns no purchase record", async () => {
  const env = LIVE();
  const o = await order(env);
  pay(o.order_id, "pay_A");
  const r = await call(env, "POST", "/verify", { headers: json, body: { razorpay_order_id: o.order_id, razorpay_payment_id: "pay_A", razorpay_signature: "0".repeat(64) } });
  eq(r.status, 400, "status");
  ok(!r.json.purchase, "no purchase record on a bad signature");
});

await test("/verify returns the purchase record: order id as event id, value, hashed contact", async () => {
  const env = LIVE();
  const o = await order(env);
  pay(o.order_id, "pay_A");
  const r = await call(env, "POST", "/verify", { headers: json, body: { razorpay_order_id: o.order_id, razorpay_payment_id: "pay_A", razorpay_signature: hmac(o.order_id + "|pay_A", "ks") } });
  eq(r.status, 200, "status");
  const p = r.json.purchase;
  eq([p.event_id, p.order_id, p.payment_id, p.no, p.value, p.currency], [o.order_id, o.order_id, "pay_A", "07", 5999, "INR"], "record");
  eq(p.em, sha("buyer@example.com"), "email trimmed, lower-cased, hashed");
  eq(p.ph, sha("919876543210"), "phone digits-only with 91, hashed");
  eq(await env.KAAL_STATE.get("sold", "json"), [7], "verified number is sold in KV");
});

await test("webhook: Purchase sent once with every required field, same event id as /verify", async () => {
  const env = LIVE();
  const o = await order(env);
  const p = pay(o.order_id, "pay_A");
  const r = await hook(env, webhookBody(p));
  eq(r.status, 200, "status");
  eq(world.commits.length, 1, "sold committed to GitHub");
  ok(/sold:\s*\[1, 2, 7\]/.test(world.file), "index.html now lists 7 as sold");
  eq(world.meta.length, 1, "one call to Meta");
  const call0 = world.meta[0];
  ok(!/access_token/.test(call0.url), "token is not in the URL");
  eq(call0.body.access_token, "EAAtoken", "token in the body");
  ok(!("test_event_code" in call0.body), "no test code in production");
  const ev = call0.body.data[0];
  eq([ev.event_name, ev.event_id, ev.action_source, ev.event_source_url], ["Purchase", o.order_id, "website", "https://thekaal.co/claimed.html"], "event");
  eq(ev.custom_data, { currency: "INR", value: 5999, content_ids: ["series01-07"], content_type: "product", num_items: 1, order_id: o.order_id }, "custom_data");
  const u = ev.user_data;
  eq([u.em, u.ph, u.fbp, u.fbc, u.client_ip_address, u.external_id, u.country],
     [[sha("buyer@example.com")], [sha("919876543210")], "fb.1.1700000000000.123456789", "fb.1.1700000000000.AbC_click-id", "203.0.113.9", [sha("tok")], [sha("in")]], "user_data");
  ok(/iPhone/.test(u.client_user_agent), "the buyer's user agent, taken at /order");
});

await test("webhook retry: no second Purchase, no second commit", async () => {
  const env = LIVE();
  const o = await order(env);
  const p = pay(o.order_id, "pay_A");
  await hook(env, webhookBody(p));
  const r = await hook(env, webhookBody(p));
  eq(r.status, 200, "retry answered 200");
  eq(world.meta.length, 1, "still one Purchase");
  eq(world.commits.length, 1, "still one commit");
});

await test("GitHub down: Purchase still reaches Meta, Razorpay is asked to retry, retry sends nothing twice", async () => {
  const env = LIVE();
  const o = await order(env);
  const p = pay(o.order_id, "pay_A");
  world.githubPut = 500;
  const r = await hook(env, webhookBody(p));
  eq(r.status, 502, "failed commit asks Razorpay to retry");
  eq(world.meta.length, 1, "Meta told anyway");
  world.githubPut = 200;
  const r2 = await hook(env, webhookBody(p));
  eq(r2.status, 200, "retry records the sale");
  eq(world.meta.length, 1, "and does not send Purchase again");
});

await test("Meta 5xx is retried; a Meta 4xx is not", async () => {
  const env = LIVE();
  const o = await order(env);
  world.metaStatus = [503, 200];
  await hook(env, webhookBody(pay(o.order_id, "pay_A")));
  eq(world.meta.map(x => x.status), [503, 200], "retried once after 503");
  reset();
  const env2 = LIVE();
  const o2 = await order(env2);
  world.metaStatus = [400];
  await hook(env2, webhookBody(pay(o2.order_id, "pay_B")));
  eq(world.meta.map(x => x.status), [400], "a 400 is not retried");
  eq(await env2.KAAL_STATE.get("meta:" + o2.order_id), null, "and is not marked sent");
});

await test("forged webhook, failed payment: nothing sold, nothing sent", async () => {
  const env = LIVE();
  const o = await order(env);
  const p = pay(o.order_id, "pay_A");
  const bad = await hook(env, webhookBody(p), "wrong-secret");
  eq(bad.status, 400, "bad signature refused");
  const failed = await hook(env, webhookBody(Object.assign({}, p, { status: "failed" }), "payment.failed"));
  eq(failed.status, 200, "failed payment acknowledged");
  eq([world.meta.length, world.commits.length], [0, 0], "no Purchase, no sale");
});

await test("the order's number wins over a number the browser typed into the payment", async () => {
  const env = LIVE();
  const o = await order(env);                               /* priced for No. 07 */
  const p = pay(o.order_id, "pay_A", { kaal_no: "03" });     /* browser claims 03 */
  await hook(env, webhookBody(p));
  ok(/sold:\s*\[1, 2, 7\]/.test(world.file), "07 recorded, not 03: " + world.file);
  eq(world.meta[0].body.data[0].custom_data.content_ids, ["series01-07"], "Meta told 07");
});

await test("test worker: a test payment is never committed, and Meta hears it only as a test event", async () => {
  const env = TEST();
  const o = await order(env, {});
  const p = pay(o.order_id, "pay_T");
  let r = await hook(env, webhookBody(p));
  eq(r.status, 200, "acknowledged");
  eq([world.commits.length, world.meta.length], [0, 0], "no commit; no Meta without a test code");
  env.META_TEST_EVENT_CODE = "TEST123";
  r = await hook(env, webhookBody(p));
  eq(world.commits.length, 0, "still no commit");
  eq(world.meta.length, 1, "Purchase sent to Test events");
  eq(world.meta[0].body.test_event_code, "TEST123", "with the test code");
  eq(world.meta[0].body.data[0].event_source_url, "https://test.kaal-preview.pages.dev/claimed.html", "preview url");
});

await test("a test key pasted into the production worker still cannot record a sale", async () => {
  const env = Object.assign(LIVE(), { RAZORPAY_KEY_ID: "rzp_test_oops" });
  const o = await order(env);
  await hook(env, webhookBody(pay(o.order_id, "pay_A")));
  eq([world.commits.length, world.meta.length], [0, 0], "nothing recorded, nothing reported");
});

const ev = (b, origin = "https://thekaal.co") =>
  call(LIVE_ENV, "POST", "/event", { raw: JSON.stringify(b), headers: { "Content-Type": "text/plain", Origin: origin } });
let LIVE_ENV;

await test("/event: the server copy carries the browser's event id, IP, browser and cookies", async () => {
  LIVE_ENV = LIVE();
  const r = await ev({ name: "AddToCart", id: "add.abc123.xyz789", url: "https://thekaal.co/?utm_source=meta",
    no: "07", dial: "Midnight", fbp: "fb.1.1700000000000.123456789", fbc: "fb.1.1700000000000.AbC", xid: sha("tok"), value: 1 });
  eq(r.status, 204, "accepted");
  const e = world.meta[0].body.data[0];
  eq([e.event_name, e.event_id, e.event_source_url], ["AddToCart", "add.abc123.xyz789", "https://thekaal.co/?utm_source=meta"], "event");
  eq(e.custom_data, { content_ids: ["series01-07"], content_type: "product", value: 5999, currency: "INR", content_name: "KAAL Series 01 Midnight" }, "custom_data: value from config, not the body");
  eq([e.user_data.client_ip_address, e.user_data.fbp, e.user_data.fbc, e.user_data.external_id],
     ["203.0.113.9", "fb.1.1700000000000.123456789", "fb.1.1700000000000.AbC", [sha("tok")]], "user_data");
});

await test("/event: PageView has no product; InitiateCheckout carries num_items", async () => {
  LIVE_ENV = LIVE();
  await ev({ name: "PageView", id: "pag.abc123.xyz789", url: "https://thekaal.co/legal.html" });
  await ev({ name: "InitiateCheckout", id: "ini.abc123.xyz789", url: "https://thekaal.co/", no: "16", dial: "Ivory" });
  ok(!("custom_data" in world.meta[0].body.data[0]), "PageView has no custom_data");
  eq(world.meta[1].body.data[0].custom_data.num_items, 1, "num_items on InitiateCheckout");
});

await test("/event refuses Purchase, strangers, junk and other sites' pages", async () => {
  LIVE_ENV = LIVE();
  const good = { name: "ViewContent", id: "vie.abc123.xyz789", url: "https://thekaal.co/", no: "03" };
  eq((await ev(Object.assign({}, good, { name: "Purchase" }))).status, 400, "Purchase refused");
  eq((await ev(good, "https://evil.example")).status, 403, "foreign origin refused");
  eq((await ev(Object.assign({}, good, { url: "https://evil.example/" }))).status, 400, "foreign page refused");
  eq((await ev(Object.assign({}, good, { id: "x" }))).status, 400, "bad id refused");
  eq((await call(LIVE_ENV, "POST", "/event", { raw: "{", headers: { Origin: "https://thekaal.co" } })).status, 400, "junk refused");
  eq((await ev(Object.assign({}, good, { no: "99" }))).status, 204, "out-of-range number accepted…");
  eq(world.meta.map(m => m.body.data[0].custom_data.content_ids[0]), ["series01"], "…but reported as the series, not No. 99");
});

await test("test worker accepts its preview origins and nothing that merely resembles them", async () => {
  LIVE_ENV = TEST();
  LIVE_ENV.META_TEST_EVENT_CODE = "TEST123";
  const b = { name: "PageView", id: "pag.abc123.xyz789", url: "https://test.kaal-preview.pages.dev/" };
  eq((await ev(b, "https://test.kaal-preview.pages.dev")).status, 204, "branch preview");
  eq((await ev(Object.assign({}, b, { url: "https://kaal-preview-x1y.pages.dev/" }), "https://kaal-preview-x1y.pages.dev")).status, 204, "suffixed project");
  eq((await ev(b, "https://kaal-preview.pages.dev.evil.com")).status, 403, "look-alike refused");
  eq((await ev(b, "https://thekaal.co")).status, 403, "production origin refused by the test worker");
  eq(world.meta.every(m => m.body.test_event_code === "TEST123"), true, "all test events carry the code");
});

await test("without a Meta token nothing is sent and nothing breaks", async () => {
  const env = LIVE(); delete env.META_CAPI_TOKEN;
  LIVE_ENV = env;
  eq((await ev({ name: "PageView", id: "pag.abc123.xyz789", url: "https://thekaal.co/" })).status, 204, "event accepted quietly");
  const o = await order(env);
  const r = await hook(env, webhookBody(pay(o.order_id, "pay_A")));
  eq([r.status, world.meta.length, world.commits.length], [200, 0, 1], "sale recorded, Meta untouched");
});

/* ── The lock: one number, one buyer ──────────────────────────────── */
const LOCKED = () => Object.assign(LIVE(), { LOCK: lockNamespace() });
const orderAs = (env, by, n = 7) => call(env, "POST", "/order", { headers: json, body: { n, by } });

await test("lock: ten buyers reach for No. 07 at the same instant — exactly one gets it", async () => {
  const env = LOCKED();
  const rs = await Promise.all([...Array(10)].map((_, i) => orderAs(env, "buyer" + i)));
  const won = rs.filter(r => r.json && r.json.ok), lost = rs.filter(r => r.status === 409);
  eq([won.length, lost.length], [1, 9], "one order, nine refusals");
  ok(lost.every(r => r.json.reason === "held"), "the nine are told it is held");
  eq(Object.keys(world.orders).length, 1, "Razorpay was asked to price it exactly once");
  eq([won[0].json.held_for, won[0].json.timeout], [720, 600], "held 12 min; checkout closes at 10");
});

await test("lock: the same buyer retrying keeps the number; a sold number is refused", async () => {
  const env = LOCKED();
  ok((await orderAs(env, "me")).json.ok, "first try");
  ok((await orderAs(env, "me")).json.ok, "retry by the same buyer");
  eq((await orderAs(env, "me", 1)).json.reason, "sold", "No. 01 is sold in index.html");
});

await test("lock: two buyers without a token are not mistaken for one", async () => {
  const env = LOCKED();
  const a = await call(env, "POST", "/order", { headers: json, body: { n: 7 } });
  const b = await call(env, "POST", "/order", { headers: json, body: { n: 7 } });
  eq([a.json.ok, b.status], [true, 409], "the second anonymous buyer is refused");
});

await test("lock: a hold that runs out frees the number for the next buyer", async () => {
  const env = LOCKED();
  ok((await orderAs(env, "first")).json.ok, "first holds");
  eq((await orderAs(env, "second")).status, 409, "second refused while held");
  const real = Date.now;
  Date.now = () => real() + 13 * 60 * 1000;
  try { ok((await orderAs(env, "second")).json.ok, "second gets it after 13 minutes"); }
  finally { Date.now = real; }
});

await test("lock: Razorpay refusing the order releases the hold", async () => {
  const env = LOCKED();
  world.orderStatus = 500;
  eq((await orderAs(env, "first")).status, 500, "order failed");
  world.orderStatus = 200;
  ok((await orderAs(env, "second")).json.ok, "nobody is left locked out");
});

/* Two tabs, one buyer, two orders for the same number, both paid. */
async function twoPaid(env) {
  const a = (await orderAs(env, "me")).json, b = (await orderAs(env, "me")).json;
  const pa = pay(a.order_id, "pay_A", { kaal_no: "07" }), pb = pay(b.order_id, "pay_B", { kaal_no: "07" });
  return { a, b, pa, pb };
}

await test("double payment: the second is refunded in full, never recorded, never sent to Meta", async () => {
  const env = LOCKED();
  const { a, b, pa, pb } = await twoPaid(env);
  eq((await hook(env, webhookBody(pa))).status, 200, "first payment recorded");
  const r = await hook(env, webhookBody(pb));
  eq(r.status, 200, "second payment answered");
  ok(/refunded/.test(r.text), "and refunded: " + r.text);
  eq(world.refunds.map(x => x.payment), ["pay_B"], "exactly the second payment refunded");
  ok(!("amount" in world.refunds[0].body), "in full (no partial amount)");
  eq(world.commits.length, 1, "one sale committed");
  eq(world.meta.filter(m => m.body.data[0].event_name === "Purchase").map(m => m.body.data[0].event_id), [a.order_id], "one Purchase, for the first order");
  await hook(env, webhookBody(pb));
  eq(world.refunds.length, 1, "a retried webhook does not refund twice");
});

await test("double payment: the second buyer's page is told the truth, not 'it's yours'", async () => {
  const env = LOCKED();
  const { a, b, pa } = await twoPaid(env);
  await hook(env, webhookBody(pa));
  const v = await call(env, "POST", "/verify", { headers: json, body: { razorpay_order_id: b.order_id, razorpay_payment_id: "pay_B", razorpay_signature: hmac(b.order_id + "|pay_B", "ks") } });
  eq([v.json.ok, v.json.conflict, v.json.refund, !!v.json.purchase], [true, true, "automatic", false], "conflict, refund, no Purchase record");
  const va = await call(env, "POST", "/verify", { headers: json, body: { razorpay_order_id: a.order_id, razorpay_payment_id: "pay_A", razorpay_signature: hmac(a.order_id + "|pay_A", "ks") } });
  ok(va.json.purchase && !va.json.conflict, "the first buyer still gets their record");
});

await test("double payment: a refund Razorpay refuses is retried, not forgotten", async () => {
  const env = LOCKED();
  const { pa, pb } = await twoPaid(env);
  await hook(env, webhookBody(pa));
  world.refundStatus = [500];
  eq((await hook(env, webhookBody(pb))).status, 502, "failed refund asks Razorpay to retry");
  eq((await hook(env, webhookBody(pb))).status, 200, "the retry refunds");
  eq(world.refunds.map(x => x.status), [500, 200], "two attempts, one refund");
});

await test("double payment: AUTO_REFUND = 0 leaves it to a person", async () => {
  const env = Object.assign(LOCKED(), { AUTO_REFUND: "0" });
  const { pa, pb } = await twoPaid(env);
  await hook(env, webhookBody(pa));
  const r = await hook(env, webhookBody(pb));
  eq([r.status, world.refunds.length, world.commits.length], [200, 0, 1], "no refund, no second sale");
});

await test("never refunds on a guess: a number sold before the lock existed is left alone", async () => {
  const env = LOCKED();
  world.orders.order_OLD = { id: "order_OLD", amount: 599900, currency: "INR", notes: { kaal_no: "01", ua: "x" } };
  const r = await hook(env, webhookBody(pay("order_OLD", "pay_OLD", { kaal_no: "01" })));
  eq(world.refunds.length, 0, "no refund for an ownerless sold number");
  ok(/already recorded/.test(r.text), "treated as the recorded sale it may be: " + r.text);
});

await test("a buyer who said No thanks is sold to but not reported to Meta", async () => {
  const env = LOCKED();
  const o = (await call(env, "POST", "/order", { headers: json, body: { n: 7, by: "me", attr: { mc: "0" } } })).json;
  eq(world.orders[o.order_id].notes.mc, "0", "the choice is on the order");
  await hook(env, webhookBody(pay(o.order_id, "pay_A")));
  eq([world.commits.length, world.meta.length], [1, 0], "sale recorded, nothing sent to Meta");
});

await test("the rightful owner is recorded even if the number was marked sold seconds before", async () => {
  const env = LOCKED();
  const x = (await orderAs(env, "x")).json;
  pay(x.order_id, "pay_X", { kaal_no: "07" });
  /* /verify writes 07 into KV at once; somebody else's /order then folds
     KV's sold list into the lock before X's webhook arrives. */
  await call(env, "POST", "/verify", { headers: json, body: { razorpay_order_id: x.order_id, razorpay_payment_id: "pay_X", razorpay_signature: hmac(x.order_id + "|pay_X", "ks") } });
  await orderAs(env, "someone-else", 9);
  await hook(env, webhookBody(world.payments.pay_X));
  /* A stray second payment for 07 must now be caught. */
  world.orders.order_STRAY = { id: "order_STRAY", amount: 599900, currency: "INR", notes: { kaal_no: "07", ua: "x" } };
  await hook(env, webhookBody(pay("order_STRAY", "pay_STRAY", { kaal_no: "07" })));
  eq(world.refunds.map(r => r.payment), ["pay_STRAY"], "the stray payment is refunded, X is not");
});

await test("/state answers from the lock: sold and held, merged with index.html", async () => {
  const env = LOCKED();
  await orderAs(env, "me", 9);
  const s = (await call(env, "GET", "/state", { headers: { Origin: "https://thekaal.co" } })).json;
  eq([s.held, s.sold.includes(9)], [[9], false], "No. 09 held, not sold");
});

/* ── Report ────────────────────────────────────────────────────────── */
let failed = 0;
for (const [pass, name, err] of results) {
  console.log(`${pass ? "  ok  " : "  FAIL"} ${name}`);
  if (!pass) { failed++; console.log("       " + String(err).split("\n").slice(0, 4).join("\n       ")); }
}
console.log(`\n${results.length - failed}/${results.length} worker tests passed.`);
process.exit(failed ? 1 : 0);
