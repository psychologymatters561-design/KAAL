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
   This worker verifies that webhook is genuinely from Razorpay, reads
   which number the buyer chose out of the payment's notes, and commits
   the updated `sold` array straight to index.html on GitHub. GitHub
   Pages rebuilds automatically. The gap between a sale and the site
   telling the truth about it drops from "whenever Arjun notices" to
   roughly the time it takes GitHub to rebuild a static page — seconds,
   not hours.

   WHAT WAS STILL OPEN, AND IS NOW CLOSED: the webhook fires at payment.
   Two honest buyers can both choose 07 in the minutes BEFORE either of
   them pays, and both reach checkout. One of them then gets an apology
   and a refund, which is the single worst message this brand can send.
   So there are two more routes now, and a KV namespace behind them:

     GET  /state        what is actually sold, and what is briefly held
     POST /hold {n}     claim a number for twelve minutes while paying

   AND THE MONEY ITSELF. The page used to hand the buyer to a hosted
   Razorpay Payment Page and rely on its stock-limit-20 to stop the
   twenty-first sale. Standard Checkout keeps the buyer on thekaal.co
   and moves that responsibility here, so two more routes carry it:

     POST /order {n}    the order for that number, priced by this file; since
                        v3 it also keeps the buyer's details given before
                        paying (name, phone, email, where it goes)
     POST /verify {..}  the signature, checked before anything is believed

   AND TWO THAT ARE NOT ABOUT MONEY (October 2026):

     POST /callback     where Razorpay sends the buyer after paying, when the
                        page itself cannot be relied on to still be there
     GET  /receipt?o=   a verified receipt for one order: paid or not, which
                        number, how much. No email, no phone, no address.
     POST /shipping     where the watch goes, given after paying, once the
                        payment is proved; tells the owner at once

     GET  /desk         the owner's private desk (section 6): passcode only,
                        never linked from the site, invisible to robots

     POST /list {email} the Series 02 list: one address, stored under the
                        hash of itself, rate limited, nothing else kept
     scheduled()        the emails nobody presses send on (section 3e),
                        each with its own switch in wrangler.toml — see
                        docs/email.md. Also the refund watch (section 7)
                        and the morning report

   Two things about /order are the whole point of it existing. It reads
   the price from PRICE_PAISE and ignores whatever the browser said the
   watch costs — a page that can name its own price is a page that sells
   a ₹5,999 watch for ₹1. And it refuses a number that is already sold
   or held by somebody else, which is the job the Payment Page's stock
   limit used to do and nothing else was doing.

   A hold is advisory on purpose. It is not a lock, it is not payment,
   and it NEVER stands between a buyer and the checkout page — if the
   hold call is slow or fails, the page proceeds to Razorpay regardless.
   It exists to stop the honest collision, not a determined attacker;
   the authority on a sale is /order refusing to price a number that is
   gone, and the webhook below recording the one that sold.

   WHAT THIS STILL DOES NOT DO: it is not a database, a cart, or an
   inventory system. It holds two small keys and edits one line of one
   file, because that is the entire footprint of "sold" in this codebase.

   WHEN TO OUTGROW IT: Workers KV is eventually consistent — a write can
   take up to about a minute to be visible everywhere. At twenty units
   that is irrelevant: the window where it matters is the window where
   two people buy within the same minute, and there are only twenty
   units in total. If this ever becomes a real cadence — a restock, a
   larger series, more than a sale a minute — move `hold` and `sold`
   into a Durable Object, which serialises writes by construction. That
   is a contained change to two functions here and nothing on the page.
   Do it when the cadence arrives, not before.
   ══════════════════════════════════════════════════════════════════ */

import { buyerConfirmation, buyerNearlyBought, nearlyWhatsApp, seriesTwoNote, afterArrival, afterSettled, afterYear, ownerSale, ownerShip, buyerShip, buyerDispatched, buyerRefund, ownerRefund, ownerDigest, arriveBy, arriveByDay, indiaTime,
  stepText, sourceName, deviceName } from "./mail.js";
import { deskPage } from "./desk.js";

const HOLD_SECONDS = 12 * 60;
const KEY_SOLD = "sold";
const HOLD_PREFIX = "hold:";
const RZP_API = "https://api.razorpay.com/v1";
const MIN_PAISE = 100;          /* Razorpay rejects anything under this */
const LEAD_DAYS = 90;           /* details from a checkout that was never paid */

export default {
  async fetch(request, env, ctx) {
    const url  = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    /* The owner's desk answers for itself, before anything that would
       hand thekaal.co a CORS header: no other site may read it. */
    if (path === "/desk" || path.startsWith("/desk/")) return desk(request, env, ctx, path);
    if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } });

    if (request.method === "OPTIONS") return preflight(request, env);

    if (request.method === "GET" && path === "/state") return getState(request, env, ctx, url);
    if (request.method === "POST" && path === "/hold") return postHold(request, env);
    if (request.method === "POST" && path === "/order") return postOrder(request, env, ctx);
    if (request.method === "POST" && path === "/verify") return postVerify(request, env);
    if (request.method === "POST" && path === "/list") return postList(request, env);
    if (request.method === "POST" && path === "/callback") return postCallback(request, env);
    if (request.method === "GET" && path === "/receipt") return getReceipt(request, env, url);
    if (request.method === "POST" && path === "/shipping") return postShipping(request, env, ctx);
    if (request.method === "POST" && path === "/e") return postCount(request, env, ctx);
    if (request.method === "POST") return webhook(request, env, ctx);   /* Razorpay posts to the root */

    return new Response("KAAL edition worker is alive.", { status: 200 });
  },

  /* The cron in wrangler.toml calls this. Each email it sends on its own
     (section 3e) does nothing unless its own switch is "on", so the trigger
     can stay configured while any of them stays off. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(followUps(env));
    ctx.waitUntil(refundWatch(env));
    ctx.waitUntil(dailyDigest(env));
    ctx.waitUntil(histPrune(env));
  }
};

/* ══════════ 1. WHAT THE PAGE ASKS ══════════ */

/* The page merges this into what it already believes. It only ever ADDS
   numbers to its sold set from here, never removes one — so a KV that is
   empty, cold, or briefly unreachable cannot un-sell a watch. A backend
   that can only ever be more cautious than the static page is a backend
   that cannot take the site down. */
async function getState(request, env, ctx, url) {
  /* The page asks this once a minute while it is being looked at, so the
     same request says "still here" for the owner's live view (section 5b):
     no second request, nothing added to the answer but `live`. */
  if (url && url.searchParams.get("h")) liveSeen(request, env, ctx, url.searchParams);
  if (!env.KAAL_STATE) {
    const placed = await readPlaced(env);
    /* No store, nowhere to keep details given before paying: still v2. */
    const out = { v: 2, sold: null, held: [], live: !!env.STATS };
    if (placed) out.placed = placed;
    return json(request, env, out);
  }

  const sold = await readSold(env);
  const held = await listHeld(env);
  const now = Date.now();

  /* v: 2 tells the page this worker has /callback, /receipt, /shipping and
     /list; v: 3, that /order also keeps the buyer's details given before
     paying. The page uses none of them until it sees the number. */
  const out = { v: 3, sold, held, at: now, live: !!env.STATS };
  const placed = await readPlaced(env);
  if (placed) out.placed = placed;
  return json(request, env, out, { "Cache-Control": "public, max-age=10" });
}

/* The holds, listed at most once a minute by each running copy of this
   worker. Every open page asks /state once a minute, and a KV listing is
   the one operation Cloudflare's free plan allows only a thousand of a day:
   listed on every ask, a busy morning of ads would spend the day's
   allowance before noon, and the desk's own listing with it. KV itself
   takes up to a minute to agree with itself, so a listing a minute old is
   no less true than a fresh one (and today's page does not read `held` at
   all). /order, the authority on a number, still reads that number's own
   hold directly, and the desk lists its own. */
const HELD_FRESH_MS = 60 * 1000;
let heldSeen = { at: 0, held: [] };
async function listHeld(env) {
  const now = Date.now();
  if (heldSeen.at && now - heldSeen.at >= 0 && now - heldSeen.at < HELD_FRESH_MS) return heldSeen.held.slice();
  const held = [];
  try {
    const list = await env.KAAL_STATE.list({ prefix: HOLD_PREFIX });
    for (const k of list.keys) {
      const n = parseInt(k.name.slice(HOLD_PREFIX.length), 10);
      if (!isNaN(n)) held.push(n);
    }
  } catch (e) { /* a listing that fails is a page with no holds, not an error */ }
  heldSeen = { at: now, held };
  return held.slice();
}

async function postHold(request, env) {
  if (!env.KAAL_STATE) return json(request, env, { ok: false, reason: "no-store" });

  let body;
  try { body = await request.json(); } catch (e) { return json(request, env, { ok: false, reason: "bad-request" }, {}, 400); }

  const n  = parseInt(body && body.n, 10);
  const by = typeof (body && body.by) === "string" ? body.by.slice(0, 64) : "";
  const edition = parseInt(env.EDITION || "20", 10);
  if (isNaN(n) || n < 1 || n > edition) return json(request, env, { ok: false, reason: "out-of-range" }, {}, 400);

  const sold = await readSold(env);
  if (sold && sold.indexOf(n) > -1) return json(request, env, { ok: false, reason: "sold" });

  const key = HOLD_PREFIX + n;
  const existing = await env.KAAL_STATE.get(key, "json").catch(() => null);
  /* Re-holding your own number extends it. Somebody else's does not. */
  if (existing && existing.by && existing.by !== by) return json(request, env, { ok: false, reason: "held" });

  const until = Date.now() + HOLD_SECONDS * 1000;
  await env.KAAL_STATE.put(key, JSON.stringify({ by, until }), { expirationTtl: HOLD_SECONDS });
  return json(request, env, { ok: true, n, until });
}

/* ══════════ 2. WHAT THE BUYER PAYS ══════════ */

/* An order is the only thing that makes a checkout modal real, and it is
   made here rather than in the browser for two reasons that are the same
   reason twice: the browser is not trusted to say what a watch costs, and
   it is not trusted to say which numbers are still for sale. Both answers
   are read from this worker's own configuration and from the edition's
   own state, and the request body contributes exactly one thing — which
   number the buyer is asking for. */
async function postOrder(request, env, ctx) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    console.log("/order called before the Razorpay key pair was set.");
    return json(request, env, { ok: false, reason: "not-configured" }, {}, 503);
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return json(request, env, { ok: false, reason: "bad-request" }, {}, 400); }

  const edition = parseInt(env.EDITION || "20", 10);
  const n  = parseInt(body && body.n, 10);
  const by = typeof (body && body.by) === "string" ? body.by.slice(0, 64) : "";
  /* A gift is a flag and a short note for the card in the box. Both go on
     the order, where they are read at packing time. The note is plain
     text, one line, capped well under Razorpay's 256-character note limit. */
  const gift = !!(body && body.gift === true);
  const giftNote = gift ? cleanNote(body && body.gift_note, 200) : "";
  if (isNaN(n) || n < 1 || n > edition) {
    return json(request, env, { ok: false, reason: "out-of-range" }, {}, 400);
  }
  const buyer = cleanBuyer(body && body.buyer);
  if (buyer === null) return json(request, env, { ok: false, reason: "details" }, {}, 400);

  /* The price is read here and nowhere else. Nothing in the request body
     can reach it, so a hand-rolled POST asking to pay one rupee gets an
     order for ₹5,999 the same as everybody else. */
  const amount = parseInt(env.PRICE_PAISE || "0", 10);
  if (isNaN(amount) || amount < MIN_PAISE) {
    console.log("PRICE_PAISE is missing or below the floor:", String(env.PRICE_PAISE).slice(0, 20));
    return json(request, env, { ok: false, reason: "not-configured" }, {}, 503);
  }

  const sold = await knownSold(env);
  if (sold && sold.indexOf(n) > -1) return json(request, env, { ok: false, reason: "sold" }, {}, 409);

  /* Somebody else's hold stops an order exactly as it stops a hold. Your
     own does not, so reloading the page and trying again still works. */
  if (env.KAAL_STATE) {
    const existing = await env.KAAL_STATE.get(HOLD_PREFIX + n, "json").catch(() => null);
    if (existing && existing.by && existing.by !== by) {
      return json(request, env, { ok: false, reason: "held" }, {}, 409);
    }
  }

  let res, order;
  try {
    res = await fetch(`${RZP_API}/orders`, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, razorpayAuth(env)),
      body: JSON.stringify({
        amount,
        currency: env.CURRENCY || "INR",
        receipt: `kaal-${pad2(n)}-${Date.now().toString(36)}`.slice(0, 40),
        /* THE ONE LINE THE WHOLE CHAIN HANGS FROM. The webhook below
           reads notes.kaal_no to know which number just sold. Rename it
           here and a real sale goes unrecorded in total silence. */
        notes: Object.assign({ kaal_no: pad2(n) },
          gift ? { gift: "yes" } : {},
          giftNote ? { gift_note: giftNote } : {},
          /* What Meta's Conversions API needs to match this purchase to
             the ad that caused it, captured here because the webhook
             arrives from Razorpay and knows nothing about the buyer's
             browser. Only ever read by sendPurchaseToMeta(). */
          metaMatch(request, body))
      })
    });
    order = await res.json();
  } catch (e) {
    console.log("Razorpay order call never completed:", String(e).slice(0, 160));
    return json(request, env, { ok: false, reason: "upstream" }, {}, 500);
  }

  if (res.status === 401 || res.status === 403) {
    console.log("Razorpay rejected the key pair on /order:", res.status);
    return json(request, env, { ok: false, reason: "auth" }, {}, 401);
  }
  if (!res.ok || !order || !order.id) {
    console.log("Razorpay refused the order:", res.status, JSON.stringify(order || {}).slice(0, 300));
    return json(request, env, { ok: false, reason: "upstream" }, {}, 500);
  }

  /* Placing the hold here rather than trusting the page's keepalive call
     means the number is held by the act of being priced, which is the
     closest thing to intent this worker can observe. A failure to hold
     is not a failure to sell: the order is already good.

     held_for goes back to the page only when the hold was actually
     written. The page used to promise one on every closed checkout,
     including from a worker with no KV bound and so nowhere to keep it —
     and a hold that is promised and not real is worse than none. It is a
     duration, not a timestamp, so a buyer's wrong clock cannot misstate it. */
  /* The details given before paying become the delivery address the
     moment the order exists, under the same key the thank-you page's form
     writes, so a buyer who gave them here is never asked again. Kept 90
     days unless the payment lands (notifySale keeps it for good then):
     long enough to help someone finish, not a mailing list. */
  if (buyer && env.KAAL_STATE) {
    try {
      await env.KAAL_STATE.put("ship:" + order.id,
        JSON.stringify(Object.assign({ at: new Date().toISOString(), src: "checkout", buyer: buyer.who }, buyer.parcel)),
        { expirationTtl: LEAD_DAYS * 86400 });
    } catch (e) { console.log("Checkout details not kept:", String(e).slice(0, 120)); }
  }
  /* The visitor's history (section 5c) learns who they are, and which
     order is theirs: `by` is the same device id the page's steps carry. */
  if (env.STATS && /^[a-z0-9]{6,24}$/.test(by)) {
    const link = env.STATS.get(env.STATS.idFromName("kaal")).fetch("https://stats/link", { method: "POST", body: JSON.stringify({
      u: by, o: order.id, n,
      buyer: buyer ? { name: buyer.who.name, phone: buyer.who.phone, email: buyer.who.email,
        city: [buyer.parcel.city, buyer.parcel.state].filter(Boolean).join(", ") } : null
    }) }).catch(e => console.log("History link failed:", String(e).slice(0, 120)));
    if (ctx && ctx.waitUntil) ctx.waitUntil(link); else await link;
  }

  let heldFor = 0;
  if (env.KAAL_STATE) {
    try {
      await env.KAAL_STATE.put(
        HOLD_PREFIX + n,
        JSON.stringify({ by, until: Date.now() + HOLD_SECONDS * 1000 }),
        { expirationTtl: HOLD_SECONDS }
      );
      heldFor = HOLD_SECONDS;
    } catch (e) { console.log("Hold failed after a good order:", String(e).slice(0, 120)); }
  }

  /* key_id travels to the browser on purpose — it is the publishable
     half of the pair and checkout.js cannot open without it. Sending it
     from here instead of writing it into index.html is what keeps any
     Razorpay key out of this repository, which tools/check.mjs enforces
     as a build failure. Swapping test for live is one secret, one place,
     no commit. */
  return json(request, env, {
    ok: true,
    order_id: order.id,
    amount: order.amount,
    currency: order.currency,
    key_id: env.RAZORPAY_KEY_ID,
    n,
    held_for: heldFor,
    details: !!buyer
  });
}

/* A signature is the only thing here that proves a payment happened.
   Razorpay signs order_id|payment_id with the key secret, which only
   this worker and Razorpay hold, so a browser cannot manufacture one.
   Everything this route does afterwards is gated on that check. */
async function postVerify(request, env) {
  if (!env.RAZORPAY_KEY_SECRET) {
    return json(request, env, { ok: false, reason: "not-configured" }, {}, 503);
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return json(request, env, { ok: false, reason: "bad-request" }, {}, 400); }

  const orderId   = body && body.razorpay_order_id;
  const paymentId = body && body.razorpay_payment_id;
  const signature = body && body.razorpay_signature;
  if (!isText(orderId) || !isText(paymentId) || !isText(signature)) {
    return json(request, env, { ok: false, reason: "missing-fields" }, {}, 400);
  }

  const expected = await hmacHex(`${orderId}|${paymentId}`, env.RAZORPAY_KEY_SECRET);
  if (!timingSafeEqual(expected, signature)) {
    console.log("Signature mismatch on /verify for order", String(orderId).slice(0, 40));
    return json(request, env, { ok: false, reason: "signature-mismatch" }, {}, 400);
  }

  /* Verified. Which number was it? The browser is not asked. It would be
     free to name any of the twenty, and a script that named all twenty
     would close the shop with one real ₹5,999 payment. Razorpay is asked
     instead, and it answers with the note this worker wrote itself. */
  const n = (await numberFromOrder(env, orderId)) || 0;

  /* KV only. The webhook still owns the commit that makes index.html
     true on its own, and two writers on one file would be a race for no
     gain. This is the fast half of the same split the webhook describes:
     every other browser stops offering this number within seconds,
     without waiting for GitHub Pages to rebuild. */
  if (n && env.KAAL_STATE) {
    try {
      const sold = (await readSold(env)) || [];
      if (sold.indexOf(n) < 0) sold.push(n);
      await env.KAAL_STATE.put(KEY_SOLD, JSON.stringify(sold.sort((a, b) => a - b)));
      await env.KAAL_STATE.delete(HOLD_PREFIX + n);
    } catch (e) { console.log("KV update after verify failed:", String(e).slice(0, 120)); }
  }

  return json(request, env, { ok: true, n: n || null });
}

