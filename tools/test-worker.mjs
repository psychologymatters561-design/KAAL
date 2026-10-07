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
  const store = new Map();
  return {
    store,
    async get(k, t) { const v = store.has(k) ? store.get(k) : null; return v === null ? null : (t === "json" ? JSON.parse(v) : v); },
    async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
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
  RAZORPAY_WEBHOOK_SECRET: "wh", GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r"
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
ok((await r.json()).v === 2, "state: announces v2, so the page turns on the return address and the list");

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
const e9 = Object.assign({}, entity, { id: "pay_ALERTOFF", notes: { kaal_no: "05" } });
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
  ok(d.leads.total === 4 && d.leads.today >= 1 && d.leads.recent.every((l, i, a) => !i || a[i - 1].ts >= l.ts) && d.leads.recent.some(l => l.email === "today.lead@example.com"), "desk: the whole Series 02 list, newest first");
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

console.log(failed ? `\n${failed} failed.` : "\nAll worker tests passed.");
process.exit(failed ? 1 : 0);
