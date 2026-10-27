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
import { createHmac, createHash } from "node:crypto";
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
  RAZORPAY_WEBHOOK_SECRET: "wh", GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", PRICE_PAISE: "599900",
  FOLLOW_GAP_MS: "0"
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

/* ── The emails nobody presses send on (worker 3e) ──
   What every customer email must never say, read from what a person sees:
   the subject, the plain text, and the HTML with its tags and styles
   taken out (so `<!doctype` and `!important` are not mistaken for an
   exclamation mark). */
const BANNED = /discount|% off|hurry|last chance|exclusive|luxury|limited time|hold|reserve|!/i;
const seen = (m) => [m.subject, m.text, String(m.html || "").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&[a-z#0-9]+;/gi, " ")].join("\n");
const clean = (m) => !BANNED.test(seen(m)) && !/\u2014/.test(seen(m));
const UNSUB = "<mailto:connect@thekaal.co?subject=stop>";
const unsub = (m) => !!(m && m.headers && m.headers["List-Unsubscribe"] === UNSUB);
const FULL_DIALS = JSON.stringify(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i + 1, i < 6 ? "Emerald" : i < 10 ? "Midnight" : i < 14 ? "Champagne" : "Ivory"])));
const sha = (s) => createHash("sha256").update(String(s).trim().toLowerCase()).digest("hex");
const person = (s) => sha(s).slice(0, 32);

/* ── Part 1. Nearly bought ── */
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
    { id: "order_N9", status: "created", created_at: at("2026-10-16T08:00:00Z"), notes: {} },                 // a name that is not a name
    { id: "order_NS", status: "created", created_at: at("2026-10-16T09:00:00Z"), notes: { kaal_no: "12" } },  // replied "stop"
    { id: "order_NT", status: "created", created_at: at("2026-10-16T10:00:00Z"), notes: { kaal_no: "13" } },  // paid later, under the email typed before paying
    { id: "order_P1", status: "paid",    created_at: at("2026-10-18T09:00:00Z"), notes: { kaal_no: "02" } },
    { id: "order_P2", status: "paid",    created_at: at("2026-09-01T09:00:00Z"), notes: { kaal_no: "01" } }
  ];
  const pays = [
    { id: "pay_N1", status: "failed", order_id: "order_N1", email: "Asha.R@Example.com", created_at: at("2026-10-19T08:02:00Z"), error_description: "Bank declined" },
    { id: "pay_N7", status: "failed", order_id: "order_N7", email: "asha.r@example.com", created_at: at("2026-10-12T08:02:00Z") },
    { id: "pay_N2", status: "failed", order_id: "order_N2", email: "bilal@example.com", created_at: at("2026-10-18T08:02:00Z") },
    { id: "pay_N3", status: "failed", order_id: "order_N3", email: "chetan@example.com", created_at: at("2026-10-19T09:02:00Z") },
    { id: "pay_N5", status: "failed", order_id: "order_N5", email: "early@example.com", created_at: at("2026-10-20T05:32:00Z") },
    { id: "pay_N6", status: "failed", order_id: "order_N6", email: "buyer@example.com", created_at: at("2026-10-18T10:02:00Z") },
    { id: "pay_NS", status: "failed", order_id: "order_NS", email: "stop.me@example.com", created_at: at("2026-10-16T09:02:00Z") },
    { id: "pay_NT", status: "failed", order_id: "order_NT", email: "typed.first@example.com", created_at: at("2026-10-16T10:02:00Z") },
    { id: "pay_P1", status: "captured", order_id: "order_P1", email: "Buyer@example.com", created_at: at("2026-10-18T09:02:00Z") },
    /* Paid six weeks ago, outside the nearly-bought window, with a different
       email at Razorpay than the one typed before paying. */
    { id: "pay_P2", status: "captured", order_id: "order_P2", email: "rzp.other@example.com", created_at: at("2026-09-01T09:02:00Z") }
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
  const envN = Object.assign({}, envC, { ABANDON_EMAIL: "on", DIALS: FULL_DIALS });
  KV.store.set("sold", "[1,2,9]"); ghSold = "[1, 2, 9]";
  for (const k of [...KV.store.keys()]) if (/^(nearly|stop|s02note|sent|list):/.test(k) && !/^sent:order_/.test(k)) KV.store.delete(k);
  KV.store.set("ship:order_N4", JSON.stringify({ buyer: { name: "priya mehta", email: "priya@example.com", phone: "+919800000044" }, city: "Pune", state: "MH" }));
  KV.store.set("ship:order_N9", JSON.stringify({ buyer: { name: "r2 d2", email: "digits@example.com", phone: "+919800000099" } }));
  KV.store.set("ship:order_P2", JSON.stringify({ buyer: { name: "Tara", email: "typed.first@example.com", phone: "+919800000077" } }));
  KV.store.set("hold:6", JSON.stringify({ by: "someone-else", until: Date.parse("2026-10-20T07:00:00Z") }));
  KV.store.set("stop:" + person("stop.me@example.com"), JSON.stringify({ at: "2026-10-19T00:00:00Z" }));
  const tick = async (iso, e = envN) => { Date.now = () => Date.parse(iso); const k = ctx(); await w.scheduled({}, e, k); await k.done(); };
  const nearly = () => mails.filter(m => /^No\. \d\d$|^[A-Z][a-z]+ of twenty$/.test(m.subject));
  const to = (e) => nearly().find(m => m.to[0] === e);

  mails.length = 0;
  await tick("2026-10-20T15:00:00Z");                                         /* 8:30 pm in India */
  ok(nearly().length === 0, "nearly: nothing goes out after eight in the evening");

  mails.length = 0;
  await tick("2026-10-20T06:00:00Z");                                         /* 11:30 am in India */
  const a = to("asha.r@example.com"), b = to("bilal@example.com"), c3 = to("priya@example.com"), dg = to("digits@example.com");
  ok(nearly().length === 4 && a && b && c3 && dg, "nearly: four people written to (" + nearly().map(m => m.to[0] + " / " + m.subject).join(", ") + ")");
  ok(a && a.subject === "No. 05" && /^Hello,\n\nYou chose No\. 05 yesterday\. The Emerald dial\. You got as far as checkout/.test(a.text) &&
    /Seventeen are left; three are already on someone's wrist\./.test(a.text) && /No\. 05: https:\/\/thekaal\.co\/#n5/.test(a.text) && /P\.S\. This is the only time we'll write about No\. 05\./.test(a.text),
    "nearly A: subject is the number, 'Hello,' without a name, when, dial, the count in words, the link to the number");
  ok(a && /<title>No\. 05<\/title>/.test(a.html) && /Still unclaimed\./.test(a.html) && !/<img|<h1|border-radius:999px|caseback/.test(a.html) && /text-decoration:underline/.test(a.html) && /font-size:16px/.test(a.html),
    "nearly A: a personal note: no picture, heading, button or card; 16px; the link one underlined line");
  ok(a && a.from === "KAAL <connect@thekaal.co>" && a.reply_to === "connect@thekaal.co" && /Reply "stop" and we won't write again\./.test(a.text) && /Reply &quot;stop&quot; and we won&#39;t write again\./.test(a.html),
    "nearly: from KAAL, replies come to connect@, and the footer says how to stop");
  ok(b && b.subject === "No. 09" && /It found its owner\./.test(b.html) && /^Hello,\n\nNo\. 09 is gone\. You chose it on Sunday,/.test(b.text) &&
    /If it was the Midnight dial that held you, No\. 07, No\. 08 and No\. 10 still carry it\. Of the twenty, seventeen are left\./.test(b.text) &&
    /The Midnight dial: https:\/\/thekaal\.co\/#n7/.test(b.text) && !/#n9/.test(b.text),
    "nearly B: a number sold since lists the same dial's open numbers and links to the lowest");
  ok(c3 && c3.subject === "Seventeen of twenty" && /Still open\./.test(c3.html) && /^Priya,\n\nYou got as far as checkout at KAAL on Saturday and stopped there\./.test(c3.text) &&
    /Of the twenty, seventeen are left and three are already on someone's wrist\./.test(c3.text) && /Choose yours: https:\/\/thekaal\.co\/#twenty/.test(c3.text),
    "nearly C: no number, an email from our own details step, their first name in title case, the count");
  ok(dg && /^Hello,/.test(dg.text), "nearly: a name with a digit in it is not used; 'Hello,' instead");
  ok(nearly().every(m => /\n\n/.test(m.text) && m.html), "nearly: always a plain-text part, with a blank line between paragraphs");
  ok(nearly().every(unsub), "nearly: List-Unsubscribe on every one");
  ok(nearly().every(clean), "nearly: no discount, hurry, last chance, exclusive, luxury, limited time, hold, reserve, exclamation mark or em dash");
  ok(!to("chetan@example.com") && !to("early@example.com") && !to("buyer@example.com") && !to("stop.me@example.com") && !to("typed.first@example.com"),
    "nearly: not while someone is paying for their number, not too soon, never to a buyer (whichever email they paid under), never after a stop");
  ok(nearly().filter(m => m.to[0] === "asha.r@example.com").length === 1, "nearly: two tries by one person is one email");
  ok(JSON.parse(KV.store.get("sent:2026-10-20")).nearly === 4, "nearly: the day's count is kept, by kind");
  ok(/^4 sent this run; 4 today \(nearly bought 4\)\.$/.test(JSON.parse(KV.store.get("followrun") || "{}").msg || ""), "nearly: the run leaves a line for the desk's Health list (" + (KV.store.get("followrun") || "") + ")");

  mails.length = 0;
  KV.store.delete("hold:6");
  await tick("2026-10-20T06:30:00Z");
  ok(nearly().length === 1 && to("chetan@example.com") && to("chetan@example.com").subject === "No. 06", "nearly: once the hold lapses, that person is written to on the next run");
  mails.length = 0;
  await tick("2026-10-20T07:00:00Z");
  await tick("2026-10-27T06:00:00Z");
  ok(nearly().length === 1 && to("early@example.com"), "nearly: everyone already written to is never written to again; the late one gets theirs when due");

  /* B, with the dial gone: every Midnight number sold. */
  mails.length = 0;
  KV.store.set("sold", "[1,2,7,8,9,10]"); ghSold = "[1, 2, 7, 8, 9, 10]";
  pays.push({ id: "pay_NB", status: "failed", order_id: "order_NB", email: "dana@example.com", created_at: at("2026-10-26T08:02:00Z") });
  orders.push({ id: "order_NB", status: "created", created_at: at("2026-10-26T08:00:00Z"), notes: { kaal_no: "08" } });
  await tick("2026-10-27T06:30:00Z");
  const fb = to("dana@example.com");
  ok(fb && fb.subject === "No. 08" && /The Midnight dial is now fully claimed\. Fourteen pieces remain in the other three\./.test(fb.text) &&
    /What's left: https:\/\/thekaal\.co\/#twenty/.test(fb.text) && !/still carry/.test(fb.text),
    "nearly B: with the dial fully claimed it says so and links to #twenty");

  /* The count is never guessed: no sold list, no email. */
  mails.length = 0; KV.store.delete("sold"); ghSold = "not-an-array";
  pays.push({ id: "pay_NU", status: "failed", order_id: "order_NU", email: "unknown.count@example.com", created_at: at("2026-10-26T09:02:00Z") });
  orders.push({ id: "order_NU", status: "created", created_at: at("2026-10-26T09:00:00Z"), notes: {} });
  await tick("2026-10-27T07:00:00Z", Object.assign({}, envN, { GITHUB_TOKEN: "" }));
  ok(!to("unknown.count@example.com"), "nearly: when the sold list cannot be read, nothing is sent rather than a wrong count");
  KV.store.set("sold", "[1,2,9]"); ghSold = "[1, 2, 9]";

  globalThis.fetch = base; Date.now = realNow;
}