/* ══════════ 2b. AFTER THE MONEY ══════════

   A real sale on an iPhone, October 2026: the payment was captured, the
   webhook recorded No. 09, and the buyer never came back to the site. The
   page that opened checkout is the only thing that knew where to send
   them, and a phone that switches to a UPI app is free to throw that page
   away. Nothing told the owner either.

   So the buyer's way home no longer depends on the page surviving:

     callback_url   Razorpay posts the result HERE, server to browser, and
                    this answers with a redirect to the thank-you page.
                    Used by Razorpay wherever its modal cannot hand the
                    result back to the page (in-app browsers, redirects).
     /receipt       the thank-you page, and a page reloaded mid-payment,
                    ask here whether an order is paid. Verified against
                    Razorpay, never against anything the browser says.
     /shipping      the one thing Standard Checkout never collects: where
                    the watch goes. Accepted only for a paid order.

   And the owner and the buyer each get an email for every sale. */

function siteUrl(env) {
  return (env.SITE_URL || (env.ALLOW_ORIGIN || "https://thekaal.co").split(",")[0]).trim().replace(/\/+$/, "");
}

async function postCallback(request, env) {
  const site = siteUrl(env);
  let form;
  try { form = await request.formData(); } catch (e) { form = null; }
  const get = (k) => (form && typeof form.get(k) === "string") ? form.get(k) : "";

  const paymentId = get("razorpay_payment_id");
  const orderId   = get("razorpay_order_id");
  const signature = get("razorpay_signature");

  if (paymentId && orderId && signature && env.RAZORPAY_KEY_SECRET) {
    const expected = await hmacHex(`${orderId}|${paymentId}`, env.RAZORPAY_KEY_SECRET);
    if (timingSafeEqual(expected, signature)) {
      const n = (await numberFromOrder(env, orderId)) || 0;
      if (n && env.KAAL_STATE) {
        try {
          const sold = (await readSold(env)) || [];
          if (sold.indexOf(n) < 0) sold.push(n);
          await env.KAAL_STATE.put(KEY_SOLD, JSON.stringify(sold.sort((a, b) => a - b)));
          await env.KAAL_STATE.delete(HOLD_PREFIX + n);
        } catch (e) { console.log("KV update on callback failed:", String(e).slice(0, 120)); }
      }
      const q = `razorpay_payment_id=${encodeURIComponent(paymentId)}&o=${encodeURIComponent(orderId)}` + (n ? `&n=${pad2(n)}` : "");
      return Response.redirect(`${site}/claimed.html?${q}`, 303);
    }
    console.log("Signature mismatch on /callback for order", String(orderId).slice(0, 40));
  }
  /* A failed or cancelled payment arrives here too, as error[...] fields.
     Nothing was charged; the buyer goes back to the twenty to try again. */
  return Response.redirect(`${site}/?checkout=failed#twenty`, 303);
}

const ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/;

async function paymentsOf(env, orderId) {
  try {
    const res = await fetch(`${RZP_API}/orders/${encodeURIComponent(orderId)}/payments`, { headers: razorpayAuth(env) });
    if (!res.ok) return [];
    const page = await res.json();
    return (page && page.items) || [];
  } catch (e) { return []; }
}

async function getReceipt(request, env, url) {
  const orderId = url.searchParams.get("o") || "";
  if (!ORDER_ID.test(orderId)) return json(request, env, { ok: false, reason: "bad-order" }, { "Cache-Control": "no-store" }, 400);
  const order = await readOrder(env, orderId);
  const n = parseInt(order && order.notes && order.notes.kaal_no, 10);
  if (!order || !n) return json(request, env, { ok: false, reason: "unknown-order" }, { "Cache-Control": "no-store" }, 404);

  const pays = await paymentsOf(env, orderId);
  const good = pays.find(p => p.status === "captured" || p.status === "authorized");
  const paid = order.status === "paid" || !!good;
  let shipping = false;
  if (env.KAAL_STATE) { try { shipping = !!(await env.KAAL_STATE.get("ship:" + orderId)); } catch (e) { shipping = false; } }

  return json(request, env, {
    ok: true, paid, n,
    amount: order.amount, currency: order.currency || "INR",
    payment_id: good ? good.id : null,
    created_at: order.created_at,
    gift: !!(order.notes && order.notes.gift === "yes"),
    shipping,
    /* Only what the receipt page needs to say "a confirmation is on its
       way to ra•••@gmail.com", and only when an email is actually sent. */
    mail: !!(env.RESEND_API_KEY || env.BREVO_API_KEY) && !!(good && good.email),
    email_hint: good && good.email ? maskEmail(good.email) : ""
  }, { "Cache-Control": "no-store" });
}

function cleanField(v, max) { return cleanNote(v, max); }

/* Where a watch goes, cleaned the same way whether it arrives before the
   payment (/order) or after it (/shipping): every line but the landmark,
   a six-digit PIN, a phone of ten digits or more. null when incomplete. */
function cleanAddress(src) {
  const a = {
    name:  cleanField(src && src.name, 80),
    phone: String((src && src.phone) || "").replace(/[^\d+]/g, "").slice(0, 15),
    line1: cleanField(src && src.line1, 120),
    line2: cleanField(src && src.line2, 120),
    city:  cleanField(src && src.city, 60),
    state: cleanField(src && src.state, 40),
    pin:   String((src && src.pin) || "").replace(/\D/g, "").slice(0, 6)
  };
  if (!a.name || !a.line1 || !a.city || !a.state || a.pin.length !== 6 || a.phone.replace(/\D/g, "").length < 10) return null;
  return a;
}

/* The buyer's own details, given before paying (/order, worker v3): who
   they are and where it goes. The parcel's name and phone are the
   recipient's when it is a gift, the buyer's otherwise. undefined when the
   page sent none (an older page), null when what it sent is incomplete. */
function cleanBuyer(src) {
  if (src === undefined || src === null) return undefined;
  if (typeof src !== "object") return null;
  const email = String(src.email || "").trim().toLowerCase().slice(0, 254);
  const who = { name: cleanField(src.name, 80), phone: String(src.phone || "").replace(/[^\d+]/g, "").slice(0, 15), email };
  if (!who.name || who.phone.replace(/\D/g, "").length < 10 || !validEmail(email)) return null;
  const parcel = cleanAddress(Object.assign({}, src, {
    name: src.to_name ? src.to_name : src.name,
    phone: src.to_phone ? src.to_phone : src.phone
  }));
  if (!parcel) return null;
  return { parcel, who };
}

/* "rahul.sharma@gmail.com" → "ra•••@gmail.com": enough for a buyer to
   recognise their own address, not enough to read someone else's. */
function maskEmail(e) {
  const m = /^([^@]+)@(.+)$/.exec(String(e || "").trim());
  if (!m) return "";
  return m[1].slice(0, Math.min(2, m[1].length)) + "\u2022\u2022\u2022@" + m[2];
}

async function postShipping(request, env, ctx) {
  let body;
  try { body = await request.json(); }
  catch (e) { return json(request, env, { ok: false, reason: "bad-request" }, {}, 400); }
  const orderId = String((body && body.o) || "");
  if (!ORDER_ID.test(orderId)) return json(request, env, { ok: false, reason: "bad-order" }, {}, 400);

  const a = cleanAddress(body);
  if (!a) return json(request, env, { ok: false, reason: "incomplete" }, {}, 400);

  const order = await readOrder(env, orderId);
  const n = parseInt(order && order.notes && order.notes.kaal_no, 10);
  if (!order || !n) return json(request, env, { ok: false, reason: "unknown-order" }, {}, 404);
  const pays = await paymentsOf(env, orderId);
  const good = pays.find(p => p.status === "captured" || p.status === "authorized");
  if (order.status !== "paid" && !good) return json(request, env, { ok: false, reason: "not-paid" }, {}, 409);

  let updated = false;
  if (env.KAAL_STATE) {
    try {
      updated = !!(await env.KAAL_STATE.get("ship:" + orderId));
      await env.KAAL_STATE.put("ship:" + orderId, JSON.stringify(Object.assign({ at: new Date().toISOString() }, a)));
    } catch (e) { console.log("Shipping KV write failed:", String(e).slice(0, 120)); }
  }

  const buyerEmail = good && good.email && validEmail(String(good.email).toLowerCase()) ? String(good.email) : "";
  const paidAt = good && good.created_at ? new Date(good.created_at * 1000) : new Date();
  const d = {
    site: siteUrl(env), n, dial: DIAL_OF(env, n), address: a, updated, orderId,
    paymentId: good ? good.id : "", buyerEmail, arriveBy: arriveBy(paidAt),
    gift: !!(order.notes && order.notes.gift === "yes"), giftNote: (order.notes && order.notes.gift_note) || ""
  };
  const toOwner = ownerShip(d), toBuyer = buyerShip(d);
  const mail = Promise.all([
    sendEmail(env, ownerInbox(env), toOwner.subject, toOwner.text, toOwner.html, buyerEmail || undefined),
    buyerEmail ? sendEmail(env, buyerEmail, toBuyer.subject, toBuyer.text, toBuyer.html) : null
  ]).catch(e => console.log("Shipping emails threw:", String(e).slice(0, 160)));
  if (ctx && ctx.waitUntil) ctx.waitUntil(mail); else await mail;
  return json(request, env, { ok: true, updated });
}

/* One email to the owner and one to the buyer, for every captured payment,
   once. Sent through the same provider as the rest (Resend or Brevo). With
   no provider key it logs and returns: a sale is never held up by mail.
   The words and the look live in worker/mail.js. */
async function notifySale(env, entity, chosen, short) {
  try {
    if (!env.RESEND_API_KEY && !env.BREVO_API_KEY) { console.log("Sale emails skipped: no RESEND_API_KEY or BREVO_API_KEY."); return; }
    const paymentId = String(entity.id || "");
    if (env.KAAL_STATE) {
      const key = "mailed:" + paymentId;
      if (await env.KAAL_STATE.get(key).catch(() => null)) return;
      await env.KAAL_STATE.put(key, "1", { expirationTtl: 90 * 24 * 3600 });
    }
    const edition = parseInt(env.EDITION || "20", 10);
    const known = Number.isInteger(chosen) && chosen >= 1 && chosen <= edition;
    const site = siteUrl(env);
    const order = entity.order_id ? await readOrder(env, entity.order_id) : null;
    const notes = (order && order.notes) || entity.notes || {};
    const sold = new Set((await knownSold(env)) || []);
    if (known) sold.add(chosen);
    let address = null;
    if (env.KAAL_STATE && entity.order_id) {
      try { address = JSON.parse((await env.KAAL_STATE.get("ship:" + entity.order_id)) || "null"); } catch (e) { address = null; }
      /* Given before paying, it was kept for 90 days in case the payment
         never came. It came: keep it for good, the same write without the
         expiry. */
      if (address && address.src === "checkout") {
        try { await env.KAAL_STATE.put("ship:" + entity.order_id, JSON.stringify(address)); } catch (e) { /* the copy in the emails remains */ }
      }
    }
    const paidAt = entity.created_at ? new Date(entity.created_at * 1000) : new Date();
    const buyer = String(entity.email || "").trim();
    const buyerOk = buyer && validEmail(buyer.toLowerCase());
    const d = {
      site, n: known ? chosen : 0, dial: known ? DIAL_OF(env, chosen) : "",
      amount: `₹${((entity.amount || 0) / 100).toLocaleString("en-IN")}`,
      paymentId, orderId: entity.order_id || "",
      email: buyerOk ? buyer : "", contact: String(entity.contact || ""),
      buyerName: (address && address.buyer && address.buyer.name) || "",
      first: firstNameOf(address && address.buyer && address.buyer.name),
      short: short ? { claimed: short.claimed, price: rupees(parseInt(env.PRICE_PAISE || "0", 10)) } : null,
      gift: notes.gift === "yes", giftNote: notes.gift_note || "",
      when: indiaTime(paidAt), arriveBy: arriveBy(paidAt),
      left: Math.max(0, edition - sold.size), edition,
      address, hasAddress: !!address,
      shipUrl: entity.order_id ? `${site}/claimed.html?o=${encodeURIComponent(entity.order_id)}&n=${known ? pad2(chosen) : ""}#ship` : `${site}/claimed.html`
    };

    const sends = [];
    /* ORDER_ALERT = "off" leaves the owner only the daily report; a payment
       whose number cannot be read is told to the owner regardless. */
    if (env.ORDER_ALERT !== "off" || !known) {
      const owner = ownerSale(d);
      sends.push(sendEmail(env, ownerInbox(env), owner.subject, owner.text, owner.html, buyerOk ? buyer : undefined));
    }
    if (buyerOk && known) {
      const mine = buyerConfirmation(d);
      sends.push(sendEmail(env, buyer, mine.subject, mine.text, mine.html));
    }
    await Promise.all(sends);
  } catch (e) { console.log("Sale emails threw:", String(e).slice(0, 160)); }
}

/* Where the owner's emails go. A secret, not a var, so a personal inbox
   never appears in the public repository; several may be given, separated
   by commas. Without it, the shop's own address. */
function ownerInbox(env) {
  const list = String(env.OWNER_EMAIL || "connect@thekaal.co").split(",").map(x => x.trim()).filter(x => validEmail(x.toLowerCase()));
  return list.length ? list : ["connect@thekaal.co"];
}

/* The dial a number carries. The page's config is the source of truth;
   DIALS in wrangler.toml mirrors it for the emails, and an unknown number
   simply gets no dial name rather than a wrong one. */
function DIAL_OF(env, n) {
  try {
    const map = JSON.parse(env.DIALS || "{}");
    return map[String(n)] || "";
  } catch (e) { return ""; }
}

/* ══════════ 3. WHAT RAZORPAY SAYS ══════════ */

