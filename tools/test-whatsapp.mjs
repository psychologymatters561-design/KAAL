/* ══════════════════════════════════════════════════════════════════
   The nearly-bought note on WhatsApp (worker/whatsapp.js and section 3e
   of kaal-sold-sync.js): who gets it (only those who ticked it), what
   Meta is sent (the approved template, two blanks, the button's number),
   Claude's line and its check, the email when WhatsApp refuses, the
   webhook (Meta's handshake, the signature, "stop", replies, a message
   that failed later), and the checkout's tick on the page.

     node --no-warnings tools/test-whatsapp.mjs
   Exits non-zero if anything fails. CI runs it on every pull request.
   ══════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import w, { Stats } from "../worker/kaal-sold-sync.js";
import { checkWaLine } from "../worker/lead-writer.js";
import { waStandardLine, waPreview, blank, buttonNumber } from "../worker/whatsapp.js";
import { d1, kv, ctx } from "./d1-shim.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };

/* ── The world outside ── */
const payments = [], rzpOrders = [], mails = [], graph = [], claudeCalls = [];
let graphReply = null, claudeReply = null;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes("api.resend.com")) { mails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url.includes("api.razorpay.com")) {
    const u = new URL(url);
    const skip = +u.searchParams.get("skip") || 0;
    if (u.pathname === "/v1/payments") return Response.json({ items: payments.slice(skip, skip + 100) });
    if (u.pathname === "/v1/orders") return Response.json({ items: skip ? [] : rzpOrders });
    return Response.json({ items: [] });
  }
  if (/^https:\/\/graph\.facebook\.com\/v23\.0\/PHONE123\/messages$/.test(url)) {
    const body = JSON.parse(init.body);
    graph.push({ headers: init.headers, body });
    const r = typeof graphReply === "function" ? graphReply(body) : graphReply;
    if (r) return new Response(JSON.stringify(r.json), { status: r.status });
    return Response.json({ messaging_product: "whatsapp", contacts: [{ wa_id: body.to }], messages: [{ id: "wamid.T" + graph.length }] });
  }
  if (url === "https://api.anthropic.com/v1/messages") {
    claudeCalls.push(JSON.parse(init.body));
    return Response.json(claudeReply);
  }
  if (url.includes("graph.facebook.com") || url.includes("api.github.com")) return Response.json({});
  return new Response("{}", { status: 404 });
};

/* ── The worker's bindings ── */
const DB = d1(), KV = kv();
const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...b) {
  const rows = /^\s*SELECT/i.test(q) ? db.prepare(q).all(...b) : (b.length ? (db.prepare(q).run(...b), []) : (db.exec(q), []));
  return { toArray: () => rows.map(r => Object.assign({}, r)) };
} };
const box = new Map();
const so = new Stats({ storage: { sql, async get(k) { return Array.isArray(k) ? new Map(k.filter(x => box.has(x)).map(x => [x, box.get(x)])) : box.get(k); },
  async put(k, v) { box.set(k, JSON.parse(JSON.stringify(v))); }, async delete(k) { box.delete(k); }, async setAlarm() {} } });
const STATS = { idFromName: () => "kaal", get: () => ({ fetch: (u, i) => so.fetch(new Request(u, i)) }) };
const ORIGIN = "https://kaal-edition.kaal-edition-hq.workers.dev";
const base = {
  DB, KAAL_STATE: KV, STATS, STAGING: "", EDITION: "20", PRICE_PAISE: "599900", CURRENCY: "INR", SITE_URL: "https://thekaal.co", WORKER_URL: ORIGIN,
  ALLOW_ORIGIN: "https://thekaal.co", RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "wh", RESEND_API_KEY: "re",
  GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", REGISTRY: "off", DIGEST: "off", ABANDON_EMAIL: "on", FOLLOW_GAP_MS: "0",
  DIALS: '{"9":"Midnight","10":"Midnight","12":"Champagne","13":"Champagne","14":"Champagne","16":"Ivory","17":"Ivory","18":"Ivory","20":"Ivory"}'
};
const WA = { WHATSAPP_NEARLY: "on", WHATSAPP_TOKEN: "EAAG-test", WHATSAPP_PHONE_ID: "PHONE123", WHATSAPP_APP_SECRET: "appsecret", WHATSAPP_VERIFY_TOKEN: "verify-me" };
const env = Object.assign({}, base, WA);
async function cron(e = env) { const k = ctx(); await w.scheduled({ cron: "*/30 * * * *" }, e, k); await k.done(); }
async function hookWa(payload, opts = {}) {
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", opts.secret || "appsecret").update(raw).digest("hex");
  const k = ctx();
  const r = await w.fetch(new Request(ORIGIN + "/wa/webhook", { method: "POST", headers: { "x-hub-signature-256": opts.sig || sig, "content-type": "application/json" }, body: raw }), opts.env || env, k);
  await k.done();
  return { status: r.status, text: await r.text() };
}
const inbound = (from, msg) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: {
  messaging_product: "whatsapp", metadata: { phone_number_id: "PHONE123" }, contacts: [{ wa_id: from, profile: { name: "Rohan" } }], messages: [Object.assign({ from, id: "wamid.IN" + Math.random(), timestamp: "1" }, msg)] } }] }] });

