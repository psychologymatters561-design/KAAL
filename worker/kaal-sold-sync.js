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

   AND TWO THAT ARE NOT ABOUT MONEY (October 2026):

     POST /list {email} the Series 02 list: one address, stored under the
                        hash of itself, rate limited, nothing else kept
     scheduled()        the abandoned-checkout email. Built, and OFF until
                        ABANDON_EMAIL = "on" — see docs/email.md

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

export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return preflight(request, env);

    if (request.method === "GET" && path === "/state") return getState(request, env);
    if (request.method === "POST" && path === "/hold") return postHold(request, env);
    if (request.method === "POST" && path === "/order") return postOrder(request, env);
    if (request.method === "POST" && path === "/verify") return postVerify(request, env);
    if (request.method === "POST" && path === "/list") return postList(request, env);
    if (request.method === "POST") return webhook(request, env);   /* Razorpay posts to the root */

    return new Response("KAAL edition worker is alive.", { status: 200 });
  },

  /* The cron in wrangler.toml calls this. It does nothing at all unless
     ABANDON_EMAIL is "on", so the trigger can stay configured while the
     feature stays off. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(abandonedCheckouts(env));
  }
};

/* ══════════ 1. WHAT THE PAGE ASKS ══════════ */

/* The page merges this into what it already believes. It only ever ADDS
   numbers to its sold set from here, never removes one — so a KV that is
   empty, cold, or briefly unreachable cannot un-sell a watch. A backend
   that can only ever be more cautious than the static page is a backend
   that cannot take the site down. */
