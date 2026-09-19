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

   Two more routes, and a KV namespace behind them, stop the honest
   collision before it reaches a payment at all:

     GET  /state        what is actually sold, and what is briefly held
     POST /hold {n}     claim a number for twelve minutes while paying

   A hold is advisory on purpose. It is not a lock, it is not payment,
   and it NEVER stands between a buyer and the checkout page — if the
   hold call is slow or fails, the page proceeds to Razorpay regardless.

   ── WHAT THE SECURITY PASS CHANGED, AND WHY EACH ONE IS HERE ──────

   The signature check was already right. Everything below it assumed
   that a correctly signed webhook was a webhook that meant what it
   said, and that assumption is where the money was.

   1. AMOUNT AND CURRENCY ARE VERIFIED (verifyPayment).
      A Razorpay webhook fires for EVERY payment on the account, not
      only for the one Payment Page this shop sells from. `kaal_no` is
      a buyer-filled custom field. So before this change: one ₹1
      payment on any link on the account, carrying a note of
      `kaal_no: 7`, was enough to strike number 07 off a live shop.
      Twenty of them, twenty rupees, and the storefront reads SOLD OUT
      while twenty watches sit unsold. The expected amount is not typed
      here — it is read out of the same index.html the edition bound is
      read from, so a price change cannot leave a stale copy behind.

   2. THE EVENT IS REPLAYED ONLY ONCE (seen: keys).
      A Razorpay signature stays valid for its body forever. Anyone who
      ever holds one captured-payment body — a log export, a screenshot
      of a webhook debug pane, a forwarded curl — could replay it. The
      GitHub side was already idempotent, but the KV side was not, and
      neither was the alerting. Events are now remembered for a day.

   3. A PAYMENT FOR AN ALREADY-SOLD NUMBER IS NO LONGER SILENT.
      It used to return "already recorded" and stop. That is the exact
      shape of a real double-sale — two people have paid for one watch
      and the only trace was a 200. It now writes an alert key and logs
      at error level, so `wrangler tail` and the /alerts route both show
      it. Refunds and disputes do the same and NEVER auto-unsell: a
      machine that can mark a number available again is a machine that
      can be made to resell a watch that has already shipped.

   4. /hold CANNOT BE USED TO BURN THE KV WRITE BUDGET.
      Re-holding the same number with the same token no longer writes.
      Holds are capped per IP and in total. This is a speed bump, not a
      wall: the real control for an unauthenticated public endpoint is
      a Cloudflare rate-limiting rule in front of the worker. See SETUP.

   5. EVERY RESPONSE CARRIES SECURITY HEADERS, and anything that is not
      a route this worker serves gets a 405 rather than a chatty 200.

   WHAT THIS STILL DOES NOT DO: it is not a database, a cart, or an
   inventory system. It holds a few small keys and edits one line of
   one file, because that is the entire footprint of "sold" here.

   WHEN TO OUTGROW IT: Workers KV is eventually consistent — a write can
   take up to about a minute to be visible everywhere. At twenty units
   that is irrelevant. If this ever becomes a real cadence — a restock,
   a larger series, more than a sale a minute — move `hold` and `sold`
   into a Durable Object, which serialises writes by construction and
   has no daily write budget to exhaust.
   ══════════════════════════════════════════════════════════════════ */

const HOLD_SECONDS   = 12 * 60;
const KEY_SOLD       = "sold";
const HOLD_PREFIX    = "hold:";
const SEEN_PREFIX    = "seen:";
const ALERT_PREFIX   = "alert:";
const RATE_PREFIX    = "rl:";

/* A webhook body is a few kilobytes. Anything larger is somebody asking
   this worker to run HMAC-SHA256 over a megabyte for free, and the read
   happens before any signature is checked, so it is the one place an
   unauthenticated caller gets to choose how much work we do. */
const MAX_BODY_BYTES = 64 * 1024;

/* Per-IP holds inside the window, and holds alive at once. Both exist to
   bound KV WRITES, which are the scarce resource, not to stop a
   determined attacker — nothing unauthenticated can do that. */
const HOLDS_PER_IP     = 8;
const HOLD_RATE_WINDOW = 600;
const MAX_LIVE_HOLDS   = 20;

