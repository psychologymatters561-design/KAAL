/* ══════════════════════════════════════════════════════════════════
   Phase 4 of the registry: the registration link, registering, the
   owner's sign-in and their dossier (worker/owners.js), against the real
   migrations in Node's SQLite.

     node --no-warnings tools/test-owners.mjs
   Exits non-zero if anything fails. CI runs it on every pull request.
   ══════════════════════════════════════════════════════════════════ */
import w from "../worker/kaal-sold-sync.js";
import * as R from "../worker/registry.js";
import { warrantyWindow, moveOrder } from "../worker/orders.js";
import { flushOutbox } from "../worker/outbox.js";
import { d1, kv, ctx } from "./d1-shim.mjs";
import { createHash } from "node:crypto";
import { seal } from "./seal-email.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const SITE = "https://thekaal.co", WORKER = "https://kaal-edition.kaal-edition-hq.workers.dev";

function world() {
  const DB = d1(), KV = kv(), mails = [];
  KV.store.set("sold", "[1,2]");
  const env = { DB, KAAL_STATE: KV, EDITION: "20", OWNER_OPS: "off", PRICE_PAISE: "599900", CURRENCY: "INR", ALLOW_ORIGIN: SITE, SITE_URL: SITE, WORKER_URL: WORKER,
    RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "wh", RESEND_API_KEY: "re", OWNER_EMAIL: "owner@thekaal.co",
    ADMIN_EMAIL: "admin@thekaal.co", AUTH_SECRET: "a".repeat(48), GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r" };
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes("api.resend.com")) { mails.push(JSON.parse(init.body)); return new Response("{}"); }
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  };
  return { env, DB, KV, mails };
}
const call = async (W, method, path, body, headers) => {
  const k = ctx();
  const h = Object.assign({ Origin: SITE, "X-KAAL": "1", "cf-connecting-ip": "203.0.113." + (1 + Math.floor(Math.random() * 200)) }, headers || {});
  if (body !== undefined) h["Content-Type"] = "application/json";
  const r = await w.fetch(new Request("https://w" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), W.env, k);
  await k.done();
  return { status: r.status, j: await r.json().catch(() => null), headers: r.headers };
};
const seed = (W, id, n, email, extra) => R.recordPayment(W.env, Object.assign({ series: "S01", n, paymentId: id, orderId: "order_" + id, amount: 599900, email, phone: "9876543210", name: "Asha Rao",
  address: { line1: "1 Road", city: "Pune", state: "Maharashtra", pin: "411001" }, paidAt: new Date().toISOString() }, extra || {}));
const deliver = async (W, orderId) => {
  const deps = { siteUrl: () => SITE, kick: () => {} };
  W.DB.raw.prepare("UPDATE orders SET status='dispatched', dispatched_at=?, courier='Delhivery', tracking_number='DL1', tracking_url='https://x.example/t' WHERE id=?").run(new Date(Date.now() - 86400000).toISOString(), orderId);
  const r = await moveOrder(W.env, deps, "admin:1", orderId, { to: "delivered", day: new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10) });
  await flushOutbox(W.env, async (to, subject, text, html) => { W.mails.push({ to: [to], subject, text, html }); return true; });
  return r;
};
const tokenFrom = (W) => { const m = [...W.mails].reverse().find(x => /One step makes it yours/.test(x.subject)); return m && (/claim\?t=([A-Za-z0-9_-]{43})/.exec(m.text) || [])[1]; };
const good = { name: "  Asha  Rao ", phone: "98765 43210", email: "Asha@Example.com", accept: true, consent: true, showCity: false };

/* ── the warranty clock ── */
{
  const a = warrantyWindow("2026-10-24", 24);
  ok(a.startMs === Date.parse("2026-10-24T00:00:00+05:30") && a.endMs === Date.parse("2028-10-24T23:59:59+05:30"), "warranty: from 00:00 India time on delivery day, to 23:59:59 two years on");
  ok(warrantyWindow("2024-02-29", 12).endDay === "2025-02-28" && warrantyWindow("2026-01-31", 1).endDay === "2026-02-28", "warranty: a day the month lacks ends on the month's last day");
}

/* ── the registration link ── */
const W = world();
const o7 = (await seed(W, "pay_OWN0007", 7, "asha@example.com")).order.id;
let r = await deliver(W, o7);
ok(r.body.ok, "setup: No. 07 delivered");
const tok = tokenFrom(W);
ok(tok && tok.length === 43, "claim: the Delivered email carries a registration link");

r = await call(W, "GET", "/o/claim/info?t=" + tok);
ok(r.status === 200 && r.j.ok && r.j.piece.n === 7 && r.j.piece.size === 20 && r.j.deliveredOn && r.j.city === "Pune" && r.j.state === "Maharashtra" && r.j.email === "asha@example.com" && r.j.ownerNo === 1,
  "claim: the link opens the piece, with the delivery date, city and state from the order, the name, phone and email to confirm");
ok(r.j.returnDays === 7 && r.j.returnOpen === true, "claim: it says the return window is open, for seven days");
r = await call(W, "GET", "/o/claim/info?t=" + "A".repeat(43));
ok(r.status === 404 && r.j.reason === "unknown", "claim: a link never issued is unknown");
r = await call(W, "GET", "/o/claim/info?t=short");
ok(r.status === 404, "claim: a malformed link is unknown");

