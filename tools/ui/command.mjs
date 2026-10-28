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

/* Thirty days of the shop's daily counts: newer days with the once-a-visit flags. */
let seeded30 = 0, seededToday = 0;
for (let i = 0; i < 30; i++) {
  const day = new Date(now + 5.5 * 3600000 - i * 86400000).toISOString().slice(0, 10), v = 40 + ((i * 37) % 29);
  const add = i < 10 ? { visit: v, visitor: v - 6, view: Math.round(v * .6), s_view: Math.round(v * .5), number: 14, s_number: 6, checkout: 4, s_checkout: 3, details: 2, s_details: 2 }
                     : { visit: v, visitor: v - 6, view: Math.round(v * .5), number: 5, checkout: 2, details: 1 };
  await so.fetch(new Request("https://stats/add", { method: "POST", body: JSON.stringify({ day, add }) }));
  seeded30 += v; if (i === 0) seededToday = v;
}
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
ok(/Visits/.test(text) && /Add to cart/.test(text) && /Checkouts/.test(text) && /Orders/.test(text) && /Revenue/.test(text) && /Conversion/.test(text) && /Needs you/.test(text) && /Right now/.test(text) && /path to a sale/.test(text),
  "today: visits, add to cart, checkouts, orders, revenue, conversion; what needs you, right now, the path to a sale");
const kv = async () => pg.$$eval(".kpis .kpi", (els) => Object.fromEntries(els.map(e => [e.querySelector(".l").textContent, e.querySelector(".v").textContent])));
let K = await kv();
ok(K.Visits === String(seededToday) && K["Add to cart"] === "6" && K.Checkouts === "3" && /Yesterday/.test(text) && /The last fourteen days/.test(text) && (await pg.locator(".chart .cday").count()) === 14,
  "today: today's visits, add to cart counted once per visit, against yesterday, with the fortnight's chart " + JSON.stringify(K));
ok(/Nos\. 01, 02 sold on the shop, with no order in the registry/.test(text) && /Record a past sale/.test(text), "today: numbers sold on the shop with no registry order are flagged, with the button to record them");
ok(/4 gone · 16 open/.test(text), "today: the twenty count what the shop shows (01, 02, the registry's 07, the withheld 09)");
ok(await flat(), "today: nothing wider than a phone");
if (SHOTS) await pg.screenshot({ path: SHOTS + "/1-today-phone.png", fullPage: true });
await pg.click('[data-act="tset"][data-v="30d"]');
await pg.waitForFunction(() => /vs previous 30 days/.test(document.getElementById("view").textContent));
text = await pg.textContent("#view");
K = await kv();
ok(K.Visits === seeded30.toLocaleString("en-IN") && K["Add to cart"] === String(10 * 6 + 20 * 5) && (await pg.locator(".chart .cday").count()) === 30 && /#today\?r=30d/.test(pg.url()),
  "today: 30 days adds up the month (once-a-visit where sent, per tap before), charts it day by day, and the period stays in the address " + JSON.stringify(K));
ok(await flat(), "today, 30 days: nothing wider than a phone");
if (SHOTS) await pg.screenshot({ path: SHOTS + "/1b-today-30d-phone.png", fullPage: true });
await pg.click('[data-act="tset"][data-v="7d"]');
await pg.waitForFunction(() => /vs previous 7 days/.test(document.getElementById("view").textContent));
ok((await pg.locator(".chart .cday").count()) === 7 && (await pg.locator(".kpis .mini").count()) >= 5, "today: 7 days, with a small trend in each number");
await pg.click('[data-act="tset"][data-v="today"]');
await pg.waitForFunction(() => /Yesterday/.test(document.getElementById("view").textContent));

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
await pg.goto(URL0 + "#insights");
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
/* Activity, live: everything on one line of time */
await pg.click('.tabs [data-go="activity"]');
await pg.waitForSelector("#alist .arow");
text = await pg.textContent("#view");
ok(/Chose No\. 05/.test(text) && /Priya/.test(text) && /Instagram/.test(text) && /people/.test(text), "activity: every visitor's steps, newest first, with who it was and where from");
await pg.click('.chip[data-p$="f=money"]');
await pg.waitForFunction(() => /f=money/.test(location.hash) && document.querySelector("#alist .arow"));
text = await pg.textContent("#view");
ok(/Pressed buy/.test(text) && !/Played the box film/.test(text), "activity: Money narrows it to checkouts and payments");
ok(await flat(), "activity: nothing wider than a phone");
if (SHOTS) await pg.screenshot({ path: SHOTS + "/6-activity-phone.png", fullPage: true });
await pg.click("#alist button.arow");
await pg.waitForFunction(() => /Roughly where/.test(document.getElementById("sheetB").textContent));
ok(true, "activity: tapping a line opens that visitor");
await pg.keyboard.press("Escape");

