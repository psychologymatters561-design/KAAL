/* ══════════════════════════════════════════════════════════════════
   THE OUTBOX (registry): every email the registry sends is a row first.

   queueLetter writes the row (template, recipient, the variables) and
   nothing else; flushOutbox sends what is due. So a stage change is
   committed whether or not the email provider answers, and an email that
   fails is tried again, with backoff, and shown as failed in /control if
   it never goes. dedupe_key makes "the Dispatched email for order 12"
   exist at most once, however many times it is asked for.

   The letter is rendered at send time from its template and variables,
   so a corrected template reaches everything still queued.
   ══════════════════════════════════════════════════════════════════ */
import { LETTERS } from "./letters.js";

const BACKOFF_MIN = [1, 5, 30, 120, 360];          /* then failed */
const SECRET_VARS = ["claimUrl", "trackUrl", "inviteUrl", "transferCode", "shipUrl"];
const iso = (ms) => new Date(ms === undefined ? Date.now() : ms).toISOString();

/* Returns the row id, or 0 when the same dedupe key was already queued. */
export async function queueLetter(env, { template, to, vars, dedupe, series }) {
  if (!LETTERS[template]) throw new Error("No letter called " + template);
  const subject = LETTERS[template](vars).subject;
  const r = await env.DB.prepare(
    `INSERT INTO email_outbox (series, template, to_email, subject, payload, dedupe_key)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`
  ).bind(series || null, template, String(to).toLowerCase(), subject, JSON.stringify(vars || {}), dedupe || null).first();
  return r ? r.id : 0;
}

/* Sends what is due, oldest first, a few at a time. Each row is claimed
   before it is sent (its next attempt pushed forward), so two runs at
   once never send the same email twice. `send(to, subject, text, html)`
   is the worker's own mail path and answers true or false. `ids`, when
   given, limits the run to those rows (the send right after a change). */
export async function flushOutbox(env, send, ids, limit) {
  const now = Date.now();
  const rows = ids && ids.length
    ? (await env.DB.prepare(`SELECT * FROM email_outbox WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'queued'`).bind(...ids).all()).results || []
    : (await env.DB.prepare("SELECT * FROM email_outbox WHERE status = 'queued' AND next_attempt_at <= ?1 ORDER BY id LIMIT ?2").bind(iso(now), limit || 10).all()).results || [];
  let sent = 0;
  for (const row of rows) {
    const wait = BACKOFF_MIN[Math.min(row.attempts, BACKOFF_MIN.length - 1)] * 60000;
    const claimed = await env.DB.prepare(
      "UPDATE email_outbox SET attempts = attempts + 1, next_attempt_at = ?1 WHERE id = ?2 AND status = 'queued' AND attempts = ?3 RETURNING id"
    ).bind(iso(now + wait), row.id, row.attempts).first();
    if (!claimed) continue;
    let ok = false, err = "";
    try {
      const vars = JSON.parse(row.payload || "{}");
      const m = LETTERS[row.template](vars);
      ok = await send(row.to_email, m.subject, m.text, m.html);
      if (!ok) err = "The email provider refused it, or no provider key is set.";
    } catch (e) { err = String(e).slice(0, 200); }
    if (ok) {
      /* The email has gone: the links in it are the buyer's now, and no
         longer need to sit in the database (or its backups). */
      let left = row.payload;
      try { const v = JSON.parse(row.payload || "{}"); for (const k of SECRET_VARS) delete v[k]; left = JSON.stringify(v); } catch (e) { /* kept as it was */ }
      await env.DB.prepare("UPDATE email_outbox SET status = 'sent', sent_at = ?1, last_error = NULL, payload = ?2 WHERE id = ?3").bind(iso(), left, row.id).run();
      sent++;
    } else {
      const dead = row.attempts + 1 >= BACKOFF_MIN.length + 1;
      await env.DB.prepare("UPDATE email_outbox SET status = ?1, last_error = ?2 WHERE id = ?3").bind(dead ? "failed" : "queued", err, row.id).run();
    }
  }
  return sent;
}

/* Back into the queue, now: the control room's Retry. */
export async function retryLetter(env, id) {
  const r = await env.DB.prepare(
    "UPDATE email_outbox SET status = 'queued', attempts = 0, next_attempt_at = ?1, last_error = NULL WHERE id = ?2 AND status IN ('failed','queued') RETURNING id"
  ).bind(iso(), id).first();
  return !!r;
}
