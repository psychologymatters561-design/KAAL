/* The command centre (/control) in a real browser: the passcode, every
   screen at a phone's width and a computer's, the visitor intelligence on
   seeded histories, and nothing wider than the screen.
     NODE_PATH=/opt/node-tools/node_modules node --no-warnings tools/ui/command.mjs [--shots]
   With --shots, screenshots go to the scratchpad given in SHOTS. */
import { world, open, WORKER } from "./harness.mjs";
import { Stats } from "../../worker/kaal-sold-sync.js";
import * as R from "../../worker/registry.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const SHOTS = process.argv.includes("--shots") ? (process.env.SHOTS || "/tmp/kaal-shots") : "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/* The visitor counter, on Node's SQLite, as the worker's own tests run it. */
const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...b) { const rows = /^\s*(SELECT|PRAGMA)/i.test(q) ? db.prepare(q).all(...b) : (b.length ? (db.prepare(q).run(...b), []) : (db.exec(q), [])); return { toArray: () => rows.map(r => Object.assign({}, r)) }; } };
const box = new Map();
const so = new Stats({ storage: { sql, async get(k) { return box.get(k); }, async put(k, v) { box.set(k, JSON.parse(JSON.stringify(v))); }, async delete(k) { box.delete(k); }, async setAlarm() {} } });
const STATS = { idFromName: () => "kaal", get: () => ({ fetch: (u, i) => so.fetch(new Request(u, i)) }) };

const W = world({ STATS, DESK_PASSCODE: "brass quiet lantern 42", ADMIN_2FA: "off" });
const now = Date.now();
const visit = (u, v, extra, ev) => so.fetch(new Request("https://stats/add", { method: "POST", body: JSON.stringify({ live: Object.assign({ v, u, p: "home", w: "twenty", s: "", ev: ev || [], app: "", os: "iPhone", dev: "phone", br: "Safari" }, extra) }) }));
/* Seven visitors: an Instagram ad that nearly bought in Pune, a Google one in Bengaluru, a ChatGPT one, browsers, a buyer. */
await visit("seedvisitor001", "tagaaaa001", { s: "instagram", app: "Instagram", br: "Instagram app", c: "S01 Launch", m: "reels", a: "Emerald 15s", gc: "IN", gr: "Maharashtra", gt: "Pune", n: 5, d: "emerald" },
  [{ e: "view" }, { e: "dial", dial: "Emerald" }, { e: "number", no: "05", dial: "Emerald" }, { e: "caseback_view", no: "05", dial: "Emerald" }, { e: "checkout", no: "05", dial: "Emerald" }, { e: "act", x: "3" }]);
await so.fetch(new Request("https://stats/link", { method: "POST", body: JSON.stringify({ u: "seedvisitor001", o: "order_SEED00001", n: 5, buyer: { name: "Priya Mehta", phone: "+919811122233", email: "priya@example.com", city: "Pune, Maharashtra" } }) }));
await visit("seedvisitor002", "tagaaaa002", { s: "google", os: "Android", br: "Chrome", gc: "IN", gr: "Karnataka", gt: "Bengaluru" }, [{ e: "view" }, { e: "dial", dial: "Champagne" }, { e: "number", no: "12", dial: "Champagne" }]);
await visit("seedvisitor003", "tagaaaa003", { s: "chatgpt", os: "Mac", dev: "computer", br: "Safari", gc: "IN", gr: "Delhi", gt: "New Delhi" }, [{ e: "view" }, { e: "act", x: "9" }, { e: "act", x: "1" }, { e: "act", x: "2" }]);
for (let i = 4; i <= 7; i++) await visit("seedvisitor00" + i, "tagaaaa00" + i, { s: i % 2 ? "facebook" : "direct", app: i % 2 ? "Facebook" : "", c: i % 2 ? "S01 Launch" : "", a: i % 2 ? "Midnight carousel" : "", gc: "IN", gr: "Maharashtra", gt: "Mumbai" }, [{ e: "film" }]);
/* A paid order in the registry, with its Razorpay order id linked to visitor 1's history. */
await R.recordPayment(W.env, { series: "S01", n: 7, paymentId: "pay_SEED00007", orderId: "order_SEED00007", amount: 599900, email: "asha@example.com", phone: "9876543210", name: "Asha Rao",
  address: { line1: "1 Road", city: "Pune", state: "Maharashtra", pincode: "411001" }, paidAt: new Date(now - 3 * 3600000).toISOString() }).catch(e => console.log("seed order:", String(e).slice(0, 120)));

