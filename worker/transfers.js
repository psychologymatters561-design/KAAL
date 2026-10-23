/* ══════════════════════════════════════════════════════════════════
   TRANSFERS (registry, Phase 6): a piece passing from one owner to the
   next, and the one place that completes it.

   The owner starts it and is shown a code once (only its keyed hash is
   kept), valid seven days. They hand the code to the buyer with the watch
   and its letter. The buyer enters it at thekaal.co/claim/transfer,
   proves their email with a code, and accepts. If the owner of the shop
   wants to approve each transfer (Settings, on by default), it waits for
   one tap; otherwise it completes at once.

   Completing closes the old ownership with a date, opens Owner II (III,
   and so on), and changes nothing about the warranty, which belongs to
   the piece and runs from its first delivery. One batch: whole or not at
   all. A stolen piece cannot move.
   ══════════════════════════════════════════════════════════════════ */
import { audit } from "./registry.js";
import { queueLetter } from "./outbox.js";
import { hmac } from "./auth.js";
import { iso, seriesSize, warrantyWindow, longDay } from "./orders.js";

/* No 0, O, 1, I or L: a code read aloud or copied off a letter is not misread. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newCode() {
  let out = "";
  const b = crypto.getRandomValues(new Uint8Array(32));
  for (const x of b) if (x < 248 && out.length < 10) out += ALPHABET[x % 31];
  while (out.length < 10) out += ALPHABET[crypto.getRandomValues(new Uint8Array(1))[0] % 31];
  return out.slice(0, 5) + "-" + out.slice(5);
}
export const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const codeHash = (env, c) => hmac(String(env.AUTH_SECRET), "transfer|" + normCode(c));

/* The piece's warranty, as the clock the dossier shows: from its first delivery. */
export async function warrantyOf(env, pieceId, months) {
  const first = await env.DB.prepare("SELECT delivered_on FROM orders WHERE piece_id = ?1 AND delivered_on IS NOT NULL ORDER BY id LIMIT 1").bind(pieceId).first();
  return first ? warrantyWindow(first.delivered_on, months || 24) : null;
}

/* Open transfers whose seven days are up. */
export async function expireTransfers(env) {
  const r = await env.DB.prepare("UPDATE transfer_requests SET status = 'expired', decided_at = ?1 WHERE status = 'open' AND expires_at <= ?1").bind(iso()).run();
  return (r.meta && r.meta.changes) || 0;
}

/* Completes an accepted transfer. Returns { ok, ownerNo } or { ok:false, reason }. */
export async function completeTransfer(env, deps, id, actor, note) {
  const t = await env.DB.prepare("SELECT * FROM transfer_requests WHERE id = ?1").bind(id).first();
  if (!t) return { ok: false, reason: "unknown" };
  if (t.status !== "accepted") return { ok: false, reason: "state", why: `This transfer is ${t.status}.` };
  const piece = await env.DB.prepare("SELECT p.*, s.warranty_months, s.size FROM pieces p JOIN series s ON s.code = p.series WHERE p.id = ?1").bind(t.piece_id).first();
  const cur = await env.DB.prepare("SELECT * FROM ownerships WHERE piece_id = ?1 AND to_at IS NULL").bind(t.piece_id).first();
  if (!piece || piece.status !== "registered") return { ok: false, reason: "piece", why: piece && piece.status === "reported_stolen" ? "The piece is flagged as stolen; it cannot move until it is cleared." : "The piece is not in a state that can be transferred." };
  if (!cur || cur.owner_id !== t.from_owner || !t.to_owner) return { ok: false, reason: "owner", why: "The piece no longer belongs to the owner who started this transfer." };

  const at = iso();
  await env.DB.batch([
    env.DB.prepare("UPDATE ownerships SET to_at = ?1 WHERE id = ?2 AND to_at IS NULL").bind(at, cur.id),
    env.DB.prepare(
      `INSERT INTO ownerships (series, piece_id, owner_id, owner_no, from_at, acquired_via)
       SELECT ?1, ?2, ?3, (SELECT COALESCE(MAX(owner_no), 0) + 1 FROM ownerships WHERE piece_id = ?2), ?4, 'transfer'`
    ).bind(t.series, t.piece_id, t.to_owner, at),
    env.DB.prepare("UPDATE transfer_requests SET status = 'approved', decided_at = ?1, admin_decision = ?2 WHERE id = ?3 AND status = 'accepted'").bind(at, note || null, id)
  ]);
  const now = await env.DB.prepare("SELECT owner_no FROM ownerships WHERE piece_id = ?1 AND to_at IS NULL").bind(t.piece_id).first();
  const w = await warrantyOf(env, t.piece_id, piece.warranty_months);
  const from = await env.DB.prepare("SELECT email FROM owners WHERE id = ?1").bind(t.from_owner).first();
  const to = await env.DB.prepare("SELECT email FROM owners WHERE id = ?1").bind(t.to_owner).first();
  const n = piece.number, site = deps.siteUrl(env), size = piece.size;
  const ids = [];
  const base = { site, n, size, fromYear: String(cur.from_at).slice(0, 4), toYear: at.slice(0, 4), warrantyEnd: w ? `23:59 on ${longDay(w.endDay)}` : "" };
  if (from) ids.push(await queueLetter(env, { template: "transferComplete", to: from.email, series: t.series, dedupe: `transfer:${id}:done:from`, vars: Object.assign({ role: "from", ownerNo: cur.owner_no }, base) }));
  if (to) ids.push(await queueLetter(env, { template: "transferComplete", to: to.email, series: t.series, dedupe: `transfer:${id}:done:to`, vars: Object.assign({ role: "to", ownerNo: now ? now.owner_no : cur.owner_no + 1 }, base) }));
  deps.kick(ids.filter(Boolean));
  await audit(env, actor, "transfer.complete", "transfer:" + id, { owner_no: cur.owner_no, owner: t.from_owner }, { owner_no: now && now.owner_no, owner: t.to_owner, piece: t.piece_id }, t.series);
  return { ok: true, ownerNo: now ? now.owner_no : null };
}

/* A rejection, with its emails to both. */
export async function rejectTransfer(env, deps, id, actor, note) {
  const t = await env.DB.prepare("SELECT t.*, p.number FROM transfer_requests t JOIN pieces p ON p.id = t.piece_id WHERE t.id = ?1").bind(id).first();
  if (!t) return { ok: false, reason: "unknown" };
  if (t.status !== "accepted" && t.status !== "open") return { ok: false, reason: "state", why: `This transfer is ${t.status}.` };
  const at = iso();
  const done = await env.DB.prepare("UPDATE transfer_requests SET status = 'rejected', decided_at = ?1, admin_decision = ?2 WHERE id = ?3 AND status IN ('open','accepted') RETURNING id").bind(at, note || null, id).first();
  if (!done) return { ok: false, reason: "state" };
  const ids = [];
  for (const [who, uid] of [["from", t.from_owner], ["to", t.to_owner]]) {
    if (!uid) continue;
    const o = await env.DB.prepare("SELECT email FROM owners WHERE id = ?1").bind(uid).first();
    if (o) ids.push(await queueLetter(env, { template: "transferRejected", to: o.email, series: t.series, dedupe: `transfer:${id}:rejected:${who}`, vars: { site: deps.siteUrl(env), n: t.number, size: await seriesSize(env, t.series) } }));
  }
  deps.kick(ids.filter(Boolean));
  await audit(env, actor, "transfer.reject", "transfer:" + id, { status: t.status }, { status: "rejected", note: note || undefined }, t.series);
  return { ok: true };
}