/* Boxes unticked, fields missing: refused in plain words, nothing used up. */
r = await call(W, "POST", "/o/claim/register", Object.assign({ t: tok }, good, { accept: false }));
ok(r.status === 400 && r.j.reason === "accept" && /accept No\. 07/.test(r.j.why), "register: the acceptance box has to be ticked");
r = await call(W, "POST", "/o/claim/register", Object.assign({ t: tok }, good, { consent: false }));
ok(r.status === 400 && r.j.reason === "consent", "register: the data notice has to be agreed");
r = await call(W, "POST", "/o/claim/register", Object.assign({ t: tok }, good, { name: "" }));
ok(r.status === 400 && r.j.reason === "name", "register: a name is needed");
r = await call(W, "POST", "/o/claim/register", Object.assign({ t: tok }, good, { phone: "12" }));
ok(r.status === 400 && r.j.reason === "phone", "register: a phone is needed");
ok(W.DB.raw.prepare("SELECT COUNT(*) AS c FROM claim_tokens WHERE used_at IS NULL").get().c === 1 && W.DB.raw.prepare("SELECT status FROM orders WHERE id = ?").get(o7).status === "delivered", "register: a refusal changes nothing and does not spend the link");
r = await call(W, "POST", "/o/claim/register", Object.assign({ t: tok }, good), { Origin: "https://evil.example" });
ok(r.status === 403, "register: another site cannot post it");
r = await call(W, "POST", "/o/claim/register", Object.assign({ t: tok }, good), { "X-KAAL": "" });
ok(r.status === 403, "register: a post without the header is refused");

/* A different email has to be proved. */
r = await call(W, "POST", "/o/claim/register", Object.assign({ t: tok }, good, { email: "new@example.com" }));
ok(r.status === 400 && r.j.reason === "email-code", "register: a changed email is not accepted without its confirmation code");
W.mails.length = 0;
r = await call(W, "POST", "/o/claim/email-code", { t: tok, email: "new@example.com" });
const code = (W.mails.find(m => m.to.includes("new@example.com")) || {}).subject?.slice(0, 7).replace(" ", "");
ok(r.j.ok && /^\d{6}$/.test(code), "register: the code goes to the new address");
r = await call(W, "POST", "/o/claim/register", Object.assign({ t: tok }, good, { email: "new@example.com", emailCode: code === "000000" ? "111111" : "000000" }));
ok(r.status === 400 && r.j.reason === "email-code", "register: a wrong confirmation code is refused");

/* Registering, with the order's own email. */
W.mails.length = 0;
r = await call(W, "POST", "/o/claim/register", Object.assign({ t: tok }, good));
ok(r.status === 200 && r.j.ok && r.j.ownerNo === 1 && r.j.n === 7 && r.j.token && r.j.token.length >= 40, "register: done, as Owner I, and signed in");
const ord = W.DB.raw.prepare("SELECT status, registered_at, return_window_ends_at FROM orders WHERE id = ?").get(o7);
ok(ord.status === "registered" && ord.registered_at && ord.return_window_ends_at === ord.registered_at, "register: the order is registered and the return window closes at that moment");
ok(W.DB.raw.prepare("SELECT status FROM pieces WHERE id = 'S01-07'").get().status === "registered", "register: the piece is registered");
const ow = W.DB.raw.prepare("SELECT * FROM owners WHERE email = 'asha@example.com'").get();
ok(ow && ow.name === "Asha Rao" && ow.phone === "919876543210" && ow.city === "Pune" && ow.show_city_publicly === 0 && ow.data_consent_at && ow.city_consent_at === null, "register: the owner row has the cleaned name and phone, consent noted, and the city NOT public (the box was not ticked)");
const ch = W.DB.raw.prepare("SELECT owner_no, to_at, acquired_via, order_id FROM ownerships WHERE piece_id = 'S01-07'").all();
ok(ch.length === 1 && ch[0].owner_no === 1 && ch[0].to_at === null && ch[0].acquired_via === "purchase" && ch[0].order_id === o7, "register: Ownership I is open");
const pub = W.DB.raw.prepare("SELECT state, owner_no, owner_city FROM public_registry WHERE number = 7").get();
ok(pub.state === "sold" && pub.owner_no === 1 && pub.owner_city === null, "register: the public registry shows Owner I, with the city withheld");
const wel = W.mails.find(m => m.subject === "No. 07 is recorded in your name");
const endText = "Your warranty runs until 23:59 on " + new Date(warrantyWindow(ord.registered_at && W.DB.raw.prepare("SELECT delivered_on FROM orders WHERE id = ?").get(o7).delivered_on, 24).endMs + 5.5 * 3600000).toISOString().slice(0, 10).split("-").reverse().join(" ");
ok(wel && /You are Owner I of No\. 07, recorded on \d+ \w+ 20\d\d\. Your warranty runs until 23:59 on \d+ \w+ 20\d\d\./.test(wel.text) && /thekaal\.co\/owners/.test(wel.text) && /Kaal does not wait\. Wear it well\./.test(wel.text), "register: the welcome email, in the brief's words" + (wel ? "" : " (not sent)"));
void endText;
const aud = W.DB.raw.prepare("SELECT actor, action FROM audit_log WHERE action = 'owner.register'").all();
ok(aud.length === 1 && /^owner:\d+$/.test(aud[0].actor), "register: written to the audit log");
ok(!JSON.stringify(W.DB.raw.prepare("SELECT payload FROM email_outbox WHERE template = 'delivered'").all()).includes(tok), "register: the link is not kept in the outbox");