/* The three shapes, rendered directly: the words for numbers and the
   "already worn" clause at its edges. */
{
  const M = await import("../worker/mail.js");
  const site = "https://thekaal.co";
  let m = M.buyerNearlyBought({ site, first: "Rahul", when: "Earlier today", n: 7, open: true, dial: "Midnight", sold: 0, left: 20 });
  ok(/^Rahul,\n\nYou chose No\. 07 earlier today\. The Midnight dial\./.test(m.text) && /Twenty are left\. We never make/.test(m.text) && !/wrist\. We never/.test(m.text),
    "nearly A: 'earlier today', and with none sold the 'already worn' clause is dropped");
  m = M.buyerNearlyBought({ site, when: "A few weeks ago", n: 7, open: true, dial: "Midnight", sold: 1, left: 19 });
  ok(/Nineteen are left; one is already on someone's wrist\./.test(m.text) && /You chose No\. 07 a few weeks ago\./.test(m.text), "nearly A: with one sold, 'one is already on someone's wrist'");
  m = M.buyerNearlyBought({ site, when: "Last week", n: 0, sold: 1, left: 19 });
  ok(m.subject === "Nineteen of twenty" && /nineteen are left and one is already on someone's wrist\./.test(m.text), "nearly C: the subject and the count in words");
  m = M.buyerNearlyBought({ site, when: "Yesterday", n: 9, open: false, dial: "Midnight", sold: 3, left: 17, sameDial: [10] });
  ok(/No\. 10 still carries it\./.test(m.text) && /The Midnight dial: https:\/\/thekaal\.co\/#n10/.test(m.text), "nearly B: one number left on the dial reads in the singular");
  const all = [m, M.seriesTwoNote({ site, left: 17 }), M.afterArrival({ site, n: 7 }), M.afterSettled({ site, n: 7, first: "Rahul" }), M.afterYear({ site, n: 7, until: "21 Oct 2028" }),
    M.buyerConfirmation({ site, n: 7, dial: "Midnight", amount: "₹5,999", paymentId: "pay_X", when: "21 Oct 2026, 2:00 pm", arriveBy: "Tue, 27 Oct", hasAddress: false, shipUrl: site + "/claimed.html#ship" }),
    M.buyerConfirmation({ site, n: 7, dial: "Midnight", amount: "₹5,999", paymentId: "pay_X", when: "21 Oct 2026, 2:00 pm", arriveBy: "Tue, 27 Oct", hasAddress: true, gift: true, giftNote: "Happy birthday" })];
  ok(all.every(clean), "every email: none of the banned words, no exclamation mark, no em dash");
  ok(/^Hello, this is KAAL\. You chose No\. 07, the Midnight dial, and stopped at payment\. It's still unclaimed, seventeen of the twenty are left/.test(M.nearlyWhatsApp({ site, n: 7, open: true, dial: "Midnight", left: 17 })),
    "nearly: the WhatsApp words for a phone with no email");
}

/* ── Part 2. The Series 02 list, one note each ── */
{
  const base = globalThis.fetch;
  const at = (iso) => Math.floor(Date.parse(iso) / 1000);
  const pays = [
    { id: "pay_S1", status: "captured", order_id: "order_S1", email: "list.buyer@example.com", created_at: at("2026-10-02T08:00:00Z") },
    { id: "pay_S2", status: "failed", order_id: "order_S2", email: "list.trying@example.com", created_at: at("2026-10-20T04:00:00Z") }
  ];
  const orders = [
    { id: "order_S1", status: "paid", created_at: at("2026-10-02T07:58:00Z"), notes: { kaal_no: "03" } },
    { id: "order_S2", status: "created", created_at: at("2026-10-20T03:58:00Z"), notes: { kaal_no: "04" } }
  ];
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (/\/v1\/refunds\?/.test(url)) return new Response(JSON.stringify({ items: [] }));
    const m = /\/v1\/(orders|payments)\?from=(\d+)&to=(\d+)/.exec(url);
    if (m) return new Response(JSON.stringify({ items: /skip=0/.test(url) ? (m[1] === "orders" ? orders : pays).filter(x => x.created_at >= +m[2] && x.created_at <= +m[3]) : [] }));
    return base(url, init);
  };
  const join = (email, iso) => KV.store.set("list:" + sha(email), JSON.stringify({ email, at: iso, source: "footer" }));
  for (const k of [...KV.store.keys()]) if (/^(nearly|stop|s02note|list):/.test(k) || /^sent:\d/.test(k)) KV.store.delete(k);
  KV.store.set("sold", "[1,2,9]");
  join("list.old@example.com", "2026-10-01T06:00:00Z");
  join("list.new@example.com", "2026-10-20T03:00:00Z");      // three hours before the run
  join("list.buyer@example.com", "2026-09-20T06:00:00Z");    // paid since
  join("list.nearly@example.com", "2026-09-20T06:00:00Z");   // had the nearly-bought note
  join("list.stop@example.com", "2026-09-20T06:00:00Z");     // replied stop
  join("list.trying@example.com", "2026-09-20T06:00:00Z");   // a checkout of their own, in that note's window
  KV.store.set("nearly:" + person("list.nearly@example.com"), JSON.stringify({ at: "x" }));
  KV.store.set("stop:" + person("list.stop@example.com"), JSON.stringify({ at: "x" }));
  const envS = Object.assign({}, envC, { SERIES02_EMAIL: "on", DIALS: FULL_DIALS });
  const tick = async (iso, e = envS) => { Date.now = () => Date.parse(iso); const k = ctx(); await w.scheduled({}, e, k); await k.done(); };
  const notes = () => mails.filter(m => m.subject === "Series 02");

  mails.length = 0;
  await tick("2026-10-20T06:00:00Z");
  ok(notes().length === 1 && notes()[0].to[0] === "list.old@example.com", "series 02: one note, to the sign-up a day old who has not paid, had the nearly note, stopped, or got a checkout going (" + notes().map(m => m.to[0]).join(", ") + ")");
  const s = notes()[0];
  ok(s && /^Hello,\n\nYou asked us to write once, when Series 02 is drawn\./.test(s.text) && /Of the twenty, seventeen are left, and when the last is claimed/.test(s.text) &&
    /The seventeen: https:\/\/thekaal\.co\/#twenty/.test(s.text) && /Not drawn yet\. One thing before it is\./.test(s.html) && unsub(s) && clean(s) && /Reply "stop"/.test(s.text),
    "series 02: the words, the count in words, the link, List-Unsubscribe, the stop line");
  mails.length = 0;
  await tick("2026-10-20T06:30:00Z");
  ok(notes().length === 0, "series 02: never twice, and a new sign-up waits its 24 hours");
  await tick("2026-10-21T04:40:00Z");                                         /* 10:10 am in India, a day and more after joining */
  ok(notes().length === 1 && notes()[0].to[0] === "list.new@example.com", "series 02: a new sign-up gets it once they have been on the list a day");
  ok(!mails.some(m => /list\.(buyer|nearly|stop)@/.test(m.to[0])), "series 02: never to a buyer, to someone who had the nearly note, or after a stop");

  /* Ten a run, ninety a day. */
  for (let i = 0; i < 30; i++) join(`bulk${i}@example.com`, "2026-10-01T06:00:00Z");
  mails.length = 0;
  const t0 = performance.now();
  await tick("2026-10-21T05:00:00Z", Object.assign({}, envS, { FOLLOW_GAP_MS: "30" }));
  ok(notes().length === 10, "cap: at most ten in one run (" + notes().length + ")");
  ok(performance.now() - t0 >= 9 * 30, "pace: the sends in a run are spaced, never fired back to back");
  KV.store.set("sent:2026-10-21", JSON.stringify({ total: 87 }));
  mails.length = 0;
  await tick("2026-10-21T05:30:00Z");
  ok(notes().length === 3 && JSON.parse(KV.store.get("sent:2026-10-21")).total === 90, "cap: the day stops at ninety, every kind together (" + notes().length + ")");
  mails.length = 0;
  await tick("2026-10-21T06:00:00Z");
  ok(notes().length === 0, "cap: nothing more that day");
  await tick("2026-10-22T05:00:00Z");
  ok(notes().length === 10, "cap: the next day starts again");
  KV.store.set("sold", JSON.stringify(Array.from({ length: 20 }, (_, i) => i + 1)));
  mails.length = 0;
  await tick("2026-10-23T05:00:00Z");
  ok(notes().length === 0, "series 02: nothing once Series 01 has no piece left");
  KV.store.set("sold", "[1,2,9]");
  mails.length = 0;
  await tick("2026-10-24T05:00:00Z", Object.assign({}, envS, { SERIES02_EMAIL: "off" }));
  ok(notes().length === 0, "series 02: SERIES02_EMAIL off sends nothing");
  globalThis.fetch = base; Date.now = realNow;
}

/* ── Part 3. The moment they pay ── */
{
  /* The welcome email, as the webhook sends it (section 4 above sent it to
     a buyer who gave no name before paying). */
  const welcome = mine;
  const di = welcome.html.indexOf("dial-emerald.jpg"), ci = welcome.html.indexOf("caseback-03.png");
  ok(di > 0 && ci > di, "welcome: No. 03 names the Emerald dial's picture, then its caseback");
  /* That order was a gift: bought by one person, worn by another. */
  ok(/^Hello,\n\nNo\. 03 is yours to give\. Of everyone who will ever wear a KAAL, the person you give it to is the only one who will wear this one\./.test(welcome.text) &&
    /₹5,999 received\. Here is what happens now\./.test(welcome.html) && /WHAT HAPPENS NOW\n1\. Today: No\. 03 comes out of the edition/.test(welcome.text) &&
    /3\. Within five working days: it is dispatched\. Tracking comes to this email the day it leaves\. It arrives by /.test(welcome.text) &&
    /Once it arrives, there are seven days to live with it\./.test(welcome.text) &&
    /Rare pieces find rare people\. This one found you\./.test(welcome.text) && /\nKAAL$/.test(welcome.text), "welcome: 'Hello,' without a name; a gift is the buyer's to give; the three steps; signed KAAL");
  ok(!welcome.headers && clean(welcome), "welcome: no List-Unsubscribe on an order email, and nothing it must not say");
  const M = await import("../worker/mail.js");
  const g = M.buyerConfirmation({ site: "https://thekaal.co", n: 7, dial: "Midnight", first: "Rahul", amount: "₹5,999", paymentId: "pay_X", when: "x", arriveBy: "Tue, 27 Oct", hasAddress: true });
  ok(/^Rahul,\n\nNo\. 07 is yours\. Of everyone who will ever wear a KAAL, you are the only one who will wear this one\./.test(g.text) &&
    /3\. Within five working days: it is dispatched to your door\. Tracking comes to this email the day it leaves\. It reaches you by Tue, 27 Oct\./.test(g.text) &&
    /At your door, you have seven days to live with it\. If it isn't you, send it back unworn for a full refund\./.test(g.text) && /dial-midnight\.jpg/.test(g.html),
    "welcome: their first name, the words for the one who will wear it, the Midnight dial for No. 07");
  /* With a name given before paying, the webhook's email uses it. */
  mails.length = 0;
  KV.store.set("ship:order_TESTORDER7", JSON.stringify({ src: "checkout", name: "Rahul Sharma", line1: "1 Road", city: "Delhi", state: "Delhi", pin: "110001", phone: "+919999999999", buyer: { name: "rahul sharma", email: "rahul.sharma@example.com", phone: "+919999999999" } }));
  const e7 = Object.assign({}, entity, { id: "pay_WELCOME7", order_id: "order_TESTORDER7", notes: { kaal_no: "07" } });
  const b7 = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: e7 } } });
  await hook(b7, Object.assign({}, env, { DIALS: FULL_DIALS }));
  const w7 = mails.find(m => m.to[0] === "rahul.sharma@example.com");
  ok(w7 && /^Rahul,\n\nNo\. 03 is yours/.test(w7.text) && /We have your delivery address/.test(w7.text), "welcome: 'Rahul,' from the name given before paying");

  /* Every way a payment can succeed ends on claimed.html. */
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const confirm = (/function confirmPayment[\s\S]*?\n}\n/.exec(page) || [""])[0];
  ok(/fetch\(KAAL\.api\.replace\([^)]*\) \+ "\/verify"/.test(confirm) && /location\.href = "claimed\.html\?razorpay_payment_id=" \+ encodeURIComponent\(ref\)/.test(confirm),
    "paths: the modal's handler verifies, then goes to claimed.html");
  ok(/handler:\s*function\s*\(res\)\s*\{\s*confirmPayment\(res/.test(page), "paths: the modal's success handler calls confirmPayment");
  ok(/opts\.callback_url = KAAL\.api\.replace\([^)]*\) \+ "\/callback"/.test(page), "paths: in-app browsers and redirects are sent to the worker's /callback (which redirects to claimed.html, tested above)");
  ok(/function recoverCheckout[\s\S]*?location\.replace\("claimed\.html\?razorpay_payment_id="/.test(page), "paths: a tab the phone threw away mid-payment recovers to claimed.html");
  const vsig = createHmac("sha256", "sek").update("order_TESTORDER1|pay_ABC123").digest("hex");
  r = await w.fetch(new Request("https://w/verify", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://thekaal.co" },
    body: JSON.stringify({ razorpay_order_id: "order_TESTORDER1", razorpay_payment_id: "pay_ABC123", razorpay_signature: vsig }) }), env, ctx());
  ok(r.status === 200 && (await r.json()).ok === true, "paths: /verify confirms a signed payment, so the handler goes on to claimed.html");
  r = await w.fetch(new Request("https://w/verify", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ razorpay_order_id: "order_TESTORDER1", razorpay_payment_id: "pay_ABC123", razorpay_signature: "bad" }) }), env, ctx());
  ok(r.status === 400, "paths: /verify refuses a bad signature, and the page does not claim a sale");
  const thanks = readFileSync(new URL("../claimed.html", import.meta.url), "utf8");
  ok(/id="ship"/.test(thanks) && /kaalQ = window\.kaalQ \|\| \[\]\)\.push\(\["purchase"/.test(thanks) && /\/receipt\?o=/.test(thanks) && />It is yours\.</.test(thanks) &&
    /assets\/email\/dial-/.test(thanks) && /assets\/email\/caseback-/.test(thanks) && /What happens now/.test(thanks), "claimed.html: the address form, the Purchase event and the order lookup kept; its dial and caseback; the three steps");
}

