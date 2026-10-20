/* ══════════════════════════════════════════════════════════════════
   The money path, tested without money.

   Runs the worker (worker/kaal-sold-sync.js) in plain Node against fake
   Razorpay, GitHub and Resend endpoints, and checks every promise this
   shop makes after a payment: the buyer is sent to their receipt, the
   receipt tells the truth, the address reaches the owner, and the owner
   and the buyer each get exactly one email, at once.

   Node's standard library only, like tools/check.mjs: nothing to install.
     node tools/test-worker.mjs
   Exits non-zero if anything fails. CI runs it on every pull request.
   ══════════════════════════════════════════════════════════════════ */
import { createHmac } from "node:crypto";
import w from "../worker/kaal-sold-sync.js";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };

function kv() {
  const store = new Map(), ttl = new Map();
  return {
    store, ttl,
    async get(k, t) { const v = store.has(k) ? store.get(k) : null; return v === null ? null : (t === "json" ? JSON.parse(v) : v); },
    async put(k, v, o) { store.set(k, v); ttl.set(k, o && o.expirationTtl); }, async delete(k) { store.delete(k); ttl.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; }
  };
}
/* waitUntil work is collected and awaited, the way a Worker finishes it
   after the response has gone. */
function ctx() { const jobs = []; return { jobs, waitUntil: p => jobs.push(p), done: () => Promise.all(jobs) }; }

const KV = kv();
const DIALS = JSON.stringify({ "3": "Emerald", "9": "Midnight" });
const env = {
  KAAL_STATE: KV, EDITION: "20", ALLOW_ORIGIN: "https://thekaal.co", RAZORPAY_KEY_ID: "rzp", RAZORPAY_KEY_SECRET: "sek",
  RESEND_API_KEY: "re", OWNER_EMAIL: "owner@thekaal.co, me@example.org", SITE_URL: "https://thekaal.co", DIALS,
  RAZORPAY_WEBHOOK_SECRET: "wh", GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", PRICE_PAISE: "599900"
};

const mails = [];
let orderStatus = "paid", payStatus = "captured", ghSold = "[1, 2]";
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes("api.resend.com")) { mails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url.includes("api.github.com")) {
    if (init && init.method === "PUT") return new Response("{}");
    const content = Buffer.from(`var KAAL = { edition:  20,\n  sold:     ${ghSold},\n};`).toString("base64");
    return new Response(JSON.stringify({ content, sha: "x" }));
  }
  if (/\/v1\/refunds\?/.test(url)) return new Response(JSON.stringify({ items: [] }));
  let m = /\/orders\/(order_\w+)\/payments/.exec(url);
  if (m) return new Response(JSON.stringify({ items: [{ id: "pay_ABC123", status: payStatus, email: "rahul.sharma@example.com", contact: "+919999999999", created_at: 1790000000 }] }));
  m = /\/orders\/(order_\w+)$/.exec(url);
  if (m) return new Response(JSON.stringify({ id: m[1], status: orderStatus, amount: 599900, currency: "INR", created_at: 1790000000,
    notes: { kaal_no: m[1] === "order_TESTORDER1" ? "09" : "03", gift: "yes", gift_note: "For <R> & me" } }));
  return new Response("{}", { status: 404 });
};

/* ── 1. Getting the buyer home after paying ── */
const form = (o) => { const f = new FormData(); for (const k in o) f.append(k, o[k]); return f; };
const sig = createHmac("sha256", "sek").update("order_TESTORDER1|pay_ABC123").digest("hex");
let r = await w.fetch(new Request("https://w/callback", { method: "POST", body: form({ razorpay_payment_id: "pay_ABC123", razorpay_order_id: "order_TESTORDER1", razorpay_signature: sig }) }), env, ctx());
ok(r.status === 303 && r.headers.get("Location") === "https://thekaal.co/claimed.html?razorpay_payment_id=pay_ABC123&o=order_TESTORDER1&n=09", "callback: a verified payment is sent to its receipt");
r = await w.fetch(new Request("https://w/callback", { method: "POST", body: form({ razorpay_payment_id: "pay_ABC123", razorpay_order_id: "order_TESTORDER1", razorpay_signature: "bad" }) }), env, ctx());
ok(r.headers.get("Location") === "https://thekaal.co/?checkout=failed#twenty", "callback: a bad signature goes back to the twenty, failed");

/* ── 2. The receipt ── */
r = await w.fetch(new Request("https://w/receipt?o=order_TESTORDER1", { headers: { Origin: "https://thekaal.co" } }), env, ctx());
let d = await r.json();
ok(d.ok && d.paid && d.n === 9 && d.payment_id === "pay_ABC123" && d.gift === true, "receipt: paid, number, reference, gift");
ok(d.mail === true && d.email_hint === "ra•••@example.com" && !JSON.stringify(d).includes("rahul.sharma"), "receipt: says a confirmation is coming, with the address masked");
r = await w.fetch(new Request("https://w/receipt?o=order_TESTORDER1"), Object.assign({}, env, { RESEND_API_KEY: "" }), ctx());
ok((await r.json()).mail === false, "receipt: never claims an email when none can be sent");
r = await w.fetch(new Request("https://w/receipt?o=../../x"), env, ctx());
ok(r.status === 400, "receipt: a malformed order id is refused");
r = await w.fetch(new Request("https://w/state", { headers: { Origin: "https://thekaal.co" } }), env, ctx());
ok((await r.json()).v === 3, "state: announces v3 with its store, so the page asks for details before paying");
r = await w.fetch(new Request("https://w/state", { headers: { Origin: "https://thekaal.co" } }), Object.assign({}, env, { KAAL_STATE: undefined }), ctx());
ok((await r.json()).v === 2, "state: without a store it stays v2: nowhere to keep details, so the page does not ask for them");

/* ── 3. The delivery address ── */
const ship = { o: "order_TESTORDER1", name: "Ravi Kumar", phone: "+91 98765 43210", line1: "12 Park <Street>", line2: "", city: "Kolkata", state: "West Bengal", pin: "700016" };
mails.length = 0;
r = await w.fetch(new Request("https://w/shipping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({}, ship, { pin: "7001" })) }), env, ctx());
ok(r.status === 400, "shipping: an incomplete address is refused");
let c = ctx();
r = await w.fetch(new Request("https://w/shipping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ship) }), env, c);
await c.done(); d = await r.json();
ok(d.ok && JSON.parse(KV.store.get("ship:order_TESTORDER1")).pin === "700016", "shipping: stored for a paid order");
const toOwner = mails.find(m => /Ship to · No\. 09/.test(m.subject));
ok(toOwner && toOwner.to.join() === "owner@thekaal.co,me@example.org" && /Kolkata, West Bengal 700016/.test(toOwner.text) && /Card: "For <R> & me"/.test(toOwner.text), "shipping: owner (both inboxes) told where to ship, with the gift card");
ok(toOwner && /12 Park &lt;Street&gt;/.test(toOwner.html) && !/<Street>/.test(toOwner.html) && /For &lt;R&gt; &amp; me/.test(toOwner.html), "shipping: what the buyer typed is escaped in the HTML");
ok(toOwner && toOwner.reply_to === "rahul.sharma@example.com", "shipping: the owner can reply straight to the buyer");
const toBuyer = mails.find(m => m.to[0] === "rahul.sharma@example.com");
ok(toBuyer && toBuyer.subject === "No. 09 will come to you here" && toBuyer.html && /caseback-09\.png/.test(toBuyer.html), "shipping: buyer gets the address back, with their engraved number");
orderStatus = "created"; payStatus = "failed";
r = await w.fetch(new Request("https://w/shipping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({}, ship, { o: "order_UNPAID001" })) }), env, ctx());
ok(r.status === 409, "shipping: refused for an unpaid order");

/* ── 4. The moment of payment: the webhook ── */
orderStatus = "paid"; payStatus = "captured"; mails.length = 0; KV.store.set("sold", "[1,2]"); KV.store.delete("ship:order_TESTORDER2");
const entity = { id: "pay_WEBHOOK1", order_id: "order_TESTORDER2", amount: 599900, currency: "INR", email: "rahul.sharma@example.com", contact: "+919999999999", created_at: 1790000000, notes: { kaal_no: "03" } };
const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity } } });
const hook = (b = body, e = env) => { const k = ctx(); return w.fetch(new Request("https://w/", { method: "POST", headers: { "x-razorpay-signature": createHmac("sha256", "wh").update(b).digest("hex") }, body: b }), e, k).then(async res => { await k.done(); return res; }); };
r = await hook();
ok(r.status === 200 && mails.length === 2, "webhook: sale recorded, two emails sent");
const sale = mails.find(m => /^New order · No\. 03 Emerald · ₹5,999$/.test(m.subject));
ok(sale && sale.to.join() === "owner@thekaal.co,me@example.org" && /Buyer email: rahul.sharma@example.com/.test(sale.text) && /wa\.me\/919999999999/.test(sale.text) && /dashboard\.razorpay\.com\/app\/payments\/pay_WEBHOOK1/.test(sale.text), "owner email: number, dial, buyer contact, WhatsApp and Razorpay links");
ok(sale && sale.reply_to === "rahul.sharma@example.com" && /<html/.test(sale.html), "owner email: branded HTML, and Reply writes to the buyer");
const mine = mails.find(m => m.to[0] === "rahul.sharma@example.com");
ok(mine && mine.subject === "No. 03 is yours" && /caseback-03\.png/.test(mine.html) && /claimed\.html\?o=order_TESTORDER2&n=03#ship/.test(mine.text) && /Arrives by:/.test(mine.text), "buyer email: engraved number, arrival date, address link");
ok(mine && mine.reply_to === "connect@thekaal.co", "buyer email: replies go to the shop");
ok(!/—/.test(mails.map(m => m.text + m.subject + m.html).join("")), "no em dashes in any email");
let before = mails.length; await hook();
ok(mails.length === before, "webhook retry: no second pair of emails");

/* Emails do not wait on, or depend on, recording the sale in GitHub. */
mails.length = 0; ghSold = "[1, 2, 3, 9]";
const e2 = Object.assign({}, entity, { id: "pay_WEBHOOK2", notes: { kaal_no: "09" } });
const b2 = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: e2 } } });
r = await hook(b2);
ok(/already recorded/.test(await r.text()) && mails.length === 2, "webhook: a sale already recorded still sends its emails, once");

