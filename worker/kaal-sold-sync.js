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
import { registryOn, SERIES, HOLD_MS, holdPiece, releaseHold, unavailable, isBlocked, recordPayment, claimRefund, refundDone, refundFailed, paymentFate } from "./registry.js";
import { buyerDuplicate, ownerDuplicate, esc, actName } from "./mail.js";
import { control } from "./control.js";
import { notifyOwner } from "./push.js";
import { flushOutbox } from "./outbox.js";
import { queuePlaced, queueAddressAsk } from "./orders.js";
import { shiprocket } from "./courier.js";
import { sweeps } from "./sla.js";
import { trackRoute } from "./track.js";
import { ownersRoute } from "./owners.js";
import { registryRoute, since } from "./registry-public.js";
import { sessionOf, authOn } from "./auth.js";
import { applyStockHtml, applyStockLlms, editionJson, configOf, stockOf, istDay as stockDay } from "./stock.js";

const HOLD_SECONDS = 12 * 60;
/* With the registry on, a hold is the brief's ten minutes, kept in D1;
   without it, the twelve this worker has always kept in KV. */
const holdSeconds = (env) => (registryOn(env) ? HOLD_MS / 1000 : HOLD_SECONDS);
/* The staging worker (wrangler.toml [env.staging]): Razorpay test mode,
   its own database, and nothing it does may reach the live site, a real
   buyer's inbox or Meta. */
const staging = (env) => env.STAGING === "on";
const anonBy = () => "anon:" + crypto.randomUUID();
const KEY_SOLD = "sold";
const HOLD_PREFIX = "hold:";
const RZP_API = "https://api.razorpay.com/v1";
const MIN_PAISE = 100;          /* Razorpay rejects anything under this */
const LEAD_DAYS = 90;           /* details from a checkout that was never paid */

export default {
  async fetch(request, env, ctx) {
    const url  = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    /* Anything that can change an order or a piece drops what the desk keeps
       for a few seconds (memo), so the next screen reads it fresh. */
    if (request.method === "POST" && !/^\/(e|hold|list)$/.test(path)) forget();

    /* The owner's desk answers for itself, before anything that would
       hand thekaal.co a CORS header: no other site may read it. */
    if (path === "/desk" || path.startsWith("/desk/")) return desk(request, env, ctx, path);
    if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } });
    /* For the six-hourly ping (.github/workflows/health.yml): the worker is up and, with the registry on, its database answers. */
    if (path === "/health") return health(env);

    if (request.method === "OPTIONS") return preflight(request, env);
    if (staging(env) && request.method === "GET" && path === "/staging") return stagingPage(env);

    if (request.method === "GET" && path === "/state") return getState(request, env, ctx, url);
    /* The public registry's data (thekaal.co/registry). */
    if (request.method === "GET" && path === "/registry/data") return registryRoute(request, env, regDeps(env, ctx));
    if (RATE_LIMITS[path] && overRate(request, path, RATE_LIMITS[path])) {
      return json(request, env, { ok: false, reason: "rate" }, { "Retry-After": "600" }, 429);
    }
    /* The registry's control room, its sign-in and the pieces' photographs
       (worker/control.js). Same origin as the page, so no CORS here. */
    if (path === "/control" || path.startsWith("/control/") || path.startsWith("/auth/") || path.startsWith("/photo/")) {
      return control(request, env, ctx, path, { sendEmail, siteUrl, workerUrl, refundPayment, releaseSold, importPaid, setOnSale, activity: (q) => histAsk(env, "/stream?" + q, null, { rows: [] }) });
    }
    /* The order's page (thekaal.co/track) and the courier's tracking events. */
    if (path.startsWith("/track/")) return trackRoute(request, env, ctx, path, regDeps(env, ctx));
    /* The owners' pages (thekaal.co/claim and /owners): registration and the dossier. */
    if (path.startsWith("/o/")) return ownersRoute(request, env, ctx, path, regDeps(env, ctx));
    if (request.method === "POST" && path === "/ship/shiprocket") return shiprocket(request, env, ctx, regDeps(env, ctx));
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
    ctx.waitUntil(metaCatchUp(env));
    /* The registry's outbox: what failed is tried again, with backoff. */
    if (registryOn(env)) ctx.waitUntil(flushOutbox(env, (to, subject, text, html) => sendEmail(env, to, subject, text, html))
      .catch(e => console.log("Outbox run failed:", String(e).slice(0, 160))));
    /* The quiet promises: late orders told to the owner, the one reminder to an unregistered owner. */
    if (registryOn(env)) ctx.waitUntil(sweeps(env, regDeps(env, ctx)).catch(e => console.log("Sweeps failed:", String(e).slice(0, 160))));
    /* The first run after the registry goes live brings in the paid orders. */
    if (registryOn(env)) ctx.waitUntil(autoImport(env));
    /* One after another: the daily check, the repair, then the owner's own
       requests, so none of them reads the sold list while another writes it. */
    ctx.waitUntil(reconcileDaily(env, ctx).then(() => registryOn(env) ? repairSold(env).then(() => ownerOps(env)) : null)
      .catch(e => console.log("Daily check chain failed:", String(e).slice(0, 160))));
    ctx.waitUntil(dailyDigest(env));
    ctx.waitUntil(histPrune(env));
  }
};

/* What the registry's modules need from this worker: its JSON answer with
   CORS, its addresses, and the outbox flush (sent after the response, or
   awaited where a cron is already running). */
function regDeps(env, ctx) {
  const flush = (ids) => flushOutbox(env, (to, subject, text, html) => sendEmail(env, to, subject, text, html), ids)
    .catch(e => console.log("Outbox flush failed:", String(e).slice(0, 160)));
  const later = (p) => { const j = Promise.resolve(p).catch(e => console.log("Background job failed:", String(e).slice(0, 160))); if (ctx && ctx.waitUntil) ctx.waitUntil(j); };
  return { json, siteUrl, workerUrl, sendEmail, kickNow: flush, kick: (ids) => later(flush(ids)), kick0: later };
}

/* ══════════ 0. A CEILING PER ADDRESS ══════════

   /order and /hold put a number on hold for twelve minutes for whoever
   asks, and nothing used to stop one script asking for all twenty, every
   eleven minutes: the shop shut with nothing sold, during the ads. /receipt
   and /shipping each cost two Razorpay calls. So each has a ceiling per IP
   address over ten minutes, far above what a person buying a watch does
   (opening checkout twelve times is already a bad afternoon).

   Kept in memory, per running copy of the worker, on purpose: KV allows a
   thousand writes a day on this plan and the holds and sales need them.
   It is a ceiling, not a wall: an attacker spread across many addresses
   or many of Cloudflare's machines gets further, and a request without an
   address is never counted. What stops a stolen number is still /order
   refusing a sold or held one; this stops the cheap way to empty the shop. */
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMITS = { "/order": 12, "/hold": 12, "/shipping": 10, "/receipt": 60,
  "/auth/start": 5, "/auth/verify": 20, "/auth/totp": 10, "/auth/totp/enroll": 5,
  "/track/data": 60, "/track/lookup": 20, "/track/register": 10, "/track/email-link": 5, "/ship/shiprocket": 600,
  "/registry/data": 120, "/o/auth/start": 5, "/o/auth/verify": 20, "/o/claim/info": 60, "/o/claim/register": 10, "/o/claim/email-code": 5, "/o/claim/request-link": 5, "/o/me": 120,
  "/o/requests": 20, "/o/upload": 20, "/o/transfer/start": 10, "/o/transfer/cancel": 10, "/o/transfer/lookup": 15, "/o/transfer/email-code": 5, "/o/transfer/accept": 10, "/o/recovery": 5 };
const RATE = new Map();
function overRate(request, route, max) {
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (!ip) return false;
  const now = Date.now(), key = route + "|" + ip;
  const seen = (RATE.get(key) || []).filter(t => now - t >= 0 && now - t < RATE_WINDOW_MS);
  const over = seen.length >= max;
  if (!over) seen.push(now);
  RATE.set(key, seen);
  if (RATE.size > 5000) {
    for (const [k, v] of RATE) if (!v.length || now - v[v.length - 1] >= RATE_WINDOW_MS) RATE.delete(k);
    if (RATE.size > 5000) RATE.clear();
  }
  if (over) console.log(`Rate ceiling on ${route} for one address (${max} in ten minutes).`);
  return over;
}

/* ══════════ 0b. THE STAGING CHECKOUT ══════════

   Only on the staging worker (STAGING = "on"): a bare page to buy any
   number with Razorpay's TEST keys and watch the registry answer. The
   twenty with their state, the last orders (number, state, payment id,
   refund), and a button. No buyer's name, email or phone is shown.
   Test card 4111 1111 1111 1111, any future date, any CVV; or UPI
   success@razorpay. */
