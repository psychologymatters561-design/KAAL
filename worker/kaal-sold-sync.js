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

     POST /order {n}    the order for that number, priced by this file
     POST /verify {..}  the signature, checked before anything is believed

   AND WHAT META IS TOLD. One more route, and one more job for the webhook:

     POST /event {..}   the server's copy of a browsing event the Pixel
                        just sent, under the same event id

   Every event the page sends to the Pixel is sent here too, with the id
   the Pixel was given, and this worker forwards it to the Conversions
   API with the buyer's IP and browser attached. Meta sees both, matches
   them on (event name, event id), and counts one. Purchase is the
   exception and never comes through /event: a browser cannot say that
   money moved. The webhook says it, once per order, after Razorpay has
   signed for it — see TELLING META below.

   Two things about /order are the whole point of it existing. It reads
   the price from PRICE_PAISE and ignores whatever the browser said the
   watch costs — a page that can name its own price is a page that sells
   a ₹5,999 watch for ₹1. And it refuses a number that is already sold
   or held by somebody else, which is the job the Payment Page's stock
   limit used to do and nothing else was doing.

   THE LOCK. This file used to say: move `hold` and `sold` into a Durable
   Object "when the cadence arrives". Paid ads arrived, and with them the
   one fact that makes collisions likely rather than rare: every visitor
   lands with the same number already chosen (the first one open), so the
   buyers an ad sends all reach for it at once. Workers KV could not stop
   that. It takes up to a minute to agree with itself across the world, and
   "is 03 free? then hold it" was two steps with a gap between them.

   So the edition now lives in ONE Durable Object (class Edition, below).
   Cloudflare runs exactly one copy of it and hands it requests one at a
   time, which turns "check, then hold" into a single step nothing can get
   between. It answers four questions:

     claim   may this buyer hold this number for twelve minutes?
     check   has somebody else's order already bought it?
     sell    record that this captured order bought it
     mark    has this one-time thing (a Purchase sent, a refund made)
             already happened?

   /order claims before it prices, and the page closes Razorpay's checkout
   two minutes before the hold runs out, so a payment cannot be finished on
   a number the buyer no longer holds. A second payment for a number that a
   different captured order already owns is refunded in full, at once and
   automatically — which is what legal.html promises — and is never told to
   Meta as a sale. AUTO_REFUND = "0" turns the refund off and leaves it to
   a person, with the case in the logs.

   The lock only refunds what it can prove. It records an owner only from a
   captured payment's webhook, and it refunds only a payment whose number
   it has seen captured by a DIFFERENT order. Where nobody is on record —
   a number sold before the lock kept owners — the payment is recorded and
   nobody is refunded on a guess: refunding a real buyer would be worse
   than the problem this solves.

   Without the Durable Object bound (an old wrangler.toml) every route
   falls back to the KV behaviour this file had before, which is weaker
   but never broken.

   WHAT THIS STILL DOES NOT DO: it is not a database, a cart, or an
   inventory system. It holds one small record and edits one line of one
   file, because that is the entire footprint of "sold" in this codebase.
   ══════════════════════════════════════════════════════════════════ */

const HOLD_SECONDS = 12 * 60;
/* How long Razorpay's checkout stays open. Shorter than the hold, so a
   payment can never be completed on a number whose hold has already lapsed
   and passed to somebody else. The page is told this by /order. */
const CHECKOUT_SECONDS = HOLD_SECONDS - 2 * 60;
const KEY_SOLD = "sold";
const HOLD_PREFIX = "hold:";
const RZP_API = "https://api.razorpay.com/v1";
const MIN_PAISE = 100;          /* Razorpay rejects anything under this */

/* The Pixel this worker reports to. Public — it is in assets/tags.js and in
   every page's noscript tag — so it lives in the code rather than as a
   secret; META_PIXEL_ID, if set, still wins. tools/check.mjs fails the
   build if this and tags.js ever disagree. */
const PIXEL_ID = "1607748840888926";
const SERIES   = "series01";        /* content_ids are series01-01 … series01-20 */
const DIALS    = ["Emerald", "Midnight", "Champagne", "Ivory"];

/* What /event will forward, and nothing else. Purchase is not on it and
   must never be: it is sent from the webhook, after a signature. */
const RELAYED = ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "ChooseNumber", "GiftOrder"];

