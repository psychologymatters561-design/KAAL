/* ══════════════════════════════════════════════════════════════════
   Phase 6 of the registry: what an owner can ask for (claims, stolen
   reports, contact changes, paid service, transfers, recovery) and what
   the owner of the shop decides in Approvals. Real migrations, the real
   worker, Node's own SQLite.

     node --no-warnings tools/test-requests.mjs
   Exits non-zero if anything fails. CI runs it on every pull request.
   ══════════════════════════════════════════════════════════════════ */
import w from "../worker/kaal-sold-sync.js";
import * as R from "../worker/registry.js";
import { moveOrder, warrantyWindow } from "../worker/orders.js";
import { flushOutbox } from "../worker/outbox.js";
import { newCode, normCode } from "../worker/transfers.js";
import { sniff } from "../worker/owner-actions.js";
import { d1, kv, ctx } from "./d1-shim.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const SITE = "https://thekaal.co", WORKER = "https://kaal-edition.kaal-edition-hq.workers.dev";

function world(extra) {
  const DB = d1(), KV = kv(), mails = [];
  KV.store.set("sold", "[1,2]");
  const env = Object.assign({ DB, KAAL_STATE: KV, EDITION: "20", PRICE_PAISE: "599900", CURRENCY: "INR", ALLOW_ORIGIN: SITE, SITE_URL: SITE, WORKER_URL: WORKER,
    RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "wh", RESEND_API_KEY: "re", OWNER_EMAIL: "owner@thekaal.co",
    ADMIN_EMAIL: "admin@thekaal.co", AUTH_SECRET: "a".repeat(48), GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r" }, extra || {});
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes("api.resend.com")) { mails.push(JSON.parse(init.body)); return new Response("{}"); }
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  };
  return { env, DB, KV, mails };
}
let ipn = 1;
const call = async (W, method, path, body, headers, raw) => {
  const k = ctx();
  const h = Object.assign({ Origin: SITE, "X-KAAL": "1", "cf-connecting-ip": "198.51.100." + (ipn++ % 250 + 1) }, headers || {});
  if (body !== undefined && !raw) h["Content-Type"] = "application/json";
  const r = await w.fetch(new Request("https://w" + path, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) }), W.env, k);
  await k.done();
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, j: /json/.test(ct) ? await r.json().catch(() => null) : null, headers: r.headers, buf: /json/.test(ct) ? null : await r.arrayBuffer() };
};
/* The control room, as its owner: a cookie, same origin. */
async function admin(W) {
  let cookie = "";
  const a = async (method, path, body) => {
    const k = ctx();
    const h = { Origin: WORKER, "X-KAAL": "1", Cookie: cookie, "cf-connecting-ip": "203.0.113." + (ipn++ % 250 + 1) };
    if (body !== undefined) h["Content-Type"] = "application/json";
    const r = await w.fetch(new Request(WORKER + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), W.env, k);
    await k.done();
    const set = r.headers.get("Set-Cookie"); if (set) { const c = /^kaal_s=([^;]*)/.exec(set); if (c) cookie = "kaal_s=" + c[1]; }
    const ct = r.headers.get("content-type") || "";
    return { status: r.status, j: /json/.test(ct) ? await r.json().catch(() => null) : null, buf: /json/.test(ct) ? null : await r.arrayBuffer(), headers: r.headers };
  };
  W.mails.length = 0;
  await a("POST", "/auth/start", { email: "admin@thekaal.co" });
  const code = W.mails.find(m => /sign-in code/.test(m.subject)).subject.slice(0, 7).replace(" ", "");
  await a("POST", "/auth/verify", { email: "admin@thekaal.co", code });
  a.signedOut = async (method, path) => { const c = cookie; cookie = ""; const r = await a(method, path); cookie = c; return r; };
  return a;
}
const flush = (W) => flushOutbox(W.env, async (to, subject, text, html) => { W.mails.push({ to: [to], subject, text, html }); return true; });
const seed = (W, id, n, email, extra) => R.recordPayment(W.env, Object.assign({ series: "S01", n, paymentId: id, orderId: "order_" + id, amount: 599900, email, phone: "9876543210", name: "Asha Rao",
  address: { line1: "1 Road", city: "Pune", state: "Maharashtra", pin: "411001" }, paidAt: new Date().toISOString() }, extra || {}));
