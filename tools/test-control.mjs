/* ══════════════════════════════════════════════════════════════════
   The control room (worker/control.js, auth.js, letters.js, outbox.js),
   tested on the real migrations in Node's SQLite.

     node --no-warnings tools/test-control.mjs
   Exits non-zero if anything fails. CI runs it on every pull request.
   ══════════════════════════════════════════════════════════════════ */
import w from "../worker/kaal-sold-sync.js";
import * as R from "../worker/registry.js";
import { totpAt, unbase32 } from "../worker/auth.js";
import { LETTERS } from "../worker/letters.js";
import { d1, kv, ctx } from "./d1-shim.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };

const DB = d1(), KV = kv(), mails = [], refunds = [], ghPuts = [];
let mailOk = true;
const ORIGIN = "https://kaal-edition-staging.kaal-edition-hq.workers.dev";
const env = {
  DB, KAAL_STATE: KV, STAGING: "", EDITION: "20", PRICE_PAISE: "599900", CURRENCY: "INR", SITE_URL: "https://thekaal.co", WORKER_URL: ORIGIN,
  ALLOW_ORIGIN: "https://thekaal.co", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "wh", RESEND_API_KEY: "re",
  OWNER_EMAIL: "Arjun@Example.com, other@example.com", ADMIN_2FA: "on", AUTH_SECRET: "a".repeat(48), GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r"
};
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes("api.resend.com")) { const m = JSON.parse(init.body); mails.push(m); return mailOk ? new Response("{}") : new Response('{"message":"down"}', { status: 500 }); }
  if (url.includes("api.github.com")) {
    if (init && init.method === "PUT") { ghPuts.push(JSON.parse(init.body).message); return new Response("{}"); }
    return new Response(JSON.stringify({ content: Buffer.from("var KAAL = {\n  sold:     [1, 2, 7],\n};").toString("base64"), sha: "x" }));
  }
  const m = /\/v1\/payments\/(pay_\w+)\/refund$/.exec(url);
  if (m) { refunds.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "rfnd_" + m[1] })); }
  return new Response("{}", { status: 404 });
};

/* A browser with a cookie jar, same-origin by default. */
let jar = "";
async function call(method, path, body, extra) {
  const h = Object.assign({ "X-KAAL": "1", Origin: ORIGIN, Cookie: jar, "cf-connecting-ip": "203.0.113.5" }, extra || {});
  let b;
  if (body instanceof Uint8Array) { b = body; } else if (body !== undefined) { b = JSON.stringify(body); h["Content-Type"] = "application/json"; }
  const k = ctx();
  const r = await w.fetch(new Request(ORIGIN + path, { method, headers: h, body: b }), env, k);
  await k.done();
  const set = r.headers.get("Set-Cookie");
  if (set) { const c = /^kaal_s=([^;]*)/.exec(set); if (c) jar = c[1] ? "kaal_s=" + c[1] : ""; }
  let j = null; const text = await r.text(); try { j = JSON.parse(text); } catch (e) { j = null; }
  return { status: r.status, j, text, headers: r.headers, cookie: set };
}
const lastCode = (to) => { const m = [...mails].reverse().find(x => x.to.includes(to) && /sign-in code/.test(x.subject)); return m ? m.subject.slice(0, 7).replace(" ", "") : ""; };

