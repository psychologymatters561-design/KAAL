/* ══════════════════════════════════════════════════════════════════
   THE OWNERS' API (registry, Phase 4): /o/*.

   What thekaal.co/claim and thekaal.co/owners talk to. Those pages live
   on GitHub Pages, so this is a cross-origin API: it answers only the
   shop's own origins (ALLOW_ORIGIN), every write needs the X-KAAL header
   (so a form on another site cannot post here) and a signed-in owner's
   session is a bearer token the page keeps, not a cookie a browser could
   refuse to send from another site. Admins sign in at /control, never here.

   Sign-in is the same emailed code as the control room's. An owner exists
   only once they have registered, so asking for a code with any other
   address sends nothing, and the answer is the same either way.

   The registration link (/claim?t=) is a random token, only its hash is
   stored, single use, thirty days. Registering is the owner's acceptance
   of the piece: it writes them into the registry as Owner I (or the next
   number), closes the return window, and opens the dashboard. It is one
   batch, so it happens whole or not at all.

   Never in an answer to anyone but the owner themselves: another owner's
   name, email, phone, address or city.
   ══════════════════════════════════════════════════════════════════ */
import { registryOn, audit, normPhone, SERIES } from "./registry.js";
import { startLogin, verifyLogin, issueCode, spendCode, openSession, sessionOf, endSession, codeEmail, adminEmail, normEmail, validEmail, sha256, authOn } from "./auth.js";
import { queueLetter } from "./outbox.js";
import { iso, istDay, pad2, clean, seriesSize, setting, warrantyWindow, longDay, nextOwnerNo, queueDelivered, mintClaim } from "./orders.js";
import { houseClaim } from "./house.js";
import { ownerActions } from "./owner-actions.js";
import { notifyOwner } from "./push.js";
import { maskName } from "./registry-public.js";

const CLAIM_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_BODY = 20 * 1024;

const allowed = (request, env) => (env.ALLOW_ORIGIN || "https://thekaal.co,https://www.thekaal.co").split(",").map(s => s.trim()).indexOf(request.headers.get("Origin") || "") > -1;

/* A write is welcome from the shop's own pages only, and only with the header
   a plain cross-site form cannot add. */
const writeOk = (request, env) => request.headers.get("X-KAAL") === "1" && allowed(request, env);

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { const j = JSON.parse(text); return j && typeof j === "object" ? j : {}; } catch (e) { return {}; }
}

/* The state of a registration link, and the order and piece behind it. */
async function claimOf(env, t) {
  if (!CLAIM_TOKEN.test(String(t || ""))) return { state: "unknown" };
  const hash = await sha256(String(t));
  const row = await env.DB.prepare("SELECT * FROM claim_tokens WHERE token_hash = ?1").bind(hash).first();
  if (!row) return { state: "unknown" };
  const order = await env.DB.prepare("SELECT o.*, p.number, p.colorway, p.photo_url, p.status AS piece_status FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE o.id = ?1").bind(row.order_id).first();
  const state = row.used_at ? "used" : row.revoked_at ? "revoked" : Date.parse(row.expires_at) <= Date.now() ? "expired" : order && order.status === "registered" ? "used" : "ok";
  return { state, token: row, order, hash };
}

const seriesOf = (env, code) => env.DB.prepare("SELECT * FROM series WHERE code = ?1").bind(code).first();

/* Pieces delivered to this address and not registered yet, oldest first. */
async function deliveredFor(env, e) {
  return ((await env.DB.prepare("SELECT o.*, p.number FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE o.email = ?1 AND o.status = 'delivered' ORDER BY o.id").bind(e).all()).results) || [];
}

