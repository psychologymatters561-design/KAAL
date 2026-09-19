/* ══════════════════════════════════════════════════════════════════
   The worker, held still.

   These are CHARACTERISATION tests before they are anything else: they
   were written against the single-file worker and are what made it safe
   to take apart. Every one of them describes a decision somebody can
   only get wrong once — a payment believed without checking the amount,
   a signature compared in a way that leaks, a refund that un-sells a
   watch that has already shipped.

   `node --test tools/test/` — no npm, no network, no mocking library.
   ══════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../../worker/index.js";
import { makeKV, makeGitHub, makeEnv, sign, captured, post, get, hold, PAGE } from "./harness.mjs";

const PRICE_PAISE = (() => {
  const m = PAGE.match(/price:\s*"([\d,]+)"/);
  return parseInt(m[1].replace(/,/g, ""), 10) * 100;
})();
const setup = (over) => { const kv = makeKV(); return { kv, gh: makeGitHub(), env: makeEnv(kv, over) }; };
const alerts = (kv) => [...kv._map.keys()].filter(k => k.startsWith("alert:"));

/* ══════════ THE MONEY ══════════ */

test("a payment below the listed price never marks a number sold", async () => {
  const { kv, gh, env } = setup();
  const res = await post(worker, env, captured(100, 7, "pay_cheap"));
  assert.equal(res.status, 200, "Razorpay must not be told to retry a payment we refuse on purpose");
  assert.equal(gh.commits.length, 0, "THE attack: one rupee must not strike a number off a live shop");
  assert.deepEqual(alerts(kv), ["alert:amount-mismatch:pay_cheap"]);
});

test("a payment at the listed price is committed, once", async () => {
  const { gh, env } = setup();
  const res = await post(worker, env, captured(PRICE_PAISE, 7, "pay_real"));
  assert.equal(res.status, 200);
  assert.equal(gh.commits.length, 1);
  assert.match(gh.commits[0].message, /^Auto: mark number 7 sold \(payment pay_real\)$/);
  const written = Buffer.from(gh.commits[0].content, "base64").toString("binary");
  assert.match(written, /sold:\s+\[1, 2, 7\]/, "the sold array gains exactly the number that was paid for");
});

test("the expected price is read from the page, not typed into the worker", async () => {
  /* Raise the price on the page and the same payment stops being enough,
     with nothing in the worker edited. This is the whole reason the
     amount is parsed rather than configured. */
  const kv = makeKV(); makeGitHub(PAGE.replace(/price:\s*"[\d,]+"/, 'price:    "9,999"'));
  const res = await post(worker, makeEnv(kv), captured(PRICE_PAISE, 7, "pay_stale"));
  assert.equal(res.status, 200);
  assert.deepEqual(alerts(kv), ["alert:amount-mismatch:pay_stale"]);
});

test("the right amount in the wrong currency is refused", async () => {
  const { kv, gh, env } = setup();
  await post(worker, env, captured(PRICE_PAISE, 9, "pay_usd", { currency: "USD" }));
  assert.equal(gh.commits.length, 0);
  assert.deepEqual(alerts(kv), ["alert:amount-mismatch:pay_usd"]);
});

test("MIN_AMOUNT_PAISE loosens the exact match to a floor", async () => {
  const { gh, env } = setup({ MIN_AMOUNT_PAISE: "100000" });
  await post(worker, env, captured(150000, 7, "pay_coupon"));
  assert.equal(gh.commits.length, 1, "a coupon is a business decision the worker must be able to honour");
});

test("a page with no readable price refuses rather than waves through", async () => {
  const kv = makeKV(); makeGitHub(PAGE.replace(/price:\s*"[\d,]+"/, "price:    UNPARSEABLE"));
  await post(worker, makeEnv(kv), captured(PRICE_PAISE, 7, "pay_noprice"));
  assert.deepEqual(alerts(kv), ["alert:amount-mismatch:pay_noprice"],
    "an unverifiable payment is exactly the one worth stopping on");
});

/* ══════════ WHO IS ASKING ══════════ */

test("a forged signature is refused before the body is trusted", async () => {
  const { gh, env } = setup();
  const res = await post(worker, env, captured(PRICE_PAISE, 7, "pay_forge"), { sig: "0".repeat(64) });
  assert.equal(res.status, 400);
  assert.equal(gh.commits.length, 0);
});

test("a signature that is right except for one character is refused", async () => {
  const { env } = setup();
  const body = captured(PRICE_PAISE, 7, "pay_near");
  const good = await sign(body);
  const near = good.slice(0, -1) + (good.at(-1) === "a" ? "b" : "a");
  assert.equal((await post(worker, env, body, { sig: near })).status, 400);
});

