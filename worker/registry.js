/* ══════════════════════════════════════════════════════════════════
   THE REGISTRY, PHASE 1: the database behind the twenty.

   Cloudflare D1 (SQLite), bound as env.DB; the schema is in
   migrations/0001_registry.sql. Nothing here runs unless DB is bound, so
   the live worker behaves exactly as before until the owner switches the
   registry on; the staging worker (wrangler.toml [env.staging]) has it.

   Three things live here, and each is one SQL statement where it matters,
   because D1 runs every write on a single SQLite primary, in order:

     holdPiece      claim a number for ten minutes, atomically. Two buyers
                    reaching for No. 07 in the same millisecond: one UPDATE
                    succeeds, the other changes nothing and is told "held".
     recordPayment  a captured payment becomes an order and the piece is
                    placed, once. Keyed on the payment id, so a webhook
                    delivered twice, or ten times, changes nothing more.
                    A second payment for a piece that already went is kept
                    as a cancelled 'duplicate' order, to be refunded.
     claimRefund    the right to refund that duplicate, taken by exactly
                    one caller, so the refund is asked for once.

   Same dialect as the worker beside it: plain functions, no classes, no
   build step. ══════════════════════════════════════════════════════ */

export const HOLD_MS = 10 * 60 * 1000;
export const SERIES = "S01";

/* On when the database is bound, unless REGISTRY = "off" (wrangler.toml, or
   the Cloudflare dashboard for an instant change): the off switch. Off,
   the worker runs exactly as it did before the registry, nothing deleted. */
export const registryOn = (env) => !!(env && env.DB && typeof env.DB.prepare === "function" && String(env.REGISTRY || "on").toLowerCase() !== "off");
export const pieceId = (series, n) => `${series}-${n < 10 ? "0" + n : n}`;
const now = () => new Date().toISOString();

/* Digits only, with India's 91 in front of a ten-digit number, so a phone
   typed three ways is one phone. */
export function normPhone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.length === 11 && d.charAt(0) === "0") d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d.length >= 11 && d.length <= 15 ? d : "";
}
export const normEmail = (v) => String(v || "").trim().toLowerCase().slice(0, 254);

/* ── Holds ──
   "ok" with the hold's end, or why not: "sold" (placed, delivered,
   withheld, anything that is not for sale), "held" (somebody else's live
   hold), "unknown" (no such piece). Re-holding your own number extends it;
   an expired hold is no hold, whoever's it was. */
export async function holdPiece(env, series, n, by, nowMs) {
  const id = pieceId(series, n), t = nowMs || Date.now(), until = t + HOLD_MS;
  const got = await env.DB.prepare(
    `UPDATE pieces SET status = 'held', held_by = ?1, held_until = ?2, updated_at = ?3
      WHERE id = ?4 AND (status = 'available'
        OR (status = 'held' AND (held_until IS NULL OR held_until <= ?5 OR held_by = ?1)))
      RETURNING held_until`
  ).bind(by, until, now(), id, t).first();
  if (got) return { ok: true, until: got.held_until };
  const p = await env.DB.prepare("SELECT status, held_until FROM pieces WHERE id = ?1").bind(id).first();
  if (!p) return { ok: false, reason: "unknown" };
  return { ok: false, reason: p.status === "held" && p.held_until > t ? "held" : "sold" };
}

/* A hold given back: only by whoever holds it, and only while it is a hold. */
export async function releaseHold(env, series, n, by) {
  await env.DB.prepare(
    "UPDATE pieces SET status = 'available', held_by = NULL, held_until = NULL, updated_at = ?1 WHERE id = ?2 AND status = 'held' AND held_by = ?3"
  ).bind(now(), pieceId(series, n), by).run();
}

/* What the shop must not sell, from the one public view: every number that
   is not available, and, apart, the ones briefly held. */
export async function unavailable(env, series) {
  const { results } = await env.DB.prepare("SELECT number, state FROM public_registry WHERE series = ?1").bind(series).all();
  const out = { gone: [], held: [] };
  for (const r of results || []) {
    if (r.state === "held") out.held.push(r.number);
    else if (r.state !== "available") out.gone.push(r.number);
  }
  return out;
}

/* Somebody the shop does not sell to again, by email or phone. */
export async function isBlocked(env, email, phone) {
  const e = normEmail(email) || null, p = normPhone(phone) || null;
  if (!e && !p) return false;
  const row = await env.DB.prepare(
    "SELECT 1 AS x FROM blocked_buyers WHERE (?1 IS NOT NULL AND email = ?1) OR (?2 IS NOT NULL AND phone = ?2) LIMIT 1"
  ).bind(e, p).first();
  return !!row;
}

/* ── A captured payment ──
   p: { series, n, paymentId, orderId, amount, currency, email, phone, name,
        address: { line1, line2, city, state, pin }, gift, giftNote, paidAt }

   Returns { outcome, order, fresh }:
     "placed"     this call placed the piece
     "already"    an earlier delivery of this same payment already did
     "duplicate"  the piece belongs to another order; this one is cancelled
                  (fresh is true only for the call that cancelled it)
     "unknown"    no such piece in the registry (nothing written)

   Written so that it converges: whatever step a previous delivery died in,
   running it again finishes the job and never does a step twice. */