/* ── 1. Signing in ── */
{
  let r = await call("POST", "/auth/start", { email: "stranger@example.com" });
  ok(r.j.ok && mails.length === 0 && DB.raw.prepare("SELECT COUNT(*) AS c FROM login_codes").get().c === 0, "sign-in: an unknown address gets the same answer, and no code");
  r = await call("POST", "/auth/start", { email: " ARJUN@example.com " });
  const code = lastCode("arjun@example.com");
  ok(r.j.ok && /^\d{6}$/.test(code), "sign-in: the admin is emailed a six-digit code, in the subject too");
  ok(!DB.raw.prepare("SELECT code_hash FROM login_codes").get().code_hash.includes(code), "sign-in: only a keyed hash of the code is stored");
  r = await call("POST", "/auth/start", { email: "arjun@example.com" }, { "X-KAAL": "" });
  ok(r.status === 403, "sign-in: a request without the X-KAAL header (a form on another site) is refused");
  r = await call("POST", "/auth/start", { email: "arjun@example.com" }, { Origin: "https://evil.example" });
  ok(r.status === 403, "sign-in: a request from another origin is refused");

  for (let i = 0; i < 4; i++) await call("POST", "/auth/verify", { email: "arjun@example.com", code: "000000" === code ? "111111" : "000000" });
  r = await call("POST", "/auth/verify", { email: "arjun@example.com", code: "000000" === code ? "111111" : "000000" });
  ok(r.status === 401 && r.j.reason === "tries", "sign-in: five wrong tries spend the code");
  r = await call("POST", "/auth/verify", { email: "arjun@example.com", code });
  ok(r.status === 401, "sign-in: the right code after five wrong ones no longer works");

  await call("POST", "/auth/start", { email: "arjun@example.com" });
  await call("POST", "/auth/start", { email: "arjun@example.com" });
  const before = mails.length;
  await call("POST", "/auth/start", { email: "arjun@example.com" });
  ok(mails.length === before, "sign-in: at most three codes per address in fifteen minutes");
  const good = lastCode("arjun@example.com");
  r = await call("POST", "/auth/verify", { email: "arjun@example.com", code: good });
  ok(r.j.ok && r.j.role === "admin" && r.j.mfa === "enroll" && /HttpOnly; Secure; SameSite=Strict/.test(r.cookie), "sign-in: the admin is in, with a strict HttpOnly cookie, and must set up the authenticator");
  const sess = DB.raw.prepare("SELECT id FROM sessions").get().id;
  ok(!jar.includes(sess) && /^[0-9a-f]{64}$/.test(sess), "sign-in: the database holds the session's hash, never the cookie's token");
  const jar1 = jar;
  r = await call("POST", "/auth/verify", { email: "arjun@example.com", code: good });
  ok(r.status === 401 && r.j.reason === "expired", "sign-in: a code works once");
  jar = jar1;
}

/* ── 2. The authenticator ── */
let secret;
{
  let r = await call("GET", "/control/api/overview");
  ok(r.status === 401 && r.j.reason === "mfa", "control: nothing opens before the authenticator's code");
  r = await call("POST", "/auth/totp/enroll", {});
  ok(r.j.ok && /^otpauth:\/\/totp\/KAAL:arjun%40example\.com\?secret=[A-Z2-7]{32}&issuer=KAAL/.test(r.j.uri), "authenticator: a secret to add, as a link an app opens");
  secret = unbase32(r.j.key);
  ok(!/[A-Z2-7]{32}/.test(DB.raw.prepare("SELECT totp_secret_enc FROM owners").get().totp_secret_enc), "authenticator: the secret is stored sealed, not readable");
  r = await call("POST", "/auth/totp", { code: "123456" === await totpAt(secret, Math.floor(Date.now() / 30000)) ? "654321" : "123456" });
  ok(r.status === 401 && r.j.reason === "wrong", "authenticator: a wrong code is refused");
  const right = await totpAt(secret, Math.floor(Date.now() / 30000));
  r = await call("POST", "/auth/totp", { code: right });
  ok(r.j.ok, "authenticator: the right code opens the control room");
  r = await call("GET", "/control/api/overview");
  ok(r.j.ok && r.j.size === 20 && r.j.pieces.length === 20, "control: the overview, twenty pieces");
  r = await call("POST", "/auth/totp", { code: right });
  ok(r.status === 401 && r.j.reason === "used", "authenticator: the same code cannot be used twice");
}

/* ── 3. The page ── */
{
  const r = await call("GET", "/control");
  const csp = r.headers.get("Content-Security-Policy") || "";
  const nonce = (/'nonce-([^']+)'/.exec(csp) || [])[1];
  ok(r.status === 200 && nonce && r.text.includes(`<script nonce="${nonce}">`) && /frame-ancestors 'none'/.test(csp) && !/unsafe-inline'[^;]*script/.test(csp),
    "page: served with a nonce CSP that runs only its own script");
  ok(!r.text.includes("${") && (r.text.match(/<script/g) || []).length === 1, "page: no template left unfilled, one script");
  ok(!/—/.test(r.text), "page: no em dashes");
}