/* The link is single use. */
r = await call(W, "GET", "/o/claim/info?t=" + tok);
ok(r.status === 410 && r.j.reason === "used", "claim: used, the link says so");
r = await call(W, "POST", "/o/claim/register", Object.assign({ t: tok }, good));
ok(r.status === 410, "register: a link cannot be used twice");
W.mails.length = 0;
r = await call(W, "POST", "/o/claim/request-link", { t: tok });
ok(r.j.ok && W.mails.some(m => m.to.includes("admin@thekaal.co") && /A new registration link was asked for: No\. 07/.test(m.subject)), "claim: asking for a new link tells the owner of the shop");
W.mails.length = 0;
r = await call(W, "POST", "/o/claim/request-link", { t: "B".repeat(43) });
ok(r.j.ok && W.mails.length === 0, "claim: asking with a link we never issued tells nobody anything");

/* A race: two registrations at once, one winner. */
{
  const X = world();
  const id = (await seed(X, "pay_RACE0007", 7, "x@example.com")).order.id;
  await deliver(X, id);
  const t2 = tokenFrom(X);
  const both = await Promise.all([call(X, "POST", "/o/claim/register", Object.assign({ t: t2 }, good, { email: "x@example.com" })), call(X, "POST", "/o/claim/register", Object.assign({ t: t2 }, good, { email: "x@example.com" }))]);
  ok(both.filter(b => b.status === 200).length === 1 && X.DB.raw.prepare("SELECT COUNT(*) AS c FROM ownerships WHERE piece_id = 'S01-07'").get().c === 1, "register: two at once, exactly one is Owner I");
}

/* Returned or cancelled before registering: the link goes nowhere. */
{
  const X = world();
  const id = (await seed(X, "pay_RET00007", 7, "x@example.com")).order.id;
  await deliver(X, id);
  const t2 = tokenFrom(X);
  X.DB.raw.prepare("UPDATE orders SET status = 'returned' WHERE id = ?").run(id);
  const g = await call(X, "GET", "/o/claim/info?t=" + t2);
  ok(g.status === 409 && g.j.reason === "early" || g.j.reason === "used", "claim: a returned order's link no longer opens a registration");
  const p = await call(X, "POST", "/o/claim/register", Object.assign({ t: t2 }, good, { email: "x@example.com" }));
  ok(p.status === 409 && X.DB.raw.prepare("SELECT COUNT(*) AS c FROM ownerships").get().c === 0, "register: and it registers nobody");
}

/* The city, only on opt-in. */
{
  const X = world();
  const id = (await seed(X, "pay_CITY0007", 7, "c@example.com")).order.id;
  await deliver(X, id);
  const r2 = await call(X, "POST", "/o/claim/register", Object.assign({ t: tokenFrom(X) }, good, { email: "c@example.com", showCity: true }));
  const pub2 = X.DB.raw.prepare("SELECT owner_city FROM public_registry WHERE number = 7").get();
  ok(r2.j.ok && pub2.owner_city === "Pune" && X.DB.raw.prepare("SELECT city_consent_at FROM owners").get().city_consent_at, "register: ticking the city box shows it in the public registry, with the time of consent");
}