KV.store.set("sold", "[1,2,3,4,5,6,7,8,11,15,19]");      /* nine left: 09 10 12 13 14 16 17 18 20 */
const T0 = Date.parse("2026-11-10T08:00:00Z");            /* 1:30 pm in India */
const realNow = Date.now;
Date.now = () => T0;
const ago = (h) => Math.floor(T0 / 1000) - h * 3600;
function checkout(id, n, h, who, pay) {
  rzpOrders.push({ id, status: "created", created_at: ago(h), notes: { kaal_no: String(n).padStart(2, "0") } });
  KV.store.set("ship:" + id, JSON.stringify({ at: new Date(T0 - h * 3600e3).toISOString(), src: "checkout", buyer: who, name: who.name, phone: who.phone, line1: "1 Road", city: "Delhi", state: "Delhi", pin: "110065" }));
  if (pay) payments.push(Object.assign({ order_id: id, amount: 599900, currency: "INR", created_at: ago(h), notes: {} }, pay));
}

/* ── 1. The pieces on their own ── */
{
  const d = { site: "https://thekaal.co", first: "Rohan", n: 13, open: true, dial: "Champagne", sold: 11, left: 9, sameDial: [], stage: "Closed checkout before paying" };
  const line = waStandardLine(d);
  ok(/You chose No\. 13, the Champagne dial,/.test(line) && /nine of the twenty are left/.test(line) && !/[\n!—–]/.test(line), "standard line: the number, the dial, the count in words, no line breaks or dashes");
  ok(checkWaLine({ line }, d).length === 0, "standard line passes the same check Claude's must " + JSON.stringify(checkWaLine({ line }, d)));
  ok(checkWaLine({ line: "No. 13 is still open.\nTake it." }, d).includes("line breaks"), "Claude line check: no line breaks (a template blank refuses them)");
  ok(checkWaLine({ line: "No. 13 is open, 10% off today only" }, d).length > 0, "Claude line check: no discount, no deadline");
  ok(checkWaLine({ line: "We noticed you spent nine minutes on No. 13." }, d).some(x => /saw of their visit/.test(x)), "Claude line check: never what we saw of their visit");
  ok(blank("a\n\nb\t c     d", 99) === "a b c d", "blank: line breaks, tabs and long runs of spaces go");
  ok(buttonNumber(d) === 13 && buttonNumber(Object.assign({}, d, { open: false, sameDial: [14, 12] })) === 12 && buttonNumber({ n: 0 }) === 0, "button: their number, else the lowest open of the same dial, else none");
  const sold = waStandardLine(Object.assign({}, d, { open: false, sameDial: [12, 14] }));
  ok(/someone else completed it/.test(sold) && /No\. 12 and No\. 14 still carry it/.test(sold), "standard line: a number sold since names the same dial's open numbers");
  ok(/^Hello Rohan, this is KAAL\.\n\n/.test(waPreview(d, line)) && /n=13/.test(waPreview(d, line)), "preview: reads as the buyer will see it, with the button to No. 13");
}

