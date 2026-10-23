/* ══════════════════════════════════════════════════════════════════
   THE APPROVALS QUEUE (registry, Phase 6): what the owner of the shop
   decides, and what each decision sends.

     warranty    approve (with pickup details) · ask for more · decline
                 (with the reason, and the paid service) · serviced
                 (a service_log line, and the piece on its way back)
     stolen      confirm (the public flag, transfers blocked) · dismiss ·
                 clear (after confirming)
     recovery    verify (move their sign-in to the new address, close
                 every session) · decline (and ask for the photographs)
     contact     done (the details were changed in Owners)
     service     close
     transfers   approve · reject

   Every decision is one guarded write, an email in the brief's voice
   where the brief gives one, and a line in the audit log with before
   and after. Nothing is decided twice: a request that has already moved
   refuses the second tap.
   ══════════════════════════════════════════════════════════════════ */
import { audit } from "./registry.js";
import { queueLetter } from "./outbox.js";
import { revokeAll, normEmail, validEmail } from "./auth.js";
import { iso, seriesSize, clean } from "./orders.js";
import { completeTransfer, rejectTransfer, warrantyOf } from "./transfers.js";
import { longDay } from "./orders.js";

const text = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max);
const fail = (http, reason, why) => ({ http, body: { ok: false, reason, why } });
const ok = (extra) => ({ http: 200, body: Object.assign({ ok: true }, extra || {}) });

export async function approvalsList(env) {
  const reqs = (await env.DB.prepare(
    `SELECT r.id, r.type, r.status, r.created_at, r.description, r.media, r.admin_notes, r.piece_id, p.number, o.name, o.email, o.phone
       FROM requests r JOIN pieces p ON p.id = r.piece_id LEFT JOIN owners o ON o.id = r.owner_id
      WHERE r.status IN ('open','info_needed','approved') ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'info_needed' THEN 1 ELSE 2 END, r.id`
  ).all()).results || [];
  const transfers = (await env.DB.prepare(
    `SELECT t.id, t.status, t.created_at, t.expires_at, t.piece_id, p.number, f.email AS from_email, f.name AS from_name, b.email AS to_email, b.name AS to_name
       FROM transfer_requests t JOIN pieces p ON p.id = t.piece_id JOIN owners f ON f.id = t.from_owner LEFT JOIN owners b ON b.id = t.to_owner
      WHERE t.status IN ('open','accepted') ORDER BY CASE t.status WHEN 'accepted' THEN 0 ELSE 1 END, t.id`
  ).all()).results || [];
  return { ok: true, requests: reqs.map(r => Object.assign(r, { media: r.media ? safeJson(r.media) : [] })), transfers };
}
function safeJson(s) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch (e) { return []; } }

/* A claim's file, for the control room only. */
export async function mediaOf(env, key) {
  if (!/^claim:\d+:[A-Za-z0-9_-]{10,24}$/.test(String(key || ""))) return null;
  const got = await env.KAAL_STATE.getWithMetadata(key, "arrayBuffer").catch(() => null);
  return got && got.value ? { body: got.value, type: (got.metadata && got.metadata.type) || "application/octet-stream" } : null;
}

