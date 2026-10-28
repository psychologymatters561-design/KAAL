/* The shop's sold numbers in a real browser: a tap on one that has gone
   opens the small card about who holds it (assets/owner-card.js), on a
   phone and on a computer, and choosing an open number still works. */
import * as R from "../../worker/registry.js";
import { world, open, SITE } from "./harness.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const SHOTS = process.env.SHOTS || "";
const W = world();
/* No. 11: registered, initials and city shown by the owner's own yes. No. 12: paid, not yet delivered. Both Champagne. */
const r7 = await R.recordPayment(W.env, { series: "S01", n: 11, paymentId: "pay_UICARD011", orderId: "order_UICARD011", amount: 599900, email: "asha@example.com", phone: "9876543210", name: "Asha Rao", address: { city: "Pune", state: "Maharashtra" }, paidAt: new Date().toISOString() });
W.DB.raw.prepare("UPDATE orders SET status='registered', delivered_on='2026-10-23', registered_at=? WHERE id=?").run(new Date().toISOString(), r7.order.id);
W.DB.raw.prepare("UPDATE pieces SET status='registered' WHERE id='S01-11'").run();
W.DB.raw.prepare("INSERT INTO owners (email, name, phone, city, state, show_city_publicly, show_name_publicly) VALUES ('asha@example.com','Asha Rao','919876543210','Pune','Maharashtra',1,1)").run();
W.DB.raw.prepare("INSERT INTO ownerships (series, piece_id, owner_id, owner_no, from_at, acquired_via) VALUES ('S01','S01-11',1,1,'2026-10-23T00:00:00Z','purchase')").run();
await R.recordPayment(W.env, { series: "S01", n: 12, paymentId: "pay_UICARD012", orderId: "order_UICARD012", amount: 599900, email: "ravi@example.com", name: "Ravi", paidAt: new Date().toISOString() });

for (const vp of [{ width: 390, height: 844, name: "phone" }, { width: 1280, height: 860, name: "desktop" }]) {
  const B = await open(W, { viewport: { width: vp.width, height: vp.height } });
  const page = await B.page();
  await page.goto(SITE + "/");
  await page.waitForSelector("#grid .pick");
  await page.locator("#grid").scrollIntoViewIfNeeded();
  /* The twenty show one dial at a time: No. 11 is a Champagne. */
  await page.click('.dialpick[data-face="champagne"]');
  await page.waitForFunction(() => document.querySelector('#grid .pick[data-n="11"]').disabled && document.querySelector('#grid li:nth-child(11) .whose') && document.querySelector('#grid li:nth-child(11)').offsetParent);
  const overlays = await page.locator("#grid .whose").count(), gone = await page.locator("#grid .pick[disabled]").count();
  ok(overlays === gone && gone >= 3, vp.name + ": every number that has gone, and only those, can be tapped for its card (" + gone + ")");
  await page.click('#grid .whose[data-n="11"]');
  await page.waitForFunction(() => document.querySelector(".oc.on") && /Held by/.test(document.querySelector(".oc").textContent));
  let card = await page.locator(".oc").innerText();
  ok(/No\. 11/i.test(card) && /Held by\s+Owner I/.test(card) && /A•••\s?R••/.test(card) && /Since Oct 2026/.test(card) && /Pune/.test(card) && /One of twenty\. Never remade\./.test(card),
    vp.name + ": No. 11's card: held by Owner I, masked initials, since when, the city, one of twenty");
  ok(!/Asha|Rao|asha@|9876/.test(card), vp.name + ": never the owner's name, email or phone");
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => { const c = document.querySelector(".oc").getBoundingClientRect(), x = c.left + c.width / 2, y = c.top + 20; const top = document.elementFromPoint(x, y); return !!(top && top.closest(".oc")); }), vp.name + ": nothing on the page sits over the card");
  if (SHOTS) await page.screenshot({ path: SHOTS + "/owner-card-" + vp.name + ".png" });
  const box = await page.locator(".oc").boundingBox();
  ok(box && box.x >= 0 && box.x + box.width <= vp.width && box.y >= 0 && box.y + box.height <= vp.height, vp.name + ": the card sits wholly on screen");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".oc"));
  ok(true, vp.name + ": Escape closes it");
  await page.click('#grid .whose[data-n="12"]');
  await page.waitForFunction(() => document.querySelector(".oc") && /Placed/.test(document.querySelector(".oc").textContent));
  card = await page.locator(".oc").innerText();
  ok(/On its way to its first owner/.test(card), vp.name + ": a number paid for and not yet registered says it is on its way");
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => !document.querySelector(".oc"));
  await page.click('#grid .pick[data-n="13"]');
  ok(await page.getAttribute('#grid .pick[data-n="13"]', "aria-pressed") === "true", vp.name + ": choosing an open number works exactly as before");
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok(sw[0] <= sw[1], vp.name + ": no sideways scroll");
  ok(!B.log.errors.length, vp.name + ": no script errors " + JSON.stringify(B.log.errors).slice(0, 200));
  await B.browser.close();
}
console.log(failed ? `\n${failed} failed.` : "\nAll owner card checks passed.");
process.exit(failed ? 1 : 0);
