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
    if (request.method === "POST") return webhook(request, env);   /* Razorpay posts to the root */

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
        notes: { kaal_no: pad2(n) }
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
     is not a failure to sell: the order is already good. */
  if (env.KAAL_STATE) {
    try {
      await env.KAAL_STATE.put(
        HOLD_PREFIX + n,
        JSON.stringify({ by, until: Date.now() + HOLD_SECONDS * 1000 }),
        { expirationTtl: HOLD_SECONDS }
      );
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
    n
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

/* ══════════ 4. PLUMBING ══════════ */

const pad2 = (n) => (n < 10 ? "0" + n : String(n));
const isText = (v) => typeof v === "string" && v.length > 0 && v.length < 256;

/* The number, from the one copy of it a browser never touched. /order
   wrote it onto the order; this reads it back. Both the webhook and
   /verify need exactly this, which is why it is not written twice. */
async function numberFromOrder(env, orderId) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !orderId) return NaN;
  try {
    const res = await fetch(`${RZP_API}/orders/${encodeURIComponent(orderId)}`, { headers: razorpayAuth(env) });
    if (!res.ok) { console.log("Order read-back failed:", res.status); return NaN; }
    const order = await res.json();
    return parseInt(order && order.notes && order.notes.kaal_no, 10);
  } catch (e) {
    console.log("Order read-back threw:", String(e).slice(0, 120));
    return NaN;
  }
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

   7. Send one real ₹1 test transaction before trusting this with a real
      ₹5,999 one. Watch `wrangler tail`, watch the commit land, watch the
      live site's count move. Do this before turning Meta ads on.
   ══════════════════════════════════════════════════════════════════ */
