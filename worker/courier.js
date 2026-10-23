/* ══════════════════════════════════════════════════════════════════
   THE COURIER (registry, Phase 3): Dispatched and Delivered by themselves.

   Shiprocket posts a tracking event to POST /ship/shiprocket each time a
   shipment moves. The worker believes it only if the request carries the
   shared secret (header x-api-key = SHIPROCKET_TOKEN, which the owner
   types into Shiprocket's webhook setting), and then:

     picked up / shipped / in transit  -> Dispatched (courier, AWB, link
                                          filled in; the buyer is emailed)
     out for delivery                  -> one short heads-up email
     delivered                         -> Delivered (today's date, the
                                          warranty and the return window
                                          start, the registration link goes)
     returned to origin, lost, damaged -> no order is changed; the owner is
                                          told, once

   Which order? By the AWB if one carries it, else by the order reference
   Shiprocket was given: create the Shiprocket order with the reference
   "KAAL-07" (or "KAAL-S01-07") for No. 07 and every event finds its way.
   An event that matches nothing is recorded and the owner is told once.

   Every event is kept once, by awb|status|time: the courier repeating
   itself changes nothing and sends nothing. The stages the courier proves
   were passed (an order never tapped Packed that is now in a courier's
   hands) are moved through silently first: the buyer is never emailed
   "boxed" after "on its way".
   ══════════════════════════════════════════════════════════════════ */
import { registryOn, audit, SERIES } from "./registry.js";
import { adminEmail, same } from "./auth.js";
import { queueLetter } from "./outbox.js";
import { moveOrder, setting, seriesSize, istDay, iso, trackUrl, clean } from "./orders.js";

const MAX_BODY = 64 * 1024;

/* Shiprocket's words for where a parcel is. Matched on the status text
   first (it is what the dashboard shows) and on the numeric id as a
   fallback. Anything not listed is ignored, not guessed at. */
const SHIPPED = new Set(["PICKED UP", "SHIPPED", "IN TRANSIT", "REACHED AT DESTINATION HUB", "REACHED BACK AT SELLER CITY"]);
const SHIPPED_IDS = new Set([6, 42, 18]);
const OFD = new Set(["OUT FOR DELIVERY"]);
const OFD_IDS = new Set([17]);
const DELIVERED = new Set(["DELIVERED"]);
const DELIVERED_IDS = new Set([7]);
const TROUBLE = /RTO|UNDELIVERED|LOST|DAMAGED|DESTROYED|UNTRACEABLE|CANCEL|MISROUTED|DISPOSED|ISSUE RELATED/;

function kind(status, id) {
  const s = String(status || "").trim().toUpperCase();
  if (DELIVERED.has(s) || DELIVERED_IDS.has(id)) return "delivered";
  if (TROUBLE.test(s)) return "trouble";
  if (OFD.has(s) || OFD_IDS.has(id)) return "ofd";
  if (SHIPPED.has(s) || SHIPPED_IDS.has(id)) return "shipped";
  return "ignore";
}