const SEEN_TTL  = 24 * 60 * 60;
const ALERT_TTL = 30 * 24 * 60 * 60;

export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return preflight(request, env);

    if (request.method === "GET" && path === "/state")  return getState(request, env);
    if (request.method === "GET" && path === "/alerts") return getAlerts(request, env);
    if (request.method === "GET" && path === "/")       return text(request, env, "KAAL edition worker is alive.", 200);

    if (request.method === "POST" && path === "/hold")  return postHold(request, env);
    /* Razorpay posts to the root. Naming the paths means a typo in the
       dashboard lands on a 405 that is visible, rather than being fed to
       the signature check and failing as if the secret were wrong. */
    if (request.method === "POST" && (path === "/" || path === "/webhook")) return webhook(request, env);

    return text(request, env, "Not a route this worker serves.", 405, { "Allow": "GET, POST, OPTIONS" });
  }
};

/* ══════════ 1. WHAT THE PAGE ASKS ══════════ */

/* The page merges this into what it already believes. It only ever ADDS
   numbers to its sold set from here, never removes one — so a KV that is
   empty, cold, or briefly unreachable cannot un-sell a watch. A backend
   that can only ever be more cautious than the static page is a backend
   that cannot take the site down. */
async function getState(request, env) {
  if (!originAllowed(request, env)) return json(request, env, { error: "origin" }, {}, 403);
  if (!env.KAAL_STATE) return json(request, env, { sold: null, held: [] });

  const sold = await readSold(env);
  const held = [];
  try {
    const list = await env.KAAL_STATE.list({ prefix: HOLD_PREFIX });
    for (const k of list.keys) {
      const n = parseInt(k.name.slice(HOLD_PREFIX.length), 10);
      if (!isNaN(n)) held.push(n);
    }
  } catch (e) { /* a listing that fails is a page with no holds, not an error */ }

  /* Numbers only. Never the `by` token or the expiry — one is a client
     identifier and the other tells a scalper exactly when to strike. */
  return json(request, env, { sold, held, at: Date.now() }, { "Cache-Control": "public, max-age=10" });
}

/* Sales that need a human to look at them: a captured payment for a
   number already gone, a refund, a dispute, a payment whose amount did
   not match the price. Behind a shared secret because it is an
   operational surface, not a public one. Set ALERT_TOKEN to use it;
   leave it unset and the route is closed rather than open. */
async function getAlerts(request, env) {
  const supplied = new URL(request.url).searchParams.get("token") || "";
  if (!env.ALERT_TOKEN || !timingSafeEqual(String(supplied), String(env.ALERT_TOKEN))) {
    return text(request, env, "Not a route this worker serves.", 404);
  }
  if (!env.KAAL_STATE) return json(request, env, { alerts: [] });

  const out = [];
  try {
    const list = await env.KAAL_STATE.list({ prefix: ALERT_PREFIX });
    for (const k of list.keys) {
      const v = await env.KAAL_STATE.get(k.name, "json").catch(() => null);
      if (v) out.push(v);
    }
  } catch (e) { /* an empty list is the honest answer when KV is unhappy */ }
  out.sort((a, b) => (b.at || 0) - (a.at || 0));
  return json(request, env, { alerts: out }, { "Cache-Control": "no-store" });
}

