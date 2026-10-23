/* ══════════════════════════════════════════════════════════════════
   THE CONTROL ROOM (registry, Phase 2): /control, the admin's only.

   Served by the worker itself, beside its API, so the session cookie is
   first party, HttpOnly and SameSite=Strict (a page on thekaal.co calling
   a workers.dev API could not keep one: browsers block that cookie). The
   page is control-page.js; this file is who may do what.

   Every route under /control/api needs a session that is the admin's AND
   has given the authenticator's code. Every write also needs the X-KAAL
   header and a same-origin Origin, and is written to audit_log with its
   before and after. Nothing here trusts the browser for a number, a
   price, a state or a date it can check itself.

   The existing desk (/desk) keeps working beside this until the owner
   retires it.
   ══════════════════════════════════════════════════════════════════ */
import { authOn, adminEmail, startLogin, verifyLogin, sessionOf, endSession, revokeAll, sessionCookie, clearCookie, totpEnroll, totpCheck, twoFactorOn, codeEmail, normEmail } from "./auth.js";
import { LETTERS, STAGE_LETTER, STAFF_LETTERS, sample } from "./letters.js";
import { STAGES, ORDER_STATUSES, iso, istDay, pad2, clean, windowEnds, setting, seriesSize, moveOrder, queueDelivered } from "./orders.js";
import { queueLetter, flushOutbox, retryLetter } from "./outbox.js";
import { controlPage } from "./control-page.js";
import { lateOrders } from "./sla.js";
import { registryOn, normPhone, audit, SERIES } from "./registry.js";

const PIECE_STATUSES = ["available", "held", "placed", "delivered", "registered", "returned", "reported_stolen", "retired", "withheld"];
const PIECE_ID = /^S\d{2}-\d{2}$/;

function headers(extra) {
  return Object.assign({
    "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY"
  }, extra || {});
}
const out = (body, status, extra) => new Response(JSON.stringify(body), { status: status || 200, headers: headers(Object.assign({ "Content-Type": "application/json" }, extra || {})) });
function writeOk(request) {
  if (request.headers.get("X-KAAL") !== "1") return false;
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}
async function body(request) { try { return await request.json(); } catch (e) { return null; } }

/* What a visitor sees when the registry is not switched on here, said in
   the words of what is actually missing and the one button that fixes it.
   A browser gets a page, anything else gets the same facts as JSON. */
function offReply(request, env, path) {
  const mode = env.STAGING === "on" ? "staging" : "live";
  let why;
  if (String(env.REGISTRY || "on").toLowerCase() === "off") why = "The registry is switched off (REGISTRY is \"off\"). Set it back to \"on\" in wrangler.toml, then run setup-worker in mode " + mode + ".";
  else if (!(env.DB && typeof env.DB.prepare === "function")) why = "This worker has no registry database yet. Run the setup-worker workflow in mode " + mode + " (GitHub, Actions, setup-worker, Run workflow). Mode deploy does not create it.";
  else why = "The control room's sign-in key is not set (AUTH_SECRET). Run the setup-worker workflow in mode " + mode + ".";
  if (request.method === "GET" && path === "/control" && String(request.headers.get("Accept") || "").includes("text/html")) {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>KAAL control room</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f3ee;color:#1a1814;font:16px/1.55 system-ui,sans-serif}main{max-width:30rem;padding:2rem 1.25rem}h1{font:600 1.1rem system-ui;letter-spacing:.08em;text-transform:uppercase}p{margin:.8rem 0}</style></head><body><main><h1>The control room is not switched on</h1><p>The worker is running, but ${why.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p><p>Steps: docs/registry-live.md in the repository.</p></main></body></html>`;
    return new Response(html, { status: 503, headers: headers({ "Content-Type": "text/html; charset=utf-8" }) });
  }
  return out({ ok: false, reason: "off", why }, 503);
}