/* A payment whose number cannot be read still reaches the owner. */
mails.length = 0;
const e3 = Object.assign({}, entity, { id: "pay_WEBHOOK3", order_id: undefined, notes: {} });
const b3 = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: e3 } } });
await hook(b3);
ok(mails.length === 1 && /number unknown/.test(mails[0].subject) && mails[0].to[0] === "owner@thekaal.co", "webhook: an unreadable number alerts the owner, and only the owner");

r = await w.fetch(new Request("https://w/", { method: "POST", headers: { "x-razorpay-signature": "nope" }, body }), env, ctx());
ok(r.status === 400, "webhook: a bad signature is refused and sends nothing");

/* ── 5. Series 02 list ── */
const post = (path, b, ip = "1.1.1.1") => w.fetch(new Request("https://w" + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://thekaal.co", "cf-connecting-ip": ip }, body: JSON.stringify(b) }), env, ctx());
r = await post("/list", { email: "Asha@Example.com ", source: "footer" });
ok(r.status === 200 && (await r.json()).ok, "/list accepts a valid address");
r = await post("/list", { email: "not-an-email" });
ok(r.status === 400, "/list refuses an invalid address");

/* ── 6. The daily count ── */
const { Stats } = await import("../worker/kaal-sold-sync.js");
const dobox = new Map();
const statsObj = new Stats({ storage: { async get(k) { return dobox.get(k); }, async put(k, v) { dobox.set(k, JSON.parse(JSON.stringify(v))); } } });
const STATS = { idFromName: () => "kaal", get: () => ({ fetch: (u, i) => statsObj.fetch(new Request(u, i)) }) };
const envC = Object.assign({}, env, { STATS });
const beacon = (body, origin = "https://thekaal.co", ua = "Mozilla/5.0 (iPhone)") => {
  const k = ctx();
  return w.fetch(new Request("https://w/e", { method: "POST", headers: { Origin: origin, "User-Agent": ua, "Content-Type": "text/plain" }, body: JSON.stringify(body) }), envC, k).then(async res => { await k.done(); return res; });
};
const realNow = Date.now;
Date.now = () => Date.parse("2026-10-06T08:00:00Z");                         /* 13:30 in India, 6 Oct */
r = await beacon({ c: { visit: 1, visitor: 1, view: 1, number: 2, checkout: 1, hero_complete: 1 } });
await beacon({ c: { visit: 1, number: 999, evil: 5, "__proto__": 3 } });       /* capped, unknown names dropped */
await beacon({ c: { visit: 1, visitor: 1 } }, "https://evil.example");          /* wrong origin: ignored */
await beacon({ c: { visit: 1, visitor: 1 } }, "https://thekaal.co", "Googlebot/2.1");
let day6 = dobox.get("d:2026-10-06") || {};
ok(r.status === 204 && day6.visit === 2 && day6.visitor === 1 && day6.number === 12 && day6.checkout === 1 && !day6.evil, "count: tallied per India day, capped at 10 a beacon, unknown names, other sites and robots ignored");
r = await w.fetch(new Request("https://w/e", { method: "POST", headers: { Origin: "https://thekaal.co" }, body: "{" }), env, ctx());
ok(r.status === 204, "count: without the store, or with a broken body, it answers 204 and keeps nothing");

/* ── 7. The morning report ── */
mails.length = 0;
dobox.set("d:2026-10-05", { visit: 40, visitor: 31, number: 3, checkout: 1 });
KV.store.set("list:aaa", JSON.stringify({ email: "lead.one@example.com", at: "2026-10-06T06:30:00Z", source: "footer" }));
KV.store.set("list:bbb", JSON.stringify({ email: "old.lead@example.com", at: "2026-09-20T06:30:00Z", source: "identity" }));
KV.store.set("sold", "[1,2,3,9]");
const at6 = (h, m) => Math.floor(Date.parse(`2026-10-06T${h}:${m}:00Z`) / 1000);
const digestFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (/\/v1\/payments\?/.test(url)) return new Response(JSON.stringify({ items: [
    { id: "pay_D1", status: "captured", order_id: "order_D1", amount: 599900, email: "buyer.d1@example.com", contact: "+919876500001", created_at: at6("09", "15"), notes: { kaal_no: "03" } },
    { id: "pay_F1", status: "failed", order_id: "order_F1", amount: 599900, email: "nearly@example.com", contact: "+919876500002", created_at: at6("10", "05"), error_description: "Bank declined", notes: {} },
    { id: "pay_OLD", status: "captured", order_id: "order_OLD", amount: 599900, created_at: Math.floor(Date.parse("2026-10-02T09:00:00Z") / 1000), notes: { kaal_no: "09" } }
  ] }));
  if (/\/v1\/orders\?/.test(url)) return new Response(JSON.stringify({ items: [
    { id: "order_D1", status: "paid", created_at: at6("09", "10"), notes: { kaal_no: "03" } },
    { id: "order_F1", status: "attempted", created_at: at6("10", "00"), notes: { kaal_no: "11" } },
    { id: "order_C1", status: "created", created_at: at6("11", "00"), notes: { kaal_no: "15" } }
  ] }));
  return digestFetch(url, init);
};
const tick = async (iso, e = envC) => { Date.now = () => Date.parse(iso); const k = ctx(); await w.scheduled({}, e, k); await k.done(); };
await tick("2026-10-06T18:10:00Z");                                            /* 23:40 on 6 Oct in India: the day is not over */
ok(mails.length === 0, "report: nothing before the day has ended, India time");
await tick("2026-10-06T18:35:00Z");                                            /* 00:05 on 7 Oct in India */
const rep = mails[0];
ok(mails.length === 1 && rep.to.join() === "owner@thekaal.co,me@example.org" && /^KAAL daily · Tue 6 Oct · 1 order · 1 visitor · 1 lead$/.test(rep.subject), "report: one email just after midnight, to the owner, about the day that ended (" + (rep && rep.subject) + ")");
ok(rep && /Chose a number \(add to cart\): 12/.test(rep.text) && /Opened checkout: 1/.test(rep.text) && /Paid: 1 \(₹5,999\)/.test(rep.text), "report: the day's funnel, with Razorpay's paid count and revenue");
ok(rep && /No\. 03 Emerald · ₹5,999 .* buyer\.d1@example\.com/.test(rep.text) && !/pay_OLD/.test(rep.text), "report: yesterday's order with the buyer's contact, and only yesterday's");
ok(rep && /No\. 11 · Payment failed: Bank declined .* nearly@example\.com/.test(rep.text) && /No\. 15 · Closed checkout before paying/.test(rep.text), "report: unfinished checkouts, with why and how to reach them");
ok(rep && /lead\.one@example\.com · footer/.test(rep.text) && !/old\.lead/.test(rep.text), "report: yesterday's Series 02 leads only");
ok(rep && /16 of 20 remain · sold: 01, 02, 03, 09/.test(rep.text) && /Mon 5 Oct: 31 \/ 3 \/ 1 \/ 0/.test(rep.text) && /Fri 2 Oct: 0 \/ 0 \/ 0 \/ 1/.test(rep.text), "report: what is left, and seven days of trend");
ok(rep && /<html/.test(rep.html) && /wa\.me\/919876500002/.test(rep.html) && !/\u2014/.test(rep.text + rep.html + rep.subject), "report: branded HTML with a WhatsApp link, no em dashes");
ok(rep && /NEEDS YOU\nNo\. 03: no delivery address yet/.test(rep.text) && /No\. 09: no delivery address yet/.test(rep.text) && /Needs you/.test(rep.html), "report: opens with what needs doing (orders still without an address)");
ok(rep && !/Open the desk/.test(rep.html), "report: no desk button while the desk is switched off");
await tick("2026-10-06T19:05:00Z");                                            /* 00:35: the cron's second run that hour */
ok(mails.length === 1, "report: once a day, not once a run");
await tick("2026-10-07T18:35:00Z", Object.assign({}, envC, { DIGEST: "off" }));
ok(mails.length === 1, "report: DIGEST off sends nothing");
Date.now = realNow; globalThis.fetch = digestFetch;

/* ── 8. Only the daily email, if the owner wants only that ── */
mails.length = 0;
const e9 = Object.assign({}, entity, { id: "pay_ALERTOFF", order_id: undefined, notes: { kaal_no: "05" } });
const b9 = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: e9 } } });
await hook(b9, Object.assign({}, env, { ORDER_ALERT: "off" }));
ok(mails.length === 1 && mails[0].to[0] === "rahul.sharma@example.com" && mails[0].subject === "No. 05 is yours", "ORDER_ALERT off: the buyer still gets their confirmation, the owner waits for the daily report");