async function webhook(request, env, ctx) {
  const rawBody   = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";

  const valid = await verifySignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
  if (!valid) return new Response("Signature mismatch.", { status: 400 });
  /* For the desk's health list: when Razorpay last reached this worker. */
  if (env.KAAL_STATE) {
    const seen = env.KAAL_STATE.put("seen:webhook", new Date().toISOString()).catch(() => null);
    if (ctx && ctx.waitUntil) ctx.waitUntil(seen); else await seen;
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch (e) { return new Response("Bad JSON.", { status: 400 }); }

  /* A refund, the moment Razorpay processes it, if the webhook is
     subscribed to refund.processed. Without that subscription the cron
     finds the same refund within half an hour; either way it is recorded
     and told once (section 7). */
  if (event.event === "refund.processed") {
    const p = event.payload || {};
    const job = recordRefund(env, p.refund && p.refund.entity, p.payment && p.payment.entity)
      .catch(e => console.log("Refund webhook threw:", String(e).slice(0, 160)));
    if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
    return new Response("Refund noted.", { status: 200 });
  }

  if (event.event !== "payment.captured") {
    return new Response("Ignored: " + String(event.event).slice(0, 60), { status: 200 });
  }

  const entity    = (event.payload && event.payload.payment && event.payload.payment.entity) || {};
  const notes     = entity.notes || {};
  const paymentId = entity.id || "unknown";
  const raw       = notes.kaal_no;
  let   chosen    = NaN;

  /* WHICH NUMBER, from the hand that can be trusted. Notes on the PAYMENT
     are the payer's own: Standard Checkout puts them there from the
     browser, the old hosted Payment Page from a field the buyer fills in.
     /order wrote kaal_no onto the ORDER, where no browser can reach, so
     whenever the payment belongs to an order this worker priced, the
     order says which number it was. The payment's note is only a fallback
     for a payment with no readable order (the old Payment Page). */
  let order = null;
  if (entity.order_id) {
    order = await readOrder(env, entity.order_id);
    chosen = parseInt(order && order.notes && order.notes.kaal_no, 10);
  }
  if (isNaN(chosen)) chosen = parseInt(raw, 10);

  /* AND WHAT WAS PAID, before any of it is believed. Razorpay sends this
     webhook for every captured payment on the account, whatever made it.
     Without this, one rupee paid anywhere on the account with "kaal_no: 7"
     in its notes would strike No. 07 off the live site and email a
     stranger "No. 07 is yours". A sale needs the full price, in the
     shop's currency; anything less reaches the owner as a payment to
     look at, and is never recorded as a sale. */
  const price = parseInt(env.PRICE_PAISE || "0", 10);
  const currency = String(env.CURRENCY || "INR").toUpperCase();
  /* Without a price to compare (PRICE_PAISE is in wrangler.toml, and
     tools/check.mjs fails the build if it disagrees with the page), a real
     sale must still be recorded: say so loudly and fall back to the check
     this worker made before. */
  const priced = price >= MIN_PAISE;
  if (!priced) console.log("PRICE_PAISE is not set: the amount of this payment could not be checked.");
  const paidInFull = !priced || ((entity.amount || 0) >= price &&
    String(entity.currency || "INR").toUpperCase() === currency &&
    !(order && (order.amount || 0) < price));
  let short = null;
  if (!paidInFull) {
    short = { claimed: isNaN(chosen) ? 0 : chosen };
    console.log(`payment.captured below the price (${entity.amount} ${entity.currency}): not a sale.`);
    chosen = NaN;
  }

  /* The upper bound is read from the file itself rather than written
     here. The old `chosen > 20` was a second copy of `edition`, and the
     day the edition changes is exactly the day nobody would think to
     look in a worker for the reason a real sale went unrecorded. */
  /* The emails go now, beside the commit rather than after it. Writing
     the sale to GitHub takes seconds, and a buyer refreshing their inbox
     should not wait on it; nor should a retry that finds the sale already
     recorded skip them. notifySale sends each payment's pair once (KV),
     and a payment with no usable number still reaches the owner. */
  const mail = notifySale(env, entity, chosen, short);
  if (ctx && ctx.waitUntil) ctx.waitUntil(mail);

  if (short) {
    if (!(ctx && ctx.waitUntil)) await mail;
    return new Response("Captured, but not the price: not recorded as a sale.", { status: 200 });
  }

  const commit = await commitSold(env, chosen, paymentId);

  if (commit.status === "bad-number") {
    console.log("payment.captured with no usable kaal_no:", String(raw).slice(0, 40));
    return new Response("Captured but no valid kaal_no — check manually.", { status: 200 });
  }
  if (commit.status === "already") return new Response(`Number ${chosen} already recorded as sold.`, { status: 200 });
  if (commit.status === "error")   return new Response("Could not record the sale — see worker logs.", { status: 502 });

  /* KV is what the live page reads within seconds; the commit is what
     makes the static file true on its own. Both, in that order, because
     the one that is fast should not wait on the one that is durable. */
  if (env.KAAL_STATE) {
    try {
      const sold = (await readSold(env)) || [];
      if (sold.indexOf(chosen) < 0) sold.push(chosen);
      await env.KAAL_STATE.put(KEY_SOLD, JSON.stringify(sold.sort((a, b) => a - b)));
      await env.KAAL_STATE.delete(HOLD_PREFIX + chosen);
    } catch (e) { console.log("KV update failed after a successful commit:", String(e).slice(0, 120)); }
  }

  console.log(`Number ${chosen} marked sold. GitHub Pages will rebuild shortly.`);
  liveTell(env, ctx, { e: "paid", no: pad2(chosen), dial: DIAL_OF(env, chosen), paise: entity.amount || 0, o: entity.order_id || "" });
  await sendPurchaseToMeta(env, entity, chosen);
  if (!(ctx && ctx.waitUntil)) await mail;
  return new Response(`OK — number ${chosen} recorded as sold.`, { status: 200 });
}

/* Read, modify, write — and mean it. Two webhooks landing together both
   read the same blob sha, and the second PUT is rejected with a 409. The
   old build returned 502 and left it to Razorpay's retry schedule, which
   is minutes. Three attempts here closes it in milliseconds.

   One routine for every change to the `sold` line: a sale adds a number
   (commitSold), and the owner's "back on sale" after a refund takes one
   away (releaseSold). `change` reads the current list and the edition and
   returns either { next } or a { status } that ends it without writing. */
async function rewriteSold(env, change, message) {
  const owner  = env.GITHUB_OWNER, repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const api    = `https://api.github.com/repos/${owner}/${repo}/contents/index.html`;
  const headers = {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "kaal-edition-worker"
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const getRes = await fetch(`${api}?ref=${branch}`, { headers });
    if (!getRes.ok) {
      console.log("GitHub GET failed:", getRes.status, (await getRes.text()).slice(0, 300));
      return { status: "error" };
    }
    const file = await getRes.json();
    const decoded = atob(file.content.replace(/\n/g, ""));

    const editionMatch = decoded.match(/edition:\s*(\d+)/);
    const edition = editionMatch ? parseInt(editionMatch[1], 10) : 20;

    const soldPattern = /sold:\s*\[([^\]]*)\]/;
    const match = decoded.match(soldPattern);
    if (!match) {
      console.log("Could not find `sold:` array — has index.html's config shape changed?");
      return { status: "error" };
    }

    const current = match[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    const step = change(current, edition);
    if (step.status) return step;

    const putRes = await fetch(api, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify({
        message,
        content: btoa(decoded.replace(soldPattern, `sold:     [${step.next.join(", ")}]`)),
        sha: file.sha,
        branch
      })
    });

    if (putRes.ok) return { status: "ok" };
    if (putRes.status === 409) continue;        /* somebody else committed first: re-read and retry */

    console.log("GitHub PUT failed:", putRes.status, (await putRes.text()).slice(0, 300));
    return { status: "error" };
  }
  console.log("GitHub PUT conflicted three times running.");
  return { status: "error" };
}

async function commitSold(env, chosen, paymentId) {
  return rewriteSold(env, (current, edition) => {
    if (!chosen || isNaN(chosen) || chosen < 1 || chosen > edition) return { status: "bad-number" };
    if (current.indexOf(chosen) > -1) return { status: "already" };
    return { next: current.concat([chosen]).sort((a, b) => a - b) };
  }, `Auto: mark number ${chosen} sold (payment ${paymentId})`);
}

/* The other direction, and only ever on the owner's tap on the desk after
   a full refund. KV follows, so /order and the live page agree at once. */
async function releaseSold(env, n, why) {
  const r = await rewriteSold(env, (current) => current.indexOf(n) < 0 ? { status: "already" } : { next: current.filter(x => x !== n) },
    `Auto: number ${n} back on sale (${why})`);
  if ((r.status === "ok" || r.status === "already") && env.KAAL_STATE) {
    try {
      const kv = (await readSold(env)) || [];
      await env.KAAL_STATE.put(KEY_SOLD, JSON.stringify(kv.filter(x => x !== n)));
    } catch (e) { console.log("KV sold not updated after a release:", String(e).slice(0, 120)); }
  }
  return r;
}

/* ══════════ 3c. THE SERIES 02 LIST ══════════

   One field on the page and one key here. The address is stored under the
   SHA-256 of itself, so adding the same person twice changes nothing, with
   the moment it arrived and which form it came from — and nothing else:
   no name, no IP, no cookie. The page promises "One note while Series 01
   is still open, and one email when Series 02 is drawn. Nothing else." The
   note is section 3e's; this route keeps nothing that could be used for
   anything else.

   Read it out when Series 02 is drawn:
     wrangler kv key list --binding KAAL_STATE --prefix list:

   Rate limited per connection, by a salted hash of the IP that expires
   with the window, so the limit itself stores no address. KV is eventually
   consistent, which makes this a speed bump rather than a wall — enough to
   stop a form being hammered, which is all a list of interested people
   needs. A hidden field the page never fills catches the bots that fill
   every field they find: they are told it worked and nothing is stored. */
const LIST_PREFIX = "list:";
const RL_PREFIX   = "rl:list:";
const RL_MAX      = 5;
const RL_SECONDS  = 3600;

async function postList(request, env) {
  if (!env.KAAL_STATE) return json(request, env, { ok: false, reason: "no-store" }, {}, 503);

  let body;
  try { body = await request.json(); }
  catch (e) { return json(request, env, { ok: false, reason: "bad-request" }, {}, 400); }

  if (body && typeof body.website === "string" && body.website.trim()) {
    return json(request, env, { ok: true });               /* the honeypot: pretend, keep nothing */
  }

  const email = typeof (body && body.email) === "string" ? body.email.trim().toLowerCase() : "";
  if (!validEmail(email)) return json(request, env, { ok: false, reason: "invalid" }, {}, 400);
  const source = String((body && body.source) || "").replace(/[^a-z0-9-]/gi, "").slice(0, 24);

  const ip  = request.headers.get("cf-connecting-ip") || "unknown";
  const rl  = RL_PREFIX + (await sha256hex(`${ip}|${env.LIST_SALT || "kaal-series-02"}`)).slice(0, 32);
  const hits = parseInt((await env.KAAL_STATE.get(rl).catch(() => null)) || "0", 10) || 0;
  if (hits >= RL_MAX) return json(request, env, { ok: false, reason: "rate" }, {}, 429);
  await env.KAAL_STATE.put(rl, String(hits + 1), { expirationTtl: RL_SECONDS });

  const key = LIST_PREFIX + (await sha256hex(email));
  const existing = await env.KAAL_STATE.get(key).catch(() => null);
  if (!existing) {
    await env.KAAL_STATE.put(key, JSON.stringify({ email, at: new Date().toISOString(), source }));
  }
  return json(request, env, { ok: true });
}

/* Deliberately plain: something@something.tld, no spaces, no control
   characters, inside the 254 the standard allows. The browser has already
   asked the visitor to fix anything worse; this is the server not trusting
   that it did. */
function validEmail(v) {
  if (typeof v !== "string" || v.length < 6 || v.length > 254) return false;
  if (/[\u0000-\u001f\u007f\s]/.test(v)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(v) && !/\.\./.test(v);
}

/* ══════════ 3d. THE REGISTER ══════════

   Where and when a number went — "Delhi · Sep 2026" — shown under it on
   the page ONLY when the owner has added it, and the owner adds it only
   with the buyer's consent. Nothing here ever writes it. It lives in KV
   under `placed`, or as a PLACED variable in wrangler.toml:

     wrangler kv key put --binding KAAL_STATE placed '{"1":"Delhi · Sep 2026"}'

   Cleaned on the way out: numbers inside the edition, plain one-line
   text, forty characters at most. */
async function readPlaced(env) {
  let raw = null;
  if (env.KAAL_STATE) { try { raw = await env.KAAL_STATE.get("placed", "json"); } catch (e) { raw = null; } }
  if (!raw && env.PLACED) { try { raw = JSON.parse(env.PLACED); } catch (e) { raw = null; } }
  if (!raw || typeof raw !== "object") return null;
  const edition = parseInt(env.EDITION || "20", 10), out = {};
  for (const k of Object.keys(raw)) {
    const n = parseInt(k, 10);
    if (n >= 1 && n <= edition && typeof raw[k] === "string" && raw[k].trim()) out[n] = cleanNote(raw[k], 40);
  }
  return Object.keys(out).length ? out : null;
}

/* ══════════ 3e. THE EMAILS NOBODY PRESSES SEND ON ══════════

   Five of them, each switched on by its own line in wrangler.toml ("on" is
   the only value that sends), each once per person or once per order,
   ever. Run on the thirty-minute cron. The words are in mail.js; this
   decides who gets which, and when. docs/email.md has the table.

     ABANDON_EMAIL   the nearly-bought note: a checkout at least three hours
                     and at most ABANDON_LOOKBACK_DAYS (default 30) old that
                     never became a payment, to the email typed into our own
                     details step (ship:<order>) or the one Razorpay holds.
                     Once per PERSON (nearly:<hash>), whichever number and
                     however many tries. Their number still open: it says so,
                     unless someone is paying for it this minute, when it
                     waits for the next run, because "still unclaimed" has to
                     be true when it lands. Sold since: it says so, with the
                     same dial's open numbers. No number: the count.
     SERIES02_EMAIL  the one note to the Series 02 list, a day after joining,
                     while Series 01 has a piece left. Never to anyone who
                     had the nearly-bought note, or whose own checkout is
                     still in that note's window (s02note:<hash>).
     ARRIVAL_EMAIL   "Has No. 07 arrived?", the day after its arrive-by date
                     and at least two days after dispatch (after1:<order>)
     SETTLED_EMAIL   "No. 07 is yours for good", ten days after dispatch and
                     never before seven days past the arrive-by date, if
                     nothing was refunded (after2:<order>)
     YEAR_EMAIL      "One year with No. 07", a year after dispatch (after3:)

   The rules every one of them keeps:
   - Only between 10:00 and 20:00 in India.
   - At most ten per run and ninety a day, all five together (the count is
     sent:<India day>), so with the order emails the shop stays inside
     Resend's free hundred a day. Every attempt counts.
   - Never to anyone who replied "stop" (stop:<hash>, set on the desk).
   - The two before a purchase never go to anyone who has paid for any
     piece: a payment captured, authorized or refunded under that email in
     the last PAID_DAYS, or the email given before paying for one.
   - The three after it are not sent late: a note about arriving goes
     within a week of the arrive-by date or not at all, so switching one on
     never sends a stale backlog. A gift's buyer is not its wearer, so the
     two that speak of wearing it are not sent for a gift.
   - The once-key is written BEFORE the send: once means once, even if the
     send fails. */
const ABANDON_AFTER   = 3 * 3600;
const FOLLOW_RUN_MAX  = 10;
const FOLLOW_DAY_MAX  = 90;
const PAID_DAYS       = 400;
const S02_AFTER       = 24 * 3600;
const ONCE_TTL        = 3 * 365 * 24 * 3600;

function nearlyWhen(tsSec, nowMs) {
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const a = new Date(tsSec * 1000 + IST_MS), b = new Date(nowMs + IST_MS);
  const days = Math.round((Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) / 86400000);
  if (days <= 0) return "Earlier today";
  if (days === 1) return "Yesterday";
  if (days <= 6) return "On " + DAYS[a.getUTCDay()];
  if (days <= 13) return "Last week";
  return "A few weeks ago";
}
/* The first word of the name they gave, in title case ("mary-jane" is
   "Mary-Jane"); nothing when it is missing, a single letter, or holds a
   digit or an @, and the email says "Hello," instead. */
function firstNameOf(full) {
  const f = String(full || "").trim().split(/\s+/)[0] || "";
  if (f.length < 2 || /[@\d]/.test(f)) return "";
  return f.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}
/* One record per person: the same hash of their email names every key
   kept about them here. */
const personHash = async (email) => (await sha256hex(String(email).trim().toLowerCase())).slice(0, 32);
const nearlyKey = async (email) => "nearly:" + (await personHash(email));
const stopKey = async (email) => "stop:" + (await personHash(email));

async function followUps(env) {
  const want = { nearly: env.ABANDON_EMAIL === "on", s02: env.SERIES02_EMAIL === "on",
    after1: env.ARRIVAL_EMAIL === "on", after2: env.SETTLED_EMAIL === "on", after3: env.YEAR_EMAIL === "on" };
  if (!Object.values(want).some(Boolean)) return;
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.KAAL_STATE) {
    console.log("Follow-up emails are on, but the Razorpay keys or the KV namespace are missing.");
    return;
  }
  if (!env.RESEND_API_KEY && !env.BREVO_API_KEY) {
    console.log("Follow-up emails are on, but neither RESEND_API_KEY nor BREVO_API_KEY is set.");
    return;
  }
  const nowMs = Date.now();
  const istHour = new Date(nowMs + IST_MS).getUTCHours();
  if (istHour < 10 || istHour >= 20) return;

  const now = Math.floor(nowMs / 1000);
  const payments = await listPayments(env, now - PAID_DAYS * 86400, now, 2000);
  if (!payments) return;
  const countKey = "sent:" + istDay(nowMs);
  const count = (await env.KAAL_STATE.get(countKey, "json").catch(() => null)) || {};
  const R = { env, nowMs, now, payments, count, run: 0, written: new Set(), site: siteUrl(env),
    edition: parseInt(env.EDITION || "20", 10), paid: await paidEmails(env, payments) };
  try {
    if (want.nearly) await nearlyRound(R);
    if (want.s02) await seriesTwoRound(R);
    if (want.after1 || want.after2 || want.after3) await afterRound(R, want);
  } catch (e) { console.log("Follow-up emails threw:", String(e).slice(0, 160)); }
  if (R.run) {
    await env.KAAL_STATE.put(countKey, JSON.stringify(count), { expirationTtl: 40 * 86400 }).catch(() => null);
    console.log(`Follow-up emails sent: ${R.run}; ${count.total} today.`);
  }
}

const room = (R) => R.run < FOLLOW_RUN_MAX && (R.count.total || 0) < FOLLOW_DAY_MAX;
const stopped = async (env, email) => !!(await env.KAAL_STATE.get(await stopKey(email)).catch(() => null));
async function heldNow(env, n) {
  const h = await env.KAAL_STATE.get(HOLD_PREFIX + n, "json").catch(() => null);
  return !!(h && h.until > Date.now());
}
/* What the counts in an email are read from. Unknown is a reason not to
   write, never a reason to write "twenty are left". */
async function soldFor(R) {
  if (R.sold === undefined) R.sold = await knownSold(R.env);
  return R.sold;
}
/* Every checkout in the nearly-bought window that never became a payment,
   newest first, read once a run. */
async function checkoutsFor(R) {
  if (!R.checkouts) {
    const days = Math.max(1, parseInt(R.env.ABANDON_LOOKBACK_DAYS || "30", 10) || 30);
    R.checkouts = await unfinishedBetween(R.env, R.payments, R.now - days * 86400, R.now);
  }
  return R.checkouts;
}
/* Everyone who has paid for a piece: the email Razorpay took, and the one
   typed into our details step for the same order, which can differ. */
async function paidEmails(env, payments) {
  const out = new Set(), orders = new Set();
  for (const p of payments) {
    if (p.status !== "captured" && p.status !== "authorized" && p.status !== "refunded") continue;
    if (p.email) out.add(String(p.email).trim().toLowerCase());
    if (p.order_id) orders.add(p.order_id);
  }
  for (const o of orders) {
    const given = await env.KAAL_STATE.get("ship:" + o, "json").catch(() => null);
    if (given && given.buyer && given.buyer.email) out.add(String(given.buyer.email).trim().toLowerCase());
  }
  return out;
}
async function followSend(R, kind, email, mail, once, record) {
  await R.env.KAAL_STATE.put(once, JSON.stringify(Object.assign({ at: indiaTime(new Date(R.nowMs)), subject: mail.subject }, record)),
    { expirationTtl: ONCE_TTL });
  R.run++;
  R.count.total = (R.count.total || 0) + 1;
  R.count[kind] = (R.count[kind] || 0) + 1;
  R.written.add(email);
  return sendEmail(R.env, email, mail.subject, mail.text, mail.html, undefined, mail.headers);
}

