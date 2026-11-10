/* ══════════════════════════════════════════════════════════════════
   The nearly-bought note on WhatsApp (worker/whatsapp.js and section 3e
   of kaal-sold-sync.js): every one written from the visit and held for
   the owner's approval; his edits; the truth checked again when he sends
   (paid since, sold since, the count moved); what Meta is sent (the
   approved template, two blanks, the button's number); Claude's line and
   its check; his words by email when WhatsApp refuses; the webhook
   (handshake, signature, "stop", replies, a message that failed later);
   and the page.

     node --no-warnings tools/test-whatsapp.mjs
   Exits non-zero if anything fails. CI runs it on every pull request.
   ══════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import w, { Stats } from "../worker/kaal-sold-sync.js";
import { checkWaLine } from "../worker/lead-writer.js";
import { waStandardLine, waPreview, blank, buttonNumber, TEMPLATE_BODY } from "../worker/whatsapp.js";
/* The template's body must read exactly as the preview the owner approves. */
const waPreviewBodyCheck = () => { const pv = waPreview({ first: "{{1}}" }, "{{2}}"); return pv.slice(0, pv.indexOf("\n\n[See the number]")) === TEMPLATE_BODY ? TEMPLATE_BODY : "MISMATCH"; };
import { d1, kv, ctx } from "./d1-shim.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };

/* ── The world outside ── */
const payments = [], rzpOrders = [], mails = [], graph = [], claudeCalls = [];
let graphReply = null, claudeReply = null, metaApi = null;
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
  if (metaApi && url.includes("graph.facebook.com")) { const r = metaApi(new URL(url), init); if (r) return r; }
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
  GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", REGISTRY: "on", ADMIN_2FA: "off", AUTH_SECRET: "a".repeat(48), DESK_PASSCODE: "brass quiet lantern 42", OWNER_OPS: "off", DIGEST: "off", ABANDON_EMAIL: "on", FOLLOW_GAP_MS: "0",
  DIALS: '{"1":"Emerald","2":"Emerald","3":"Emerald","4":"Emerald","5":"Emerald","6":"Emerald","7":"Midnight","8":"Midnight","9":"Midnight","10":"Midnight","11":"Champagne","12":"Champagne","13":"Champagne","14":"Champagne","15":"Ivory","16":"Ivory","17":"Ivory","18":"Ivory","19":"Ivory","20":"Ivory"}'
};
const WA = { WHATSAPP_NEARLY: "on", WHATSAPP_TOKEN: "EAAG-test", WHATSAPP_PHONE_ID: "PHONE123", WHATSAPP_APP_SECRET: "appsecret", WHATSAPP_VERIFY_TOKEN: "verify-me" };
const env = Object.assign({}, base, WA);
let jar = "";
async function call(method, path, body, e = env) {
  const k = ctx();
  const r = await w.fetch(new Request(ORIGIN + path, { method, headers: { "X-KAAL": "1", "X-Desk": "1", Origin: ORIGIN, Cookie: jar, "cf-connecting-ip": "203.0.113.9", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) }), e, k);
  await k.done();
  const set = r.headers.get("Set-Cookie");
  if (set) { const c = /^kaal_s=([^;]*)/.exec(set); if (c) jar = c[1] ? "kaal_s=" + c[1] : ""; }
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (x) { j = null; }
  return { status: r.status, j, text };
}
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

KV.store.set("sold", "[1,2,3,4,5,6,7,8,11,15,19]");      /* with No. 09 withheld in the registry (as live): eight left */
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

/* ── 2. Through the real run: written, then held for the owner ── */
{
  const r = await call("POST", "/auth/passcode", { passcode: "brass quiet lantern 42" });
  ok(r.j && r.j.ok && jar, "sign-in: the owner's passcode opens the command centre");
}
const queue = async (e = env) => (await call("GET", "/control/api/followups", undefined, e)).j;
const qFor = (j, n) => j.queue.find(q => q.n === n);
const send = (id, body, e = env) => call("POST", "/control/api/followups/" + id + "/send", body || {}, e);

checkout("order_Wa13aaaaaa", 13, 4, { name: "rohan mehta", phone: "9810012345", email: "rohan@example.com" });
checkout("order_Wa16aaaaaa", 16, 1, { name: "Too Soon", phone: "9810011111", email: "soon@example.com" });
await cron();
let j = await queue();
let q13 = qFor(j, 13);
ok(!graph.length && !mails.some(m => /rohan@/.test(m.to.join())), "nothing goes on its own: no WhatsApp, no email");
ok(j.whatsapp === true && q13 && q13.channel === "whatsapp" && q13.waTo === "9810012345" && q13.d.first === "Rohan" && /You chose No\. 13/.test(q13.draft.paragraphs[0]),
  "the note is written and waits in Follow-ups, marked WhatsApp, with their phone and first name");