/* ── 9. The owner's desk ── */
{
  const deskEnv = Object.assign({}, envC, { DESK_PASSCODE: "brass-quiet-lantern-42" });
  const D = (path, init = {}, e = deskEnv) => w.fetch(new Request("https://kaal-edition.example.workers.dev" + path, init), e, ctx());
  const W = (path, body, extra = {}, e = deskEnv) => D(path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json", "X-Desk": "1", "cf-connecting-ip": "5.5.5.5" }, extra), body: JSON.stringify(body) }, e);

  r = await D("/desk", {}, envC);
  const page = await r.text();
  const nonce = (/script-src 'nonce-([^']+)'/.exec(r.headers.get("Content-Security-Policy") || "") || [])[1];
  ok(r.status === 200 && /noindex/.test(r.headers.get("X-Robots-Tag")) && /<meta name="robots" content="noindex/.test(page) && r.headers.get("Cache-Control") === "no-store", "desk: the page is served, told to robots as private, never cached");
  ok(nonce && page.includes(`<script nonce="${nonce}">`) && /frame-ancestors 'none'/.test(r.headers.get("Content-Security-Policy")) && !/https?:\/\/(?!dashboard\.razorpay\.com|wa\.me)[a-z]/i.test(page.replace(/href="https:\/\/(wa\.me|dashboard\.razorpay\.com)[^"]*"/g, "")), "desk: only its own script runs, it cannot be framed, and it loads nothing from elsewhere");
  r = await D("/desk/data", {}, envC);
  ok(r.status === 503 && (await r.json()).reason === "off", "desk: shut while DESK_PASSCODE is not set");
  r = await D("/robots.txt");
  ok(/Disallow: \//.test(await r.text()), "robots.txt: the whole worker is off limits to crawlers");

  r = await D("/desk/data");
  ok(r.status === 401, "desk: no data without signing in");
  r = await D("/desk/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode: "brass-quiet-lantern-42" }) });
  ok(r.status === 403, "desk: a sign-in from anywhere but the desk itself is refused");
  r = await W("/desk/login", { passcode: "brass-quiet-lantern-4" });
  ok(r.status === 401 && !r.headers.get("Set-Cookie"), "desk: a wrong passcode gets nothing");
  r = await W("/desk/login", { passcode: " brass-quiet-lantern-42 " }, { Origin: "https://evil.example" });
  ok(r.status === 403, "desk: a sign-in posted from another site is refused");
  r = await W("/desk/login", { passcode: " brass-quiet-lantern-42 " });
  const cookie = (r.headers.get("Set-Cookie") || "");
  ok(r.status === 200 && /^kaal_desk=\d+\.[0-9a-f]{64};/.test(cookie) && /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Strict/.test(cookie) && /Path=\/desk/.test(cookie), "desk: the right passcode gets a signed, HttpOnly, SameSite=Strict cookie for /desk only");
  const jar = { Cookie: cookie.split(";")[0] };

  /* A shop with some history, 7 Oct 2026, 1:30 pm in India. */
  const T = (iso) => Math.floor(Date.parse(iso) / 1000);
  Date.now = () => Date.parse("2026-10-07T08:00:00Z");
  KV.store.set("sold", "[1,2,3,12]");
  KV.store.set("ship:order_B", JSON.stringify({ at: "2026-10-07T07:00:00Z", name: "Meera <Iyer>", phone: "+919800000001", line1: "4 Lake Road", line2: "", city: "Pune", state: "Maharashtra", pin: "411001" }));
  KV.store.set("sent:order_D", JSON.stringify({ at: "2026-10-03T10:00:00Z", courier: "Delhivery", tracking: "DL123", url: "", mailed: "" }));
  KV.store.set("hold:15", JSON.stringify({ until: Date.now() + 600000 }));
  KV.store.set("list:ccc", JSON.stringify({ email: "today.lead@example.com", at: "2026-10-07T05:00:00Z", source: "stillness" }));
  /* The /list test above stored its address at the real time; pin it inside
     this test's day, or the answers below change with the calendar. */
  for (const [k, v] of KV.store) if (k.startsWith("list:") && v.includes("asha@example.com")) KV.store.set(k, JSON.stringify(Object.assign(JSON.parse(v), { at: "2026-10-07T07:30:00Z" })));
  dobox.set("d:2026-10-07", { visit: 12, visitor: 9, number: 2, checkout: 1, view: 5 });
  const deskFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (/\/v1\/payments\?/.test(url)) return new Response(JSON.stringify({ items: [
      { id: "pay_A", status: "captured", order_id: "order_A", amount: 599900, email: "late.buyer@example.com", contact: "+919800000002", created_at: T("2026-09-28T09:00:00Z"), notes: { kaal_no: "03", gift: "yes", gift_note: "=HYPERLINK(\"x\")" } },
      { id: "pay_B", status: "captured", order_id: "order_B", amount: 599900, email: "meera@example.com", contact: "+919800000001", created_at: T("2026-10-07T06:00:00Z"), notes: { kaal_no: "07" } },
      { id: "pay_C", status: "refunded", order_id: "order_C", amount: 599900, amount_refunded: 599900, email: "gone@example.com", created_at: T("2026-10-01T06:00:00Z"), notes: { kaal_no: "05" } },
      { id: "pay_D", status: "captured", order_id: "order_D", amount: 599900, email: "sent@example.com", created_at: T("2026-10-01T06:00:00Z"), notes: {} },
      { id: "pay_F1", status: "failed", order_id: "order_X", amount: 599900, email: "try@example.com", contact: "+919800000009", created_at: T("2026-10-07T04:00:00Z"), error_description: "Card declined", notes: {} },
      { id: "pay_F2", status: "failed", order_id: "order_X", amount: 599900, created_at: T("2026-10-07T04:01:00Z"), notes: {} },
      { id: "pay_F3", status: "failed", order_id: "order_X", amount: 599900, created_at: T("2026-10-07T04:02:00Z"), notes: {} }
    ] }));
    if (/\/v1\/orders\?/.test(url)) return new Response(JSON.stringify({ items: [
      { id: "order_X", status: "attempted", created_at: T("2026-10-07T03:59:00Z"), notes: { kaal_no: "11" } },
      { id: "order_B", status: "paid", created_at: T("2026-10-07T05:59:00Z"), notes: { kaal_no: "07" } }
    ] }));
    if (/\/orders\/order_D$/.test(url)) return new Response(JSON.stringify({ id: "order_D", status: "paid", notes: { kaal_no: "12" } }));
    return deskFetch(url, init);
  };

  r = await D("/desk/data", { headers: jar });
  d = await r.json();
  ok(r.status === 200 && !r.headers.get("Access-Control-Allow-Origin"), "desk data: signed in, and no other site may read it (no CORS)");
  const kinds = d.alerts.map(a => a.kind + ":" + (a.n || ""));
  ok(kinds.includes("late:3") && kinds.includes("address:3") && kinds.includes("unsold:7") && kinds.includes("failures:") && kinds.indexOf("unsold:7") < kinds.indexOf("late:3"), "desk alerts: late dispatch, missing address, a paid number the site still offers, a run of failed payments (" + kinds.join(", ") + ")");
  ok(!kinds.some(k => /:5$|:12$/.test(k)) && !kinds.includes("address:7"), "desk alerts: nothing for a refunded order, a dispatched one, or one paid an hour ago");
  const byId = Object.fromEntries(d.orders.map(o => [o.id, o]));
  ok(byId.pay_D.n === 12 && byId.pay_D.sent.tracking === "DL123" && byId.pay_C.refund === "full" && byId.pay_B.address.city === "Pune", "desk orders: number read from the order when the payment lacks it, dispatches, refunds and addresses attached");
  ok(d.revenue === 3 * 599900 && d.paid.today === 1 && d.left === 16 && d.held.includes(15), "desk: money taken leaves out the refund; today's orders, what remains, what is held");
  ok(d.c.today.visitor === 9 && d.unfinished.length === 1 && d.unfinished[0].n === 11 && /Payment failed: Card declined \(3 tries\)/.test(d.unfinished[0].stage) && d.unfinished[0].contact === "+919800000009" && d.unfinished[0].email === "try@example.com", "desk: today's count, and the checkout that nearly happened, with the reason and contact from whichever try had them");
  ok(d.leads.total === 4 && d.leads.today === 2 && d.leads.recent.map(l => l.email).join() === "asha@example.com,today.lead@example.com,lead.one@example.com,old.lead@example.com", "desk: the whole Series 02 list, newest first, and who joined today");
  ok(d.health.length >= 6 && d.health.every(h => typeof h.ok === "boolean" && h.label && h.detail), "desk: a health line for each moving part");

  /* Read as bytes: Response.text() quietly drops the byte-order mark being checked for. */
  const csvOf = async (res) => { const b = new Uint8Array(await res.arrayBuffer()); return { bom: b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(b).replace(/^﻿/, "") }; };
  r = await D("/desk/orders.csv", { headers: jar });
  let csvOut = await csvOf(r), csvText = csvOut.text;
  ok(/attachment; filename="kaal-orders-2026-10-07\.csv"/.test(r.headers.get("Content-Disposition")) && csvOut.bom && /^Number,Dial,/.test(csvText), "orders.csv: downloads, opens cleanly in Excel");
  ok(/"'=HYPERLINK\(""x""\)"/.test(csvText) && /\n07,,.*Meera <Iyer>,4 Lake Road/.test(csvText), "orders.csv: a gift note that looks like a formula stays text; addresses included");
  r = await D("/desk/leads.csv", { headers: jar });
  csvOut = await csvOf(r); csvText = csvOut.text;
  ok(csvOut.bom && /^Email,Form,Joined/.test(csvText) && /today\.lead@example\.com,stillness/.test(csvText) && /asha@example\.com/.test(csvText), "leads.csv: the whole list");

  /* Forged, stale and old-passcode cookies. */
  const forged = jar.Cookie.replace(/.$/, c => (c === "0" ? "1" : "0"));
  r = await D("/desk/data", { headers: { Cookie: forged } });
  ok(r.status === 401, "desk: a cookie with a forged signature is refused");
  const stale = String(Date.now() - 1000);
  const staleSig = createHmac("sha256", "kaal-desk|brass-quiet-lantern-42|sek").update("desk|" + stale).digest("hex");
  r = await D("/desk/data", { headers: { Cookie: `kaal_desk=${stale}.${staleSig}` } });
  ok(r.status === 401, "desk: a correctly signed cookie past its thirty days is refused");
  r = await D("/desk/data", { headers: jar }, Object.assign({}, deskEnv, { DESK_PASSCODE: "a-new-passcode-99" }));
  ok(r.status === 401, "desk: changing the passcode signs every device out");

  /* Dispatch, and the tracking email the confirmation promised. */
  mails.length = 0;
  r = await D("/desk/dispatch", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, jar), body: JSON.stringify({ o: "order_TESTORDER1" }) });
  ok(r.status === 403, "dispatch: refused without the desk's own header");
  r = await W("/desk/dispatch", { o: "order_TESTORDER1", courier: "Blue Dart", tracking: "BD 7788", url: "javascript:alert(1)", notify: true }, jar);
  d = await r.json();
  const sentRec = JSON.parse(KV.store.get("sent:order_TESTORDER1") || "{}");
  const tr = mails.find(m => m.to[0] === "rahul.sharma@example.com");
  ok(d.ok && d.mailed && d.to === "ra•••@example.com" && sentRec.courier === "Blue Dart" && sentRec.url === "" && sentRec.mailed, "dispatch: recorded, a non-https tracking link dropped, the buyer emailed");
  ok(tr && tr.subject === "No. 09 is on its way" && /Courier: Blue Dart/.test(tr.text) && /Tracking number: BD 7788/.test(tr.text) && /caseback-09\.png/.test(tr.html) && /Kolkata/.test(tr.text) && !/javascript:/.test(tr.html), "dispatch email: courier, tracking, where it is going, their engraved number");
  ok(mails.length === 1, "dispatch: the owner is not emailed about their own tap");
  mails.length = 0;
  r = await W("/desk/dispatch", { o: "order_TESTORDER1", courier: "Blue Dart", tracking: "BD 7788", notify: false }, jar);
  ok((await r.json()).ok && mails.length === 0 && JSON.parse(KV.store.get("sent:order_TESTORDER1")).mailed, "dispatch: correcting a record without the email sends nothing, and remembers the earlier email");
  r = await W("/desk/dispatch", { o: "order_TESTORDER1", undo: true }, jar);
  ok((await r.json()).undone && !KV.store.has("sent:order_TESTORDER1"), "dispatch: undo takes the mark back");
  orderStatus = "created"; payStatus = "failed";
  r = await W("/desk/dispatch", { o: "order_UNPAID001", courier: "x", notify: true }, jar);
  ok(r.status === 409, "dispatch: refused for an order that was never paid");
  orderStatus = "paid"; payStatus = "captured";
  r = await W("/desk/dispatch", { o: "../../etc" }, jar);
  ok(r.status === 400, "dispatch: a malformed order id is refused");

  /* The digest, with the desk on, links to it. */
  r = await W("/desk/logout", {}, jar);
  ok(/kaal_desk=;.*Max-Age=0/.test(r.headers.get("Set-Cookie") || ""), "desk: sign out clears the cookie");

  /* Nine wrong passcodes from one connection: the ninth try is not even read. */
  for (let i = 0; i < 8; i++) await W("/desk/login", { passcode: "guess-" + i }, { "cf-connecting-ip": "9.9.9.9" });
  r = await W("/desk/login", { passcode: "brass-quiet-lantern-42" }, { "cf-connecting-ip": "9.9.9.9" });
  ok(r.status === 429, "desk: eight wrong passcodes in fifteen minutes and that connection is refused, even with the right one");

  globalThis.fetch = deskFetch; Date.now = realNow;
}


/* ── 10. Details before paying ── */
{
  const posted = [];
  const orderFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (/\/v1\/orders$/.test(url) && init && init.method === "POST") {
      posted.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "order_DETAILS0" + posted.length, amount: 599900, currency: "INR" }));
    }
    const got = /\/v1\/orders\/order_DETAILS0(\d)$/.exec(url);
    if (got) return new Response(JSON.stringify({ id: "order_DETAILS0" + got[1], status: "paid", amount: 599900, notes: posted[got[1] - 1].notes }));
    return orderFetch(url, init);
  };
  const envO = Object.assign({}, env, { PRICE_PAISE: "599900" });
  KV.store.set("sold", "[1,2,3,9]");
  const order = (b) => w.fetch(new Request("https://w/order", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://thekaal.co" }, body: JSON.stringify(b) }), envO, ctx());
  const buyer = { name: "Meera Iyer", phone: "+91 98200 00001", email: "Meera.Iyer@Example.com", line1: "Flat 4B, Sea Breeze", line2: "", city: "Mumbai", state: "Maharashtra", pin: "400050" };

  r = await order({ n: 12, by: "t1", buyer });
  d = await r.json();
  let rec = JSON.parse(KV.store.get("ship:order_DETAILS01") || "null");
  ok(d.ok && d.details === true && rec && rec.src === "checkout" && rec.pin === "400050" && rec.name === "Meera Iyer" && rec.buyer.email === "meera.iyer@example.com", "order: the details given before paying become the delivery address, under the order");
  ok(KV.ttl.get("ship:order_DETAILS01") === 90 * 86400, "order: kept 90 days while unpaid, not forever");
  ok(!JSON.stringify(posted[0].notes).includes("Meera") && !JSON.stringify(posted[0].notes).includes("400050"), "order: the details stay with KAAL, not in Razorpay's order notes");

  r = await order({ n: 13, by: "t2", gift: true, buyer: Object.assign({}, buyer, { to_name: "Appa Iyer", to_phone: "9800000002" }) });
  rec = JSON.parse(KV.store.get("ship:order_DETAILS02") || "null");
  ok(rec && rec.name === "Appa Iyer" && rec.phone === "9800000002" && rec.buyer.name === "Meera Iyer", "order: a gift goes to the recipient's name and phone; the buyer is kept as the buyer");

  r = await order({ n: 14, by: "t3", buyer: Object.assign({}, buyer, { pin: "4000" }) });
  ok(r.status === 400 && (await r.json()).reason === "details" && posted.length === 2, "order: half-filled details are refused before Razorpay is asked for anything");
  r = await order({ n: 14, by: "t4", buyer: Object.assign({}, buyer, { email: "not-an-email" }) });
  ok(r.status === 400, "order: an email that cannot receive the confirmation is refused");
  r = await order({ n: 14, by: "t5" });
  ok((await r.json()).details === false && posted.length === 3, "order: a page that sends no details (older page) still gets its order");

  /* The payment lands: the address is already known, and kept for good. */
  mails.length = 0;
  const eD = { id: "pay_DETAILS01", order_id: "order_DETAILS01", amount: 599900, currency: "INR", email: "meera.iyer@example.com", contact: "+919820000001", created_at: 1790000000, notes: { kaal_no: "12" } };
  await hook(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: eD } } }), envO);
  const mineD = mails.find(m => m.to[0] === "meera.iyer@example.com"), ownD = mails.find(m => /^New order · No\. 12/.test(m.subject));
  ok(mineD && /We have your delivery address/.test(mineD.text) && !/Add delivery address|claimed\.html\?o=/.test(mineD.text), "paid: the buyer is not asked for an address they already gave");
  ok(ownD && /Buyer: Meera Iyer/.test(ownD.text) && /Mumbai, Maharashtra 400050/.test(ownD.text), "paid: the owner's alert carries the buyer's name and the address");
  ok(KV.store.has("ship:order_DETAILS01") && KV.ttl.get("ship:order_DETAILS01") === undefined, "paid: the address is kept for good once the money is real");
  globalThis.fetch = orderFetch;
}