async function stagingPage(env) {
  let pieces = [], orders = [], err = "";
  if (registryOn(env)) {
    try {
      pieces = (await env.DB.prepare("SELECT number, colorway, state FROM public_registry WHERE series = ?1 ORDER BY number").bind(SERIES).all()).results || [];
      orders = (await env.DB.prepare("SELECT id, piece_id, status, cancel_reason, razorpay_payment_id, refund_id, paid_at FROM orders ORDER BY id DESC LIMIT 15").all()).results || [];
    } catch (e) { err = String(e).slice(0, 200); }
  } else err = "No database is bound (DB). Run the setup-worker workflow in mode staging.";
  const cell = (p) => `<button type="button" class="n ${esc(p.state)}" data-n="${p.number}" ${p.state === "available" ? "" : "disabled"}><b>${String(p.number).padStart(2, "0")}</b><small>${esc(p.colorway)}<br>${esc(p.state)}</small></button>`;
  const row = (o) => `<tr><td>${esc(o.piece_id)}</td><td>${esc(o.status)}${o.cancel_reason ? " (" + esc(o.cancel_reason) + ")" : ""}</td><td><code>${esc(o.razorpay_payment_id)}</code></td><td>${o.refund_id ? "<code>" + esc(o.refund_id) + "</code>" : ""}</td><td>${esc(String(o.paid_at || "").slice(0, 16).replace("T", " "))}</td></tr>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KAAL staging checkout</title><meta name="robots" content="noindex">
<style>:root{--void:#080908;--bone:#EDE8DF;--mute:#B3AC9F;--line:#221F1C;--gold:#C6A15B}
body{margin:0;background:var(--void);color:var(--bone);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}
h1{font-weight:400;font-size:1.4rem;margin:.2rem 0}p{color:var(--mute);margin:.3rem 0 1rem}.warn{color:var(--gold)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:8px;max-width:720px}
.n{min-height:64px;background:#0E0F0D;color:var(--bone);border:1px solid var(--line);border-radius:6px;font:inherit;padding:6px;text-align:left}
.n b{display:block;font-variant-numeric:tabular-nums}.n small{color:var(--mute);font-size:.7rem}.n.available{border-color:var(--gold);cursor:pointer}
.n[disabled]{opacity:.45}.n.held{opacity:.7}table{border-collapse:collapse;margin-top:1rem;font-size:.8rem;max-width:720px;width:100%;display:block;overflow-x:auto}
td{border-bottom:1px solid var(--line);padding:6px 8px;white-space:nowrap}code{font-size:.75rem}#msg{min-height:1.5em;color:var(--gold)}</style></head>
<body><h1>KAAL staging checkout</h1>
<p class="warn">Razorpay TEST mode. No real money moves, the live site is never touched, and every email goes to the owner's inbox only.</p>
<p>Tap an available number to buy it with a test card (4111 1111 1111 1111, any future date, any CVV) or UPI <code>success@razorpay</code>.</p>
${err ? `<p class="warn">${esc(err)}</p>` : ""}
<div class="grid">${pieces.map(cell).join("")}</div><p id="msg" role="status"></p>
<table><tbody><tr><td>Piece</td><td>Order</td><td>Payment</td><td>Refund</td><td>Paid (UTC)</td></tr>${orders.map(row).join("")}</tbody></table>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
(function(){
  var by = "staging" + Math.random().toString(36).slice(2, 10), msg = document.getElementById("msg");
  function say(t){ msg.textContent = t; }
  document.addEventListener("click", function(e){
    var b = e.target.closest && e.target.closest(".n.available"); if(!b) return;
    var n = +b.getAttribute("data-n"); say("Opening a test checkout for No. " + n + "...");
    fetch("/order", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ n:n, by:by }) })
      .then(function(r){ return r.json(); }).then(function(d){
        if(!d || !d.ok){ say("Refused: " + (d && d.reason)); return; }
        var rzp = new Razorpay({ key:d.key_id, order_id:d.order_id, amount:d.amount, currency:d.currency, name:"KAAL (staging)",
          description:"TEST No. " + n, notes:{ kaal_no: String(n).padStart(2, "0") }, timeout: d.checkout_timeout || undefined,
          handler: function(res){
            fetch("/verify", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(res) })
              .then(function(r){ return r.json(); }).then(function(v){ say(v && v.ok ? "Paid and verified. The webhook places it; reloading in five seconds." : "Signature not verified."); setTimeout(function(){ location.reload(); }, 5000); });
          },
          modal:{ ondismiss: function(){ say("Closed. Nothing charged. The hold lasts " + Math.round((d.held_for || 0) / 60) + " minutes."); } } });
        rzp.open();
      }).catch(function(){ say("Could not reach /order."); });
  });
})();
</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" } });
}

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
    await withRegistry(env, out);
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
  await withRegistry(env, out);
  return json(request, env, out, { "Cache-Control": "public, max-age=10" });
}

/* The page only ever adds to what it believes is gone, so the registry's
   answer is merged in, never substituted: a number gone by either account
   is gone. */
async function withRegistry(env, out) {
  if (!registryOn(env)) return;
  try {
    const u = await unavailable(env, SERIES);
    out.sold = [...new Set((out.sold || []).concat(u.gone))].sort((a, b) => a - b);
    out.held = [...new Set((out.held || []).concat(u.held))].sort((a, b) => a - b);
    /* Where a number went, for the shop's grid: an owner's city appears
       only if that owner ticked the box, and an owner who registered and did
       not tick it takes precedence over any line written by hand. */
    const reg = (await env.DB.prepare("SELECT number, owner_no, owner_since, owner_city FROM public_registry WHERE series = ?1 AND owner_no IS NOT NULL").bind(SERIES).all()).results || [];
    if (reg.length) {
      const placed = Object.assign({}, out.placed || {});
      for (const r of reg) {
        if (r.owner_city) placed[r.number] = cleanNote(`${r.owner_city} · ${since(r.owner_since)}`, 40);
        else delete placed[r.number];
      }
      if (Object.keys(placed).length) out.placed = placed; else delete out.placed;
    }
  } catch (e) { console.log("Registry unavailable on /state:", String(e).slice(0, 160)); }
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

  /* The registry's hold is the real one when it is on: one SQL statement,
     so two buyers cannot both win it. KV keeps its copy for the page. */
  if (registryOn(env)) {
    try {
      const h = await holdPiece(env, SERIES, n, by || anonBy());
      if (!h.ok) return json(request, env, { ok: false, reason: h.reason === "held" ? "held" : "sold" });
    } catch (e) { console.log("Registry hold failed on /hold:", String(e).slice(0, 160)); }
  }

  const key = HOLD_PREFIX + n;
  const existing = await env.KAAL_STATE.get(key, "json").catch(() => null);
  /* Re-holding your own number extends it. Somebody else's does not. */
  if (existing && existing.by && existing.by !== by) return json(request, env, { ok: false, reason: "held" });

  const until = Date.now() + holdSeconds(env) * 1000;
  await env.KAAL_STATE.put(key, JSON.stringify({ by, until }), { expirationTtl: holdSeconds(env) });
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

  /* With the registry on: someone the shop does not sell to again is
     refused in words that accuse nobody, and the number is held before the
     Razorpay order exists, atomically, so it cannot be priced for two
     people at once. A registry that cannot be reached is logged and the
     checks above stand alone, as they always have. */
  const holder = by || anonBy();
  let dbHold = false;
  if (registryOn(env)) {
    try {
      if (buyer && await isBlocked(env, buyer.who.email, buyer.who.phone)) {
        console.log("Checkout refused: a blocked buyer.");
        return json(request, env, { ok: false, reason: "unavailable" }, {}, 403);
      }
      const h = await holdPiece(env, SERIES, n, holder);
      if (!h.ok) return json(request, env, { ok: false, reason: h.reason === "held" ? "held" : "sold" }, {}, 409);
      dbHold = true;
    } catch (e) { console.log("Registry unavailable on /order:", String(e).slice(0, 160)); }
  }
  const letGo = () => dbHold ? releaseHold(env, SERIES, n, holder).catch(() => null) : null;

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
    await letGo();
    return json(request, env, { ok: false, reason: "upstream" }, {}, 500);
  }

  if (res.status === 401 || res.status === 403) {
    console.log("Razorpay rejected the key pair on /order:", res.status);
    await letGo();
    return json(request, env, { ok: false, reason: "auth" }, {}, 401);
  }
  if (!res.ok || !order || !order.id) {
    console.log("Razorpay refused the order:", res.status, JSON.stringify(order || {}).slice(0, 300));
    await letGo();
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
  /* The owner's phone: a checkout is the moment a visitor is closest. Once
     a device in twenty minutes, so a buyer trying twice is one alert. */
  tellOwnerPhone(env, ctx, { kind: "checkout", no: pad2(n), by, who: buyer ? firstNameOf(buyer.who.name) : "",
    city: buyer ? buyer.parcel.city || "" : "", place: (request.cf && (request.cf.city || request.cf.region)) || "" });

  let heldFor = 0;
  if (env.KAAL_STATE) {
    try {
      await env.KAAL_STATE.put(
        HOLD_PREFIX + n,
        JSON.stringify({ by, until: Date.now() + holdSeconds(env) * 1000 }),
        { expirationTtl: holdSeconds(env) }
      );
      heldFor = holdSeconds(env);
    } catch (e) { console.log("Hold failed after a good order:", String(e).slice(0, 120)); }
  }
  if (dbHold) heldFor = holdSeconds(env);

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
    /* With the registry's hold, the checkout window closes half a minute
       before the hold does, so a payment cannot start on a number the
       hold has already let go of. Only sent then; the page uses it if so. */
    checkout_timeout: dbHold ? holdSeconds(env) - 30 : undefined,
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
  /* A payment the registry turned away as a second one for the same watch:
     the thank-you page must not tell its buyer the watch is theirs. */
  let fate = null;
  if (registryOn(env) && good) { try { fate = await paymentFate(env, good.id); } catch (e) { fate = null; } }
  let shipping = false;
  if (env.KAAL_STATE) { try { shipping = !!(await env.KAAL_STATE.get("ship:" + orderId)); } catch (e) { shipping = false; } }

  return json(request, env, {
    ok: true, paid, n,
    amount: order.amount, currency: order.currency || "INR",
    payment_id: good ? good.id : null,
    created_at: order.created_at,
    gift: !!(order.notes && order.notes.gift === "yes"),
    shipping,
    duplicate: !!(fate && fate.duplicate),
    refunded: !!(fate && fate.refunded),
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

  /* The first address is the address. An order id is not a secret: it sits
     in the thank-you page's address, in the buyer's email link, and in what
     that page's analytics see. Accepting a second address here let anyone
     holding one reroute a paid watch, and the owner's email said to "use
     this address, not the earlier one". A buyer who needs to change it
     replies to their confirmation, which the page already tells them, and
     a person checks it. */
  const updated = false;
  if (env.KAAL_STATE) {
    try {
      if (await env.KAAL_STATE.get("ship:" + orderId)) {
        console.log("Second address refused for", orderId);
        return json(request, env, { ok: false, reason: "exists" }, {}, 409);
      }
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
async function notifySale(env, entity, chosen, short, opts) {
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
    if (buyerOk && known && !(opts && opts.skipBuyer)) {
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
  /* THE REGISTRY, when it is on, decides first: this payment either places
     the piece (once, however many times Razorpay delivers it), or the piece
     already belongs to another order, and this is a second payment for one
     watch. That one is refunded and apologised for, and nothing below is
     said: no "No. 07 is yours", no commit, no Purchase to Meta. */
  const edition0 = parseInt(env.EDITION || "20", 10);
  /* A payment from before the owner put this number back on sale (their
     own test order, a sale refunded and released) is not a sale of it now. */
  if (!short && chosen >= 1 && chosen <= edition0 && await paidBeforeRelease(env, chosen, entity)) {
    console.log(`No. ${pad2(chosen)}: a payment from before it went back on sale (${paymentId}); not a sale.`);
    return new Response("A payment from before this number went back on sale: not recorded.", { status: 200 });
  }
  let placedLetter = false;
  if (registryOn(env) && !short && chosen >= 1 && chosen <= edition0) {
    let fate = null;
    try { fate = await recordPayment(env, await paymentRecord(env, entity, chosen, order)); }
    catch (e) { console.log("Registry write failed on the webhook:", String(e).slice(0, 160)); }
    if (fate && fate.outcome === "duplicate") return duplicatePayment(env, entity, chosen, fate);
    /* The buyer's confirmation is the Placed letter (the brief's words),
       through the outbox: it is not lost if the provider is down, and a
       webhook delivered twice queues it once. If it cannot be made (stage
       emails off, no email on the order, the registry write failed), the
       earlier confirmation still goes, so a buyer is never left without. */
    if (fate && (fate.outcome === "placed" || fate.outcome === "already") && fate.order) {
      try {
        const q = await queuePlaced(env, siteUrl(env), fate.order);
        if (q !== 0) placedLetter = true;
        if (q > 0) regDeps(env, ctx).kick([q]);
        if (q !== 0 && !fate.order.address_line1) {
          const a = await queueAddressAsk(env, siteUrl(env), fate.order, `${siteUrl(env)}/claimed.html?o=${encodeURIComponent(entity.order_id || "")}&n=${pad2(chosen)}#ship`);
          if (a > 0) regDeps(env, ctx).kick([a]);
        }
      } catch (e) { console.log("Placed letter failed to queue:", String(e).slice(0, 160)); }
    }
  }

  const mail = notifySale(env, entity, chosen, short, { skipBuyer: placedLetter });
  if (ctx && ctx.waitUntil) ctx.waitUntil(mail);

  /* Meta hears now too, for the same reason, and whatever the commit then
     says (section 3b). A retry that finds the sale already recorded used to
     return before this line was reached, and Meta never heard at all. */
  const edition = parseInt(env.EDITION || "20", 10);
  let told = null;
  if (!short && chosen >= 1 && chosen <= edition) {
    told = sendPurchaseToMeta(env, entity, chosen, order || undefined);
    if (ctx && ctx.waitUntil) ctx.waitUntil(told);
  }

  if (short) {
    if (!(ctx && ctx.waitUntil)) await mail;
    return new Response("Captured, but not the price: not recorded as a sale.", { status: 200 });
  }

  /* THE BOOKKEEPING THAT MUST NOT WAIT ON GITHUB, on every delivery, the
     retry included: KV (what the live page and /order read within
     seconds), then the live view and the buyer's own history ("paid").
     Writing to GitHub takes seconds; Razorpay stops waiting after a few
     and sends the webhook again. The retry used to find the number
     "already" sold and return before either line ran, so a real sale never
     showed as paid on the desk or in the visitor's history. Both are
     idempotent: the number is added once, the history step is kept once. */
  const numberOk = chosen >= 1 && chosen <= edition;
  if (numberOk && !staging(env)) {
    await markSoldKv(env, chosen);
    liveTell(env, ctx, { e: "paid", no: pad2(chosen), dial: DIAL_OF(env, chosen), paise: entity.amount || 0, o: entity.order_id || "",
      em: String(entity.email || "").toLowerCase().slice(0, 120), ph: String(entity.contact || "").replace(/\D/g, "").slice(-10) });
    tellOwnerPhone(env, ctx, { kind: "sale", no: pad2(chosen), paise: entity.amount || 0 });
  }

  /* The commit runs under waitUntil, so Razorpay closing the connection at
     its timeout cannot cut it off between writing the file and moving main;
     it is awaited for a few seconds so a quick one still answers with its
     result. One that fails is mended by the half-hourly repair (repairSold). */
  const job = commitSold(env, chosen, paymentId).catch(e => { console.log("Commit threw:", String(e).slice(0, 160)); return { status: "error" }; });
  if (ctx && ctx.waitUntil) ctx.waitUntil(job.then(r => { if (r.status === "error") console.log(`No. ${chosen}: the sold list commit failed; the repair run retries it.`); }));
  const commit = ctx && ctx.waitUntil ? await Promise.race([job, new Promise(res => setTimeout(() => res({ status: "pending" }), COMMIT_WAIT_MS))]) : await job;

  if (commit.status === "bad-number") {
    console.log("payment.captured with no usable kaal_no:", String(raw).slice(0, 40));
    return new Response("Captured but no valid kaal_no — check manually.", { status: 200 });
  }
  if (commit.status === "already") return new Response(`Number ${chosen} already recorded as sold.`, { status: 200 });
  if (commit.status === "skipped") {
    if (!(ctx && ctx.waitUntil)) { await mail; if (told) await told; }
    return new Response(`OK (staging): number ${chosen} placed in the registry; the live site is untouched.`, { status: 200 });
  }
  /* The payment is recorded (registry, KV, live view); only the file is
     behind, and the repair run writes it. A 502 here would only make
     Razorpay deliver it again. */
  if (commit.status === "error") return new Response(`Number ${chosen} recorded; the site file is written by the next repair run.`, { status: 200 });
  if (commit.status === "pending") return new Response(`Number ${chosen} recorded; the site file is being written.`, { status: 200 });

  console.log(`Number ${chosen} marked sold. GitHub Pages will rebuild shortly.`);
  if (!(ctx && ctx.waitUntil)) { await mail; if (told) await told; }
  return new Response(`OK — number ${chosen} recorded as sold.`, { status: 200 });
}
const COMMIT_WAIT_MS = 3500;

