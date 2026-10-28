/* /claim and /owners in a real browser: the whole of registering, the
   countdown, signing out and in again, a bad link, 360px. */
import * as R from "../../worker/registry.js";
import { moveOrder } from "../../worker/orders.js";
import { flushOutbox } from "../../worker/outbox.js";
import { world, open, SITE } from "./harness.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const W = world();
const r = await R.recordPayment(W.env, { series: "S01", n: 7, paymentId: "pay_UIOWN0007", orderId: "order_UIOWN0007", amount: 599900, email: "asha@example.com", phone: "9876543210", name: "Asha Rao",
  address: { line1: "1 Road", city: "Pune", state: "Maharashtra", pin: "411001" }, paidAt: new Date(Date.now() - 4 * 86400000).toISOString() });
W.DB.raw.prepare("UPDATE orders SET status='dispatched', dispatched_at=?, courier='Delhivery', tracking_number='DL1', tracking_url='https://x.example/t' WHERE id=?").run(new Date(Date.now() - 86400000).toISOString(), r.order.id);
await moveOrder(W.env, { siteUrl: () => SITE, kick: () => {} }, "admin:1", r.order.id, { to: "delivered", day: new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10) });
await flushOutbox(W.env, async (to, subject, text, html) => { W.mails.push({ to: [to], subject, text, html }); return true; });
const token = (/claim\?t=([A-Za-z0-9_-]{43})/.exec(W.mails.find(m => /One step makes it yours/.test(m.subject)).text) || [])[1];

const B = await open(W, { viewport: { width: 360, height: 800 } });
const page = await B.page();

/* A bad link first. */
await page.goto(SITE + "/claim?t=" + "z".repeat(43));
await page.waitForSelector("#bad:not([hidden])");
ok(/not one of ours/.test(await page.locator("#badH").innerText()) && await page.locator("#again").isVisible(), "claim: a link we never issued is told plainly, with a way to ask for another");
await page.goto(SITE + "/claim");
await page.waitForSelector("#bad:not([hidden])");
ok(await page.locator("#form").isHidden(), "claim: no link, no form");

/* The real one. */
await page.goto(SITE + "/claim?t=" + token);
await page.waitForSelector("#form:not([hidden])");
ok(await page.locator("#title").innerText() === "Register No. 07", "claim: opens on the piece");
ok(/NO\. 07/.test(await page.locator(".plate").innerText()), "claim: its caseback, until its photograph is taken");
const facts = await page.locator("#facts").innerText();
ok(/No\. 07 of 20/.test(facts) && /Series 01/.test(facts) && /Midnight/.test(facts) && /Pune, Maharashtra/.test(facts), "claim: piece, series, colourway, city and state shown as read-only facts");
ok(await page.locator("#facts input").count() === 0, "claim: the locked facts are not inputs");
ok(await page.inputValue("#name") === "Asha Rao" && await page.inputValue("#email") === "asha@example.com" && /9876543210/.test(await page.inputValue("#phone")), "claim: name, phone and email prefilled and editable");
ok(!(await page.locator("#accept").isChecked()) && !(await page.locator("#showCity").isChecked()) && !(await page.locator("#consent").isChecked()), "claim: every box starts unticked");
ok(/I accept No\. 07\. I understand registering ends my 7-day return option\./.test(await page.locator("label[for=accept]").innerText()), "claim: the acceptance box says the brief's words");
ok(/Registering ends the 7-day return option\./.test(await page.locator("#returnNotice").innerText()), "claim: the return window notice sits beside it");
ok(/Show my city beside No\. 07 in the public registry\./.test(await page.locator("label[for=showCity]").innerText()), "claim: the city box is optional and says so");
ok(await page.locator("#codeBlock").isHidden(), "claim: no code field while the email is the order's");
const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
ok(sw[0] <= sw[1], "claim: no sideways scroll at 360px");
const tall = await page.locator("#go, #accept, #consent").evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
ok(tall.every(h => h >= 22) && (await page.locator("#go").boundingBox()).height >= 44, "claim: the button is at least 44px to tap");
await page.screenshot({ path: "/tmp/claim-form.png", fullPage: true });

/* Refusals first. */
await page.click("#go");
await page.waitForFunction(() => document.getElementById("err").textContent.length > 0);
ok(/Tick the box to accept No\. 07/.test(await page.locator("#err").innerText()), "claim: submitting with the box unticked is refused in plain words");
await page.check("#accept");
await page.click("#go");
await page.waitForFunction(() => /data notice/.test(document.getElementById("err").textContent));
ok(true, "claim: then the data notice");
await page.fill("#email", "new@example.com");
ok(await page.locator("#codeBlock").isVisible(), "claim: a different email asks for a code");
await page.fill("#email", "asha@example.com");
await page.check("#consent"); await page.check("#showCity");
await page.click("#go");
await page.waitForSelector("#done:not([hidden])");
ok(await page.locator("#doneH").innerText() === "No. 07 is recorded in your name", "claim: registered, and it says so");
ok(/Owner I of No\. 07 of 20/.test(await page.locator("#doneP").innerText()), "claim: as Owner I");
ok(await page.locator("#strip i.mine").count() === 1 && await page.locator("#strip i").count() === 20, "claim: the number settles into the twenty");
await page.screenshot({ path: "/tmp/claim-done.png", fullPage: true });
ok(W.DB.raw.prepare("SELECT show_city_publicly FROM owners WHERE email='asha@example.com'").get().show_city_publicly === 1, "claim: the city was ticked, so it is public");
ok(W.mails.some(m => m.subject === "No. 07 is recorded in your name"), "claim: the welcome email went");