export async function ownersRoute(request, env, ctx, path, deps) {
  const J = (body, status, extra) => deps.json(request, env, body, Object.assign({ "Cache-Control": "no-store" }, extra || {}), status);
  if (!registryOn(env) || !authOn(env)) return J({ ok: false, reason: "off" }, 503);
  const method = request.method;
  const url = new URL(request.url);
  if (method === "POST" && !writeOk(request, env)) return J({ ok: false, reason: "refused" }, 403);
  try {
    /* ── Signing in ── */
    if (method === "POST" && path === "/o/auth/start") {
      const b = await readBody(request); if (!b) return J({ ok: false, reason: "too-big" }, 413);
      const e = normEmail(b.email);
      if (!validEmail(e)) return J({ ok: false, reason: "invalid" }, 400);
      /* The house's own piece, held for the owner's own address (house.js):
         made ready for it here, then the usual path below. */
      await houseClaim(env, e);
      /* A buyer whose piece has arrived but is not registered yet gets the
         same six-digit code: entering it opens the piece's registration
         (verify, below), exactly as the link in their letter does. Before
         delivery, nothing. The answer on the screen is the same either way. */
      const holds = await env.DB.prepare("SELECT 1 AS x FROM ownerships s JOIN owners w ON w.id = s.owner_id WHERE w.email = ?1 AND w.deleted_at IS NULL AND s.to_at IS NULL LIMIT 1").bind(e).first();
      if (!holds && e !== adminEmail(env)) {
        const waiting = await deliveredFor(env, e);
        if (waiting.length) {
          const r = await issueCode(env, e);
          if (r.send) {
            const m = codeEmail(r.send.code, deps.siteUrl(env), waiting[0].number);
            deps.kick0(deps.sendEmail(env, r.send.to, m.subject, m.text, m.html));
          }
          return J({ ok: true });
        }
      }
      const r = await startLogin(env, e);
      if (r.send) {
        const m = codeEmail(r.send.code, deps.siteUrl(env));
        deps.kick0(deps.sendEmail(env, r.send.to, m.subject, m.text, m.html));
      }
      return J({ ok: true });                                                         /* even when the quarter hour's three codes are used: that would say the address is known */
    }
    if (method === "POST" && path === "/o/auth/verify") {
      const b = await readBody(request); if (!b) return J({ ok: false, reason: "too-big" }, 413);
      const e = normEmail(b.email);
      /* Not registered yet, with a piece delivered to this address: the code
         is spent and the answer is that piece's registration page. */
      const holds = await env.DB.prepare("SELECT 1 AS x FROM ownerships s JOIN owners w ON w.id = s.owner_id WHERE w.email = ?1 AND w.deleted_at IS NULL AND s.to_at IS NULL LIMIT 1").bind(e).first();
      if (!holds && e !== adminEmail(env)) {
        const waiting = await deliveredFor(env, e);
        if (waiting.length) {
          const spent = await spendCode(env, e, b.code);
          if (!spent.ok) return J({ ok: false, reason: spent.reason }, 401);
          const t = await mintClaim(env, waiting[0]);
          return J({ ok: true, register: `/claim?t=${t}`, n: waiting[0].number });
        }
      }
      /* Whoever holds the shop's own address may also hold a piece; the token this gives opens the owners' pages and nothing else. */
      const r = await verifyLogin(env, e, b.code, request.headers.get("user-agent"), "owner");
      if (!r.ok) return J({ ok: false, reason: r.reason }, 401);
      return J({ ok: true, token: r.token, maxAge: r.maxAge });
    }
    if (method === "POST" && path === "/o/auth/logout") {
      const s = await sessionOf(env, request, { bearer: true });
      if (s) await endSession(env, s.sid);
      return J({ ok: true });
    }

    /* ── The registration link ── */
    if (method === "GET" && path === "/o/claim/info") return claimInfo(env, J, url.searchParams.get("t"));
    if (method === "POST" && path === "/o/claim/request-link") return requestLink(env, deps, J, await readBody(request) || {});
    if (method === "POST" && path === "/o/claim/email-code") return emailCode(env, deps, J, await readBody(request) || {});
    if (method === "POST" && path === "/o/claim/register") return register(env, deps, J, request, await readBody(request) || {});

    /* ── Claims, uploads, transfers, recovery ── */
    if (path === "/o/requests" || path === "/o/upload" || path === "/o/recovery" || path.startsWith("/o/transfer/")) {
      const r = await ownerActions(request, env, ctx, path, deps, J, readBody);
      if (r) return r;
    }

    /* ── The owner's own dossier ── */
    if (path === "/o/me" || path.startsWith("/o/me/")) {
      const s = await sessionOf(env, request, { bearer: true });
      if (!s) return J({ ok: false, reason: "signed-out" }, 401);
      if (method === "GET" && path === "/o/me") return J(await dossier(env, s.owner));
      /* How they appear on the shop: their city, their masked initials. Each a yes they can take back. */
      if (method === "POST" && path === "/o/me/privacy") {
        const b = await readBody(request) || {}, at = iso();
        const showCity = b.showCity === true && !!s.owner.city, showName = b.showName === true && !!maskName(s.owner.name);
        await env.DB.prepare(`UPDATE owners SET show_city_publicly = ?1, city_consent_at = CASE WHEN ?1 = 1 THEN ?3 ELSE NULL END,
            show_name_publicly = ?2, name_consent_at = CASE WHEN ?2 = 1 THEN ?3 ELSE NULL END, updated_at = ?3 WHERE id = ?4`).bind(showCity ? 1 : 0, showName ? 1 : 0, at, s.owner.id).run();
        await audit(env, "owner:" + s.owner.id, "owner.privacy", "owner:" + s.owner.id, { city: !!s.owner.show_city_publicly, initials: !!s.owner.show_name_publicly }, { city: showCity, initials: showName }, null);
        return J({ ok: true, showCity, showName });
      }
    }
  } catch (e) {
    console.log("Owners API error:", path, String(e).slice(0, 200));
    return J({ ok: false, reason: "error" }, 500);
  }
  return J({ ok: false, reason: "not-found" }, 404);
}