export default {
  async fetch(request, env, ctx) {
    const url  = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return preflight(request, env);

    if (request.method === "GET" && path === "/state") return getState(request, env);
    if (request.method === "POST" && path === "/hold") return postHold(request, env);
    if (request.method === "POST" && path === "/order") return postOrder(request, env);
    if (request.method === "POST" && path === "/verify") return postVerify(request, env);
    if (request.method === "POST" && path === "/event") return postEvent(request, env, ctx);
    if (request.method === "POST") return webhook(request, env, ctx);   /* Razorpay posts to the root */

    return new Response("KAAL edition worker is alive.", { status: 200 });
  }
};

/* ══════════ 0. THE EDITION, ONE REQUEST AT A TIME ══════════

   The Durable Object. One instance, named after the series, holds the whole
   edition as one small record:

     sold    numbers that are gone (from captured payments, and from what
             index.html and KV already said when a request passed it in)
     owner   number → the Razorpay order that bought it; only ever written
             by a captured payment's webhook
     holds   number → { by, until }: who is paying for it, and until when
     marks   one-time markers — "Purchase sent to Meta for order X",
             "refund issued for payment Y" — each tested and set in one step

   Every request reads the record, decides, and writes it back without
   waiting on anything else in between, so Cloudflare's guarantee that a
   Durable Object handles its storage one request at a time is what makes
   each answer atomic. Written in the plain fetch style so it needs no
   imports and runs unchanged under tools/test-worker.mjs. */
export class Edition {
  constructor(state) { this.storage = state.storage; }

  async fetch(request) {
    let a;
    try { a = await request.json(); } catch (e) { return Response.json({ error: "bad-request" }, { status: 400 }); }
    const now = Date.now();
    const s = (await this.storage.get("s")) || { sold: [], owner: {}, holds: {}, marks: {} };
    let dirty = false, out;

    for (const k of Object.keys(s.holds)) if (!(s.holds[k].until > now)) { delete s.holds[k]; dirty = true; }
    /* What the caller already knows is sold (index.html, KV) is folded in
       on a claim or a read — never on a sale, where a number this very
       order was just recorded under must not look like somebody else's. */
    if ((a.op === "claim" || a.op === "state") && Array.isArray(a.known)) {
      for (const x of a.known) {
        const k = parseInt(x, 10);
        if (k > 0 && s.sold.indexOf(k) < 0) { s.sold.push(k); dirty = true; }
      }
    }
    const n = parseInt(a.n, 10);

    switch (a.op) {
      case "state":
        out = { sold: s.sold.slice().sort((x, y) => x - y), held: Object.keys(s.holds).map(Number) };
        break;
      case "claim": {
        if (s.sold.indexOf(n) > -1) { out = { ok: false, reason: "sold" }; break; }
        const h = s.holds[n];
        if (h && h.by !== a.by) { out = { ok: false, reason: "held", until: h.until }; break; }
        s.holds[n] = { by: String(a.by), until: now + a.ttl * 1000 };
        dirty = true;
        out = { ok: true, until: s.holds[n].until };
        break;
      }
      case "release":
        if (s.holds[n] && s.holds[n].by === a.by) { delete s.holds[n]; dirty = true; }
        out = { ok: true };
        break;
      case "check": {
        const who = s.owner[n];
        out = { conflict: !!(who && who !== a.order) };
        break;
      }
      case "sell": {
        const who = s.owner[n];
        if (who && who !== a.order) { out = { status: "conflict", owner: who }; break; }
        if (who === a.order) { out = { status: "already" }; break; }
        /* No owner yet: this captured order is it. That holds even when the
           number is already in `sold` — /verify marks a paid number sold a
           few seconds before its webhook lands, and a number sold before
           the lock kept owners has nobody on record to prefer. Either way
           nobody is refunded on a guess. */
        s.owner[n] = String(a.order);
        if (s.sold.indexOf(n) < 0) s.sold.push(n);
        delete s.holds[n];
        dirty = true;
        out = { status: "new" };
        break;
      }
      case "mark":
        if (s.marks[a.key]) { out = { was: true }; break; }
        s.marks[a.key] = now;
        dirty = true;
        out = { was: false };
        break;
      case "unmark":
        if (s.marks[a.key]) { delete s.marks[a.key]; dirty = true; }
        out = { ok: true };
        break;
      default:
        out = { error: "unknown-op" };
    }
    if (dirty) await this.storage.put("s", s);
    return Response.json(out);
  }
}

/* One door to the lock, for every route. */
async function lock(env, body) {
  const stub = env.LOCK.get(env.LOCK.idFromName(SERIES));
  const res = await stub.fetch("https://edition.internal/", { method: "POST", body: JSON.stringify(body) });
  return res.json();
}

/* One-time markers: the lock's when there is one, KV's otherwise. Returns
   true if this is the first time `key` has been seen. */