/* On to the dashboard. */
await page.click("#open");
await page.waitForSelector("#app:not([hidden]) .dial");
ok(await page.locator("h1.piece, .piece .no").first().innerText().then(t => /No\. 07/.test(t)), "owners: the dashboard opens signed in");
ok(/Owner I/.test(await page.locator(".kv").first().innerText()), "owners: the owner number, in numerals");
const d0 = await page.locator(".dial .days").innerText();
ok(/^\d+\s*days$/i.test(d0.replace("\n", " ")) && parseInt(d0, 10) >= 729, "owners: about two years of days remain");
const s1 = await page.locator(".dial .hms span").nth(4).innerText();
await page.waitForTimeout(1250);
const s2 = await page.locator(".dial .hms span").nth(4).innerText();
ok(s1 !== s2 && /^\d\d$/.test(s2), "owners: the seconds step (" + s1 + " to " + s2 + ")");
const serverS = await page.evaluate(() => 0);
void serverS;
ok(await page.locator(".dial svg line.tick").count() === 24, "owners: the ring has 24 ticks, like the 24 hour subdial");
const hrs = await page.locator(".dial .hms span").nth(0).innerText();
ok(/^\d\d$/.test(hrs), "owners: hours, minutes and seconds are two digits");
ok(await page.locator(".chain li.mine .you").count() === 1, "owners: the chain marks the owner as you");
ok(/Nothing yet/.test(await page.locator("text=Service history").locator("..").innerText()), "owners: an empty service history is designed, not blank");
const sw2 = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
ok(sw2[0] <= sw2[1], "owners: no sideways scroll at 360px");
/* Scroll through, as an owner would, so every part has arrived. */
await page.evaluate(async () => { for (let y = 0; y <= document.body.scrollHeight; y += 300) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 90)); } window.scrollTo(0, 0); });
await page.waitForTimeout(1500);
ok(await page.evaluate(() => [...document.querySelectorAll("#dossier .card")].every(c => getComputedStyle(c).opacity === "1")), "owners: every part of the page arrives as it is scrolled to");
await page.screenshot({ path: "/tmp/owners-dash.png", fullPage: true });

/* The certificate and the receipt. */
await page.click("text=Printable certificate");
await page.waitForSelector("#paper:not([hidden])");
const cert = await page.locator("#paper").innerText();
ok(/certificate of ownership/i.test(cert) && /Owner I/.test(cert) && /Asha Rao/.test(cert), "owners: a printable certificate");
await page.screenshot({ path: "/tmp/owners-cert.png", fullPage: true });
await page.click("text=Back");
await page.click("text=Download receipt");
await page.waitForSelector("#paper:not([hidden])");
ok(/599,00|5,999/.test(await page.locator("#paper").innerText()) && /pay_UIOWN0007/.test(await page.locator("#paper").innerText()), "owners: the receipt, with the amount and the payment reference");
await page.click("text=Back");

/* Out, and back in with a code. */
await page.click("#out");
await page.waitForSelector("#gate:not([hidden])");
ok(await page.evaluate(() => !localStorage.getItem("kaal_o")), "owners: signing out forgets the token");
W.mails.length = 0;
await page.fill("#email", "asha@example.com"); await page.click("#eGo");
await page.waitForSelector("#fCode:not([hidden])");
const code = (W.mails.find(m => /sign-in code/.test(m.subject)) || {}).subject.slice(0, 7).replace(" ", "");
await page.fill("#code", "000000"); await page.click("#cGo");
await page.waitForFunction(() => document.getElementById("cErr").textContent.length > 0);
ok(/not right/.test(await page.locator("#cErr").innerText()), "owners: a wrong code is told plainly");
await page.fill("#code", code); await page.click("#cGo");
await page.waitForSelector("#app:not([hidden]) .dial");
ok(true, "owners: the right code signs in again");

/* Another visitor, never registered: the gate says nothing about who is an owner. */
const B2 = await open(W, { viewport: { width: 360, height: 800 } });
const p2 = await B2.page();
await p2.goto(SITE + "/owners");
await p2.waitForSelector("#gate:not([hidden])");
await p2.fill("#email", "stranger@example.com"); await p2.click("#eGo");
await p2.waitForSelector("#fCode:not([hidden])");
ok(/If that email holds a KAAL, a code is on its way/.test(await p2.locator("#gateLead").innerText()), "owners: a stranger's email gets the same answer as an owner's");
ok(B.log.errors.length === 0, "owners: no script errors " + JSON.stringify(B.log.errors).slice(0, 200));
ok(B.log.console.filter(x => !/Failed to load resource.*status of (40\d|410)/.test(x)).length === 0, "owners: no console errors " + JSON.stringify(B.log.console).slice(0, 300));
await B2.browser.close();
await B.browser.close();
console.log(failed ? `\n${failed} failed.` : "\nAll owners browser checks passed.");
process.exit(failed ? 1 : 0);