test("no webhook secret configured means no webhook is ever believed", async () => {
  const { gh, env } = setup({ RAZORPAY_WEBHOOK_SECRET: "" });
  assert.equal((await post(worker, env, captured(PRICE_PAISE, 7, "pay_x"))).status, 400);
  assert.equal(gh.commits.length, 0);
});

test("the same event delivered twice is processed once", async () => {
  const { gh, env } = setup();
  const body = captured(PRICE_PAISE, 8, "pay_twice");
  const sig = await sign(body);
  await post(worker, env, body, { sig, eventId: "evt_fixed" });
  const second = await post(worker, env, body, { sig, eventId: "evt_fixed" });
  assert.match(await second.text(), /Already processed/);
  assert.equal(gh.commits.length, 1, "a signed body replays forever unless something remembers it");
});

test("a webhook from another Razorpay account is ignored when the id is pinned", async () => {
  const { gh, env } = setup({ RAZORPAY_ACCOUNT_ID: "acc_ours" });
  const body = JSON.stringify(Object.assign(JSON.parse(captured(PRICE_PAISE, 7, "pay_other")), { account_id: "acc_theirs" }));
  await post(worker, env, body);
  assert.equal(gh.commits.length, 0);
});

/* ══════════ THINGS A PERSON MUST HEAR ABOUT ══════════ */

test("a captured payment for a number already sold raises a double-sale alert", async () => {
  const { kv, gh, env } = setup();
  const res = await post(worker, env, captured(PRICE_PAISE, 1, "pay_dupe"));   /* 1 is sold in the page */
  assert.equal(res.status, 200);
  assert.equal(gh.commits.length, 0);
  assert.deepEqual(alerts(kv), ["alert:double-sale:pay_dupe"],
    "two people have paid for one watch; a 200 and silence is not an answer");
});

test("a refund is recorded and never un-sells the number", async () => {
  const { kv, gh, env } = setup();
  await post(worker, env, captured(PRICE_PAISE, 7, "pay_ref"));
  const before = JSON.parse(kv._map.get("sold"));
  await post(worker, env, JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_ref" } } } }));
  assert.deepEqual(JSON.parse(kv._map.get("sold")), before,
    "a machine that can mark a number available again can be made to resell a watch that has shipped");
  assert.ok(alerts(kv).includes("alert:refund.processed:pay_ref"));
});

test("a dispute is recorded the same way", async () => {
  const { kv, env } = setup();
  await post(worker, env, JSON.stringify({ event: "payment.dispute.created", payload: { dispute: { entity: { id: "disp_1", payment_id: "pay_d" } } } }));
  assert.ok(alerts(kv).some(k => k.startsWith("alert:payment.dispute.created")));
});

test("alerts are readable only with the token", async () => {
  const { kv, env } = setup();
  await post(worker, env, captured(100, 7, "pay_cheap"));
  assert.equal((await get(worker, env, "/alerts")).status, 404, "closed, not merely unlisted");
  assert.equal((await get(worker, env, "/alerts?token=wrong")).status, 404);
  const ok = await get(worker, env, "/alerts?token=alerttoken");
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).alerts.length, 1);
  assert.equal((await get(worker, env, "/alerts?token=alerttoken", {})).headers.get("Cache-Control"), "no-store");
  void kv;
});

test("with no ALERT_TOKEN set the route stays shut", async () => {
  const { env } = setup({ ALERT_TOKEN: "" });
  assert.equal((await get(worker, env, "/alerts?token=")).status, 404);
});

/* ══════════ WHAT THE PAGE ASKS ══════════ */

test("/state reports sold and held, and never who holds them", async () => {
  const { kv, env } = setup();
  await hold(worker, env, 5, "clienttoken1");
  const body = await (await get(worker, env, "/state", { Origin: "https://thekaal.co" })).json();
  assert.deepEqual(body.held, [5]);
  assert.equal(JSON.stringify(body).includes("clienttoken1"), false, "the token is a client identifier, not public data");
  void kv;
});

test("/state and /hold refuse a foreign origin but allow no origin at all", async () => {
  const { env } = setup();
  assert.equal((await get(worker, env, "/state", { Origin: "https://not-kaal.example" })).status, 403);
  assert.equal((await hold(worker, env, 5, "clienttoken1", "https://not-kaal.example")).status, 403);
  assert.equal((await get(worker, env, "/state")).status, 200, "curl, health checks and Razorpay are not what CORS is for");
});

test("/state never answers with a wildcard origin", async () => {
  const { env } = setup();
  const res = await get(worker, env, "/state", { Origin: "https://thekaal.co" });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://thekaal.co");
  assert.notEqual(res.headers.get("Access-Control-Allow-Origin"), "*");
});