/* A phone alert to the owner (worker/push.js), in the background. */
function tellOwnerPhone(env, ctx, n) {
  if (staging(env) || !env.KAAL_STATE) return;
  const job = (async () => {
    let note;
    if (n.kind === "sale") note = { kind: "sale", title: `Sold: No. ${n.no} · ${rupees(n.paise)}`, body: "Paid just now. The buyer's letter is on its way. Tap for the order.", url: "/control#orders", tag: "sale-" + n.no };
    else if (n.kind === "checkout") {
      if (n.by) {
        const key = "push:co:" + n.by;
        if (await env.KAAL_STATE.get(key).catch(() => null)) return;
        await env.KAAL_STATE.put(key, "1", { expirationTtl: 1200 }).catch(() => null);
      }
      const who = [n.who || "A visitor", n.city || n.place].filter(Boolean).join(", ");
      note = { kind: "checkout", title: `Checkout open: No. ${n.no}`, body: `${who} is at the payment step now.`, url: "/control#activity", tag: "co-" + n.no, urgency: "normal", ttl: 1800 };
    } else note = n;
    await notifyOwner(env, note);
  })().catch(e => console.log("Phone alert threw:", String(e).slice(0, 120)));
  if (ctx && ctx.waitUntil) ctx.waitUntil(job);
}

/* The number into KV's sold list, once; and its hold, gone. */
async function markSoldKv(env, n) {
  if (!env.KAAL_STATE) return;
  try {
    const sold = (await readSold(env)) || [];
    if (sold.indexOf(n) < 0) { sold.push(n); await env.KAAL_STATE.put(KEY_SOLD, JSON.stringify(sold.sort((a, b) => a - b))); }
    await env.KAAL_STATE.delete(HOLD_PREFIX + n);
  } catch (e) { console.log("KV sold update failed:", String(e).slice(0, 120)); }
}

/* What the registry keeps about a paid order: the payment's own email and
   phone, and the name and address the buyer gave at checkout (KV), when
   they gave them before paying. */
async function paymentRecord(env, entity, n, order) {
  let ship = null;
  if (env.KAAL_STATE && entity.order_id) ship = await env.KAAL_STATE.get("ship:" + entity.order_id, "json").catch(() => null);
  const notes = (order && order.notes) || entity.notes || {};
  return {
    series: SERIES, n, paymentId: String(entity.id), orderId: entity.order_id || null,
    amount: entity.amount || 0, currency: String(entity.currency || "INR").toUpperCase(),
    email: entity.email || (ship && ship.buyer && ship.buyer.email) || "", phone: entity.contact || (ship && ship.buyer && ship.buyer.phone) || "",
    name: (ship && ship.buyer && ship.buyer.name) || (ship && ship.name) || "",
    address: ship ? { line1: ship.line1, line2: ship.line2, city: ship.city, state: ship.state, pin: ship.pin } : null,
    gift: notes.gift === "yes", giftNote: notes.gift_note || "",
    paidAt: entity.created_at ? new Date(entity.created_at * 1000).toISOString() : new Date().toISOString()
  };
}

/* A second payment for a watch that already went. It is refunded in full,
   once (claimRefund lets exactly one delivery ask Razorpay), and the buyer
   is written to only when the refund exists, so the email can say it is
   done. If Razorpay refuses, the claim is given back and the webhook
   answers 502, so Razorpay delivers it again and the refund is retried;
   the owner hears the first time, and again when it goes through.
   The refund carries notes.reason "duplicate", which recordRefund reads so
   that this refund is not mistaken for a returned watch. */
async function duplicatePayment(env, entity, n, fate) {
  const o = fate.order;
  if (o.refund_id) return new Response(`Duplicate payment for No. ${pad2(n)}: already refunded.`, { status: 200 });
  if (!(await claimRefund(env, o.id))) return new Response(`Duplicate payment for No. ${pad2(n)}: refund in progress.`, { status: 200 });

  const { id: refundId, error } = await refundPayment(env, entity.id, entity.amount, "duplicate", n, "dup-");

  const buyer = String(entity.email || "").trim();
  const buyerOk = buyer && validEmail(buyer.toLowerCase());
  const d = { site: siteUrl(env), n, amount: rupees(entity.amount), paymentId: String(entity.id), refundId, error, email: buyerOk ? buyer : "" };
  const toOwner = ownerDuplicate(d);
  if (refundId) {
    await refundDone(env, o.id, refundId, SERIES);
    console.log(`Duplicate payment ${entity.id} for No. ${pad2(n)} refunded (${refundId}).`);
    const sends = [sendEmail(env, ownerInbox(env), toOwner.subject, toOwner.text, toOwner.html, buyerOk ? buyer : undefined)];
    if (buyerOk) { const m = buyerDuplicate(d); sends.push(sendEmail(env, buyer, m.subject, m.text, m.html)); }
    await Promise.all(sends);
    return new Response(`Duplicate payment for No. ${pad2(n)}: refunded.`, { status: 200 });
  }
  await refundFailed(env, o.id);
  console.log(`Duplicate payment ${entity.id} for No. ${pad2(n)}: refund failed (${error}).`);
  if (fate.fresh) await sendEmail(env, ownerInbox(env), toOwner.subject, toOwner.text, toOwner.html);
  return new Response("Duplicate payment: the refund failed; deliver again.", { status: 502 });
}

/* ══════════ 3f. INTO THE REGISTRY ══════════

   Going live: every paid order Razorpay already holds becomes an order in
   the registry, so the control room starts with the real shop in it.
   Nothing is emailed to anyone; it only writes down what already happened.

     a captured, full-price payment for a number      placed (recordPayment,
                                                      the same idempotent path
                                                      as the webhook)
     ...that the old desk had marked dispatched       dispatched, with its
                                                      courier and tracking
     a number the owner keeps off sale (No. 09)       left withheld
     refunded in full, or below the price             left out
     a number the live site lists as sold with no     marked placed and named,
     payment Razorpay knows of (Nos. 01 and 02)       to be recorded by hand
                                                      ("Record a past sale")
     two captured payments for one number             reported, never refunded
                                                      here: that is a person's
                                                      decision

   Running it again changes nothing that is already in. */