/* ── 4. The orders pipeline ── */
const seed = async (id, n, email) => R.recordPayment(env, { series: "S01", n, paymentId: id, orderId: "order_" + id, amount: 599900, email, phone: "9876543210",
  name: "Asha Rao", address: { line1: "1 Road", city: "Pune", state: "Maharashtra", pin: "411001" }, paidAt: new Date().toISOString() });
let oid;
{
  oid = (await seed("pay_P1", 7, "asha@example.com")).order.id;
  mails.length = 0;
  let r = await call("GET", "/control/api/orders");
  const o = r.j.orders.find(x => x.id === oid);
  ok(o && o.status === "placed" && o.next === "inspected", "orders: a paid order waits at Placed, Inspected next");
  r = await call("POST", `/control/api/orders/${oid}/stage`, { to: "packed" });
  ok(r.status === 409, "orders: a stage cannot be skipped");
  r = await call("POST", `/control/api/orders/${oid}/stage`, { to: "inspected" });
  const ins = mails.find(m => m.to.includes("asha@example.com"));
  ok(r.j.ok && r.j.letter === "queued" && ins && ins.subject === "No. 07 has passed inspection", "Inspected: saved, and the buyer's email goes at once");
  ok(ins && ins.text.includes("Today it was No. 07's turn: the time, the day and date, the 24-hour hand, the crown, the bracelet, the finish. It passed.") && /^Owner,/.test(ins.text) && /\nKAAL\n/.test(ins.text) && /\nFollow No\. 07's journey: https:\/\/thekaal\.co\/track\?o=\d+&s=[0-9a-f]{24}\n$/.test(ins.text),
    "Inspected: the brief's words, verbatim, signed KAAL, ending with the quiet link to follow its journey");
  ok(ins && /background:#F4F1EA/.test(ins.html) && (ins.html.match(/<a /g) || []).length <= 1 && !/<img/.test(ins.html), "Inspected: the light layout, no image, one link at most");
  r = await call("POST", `/control/api/orders/${oid}/stage`, { to: "inspected" });
  ok(r.status === 409 && mails.filter(m => /passed inspection/.test(m.subject)).length === 1, "Inspected twice: refused, and one email only");
  await call("POST", `/control/api/orders/${oid}/stage`, { to: "packed" });
  r = await call("POST", `/control/api/orders/${oid}/stage`, { to: "dispatched", courier: "Delhivery", tracking: "DL123" });
  ok(r.status === 400, "Dispatched: refused without a tracking link");
  r = await call("POST", `/control/api/orders/${oid}/stage`, { to: "dispatched", courier: "Delhivery", tracking: "DL123", url: "javascript:alert(1)" });
  ok(r.status === 400, "Dispatched: a link that is not https:// is refused");
  r = await call("POST", `/control/api/orders/${oid}/stage`, { to: "dispatched", courier: "Delhivery", tracking: "DL123", url: "https://www.delhivery.com/track/package/DL123" });
  const dis = mails.find(m => m.subject === "No. 07 is on its way to you");
  ok(r.j.ok && dis && dis.text.includes("No. 07 has left us. It travels with Delhivery, tracking number DL123.") && dis.html.includes('href="https://www.delhivery.com/track/package/DL123"'),
    "Dispatched: courier, number and the one button to follow it");
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  r = await call("POST", `/control/api/orders/${oid}/stage`, { to: "delivered", day: future });
  ok(r.status === 400, "Delivered: not a day in the future");
  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  r = await call("POST", `/control/api/orders/${oid}/stage`, { to: "delivered", day: today });
  const row = DB.raw.prepare("SELECT delivered_on, return_window_ends_at FROM orders WHERE id = ?").get(oid);
  const want = new Date(Date.parse(today + "T23:59:59.000+05:30") + 7 * 86400000).toISOString();
  ok(r.j.ok && r.j.letter === "queued" && row.delivered_on === today && row.return_window_ends_at === want, "Delivered: the date, and the return window to 23:59:59 India time seven days on");
  const del = mails.find(m => m.subject === "No. 07 is with you. One step makes it yours.");
  const tok = del && (/claim\?t=([A-Za-z0-9_-]{43})/.exec(del.text) || [])[1];
  ok(tok && DB.raw.prepare("SELECT COUNT(*) AS c FROM claim_tokens WHERE order_id = ? AND used_at IS NULL").get(oid).c === 1, "Delivered: the registration link goes in the email, and only its hash is kept");
  ok(tok && !DB.raw.prepare("SELECT payload FROM email_outbox WHERE dedupe_key = ?").get(`stage:${oid}:delivered`).payload.includes(tok), "Delivered: once sent, the link is scrubbed from the outbox");
  ok(DB.raw.prepare("SELECT status FROM pieces WHERE id = 'S01-07'").get().status === "delivered", "Delivered: the piece is delivered");

  /* Corrections, without email, and never a second stage email. */
  mails.length = 0;
  r = await call("POST", `/control/api/orders/${oid}/stage`, { to: "dispatched", silent: true });
  ok(r.status === 400, "correction: needs a reason");
  r = await call("POST", `/control/api/orders/${oid}/stage`, { to: "dispatched", silent: true, reason: "Marked delivered by mistake" });
  ok(r.j.ok && mails.length === 0 && DB.raw.prepare("SELECT status FROM pieces WHERE id = 'S01-07'").get().status === "placed", "correction: back to Dispatched, no email, the piece follows");
  await call("POST", `/control/api/orders/${oid}/stage`, { to: "delivered", day: today });
  ok(mails.length === 0, "correction: going forward again never sends the same stage's email twice");
  const aud = DB.raw.prepare("SELECT action, before, after FROM audit_log WHERE target = ? ORDER BY id").all("order:" + oid);
  ok(aud.length >= 6 && aud.some(a => a.action === "order.correct" && /Marked delivered by mistake/.test(a.after)) && aud.every(a => a.before), "audit: every stage action, with before and after, and the correction's reason");

  /* Returned, then refunded. */
  r = await call("POST", `/control/api/orders/${oid}/returned`, { reason: "Did not suit" });
  ok(r.j.ok && DB.raw.prepare("SELECT COUNT(*) AS c FROM blocked_buyers WHERE email = 'asha@example.com'").get().c === 1, "Returned: inside the window, and the buyer is never sold to again");
  r = await call("POST", `/control/api/orders/${oid}/refund`, { confirm: "08" });
  ok(r.status === 400 && refunds.length === 0, "Refund: refused unless the number is typed");
  r = await call("POST", `/control/api/orders/${oid}/refund`, { confirm: "07", reason: "return" });
  ok(r.j.ok && refunds.length === 1 && refunds[0].amount === 599900 && refunds[0].notes.reason === "return", "Refund: the full amount, through Razorpay, once");
  r = await call("POST", `/control/api/orders/${oid}/refund`, { confirm: "07" });
  ok(r.status === 409 && refunds.length === 1, "Refund: never twice");

  const o2 = (await seed("pay_P2", 8, "late@example.com")).order.id;
  DB.raw.prepare("UPDATE orders SET status = 'delivered', delivered_on = '2026-09-01', return_window_ends_at = '2026-09-08T18:29:59.000Z' WHERE id = ?").run(o2);
  r = await call("POST", `/control/api/orders/${o2}/returned`, {});
  ok(r.status === 409, "Returned: refused once the seven days are over");
}

/* ── 5. Stage emails off, and the outbox under failure ── */
{
  let r = await call("POST", "/control/api/settings", { settings: { stage_emails: "0" } });
  const o3 = (await seed("pay_P3", 11, "quiet@example.com")).order.id;
  mails.length = 0;
  await call("POST", `/control/api/orders/${o3}/stage`, { to: "inspected" });
  ok(r.j.ok && mails.length === 0, "settings: stage emails off, a stage change sends nothing");
  await call("POST", "/control/api/settings", { settings: { stage_emails: "1" } });

  mailOk = false; mails.length = 0;
  r = await call("POST", `/control/api/orders/${o3}/stage`, { to: "packed" });
  const q = DB.raw.prepare("SELECT * FROM email_outbox WHERE dedupe_key = ?").get(`stage:${o3}:packed`);
  ok(r.j.ok && q.status === "queued" && q.attempts === 1 && q.last_error && mails.length === 1, "outbox: the provider fails; the stage is saved anyway, the email waits with its error");
  const realNow = Date.now;
  Date.now = () => realNow() + 10 * 60000;
  mailOk = true;
  let k = ctx(); await w.scheduled({}, env, k); await k.done();
  ok(DB.raw.prepare("SELECT status, attempts FROM email_outbox WHERE id = ?").get(q.id).status === "sent", "outbox: retried with backoff on the next run, and sent");
  mailOk = false;
  const o4 = (await seed("pay_P4", 12, "dead@example.com")).order.id;
  await call("POST", `/control/api/orders/${o4}/stage`, { to: "inspected" });
  const qid = DB.raw.prepare("SELECT id FROM email_outbox WHERE dedupe_key = ?").get(`stage:${o4}:inspected`).id;
  for (let i = 1; i <= 7; i++) { Date.now = () => realNow() + i * 7 * 3600000; k = ctx(); await w.scheduled({}, env, k); await k.done(); }
  ok(DB.raw.prepare("SELECT status FROM email_outbox WHERE id = ?").get(qid).status === "failed", "outbox: after six tries it is marked failed, for the owner to see");
  Date.now = realNow; mailOk = true;
  r = await call("GET", "/control/api/overview");
  ok(r.j.emails.failed === 1 && r.j.health.some(h => h.label === "Emails" && !h.ok), "overview: the failed email shows, and Health says so");
  r = await call("POST", `/control/api/emails/${qid}/retry`, {});
  ok(r.j.ok && DB.raw.prepare("SELECT status FROM email_outbox WHERE id = ?").get(qid).status === "sent", "Emails: Retry sends it now");
}

/* ── 6. Pieces and their photographs ── */
{
  let r = await call("POST", "/control/api/pieces/S01-09", { status: "available" });
  ok(r.status === 400, "pieces: a status override needs a reason");
  ghPuts.length = 0;
  r = await call("POST", "/control/api/pieces/S01-07", { status: "available", reason: "Returned and inspected, back on sale" });
  ok(r.j.ok && ghPuts.some(m => /number 7 back on sale/.test(m)), "pieces: back on sale also takes it off the live site's sold list");
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0]);
  r = await call("POST", "/control/api/pieces/S01-07/photo", jpeg, { "Content-Type": "image/png" });
  ok(r.status === 415, "photo: bytes that are not what they claim are refused");
  r = await call("POST", "/control/api/pieces/S01-07/photo", new Uint8Array([60, 115, 99, 114, 105, 112, 116, 62]), { "Content-Type": "image/svg+xml" });
  ok(r.status === 415, "photo: SVG (which can carry script) is refused");
  r = await call("POST", "/control/api/pieces/S01-07/photo", jpeg, { "Content-Type": "image/jpeg" });
  ok(r.j.ok && /\/photo\/S01-07\?v=/.test(r.j.url), "photo: a JPEG of the watch is kept");
  const pub = await w.fetch(new Request(ORIGIN + "/photo/S01-07"), env, ctx());
  ok(pub.status === 200 && pub.headers.get("Content-Type") === "image/jpeg" && pub.headers.get("X-Content-Type-Options") === "nosniff", "photo: served publicly as an image, nosniff");
  ok((await w.fetch(new Request(ORIGIN + "/photo/..%2Fsecret"), env, ctx())).status === 404, "photo: nothing else can be fetched through it");
}