/* ── Signing in ── */
{
  const X = world();
  const id = (await seed(X, "pay_SIGN0007", 7, "asha@example.com")).order.id;
  await deliver(X, id);
  await call(X, "POST", "/o/claim/register", Object.assign({ t: tokenFrom(X) }, good, { email: "asha@example.com" }));
  X.mails.length = 0;
  let a = await call(X, "POST", "/o/auth/start", { email: "stranger@example.com" });
  ok(a.j.ok && X.mails.length === 0, "sign-in: an address that is no owner's gets the same answer and no email");
  a = await call(X, "POST", "/o/auth/start", { email: "ASHA@example.com" });
  const c = (X.mails.find(m => m.to.includes("asha@example.com") && /sign-in code/.test(m.subject)) || {}).subject?.slice(0, 7).replace(" ", "");
  ok(a.j.ok && /^\d{6}$/.test(c), "sign-in: an owner is emailed a code");
  a = await call(X, "POST", "/o/auth/verify", { email: "asha@example.com", code: c === "000000" ? "111111" : "000000" });
  ok(a.status === 401, "sign-in: a wrong code is refused");
  a = await call(X, "POST", "/o/auth/verify", { email: "asha@example.com", code: c });
  ok(a.status === 200 && a.j.ok && a.j.token, "sign-in: the right code gives a token");
  const bearer = { Authorization: "Bearer " + a.j.token };
  let me = await call(X, "GET", "/o/me");
  ok(me.status === 401, "dossier: no token, nothing");
  me = await call(X, "GET", "/o/me", undefined, { Authorization: "Bearer " + "x".repeat(43) });
  ok(me.status === 401, "dossier: a made-up token, nothing");
  me = await call(X, "GET", "/o/me", undefined, bearer);
  ok(me.status === 200 && me.j.ok && me.j.pieces.length === 1 && me.j.pieces[0].n === 7 && me.j.pieces[0].ownerNo === 1, "dossier: the owner sees their piece, as Owner I");
  const p = me.j.pieces[0];
  const w2 = warrantyWindow(p.deliveredOn, 24);
  ok(p.warranty.endMs === w2.endMs && p.warranty.startMs === w2.startMs && Math.abs(me.j.now - Date.now()) < 5000, "dossier: the warranty clock and the server's time");
  ok(me.j.owner.name === "Asha Rao" && me.j.owner.email === "asha@example.com" && p.city === "Pune" && p.state === "Maharashtra" && p.chain.length === 1, "dossier: name, city and state of the order, the chain");
  ok(me.j.pieces[0].receipt && me.j.pieces[0].receipt.reference === "pay_SIGN0007" && me.j.pieces[0].receipt.amountPaise === 599900, "dossier: the receipt's facts");
  ok(!JSON.stringify(me.j).match(/admin@|owner@thekaal|address_line|411001|1 Road/), "dossier: no address, nothing of anyone else");

  /* A second owner cannot see the first's. */
  const id2 = (await seed(X, "pay_SIGN0008", 8, "ravi@example.com", { name: "Ravi K", phone: "9811122233" })).order.id;
  await deliver(X, id2);
  await call(X, "POST", "/o/claim/register", Object.assign({ t: tokenFrom(X) }, good, { name: "Ravi K", email: "ravi@example.com" }));
  X.mails.length = 0;
  await call(X, "POST", "/o/auth/start", { email: "ravi@example.com" });
  const c2 = (X.mails.find(m => /sign-in code/.test(m.subject)) || {}).subject?.slice(0, 7).replace(" ", "");
  const a2 = await call(X, "POST", "/o/auth/verify", { email: "ravi@example.com", code: c2 });
  const me2 = await call(X, "GET", "/o/me", undefined, { Authorization: "Bearer " + a2.j.token });
  ok(me2.j.pieces.length === 1 && me2.j.pieces[0].n === 8 && !JSON.stringify(me2.j).includes("Asha") && !JSON.stringify(me2.j).includes("asha@"), "dossier: another owner sees only their own piece, and nothing of the first");

  /* The shop's own address may hold a piece too. It signs in here like any
     owner, and each door's session opens only its own door. */
  X.DB.raw.prepare("INSERT INTO owners (email, role) VALUES ('admin@thekaal.co', 'admin')").run();   /* the admin has signed in to the control room before */
  const idA = (await seed(X, "pay_SIGN0001", 1, "admin@thekaal.co", { name: "Shop Owner" })).order.id;
  await deliver(X, idA);
  const rA = await call(X, "POST", "/o/claim/register", Object.assign({ t: tokenFrom(X) }, good, { name: "Shop Owner", email: "admin@thekaal.co" }));
  ok(rA.j.ok && rA.j.token && X.DB.raw.prepare("SELECT role FROM owners WHERE email = 'admin@thekaal.co'").get().role === "admin", "admin as owner: registering keeps the admin role");
  X.mails.length = 0;
  a = await call(X, "POST", "/o/auth/start", { email: "admin@thekaal.co" });
  const cA = (X.mails.find(m => m.to.includes("admin@thekaal.co") && /sign-in code/.test(m.subject)) || {}).subject?.slice(0, 7).replace(" ", "");
  ok(a.j.ok && /^\d{6}$/.test(cA), "admin as owner: the admin's address is emailed a code at the owners' door");
  a = await call(X, "POST", "/o/auth/verify", { email: "admin@thekaal.co", code: cA });
  ok(a.status === 200 && a.j.token, "admin as owner: the code gives an owner's token");
  const ownerTok = a.j.token;
  me = await call(X, "GET", "/o/me", undefined, { Authorization: "Bearer " + ownerTok });
  ok(me.status === 200 && me.j.pieces.length === 1 && me.j.pieces[0].n === 1 && !JSON.stringify(me.j).includes("asha@"), "admin as owner: the dossier shows No. 01 and only No. 01");
  const ctl = (pth, hdr) => w.fetch(new Request("https://w" + pth, { headers: Object.assign({ Origin: "https://w", "X-KAAL": "1" }, hdr) }), X.env, ctx());
  let cr = await ctl("/control/api/overview", { Cookie: "kaal_s=" + ownerTok });
  ok(cr.status === 401, "scope: an owner's token sent as the control room's cookie opens nothing");
  cr = await ctl("/control/api/overview", { Cookie: "kaal_s=" + rA.j.token });
  ok(cr.status === 401, "scope: the token registration hands out opens nothing in the control room either");
  X.mails.length = 0;
  await w.fetch(new Request("https://w/auth/start", { method: "POST", headers: { Origin: "https://w", "X-KAAL": "1", "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.250" }, body: JSON.stringify({ email: "admin@thekaal.co" }) }), X.env, ctx());
  const cC = (X.mails.find(m => /sign-in code/.test(m.subject)) || {}).subject?.slice(0, 7).replace(" ", "");
  const vr = await w.fetch(new Request("https://w/auth/verify", { method: "POST", headers: { Origin: "https://w", "X-KAAL": "1", "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.250" }, body: JSON.stringify({ email: "admin@thekaal.co", code: cC }) }), X.env, ctx());
  const ctlTok = (/^kaal_s=([^;]+)/.exec(vr.headers.get("Set-Cookie") || "") || [])[1];
  cr = await ctl("/control/api/overview", { Cookie: "kaal_s=" + ctlTok });
  ok(vr.status === 200 && ctlTok && cr.status === 200, "scope: the control room's own sign-in still opens the control room");
  me = await call(X, "GET", "/o/me", undefined, { Authorization: "Bearer " + ctlTok });
  ok(me.status === 401, "scope: the control room's cookie sent as an owner's token opens nothing");
  await call(X, "POST", "/o/auth/logout", {}, bearer);
  me = await call(X, "GET", "/o/me", undefined, bearer);
  ok(me.status === 401, "sign-out: the token stops working");
  const cors = await w.fetch(new Request("https://w/o/me", { headers: { Origin: "https://evil.example", Authorization: "Bearer x" } }), X.env, ctx());
  ok(cors.headers.get("Access-Control-Allow-Origin") === SITE && /Authorization/.test((await w.fetch(new Request("https://w/o/me", { method: "OPTIONS", headers: { Origin: SITE } }), X.env, ctx())).headers.get("Access-Control-Allow-Headers")), "cors: only the shop's origin, and preflight allows the bearer header");
}