async function postHold(request, env) {
  if (!originAllowed(request, env)) return json(request, env, { ok: false, reason: "origin" }, {}, 403);
  if (!env.KAAL_STATE) return json(request, env, { ok: false, reason: "no-store" });

  const raw = await readBounded(request);
  if (raw === null) return json(request, env, { ok: false, reason: "too-large" }, {}, 413);

  let body;
  try { body = JSON.parse(raw); } catch (e) { return json(request, env, { ok: false, reason: "bad-request" }, {}, 400); }

  const n = parseInt(body && body.n, 10);
  /* The page writes a base36 token. Anything else is not the page, and
     while a token is forgeable by construction, a shape check keeps a
     stray value out of a KV key and out of the comparison below. */
  const byRaw = typeof (body && body.by) === "string" ? body.by : "";
  const by = /^[a-z0-9]{6,32}$/.test(byRaw) ? byRaw : "";

  const edition = parseInt(env.EDITION || "20", 10);
  if (isNaN(n) || n < 1 || n > edition) return json(request, env, { ok: false, reason: "out-of-range" }, {}, 400);

  const sold = await readSold(env);
  if (sold && sold.indexOf(n) > -1) return json(request, env, { ok: false, reason: "sold" });

  const key = HOLD_PREFIX + n;
  const existing = await env.KAAL_STATE.get(key, "json").catch(() => null);
  const now = Date.now();

  /* Somebody else's hold stands. */
  if (existing && existing.by && by && existing.by !== by) return json(request, env, { ok: false, reason: "held" });
  if (existing && existing.by && !by)                      return json(request, env, { ok: false, reason: "held" });

  /* Re-holding your own number used to rewrite the key on every click.
     A hold that still has most of its life left does not need extending,
     and a write that changes nothing is a write somebody else can make
     us spend. This is the single biggest source of write amplification
     on an endpoint anyone can call. */
  if (existing && existing.by === by && existing.until - now > (HOLD_SECONDS - 120) * 1000) {
    return json(request, env, { ok: true, n, until: existing.until });
  }

  if (!existing && !(await underHoldCaps(env, request))) {
    /* Deliberately shaped like success. A buyer must never be told "no"
       by a rate limiter on the way to a checkout page; the hold is
       advisory and the page proceeds regardless. */
    return json(request, env, { ok: true, n, until: now + HOLD_SECONDS * 1000, advisory: false });
  }

  const until = now + HOLD_SECONDS * 1000;
  await env.KAAL_STATE.put(key, JSON.stringify({ by, until }), { expirationTtl: HOLD_SECONDS });
  return json(request, env, { ok: true, n, until });
}

/* Two bounds, both cheap, both about KV writes rather than about
   attackers. The counter is only ever incremented when a real hold write
   is about to happen, so it can never cost more writes than it saves. */
async function underHoldCaps(env, request) {
  try {
    const list = await env.KAAL_STATE.list({ prefix: HOLD_PREFIX });
    if (list.keys.length >= MAX_LIVE_HOLDS) return false;
  } catch (e) { /* if we cannot count them, let the hold through */ }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!ip) return true;
  const key = RATE_PREFIX + ip;
  try {
    const seen = await env.KAAL_STATE.get(key, "json").catch(() => null);
    const count = seen && typeof seen.n === "number" ? seen.n : 0;
    if (count >= HOLDS_PER_IP) return false;
    await env.KAAL_STATE.put(key, JSON.stringify({ n: count + 1 }), { expirationTtl: HOLD_RATE_WINDOW });
  } catch (e) { /* a limiter that errors must not close the shop */ }
  return true;
}

/* ══════════ 2. WHAT RAZORPAY SAYS ══════════ */