const B = await open(W);
const pg = await B.page();
const URL0 = WORKER + "/control";
const flat = async () => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

await pg.goto(URL0);
await pg.waitForSelector("#pass");
ok(await pg.isVisible("#fPass") && await pg.getAttribute("#pass", "type") === "password", "gate: the passcode, hidden as it is typed");
await pg.fill("#pass", "not it"); await pg.click("#passGo");
await pg.waitForFunction(() => /not right/.test(document.getElementById("gateErr").textContent));
ok(true, "gate: a wrong passcode is told plainly");
await pg.click("#peek");
ok(await pg.getAttribute("#pass", "type") === "text", "gate: Show reveals what was typed");
if (SHOTS) await pg.screenshot({ path: SHOTS + "/0-gate.png" });
await pg.fill("#pass", "brass quiet lantern 42"); await pg.click("#passGo");
await pg.waitForSelector("#app:not([hidden]) .kpi");
ok(W.mails.some(m => /New sign-in to the KAAL command centre/.test(m.subject)), "gate: the first sign-in on this device emails the admin");

/* Today */
await pg.waitForFunction(() => /Hot leads|hot lead/.test(document.getElementById("view").textContent));
let text = await pg.textContent("#view");
ok(/Sold/.test(text) && /Visitors today/.test(text) && /Needs you/.test(text) && /Right now/.test(text) && /path to a sale/.test(text), "today: the numbers, what needs you, right now, the path to a sale");
ok(/Nos\. 01, 02 sold on the shop, with no order in the registry/.test(text) && /Record a past sale/.test(text), "today: numbers sold on the shop with no registry order are flagged, with the button to record them");
ok(/4\s*\/ 20\s*Sold\s*16 remain/.test(text), "today: Sold counts what the shop shows (01, 02, the registry's 07, the withheld 09)");
ok(await flat(), "today: nothing wider than a phone");
if (SHOTS) await pg.screenshot({ path: SHOTS + "/1-today-phone.png", fullPage: true });

/* Visitors: the hot list, then one visitor */
await pg.click('.tabs [data-go="visitors"]');
await pg.waitForSelector("#vlist .lrow");
text = await pg.textContent("#view");
ok(/Visitor 1/.test(text) && /Priya Mehta/.test(text) && /S01 Launch \/ Emerald 15s/.test(text) && /Pune/.test(text), "visitors: the hot lead, with their name, the ad that brought them and where");
await pg.click('#vlist .lrow');
await pg.waitForFunction(() => /Roughly where/.test(document.getElementById("sheetB").textContent));
text = await pg.textContent("#sheetB");
ok(/Hot: close to buying/.test(text) && /WhatsApp/.test(text) && /S01 Launch/.test(text) && /Opened checkout|Chose No\. 05/.test(text), "visitor: score, WhatsApp/Call/Email, the ad, and every step");
if (SHOTS) await pg.screenshot({ path: SHOTS + "/2-visitor-phone.png" });
await pg.keyboard.press("Escape");
await pg.click('[data-act="vset"][data-v="all"]');
await pg.waitForFunction(() => document.querySelectorAll("#vlist .lrow").length >= 7);
ok(true, "visitors: Everyone lists all seven");