export async function control(request, env, ctx, path, T) {
  const method = request.method;
  if (!registryOn(env) || !authOn(env)) {
    if (path.startsWith("/photo/")) return new Response("Not found", { status: 404 });
    return offReply(request, env, path);
  }

  /* ── Public: a piece's own photograph ── */
  if (path.startsWith("/photo/") && method === "GET") {
    const id = path.slice(7);
    if (!PIECE_ID.test(id) || !env.KAAL_STATE) return new Response("Not found", { status: 404 });
    const got = await env.KAAL_STATE.getWithMetadata("photo:" + id, "arrayBuffer").catch(() => null);
    if (!got || !got.value) return new Response("Not found", { status: 404 });
    const type = (got.metadata && got.metadata.type) || "image/jpeg";
    return new Response(got.value, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'", "Access-Control-Allow-Origin": "*" } });
  }

  /* ── The page ── */
  if (path === "/control" && method === "GET") {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    return new Response(controlPage(nonce, { staging: env.STAGING === "on" }), { headers: headers({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
    }) });
  }

  /* ── Signing in ── */
  if (path.startsWith("/auth/")) return authRoute(request, env, ctx, path, T);

  /* ── Everything else is the admin's, after the second factor ── */
  const s = await sessionOf(env, request);
  if (!s) return out({ ok: false, reason: "signed-out" }, 401);
  if (!s.admin) return out({ ok: false, reason: "not-admin" }, 403);
  if (!s.mfa) return out({ ok: false, reason: "mfa" }, 401);
  const actor = "admin:" + s.owner.id;

  if (path === "/control/preview" && method === "GET") return preview(env, new URL(request.url), T);
  if (!path.startsWith("/control/api/")) return out({ ok: false, reason: "not-found" }, 404);
  const route = path.slice("/control/api".length);
  if (method === "POST" && !writeOk(request)) return out({ ok: false, reason: "refused" }, 403);

  try {
    if (method === "GET" && route === "/overview") return out(await overview(env, T));
    if (method === "GET" && route === "/orders") return out(await listOrders(env));
    if (method === "POST" && route === "/import") {
      const r = await T.importPaid(env);
      await audit(env, actor, "registry.import.asked", "registry", null, { ok: r.ok });
      return out(r, r.ok ? 200 : 502);
    }
    if (method === "POST" && route === "/orders/manual") return pastSale(env, actor, await body(request) || {});
    let m = /^\/orders\/(\d+)\/link$/.exec(route);
    if (method === "POST" && m) return claimLink(env, ctx, T, actor, +m[1], await body(request) || {});
    m = /^\/orders\/(\d+)\/(stage|returned|refund)$/.exec(route);
    if (method === "POST" && m) {
      const b = await body(request) || {};
      if (m[2] === "stage") return stage(env, ctx, T, actor, +m[1], b);
      if (m[2] === "returned") return markReturned(env, actor, +m[1], b);
      return refund(env, T, actor, +m[1], b);
    }
    if (method === "GET" && route === "/pieces") return out(await listPieces(env));
    m = /^\/pieces\/(S\d{2}-\d{2})(\/photo)?$/.exec(route);
    if (method === "POST" && m) return m[2] ? photo(request, env, T, actor, m[1]) : piece(env, T, actor, m[1], await body(request) || {});
    if (method === "GET" && route === "/owners") return out(await listOwners(env, new URL(request.url).searchParams.get("q") || ""));
    m = /^\/owners\/(\d+)(\/revoke)?$/.exec(route);
    if (method === "GET" && m && !m[2]) return out(await ownerDetail(env, +m[1]));
    if (method === "POST" && m) return m[2] ? revokeOwner(env, actor, +m[1]) : ownerUpdate(env, actor, +m[1], await body(request) || {});
    if (method === "GET" && route === "/approvals") return out(await approvals(env));
    if (method === "GET" && route === "/emails") return out(await emails(env));
    m = /^\/emails\/(\d+)\/retry$/.exec(route);
    if (method === "POST" && m) { const ok = await retryLetter(env, +m[1]); if (ok) kick(env, ctx, T, [+m[1]]); await audit(env, actor, "email.retry", "email:" + m[1], null, { ok }); return out({ ok }); }
    if (method === "POST" && route === "/emails/test") return testLetter(env, ctx, T, actor, await body(request) || {});
    if (method === "GET" && route === "/settings") return out(await settings(env));
    if (method === "POST" && route === "/settings") return saveSettings(env, actor, await body(request) || {});
    if (method === "POST" && route === "/blocked") return blocked(env, actor, await body(request) || {});
    if (method === "GET" && route === "/audit") return out(await auditList(env));
    m = /^\/export\/(orders|owners|pieces)\.csv$/.exec(route);
    if (method === "GET" && m) return exportCsv(env, m[1]);
    if (method === "GET" && route === "/backup") return backup(env, actor);
  } catch (e) {
    console.log("Control room error:", route, String(e).slice(0, 200));
    return out({ ok: false, reason: "error", why: "Something failed on our side. Nothing was changed; try again." }, 500);
  }
  return out({ ok: false, reason: "not-found" }, 404);
}

/* Sends queued letters now, after the response, so a tap is never slower
   than the database write. */
function kick(env, ctx, T, ids) {
  const job = flushOutbox(env, (to, subject, text, html) => T.sendEmail(env, to, subject, text, html), ids).catch(e => console.log("Outbox flush failed:", String(e).slice(0, 160)));
  if (ctx && ctx.waitUntil) ctx.waitUntil(job);
}

/* ══ Signing in ══ */
async function authRoute(request, env, ctx, path, T) {
  if (request.method !== "POST") return out({ ok: false, reason: "not-found" }, 404);
  if (!writeOk(request)) return out({ ok: false, reason: "refused" }, 403);
  const b = await body(request) || {};

  if (path === "/auth/start") {
    const r = await startLogin(env, b.email);
    if (r.send) {
      const m = codeEmail(r.send.code, T.siteUrl(env));
      const job = T.sendEmail(env, r.send.to, m.subject, m.text, m.html).catch(() => null);
      if (ctx && ctx.waitUntil) ctx.waitUntil(job);
    }
    if (r.reason === "invalid") return out({ ok: false, reason: "invalid" }, 400);
    /* The same answer whether or not the address is known. */
    return out({ ok: true });
  }
  if (path === "/auth/verify") {
    const r = await verifyLogin(env, b.email, b.code, request.headers.get("user-agent"));
    if (!r.ok) return out({ ok: false, reason: r.reason }, 401);
    if (r.owner.role === "admin") await audit(env, "admin:" + r.owner.id, "auth.code", "session", null, { mfa: r.mfa });
    return out({ ok: true, role: r.owner.role, mfa: r.mfa }, 200, { "Set-Cookie": sessionCookie(r.token, r.maxAge) });
  }
  const s = await sessionOf(env, request);
  if (path === "/auth/logout") {
    if (s) await endSession(env, s.sid);
    return out({ ok: true }, 200, { "Set-Cookie": clearCookie() });
  }
  /* Asking "who am I" while signed out is the page's first question, not an error. */
  if (!s) return out({ ok: false, reason: "signed-out" }, path === "/auth/me" ? 200 : 401);
  if (path === "/auth/totp/enroll") {
    const e = await totpEnroll(env, s);
    return e ? out({ ok: true, key: e.key, uri: e.uri }) : out({ ok: false, reason: "not-allowed" }, 403);
  }
  if (path === "/auth/totp") {
    const r = await totpCheck(env, s, b.code);
    await audit(env, "admin:" + s.owner.id, r.ok ? (r.enrolled ? "auth.totp.enrolled" : "auth.totp") : "auth.totp.failed", "session", null, { reason: r.reason || "" });
    if (!r.ok) return out({ ok: false, reason: r.reason }, 401, r.reason === "locked" ? { "Set-Cookie": clearCookie() } : {});
    return out({ ok: true });
  }
  if (path === "/auth/me") return out({ ok: true, email: s.owner.email, role: s.owner.role, mfa: s.mfa, enrolled: !!s.owner.totp_confirmed_at });
  return out({ ok: false, reason: "not-found" }, 404);
}

/* ══ Overview ══ */
async function overview(env, T) {
  const pieces = (await env.DB.prepare(
    "SELECT p.number, p.status, p.colorway, r.state FROM pieces p JOIN public_registry r ON r.series = p.series AND r.number = p.number WHERE p.series = ?1 ORDER BY p.number"
  ).bind(SERIES).all()).results || [];
  const counts = {};
  for (const r of (await env.DB.prepare("SELECT status, COUNT(*) AS c FROM orders GROUP BY status").all()).results || []) counts[r.status] = r.c;
  const rev = await env.DB.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS p FROM orders WHERE status NOT IN ('cancelled','returned')").first();
  const open = (await env.DB.prepare(
    "SELECT id, piece_id, delivered_on, return_window_ends_at FROM orders WHERE status = 'delivered' AND return_window_ends_at > ?1 ORDER BY return_window_ends_at"
  ).bind(iso()).all()).results || [];
  const approvals = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM requests WHERE status IN ('open','info_needed')) + (SELECT COUNT(*) FROM transfer_requests WHERE status = 'accepted') AS c").first();
  const mail = {};
  for (const r of (await env.DB.prepare("SELECT status, COUNT(*) AS c FROM email_outbox GROUP BY status").all()).results || []) mail[r.status] = r.c;
  const hook = env.KAAL_STATE ? await env.KAAL_STATE.get("seen:webhook").catch(() => null) : null;
  const imported = env.KAAL_STATE ? await env.KAAL_STATE.get("registry:imported", "json").catch(() => null) : null;
  /* What has sat too long: the brief's three promises. The same check
     emails the owner once each (worker/sla.js). */
  const late = await lateOrders(env);
  const courier = (await env.DB.prepare("SELECT awb, status, outcome, received_at FROM courier_events WHERE outcome IN ('unmatched','alert') ORDER BY id DESC LIMIT 5").all()).results || [];
  return {
    ok: true, staging: env.STAGING === "on", now: iso(), today: istDay(),
    pieces, sold: pieces.filter(p => p.state === "sold").length, size: pieces.length,
    revenue: rev ? rev.p : 0, stages: counts,
    returnWindows: open.map(o => ({ id: o.id, piece: o.piece_id, delivered: o.delivered_on, endsAt: o.return_window_ends_at,
      daysLeft: Math.max(0, Math.ceil((Date.parse(o.return_window_ends_at) - Date.now()) / 86400000)) })),
    approvals: approvals ? approvals.c : 0, emails: mail, imported,
    late: late.map(o => ({ id: o.id, piece: o.piece_id, status: o.status, why: o.why })), courier,
    health: [
      { label: "Database", ok: true, detail: "The registry answers." },
      { label: "Payment webhook", ok: !!hook, detail: hook ? "Last heard from Razorpay " + hook : "Not heard from yet on this worker." },
      { label: "Emails", ok: !mail.failed, detail: `${mail.sent || 0} sent, ${mail.queued || 0} waiting, ${mail.failed || 0} failed.` },
      twoFactorOn(env) ? { label: "Second factor", ok: true, detail: "Every action here needs the authenticator's code." } : { label: "Sign-in", ok: true, detail: "The emailed code is the only lock, so guard that mailbox with 2-step verification." }
    ]
  };
}