/* ══ The registration page's first question: what is this link? ══ */
async function claimInfo(env, J, t) {
  const c = await claimOf(env, t);
  if (c.state !== "ok") return J({ ok: false, reason: c.state === "revoked" ? "expired" : c.state }, c.state === "unknown" ? 404 : 410);
  const o = c.order;
  if (o.status !== "delivered") return J({ ok: false, reason: o.status === "registered" ? "used" : "early", why: o.status === "registered" ? "" : "Registration opens once the piece has been delivered." }, 409);
  const series = await seriesOf(env, o.series);
  const size = series ? series.size : await seriesSize(env, o.series);
  return J({
    ok: true,
    piece: { n: o.number, size, colorway: o.colorway, photo: o.photo_url || null, series: series ? series.name : "Series 01" },
    deliveredOn: o.delivered_on, city: o.city || "", state: o.state || "",
    name: o.buyer_name || "", phone: o.phone || "", email: o.email || "",
    ownerNo: await nextOwnerNo(env, o.piece_id),
    returnDays: series ? series.return_days : 7,
    returnEndsAt: o.return_window_ends_at || null,
    returnOpen: !!(o.return_window_ends_at && Date.parse(o.return_window_ends_at) > Date.now())
  });
}

/* "Request a new link": the owner is told, and sends one. A link we have
   never issued tells nobody anything. */
async function requestLink(env, deps, J, b) {
  const c = await claimOf(env, b.t);
  if (c.order && c.state !== "ok" && c.state !== "unknown") {
    const q = await queueLetter(env, { template: "linkRequested", to: adminEmail(env), series: c.order.series, dedupe: `linkreq:${c.order.id}:${istDay()}`,
      vars: { n: c.order.number, email: c.order.email || "(none on file)", controlUrl: `${deps.workerUrl(env)}/control` } });
    if (q) deps.kick([q]);
  }
  return J({ ok: true });
}

/* A different email than the order's has to be proved before it is used. */
async function emailCode(env, deps, J, b) {
  const c = await claimOf(env, b.t);
  if (c.state !== "ok") return J({ ok: false, reason: c.state }, 410);
  const e = normEmail(b.email);
  if (!validEmail(e)) return J({ ok: false, reason: "invalid" }, 400);
  const r = await issueCode(env, e);
  if (r.reason === "rate") return J({ ok: false, reason: "rate" }, 429);
  if (r.send) {
    const m = codeEmail(r.send.code, deps.siteUrl(env));
    deps.kick0(deps.sendEmail(env, r.send.to, m.subject, m.text, m.html));
  }
  return J({ ok: true });
}