/* ── 7. Owners, settings, blocked, exports ── */
{
  DB.raw.exec("INSERT INTO owners (email, name) VALUES ('=cmd@example.com', '=HYPERLINK(\"x\")'), ('taken@example.com', 'T')");
  const id = DB.raw.prepare("SELECT id FROM owners WHERE email = '=cmd@example.com'").get().id;
  DB.raw.prepare("INSERT INTO sessions (id, owner_id, expires_at) VALUES ('f'||hex(randomblob(31)), ?, '2099-01-01T00:00:00Z')").run(id);
  let r = await call("POST", `/control/api/owners/${id}`, { email: "taken@example.com" });
  ok(r.status === 409, "owners: an email another owner signs in with is refused");
  r = await call("POST", `/control/api/owners/${id}`, { email: "new@example.com", phone: "98765 43210" });
  ok(r.j.ok && DB.raw.prepare("SELECT COUNT(*) AS c FROM sessions WHERE owner_id = ? AND revoked_at IS NULL").get(id).c === 0, "owners: a new sign-in address signs every device out");
  r = await call("POST", "/control/api/settings", { series: { code: "S01", return_days: 3, warranty_months: 24 } });
  ok(r.status === 400, "settings: fewer than seven return days is refused");
  r = await call("POST", "/control/api/blocked", { email: "x@example.com" });
  ok(r.status === 400, "blocked: needs a reason");
  r = await call("POST", "/control/api/blocked", { phone: "+91 98111 11111", reason: "chargeback" });
  ok(r.j.ok && await R.isBlocked(env, "", "9811111111"), "blocked: added, and checkout refuses that phone");
  r = await call("GET", "/control/api/export/owners.csv");
  ok(/'=HYPERLINK/.test(r.text) && !/,=HYPERLINK/.test(r.text), "export: a name typed as a formula stays text in a spreadsheet");
  r = await call("GET", "/control/api/backup");
  const dump = JSON.parse(r.text);
  ok(dump.tables.orders.length >= 4 && !("sessions" in dump.tables) && !("login_codes" in dump.tables) && dump.tables.owners.every(o => !o.totp_secret_enc || o.totp_secret_enc === "(withheld)"),
    "backup: every table, never the sessions, codes or the authenticator secret");
}

/* ── 8. Who may not ── */
{
  const saved = jar;
  jar = "";
  const other = { "cf-connecting-ip": "198.51.100.77" };
  let r = await call("GET", "/control/api/orders");
  ok(r.status === 401, "control: signed out, nothing");
  DB.raw.exec("INSERT INTO owners (email, name) VALUES ('owner@example.com', 'An Owner')");
  await call("POST", "/auth/start", { email: "owner@example.com" }, other);
  r = await call("POST", "/auth/verify", { email: "owner@example.com", code: lastCode("owner@example.com") }, other);
  ok(r.j.ok && r.j.role === "owner", "an owner can sign in");
  r = await call("GET", "/control/api/orders");
  ok(r.status === 403 && r.j.reason === "not-admin", "an owner cannot open the control room");
  r = await call("POST", "/auth/totp/enroll", {});
  ok(r.status === 403, "an owner cannot make themselves an authenticator");
  jar = saved;
  const seen = [];
  for (let i = 0; i < 6; i++) { r = await call("POST", "/auth/totp", { code: "000000" }, { "cf-connecting-ip": "198.51.100.78" }); seen.push(r.j.reason); }
  ok(seen.includes("locked") && seen.indexOf("locked") <= 4, "authenticator: wrong codes are counted, and the fifth locks: " + seen.join(","));
  r = await call("GET", "/control/api/overview");
  ok(r.status === 401, "authenticator: five wrong codes end the session");
  const off = await w.fetch(new Request(ORIGIN + "/control"), Object.assign({}, env, { DB: undefined }), ctx());
  ok(off.status === 503, "production without the registry: the control room is not there");
  const offJ = await off.json();
  ok(/mode live/.test(offJ.why) && !/mode staging/.test(offJ.why) && /Mode deploy does not create it/.test(offJ.why), "production without the registry: the reply names mode live, and says deploy is not enough");
  const offPage = await w.fetch(new Request(ORIGIN + "/control", { headers: { Accept: "text/html" } }), Object.assign({}, env, { DB: undefined }), ctx());
  const offHtml = await offPage.text();
  ok(offPage.status === 503 && /text\/html/.test(offPage.headers.get("content-type")) && /not switched on/.test(offHtml) && /mode live/.test(offHtml), "a browser sees a page, not raw JSON, and it says what to run");
  const offStg = await (await w.fetch(new Request(ORIGIN + "/control"), Object.assign({}, env, { DB: undefined, STAGING: "on" }), ctx())).json();
  ok(/mode staging/.test(offStg.why), "staging without the registry: the reply names mode staging");
  const offSw = await (await w.fetch(new Request(ORIGIN + "/control"), Object.assign({}, env, { REGISTRY: "off" }), ctx())).json();
  ok(/REGISTRY is "off"/.test(offSw.why), "the off switch is named when it is the reason");
}

/* ── 9. The letters are the brief's ── */
{
  const d = { n: 7, size: 20, courier: "Delhivery", tracking: "DL1", trackingUrl: "https://x.example/t", claimUrl: "https://thekaal.co/claim?t=x", ownerNo: 1, registeredOn: "26 October 2026", warrantyEnd: "24 October 2028" };
  const want = {
    placed: ["No. 07 is spoken for", "Your payment is received and No. 07 of 20 is now set aside for you alone. Before it leaves, it will be inspected again, boxed by hand and sent to you within five days. You will hear from us at each step."],
    packed: ["No. 07 is boxed", "Every KAAL box is made for the one piece it carries. No. 07's is finished, and the piece is resting inside it with its letter."],
    dispatched: ["No. 07 is on its way to you", "Somewhere between here and you is a piece that will not be made again. When it arrives, open it slowly."],
    delivered: ["No. 07 is with you. One step makes it yours.", "One step remains. Registering writes you into the KAAL registry as Owner I of No. 07 of 20. That record stays with this piece for as long as it exists. It also opens your owner dashboard: your 2-year warranty counting down to the second, the piece's history, and its transfer if you ever pass it on."],
    reminder: ["No. 07 has no name beside it yet", "No. 07 has been with you for three days. Its place in the registry is still empty."],
    registered: ["No. 07 is recorded in your name", "It is done. You are Owner I of No. 07, recorded on 26 October 2026. Your warranty runs until 24 October 2028."]
  };
  for (const k of Object.keys(want)) {
    const m = LETTERS[k](d);
    ok(m.subject === want[k][0] && m.text.includes(want[k][1]) && m.html.includes(want[k][1].replace(/'/g, "&#39;")), `letter ${k}: the brief's subject and words`);
  }
  ok(Object.keys(LETTERS).every(k => !/—/.test(LETTERS[k](d).text + LETTERS[k](d).html)), "letters: no em dashes, no emojis by construction");
}

/* ── 10. The emailed code alone (the default: ADMIN_2FA off) ── */
{
  const keep = { env: env.ADMIN_2FA, jar };
  const ip = { "cf-connecting-ip": "198.51.100.91" };
  delete env.ADMIN_2FA;
  DB.raw.prepare("DELETE FROM login_codes").run();
  jar = "";
  let r = await call("GET", "/control/api/overview", undefined, ip);
  ok(r.status === 401 && r.j.reason === "signed-out", "code only: signed out, nothing opens");
  await call("POST", "/auth/start", { email: "arjun@example.com" }, ip);
  r = await call("POST", "/auth/verify", { email: "arjun@example.com", code: lastCode("arjun@example.com") }, ip);
  ok(r.j.ok && r.j.role === "admin" && r.j.mfa === "none", "code only: the admin's emailed code signs in with no second step");
  r = await call("GET", "/control/api/overview", undefined, ip);
  ok(r.j.ok && r.j.pieces.length === 20, "code only: the control room opens on the code alone");
  r = await call("POST", "/auth/me", {}, ip);
  ok(r.j.ok && r.j.role === "admin" && r.j.mfa === true, "code only: the page is told it is already in");
  r = await call("POST", "/auth/verify", { email: "arjun@example.com", code: "000000" }, ip);
  ok(r.status === 401, "code only: a wrong or spent code still gets nothing");
  const saved = jar;
  jar = "";
  r = await call("POST", "/auth/verify", { email: "arjun@example.com", code: "000000" }, ip);
  r = await call("GET", "/control/api/overview", undefined, ip);
  ok(r.status === 401, "code only: a wrong code leaves the visitor signed out");
  jar = saved;
  env.ADMIN_2FA = "on";
  r = await call("GET", "/control/api/overview", undefined, ip);
  ok(r.status === 401 && r.j.reason === "mfa", "switching ADMIN_2FA on asks the authenticator of a session that has not given it");
  env.ADMIN_2FA = keep.env; jar = keep.jar;
}

console.log(failed ? `\n${failed} failed.` : "\nAll control room tests passed.");
process.exit(failed ? 1 : 0);