ok(/^Hello Rohan, this is KAAL\.\n\nYou chose No\. 13/.test(q13.preview) && /n=13\n\[Stop\]$/.test(q13.preview), "the owner sees it exactly as they will, button and Stop included");
ok(!qFor(j, 16), "under three hours: not yet");
ok(/1 WhatsApp message is written and waiting for your approval/.test(JSON.parse(KV.store.get("followrun")).msg), "the command centre's Health line says one is waiting for approval");
let log = JSON.parse(KV.store.get("fu:log"));
ok(log[0].status === "waiting" && log[0].channel === "whatsapp", "the log says it is waiting for you");
graph.length = 0;
await cron();
j = await queue();
ok(j.queue.filter(q => q.n === 13).length === 1 && !graph.length, "the next run neither repeats it nor sends it");

/* The owner edits the words and the name, and approves. */
let r = await send(q13.id, { body: "Rohan sir, No. 13 is still here.\n\nThe Champagne dial, one of one.", first: "Mr. Mehta" });
const g13 = graph.find(x => x.body.to === "919810012345");
ok(r.j.ok && r.j.channel === "whatsapp" && g13 && g13.headers.authorization === "Bearer EAAG-test" && g13.body.template.name === "kaal_nearly" && g13.body.template.language.code === "en",
  "Approve: the approved template goes to +91 and the ten digits they typed, with the token");
const p13 = g13 ? g13.body.template.components : [];
ok(p13[0].parameters[0].text === "Mr. Mehta" && p13[0].parameters[1].text === "Rohan sir, No. 13 is still here. The Champagne dial, one of one." && p13[1].parameters[0].text === "13" && p13[2].parameters[0].payload === "STOP",
  "his edits go as he wrote them: his name, his words on one line, the button on No. 13, the Stop button");
ok(!mails.some(m => /rohan@/.test(m.to.join())), "one message, never both: no email to Rohan");
j = await queue();
ok(!qFor(j, 13) && j.log[0].status === "sent" && j.log[0].channel === "whatsapp" && /Hello Mr\. Mehta, this is KAAL\.\n\nRohan sir/.test(j.log[0].text), "it leaves the queue, and the log keeps it word for word");
r = await send(q13.id, {});
ok(r.status === 404 && graph.filter(x => x.body.to === "919810012345").length === 1, "it cannot be sent twice");
graph.length = 0;
await cron();
ok(!graph.length && !qFor(await queue(), 13), "once, ever: never written again");

/* Skip */
checkout("order_Wa14aaaaaa", 14, 4, { name: "Sana Kapoor", phone: "9810054321", email: "sana@example.com" });
await cron();
let q14 = qFor(await queue(), 14);
r = await call("POST", "/control/api/followups/" + q14.id + "/skip", {});
await cron();
ok(r.j.ok && !graph.length && !mails.some(m => /sana@/.test(m.to.join())) && !qFor(await queue(), 14), "Skip: no message to her, ever, by either way");

/* ── 3. The truth, checked again when he presses Send ── */
checkout("order_Wa17aaaaaa", 17, 5, { name: "Neel", phone: "9810022222", email: "neel@example.com" });
checkout("order_Wa18aaaaaa", 18, 5, { name: "Ira", phone: "9810033333", email: "ira@example.com" });
checkout("order_Wa20aaaaaa", 20, 5, { name: "Om", phone: "9810055555", email: "om@example.com" });
await cron();
j = await queue();
const q17 = qFor(j, 17), q18 = qFor(j, 18), q20 = qFor(j, 20);
ok(q17 && q18 && q20 && /eight of the twenty are left/.test(q17.draft.paragraphs[0]), "three waiting, each stating the count as it was");
/* No. 17 sells to someone else; then one more piece sells. */
KV.store.set("sold", "[1,2,3,4,5,6,7,8,11,15,17,19]");
graph.length = 0;
r = await send(q17.id, {});
ok(r.status === 409 && r.j.refreshed && /No\. 17 has sold since/.test(r.j.why) && !graph.length, "sold since: nothing goes; he is told why");
const q17b = qFor(await queue(), 17);
ok(q17b && /someone else completed it/.test(q17b.draft.paragraphs[0]) && /No\. 16, No\. 18 and No\. 20 still carry it/.test(q17b.draft.paragraphs[0]) && /seven are left/.test(q17b.draft.paragraphs[0]),
  "and the draft is rewritten with today's facts: sold, the same dial's open numbers, the new count");