/* ══ Orders ══ */
async function listOrders(env) {
  const rows = (await env.DB.prepare(
    `SELECT o.id, o.piece_id, p.number, p.colorway, o.status, o.cancel_reason, o.buyer_name, o.email, o.phone, o.city, o.state, o.pincode,
            o.address_line1, o.address_line2, o.gift, o.gift_note, o.amount_paise, o.razorpay_payment_id, o.razorpay_order_id, o.paid_at,
            o.inspected_at, o.packed_at, o.dispatched_at, o.delivered_on, o.return_window_ends_at, o.registered_at,
            o.courier, o.tracking_number, o.tracking_url, o.refund_id
       FROM orders o JOIN pieces p ON p.id = o.piece_id ORDER BY o.id DESC LIMIT 200`
  ).all()).results || [];
  const sent = {};
  for (const r of (await env.DB.prepare("SELECT dedupe_key, status FROM email_outbox WHERE dedupe_key LIKE 'stage:%'").all()).results || []) sent[r.dedupe_key] = r.status;
  return { ok: true, today: istDay(), orders: rows.map(o => Object.assign(o, {
    next: o.status === "cancelled" || o.status === "returned" || o.status === "registered" ? null : STAGES[STAGES.indexOf(o.status) + 1] || null,
    letters: Object.fromEntries(STAGES.slice(1).map(st => [st, sent[`stage:${o.id}:${st}`] || ""])),
    returnOpen: o.status === "delivered" && o.return_window_ends_at && Date.parse(o.return_window_ends_at) > Date.now()
  })) };
}