/* "23 05 2026 11:43:53" (Shiprocket's own) or any date JS reads. India time. */
function when(v) {
  const m = /^(\d{2}) (\d{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(v || "").trim());
  const t = m ? Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`) : Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : Date.now();
}

/* The number a courier reference means: KAAL-07, KAAL-S01-07, kaal 7. */
export function numberOf(ref) {
  const m = /KAAL[-_ ]*(?:S\d{2}[-_ ]*)?0*(\d{1,2})\b/i.exec(String(ref || ""));
  const n = m ? parseInt(m[1], 10) : 0;
  return n >= 1 && n <= 99 ? n : 0;
}

function out(body, status) { return new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }

export async function shiprocket(request, env, ctx, deps) {
  if (!registryOn(env) || !env.SHIPROCKET_TOKEN || String(env.SHIPROCKET_TOKEN).length < 12) {
    return out({ ok: false, reason: "off", why: "The courier link is not switched on: set the SHIPROCKET_TOKEN secret and run setup-worker." }, 503);
  }
  if (!same(String(request.headers.get("x-api-key") || ""), String(env.SHIPROCKET_TOKEN))) return out({ ok: false, reason: "refused" }, 401);

  const raw = await request.text();
  if (raw.length > MAX_BODY) return out({ ok: false, reason: "too-big" }, 413);
  let p;
  try { p = JSON.parse(raw); } catch (e) { return out({ ok: false, reason: "bad-json" }, 400); }
  if (!p || typeof p !== "object") return out({ ok: false, reason: "bad-json" }, 400);

  const awb = clean(String(p.awb || p.awb_code || ""), 60);
  const status = clean(String(p.current_status || p.shipment_status || ""), 80);
  const sid = parseInt(p.current_status_id || p.shipment_status_id, 10);
  const at = when(p.current_timestamp);
  const courier = clean(String(p.courier_name || ""), 40);
  const ref = clean(String(p.order_id || p.channel_order_id || ""), 80);
  if (!awb || !status) return out({ ok: true, ignored: "no awb or status" });
  if (p.is_return === 1 || p.is_return === true || p.is_return === "1") return out({ ok: true, ignored: "a return shipment" });

  const k = kind(status, Number.isFinite(sid) ? sid : -1);
  if (k === "ignore") return out({ ok: true, ignored: status });

  /* Once each. */
  const key = `${awb}|${status.toUpperCase()}|${p.current_timestamp || ""}`;
  const first = await env.DB.prepare("INSERT INTO courier_events (dedupe_key, awb, status) VALUES (?1, ?2, ?3) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id").bind(key, awb, status).first();
  if (!first) return out({ ok: true, duplicate: true });
  const mark = (outcome, orderId) => env.DB.prepare("UPDATE courier_events SET outcome = ?1, order_id = ?2 WHERE id = ?3").bind(outcome, orderId || null, first.id).run();

  /* Which order. */
  let o = await env.DB.prepare("SELECT o.*, p.number FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE o.tracking_number = ?1 AND o.status NOT IN ('cancelled','returned') ORDER BY o.id DESC").bind(awb).first();
  if (!o) {
    const n = numberOf(ref);
    if (n) o = await env.DB.prepare("SELECT o.*, p.number FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE p.series = ?1 AND p.number = ?2 AND o.status NOT IN ('cancelled','returned') ORDER BY o.id DESC").bind(SERIES, n).first();
  }
  const site = deps.siteUrl(env);
  const controlUrl = `${deps.workerUrl(env)}/control`;
  const tell = async (n, why) => {
    const q = await queueLetter(env, { template: "courierAlert", to: adminEmail(env), dedupe: `courier:${awb}:${status.toUpperCase()}`, vars: { n, awb, status: why || status, controlUrl } });
    if (q) deps.kick([q]);
  };
  if (!o) {
    await mark("unmatched");
    await audit(env, "system:courier", "courier.unmatched", "awb:" + awb, null, { status, ref });
    await tell(0);
    return out({ ok: true, unmatched: true });
  }
  if (k === "trouble") {
    await mark("alert", o.id);
    await audit(env, "system:courier", "courier.alert", "order:" + o.id, null, { status, awb }, o.series);
    await tell(o.number);
    return out({ ok: true, alert: true });
  }

  const day = istDay(at);
  const link = `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
  const run = (b, quiet) => moveOrder(env, deps, "system:courier", o.id, b, { quiet });
  const walk = async (upTo) => {                      /* silent moves to the stage before the one the courier proves */
    const order = ["placed", "inspected", "packed", "dispatched"];
    let cur = (await env.DB.prepare("SELECT status FROM orders WHERE id = ?1").bind(o.id).first()).status;
    while (order.indexOf(cur) > -1 && order.indexOf(cur) < order.indexOf(upTo)) {
      const next = order[order.indexOf(cur) + 1];
      const b = next === "dispatched" ? { to: next, courier: courier || "Shiprocket", tracking: awb, url: link } : { to: next };
      const r = await run(b, true);
      if (!r.body.ok) return r;
      cur = next;
    }
    return { body: { ok: true } };
  };
  const now = () => env.DB.prepare("SELECT status FROM orders WHERE id = ?1").bind(o.id).first().then(r => r.status);

  if (k === "shipped") {
    if (["placed", "inspected", "packed"].indexOf(o.status) < 0) { await mark("ignored", o.id); return out({ ok: true, already: o.status }); }
    const w = await walk("packed");
    const r = w.body.ok ? await run({ to: "dispatched", courier: courier || "Shiprocket", tracking: awb, url: link }, false) : w;
    await mark(r.body.ok ? "dispatched" : "alert", o.id);
    if (!r.body.ok) await tell(o.number, `could not be marked dispatched (${r.body.why || r.body.reason})`);
    return out({ ok: true, dispatched: !!r.body.ok });
  }
  if (k === "ofd") {
    if (await now() === "dispatched" && o.email && (await setting(env, "stage_emails", "1")) === "1") {
      const q = await queueLetter(env, { template: "outForDelivery", to: o.email, series: o.series, dedupe: `stage:${o.id}:ofd`,
        vars: { site, n: o.number, size: await seriesSize(env, o.series), courier: o.courier || courier, trackUrl: await trackUrl(env, site, o.id) } });
      if (q) deps.kick([q]);
    }
    await mark("heads-up", o.id);
    return out({ ok: true, headsUp: true });
  }
  /* delivered */
  if (["delivered", "registered"].indexOf(o.status) > -1) { await mark("ignored", o.id); return out({ ok: true, already: o.status }); }
  const w = await walk("dispatched");
  let d = day;
  const fresh = await env.DB.prepare("SELECT dispatched_at FROM orders WHERE id = ?1").bind(o.id).first();
  const sent = fresh && fresh.dispatched_at ? istDay(Date.parse(fresh.dispatched_at)) : "";
  if (sent && d < sent) d = sent;                      /* a courier clock a little behind ours */
  if (d > istDay()) d = istDay();
  const r = w.body.ok ? await run({ to: "delivered", day: d }, false) : w;
  await mark(r.body.ok ? "delivered" : "alert", o.id);
  if (!r.body.ok) await tell(o.number, `could not be marked delivered (${r.body.why || r.body.reason})`);
  return out({ ok: true, delivered: !!r.body.ok });
}