r = await send(q17.id, {});
const g17 = graph.find(x => x.body.to === "919810022222");
ok(r.j.ok && g17 && g17.body.template.components[1].parameters[0].text === "16", "sent on his second look; the button opens the lowest open Ivory, No. 16");
r = await send(q18.id, {});
ok(r.status === 409 && /7 are left now/.test(r.j.why) && /seven of the twenty/.test(qFor(await queue(), 18).draft.paragraphs[0]), "the count moved and the words state it: rewritten, back to him");
r = await send(q20.id, { body: "No. 20 is still unclaimed, the last Ivory number on the list. One of one." });
ok(r.j.ok && graph.some(x => x.body.to === "919810055555"), "the count moved but his words do not state it: it goes as he wrote it");
/* Their number had sold already; the words offer others of the dial, and one of those sells. */
checkout("order_Wa19aaaaaa", 19, 5, { name: "Tara", phone: "9810013131", email: "tara@example.com" });
await cron();
const q19 = (await queue()).queue.find(q => q.email === "tara@example.com");
ok(q19 && /No\. 16, No\. 18 and No\. 20 still carry it/.test(q19.draft.paragraphs[0]), "a sold number: the note offers the dial's open numbers");
KV.store.set("sold", "[1,2,3,4,5,6,7,8,11,15,16,17,19]");
graph.length = 0;
r = await send(q19.id, {});
const q19b = (await queue()).queue.find(q => q.email === "tara@example.com");
ok(r.status === 409 && /A number it offers has sold since/.test(r.j.why) && !graph.length && /No\. 18 and No\. 20 still carry it/.test(q19b.draft.paragraphs[0]), "one of those sells: rewritten without it, back to him");
r = await send(q19.id, {});
ok(r.j.ok && graph.some(x => x.body.to === "919810013131" && x.body.template.components[1].parameters[0].text === "18"), "and on his second look it goes, its button on No. 18");

/* Paid since */
checkout("order_Wa12aaaaaa", 12, 5, { name: "Dev", phone: "9810077777", email: "dev@example.com" });
await cron();
const q12 = qFor(await queue(), 12);
payments.push({ id: "pay_Dev12ok", order_id: "order_Wa12xxxxxx", status: "captured", email: "dev@example.com", amount: 599900, currency: "INR", created_at: ago(1), notes: {} });
graph.length = 0;
r = await send(q12.id, {});
ok(r.status === 409 && /paid since/.test(r.j.why) && !graph.length && !qFor(await queue(), 12), "paid since: never sent, and cleared from the queue");

/* Paid already, from the same phone under another email: never queued. */
payments.push({ id: "pay_Twin14ok", order_id: "order_Twin14xxxx", status: "captured", email: "other@example.com", contact: "+919810012121", amount: 599900, currency: "INR", created_at: ago(2), notes: {} });
checkout("order_Wa14bbbbbb", 14, 4, { name: "Twin", phone: "98100 12121", email: "twin@example.com" });
await cron();
ok(!(await queue()).queue.some(q => q.email === "twin@example.com"), "paid from the same phone under another email: nothing is written for them");

/* ── 4. WhatsApp refuses: his words go by email ── */
checkout("order_Wa09aaaaaa", 9, 4, { name: "Kabir", phone: "9810044444", email: "kabir@example.com" });
await cron();
const q09 = qFor(await queue(), 9);
graphReply = { status: 400, json: { error: { message: "Recipient phone number not in allowed list", code: 131030 } } };
mails.length = 0;
r = await send(q09.id, { body: "No. 09 is still yours to take, Kabir. The Midnight dial." });
graphReply = null;
const m09 = mails.find(m => m.to.includes("kabir@example.com"));
ok(r.j.ok && r.j.channel === "email" && /131030/.test(r.j.why) && m09 && /No\. 09 is still yours to take, Kabir/.test(m09.text) && /P\.S\. This is the only time/.test(m09.text),
  "WhatsApp refused (131030): his same words go by email at once, in the email's frame, and he is told");