/* ── 11. Refunds, found on their own ── */
{
  const base = globalThis.fetch;
  const puts = [];
  let refundList = [];
  const payments = {
    pay_R1: { id: "pay_R1", status: "refunded", amount: 599900, amount_refunded: 599900, email: "refund.buyer@example.com", contact: "+919800000011", order_id: "order_R1", created_at: 1791000000, notes: { kaal_no: "07" } },
    pay_R3: { id: "pay_R3", status: "captured", amount: 599900, amount_refunded: 100000, email: "part.buyer@example.com", order_id: "order_R3", created_at: 1791000000, notes: { kaal_no: "11" } }
  };
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (/\/v1\/refunds\?/.test(url)) return new Response(JSON.stringify({ items: refundList }));
    let m = /\/v1\/payments\/(pay_\w+)$/.exec(url);
    if (m) return payments[m[1]] ? new Response(JSON.stringify(payments[m[1]])) : new Response("{}", { status: 404 });
    if (/\/v1\/payments\?/.test(url)) return new Response(JSON.stringify({ items: Object.values(payments).concat([
      { id: "pay_LIVE9", status: "captured", order_id: "order_L9", amount: 599900, created_at: 1791000000, notes: { kaal_no: "09" } }]) }));
    if (/\/v1\/orders\?/.test(url)) return new Response(JSON.stringify({ items: [] }));
    if (url.includes("api.github.com") && init && init.method === "PUT") { puts.push(JSON.parse(init.body)); return new Response("{}"); }
    return base(url, init);
  };
  const envR = Object.assign({}, envC, { DESK_PASSCODE: "brass-quiet-lantern-42" });
  KV.store.set("sold", "[1,2,3,7,9]"); ghSold = "[1, 2, 3, 7, 9]";
  for (const k of [...KV.store.keys()]) if (/^(refund|refunded|refundof|refunds):/.test(k)) KV.store.delete(k);
  const at = (iso) => Math.floor(Date.parse(iso) / 1000);
  refundList = [
    { id: "rfnd_A1", payment_id: "pay_R1", amount: 599900, status: "processed", created_at: at("2026-10-07T05:00:00Z") },
    { id: "rfnd_P1", payment_id: "pay_R1", amount: 100, status: "pending", created_at: at("2026-10-07T05:30:00Z") }
  ];
  const tick = async (iso, e = envR) => { Date.now = () => Date.parse(iso); const k = ctx(); await w.scheduled({}, e, k); await k.done(); };
  mails.length = 0;
  await tick("2026-10-08T06:00:00Z");                                        /* 11:30 am in India: no report hour */
  const own = mails.find(m => /^Refund processed · No\. 07/.test(m.subject)), buy = mails.find(m => m.to[0] === "refund.buyer@example.com");
  ok(mails.length === 2 && own && own.subject === "Refund processed · No. 07 · ₹5,999" && own.to.join() === "owner@thekaal.co,me@example.org", "refund: found without being told, and the owner is emailed (" + mails.map(m => m.subject).join(" / ") + ")");
  ok(own && /still shown as sold/.test(own.text) && /\/desk/.test(own.text) && own.reply_to === "refund.buyer@example.com", "refund: the owner is asked the one question it leaves, with the desk link, and can reply to the buyer");
  ok(buy && buy.subject === "Your refund for No. 07 has been processed" && /₹5,999/.test(buy.text) && /rfnd_A1/.test(buy.text) && /5 to 7 working days/.test(buy.text) && !/thekaal\.co\/#|choose|buy again/i.test(buy.text), "refund: the buyer is told plainly, with both references, and not sold to");
  ok(JSON.parse(KV.store.get("refunded:7")).decided === "" && KV.store.has("refund:rfnd_A1") && !KV.store.has("refund:rfnd_P1"), "refund: recorded once; a pending refund waits until Razorpay processes it");
  ok(JSON.parse(KV.store.get("sold")).includes(7) && puts.length === 0, "refund: the number is NOT put back on sale by itself");
  await tick("2026-10-08T06:30:00Z");
  ok(mails.length === 2, "refund: the next run finds it again and says nothing");

  /* The same refund announced by the webhook as well: still once. A new
     part refund by webhook: told, no question about the number. */
  const rhook = (b) => { const k = ctx(); return w.fetch(new Request("https://w/", { method: "POST", headers: { "x-razorpay-signature": createHmac("sha256", "wh").update(b).digest("hex") }, body: b }), envR, k).then(async res => { await k.done(); return res; }); };
  r = await rhook(JSON.stringify({ event: "refund.processed", payload: { refund: { entity: refundList[0] }, payment: { entity: payments.pay_R1 } } }));
  ok(r.status === 200 && mails.length === 2, "refund webhook: a refund the cron already told is not told twice");
  const part = { id: "rfnd_W1", payment_id: "pay_R3", amount: 100000, status: "processed", created_at: at("2026-10-08T06:40:00Z") };
  r = await rhook(JSON.stringify({ event: "refund.processed", payload: { refund: { entity: part }, payment: { entity: payments.pay_R3 } } }));
  const ownP = mails.find(m => /\(part\)$/.test(m.subject)), buyP = mails.find(m => m.to[0] === "part.buyer@example.com");
  ok(ownP && ownP.subject === "Refund processed · No. 11 · ₹1,000 (part)" && /order itself stands/.test(ownP.text) && buyP && buyP.subject === "A refund of ₹1,000 for No. 11 has been processed" && !KV.store.has("refunded:11"), "refund webhook: a part refund is told at once, and asks nothing about the number");
  refundList.push(part);
  const before = mails.length; await tick("2026-10-08T07:00:00Z");
  ok(mails.length === before, "refund: the cron does not repeat what the webhook already told");

  /* REFUND_EMAIL off: the owner only. */
  payments.pay_R4 = { id: "pay_R4", status: "refunded", amount: 599900, amount_refunded: 599900, email: "quiet@example.com", order_id: "order_R4", created_at: 1791000000, notes: { kaal_no: "15" } };
  refundList.push({ id: "rfnd_Q1", payment_id: "pay_R4", amount: 599900, status: "processed", created_at: at("2026-10-08T07:10:00Z") });
  mails.length = 0; await tick("2026-10-08T07:30:00Z", Object.assign({}, envR, { REFUND_EMAIL: "off" }));
  ok(mails.length === 1 && /No\. 15/.test(mails[0].subject) && /Buyer told: by Razorpay/.test(mails[0].text), "REFUND_EMAIL off: only the owner hears from KAAL");
  delete payments.pay_R4;

  /* The desk: the question, then the owner's answer. */
  Date.now = () => Date.parse("2026-10-08T08:00:00Z");
  const D = (path, init = {}) => w.fetch(new Request("https://kaal-edition.example.workers.dev" + path, init), envR, ctx());
  const W = (path, body, extra = {}) => D(path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json", "X-Desk": "1", "cf-connecting-ip": "6.6.6.6" }, extra), body: JSON.stringify(body) });
  r = await W("/desk/login", { passcode: "brass-quiet-lantern-42" });
  const jar = { Cookie: (r.headers.get("Set-Cookie") || "").split(";")[0] };
  d = await (await D("/desk/data", { headers: jar })).json();
  const o7 = d.orders.find(o => o.id === "pay_R1");
  ok(d.alerts.some(a => a.kind === "refund" && a.n === 7) && o7 && o7.refund === "full" && o7.refunded === "₹5,999" && o7.release && o7.release.decided === "", "desk: a full refund asks 'back on sale, or keep it retired?', with the amount and date");
  ok(!d.alerts.some(a => a.kind === "unsold" && a.n === 7) && !d.alerts.some(a => a.n === 11 && a.kind === "refund"), "desk: no false 'site still offers it' for a refunded number, and no question for a part refund");

  r = await D("/desk/release", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, jar), body: JSON.stringify({ n: 7, action: "sell" }) });
  ok(r.status === 403 && puts.length === 0, "release: refused without the desk's own header");
  r = await W("/desk/release", { n: 9, action: "sell" }, jar);
  ok(r.status === 409 && (await r.json()).reason === "not-refunded" && puts.length === 0, "release: a number that was never refunded cannot be put back on sale");
  r = await W("/desk/release", { n: 7, action: "retire" }, jar);
  d = await (await D("/desk/data", { headers: jar })).json();
  ok((await r.json()).decided === "retire" && puts.length === 0 && !d.alerts.some(a => a.kind === "refund") && JSON.parse(KV.store.get("sold")).includes(7), "release: 'keep it retired' is written down, the question goes, the number stays sold");
  r = await W("/desk/release", { n: 7, action: "sell" }, jar);
  const commit = puts[0] ? Buffer.from(puts[0].content, "base64").toString() : "";
  ok((await r.json()).decided === "sell" && /sold:\s+\[1, 2, 3, 9\]/.test(commit) && /back on sale \(refunded, payment pay_R1\)/.test(puts[0].message) && !JSON.parse(KV.store.get("sold")).includes(7), "release: 'back on sale' takes No. 07 off index.html's sold list and the live list, in one commit");
  payments.pay_NEW7 = { id: "pay_NEW7", status: "captured", amount: 599900, order_id: "order_N7", created_at: 1791100000, notes: { kaal_no: "07" } };
  r = await W("/desk/release", { n: 7, action: "sell" }, jar);
  ok(r.status === 409 && (await r.json()).reason === "sold-again" && puts.length === 1, "release: once someone has bought No. 07 again, no stale tap can release it");
  delete payments.pay_NEW7;

  /* The morning report lists the day's refunds. */
  mails.length = 0;
  KV.store.delete("digest:2026-10-07"); dobox.set("d:2026-10-07", { visit: 5, visitor: 4, details: 2, checkout: 3 });
  await tick("2026-10-07T18:35:00Z");
  const rep7 = mails.find(m => /^KAAL daily · Wed 7 Oct/.test(m.subject));
  ok(rep7 && /REFUNDS\nNo\. 07 · ₹5,999 · 7 Oct 2026, 10:30 am/.test(rep7.text) && /Gave their details: 2/.test(rep7.text), "report: the day's refunds, and how many gave their details");

  globalThis.fetch = base; Date.now = realNow; ghSold = "[1, 2]";
}