export async function decideRequest(env, deps, actor, id, b) {
  const r = await env.DB.prepare(
    `SELECT r.*, p.number, p.status AS piece_status, p.id AS pid, s.size, s.warranty_months, o.email AS owner_email, o.name AS owner_name
       FROM requests r JOIN pieces p ON p.id = r.piece_id JOIN series s ON s.code = r.series LEFT JOIN owners o ON o.id = r.owner_id WHERE r.id = ?1`
  ).bind(id).first();
  if (!r) return fail(404, "unknown");
  const action = String(b.action || ""), site = deps.siteUrl(env), at = iso();
  const vars = (extra) => Object.assign({ site, n: r.number, size: r.size }, extra || {});
  const mail = async (template, to, extra, key) => {
    if (!to) return null;
    const q = await queueLetter(env, { template, to, series: r.series, dedupe: `req:${id}:${key || template}`, vars: vars(extra) });
    if (q) deps.kick([q]);
    return q;
  };
  /* The move itself: only from a state the request is actually in. */
  const move = async (from, to, decision) => {
    const done = await env.DB.prepare(`UPDATE requests SET status = ?1, decision = ?2, decided_at = ?3, updated_at = ?3 WHERE id = ?4 AND status IN (${from.map(() => "?").join(",")}) RETURNING id`)
      .bind(to, decision || null, at, id, ...from).first();
    return !!done;
  };
  const stale = () => fail(409, "state", `This request is ${r.status}; it has already moved.`);
  const logIt = (what, after) => audit(env, actor, "request." + what, "request:" + id, { status: r.status, type: r.type }, after, r.series);

  if (r.type === "warranty") {
    if (action === "approve") {
      const pickup = text(b.pickup, 600);
      if (pickup.length < 5) return fail(400, "pickup", "Say how the pickup will work: who collects it, and when.");
      if (!(await move(["open", "info_needed"], "approved", "approved"))) return stale();
      await mail("claimApproved", r.owner_email, { pickup }, "approved");
      await logIt("approve", { status: "approved", pickup }); return ok();
    }
    if (action === "info") {
      const message = text(b.message, 800);
      if (message.length < 5) return fail(400, "message", "Say what you need from them.");
      if (!(await move(["open", "info_needed"], "info_needed", "info"))) return stale();
      await mail("moreInfo", r.owner_email, { message }, "info:" + Date.now());
      await logIt("info", { status: "info_needed", message }); return ok();
    }
    if (action === "decline") {
      const reason = text(b.reason, 800);
      if (reason.length < 5) return fail(400, "reason", "Say why, kindly and plainly. They are sent it.");
      if (!(await move(["open", "info_needed"], "declined", "declined"))) return stale();
      await mail("claimDeclined", r.owner_email, { reason }, "declined");
      await logIt("decline", { status: "declined", reason }); return ok();
    }
    if (action === "serviced") {
      const work = text(b.work_done, 500);
      if (work.length < 3) return fail(400, "work", "What was done, for the service history.");
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? String(b.date) : iso().slice(0, 10);
      if (!(await move(["approved"], "closed", "serviced"))) return fail(409, "state", "A claim is marked serviced only after it has been approved.");
      const pub = text(b.public_line, 120);
      await env.DB.prepare("INSERT INTO service_log (series, piece_id, date, work_done, public_line) VALUES (?1, ?2, ?3, ?4, ?5)").bind(r.series, r.pid, day, work, pub || null).run();
      const w = await warrantyOf(env, r.pid, r.warranty_months);
      await mail("serviceReturned", r.owner_email, { courier: clean(String(b.courier || ""), 40), tracking: clean(String(b.tracking || ""), 60), warrantyEnd: w ? `23:59 on ${longDay(w.endDay)}` : "" }, "returned");
      await logIt("serviced", { status: "closed", work, public_line: pub || undefined, date: day }); return ok();
    }
  }

  if (r.type === "stolen") {
    if (action === "confirm") {
      if (!(await move(["open"], "approved", "confirmed"))) return stale();
      await env.DB.prepare("UPDATE pieces SET status = 'reported_stolen', updated_at = ?1 WHERE id = ?2 AND status IN ('registered','delivered','placed')").bind(at, r.pid).run();
      await env.DB.prepare("UPDATE transfer_requests SET status = 'cancelled', decided_at = ?1 WHERE piece_id = ?2 AND status IN ('open','accepted')").bind(at, r.pid).run();
      await mail("stolenConfirmed", r.owner_email, {}, "confirmed");
      await logIt("confirm", { status: "approved", piece: "reported_stolen" }); return ok();
    }
    if (action === "dismiss") {
      if (!(await move(["open"], "declined", "dismissed"))) return stale();
      await logIt("dismiss", { status: "declined" }); return ok();
    }
    if (action === "clear") {
      if (!(await move(["approved"], "closed", "cleared"))) return fail(409, "state", "Only a confirmed report can be cleared.");
      await env.DB.prepare("UPDATE pieces SET status = 'registered', updated_at = ?1 WHERE id = ?2 AND status = 'reported_stolen'").bind(at, r.pid).run();
      await mail("stolenCleared", r.owner_email, {}, "cleared");
      await logIt("clear", { status: "closed", piece: "registered" }); return ok();
    }
  }

  if (r.type === "recovery") {
    const contact = (/^Contact: (\S+)/.exec(r.description || "") || [])[1] || "";
    if (action === "verify") {
      const e = normEmail(b.email || contact);
      if (!validEmail(e)) return fail(400, "email", "The address their sign-in should move to.");
      const holder = await env.DB.prepare("SELECT id, email FROM owners WHERE id = ?1").bind(r.owner_id).first();
      if (!holder) return fail(409, "owner", "The piece has no open owner to move.");
      const clash = await env.DB.prepare("SELECT id FROM owners WHERE email = ?1 AND id != ?2").bind(e, holder.id).first();
      if (clash) return fail(409, "taken", "Another owner already signs in with that address.");
      if (!(await move(["open", "info_needed"], "closed", "verified"))) return stale();
      await env.DB.prepare("UPDATE owners SET email = ?1, updated_at = ?2 WHERE id = ?3").bind(e, at, holder.id).run();
      const n = await revokeAll(env, holder.id);
      await mail("accessReset", e, { signInUrl: `${site}/owners` }, "reset");
      await audit(env, actor, "owner.recovery", "owner:" + holder.id, { email: holder.email }, { email: e, sessions: n }, r.series);
      await logIt("verify", { status: "closed", email: e }); return ok();
    }
    if (action === "decline") {
      const reason = text(b.reason, 600);
      if (reason.length < 5) return fail(400, "reason", "Say what you could not verify.");
      if (!(await move(["open", "info_needed"], "declined", "declined"))) return stale();
      await mail("recoveryDeclined", normEmail(contact), { reason }, "declined");
      await logIt("decline", { status: "declined", reason }); return ok();
    }
  }

  if ((r.type === "contact" || r.type === "service") && (action === "done" || action === "close")) {
    if (!(await move(["open", "info_needed", "approved"], "closed", action === "done" ? "done" : "closed"))) return stale();
    await logIt(action, { status: "closed", note: text(b.note, 300) || undefined }); return ok();
  }
  return fail(400, "action", "That is not something this request can be asked to do.");
}

export async function decideTransfer(env, deps, actor, id, b) {
  const action = String(b.action || ""), note = text(b.note, 300);
  if (action === "approve") {
    const r = await completeTransfer(env, deps, id, actor, note);
    return r.ok ? ok({ ownerNo: r.ownerNo }) : fail(r.reason === "unknown" ? 404 : 409, r.reason, r.why);
  }
  if (action === "reject") {
    const r = await rejectTransfer(env, deps, id, actor, note);
    return r.ok ? ok() : fail(r.reason === "unknown" ? 404 : 409, r.reason, r.why);
  }
  return fail(400, "action", "Approve or reject.");
}