/* A stage change. Forward, one step at a time, with its email; or, for a
   correction, any status with a reason and no email (silent). The 10
   second Undo lives in the page: nothing reaches here until it has run
   out. The work itself is worker/orders.js, shared with the courier. */
async function stage(env, ctx, T, actor, id, b) {
  const r = await moveOrder(env, { siteUrl: T.siteUrl, kick: (ids) => kick(env, ctx, T, ids) }, actor, id, b);
  return out(r.body, r.http);
}

/* "Resend registration link" mails the owner a fresh link and leaves the
   earlier ones working; "Regenerate" first revokes every unused one (for a
   link that went astray). Only for a delivered, unregistered piece. */
async function claimLink(env, ctx, T, actor, id, b) {
  const o = await env.DB.prepare("SELECT o.*, p.number FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE o.id = ?1").bind(id).first();
  if (!o) return out({ ok: false, reason: "unknown-order" }, 404);
  if (o.status !== "delivered") return out({ ok: false, reason: "state", why: o.status === "registered" ? "This piece is already registered." : "A registration link is for a delivered piece. Mark it delivered first." }, 409);
  if (!o.email) return out({ ok: false, reason: "email", why: "This order has no email address to send it to." }, 400);
  const regen = b.mode === "regenerate";
  if (regen) await env.DB.prepare("UPDATE claim_tokens SET revoked_at = ?1 WHERE order_id = ?2 AND used_at IS NULL AND revoked_at IS NULL").bind(iso(), id).run();
  const q = await queueDelivered(env, T.siteUrl(env), o, `link:${id}:${Date.now()}`);
  if (q) kick(env, ctx, T, [q]);
  await audit(env, actor, regen ? "order.link.regenerate" : "order.link.resend", "order:" + id, { status: o.status }, { to: o.email, queued: !!q }, o.series);
  return out({ ok: true, to: o.email });
}

/* A sale made before the registry (Nos. 01 and 02): typed in once, from
   the owner's own records, and kept like any other order, except that it
   can never be refunded from here (no payment of this checkout's exists).
   Only for a piece that has no order yet. No email is sent to anyone. */
