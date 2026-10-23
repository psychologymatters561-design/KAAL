/* ══════════════════════════════════════════════════════════════════
   THE QUIET PROMISES (registry, Phase 3): what the clock does by itself.

   Run by the worker's cron (every half hour). Each check is safe to run
   again and again: an email is queued under a key naming the order and
   the rule, so it exists once however often the check finds the same
   late order. Nothing here moves an order; it only tells.

   To the shop's own inbox, once per order and rule:
     placed more than 48 hours, not inspected
     not dispatched by day 4 (the promise is five days)
     dispatched more than 7 days, not delivered
   To a buyer, once, never nagging:
     72 hours after delivery, still unregistered: the one reminder,
     with a fresh registration link (the first is not revoked).
   ══════════════════════════════════════════════════════════════════ */
import { registryOn } from "./registry.js";
import { adminEmail } from "./auth.js";
import { queueLetter, flushOutbox } from "./outbox.js";
import { mintClaim, nextOwnerNo, seriesSize, setting, iso } from "./orders.js";

const H = 3600000, D = 86400000;

export const RULES = [
  { key: "inspect48", why: "Placed more than 48 hours ago, not inspected", sql: "status = 'placed' AND paid_at < ?1", ms: 48 * H },
  { key: "dispatch4", why: "Not dispatched by day 4", sql: "status IN ('placed','inspected','packed') AND paid_at < ?1", ms: 4 * D },
  { key: "deliver7", why: "Dispatched more than 7 days ago, not delivered", sql: "status = 'dispatched' AND dispatched_at < ?1", ms: 7 * D }
];

/* The orders breaking a promise right now, with the rule, for the control
   room's Overview and for the emails. */
export async function lateOrders(env, nowMs) {
  const now = nowMs === undefined ? Date.now() : nowMs;
  const seen = new Set(), out = [];
  for (const r of RULES.slice().reverse()) {                 /* the worst rule first, so an order is named by it */
    const rows = (await env.DB.prepare(
      `SELECT o.id, o.piece_id, p.number, o.series, o.status, o.paid_at, o.dispatched_at FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE ${r.sql.replace(/\b(status|paid_at|dispatched_at)\b/g, "o.$1")} ORDER BY o.paid_at`
    ).bind(iso(now - r.ms)).all()).results || [];
    for (const o of rows) {
      /* An order late on the day-4 rule is also past the 48 hour one; say the worst, once. */
      if (seen.has(String(o.id))) continue;
      seen.add(String(o.id));
      out.push(Object.assign({}, o, { rule: r.key, why: r.why }));
    }
  }
  /* Worst first: the later promise is the worse one. */
  const rank = { deliver7: 0, dispatch4: 1, inspect48: 2 };
  return out.sort((a, b) => rank[a.rule] - rank[b.rule]);
}

export async function sweeps(env, deps) {
  if (!registryOn(env)) return { ok: false };
  const site = deps.siteUrl(env), controlUrl = `${deps.workerUrl(env)}/control`;
  const queued = [];
  const day = (iso8601) => new Date(Date.parse(iso8601) + 5.5 * H).toISOString().slice(0, 10);

  /* To the shop: one email per order and rule, and a rule that is worse
     later (day 4 after 48 hours) is its own email, once. */
  for (const r of RULES) {
    const rows = (await env.DB.prepare(
      `SELECT o.id, o.series, o.status, o.paid_at, p.number FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE ${r.sql.replace(/\b(status|paid_at|dispatched_at)\b/g, "o.$1")}`
    ).bind(iso(Date.now() - r.ms)).all()).results || [];
    for (const o of rows) {
      const q = await queueLetter(env, { template: "sla", to: adminEmail(env), series: o.series, dedupe: `sla:${r.key}:${o.id}`,
        vars: { n: o.number, why: r.why, status: o.status, paidOn: day(o.paid_at), controlUrl } });
      if (q) queued.push(q);
    }
  }

  /* To the buyer: the one reminder, 72 hours after delivery. The warranty
     clock starts at 00:00 India time on the delivery day, so "72 hours
     after delivery" is the same moment three days on. */
  if ((await setting(env, "stage_emails", "1")) === "1") {
    const rows = (await env.DB.prepare(
      `SELECT o.*, p.number FROM orders o JOIN pieces p ON p.id = o.piece_id
        WHERE o.status = 'delivered' AND o.registered_at IS NULL AND o.delivered_on IS NOT NULL AND o.email IS NOT NULL`
    ).all()).results || [];
    for (const o of rows) {
      const dueAt = Date.parse(`${o.delivered_on}T00:00:00.000+05:30`) + 3 * D;
      if (Date.now() < dueAt) continue;
      if (o.return_window_ends_at && Date.parse(o.return_window_ends_at) < Date.now()) continue;      /* the window has closed: nothing to close by registering */
      const have = await env.DB.prepare("SELECT 1 AS x FROM email_outbox WHERE dedupe_key = ?1").bind(`reminder:${o.id}`).first();
      if (have) continue;
      const token = await mintClaim(env, o);
      const q = await queueLetter(env, { template: "reminder", to: o.email, series: o.series, dedupe: `reminder:${o.id}`,
        vars: { site, n: o.number, size: await seriesSize(env, o.series), claimUrl: `${site}/claim?t=${token}`, ownerNo: await nextOwnerNo(env, o.piece_id) } });
      if (q) queued.push(q);
    }
  }
  if (queued.length) await deps.kickNow(queued);
  return { ok: true, queued: queued.length };
}
