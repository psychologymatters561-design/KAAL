/* ══════════════════════════════════════════════════════════════════
   KAAL — edition state worker.

   THE PROBLEM THIS CLOSES: index.html is a static site with no backend.
   `KAAL.sold` only ever changes when Arjun edits it by hand and pushes.
   Between a real sale landing and that push, the site is telling every
   other visitor a number is available when it is not — two people can
   pick the same number, pay, and only one watch exists. Razorpay's own
   stock-limit-20 stops the 21st sale; it does nothing about two people
   both landing on "07".

   THE FIX: Razorpay fires a webhook the instant a payment is captured.
   This worker verifies the webhook is genuinely from Razorpay, checks
   that what was paid is what the page is asking, reads which number the
   buyer chose, and commits the updated `sold` array straight to
   index.html on GitHub. Pages rebuilds. The gap between a sale and the
   site telling the truth about it drops to seconds.

   Two more routes stop the honest collision before a payment at all:

     GET  /state        what is actually sold, and what is briefly held
     POST /hold {n}     claim a number for twelve minutes while paying
     GET  /alerts       what needs a person (token required)

   A hold is advisory on purpose. It is not a lock, it is not payment,
   and it NEVER stands between a buyer and the checkout page.

   ── WHAT THIS FILE IS, AND IS NOT ────────────────────────────────

   THIS FILE IS THE COMPOSITION ROOT. Routing, and handlers that read as
   a sequence of decisions. It is allowed to be the only place that
   knows the shape of the whole transaction — that is its job.

   IT DOES NOT KNOW HOW ANYTHING WORKS.

     lib/edition.js   the rules: what a valid sale is. Pure. No I/O, no
                      globals, no clock. Testable by calling it.
     lib/crypto.js    is this really Razorpay
     lib/store.js     Workers KV, behind names, and optional by design
     lib/github.js    the contents API, in two functions
     lib/http.js      CORS, security headers, bounded bodies

   The rule that keeps it that way: a handler here may DECIDE things and
   may CALL things. The moment one starts building a header by hand,
   parsing base64, or writing a KV key with a prefix in it, the layer
   below it has a gap and the fix belongs there, not here.

   WHAT THIS STILL DOES NOT DO: it is not a database, a cart, or an
   inventory system. It holds a few small keys and edits one line of one
   file, because that is the entire footprint of "sold" in this codebase.

   WHEN TO OUTGROW IT: KV is eventually consistent — a write can take up
   to a minute to be visible everywhere. At twenty units that is
   irrelevant. If this becomes a real cadence — a restock, a larger
   series, more than a sale a minute — move holds and sold into a
   Durable Object, which serialises writes by construction. That is a
   change to lib/store.js and nothing else, which is most of the reason
   lib/store.js exists.

   Setup, secrets and the launch checks: docs/LAUNCH-RUNBOOK.md.
   ══════════════════════════════════════════════════════════════════ */

import * as http from "./lib/http.js";
import * as store from "./lib/store.js";
import * as github from "./lib/github.js";
import { verifySignature, timingSafeEqual } from "./lib/crypto.js";
import {
  parseEdition, isInEdition, withNumberSold, verifyAmount,
  entityOf, classifyEvent, chosenNumber
} from "./lib/edition.js";

const HOLDS_PER_IP     = 8;
const HOLD_RATE_WINDOW = 600;
const MAX_LIVE_HOLDS   = 20;

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return http.preflight(request, env);

    if (request.method === "GET" && path === "/state")  return getState(request, env);
    if (request.method === "GET" && path === "/alerts") return getAlerts(request, env);
    if (request.method === "GET" && path === "/")       return http.text(request, env, "KAAL edition worker is alive.", 200);

    if (request.method === "POST" && path === "/hold")  return postHold(request, env);
    /* Razorpay posts to the root. Naming the paths means a typo in the
       dashboard lands on a visible 405 rather than being fed to the
       signature check and failing as if the secret were wrong. */
    if (request.method === "POST" && (path === "/" || path === "/webhook")) return webhook(request, env);

    return http.text(request, env, "Not a route this worker serves.", 405, { "Allow": "GET, POST, OPTIONS" });
  }
};

/* ══════════ 1. WHAT THE PAGE ASKS ══════════ */

/* The page merges this into what it already believes, in ONE direction:
   a number the server calls sold gets struck, a number it does not is
   left exactly as the file said. A backend that can only ever be more
   cautious than the static page is a backend that cannot take the shop
   down when it is having a bad day. */
async function getState(request, env) {
  if (!http.originAllowed(request, env)) return http.json(request, env, { error: "origin" }, {}, 403);

  const db = store.open(env);
  if (!db.available) return http.json(request, env, { sold: null, held: [] });

  /* Numbers only. Never the `by` token or the expiry — one is a client
     identifier and the other tells a scalper exactly when to strike. */
  return http.json(request, env,
    { sold: await db.readSold(), held: await db.listHeldNumbers(), at: Date.now() },
    { "Cache-Control": "public, max-age=10" });
}

