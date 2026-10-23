/* ══════════════════════════════════════════════════════════════════
   THE ORDER'S PAGE, its data (registry, Phase 3): /track.

   thekaal.co/track (track.html) asks this for an order's journey. It
   reads the same orders table the emails are made from, so the page can
   never disagree with them.

   Two ways in:
     GET  /track/data?o=<id>&s=<sig>   the link in every tracking email.
          The signature (worker/orders.js) proves the link came from an
          email sent to the buyer: it is a "strong" visit.
     POST /track/lookup {ref, email}   an order reference (the payment id,
          the Razorpay order id, or the number) and the order's email.
          A "weak" visit: it can read the journey, nothing more.

   What opens the registration page is the strong visit only:
     POST /track/register {o, s}       mints a registration link for a
          delivered, unregistered order and hands it over.
   A weak visit can only ask for the link to be emailed to the address on
   the order (POST /track/email-link), and the answer is the same whether
   or not the two matched: registering makes someone the owner, so the
   link goes only to the inbox that paid.

   Never in the answer: name, email, phone, address, payment id.
   ══════════════════════════════════════════════════════════════════ */
import { registryOn, normEmail, SERIES } from "./registry.js";
import { trackOk, mintClaim, queueDelivered, seriesSize, setting } from "./orders.js";
import { same } from "./auth.js";

const LABEL = { placed: "Placed", inspected: "Inspected", packed: "Packed", dispatched: "Dispatched", delivered: "Delivered" };

async function journey(env, order, strong) {
  const piece = await env.DB.prepare("SELECT number, colorway, photo_url FROM pieces WHERE id = ?1").bind(order.piece_id).first();
  const size = await seriesSize(env, order.series);
  const at = { placed: order.paid_at, inspected: order.inspected_at, packed: order.packed_at, dispatched: order.dispatched_at,
    delivered: order.delivered_on ? order.delivered_on : null };
  const reached = ["placed", "inspected", "packed", "dispatched", "delivered"].filter(k => at[k]);
  const idx = ["placed", "inspected", "packed", "dispatched", "delivered", "registered"].indexOf(order.status);
  const current = order.status === "registered" ? "delivered" : ["placed", "inspected", "packed", "dispatched", "delivered"][Math.max(0, Math.min(4, idx))];
  const stages = ["placed", "inspected", "packed", "dispatched", "delivered"].map(k => ({
    key: k, label: LABEL[k], at: at[k] || null,
    state: k === current && k !== "delivered" ? "current" : (at[k] || reached.indexOf(k) > -1 ? "done" : "todo")
  }));
  const cancelled = order.status === "cancelled" || order.status === "returned";
  const delivered = ["delivered", "registered"].indexOf(order.status) > -1;
  return {
    ok: true, strong, status: order.status, cancelled,
    piece: { n: piece ? piece.number : 0, size, colorway: piece ? piece.colorway : "", photo: piece && piece.photo_url ? piece.photo_url : null },
    stages: cancelled ? [] : stages,
    courier: order.dispatched_at ? order.courier || null : null,
    tracking: order.dispatched_at ? order.tracking_number || null : null,
    trackingUrl: order.dispatched_at ? order.tracking_url || null : null,
    delivered, registered: order.status === "registered",
    returnEndsAt: order.status === "delivered" ? order.return_window_ends_at : null,
    canRegister: delivered && order.status !== "registered"
  };
}

async function byRef(env, ref, email) {
  ref = String(ref || "").trim();
  const e = normEmail(email);
  if (!ref || !e) return null;
  let o = null;
  if (/^pay_[A-Za-z0-9]{6,40}$/.test(ref)) o = await env.DB.prepare("SELECT * FROM orders WHERE razorpay_payment_id = ?1").bind(ref).first();
  else if (/^order_[A-Za-z0-9]{6,40}$/.test(ref)) o = await env.DB.prepare("SELECT * FROM orders WHERE razorpay_order_id = ?1").bind(ref).first();
  else {
    const m = /^(?:KAAL[-\s]*)?(?:S\d{2}[-\s]*)?0*(\d{1,2})$/i.exec(ref);
    if (m) o = await env.DB.prepare("SELECT o.* FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE p.series = ?1 AND p.number = ?2 AND o.status NOT IN ('cancelled') ORDER BY o.id DESC").bind(SERIES, parseInt(m[1], 10)).first();
  }
  /* The email has to be the order's. A wrong one and an unknown order look the same. */
  return o && o.email && same(normEmail(o.email), e) ? o : null;
}

async function strongOrder(env, o, s) {
  const id = parseInt(o, 10);
  if (!(id > 0) || !(await trackOk(env, id, s))) return null;
  return env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(id).first();
}

export async function trackRoute(request, env, ctx, path, deps) {
  const J = (body, status, extra) => deps.json(request, env, body, Object.assign({ "Cache-Control": "no-store" }, extra || {}), status);
  if (!registryOn(env)) return J({ ok: false, reason: "off" }, 503);
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && path === "/track/data") {
      const o = await strongOrder(env, url.searchParams.get("o"), url.searchParams.get("s"));
      return o ? J(await journey(env, o, true)) : J({ ok: false, reason: "link" }, 404);
    }
    if (request.method !== "POST") return J({ ok: false, reason: "not-found" }, 404);
    let b = null;
    try { b = await request.json(); } catch (e) { b = null; }
    b = b || {};

    if (path === "/track/lookup") {
      const o = await byRef(env, b.ref, b.email);
      return o ? J(await journey(env, o, false)) : J({ ok: false, reason: "nomatch" }, 404);
    }
    if (path === "/track/register") {
      const o = await strongOrder(env, b.o, b.s);
      if (!o) return J({ ok: false, reason: "link" }, 404);
      if (o.status !== "delivered") return J({ ok: false, reason: "state", why: o.status === "registered" ? "This piece is already registered." : "Registration opens when the piece has been delivered." }, 409);
      return J({ ok: true, claimUrl: `${deps.siteUrl(env)}/claim?t=${await mintClaim(env, o)}` });
    }
    if (path === "/track/email-link") {
      const o = await byRef(env, b.ref, b.email);
      if (o && o.status === "delivered" && (await setting(env, "stage_emails", "1")) === "1") {
        /* One an hour per order: asking again is not a way to flood an inbox. */
        const hour = new Date().toISOString().slice(0, 13);
        const q = await queueDelivered(env, deps.siteUrl(env), o, `asked:${o.id}:${hour}`);
        if (q) deps.kick([q]);
      }
      return J({ ok: true });
    }
  } catch (e) {
    console.log("Track error:", path, String(e).slice(0, 160));
    return J({ ok: false, reason: "error" }, 500);
  }
  return J({ ok: false, reason: "not-found" }, 404);
}