/* ── 12. Only the full price buys a number ── */
{
  mails.length = 0;
  const base = globalThis.fetch;
  const puts = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.github.com") && init && init.method === "PUT") puts.push(1);
    return base(url, init);
  };
  KV.store.set("sold", "[1,2]"); ghSold = "[1, 2]";
  const pay = (over) => JSON.stringify({ event: "payment.captured", payload: { payment: { entity: Object.assign(
    { id: "pay_X" + Math.random().toString(36).slice(2, 8), amount: 599900, currency: "INR", email: "someone@example.com", contact: "+919800000099", created_at: 1791000000 }, over) } } });

  r = await hook(pay({ amount: 100, notes: { kaal_no: "07" } }));
  ok(/not the price/.test(await r.text()) && puts.length === 0 && !JSON.parse(KV.store.get("sold")).includes(7), "₹1 with 'kaal_no: 07' in its notes marks nothing sold");
  ok(mails.length === 1 && mails[0].to[0] === "owner@thekaal.co" && /^Payment of ₹1 is not the price · not a sale/.test(mails[0].subject) && /mentioning No\. 07/.test(mails[0].text) && /refund it there/.test(mails[0].text), "₹1: the owner is told exactly what happened; the payer is told nothing");
  mails.length = 0;
  r = await hook(pay({ amount: 599900, currency: "USD", notes: { kaal_no: "08" } }));
  ok(/not the price/.test(await r.text()) && puts.length === 0 && mails.every(m => m.to[0] !== "someone@example.com"), "the right number in the wrong currency is not a sale");
  mails.length = 0;
  r = await hook(pay({ order_id: "order_TESTORDER1", notes: { kaal_no: "04" } }));
  ok(/number 9 recorded as sold/.test(await r.text()) && puts.length === 1 && mails.some(m => m.subject === "No. 09 is yours"), "full price: the number comes from the order the worker priced (09), not the payer's note (04)");
  globalThis.fetch = base;
}