async function importPaid(env) {
  if (!registryOn(env)) return { ok: false, reason: "off" };
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return { ok: false, reason: "razorpay" };
  const now = Math.floor(Date.now() / 1000);
  const pays = await listPayments(env, now - 400 * 86400, now + 60, 2000);
  if (!pays) return { ok: false, reason: "razorpay" };
  const price = parseInt(env.PRICE_PAISE || "0", 10), edition = parseInt(env.EDITION || "20", 10);
  const currency = String(env.CURRENCY || "INR").toUpperCase();
  const r = { ok: true, imported: [], already: [], dispatched: [], withheld: [], released: [], duplicates: [], needsRecord: [], skipped: 0 };
  for (const p of pays.sort((a, b) => a.created_at - b.created_at)) {
    if (p.status !== "captured" || (p.amount || 0) < price || String(p.currency || "INR").toUpperCase() !== currency) { r.skipped++; continue; }
    const order = p.order_id ? await readOrder(env, p.order_id) : null;
    const n = parseInt((order && order.notes && order.notes.kaal_no) || (p.notes && p.notes.kaal_no), 10);
    if (!(n >= 1 && n <= edition)) { r.skipped++; continue; }
    const piece = await env.DB.prepare("SELECT status, order_ref FROM pieces WHERE series = ?1 AND number = ?2").bind(SERIES, n).first();
    if (piece && piece.status === "withheld") { r.withheld.push(n); continue; }
    if (await paidBeforeRelease(env, n, p)) { r.released.push(n); continue; }
    const fate = await recordPayment(env, await paymentRecord(env, p, n, order));
    if (fate.outcome === "duplicate") { r.duplicates.push({ n, payment: p.id }); continue; }
    if (fate.outcome !== "placed") { r.already.push(n); continue; }
    r.imported.push(n);
    /* What the old desk already knew: it was sent, with this courier. */
    const sent = env.KAAL_STATE && p.order_id ? await env.KAAL_STATE.get("sent:" + p.order_id, "json").catch(() => null) : null;
    if (sent && sent.at) {
      await env.DB.prepare(`UPDATE orders SET status = 'dispatched', courier = ?1, tracking_number = ?2, tracking_url = ?3, dispatched_at = ?4, updated_at = ?5
        WHERE id = ?6 AND status = 'placed'`).bind(sent.courier || null, sent.tracking || null, sent.url || null, sent.at, new Date().toISOString(), fate.order.id).run();
      r.dispatched.push(n);
    }
  }
  /* Sold on the live site, unknown to Razorpay: never "available" here. */
  const listed = (await readSold(env)) || (await readSoldFromGitHub(env)) || [];
  for (const n of listed) {
    const pc = await env.DB.prepare("SELECT id, status, order_ref FROM pieces WHERE series = ?1 AND number = ?2").bind(SERIES, n).first();
    if (!pc || pc.order_ref || pc.status === "withheld") continue;
    /* Put back on sale by the owner: a list read a moment before says nothing. */
    if (env.KAAL_STATE && await env.KAAL_STATE.get("released:" + n).catch(() => null)) continue;
    if (pc.status === "available" || pc.status === "held") {
      await env.DB.prepare("UPDATE pieces SET status = 'placed', notes = COALESCE(notes, ?1), held_by = NULL, held_until = NULL, updated_at = ?2 WHERE id = ?3")
        .bind("Sold before the registry: record its sale (Orders, Record a past sale).", new Date().toISOString(), pc.id).run();
    }
    r.needsRecord.push(n);
  }
  await auditRegistry(env, "registry.import", r);
  if (env.KAAL_STATE) await env.KAAL_STATE.put("registry:imported", JSON.stringify({ at: new Date().toISOString(), r })).catch(() => null);
  console.log("Registry import:", JSON.stringify(r).slice(0, 300));
  return r;
}
/* "Is it up?": the worker answers, and so does the registry's database. */
async function health(env) {
  const out = { ok: true, at: new Date().toISOString(), registry: registryOn(env) ? "on" : "off" };
  if (registryOn(env)) {
    try { await env.DB.prepare("SELECT 1 AS up").first(); out.db = true; }
    catch (e) { out.ok = false; out.db = false; }
  }
  return new Response(JSON.stringify(out), { status: out.ok ? 200 : 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

/* ══════════ 3g. THE DAILY CHECK AGAINST RAZORPAY ══════════

   Once a day (India time) the worker asks Razorpay for what it captured and
   compares it with the registry, the same way the go-live import does. A
   payment Razorpay took that the webhook never told us about is recorded,
   its buyer gets the Placed letter, and the owner is told that the webhook
   missed it. A second payment for one number is told to the owner (the
   webhook is what refunds it; this is only the net under it). Nothing here
   moves an order or refunds anyone. */
async function reconcileDaily(env, ctx) {
  try {
    if (!registryOn(env) || !env.KAAL_STATE || !env.RAZORPAY_KEY_ID || staging(env)) return;
    const key = "recon:" + istDay(Date.now());
    if (await env.KAAL_STATE.get(key).catch(() => "x")) return;
    await env.KAAL_STATE.put(key, "1", { expirationTtl: 3 * 86400 });
    const r = await importPaid(env);
    const lines = [];
    if (!r.ok) lines.push("The daily check could not read Razorpay's payments (" + (r.reason || "unknown") + "). Nothing was changed.");
    else {
      const deps = regDeps(env, ctx);
      for (const n of r.imported) {
        lines.push(`No. ${pad2(n)} was paid for, and Razorpay's webhook never told us. It is recorded now. Check the webhook in Razorpay (Settings, Webhooks): it should send payment.captured to ${workerUrl(env)}/.`);
        const o = await env.DB.prepare("SELECT o.* FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE p.series = ?1 AND p.number = ?2 AND o.status = 'placed' ORDER BY o.id DESC").bind(SERIES, n).first();
        if (o && Date.now() - Date.parse(o.paid_at) < 4 * 86400000) {
          const q = await queuePlaced(env, siteUrl(env), o);
          if (q > 0) deps.kick([q]);
        }
      }
      for (const d of r.duplicates) {
        const seen = "recon:dup:" + d.payment;
        if (await env.KAAL_STATE.get(seen).catch(() => null)) continue;
        await env.KAAL_STATE.put(seen, "1", { expirationTtl: 60 * 86400 });
        lines.push(`A second payment (${d.payment}) exists for No. ${pad2(d.n)}. It should have been refunded automatically; check it in Razorpay.`);
      }
    }
    if (lines.length) {
      const text = lines.join("\n\n") + "\n";
      await sendEmail(env, ownerInbox(env), "[KAAL] The daily check against Razorpay found something", text, "<p>" + lines.map(esc).join("</p><p>") + "</p>");
    }
  } catch (e) { console.log("Daily check threw:", String(e).slice(0, 160)); }
}

/* The net under the webhook's commit, every half hour: a number the
   registry holds a paid order for (placed, delivered, registered) that the
   site file still offers is written onto the sold list. It only ever adds;
   taking a number off is the owner's decision alone (On sale, Pieces). */
async function repairSold(env) {
  if (staging(env) || !env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.DB) return;
  try {
    const rows = (await env.DB.prepare("SELECT number FROM pieces WHERE series = ?1 AND status IN ('placed','delivered','registered')").bind(SERIES).all()).results || [];
    if (!rows.length) return;
    const listed = await readSoldFromGitHub(env);
    if (!listed) return;
    const missing = rows.map(r => r.number).filter(n => listed.indexOf(n) < 0);
    if (!missing.length) return;
    for (const n of missing) await markSoldKv(env, n);
    const r = await rewriteSold(env, (current) => {
      const add = missing.filter(n => current.indexOf(n) < 0);
      return add.length ? { next: current.concat(add).sort((a, b) => a - b) } : { status: "already" };
    }, `Auto: mark ${missing.map(pad2).join(", ")} sold (repair: paid in the registry, missing from the site)`);
    console.log(`Repair: ${missing.map(pad2).join(", ")} ${r.status === "ok" ? "written to the sold list" : "not written (" + r.status + ")"}.`);
  } catch (e) { console.log("Repair threw:", String(e).slice(0, 160)); }
}

/* What the owner asked for in words, done once by the worker on the first
   run after it is deployed, through the same path as the command centre's
   own buttons, and written to the audit log. Each runs only while the
   piece is still exactly as it was when it was asked for. */
const OWNER_OPS = [
  { id: "2026-10-28-release-09", n: 9, from: "withheld", to: "available",
    why: "Owner's request: No. 09 (the owner's own test order, kept back since 2 Oct 2026) goes on sale." }
];
async function ownerOps(env) {
  if (staging(env) || env.OWNER_OPS === "off" || !env.KAAL_STATE || !env.DB) return;
  for (const op of OWNER_OPS) {
    try {
      const key = "op:" + op.id;
      if (await env.KAAL_STATE.get(key).catch(() => "x")) continue;
      const pc = await env.DB.prepare("SELECT id, status, order_ref FROM pieces WHERE series = ?1 AND number = ?2").bind(SERIES, op.n).first();
      const open = await env.DB.prepare("SELECT COUNT(*) AS c FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE p.series = ?1 AND p.number = ?2 AND o.status NOT IN ('cancelled','returned')").bind(SERIES, op.n).first();
      if (!pc || pc.status !== op.from || pc.order_ref || (open && open.c)) {
        await env.KAAL_STATE.put(key, JSON.stringify({ at: new Date().toISOString(), skipped: pc ? pc.status : "no piece" }));
        continue;
      }
      const r = await setOnSale(env, "system:owner-request", op.n, op.to === "available", op.why);
      await env.KAAL_STATE.put(key, JSON.stringify({ at: new Date().toISOString(), site: r.site }));
      console.log(`Owner op ${op.id}: ${r.ok ? "done" : "failed"} (site: ${r.site}).`);
    } catch (e) { console.log("Owner op threw:", String(e).slice(0, 160)); }
  }
}

/* ON SALE, OR KEPT BACK: one number, everywhere at once. The registry
   (D1) first, because it is what /order checks; then KV, which the live
   page reads within seconds; then the site's own file, llms.txt and
   edition.json in one commit. A number with a paid order cannot be put
   back on sale here (refund or mark it returned first), and a kept-back
   number is on the sold list, so the page shows it gone.
   Returns { ok, status, site: "ok" | "already" | "error" | "skipped", why }. */
async function setOnSale(env, actor, n, on, reason) {
  const edition = parseInt(env.EDITION || "20", 10);
  if (!(n >= 1 && n <= edition)) return { ok: false, why: "No such number." };
  const pc = await env.DB.prepare("SELECT * FROM pieces WHERE series = ?1 AND number = ?2").bind(SERIES, n).first();
  if (!pc) return { ok: false, why: "No such piece in the registry." };
  if (on) {
    if (["placed", "delivered", "registered", "reported_stolen"].indexOf(pc.status) > -1)
      return { ok: false, why: `No. ${pad2(n)} is ${pc.status.replace("_", " ")} with an order. Refund it or mark it returned before it can go back on sale.` };
    if (pc.status !== "available") await env.DB.prepare("UPDATE pieces SET status = 'available', held_by = NULL, held_until = NULL, order_ref = NULL, updated_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), pc.id).run();
    const r = await releaseSold(env, n, reason || "owner");
    /* Any payment for this number made before this moment (the owner's own
       test order, a refunded sale) can never place it again: the daily
       check against Razorpay and a late webhook both read this. */
    if (env.KAAL_STATE) {
      await env.KAAL_STATE.delete(HOLD_PREFIX + n).catch(() => null);
      await env.KAAL_STATE.put("released:" + n, new Date().toISOString()).catch(() => null);
    }
    await auditPiece(env, actor, pc, "available", reason, r.status);
    return { ok: true, status: "available", site: r.status };
  }
  if (["placed", "delivered", "registered"].indexOf(pc.status) > -1) return { ok: true, status: pc.status, site: "already" };
  if (pc.status !== "withheld") await env.DB.prepare("UPDATE pieces SET status = 'withheld', held_by = NULL, held_until = NULL, updated_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), pc.id).run();
  await markSoldKv(env, n);
  const r = await rewriteSold(env, (current) => current.indexOf(n) > -1 ? { status: "already" } : { next: current.concat([n]).sort((a, b) => a - b) },
    `Auto: number ${n} kept back from sale (${String(reason || "owner").slice(0, 80)})`);
  await auditPiece(env, actor, pc, "withheld", reason, r.status);
  return { ok: true, status: "withheld", site: r.status };
}
async function auditPiece(env, actor, pc, to, reason, site) {
  try {
    await env.DB.prepare("INSERT INTO audit_log (actor, action, target, before, after, series) VALUES (?1, 'piece.sale', ?2, ?3, ?4, ?5)")
      .bind(actor, "piece:" + pc.id, JSON.stringify({ status: pc.status }), JSON.stringify({ status: to, reason: String(reason || "").slice(0, 200), site }), SERIES).run();
  } catch (e) { console.log("Audit write failed:", String(e).slice(0, 120)); }
}

/* A payment for a number made before the owner last put it back on sale. */
async function paidBeforeRelease(env, n, p) {
  if (!env.KAAL_STATE) return false;
  const at = await env.KAAL_STATE.get("released:" + n).catch(() => null);
  return !!at && (p.created_at || 0) * 1000 < Date.parse(at);
}

async function autoImport(env) {
  try {
    if (!env.KAAL_STATE || await env.KAAL_STATE.get("registry:imported").catch(() => "x")) return;
    await importPaid(env);
  } catch (e) { console.log("Registry import threw:", String(e).slice(0, 160)); }
}
async function auditRegistry(env, action, after) {
  try { await env.DB.prepare("INSERT INTO audit_log (actor, action, target, after, series) VALUES ('system:import', ?1, 'registry', ?2, ?3)").bind(action, JSON.stringify(after), SERIES).run(); }
  catch (e) { console.log("Audit write failed:", String(e).slice(0, 120)); }
}

/* A full refund through Razorpay, with the reason in its notes (recordRefund
   reads "duplicate"). { id } or { error }, never a throw. */
async function refundPayment(env, paymentId, amount, reason, n, prefix) {
  try {
    const res = await fetch(`${RZP_API}/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, razorpayAuth(env)),
      body: JSON.stringify({ amount, speed: "normal", receipt: ((prefix || "kaal-") + paymentId).slice(0, 40),
        notes: { reason, kaal_no: n ? pad2(n) : "" } })
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.id) return { id: j.id, error: "" };
    return { id: "", error: `HTTP ${res.status}${j && j.error && j.error.description ? ": " + String(j.error.description).slice(0, 160) : ""}` };
  } catch (e) { return { id: "", error: String(e).slice(0, 160) }; }
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
  /* Staging never writes the live site's sold list, either way. */
  if (staging(env)) return { status: "skipped" };
  /* First choice: one commit that changes the sold list AND every count a
     reader without a script sees (worker/stock.js): index.html, llms.txt,
     edition.json together. If anything about that path fails, the single
     file write below still marks the number, as it always has. */
  const atomic = await commitStock(env, change, message).catch(e => { console.log("Stock commit failed:", String(e).slice(0, 160)); return { status: "error" }; });
  if (atomic.status !== "error") return atomic;
  return rewriteIndexOnly(env, change, message);
}

const ghHeaders = (env, raw) => ({
  "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
  "Accept": raw ? "application/vnd.github.raw" : "application/vnd.github+json",
  "User-Agent": "kaal-edition-worker"
});
const soldPattern = /sold:\s*\[([^\]]*)\]/;
const soldOf = (html) => { const m = html.match(soldPattern); return m ? m[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : null; };

/* The Git Data API: read main, write a tree of three files on top of it,
   a commit, then move main to it only if main has not moved (no force).
   A race with another commit re-reads and tries again. */
async function commitStock(env, change, message) {
  const repo = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
  const branch = env.GITHUB_BRANCH || "main";
  const H = ghHeaders(env), json = (o) => ({ method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify(o) });
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = await fetch(`${repo}/git/ref/heads/${branch}`, { headers: H });
    if (!ref.ok) return { status: "error" };
    const head = ((await ref.json()).object || {}).sha;
    if (!/^[0-9a-f]{40}$/.test(head || "")) return { status: "error" };
    const [hRes, lRes] = await Promise.all([
      fetch(`${repo}/contents/index.html?ref=${head}`, { headers: ghHeaders(env, true) }),
      fetch(`${repo}/contents/llms.txt?ref=${head}`, { headers: ghHeaders(env, true) })
    ]);
    if (!hRes.ok) return { status: "error" };
    const html = await hRes.text(), llms = lRes.ok ? await lRes.text() : "";
    const current = soldOf(html);
    if (!current) { console.log("Could not find `sold:` array: has index.html's config shape changed?"); return { status: "error" }; }
    const edition = parseInt((html.match(/edition:\s*(\d+)/) || [])[1], 10) || 20;
    const step = change(current, edition);
    if (step.status) return step;
    const nextHtml = applyStockHtml(html.replace(soldPattern, `sold:     [${step.next.join(", ")}]`));
    const st = stockOf(configOf(nextHtml)), day = stockDay(Date.now());
    const files = [{ path: "index.html", mode: "100644", type: "blob", content: nextHtml },
      { path: "edition.json", mode: "100644", type: "blob", content: editionJson(st, day) }];
    if (llms) files.push({ path: "llms.txt", mode: "100644", type: "blob", content: applyStockLlms(llms, st, day) });
    const base = await fetch(`${repo}/git/commits/${head}`, { headers: H });
    if (!base.ok) return { status: "error" };
    const tree = await fetch(`${repo}/git/trees`, json({ base_tree: (await base.json()).tree.sha, tree: files }));
    if (!tree.ok) return { status: "error" };
    const commit = await fetch(`${repo}/git/commits`, json({ message, tree: (await tree.json()).sha, parents: [head] }));
    if (!commit.ok) return { status: "error" };
    const moved = await fetch(`${repo}/git/refs/heads/${branch}`, Object.assign(json({ sha: (await commit.json()).sha, force: false }), { method: "PATCH" }));
    if (moved.ok) return { status: "ok" };
    if (moved.status === 422 || moved.status === 409) continue;        /* main moved under us: read it again */
    console.log("GitHub ref update failed:", moved.status, (await moved.text()).slice(0, 200));
    return { status: "error" };
  }
  return { status: "error" };
}

/* The original path, kept as the fallback: one file, the contents API.
   It still prints the counts (applyStockHtml); only llms.txt and
   edition.json wait for the next commit that carries them. */
async function rewriteIndexOnly(env, change, message) {
  const owner  = env.GITHUB_OWNER, repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const api    = `https://api.github.com/repos/${owner}/${repo}/contents/index.html`;
  const headers = ghHeaders(env);

  for (let attempt = 0; attempt < 3; attempt++) {
    const getRes = await fetch(`${api}?ref=${branch}`, { headers });
    if (!getRes.ok) {
      console.log("GitHub GET failed:", getRes.status, (await getRes.text()).slice(0, 300));
      return { status: "error" };
    }
    const file = await getRes.json();
    const decoded = b64Text(file.content);

    const editionMatch = decoded.match(/edition:\s*(\d+)/);
    const edition = editionMatch ? parseInt(editionMatch[1], 10) : 20;

    const current = soldOf(decoded);
    if (!current) {
      console.log("Could not find `sold:` array: has index.html's config shape changed?");
      return { status: "error" };
    }

    const step = change(current, edition);
    if (step.status) return step;

    let next = decoded.replace(soldPattern, `sold:     [${step.next.join(", ")}]`);
    try { next = applyStockHtml(next); } catch (e) { console.log("Counts not printed:", String(e).slice(0, 120)); }
    const putRes = await fetch(api, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify({ message, content: textB64(next), sha: file.sha, branch })
    });

    if (putRes.ok) return { status: "ok" };
    if (putRes.status === 409) continue;        /* somebody else committed first: re-read and retry */

    console.log("GitHub PUT failed:", putRes.status, (await putRes.text()).slice(0, 300));
    return { status: "error" };
  }
  console.log("GitHub PUT conflicted three times running.");
  return { status: "error" };
}

/* GitHub's base64 is of UTF-8 bytes; the page has ₹ and Devanagari in it. */
function b64Text(b64) {
  const bin = atob(String(b64 || "").replace(/\n/g, "")), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function textB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function commitSold(env, chosen, paymentId) {
  /* Staging takes test-mode payments: none of them may ever touch the live
     site's sold list. The registry is staging's record. */
  if (staging(env)) return { status: "skipped" };
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
  /* KV follows whatever GitHub says: the registry already says "on sale",
     and the page and /order read KV, not the file. */
  if (env.KAAL_STATE) {
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

  /* What the last run did, for the desk's Health list: the owner cannot
     read this worker's logs, and "nothing went" needs a reason. */
  const told = (msg, bad) => env.KAAL_STATE.put("followrun", JSON.stringify({ at: new Date(nowMs).toISOString(), msg, bad: !!bad }),
    { expirationTtl: 7 * 86400 }).catch(() => null);
  const now = Math.floor(nowMs / 1000);
  const payments = await listPayments(env, now - PAID_DAYS * 86400, now, 2000);
  if (!payments) { await told("Razorpay refused the payment listing, so nothing was sent.", true); return; }
  const countKey = "sent:" + istDay(nowMs);
  const count = (await env.KAAL_STATE.get(countKey, "json").catch(() => null)) || {};
  const R = { env, nowMs, now, payments, count, run: 0, written: new Set(), site: siteUrl(env),
    edition: parseInt(env.EDITION || "20", 10), paid: await paidEmails(env, payments),
    gap: Math.max(0, parseInt(env.FOLLOW_GAP_MS || "600", 10) || 0) };
  let failed = "";
  try {
    if (want.nearly) await nearlyRound(R);
    if (want.s02) await seriesTwoRound(R);
    if (want.after1 || want.after2 || want.after3) await afterRound(R, want);
  } catch (e) { failed = String(e).slice(0, 160); console.log("Follow-up emails threw:", failed); }
  const kinds = [["nearly", "nearly bought"], ["s02", "Series 02"], ["after1", "arrival"], ["after2", "seven-day"], ["after3", "one-year"]]
    .filter(([k]) => R.count[k]).map(([k, label]) => `${label} ${R.count[k]}`).join(", ");
  await told(failed ? `Stopped by an error after ${R.run} sent: ${failed}`
    : R.sold === null ? "The sold list could not be read, so nothing that states a count was sent."
    : `${R.run} sent this run; ${R.count.total || 0} today${kinds ? " (" + kinds + ")" : ""}.` +
      (R.run ? "" : ` Checked ${R.payments.length} payments and ${(R.checkouts || []).length} unpaid checkouts; nobody new was due.`), !!failed);
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
  /* Resend's free plan takes two requests a second, and a send it refuses
     here is never tried again (the once-key below), so the sends are
     spaced rather than fired back to back. */
  if (R.run > 0 && R.gap > 0) await new Promise(r => setTimeout(r, R.gap));
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
  let list      = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return false;
  /* Staging writes to the owner only, whoever the email was for, and says
     so in the subject: a test payment made with a real person's address
     must never reach that person. */
  if (staging(env)) { subject = `[Staging, for ${list.join(", ")}] ${subject}`.slice(0, 250); list = ownerInbox(env); }
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
  "number", "caseback_view", "gift", "checkout", "details", "list", "film", "provenance_click", "deeplink",
  /* Once per visit, however many times it happened in it: the Today dashboard's funnel. */
  "s_view", "s_number", "s_checkout", "s_details"]);

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
  const br = app ? app + " app" : /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return { app, os, dev, br };
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
    g: l.g === 1 || l.g === true, ev: [], c: camp(l.c), m: camp(l.m), a: camp(l.a) }, uaInfo(request.headers.get("User-Agent")), geoOf(request));
  for (const e of Array.isArray(l.ev) ? l.ev.slice(0, 16) : []) {
    if (!e || !LIVE_EV.has(e.e)) continue;
    out.ev.push({ e: e.e, no: /^\d{1,2}$/.test(e.no || "") ? String(e.no) : "",
      dial: /^[A-Za-z]{3,12}$/.test(e.dial || "") ? String(e.dial) : "",
      x: String(e.x || "").replace(/<[^>]*>?/g, "").replace(/[^A-Za-z0-9 .,'()-]/g, "").slice(0, 60) });
  }
  return out;
}

/* The ad's own names for itself (utm_campaign, utm_medium, utm_content),
   as the ad was set up: a few safe characters, kept short. */
function camp(v) { return String(v || "").replace(/[^A-Za-z0-9 ._|:+-]/g, "").trim().slice(0, 60); }
/* Roughly where, as Cloudflare places the connection: a city, its state,
   the country. The address itself is never read or kept. */
function geoOf(request) {
  const cf = (request && request.cf) || {}, place = (v) => String(v || "").replace(/[^\p{L} .'-]/gu, "").trim().slice(0, 40);
  return { gc: /^[A-Z]{2}$/.test(cf.country || "") ? cf.country : "", gr: place(cf.region), gt: place(cf.city) };
}

/* The page's minute check: "this visit is still here, and here". */
function liveSeen(request, env, ctx, q) {
  if (!countable(request, env)) return;
  const live = liveVisit(request, { v: q.get("h"), u: q.get("u"), w: q.get("w"), n: q.get("n"), d: q.get("d"), s: q.get("s"),
    c: q.get("c"), m: q.get("m"), a: q.get("a") });
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

/* What a visitor did, reduced to what the desk sorts and counts by. Kept
   as columns beside the steps, so a breakdown of ninety days is one SQL
   query and not ninety days of steps read again.

   The score is how close they came to buying, out of 100, from what they
   did and nothing else: reached the twenty 10, chose a dial 10, chose a
   number 15, turned to the caseback 10, watched the film through 5, read
   three or more of the story 5, opened checkout 20, gave their details 15,
   came back another day 10, three minutes or more on the site 5. A
   payment is 100. 50 and over is hot; 25 and over is warm. */
const HOT = 50, WARM = 25;
function derive(row, st) {
  const has = (e) => st.some(x => x.e === e);
  const dials = uniq(st.filter(e => (e.e === "dial" || e.e === "early_dial" || e.e === "number") && e.dial).map(e => e.dial));
  const nums = uniq(st.filter(e => (e.e === "number" || e.e === "caseback_view" || e.e === "checkout") && e.no).map(e => e.no)
    .concat(row.n ? [pad2(row.n)] : []));
  const acts = uniq(st.filter(e => e.e === "act" && e.x).map(e => e.x));
  const f = { view: has("view"), dial: dials.length > 0, num: nums.length > 0, cas: has("caseback_view"), film: has("hero_complete"),
    co: has("checkout"), det: has("details") || !!(row.name || row.phone || row.email) };
  const tsec = Math.round(visitTime(st, row.last) / 1000);
  const paid = !!String(row.paid || "").replace(/,/g, "");
  let score = (f.view ? 10 : 0) + (f.dial ? 10 : 0) + (f.num ? 15 : 0) + (f.cas ? 10 : 0) + (f.film ? 5 : 0) + (acts.length >= 3 ? 5 : 0)
    + (f.co ? 20 : 0) + (f.det ? 15 : 0) + ((row.visits || 1) >= 2 ? 10 : 0) + (tsec >= 180 ? 5 : 0);
  score = paid ? 100 : Math.min(99, score);
  return { f, dials, nums, acts, tsec, score, paid };
}
const DERIVED = ["country", "region", "gcity", "cmp", "med", "ad", "br", "f_view", "f_dial", "f_num", "f_case", "f_film", "f_co", "f_det",
  "acts", "dials", "nums", "score", "tsec"];

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
    time: visitTime(st, row.last),
    score: derive(row, st).score, country: row.country || "", region: row.region || "", gcity: row.gcity || "",
    cmp: row.cmp || "", med: row.med || "", ad: row.ad || "", br: row.br || ""
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
      const days = (q.get("days") || "").split(",").filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 184);
      const res = {};
      /* Up to 128 keys a read (a Durable Object's limit); one at a time where a store cannot. */
      for (let i = 0; i < days.length; i += 128) {
        const part = days.slice(i, i + 128), got = await this.state.storage.get(part.map(d => "d:" + d));
        for (const d of part) res[d] = (got instanceof Map ? got.get("d:" + d) : await this.state.storage.get("d:" + d)) || {};
      }
      return out(res);
    }
    if (url.pathname === "/live") return out(await this.liveView());
    if (url.pathname === "/link" && request.method === "POST") { await this.histLink(await request.json()); return new Response("ok"); }
    if (url.pathname === "/visitors") return out(this.histList(q));
    if (url.pathname === "/insights") return out(this.insights(parseInt(q.get("since"), 10) || 0));
    if (url.pathname === "/visitor") return out(this.histOne(parseInt(q.get("k"), 10)));
    if (url.pathname === "/journeys" && request.method === "POST") return out(this.histJourneys((await request.json()).o || []));
    if (url.pathname === "/day") return out(this.histDay(q.get("d") || ""));
    if (url.pathname === "/stream") return out(this.histStream(parseInt(q.get("since"), 10) || 0, Math.min(500, parseInt(q.get("lim"), 10) || 200)));
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
      /* The derived columns (derive(), above), added to a store made before them. */
      const have = new Set(sql.exec("PRAGMA table_info(visitor)").toArray().map(c => c.name));
      for (const c of DERIVED) if (!have.has(c)) sql.exec(`ALTER TABLE visitor ADD COLUMN ${c} ${/^(f_|score|tsec)/.test(c) ? "INTEGER" : "TEXT"}`);
      sql.exec("CREATE INDEX IF NOT EXISTS visitor_score ON visitor(score)");
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
    const d = derive(row, steps);
    this.sql.exec(`INSERT INTO visitor (id, k, first, last, visits, tag, s, app, os, dev, name, phone, email, city, n, dial, paid, steps,
        country, region, gcity, cmp, med, ad, br, f_view, f_dial, f_num, f_case, f_film, f_co, f_det, acts, dials, nums, score, tsec)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last = excluded.last, visits = excluded.visits, tag = excluded.tag, s = excluded.s,
      app = excluded.app, os = excluded.os, dev = excluded.dev, name = excluded.name, phone = excluded.phone,
      email = excluded.email, city = excluded.city, n = excluded.n, dial = excluded.dial, paid = excluded.paid, steps = excluded.steps,
      country = excluded.country, region = excluded.region, gcity = excluded.gcity, cmp = excluded.cmp, med = excluded.med, ad = excluded.ad,
      br = excluded.br, f_view = excluded.f_view, f_dial = excluded.f_dial, f_num = excluded.f_num, f_case = excluded.f_case,
      f_film = excluded.f_film, f_co = excluded.f_co, f_det = excluded.f_det, acts = excluded.acts, dials = excluded.dials,
      nums = excluded.nums, score = excluded.score, tsec = excluded.tsec`,
      row.id, row.k, row.first, row.last, row.visits, row.tag || null, row.s || null, row.app || null, row.os || null, row.dev || null,
      row.name || null, row.phone || null, row.email || null, row.city || null, row.n || null, row.dial || null, row.paid || null,
      JSON.stringify(steps),
      row.country || null, row.region || null, row.gcity || null, row.cmp || null, row.med || null, row.ad || null, row.br || null,
      d.f.view ? 1 : 0, d.f.dial ? 1 : 0, d.f.num ? 1 : 0, d.f.cas ? 1 : 0, d.f.film ? 1 : 0, d.f.co ? 1 : 0, d.f.det ? 1 : 0,
      d.acts.join(",") || null, d.dials.join(",") || null, d.nums.join(",") || null, d.score, d.tsec);
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
      const where = [x.gt, x.gr].filter(Boolean).join(", ");
      steps.push(Object.assign({ t: now, e: "visit", x: x.p || "home", s: x.s || "", app: x.app || "", os: x.os || "", dev: x.dev || "" },
        x.c ? { c: x.c, a: x.a || "" } : {}, where ? { g: where } : {}));
      if (fresh || !row.s) { row.s = x.s || ""; row.app = x.app || ""; row.os = x.os || ""; row.dev = x.dev || ""; }
      if (x.gc) { row.country = x.gc; row.region = x.gr || ""; row.gcity = x.gt || ""; }
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
    /* The first campaign that brought them is the one that gets the credit,
       whichever report of the visit (a step, or the minute check) says it first. */
    if (x.c && !row.cmp) { row.cmp = x.c; row.med = x.m || ""; row.ad = x.a || ""; changed = true; }
    if (x.gc && !row.country) { row.country = x.gc; row.region = x.gr || ""; row.gcity = x.gt || ""; changed = true; }
    if (x.br && !row.br) { row.br = x.br; changed = true; }
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
  /* Found by the checkout that opened the order; failing that (a checkout
     from a page too old to say who it was), by the email or phone the
     payment carries, which a visitor who gave details is filed under. */
  histPaid(x) {
    if (!this.hasSql()) return;
    let m = x.o ? this.sql.exec("SELECT id FROM orderof WHERE o = ?", String(x.o)).toArray()[0] : null;
    if (!m && x.em) m = this.sql.exec("SELECT id FROM visitor WHERE lower(email) = ? ORDER BY last DESC LIMIT 1", String(x.em)).toArray()[0];
    if (!m && x.ph && x.ph.length === 10) m = this.sql.exec("SELECT id FROM visitor WHERE phone LIKE ? ORDER BY last DESC LIMIT 1", "%" + String(x.ph)).toArray()[0];
    const row = m && this.row(m.id);
    if (!row) return;
    const steps = stepsOf(row), now = Date.now();
    if (x.o && /^order_\w{6,40}$/.test(String(x.o))) this.sql.exec("INSERT OR IGNORE INTO orderof (o, id, at) VALUES (?, ?, ?)", String(x.o), row.id, now);
    if (steps.some(s => s.e === "paid" && s.no === String(x.no || ""))) return;
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
    else if (f === "hot") where += ` AND score >= ${HOT} AND (paid IS NULL OR paid = '')`;
    else if (f === "warm") where += ` AND score >= ${WARM} AND score < ${HOT} AND (paid IS NULL OR paid = '')`;
    else if (f === "back") where += " AND visits > 1";
    /* Narrowed by one value of a breakdown, as the Insights screen links. */
    const by = { src: "(s = ? OR app = ?)", cmp: "cmp = ?", ad: "ad = ?", region: "region = ?", city: "(gcity = ? OR city = ?)", os: "os = ?", br: "br = ?", dev: "dev = ?" };
    for (const k of Object.keys(by)) {
      const v = String(q.get(k) || "").slice(0, 60);
      if (!v) continue;
      where += " AND " + by[k];
      args.push(...Array((by[k].match(/\?/g) || []).length).fill(v));
    }
    const term = String(q.get("q") || "").trim().slice(0, 60);
    if (term) {
      const kn = parseInt(term.replace(/^visitor\s*/i, ""), 10);
      where += " AND (name LIKE ? OR phone LIKE ? OR email LIKE ? OR city LIKE ? OR s LIKE ? OR app LIKE ? OR paid LIKE ? OR gcity LIKE ? OR region LIKE ? OR cmp LIKE ? OR ad LIKE ?" + (kn ? " OR k = ?" : "") + ")";
      const like = "%" + term.replace(/[%_]/g, "") + "%";
      args.push(like, like, like, like, like, like, like, like, like, like, like);
      if (kn) args.push(kn);
    }
    const order = q.get("sort") === "score" ? "score DESC, last DESC" : "last DESC";
    const total = this.sql.exec(`SELECT COUNT(*) AS c FROM visitor WHERE ${where}`, ...args).toArray()[0].c;
    const rows = this.sql.exec(`SELECT * FROM visitor WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, lim, off).toArray();
    return { ok: true, total, rows: rows.map(visitorSummary) };
  }
  /* Rows written before the derived columns existed get them here, a
     batch at a time: by every Insights read and every half-hourly run. */
  backfill(max) {
    if (!this.hasSql()) return 0;
    const rows = this.sql.exec("SELECT * FROM visitor WHERE score IS NULL LIMIT ?", max || 150).toArray();
    for (const row of rows) this.save(row, stepsOf(row));
    return this.sql.exec("SELECT COUNT(*) AS c FROM visitor WHERE score IS NULL").toArray()[0].c;
  }
  /* Every breakdown the Insights screen shows, for visitors seen since a
     moment: who came, from where, on what, when, what pulled them, and
     how far each kind got. One query each, over the derived columns. */
  insights(since) {
    if (!this.hasSql()) return { ok: false };
    const pending = this.backfill(150);
    const all = (sql, ...a) => this.sql.exec(sql, ...a).toArray();
    const W = "last >= ?", PAID = "(paid IS NOT NULL AND paid <> '')";
    const M = `COUNT(*) AS v, SUM(f_view) AS view, SUM(f_num) AS num, SUM(f_co) AS co, SUM(f_det) AS det, SUM(${PAID}) AS paid,
      SUM(score >= ${HOT} AND NOT ${PAID}) AS hot`;
    const tot = all(`SELECT ${M}, SUM(visits > 1) AS back, SUM(f_dial) AS dial, SUM(f_case) AS cas, SUM(f_film) AS film,
      AVG(tsec) AS tsec, SUM(score >= ${WARM} AND score < ${HOT} AND NOT ${PAID}) AS warm FROM visitor WHERE ${W}`, since)[0] || {};
    const group = (col, extra, lim) => all(`SELECT ${col}, ${M} FROM visitor WHERE ${W} ${extra || ""} GROUP BY ${col.replace(/ AS \w+/g, "")} ORDER BY v DESC LIMIT ${lim || 12}`, since);
    /* Sources, named the way the desk names them, then merged by name. */
    const src = {};
    for (const r of group("s, app", "", 60)) {
      const k = sourceName(r.s, r.app), t = src[k] || (src[k] = { k, s: r.app && (!r.s || r.s === "direct" || r.s === "meta") ? r.app : (r.s || "direct"), v: 0, view: 0, num: 0, co: 0, det: 0, paid: 0, hot: 0 });
      for (const m of ["v", "view", "num", "co", "det", "paid", "hot"]) t[m] += r[m] || 0;
    }
    const count = (col) => {
      const out = {};
      for (const r of all(`SELECT ${col} AS x, ${PAID} AS p FROM visitor WHERE ${W} AND ${col} IS NOT NULL`, since))
        for (const k of String(r.x).split(",").filter(Boolean)) { const t = out[k] || (out[k] = { k, v: 0, paid: 0 }); t.v++; if (r.p) t.paid++; }
      return Object.values(out).sort((a, b) => b.v - a.v);
    };
    const hourIst = `CAST(((first + ${IST_MS}) / 3600000) % 24 AS INTEGER)`, dayIst = `CAST((((first + ${IST_MS}) / 86400000) + 4) % 7 AS INTEGER)`;
    return {
      ok: true, since, pending,
      totals: tot,
      sources: Object.values(src).sort((a, b) => b.v - a.v).slice(0, 15),
      campaigns: group("cmp, ad", "AND cmp IS NOT NULL", 25),
      regions: group("region, country", "AND region IS NOT NULL AND region <> ''", 15),
      cities: group("COALESCE(NULLIF(gcity, ''), city) AS place", "AND COALESCE(NULLIF(gcity, ''), city) IS NOT NULL", 15),
      os: group("os", "AND os IS NOT NULL AND os <> ''", 8),
      browsers: group("br", "AND br IS NOT NULL AND br <> ''", 8),
      devices: group("dev", "AND dev IS NOT NULL", 4),
      hours: all(`SELECT ${hourIst} AS h, COUNT(*) AS v, SUM(${PAID}) AS paid FROM visitor WHERE ${W} GROUP BY h`, since),
      weekdays: all(`SELECT ${dayIst} AS d, COUNT(*) AS v, SUM(${PAID}) AS paid FROM visitor WHERE ${W} GROUP BY d`, since),
      dials: count("dials"), numbers: count("nums").sort((a, b) => b.v - a.v || a.k - b.k), acts: count("acts").map(a => Object.assign(a, { name: actName(a.k) })),
      time: all(`SELECT CASE WHEN tsec < 30 THEN 0 WHEN tsec < 120 THEN 1 WHEN tsec < 300 THEN 2 WHEN tsec < 900 THEN 3 ELSE 4 END AS b, COUNT(*) AS v, SUM(${PAID}) AS paid
        FROM visitor WHERE ${W} GROUP BY b`, since),
      hot: all(`SELECT * FROM visitor WHERE ${W} AND score >= ${WARM} AND NOT ${PAID} ORDER BY score DESC, last DESC LIMIT 40`, since).map(visitorSummary)
    };
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
  /* Every step of every visitor since a moment, newest first: the command
     centre's Activity. Each carries who it was, in one short line. */
  histStream(since, lim) {
    if (!this.hasSql()) return { rows: [] };
    const rows = this.sql.exec("SELECT * FROM visitor WHERE last >= ? ORDER BY last DESC LIMIT 400", since).toArray();
    const out = [];
    for (const row of rows) {
      const st = stepsOf(row), score = derive(row, st).score;
      const who = { k: row.k, from: sourceName(row.s, row.app), place: [row.gcity, row.region].filter(Boolean).join(", ") || row.city || "",
        dev: deviceName(row.os, row.dev), name: firstNameOf(row.name || ""), score, hot: score >= HOT, paid: !!row.paid };
      for (const e of st) if (e.t >= since) out.push(Object.assign({ t: e.t, e: e.e, no: e.no || "", txt: stepText(e) }, who));
    }
    out.sort((a, b) => b.t - a.t);
    return { rows: out.slice(0, lim) };
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
    this.backfill(400);
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
      /* Razorpay may deliver one payment more than once: it is one sale. */
      if (!L.paid.some(p => (x.o && p.o === x.o) || (!x.o && p.no === String(x.no || ""))))
        L.paid.push({ ts: now, no: String(x.no || ""), dial: String(x.dial || ""), paise: parseInt(x.paise, 10) || 0, o: String(x.o || "") });
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
      /* A page of sign-ups read at once, not one after another. */
      const got = await Promise.all((page.keys || []).map(k => env.KAAL_STATE.get(k.name, "json").catch(() => null)));
      for (const v of got) {
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
  /* The listing is the slow part (Razorpay, a page per hundred), and every
     screen of the desk asks for it: kept for a few seconds in this copy of
     the worker, and dropped at once by anything that changes an order. */
  const pays = rzp ? await memo("pays", PAYS_MEMO_MS, () => listPayments(env, now - SALES_DAYS * 86400, now + 60)) : null;
  const paid = (pays || []).filter(p => p.status === "captured" || p.status === "authorized" || p.status === "refunded")
    .sort((a, b) => b.created_at - a.created_at);
  const kv = (k) => env.KAAL_STATE ? env.KAAL_STATE.get(k, "json").catch(() => null) : Promise.resolve(null);
  /* Every order's notes at once rather than six reads an order, one after
     another: the desk used to wait a second or more on this alone. */
  const orders = await Promise.all(paid.map(async (p, i) => {
    const notes = p.notes || {};
    let n = parseInt(notes.kaal_no, 10);
    if (!n && p.order_id && i < 25) n = await numberFromOrderKept(env, p.order_id);
    n = n || 0;
    const back = p.amount_refunded || 0;
    const [address, sent, a1, a2, a3, refundRec, r] = await Promise.all([
      p.order_id ? kv("ship:" + p.order_id) : null, p.order_id ? kv("sent:" + p.order_id) : null,
      p.order_id ? kv("after1:" + p.order_id) : null, p.order_id ? kv("after2:" + p.order_id) : null, p.order_id ? kv("after3:" + p.order_id) : null,
      back ? kv("refundof:" + p.id) : null, back && n ? kv("refunded:" + n) : null]);
    /* The notes to the owner after it left (section 3e). */
    const after = {};
    if (sent) [["after1", a1], ["after2", a2], ["after3", a3]].forEach(([k, a]) => { if (a) after[k] = a.at || "yes"; });
    const release = r && r.payment === p.id ? r : null;
    const at = new Date(p.created_at * 1000);
    return {
      n, dial: n ? DIAL_OF(env, n) : "", id: p.id, orderId: p.order_id || "",
      amount: `₹${((p.amount || 0) / 100).toLocaleString("en-IN")}`, paise: p.amount || 0,
      email: p.email || "", contact: p.contact || "", ts: p.created_at, day: istDay(p.created_at * 1000), at: indiaTime(at),
      gift: notes.gift === "yes", giftNote: notes.gift_note || "",
      due: arriveBy(at), dueDay: arriveByDay(at), address, sent, after,
      refund: p.status === "refunded" || (back && back >= (p.amount || 0)) ? "full" : back ? "part" : "",
      refunded: back ? rupees(back) : "", refundedOn: refundRec ? indiaTime(new Date(refundRec.refundedAt)) : "",
      release: release ? { decided: release.decided || "", at: release.decidedAt || "" } : null
    };
  }));
  return { rzp, pays, orders };
}
const PAYS_MEMO_MS = 20000, LEADS_MEMO_MS = 60000;

/* What this copy of the worker already asked for, for a few seconds. A
   promise is kept, so two screens asking at once share one call; a failed
   one is not kept. Anything that changes an order calls forget(). */
const MEMO = new Map();
function memo(key, ms, fn) {
  const hit = MEMO.get(key), t = Date.now();
  if (hit && t - hit.at < ms) return hit.p;
  const p = Promise.resolve().then(fn);
  MEMO.set(key, { at: t, p });
  p.then(v => { if (v == null) MEMO.delete(key); }, () => MEMO.delete(key));
  return p;
}
function forget() { MEMO.clear(); }

/* An order's number never changes once Razorpay holds it: asked once, kept. */
async function numberFromOrderKept(env, orderId) {
  const key = "ordno:" + orderId;
  if (env.KAAL_STATE) { const k = await env.KAAL_STATE.get(key).catch(() => null); if (k) return parseInt(k, 10) || 0; }
  const n = await numberFromOrder(env, orderId);
  if (n && env.KAAL_STATE) await env.KAAL_STATE.put(key, String(n), { expirationTtl: 400 * 86400 }).catch(() => null);
  return n;
}

/* Checkouts opened in the window that never became a payment, with how far
   each got and how to reach the person, when Razorpay knows. */
async function unfinishedBetween(env, pays, from, to) {
  const paidOrders = new Set(pays.filter(p => p.status === "captured" || p.status === "authorized" || p.status === "refunded").map(p => p.order_id).filter(Boolean));
  /* Each open checkout's notes at once, not one after another. */
  const open = (await listOrders(env, from, to)).filter(o => !(o.status === "paid" || paidOrders.has(o.id)));
  const out = await Promise.all(open.map(async (o) => {
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
    return ({ n, dial: n ? DIAL_OF(env, n) : "", orderId: o.id, ts: o.created_at, at: indiaTime(new Date(o.created_at * 1000)),
      name: who.name || "", city: given ? [given.city, given.state].filter(Boolean).join(", ") : "",
      email, contact: has("contact") || who.phone || "", followed,
      stage: t ? (t.status === "failed" ? "Payment failed" + (why ? `: ${String(why).slice(0, 80)}` : "") + (tries.length > 1 ? ` (${tries.length} tries)` : "") : `Payment ${t.status}`)
               : "Closed checkout before paying" });
  }));
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
      await env.KAAL_STATE.put("digest:last", day).catch(() => null);
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
/* "Sign out every device" in the command centre moves desk:epoch, which
   is in the key, so every desk cookie made before it stops working. */
async function deskKey(env) {
  const epoch = env.KAAL_STATE ? await env.KAAL_STATE.get("desk:epoch").catch(() => null) : null;
  return `kaal-desk|${env.DESK_PASSCODE}|${env.RAZORPAY_KEY_SECRET || env.GITHUB_TOKEN || ""}` + (epoch ? "|" + epoch : "");
}
async function deskSession(request, env) {
  if (!env.DESK_PASSCODE) return false;
  const m = new RegExp(`(?:^|;\\s*)${DESK_COOKIE}=(\\d{10,15})\\.([0-9a-f]{64})`).exec(request.headers.get("Cookie") || "");
  if (!m || !(parseInt(m[1], 10) > Date.now())) return false;
  return timingSafeEqual(await hmacHex("desk|" + m[1], await deskKey(env)), m[2]);
}
/* The command centre (/control) reads everything the desk does, with its
   own session: the admin's, signed in, past any second factor. */
const commandOn = (env) => registryOn(env) && authOn(env);
async function commandSession(request, env) {
  if (!commandOn(env)) return false;
  const s = await sessionOf(env, request).catch(() => null);
  return !!(s && s.admin && s.mfa);
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
  /* The desk is now part of the command centre; the old address leads there. */
  if (path === "/desk" && method === "GET" && commandOn(env)) return new Response(null, { status: 302, headers: deskHeaders({ Location: "/control" }) });
  if (path === "/desk" && method === "GET") {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    return new Response(deskPage(nonce), { headers: deskHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
    }) });
  }
  /* With the command centre on, the passcode is checked only at /auth/passcode, behind its
     limits and its lockout; this older door would be a way round them. */
  if (path === "/desk/login" && method === "POST") return commandOn(env) ? deskJson({ ok: false, reason: "moved", why: "Sign in at /control." }, 410) : deskLogin(request, env);
  if (path === "/desk/logout" && method === "POST") {
    if (!deskWrite(request)) return deskJson({ ok: false, reason: "refused" }, 403);
    return deskJson({ ok: true }, 200, { "Set-Cookie": `${DESK_COOKIE}=; Path=/desk; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });
  }
  if (!(await commandSession(request, env)) && !(await deskSession(request, env))) {
    return env.DESK_PASSCODE || commandOn(env) ? deskJson({ ok: false, reason: "signed-out" }, 401) : deskJson({ ok: false, reason: "off" }, 503);
  }
  if (path === "/desk/data" && method === "GET") return deskJson(await deskData(env));
  if (path === "/desk/live" && method === "GET") return deskJson(await deskLive(env));
  if (path === "/desk/summary" && method === "GET") return deskJson(await deskSummary(env, new URL(request.url).searchParams.get("r") || "today"));
  if (path === "/desk/visitors" && method === "GET") return deskJson(await deskVisitors(env, new URL(request.url).searchParams));
  if (path === "/desk/insights" && method === "GET") {
    const r = new URL(request.url).searchParams.get("r") || "30d";
    return deskJson(Object.assign({ on: !!env.STATS, r }, await histAsk(env, "/insights?since=" + histSince(r), null, { ok: false })));
  }
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
  const token = exp + "." + (await hmacHex("desk|" + exp, await deskKey(env)));
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
  const K = env.KAAL_STATE, kget = (k, t) => K ? K.get(k, t).catch(() => null) : Promise.resolve(null);
  /* Everything that does not depend on anything else, at once. */
  const [counts, L, soldRaw, leads, lastMeta, held, lastHook, lastRun, lastDigest] = await Promise.all([
    statsFor(env, days), ledger(env, nowMs), knownSold(env), memo("leads", LEADS_MEMO_MS, () => leadsBetween(env, 0, 4102444800)),
    kget("meta:last", "json"),
    K ? K.list({ prefix: HOLD_PREFIX }).then(r => r.keys.map(k => parseInt(k.name.slice(HOLD_PREFIX.length), 10)).filter(Boolean)).catch(() => []) : [],
    kget("seen:webhook"), kget("followrun", "json"),
    K ? kget("digest:last").then(v => v || K.list({ prefix: "digest:" }).then(r => { const k = r.keys.map(x => x.name.slice(7)).filter(x => /^\d/.test(x)).sort(); return k.length ? k[k.length - 1] : null; })).catch(() => null) : null
  ]);
  const pays = L.pays || [];
  const unfinished = L.rzp ? await memo("unfinished", PAYS_MEMO_MS, () => unfinishedBetween(env, pays, istWindow(yesterday)[0], now + 60)) : [];

  const live = L.orders.filter(o => o.refund !== "full");
  const ordersOn = {}, revenueOn = {};
  for (const o of live) { ordersOn[o.day] = (ordersOn[o.day] || 0) + 1; revenueOn[o.day] = (revenueOn[o.day] || 0) + o.paise; }
  const sold = soldRaw ? soldRaw.slice().sort((a, b) => a - b) : null;
  const dials = {};
  for (let n = 1; n <= edition; n++) dials[n] = DIAL_OF(env, n);
  /* Who asked not to be written to, and, for someone who left a phone and
     no email, the nearly-bought note as a WhatsApp the owner sends by hand. */
  const recentLeads = leads.slice(-50).reverse().map(l => Object.assign({}, l));
  await Promise.all(unfinished.map(async u => { if (u.email && K) u.stopped = await stopped(env, u.email); })
    .concat(K ? recentLeads.map(async l => { l.stopped = await stopped(env, l.email); }) : []));
  for (const u of unfinished) {
    if (!u.email && u.contact && sold) {
      const n = u.n >= 1 && u.n <= edition ? u.n : 0, dial = n ? dials[n] : "", open = !!n && sold.indexOf(n) < 0;
      const same = [];
      if (n && !open && dial) for (let k = 1; k <= edition; k++) if (k !== n && dials[k] === dial && sold.indexOf(k) < 0) same.push(k);
      u.wa = nearlyWhatsApp({ site, first: firstNameOf(u.name), n, open, dial, left: edition - sold.length, sameDial: same });
    }
  }
  const journeys = await histAsk(env, "/journeys", { o: L.orders.map(o => o.orderId).concat(unfinished.map(u => u.orderId)).filter(Boolean) }, {});
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
    journeys,
    leads: { total: leads.length, today: leads.filter(l => istDay(l.ts * 1000) === today).length, recent: recentLeads },
    alerts: alertsFor(env, L, soldRaw, nowMs),
    health: [
      { ok: mail, label: "Emails", detail: mail ? `Order emails go to buyers, and alerts and the daily report to ${ownerInbox(env).join(", ")}.` : "Not sending: RESEND_API_KEY is not set on the worker." },
      { ok: L.rzp && L.pays !== null, label: "Razorpay", detail: !L.rzp ? "No keys on the worker: orders cannot be read." : L.pays === null ? "The keys are set, but Razorpay refused the listing." : `Reading payments from the last ${SALES_DAYS} days.` },
      { ok: !!lastHook || !live.length, label: "Payment webhook", detail: lastHook ? `Last heard from Razorpay ${indiaTime(new Date(lastHook))}.` : "Not heard from since this desk was switched on. It is heard at the next payment." },
      { ok: !!env.KAAL_STATE, label: "Store", detail: env.KAAL_STATE ? "Holds, addresses, dispatches and the Series 02 list are kept." : "Not connected: addresses, holds and the Series 02 list are not kept." },
      { ok: !!env.STATS, label: "Visitor count", detail: env.STATS ? `${(counts[today] || {}).visit || 0} page visits counted today, without cookies.` : "Not connected: the daily report has no visitor numbers." },
      { ok: metaOn(env) && !(lastMeta && !lastMeta.ok), label: "Meta (sales to the ad account)",
        detail: !metaOn(env) ? "Off: META_CAPI_TOKEN is not set, so Meta only hears of a sale if the buyer's browser reaches the thank-you page with tracking allowed. docs/meta.md sets it from a phone."
          : !lastMeta ? "On. Each paid order is sent to Meta as a Purchase; the first one shows here."
          : lastMeta.ok ? `On. Last sale sent ${indiaTime(new Date(lastMeta.at))}${lastMeta.n ? ` (No. ${pad2(lastMeta.n)})` : ""}.`
          : `Meta refused the last one (${indiaTime(new Date(lastMeta.at))}): ${lastMeta.why}. It is tried again every half hour for six days; check the token (docs/meta.md).` },
      { ok: !!(env.GITHUB_TOKEN && env.GITHUB_OWNER), label: "Sold list", detail: env.GITHUB_TOKEN ? "Each sale is written to the site within a minute." : "No GITHUB_TOKEN: sales are not written to the site." },
      { ok: !!lastRun && !lastRun.bad, label: "Emails sent on their own", detail: lastRun ? `Last run ${indiaTime(new Date(lastRun.at))}: ${lastRun.msg}`
        : "No run yet. The worker runs every half hour, 10:00 to 20:00 India time." },
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
  for (const k of ["src", "cmp", "ad", "region", "city", "os", "br", "dev", "sort"]) if (q.get(k)) p.set(k, String(q.get(k)).slice(0, 60));
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

/* ── The Today dashboard: a period (today, 7, 30 or 90 days in India) and
   the same length before it, day by day. Visits and the steps toward a sale
   from the daily count (once per visit where the page sends it, the older
   per-action count on days before it did); orders and revenue from the
   registry, or Razorpay's own list where there is no registry. ── */
const PERIODS = { today: 1, "7d": 7, "30d": 30, "90d": 90 };
async function ordersByDay(env, fromDay, nowMs) {
  const by = {};
  if (registryOn(env)) {
    const since = new Date(Date.parse(fromDay + "T00:00:00Z") - IST_MS).toISOString();
    const r = await env.DB.prepare(
      `SELECT substr(datetime(paid_at, '+330 minutes'), 1, 10) AS d, COUNT(*) AS n,
              SUM(CASE WHEN refund_id IS NULL AND status NOT IN ('returned') THEN amount_paise ELSE 0 END) AS paise,
              SUM(CASE WHEN refund_id IS NOT NULL OR status = 'returned' THEN 1 ELSE 0 END) AS back
         FROM orders WHERE paid_at >= ?1 AND status <> 'cancelled' GROUP BY d`).bind(since).all();
    for (const x of r.results || []) by[x.d] = { n: x.n || 0, paise: x.paise || 0, back: x.back || 0 };
    return by;
  }
  const L = await ledger(env, nowMs);
  for (const o of L.orders || []) {
    if (!o.day || o.day < fromDay) continue;
    const t = by[o.day] || (by[o.day] = { n: 0, paise: 0, back: 0 });
    t.n++; if (o.refund === "full") t.back++; else t.paise += o.paise || 0;
  }
  return by;
}
async function deskSummary(env, r) {
  const n = PERIODS[r] || 1, span = Math.max(2 * n, 14), nowMs = Date.now(), all = [];
  for (let i = span - 1; i >= 0; i--) all.push(istDay(nowMs - i * 86400000));
  const [counts, orders] = await Promise.all([statsFor(env, all),
    ordersByDay(env, all[0], nowMs).catch(e => { console.log("Summary orders failed:", String(e).slice(0, 120)); return {}; })]);
  const row = (day) => {
    const c = counts[day] || {}, o = orders[day] || {}, once = (k) => c["s_" + k] != null ? c["s_" + k] : c[k] || 0;
    return { day, visits: c.visit || 0, visitors: c.visitor || 0, twenty: once("view"), cart: once("number"), checkout: once("checkout"),
      details: once("details"), orders: o.n || 0, paise: o.paise || 0, returned: o.back || 0 };
  };
  const rows = all.map(row);
  const sum = (list) => list.reduce((t, x) => { for (const k of Object.keys(x)) if (k !== "day") t[k] = (t[k] || 0) + x[k]; return t; }, {});
  const cur = rows.slice(-n), prev = rows.slice(-2 * n, -n);
  return { ok: true, r: PERIODS[r] ? r : "today", n, today: all[all.length - 1], from: cur[0].day,
    prevFrom: prev[0].day, prevTo: prev[prev.length - 1].day, totals: sum(cur), prev: sum(prev),
    /* the chart: the period's days, or for Today the fortnight it ends */
    days: n === 1 ? rows.slice(-14) : cur, counting: !!env.STATS, orders: registryOn(env) ? "registry" : "razorpay", at: nowMs };
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
  /* The worker's own refund of a second payment for a watch that went to
     someone else (duplicatePayment). The watch was never returned: the
     number stays sold, and the owner and the buyer have already been told
     exactly this, so nothing more is said. */
  if (r.notes && r.notes.reason === "duplicate") {
    console.log(`Refund ${r.id} recorded: a duplicate payment${n ? " for No. " + pad2(n) : ""}.`);
    return "new";
  }
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

   Optional. The pixel id is META_PIXEL in wrangler.toml (META_PIXEL_ID,
   if that secret was set by hand, wins); the access token is the secret
   META_CAPI_TOKEN. Without the token it returns before doing anything,
   and nothing it does can fail a sale: it swallows its own errors.

   October 2026: two sales from a Meta campaign never reached the ad
   account. The token had never been set, and even with it this ran only
   after the GitHub commit, so a webhook that timed out on the commit and
   came back as a retry ("already recorded") never told Meta at all. Now
   the webhook sends it beside the commit, not after it, and a payment
   Meta has accepted is marked (meta:<payment id>); the half-hourly run
   (metaCatchUp) sends every paid order of the last six and a half days
   that is not marked. Meta takes a purchase up to seven days late and
   still credits the ad, and counts a resend with the same event id once.

   Email, phone and name are hashed (SHA-256) before they leave this
   worker, as Meta requires; nothing is sent in the clear, and never the
   address or the gift note (legal.html#privacy says exactly this). */
const META_KEY = "meta:";
const META_LOOKBACK = 6 * 86400 + 12 * 3600;
const META_PER_RUN = 8;
function metaPixel(env) { return String(env.META_PIXEL_ID || env.META_PIXEL || "").replace(/\D/g, ""); }
const metaOn = (env) => !staging(env) && !!(metaPixel(env) && env.META_CAPI_TOKEN);

/* Meta's normalising for a name: lower case, letters only. */
const metaName = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-zऀ-ॿ]/g, "");

/* "sent" when Meta has it (now, or on an earlier run), "skip" when there is
   nothing that could be sent, "failed" when it should be tried again.
   `order` is passed when the caller has already read it from Razorpay. */
async function sendPurchaseToMeta(env, entity, chosen, order) {
  if (!metaOn(env) || !entity || !entity.id) return "skip";
  const id = String(entity.id);
  try {
    if (env.KAAL_STATE && await env.KAAL_STATE.get(META_KEY + id).catch(() => null)) return "sent";
    if (order === undefined) order = entity.order_id ? await readOrder(env, entity.order_id) : null;
    const m = Object.assign({}, entity.notes || {}, (order && order.notes) || {});
    /* Meta rejects a "website" event without the browser's user agent.
       Every order this worker priced has one (metaMatch, at /order); the
       old hosted Payment Page never passed through /order, and the browser
       Pixel is its only record. */
    if (!m.ua) { console.log("Meta CAPI skipped: no user agent on the order", id); return "skip"; }

    const user = { client_user_agent: m.ua, country: [await sha256hex("in")] };
    if (m.ip)  user.client_ip_address = m.ip;
    if (m.fbp) user.fbp = m.fbp;
    if (m.fbc) user.fbc = m.fbc;
    const email = String(entity.email || "").trim().toLowerCase();
    if (validEmail(email)) user.em = [await sha256hex(email)];
    let phone = String(entity.contact || "").replace(/\D/g, "");
    if (phone.length === 10) phone = "91" + phone;
    if (phone.length >= 11) user.ph = [await sha256hex(phone)];
    /* The name the buyer gave at checkout, when they gave one. */
    if (env.KAAL_STATE && entity.order_id) {
      const ship = await env.KAAL_STATE.get("ship:" + entity.order_id, "json").catch(() => null);
      const parts = String((ship && ship.buyer && ship.buyer.name) || (ship && ship.name) || "").trim().split(/\s+/).map(metaName).filter(Boolean);
      if (parts.length) user.fn = [await sha256hex(parts[0])];
      if (parts.length > 1) user.ln = [await sha256hex(parts[parts.length - 1])];
    }

    const value = (entity.amount || 0) / 100;
    const payload = {
      data: [{
        event_name: "Purchase",
        event_time: entity.created_at || Math.floor(Date.now() / 1000),
        event_id: id,
        action_source: "website",
        event_source_url: siteUrl(env) + "/claimed.html",
        user_data: user,
        custom_data: {
          currency: entity.currency || "INR",
          value,
          content_ids: ["KAAL-" + pad2(chosen)],
          content_type: "product",
          contents: [{ id: "KAAL-" + pad2(chosen), quantity: 1, item_price: value }],
          num_items: 1,
          order_id: String(entity.order_id || id)
        }
      }]
    };
    if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

    const ver = env.META_API_VERSION || "v23.0";
    const url = `https://graph.facebook.com/${ver}/${metaPixel(env)}/events?access_token=${encodeURIComponent(env.META_CAPI_TOKEN)}`;
    let res = null, why = "";
    /* Once more on a network error or a 5xx; a 4xx is Meta saying no, and
       the next half-hourly run is the retry for that. */
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (res.status < 500) break;
        why = "HTTP " + res.status;
      } catch (e) { res = null; why = String(e).slice(0, 120); }
    }
    const ok = !!(res && res.ok);
    if (!ok && res) why = `HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`;
    if (env.KAAL_STATE) {
      if (ok) await env.KAAL_STATE.put(META_KEY + id, new Date().toISOString(), { expirationTtl: 30 * 86400 }).catch(() => null);
      /* For the desk's health list, never the token or the buyer. Written on
         every success (one a sale) but a repeated refusal only every six
         hours: a wrong token retried each half hour must not spend the KV
         writes the holds and the sales need (a thousand a day, free plan). */
      const prev = ok ? null : await env.KAAL_STATE.get("meta:last", "json").catch(() => null);
      const quiet = prev && !prev.ok && prev.why === why && Date.now() - Date.parse(prev.at) < 6 * 3600 * 1000;
      if (!quiet) await env.KAAL_STATE.put("meta:last", JSON.stringify({ at: new Date().toISOString(), ok, n: chosen, why: ok ? "" : why })).catch(() => null);
    }
    if (ok) { console.log(`Meta told: purchase of No. ${pad2(chosen)} (${id}).`); return "sent"; }
    console.log("Meta CAPI refused the purchase:", id, why);
    return "failed";
  } catch (e) {
    console.log("Meta CAPI call threw:", String(e).slice(0, 160));
    return "failed";
  }
}

/* Every full-price KAAL payment of the last six and a half days that Meta
   has not accepted yet, a few a run. This is what tells Meta about a sale
   whose webhook never got as far as telling it, and, the first time the
   token is set, about the sales made before it was. */
async function metaCatchUp(env) {
  try {
    if (!metaOn(env) || !env.KAAL_STATE || !env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return;
    const now = Math.floor(Date.now() / 1000);
    const pays = await listPayments(env, now - META_LOOKBACK, now + 60, 300);
    if (!pays) return;
    const price = parseInt(env.PRICE_PAISE || "0", 10), edition = parseInt(env.EDITION || "20", 10);
    const currency = String(env.CURRENCY || "INR").toUpperCase();
    let tried = 0;
    for (const p of pays.sort((a, b) => a.created_at - b.created_at)) {
      if (tried >= META_PER_RUN) return;
      /* Captured and still kept. One already refunded before Meta heard of
         it is a return, not a sale to teach the ads. */
      if (p.status !== "captured" || (p.amount_refunded || 0) > 0) continue;
      if (!p.order_id || (p.amount || 0) < price || String(p.currency || "INR").toUpperCase() !== currency) continue;
      if (await env.KAAL_STATE.get(META_KEY + p.id).catch(() => null)) continue;
      const order = await readOrder(env, p.order_id);
      const n = parseInt(order && order.notes && order.notes.kaal_no, 10);
      if (!(n >= 1 && n <= edition) || (order.amount || 0) < price) continue;
      tried++;
      await sendPurchaseToMeta(env, p, n, order);
    }
  } catch (e) { console.log("Meta catch-up threw:", String(e).slice(0, 160)); }
}

/* The browser half of the match, taken at /order. _fbp and _fbc are the
   Pixel's own first-party cookies, passed up by the page; the user agent
   and IP are read off the request itself. Each is capped to fit a
   Razorpay note. Meta's own libraries may add a short suffix after the
   last part (".Bg"), which is kept, not refused. */
function metaMatch(request, body) {
  const out = {};
  const ua = request.headers.get("user-agent") || "";
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (ua) out.ua = ua.slice(0, 250);
  if (ip) out.ip = ip.slice(0, 64);
  const fbp = cleanNote(body && body.fbp, 120), fbc = cleanNote(body && body.fbc, 250);
  if (/^fb\.\d\.\d{10,13}\.[\w.-]+$/.test(fbp)) out.fbp = fbp;
  if (/^fb\.\d\.\d{10,13}\.[\w.-]+$/.test(fbc)) out.fbc = fbc;
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
  const base = kv || await readSoldFromGitHub(env);
  if (!registryOn(env)) return base;
  try {
    const u = await unavailable(env, SERIES);
    return [...new Set((base || []).concat(u.gone))].sort((a, b) => a - b);
  } catch (e) { return base; }
}

async function readSoldFromGitHub(env) {
  if (staging(env) || !env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) return null;
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-KAAL",
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