/* Insights */
await pg.click('.tabs [data-go="insights"]');
await pg.waitForFunction(() => /Where they come from/.test(document.getElementById("view").textContent));
text = await pg.textContent("#view");
ok(/Instagram/.test(text) && /ChatGPT/.test(text) && /S01 Launch/.test(text) && /Maharashtra/.test(text) && /Bengaluru/.test(text) && /Where people stop/.test(text) && /Numbers looked at/.test(text),
  "insights: sources, the ads, states and cities, the funnel, and the numbers that pull");
ok(await flat(), "insights: nothing wider than a phone");
if (SHOTS) await pg.screenshot({ path: SHOTS + "/3-insights-phone.png", fullPage: true });
await pg.click('tr.go:has-text("ChatGPT")');
await pg.waitForFunction(() => /Source: chatgpt/.test(document.getElementById("view").textContent));
ok(/Visitor 3/.test(await pg.textContent("#view")), "insights: tapping a source lists exactly its visitors");

/* Orders, More, AI search, Settings */
await pg.click('.tabs [data-go="orders"]');
await pg.waitForFunction(() => /No\. 07/.test(document.getElementById("view").textContent));
ok(/Mark Inspected/.test(await pg.textContent("#view")), "orders: the paid order, one tap to its next stage");
await pg.click('.tabs [data-act="more"]');
await pg.waitForSelector('#sheet:not([hidden]) [data-go="ai"]');
await pg.click('#sheet [data-go="ai"]');
await pg.waitForFunction(() => /What answer engines are told/.test(document.getElementById("view").textContent));
ok(/Ask ChatGPT/.test(await pg.textContent("#view")) && /ChatGPT/.test(await pg.textContent("#view")), "ai search: what crawlers are told, and the visitors AI sent");
await pg.goto(URL0 + "#settings");
await pg.waitForFunction(() => /Sign out every device/.test(document.getElementById("view").textContent));
ok(/this one/.test(await pg.textContent("#view")), "settings: the signed-in devices, and Sign out every device");
for (const v of ["approvals", "pieces", "owners", "list", "emails", "audit", "health"]) {
  await pg.goto(URL0 + "#" + v);
  await pg.waitForFunction(() => !/Loading/.test(document.getElementById("view").textContent));
  ok(!/Could not load/.test(await pg.textContent("#view")) && await flat(), "screen " + v + ": loads, nothing wider than a phone");
}

/* A computer's width: the sidebar, the keyboard */
await pg.setViewportSize({ width: 1280, height: 860 });
await pg.goto(URL0 + "#today");
await pg.waitForSelector(".side .navb");
ok(await pg.isVisible(".side") && !(await pg.isVisible(".tabs")), "desktop: the sidebar instead of the bar below");
await pg.keyboard.press("4");
await pg.waitForFunction(() => /Where they come from/.test(document.getElementById("view").textContent));
ok((await pg.textContent("#title")) === "Insights", "desktop: 4 opens Insights");
if (SHOTS) await pg.screenshot({ path: SHOTS + "/4-insights-desktop.png", fullPage: true });
await pg.keyboard.press("1");
await pg.waitForFunction(() => /Needs you/.test(document.getElementById("view").textContent));
if (SHOTS) await pg.screenshot({ path: SHOTS + "/5-today-desktop.png", fullPage: true });
await pg.setViewportSize({ width: 768, height: 1000 });
await pg.goto(URL0 + "#visitors?f=all&r=7d");
await pg.waitForSelector("#vlist .lrow");
ok(await flat(), "tablet: nothing wider than the screen");

ok(!B.log.errors.length, "no script errors " + JSON.stringify(B.log.errors));
ok(!B.log.console.filter(m => !/Failed to load resource/.test(m)).length, "no console errors " + JSON.stringify(B.log.console.slice(0, 3)));
await B.browser.close();
console.log(failed ? `\n${failed} failed.` : "\nAll command centre browser checks passed.");
process.exit(failed ? 1 : 0);
