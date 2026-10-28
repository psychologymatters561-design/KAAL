/* ══════════════════════════════════════════════════════════════════
   WHAT AN OWNER CAN ASK FOR (registry, Phase 6): /o/requests, /o/upload,
   /o/transfer/*, /o/recovery.

   Warranty claims, stolen reports, contact changes and paid service all
   become one row in `requests`, which the owner of the shop answers in
   the control room's Approvals within forty eight hours; nothing here
   decides anything. Transfers are in worker/transfers.js.

   A claim's photographs and videos are kept private: stored by their own
   random key against the owner who sent them, readable only from the
   control room, and sniffed for what they really are rather than trusted
   for what they say they are.
   ══════════════════════════════════════════════════════════════════ */
import { audit, normPhone } from "./registry.js";
import { notifyOwner } from "./push.js";
import { sessionOf, issueCode, spendCode, openSession, codeEmail, adminEmail, normEmail, validEmail, b64url } from "./auth.js";
import { queueLetter } from "./outbox.js";
import { iso, seriesSize, setting, warrantyWindow } from "./orders.js";
import { newCode, normCode, codeHash, warrantyOf, completeTransfer } from "./transfers.js";

const TYPES = ["warranty", "stolen", "contact", "service"];
const MAX_IMAGE = 8 * 1024 * 1024, MAX_VIDEO = 24 * 1024 * 1024;
const MEDIA_TTL = 400 * 86400;

/* Text that keeps its paragraphs. */
const longText = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const clean1 = (v, max) => longText(v, max).replace(/\n/g, " ");

/* What a file really is, from its first bytes. */
export function sniff(b) {
  const u = new Uint8Array(b.slice(0, 16));
  if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return { type: "image/jpeg", kind: "image" };
  if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return { type: "image/png", kind: "image" };
  if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) return { type: "image/webp", kind: "image" };
  if (u[4] === 0x66 && u[5] === 0x74 && u[6] === 0x79 && u[7] === 0x70) return { type: "video/mp4", kind: "video" };   /* ftyp: mp4, mov, m4v */
  if (u[0] === 0x1a && u[1] === 0x45 && u[2] === 0xdf && u[3] === 0xa3) return { type: "video/webm", kind: "video" };
  return null;
}

async function heldBy(env, ownerId, pieceId) {
  return env.DB.prepare(
    `SELECT w.*, p.number, p.status AS piece_status, s.warranty_months, s.size, s.name AS series_name FROM ownerships w
       JOIN pieces p ON p.id = w.piece_id JOIN series s ON s.code = w.series
      WHERE w.owner_id = ?1 AND w.piece_id = ?2 AND w.to_at IS NULL`
  ).bind(ownerId, String(pieceId || "")).first();
}