/* ── 13. The live view: the desk's "Right now" ── */
{
  const box = new Map(); let alarm = 0;
  const so = new Stats({ storage: { async get(k) { return box.get(k); }, async put(k, v) { box.set(k, JSON.parse(JSON.stringify(v))); },
    async delete(k) { box.delete(k); }, async setAlarm(t) { alarm = t; } } });
  const LS = { idFromName: () => "kaal", get: () => ({ fetch: (u, i) => so.fetch(new Request(u, i)) }) };
  const envL = Object.assign({}, env, { STATS: LS, DESK_PASSCODE: "brass-quiet-lantern-42" });
  const IG = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0";
  const send = (body, origin = "https://thekaal.co", ua = IG) => {
    const k = ctx();
    return w.fetch(new Request("https://w/e", { method: "POST", headers: { Origin: origin, "User-Agent": ua, "Content-Type": "text/plain" }, body: JSON.stringify(body) }), envL, k).then(async res => { await k.done(); return res; });
  };
  const seen = (q, ua = IG, origin = "https://thekaal.co") => {
    const k = ctx();
    return w.fetch(new Request("https://w/state?" + q, { headers: { Origin: origin, "User-Agent": ua } }), envL, k).then(async res => { await k.done(); return res; });
  };
  let t0 = Date.parse("2026-10-06T08:00:00Z");
  Date.now = () => t0;

  r = await seen("h=abc123def0&w=film&n=0&d=&s=instagram");
  ok((await r.json()).live === true, "live: /state tells the page the live view is on");
  let v = await so.liveView();
  ok(v.here.length === 1 && v.here[0].w === "film" && v.here[0].app === "Instagram" && v.here[0].os === "iPhone" && v.here[0].dev === "phone" && v.here[0].s === "instagram",
    "live: the page's minute check puts the visit on the desk: watching the film, from Instagram, on an iPhone");
  ok(!JSON.stringify(v).includes("abc123def0") && v.here[0].k === 1, "live: the visit's tag never leaves the counter; the desk sees Visitor 1");

  t0 += 20000;
  r = await send({ c: { number: 1 }, l: { v: "abc123def0", w: "twenty", n: 7, d: "midnight", s: "instagram",
    ev: [{ e: "dial", dial: "Midnight" }, { e: "number", no: "07", dial: "Midnight" }] } });
  v = await so.liveView();
  ok(r.status === 204 && v.here[0].w === "twenty" && v.here[0].n === 7 && v.here[0].d === "midnight" && v.here[0].steps.length === 2 && v.feed[0].e === "number" && v.feed[0].no === "07",
    "live: a step reaches the desk seconds after it is taken, with where the visit is now");
  ok((box.get("d:2026-10-06") || {}).number === 1, "live: the day's count rides the same request, so Today so far is live too");

  await send({ l: { v: "zzz999yyy8", w: "<script>", n: 400, d: "<b>", s: "<img src=x onerror=1>",
    ev: [{ e: "evil" }, { e: "number", no: "<b>", dial: "<i>x</i>" }] } });
  v = await so.liveView();
  const junk = v.here.find(x => x.k === 2);
  ok(junk && junk.w === "" && junk.n === 0 && junk.d === "" && junk.steps.length === 1 && junk.steps[0].no === "" && !/[<>]/.test(JSON.stringify(v)),
    "live: anything off its short lists is dropped, so nothing a stranger posts can reach the desk as markup");
  await send({ l: { v: "robot00001", w: "film" } }, "https://thekaal.co", "Googlebot/2.1");
  await send({ l: { v: "elsewhere1", w: "film" } }, "https://evil.example");
  await seen("h=bad%20tag&w=film");
  v = await so.liveView();
  ok(v.here.length === 2, "live: robots, other sites and malformed tags are not visitors");

  await send({ l: { v: "zzz999yyy8", g: 1 } });
  v = await so.liveView();
  ok(v.here.length === 1 && v.left.length === 1, "live: a visit that leaves is off 'on the site' at once, and stays in the hour");

  t0 += 1000;
  r = await hook(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_LIVE1", amount: 599900, currency: "INR",
    email: "x@example.com", contact: "+919800000001", created_at: 1791000000, notes: { kaal_no: "06" } } } } }), envL);
  v = await so.liveView();
  ok(v.paid.length === 1 && v.paid[0].no === "06" && v.paid[0].paise === 599900 && v.feed[0].e === "paid", "live: a sale is on the desk the moment Razorpay confirms it");

  t0 += 100000;
  v = await so.liveView();
  ok(v.here.length === 0 && v.left.length === 2, "live: a visit that stops checking in leaves 'on the site' within two minutes");
  ok(v.minutes.length === 30 && v.minutes[28] === 2 && v.minutes[29] === 0, "live: thirty minutes of how many were on the site");

  ok(alarm > 0 && !box.has("live"), "live: the save is scheduled, not written on every check-in");
  await so.alarm();
  ok(box.has("live") && box.get("live").visits && Object.keys(box.get("live").visits).length === 2, "live: saved within fifteen seconds, so a quiet spell does not lose it");
  t0 += 61 * 60000;
  await so.alarm();
  v = await so.liveView();
  ok(!box.has("live") && !v.left.length && !v.paid.length, "live: every visit is forgotten an hour after it was last seen");

  const D = (path, init = {}) => w.fetch(new Request("https://kaal-edition.example.workers.dev" + path, init), envL, ctx());
  r = await D("/desk/live");
  ok(r.status === 401, "live: the desk's live view needs the passcode");
  r = await D("/desk/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Desk": "1", "cf-connecting-ip": "7.7.7.7" }, body: JSON.stringify({ passcode: "brass-quiet-lantern-42" }) });
  const jar = { Cookie: (r.headers.get("Set-Cookie") || "").split(";")[0] };
  await seen("h=def456abc1&w=pay&n=3&d=emerald&s=direct", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36");
  r = await D("/desk/live", { headers: jar });
  d = await r.json();
  ok(r.status === 200 && d.ok && d.today === "2026-10-06" && d.live.here.length === 1 && d.live.here[0].w === "pay" && d.live.here[0].os === "Android" && d.live.here[0].n === 3,
    "live: with the passcode, the desk sees who is paying right now");
  ok(r.headers.get("Cache-Control") === "no-store" && !r.headers.get("Access-Control-Allow-Origin"), "live: never cached, and no other site can read it");
  r = await D("/desk");
  const pg = await r.text();
  ok(/id="now"/.test(pg) && /\/desk\/live/.test(pg) && /Right now/.test(pg), "live: the desk page has Right now, and asks for it");
  Date.now = realNow;
}