/* ── 2. Through the real run ── */
checkout("order_WaTick13aa", 13, 4, { name: "rohan mehta", phone: "9810012345", email: "rohan@example.com", wa: "2026-11-10T03:00:00Z" });
checkout("order_NoTick14aa", 14, 4, { name: "Sana Kapoor", phone: "9810054321", email: "sana@example.com" });
checkout("order_WaTick16aa", 16, 1, { name: "Too Soon", phone: "9810011111", email: "soon@example.com", wa: "2026-11-10T07:00:00Z" });
await cron();
const g13 = graph.find(x => x.body.to === "919810012345");
ok(g13 && g13.headers.authorization === "Bearer EAAG-test" && g13.body.type === "template" && g13.body.template.name === "kaal_nearly" && g13.body.template.language.code === "en",
  "WhatsApp: the approved template, to +91 and the ten digits they typed, with the token");
const params = g13 ? g13.body.template.components : [];
ok(params[0].parameters[0].text === "Rohan" && /You chose No\. 13/.test(params[0].parameters[1].text) && params[1].sub_type === "url" && params[1].parameters[0].text === "13" && params[2].parameters[0].payload === "STOP",
  "WhatsApp: first name in title case, the line, the button on No. 13, and the Stop button");
ok(!mails.some(m => m.to.includes("rohan@example.com")), "WhatsApp: one note, never both: no email to the person who got WhatsApp");
ok(mails.some(m => m.to.includes("sana@example.com")) && !graph.some(x => x.body.to === "919810054321"), "no tick, no WhatsApp: the email goes, as before");
ok(!graph.some(x => x.body.to === "919810011111") && !mails.some(m => m.to.includes("soon@example.com")), "under three hours: nothing yet, either way");
let log = JSON.parse(KV.store.get("fu:log"));
ok(log.some(l => l.channel === "whatsapp" && l.status === "sent" && /Hello Rohan, this is KAAL/.test(l.text)), "the command centre's log shows the WhatsApp note, word for word");
graph.length = 0; mails.length = 0;
await cron();
ok(!graph.length && !mails.some(m => /rohan@|sana@/.test(m.to.join())), "once, ever: the next run sends nothing to either");

/* ── 3. WhatsApp refuses: the email goes instead, at once ── */
checkout("order_WaTick17aa", 17, 5, { name: "Neel", phone: "9810022222", email: "neel@example.com", wa: "2026-11-10T02:00:00Z" });
graphReply = { status: 400, json: { error: { message: "Recipient phone number not in allowed list", code: 131030 } } };
await cron();
graphReply = null;
ok(graph.some(x => x.body.to === "919810022222") && mails.some(m => m.to.includes("neel@example.com") && /No\. 17/.test(m.subject)), "WhatsApp refused (131030): the standard email goes instead, in the same run");
log = JSON.parse(KV.store.get("fu:log"));
ok(log.some(l => l.channel === "whatsapp" && l.status === "failed" && /131030/.test(l.why)), "and the log says why");

/* ── 4. Claude writes the line ── */
checkout("order_WaTick18aa", 18, 4, { name: "Ira", phone: "+91 98100 33333", email: "ira@example.com", wa: "2026-11-10T02:00:00Z" }, { id: "pay_Ira18", status: "failed", email: "ira@example.com", error_description: "card declined" });
const e2 = Object.assign({}, env, { ANTHROPIC_API_KEY: "sk-ant-test" });
claudeReply = { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ line: "The card did not go through for No. 18, and the Ivory piece is still unclaimed. If you reply, a person will help you finish.", angle: "payment_help", why: "Their payment failed." }) }] };
graph.length = 0;
await cron(e2);
const g18 = graph.find(x => x.body.to === "919810033333");
ok(g18 && /The card did not go through for No\. 18/.test(g18.body.template.components[0].parameters[1].text), "Claude's line goes in the template's blank");
ok(claudeCalls.length === 1 && /WhatsApp/.test(claudeCalls[0].system) && claudeCalls[0].output_config.format.schema.required.includes("line") && !/9810033333|ira@/.test(JSON.stringify(claudeCalls[0])),
  "one Claude call for the WhatsApp line, and Claude is never sent their phone or email");
checkout("order_WaTick20aa", 20, 4, { name: "Kabir", phone: "9810044444", email: "kabir@example.com", wa: "2026-11-10T02:00:00Z" });
claudeReply = { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ line: "No. 20 is yours, 20% off, today only", angle: "still_open", why: "x" }) }] };
graph.length = 0;
await cron(e2);
const g20 = graph.find(x => x.body.to === "919810044444");
ok(g20 && /You chose No\. 20/.test(g20.body.template.components[0].parameters[1].text) && !/off/.test(g20.body.template.components[0].parameters[1].text), "a line that fails the check never goes; the standard line does");