async function firstTime(env, key) {
  if (env.LOCK) return !(await lock(env, { op: "mark", key })).was;
  if (env.KAAL_STATE) {
    if (await env.KAAL_STATE.get(key).catch(() => null)) return false;
    await env.KAAL_STATE.put(key, "1", { expirationTtl: 7 * 24 * 3600 }).catch(() => {});
  }
  return true;
}
async function forget(env, key) {
  if (env.LOCK) await lock(env, { op: "unmark", key }).catch(() => {});
  else if (env.KAAL_STATE) await env.KAAL_STATE.delete(key).catch(() => {});
}

/* ══════════ 1. WHAT THE PAGE ASKS ══════════ */

/* The page merges this into what it already believes. It only ever ADDS
   numbers to its sold set from here, never removes one — so a KV that is
   empty, cold, or briefly unreachable cannot un-sell a watch. A backend
   that can only ever be more cautious than the static page is a backend
   that cannot take the site down. */
async function getState(request, env) {
  if (env.LOCK) {
    try {
      const s = await lock(env, { op: "state", known: (await readSold(env)) || [] });
      return json(request, env, { sold: s.sold, held: s.held, at: Date.now() }, { "Cache-Control": "public, max-age=10" });
    } catch (e) { console.log("Lock unreachable on /state:", String(e).slice(0, 120)); }
  }
  if (!env.KAAL_STATE) return json(request, env, { sold: null, held: [] });

  const sold = await readSold(env);
  const held = [];
  const now = Date.now();
  try {
    const list = await env.KAAL_STATE.list({ prefix: HOLD_PREFIX });
    for (const k of list.keys) {
      const n = parseInt(k.name.slice(HOLD_PREFIX.length), 10);
      if (!isNaN(n)) held.push(n);
    }
  } catch (e) { /* a listing that fails is a page with no holds, not an error */ }

  return json(request, env, { sold, held, at: now }, { "Cache-Control": "public, max-age=10" });
}

async function postHold(request, env) {
  if (!env.KAAL_STATE && !env.LOCK) return json(request, env, { ok: false, reason: "no-store" });

  let body;
  try { body = await request.json(); } catch (e) { return json(request, env, { ok: false, reason: "bad-request" }, {}, 400); }

  const n  = parseInt(body && body.n, 10);
  const by = buyerToken(body);
  const edition = parseInt(env.EDITION || "20", 10);
  if (isNaN(n) || n < 1 || n > edition) return json(request, env, { ok: false, reason: "out-of-range" }, {}, 400);

  if (env.LOCK) {
    const c = await lock(env, { op: "claim", n, by, ttl: HOLD_SECONDS, known: (await knownSold(env)) || [] });
    return c.ok ? json(request, env, { ok: true, n, until: c.until }) : json(request, env, { ok: false, reason: c.reason });
  }

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
async function postOrder(request, env) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    console.log("/order called before the Razorpay key pair was set.");
    return json(request, env, { ok: false, reason: "not-configured" }, {}, 503);
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return json(request, env, { ok: false, reason: "bad-request" }, {}, 400); }

  const edition = parseInt(env.EDITION || "20", 10);
  const n  = parseInt(body && body.n, 10);
  const by = buyerToken(body);
  /* A gift is a flag and a short note for the card in the box. Both go on
     the order, where they are read at packing time. The note is plain
     text, one line, capped well under Razorpay's 256-character note limit. */
  const gift = !!(body && body.gift === true);
  const giftNote = gift ? cleanNote(body && body.gift_note, 200) : "";
  if (isNaN(n) || n < 1 || n > edition) {
    return json(request, env, { ok: false, reason: "out-of-range" }, {}, 400);
  }

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

  /* THE LOCK. The number is claimed BEFORE it is priced, in one step that
     no other buyer's request can get between. A number somebody else is
     paying for is refused here, before any money is asked for; your own
     claim is extended, so reloading and trying again still works. */
  let claimed = false;
  if (env.LOCK) {
    const c = await lock(env, { op: "claim", n, by, ttl: HOLD_SECONDS, known: sold || [] });
    if (!c.ok) return json(request, env, { ok: false, reason: c.reason }, {}, 409);
    claimed = true;
  } else if (env.KAAL_STATE) {
    /* Somebody else's hold stops an order exactly as it stops a hold. Your
       own does not, so reloading the page and trying again still works. */
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
    if (claimed) await lock(env, { op: "release", n, by }).catch(() => {});
    return json(request, env, { ok: false, reason: "upstream" }, {}, 500);
  }

  /* No order, no hold: a number must not sit locked behind a checkout
     that never opened. */
  if (!res.ok || !order || !order.id) {
    if (claimed) await lock(env, { op: "release", n, by }).catch(() => {});
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
  let heldFor = claimed ? HOLD_SECONDS : 0;
  if (!claimed && env.KAAL_STATE) {
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
    /* Razorpay's checkout closes itself after this many seconds — two
       minutes inside the hold, so no payment can finish on a number that
       has meanwhile passed to somebody else. Only sent with a real lock. */
    timeout: claimed ? CHECKOUT_SECONDS : 0
  });
}