/* ── 14. Every visitor's history: ninety days, joined across visits, linked
      to the buyer at checkout ── */
{
  const { DatabaseSync } = await import("node:sqlite");
  const { ownerDigest } = await import("../worker/mail.js");
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...b) {
    const rows = /^\s*SELECT/i.test(q) ? db.prepare(q).all(...b) : (b.length ? (db.prepare(q).run(...b), []) : (db.exec(q), []));
    return { toArray: () => rows.map(r => Object.assign({}, r)) };
  } };
  const box = new Map();
  const so = new Stats({ storage: { sql, async get(k) { return box.get(k); }, async put(k, v) { box.set(k, JSON.parse(JSON.stringify(v))); },
    async delete(k) { box.delete(k); }, async setAlarm() {} } });
  const HS = { idFromName: () => "kaal", get: () => ({ fetch: (u, i) => so.fetch(new Request(u, i)) }) };
  const envH = Object.assign({}, env, { STATS: HS, DESK_PASSCODE: "brass-quiet-lantern-42" });
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0";
  const go = (path, init, e = envH) => { const k = ctx(); return w.fetch(new Request("https://w" + path, init), e, k).then(async res => { await k.done(); return res; }); };
  const beaconH = (l, ua = IPHONE) => go("/e", { method: "POST", headers: { Origin: "https://thekaal.co", "User-Agent": ua, "Content-Type": "text/plain" }, body: JSON.stringify({ l }) });
  const U = "mgk2p7xq4h3jz9a1";
  let t0 = Date.parse("2026-10-14T09:00:00Z");                                      /* 14:30 in India, Tue 14 Oct */
  Date.now = () => t0;

  await go("/state?h=pagetag001&u=" + U + "&w=film&n=0&d=&s=instagram", { headers: { Origin: "https://thekaal.co", "User-Agent": IPHONE } });
  let one = so.histOne(1);
  ok(one.ok && one.v.visits === 1 && one.v.steps[0].txt === "Arrived from Instagram on iPhone", "history: the first minute check opens a history: arrived from Instagram on an iPhone");

  t0 += 40000;
  await beaconH({ v: "pagetag001", u: U, w: "twenty", n: 3, d: "emerald", s: "instagram", ev: [
    { e: "act", x: "3" }, { e: "view" }, { e: "dial", dial: "Emerald" }, { e: "number", no: "03", dial: "Emerald" }, { e: "caseback_view", no: "03", dial: "Emerald" }] });
  one = so.histOne(1);
  const txts = one.v.steps.map(e => e.txt);
  ok(txts.includes("Read Emerald") && txts.includes("Reached the twenty") && txts.includes("Chose the Emerald dial") && txts.includes("Chose No. 03 (Emerald)") && txts.includes("Turned No. 03 to its engraved back"),
    "history: every step is kept in plain words: what they read, the dial, the number, the caseback");
  ok(one.v.dials.join() === "Emerald" && one.v.numbers.join() === "03" && one.v.n === 3, "history: the dials and numbers they chose are summed up for the list");

  /* Two days later, the same phone, from a Facebook ad, on the movement page first. */
  t0 += 2 * 86400000;
  await beaconH({ v: "pagetag002", u: U, p: "movement", s: "facebook", ev: [{ e: "page", x: "movement" }] });
  t0 += 60000;
  await go("/state?h=pagetag003&u=" + U + "&w=twenty&n=0&d=&s=thekaal.co", { headers: { Origin: "https://thekaal.co", "User-Agent": IPHONE } });
  one = so.histOne(1);
  const visits = one.v.steps.filter(e => e.e === "visit");
  ok(one.v.visits === 2 && visits[1].txt === "Arrived from Facebook on iPhone, on the movement page" && !one.v.steps.some(e => e.e === "page" && e.x === "movement"),
    "history: a return two days later joins the same history as visit 2, and says where it landed, once (" + (visits[1] && visits[1].txt) + ")");
  ok(one.v.steps.some(e => e.txt === "Opened the shop again"), "history: going from another page back to the shop is a step");

  /* The checkout: /order carries the same device id as `by`. */
  KV.store.delete("hold:3"); KV.store.set("sold", "[1,2,6,9]"); ghSold = "[1, 2]";
  const baseFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (/\/v1\/orders$/.test(String(url)) && init && init.method === "POST") return new Response(JSON.stringify({ id: "order_HISTA0001", amount: 599900, currency: "INR" }));
    return baseFetch(url, init);
  };
  r = await go("/order", { method: "POST", headers: { Origin: "https://thekaal.co", "Content-Type": "application/json" }, body: JSON.stringify({ n: 3, by: U,
    buyer: { name: "Rahul Sharma", phone: "+91 98765 43210", email: "rahul.sharma@example.com", line1: "12 Park Street", city: "Kolkata", state: "West Bengal", pin: "700016" } }) });
  d = await r.json();
  one = so.histOne(1);
  ok(d.order_id === "order_HISTA0001" || d.order === "order_HISTA0001" || d.id === "order_HISTA0001" || r.status === 200, "history: the checkout opens as before (" + r.status + ")");
  ok(one.v.name === "Rahul Sharma" && one.v.phone === "+919876543210" && one.v.email === "rahul.sharma@example.com" && one.v.city === "Kolkata, West Bengal",
    "history: the details given at checkout are put on the visitor's history");
  await beaconH({ v: "pagetag003", u: U, w: "pay", n: 3, d: "emerald", ev: [{ e: "checkout", no: "03", dial: "Emerald" }, { e: "details", no: "03" }, { e: "pay_failed", no: "03", x: "Bank <b>declined</b>" }] });

  /* Razorpay says it was paid. */
  t0 += 60000;
  r = await hook(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_HIST1", order_id: "order_HISTA0001", amount: 599900, currency: "INR",
    email: "rahul.sharma@example.com", contact: "+919876543210", created_at: Math.floor(t0 / 1000), notes: { kaal_no: "03" } } } } }), envH);
  globalThis.fetch = baseFetch;
  one = so.histOne(1);
  ok(one.v.paid.join() === "03" && one.v.steps.some(e => e.txt === "Paid ₹5,999 for No. 03 (Emerald)") && one.v.steps.some(e => e.txt === "Payment failed: Bank declined"),
    "history: the failed try and the payment both land on the same visitor, markup stripped");
  ok(so.histJourneys(["order_HISTA0001"])["order_HISTA0001"].k === 1, "history: the order points back to the visitor who placed it");

  /* A second visitor, never bought. */
  await go("/state?h=pagetag009&u=zzzzzzzzzz01&w=film&n=0&d=&s=google", { headers: { Origin: "https://thekaal.co", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15" } });
  await beaconH({ v: "pagetag010", u: "bad id!", w: "film", ev: [{ e: "view" }] });
  ok(!so.histOne(3).ok && so.histOne(2).ok && so.histOne(2).v.steps[0].txt === "Arrived from Google on Mac", "history: a second device is a second visitor; a malformed id keeps nothing");

  /* The desk. */
  r = await go("/desk/visitors?r=90d");
  ok(r.status === 401, "history: the desk's visitor list needs the passcode");
  r = await go("/desk/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Desk": "1", "cf-connecting-ip": "8.8.4.4" }, body: JSON.stringify({ passcode: "brass-quiet-lantern-42" }) });
  const jar = { Cookie: (r.headers.get("Set-Cookie") || "").split(";")[0], "X-Desk": "1" };
  d = await (await go("/desk/visitors?r=90d", { headers: jar })).json();
  ok(d.ok && d.on && d.total === 2 && d.rows[0].k === 2 && d.rows[1].k === 1 && d.rows[1].from === "Instagram", "history: the desk lists every visitor, most recent first");
  d = await (await go("/desk/visitors?r=90d&f=bought", { headers: jar })).json();
  const d2 = await (await go("/desk/visitors?r=90d&q=" + encodeURIComponent("rahul"), { headers: jar })).json();
  const d3 = await (await go("/desk/visitors?r=90d&q=" + encodeURIComponent("Visitor 2"), { headers: jar })).json();
  const d4 = await (await go("/desk/visitors?r=today", { headers: jar })).json();
  ok(d.total === 1 && d.rows[0].name === "Rahul Sharma" && d2.total === 1 && d3.total === 1 && d3.rows[0].k === 2 && d4.total === 2,
    "history: filtered by who bought, searched by name or visitor number, by period");
  d = await (await go("/desk/visitor?k=1", { headers: jar })).json();
  ok(d.ok && d.v.visits === 2 && d.v.steps.every(e => typeof e.txt === "string") && d.v.time > 0, "history: one visitor, every step, with time on the site");
  r = await go("/desk/visitors.csv?r=90d", { headers: jar });
  let text = await r.text();
  ok(/text\/csv/.test(r.headers.get("Content-Type")) && /Rahul Sharma/.test(text) && /Instagram/.test(text) && /Emerald/.test(text) && text.split("\r\n").length === 4,
    "history: one spreadsheet row per visitor");
  text = await (await go("/desk/steps.csv?r=90d", { headers: jar })).text();
  ok(/Chose No\. 03 \(Emerald\)/.test(text) && /Paid ₹5,999 for No\. 03 \(Emerald\)/.test(text), "history: and one row per step");
  d = await (await go("/desk/data", { headers: jar })).json();
  ok(d.journeys && typeof d.journeys === "object", "history: the desk's data carries the journey behind each order");

  /* The midnight email. */
  const day = so.histDay("2026-10-16");
  const mail = ownerDigest({ site: "https://thekaal.co", day: "2026-10-16", edition: 20, c: {}, orders: [], unfinished: [], leads: [], sold: [1, 2], left: 18,
    revenue: 0, trend: [], refunds: [], alerts: [], deskUrl: "", counting: true, razorpay: true, visitors: day });
  ok(day.total === 2 && day.rows.find(v => v.k === 1).visitNo === 2 && /WHO VISITED \(2\)/.test(mail.text) && /Visitor 1 · Rahul Sharma · Instagram · iPhone · 2nd visit/.test(mail.text) && /Who visited \(2\)/.test(mail.html) && /Paid ₹5,999 for No\. 03 \(Emerald\)/.test(mail.text) && /Payment failed/.test(mail.html),
    "history: the midnight email lists the day's visitors and what each did");
  ok(!/Read Emerald/.test(mail.text.split("WHO VISITED")[1]), "history: the email shows only that day's steps, not the visit two days before");

  /* Deleted on request, and after ninety days. */
  r = await go("/desk/forget", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, jar), body: JSON.stringify({ k: 2 }) });
  ok((await r.json()).ok && !so.histOne(2).ok, "history: Delete this visitor deletes them");
  r = await go("/desk/forget", { method: "POST", headers: Object.assign({ "Content-Type": "application/json", Origin: "https://evil.example" }, jar), body: JSON.stringify({ k: 1 }) });
  ok(r.status === 403 && so.histOne(1).ok, "history: no other site can delete one");
  t0 += 91 * 86400000;
  const pr = so.histPrune();
  ok(pr.deleted === 1 && !so.histOne(1).ok && !Object.keys(so.histJourneys(["order_HISTA0001"])).length, "history: ninety days after they were last seen, a visitor and their order link are deleted");
  Date.now = realNow;
}