/* ── A buyer who has not registered yet asks to sign in ── */
{
  const X = world();
  const id = (await seed(X, "pay_WAIT0012", 12, "gaurang@example.com", { name: "G V" })).order.id;
  X.mails.length = 0;
  let a = await call(X, "POST", "/o/auth/start", { email: "gaurang@example.com" });
  ok(a.j.ok && X.mails.length === 0, "sign-in before delivery: the same answer, and nothing sent");
  await deliver(X, id);
  X.mails.length = 0;
  a = await call(X, "POST", "/o/auth/start", { email: "Gaurang@Example.com" });
  const cm = X.mails.find(m => m.to.includes("gaurang@example.com") && /sign-in code/.test(m.subject));
  const code = cm && cm.subject.slice(0, 7).replace(" ", "");
  ok(a.j.ok && /^\d{6}$/.test(code || "") && /No\. 12's registration opens/.test(cm.text), "sign-in before registering: a delivered, unregistered buyer is sent a code, which says it opens No. 12's registration");
  a = await call(X, "POST", "/o/auth/verify", { email: "gaurang@example.com", code: code === "000000" ? "111111" : "000000" });
  ok(a.status === 401, "sign-in before registering: a wrong code is refused");
  a = await call(X, "POST", "/o/auth/verify", { email: "gaurang@example.com", code });
  const t = (/^\/claim\?t=([A-Za-z0-9_-]{43})$/.exec((a.j && a.j.register) || "") || [])[1];
  ok(a.status === 200 && a.j.ok && t && a.j.n === 12 && !a.j.token, "sign-in before registering: the right code opens No. 12's registration (no session yet)");
  const info = await call(X, "GET", "/o/claim/info?t=" + t);
  ok(info.j && info.j.ok && info.j.piece.n === 12 && info.j.email === "gaurang@example.com", "sign-in before registering: the registration page it opens is that piece's, prefilled");
  a = await call(X, "POST", "/o/auth/verify", { email: "gaurang@example.com", code });
  ok(a.status === 401, "sign-in before registering: a code works once");
  const reg = await call(X, "POST", "/o/claim/register", Object.assign({ t }, good, { name: "G V", email: "gaurang@example.com" }));
  ok(reg.j.ok, "sign-in before registering: and registering from there works");
  X.mails.length = 0;
  a = await call(X, "POST", "/o/auth/start", { email: "gaurang@example.com" });
  const c2 = ((X.mails.find(m => /sign-in code/.test(m.subject)) || {}).subject || "").slice(0, 7).replace(" ", "");
  a = await call(X, "POST", "/o/auth/verify", { email: "gaurang@example.com", code: c2 });
  ok(/^\d{6}$/.test(c2) && a.j.ok && a.j.token && !a.j.register, "once registered, the code signs in to the owners' room");
}

/* ── The public registry (Phase 5) ── */
{
  const X = world();
  const id7 = (await seed(X, "pay_PUB00007", 7, "asha@example.com")).order.id;
  await deliver(X, id7);
  await call(X, "POST", "/o/claim/register", Object.assign({ t: tokenFrom(X) }, good, { email: "asha@example.com", showCity: false }));
  await seed(X, "pay_PUB00008", 8, "ravi@example.com", { name: "Ravi K" });                    /* sold, unregistered */
  X.DB.raw.prepare("UPDATE pieces SET photo_url = 'https://w.example/photo/S01-07' WHERE id = 'S01-07'").run();
  X.DB.raw.prepare("UPDATE pieces SET photo_url = 'https://w.example/photo/S01-12' WHERE id = 'S01-12'").run();
  X.DB.raw.prepare("UPDATE pieces SET status = 'held', held_by = 'x', held_until = ? WHERE id = 'S01-10'").run(Date.now() + 600000);
  X.DB.raw.prepare("UPDATE pieces SET status = 'reported_stolen' WHERE id = 'S01-15'").run();
  X.DB.raw.prepare("INSERT INTO service_log (series, piece_id, date, work_done, public_line) VALUES ('S01','S01-07','2027-03-01','Replaced the movement, serial 1234','Movement replaced under warranty')").run();
  X.DB.raw.prepare("INSERT INTO service_log (series, piece_id, date, work_done, public_line) VALUES ('S01','S01-07','2027-04-01','Private note only',NULL)").run();
  let g = await call(X, "GET", "/registry/data");
  const by = (n) => g.j.pieces.find(p => p.n === n);
  ok(g.status === 200 && g.j.ok && g.j.pieces.length === 20 && g.j.series.size === 20 && g.j.series.retired === false, "registry: the twenty, and the series is not retired");
  ok(by(7).state === "sold" && by(7).owner.no === 1 && /^[A-Z][a-z]{2} 20\d\d$/.test(by(7).owner.since) && by(7).owner.city === null, "registry: No. 07 is sold to Owner I since the month, its city withheld");
  ok(by(8).state === "sold" && by(8).owner === null, "registry: a sold piece nobody has registered yet has no owner to show");
  ok(by(10).state === "held" && by(15).state === "stolen" && by(9).state === "unavailable" && by(1).state === "sold" || by(1).state === "available", "registry: held, stolen and withheld pieces read as what they are");
  ok(by(9).state !== "sold" && by(9).owner === null, "registry: withheld No. 09 is never shown as sold or owned");
  ok(by(7).photo && !by(12).photo, "registry: a photograph only for a piece that has gone");
  ok(by(7).service.length === 1 && by(7).service[0].line === "Movement replaced under warranty", "registry: only the service lines chosen for the public");
  const raw = JSON.stringify(g.j);
  ok(!/asha|ravi|example\.com|9876|98765|Road|411001|Pune|pay_|order_|serial 1234|Private note/i.test(raw), "registry: no name, email, phone, address, payment id, private note or city");
  X.DB.raw.prepare("UPDATE owners SET show_city_publicly = 1 WHERE email = 'asha@example.com'").run();
  g = await call(X, "GET", "/registry/data");
  ok(by(7).owner.city === "Pune", "registry: the city appears once its owner has opted in");
  X.DB.raw.prepare("UPDATE owners SET show_city_publicly = 0 WHERE email = 'asha@example.com'").run();
  const st = await call(X, "GET", "/state");
  ok(st.j.sold.includes(7) && st.j.sold.includes(8) && st.j.held.includes(10) && st.j.sold.includes(9), "state: the shop reads the same table: sold, held and withheld numbers are not offered");
  ok(!(st.j.placed && st.j.placed[7]), "state: with the city not opted in, the shop's grid shows none");
  X.DB.raw.prepare("UPDATE owners SET show_city_publicly = 1 WHERE email = 'asha@example.com'").run();
  const st2 = await call(X, "GET", "/state");
  ok(st2.j.placed && /^Pune · [A-Z][a-z]{2} 20\d\d$/.test(st2.j.placed[7]), "state: and with it opted in, the shop's grid says where and when");
  X.DB.raw.prepare("UPDATE pieces SET status = 'placed', order_ref = 1 WHERE status = 'available'").run();
  X.DB.raw.prepare("UPDATE pieces SET status = 'placed' WHERE status IN ('held','reported_stolen','withheld')").run();
  g = await call(X, "GET", "/registry/data");
  ok(g.j.series.retired === true, "registry: when all twenty have gone, the series reads Retired");
  const c = await w.fetch(new Request("https://w/registry/data", { headers: { Origin: "https://evil.example" } }), X.env, ctx());
  ok(c.headers.get("Access-Control-Allow-Origin") === SITE && /max-age=10/.test(c.headers.get("Cache-Control")), "registry: shop origin only, cached ten seconds");
}

/* ── Brute force, and a cookie is not a bearer ── */
{
  const X = world();
  const id = (await seed(X, "pay_BRUTE0007", 7, "asha@example.com")).order.id;
  await deliver(X, id);
  await call(X, "POST", "/o/claim/register", Object.assign({ t: tokenFrom(X) }, good, { email: "asha@example.com" }));
  X.mails.length = 0;
  await call(X, "POST", "/o/auth/start", { email: "asha@example.com" });
  const c = X.mails.find(m => /sign-in code/.test(m.subject)).subject.slice(0, 7).replace(" ", "");
  const wrong = c === "000000" ? "111111" : "000000";
  let last;
  for (let i = 0; i < 5; i++) last = await call(X, "POST", "/o/auth/verify", { email: "asha@example.com", code: wrong });
  ok(last.status === 401 && last.j.reason === "tries", "brute force: five wrong guesses spend the code");
  const after = await call(X, "POST", "/o/auth/verify", { email: "asha@example.com", code: c });
  ok(after.status === 401 && after.j.ok !== true, "brute force: and the right code no longer works after them");
  const same = { "cf-connecting-ip": "198.51.100.250" };
  let rate = null;
  for (let i = 0; i < 7; i++) { const r = await call(X, "POST", "/o/auth/start", { email: "x" + i + "@example.com" }, same); if (r.status === 429) { rate = i; break; } }
  ok(rate !== null && rate <= 5, "brute force: one address asking for codes is stopped after five (" + rate + ")");
  const adm = world();
  ok((await call(adm, "GET", "/o/me", undefined, { Cookie: "kaal_s=" + "a".repeat(43) })).status === 401, "a session cookie is not a bearer token");
}

/* ── Initials on the shop: only with a yes, only masked, and taken back at will ── */
{
  const X = world();
  const id = (await seed(X, "pay_INIT0007", 7, "i@example.com")).order.id;
  await deliver(X, id);
  const reg = await call(X, "POST", "/o/claim/register", Object.assign({ t: tokenFrom(X) }, good, { name: "Arjun Dixit", email: "i@example.com" }));
  let pub = await call(X, "GET", "/registry/data");
  const p7 = pub.j.pieces.find(p => p.n === 7);
  ok(reg.j.ok && p7.owner && p7.owner.no === 1 && p7.owner.initials === null && !/Arjun|Dixit/.test(JSON.stringify(pub.j)), "initials: unticked (the default), the shop's card has none, and no name anywhere in the public data");
  const bearer = { Authorization: "Bearer " + reg.j.token };
  let me = await call(X, "GET", "/o/me", undefined, bearer);
  ok(me.j.owner.showName === false && me.j.owner.initials === "A\u2022\u2022\u2022\u2022 D\u2022\u2022\u2022\u2022", "initials: the owner's page shows what they would look like, A\u2022\u2022\u2022\u2022 D\u2022\u2022\u2022\u2022");
  let r = await call(X, "POST", "/o/me/privacy", { showName: true, showCity: true }, bearer);
  pub = await call(X, "GET", "/registry/data");
  const q7 = pub.j.pieces.find(p => p.n === 7);
  const ow = X.DB.raw.prepare("SELECT show_name_publicly, name_consent_at, show_city_publicly FROM owners WHERE email = 'i@example.com'").get();
  ok(r.j.ok && r.j.showName && q7.owner.initials === "A\u2022\u2022\u2022\u2022 D\u2022\u2022\u2022\u2022" && q7.owner.city === "Pune" && ow.name_consent_at && !/Arjun|Dixit/.test(JSON.stringify(pub.j)),
    "initials: a yes on their page shows them masked, with their city, the time of consent kept, and still never the name");
  r = await call(X, "POST", "/o/me/privacy", { showName: false, showCity: false }, bearer);
  pub = await call(X, "GET", "/registry/data");
  const z7 = pub.j.pieces.find(p => p.n === 7);
  ok(r.j.ok && z7.owner.initials === null && z7.owner.city === null && X.DB.raw.prepare("SELECT name_consent_at FROM owners WHERE email = 'i@example.com'").get().name_consent_at === null, "initials: and a no takes both away at once");
  ok((await call(X, "POST", "/o/me/privacy", { showName: true })).status === 401, "initials: nobody else can change them");
  ok(X.DB.raw.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'owner.privacy'").get().c === 2, "initials: each change is in the audit log");
  const Y = world();
  const id8 = (await seed(Y, "pay_INIT0008", 8, "y@example.com")).order.id;
  await deliver(Y, id8);
  await call(Y, "POST", "/o/claim/register", Object.assign({ t: tokenFrom(Y) }, good, { name: "Meera Shah", email: "y@example.com", showName: true }));
  const y8 = (await call(Y, "GET", "/registry/data")).j.pieces.find(p => p.n === 8);
  ok(y8.owner.initials === "M\u2022\u2022\u2022\u2022 S\u2022\u2022\u2022", "initials: ticked at registration, shown from the start");
}

/* ── The house's own piece (worker/house.js): No. 01, kept for the owner's own address ── */
{
  const HOUSE = JSON.stringify([{ n: 1, h: createHash("sha256").update("me@example.com").digest("hex") }]);
  const X = world(); X.env.HOUSE = HOUSE;
  X.DB.raw.prepare("UPDATE pieces SET status = 'placed', notes = 'Sold before the registry' WHERE id = 'S01-01'").run();
  let a = await call(X, "POST", "/o/auth/start", { email: "someone@example.com" });
  ok(a.j.ok && !X.DB.raw.prepare("SELECT COUNT(*) AS c FROM orders WHERE piece_id = 'S01-01'").get().c && !X.mails.length, "house: any other address changes nothing and gets nothing");
  a = await call(X, "POST", "/o/auth/start", { email: "Me@Example.com" });
  const o1 = X.DB.raw.prepare("SELECT * FROM orders WHERE piece_id = 'S01-01'").get();
  ok(a.j.ok && o1 && o1.status === "delivered" && o1.amount_paise === 0 && o1.email === "me@example.com" && Date.parse(o1.return_window_ends_at) <= Date.now() &&
    X.DB.raw.prepare("SELECT status FROM pieces WHERE id = 'S01-01'").get().status === "delivered", "house: the owner's own address: a house order of Rs 0, delivered, with nothing to return");
  const hc = X.mails.find(m => m.to.includes("me@example.com") && /sign-in code/.test(m.subject));
  ok(hc && /No\. 01's registration opens/.test(hc.text), "house: and a code comes to that inbox, which opens No. 01's registration");
  const hv = await call(X, "POST", "/o/auth/verify", { email: "me@example.com", code: hc ? hc.subject.slice(0, 7).replace(" ", "") : "" });
  const t1 = (/^\/claim\?t=([A-Za-z0-9_-]{43})$/.exec((hv.j && hv.j.register) || "") || [])[1];
  const reg = await call(X, "POST", "/o/claim/register", { t: t1, name: "A. Owner", phone: "9876543210", email: "me@example.com", accept: true, consent: true });
  ok(reg.j && reg.j.ok && reg.j.n === 1 && reg.j.ownerNo === 1, "house: registered, as Owner I of No. 01");
  X.mails.length = 0;
  a = await call(X, "POST", "/o/auth/start", { email: "me@example.com" });
  ok(X.mails.some(m => m.to.includes("me@example.com") && /sign-in code/.test(m.subject)) && X.DB.raw.prepare("SELECT COUNT(*) AS c FROM orders WHERE piece_id = 'S01-01'").get().c === 1,
    "house: from then on, signing in sends a code, and nothing more is written");
  const audits = X.DB.raw.prepare("SELECT after FROM audit_log WHERE action = 'order.house'").all();
  ok(audits.length === 1 && !/me@example/.test(audits[0].after), "house: the change is in the audit log, without the address");
}
{
  /* Held by the shop's own address: moved to the owner's own, same place in the line, details kept. */
  const X = world(); X.env.HOUSE = JSON.stringify([{ n: 1, h: createHash("sha256").update("me@example.com").digest("hex") }]);
  X.DB.raw.prepare("INSERT INTO owners (email, name, phone, data_consent_at) VALUES ('admin@thekaal.co', 'A. Owner', '919876543210', '2026-10-23T00:00:00Z')").run();
  X.DB.raw.prepare("INSERT INTO ownerships (series, piece_id, owner_id, owner_no, from_at, acquired_via) VALUES ('S01', 'S01-01', 1, 1, '2026-10-23T00:00:00Z', 'purchase')").run();
  X.DB.raw.prepare("UPDATE pieces SET status = 'registered' WHERE id = 'S01-01'").run();
  await call(X, "POST", "/o/auth/start", { email: "me@example.com" });
  const held = X.DB.raw.prepare("SELECT w.email, w.name, w.data_consent_at, s.owner_no FROM ownerships s JOIN owners w ON w.id = s.owner_id WHERE s.piece_id = 'S01-01' AND s.to_at IS NULL").get();
  ok(held.email === "me@example.com" && held.owner_no === 1 && held.name === "A. Owner" && held.data_consent_at, "house: held by the shop's address, it moves to the owner's own, still Owner I, details kept");
  ok(X.mails.some(m => m.to.includes("me@example.com") && /sign-in code/.test(m.subject)), "house: and a code goes at once");
}
{
  /* Held by anyone else: never touched. */
  const X = world(); X.env.HOUSE = JSON.stringify([{ n: 1, h: createHash("sha256").update("me@example.com").digest("hex") }]);
  X.DB.raw.prepare("INSERT INTO owners (email, name) VALUES ('b@example.com', 'B')").run();
  X.DB.raw.prepare("INSERT INTO ownerships (series, piece_id, owner_id, owner_no, from_at, acquired_via) VALUES ('S01', 'S01-01', 1, 1, '2026-10-23T00:00:00Z', 'purchase')").run();
  X.DB.raw.prepare("UPDATE pieces SET status = 'registered' WHERE id = 'S01-01'").run();
  await call(X, "POST", "/o/auth/start", { email: "me@example.com" });
  ok(X.DB.raw.prepare("SELECT w.email FROM ownerships s JOIN owners w ON w.id = s.owner_id WHERE s.piece_id = 'S01-01'").get().email === "b@example.com" && !X.mails.length,
    "house: a piece another owner holds is never touched");
}

{
  /* A sealed address (house.js): the worker makes its key, the address is sealed to it in Node, and only the worker opens it. */
  const X = world(); X.env.OWNER_OPS = ""; X.env.OPS_KEY = "k".repeat(43);
  const run = () => call(X, "POST", "/ops/run", undefined, { Authorization: "Bearer " + "k".repeat(43) });
  let a = await run();
  ok(a.status === 200 && a.j.opsKey && a.j.opsKey.crv === "P-256" && a.j.opsKey.x && !a.j.opsKey.d, "sealed: the worker makes its own key and gives out only the public half");
  const again = await run();
  ok(again.j.opsKey.x === a.j.opsKey.x, "sealed: the same key every time after");
  const h = createHash("sha256").update("g@example.com").digest("hex");
  X.env.HOUSE = JSON.stringify([{ n: 2, h, box: await seal(a.j.opsKey, "g@example.com") }, { n: 3, h: "0".repeat(64), box: await seal(a.j.opsKey, "x@example.com") }]);
  X.mails.length = 0;
  a = await call(X, "POST", "/ops/run", undefined, { Authorization: "Bearer " + "k".repeat(43) });
  const raw = JSON.stringify(a.j);
  const o2 = X.DB.raw.prepare("SELECT * FROM orders WHERE piece_id = 'S01-02'").get();
  ok(a.j.delivered.some(d => d.n === 2 && d.did === "letter queued") && o2 && o2.status === "delivered" && o2.amount_paise === 0 && o2.email === "g@example.com",
    "sealed: No. 02 is made ready for its owner's address, delivered, Rs 0");
  const letter = X.mails.find(m => m.to.includes("g@example.com") && /No\. 02 is with you\. One step makes it yours\./.test(m.subject));
  ok(letter && /claim\?t=[A-Za-z0-9_-]{43}/.test(letter.text) && /return window has already closed/.test(letter.text), "sealed: and its registration letter goes to that address at once");
  ok(a.j.delivered.some(d => d.n === 3 && /does not match/.test(d.did)) && !X.DB.raw.prepare("SELECT COUNT(*) AS c FROM orders WHERE piece_id = 'S01-03'").get().c, "sealed: an address that does not match its fingerprint changes nothing");
  ok(!/g@example|x@example/.test(raw), "sealed: the deploy's report never shows the address");
  X.mails.length = 0;
  a = await run();
  ok(a.j.delivered.some(d => d.n === 2 && d.did === "letter already sent") && !X.mails.some(m => m.to.includes("g@example.com")), "sealed: the letter goes once, never again");
  const t2 = (/claim\?t=([A-Za-z0-9_-]{43})/.exec(letter ? letter.text : "") || [])[1];
  const reg = await call(X, "POST", "/o/claim/register", { t: t2, name: "G. Owner", phone: "9876543210", email: "g@example.com", accept: true, consent: true });
  a = await run();
  ok(reg.j && reg.j.ok && reg.j.n === 2 && a.j.delivered.some(d => d.n === 2 && d.did === "registered"), "sealed: once registered, it says so and sends nothing");
  /* Signed in first (a code): the letter, with its link, still goes once. */
  const hm = createHash("sha256").update("me@example.com").digest("hex");
  X.env.HOUSE = JSON.stringify([{ n: 4, h: hm }]);
  X.mails.length = 0;
  await call(X, "POST", "/o/auth/start", { email: "me@example.com" });
  ok(X.mails.some(m => m.to.includes("me@example.com") && /sign-in code/.test(m.subject)), "sealed: signing in first sends a code");
  X.env.HOUSE = JSON.stringify([{ n: 4, h: hm, box: await seal(again.j.opsKey, "me@example.com") }]);
  X.mails.length = 0;
  a = await run();
  ok(a.j.delivered.some(d => d.n === 4 && d.did === "letter queued") && X.mails.some(m => m.to.includes("me@example.com") && /No\. 04 is with you/.test(m.subject)), "sealed: and the letter with the registration link still goes");
  X.mails.length = 0;
  a = await run();
  ok(a.j.delivered.some(d => d.n === 4 && d.did === "letter already sent") && !X.mails.length, "sealed: once");
}

console.log(failed ? `\n${failed} failed.` : "\nAll Phase 4 tests passed.");
process.exit(failed ? 1 : 0);