async function pastSale(env, actor, b) {
  const n = parseInt(b.n, 10);
  const p = await env.DB.prepare("SELECT * FROM pieces WHERE series = ?1 AND number = ?2").bind(SERIES, n).first();
  if (!p) return out({ ok: false, reason: "piece", why: "No such number." }, 400);
  if (p.order_ref || ["available", "placed", "delivered"].indexOf(p.status) < 0) {
    return out({ ok: false, reason: "taken", why: `No. ${pad2(n)} already has an order, or is ${p.status}.` }, 409);
  }
  const name = clean(b.name, 80), email = normEmail(b.email), phone = normPhone(b.phone);
  const today = istDay(), paid = String(b.paid_on || ""), del = String(b.delivered_on || "");
  if (!name) return out({ ok: false, reason: "name", why: "The buyer's name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return out({ ok: false, reason: "email", why: "The buyer's email: it becomes how they sign in to the registry." }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paid) || paid > today) return out({ ok: false, reason: "paid", why: "The day it was paid, not in the future." }, 400);
  if (del && (!/^\d{4}-\d{2}-\d{2}$/.test(del) || del > today || del < paid)) return out({ ok: false, reason: "delivered", why: "The delivery day: after it was paid, not in the future." }, 400);
  const series = await env.DB.prepare("SELECT price_paise, return_days FROM series WHERE code = ?1").bind(p.series).first();
  const amount = Math.round(parseFloat(b.amount_rupees || "0") * 100) || (series && series.price_paise) || 0;
  const status = del ? "delivered" : "placed";
  const row = await env.DB.prepare(
    `INSERT INTO orders (series, piece_id, razorpay_payment_id, buyer_name, email, phone, address_line1, city, state, pincode, amount_paise, status, paid_at,
       delivered_on, return_window_ends_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16) RETURNING id`
  ).bind(p.series, p.id, "manual:" + crypto.randomUUID(), name, email, phone || null, clean(b.line1, 120) || null, clean(b.city, 60) || null, clean(b.state, 40) || null,
    String(b.pin || "").replace(/\D/g, "").slice(0, 6) || null, amount, status, iso(Date.parse(paid + "T12:00:00.000+05:30")),
    del || null, del ? windowEnds(del, (series && series.return_days) || 7) : null, iso()).first();
  const placed = await env.DB.prepare("UPDATE pieces SET status = ?1, order_ref = ?2, held_by = NULL, held_until = NULL, updated_at = ?3 WHERE id = ?4 AND order_ref IS NULL RETURNING id")
    .bind(del ? "delivered" : "placed", row.id, iso(), p.id).first();
  if (!placed) {
    await env.DB.prepare("DELETE FROM orders WHERE id = ?1").bind(row.id).run();
    return out({ ok: false, reason: "taken", why: `No. ${pad2(n)} was given an order a moment ago.` }, 409);
  }
  await audit(env, actor, "order.past_sale", "order:" + row.id, { piece: p.status }, { piece: p.id, status, paid_on: paid, delivered_on: del || null, email }, p.series);
  return out({ ok: true, id: row.id });
}

/* Returned: only while the return window is open and the piece is not
   registered. The buyer joins blocked_buyers (the shop's rule: never sold
   to again). The refund itself is the separate, confirmed Refund. */
async function markReturned(env, actor, id, b) {
  const o = await env.DB.prepare("SELECT o.*, p.number, p.status AS piece_status FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE o.id = ?1").bind(id).first();
  if (!o) return out({ ok: false, reason: "unknown-order" }, 404);
  if (o.status !== "delivered" || o.piece_status === "registered" || !o.return_window_ends_at || Date.parse(o.return_window_ends_at) <= Date.now()) {
    return out({ ok: false, reason: "window", why: "A return can be marked only while the seven days are open and the piece is not registered." }, 409);
  }
  await env.DB.prepare("UPDATE orders SET status = 'returned', updated_at = ?1 WHERE id = ?2").bind(iso(), id).run();
  await env.DB.prepare("UPDATE pieces SET status = 'returned', updated_at = ?1 WHERE id = ?2").bind(iso(), o.piece_id).run();
  if (o.email || o.phone) {
    await env.DB.prepare("INSERT INTO blocked_buyers (email, phone, reason) VALUES (?1, ?2, ?3)")
      .bind(o.email || null, normPhone(o.phone) || null, `Returned No. ${pad2(o.number)} (order ${o.id})`).run();
  }
  await audit(env, actor, "order.returned", "order:" + id, { status: o.status }, { status: "returned", blocked: true, reason: clean(b.reason, 200) }, o.series);
  return out({ ok: true });
}

/* Refund, in full, through Razorpay. Asked to type the number, because it
   moves money and cannot be undone. The order is cancelled (if it was not
   yet returned); the piece is left 'returned', not put back on sale: that
   is a separate decision on the Pieces screen. */
async function refund(env, T, actor, id, b) {
  const o = await env.DB.prepare("SELECT o.*, p.number FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE o.id = ?1").bind(id).first();
  if (!o) return out({ ok: false, reason: "unknown-order" }, 404);
  if (String(b.confirm || "").replace(/\D/g, "") !== pad2(o.number) && String(b.confirm || "").replace(/\D/g, "") !== String(o.number)) {
    return out({ ok: false, reason: "confirm", why: `Type ${pad2(o.number)} to confirm the refund.` }, 400);
  }
  if (o.refund_id) return out({ ok: false, reason: "done", why: "Already refunded: " + o.refund_id }, 409);
  if (/^manual:/.test(o.razorpay_payment_id)) return out({ ok: false, reason: "manual", why: "This sale was recorded by hand, not paid through this checkout. Refund it the way it was paid." }, 409);
  const claim = await env.DB.prepare("UPDATE orders SET refund_requested_at = ?1 WHERE id = ?2 AND refund_requested_at IS NULL AND refund_id IS NULL RETURNING id").bind(iso(), id).first();
  if (!claim) return out({ ok: false, reason: "busy", why: "A refund for this order is already being asked for." }, 409);
  const r = await T.refundPayment(env, o.razorpay_payment_id, o.amount_paise, b.reason === "return" ? "return" : "cancel", o.number, "kaal-");
  if (!r.id) {
    await env.DB.prepare("UPDATE orders SET refund_requested_at = NULL WHERE id = ?1").bind(id).run();
    await audit(env, actor, "order.refund.failed", "order:" + id, null, { error: r.error }, o.series);
    return out({ ok: false, reason: "razorpay", why: "Razorpay did not refund it: " + r.error }, 502);
  }
  const status = o.status === "returned" ? "returned" : "cancelled";
  await env.DB.prepare("UPDATE orders SET refund_id = ?1, refunded_at = ?2, status = ?3, cancel_reason = COALESCE(cancel_reason, ?4), updated_at = ?2 WHERE id = ?5")
    .bind(r.id, iso(), status, status === "cancelled" ? "refund" : null, id).run();
  await env.DB.prepare("UPDATE pieces SET status = 'returned', updated_at = ?1 WHERE id = ?2 AND status NOT IN ('registered')").bind(iso(), o.piece_id).run();
  await audit(env, actor, "order.refunded", "order:" + id, { status: o.status }, { status, refund: r.id }, o.series);
  return out({ ok: true, refund: r.id });
}

/* ══ Pieces ══ */
async function listPieces(env) {
  const rows = (await env.DB.prepare(
    `SELECT p.id, p.series, p.number, p.colorway, p.status, p.photo_url, p.notes, p.held_until, r.state, r.owner_no, r.owner_since,
            (SELECT COUNT(*) FROM orders o WHERE o.piece_id = p.id) AS orders
       FROM pieces p JOIN public_registry r ON r.series = p.series AND r.number = p.number ORDER BY p.series, p.number`
  ).all()).results || [];
  return { ok: true, pieces: rows, statuses: PIECE_STATUSES };
}
async function piece(env, T, actor, id, b) {
  const p = await env.DB.prepare("SELECT * FROM pieces WHERE id = ?1").bind(id).first();
  if (!p) return out({ ok: false, reason: "unknown-piece" }, 404);
  const set = {};
  if (b.status !== undefined && b.status !== p.status) {
    if (PIECE_STATUSES.indexOf(b.status) < 0 || b.status === "held") return out({ ok: false, reason: "bad-status" }, 400);
    if (clean(b.reason, 200).length < 3) return out({ ok: false, reason: "reason", why: "A status override needs a reason, in a few words." }, 400);
    set.status = b.status;
    if (b.status === "available") { set.held_by = null; set.held_until = null; set.order_ref = null; }
  }
  if (b.colorway !== undefined) { const c = clean(b.colorway, 30); if (!c) return out({ ok: false, reason: "colorway" }, 400); set.colorway = c; }
  if (b.notes !== undefined) set.notes = clean(b.notes, 2000) || null;
  const cols = Object.keys(set);
  if (!cols.length) return out({ ok: true, unchanged: true });
  set.updated_at = iso(); cols.push("updated_at");
  await env.DB.prepare(`UPDATE pieces SET ${cols.map((c, i) => `${c} = ?${i + 1}`).join(", ")} WHERE id = ?${cols.length + 1}`).bind(...cols.map(c => set[c]), id).run();
  /* Back on sale means off the live site's sold list too (staging skips it). */
  if (set.status === "available") await T.releaseSold(env, p.number, "control room: " + clean(b.reason, 80));
  await audit(env, actor, "piece.update", "piece:" + id, { status: p.status, colorway: p.colorway, notes: p.notes ? "(set)" : null },
    { status: set.status, colorway: set.colorway, notes: b.notes !== undefined ? "(changed)" : undefined, reason: clean(b.reason, 200) || undefined }, p.series);
  return out({ ok: true });
}
/* A photograph of that exact watch: JPEG, PNG or WebP, up to 3 MB, kept in
   KV (no card on file needed, unlike R2) and served at /photo/S01-07. */
async function photo(request, env, T, actor, id) {
  const p = await env.DB.prepare("SELECT id, series FROM pieces WHERE id = ?1").bind(id).first();
  if (!p || !env.KAAL_STATE) return out({ ok: false, reason: "unknown-piece" }, 404);
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim();
  if (["image/jpeg", "image/png", "image/webp"].indexOf(type) < 0) return out({ ok: false, reason: "type", why: "A JPEG, PNG or WebP, please." }, 415);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 3 * 1024 * 1024) return out({ ok: false, reason: "size", why: "Up to 3 MB. Export it smaller from Photos and try again." }, 413);
  /* The bytes have to be what they say they are. */
  const h = new Uint8Array(buf.slice(0, 12));
  const real = (type === "image/jpeg" && h[0] === 0xff && h[1] === 0xd8) || (type === "image/png" && h[0] === 0x89 && h[1] === 0x50) ||
    (type === "image/webp" && h[0] === 0x52 && h[1] === 0x49 && h[8] === 0x57 && h[9] === 0x45);
  if (!real) return out({ ok: false, reason: "type", why: "That file is not the image it says it is." }, 415);
  await env.KAAL_STATE.put("photo:" + id, buf, { metadata: { type } });
  const url = `${T.workerUrl(env)}/photo/${id}?v=${Date.now().toString(36)}`;
  await env.DB.prepare("UPDATE pieces SET photo_url = ?1, updated_at = ?2 WHERE id = ?3").bind(url, iso(), id).run();
  await audit(env, actor, "piece.photo", "piece:" + id, null, { bytes: buf.byteLength, type }, p.series);
  return out({ ok: true, url });
}

/* ══ Owners ══ */
async function listOwners(env, q) {
  const like = "%" + clean(q, 60).toLowerCase() + "%";
  const rows = (await env.DB.prepare(
    `SELECT w.id, w.email, w.name, w.phone, w.city, w.state, w.role, w.show_city_publicly, w.created_at,
            (SELECT GROUP_CONCAT(o.piece_id) FROM ownerships o WHERE o.owner_id = w.id AND o.to_at IS NULL) AS pieces
       FROM owners w WHERE w.deleted_at IS NULL AND (?1 = '%%' OR lower(w.email) LIKE ?1 OR lower(COALESCE(w.name,'')) LIKE ?1 OR COALESCE(w.phone,'') LIKE ?1)
      ORDER BY w.id DESC LIMIT 100`
  ).bind(like).all()).results || [];
  return { ok: true, owners: rows };
}
async function ownerDetail(env, id) {
  const w = await env.DB.prepare("SELECT id, email, name, phone, city, state, role, show_city_publicly, created_at, data_consent_at, city_consent_at FROM owners WHERE id = ?1").bind(id).first();
  if (!w) return { ok: false, reason: "unknown-owner" };
  const chain = (await env.DB.prepare(
    `SELECT o.piece_id, o.owner_no, o.from_at, o.to_at, o.acquired_via, w2.id AS owner_id, w2.email
       FROM ownerships o JOIN owners w2 ON w2.id = o.owner_id
      WHERE o.piece_id IN (SELECT piece_id FROM ownerships WHERE owner_id = ?1) ORDER BY o.piece_id, o.owner_no`
  ).bind(id).all()).results || [];
  const sessions = await env.DB.prepare("SELECT COUNT(*) AS c FROM sessions WHERE owner_id = ?1 AND revoked_at IS NULL AND expires_at > ?2").bind(id, iso()).first();
  return { ok: true, owner: w, chain, sessions: sessions ? sessions.c : 0 };
}
async function ownerUpdate(env, actor, id, b) {
  const w = await env.DB.prepare("SELECT * FROM owners WHERE id = ?1 AND deleted_at IS NULL").bind(id).first();
  if (!w) return out({ ok: false, reason: "unknown-owner" }, 404);
  const set = {};
  if (b.name !== undefined) set.name = clean(b.name, 80) || null;
  if (b.phone !== undefined) set.phone = normPhone(b.phone) || null;
  if (b.city !== undefined) set.city = clean(b.city, 60) || null;
  if (b.state !== undefined) set.state = clean(b.state, 40) || null;
  if (b.email !== undefined) {
    const e = normEmail(b.email);
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) return out({ ok: false, reason: "email" }, 400);
    if (e !== w.email && await env.DB.prepare("SELECT 1 AS x FROM owners WHERE email = ?1").bind(e).first()) return out({ ok: false, reason: "taken", why: "Another owner already signs in with that email." }, 409);
    set.email = e;
  }
  const cols = Object.keys(set);
  if (!cols.length) return out({ ok: true, unchanged: true });
  set.updated_at = iso(); cols.push("updated_at");
  await env.DB.prepare(`UPDATE owners SET ${cols.map((c, i) => `${c} = ?${i + 1}`).join(", ")} WHERE id = ?${cols.length + 1}`).bind(...cols.map(c => set[c]), id).run();
  /* A new sign-in address signs every device out. */
  if (set.email) await revokeAll(env, id);
  const pick = (o) => Object.fromEntries(cols.filter(c => c !== "updated_at").map(c => [c, o[c]]));
  await audit(env, actor, "owner.update", "owner:" + id, pick(w), pick(set));
  return out({ ok: true });
}
async function revokeOwner(env, actor, id) {
  const n = await revokeAll(env, id);
  await audit(env, actor, "owner.revoke", "owner:" + id, null, { sessions: n });
  return out({ ok: true, revoked: n });
}