async function webhook(request, env) {
  const rawBody = await readBounded(request);
  if (rawBody === null) return new Response("Body too large.", { status: 413 });

  const signature = request.headers.get("x-razorpay-signature") || "";
  const valid = await verifySignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
  if (!valid) return new Response("Signature mismatch.", { status: 400 });

  let event;
  try { event = JSON.parse(rawBody); }
  catch (e) { return new Response("Bad JSON.", { status: 400 }); }

  /* A signed body is proof of the secret, not proof of freshness. The
     same body replays forever unless something remembers it. */
  const eventId = request.headers.get("x-razorpay-event-id") || "";
  if (await alreadySeen(env, eventId)) {
    return new Response("Already processed.", { status: 200 });
  }

  /* One secret, one account. If the secret ever ends up on a second
     Razorpay account, this is what stops that account writing to this
     shop's inventory. Optional, because most setups have one account. */
  if (env.RAZORPAY_ACCOUNT_ID && event.account_id && event.account_id !== env.RAZORPAY_ACCOUNT_ID) {
    console.error("Webhook from an unexpected account:", String(event.account_id).slice(0, 40));
    return new Response("Not this account.", { status: 200 });
  }

  const name = String(event.event || "");

  /* Money going back out is never handled automatically. A refund or a
     dispute on a number that has shipped must not un-sell it, and a
     refund on a number that has not is a decision with a person's
     judgement in it. Both get recorded loudly and left alone. */
  if (name.startsWith("refund.") || name.startsWith("payment.dispute")) {
    const ent = entityOf(event);
    await raiseAlert(env, {
      kind: name,
      payment: ent.payment_id || ent.id || "unknown",
      note: "Money reversed or disputed. The number is still marked sold — decide by hand.",
      at: Date.now()
    });
    console.error("ALERT", name, ent.payment_id || ent.id || "unknown");
    return new Response("Recorded for manual review.", { status: 200 });
  }

  if (name !== "payment.captured") {
    return new Response("Ignored: " + name.slice(0, 60), { status: 200 });
  }

  const entity    = entityOf(event);
  const notes     = entity.notes || {};
  const paymentId = typeof entity.id === "string" ? entity.id.slice(0, 40) : "unknown";
  const raw       = notes.kaal_no;
  const chosen    = parseInt(raw, 10);

  if (entity.status && entity.status !== "captured") {
    return new Response("Not a captured payment.", { status: 200 });
  }

  /* Both bounds — the edition and the price — are read out of the file
     itself rather than written here. The day the edition or the price
     changes is exactly the day nobody would think to look in a worker
     for the reason a real sale went unrecorded. */
  const commit = await commitSold(env, chosen, paymentId, entity);

  if (commit.status === "bad-number") {
    console.log("payment.captured with no usable kaal_no:", String(raw).slice(0, 40));
    return new Response("Captured but no valid kaal_no — check manually.", { status: 200 });
  }

  if (commit.status === "bad-amount") {
    /* The attack this closes in one line: any cheap payment anywhere on
       this Razorpay account, carrying a kaal_no note, marking a watch
       sold. Never commit, always shout. */
    await raiseAlert(env, {
      kind: "amount-mismatch", payment: paymentId, n: chosen,
      got: commit.got, want: commit.want, currency: commit.currency,
      note: "A captured payment carried a kaal_no but did not match the page price. Nothing was marked sold.",
      at: Date.now()
    });
    console.error("ALERT amount-mismatch", paymentId, "got", commit.got, commit.currency, "want", commit.want);
    return new Response("Amount did not match the listed price — recorded for review.", { status: 200 });
  }

  if (commit.status === "already") {
    /* Two payments, one watch. This used to be a silent 200. */
    await raiseAlert(env, {
      kind: "double-sale", payment: paymentId, n: chosen,
      note: "A captured payment named a number that was already sold. One of these buyers needs a refund and a message, today.",
      at: Date.now()
    });
    console.error("ALERT double-sale", paymentId, "number", chosen);
    await remember(env, eventId);
    return new Response(`Number ${chosen} was already sold — recorded for review.`, { status: 200 });
  }

  if (commit.status === "error") return new Response("Could not record the sale — see worker logs.", { status: 502 });

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

  await remember(env, eventId);
  console.log(`Number ${chosen} marked sold. GitHub Pages will rebuild shortly.`);
  return new Response(`OK — number ${chosen} recorded as sold.`, { status: 200 });
}

/* Read, modify, write — and mean it. Two webhooks landing together both
   read the same blob sha, and the second PUT is rejected with a 409. The
   old build returned 502 and left it to Razorpay's retry schedule, which
   is minutes. Three attempts here closes it in milliseconds. */