/* The buyer's anonymous token, from the page. A request without one gets a
   random one of its own, so two token-less buyers are never mistaken for
   the same person and handed each other's hold. */
function buyerToken(body) {
  const t = typeof (body && body.by) === "string" ? body.by.replace(/[^\w.-]/g, "").slice(0, 64) : "";
  return t || "anon-" + crypto.randomUUID();
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
  const order = await readOrder(env, orderId);
  const n = parseInt(order && order.notes && order.notes.kaal_no, 10) || 0;

  /* The one case where a real payment must NOT be greeted with "it's
     yours": a different order has already been captured for this number.
     The buyer is told so on the spot, with no Purchase record, and the
     webhook refunds the payment when Razorpay confirms it. */
  if (n && env.LOCK) {
    const c = await lock(env, { op: "check", n, order: orderId }).catch(() => ({}));
    if (c.conflict) {
      console.log(`/verify: order ${orderId} paid for No. ${pad2(n)}, which another order already bought.`);
      return json(request, env, { ok: true, n, conflict: true, refund: env.AUTO_REFUND === "0" ? "manual" : "automatic" });
    }
  }

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

  return json(request, env, { ok: true, n: n || null, purchase: await purchaseRecord(env, order, orderId, paymentId, n) });
}

/* THE ONLY THING THAT LETS A BROWSER SAY "PURCHASE".

   claimed.html used to fire the Pixel's Purchase for anybody who opened it
   with a payment id in the address bar — any string, from anyone, at
   ₹5,999 a time. Now the page carries this record from here to there in
   sessionStorage, fires once if and only if it holds one for the payment
   in its address, and throws it away. A reload, the back button, a
   bookmark or a shared link finds nothing and sends nothing.

   event_id is the ORDER id, and so is the webhook's. One order is one
   watch: a card declined and retried inside the same checkout is two
   payments against one order, and still exactly one Purchase.

   Email and telephone come from Razorpay's copy of the payment, hashed
   here. They go back only to the browser that just proved, with a
   signature, that it made this payment — they are the buyer's own. */
async function purchaseRecord(env, order, orderId, paymentId, n) {
  const paise = (order && order.amount) || parseInt(env.PRICE_PAISE || "0", 10);
  const rec = {
    event_id:   String(orderId),
    order_id:   String(orderId),
    payment_id: String(paymentId),
    no:         n ? pad2(n) : "",
    value:      paise / 100,
    currency:   (order && order.currency) || env.CURRENCY || "INR"
  };
  const payment = await readPayment(env, paymentId);
  if (payment && payment.order_id === orderId) {
    const h = await hashedContact(payment);
    if (h.em) rec.em = h.em;
    if (h.ph) rec.ph = h.ph;
  }
  return rec;
}

/* ══════════ 3. WHAT RAZORPAY SAYS ══════════ */