/* ══ Approvals (decisions arrive with Phase 6's flows) ══ */
async function approvals(env) {
  const reqs = (await env.DB.prepare("SELECT id, type, piece_id, owner_id, status, created_at, substr(COALESCE(description,''), 1, 200) AS description FROM requests WHERE status IN ('open','info_needed') ORDER BY id").all()).results || [];
  const transfers = (await env.DB.prepare("SELECT id, piece_id, from_owner, to_owner, status, created_at FROM transfer_requests WHERE status IN ('open','accepted') ORDER BY id").all()).results || [];
  return { ok: true, requests: reqs, transfers };
}

/* ══ Emails ══ */
async function emails(env) {
  const rows = (await env.DB.prepare("SELECT id, template, to_email, subject, status, attempts, last_error, created_at, sent_at, next_attempt_at FROM email_outbox ORDER BY id DESC LIMIT 100").all()).results || [];
  return { ok: true, emails: rows, templates: Object.keys(LETTERS) };
}
async function testLetter(env, ctx, T, actor, b) {
  const t = String(b.template || "");
  if (!LETTERS[t]) return out({ ok: false, reason: "template" }, 400);
  const vars = { site: T.siteUrl(env), n: 7, size: 20, courier: "Delhivery", tracking: "SAMPLE123456", trackingUrl: "https://www.delhivery.com/track/package/SAMPLE123456",
    claimUrl: `${T.siteUrl(env)}/claim?t=sample`, ownerNo: 1, registeredOn: "26 October 2026", warrantyEnd: "23:59 on 24 October 2028", trackUrl: "" };
  const id = await queueLetter(env, { template: t, to: adminEmail(env), vars, dedupe: null });
  kick(env, ctx, T, [id]);
  await audit(env, actor, "email.test", "template:" + t, null, { to: adminEmail(env) });
  return out({ ok: true, to: adminEmail(env) });
}
/* The email a stage would send, rendered, for the Preview button: from a
   real order when one is named, else from sample data. */