async function nearlyRound(R) {
  const { env, nowMs } = R;
  const sold = await soldFor(R);
  if (!sold) { console.log("Nearly-bought: the sold list could not be read, so nothing was sent."); return; }
  const left = Math.max(0, R.edition - sold.length);
  if (!left) return;

  /* Each person's newest checkout. One still under three hours old means
     they are still trying, or only just stopped: not yet. */
  const latest = new Map();
  for (const u of await checkoutsFor(R)) {
    const email = String(u.email || "").trim().toLowerCase();
    if (!validEmail(email) || R.paid.has(email)) continue;
    if (!latest.has(email)) latest.set(email, u);
  }
  for (const [email, u] of latest) {
    if (!room(R)) return;
    if (u.ts > R.now - ABANDON_AFTER) continue;
    const once = await nearlyKey(email);
    if (await env.KAAL_STATE.get(once).catch(() => null)) continue;
    if (await stopped(env, email)) continue;

    const n = u.n >= 1 && u.n <= R.edition ? u.n : 0;
    const dial = n ? DIAL_OF(env, n) : "";
    const open = !!n && sold.indexOf(n) === -1;
    const same = [];
    if (open) {
      if (await heldNow(env, n)) continue;                 // someone is paying for it now; next run
    } else if (n && dial) {
      const pool = [];
      for (let k = 1; k <= R.edition; k++) if (k !== n && DIAL_OF(env, k) === dial && sold.indexOf(k) === -1) pool.push(k);
      for (const k of pool) if (!(await heldNow(env, k))) same.push(k);
      if (pool.length && !same.length) continue;           // the dial's last open numbers are being paid for; next run
    }
    const mail = buyerNearlyBought({ site: R.site, first: firstNameOf(u.name), when: nearlyWhen(u.ts, nowMs),
      n, open, dial, sold: sold.length, left, sameDial: same });
    await followSend(R, "nearly", email, mail, once, { n, order: u.orderId });
  }
}

async function seriesTwoRound(R) {
  const { env } = R;
  if (!room(R)) return;
  const sold = await soldFor(R);
  if (!sold) return;
  const left = Math.max(0, R.edition - sold.length);
  if (!left) return;
  const trying = new Set((await checkoutsFor(R)).map(u => String(u.email || "").trim().toLowerCase()).filter(Boolean));
  let cursor;
  do {
    const page = await env.KAAL_STATE.list({ prefix: LIST_PREFIX, cursor });
    for (const k of page.keys || []) {
      if (!room(R)) return;
      /* list:<sha-256 of the email>, so its first 32 are the person's hash. */
      const once = "s02note:" + k.name.slice(LIST_PREFIX.length, LIST_PREFIX.length + 32);
      if (await env.KAAL_STATE.get(once).catch(() => null)) continue;
      const v = await env.KAAL_STATE.get(k.name, "json").catch(() => null);
      const email = String((v && v.email) || "").trim().toLowerCase();
      const joined = v && Date.parse(v.at) / 1000;
      if (!validEmail(email) || !(joined <= R.now - S02_AFTER)) continue;
      if (R.paid.has(email) || trying.has(email) || R.written.has(email)) continue;
      if (await env.KAAL_STATE.get(await nearlyKey(email)).catch(() => null)) continue;
      if (await stopped(env, email)) continue;
      await followSend(R, "s02", email, seriesTwoNote({ site: R.site, left }), once, { source: (v && v.source) || "" });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

/* "2 Oct 2027", in India. */
function longDate(ms) {
  const d = new Date(ms + IST_MS);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const dayPlus = (day, k) => new Date(Date.parse(day + "T12:00:00Z") + k * 86400000).toISOString().slice(0, 10);

async function afterRound(R, want) {
  const { env } = R;
  const today = istDay(R.nowMs);
  let lookups = 0;
  const paid = R.payments.filter(p => (p.status === "captured" || p.status === "authorized") && p.order_id && p.email)
    .sort((a, b) => a.created_at - b.created_at);
  for (const p of paid) {
    if (!room(R)) return;
    const sent = await env.KAAL_STATE.get("sent:" + p.order_id, "json").catch(() => null);
    const out = sent && Date.parse(sent.at);
    if (!out) continue;                                     // not dispatched
    const email = String(p.email).trim().toLowerCase();
    if (!validEmail(email)) continue;
    const since = (R.nowMs - out) / 86400000;
    const due = arriveByDay(new Date(p.created_at * 1000));
    const gift = (p.notes || {}).gift === "yes";
    const kinds = [];
    if (want.after1 && today > due && today <= dayPlus(due, 7) && since >= 2) kinds.push(["after1", afterArrival]);
    if (want.after2 && !gift && !(p.amount_refunded > 0) && since >= 10 && since < 30 && today > dayPlus(due, 7)) kinds.push(["after2", afterSettled]);
    if (want.after3 && !gift && since >= 365 && since < 395) kinds.push(["after3", afterYear]);
    if (!kinds.length || await stopped(env, email)) continue;

    let n = parseInt((p.notes || {}).kaal_no, 10);
    if (!n && lookups < 5) { lookups++; n = await numberFromOrder(env, p.order_id); }
    if (!(n >= 1 && n <= R.edition)) continue;
    const given = await env.KAAL_STATE.get("ship:" + p.order_id, "json").catch(() => null);
    const first = firstNameOf(given && given.buyer && given.buyer.name);
    for (const [kind, make] of kinds) {
      const once = kind + ":" + p.order_id;
      if (await env.KAAL_STATE.get(once).catch(() => null)) continue;
      const end = new Date(out); end.setUTCFullYear(end.getUTCFullYear() + 2);      // twenty four months from dispatch
      const mail = make({ site: R.site, n, first, until: longDate(end.getTime()) });
      await followSend(R, kind, email, mail, once, { n });
      break;                                                // one note per owner per run
    }
  }
}

async function listPayments(env, from, to, max = 500) {
  const out = [];
  try {
    for (let skip = 0; skip < max; skip += 100) {
      const res = await fetch(`${RZP_API}/payments?from=${from}&to=${to}&count=100&skip=${skip}`, { headers: razorpayAuth(env) });
      if (!res.ok) { console.log("Payment listing failed:", res.status); return null; }
      const page = await res.json();
      const items = (page && page.items) || [];
      out.push(...items);
      if (items.length < 100) break;
    }
  } catch (e) {
    console.log("Payment listing threw:", String(e).slice(0, 120));
    return null;
  }
  return out;
}

/* Resend if its key is set, Brevo if that one is. Plain text only, from
   ABANDON_FROM, replies to connect@thekaal.co unless ABANDON_REPLY_TO says
   otherwise. A refused send is logged and never retried. `headers` are
   extra mail headers (List-Unsubscribe on the emails nobody asked for);
   both providers take them as they are. */
async function sendEmail(env, to, subject, text, html, replyToOverride, headers) {
  const from    = env.MAIL_FROM || env.ABANDON_FROM || "KAAL <connect@thekaal.co>";
  const replyTo = replyToOverride || env.MAIL_REPLY_TO || env.ABANDON_REPLY_TO || "connect@thekaal.co";
  const list    = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return false;
  try {
    let res;
    if (env.RESEND_API_KEY) {
      const msg = { from, to: list, subject, text, reply_to: replyTo };
      if (html) msg.html = html;
      if (headers) msg.headers = headers;
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(msg)
      });
    } else {
      const m = /^(.*?)\s*<([^>]+)>$/.exec(from);
      const msg = {
        sender: m ? { name: m[1] || "KAAL", email: m[2] } : { name: "KAAL", email: from },
        to: list.map(email => ({ email })), subject, textContent: text, replyTo: { email: replyTo }
      };
      if (html) msg.htmlContent = html;
      if (headers) msg.headers = headers;
      res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(msg)
      });
    }
    if (!res.ok) { console.log("Email provider refused:", res.status, (await res.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) {
    console.log("Email send threw:", String(e).slice(0, 120));
    return false;
  }
}

/* ══════════ 5. THE DAILY COUNT, AND THE MORNING REPORT ══════════

   The page counts what visitors do in memory and sends the totals once,
   when the page is hidden: one small request per visit, carrying numbers
   and nothing else. No cookie, no identifier, no IP is kept (the live view,
   5b below, keeps a one-visit tag for an hour and no more); "visitor" is
   the browser saying "first visit today", decided on the device. The
   totals live in one Durable Object, keyed by the day in India, because
   KV's free allowance (1,000 writes a day) is a busy morning of ads.

   Once a day, in the hour DIGEST_HOUR_IST (just after midnight by default),
   the cron sends the owner the day that has just ended, in one email: the counts, Razorpay's orders and
   unfinished checkouts, new Series 02 leads, what is left of the edition,
   and the last seven days. DIGEST = "off" stops it. ─────────────────── */

const IST_MS = 5.5 * 3600 * 1000;
const COUNTED = new Set(["visit", "visitor", "hero", "hero_complete", "early_dial", "ctx_cta", "view", "dial",
  "number", "caseback_view", "gift", "checkout", "details", "list", "film", "provenance_click", "deeplink"]);

/* "2026-10-06": the calendar day in India for a moment in time. */
function istDay(ms) { return new Date(ms + IST_MS).toISOString().slice(0, 10); }
/* [from, to) in unix seconds for one day in India. */
function istWindow(day) {
  const start = Date.parse(day + "T00:00:00Z") - IST_MS;
  return [Math.floor(start / 1000), Math.floor(start / 1000) + 86400];
}

async function postCount(request, env, ctx) {
  const done = new Response(null, { status: 204, headers: cors(request, env) });
  if (!countable(request, env)) return done;
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 4000)); } catch (e) { return done; }
  const add = {};
  for (const k of Object.keys((body && body.c) || {}).slice(0, 32)) {
    if (!COUNTED.has(k)) continue;
    const n = Math.min(10, Math.max(0, parseInt(body.c[k], 10) || 0));
    if (n) add[k] = n;
  }
  const live = body && body.l ? liveVisit(request, body.l) : null;
  if (!Object.keys(add).length && !live) return done;
  const stub = env.STATS.get(env.STATS.idFromName("kaal"));
  const write = stub.fetch("https://stats/add", { method: "POST", body: JSON.stringify({ day: istDay(Date.now()), add, live }) })
    .catch(e => console.log("Count write failed:", String(e).slice(0, 120)));
  if (ctx && ctx.waitUntil) ctx.waitUntil(write); else await write;
  return done;
}

/* Only the shop's own pages, only a counter that exists, and never a robot. */
function countable(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOW_ORIGIN || "https://thekaal.co,https://www.thekaal.co").split(",").map(x => x.trim());
  if (allowed.indexOf(origin) < 0 || !env.STATS) return false;
  return !/bot|crawl|spider|headless|lighthouse|preview/i.test(request.headers.get("User-Agent") || "");
}

/* ══════════ 5b. THE LIVE VIEW ══════════

   What the desk shows as "Right now": who is on the page this minute,
   where in it they are, and each step a visit takes, seconds after it is
   taken. The day's totals above wait for a visit to end; this does not.

   A visit is known only by a random tag the page makes when it loads and
   holds in memory: no cookie, nothing stored on the visitor's device,
   nothing about who. The page says where it is with its minute check of
   the edition (/state, already asked), and sends its steps with the count
   it already sends, a few seconds after each one. From the request itself
   the worker reads only what kind of device it is and, for the two apps
   the ads run in, which app. No address, no place, no IP.

   It lives in the counter's own Durable Object: in memory while it is
   being used, saved at most every fifteen seconds so a quiet spell does not
   lose it, and every visit forgotten an hour after it was last seen. The
   tag never leaves the object; the desk sees "Visitor 4". ─────────────── */
const LIVE_WHERE = new Set(["film", "story", "twenty", "below", "details", "pay"]);
/* Every step a visit can take, as the page and the other pages name it.
   Anything else is dropped. The words for each are stepText(), in mail.js. */
const LIVE_EV = new Set(["film", "hero", "hero_complete", "view", "dial", "early_dial", "number", "caseback_view", "gift",
  "checkout", "details", "details_closed", "pay_closed", "pay_failed", "list", "deeplink",
  "provenance_click", "ctx_cta", "act", "page"]);
const LIVE_FACES = new Set(["emerald", "midnight", "champagne", "ivory"]);
const PAGES = new Set(["home", "about", "manifesto", "movement", "provenance", "legal", "claimed", "404"]);

/* What kind of device, and which of the two in-app browsers the ads open
   in. Coarse on purpose: enough to know an Instagram ad is landing on
   iPhones, never enough to tell one phone from another. */
function uaInfo(ua) {
  ua = String(ua || "");
  const app = /Instagram/i.test(ua) ? "Instagram" : /FBAN|FBAV|FB_IAB|FBIOS/i.test(ua) ? "Facebook" : "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "";
  const dev = /iPad|Tablet/i.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? "tablet" : /Mobi|iPhone|Android/i.test(ua) ? "phone" : "computer";
  return { app, os, dev };
}

/* One visit's report, cleaned: anything not on these short lists is
   dropped, so nothing a stranger posts here can reach the desk as markup
   or grow without bound. `v` is the page view's own tag (the live view);
   `u` is the device's (the history, 5c). */