async function webhook(request, env, ctx) {
  const rawBody   = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";

  const valid = await verifySignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
  if (!valid) return new Response("Signature mismatch.", { status: 400 });

  let event;
  try { event = JSON.parse(rawBody); }
  catch (e) { return new Response("Bad JSON.", { status: 400 }); }

  if (event.event !== "payment.captured") {
    return new Response("Ignored: " + String(event.event).slice(0, 60), { status: 200 });
  }

  const entity    = (event.payload && event.payload.payment && event.payload.payment.entity) || {};
  const notes     = entity.notes || {};
  const paymentId = entity.id || "unknown";

  /* Which number sold. The ORDER's note first: /order wrote it there
     itself, somewhere no browser can reach. The PAYMENT's note is only
     the fallback, because nothing here wrote it — Standard Checkout puts
     it there from the browser's checkout options, where a buyer who
     edits the page can type any number they like over the one they were
     priced for. The Payment Page route has no order note at all, which
     is the one case the payment's copy is still read for. */
  const order  = entity.order_id ? await readOrder(env, entity.order_id) : null;
  const raw    = (order && order.notes && order.notes.kaal_no) || notes.kaal_no;
  const chosen = parseInt(raw, 10);

  /* THE LOCK DECIDES WHOSE IT IS. The first captured order for a number
     owns it. A second, different order that also got paid — two tabs open
     at once, a hold that ran out mid-payment — is refunded in full here,
     is never recorded as a sale, and is never told to Meta as one. */
  if (env.LOCK && chosen > 0 && entity.order_id) {
    const sale = await lock(env, { op: "sell", n: chosen, order: String(entity.order_id) });
    if (sale.status === "conflict") {
      const r = await refundConflict(env, entity, chosen, sale.owner);
      if (r === "failed") return new Response("Double payment — refund failed, will retry.", { status: 502 });
      return new Response(`Number ${chosen} already sold to ${sale.owner}; payment ${paymentId} ${r === "manual" ? "left for a manual refund" : "refunded"}.`, { status: 200 });
    }
  }

  /* Meta hears about the money whatever happens to the commit below. It
     used to be told only after GitHub accepted the new sold array, so an
     expired token, a busy API or a retry of a sale already recorded all
     meant that Meta never learnt a purchase had happened at all. It is
     idempotent per order (see sendPurchaseToMeta), so the retries that a
     failed commit asks Razorpay for cannot send it twice. */
  const meta = sendPurchaseToMeta(env, entity, order, chosen);
  if (ctx && ctx.waitUntil) ctx.waitUntil(meta); else await meta;

  /* A test-mode payment is not a sale. Without this, a single rehearsal
     with Razorpay's test keys would commit a real number as SOLD to the
     live page. The test worker (wrangler.toml [env.test]) sets
     COMMIT_SOLD = "0"; a test key id turns it off here as well, in case
     somebody ever pastes one into the production worker. */
  if (commitDisabled(env)) {
    console.log(`Test mode: payment ${paymentId} for number ${raw} verified, NOT recorded as sold.`);
    return new Response("Test mode — verified, not recorded.", { status: 200 });
  }

  /* The upper bound is read from the file itself rather than written
     here. The old `chosen > 20` was a second copy of `edition`, and the
     day the edition changes is exactly the day nobody would think to
     look in a worker for the reason a real sale went unrecorded. */
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
  return new Response(`OK — number ${chosen} recorded as sold.`, { status: 200 });
}

/* legal.html: "where two orders reach us for the same number, the earlier
   captured payment stands and the later one is refunded in full". This is
   that sentence, kept without anybody having to notice first. Once per
   payment, in full, at normal speed; a refund Razorpay says is already
   done counts as done. A refund that fails asks Razorpay to send the
   webhook again, so it is retried rather than forgotten. */