async function preview(env, url, T) {
  const t = url.searchParams.get("t") || "";
  if (!LETTERS[t]) return new Response("No such letter.", { status: 404, headers: headers() });
  let m = sample(t, T.siteUrl(env));
  const oid = parseInt(url.searchParams.get("o") || "", 10);
  if (oid) {
    const o = await env.DB.prepare("SELECT o.*, p.number FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE o.id = ?1").bind(oid).first();
    if (o) m = LETTERS[t]({ site: T.siteUrl(env), n: o.number, size: await seriesSize(env, o.series), courier: url.searchParams.get("courier") || o.courier || "the courier",
      tracking: url.searchParams.get("tracking") || o.tracking_number || "(tracking number)", trackingUrl: url.searchParams.get("url") || o.tracking_url || "",
      claimUrl: `${T.siteUrl(env)}/claim?t=(sent-with-the-email)`, ownerNo: 1, trackUrl: "" });
  }
  const page = url.searchParams.get("format") === "text" ? `<pre style="white-space:pre-wrap;font:14px/1.6 ui-monospace,Menlo,monospace;padding:16px">${m.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>` : m.html;
  return new Response(page, { headers: headers({ "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; frame-ancestors 'self'" }) });
}

/* ══ Settings ══ */
async function settings(env) {
  const rows = (await env.DB.prepare("SELECT key, value FROM settings").all()).results || [];
  const series = (await env.DB.prepare("SELECT code, name, size, price_paise, warranty_months, return_days, manufactured, retired_at FROM series").all()).results || [];
  const blocked = (await env.DB.prepare("SELECT id, email, phone, reason, created_at FROM blocked_buyers ORDER BY id DESC").all()).results || [];
  return { ok: true, settings: Object.fromEntries(rows.map(r => [r.key, r.value])), series, blocked, sender: "connect@thekaal.co", admin: adminEmail(env) };
}
const SETTING_KEYS = { transfers_need_approval: /^[01]$/, stage_emails: /^[01]$/, sender_name: /^.{1,40}$/, warranty_terms: /^[\s\S]{0,4000}$/, guide_video_url: /^(https:\/\/[^\s"'<>]{4,300})?$/ };
async function saveSettings(env, actor, b) {
  const changed = {};
  for (const k of Object.keys(b.settings || {})) {
    const v = String(b.settings[k]);
    if (!SETTING_KEYS[k] || !SETTING_KEYS[k].test(v)) return out({ ok: false, reason: "bad-setting", key: k }, 400);
    const before = await setting(env, k, null);
    if (before === v) continue;
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = ?3").bind(k, v, iso()).run();
    changed[k] = { before, after: k === "warranty_terms" ? "(text)" : v };
  }
  if (b.series && b.series.code) {
    const s = await env.DB.prepare("SELECT * FROM series WHERE code = ?1").bind(String(b.series.code)).first();
    if (!s) return out({ ok: false, reason: "unknown-series" }, 404);
    const rd = parseInt(b.series.return_days, 10), wm = parseInt(b.series.warranty_months, 10);
    if (!(rd >= 7 && rd <= 30) || !(wm >= 12 && wm <= 60)) return out({ ok: false, reason: "bad-series", why: "Return days 7 to 30 (the law's minimum is honoured), warranty 12 to 60 months." }, 400);
    if (rd !== s.return_days || wm !== s.warranty_months) {
      await env.DB.prepare("UPDATE series SET return_days = ?1, warranty_months = ?2 WHERE code = ?3").bind(rd, wm, s.code).run();
      changed["series:" + s.code] = { before: { return_days: s.return_days, warranty_months: s.warranty_months }, after: { return_days: rd, warranty_months: wm } };
    }
  }
  if (Object.keys(changed).length) await audit(env, actor, "settings.update", "settings", null, changed);
  return out({ ok: true, changed: Object.keys(changed) });
}
async function blocked(env, actor, b) {
  if (b.remove) {
    const r = await env.DB.prepare("DELETE FROM blocked_buyers WHERE id = ?1 RETURNING email, phone, reason").bind(parseInt(b.remove, 10)).first();
    if (r) await audit(env, actor, "blocked.remove", "blocked:" + b.remove, r, null);
    return out({ ok: !!r });
  }
  const email = normEmail(b.email) || null, phone = normPhone(b.phone) || null, reason = clean(b.reason, 200);
  if (!email && !phone) return out({ ok: false, reason: "empty", why: "An email or a phone number." }, 400);
  if (reason.length < 3) return out({ ok: false, reason: "reason", why: "Say why, in a few words." }, 400);
  const r = await env.DB.prepare("INSERT INTO blocked_buyers (email, phone, reason) VALUES (?1, ?2, ?3) RETURNING id").bind(email, phone, reason).first();
  await audit(env, actor, "blocked.add", "blocked:" + r.id, null, { email, phone, reason });
  return out({ ok: true, id: r.id });
}

/* ══ Audit, export, backup ══ */
async function auditList(env) {
  const rows = (await env.DB.prepare("SELECT id, at, actor, action, target, before, after FROM audit_log ORDER BY id DESC LIMIT 300").all()).results || [];
  return { ok: true, audit: rows };
}
function csvCell(v) {
  let s = String(v == null ? "" : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function exportCsv(env, what) {
  const sql = {
    orders: "SELECT id, series, piece_id, status, cancel_reason, buyer_name, email, phone, address_line1, address_line2, city, state, pincode, gift, gift_note, amount_paise, razorpay_order_id, razorpay_payment_id, paid_at, inspected_at, packed_at, dispatched_at, courier, tracking_number, tracking_url, delivered_on, return_window_ends_at, registered_at, refund_id, refunded_at FROM orders ORDER BY id",
    owners: "SELECT id, email, name, phone, city, state, show_city_publicly, role, data_consent_at, city_consent_at, created_at FROM owners WHERE deleted_at IS NULL ORDER BY id",
    pieces: "SELECT p.id, p.series, p.number, p.colorway, p.status, p.photo_url, p.notes, r.state, r.owner_no, r.owner_since FROM pieces p JOIN public_registry r ON r.series = p.series AND r.number = p.number ORDER BY p.series, p.number"
  }[what];
  const rows = (await env.DB.prepare(sql).all()).results || [];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const text = "﻿" + [cols, ...rows.map(r => cols.map(c => r[c]))].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new Response(text, { headers: headers({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="kaal-${what}-${istDay()}.csv"` }) });
}
/* Everything the registry holds, as one JSON file, except what must
   never leave it: sign-in codes, sessions and the authenticator secret. */
async function backup(env, actor) {
  const tables = ["series", "pieces", "orders", "owners", "ownerships", "claim_tokens", "transfer_requests", "requests", "service_log", "email_outbox", "audit_log", "blocked_buyers", "settings"];
  const dump = { made_at: iso(), tables: {} };
  for (const t of tables) {
    let rows = (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results || [];
    if (t === "owners") rows = rows.map(r => Object.assign({}, r, { totp_secret_enc: r.totp_secret_enc ? "(withheld)" : null }));
    dump.tables[t] = rows;
  }
  await audit(env, actor, "backup.download", "registry", null, { tables: tables.length });
  return new Response(JSON.stringify(dump, null, 1), { headers: headers({ "Content-Type": "application/json", "Content-Disposition": `attachment; filename="kaal-registry-${istDay()}.json"` }) });
}