/* ══ Registering ══ */
async function register(env, deps, J, request, b) {
  const c = await claimOf(env, b.t);
  if (c.state !== "ok") return J({ ok: false, reason: c.state === "revoked" ? "expired" : c.state }, c.state === "unknown" ? 404 : 410);
  const o = c.order;
  if (o.status !== "delivered") return J({ ok: false, reason: o.status === "registered" ? "used" : "early" }, 409);
  if (o.piece_status !== "delivered") return J({ ok: false, reason: "piece", why: "This piece is not open for registration. Write to connect@thekaal.co." }, 409);

  if (b.accept !== true) return J({ ok: false, reason: "accept", why: `Tick the box to accept No. ${pad2(o.number)}. Registering is what makes it yours.` }, 400);
  if (b.consent !== true) return J({ ok: false, reason: "consent", why: "Tick the box to agree to the data notice so we can keep your record." }, 400);
  const name = clean(b.name, 80);
  const phone = normPhone(b.phone);
  const email = normEmail(b.email);
  if (!name) return J({ ok: false, reason: "name", why: "Your name, as it should be written in the registry." }, 400);
  if (!phone || phone.length < 11) return J({ ok: false, reason: "phone", why: "A phone number we can reach you on." }, 400);
  if (!validEmail(email)) return J({ ok: false, reason: "email", why: "An email address. It is how you sign in." }, 400);

  /* A new address has to be shown to be theirs. */
  const changed = email !== normEmail(o.email);
  if (changed) {
    const spent = await spendCode(env, email, b.emailCode);
    if (!spent.ok) return J({ ok: false, reason: "email-code", why: spent.reason === "wrong" ? "That code is not right. Check it and try again." : "Enter the six digits we sent to that address." }, 400);
  }
  const showCity = b.showCity === true, showName = b.showName === true;

  /* Taking the link is the one step only one caller can win. */
  const won = await env.DB.prepare("UPDATE claim_tokens SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?1 RETURNING id").bind(iso(), c.token.id).first();
  if (!won) return J({ ok: false, reason: "used" }, 410);

  const at = iso();
  const series = await seriesOf(env, o.series);
  const months = series ? series.warranty_months : 24;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO owners (email, name, phone, city, state, show_city_publicly, data_consent_at, city_consent_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?7, ?7)
         ON CONFLICT (email) DO UPDATE SET name = ?2, phone = ?3, city = COALESCE(owners.city, ?4), state = COALESCE(owners.state, ?5),
           show_city_publicly = ?6, data_consent_at = ?7, city_consent_at = CASE WHEN ?6 = 1 THEN ?7 ELSE owners.city_consent_at END, deleted_at = NULL, updated_at = ?7`
      ).bind(email, name, phone, o.city || null, o.state || null, showCity ? 1 : 0, at, showCity ? at : null),
      /* Initials on the shop: only with the box ticked (unticked by default). */
      env.DB.prepare("UPDATE owners SET show_name_publicly = ?1, name_consent_at = CASE WHEN ?1 = 1 THEN ?2 ELSE NULL END WHERE email = ?3").bind(showName ? 1 : 0, at, email),
      env.DB.prepare(
        `INSERT INTO ownerships (series, piece_id, owner_id, owner_no, from_at, acquired_via, order_id)
         SELECT ?1, ?2, id, (SELECT COALESCE(MAX(owner_no), 0) + 1 FROM ownerships WHERE piece_id = ?2), ?3, 'purchase', ?4 FROM owners WHERE email = ?5`
      ).bind(o.series, o.piece_id, at, o.id, email),
      env.DB.prepare("UPDATE orders SET status = 'registered', registered_at = ?1, return_window_ends_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'delivered'").bind(at, o.id),
      env.DB.prepare("UPDATE pieces SET status = 'registered', updated_at = ?1 WHERE id = ?2 AND status = 'delivered'").bind(at, o.piece_id),
      env.DB.prepare("UPDATE claim_tokens SET revoked_at = ?1 WHERE order_id = ?2 AND used_at IS NULL AND revoked_at IS NULL").bind(at, o.id)
    ]);
  } catch (e) {
    /* Whole or not at all: the link is given back and nothing was written. */
    await env.DB.prepare("UPDATE claim_tokens SET used_at = NULL WHERE id = ?1").bind(c.token.id).run().catch(() => null);
    console.log("Registration failed:", String(e).slice(0, 200));
    return J({ ok: false, reason: "error", why: "Something failed on our side. Nothing was changed; please try again." }, 500);
  }
  const owner = await env.DB.prepare("SELECT * FROM owners WHERE email = ?1").bind(email).first();
  const mine = await env.DB.prepare("SELECT owner_no FROM ownerships WHERE piece_id = ?1 AND owner_id = ?2 AND to_at IS NULL").bind(o.piece_id, owner.id).first();
  const w = warrantyWindow(o.delivered_on, months);
  await audit(env, "owner:" + owner.id, "owner.register", "order:" + o.id,
    { order: "delivered", piece: "delivered", return_window_ends_at: o.return_window_ends_at },
    { order: "registered", piece: "registered", owner_no: mine && mine.owner_no, email_changed: changed || undefined, show_city: showCity, show_initials: showName }, o.series);
  await notifyOwner(env, { kind: "owner", title: `No. ${pad2(o.number)} is registered`, body: `Owner ${mine ? mine.owner_no : 1} of No. ${pad2(o.number)} just registered. The return window is closed; the warranty is on file.`, url: "/control#owners", tag: "reg-" + o.number });

  /* The welcome, and the session that opens the dashboard. */
  const q = await queueLetter(env, { template: "registered", to: email, series: o.series, dedupe: `registered:${o.id}`,
    vars: { site: deps.siteUrl(env), n: o.number, size: series ? series.size : await seriesSize(env, o.series), ownerNo: mine ? mine.owner_no : 1,
      registeredOn: longDay(istDay()), warrantyEnd: w ? `23:59 on ${longDay(w.endDay)}` : "" } });
  if (q) deps.kick([q]);
  const s = await openSession(env, owner, request.headers.get("user-agent"), "owner");
  return J({ ok: true, token: s.token, maxAge: s.maxAge, n: o.number, ownerNo: mine ? mine.owner_no : 1 });
}

/* ══ The dossier ══
   Everything one owner may see of the pieces they hold: their own record,
   the warranty clock in the server's time, the chain with earlier owners
   as numbers and years only, the service history, what is open. */
export async function dossier(env, owner) {
  const held = (await env.DB.prepare(
    `SELECT w.*, p.number, p.colorway, p.photo_url, p.status AS piece_status, s.name AS series_name, s.size, s.warranty_months, s.return_days,
            o.id AS order_row, o.paid_at, o.amount_paise, o.currency, o.razorpay_payment_id, o.delivered_on, o.registered_at, o.buyer_name, o.city AS order_city, o.state AS order_state
       FROM ownerships w JOIN pieces p ON p.id = w.piece_id JOIN series s ON s.code = w.series LEFT JOIN orders o ON o.id = w.order_id
      WHERE w.owner_id = ?1 AND w.to_at IS NULL ORDER BY w.from_at`
  ).bind(owner.id).all()).results || [];
  const pieces = [];
  for (const h of held) {
    const chain = (await env.DB.prepare("SELECT owner_no, from_at, to_at FROM ownerships WHERE piece_id = ?1 ORDER BY owner_no").bind(h.piece_id).all()).results || [];
    /* The warranty belongs to the piece and runs from its first delivery; a
       transfer never restarts it. */
    const first = await env.DB.prepare("SELECT delivered_on FROM orders WHERE piece_id = ?1 AND delivered_on IS NOT NULL ORDER BY id LIMIT 1").bind(h.piece_id).first();
    const clock = warrantyWindow(first ? first.delivered_on : h.delivered_on, h.warranty_months);
    const service = (await env.DB.prepare("SELECT date, work_done, public_line FROM service_log WHERE piece_id = ?1 ORDER BY date DESC, id DESC").bind(h.piece_id).all()).results || [];
    const requests = (await env.DB.prepare("SELECT id, type, status, created_at, decision FROM requests WHERE piece_id = ?1 AND owner_id = ?2 AND status IN ('open','info_needed','approved') ORDER BY id DESC").bind(h.piece_id, owner.id).all()).results || [];
    const transfer = await env.DB.prepare("SELECT id, status, expires_at FROM transfer_requests WHERE piece_id = ?1 AND from_owner = ?2 AND status IN ('open','accepted') ORDER BY id DESC LIMIT 1").bind(h.piece_id, owner.id).first();
    pieces.push({
      id: h.piece_id, n: h.number, size: h.size, colorway: h.colorway, series: h.series_name, photo: h.photo_url || null,
      ownerNo: h.owner_no, status: h.piece_status, stolen: h.piece_status === "reported_stolen",
      city: h.order_city || owner.city || "", state: h.order_state || owner.state || "",
      orderedOn: h.paid_at || null, deliveredOn: first ? first.delivered_on : h.delivered_on || null, registeredOn: h.from_at,
      warranty: clock ? { startMs: clock.startMs, endMs: clock.endMs, endDay: clock.endDay, months: h.warranty_months } : null,
      chain: chain.map(c => ({ ownerNo: c.owner_no, from: String(c.from_at).slice(0, 4), to: c.to_at ? String(c.to_at).slice(0, 4) : null, mine: c.owner_no === h.owner_no })),
      service, requests, transfer: transfer || null,
      receipt: h.order_row ? { amountPaise: h.amount_paise, currency: h.currency, paidAt: h.paid_at, reference: /^manual:/.test(h.razorpay_payment_id || "") ? "Recorded by KAAL" : h.razorpay_payment_id, name: h.buyer_name || owner.name } : null
    });
  }
  /* A transfer to this owner that is waiting for the shop's approval. */
  const incoming = (await env.DB.prepare(
    "SELECT t.id, t.status, p.number FROM transfer_requests t JOIN pieces p ON p.id = t.piece_id WHERE t.to_owner = ?1 AND t.status = 'accepted' ORDER BY t.id DESC"
  ).bind(owner.id).all()).results || [];
  return {
    ok: true, now: Date.now(),
    owner: { name: owner.name, email: owner.email, phone: owner.phone, city: owner.city, state: owner.state, showCity: !!owner.show_city_publicly,
      showName: !!owner.show_name_publicly, initials: maskName(owner.name) },
    pieces, incoming: incoming.map(t => ({ n: t.number, status: t.status })), guide: (await setting(env, "guide_video_url", "")) || null
  };
}