const good = (email, extra) => Object.assign({ name: "Asha Rao", phone: "9876543210", email, accept: true, consent: true, showCity: false }, extra || {});
const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
async function register(W, n, email, name, extra) {
  const id = (await seed(W, "pay_REQ" + String(n).padStart(5, "0") + Math.floor(Math.random() * 1e4), n, email, { name: name || "Asha Rao" })).order.id;
  W.DB.raw.prepare("UPDATE orders SET status='dispatched', dispatched_at=?, courier='X', tracking_number='T', tracking_url='https://x.example/t' WHERE id=?").run(new Date(Date.now() - 86400000).toISOString(), id);
  W.mails.length = 0;
  await moveOrder(W.env, { siteUrl: () => SITE, kick: () => {} }, "admin:1", id, { to: "delivered", day: today() });
  await flush(W);
  const tok = (/claim\?t=([A-Za-z0-9_-]{43})/.exec(W.mails.find(m => /One step makes it yours/.test(m.subject)).text) || [])[1];
  const r = await call(W, "POST", "/o/claim/register", Object.assign({ t: tok }, good(email, { name: name || "Asha Rao" }), extra || {}));
  return { id, token: r.j.token, bearer: { Authorization: "Bearer " + r.j.token } };
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const sent = (W, re, to) => W.mails.filter(m => re.test(m.subject) && (!to || m.to.includes(to)));

/* ── the file sniffer ── */
{
  ok(sniff(JPEG.buffer).type === "image/jpeg" && sniff(new TextEncoder().encode("<script>alert(1)</script>").buffer) === null, "sniff: a JPEG is a JPEG, a script is nothing we keep");
  ok(sniff(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]).buffer).kind === "video", "sniff: an MP4 is a video");
  const c = newCode();
  ok(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/.test(c) && normCode(c).length === 10 && normCode(c.toLowerCase()) === normCode(c), "code: ten characters with no look-alikes, read the same in any case");
}