/* The command bar: in words, read back, then done */
const piece = (n) => W.DB.raw.prepare("SELECT status FROM pieces WHERE number = ?").get(n).status;
const soldKV = () => JSON.parse(W.KV.store.get("sold") || "[]");
await pg.click('[data-act="cmd"]');
await pg.fill("#cmdIn", "keep 12 back");
await pg.keyboard.press("Enter");
await pg.waitForFunction(() => /Keep No\. 12 back/.test(document.getElementById("cmdOut").textContent));
ok(piece(12) === "available", "command: 'keep 12 back' is read back first, and nothing has changed yet");
if (SHOTS) await pg.screenshot({ path: SHOTS + "/7-command-phone.png" });
await pg.click('[data-act="cmdGo"]');
await pg.waitForFunction(() => /No\. 12 is kept back/.test(document.getElementById("toast").textContent));
ok(piece(12) === "withheld" && soldKV().includes(12), "command: Do it takes No. 12 off the shop");
await pg.click('[data-act="cmd"]');
await pg.fill("#cmdIn", "mark 12 unsold");
await pg.keyboard.press("Enter");
await pg.waitForFunction(() => /Put No\. 12 on sale/.test(document.getElementById("cmdOut").textContent));
await pg.click('[data-act="cmdGo"]');
await pg.waitForFunction(() => /No\. 12 is on sale/.test(document.getElementById("toast").textContent));
ok(piece(12) === "available" && !soldKV().includes(12), "command: 'mark 12 unsold' puts it back on sale");
await pg.click('[data-act="cmd"]');
await pg.fill("#cmdIn", "how many are left?");
await pg.keyboard.press("Enter");
await pg.waitForFunction(() => /are open/.test(document.getElementById("cmdOut").textContent));
ok(/Nos\. /.test(await pg.textContent("#cmdOut")), "command: answers how many are left, and which");
await pg.keyboard.press("Escape");

/* The twenty: No. 09, kept back, one tap to sell */
await pg.goto(URL0 + "#pieces");
await pg.waitForSelector('.lrow[data-id="S01-09"]');
await pg.click('.lrow[data-id="S01-09"]');
await pg.waitForFunction(() => /Kept back/.test(document.getElementById("sheetB").textContent));
if (SHOTS) await pg.screenshot({ path: SHOTS + "/8-piece-sale-phone.png" });
await pg.click('#sheetB [data-act="sale"][data-v="1"]');
await pg.waitForFunction(() => /No\. 09 is on sale/.test(document.getElementById("toast").textContent));
ok(piece(9) === "available" && !soldKV().includes(9), "the twenty: Put it on sale opens No. 09 on the shop");

await pg.goto(URL0 + "#settings");
await pg.waitForFunction(() => /Sign out every device/.test(document.getElementById("view").textContent) && !/Checking this device/.test(document.getElementById("view").textContent));
text = await pg.textContent("#view");
ok(/this one/.test(text), "settings: the signed-in devices, and Sign out every device");
ok(/Phone alerts/.test(text) && /Turn on phone alerts|three taps|cannot show alerts/.test(text) && /A watch is paid for \(always\)/.test(text), "settings: phone alerts for this device, and which kinds");
if (SHOTS) await pg.screenshot({ path: SHOTS + "/9-settings-phone.png", fullPage: true });
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
await pg.keyboard.press("5");
await pg.waitForFunction(() => /Where they come from/.test(document.getElementById("view").textContent));
ok((await pg.textContent("#title")) === "Insights", "desktop: 5 opens Insights");
await pg.keyboard.press("2");
await pg.waitForSelector("#alist .arow");
if (SHOTS) await pg.screenshot({ path: SHOTS + "/10-activity-desktop.png", fullPage: true });
ok((await pg.textContent("#title")) === "Activity, live", "desktop: 2 opens the live Activity");
if (SHOTS) await pg.screenshot({ path: SHOTS + "/4-insights-desktop.png", fullPage: true });
await pg.goto(URL0 + "#today?r=30d");
await pg.waitForFunction(() => /vs previous 30 days/.test(document.getElementById("view").textContent));
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