export async function ownerActions(request, env, ctx, path, deps, J, readBody) {
  const method = request.method, site = deps.siteUrl(env), controlUrl = `${deps.workerUrl(env)}/control`;
  const staff = async (type, piece, summary, id) => {
    const q = await queueLetter(env, { template: "requestNew", to: adminEmail(env), series: piece.series, dedupe: `req:${id}`,
      vars: { n: piece.number, type, summary: summary ? summary.slice(0, 400) : "", controlUrl } });
    if (q) deps.kick([q]);
  };
  const me = () => sessionOf(env, request, { bearer: true });

  /* ── A photograph or a video for a claim ── */
  if (method === "POST" && path === "/o/upload") {
    const s = await me(); if (!s) return J({ ok: false, reason: "signed-out" }, 401);
    const piece = await heldBy(env, s.owner.id, new URL(request.url).searchParams.get("p"));
    if (!piece) return J({ ok: false, reason: "piece" }, 404);
    const len = parseInt(request.headers.get("content-length") || "0", 10);
    if (len > MAX_VIDEO + 1024) return J({ ok: false, reason: "too-big", why: "That file is too large. Photographs up to 8 MB and videos up to 24 MB." }, 413);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) return J({ ok: false, reason: "empty" }, 400);
    const kind = sniff(buf);
    if (!kind) return J({ ok: false, reason: "type", why: "That does not look like a photograph or a video we can keep. Use JPEG, PNG, WebP, MP4, MOV or WebM." }, 415);
    if (buf.byteLength > (kind.kind === "image" ? MAX_IMAGE : MAX_VIDEO)) return J({ ok: false, reason: "too-big", why: kind.kind === "image" ? "That photograph is over 8 MB." : "That video is over 24 MB." }, 413);
    const key = `claim:${s.owner.id}:${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
    await env.KAAL_STATE.put(key, buf, { expirationTtl: MEDIA_TTL, metadata: { type: kind.type, size: buf.byteLength, piece: piece.piece_id, at: iso() } });
    return J({ ok: true, key, type: kind.type, size: buf.byteLength });
  }

  /* ── A claim, a stolen report, a contact change, a service request ── */
  if (method === "POST" && path === "/o/requests") {
    const s = await me(); if (!s) return J({ ok: false, reason: "signed-out" }, 401);
    const b = await readBody(request); if (!b) return J({ ok: false, reason: "too-big" }, 413);
    const type = String(b.type || "");
    if (TYPES.indexOf(type) < 0) return J({ ok: false, reason: "type" }, 400);
    const piece = await heldBy(env, s.owner.id, b.piece);
    if (!piece) return J({ ok: false, reason: "piece" }, 404);
    const description = longText(b.description, 2000);
    if (description.length < 5) return J({ ok: false, reason: "description", why: "Say a little about it, in a sentence or two." }, 400);
    if (piece.piece_status === "reported_stolen" && type !== "stolen") return J({ ok: false, reason: "stolen", why: "This piece is flagged as stolen. Write to connect@thekaal.co." }, 409);
    if (type === "stolen" && piece.piece_status === "reported_stolen") return J({ ok: false, reason: "dup", why: "It is already flagged." }, 409);
    if (type === "warranty") {
      const w = await warrantyOf(env, piece.piece_id, piece.warranty_months);
      if (!w || w.endMs <= Date.now()) return J({ ok: false, reason: "expired", why: "Your warranty has concluded. You can ask for a paid service instead." }, 409);
    }
    const open = await env.DB.prepare("SELECT id FROM requests WHERE piece_id = ?1 AND type = ?2 AND status IN ('open','info_needed','approved')").bind(piece.piece_id, type).first();
    if (open) return J({ ok: false, reason: "dup", why: "You already have one open for this piece. We will answer it first." }, 409);
    const media = (Array.isArray(b.media) ? b.media : []).slice(0, 4).map(String);
    for (const k of media) {
      if (!k.startsWith(`claim:${s.owner.id}:`) || !(await env.KAAL_STATE.get(k, "arrayBuffer").catch(() => null))) return J({ ok: false, reason: "media", why: "One of the files is no longer here. Add it again." }, 400);
    }
    const row = await env.DB.prepare(
      "INSERT INTO requests (series, piece_id, owner_id, type, description, media) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id"
    ).bind(piece.series, piece.piece_id, s.owner.id, type, description, media.length ? JSON.stringify(media) : null).first();
    await audit(env, "owner:" + s.owner.id, "request.new", "request:" + row.id, null, { type, piece: piece.piece_id, media: media.length }, piece.series);
    await staff(type, piece, description, row.id);
    await notifyOwner(env, { kind: "owner", title: `${type === "warranty" ? "Warranty claim" : "Owner request"}: No. ${String(piece.number).padStart(2, "0")}`,
      body: "An owner is waiting on you. Answer within 48 hours.", url: "/control#approvals", tag: "req-" + row.id });
    if (type === "warranty") {
      const q = await queueLetter(env, { template: "claimReceived", to: s.owner.email, series: piece.series, dedupe: `claim:${row.id}:received`, vars: { site, n: piece.number, size: piece.size } });
      if (q) deps.kick([q]);
    }
    return J({ ok: true, id: row.id });
  }

  /* ── Passing a piece on ── */
  if (method === "POST" && path === "/o/transfer/start") {
    const s = await me(); if (!s) return J({ ok: false, reason: "signed-out" }, 401);
    const b = await readBody(request); if (!b) return J({ ok: false, reason: "too-big" }, 413);
    const piece = await heldBy(env, s.owner.id, b.piece);
    if (!piece) return J({ ok: false, reason: "piece" }, 404);
    if (piece.piece_status === "reported_stolen") return J({ ok: false, reason: "stolen", why: "This piece is flagged as stolen, so it cannot be transferred until the flag is cleared." }, 409);
    if (piece.piece_status !== "registered") return J({ ok: false, reason: "state", why: "Only a registered piece can be passed on." }, 409);
    const live = await env.DB.prepare("SELECT id FROM transfer_requests WHERE piece_id = ?1 AND status IN ('open','accepted')").bind(piece.piece_id).first();
    if (live) return J({ ok: false, reason: "dup", why: "A transfer is already open for this piece. Cancel it first to start another." }, 409);
    const buyer = normEmail(b.buyerEmail);
    if (b.buyerEmail && !validEmail(buyer)) return J({ ok: false, reason: "email", why: "That does not look like an email address." }, 400);
    if (buyer && buyer === normEmail(s.owner.email)) return J({ ok: false, reason: "email", why: "That is your own email." }, 400);
    const code = newCode(), expires = iso(Date.now() + 7 * 86400000);
    const row = await env.DB.prepare("INSERT INTO transfer_requests (series, piece_id, from_owner, code_hash, expires_at) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id")
      .bind(piece.series, piece.piece_id, s.owner.id, await codeHash(env, code), expires).first();
    await audit(env, "owner:" + s.owner.id, "transfer.start", "transfer:" + row.id, null, { piece: piece.piece_id, invited: !!buyer }, piece.series);
    const ids = [await queueLetter(env, { template: "transferStarted", to: s.owner.email, series: piece.series, dedupe: `transfer:${row.id}:start`, vars: { site, n: piece.number, size: piece.size } })];
    if (buyer) ids.push(await queueLetter(env, { template: "transferInvite", to: buyer, series: piece.series, dedupe: `transfer:${row.id}:invite`, vars: { site, n: piece.number, size: piece.size, inviteUrl: `${site}/claim/transfer` } }));
    deps.kick(ids.filter(Boolean));
    return J({ ok: true, code, expiresAt: expires });
  }
  if (method === "POST" && path === "/o/transfer/cancel") {
    const s = await me(); if (!s) return J({ ok: false, reason: "signed-out" }, 401);
    const b = await readBody(request); if (!b) return J({ ok: false, reason: "too-big" }, 413);
    const piece = await heldBy(env, s.owner.id, b.piece);
    if (!piece) return J({ ok: false, reason: "piece" }, 404);
    const done = await env.DB.prepare("UPDATE transfer_requests SET status = 'cancelled', decided_at = ?1 WHERE piece_id = ?2 AND from_owner = ?3 AND status IN ('open','accepted') RETURNING id").bind(iso(), piece.piece_id, s.owner.id).first();
    if (done) await audit(env, "owner:" + s.owner.id, "transfer.cancel", "transfer:" + done.id, null, { piece: piece.piece_id }, piece.series);
    return J({ ok: !!done, reason: done ? undefined : "none" }, done ? 200 : 404);
  }

  /* The receiving side, for someone with a code and nothing else. */
  const open = async (code) => {
    if (normCode(code).length !== 10) return null;
    const t = await env.DB.prepare("SELECT t.*, p.number, p.colorway, p.photo_url, p.status AS piece_status, s.size, s.name AS series_name, s.warranty_months FROM transfer_requests t JOIN pieces p ON p.id = t.piece_id JOIN series s ON s.code = t.series WHERE t.code_hash = ?1").bind(await codeHash(env, code)).first();
    return t && t.status === "open" && Date.parse(t.expires_at) > Date.now() ? t : null;
  };
  if (method === "POST" && path === "/o/transfer/lookup") {
    const b = await readBody(request); if (!b) return J({ ok: false, reason: "too-big" }, 413);
    const t = await open(b.code);
    if (!t) return J({ ok: false, reason: "invalid", why: "That code is not valid, or it has expired or been used. Ask its owner for a new one." }, 404);
    const w = await warrantyOf(env, t.piece_id, t.warranty_months);
    const next = await env.DB.prepare("SELECT COALESCE(MAX(owner_no), 0) + 1 AS n FROM ownerships WHERE piece_id = ?1").bind(t.piece_id).first();
    return J({ ok: true, piece: { n: t.number, size: t.size, colorway: t.colorway, series: t.series_name, photo: t.photo_url || null }, ownerNo: next ? next.n : 2,
      warrantyEndMs: w ? w.endMs : null, warrantyEndDay: w ? w.endDay : null, expiresAt: t.expires_at, stolen: t.piece_status === "reported_stolen" });
  }
  if (method === "POST" && path === "/o/transfer/email-code") {
    const b = await readBody(request); if (!b) return J({ ok: false, reason: "too-big" }, 413);
    if (!(await open(b.code))) return J({ ok: false, reason: "invalid" }, 404);
    const e = normEmail(b.email);
    if (!validEmail(e)) return J({ ok: false, reason: "invalid-email" }, 400);
    const r = await issueCode(env, e);
    if (r.send) { const m = codeEmail(r.send.code, site); deps.kick0(deps.sendEmail(env, r.send.to, m.subject, m.text, m.html)); }
    return J({ ok: true });
  }
  if (method === "POST" && path === "/o/transfer/accept") {
    const b = await readBody(request); if (!b) return J({ ok: false, reason: "too-big" }, 413);
    const t = await open(b.code);
    if (!t) return J({ ok: false, reason: "invalid", why: "That code is not valid, or it has expired or been used." }, 404);
    if (t.piece_status === "reported_stolen") return J({ ok: false, reason: "stolen", why: "This piece is flagged as stolen, so it cannot be transferred." }, 409);
    if (b.accept !== true) return J({ ok: false, reason: "accept", why: `Tick the box to accept No. ${t.number < 10 ? "0" + t.number : t.number}.` }, 400);
    if (b.consent !== true) return J({ ok: false, reason: "consent", why: "Tick the box to agree to the data notice so we can keep your record." }, 400);
    const email = normEmail(b.email), name = clean1(b.name, 80), phone = normPhone(b.phone);
    if (!validEmail(email)) return J({ ok: false, reason: "email", why: "An email address. It is how you sign in." }, 400);
    if (!name) return J({ ok: false, reason: "name", why: "Your name, as it should be written in the registry." }, 400);
    if (!phone || phone.length < 11) return J({ ok: false, reason: "phone", why: "A phone number we can reach you on." }, 400);
    const seller = await env.DB.prepare("SELECT email FROM owners WHERE id = ?1").bind(t.from_owner).first();
    if (seller && normEmail(seller.email) === email) return J({ ok: false, reason: "email", why: "That is the email of the owner passing it on. Use your own." }, 400);
    const spent = await spendCode(env, email, b.emailCode);
    if (!spent.ok) return J({ ok: false, reason: "email-code", why: spent.reason === "wrong" ? "That code is not right. Check it and try again." : "Enter the six digits we sent to that address." }, 400);

    const at = iso(), city = clean1(b.city, 60), state = clean1(b.state, 40), showCity = b.showCity === true && !!city;
    await env.DB.prepare(
      `INSERT INTO owners (email, name, phone, city, state, show_city_publicly, data_consent_at, city_consent_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?7, ?7)
       ON CONFLICT (email) DO UPDATE SET name = COALESCE(owners.name, ?2), phone = COALESCE(owners.phone, ?3), city = COALESCE(owners.city, ?4), state = COALESCE(owners.state, ?5),
         data_consent_at = ?7, deleted_at = NULL, updated_at = ?7`
    ).bind(email, name, phone, city || null, state || null, showCity ? 1 : 0, at, showCity ? at : null).run();
    const owner = await env.DB.prepare("SELECT * FROM owners WHERE email = ?1").bind(email).first();
    const won = await env.DB.prepare("UPDATE transfer_requests SET status = 'accepted', to_owner = ?1 WHERE id = ?2 AND status = 'open' RETURNING id").bind(owner.id, t.id).first();
    if (!won) return J({ ok: false, reason: "invalid", why: "That code was just used." }, 409);
    await audit(env, "owner:" + owner.id, "transfer.accept", "transfer:" + t.id, { status: "open" }, { status: "accepted", piece: t.piece_id }, t.series);

    let completed = false;
    if ((await setting(env, "transfers_need_approval", "1")) === "0") {
      const r = await completeTransfer(env, deps, t.id, "system:transfer", "approval not required");
      completed = !!r.ok;
    }
    if (!completed) await staff("transfer", { series: t.series, number: t.number }, "A transfer has been accepted and is waiting for your approval.", "t" + t.id);
    const sess = await openSession(env, owner, request.headers.get("user-agent"), "owner");
    return J({ ok: true, token: sess.token, maxAge: sess.maxAge, completed, n: t.number });
  }

  /* ── An owner who cannot sign in: a request for us to verify them by hand ── */
  if (method === "POST" && path === "/o/recovery") {
    const b = await readBody(request); if (!b) return J({ ok: false, reason: "too-big" }, 413);
    const n = parseInt(b.number, 10), email = normEmail(b.email), text = longText(b.description, 1000);
    if (!(n >= 1 && n <= 99) || !validEmail(email)) return J({ ok: false, reason: "invalid", why: "Give the number of your piece and an email we can reach you on." }, 400);
    /* The same answer whether or not the piece is registered or already asked about. */
    const p = await env.DB.prepare("SELECT p.id, p.number, p.series, w.owner_id FROM pieces p JOIN ownerships w ON w.piece_id = p.id AND w.to_at IS NULL WHERE p.number = ?1 AND p.status = 'registered'").bind(n).first();
    if (p) {
      const dup = await env.DB.prepare("SELECT id FROM requests WHERE piece_id = ?1 AND type = 'recovery' AND status IN ('open','info_needed')").bind(p.id).first();
      if (!dup) {
        const row = await env.DB.prepare("INSERT INTO requests (series, piece_id, owner_id, type, description) VALUES (?1, ?2, ?3, 'recovery', ?4) RETURNING id")
          .bind(p.series, p.id, p.owner_id, `Contact: ${email}\n${text}`).first();
        await audit(env, "system:recovery", "request.new", "request:" + row.id, null, { type: "recovery", piece: p.id }, p.series);
        await staff("recovery", p, `Reach them at ${email}. ${text}`, row.id);
      }
    }
    return J({ ok: true });
  }
  return null;
}