async function refundConflict(env, entity, n, owner) {
  const paymentId = String(entity.id || "");
  console.log(`DOUBLE PAYMENT: ${paymentId} (order ${entity.order_id}) for No. ${pad2(n)}, already sold to ${owner}.`);
  if (env.AUTO_REFUND === "0" || !paymentId) return "manual";
  const key = "refund:" + paymentId;
  if (!(await firstTime(env, key))) return "already";
  try {
    const res = await fetch(`${RZP_API}/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, razorpayAuth(env)),
      body: JSON.stringify({
        speed: "normal",
        receipt: ("dup-" + paymentId).slice(0, 40),
        notes: { reason: `No. ${pad2(n)} was already sold to an earlier order`, kaal_no: pad2(n) }
      })
    });
    if (res.ok) return "refunded";
    const text = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 400 && /refunded/i.test(text)) return "refunded";
    console.log("Refund refused:", res.status, text);
  } catch (e) {
    console.log("Refund call threw:", String(e).slice(0, 160));
  }
  await forget(env, key);
  return "failed";
}

const testKeys = (env) => /^rzp_test_/.test(env.RAZORPAY_KEY_ID || "");
const commitDisabled = (env) => env.COMMIT_SOLD === "0" || testKeys(env);

/* Read, modify, write — and mean it. Two webhooks landing together both
   read the same blob sha, and the second PUT is rejected with a 409. The
   old build returned 502 and left it to Razorpay's retry schedule, which
   is minutes. Three attempts here closes it in milliseconds. */
async function commitSold(env, chosen, paymentId) {
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
    if (!chosen || isNaN(chosen) || chosen < 1 || chosen > edition) return { status: "bad-number" };

    const soldPattern = /sold:\s*\[([^\]]*)\]/;
    const match = decoded.match(soldPattern);
    if (!match) {
      console.log("Could not find `sold:` array — has index.html's config shape changed?");
      return { status: "error" };
    }

    const current = match[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (current.indexOf(chosen) > -1) return { status: "already" };

    const updated = current.concat([chosen]).sort((a, b) => a - b);
    const putRes = await fetch(api, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify({
        message: `Auto: mark number ${chosen} sold (payment ${paymentId})`,
        content: btoa(decoded.replace(soldPattern, `sold:     [${updated.join(", ")}]`)),
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

/* ══════════ 4. PLUMBING ══════════ */

const pad2 = (n) => (n < 10 ? "0" + n : String(n));
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

/* The payment itself, for the two things only Razorpay's copy of it holds:
   the email and telephone the buyer typed into checkout, which this page
   never sees because checkout is Razorpay's own frame. */
async function readPayment(env, paymentId) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !paymentId) return null;
  try {
    const res = await fetch(`${RZP_API}/payments/${encodeURIComponent(paymentId)}`, { headers: razorpayAuth(env) });
    if (!res.ok) { console.log("Payment read failed:", res.status); return null; }
    return await res.json();
  } catch (e) {
    console.log("Payment read threw:", String(e).slice(0, 120));
    return null;
  }
}

/* ══════════ 3b. TELLING META ══════════

   Two routes into the Conversions API, one door out (sendToMeta).

   /event is the server's copy of what the Pixel just saw — a page view, a
   dial, a number, the pay button — sent by the page with the same event
   id it gave the Pixel, so Meta keeps one of each pair. It adds what only
   a server has: the buyer's IP address and browser, read off the request.

   The webhook sends Purchase, and only the webhook does, because only
   the webhook arrives with Razorpay's signature on it.

   Entirely optional. Without META_CAPI_TOKEN nothing is sent, and nothing
   here can fail a sale: Purchase runs beside the commit, not in front of
   it, and every error is logged and swallowed.

   Email and phone are normalised and hashed (SHA-256) before they leave
   this worker, as Meta requires; nothing is sent in the clear.

   metaReady is also the second half of the test-mode guard: a worker on
   Razorpay test keys reports to Meta only with a test event code, so a
   rehearsal lands in Events Manager → Test events and never in the
   numbers the ads are optimised on. */
const metaReady = (env) => !!env.META_CAPI_TOKEN && !(testKeys(env) && !env.META_TEST_EVENT_CODE);

async function sendPurchaseToMeta(env, entity, order, chosen) {
  if (!metaReady(env)) return "skipped";
  const eventId = String(entity.order_id || entity.id || "");
  if (!eventId) return "skipped";
  try {
    /* Once per order. Razorpay retries a webhook it did not like the
       answer to, and a commit that fails asks it to; the marker is what
       keeps a retry from being a second sale in the ad account. */
    const mark = "meta:" + eventId;

    /* The order's notes are this worker's own handwriting; the payment's
       are the browser's. Where both say something, the order wins. */
    const m = Object.assign({}, entity.notes || {}, (order && order.notes) || {});
    /* A buyer who said "No thanks" to measurement is not reported, not
       even the purchase. The page wrote that choice onto the order. */
    if (m.mc === "0") { console.log("Meta CAPI skipped: the buyer declined measurement."); return "skipped"; }
    if (!(await firstTime(env, mark))) return "already";
    /* Meta rejects a "website" event without the browser's user agent.
       The hosted Payment Page route never passes through /order, so it
       has none; the browser Pixel is its only record. */
    if (!m.ua) { console.log("Meta CAPI skipped: no user agent on the order."); return "skipped"; }

    const user = { client_user_agent: m.ua, country: [await sha256hex("in")] };
    if (m.ip) user.client_ip_address = m.ip;
    if (cleanFbp(m.fbp)) user.fbp = m.fbp;
    if (cleanFbc(m.fbc)) user.fbc = m.fbc;
    if (isHash(m.xid)) user.external_id = [m.xid];
    const h = await hashedContact(entity);
    if (h.em) user.em = [h.em];
    if (h.ph) user.ph = [h.ph];

    const ok = await sendToMeta(env, [{
      event_name: "Purchase",
      event_time: entity.created_at || Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: "website",
      event_source_url: siteUrl(env) + "/claimed.html",
      user_data: user,
      custom_data: {
        currency: entity.currency || "INR",
        value: (entity.amount || 0) / 100,
        content_ids: [contentId(parseInt(chosen, 10), env)],
        content_type: "product",
        num_items: 1,
        order_id: eventId
      }
    }], 3);
    if (!ok) await forget(env, mark);
    return ok ? "sent" : "failed";
  } catch (e) {
    console.log("Meta CAPI purchase threw:", String(e).slice(0, 160));
    return "failed";
  }
}

/* THE SERVER HALF OF EVERY BROWSING EVENT.

   The page calls this with navigator.sendBeacon, as text/plain, so there
   is no preflight and the request survives the page navigating away.
   Everything Meta receives is either read off the request by this worker
   (IP, browser) or checked against a short list of what it can be: six
   event names, twenty numbers, four dials, and a price from this file.
   A caller can choose which of those it claims; it cannot invent a value,
   a product, or a Purchase.

   The page only calls this when the browser's own Pixel actually loaded —
   see assets/tags.js — so blocking Meta in the browser still blocks it
   here, which is what legal.html promises. */
async function postEvent(request, env, ctx) {
  const headers = cors(request, env);
  const reply = (status) => new Response(null, { status, headers });
  if (!metaReady(env)) return reply(204);
  /* Browsers put an Origin on a beacon's POST; the odd one that does not
     still sends a Referer, and its origin is held to the same list. */
  let from = request.headers.get("Origin") || "";
  if (!from) { try { from = new URL(request.headers.get("Referer") || "").origin; } catch (e) { from = ""; } }
  if (!originAllowed(from, env)) return reply(403);

  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > 4096) return reply(400);
  let b;
  try { b = JSON.parse(raw); } catch (e) { return reply(400); }
  if (!b || RELAYED.indexOf(b.name) < 0) return reply(400);
  if (typeof b.id !== "string" || !/^[\w.-]{8,64}$/.test(b.id)) return reply(400);
  let page;
  try { page = new URL(String(b.url || "")); } catch (e) { return reply(400); }
  if (!originAllowed(page.origin, env)) return reply(400);
  const ua = request.headers.get("user-agent") || "";
  if (!ua) return reply(400);

  const user = { client_user_agent: ua.slice(0, 512) };
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (ip) user.client_ip_address = ip.slice(0, 64);
  if (cleanFbp(b.fbp)) user.fbp = b.fbp;
  if (cleanFbc(b.fbc)) user.fbc = b.fbc;
  if (isHash(b.xid)) user.external_id = [b.xid];

  const ev = {
    event_name: b.name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: b.id,
    action_source: "website",
    event_source_url: page.href.slice(0, 1000),
    user_data: user
  };
  if (b.name !== "PageView") {
    const cd = {
      content_ids: [contentId(parseInt(b.no, 10), env)],
      content_type: "product",
      value: parseInt(env.PRICE_PAISE || "0", 10) / 100,
      currency: env.CURRENCY || "INR"
    };
    if (DIALS.indexOf(b.dial) > -1) cd.content_name = "KAAL Series 01 " + b.dial;
    if (b.name === "InitiateCheckout") cd.num_items = 1;
    ev.custom_data = cd;
  }

  const send = sendToMeta(env, [ev], 1);
  if (ctx && ctx.waitUntil) ctx.waitUntil(send); else await send;
  return reply(204);
}

/* The one door out. The token goes in the body, never in the URL, so it
   cannot turn up in a log line that prints a request address. A send is
   retried on a network error, a 429 or a 5xx; a 4xx is a mistake in what
   was sent, and sending it again changes nothing. */
async function sendToMeta(env, data, attempts) {
  const ver = env.META_API_VERSION || "v23.0";
  const pixel = env.META_PIXEL_ID || PIXEL_ID;
  const body = { data, access_token: env.META_CAPI_TOKEN };
  if (env.META_TEST_EVENT_CODE) body.test_event_code = env.META_TEST_EVENT_CODE;
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise(r => setTimeout(r, i === 1 ? 1000 : 3000));
    try {
      const res = await fetch(`https://graph.facebook.com/${ver}/${encodeURIComponent(pixel)}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.ok) return true;
      const text = (await res.text().catch(() => "")).slice(0, 300);
      console.log(`Meta CAPI refused ${data[0].event_name} ${data[0].event_id}:`, res.status, text);
      if (res.status < 500 && res.status !== 429) return false;
    } catch (e) {
      console.log("Meta CAPI call threw:", String(e).slice(0, 160));
    }
  }
  return false;
}