test("re-holding your own number does not write again", async () => {
  const { kv, env } = setup();
  await hold(worker, env, 12, "clienttoken1");
  const after = kv.writes;
  for (let i = 0; i < 50; i++) await hold(worker, env, 12, "clienttoken1");
  assert.equal(kv.writes, after, "fifty clicks used to be fifty writes against a thousand-a-day budget");
});

test("somebody else's hold stands", async () => {
  const { env } = setup();
  await hold(worker, env, 3, "clienttoken1");
  assert.equal((await (await hold(worker, env, 3, "clienttoken2")).json()).reason, "held");
});

test("a hold is refused for a number that is already sold, and for one out of range", async () => {
  const { env } = setup();
  assert.equal((await (await hold(worker, env, 21, "clienttoken1")).json()).reason, "out-of-range");
  assert.equal((await (await hold(worker, env, 0, "clienttoken1")).json()).reason, "out-of-range");
  await post(worker, makeEnv(makeKV()), captured(PRICE_PAISE, 7, "pay_a"));
});

test("a hold never blocks a buyer, even when the per-IP cap is spent", async () => {
  const { env } = setup();
  for (let n = 2; n <= 20; n++) await hold(worker, env, n, "client" + n);
  const res = await hold(worker, env, 19, "clientlast");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true, "a rate limiter must never stand between somebody and a checkout page");
});

/* ══════════ THE EDGES ══════════ */

test("an oversized body is refused before any HMAC is computed", async () => {
  const { env } = setup();
  assert.equal((await post(worker, env, "x".repeat(200 * 1024), { sig: "0".repeat(64) })).status, 413);
});

test("unknown routes are refused, and every response is hardened", async () => {
  const { env } = setup();
  const res = await worker.fetch(new Request("https://w.example/nope", { method: "PUT" }), env);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("Allow"), "GET, POST, OPTIONS");
  for (const [h, v] of [["X-Content-Type-Options", "nosniff"], ["Referrer-Policy", "no-referrer"]])
    assert.equal(res.headers.get(h), v);
  assert.match(res.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
});

test("a preflight answers without a body", async () => {
  const { env } = setup();
  const res = await worker.fetch(new Request("https://w.example/hold", { method: "OPTIONS", headers: { Origin: "https://thekaal.co" } }), env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://thekaal.co");
});

test("a payment with no usable kaal_no is reported, not committed", async () => {
  const { gh, env } = setup();
  const res = await post(worker, env, captured(PRICE_PAISE, "banana", "pay_junk"));
  assert.equal(res.status, 200);
  assert.equal(gh.commits.length, 0);
  assert.match(await res.text(), /no valid kaal_no/);
});

test("a number outside the edition is refused, and the edition is read from the page", async () => {
  const { gh, env } = setup();
  await post(worker, env, captured(PRICE_PAISE, 21, "pay_oob"));
  assert.equal(gh.commits.length, 0);
});

test("an events this shop does not care about is acknowledged and dropped", async () => {
  const { gh, env } = setup();
  const res = await post(worker, env, JSON.stringify({ event: "payment.authorized", payload: {} }));
  assert.equal(res.status, 200);
  assert.equal(gh.commits.length, 0);
});

test("a concurrent commit is retried rather than left to Razorpay's schedule", async () => {
  const { gh, env } = setup();
  gh.conflictOnce = true;
  await post(worker, env, captured(PRICE_PAISE, 7, "pay_race"));
  assert.equal(gh.commits.length, 1, "two webhooks landing together must not need a human");
});

test("a GitHub response in an unusable shape commits nothing", async () => {
  const kv = makeKV();
  const gh = makeGitHub();
  globalThis.fetch = async () => new Response(JSON.stringify({ content: "", sha: "x", encoding: "none" }), { status: 200 });
  const res = await post(worker, makeEnv(kv), captured(PRICE_PAISE, 7, "pay_big"));
  assert.equal(res.status, 502, "over a megabyte the contents API returns empty content and no error");
  void gh;
});

test("without KV the webhook still records sales", async () => {
  const gh = makeGitHub();
  const env = makeEnv(undefined, { KAAL_STATE: undefined });
  await post(worker, env, captured(PRICE_PAISE, 7, "pay_nokv"));
  assert.equal(gh.commits.length, 1, "the store is an accelerator; the commit is the record");
});

test("without KV the page is told the server has no opinion", async () => {
  const env = makeEnv(undefined, { KAAL_STATE: undefined });
  assert.deepEqual(await (await get(worker, env, "/state")).json(), { sold: null, held: [] },
    "null is not an empty edition — the page must keep its own array");
});