/* Sales that need a human: a captured payment for a number already gone,
   a refund, a dispute, a payment whose amount did not match. Behind a
   shared secret because it is an operational surface, not a public one —
   and closed rather than open when no secret is set. */
async function getAlerts(request, env) {
  const supplied = new URL(request.url).searchParams.get("token") || "";
  if (!env.ALERT_TOKEN || !timingSafeEqual(String(supplied), String(env.ALERT_TOKEN)))
    return http.text(request, env, "Not a route this worker serves.", 404);

  return http.json(request, env, { alerts: await store.open(env).listAlerts() }, { "Cache-Control": "no-store" });
}

async function postHold(request, env) {
  if (!http.originAllowed(request, env)) return http.json(request, env, { ok: false, reason: "origin" }, {}, 403);

  const db = store.open(env);
  if (!db.available) return http.json(request, env, { ok: false, reason: "no-store" });

  const raw = await http.readBounded(request);
  if (raw === null) return http.json(request, env, { ok: false, reason: "too-large" }, {}, 413);

  let body;
  try { body = JSON.parse(raw); } catch (e) { return http.json(request, env, { ok: false, reason: "bad-request" }, {}, 400); }

  const n = parseInt(body && body.n, 10);
  /* The page writes a base36 token. It is forgeable by construction, so
     the shape check is only there to keep a stray value out of a KV key
     and out of the comparison below. */
  const byRaw = typeof (body && body.by) === "string" ? body.by : "";
  const by = /^[a-z0-9]{6,32}$/.test(byRaw) ? byRaw : "";

  if (!isInEdition(n, parseInt(env.EDITION || "20", 10)))
    return http.json(request, env, { ok: false, reason: "out-of-range" }, {}, 400);

  const sold = await db.readSold();
  if (sold && sold.indexOf(n) > -1) return http.json(request, env, { ok: false, reason: "sold" });

  const existing = await db.getHold(n);
  const now = Date.now();

  /* Somebody else's hold stands. So does an anonymous caller's, against
     an anonymous caller. */
  if (existing && existing.by && existing.by !== by) return http.json(request, env, { ok: false, reason: "held" });

  /* Re-holding your own number used to rewrite the key on every click.
     A hold with most of its life left does not need extending, and a
     write that changes nothing is a write somebody else can make us
     spend. This is the single biggest source of write amplification on
     an endpoint anyone can call. */
  if (existing && existing.by === by && existing.until - now > (store.HOLD_SECONDS - 120) * 1000)
    return http.json(request, env, { ok: true, n, until: existing.until });

  if (!existing && !(await underHoldCaps(db, request))) {
    /* Deliberately shaped like success. A buyer must never be told "no"
       by a rate limiter on the way to a checkout page; the hold is
       advisory and the page proceeds regardless. */
    return http.json(request, env, { ok: true, n, until: now + store.HOLD_SECONDS * 1000, advisory: false });
  }

  const until = now + store.HOLD_SECONDS * 1000;
  await db.putHold(n, { by, until });
  return http.json(request, env, { ok: true, n, until });
}

/* Two bounds, both about KV writes rather than about attackers. Nothing
   unauthenticated can be stopped here — that is what the Cloudflare rate
   limiting rule in front of this worker is for (runbook section 5.4). */
async function underHoldCaps(db, request) {
  if ((await db.listHeldNumbers()).length >= MAX_LIVE_HOLDS) return false;

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const { count, bump } = await db.countHoldsFrom(ip, HOLD_RATE_WINDOW);
  if (count >= HOLDS_PER_IP) return false;
  await bump();
  return true;
}

/* ══════════ 2. WHAT RAZORPAY SAYS ══════════ */