/* Meta's normalisation, which is not optional: a hash of " A@B.com" is a
   hash of nothing Meta holds. Email is trimmed and lower-cased. A phone is
   digits only with the country code in front — Razorpay stores
   +919876543210, which becomes 919876543210; a bare ten digit Indian
   number gets its 91; a leading trunk zero is dropped first. */
async function hashedContact(p) {
  const out = {};
  const email = String((p && p.email) || "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.em = await sha256hex(email);
  const phone = normPhone(p && p.contact);
  if (phone) out.ph = await sha256hex(phone);
  return out;
}
function normPhone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "0") d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d.length >= 11 && d.length <= 15 ? d : "";
}

function contentId(n, env) {
  const edition = parseInt(env.EDITION || "20", 10);
  return n >= 1 && n <= edition ? `${SERIES}-${pad2(n)}` : SERIES;
}
const siteUrl = (env) => (env.SITE_URL || "https://thekaal.co").replace(/\/+$/, "");

/* The browser half of the match, taken at /order. _fbp and _fbc are the
   Pixel's own first-party cookies, passed up by the page; the user agent
   and IP are read off the request itself.

   And where the buyer came from: the UTM tags and the fbclid of the ad
   click that brought them, kept by assets/tags.js from the landing page
   to here. They go on the order so that every sale in the Razorpay
   dashboard says which campaign made it, whether or not Meta ever heard
   from the browser. xid is the buyer's anonymous browser id, already
   hashed by the page — the same external_id the Pixel was given.

   Razorpay allows fifteen notes of 256 characters each. This writes at
   most fourteen with kaal_no and the gift, and anything that would not
   fit whole is dropped rather than cut: a truncated click id is not a
   shorter click id, it is a wrong one. */