/* ── Part 4. After the purchase ── */
{
  const base = globalThis.fetch;
  const at = (iso) => Math.floor(Date.parse(iso) / 1000);
  const pays = [
    { id: "pay_A1", status: "captured", order_id: "order_A1", email: "owner.one@example.com", amount: 599900, amount_refunded: 0, created_at: at("2026-10-01T06:00:00Z"), notes: { kaal_no: "03" } },
    { id: "pay_A2", status: "captured", order_id: "order_A2", email: "gift.giver@example.com", amount: 599900, amount_refunded: 0, created_at: at("2026-10-01T06:10:00Z"), notes: { kaal_no: "04", gift: "yes" } },
    { id: "pay_A3", status: "captured", order_id: "order_A3", email: "part.refund@example.com", amount: 599900, amount_refunded: 50000, created_at: at("2026-10-01T06:20:00Z"), notes: { kaal_no: "05" } },
    { id: "pay_A4", status: "captured", order_id: "order_A4", email: "owner.stop@example.com", amount: 599900, amount_refunded: 0, created_at: at("2026-10-01T06:30:00Z"), notes: { kaal_no: "06" } },
    { id: "pay_A5", status: "captured", order_id: "order_A5", email: "not.sent@example.com", amount: 599900, amount_refunded: 0, created_at: at("2026-10-01T06:40:00Z"), notes: { kaal_no: "07" } },
    { id: "pay_A6", status: "refunded", order_id: "order_A6", email: "full.refund@example.com", amount: 599900, amount_refunded: 599900, created_at: at("2026-10-01T06:50:00Z"), notes: { kaal_no: "08" } }
  ];
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (/\/v1\/refunds\?/.test(url)) return new Response(JSON.stringify({ items: [] }));
    const m = /\/v1\/(orders|payments)\?from=(\d+)&to=(\d+)/.exec(url);
    if (m) return new Response(JSON.stringify({ items: m[1] === "payments" && /skip=0/.test(url) ? pays.filter(x => x.created_at >= +m[2] && x.created_at <= +m[3]) : [] }));
    return base(url, init);
  };
  for (const k of [...KV.store.keys()]) if (/^(after\d|stop|list|s02note):/.test(k) || /^sent:\d/.test(k)) KV.store.delete(k);
  for (const o of ["order_A1", "order_A2", "order_A3", "order_A4", "order_A6"]) KV.store.set("sent:" + o, JSON.stringify({ at: "2026-10-03T10:00:00Z", courier: "Delhivery", tracking: "DL1" }));
  KV.store.set("ship:order_A1", JSON.stringify({ name: "Meera Iyer", line1: "1 Road", city: "Pune", state: "MH", pin: "411001", phone: "+919800000001", buyer: { name: "meera iyer", email: "owner.one@example.com" } }));
  KV.store.set("stop:" + person("owner.stop@example.com"), JSON.stringify({ at: "x" }));
  const envA = Object.assign({}, envC, { ARRIVAL_EMAIL: "on", SETTLED_EMAIL: "on", YEAR_EMAIL: "on", DIALS: FULL_DIALS });
  const tick = async (iso, e = envA) => { Date.now = () => Date.parse(iso); const k = ctx(); await w.scheduled({}, e, k); await k.done(); };
  const by = (e, re) => mails.filter(m => m.to[0] === e && re.test(m.subject));

  /* Paid Thu 1 Oct, arrives by Wed 7 Oct, dispatched Sat 3 Oct. */
  mails.length = 0;
  await tick("2026-10-07T06:00:00Z");
  ok(!mails.some(m => /arrived\?/.test(m.subject)), "after: nothing on the arrive-by day itself");
  await tick("2026-10-08T06:00:00Z");
  const a1 = by("owner.one@example.com", /^Has No\. 03 arrived\?$/)[0];
  ok(a1 && /^Meera,\n\nWe hope No\. 03 arrived well/.test(a1.text) && /We set the day, the date and the twenty-four hour hand before it left us, so it should read true when you open the box: the day at twelve, the date at six, the twenty-four hours at nine\./.test(a1.text) &&
    /If anything isn't right, reply here\.\n\nKAAL$/.test(a1.text) && /caseback-03\.png/.test(a1.html) && clean(a1),
    "after 4a: the day after arrive-by, 'Has No. 03 arrived?', their first name, set before it left, signed KAAL");
  ok(by("gift.giver@example.com", /arrived\?/).length === 1 && by("part.refund@example.com", /arrived\?/).length === 1, "after 4a: a gift's buyer and a part refund are asked too");
  ok(!mails.some(m => m.to[0] === "owner.stop@example.com" || m.to[0] === "not.sent@example.com" || m.to[0] === "full.refund@example.com"),
    "after: never after a stop, never before dispatch, never for a full refund");
  mails.length = 0;
  await tick("2026-10-08T06:30:00Z");
  ok(!mails.some(m => /arrived\?/.test(m.subject)), "after 4a: once per order");

  mails.length = 0;
  await tick("2026-10-14T06:00:00Z");
  ok(!mails.some(m => /for good/.test(m.subject)), "after 4b: not before the seven days from the arrive-by date have run out");
  await tick("2026-10-15T06:00:00Z");
  const a2 = by("owner.one@example.com", /^No\. 03 is yours for good$/)[0];
  ok(a2 && /^Meera,\n\nThe seven days have passed\./.test(a2.text) && /city and month can sit under No\. 03 on thekaal\.co, for example "Delhi · Oct 2026"\. Reply "yes" to be listed\./.test(a2.text) &&
    /end your reply with "Yes, you can publish this"\. There is no gift for doing so\./.test(a2.text) && clean(a2), "after 4b: ten days after dispatch, the register and the three questions");
  ok(!by("gift.giver@example.com", /for good/).length && !by("part.refund@example.com", /for good/).length, "after 4b: not for a gift, nor where any refund exists");

  /* The desk shows what went, on each order. */
  {
    const deskEnv = Object.assign({}, envA, { DESK_PASSCODE: "brass-quiet-lantern-42" });
    const login = await w.fetch(new Request("https://k.example.workers.dev/desk/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Desk": "1", "cf-connecting-ip": "6.6.6.6" }, body: JSON.stringify({ passcode: "brass-quiet-lantern-42" }) }), deskEnv, ctx());
    const jar = { Cookie: (login.headers.get("Set-Cookie") || "").split(";")[0], "X-Desk": "1" };
    const dd = await (await w.fetch(new Request("https://k.example.workers.dev/desk/data", { headers: jar }), deskEnv, ctx())).json();
    const o1 = (dd.orders || []).find(o => o.orderId === "order_A1");
    ok(o1 && o1.after && o1.after.after1 && o1.after.after2 && !o1.after.after3, "desk: each order carries the notes sent to its owner");
    let sr = await w.fetch(new Request("https://k.example.workers.dev/desk/stop", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, jar), body: JSON.stringify({ email: "Owner.One@example.com" }) }), deskEnv, ctx());
    ok((await sr.json()).stopped === true && KV.store.has("stop:" + person("owner.one@example.com")), "desk: 'Stop emails to this person' sets stop:<hash>");
    sr = await w.fetch(new Request("https://k.example.workers.dev/desk/stop", { method: "POST", headers: { "Content-Type": "application/json", Cookie: jar.Cookie }, body: JSON.stringify({ email: "x@example.com" }) }), deskEnv, ctx());
    ok(sr.status === 403, "desk: the stop is refused without the desk's own header");
    await w.fetch(new Request("https://k.example.workers.dev/desk/stop", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, jar), body: JSON.stringify({ email: "owner.one@example.com", undo: true }) }), deskEnv, ctx());
    ok(!KV.store.has("stop:" + person("owner.one@example.com")), "desk: and can be taken back");
  }

  mails.length = 0;
  await tick("2027-10-04T06:00:00Z");
  const a3 = by("owner.one@example.com", /^One year with No\. 03$/)[0];
  ok(a3 && /^Meera,\n\nA year ago No\. 03 left us for your wrist\./.test(a3.text) && /The movement warranty runs for one more year, until 3 Oct 2028\./.test(a3.text) &&
    /When Series 02 is drawn, owners of Series 01 hear first\./.test(a3.text) && clean(a3), "after 4c: a year after dispatch, the warranty's last year, Series 02 first");
  ok(!mails.some(m => /arrived\?|for good/.test(m.subject)), "after: a stale note is never sent late");
  ok(mails.every(m => !m.headers), "after: no List-Unsubscribe on a note to an owner about their own watch");

  /* Each switch on its own. */
  for (const k of [...KV.store.keys()]) if (/^after\d:/.test(k)) KV.store.delete(k);
  mails.length = 0;
  await tick("2026-10-08T07:00:00Z", Object.assign({}, envA, { ARRIVAL_EMAIL: "off" }));
  ok(!mails.some(m => /arrived\?/.test(m.subject)), "after: ARRIVAL_EMAIL off sends no arrival note");

  /* The daily report counts each kind. */
  for (const k of [...KV.store.keys()]) if (/^digest:/.test(k)) KV.store.delete(k);
  KV.store.set("sent:2026-10-08", JSON.stringify({ total: 3, after1: 3 }));
  mails.length = 0;
  await tick("2026-10-08T18:35:00Z");
  const rep2 = mails.find(m => /^KAAL daily · Thu 8 Oct/.test(m.subject));
  ok(rep2 && /EMAILS SENT ON THEIR OWN\nNearly bought: 0\nSeries 02 note: 0\nArrival note: 3\nSeven-day note: 0\nOne-year note: 0/.test(rep2.text) && /Emails sent on their own/.test(rep2.html),
    "report: a count of each email the worker sent on its own that day");
  globalThis.fetch = base; Date.now = realNow;
}