/* ── Claims, uploads, and what the owner of the shop does with them ── */
{
  const W = world();
  const A = await register(W, 7, "asha@example.com");
  const B = await register(W, 8, "ravi@example.com", "Ravi K");
  const adm = await admin(W);

  let r = await call(W, "POST", "/o/upload?p=S01-07", JPEG, A.bearer, true);
  ok(r.status === 200 && r.j.ok && /^claim:\d+:/.test(r.j.key) && r.j.type === "image/jpeg", "upload: a photograph is kept under its own key");
  const key = r.j.key;
  r = await call(W, "POST", "/o/upload?p=S01-07", new TextEncoder().encode("hello, not a picture"), A.bearer, true);
  ok(r.status === 415, "upload: a file that is not a photograph or a video is refused, whatever it calls itself");
  r = await call(W, "POST", "/o/upload?p=S01-08", JPEG, A.bearer, true);
  ok(r.status === 404, "upload: a piece that is not yours is not found");
  r = await call(W, "POST", "/o/upload?p=S01-07", JPEG);
  ok(r.status === 401, "upload: nobody signed in, nothing kept");
  const big = new Uint8Array(9 * 1024 * 1024); big.set(JPEG);
  r = await call(W, "POST", "/o/upload?p=S01-07", big, A.bearer, true);
  ok(r.status === 413, "upload: a photograph over 8 MB is refused");

  W.mails.length = 0;
  r = await call(W, "POST", "/o/requests", { piece: "S01-07", type: "warranty", description: "" }, A.bearer);
  ok(r.status === 400 && r.j.reason === "description", "claim: say something about it");
  r = await call(W, "POST", "/o/requests", { piece: "S01-08", type: "warranty", description: "It stops after an hour." }, A.bearer);
  ok(r.status === 404, "claim: not for a piece that is another owner's");
  r = await call(W, "POST", "/o/requests", { piece: "S01-07", type: "warranty", description: "It stops after an hour.", media: [key.replace(/claim:\d+/, "claim:999")] }, A.bearer);
  ok(r.status === 400 && r.j.reason === "media", "claim: another owner's file cannot be attached");
  const keyB = (await call(W, "POST", "/o/upload?p=S01-08", JPEG, B.bearer, true)).j.key;
  r = await call(W, "POST", "/o/requests", { piece: "S01-07", type: "warranty", description: "It stops after an hour.", media: [keyB] }, A.bearer);
  ok(r.status === 400 && r.j.reason === "media", "claim: nor a real file that belongs to somebody else");
  r = await call(W, "POST", "/o/requests", { piece: "S01-07", type: "warranty", description: "It stops after an hour.", media: [key] }, A.bearer);
  const rid = r.j.id;
  ok(r.status === 200 && r.j.ok && rid, "claim: raised, with its photograph");
  await flush(W);
  ok(sent(W, /^No\. 07: your claim is with us$/, "asha@example.com").length === 1 && /forty eight hours/.test(sent(W, /your claim is with us/)[0].text), "claim: the owner is told it is with us, and when to expect an answer");
  ok(sent(W, /needs you/, "admin@thekaal.co").length === 1 && /warranty claim for No\. 07/i.test(sent(W, /needs you/)[0].subject), "claim: the owner of the shop is told");
  r = await call(W, "POST", "/o/requests", { piece: "S01-07", type: "warranty", description: "Again, it stops." }, A.bearer);
  ok(r.status === 409 && r.j.reason === "dup", "claim: one open claim at a time");
  const me = await call(W, "GET", "/o/me", undefined, A.bearer);
  ok(me.j.pieces[0].requests.length === 1 && me.j.pieces[0].requests[0].type === "warranty" && me.j.pieces[0].requests[0].status === "open", "claim: the dossier shows it as open");

  /* The control room. */
  let ap = await adm("GET", "/control/api/approvals");
  ok(ap.status === 200 && ap.j.requests.length === 1 && ap.j.requests[0].media.length === 1 && ap.j.requests[0].number === 7 && ap.j.requests[0].email === "asha@example.com", "approvals: the claim, its owner and its file");
  const media = await adm("GET", "/control/api/media?k=" + encodeURIComponent(key));
  ok(media.status === 200 && media.headers.get("content-type") === "image/jpeg" && media.buf.byteLength === JPEG.byteLength, "approvals: the file, to the owner of the shop");
  ok((await adm.signedOut("GET", "/control/api/media?k=" + encodeURIComponent(key))).status === 401, "approvals: and to nobody signed out");
  const asOwner = await call(W, "GET", "/control/api/media?k=" + encodeURIComponent(key), undefined, A.bearer);
  ok(asOwner.status === 401, "approvals: an owner's token does not open the control room");
  ok((await adm("GET", "/control/api/media?k=" + encodeURIComponent("claim:1:../../x"))).status === 404, "approvals: a made-up key finds nothing");

  W.mails.length = 0;
  let d = await adm("POST", `/control/api/requests/${rid}/decide`, { action: "approve", pickup: "" });
  ok(d.status === 400 && d.j.reason === "pickup", "decide: approving needs the pickup details");
  d = await adm("POST", `/control/api/requests/${rid}/decide`, { action: "info", message: "A photograph of the caseback, please." });
  await flush(W);
  ok(d.j.ok && sent(W, /we need a little more/, "asha@example.com").length === 1 && /caseback/.test(sent(W, /a little more/)[0].text), "decide: asking for more emails the owner what is needed");
  ok((await call(W, "GET", "/o/me", undefined, A.bearer)).j.pieces[0].requests[0].status === "info_needed", "decide: the dossier says it needs a little more");
  d = await adm("POST", `/control/api/requests/${rid}/decide`, { action: "approve", pickup: "A courier collects it on 28 October between 10 and 1." });
  await flush(W);
  ok(d.j.ok && sent(W, /your claim is approved/, "asha@example.com").length === 1 && /Pickup: A courier collects it/.test(sent(W, /approved/)[0].text), "decide: approving emails the pickup details");
  d = await adm("POST", `/control/api/requests/${rid}/decide`, { action: "approve", pickup: "again again" });
  ok(d.status === 409, "decide: never decided twice");
  d = await adm("POST", `/control/api/requests/${rid}/decide`, { action: "decline", reason: "Some reason here" });
  ok(d.status === 409, "decide: an approved claim cannot then be declined");
  W.mails.length = 0;
  d = await adm("POST", `/control/api/requests/${rid}/decide`, { action: "serviced", work_done: "Replaced the movement, serial 4471", public_line: "Movement replaced under warranty", courier: "Delhivery", tracking: "DL99" });
  await flush(W);
  ok(d.j.ok && sent(W, /No\. 07 is on its way back to you/, "asha@example.com").length === 1 && /unchanged/.test(sent(W, /on its way back/)[0].text), "service: marking it serviced emails that it is on its way back, warranty unchanged");
  ok(W.DB.raw.prepare("SELECT COUNT(*) AS c FROM service_log WHERE piece_id = 'S01-07' AND public_line = 'Movement replaced under warranty'").get().c === 1 && W.DB.raw.prepare("SELECT status FROM requests WHERE id = ?").get(rid).status === "closed", "service: a service_log line, and the claim is closed");
  const me2 = await call(W, "GET", "/o/me", undefined, A.bearer);
  ok(me2.j.pieces[0].service.length === 1 && /serial 4471/.test(me2.j.pieces[0].service[0].work_done) && me2.j.pieces[0].requests.length === 0, "service: the owner's history shows it");
  const pub = await call(W, "GET", "/registry/data");
  ok(pub.j.pieces[6].service[0].line === "Movement replaced under warranty" && !/4471/.test(JSON.stringify(pub.j)), "service: the public line is public; what was done is not");

  /* A decline carries the reason and the paid option. */
  W.mails.length = 0;
  const rb = (await call(W, "POST", "/o/requests", { piece: "S01-08", type: "warranty", description: "The strap marks easily." }, B.bearer)).j.id;
  const dd = await adm("POST", `/control/api/requests/${rb}/decide`, { action: "decline", reason: "Marks on the bracelet are wear, which the warranty does not cover." });
  await flush(W);
  const dec = sent(W, /about your claim/, "ravi@example.com")[0];
  ok(dd.j.ok && dec && /wear, which the warranty does not cover/.test(dec.text) && /service it for a fee/.test(dec.text), "decline: the reason, and the paid service, in the owner's email");

  /* An expired warranty cannot claim, but can ask for service. */
  W.DB.raw.prepare("UPDATE orders SET delivered_on = '2023-01-01' WHERE piece_id = 'S01-08'").run();
  r = await call(W, "POST", "/o/requests", { piece: "S01-08", type: "warranty", description: "It has stopped again." }, B.bearer);
  ok(r.status === 409 && r.j.reason === "expired", "claim: once the warranty has concluded, a claim is refused and service is offered");
  r = await call(W, "POST", "/o/requests", { piece: "S01-08", type: "service", description: "Please service it." }, B.bearer);
  ok(r.status === 200, "service: a paid service request is taken");
  const sv = (await adm("GET", "/control/api/approvals")).j.requests.find(x => x.type === "service");
  d = await adm("POST", `/control/api/requests/${sv.id}/decide`, { action: "close", note: "Quoted by email" });
  ok(d.j.ok, "service: closed from Approvals");

  /* A contact change. */
  r = await call(W, "POST", "/o/requests", { piece: "S01-07", type: "contact", description: "Please change my phone to 9811122233." }, A.bearer);
  const ct = r.j.id;
  d = await adm("POST", `/control/api/requests/${ct}/decide`, { action: "done" });
  ok(r.j.ok && d.j.ok && W.DB.raw.prepare("SELECT status FROM requests WHERE id = ?").get(ct).status === "closed", "contact: asked for, and marked done");

  /* The audit trail. */
  const act = W.DB.raw.prepare("SELECT action FROM audit_log WHERE action LIKE 'request.%'").all().map(x => x.action).join();
  ok(/request\.new/.test(act) && /request\.approve/.test(act) && /request\.serviced/.test(act) && /request\.decline/.test(act), "audit: every request and every decision is written down");
}