function metaMatch(request, body) {
  const out = {};
  const ua = request.headers.get("user-agent") || "";
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (ua) out.ua = ua.slice(0, 250);
  if (ip) out.ip = ip.slice(0, 64);
  const fbp = cleanFbp(body && body.fbp), fbc = cleanFbc(body && body.fbc);
  if (fbp) out.fbp = fbp;
  if (fbc) out.fbc = fbc;

  const a = (body && typeof body.attr === "object" && body.attr) || {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const v = cleanNote(a[k], 256);
    if (v && v.length <= 200) out[k] = v;
  }
  const fbclid = cleanNote(a.fbclid, 256);
  if (/^[\w-]{10,240}$/.test(fbclid)) out.fbclid = fbclid;
  if (isHash(a.xid)) out.xid = a.xid;
  /* "No thanks" to measurement, from the page's notice. Read by the webhook,
     which then tells Meta nothing about this order. Fifteenth note of
     fifteen: nothing else may be added to an order without taking one away. */
  if (a.mc === "0") out.mc = "0";
  return out;
}

const isHash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function cleanFbp(v) {
  const s = cleanNote(v, 120);
  return /^fb\.\d\.\d+\.\d+$/.test(s) ? s : "";
}
function cleanFbc(v) {
  const s = cleanNote(v, 256);
  return s.length <= 250 && /^fb\.\d\.\d+\.[\w-]+$/.test(s) ? s : "";
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

/* ALLOW_ORIGIN is a comma separated list. An entry may carry a `*`, which
   stands for letters, digits, dots and hyphens and nothing else — enough
   for the test worker to accept whatever address Cloudflare Pages gives a
   preview (https://*kaal-preview*.pages.dev), never enough to cross a
   scheme, a port or a slash. Production lists its two origins exactly. */
function originList(env) {
  return (env.ALLOW_ORIGIN || "https://thekaal.co,https://www.thekaal.co").split(",").map(s => s.trim()).filter(Boolean);
}
function originAllowed(origin, env) {
  if (!origin) return false;
  return originList(env).some(o => o.indexOf("*") < 0 ? o === origin
    : new RegExp("^" + o.split("*").map(p => p.replace(/[.+?^${}()|[\]\\\/]/g, "\\$&")).join("[a-z0-9.-]*") + "$").test(origin));
}
function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  return originAllowed(origin, env) ? origin : originList(env)[0];
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

   7. Send one real ₹1 test transaction before trusting this with a real
      ₹5,999 one. Watch `wrangler tail`, watch the commit land, watch the
      live site's count move. Do this before turning Meta ads on.

   8. Meta Conversions API: one secret, META_CAPI_TOKEN (Events Manager →
      the Pixel → Settings → Conversions API → Generate access token).
      Rehearse on the TEST worker, never on this one: `wrangler deploy
      --env test` runs this same file as kaal-edition-test, on Razorpay
      test keys, with COMMIT_SOLD = "0" and META_TEST_EVENT_CODE set, so
      nothing it sees is recorded as a sale or counted as one by Meta.
      .github/workflows/deploy.yml does all of this from GitHub.
   ══════════════════════════════════════════════════════════════════ */