/* ── 5. Claude writes the line from the visit ── */
checkout("order_Wa10aaaaaa", 10, 4, { name: "Asha", phone: "9810066666", email: "asha@example.com" }, { id: "pay_Asha10", status: "failed", email: "asha@example.com", error_description: "card declined" });
const e2 = Object.assign({}, env, { ANTHROPIC_API_KEY: "sk-ant-test" });
claudeReply = { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ line: "The card did not go through for No. 10, and the Midnight piece is still unclaimed. A person can help you finish.", angle: "payment_help", why: "Their payment failed." }) }] };
await cron(e2);
const q10 = qFor(await queue(e2), 10);
ok(q10 && q10.how === "claude" && /The card did not go through for No\. 10/.test(q10.draft.paragraphs[0]) && q10.draft.angle === "payment_help" && /failed/.test(q10.draft.why), "Claude's line waits for him, with its angle and why");
ok(claudeCalls.length === 1 && /WhatsApp/.test(claudeCalls[0].system) && claudeCalls[0].output_config.format.schema.required.includes("line") && !/9810066666|asha@/.test(JSON.stringify(claudeCalls[0])),
  "one Claude call, and Claude is never sent their phone or email");
await call("POST", "/control/api/followups/" + q10.id + "/skip", {}, e2);
checkout("order_Wa18bbbbbb", 18, 4, { name: "Zoya", phone: "9810088888", email: "zoya@example.com" });
claudeReply = { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ line: "No. 18 is yours, 20% off, today only", angle: "still_open", why: "x" }) }] };
await cron(e2);
const qz = (await queue(e2)).queue.find(q => q.email === "zoya@example.com");
ok(qz && /You chose No\. 18/.test(qz.draft.paragraphs[0]) && !/off/.test(qz.draft.paragraphs[0]) && /failed the check/.test(qz.draft.why), "a Claude line that fails the check is replaced by the standard line, and he is told why");

/* ── 6. The webhook ── */
{
  let k = ctx();
  let rr = await w.fetch(new Request(ORIGIN + "/wa/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"), env, k);
  ok(rr.status === 200 && await rr.text() === "12345", "webhook: Meta's handshake answered with the challenge");
  rr = await w.fetch(new Request(ORIGIN + "/wa/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345"), env, k);
  ok(rr.status === 403, "webhook: a wrong verify token is refused");
  graph.length = 0;
  rr = await hookWa(inbound("919810012345", { type: "text", text: { body: "stop" } }), { sig: "sha256=" + "0".repeat(64) });
  ok(rr.status === 401 && !graph.length, "webhook: a body not signed with the app secret is refused, and nothing happens");
  rr = await hookWa(inbound("919810012345", { type: "button", button: { payload: "STOP", text: "Stop" } }));
  const hash = q13.id;
  ok(rr.status === 200 && KV.store.has("stop:" + hash), "webhook: the Stop button marks the person stop, the same key the email and the desk keep");
  ok(graph.some(x => x.body.type === "text" && x.body.to === "919810012345" && /will not write to you again/.test(x.body.text.body)), "webhook: and tells them so, once");
  graph.length = 0;
  rr = await hookWa(inbound("919810055555", { type: "text", text: { body: "Is the strap adjustable?" } }));
  ok(rr.status === 200 && !graph.length, "webhook: an ordinary reply is his to answer: nothing automatic goes back");
  /* Meta took Om's message, then could not deliver it: the email goes. */
  const omId = [...KV.store.keys()].filter(x => x.startsWith("wamsg:")).map(x => [x.slice(6), JSON.parse(KV.store.get(x))]).find(([, v]) => v.email === "om@example.com")[0];
  mails.length = 0;
  rr = await hookWa({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "PHONE123" }, statuses: [{ id: omId, status: "failed", recipient_id: "919810055555", errors: [{ code: 131049, title: "This message was not delivered to maintain healthy ecosystem engagement." }] }] } }] }] });
  const mOm = mails.find(m => m.to.includes("om@example.com"));
  ok(rr.status === 200 && mOm && /No\. 20 is still unclaimed, the last Ivory number/.test(mOm.text), "webhook: a message Meta later could not deliver (131049) goes by email, in his words");
  mails.length = 0;
  await hookWa({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "PHONE123" }, statuses: [{ id: omId, status: "failed", recipient_id: "919810055555", errors: [{ code: 131049 }] }] } }] }] });
  ok(!mails.length, "webhook: and only once, however often Meta repeats it");
}