function liveVisit(request, l) {
  const tag = String((l && l.v) || "");
  if (!/^[a-z0-9]{6,16}$/.test(tag)) return null;
  const n = parseInt(l.n, 10), u = String(l.u || "");
  const out = Object.assign({ v: tag, u: /^[a-z0-9]{6,24}$/.test(u) ? u : "", p: PAGES.has(l.p) ? l.p : "home",
    w: LIVE_WHERE.has(l.w) ? l.w : "", n: n >= 1 && n <= 99 ? n : 0,
    d: LIVE_FACES.has(l.d) ? l.d : "", s: String(l.s || "").toLowerCase().replace(/[^a-z0-9 ._-]/g, "").slice(0, 24),
    g: l.g === 1 || l.g === true, ev: [] }, uaInfo(request.headers.get("User-Agent")));
  for (const e of Array.isArray(l.ev) ? l.ev.slice(0, 16) : []) {
    if (!e || !LIVE_EV.has(e.e)) continue;
    out.ev.push({ e: e.e, no: /^\d{1,2}$/.test(e.no || "") ? String(e.no) : "",
      dial: /^[A-Za-z]{3,12}$/.test(e.dial || "") ? String(e.dial) : "",
      x: String(e.x || "").replace(/<[^>]*>?/g, "").replace(/[^A-Za-z0-9 .,'()-]/g, "").slice(0, 60) });
  }
  return out;
}

/* The page's minute check: "this visit is still here, and here". */
function liveSeen(request, env, ctx, q) {
  if (!countable(request, env)) return;
  const live = liveVisit(request, { v: q.get("h"), u: q.get("u"), w: q.get("w"), n: q.get("n"), d: q.get("d"), s: q.get("s") });
  if (live) liveTell(env, ctx, live);
}

/* Anything the worker itself knows first, a sale above all. */
function liveTell(env, ctx, live) {
  if (!env.STATS) return;
  const write = env.STATS.get(env.STATS.idFromName("kaal"))
    .fetch("https://stats/add", { method: "POST", body: JSON.stringify({ live }) })
    .catch(e => console.log("Live note failed:", String(e).slice(0, 120)));
  if (ctx && ctx.waitUntil) ctx.waitUntil(write);
}

async function liveFor(env) {
  if (!env.STATS) return null;
  try {
    const r = await env.STATS.get(env.STATS.idFromName("kaal")).fetch("https://stats/live");
    return r.ok ? await r.json() : null;
  } catch (e) { console.log("Live read failed:", String(e).slice(0, 120)); return null; }
}

const LIVE_KEEP_MS = 60 * 60 * 1000;   /* the live view's feed is the last hour */
const LIVE_HERE_MS = 95 * 1000;        /* the page checks in every minute: seen inside this and still open is here */
const LIVE_SAVE_MS = 15 * 1000;
const LIVE_MAX = 400;                  /* visits kept at once; the oldest goes first */

/* ══════════ 5c. EVERY VISITOR'S HISTORY ══════════

   The owner asked for the whole story of each visitor: where they came
   from, every visit, every dial and number they looked at, how far into
   checkout they got, and, when they gave their details or paid, who they
   are. So the live view's steps are also written here, kept ninety days
   from the last time the visitor was seen, and then deleted.

   A visitor is a device: the random id the page already keeps for holds
   (kaal_client, in the browser's storage), so a return three days later
   joins the same history. A visit is a stretch of activity with less than
   thirty minutes between steps. When the same device opens a checkout
   (/order sends that id as `by`), its name, phone, email and city are put
   on the history, and a payment on that order is too. legal.html's
   privacy section says all of this, and the details form says it at the
   moment they are given.

   One row per visitor in the counter's own SQLite store, its steps as one
   JSON list (at most STEPS_MAX, the oldest dropped first), so a step costs
   one row written, not one per step. The desk reads it page by page; the
   midnight email reads the day's. ─────────────────────────────────────── */
const HIST_DAYS = 90;
const VISIT_GAP_MS = 30 * 60 * 1000;
const STEPS_MAX = 400;
const SEEN_WRITE_MS = 50 * 1000;   /* a minute check updates "last seen" at most this often */
const HIST_HOUR_MAX = 3000;        /* new visitors stop being written past this many in an hour */

function stepsOf(row) { try { const a = JSON.parse(row.steps || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function uniq(a) { return a.filter((x, i) => x && a.indexOf(x) === i); }

/* One visitor, as the desk lists them: who, where from, and the
   moments that matter, worked out from the steps. */
function visitorSummary(row) {
  const st = stepsOf(row), first = st.find(e => e.e === "visit") || {};
  return {
    k: row.k, first: row.first, last: row.last, visits: row.visits,
    s: row.s || "", from: sourceName(row.s, row.app), app: row.app || "", os: row.os || "", dev: row.dev || "",
    name: row.name || "", phone: row.phone || "", email: row.email || "", city: row.city || "",
    n: row.n || 0, dial: row.dial || "", paid: row.paid ? String(row.paid).split(",").filter(Boolean) : [],
    landed: first.x || "home", steps: st.length,
    dials: uniq(st.filter(e => (e.e === "dial" || e.e === "early_dial" || e.e === "number") && e.dial).map(e => e.dial)),
    /* A dial chosen picks its first open number for them: that counts too. */
    numbers: uniq(st.filter(e => (e.e === "number" || e.e === "caseback_view" || e.e === "checkout") && e.no).map(e => e.no)
      .concat(row.n ? [pad2(row.n)] : [])),
    checkout: st.some(e => e.e === "checkout"), details: st.some(e => e.e === "details"),
    film: st.some(e => e.e === "hero_complete"), twenty: st.some(e => e.e === "view"),
    time: visitTime(st, row.last)
  };
}
/* Time on the site across every visit: each visit runs from its arrival to
   its last step, the latest one to when the visitor was last seen. */
function visitTime(st, last) {
  let total = 0, start = 0, end = 0;
  for (const e of st) {
    if (e.e === "visit") { if (start) total += Math.max(0, (e.end || end) - start); start = e.t; end = e.t; }
    else end = e.t;
  }
  if (start) total += Math.max(0, Math.max(end, last || 0) - start);
  return total;
}

/* The one place the counts are kept, the live view, and the histories.
   Single-threaded by construction, so two visits ending at once cannot
   lose each other's numbers. */
export class Stats {
  constructor(state) { this.state = state; this.live = null; this.alarmAt = 0; this.sqlOk = false; }
  async fetch(request) {
    const url = new URL(request.url), q = url.searchParams;
    const out = (b) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/add" && request.method === "POST") {
      const { day, add, live } = await request.json();
      if (add && Object.keys(add).length) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return new Response("bad day", { status: 400 });
        const cur = (await this.state.storage.get("d:" + day)) || {};
        for (const k of Object.keys(add)) cur[k] = (cur[k] || 0) + (parseInt(add[k], 10) || 0);
        await this.state.storage.put("d:" + day, cur);
      }
      if (live) {
        const k = await this.histTake(live);
        if (k) live.vk = k;
        await this.liveTake(live);
      }
      return new Response("ok");
    }
    if (url.pathname === "/get") {
      const days = (q.get("days") || "").split(",").filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 31);
      const res = {};
      for (const d of days) res[d] = (await this.state.storage.get("d:" + d)) || {};
      return out(res);
    }
    if (url.pathname === "/live") return out(await this.liveView());
    if (url.pathname === "/link" && request.method === "POST") { await this.histLink(await request.json()); return new Response("ok"); }
    if (url.pathname === "/visitors") return out(this.histList(q));
    if (url.pathname === "/visitor") return out(this.histOne(parseInt(q.get("k"), 10)));
    if (url.pathname === "/journeys" && request.method === "POST") return out(this.histJourneys((await request.json()).o || []));
    if (url.pathname === "/day") return out(this.histDay(q.get("d") || ""));
    if (url.pathname === "/rows") return out(this.histRows(parseInt(q.get("since"), 10) || 0));
    if (url.pathname === "/prune" && request.method === "POST") return out(this.histPrune());
    if (url.pathname === "/forget" && request.method === "POST") return out(this.histForget(parseInt((await request.json()).k, 10)));
    return new Response("not found", { status: 404 });
  }

  /* ── 5c. the histories ── */
  get sql() {
    const sql = this.state.storage.sql;
    if (!this.sqlOk) {
      sql.exec(`CREATE TABLE IF NOT EXISTS visitor (id TEXT PRIMARY KEY, k INTEGER NOT NULL, first INTEGER NOT NULL,
        last INTEGER NOT NULL, visits INTEGER NOT NULL DEFAULT 1, tag TEXT, s TEXT, app TEXT, os TEXT, dev TEXT,
        name TEXT, phone TEXT, email TEXT, city TEXT, n INTEGER, dial TEXT, paid TEXT, steps TEXT NOT NULL)`);
      sql.exec("CREATE INDEX IF NOT EXISTS visitor_last ON visitor(last)");
      sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS visitor_k ON visitor(k)");
      sql.exec("CREATE TABLE IF NOT EXISTS orderof (o TEXT PRIMARY KEY, id TEXT NOT NULL, at INTEGER NOT NULL)");
      this.sqlOk = true;
    }
    return sql;
  }
  hasSql() { return !!(this.state.storage && this.state.storage.sql); }
  row(id) { return this.sql.exec("SELECT * FROM visitor WHERE id = ?", id).toArray()[0] || null; }
  async nextK() {
    const k = ((await this.state.storage.get("vseq")) || 0) + 1;
    await this.state.storage.put("vseq", k);
    return k;
  }
  save(row, steps) {
    if (steps.length > STEPS_MAX) steps = steps.slice(steps.length - STEPS_MAX);
    this.sql.exec(`INSERT INTO visitor (id, k, first, last, visits, tag, s, app, os, dev, name, phone, email, city, n, dial, paid, steps)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last = excluded.last, visits = excluded.visits, tag = excluded.tag, s = excluded.s,
      app = excluded.app, os = excluded.os, dev = excluded.dev, name = excluded.name, phone = excluded.phone,
      email = excluded.email, city = excluded.city, n = excluded.n, dial = excluded.dial, paid = excluded.paid, steps = excluded.steps`,
      row.id, row.k, row.first, row.last, row.visits, row.tag || null, row.s || null, row.app || null, row.os || null, row.dev || null,
      row.name || null, row.phone || null, row.email || null, row.city || null, row.n || null, row.dial || null, row.paid || null,
      JSON.stringify(steps));
  }
  /* A report from a page: a minute check, a few steps, or "gone". Returns
     the visitor's number for the live view. A minute check that changes
     nothing writes at most once every fifty seconds. */
  async histTake(x) {
    if (!x.u || !this.hasSql()) return 0;
    const now = Date.now();
    let row = this.row(x.u);
    const fresh = !row;
    /* A brake on anyone posting made-up visitors to fill the store: far
       above what a twenty-watch shop sees in an hour. */
    if (fresh && this.sql.exec("SELECT COUNT(*) AS c FROM visitor WHERE last >= ?", now - 3600000).toArray()[0].c >= HIST_HOUR_MAX) return 0;
    if (!row) row = { id: x.u, k: await this.nextK(), first: now, last: now, visits: 0, steps: "[]" };
    const steps = stepsOf(row);
    const newVisit = fresh || now - row.last > VISIT_GAP_MS;
    let changed = fresh || newVisit || (x.ev && x.ev.length) || x.g;
    if (newVisit) {
      const prev = steps.filter(e => e.e === "visit").pop();
      if (prev && !prev.end) prev.end = row.last;
      row.visits = (row.visits || 0) + 1;
      steps.push({ t: now, e: "visit", x: x.p || "home", s: x.s || "", app: x.app || "", os: x.os || "", dev: x.dev || "" });
      if (fresh || !row.s) { row.s = x.s || ""; row.app = x.app || ""; row.os = x.os || ""; row.dev = x.dev || ""; }
    } else if (x.v && row.tag && x.v !== row.tag && x.p === "home") {
      /* Back on the storefront within the same visit: a reload, or from one
         of the other pages. */
      steps.push({ t: now, e: "page", x: "home" });
      changed = true;
    }
    for (const e of x.ev || []) {
      if (newVisit && e.e === "page" && e.x === (x.p || "home")) continue;
      steps.push({ t: now, e: e.e, no: e.no || "", dial: e.dial || "", x: e.x || "" });
    }
    if (x.n) { if (row.n !== x.n) changed = true; row.n = x.n; }
    if (x.d) { const d = x.d.charAt(0).toUpperCase() + x.d.slice(1); if (row.dial !== d) changed = true; row.dial = d; }
    if (x.v) row.tag = x.v;
    if (!changed && now - row.last < SEEN_WRITE_MS) return row.k;
    row.last = now;
    this.save(row, steps);
    return row.k;
  }
  /* A checkout opened (/order): who they said they are, and which order is
     theirs, so its payment finds them later. */
  async histLink(b) {
    if (!this.hasSql() || !/^[a-z0-9]{6,24}$/.test(String(b.u || "")) || !/^order_\w{6,40}$/.test(String(b.o || ""))) return;
    const now = Date.now();
    let row = this.row(b.u);
    if (!row) row = { id: b.u, k: await this.nextK(), first: now, last: now, visits: 1, steps: JSON.stringify([{ t: now, e: "visit", x: "home" }]) };
    const steps = stepsOf(row), who = b.buyer || {};
    for (const f of ["name", "phone", "email", "city"]) if (who[f]) row[f] = String(who[f]).slice(0, 120);
    if (b.n) row.n = parseInt(b.n, 10) || row.n;
    row.last = Math.max(row.last, now);
    this.save(row, steps);
    this.sql.exec("INSERT OR REPLACE INTO orderof (o, id, at) VALUES (?, ?, ?)", b.o, b.u, now);
  }
  /* A payment on an order whose checkout this store saw. */
  histPaid(x) {
    if (!this.hasSql() || !x.o) return;
    const m = this.sql.exec("SELECT id FROM orderof WHERE o = ?", String(x.o)).toArray()[0];
    const row = m && this.row(m.id);
    if (!row) return;
    const steps = stepsOf(row), now = Date.now();
    steps.push({ t: now, e: "paid", no: String(x.no || ""), dial: String(x.dial || ""), x: String(parseInt(x.paise, 10) || 0) });
    row.paid = uniq(String(row.paid || "").split(",").concat([String(x.no || "")])).join(",");
    row.last = Math.max(row.last, now);
    this.save(row, steps);
  }
  histList(q) {
    if (!this.hasSql()) return { ok: false, total: 0, rows: [] };
    const since = parseInt(q.get("since"), 10) || 0, f = q.get("f") || "all", off = Math.max(0, parseInt(q.get("off"), 10) || 0);
    const lim = Math.min(100, Math.max(1, parseInt(q.get("lim"), 10) || 25));
    let where = "last >= ?";
    const args = [since];
    if (f === "bought") where += " AND paid IS NOT NULL AND paid <> ''";
    else if (f === "details") where += " AND (name IS NOT NULL OR phone IS NOT NULL OR email IS NOT NULL)";
    else if (f === "number") where += " AND n IS NOT NULL AND n > 0";
    else if (f === "checkout") where += " AND steps LIKE '%\"e\":\"checkout\"%'";
    const term = String(q.get("q") || "").trim().slice(0, 60);
    if (term) {
      const kn = parseInt(term.replace(/^visitor\s*/i, ""), 10);
      where += " AND (name LIKE ? OR phone LIKE ? OR email LIKE ? OR city LIKE ? OR s LIKE ? OR app LIKE ? OR paid LIKE ?" + (kn ? " OR k = ?" : "") + ")";
      const like = "%" + term.replace(/[%_]/g, "") + "%";
      args.push(like, like, like, like, like, like, like);
      if (kn) args.push(kn);
    }
    const total = this.sql.exec(`SELECT COUNT(*) AS c FROM visitor WHERE ${where}`, ...args).toArray()[0].c;
    const rows = this.sql.exec(`SELECT * FROM visitor WHERE ${where} ORDER BY last DESC LIMIT ? OFFSET ?`, ...args, lim, off).toArray();
    return { ok: true, total, rows: rows.map(visitorSummary) };
  }
  histOne(k) {
    if (!this.hasSql() || !k) return { ok: false };
    const row = this.sql.exec("SELECT * FROM visitor WHERE k = ?", k).toArray()[0];
    if (!row) return { ok: false, reason: "gone" };
    return { ok: true, v: Object.assign(visitorSummary(row), { steps: stepsOf(row).map(e => Object.assign({}, e, { txt: stepText(e) })) }) };
  }
  histJourneys(orders) {
    const res = {};
    if (!this.hasSql()) return res;
    for (const o of orders.slice(0, 200)) {
      const m = this.sql.exec("SELECT id FROM orderof WHERE o = ?", String(o)).toArray()[0];
      const row = m && this.row(m.id);
      if (row) res[o] = visitorSummary(row);
    }
    return res;
  }
  /* The day's visitors for the midnight email: everyone with a step that
     day, with only that day's steps. */
  histDay(day) {
    if (!this.hasSql() || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { rows: [], total: 0 };
    const from = Date.parse(day + "T00:00:00Z") - IST_MS, to = from + 86400000;
    const rows = this.sql.exec("SELECT * FROM visitor WHERE last >= ? AND first < ? ORDER BY first", from, to).toArray();
    const out = [];
    for (const row of rows) {
      const all = stepsOf(row), today = all.filter(e => e.t >= from && e.t < to);
      if (!today.length) continue;
      const visitNo = all.filter(e => e.e === "visit" && e.t < to).length;
      out.push(Object.assign(visitorSummary(row), { today, visitNo, before: all.some(e => e.e === "visit" && e.t < from) }));
    }
    return { rows: out.slice(0, 300), total: out.length };
  }
  /* Everything since a moment, for the two spreadsheets: the 5,000 most
     recent visitors, which is more than ninety days of this shop. */
  histRows(since) {
    if (!this.hasSql()) return { rows: [] };
    return { rows: this.sql.exec("SELECT * FROM visitor WHERE last >= ? ORDER BY last DESC LIMIT 5000", since).toArray()
      .map(row => Object.assign(visitorSummary(row), { steps: stepsOf(row) })) };
  }
  /* Someone asked to have their history deleted (legal.html promises they
     can): the visitor and the note of which orders were theirs. Their
     orders themselves stay in Razorpay, where the law keeps them. */
  histForget(k) {
    if (!this.hasSql() || !(k > 0)) return { ok: false };
    const row = this.sql.exec("SELECT id FROM visitor WHERE k = ?", k).toArray()[0];
    if (!row) return { ok: false, reason: "gone" };
    this.sql.exec("DELETE FROM orderof WHERE id = ?", row.id);
    this.sql.exec("DELETE FROM visitor WHERE id = ?", row.id);
    return { ok: true };
  }
  /* Ninety days after a visitor was last seen, they are deleted, with the
     note of which orders were theirs. */
  histPrune() {
    if (!this.hasSql()) return { deleted: 0 };
    const cut = Date.now() - HIST_DAYS * 86400000;
    const gone = this.sql.exec("SELECT COUNT(*) AS c FROM visitor WHERE last < ?", cut).toArray()[0].c;
    this.sql.exec("DELETE FROM visitor WHERE last < ?", cut);
    this.sql.exec("DELETE FROM orderof WHERE at < ?", cut);
    return { deleted: gone };
  }

  /* ── 5b. the live view ── */
  async liveLoad() {
    if (!this.live) this.live = (await this.state.storage.get("live")) || { seq: 0, visits: {}, paid: [] };
    return this.live;
  }
  livePrune(now) {
    const L = this.live, tags = Object.keys(L.visits);
    for (const t of tags) if (now - L.visits[t].last > LIVE_KEEP_MS) delete L.visits[t];
    L.paid = L.paid.filter(p => now - p.ts <= LIVE_KEEP_MS);
    const left = Object.keys(L.visits);
    if (left.length > LIVE_MAX) {
      left.sort((a, b) => L.visits[a].last - L.visits[b].last).slice(0, left.length - LIVE_MAX).forEach(t => { delete L.visits[t]; });
    }
    if (!Object.keys(L.visits).length && !L.paid.length) L.seq = 0;
  }
  async liveTake(x) {
    const L = await this.liveLoad(), now = Date.now();
    if (x.e === "paid") {
      L.paid.push({ ts: now, no: String(x.no || ""), dial: String(x.dial || ""), paise: parseInt(x.paise, 10) || 0 });
      this.histPaid(x);
    } else if (x.v) {
      let v = L.visits[x.v];
      if (!v) v = L.visits[x.v] = { k: ++L.seq, first: now, last: now, s: x.s || "", app: x.app || "", os: x.os || "", dev: x.dev || "", w: "", n: 0, d: "", p: x.p || "home", steps: [] };
      /* The visitor's own number, the same one the history and every other
         day uses, once the device is known. */
      if (x.vk) v.vk = x.vk;
      v.last = now;
      v.gone = !!x.g;
      if (x.w) v.w = x.w;
      if (x.n) v.n = x.n;
      if (x.d) v.d = x.d;
      if (!v.s && x.s) v.s = x.s;
      for (const e of x.ev || []) if (v.steps.length < 40) v.steps.push({ ts: now, e: e.e, no: e.no, dial: e.dial, x: e.x || "" });
    }
    this.livePrune(now);
    /* Saved soon, not now: a visit checks in every minute, and a write for
       each would spend the free plan's allowance on nothing. */
    if (!this.alarmAt || this.alarmAt > now + LIVE_SAVE_MS) {
      this.alarmAt = now + LIVE_SAVE_MS;
      await this.state.storage.setAlarm(this.alarmAt);
    }
  }
  /* Saves the live view, and comes back when the oldest visit in it is an
     hour old, to drop it from the feed. */
  async alarm() {
    this.alarmAt = 0;
    const L = await this.liveLoad(), now = Date.now();
    this.livePrune(now);
    const times = Object.values(L.visits).map(v => v.last).concat(L.paid.map(p => p.ts));
    if (!times.length) { await this.state.storage.delete("live"); return; }
    await this.state.storage.put("live", L);
    this.alarmAt = Math.max(now + LIVE_SAVE_MS, Math.min.apply(null, times) + LIVE_KEEP_MS + 1000);
    await this.state.storage.setAlarm(this.alarmAt);
  }
  /* What the desk reads: no tags, only "Visitor 4". */
  async liveView() {
    const L = await this.liveLoad(), now = Date.now();
    this.livePrune(now);
    const num = v => v.vk || 0;
    const show = v => ({ k: v.k, vk: num(v), since: v.first, last: v.last, s: v.s, from: sourceName(v.s, v.app), app: v.app, os: v.os, dev: v.dev, w: v.w, p: v.p || "home", n: v.n, d: v.d,
      steps: v.steps.map(e => ({ ts: e.ts, e: e.e, no: e.no, dial: e.dial, txt: stepText(e) })) });
    const all = Object.values(L.visits);
    const isHere = v => !v.gone && now - v.last < LIVE_HERE_MS;
    const here = all.filter(isHere).sort((a, b) => a.first - b.first).map(show);
    const left = all.filter(v => !isHere(v)).sort((a, b) => b.last - a.last).slice(0, 40).map(show);
    /* How many were on the page in each of the last thirty minutes. */
    const minutes = [];
    for (let i = 29; i >= 0; i--) {
      const to = now - i * 60000, from = to - 60000;
      minutes.push(all.filter(v => v.first < to && v.last >= from).length);
    }
    /* Steps sent together share a moment; the later one still goes first. */
    const feed = [];
    let o = 0;
    for (const v of all) for (const e of v.steps) feed.push({ ts: e.ts, o: o++, k: v.k, vk: num(v), e: e.e, no: e.no, dial: e.dial, txt: stepText(e) });
    for (const p of L.paid) feed.push({ ts: p.ts, o: o++, k: 0, vk: 0, e: "paid", no: p.no, dial: p.dial, paise: p.paise, txt: stepText({ e: "paid", no: p.no, dial: p.dial, x: String(p.paise) }) });
    feed.sort((a, b) => (b.ts - a.ts) || (b.o - a.o));
    return { now, here, left, minutes, feed: feed.slice(0, 80).map(({ o, ...e }) => e), paid: L.paid.slice().sort((a, b) => b.ts - a.ts) };
  }
}

async function statsFor(env, days) {
  if (!env.STATS) return {};
  try {
    const r = await env.STATS.get(env.STATS.idFromName("kaal")).fetch("https://stats/get?days=" + days.join(","));
    return r.ok ? await r.json() : {};
  } catch (e) { console.log("Count read failed:", String(e).slice(0, 120)); return {}; }
}

async function listOrders(env, from, to) {
  const out = [];
  try {
    for (let skip = 0; skip < 500; skip += 100) {
      const res = await fetch(`${RZP_API}/orders?from=${from}&to=${to}&count=100&skip=${skip}`, { headers: razorpayAuth(env) });
      if (!res.ok) { console.log("Order listing failed:", res.status); return out; }
      const items = ((await res.json()) || {}).items || [];
      out.push(...items);
      if (items.length < 100) break;
    }
  } catch (e) { console.log("Order listing threw:", String(e).slice(0, 120)); }
  return out;
}

/* Series 02 sign-ups that arrived in the window, newest last. */
async function leadsBetween(env, from, to) {
  if (!env.KAAL_STATE) return [];
  const out = [];
  try {
    let cursor;
    do {
      const page = await env.KAAL_STATE.list({ prefix: LIST_PREFIX, cursor });
      for (const k of page.keys || []) {
        const v = await env.KAAL_STATE.get(k.name, "json").catch(() => null);
        const at = v && Date.parse(v.at) / 1000;
        if (v && at >= from && at < to) out.push({ email: v.email, source: v.source || "", ts: at, at: indiaTime(new Date(at * 1000)) });
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  } catch (e) { console.log("Lead listing failed:", String(e).slice(0, 120)); }
  return out.sort((a, b) => a.ts - b.ts);
}

/* Every paid order of the last SALES_DAYS days, newest first, with where
   each one stands: the address, the dispatch, the day it is due. The desk
   and the morning report both read this, so the two can never disagree. */
const SALES_DAYS = 120;
async function ledger(env, nowMs) {
  const now = Math.floor(nowMs / 1000);
  const rzp = !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
  const pays = rzp ? await listPayments(env, now - SALES_DAYS * 86400, now) : null;
  const orders = [];
  let lookups = 0;
  const paid = (pays || []).filter(p => p.status === "captured" || p.status === "authorized" || p.status === "refunded")
    .sort((a, b) => b.created_at - a.created_at);
  for (const p of paid) {
    const notes = p.notes || {};
    let n = parseInt(notes.kaal_no, 10);
    if (!n && p.order_id && lookups < 25) { lookups++; n = await numberFromOrder(env, p.order_id); }
    n = n || 0;
    let address = null, sent = null, refundRec = null, release = null;
    const after = {};
    if (env.KAAL_STATE && p.order_id) {
      address = await env.KAAL_STATE.get("ship:" + p.order_id, "json").catch(() => null);
      sent = await env.KAAL_STATE.get("sent:" + p.order_id, "json").catch(() => null);
      /* The notes to the owner after it left (section 3e). */
      if (sent) for (const k of ["after1", "after2", "after3"]) {
        const a = await env.KAAL_STATE.get(k + ":" + p.order_id, "json").catch(() => null);
        if (a) after[k] = a.at || "yes";
      }
    }
    const at = new Date(p.created_at * 1000), back = p.amount_refunded || 0;
    if (back && env.KAAL_STATE) {
      refundRec = await env.KAAL_STATE.get("refundof:" + p.id, "json").catch(() => null);
      const r = n ? await env.KAAL_STATE.get("refunded:" + n, "json").catch(() => null) : null;
      if (r && r.payment === p.id) release = r;
    }
    orders.push({
      n, dial: n ? DIAL_OF(env, n) : "", id: p.id, orderId: p.order_id || "",
      amount: `₹${((p.amount || 0) / 100).toLocaleString("en-IN")}`, paise: p.amount || 0,
      email: p.email || "", contact: p.contact || "", ts: p.created_at, day: istDay(p.created_at * 1000), at: indiaTime(at),
      gift: notes.gift === "yes", giftNote: notes.gift_note || "",
      due: arriveBy(at), dueDay: arriveByDay(at), address, sent, after,
      refund: p.status === "refunded" || (back && back >= (p.amount || 0)) ? "full" : back ? "part" : "",
      refunded: back ? rupees(back) : "", refundedOn: refundRec ? indiaTime(new Date(refundRec.refundedAt)) : "",
      release: release ? { decided: release.decided || "", at: release.decidedAt || "" } : null
    });
  }
  return { rzp, pays, orders };
}

/* Checkouts opened in the window that never became a payment, with how far
   each got and how to reach the person, when Razorpay knows. */
async function unfinishedBetween(env, pays, from, to) {
  const paidOrders = new Set(pays.filter(p => p.status === "captured" || p.status === "authorized" || p.status === "refunded").map(p => p.order_id).filter(Boolean));
  const out = [];
  for (const o of await listOrders(env, from, to)) {
    if (o.status === "paid" || paidOrders.has(o.id)) continue;
    /* The latest try says how far they got; a person often tries twice,
       and only one of the tries may carry their email, phone or the bank's
       reason, so those come from whichever try has them. */
    const tries = pays.filter(p => p.order_id === o.id).sort((a, b) => b.created_at - a.created_at);
    const t = tries[0], has = (k) => (tries.find(p => p[k]) || {})[k] || "";
    const why = (tries.find(p => p.status === "failed" && p.error_description) || {}).error_description;
    const n = parseInt((o.notes || {}).kaal_no, 10) || 0;
    /* What they told us before paying, if they did (worker v3): enough to
       reach someone who closed the payment window without typing a thing. */
    let given = null;
    if (env.KAAL_STATE) given = await env.KAAL_STATE.get("ship:" + o.id, "json").catch(() => null);
    const who = (given && given.buyer) || {};
    const email = has("email") || who.email || "";
    /* Whether the one follow-up email has gone to this person (3e). */
    let followed = "";
    if (env.KAAL_STATE && email) {
      const f = await env.KAAL_STATE.get(await nearlyKey(email), "json").catch(() => null);
      if (f) followed = f.at || "yes";
    }
    out.push({ n, dial: n ? DIAL_OF(env, n) : "", orderId: o.id, ts: o.created_at, at: indiaTime(new Date(o.created_at * 1000)),
      name: who.name || "", city: given ? [given.city, given.state].filter(Boolean).join(", ") : "",
      email, contact: has("contact") || who.phone || "", followed,
      stage: t ? (t.status === "failed" ? "Payment failed" + (why ? `: ${String(why).slice(0, 80)}` : "") + (tries.length > 1 ? ` (${tries.length} tries)` : "") : `Payment ${t.status}`)
               : "Closed checkout before paying" });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

async function digestData(env, day) {
  const site = siteUrl(env);
  const edition = parseInt(env.EDITION || "20", 10);
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(istDay(Date.parse(day + "T12:00:00Z") - IST_MS - i * 86400000));
  const nowMs = Date.now();
  const [counts, L, soldRaw] = await Promise.all([statsFor(env, days), ledger(env, nowMs), knownSold(env)]);
  const [from, to] = istWindow(day);

  const live = L.orders.filter(o => o.refund !== "full");
  const ordersOn = {};
  for (const o of live) ordersOn[o.day] = (ordersOn[o.day] || 0) + 1;
  const orders = L.orders.filter(o => o.ts >= from && o.ts < to);
  const unfinished = L.rzp ? await unfinishedBetween(env, L.pays || [], from, to) : [];

  const sold = soldRaw || [];
  const c = counts[day] || {};
  return {
    site, day, edition, c, orders, unfinished,
    leads: await leadsBetween(env, from, to),
    visitors: await histAsk(env, "/day?d=" + day, null, { rows: [], total: 0 }),
    sold: sold.slice().sort((a, b) => a - b), left: Math.max(0, edition - sold.length),
    revenue: orders.filter(o => o.refund !== "full").reduce((t, o) => t + o.paise, 0),
    trend: days.map(dd => ({ day: dd, visitors: (counts[dd] || {}).visitor || 0, visits: (counts[dd] || {}).visit || 0,
      numbers: (counts[dd] || {}).number || 0, checkouts: (counts[dd] || {}).checkout || 0, orders: ordersOn[dd] || 0 })),
    refunds: (await refundsBetween(env, from, to)).map(r => ({ n: r.n, dial: r.n ? DIAL_OF(env, r.n) : "", amount: rupees(r.amount),
      full: !!r.full, payment: r.payment, at: indiaTime(new Date(r.refundedAt)) })),
    alerts: alertsFor(env, L, soldRaw, nowMs),
    followUps: env.KAAL_STATE ? (await env.KAAL_STATE.get("sent:" + day, "json").catch(() => null)) || {} : {},
    deskUrl: env.DESK_PASSCODE ? workerUrl(env) + "/desk" : "",
    counting: !!env.STATS, razorpay: L.rzp
  };
}

/* Once a day, in the hour the owner chose. The cron runs every thirty
   minutes; the store remembers which mornings were sent, and without a
   store only the first half of the hour sends. */
async function dailyDigest(env) {
  try {
    if (env.DIGEST === "off") return;
    if (!env.RESEND_API_KEY && !env.BREVO_API_KEY) return;
    const now = Date.now(), ist = new Date(now + IST_MS);
    if (ist.getUTCHours() !== parseInt(env.DIGEST_HOUR_IST || "0", 10)) return;
    const day = istDay(now - 86400000);
    if (env.KAAL_STATE) {
      const key = "digest:" + day;
      if (await env.KAAL_STATE.get(key).catch(() => null)) return;
      await env.KAAL_STATE.put(key, "1", { expirationTtl: 40 * 24 * 3600 });
    } else if (ist.getUTCMinutes() >= 30) return;
    const m = ownerDigest(await digestData(env, day));
    await sendEmail(env, ownerInbox(env), m.subject, m.text, m.html);
  } catch (e) { console.log("Daily report threw:", String(e).slice(0, 160)); }
}

/* ══════════ 6. THE DESK ══════════

   One private page for the owner, at <worker>/desk: today so far, every
   order and where it stands, who nearly bought, the Series 02 list, the
   twenty, and whatever needs doing. Nothing on thekaal.co links to it,
   robots are told to stay out, and it opens only with the passcode in
   DESK_PASSCODE, a worker secret. Without that secret it stays shut.

   A right passcode earns a cookie that lasts thirty days on that device:
   the expiry, signed with a key made from the passcode, so changing the
   passcode signs every device out. Wrong passcodes are counted per
   connection (a salted hash, like the list's limiter), and the ninth in
   fifteen minutes is refused unread. The page loads nothing from any
   other site, and no other site can read anything from it.

     GET  /desk              the page (it asks for the passcode itself)
     POST /desk/login        {passcode}
     POST /desk/logout
     GET  /desk/data         everything the page shows, as JSON
     GET  /desk/live         "Right now" (section 5b) and today's totals,
                             asked every ten seconds while the desk is open
     GET  /desk/visitors     every visitor's history (5c), a page at a time:
                             ?r=today|7d|30d|90d &f=all|bought|details|number
                             |checkout &q=search &off=
     GET  /desk/visitor?k=   one visitor, every step
     GET  /desk/visitors.csv one row per visitor   (?r= as above)
     GET  /desk/steps.csv    one row per step      (?r= as above)
     POST /desk/forget       {k} deletes one visitor's history, on request
     GET  /desk/orders.csv   every order, with addresses, for the books
     GET  /desk/leads.csv    the whole Series 02 list
     POST /desk/dispatch     {o, courier, tracking, url, notify} marks an
                             order sent and, if asked, emails the buyer
                             their tracking; {o, undo:true} takes it back
     POST /desk/release      {n, action: "sell" | "retire"} the owner's
                             answer to a full refund (section 7)
     POST /desk/stop         {email} someone replied "stop": no email the
                             worker sends on its own goes to them again
                             (section 3e); {email, undo:true} takes it back
   ─────────────────── */

const DESK_COOKIE = "kaal_desk";
const DESK_DAYS = 30;
const DESK_TRIES = 8, DESK_TRIES_SECONDS = 15 * 60;
const ADDRESS_AFTER = 6 * 3600;   /* paid this long ago with no address: ask them */

function workerUrl(env) { return String(env.WORKER_URL || "https://kaal-edition.kaal-edition-hq.workers.dev").replace(/\/+$/, ""); }

function deskHeaders(extra) {
  return Object.assign({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  }, extra || {});
}
function deskJson(body, status, extra) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: deskHeaders(Object.assign({ "Content-Type": "application/json" }, extra || {})) });
}

/* The signing key mixes the passcode with a secret that never leaves the
   worker, so a stolen cookie cannot be used to guess the passcode offline. */
const deskKey = (env) => `kaal-desk|${env.DESK_PASSCODE}|${env.RAZORPAY_KEY_SECRET || env.GITHUB_TOKEN || ""}`;
async function deskSession(request, env) {
  if (!env.DESK_PASSCODE) return false;
  const m = new RegExp(`(?:^|;\\s*)${DESK_COOKIE}=(\\d{10,15})\\.([0-9a-f]{64})`).exec(request.headers.get("Cookie") || "");
  if (!m || !(parseInt(m[1], 10) > Date.now())) return false;
  return timingSafeEqual(await hmacHex("desk|" + m[1], deskKey(env)), m[2]);
}

/* Every write the desk makes carries X-Desk and comes from the desk's own
   address. A form on another site can do neither, and SameSite=Strict
   keeps the cookie off its requests anyway. */
function deskWrite(request) {
  if (request.headers.get("X-Desk") !== "1") return false;
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

async function desk(request, env, ctx, path) {
  const method = request.method;
  if (path === "/desk" && method === "GET") {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    return new Response(deskPage(nonce), { headers: deskHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
    }) });
  }
  if (path === "/desk/login" && method === "POST") return deskLogin(request, env);
  if (path === "/desk/logout" && method === "POST") {
    if (!deskWrite(request)) return deskJson({ ok: false, reason: "refused" }, 403);
    return deskJson({ ok: true }, 200, { "Set-Cookie": `${DESK_COOKIE}=; Path=/desk; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });
  }
  if (!env.DESK_PASSCODE) return deskJson({ ok: false, reason: "off" }, 503);
  if (!(await deskSession(request, env))) return deskJson({ ok: false, reason: "signed-out" }, 401);
  if (path === "/desk/data" && method === "GET") return deskJson(await deskData(env));
  if (path === "/desk/live" && method === "GET") return deskJson(await deskLive(env));
  if (path === "/desk/visitors" && method === "GET") return deskJson(await deskVisitors(env, new URL(request.url).searchParams));
  if (path === "/desk/visitor" && method === "GET") {
    const k = parseInt(new URL(request.url).searchParams.get("k"), 10);
    return deskJson(k > 0 ? await histAsk(env, "/visitor?k=" + k, null, { ok: false }) : { ok: false });
  }
  if (path === "/desk/forget" && method === "POST") {
    if (!deskWrite(request)) return deskJson({ ok: false, reason: "refused" }, 403);
    let b; try { b = await request.json(); } catch (e) { return deskJson({ ok: false, reason: "bad-request" }, 400); }
    return deskJson(await histAsk(env, "/forget", { k: parseInt(b && b.k, 10) }, { ok: false }));
  }
  if (path === "/desk/visitors.csv" && method === "GET") return deskVisitorsCsv(env, new URL(request.url).searchParams, false);
  if (path === "/desk/steps.csv" && method === "GET") return deskVisitorsCsv(env, new URL(request.url).searchParams, true);
  if (path === "/desk/orders.csv" && method === "GET") return deskOrdersCsv(env);
  if (path === "/desk/leads.csv" && method === "GET") return deskLeadsCsv(env);
  if (path === "/desk/dispatch" && method === "POST") return deskDispatch(request, env);
  if (path === "/desk/release" && method === "POST") return deskRelease(request, env);
  if (path === "/desk/stop" && method === "POST") return deskStop(request, env);
  return deskJson({ ok: false, reason: "not-found" }, 404);
}

async function deskLogin(request, env) {
  if (!deskWrite(request)) return deskJson({ ok: false, reason: "refused" }, 403);
  if (!env.DESK_PASSCODE) return deskJson({ ok: false, reason: "off" }, 503);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const rl = "rl:desk:" + (await sha256hex(`${ip}|${env.LIST_SALT || "kaal-desk"}`)).slice(0, 32);
  const tries = env.KAAL_STATE ? parseInt((await env.KAAL_STATE.get(rl).catch(() => null)) || "0", 10) || 0 : 0;
  if (tries >= DESK_TRIES) return deskJson({ ok: false, reason: "rate" }, 429);
  let body;
  try { body = await request.json(); } catch (e) { return deskJson({ ok: false, reason: "bad-request" }, 400); }
  const given = String((body && body.passcode) || "").trim().slice(0, 200);
  /* Compared as hashes, so the comparison takes the same time whatever
     the lengths. */
  const right = given && timingSafeEqual(await sha256hex("desk|" + given), await sha256hex("desk|" + String(env.DESK_PASSCODE).trim()));
  if (!right) {
    if (env.KAAL_STATE) await env.KAAL_STATE.put(rl, String(tries + 1), { expirationTtl: DESK_TRIES_SECONDS }).catch(() => null);
    return deskJson({ ok: false, reason: "wrong" }, 401);
  }
  const exp = String(Date.now() + DESK_DAYS * 86400000);
  const token = exp + "." + (await hmacHex("desk|" + exp, deskKey(env)));
  return deskJson({ ok: true }, 200, { "Set-Cookie": `${DESK_COOKIE}=${token}; Path=/desk; Max-Age=${DESK_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict` });
}

/* What needs the owner, most urgent kind first. "act" is a job; "note" is
   worth knowing. The morning report carries the acts; the desk shows both. */
function alertsFor(env, L, sold, nowMs) {
  const out = [], now = Math.floor(nowMs / 1000), today = istDay(nowMs);
  const byN = {};
  const live = new Set(L.orders.filter(o => o.refund !== "full" && o.n).map(o => o.n));
  for (const o of L.orders) {
    if (o.refund === "full") {
      if (o.n && sold && sold.indexOf(o.n) > -1 && !live.has(o.n) && !(o.release && o.release.decided)) {
        out.push({ level: "act", kind: "refund", n: o.n, orderId: o.orderId, id: o.id,
          title: `No. ${pad2(o.n)} was refunded: back on sale, or keep it retired?`,
          detail: `${o.refunded || o.amount} went back to the buyer${o.refundedOn ? " on " + o.refundedOn : ""}. The site still shows it sold until you choose.` });
      }
      continue;
    }
    const no = `No. ${pad2(o.n)}`;
    if (!o.n) {
      out.push({ level: "act", kind: "unknown", id: o.id, title: `A payment of ${o.amount} has no watch number`, detail: `${o.at}. Open it in Razorpay, read the notes, and mark the number sold by hand.` });
      continue;
    }
    (byN[o.n] = byN[o.n] || []).push(o);
    if (sold && sold.indexOf(o.n) < 0) {
      out.push({ level: "act", kind: "unsold", n: o.n, title: `${no} is paid for, but the site still offers it`, detail: "Add it to sold in index.html, and check the worker's GitHub token." });
    }
    if (o.sent) continue;
    if (!o.address && now - o.ts >= ADDRESS_AFTER) {
      out.push({ level: "act", kind: "address", n: o.n, orderId: o.orderId, title: `${no}: no delivery address yet`, detail: `Paid ${o.at}. Send them the address link, or mark it dispatched if it has already gone.` });
    }
    if (today > o.dueDay) out.push({ level: "act", kind: "late", n: o.n, orderId: o.orderId, title: `${no}: dispatch is late`, detail: `It was promised by ${o.due}. If it has already gone, mark it dispatched.` });
    else if (today === o.dueDay) out.push({ level: "act", kind: "due", n: o.n, orderId: o.orderId, title: `${no}: dispatch today`, detail: `It was promised by ${o.due}.` });
  }
  for (const n of Object.keys(byN)) {
    if (byN[n].length > 1) out.push({ level: "act", kind: "double", n: +n, title: `No. ${pad2(+n)} was paid for ${byN[n].length} times`, detail: "One watch, more than one buyer: refund the later payment in Razorpay and write to them." });
  }
  if (L.rzp && L.pays === null) out.push({ level: "act", kind: "razorpay", title: "Razorpay refused to list payments", detail: "Orders cannot be read. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the worker." });
  if (!env.RESEND_API_KEY && !env.BREVO_API_KEY) out.push({ level: "act", kind: "mail", title: "Nothing is being emailed", detail: "Buyers get no confirmation and you get no report until RESEND_API_KEY is set (docs/setup-email.md)." });
  const failedToday = (L.pays || []).filter(p => p.status === "failed" && istDay(p.created_at * 1000) === today).length;
  if (failedToday >= 3) out.push({ level: "note", kind: "failures", title: `${failedToday} payments failed today`, detail: "If they share one reason in Razorpay, a payment method may be refusing." });
  if (sold) {
    const left = Math.max(0, parseInt(env.EDITION || "20", 10) - sold.length);
    if (left === 0) out.push({ level: "note", kind: "complete", title: "The edition is complete", detail: "All twenty have gone." });
    else if (left <= 3) out.push({ level: "note", kind: "few", title: `${left} of ${env.EDITION || 20} remain`, detail: "" });
  }
  const order = ["unknown", "double", "unsold", "refund", "late", "due", "address", "razorpay", "mail"];
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "act" ? -1 : 1) || (order.indexOf(a.kind) - order.indexOf(b.kind)));
}

async function deskData(env) {
  const nowMs = Date.now(), now = Math.floor(nowMs / 1000);
  const today = istDay(nowMs), yesterday = istDay(nowMs - 86400000);
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(istDay(nowMs - i * 86400000));
  const site = siteUrl(env), edition = parseInt(env.EDITION || "20", 10);
  const [counts, L, soldRaw] = await Promise.all([statsFor(env, days), ledger(env, nowMs), knownSold(env)]);
  const pays = L.pays || [];
  const unfinished = L.rzp ? await unfinishedBetween(env, pays, istWindow(yesterday)[0], now + 60) : [];
  const leads = await leadsBetween(env, 0, now + 60);

  const held = [];
  let lastHook = null, lastDigest = null;
  if (env.KAAL_STATE) {
    try {
      for (const k of (await env.KAAL_STATE.list({ prefix: HOLD_PREFIX })).keys) {
        const n = parseInt(k.name.slice(HOLD_PREFIX.length), 10);
        if (n) held.push(n);
      }
    } catch (e) { /* no holds shown */ }
    lastHook = await env.KAAL_STATE.get("seen:webhook").catch(() => null);
    try {
      const keys = (await env.KAAL_STATE.list({ prefix: "digest:" })).keys.map(k => k.name.slice(7)).sort();
      lastDigest = keys.length ? keys[keys.length - 1] : null;
    } catch (e) { lastDigest = null; }
  }

  const live = L.orders.filter(o => o.refund !== "full");
  const ordersOn = {}, revenueOn = {};
  for (const o of live) { ordersOn[o.day] = (ordersOn[o.day] || 0) + 1; revenueOn[o.day] = (revenueOn[o.day] || 0) + o.paise; }
  const sold = soldRaw ? soldRaw.slice().sort((a, b) => a - b) : null;
  const dials = {};
  for (let n = 1; n <= edition; n++) dials[n] = DIAL_OF(env, n);
  /* Who asked not to be written to, and, for someone who left a phone and
     no email, the nearly-bought note as a WhatsApp the owner sends by hand. */
  for (const u of unfinished) {
    if (u.email && env.KAAL_STATE) u.stopped = await stopped(env, u.email);
    if (!u.email && u.contact && sold) {
      const n = u.n >= 1 && u.n <= edition ? u.n : 0, dial = n ? dials[n] : "", open = !!n && sold.indexOf(n) < 0;
      const same = [];
      if (n && !open && dial) for (let k = 1; k <= edition; k++) if (k !== n && dials[k] === dial && sold.indexOf(k) < 0) same.push(k);
      u.wa = nearlyWhatsApp({ site, first: firstNameOf(u.name), n, open, dial, left: edition - sold.length, sameDial: same });
    }
  }
  const recentLeads = leads.slice(-50).reverse();
  if (env.KAAL_STATE) for (const l of recentLeads) l.stopped = await stopped(env, l.email);
  const mail = !!(env.RESEND_API_KEY || env.BREVO_API_KEY);
  const hour = parseInt(env.DIGEST_HOUR_IST || "0", 10);

  return {
    ok: true, now: indiaTime(new Date(nowMs)), today, yesterday, site, edition,
    c: { today: counts[today] || {}, yesterday: counts[yesterday] || {} },
    paid: { today: ordersOn[today] || 0, yesterday: ordersOn[yesterday] || 0, todayPaise: revenueOn[today] || 0, yesterdayPaise: revenueOn[yesterday] || 0 },
    trend: days.map(dd => ({ day: dd, visitors: (counts[dd] || {}).visitor || 0, numbers: (counts[dd] || {}).number || 0,
      checkouts: (counts[dd] || {}).checkout || 0, orders: ordersOn[dd] || 0 })),
    sold, held, dials, left: sold ? Math.max(0, edition - sold.length) : null,
    orders: L.orders.map(o => Object.assign({}, o, {
      shipUrl: o.orderId ? `${site}/claimed.html?o=${encodeURIComponent(o.orderId)}&n=${o.n ? pad2(o.n) : ""}#ship` : ""
    })),
    revenue: live.reduce((t, o) => t + o.paise, 0),
    unfinished,
    journeys: await histAsk(env, "/journeys", { o: L.orders.map(o => o.orderId).concat(unfinished.map(u => u.orderId)).filter(Boolean) }, {}),
    leads: { total: leads.length, today: leads.filter(l => istDay(l.ts * 1000) === today).length, recent: recentLeads },
    alerts: alertsFor(env, L, soldRaw, nowMs),
    health: [
      { ok: mail, label: "Emails", detail: mail ? `Order emails go to buyers, and alerts and the daily report to ${ownerInbox(env).join(", ")}.` : "Not sending: RESEND_API_KEY is not set on the worker." },
      { ok: L.rzp && L.pays !== null, label: "Razorpay", detail: !L.rzp ? "No keys on the worker: orders cannot be read." : L.pays === null ? "The keys are set, but Razorpay refused the listing." : `Reading payments from the last ${SALES_DAYS} days.` },
      { ok: !!lastHook || !live.length, label: "Payment webhook", detail: lastHook ? `Last heard from Razorpay ${indiaTime(new Date(lastHook))}.` : "Not heard from since this desk was switched on. It is heard at the next payment." },
      { ok: !!env.KAAL_STATE, label: "Store", detail: env.KAAL_STATE ? "Holds, addresses, dispatches and the Series 02 list are kept." : "Not connected: addresses, holds and the Series 02 list are not kept." },
      { ok: !!env.STATS, label: "Visitor count", detail: env.STATS ? `${(counts[today] || {}).visit || 0} page visits counted today, without cookies.` : "Not connected: the daily report has no visitor numbers." },
      { ok: !!(env.GITHUB_TOKEN && env.GITHUB_OWNER), label: "Sold list", detail: env.GITHUB_TOKEN ? "Each sale is written to the site within a minute." : "No GITHUB_TOKEN: sales are not written to the site." },
      { ok: env.DIGEST !== "off" && mail, label: "Daily report", detail: env.DIGEST === "off" ? "Switched off (DIGEST in wrangler.toml)." : `Every day at ${hour === 0 ? "midnight" : hour + ":00"}, India time${lastDigest ? `; last one covered ${lastDigest}` : ""}.` }
    ],
    counting: !!env.STATS, razorpay: L.rzp
  };
}

/* "Right now": the live view and today's totals so far, and nothing that
   has to ask Razorpay, so it can be asked every ten seconds and stay quick. */
/* ── The histories (section 5c), as the desk and the report ask for them. ── */
async function histAsk(env, path, body, fallback) {
  if (!env.STATS) return fallback;
  try {
    const r = await env.STATS.get(env.STATS.idFromName("kaal")).fetch("https://stats" + path,
      body ? { method: "POST", body: JSON.stringify(body) } : undefined);
    return r.ok ? await r.json() : fallback;
  } catch (e) { console.log("History read failed:", String(e).slice(0, 120)); return fallback; }
}
function histSince(r) {
  const now = Date.now();
  if (r === "today") return Date.parse(istDay(now) + "T00:00:00Z") - IST_MS;
  if (r === "7d") return now - 7 * 86400000;
  if (r === "30d") return now - 30 * 86400000;
  return now - HIST_DAYS * 86400000;
}
async function deskVisitors(env, q) {
  const p = new URLSearchParams({ since: String(histSince(q.get("r") || "today")), f: q.get("f") || "all",
    q: String(q.get("q") || "").slice(0, 60), off: String(Math.max(0, parseInt(q.get("off"), 10) || 0)), lim: "25" });
  const res = await histAsk(env, "/visitors?" + p, null, { ok: false, total: 0, rows: [] });
  return Object.assign({ on: !!env.STATS }, res);
}
/* Once a cron run: anyone not seen for ninety days is deleted. */
async function histPrune(env) {
  const r = await histAsk(env, "/prune", {}, null);
  if (r && r.deleted) console.log(`History: ${r.deleted} visitors not seen for ${HIST_DAYS} days deleted.`);
}
/* Two spreadsheets: one row per visitor, or one row per step. */
async function deskVisitorsCsv(env, q, everyStep) {
  const r = q.get("r") || "90d";
  const { rows } = await histAsk(env, "/rows?since=" + histSince(r), null, { rows: [] });
  const t = (ms) => ms ? indiaTime(new Date(ms)) : "";
  if (!everyStep) {
    const out = [["Visitor", "First seen (India time)", "Last seen", "Visits", "Time on site (min)", "Came from", "Device", "Landed on",
      "Name", "Phone", "Email", "City", "Dials looked at", "Numbers chosen", "Reached the twenty", "Opened checkout", "Gave details", "Paid for"]];
    for (const v of rows) out.push([v.k, t(v.first), t(v.last), v.visits, Math.round(v.time / 60000), sourceName(v.s, v.app), deviceName(v.os, v.dev), v.landed,
      v.name, v.phone, v.email, v.city, v.dials.join(" "), v.numbers.join(" "), v.twenty ? "yes" : "", v.checkout ? "yes" : "", v.details ? "yes" : "", v.paid.join(" ")]);
    return csv(out, "kaal-visitors-" + r);
  }
  const out = [["Visitor", "Name", "Visit", "When (India time)", "What they did", "Number", "Dial"]];
  for (const v of rows) {
    let visit = 0;
    for (const e of v.steps) {
      if (e.e === "visit") visit++;
      out.push([v.k, v.name, visit, t(e.t), stepText(e), e.no ? e.no : "", e.dial || ""]);
    }
  }
  return csv(out, "kaal-every-step-" + r);
}

async function deskLive(env) {
  const nowMs = Date.now(), today = istDay(nowMs);
  const [live, counts] = await Promise.all([liveFor(env), statsFor(env, [today])]);
  return { ok: true, at: indiaTime(new Date(nowMs)), now: nowMs, today, c: counts[today] || {}, live, counting: !!env.STATS };
}

/* The buyer's confirmation promised tracking "the day it leaves". This is
   how that promise is kept: one tap on the desk, the courier and number,
   and (when ticked) the email. The record is kept even when the email is
   not wanted, so an order sent before the desk existed stops being flagged. */
async function deskDispatch(request, env) {
  if (!deskWrite(request)) return deskJson({ ok: false, reason: "refused" }, 403);
  if (!env.KAAL_STATE) return deskJson({ ok: false, reason: "no-store" }, 503);
  let body;
  try { body = await request.json(); } catch (e) { return deskJson({ ok: false, reason: "bad-request" }, 400); }
  const orderId = String((body && body.o) || "");
  if (!ORDER_ID.test(orderId)) return deskJson({ ok: false, reason: "bad-order" }, 400);
  const key = "sent:" + orderId;
  if (body.undo === true) { await env.KAAL_STATE.delete(key); return deskJson({ ok: true, undone: true }); }

  const courier = cleanField(body.courier, 40), tracking = cleanField(body.tracking, 60);
  let url = cleanField(body.url, 300);
  if (url && !/^https:\/\/[^\s"'<>]+$/i.test(url)) url = "";

  const order = await readOrder(env, orderId);
  const n = parseInt(order && order.notes && order.notes.kaal_no, 10);
  if (!order || !n) return deskJson({ ok: false, reason: "unknown-order" }, 404);
  const pays = await paymentsOf(env, orderId);
  const good = pays.find(p => p.status === "captured" || p.status === "authorized");
  if (order.status !== "paid" && !good) return deskJson({ ok: false, reason: "not-paid" }, 409);

  const before = await env.KAAL_STATE.get(key, "json").catch(() => null);
  const rec = { at: new Date().toISOString(), courier, tracking, url, mailed: (before && before.mailed) || "" };
  const buyer = good && good.email && validEmail(String(good.email).toLowerCase()) ? String(good.email) : "";
  let mailed = false;
  if (body.notify === true && buyer) {
    const address = await env.KAAL_STATE.get("ship:" + orderId, "json").catch(() => null);
    const paidAt = good.created_at ? new Date(good.created_at * 1000) : new Date();
    /* The arrival date is only repeated while it is still ahead. */
    const promise = arriveByDay(paidAt) > istDay(Date.now()) ? arriveBy(paidAt) : "";
    const m = buyerDispatched({ site: siteUrl(env), n, courier, tracking, url, arriveBy: promise, address });
    mailed = await sendEmail(env, buyer, m.subject, m.text, m.html);
    if (mailed) rec.mailed = rec.at;
  }
  await env.KAAL_STATE.put(key, JSON.stringify(rec));
  return deskJson({ ok: true, mailed, to: mailed ? maskEmail(buyer) : "", sent: rec });
}

/* Inbound mail is not wired to this worker, so a reply saying "stop"
   reaches a person, and this is where they mark it. Kept for good, under
   the same hash as everything else kept about that person. */
async function deskStop(request, env) {
  if (!deskWrite(request)) return deskJson({ ok: false, reason: "refused" }, 403);
  if (!env.KAAL_STATE) return deskJson({ ok: false, reason: "no-store" }, 503);
  let body;
  try { body = await request.json(); } catch (e) { return deskJson({ ok: false, reason: "bad-request" }, 400); }
  const email = String((body && body.email) || "").trim().toLowerCase();
  if (!validEmail(email)) return deskJson({ ok: false, reason: "invalid" }, 400);
  const key = await stopKey(email);
  if (body.undo === true) { await env.KAAL_STATE.delete(key); return deskJson({ ok: true, stopped: false }); }
  await env.KAAL_STATE.put(key, JSON.stringify({ at: new Date().toISOString() }));
  return deskJson({ ok: true, stopped: true });
}

/* A spreadsheet opens these. A cell that starts like a formula is made
   plain text, so a name typed as "=HYPERLINK(...)" stays a name. */
function csvCell(v) {
  let s = String(v == null ? "" : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csv(rows, name) {
  const text = "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new Response(text, { headers: deskHeaders({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${istDay(Date.now())}.csv"` }) });
}
async function deskOrdersCsv(env) {
  const L = await ledger(env, Date.now());
  const rows = [["Number", "Dial", "Paid (India time)", "Amount (INR)", "Payment", "Order", "Email", "Phone", "Gift", "Gift card",
    "Name", "Address line 1", "Address line 2", "City", "State", "PIN", "Delivery phone", "Dispatched", "Courier", "Tracking", "Refund"]];
  for (const o of L.orders.slice().reverse()) {
    const a = o.address || {}, s = o.sent || {};
    rows.push([o.n ? pad2(o.n) : "", o.dial, o.at, (o.paise / 100).toFixed(2), o.id, o.orderId, o.email, o.contact, o.gift ? "yes" : "", o.giftNote,
      a.name, a.line1, a.line2, a.city, a.state, a.pin, a.phone, s.at ? indiaTime(new Date(s.at)) : "", s.courier, s.tracking, o.refund]);
  }
  return csv(rows, "kaal-orders");
}
async function deskLeadsCsv(env) {
  const leads = await leadsBetween(env, 0, Math.floor(Date.now() / 1000) + 60);
  return csv([["Email", "Form", "Joined (India time)"]].concat(leads.map(l => [l.email, l.source, l.at])), "kaal-series-02");
}

/* ══════════ 7. REFUNDS ══════════

   A refund is issued in Razorpay: from its dashboard, or by Razorpay on a
   cancellation. This worker finds it on its own. Every cron run lists the
   last fifteen days of refunds (the very first run looks back 180), and
   the webhook hands over refund.processed at once if Razorpay is told to
   send it. Each processed refund is recorded once, under refund:<id>, and
   told once: to the owner, and to the buyer in KAAL's words (Razorpay
   sends its own notice too; REFUND_EMAIL = "off" leaves it at that).

   A full refund never puts the number back on sale by itself. The watch
   may still be on its way back, or the owner may want that number retired
   for good. The desk asks, and only the owner's tap moves the sold list
   (POST /desk/release). ─────────────────── */
const REFUND_LOOKBACK = 15 * 86400, REFUND_FIRST_LOOKBACK = 180 * 86400, REFUNDS_PER_RUN = 6;

async function listRefunds(env, from, to) {
  const out = [];
  try {
    for (let skip = 0; skip < 500; skip += 100) {
      const res = await fetch(`${RZP_API}/refunds?from=${from}&to=${to}&count=100&skip=${skip}`, { headers: razorpayAuth(env) });
      if (!res.ok) { console.log("Refund listing failed:", res.status); return null; }
      const items = ((await res.json()) || {}).items || [];
      out.push(...items);
      if (items.length < 100) break;
    }
  } catch (e) { console.log("Refund listing threw:", String(e).slice(0, 120)); return null; }
  return out;
}

async function readPayment(env, id) {
  try {
    const res = await fetch(`${RZP_API}/payments/${encodeURIComponent(id)}`, { headers: razorpayAuth(env) });
    return res.ok ? await res.json() : null;
  } catch (e) { return null; }
}

async function refundWatch(env) {
  try {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.KAAL_STATE) return;
    const now = Math.floor(Date.now() / 1000);
    const first = !(await env.KAAL_STATE.get("refunds:looked").catch(() => null));
    const list = await listRefunds(env, now - (first ? REFUND_FIRST_LOOKBACK : REFUND_LOOKBACK), now + 60);
    if (!list) return;
    /* A few new ones per run keeps a run inside the Worker's request
       budget; the rest are simply found again half an hour later. */
    let fresh = 0;
    for (const r of list.sort((a, b) => a.created_at - b.created_at)) {
      if (fresh >= REFUNDS_PER_RUN) return;
      if ((await recordRefund(env, r)) === "new") fresh++;
    }
    if (first) await env.KAAL_STATE.put("refunds:looked", String(now));
  } catch (e) { console.log("Refund watch threw:", String(e).slice(0, 160)); }
}

/* "new" when recorded and told now, "seen" when it already was, "skip"
   when it is not a processed refund or Razorpay could not be read (it is
   tried again on the next run). */
async function recordRefund(env, r, payment) {
  if (!r || !r.id || !r.payment_id || !env.KAAL_STATE || r.status !== "processed") return "skip";
  const key = "refund:" + r.id;
  if (await env.KAAL_STATE.get(key).catch(() => null)) return "seen";
  if (!payment || payment.id !== r.payment_id) payment = await readPayment(env, r.payment_id);
  if (!payment) return "skip";

  let n = parseInt((payment.notes || {}).kaal_no, 10);
  if (!n && payment.order_id) n = await numberFromOrder(env, payment.order_id);
  n = n || 0;
  const back = Math.max(payment.amount_refunded || 0, r.amount || 0);
  const full = payment.status === "refunded" || back >= (payment.amount || 0);
  const when = new Date((r.created_at || Math.floor(Date.now() / 1000)) * 1000);
  const rec = { at: new Date().toISOString(), refundedAt: when.toISOString(), id: r.id, n, payment: payment.id,
    order: payment.order_id || "", amount: r.amount || 0, full };

  /* Written before anything is said, so a send that fails is never sent
     twice. The payment's own copy is what the desk's order list reads. */
  await env.KAAL_STATE.put(key, JSON.stringify(rec));
  await env.KAAL_STATE.put("refundof:" + payment.id, JSON.stringify(rec)).catch(() => null);
  if (full && n) {
    const cur = await env.KAAL_STATE.get("refunded:" + n, "json").catch(() => null);
    if (!cur || cur.payment !== payment.id) {
      await env.KAAL_STATE.put("refunded:" + n, JSON.stringify({ n, payment: payment.id, refund: r.id, at: rec.refundedAt, decided: "" }));
    }
  }

  if (env.RESEND_API_KEY || env.BREVO_API_KEY) {
    const email = String(payment.email || "").trim();
    const emailOk = email && validEmail(email.toLowerCase());
    const sold = (await knownSold(env)) || [];
    const d = {
      site: siteUrl(env), n, dial: n ? DIAL_OF(env, n) : "", amount: rupees(r.amount), paid: rupees(payment.amount), full,
      paymentId: payment.id, refundId: r.id, when: indiaTime(when), email: emailOk ? email : "", contact: String(payment.contact || ""),
      stillSold: !!(full && n && sold.indexOf(n) > -1), deskUrl: env.DESK_PASSCODE ? workerUrl(env) + "/desk" : "",
      buyerTold: !!(emailOk && env.REFUND_EMAIL !== "off")
    };
    const toOwner = ownerRefund(d);
    const sends = [sendEmail(env, ownerInbox(env), toOwner.subject, toOwner.text, toOwner.html, emailOk ? email : undefined)];
    if (emailOk && env.REFUND_EMAIL !== "off") {
      const toBuyer = buyerRefund(d);
      sends.push(sendEmail(env, email, toBuyer.subject, toBuyer.text, toBuyer.html));
    }
    await Promise.all(sends);
  }
  console.log(`Refund ${r.id} recorded${n ? " for No. " + pad2(n) : ""}${full ? " (full)" : ""}.`);
  return "new";
}

/* The owner's answer to a full refund, from the desk. Allowed only when
   Razorpay shows that number's payment fully refunded and no other payment
   for it still standing, so a number that has since sold again can never
   be released by a stale tap. "retire" only writes the answer down. */
async function deskRelease(request, env) {
  if (!deskWrite(request)) return deskJson({ ok: false, reason: "refused" }, 403);
  if (!env.KAAL_STATE) return deskJson({ ok: false, reason: "no-store" }, 503);
  let body;
  try { body = await request.json(); } catch (e) { return deskJson({ ok: false, reason: "bad-request" }, 400); }
  const n = parseInt(body && body.n, 10), action = body && body.action;
  if (!(n >= 1 && n <= parseInt(env.EDITION || "20", 10)) || (action !== "sell" && action !== "retire")) {
    return deskJson({ ok: false, reason: "bad-request" }, 400);
  }
  const L = await ledger(env, Date.now());
  if (L.rzp && L.pays === null) return deskJson({ ok: false, reason: "razorpay" }, 502);
  const mine = L.orders.filter(o => o.n === n);
  const refunded = mine.find(o => o.refund === "full");
  if (!refunded) return deskJson({ ok: false, reason: "not-refunded" }, 409);
  if (mine.some(o => o.refund !== "full")) return deskJson({ ok: false, reason: "sold-again" }, 409);

  const prev = (await env.KAAL_STATE.get("refunded:" + n, "json").catch(() => null)) || { n, payment: refunded.id };
  if (action === "sell") {
    const r = await releaseSold(env, n, `refunded, payment ${refunded.id}`);
    if (r.status === "error") return deskJson({ ok: false, reason: "github" }, 502);
  }
  const rec = Object.assign({}, prev, { decided: action, decidedAt: new Date().toISOString() });
  await env.KAAL_STATE.put("refunded:" + n, JSON.stringify(rec));
  return deskJson({ ok: true, n, decided: action });
}

/* Refunds recorded in a window, for the morning report. */
async function refundsBetween(env, from, to) {
  if (!env.KAAL_STATE) return [];
  const out = [];
  try {
    let cursor;
    do {
      const page = await env.KAAL_STATE.list({ prefix: "refund:", cursor });
      for (const k of page.keys || []) {
        const v = await env.KAAL_STATE.get(k.name, "json").catch(() => null);
        const t = v && Date.parse(v.refundedAt) / 1000;
        if (v && t >= from && t < to) out.push(v);
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  } catch (e) { console.log("Refund listing (KV) failed:", String(e).slice(0, 120)); }
  return out.sort((a, b) => (a.refundedAt < b.refundedAt ? -1 : 1));
}

/* ══════════ 4. PLUMBING ══════════ */

const pad2 = (n) => (n < 10 ? "0" + n : String(n));
const rupees = (paise) => `₹${((paise || 0) / 100).toLocaleString("en-IN")}`;
const isText = (v) => typeof v === "string" && v.length > 0 && v.length < 256;

/* The number, from the one copy of it a browser never touched. /order
   wrote it onto the order; this reads it back. Both the webhook and
   /verify need exactly this, which is why it is not written twice. */
async function readOrder(env, orderId) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !orderId) return null;
  try {
    const res = await fetch(`${RZP_API}/orders/${encodeURIComponent(orderId)}`, { headers: razorpayAuth(env) });
    if (!res.ok) { console.log("Order read-back failed:", res.status); return null; }
    return await res.json();
  } catch (e) {
    console.log("Order read-back threw:", String(e).slice(0, 120));
    return null;
  }
}

async function numberFromOrder(env, orderId) {
  const order = await readOrder(env, orderId);
  return parseInt(order && order.notes && order.notes.kaal_no, 10);
}

/* ══════════ 3b. TELLING META ══════════

   The browser's Pixel fires Purchase on claimed.html, and on iOS, in
   Safari and behind an ad blocker it often never arrives. This is the
   server's copy of the same purchase, sent once the webhook has proved
   the money is real. Both carry the Razorpay payment id as the event id,
   so Meta counts the pair as one sale rather than two.

   Entirely optional. Without META_PIXEL_ID and META_CAPI_TOKEN it returns
   before doing anything, and nothing it does can fail a sale: it runs
   after the sale is recorded and swallows its own errors.

   Email and phone are hashed (SHA-256) before they leave this worker, as
   Meta requires; nothing is sent in the clear. */
async function sendPurchaseToMeta(env, entity, chosen) {
  if (!env.META_PIXEL_ID || !env.META_CAPI_TOKEN) return;
  try {
    let m = entity.notes || {};
    if (!m.ua && entity.order_id) {
      const order = await readOrder(env, entity.order_id);
      m = (order && order.notes) || m;
    }
    /* Meta rejects a "website" event without the browser's user agent.
       The hosted Payment Page route never passes through /order, so it
       has none; the browser Pixel is its only record. */
    if (!m.ua) { console.log("Meta CAPI skipped: no user agent on the order."); return; }

    const user = { client_user_agent: m.ua, country: [await sha256hex("in")] };
    if (m.ip)  user.client_ip_address = m.ip;
    if (m.fbp) user.fbp = m.fbp;
    if (m.fbc) user.fbc = m.fbc;
    const email = String(entity.email || "").trim().toLowerCase();
    if (email) user.em = [await sha256hex(email)];
    let phone = String(entity.contact || "").replace(/\D/g, "");
    if (phone.length === 10) phone = "91" + phone;
    if (phone) user.ph = [await sha256hex(phone)];

    const payload = {
      data: [{
        event_name: "Purchase",
        event_time: entity.created_at || Math.floor(Date.now() / 1000),
        event_id: String(entity.id),
        action_source: "website",
        event_source_url: "https://thekaal.co/claimed.html",
        user_data: user,
        custom_data: {
          currency: entity.currency || "INR",
          value: (entity.amount || 0) / 100,
          content_ids: ["KAAL-" + pad2(chosen)],
          content_type: "product"
        }
      }]
    };
    if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

    const ver = env.META_API_VERSION || "v23.0";
    const res = await fetch(`https://graph.facebook.com/${ver}/${encodeURIComponent(env.META_PIXEL_ID)}/events?access_token=${encodeURIComponent(env.META_CAPI_TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) console.log("Meta CAPI refused the purchase:", res.status, (await res.text()).slice(0, 300));
  } catch (e) {
    console.log("Meta CAPI call threw:", String(e).slice(0, 160));
  }
}

/* The browser half of the match, taken at /order. _fbp and _fbc are the
   Pixel's own first-party cookies, passed up by the page; the user agent
   and IP are read off the request itself. Each is capped to fit a
   Razorpay note. */
function metaMatch(request, body) {
  const out = {};
  const ua = request.headers.get("user-agent") || "";
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (ua) out.ua = ua.slice(0, 250);
  if (ip) out.ip = ip.slice(0, 64);
  const fbp = cleanNote(body && body.fbp, 120), fbc = cleanNote(body && body.fbc, 250);
  if (/^fb\.\d\.\d+\.\d+$/.test(fbp)) out.fbp = fbp;
  if (/^fb\.\d\.\d+\.[\w-]+$/.test(fbc)) out.fbc = fbc;
  return out;
}

function cleanNote(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function razorpayAuth(env) {
  return {
    "Authorization": "Basic " + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`),
    "User-Agent": "kaal-edition-worker"
  };
}

async function readSold(env) {
  if (!env.KAAL_STATE) return null;
  try {
    const v = await env.KAAL_STATE.get(KEY_SOLD, "json");
    return Array.isArray(v) ? v : null;
  } catch (e) { return null; }
}

/* KV is the fast answer and index.html is the true one. Before the KV
   namespace exists KV has no answer at all, and /order without an answer
   would happily price a watch that is already on somebody's wrist. So
   the file itself is the fallback: the worker already holds a token that
   reads it, and at twenty units one extra GitHub call per order is
   nothing. This is what lets Standard Checkout enforce the edition on
   day one, before any KV namespace has been created. */
async function knownSold(env) {
  const kv = await readSold(env);
  if (kv) return kv;
  return readSoldFromGitHub(env);
}

async function readSoldFromGitHub(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) return null;
  const branch = env.GITHUB_BRANCH || "main";
  try {
    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/index.html?ref=${branch}`,
      { headers: {
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "kaal-edition-worker"
        } }
    );
    if (!res.ok) { console.log("Edition read from GitHub failed:", res.status); return null; }
    const file = await res.json();
    const match = atob(file.content.replace(/\n/g, "")).match(/sold:\s*\[([^\]]*)\]/);
    if (!match) return null;
    return match[1].split(",").map(x => parseInt(x.trim(), 10)).filter(x => !isNaN(x));
  } catch (e) {
    console.log("Edition read from GitHub threw:", String(e).slice(0, 120));
    return null;
  }
}

/* One HMAC for both things that need one: the webhook's body signature
   and the checkout's order|payment signature. They are the same
   primitive with the same secret shape, and two copies of a crypto
   routine is one copy too many to keep correct. */
async function hmacHex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(body, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  return timingSafeEqual(await hmacHex(body, secret), signatureHeader);
}

/* `a === b` on a string returns as soon as two characters differ, so the
   time it takes leaks how much of a guess was right. That is the textbook
   way to be walked character by character towards a valid signature. This
   always reads both strings to the end. */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function allowedOrigin(request, env) {
  const list = (env.ALLOW_ORIGIN || "https://thekaal.co,https://www.thekaal.co").split(",").map(s => s.trim());
  const origin = request.headers.get("Origin") || "";
  return list.indexOf(origin) > -1 ? origin : list[0];
}

function cors(request, env) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(request, env),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function preflight(request, env) {
  return new Response(null, { status: 204, headers: cors(request, env) });
}

function json(request, env, body, extra, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, cors(request, env), extra || {})
  });
}

/* ══════════════════════════════════════════════════════════════════
   SETUP — do this once, after your Razorpay Payment Page is live.

   1. Free Cloudflare account. `npm i -g wrangler`, then from the repo
      root: `wrangler deploy` (wrangler.toml is beside this file).
      There is still no build step; the file deploys as it is.

   2. Create the KV namespace the holds live in, once:

        wrangler kv namespace create KAAL_STATE

      Paste the id it prints into wrangler.toml. Skip this and
      everything still works exactly as it did before holds existed:
      /state answers "no opinion" and the page trusts its own array.

   3. Set the secrets (`wrangler secret put NAME`, one at a time):
        RAZORPAY_WEBHOOK_SECRET   from Razorpay Dashboard -> Webhooks
        GITHUB_TOKEN              fine-grained PAT, scoped ONLY to the
                                   KAAL repo, Contents: Read and write.
                                   It does NOT need Workflows, and must
                                   not be given it.
      And the plain vars in wrangler.toml: GITHUB_OWNER, GITHUB_REPO,
      EDITION, ALLOW_ORIGIN.

   4. In Razorpay Dashboard -> Webhooks, add an endpoint pointing at the
      deployed worker's root URL, subscribe to `payment.captured`, use
      the same secret as RAZORPAY_WEBHOOK_SECRET. Razorpay shows the
      secret once, at creation — save it immediately.

   5. On the Payment Page, confirm the custom field capturing the chosen
      number is literally named `kaal_no`. That is the only reason this
      chain works.

   6. Put the deployed URL into index.html as `api:` in the KAAL config.
      Leave it empty and the page behaves exactly as it does today.

   6b. (October 2026) The Series 02 list needs the KV namespace from step
      2; nothing else. The abandoned-checkout email needs it too, plus a
      provider key and ABANDON_EMAIL = "on" — docs/email.md, and it is
      off until then. The cron in wrangler.toml deploys with the worker.

   7. Send one real ₹1 test transaction before trusting this with a real
      ₹5,999 one. Watch `wrangler tail`, watch the commit land, watch the
      live site's count move. Do this before turning Meta ads on.
   ══════════════════════════════════════════════════════════════════ */