/* ── 15. Meta hears of every sale (October 2026: two sales it never did) ── */
{
  const base = globalThis.fetch, realNow = Date.now;
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  const sent = [];
  let metaStatus = 200, catchPays = [];
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith("https://graph.facebook.com/")) { sent.push({ url, body: JSON.parse(init.body) }); return new Response(metaStatus === 200 ? '{"events_received":1}' : '{"error":{"message":"Invalid OAuth access token"}}', { status: metaStatus }); }
    if (/\/v1\/payments\?from=/.test(url)) return new Response(JSON.stringify({ items: /skip=0/.test(url) ? catchPays : [] }));
    if (/\/v1\/(orders|refunds)\?/.test(url)) return new Response(JSON.stringify({ items: [] }));
    const m = /\/orders\/(order_M\w+)$/.exec(url);
    if (m) return new Response(JSON.stringify({ id: m[1], status: "paid", amount: m[1] === "order_MSHORT" ? 100 : 599900, currency: "INR", created_at: 1790000000,
      notes: { kaal_no: m[1] === "order_MNONE" ? "" : "07", ua: "Mozilla/5.0 (iPhone)", ip: "203.0.113.9", fbp: "fb.1.1790000000000.123456789", fbc: "fb.1.1790000000000.IwAR0abc-_x.Bg" } }));
    return base(url, init);
  };
  const envM = Object.assign({}, env, { META_PIXEL: "1607748840888926", META_CAPI_TOKEN: "EAAsecretTOKEN42" });
  for (const k of [...KV.store.keys()]) if (/^(meta|mailed):/.test(k)) KV.store.delete(k);
  KV.store.set("ship:order_MAIN1", JSON.stringify({ src: "checkout", name: "Rahul Sharma", line1: "1 Road", city: "Delhi", state: "Delhi", pin: "110001", phone: "+919999999999", buyer: { name: "Rahul K. Sharma", email: "rahul.sharma@example.com", phone: "+919999999999" } }));
  ghSold = "[1, 2, 7]";   /* the commit finds it already recorded: the retry that used to skip Meta */
  const pay = { id: "pay_META1", order_id: "order_MAIN1", amount: 599900, currency: "INR", email: "Rahul.Sharma@example.com", contact: "9999999999", created_at: 1790000000, notes: { kaal_no: "07" } };
  const mb = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: pay } } });
  r = await hook(mb, envM);
  ok(/already recorded/.test(await r.text()) && sent.length === 1, "meta: a sale is sent even when the commit finds it already recorded");
  const ev = sent[0] && sent[0].body.data[0], u = ev && ev.user_data;
  ok(sent[0] && /\/v23\.0\/1607748840888926\/events\?access_token=EAAsecretTOKEN42$/.test(sent[0].url), "meta: to the pixel in wrangler.toml, with the token");
  ok(ev && ev.event_name === "Purchase" && ev.event_id === "pay_META1" && ev.action_source === "website" && ev.event_time === 1790000000 && ev.event_source_url === "https://thekaal.co/claimed.html",
    "meta: Purchase, deduplicated against the browser by the payment id, at the time of payment");
  ok(ev && ev.custom_data.value === 5999 && ev.custom_data.currency === "INR" && ev.custom_data.content_ids[0] === "KAAL-07" && ev.custom_data.order_id === "order_MAIN1",
    "meta: the price, the currency and the number, as the browser sends them");
  ok(u && u.em[0] === sha("rahul.sharma@example.com") && u.ph[0] === sha("919999999999") && u.fn[0] === sha("rahul") && u.ln[0] === sha("sharma") && u.country[0] === sha("in"),
    "meta: email, phone (with 91) and name hashed, normalised the way Meta asks");
  ok(u && u.client_user_agent === "Mozilla/5.0 (iPhone)" && u.client_ip_address === "203.0.113.9" && u.fbp === "fb.1.1790000000000.123456789" && u.fbc === "fb.1.1790000000000.IwAR0abc-_x.Bg",
    "meta: the browser's match keys from the order, the click id's suffix kept");
  const raw = JSON.stringify(sent[0].body);
  ok(!/rahul|9999999999|1 Road|110001|Delhi/i.test(raw), "meta: nothing about the buyer leaves in the clear, and never the address");
  ok(KV.store.has("meta:pay_META1") && JSON.parse(KV.store.get("meta:last")).ok === true, "meta: an accepted sale is marked, and the desk can say so");
  sent.length = 0; await hook(mb, envM);
  ok(sent.length === 0, "meta: a webhook retry does not send it twice");

  /* Without the token, nothing goes to Meta at all. */
  KV.store.delete("meta:pay_META1"); sent.length = 0;
  await hook(mb, Object.assign({}, envM, { META_CAPI_TOKEN: "" }));
  ok(sent.length === 0, "meta: no token, nothing sent");

  /* The half-hourly run: what the webhook did not get through. */
  const at = (iso) => Math.floor(Date.parse(iso) / 1000);
  Date.now = () => Date.parse("2026-10-22T12:00:00Z");
  catchPays = [
    Object.assign({}, pay, { id: "pay_C_OLD", created_at: at("2026-10-14T09:00:00Z"), status: "captured" }),
    Object.assign({}, pay, { id: "pay_C_10", created_at: at("2026-10-20T08:54:00Z"), status: "captured" }),
    Object.assign({}, pay, { id: "pay_C_07", created_at: at("2026-10-22T08:55:00Z"), status: "captured" }),
    Object.assign({}, pay, { id: "pay_C_DONE", created_at: at("2026-10-21T08:55:00Z"), status: "captured" }),
    Object.assign({}, pay, { id: "pay_C_FAIL", created_at: at("2026-10-21T09:00:00Z"), status: "failed" }),
    Object.assign({}, pay, { id: "pay_C_RS1", amount: 100, created_at: at("2026-10-21T09:05:00Z"), status: "captured" }),
    Object.assign({}, pay, { id: "pay_C_SHORT", order_id: "order_MSHORT", created_at: at("2026-10-21T09:10:00Z"), status: "captured" }),
    Object.assign({}, pay, { id: "pay_C_NONE", order_id: "order_MNONE", created_at: at("2026-10-21T09:15:00Z"), status: "captured" }),
    Object.assign({}, pay, { id: "pay_C_NOORD", order_id: undefined, created_at: at("2026-10-21T09:20:00Z"), status: "captured" }),
    Object.assign({}, pay, { id: "pay_C_RETURNED", created_at: at("2026-10-21T09:25:00Z"), status: "refunded", amount_refunded: 599900 })
  ];
  catchPays = catchPays.filter(p => p.created_at >= at("2026-10-22T12:00:00Z") - (6 * 86400 + 12 * 3600));
  KV.store.set("meta:pay_C_DONE", "x");
  sent.length = 0;
  let k = ctx(); await w.scheduled({}, envM, k); await k.done();
  const ids = sent.map(s => s.body.data[0].event_id).sort();
  ok(ids.join() === "pay_C_07,pay_C_10", "meta catch-up: the two unsent sales of the week go, nothing else (done, failed, ₹1, short order, no number, no order, returned)");
  sent.length = 0; k = ctx(); await w.scheduled({}, envM, k); await k.done();
  ok(sent.length === 0, "meta catch-up: once Meta has them, never again");

  /* Meta says no: told on the desk, tried again next run. */
  KV.store.delete("meta:pay_C_07"); metaStatus = 400; sent.length = 0;
  k = ctx(); await w.scheduled({}, envM, k); await k.done();
  const last = JSON.parse(KV.store.get("meta:last") || "{}");
  ok(sent.length === 1 && !KV.store.has("meta:pay_C_07") && last.ok === false && /HTTP 400 .*Invalid OAuth/.test(last.why) && !/EAAsecretTOKEN42/.test(last.why), "meta: a refusal is kept for the desk (never the token) and not marked sent");
  const firstAt = last.at;
  Date.now = () => Date.parse("2026-10-22T12:30:00Z");
  k = ctx(); await w.scheduled({}, envM, k); await k.done();
  ok(JSON.parse(KV.store.get("meta:last")).at === firstAt, "meta: the same refusal half an hour later spends no KV write");
  metaStatus = 200; sent.length = 0;
  k = ctx(); await w.scheduled({}, envM, k); await k.done();
  ok(sent.length === 1 && KV.store.has("meta:pay_C_07"), "meta: and goes through on the next run once Meta accepts it");

  /* /order keeps the browser's keys for the webhook, and only real ones. */
  let orderNotes = null;
  const fetch2 = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (/\/v1\/orders$/.test(String(url)) && init && init.method === "POST") { orderNotes = JSON.parse(init.body).notes; return new Response(JSON.stringify({ id: "order_NEWONE1", amount: 599900, currency: "INR" })); }
    return fetch2(url, init);
  };
  const order = (b, h) => w.fetch(new Request("https://w/order", { method: "POST", headers: Object.assign({ "Content-Type": "application/json", "User-Agent": "UA/1", "cf-connecting-ip": "198.51.100.1" }, h || {}), body: JSON.stringify(Object.assign({ n: 11, by: "abc123def" }, b)) }), envM, ctx());
  KV.store.delete("hold:11");
  await order({ fbp: "fb.1.1790000000000.987654321.AQ", fbc: "fb.1.1790000000000.IwZXh0bgNhZW0" });
  ok(orderNotes && orderNotes.fbp === "fb.1.1790000000000.987654321.AQ" && orderNotes.fbc === "fb.1.1790000000000.IwZXh0bgNhZW0" && orderNotes.ua === "UA/1" && orderNotes.ip === "198.51.100.1", "order: the Pixel's cookies, user agent and address kept for Meta");
  KV.store.delete("hold:11");
  await order({ fbp: "<script>", fbc: "fb.1.x.y" });
  ok(orderNotes && !("fbp" in orderNotes) && !("fbc" in orderNotes), "order: anything that is not a Meta cookie is dropped");

  /* The ceiling per address: the twenty cannot be held by one script. */
  let last429 = null, okCount = 0;
  for (let i = 0; i < 14; i++) {
    KV.store.delete("hold:" + (i % 20 + 1));
    const res = await w.fetch(new Request("https://w/order", { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": "192.0.2.77" }, body: JSON.stringify({ n: (i % 20) + 1, by: "bot" + i }) }), envM, ctx());
    if (res.status === 429) last429 = await res.json(); else okCount++;
  }
  ok(okCount === 12 && last429 && last429.reason === "rate", "rate: one address gets twelve checkouts in ten minutes, then 429");
  r = await w.fetch(new Request("https://w/order", { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": "192.0.2.78" }, body: JSON.stringify({ n: 15, by: "person" }) }), envM, ctx());
  ok(r.status !== 429, "rate: somebody else is not affected");
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) KV.store.delete("hold:" + n);
  globalThis.fetch = fetch2;

  /* The desk shows whether Meta is hearing. */
  const deskEnv = Object.assign({}, envM, { DESK_PASSCODE: "correct horse battery" });
  const expMs = String(Date.now() + 86400000);
  const cookie = `kaal_desk=${expMs}.${createHmac("sha256", `kaal-desk|correct horse battery|sek`).update("desk|" + expMs).digest("hex")}`;
  r = await w.fetch(new Request("https://w/desk/data", { headers: { Cookie: cookie } }), deskEnv, ctx());
  const dd = await r.json();
  const mh = dd.health && dd.health.find(h => /^Meta/.test(h.label));
  ok(mh && mh.ok === true && /^On\. Last sale sent .*No\. 07/.test(mh.detail), "desk: Health says Meta is on, and when it last heard");
  r = await w.fetch(new Request("https://w/desk/data", { headers: { Cookie: cookie } }), Object.assign({}, deskEnv, { META_CAPI_TOKEN: "" }), ctx());
  const mh2 = (await r.json()).health.find(h => /^Meta/.test(h.label));
  ok(mh2 && mh2.ok === false && /META_CAPI_TOKEN is not set/.test(mh2.detail), "desk: and says plainly when it is off");

  globalThis.fetch = base; Date.now = realNow;
}

/* ── 16. The first address is the address ── */
{
  mails.length = 0; orderStatus = "paid"; payStatus = "captured";
  KV.store.set("ship:order_TESTORDER1", JSON.stringify({ at: "2026-10-20T10:00:00Z", name: "Ravi Kumar", line1: "12 Park Street", city: "Kolkata", state: "West Bengal", pin: "700016", phone: "+919876543210" }));
  const thief = { o: "order_TESTORDER1", name: "Someone Else", phone: "+91 90000 00000", line1: "9 Other Road", line2: "", city: "Mumbai", state: "Maharashtra", pin: "400001" };
  r = await w.fetch(new Request("https://w/shipping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(thief) }), env, ctx());
  const j = await r.json();
  ok(r.status === 409 && j.reason === "exists" && JSON.parse(KV.store.get("ship:order_TESTORDER1")).pin === "700016" && mails.length === 0,
    "shipping: a second address for a paid order is refused, the first stays, nobody is emailed 'use this one instead'");
  const thanks = (await import("node:fs")).readFileSync(new URL("../claimed.html", import.meta.url), "utf8");
  ok(/reason === "exists"/.test(thanks), "claimed.html: says the address is already in, and how to change it");
}

/* ── 17. A sale's commit carries what is left, for readers that run no script ── */
{
  const fs = await import("node:fs");
  const S = await import("../worker/stock.js");
  const files = { "index.html": fs.readFileSync(new URL("../index.html", import.meta.url), "utf8"), "llms.txt": fs.readFileSync(new URL("../llms.txt", import.meta.url), "utf8") };
  const before = S.configOf(files["index.html"]).sold;
  const open = [5, 6, 8, 11].find(n => before.indexOf(n) < 0);
  const base = globalThis.fetch;
  let trees = [], patches = [], puts = [], race = 0, refDown = false;
  globalThis.fetch = async (url, init) => {
    url = String(url); const m = (init && init.method) || "GET";
    if (/\/orders\/order_STOCK\d$/.test(url)) return new Response(JSON.stringify({ id: "order_STOCK1", status: "paid", amount: 599900, currency: "INR", created_at: 1790000000, notes: { kaal_no: String(open) } }));
    if (!url.includes("api.github.com")) return base(url, init);
    if (/\/git\/ref\/heads\/main$/.test(url)) return refDown ? new Response("down", { status: 502 }) : new Response(JSON.stringify({ object: { sha: "a".repeat(40) } }));
    const f = /\/contents\/([a-z.]+)\?ref=/.exec(url);
    if (f && m === "GET") {
      if (/raw/.test((init.headers || {}).Accept || "")) return files[f[1]] != null ? new Response(files[f[1]]) : new Response("", { status: 404 });
      return new Response(JSON.stringify({ content: Buffer.from(files[f[1]] || "").toString("base64"), sha: "x" }));
    }
    if (/\/git\/commits\/[0-9a-f]{40}$/.test(url)) return new Response(JSON.stringify({ tree: { sha: "t".repeat(40) } }));
    if (/\/git\/trees$/.test(url)) { trees.push(JSON.parse(init.body)); return new Response(JSON.stringify({ sha: "b".repeat(40) }), { status: 201 }); }
    if (/\/git\/commits$/.test(url)) return new Response(JSON.stringify({ sha: "c".repeat(40) }), { status: 201 });
    if (/\/git\/refs\/heads\/main$/.test(url) && m === "PATCH") { patches.push(JSON.parse(init.body)); return race-- > 0 ? new Response("{}", { status: 422 }) : new Response("{}"); }
    if (m === "PUT") { puts.push(JSON.parse(init.body)); return new Response("{}"); }
    return new Response("{}", { status: 404 });
  };
  const sell = (id) => hook(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id, order_id: "order_STOCK1", amount: 599900, currency: "INR", email: "stock@example.com", contact: "+919800000011", created_at: 1791000000 } } } }));
  KV.store.set("sold", JSON.stringify(before)); race = 1;
  r = await sell("pay_STOCK01");
  const t = trees[trees.length - 1] || { tree: [] }, by = {};
  for (const x of t.tree) by[x.path] = x.content;
  const after = by["index.html"] ? S.configOf(by["index.html"]) : null, st = after && S.stockOf(after);
  ok(r.status === 200 && patches.length === 2 && patches.every(p => p.force === false) && puts.length === 0 && Object.keys(by).sort().join() === "edition.json,index.html,llms.txt",
    "stock: a sale is ONE commit of index.html, llms.txt and edition.json, main moved without force, and a race read again");
  ok(after && after.sold.indexOf(open) > -1 && S.applyStockHtml(by["index.html"]) === by["index.html"] && new RegExp('<span id="heroLeft">' + (20 - before.length - 1) + "<").test(by["index.html"]) &&
    new RegExp('"sku": "KAAL-' + String(open).padStart(2, "0") + '"[\\s\\S]*?SoldOut').test(by["index.html"]),
    "stock: the page's counts, its grid and No. " + open + "'s structured data all say it is gone");
  ok(st && S.llmsAgrees(by["llms.txt"], st) && S.editionAgrees(by["edition.json"], st) && JSON.parse(by["edition.json"]).available === st.remaining,
    "stock: llms.txt's Live status and edition.json say the same, " + (st && st.remaining) + " left");
  /* GitHub's Git Data API down: the one-file path still marks it, counts and all. */
  KV.store.set("sold", JSON.stringify(before)); refDown = true; trees = []; patches = [];
  r = await sell("pay_STOCK02");
  const put = puts[0] ? Buffer.from(puts[0].content, "base64").toString("utf8") : "";
  ok(r.status === 200 && trees.length === 0 && puts.length === 1 && S.configOf(put).sold.indexOf(open) > -1 && S.applyStockHtml(put) === put && /काल/.test(put),
    "stock: if that fails, the old single-file write still marks it, prints the counts and keeps the page's Devanagari intact");
  globalThis.fetch = base;
}

console.log(failed ? `\n${failed} failed.` : "\nAll worker tests passed.");
process.exit(failed ? 1 : 0);
