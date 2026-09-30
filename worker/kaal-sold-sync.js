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

const HOLD_SECONDS = 12 * 60;
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

/* ══════════ 1. WHAT THE PAGE ASKS ══════════ */

/* The page merges this into what it already believes. It only ever ADDS
   numbers to its sold set from here, never removes one — so a KV that is
   empty, cold, or briefly unreachable cannot un-sell a watch. A backend
   that can only ever be more cautious than the static page is a backend
   that cannot take the site down. */
async function getState(request, env) {
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
  const by = typeof (body && body.by) === "string" ? body.by.slice(0, 64) : "";
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
    held_for: heldFor
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
  const order = await readOrder(env, orderId);
  const n = parseInt(order && order.notes && order.notes.kaal_no, 10) || 0;

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
    if (env.KAAL_STATE && await env.KAAL_STATE.get(mark).catch(() => null)) return "already";

    /* The order's notes are this worker's own handwriting; the payment's
       are the browser's. Where both say something, the order wins. */
    const m = Object.assign({}, entity.notes || {}, (order && order.notes) || {});
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
    if (ok && env.KAAL_STATE) {
      await env.KAAL_STATE.put(mark, "1", { expirationTtl: 7 * 24 * 3600 }).catch(() => {});
    }
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