async function commitSold(env, chosen, paymentId, entity) {
  const owner  = env.GITHUB_OWNER, repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const api    = `https://api.github.com/repos/${owner}/${repo}/contents/index.html`;
  const headers = {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "kaal-edition-worker"
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const getRes = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
    if (!getRes.ok) {
      console.log("GitHub GET failed:", getRes.status, (await getRes.text()).slice(0, 300));
      return { status: "error" };
    }
    const file = await getRes.json();
    /* Over a megabyte the contents API answers with an empty `content`
       and no error. Decoding that would hand btoa an empty string and
       commit a blank storefront. */
    if (file.encoding !== "base64" || !file.content) {
      console.log("GitHub returned index.html in an unusable shape — encoding:", String(file.encoding));
      return { status: "error" };
    }
    const decoded = atob(file.content.replace(/\n/g, ""));

    const editionMatch = decoded.match(/edition:\s*(\d+)/);
    const edition = editionMatch ? parseInt(editionMatch[1], 10) : 20;
    if (!chosen || isNaN(chosen) || chosen < 1 || chosen > edition) return { status: "bad-number" };

    const check = verifyPayment(env, decoded, entity);
    if (!check.ok) return Object.assign({ status: "bad-amount" }, check);

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
        content: btoa(decoded.replace(soldPattern, () => `sold:     [${updated.join(", ")}]`)),
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

/* THE MONEY CHECK.

   `notes.kaal_no` is filled in by the buyer, and a Razorpay webhook
   fires for every payment on the account — a ₹1 test link, a repair
   invoice, anything. Without this function, twenty rupees spent on any
   of them marks the entire edition sold. With it, the only thing that
   can strike a number off is a payment for the price the page is
   actually asking.

   The expected amount is the `price:` line in index.html, in paise. It
   is read rather than typed for the same reason `edition` is: a second
   copy of a commercial value is a copy that will one day disagree.

   MIN_AMOUNT_PAISE loosens it to a floor, for the day a coupon or a
   part payment is a real thing. Setting AMOUNT_CHECK=off turns it off
   entirely, which is the pre-audit behaviour and is documented only so
   that turning it off is a deliberate act with a name. */
function verifyPayment(env, pageSource, entity) {
  if (String(env.AMOUNT_CHECK || "").toLowerCase() === "off") return { ok: true };

  const currency = String(entity && entity.currency || "");
  const got = Number(entity && entity.amount);

  const wantCurrency = String(env.CURRENCY || "INR").toUpperCase();
  if (currency.toUpperCase() !== wantCurrency) return { ok: false, got, want: null, currency };

  let want = parseInt(env.MIN_AMOUNT_PAISE || "", 10);
  if (!Number.isFinite(want) || want <= 0) {
    const m = pageSource.match(/price:\s*"([\d,]+)"/);
    const rupees = m ? parseInt(m[1].replace(/,/g, ""), 10) : NaN;
    if (!Number.isFinite(rupees) || rupees <= 0) {
      /* No price to compare against is not permission to skip the check.
         Refuse, alert, and let a person look — an unverifiable payment
         is exactly the one worth stopping on. */
      return { ok: false, got, want: null, currency };
    }
    want = rupees * 100;
  }

  if (!Number.isFinite(got) || got < want) return { ok: false, got, want, currency };
  return { ok: true };
}

/* ══════════ 3. PLUMBING ══════════ */

function entityOf(event) {
  const p = (event && event.payload) || {};
  const holder = p.payment || p.refund || p.dispute || {};
  return holder.entity || {};
}

/* The body is read once, with a ceiling, before anything expensive
   touches it. Content-Length is a hint from the caller and is checked
   first only because it is free; the real bound is the bytes. */
async function readBounded(request) {
  const declared = parseInt(request.headers.get("content-length") || "", 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const body = await request.text();
  /* A rough byte ceiling: UTF-8 is at most four bytes a code unit pair,
     and this only has to stop a megabyte, not measure one exactly. */
  if (body.length > MAX_BODY_BYTES) return null;
  return body;
}

async function alreadySeen(env, eventId) {
  if (!env.KAAL_STATE || !eventId) return false;
  try { return (await env.KAAL_STATE.get(SEEN_PREFIX + eventId.slice(0, 64))) !== null; }
  catch (e) { return false; }
}

async function remember(env, eventId) {
  if (!env.KAAL_STATE || !eventId) return;
  try { await env.KAAL_STATE.put(SEEN_PREFIX + eventId.slice(0, 64), "1", { expirationTtl: SEEN_TTL }); }
  catch (e) { /* a forgotten event replays idempotently; it is not worth failing over */ }
}

async function raiseAlert(env, payload) {
  if (!env.KAAL_STATE) return;
  const id = `${payload.kind}:${payload.payment || Date.now()}`.slice(0, 96);
  try { await env.KAAL_STATE.put(ALERT_PREFIX + id, JSON.stringify(payload), { expirationTtl: ALERT_TTL }); }
  catch (e) { /* the console line beside every call to this is the backstop */ }
}

async function readSold(env) {
  if (!env.KAAL_STATE) return null;
  try {
    const v = await env.KAAL_STATE.get(KEY_SOLD, "json");
    return Array.isArray(v) ? v : null;
  } catch (e) { return null; }
}

async function verifySignature(body, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, String(signatureHeader).trim().toLowerCase());
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

function originList(env) {
  return (env.ALLOW_ORIGIN || "https://thekaal.co,https://www.thekaal.co")
    .split(",").map(s => s.trim()).filter(Boolean);
}

/* No Origin header at all is a curl, a health check, or Razorpay — none
   of which a CORS policy is for. An Origin this shop does not own is
   another site's page calling these routes in a visitor's browser, and
   that is what gets turned away. */
function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return originList(env).indexOf(origin) > -1;
}

function allowedOrigin(request, env) {
  const list = originList(env);
  const origin = request.headers.get("Origin") || "";
  return list.indexOf(origin) > -1 ? origin : list[0];
}

function cors(request, env) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(request, env),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

/* This worker serves JSON and short strings to a browser. None of these
   headers change that; all of them remove a way to misread it. */
function guard() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-site",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  };
}

function preflight(request, env) {
  return new Response(null, { status: 204, headers: Object.assign({}, cors(request, env), guard()) });
}

function json(request, env, body, extra, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" },
                           cors(request, env), guard(), extra || {})
  });
}