async function webhook(request, env) {
  const rawBody = await http.readBounded(request);
  if (rawBody === null) return new Response("Body too large.", { status: 413 });

  if (!await verifySignature(rawBody, request.headers.get("x-razorpay-signature") || "", env.RAZORPAY_WEBHOOK_SECRET))
    return new Response("Signature mismatch.", { status: 400 });

  let event;
  try { event = JSON.parse(rawBody); }
  catch (e) { return new Response("Bad JSON.", { status: 400 }); }

  const db = store.open(env);

  /* A signed body is proof of the secret, not proof of freshness. The
     same body replays forever unless something remembers it. */
  const eventId = request.headers.get("x-razorpay-event-id") || "";
  if (await db.hasSeen(eventId)) return new Response("Already processed.", { status: 200 });

  /* One secret, one account. If the secret ever reaches a second
     Razorpay account, this is what stops that account writing to this
     shop's inventory. */
  if (env.RAZORPAY_ACCOUNT_ID && event.account_id && event.account_id !== env.RAZORPAY_ACCOUNT_ID) {
    console.error("Webhook from an unexpected account:", String(event.account_id).slice(0, 40));
    return new Response("Not this account.", { status: 200 });
  }

  const { kind, name } = classifyEvent(event);
  const entity = entityOf(event);

  /* Money going back out is never handled automatically. A refund or a
     dispute on a piece that has shipped must not un-sell it, and a
     refund on one that has not is a decision with judgement in it. */
  if (kind === "reversal") {
    const payment = entity.payment_id || entity.id || "unknown";
    await db.alert({ kind: name, payment, at: Date.now(),
      note: "Money reversed or disputed. The number is still marked sold — decide by hand." });
    console.error("ALERT", name, payment);
    return new Response("Recorded for manual review.", { status: 200 });
  }

  if (kind !== "captured") return new Response("Ignored: " + name.slice(0, 60), { status: 200 });
  if (entity.status && entity.status !== "captured") return new Response("Not a captured payment.", { status: 200 });

  const paymentId = typeof entity.id === "string" ? entity.id.slice(0, 40) : "unknown";
  const { raw, n: chosen } = chosenNumber(entity);
  const sale = await recordSale(env, chosen, paymentId, entity);

  if (sale.status === "bad-number") {
    console.log("payment.captured with no usable kaal_no:", String(raw).slice(0, 40));
    return new Response("Captured but no valid kaal_no — check manually.", { status: 200 });
  }

  if (sale.status === "bad-amount") {
    /* The attack this closes in one line: any cheap payment anywhere on
       this Razorpay account, carrying a kaal_no note, marking a watch
       sold. Never commit, always shout. */
    await db.alert({ kind: "amount-mismatch", payment: paymentId, n: chosen, at: Date.now(),
      got: sale.got, want: sale.want, currency: sale.currency,
      note: "A captured payment carried a kaal_no but did not match the page price. Nothing was marked sold." });
    console.error("ALERT amount-mismatch", paymentId, "got", sale.got, sale.currency, "want", sale.want);
    return new Response("Amount did not match the listed price — recorded for review.", { status: 200 });
  }

  if (sale.status === "already") {
    /* Two payments, one watch. This used to be a silent 200. */
    await db.alert({ kind: "double-sale", payment: paymentId, n: chosen, at: Date.now(),
      note: "A captured payment named a number that was already sold. One of these buyers needs a refund and a message, today." });
    console.error("ALERT double-sale", paymentId, "number", chosen);
    await db.remember(eventId);
    return new Response(`Number ${chosen} was already sold — recorded for review.`, { status: 200 });
  }

  if (sale.status === "error") return new Response("Could not record the sale — see worker logs.", { status: 502 });

  /* KV is what the live page reads within seconds; the commit is what
     makes the static file true on its own. Both, in that order, because
     the one that is fast should not wait on the one that is durable. */
  const known = (await db.readSold()) || [];
  if (known.indexOf(chosen) < 0) known.push(chosen);
  await db.saveSold(known);
  await db.dropHold(chosen);
  await db.remember(eventId);

  console.log(`Number ${chosen} marked sold. GitHub Pages will rebuild shortly.`);
  return new Response(`OK — number ${chosen} recorded as sold.`, { status: 200 });
}

/* Read, modify, write — and mean it.

   Both bounds this checks, the edition and the price, are read out of
   the file being edited rather than configured here. The day the
   edition or the price changes is exactly the day nobody would think to
   look in a worker for the reason a real sale went unrecorded.

   The order matters and is deliberate: a number that is not in the
   edition is reported as a bad number even if the amount is also wrong,
   because "your custom field says 47" is a more useful thing to be told
   than "the amount was short". */
async function recordSale(env, chosen, paymentId, entity) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const page = await github.fetchPage(env);
    if (!page.ok) return { status: "error" };

    if (!isInEdition(chosen, parseEdition(page.source))) return { status: "bad-number" };

    const money = verifyAmount(entity, page.source, env);
    if (!money.ok) return Object.assign({ status: "bad-amount" }, money);

    const next = withNumberSold(page.source, chosen);
    if (next.status === "no-sold-array") {
      console.log("Could not find `sold:` array — has index.html's config shape changed?");
      return { status: "error" };
    }
    if (next.status === "already") return { status: "already" };

    const put = await github.commitPage(env, {
      source: next.source, sha: page.sha,
      message: `Auto: mark number ${chosen} sold (payment ${paymentId})`
    });
    if (put.ok) return { status: "ok" };
    if (put.conflict) continue;          /* somebody committed first: re-read and retry */
    return { status: "error" };
  }
  console.log("GitHub PUT conflicted three times running.");
  return { status: "error" };
}