/* ── Nearly bought: the one follow-up email (worker 3e) ── */
{
  const base = globalThis.fetch;
  const at = (iso) => Math.floor(Date.parse(iso) / 1000);
  const orders = [
    { id: "order_N1", status: "created", created_at: at("2026-10-19T08:00:00Z"), notes: { kaal_no: "05" } },  // open number, Razorpay has the email
    { id: "order_N7", status: "created", created_at: at("2026-10-12T08:00:00Z"), notes: { kaal_no: "04" } },  // same person, older: no second email
    { id: "order_N2", status: "created", created_at: at("2026-10-18T08:00:00Z"), notes: { kaal_no: "09" } },  // number sold since
    { id: "order_N3", status: "created", created_at: at("2026-10-19T09:00:00Z"), notes: { kaal_no: "06" } },  // number held by someone paying now
    { id: "order_N4", status: "created", created_at: at("2026-10-17T08:00:00Z"), notes: {} },                 // no number, email from our details step
    { id: "order_N5", status: "created", created_at: at("2026-10-20T05:30:00Z"), notes: { kaal_no: "08" } },  // one hour old: too soon
    { id: "order_N6", status: "created", created_at: at("2026-10-18T10:00:00Z"), notes: { kaal_no: "10" } },  // this person paid for another piece
    { id: "order_N8", status: "created", created_at: at("2026-10-18T11:00:00Z"), notes: { kaal_no: "11" } },  // no email anywhere
    { id: "order_P1", status: "paid",    created_at: at("2026-10-18T09:00:00Z"), notes: { kaal_no: "02" } }
  ];
  const pays = [
    { id: "pay_N1", status: "failed", order_id: "order_N1", email: "Asha.R@Example.com", created_at: at("2026-10-19T08:02:00Z"), error_description: "Bank declined" },
    { id: "pay_N7", status: "failed", order_id: "order_N7", email: "asha.r@example.com", created_at: at("2026-10-12T08:02:00Z") },
    { id: "pay_N2", status: "failed", order_id: "order_N2", email: "bilal@example.com", created_at: at("2026-10-18T08:02:00Z") },
    { id: "pay_N3", status: "failed", order_id: "order_N3", email: "chetan@example.com", created_at: at("2026-10-19T09:02:00Z") },
    { id: "pay_N5", status: "failed", order_id: "order_N5", email: "early@example.com", created_at: at("2026-10-20T05:32:00Z") },
    { id: "pay_N6", status: "failed", order_id: "order_N6", email: "buyer@example.com", created_at: at("2026-10-18T10:02:00Z") },
    { id: "pay_P1", status: "captured", order_id: "order_P1", email: "Buyer@example.com", created_at: at("2026-10-18T09:02:00Z") }
  ];
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (/\/v1\/refunds\?/.test(url)) return new Response(JSON.stringify({ items: [] }));
    let m = /\/v1\/(orders|payments)\?from=(\d+)&to=(\d+)/.exec(url);
    if (m) {
      const list = (m[1] === "orders" ? orders : pays).filter(x => x.created_at >= +m[2] && x.created_at <= +m[3]);
      return new Response(JSON.stringify({ items: /skip=0/.test(url) ? list : [] }));
    }
    return base(url, init);
  };
  const envN = Object.assign({}, envC, { ABANDON_EMAIL: "on" });
  KV.store.set("sold", "[1,2,9]"); ghSold = "[1, 2, 9]";
  KV.store.set("ship:order_N4", JSON.stringify({ buyer: { name: "priya mehta", email: "priya@example.com", phone: "+919800000044" }, city: "Pune", state: "MH" }));
  KV.store.set("hold:6", JSON.stringify({ by: "someone-else", until: Date.parse("2026-10-20T07:00:00Z") }));
  for (const k of [...KV.store.keys()]) if (k.startsWith("nearly:")) KV.store.delete(k);
  const tick = async (iso) => { Date.now = () => Date.parse(iso); const k = ctx(); await w.scheduled({}, envN, k); await k.done(); };
  const nearly = () => mails.filter(m => /still here|found its owner|still waiting/.test(m.subject));

  mails.length = 0;
  await tick("2026-10-20T15:00:00Z");                                         /* 8:30 pm in India */
  ok(nearly().length === 0, "nearly: nothing goes out after eight in the evening");

  mails.length = 0;
  await tick("2026-10-20T06:00:00Z");                                         /* 11:30 am in India */
  const to = (e) => nearly().find(m => m.to[0] === e);
  const a = to("asha.r@example.com"), b = to("bilal@example.com"), d = to("priya@example.com");
  ok(nearly().length === 3 && a && b && d, "nearly: three people written to (" + nearly().map(m => m.to[0] + " / " + m.subject).join(", ") + ")");
  ok(a && a.subject === "No. 05 is still here" && /caseback-05\.png/.test(a.html) && /thekaal\.co\/#n5/.test(a.text) && /seventeen remain/.test(a.text) && /^Hello,/.test(a.text) && /Yesterday you chose No\. 05/.test(a.text),
    "nearly: an open number gets its own caseback, link, the true count and when they chose it");
  ok(a && a.from === "KAAL <connect@thekaal.co>" && a.reply_to === "connect@thekaal.co" && /Reply "stop"/.test(a.text), "nearly: from KAAL, replies come to connect@, and it says how to stop");
  ok(b && b.subject === "No. 09 found its owner" && !/#n9/.test(b.text) && /#twenty/.test(b.text), "nearly: a number that sold since is told honestly, and pointed at the rest");
  ok(d && d.subject === "Your piece is still waiting" && /^Priya,/.test(d.text), "nearly: no number, an email from our own details step, and their first name");
  ok(!to("chetan@example.com") && !to("early@example.com") && !to("buyer@example.com") && nearly().every(m => !/discount|% off|hurry|last chance/i.test(m.text)),
    "nearly: not while someone is paying for their number, not too soon, never to a buyer, and no fake pressure");
  ok(nearly().filter(m => m.to[0] === "asha.r@example.com").length === 1, "nearly: two tries by one person is one email");

  mails.length = 0;
  KV.store.delete("hold:6");
  await tick("2026-10-20T06:30:00Z");
  ok(nearly().length === 1 && to("chetan@example.com") && to("chetan@example.com").subject === "No. 06 is still here", "nearly: once the hold lapses, that person is written to on the next run");
  mails.length = 0;
  await tick("2026-10-20T07:00:00Z");
  await tick("2026-10-27T06:00:00Z");
  ok(nearly().length === 1 && to("early@example.com"), "nearly: everyone already written to is never written to again; the late one gets theirs when due");

  globalThis.fetch = base; Date.now = realNow; ghSold = "[1, 2]";
}

console.log(failed ? `\n${failed} failed.` : "\nAll worker tests passed.");
process.exit(failed ? 1 : 0);