/* ── Stolen ── */
{
  const W = world();
  const A = await register(W, 7, "asha@example.com");
  const adm = await admin(W);
  let r = await call(W, "POST", "/o/requests", { piece: "S01-07", type: "stolen", description: "Taken from my bag on a train." }, A.bearer);
  const id = r.j.id;
  ok(r.j.ok && W.DB.raw.prepare("SELECT status FROM pieces WHERE id = 'S01-07'").get().status === "registered", "stolen: reporting does not by itself flag the piece");
  const t = await call(W, "POST", "/o/transfer/start", { piece: "S01-07" }, A.bearer);
  ok(t.j.ok, "setup: a transfer is open");
  W.mails.length = 0;
  let d = await adm("POST", `/control/api/requests/${id}/decide`, { action: "confirm" });
  await flush(W);
  ok(d.j.ok && W.DB.raw.prepare("SELECT status FROM pieces WHERE id = 'S01-07'").get().status === "reported_stolen" && sent(W, /No\. 07 is flagged as stolen/, "asha@example.com").length === 1, "stolen: confirming flags the piece and emails the owner");
  ok((await call(W, "GET", "/registry/data")).j.pieces[6].state === "stolen", "stolen: the public registry shows it");
  ok(W.DB.raw.prepare("SELECT status FROM transfer_requests").get().status === "cancelled", "stolen: an open transfer is cancelled with it");
  r = await call(W, "POST", "/o/transfer/start", { piece: "S01-07" }, A.bearer);
  ok(r.status === 409 && r.j.reason === "stolen", "stolen: and no transfer can start while it is flagged");
  r = await call(W, "POST", "/o/requests", { piece: "S01-07", type: "warranty", description: "It also stops." }, A.bearer);
  ok(r.status === 409, "stolen: nor a claim");
  const me = await call(W, "GET", "/o/me", undefined, A.bearer);
  ok(me.j.pieces[0].stolen === true, "stolen: the dossier shows the flag");
  W.mails.length = 0;
  d = await adm("POST", `/control/api/requests/${id}/decide`, { action: "clear" });
  await flush(W);
  ok(d.j.ok && W.DB.raw.prepare("SELECT status FROM pieces WHERE id = 'S01-07'").get().status === "registered" && sent(W, /No\. 07 is cleared/).length === 1, "stolen: clearing restores it and says so");
  ok((await call(W, "GET", "/registry/data")).j.pieces[6].state === "sold", "stolen: the registry shows it sold again");
  const r2 = await call(W, "POST", "/o/requests", { piece: "S01-07", type: "stolen", description: "A mistake, then." }, A.bearer);
  d = await adm("POST", `/control/api/requests/${r2.j.id}/decide`, { action: "dismiss" });
  ok(d.j.ok && W.DB.raw.prepare("SELECT status FROM pieces WHERE id = 'S01-07'").get().status === "registered", "stolen: a report can be dismissed without touching the piece");
}