export async function recordPayment(env, p) {
  const id = pieceId(p.series, p.n), at = now();
  const piece0 = await env.DB.prepare("SELECT id FROM pieces WHERE id = ?1").bind(id).first();
  if (!piece0) return { outcome: "unknown", order: null, fresh: false };

  const a = p.address || {};
  const ins = await env.DB.prepare(
    `INSERT INTO orders (series, piece_id, razorpay_order_id, razorpay_payment_id, buyer_name, email, phone,
       address_line1, address_line2, city, state, pincode, gift, gift_note, amount_paise, currency, status, paid_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, 'placed', ?17, ?18, ?18)
     ON CONFLICT (razorpay_payment_id) DO NOTHING
     RETURNING id`
  ).bind(p.series, id, p.orderId || null, p.paymentId, p.name || null, normEmail(p.email) || null, normPhone(p.phone) || null,
    a.line1 || null, a.line2 || null, a.city || null, a.state || null, a.pin || null, p.gift ? 1 : 0, p.giftNote || null,
    p.amount || 0, p.currency || "INR", p.paidAt || at, at).first();
  const fresh = !!ins;
  const order = await env.DB.prepare("SELECT * FROM orders WHERE razorpay_payment_id = ?1").bind(p.paymentId).first();
  if (order.status === "cancelled") return { outcome: "duplicate", order, fresh: false };

  const mine = async () => {
    const pc = await env.DB.prepare("SELECT order_ref FROM pieces WHERE id = ?1").bind(id).first();
    return pc && pc.order_ref === order.id;
  };
  if (await mine()) return { outcome: fresh ? "placed" : "already", order, fresh };

  /* The payment wins over any hold, whoever's: a hold is a courtesy, money
     is the fact. Anything else (placed by another order, withheld,
     retired, stolen) is not this order's to take. */
  const placed = await env.DB.prepare(
    `UPDATE pieces SET status = 'placed', order_ref = ?1, held_by = NULL, held_until = NULL, updated_at = ?2
      WHERE id = ?3 AND status IN ('available','held') RETURNING id`
  ).bind(order.id, at, id).first();
  if (placed) {
    await audit(env, "system:webhook", "piece.placed", id, null, { order: order.id, payment: p.paymentId }, p.series);
    return { outcome: "placed", order, fresh: true };
  }
  /* Lost the race to... itself? (the same payment, delivered twice at once) */
  if (await mine()) return { outcome: "already", order, fresh: false };

  const cancelled = await env.DB.prepare(
    "UPDATE orders SET status = 'cancelled', cancel_reason = 'duplicate', updated_at = ?1 WHERE id = ?2 AND status = 'placed' RETURNING id"
  ).bind(at, order.id).first();
  if (cancelled) {
    const holder = await env.DB.prepare("SELECT status, order_ref FROM pieces WHERE id = ?1").bind(id).first();
    await audit(env, "system:webhook", "order.duplicate", "order:" + order.id, { status: "placed" },
      { status: "cancelled", reason: "duplicate", piece: id, piece_status: holder && holder.status, held_by_order: holder && holder.order_ref }, p.series);
  }
  const now2 = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(order.id).first();
  return { outcome: "duplicate", order: now2, fresh: !!cancelled };
}

/* The right to ask Razorpay for this refund, taken once. True for exactly
   one caller; the others see it already taken (or done). */
export async function claimRefund(env, orderRowId) {
  const r = await env.DB.prepare(
    "UPDATE orders SET refund_requested_at = ?1 WHERE id = ?2 AND refund_requested_at IS NULL AND refund_id IS NULL RETURNING id"
  ).bind(now(), orderRowId).first();
  return !!r;
}
export async function refundDone(env, orderRowId, refundId, series) {
  await env.DB.prepare("UPDATE orders SET refund_id = ?1, refunded_at = ?2, updated_at = ?2 WHERE id = ?3")
    .bind(refundId, now(), orderRowId).run();
  await audit(env, "system:webhook", "order.refunded", "order:" + orderRowId, null, { refund: refundId, reason: "duplicate" }, series);
}
/* The call failed: give the claim back, so the next delivery tries again. */
export async function refundFailed(env, orderRowId) {
  await env.DB.prepare("UPDATE orders SET refund_requested_at = NULL WHERE id = ?1 AND refund_id IS NULL").bind(orderRowId).run();
}

/* What a receipt may say about a payment: nothing more than its fate. */
export async function paymentFate(env, paymentId) {
  const r = await env.DB.prepare("SELECT status, cancel_reason, refund_id FROM orders WHERE razorpay_payment_id = ?1").bind(paymentId).first();
  if (!r) return null;
  return { duplicate: r.status === "cancelled" && r.cancel_reason === "duplicate", refunded: !!r.refund_id };
}

export async function audit(env, actor, action, target, before, after, series) {
  try {
    await env.DB.prepare("INSERT INTO audit_log (actor, action, target, before, after, series) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(actor, action, target || null, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, series || null).run();
  } catch (e) { console.log("Audit write failed:", String(e).slice(0, 120)); }
}