/* ── 7. Off means off; not set up means email as before ── */
{
  checkout("order_Wa18cccccc", 18, 4, { name: "Off", phone: "9810099999", email: "off@example.com" });
  graph.length = 0; mails.length = 0;
  const off = Object.assign({}, base, { ADMIN_2FA: "off", AUTH_SECRET: "a".repeat(48), DESK_PASSCODE: "brass quiet lantern 42" });
  await cron(off);
  ok(!graph.length && mails.some(m => m.to.includes("off@example.com")), "no WhatsApp keys: the email goes on its own, exactly as before");
}

/* ── 8. The connection check: everything found from the token alone ── */
{
  const M = { phone: { id: "PN777", display_phone_number: "+91 93114 16678", verified_name: "KAAL", status: "PENDING", code_verification_status: "NOT_VERIFIED", platform_type: "NOT_APPLICABLE", name_status: "APPROVED" },
    subscribed: false, hook: null, template: null, calls: [] };
  metaApi = (u, init) => {
    const m = init.method || "GET", path = u.pathname.replace(/^\/v23\.0\//, "");
    M.calls.push(m + " " + path);
    const tok = u.searchParams.get("access_token");
    if (path === "debug_token") return Response.json({ data: { is_valid: true, app_id: "APP555", expires_at: 0, scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
      granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA9"] }, { scope: "whatsapp_business_messaging", target_ids: ["WABA9"] }] } });
    if (path === "WABA9/phone_numbers") return Response.json({ data: [{ id: "PN111", display_phone_number: "+1 555 0100" }, M.phone] });
    if (path === "WABA9/subscribed_apps" && m === "GET") return Response.json({ data: M.subscribed ? [{ whatsapp_business_api_data: { id: "APP555" } }] : [] });
    if (path === "WABA9/subscribed_apps" && m === "POST") { M.subscribed = true; return Response.json({ success: true }); }
    if (path === "APP555/subscriptions" && m === "GET") return tok === "APP555|appsecret" ? Response.json({ data: M.hook ? [M.hook] : [] }) : Response.json({ error: { message: "bad app token" } }, { status: 400 });
    if (path === "APP555/subscriptions" && m === "POST") {
      const f = new URLSearchParams(init.body);
      if (f.get("access_token") !== "APP555|appsecret" || f.get("verify_token") !== "verify-me") return Response.json({ error: { message: "bad" } }, { status: 400 });
      M.hook = { object: "whatsapp_business_account", active: true, callback_url: f.get("callback_url"), fields: [{ name: f.get("fields") }] };
      return Response.json({ success: true });
    }
    if (path === "WABA9/message_templates" && m === "GET") return Response.json({ data: M.template ? [M.template] : [] });
    if (path === "WABA9/message_templates" && m === "POST") { M.templateSent = JSON.parse(init.body); M.template = { name: "kaal_nearly", status: "PENDING" }; return Response.json({ id: "T1", status: "PENDING" }); }
    if (path === "PN777/request_code") { M.codeAsked = JSON.parse(init.body); return Response.json({ success: true }); }
    if (path === "PN777/verify_code") { if (JSON.parse(init.body).code !== "123456") return Response.json({ error: { message: "Wrong code" } }, { status: 400 }); M.phone.code_verification_status = "VERIFIED"; return Response.json({ success: true }); }
    if (path === "PN777/register") { M.pin = JSON.parse(init.body).pin; M.phone.status = "CONNECTED"; M.phone.platform_type = "CLOUD_API"; return Response.json({ success: true }); }
    if (path === "PN777/messages") { M.sentFrom = "PN777"; return Response.json({ messages: [{ id: "wamid.C1" }] }); }
    return null;
  };
  const e3 = Object.assign({}, env); delete e3.WHATSAPP_PHONE_ID;
  KV.store.delete("wa:phoneid");
  let c = (await call("GET", "/control/api/followups/wa", undefined, e3)).j;
  const st = (id) => c.steps.find(x => x.id === id) || {};
  ok(c.ok && !c.ready && st("keys").done && st("token").done && st("number").done && /\+91 93114 16678/.test(st("number").detail), "check: from the token alone it finds the account and +91 93114 16678 among the numbers");
  ok(KV.store.get("wa:phoneid") === "PN777", "check: and keeps its Phone number ID, so WHATSAPP_PHONE_ID is not needed");
  ok(!st("verify").done && st("verify").action === "verify" && !st("register").done, "check: not verified, not registered: the next step is Send code");
  let r = await call("POST", "/control/api/followups/wa/verify-send", {}, e3);
  ok(r.j.ok && M.codeAsked && M.codeAsked.code_method === "SMS", "Send code: Meta sends the code by SMS");
  r = await call("POST", "/control/api/followups/wa/verify-code", { code: "111111" }, e3);
  ok(!r.j.ok && /Wrong code/.test(r.j.why), "a wrong code is refused in plain words");
  r = await call("POST", "/control/api/followups/wa/verify-code", { code: "123 456" }, e3);
  ok(r.j.ok, "the right code verifies it (spaces ignored)");
  r = await call("POST", "/control/api/followups/wa/register", { pin: "12" }, e3);
  ok(!r.j.ok && !M.pin, "Register: a PIN that is not 6 digits is refused before Meta is asked");
  r = await call("POST", "/control/api/followups/wa/register", { pin: "424242" }, e3);
  ok(r.j.ok && M.pin === "424242", "Register: the number is switched on with his PIN");
  c = (await call("GET", "/control/api/followups/wa", undefined, e3)).j;
  ok(st("verify").done && st("register").done && !st("replies").done && st("replies").action === "replies", "check: verified and registered; next, Connect replies");
  r = await call("POST", "/control/api/followups/wa/replies", {}, e3);
  ok(r.j.ok && M.subscribed && M.hook && M.hook.callback_url === ORIGIN + "/wa/webhook", "Connect replies: the app is subscribed to the account and the webhook points at this worker");
  r = await call("POST", "/control/api/followups/wa/template", {}, e3);
  ok(r.j.ok && M.templateSent.name === "kaal_nearly" && M.templateSent.category === "MARKETING" && M.templateSent.components[0].text === waPreviewBodyCheck() && M.templateSent.components[1].buttons[1].text === "Stop",
    "Create template: kaal_nearly goes to Meta word for word, with both buttons");
  c = (await call("GET", "/control/api/followups/wa", undefined, e3)).j;
  ok(!c.ready && st("replies").done && /waiting for approval/.test(st("template").detail), "check: replies connected; the template waits for Meta");
  M.template.status = "APPROVED";
  c = (await call("GET", "/control/api/followups/wa", undefined, e3)).j;
  ok(c.ready && c.steps.every(x => x.done), "check: every step done once Meta approves: Connected");
  const fu = (await call("GET", "/control/api/followups", undefined, e3)).j;
  ok(fu.whatsapp === true, "and Follow-ups says WhatsApp is on, with no WHATSAPP_PHONE_ID set");
  /* A coexistence number (also on the Business app) is never registered again. */
  M.pin = null; M.phone.platform_type = "CLOUD_API"; M.phone.status = "CONNECTED";
  r = await call("POST", "/control/api/followups/wa/register", { pin: "999999" }, e3);
  ok(r.j.ok && M.pin === null, "a number already switched on is left alone: Register does nothing");
  /* A token that expires, or lacks a permission, is named. */
  const save = metaApi;
  metaApi = (u, init) => u.pathname.endsWith("/debug_token") ? Response.json({ data: { is_valid: true, app_id: "APP555", expires_at: 1790000000, scopes: ["whatsapp_business_messaging"], granular_scopes: [] } }) : save(u, init);
  c = (await call("GET", "/control/api/followups/wa", undefined, e3)).j;
  ok(!st("token").done && /missing whatsapp_business_management/.test(st("token").detail), "check: a token missing a permission is named");
  metaApi = save;
  /* No token at all: says exactly which keys are missing. */
  const e4 = Object.assign({}, e3); delete e4.WHATSAPP_TOKEN; delete e4.WHATSAPP_APP_SECRET;
  c = (await call("GET", "/control/api/followups/wa", undefined, e4)).j;
  ok(!c.ready && /WHATSAPP_TOKEN, WHATSAPP_APP_SECRET/.test(c.steps[0].detail), "check: no keys: it names the missing ones");
  metaApi = null;
}

/* ── 9. The page ── */
{
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  ok(!/name="wa"/.test(page) && /reach you about this order, by email or WhatsApp/.test(page), "page: no tick; the details step says WhatsApp plainly");
  ok(/qs\.get\("n"\)/.test(page) && /qsNUsed/.test(page), "page: ?n=7 opens No. 07 on arrival, once");
  const cp = readFileSync(new URL("../worker/control-page.js", import.meta.url), "utf8");
  ok(/Approve and send on WhatsApp/.test(cp) && /ff_/.test(cp) && /For you only, never sent|for you only, never sent/.test(cp), "command centre: the name, the words, what they did on the site, Approve");
}

Date.now = realNow;
console.log(failed ? `\n${failed} failed.` : "\nAll WhatsApp tests passed.");
process.exit(failed ? 1 : 0);