/* ── Transfers ── */
{
  const W = world();
  const A = await register(W, 7, "asha@example.com");
  const adm = await admin(W);
  W.mails.length = 0;
  let r = await call(W, "POST", "/o/transfer/start", { piece: "S01-08" }, A.bearer);
  ok(r.status === 404, "transfer: only for a piece that is yours");
  r = await call(W, "POST", "/o/transfer/start", { piece: "S01-07", buyerEmail: "asha@example.com" }, A.bearer);
  ok(r.status === 400, "transfer: not to yourself");
  r = await call(W, "POST", "/o/transfer/start", { piece: "S01-07", buyerEmail: "kim@example.com" }, A.bearer);
  const code = r.j.code;
  await flush(W);
  ok(r.j.ok && /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(code) && Date.parse(r.j.expiresAt) - Date.now() > 6.9 * 86400000, "transfer: a code, shown once, good for seven days");
  ok(!JSON.stringify(W.DB.raw.prepare("SELECT * FROM transfer_requests").all()).includes(code.replace("-", "")) && !W.DB.raw.prepare("SELECT code_hash FROM transfer_requests").get().code_hash.includes(code), "transfer: only a keyed hash of the code is kept");
  ok(!JSON.stringify(W.mails).includes(code) && sent(W, /a transfer has begun/, "asha@example.com").length === 1, "transfer: the seller's email does not carry the code");
  const inv = sent(W, /is being passed to you/, "kim@example.com")[0];
  ok(inv && /claim\/transfer/.test(inv.text) && !inv.text.includes(code), "transfer: the buyer is invited to the page, not given the code");
  r = await call(W, "POST", "/o/transfer/start", { piece: "S01-07" }, A.bearer);
  ok(r.status === 409 && r.j.reason === "dup", "transfer: one at a time");

  const me = await call(W, "GET", "/o/me", undefined, A.bearer);
  ok(me.j.pieces[0].transfer && me.j.pieces[0].transfer.status === "open", "transfer: the dossier shows it");
  let lk = await call(W, "POST", "/o/transfer/lookup", { code: "AAAAA-BBBBB" });
  ok(lk.status === 404 && lk.j.reason === "invalid", "transfer: a wrong code finds nothing");
  lk = await call(W, "POST", "/o/transfer/lookup", { code: code.toLowerCase().replace("-", " ") });
  ok(lk.status === 200 && lk.j.piece.n === 7 && lk.j.ownerNo === 2 && lk.j.warrantyEndMs, "transfer: the code, in any case, shows the piece, the next owner number and the warranty that stays");
  ok(!JSON.stringify(lk.j).match(/asha|example\.com|Pune|9876/i), "transfer: and nothing of the seller");

  W.mails.length = 0;
  r = await call(W, "POST", "/o/transfer/email-code", { code, email: "kim@example.com" });
  const ec = W.mails.find(m => /sign-in code/.test(m.subject)).subject.slice(0, 7).replace(" ", "");
  ok(r.j.ok && /^\d{6}$/.test(ec), "transfer: the buyer's email is proved with a code");
  const acc = (extra) => call(W, "POST", "/o/transfer/accept", Object.assign({ code, email: "kim@example.com", emailCode: ec, name: "Kim Lee", phone: "9811122233", accept: true, consent: true, city: "Delhi", state: "Delhi", showCity: true }, extra || {}));
  r = await acc({ accept: false });
  ok(r.status === 400 && r.j.reason === "accept", "transfer: the acceptance box has to be ticked");
  r = await acc({ consent: false });
  ok(r.status === 400 && r.j.reason === "consent", "transfer: and the data notice");
  r = await acc({ email: "asha@example.com" });
  ok(r.status === 400 && r.j.reason === "email", "transfer: the seller cannot accept their own piece");
  r = await acc({ emailCode: ec === "000000" ? "111111" : "000000" });
  ok(r.status === 400 && r.j.reason === "email-code", "transfer: a wrong email code is refused");
  r = await acc();
  const K = { Authorization: "Bearer " + (r.j && r.j.token) };
  ok(r.status === 200 && r.j.ok && r.j.completed === false && r.j.token, "transfer: accepted, and with approval on it waits");
  ok(W.DB.raw.prepare("SELECT status FROM transfer_requests").get().status === "accepted" && W.DB.raw.prepare("SELECT COUNT(*) AS c FROM ownerships WHERE piece_id = 'S01-07' AND to_at IS NULL AND owner_no = 1").get().c === 1, "transfer: nothing has moved yet");
  const kd = await call(W, "GET", "/o/me", undefined, K);
  ok(kd.j.pieces.length === 0 && kd.j.incoming.length === 1 && kd.j.incoming[0].n === 7, "transfer: the buyer's page says it is waiting for approval");
  r = await call(W, "POST", "/o/transfer/accept", { code, email: "other@example.com", emailCode: "123456", name: "O", phone: "9811122233", accept: true, consent: true });
  ok(r.status === 404, "transfer: a code that has been accepted cannot be used again");
  ok(sent(W, /needs you/, "admin@thekaal.co").some(m => /transfer for No\. 07/i.test(m.subject)), "transfer: the owner of the shop is told");

  const ap = await adm("GET", "/control/api/approvals");
  ok(ap.j.transfers.length === 1 && ap.j.transfers[0].status === "accepted" && ap.j.transfers[0].to_email === "kim@example.com", "approvals: the transfer waits, with both owners");
  const w0 = (await call(W, "GET", "/o/me", undefined, A.bearer)).j.pieces[0].warranty;
  W.mails.length = 0;
  let d = await adm("POST", `/control/api/transfers/${ap.j.transfers[0].id}/decide`, { action: "approve" });
  await flush(W);
  ok(d.j.ok && d.j.ownerNo === 2, "approvals: approved, one tap");
  const chain = W.DB.raw.prepare("SELECT owner_no, to_at, acquired_via FROM ownerships WHERE piece_id = 'S01-07' ORDER BY owner_no").all();
  ok(chain.length === 2 && chain[0].to_at && chain[1].to_at === null && chain[1].acquired_via === "transfer", "transfer: the old ownership closes with a date, Owner II opens");
  const kd2 = await call(W, "GET", "/o/me", undefined, K);
  ok(kd2.j.pieces.length === 1 && kd2.j.pieces[0].ownerNo === 2 && kd2.j.pieces[0].warranty.endMs === w0.endMs && kd2.j.pieces[0].chain.length === 2, "transfer: the buyer is Owner II, and the warranty end has not moved");
  ok((await call(W, "GET", "/o/me", undefined, A.bearer)).j.pieces.length === 0, "transfer: the seller no longer holds it");
  const kc = JSON.stringify(kd2.j);
  ok(!/asha/i.test(kc) && kd2.j.pieces[0].chain.map(c => c.ownerNo).join() === "1,2" && kd2.j.pieces[0].chain[0].to, "transfer: the buyer sees the earlier owner as a number and years, never a name");
  ok(sent(W, /No\. 07 has passed on/, "asha@example.com").length === 1 && sent(W, /No\. 07 is recorded in your name/, "kim@example.com").length === 1, "transfer: both are emailed");
  const pub = (await call(W, "GET", "/registry/data")).j.pieces[6];
  ok(pub.owner.no === 2 && pub.owner.city === "Delhi", "transfer: the public registry shows Owner II, and the city they chose to show");
  d = await adm("POST", `/control/api/transfers/${ap.j.transfers[0].id}/decide`, { action: "approve" });
  ok(d.status === 409, "transfer: never approved twice");

  /* Cancel, expire, reject. */
  const K2 = await call(W, "POST", "/o/transfer/start", { piece: "S01-07" }, K);
  ok(K2.j.ok, "setup: Owner II starts one");
  r = await call(W, "POST", "/o/transfer/cancel", { piece: "S01-07" }, K);
  ok(r.j.ok && W.DB.raw.prepare("SELECT status FROM transfer_requests ORDER BY id DESC").get().status === "cancelled", "transfer: the owner can cancel");
  r = await call(W, "POST", "/o/transfer/lookup", { code: K2.j.code });
  ok(r.status === 404, "transfer: and a cancelled code is dead");
  const K3 = await call(W, "POST", "/o/transfer/start", { piece: "S01-07" }, K);
  W.DB.raw.prepare("UPDATE transfer_requests SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), W.DB.raw.prepare("SELECT MAX(id) AS i FROM transfer_requests").get().i);
  r = await call(W, "POST", "/o/transfer/lookup", { code: K3.j.code });
  ok(r.status === 404, "transfer: an expired code is dead");
  const k = ctx(); await w.scheduled({}, W.env, k); await k.done();
  ok(W.DB.raw.prepare("SELECT status FROM transfer_requests ORDER BY id DESC").get().status === "expired", "transfer: unused codes are marked expired by the clock");
  const K4 = await call(W, "POST", "/o/transfer/start", { piece: "S01-07" }, K);
  W.mails.length = 0;
  const ec4 = await (async () => { await call(W, "POST", "/o/transfer/email-code", { code: K4.j.code, email: "lee@example.com" }); return W.mails.find(m => /sign-in code/.test(m.subject)).subject.slice(0, 7).replace(" ", ""); })();
  await call(W, "POST", "/o/transfer/accept", { code: K4.j.code, email: "lee@example.com", emailCode: ec4, name: "Lee", phone: "9811122233", accept: true, consent: true });
  const tid = W.DB.raw.prepare("SELECT MAX(id) AS i FROM transfer_requests").get().i;
  W.mails.length = 0;
  d = await adm("POST", `/control/api/transfers/${tid}/decide`, { action: "reject", note: "Not satisfied" });
  await flush(W);
  ok(d.j.ok && W.DB.raw.prepare("SELECT COUNT(*) AS c FROM ownerships WHERE piece_id = 'S01-07' AND to_at IS NULL AND owner_no = 2").get().c === 1 && sent(W, /transfer was not approved/).length === 2, "transfer: rejected, it stays where it was and both are told");
}

/* ── Approval switched off: it completes at once ── */
{
  const W = world();
  const A = await register(W, 7, "asha@example.com");
  W.DB.raw.prepare("UPDATE settings SET value = '0' WHERE key = 'transfers_need_approval'").run();
  const t = await call(W, "POST", "/o/transfer/start", { piece: "S01-07" }, A.bearer);
  await call(W, "POST", "/o/transfer/email-code", { code: t.j.code, email: "kim@example.com" });
  const ec = W.mails.filter(m => /sign-in code/.test(m.subject)).at(-1).subject.slice(0, 7).replace(" ", "");
  const r = await call(W, "POST", "/o/transfer/accept", { code: t.j.code, email: "kim@example.com", emailCode: ec, name: "Kim", phone: "9811122233", accept: true, consent: true });
  ok(r.j.ok && r.j.completed === true && W.DB.raw.prepare("SELECT owner_no FROM ownerships WHERE piece_id = 'S01-07' AND to_at IS NULL").get().owner_no === 2, "transfer: with approval off, accepting completes it at once");
}

/* ── Recovery: an owner who cannot sign in ── */
{
  const W = world();
  const A = await register(W, 7, "asha@example.com");
  const adm = await admin(W);
  W.mails.length = 0;
  let r = await call(W, "POST", "/o/recovery", { number: 7, email: "newmail@example.com", description: "I lost access to my old email." });
  const none = await call(W, "POST", "/o/recovery", { number: 12, email: "newmail@example.com", description: "Nothing registered." });
  ok(r.j.ok && none.j.ok && JSON.stringify(r.j) === JSON.stringify(none.j), "recovery: the same answer for a registered piece and for one that is not");
  await flush(W);
  ok(W.DB.raw.prepare("SELECT COUNT(*) AS c FROM requests WHERE type = 'recovery'").get().c === 1 && sent(W, /needs you/, "admin@thekaal.co").length === 1, "recovery: one request, and the owner of the shop is told");
  await call(W, "POST", "/o/recovery", { number: 7, email: "newmail@example.com", description: "Again." });
  ok(W.DB.raw.prepare("SELECT COUNT(*) AS c FROM requests WHERE type = 'recovery'").get().c === 1, "recovery: asking again does not make a second");
  const id = W.DB.raw.prepare("SELECT id FROM requests WHERE type = 'recovery'").get().id;
  let d = await adm("POST", `/control/api/requests/${id}/decide`, { action: "decline", reason: "" });
  ok(d.status === 400, "recovery: declining needs a reason");
  W.mails.length = 0;
  d = await adm("POST", `/control/api/requests/${id}/decide`, { action: "verify" });
  await flush(W);
  ok(d.j.ok && W.DB.raw.prepare("SELECT email FROM owners WHERE id = (SELECT owner_id FROM requests WHERE id = ?)").get(id).email === "newmail@example.com", "recovery: verified, the sign-in moves to the address they gave");
  ok((await call(W, "GET", "/o/me", undefined, A.bearer)).status === 401, "recovery: every earlier sign-in is closed");
  ok(sent(W, /your access is restored/, "newmail@example.com").length === 1 && /thekaal\.co\/owners/.test(sent(W, /access is restored/)[0].text), "recovery: the new address is told, and pointed at Owners");
  await call(W, "POST", "/o/auth/start", { email: "newmail@example.com" });
  const code = W.mails.filter(m => /sign-in code/.test(m.subject)).at(-1).subject.slice(0, 7).replace(" ", "");
  const v = await call(W, "POST", "/o/auth/verify", { email: "newmail@example.com", code });
  const me = await call(W, "GET", "/o/me", undefined, { Authorization: "Bearer " + v.j.token });
  ok(me.status === 200 && me.j.pieces.length === 1 && me.j.pieces[0].n === 7, "recovery: and they sign in at the new address to their own piece");

  /* A decline asks for the photographs. */
  const W2 = world();
  await register(W2, 9, "x@example.com");
  const adm2 = await admin(W2);
  await call(W2, "POST", "/o/recovery", { number: 9, email: "thief@example.com", description: "It is mine, trust me." });
  const rid = W2.DB.raw.prepare("SELECT id FROM requests WHERE type = 'recovery'").get().id;
  W2.mails.length = 0;
  const dd = await adm2("POST", `/control/api/requests/${rid}/decide`, { action: "decline", reason: "The details do not match our record." });
  await flush(W2);
  ok(dd.j.ok && sent(W2, /about your request/, "thief@example.com").length === 1 && /photograph of the caseback and of the letter/.test(sent(W2, /about your request/)[0].text), "recovery: a decline asks for the caseback and the letter");
  ok(W2.DB.raw.prepare("SELECT email FROM owners WHERE email = 'x@example.com'").get(), "recovery: and changes nothing about the real owner");
}

/* ── Nos. 01 and 02: sold before the registry, brought in by hand, registered by their owners ── */
{
  const W = world();
  const adm = await admin(W);
  W.mails.length = 0;
  let r = await adm("POST", "/control/api/orders/manual", { n: 1, name: "Mira Das", email: "Mira@Example.com", phone: "9822233344", city: "Mumbai", state: "Maharashtra", paid_on: "2026-09-20", delivered_on: "2026-09-28" });
  ok(r.j.ok && W.mails.every(m => !m.to.includes("mira@example.com")), "past sale: recorded for No. 01, and nobody is emailed");
  const oid = r.j.id;
  ok(W.DB.raw.prepare("SELECT status, return_window_ends_at FROM orders WHERE id = ?").get(oid).status === "delivered", "past sale: delivered, with the return window computed from the real delivery day");
  const win = Date.parse(W.DB.raw.prepare("SELECT return_window_ends_at FROM orders WHERE id = ?").get(oid).return_window_ends_at);
  ok(win < Date.now(), "past sale: and that window closed weeks ago, as it should");
  r = await adm("POST", `/control/api/orders/${oid}/link`, { mode: "send" });
  await flush(W);
  const mail = sent(W, /One step makes it yours/, "mira@example.com")[0];
  ok(r.j.ok && mail, "past sale: 'Send registration link' reaches the owner");
  const tok = (/claim\?t=([A-Za-z0-9_-]{43})/.exec(mail.text) || [])[1];
  const info = await call(W, "GET", "/o/claim/info?t=" + tok);
  ok(info.j.ok && info.j.piece.n === 1 && info.j.returnOpen === false && info.j.city === "Mumbai", "past sale: the registration page opens, and says the return window is already closed");
  const reg = await call(W, "POST", "/o/claim/register", Object.assign({ t: tok }, good("mira@example.com", { name: "Mira Das", phone: "9822233344" })));
  ok(reg.j.ok && reg.j.ownerNo === 1, "past sale: Mira registers as Owner I of No. 01");
  const warranty = (await call(W, "GET", "/o/me", undefined, { Authorization: "Bearer " + reg.j.token })).j.pieces[0].warranty;
  ok(warranty.endDay === "2028-09-28", "past sale: her warranty runs from the real delivery day, to 28 September 2028");
  ok((await call(W, "GET", "/registry/data")).j.pieces[0].owner.no === 1, "past sale: the public registry shows No. 01 with its Owner I");
}

console.log(failed ? `\n${failed} failed.` : "\nAll Phase 6 tests passed.");
process.exit(failed ? 1 : 0);
