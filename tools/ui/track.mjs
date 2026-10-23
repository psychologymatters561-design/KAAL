/* /track in a real browser: the signed link, the form, 360px, reduced motion. */
import * as R from "../../worker/registry.js";
import { trackUrl } from "../../worker/orders.js";
import { world, open, SITE } from "./harness.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const W = world();
const r = await R.recordPayment(W.env, { series: "S01", n: 7, paymentId: "pay_UITRACK01", orderId: "order_UITRACK01", amount: 599900, email: "asha@example.com", phone: "9876543210", name: "Asha Rao",
  address: { line1: "1 Road", city: "Pune", state: "Maharashtra", pin: "411001" }, paidAt: new Date().toISOString() });
const link = await trackUrl(W.env, SITE, r.order.id);
const B = await open(W, { viewport: { width: 360, height: 780 } });
const page = await B.page();

await page.goto(link);
await page.waitForSelector("#timeline li");
ok((await page.locator("#timeline li").count()) === 5, "track: five stages");
ok(await page.locator("#timeline li.current .what").innerText() === "Placed (now)", "track: Placed is the current stage");
ok((await page.locator("#headline").innerText()) === "Set aside for you", "track: the headline says where it is");
ok((await page.locator(".plate").count()) === 1 && /NO\. 07/.test(await page.locator(".plate").innerText()), "track: no photograph yet, so the engraved caseback");
const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
ok(w[0] <= w[1], "track: no sideways scroll at 360px");
await page.screenshot({ path: "/tmp/track-placed.png", fullPage: true });

/* Move it along in the database and look again. */
const day = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
W.DB.raw.prepare("UPDATE orders SET status='delivered', inspected_at=?, packed_at=?, dispatched_at=?, courier='Delhivery', tracking_number='DL123', tracking_url='https://www.delhivery.com/track/package/DL123', delivered_on=?, return_window_ends_at='2099-01-01T00:00:00Z' WHERE id=?")
  .run(new Date(Date.now() - 3 * 86400000).toISOString(), new Date(Date.now() - 2 * 86400000).toISOString(), new Date(Date.now() - 86400000).toISOString(), day, r.order.id);
await page.goto(link);
await page.waitForSelector("#timeline li");
ok((await page.locator("#timeline li.done").count()) === 5, "track: delivered, all five done");
ok(await page.locator(".tl .more a").getAttribute("href") === "https://www.delhivery.com/track/package/DL123", "track: the courier's live link");
ok(/Registering ends the 7-day return option\./.test(await page.locator(".notice").innerText()), "track: the registration card says plainly that registering ends the return option");
await page.screenshot({ path: "/tmp/track-delivered.png", fullPage: true });
await page.getByRole("button", { name: /Register No\. 07/ }).click();
await page.waitForURL(/\/claim\?t=/, { timeout: 5000 }).catch(() => {});
ok(/\/claim\?t=[A-Za-z0-9_-]{43}$/.test(page.url()), "track: Register opens the registration page with a fresh link");

/* The form route. */
const p2 = await B.page();
await p2.goto(SITE + "/track");
ok(await p2.locator("#ask").isVisible() && !(await p2.locator("#found").isVisible()), "track: with no link, it asks for the reference and email");
await p2.fill("#ref", "pay_UITRACK01"); await p2.fill("#email", "wrong@example.com"); await p2.click("#go");
await p2.waitForFunction(() => document.getElementById("err").textContent.length > 0);
ok(/could not find an order/.test(await p2.locator("#err").innerText()), "track: a wrong email is told plainly");
await p2.fill("#email", "asha@example.com"); await p2.click("#go");
await p2.waitForSelector("#timeline li");
ok(await p2.locator("button", { hasText: "Email me the registration link" }).count() === 1, "track: a weaker visit is offered the email link, not the link itself");
const p3 = await B.page();
await p3.goto(SITE + "/track?o=1&s=" + "0".repeat(24));
await p3.waitForFunction(() => document.getElementById("err").textContent.length > 0);
ok(/not valid/.test(await p3.locator("#err").innerText()), "track: a bad link falls back to the form with a plain message");
ok(B.log.errors.length === 0 && B.log.console.filter(x => !/404 \(\)|Failed to load resource/.test(x)).length === 0, "track: no console errors" + (B.log.errors.concat(B.log.console).length ? " " + JSON.stringify(B.log.errors.concat(B.log.console)).slice(0, 300) : ""));
await B.browser.close();
console.log(failed ? `\n${failed} failed.` : "\nAll /track browser checks passed.");
process.exit(failed ? 1 : 0);
