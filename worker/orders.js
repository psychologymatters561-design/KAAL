/* ══════════════════════════════════════════════════════════════════
   THE ORDER ENGINE (registry, Phase 3): one place where an order moves.

   The control room's tap and the courier's webhook both come here, so a
   stage means the same thing whoever asked: the dates are set the same
   way, the email is queued the same way (at most once), and the audit log
   says who did it. Nothing here trusts the caller for a date it can check.

   Also here: the two links an order's emails carry.
     /track?o=<id>&s=<signature>   the order's page, no login. The
        signature is an HMAC of the order id under AUTH_SECRET, so the link
        can be made again at any time and proves nothing but "this came
        from an email we sent to the buyer".
     /claim?t=<token>              the registration link. A random token,
        only its hash is stored, single use, thirty days.
   ══════════════════════════════════════════════════════════════════ */
import { audit, SERIES } from "./registry.js";
import { queueLetter } from "./outbox.js";
import { STAGE_LETTER } from "./letters.js";
import { sha256, hmac, same, b64url } from "./auth.js";

export const STAGES = ["placed", "inspected", "packed", "dispatched", "delivered"];
export const ORDER_STATUSES = [...STAGES, "registered", "returned", "cancelled"];
export const iso = (ms) => new Date(ms === undefined ? Date.now() : ms).toISOString();
export const istDay = (ms) => new Date((ms === undefined ? Date.now() : ms) + 5.5 * 3600000).toISOString().slice(0, 10);
export const pad2 = (n) => (n < 10 ? "0" + n : String(n));
export const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/* The day a return window closes: delivered_on plus the series' return
   days, at 23:59:59 India time, as an instant. */
export function windowEnds(day, days) { return iso(Date.parse(`${day}T23:59:59.000+05:30`) + days * 86400000); }

export async function setting(env, key, fallback) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first().catch(() => null);
  return r ? r.value : fallback;
}
export async function seriesSize(env, code) {
  const r = await env.DB.prepare("SELECT size FROM series WHERE code = ?1").bind(code || SERIES).first();
  return r ? r.size : 20;
}

/* ── The order's page link ── */
export async function trackSig(env, orderId) { return env.AUTH_SECRET ? (await hmac(String(env.AUTH_SECRET), "track|" + orderId)).slice(0, 24) : ""; }
/* Without AUTH_SECRET there is no link (an email simply omits the quiet line). */
export async function trackUrl(env, site, orderId) { return env.AUTH_SECRET ? `${site}/track?o=${orderId}&s=${await trackSig(env, orderId)}` : ""; }
export async function trackOk(env, orderId, sig) { const want = await trackSig(env, orderId); return !!want && same(String(sig || ""), want); }

/* ── The registration link ── */
export async function mintClaim(env, order, days) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO claim_tokens (series, order_id, piece_id, token_hash, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(order.series, order.id, order.piece_id, await sha256(token), iso(Date.now() + (days || 30) * 86400000)).run();
  return token;
}
/* Which Owner this will be: one more than the last the piece has had. */
export async function nextOwnerNo(env, pieceId) {
  const r = await env.DB.prepare("SELECT COALESCE(MAX(owner_no), 0) + 1 AS n FROM ownerships WHERE piece_id = ?1").bind(pieceId).first();
  return r ? r.n : 1;
}

/* What every order's letter is told. */
async function letterVars(env, site, o, extra) {
  return Object.assign({ site, n: o.number, size: await seriesSize(env, o.series), courier: o.courier, tracking: o.tracking_number,
    trackingUrl: o.tracking_url, trackUrl: await trackUrl(env, site, o.id) }, extra || {});
}

/* The Placed letter: from the verified payment, with nobody pressing
   anything. Returns the outbox row id; -1 if it was already queued;
   0 if there is nothing to send (stage emails are switched off, or the
   order has no email), so the caller can fall back. */
export async function queuePlaced(env, site, order) {
  if ((await setting(env, "stage_emails", "1")) !== "1" || !order || !order.email) return 0;
  const o = Object.assign({}, order, { number: parseInt(String(order.piece_id).split("-")[1], 10) });
  const q = await queueLetter(env, { template: "placed", to: order.email, series: order.series, dedupe: `stage:${order.id}:placed`, vars: await letterVars(env, site, o) });
  return q || -1;
}

/* The same address problem as before the registry: a buyer whose address
   did not arrive is asked for it, once, in the same voice. */
export async function queueAddressAsk(env, site, order, shipUrl) {
  if (!order || !order.email) return 0;
  const n = parseInt(String(order.piece_id).split("-")[1], 10);
  return queueLetter(env, { template: "addressNeeded", to: order.email, series: order.series, dedupe: `address:${order.id}`, vars: { site, n, size: await seriesSize(env, order.series), shipUrl } });
}

/* ══ One order moves ══
   `b` is what the caller asked: { to, silent, reason, courier, tracking, url, day }.
   `deps` is { siteUrl(env), kick(ids) }. `opts.quiet` (the courier's, never
   a request's) moves forward without a letter, for a stage the courier
   proves was passed without anyone tapping it.
   Returns { http, body }. */