async function getState(request, env) {
  if (!env.KAAL_STATE) {
    const placed = await readPlaced(env);
    return json(request, env, placed ? { sold: null, held: [], placed } : { sold: null, held: [] });
  }

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

  const out = { sold, held, at: now };
  const placed = await readPlaced(env);
  if (placed) out.placed = placed;
  return json(request, env, out, { "Cache-Control": "public, max-age=10" });
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

/* ══════════ 3. WHAT RAZORPAY SAYS ══════════ */

async function webhook(request, env) {
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
  const raw       = notes.kaal_no;
  let   chosen    = parseInt(raw, 10);

  /* These notes are on the PAYMENT, and nothing here wrote them. The
     Payment Page route put the number there as a custom field; Standard
     Checkout puts it there from the browser's checkout options. Both
     arrive the same way and neither is this worker's own handwriting,
     so when it is missing or nonsense the order is asked instead —
     /order wrote kaal_no onto the order itself, somewhere no browser
     can reach. A captured payment that goes unrecorded is the one
     failure on this path that costs an actual watch, and it is worth
     one extra call to avoid it. */
  if (isNaN(chosen) && entity.order_id) chosen = await numberFromOrder(env, entity.order_id);

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
  await sendPurchaseToMeta(env, entity, chosen);
  return new Response(`OK — number ${chosen} recorded as sold.`, { status: 200 });
}

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

/* ══════════ 3c. THE SERIES 02 LIST ══════════

   One field on the page and one key here. The address is stored under the
   SHA-256 of itself, so adding the same person twice changes nothing, with
   the moment it arrived and which form it came from — and nothing else:
   no name, no IP, no cookie. The page promises "One email when Series 02
   is drawn. Nothing else, ever." and this route keeps nothing that could
   be used for anything else.

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

/* ══════════ 3e. THE ONE EMAIL AFTER AN UNFINISHED CHECKOUT ══════════

   OFF unless ABANDON_EMAIL = "on". Setup and the reasoning are in
   docs/email.md; the rules this code keeps are these:

   - Only a checkout this worker priced, three hours or more ago and within
     the last day, that never became a payment.
   - Only if Razorpay holds an email for it — which it does only when the
     buyer reached the payment step and it failed or was abandoned there.
     A modal opened and closed with nothing typed leaves no address, and
     no address means no email. Nothing is guessed or collected for this.
   - Only if the number is still open and nobody else is holding it: the
     email says "it is here", and that has to be true when it arrives.
   - Not to anybody who has since paid for any piece.
   - Exactly once per person per number, ever (a KV key, kept a year).
   - Only between noon and six in the evening in India, because the email
     says "this afternoon".
   - At most ten per run.

   The words are the owner's and are sent exactly, as plain text. */
const ABANDON_AFTER  = 3 * 3600;
const ABANDON_WITHIN = 24 * 3600;
const ABANDON_MAX    = 10;

async function abandonedCheckouts(env) {
  if (env.ABANDON_EMAIL !== "on") return;
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.KAAL_STATE) {
    console.log("ABANDON_EMAIL is on, but the Razorpay keys or the KV namespace are missing.");
    return;
  }
  if (!env.RESEND_API_KEY && !env.BREVO_API_KEY) {
    console.log("ABANDON_EMAIL is on, but neither RESEND_API_KEY nor BREVO_API_KEY is set.");
    return;
  }
  const istHour = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
  if (istHour < 12 || istHour >= 18) return;

  const now = Math.floor(Date.now() / 1000);
  const payments = await listPayments(env, now - ABANDON_AFTER - ABANDON_WITHIN, now);
  if (!payments) return;

  const paid = new Set();
  for (const p of payments) {
    if ((p.status === "captured" || p.status === "authorized") && p.email) paid.add(String(p.email).toLowerCase());
  }
  const sold = (await knownSold(env)) || [];
  let sent = 0;

  for (const p of payments) {
    if (sent >= ABANDON_MAX) break;
    if (p.status !== "failed" || !p.order_id || !p.email) continue;
    if (p.created_at > now - ABANDON_AFTER) continue;
    const email = String(p.email).trim().toLowerCase();
    if (!validEmail(email) || paid.has(email)) continue;

    const order = await readOrder(env, p.order_id);
    if (!order || order.status === "paid") continue;
    const n = parseInt(order.notes && order.notes.kaal_no, 10);
    if (!n || sold.indexOf(n) > -1) continue;

    const hold = await env.KAAL_STATE.get(HOLD_PREFIX + n, "json").catch(() => null);
    if (hold && hold.until > Date.now()) continue;

    const once = "abandon:" + (await sha256hex(email)).slice(0, 32) + ":" + n;
    if (await env.KAAL_STATE.get(once).catch(() => null)) continue;
    /* Written BEFORE sending: if the send fails, the visitor gets nothing
       rather than a second copy on the next run. Once means once. */
    await env.KAAL_STATE.put(once, String(now), { expirationTtl: 365 * 24 * 3600 });

    const subject = `No. ${pad2(n)}`;
    const text = `No. ${pad2(n)} went back to the twenty this afternoon. If you still want it, it is here: thekaal.co/#n${n}. If someone else chooses it first, it is theirs.`;
    if (await sendEmail(env, email, subject, text)) sent++;
  }
  if (sent) console.log(`Abandoned-checkout emails sent: ${sent}.`);
}

async function listPayments(env, from, to) {
  const out = [];
  try {
    for (let skip = 0; skip < 500; skip += 100) {
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
   otherwise. A refused send is logged and never retried. */
async function sendEmail(env, to, subject, text) {
  const from    = env.ABANDON_FROM || "KAAL <connect@thekaal.co>";
  const replyTo = env.ABANDON_REPLY_TO || "connect@thekaal.co";
  try {
    let res;
    if (env.RESEND_API_KEY) {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text, reply_to: replyTo })
      });
    } else {
      const m = /^(.*?)\s*<([^>]+)>$/.exec(from);
      res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          sender: m ? { name: m[1] || "KAAL", email: m[2] } : { name: "KAAL", email: from },
          to: [{ email: to }], subject, textContent: text, replyTo: { email: replyTo }
        })
      });
    }
    if (!res.ok) { console.log("Email provider refused:", res.status, (await res.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) {
    console.log("Email send threw:", String(e).slice(0, 120));
    return false;
  }
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