function text(request, env, body, status, extra) {
  return new Response(body, {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "text/plain; charset=utf-8" },
                           cors(request, env), guard(), extra || {})
  });
}

/* ══════════════════════════════════════════════════════════════════
   SETUP — do this once, after your Razorpay Payment Page is live.

   1. Free Cloudflare account. `npm i -g wrangler`, then from the repo
      root: `wrangler deploy` (wrangler.toml is beside this file).
      There is still no build step; the file deploys as it is.

   2. Create the KV namespace, once:

        wrangler kv namespace create KAAL_STATE

      Paste the id it prints into wrangler.toml. Skip this and the
      webhook still records sales, but NOTHING IS REPLAY-PROTECTED and
      no alert is ever stored. Create it.

   3. Set the secrets (`wrangler secret put NAME`, one at a time):
        RAZORPAY_WEBHOOK_SECRET   from Razorpay Dashboard -> Webhooks
        GITHUB_TOKEN              fine-grained PAT, scoped ONLY to the
                                   KAAL repo, Contents: Read and write,
                                   nothing else, with an expiry set.
                                   It does NOT need Workflows, and must
                                   never be given it — Workflows write
                                   is the difference between "can edit
                                   one line" and "can run code as you".
        ALERT_TOKEN               any long random string. Without it the
                                   /alerts route stays closed.
      And the plain vars in wrangler.toml: GITHUB_OWNER, GITHUB_REPO,
      EDITION, ALLOW_ORIGIN.

   4. In Razorpay Dashboard -> Webhooks, add an endpoint pointing at the
      deployed worker's root URL, subscribe to `payment.captured` — and
      also to `refund.processed` and `payment.dispute.created`, so a
      reversal is recorded instead of going unnoticed. Use the same
      secret as RAZORPAY_WEBHOOK_SECRET. Razorpay shows it once, at
      creation — save it immediately, and treat it like a password:
      anyone holding it can mark this edition sold out.

   5. On the Payment Page, confirm the custom field capturing the chosen
      number is literally named `kaal_no`, and that the amount is FIXED
      at the page price. A "customer decides the amount" page would be
      handing the inventory switch to the buyer; the amount check above
      is what stops that, and a fixed amount is what makes it simple.

   6. Put the deployed URL into index.html as `api:` in the KAAL config,
      and add that URL's origin to the page's Content-Security-Policy
      connect-src. tools/check.mjs fails the build if you forget.

   7. RATE LIMITING IS NOT THIS FILE'S JOB. /hold and /state are public
      and unauthenticated by design. In the Cloudflare dashboard, add a
      rate-limiting rule on the worker's route — something like 30
      requests a minute per IP — and turn Bot Fight Mode on. The caps in
      this file bound the damage; that rule is what actually stops it.

   8. Send one real ₹1 test transaction before trusting this with a real
      ₹5,999 one — and confirm it is REJECTED with an amount mismatch,
      which is the check doing its job. Then one at full price, and
      watch the commit land. Do this before turning Meta ads on.
   ══════════════════════════════════════════════════════════════════ */