export async function moveOrder(env, deps, actor, id, b, opts) {
  const quiet = !!(opts && opts.quiet);
  const o = await env.DB.prepare("SELECT o.*, p.number, p.status AS piece_status FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE o.id = ?1").bind(id).first();
  if (!o) return { http: 404, body: { ok: false, reason: "unknown-order" } };
  const to = String(b.to || "");
  const silent = b.silent === true;
  const reason = clean(b.reason, 200);
  if (silent) {
    if (ORDER_STATUSES.indexOf(to) < 0) return { http: 400, body: { ok: false, reason: "bad-status" } };
    if (reason.length < 3) return { http: 400, body: { ok: false, reason: "reason", why: "A correction needs a reason, in a few words." } };
  } else {
    const next = STAGES[STAGES.indexOf(o.status) + 1];
    if (!next || to !== next) return { http: 409, body: { ok: false, reason: "order", why: `No. ${pad2(o.number)} is ${o.status}; the next step is ${next || "none"}.` } };
  }

  const set = { status: to, updated_at: iso() };
  if (to === "inspected" && !o.inspected_at) set.inspected_at = iso();
  if (to === "packed" && !o.packed_at) set.packed_at = iso();
  if (to === "dispatched") {
    const courier = clean(b.courier, 40), tracking = clean(b.tracking, 60), url = clean(b.url, 300);
    if (!silent && (!courier || !tracking || !/^https:\/\/[^\s"'<>]+$/i.test(url))) {
      return { http: 400, body: { ok: false, reason: "dispatch", why: "Dispatched needs the courier, the tracking number and a tracking link that starts with https://." } };
    }
    Object.assign(set, { courier: courier || o.courier, tracking_number: tracking || o.tracking_number, tracking_url: url || o.tracking_url, dispatched_at: o.dispatched_at || iso() });
  }
  let pieceStatus = null;
  if (to === "delivered") {
    const day = String(b.day || istDay());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > istDay() || (o.dispatched_at && day < istDay(Date.parse(o.dispatched_at)) && !silent)) {
      return { http: 400, body: { ok: false, reason: "day", why: "The delivery date has to be a real day, not in the future, and not before it was dispatched." } };
    }
    const series = await env.DB.prepare("SELECT return_days FROM series WHERE code = ?1").bind(o.series).first();
    Object.assign(set, { delivered_on: day, return_window_ends_at: windowEnds(day, (series && series.return_days) || 7) });
    pieceStatus = "delivered";
  }
  if (silent && ["placed", "inspected", "packed", "dispatched"].indexOf(to) > -1 && ["delivered", "returned"].indexOf(o.piece_status) > -1) pieceStatus = "placed";
  if (to === "returned") pieceStatus = "returned";
  if (to === "registered") pieceStatus = "registered";

  /* The move itself, only if the order is still where the caller saw it:
     two taps (or a tap and the courier) cannot both advance it. */
  const cols = Object.keys(set);
  const moved = await env.DB.prepare(`UPDATE orders SET ${cols.map((c, i) => `${c} = ?${i + 1}`).join(", ")} WHERE id = ?${cols.length + 1} AND status = ?${cols.length + 2} RETURNING id`)
    .bind(...cols.map(c => set[c]), id, o.status).first();
  if (!moved) return { http: 409, body: { ok: false, reason: "order", why: `No. ${pad2(o.number)} was moved a moment ago. Refresh to see where it is.` } };
  if (pieceStatus) await env.DB.prepare("UPDATE pieces SET status = ?1, updated_at = ?2 WHERE id = ?3").bind(pieceStatus, iso(), o.piece_id).run();

  /* The stage's email, once per order and stage (dedupe), unless silent,
     quiet or switched off. Delivered's carries the registration link. */
  let letter = null;
  const site = deps.siteUrl(env);
  const on = await setting(env, "stage_emails", "1");
  if (!silent && !quiet && on === "1" && o.email && STAGE_LETTER[to]) {
    const merged = Object.assign({}, o, set);
    const extra = {};
    if (to === "delivered") {
      extra.claimUrl = `${site}/claim?t=${await mintClaim(env, o)}`;
      extra.ownerNo = await nextOwnerNo(env, o.piece_id);
    }
    const q = await queueLetter(env, { template: STAGE_LETTER[to], to: o.email, dedupe: `stage:${o.id}:${to}`, series: o.series, vars: await letterVars(env, site, merged, extra) });
    letter = q ? "queued" : "already";
    if (q) deps.kick([q]);
  }
  await audit(env, actor, silent ? "order.correct" : "order.stage", "order:" + id,
    { status: o.status, piece: o.piece_status }, Object.assign({}, set, { piece: pieceStatus || o.piece_status, reason: reason || undefined, letter, quiet: quiet || undefined }), o.series);
  return { http: 200, body: { ok: true, status: to, letter } };
}