/* ── 5. The webhook ── */
{
  let k = ctx();
  let r = await w.fetch(new Request(ORIGIN + "/wa/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"), env, k);
  ok(r.status === 200 && await r.text() === "12345", "webhook: Meta's handshake answered with the challenge");
  r = await w.fetch(new Request(ORIGIN + "/wa/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345"), env, k);
  ok(r.status === 403, "webhook: a wrong verify token is refused");
  r = await hookWa(inbound("919810012345", { type: "text", text: { body: "stop" } }), { sig: "sha256=" + "0".repeat(64) });
  ok(r.status === 401 && !graph.some(x => x.body.type === "text"), "webhook: a body not signed with the app secret is refused, and nothing happens");

  graph.length = 0;
  r = await hookWa(inbound("919810012345", { type: "button", button: { payload: "STOP", text: "Stop" } }));
  const hash = [...KV.store.keys()].find(x => x.startsWith("nearly:") && JSON.parse(KV.store.get(x)).order === "order_WaTick13aa").slice(7);
  ok(r.status === 200 && KV.store.has("stop:" + hash), "webhook: the Stop button marks the person stop, the same key the email and the desk keep");
  ok(graph.some(x => x.body.type === "text" && x.body.to === "919810012345" && /will not write to you again/.test(x.body.text.body)), "webhook: and tells them so, once, in the free reply window");
  graph.length = 0;
  r = await hookWa(inbound("919810033333", { type: "text", text: { body: "Is the strap adjustable?" } }));
  ok(r.status === 200 && !graph.length, "webhook: an ordinary reply is the owner's to answer: nothing automatic goes back");

  /* Meta took the note, then could not deliver it: the email goes. */
  checkout("order_WaTick09aa", 9, 4, { name: "Om", phone: "9810055555", email: "om@example.com", wa: "2026-11-10T02:00:00Z" });
  graph.length = 0; mails.length = 0;
  await cron();
  const id = graph.find(x => x.body.to === "919810055555") && "wamid.T1";
  ok(!!id && !mails.some(m => m.to.includes("om@example.com")), "Om's note went by WhatsApp");
  r = await hookWa({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "PHONE123" }, statuses: [{ id, status: "failed", recipient_id: "919810055555", errors: [{ code: 131049, title: "This message was not delivered to maintain healthy ecosystem engagement." }] }] } }] }] });
  ok(r.status === 200 && mails.some(m => m.to.includes("om@example.com") && /No\. 09/.test(m.subject)), "webhook: a note Meta later could not deliver (131049) is sent by email instead");
  mails.length = 0;
  await hookWa({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "PHONE123" }, statuses: [{ id, status: "failed", recipient_id: "919810055555", errors: [{ code: 131049 }] }] } }] }] });
  ok(!mails.length, "webhook: and only once, however often Meta repeats it");
}

/* ── 6. Off means off ── */
{
  checkout("order_WaTick10aa", 10, 4, { name: "Off", phone: "9810066666", email: "off@example.com", wa: "2026-11-10T02:00:00Z" });
  graph.length = 0; mails.length = 0;
  await cron(Object.assign({}, env, { WHATSAPP_NEARLY: "off" }));
  ok(!graph.length && mails.some(m => m.to.includes("off@example.com")), "WHATSAPP_NEARLY off: email, as before, even for someone who ticked it");
}

/* ── 7. The page: the tick is there, unticked, and ?n= lands on the number ── */
{
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const tick = /<input name="wa" type="checkbox"[^>]*>/.exec(page);
  ok(tick && !/checked/.test(tick[0]) && /KAAL may send one WhatsApp message about this number/.test(page), "page: the WhatsApp tick is on the details step, unticked, in plain words");
  ok(/b\.wa = !!\(f\.wa && f\.wa\.checked\);/.test(page), "page: the tick goes with the details to /order");
  ok(/qs\.get\("n"\)/.test(page) && /qsNUsed/.test(page), "page: ?n=7 opens No. 07 on arrival, once");
}

Date.now = realNow;
console.log(failed ? `\n${failed} failed.` : "\nAll WhatsApp tests passed.");
process.exit(failed ? 1 : 0);
