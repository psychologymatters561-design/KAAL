/* ══════════════════════════════════════════════════════════════════
   The whole life of a KAAL, in real browsers (the brief's section 14,
   final QA), against the real worker on the real migrations:

     a payment is captured (Razorpay's signed webhook) -> the buyer is
     told it is spoken for -> the owner of the shop taps Inspected,
     Packed, Dispatched and Delivered in the control room (each with its
     email) -> the buyer follows it on /track -> registers from the link
     -> raises a warranty claim with a photograph -> the claim is approved
     in Approvals -> passes it on with a code -> the next owner accepts at
     /claim/transfer -> the owner of the shop approves -> Owner II, the
     warranty unchanged, the registry saying so.

   Not part of CI (the repository has no npm). By hand:
     NODE_PATH=/opt/node-tools/node_modules node --no-warnings tools/ui/lifecycle.mjs
   ══════════════════════════════════════════════════════════════════ */
import { createHmac } from "node:crypto";
import w from "../../worker/kaal-sold-sync.js";
import { ctx } from "../d1-shim.mjs";
import { world, open, SITE, WORKER } from "./harness.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const W = world();
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const mailsTo = (to, re) => W.mails.filter(m => m.to.includes(to) && re.test(m.subject));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const waitMail = async (to, re, n) => { for (let i = 0; i < 60; i++) { const m = mailsTo(to, re); if (m.length >= (n || 1)) return m[m.length - 1]; await wait(100); } return null; };

/* 1. Razorpay captures a payment for No. 07. */
W.KV.put("ship:order_E2E0007", JSON.stringify({ src: "checkout", buyer: { name: "Asha Rao", phone: "9876543210", email: "asha@example.com" }, line1: "1 Road", city: "Pune", state: "Maharashtra", pin: "411001" }));
const entity = { id: "pay_E2E0000007", order_id: "order_E2E0007", amount: 599900, currency: "INR", email: "asha@example.com", contact: "+919876543210", created_at: Math.floor(Date.now() / 1000), notes: { kaal_no: "07" } };
{
  const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity } } });
  const k = ctx();
  const r = await w.fetch(new Request(WORKER + "/", { method: "POST", headers: { "x-razorpay-signature": createHmac("sha256", "wh").update(body).digest("hex") }, body }), W.env, k);
  await k.done();
  ok(r.status === 200, "buy: the signed webhook is accepted");
  const forged = await w.fetch(new Request(WORKER + "/", { method: "POST", headers: { "x-razorpay-signature": "0".repeat(64) }, body }), W.env, ctx());
  ok(forged.status === 400, "buy: a forged one is refused");
}
const placed = await waitMail("asha@example.com", /No\. 07 is spoken for/);
ok(placed, "buy: 'No. 07 is spoken for' reaches the buyer");
const trackLink = /https:\/\/thekaal\.co(\/track\?o=\d+&s=[0-9a-f]{24})/.exec(placed.text)[1];

/* The buyer's phone. */
const BUY = await open(W, { viewport: { width: 360, height: 780 } });
const bp = await BUY.page();
await bp.goto(SITE + trackLink);
await bp.waitForSelector("#timeline li");
ok(await bp.locator("#timeline li.current .what").innerText() === "Placed (now)", "track: the buyer sees it is Placed");

/* 2. The owner of the shop, in the control room, on a phone. */
const ADM = await open(W, { viewport: { width: 390, height: 844 } });
const ap = await ADM.page();
await ap.clock.install();
await ap.goto(WORKER + "/control");
await ap.fill("#email", "admin@thekaal.co");
W.mails.length = 0;
await ap.click("#fEmail button[type=submit]");
await ap.waitForSelector("#fCode:not([hidden])");
const code = (await waitMail("admin@thekaal.co", /sign-in code/)).subject.slice(0, 7).replace(" ", "");
await ap.fill("#code", code);
await ap.click("#fCode button[type=submit]");
await ap.waitForSelector("#app:not([hidden])");
ok(true, "control: signed in with the emailed code alone");
await ap.click('[data-go="orders"]');
await ap.waitForSelector('[data-act="next"]');

async function tap(label, mailRe, who) {
  await ap.click(`button[data-act="next"]:has-text("${label}")`);
  if (label === "Mark Dispatched") {
    await ap.selectOption("#cr", "Delhivery"); await ap.fill("#tn", "DL123456789"); await ap.fill("#tu", "https://www.delhivery.com/track/package/DL123456789");
    await ap.click('[data-act="dispatchGo"]');
  } else if (label === "Mark Delivered") await ap.click('[data-act="deliverGo"]');
  await ap.waitForSelector("#toast:not([hidden])");
  await ap.clock.runFor(11000);                                   /* the ten seconds of Undo */
  const m = await waitMail(who || "asha@example.com", mailRe);
  return m;
}
const ins = await tap("Mark Inspected", /No\. 07 has passed inspection/);
ok(ins && /It passed\./.test(ins.text), "control: Inspected, and the buyer's email, after the Undo");
ok(await tap("Mark Packed", /No\. 07 is boxed/), "control: Packed, and its email");
const dis = await tap("Mark Dispatched", /No\. 07 is on its way to you/);
ok(dis && /DL123456789/.test(dis.text), "control: Dispatched with the courier and tracking, and its email");
await bp.reload(); await bp.waitForSelector("#timeline li");
ok((await bp.locator("#timeline li.done").count()) >= 3 && /Delhivery/.test(await bp.locator(".tl .more").innerText()), "track: the buyer's page moves with it, with the courier");
const del = await tap("Mark Delivered", /No\. 07 is with you\. One step makes it yours\./);
ok(del && /Once you register, the 7-day return option closes/.test(del.text), "control: Delivered, and the registration email with the return-window notice");
const claimLink = /https:\/\/thekaal\.co(\/claim\?t=[A-Za-z0-9_-]{43})/.exec(del.text)[1];

/* 3. The buyer registers. */
await bp.goto(SITE + claimLink);
await bp.waitForSelector("#form:not([hidden])");
ok(!(await bp.locator("#accept").isChecked()), "register: every box begins unticked");
await bp.check("#accept"); await bp.check("#consent");
await bp.click("#go");
await bp.waitForSelector("#done:not([hidden])");
ok(/recorded in your name/.test(await bp.locator("#doneH").innerText()), "register: recorded in their name");
ok(!!(await waitMail("asha@example.com", /No\. 07 is recorded in your name/)), "register: the welcome email");
await bp.click("#open");
await bp.waitForSelector("#app:not([hidden]) .dial");
ok(true, "dashboard: it opens signed in, with the warranty counting down");

/* 4. A warranty claim, with a photograph, from the dashboard. */
await bp.click('button:has-text("Raise a warranty claim")');
await bp.fill("#cd", "It loses about a minute a day.");
await bp.setInputFiles("#cf", { name: "dial.jpg", mimeType: "image/jpeg", buffer: JPEG });
await bp.click('#dlgB button[type=submit]');
await bp.waitForSelector("#dlgB .okmsg");
ok(/Your claim is with us/.test(await bp.locator("#dlgB .okmsg").innerText()), "claim: raised with its photograph");
ok(!!(await waitMail("asha@example.com", /your claim is with us/)), "claim: the owner is told it is with us");
await bp.click("#dlgB button:has-text('Done')");
await bp.waitForSelector(".banner:has-text('Your warranty claim')");
ok(true, "dashboard: the open claim shows");

await ap.click('[data-go="approvals"]');
await ap.waitForSelector('[data-act="decide"][data-do="approve"]');
ok(await ap.locator('a:has-text("File 1")').count() === 1, "approvals: the claim and its photograph");
await ap.click('[data-act="decide"][data-do="approve"]');
await ap.fill("#d_pickup", "A courier collects it on 28 October between 10 and 1.");
await ap.click('[data-act="decideGo"]');
ok(!!(await waitMail("asha@example.com", /your claim is approved/)), "approvals: approved, and the pickup details go to the owner");

/* What an owner types is shown as words, never as markup, in the owner of the shop's own screen. */
{
  const evil = '<img src=x onerror="window.__xss=1"> and <b>bold</b>';
  await bp.reload();
  await bp.waitForSelector(".actions");
  await bp.click('button:has-text("Request a contact-details change")');
  await bp.fill("#rd", evil);
  await bp.click('#dlgB button[type=submit]');
  await bp.waitForSelector("#dlgB .okmsg");
  await ap.click('[data-go="overview"]'); await ap.click('[data-go="approvals"]');
  await ap.waitForSelector('[data-act="decide"][data-do="done"]');
  ok(await ap.locator('[data-v="approvals"] img, [data-v="approvals"] b:not(.num)').count() === 0 && /onerror/.test(await ap.locator('[data-v="approvals"]').innerText()), "XSS: a claim that carries markup is shown as text in Approvals, and nothing ran");
  ok(await ap.evaluate(() => window.__xss === undefined), "XSS: and no script from it executed");
  await ap.click('[data-act="decide"][data-do="done"]');
  await ap.click('[data-act="decideGo"]');
  await ap.waitForSelector('[data-act="decide"][data-do="done"]', { state: "detached" }).catch(() => {});
}

/* 5. Passing it on. */
await bp.reload();
await bp.waitForSelector(".actions");
await bp.click('button:has-text("Transfer ownership")');
await bp.click('#dlgB button[type=submit]');
await bp.waitForSelector(".big-code");
const tcode = (await bp.locator(".big-code").innerText()).trim();
ok(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(tcode), "transfer: the code is shown once");
await bp.click("#dlgB button:has-text('Done')");
await bp.waitForSelector(".banner:has-text('A transfer is open')");

const NEW = await open(W, { viewport: { width: 360, height: 780 } });
const np = await NEW.page();
await np.goto(SITE + "/claim/transfer");
await np.fill("#code", tcode);
await np.click("#go1");
await np.waitForSelector("#s2:not([hidden])");
ok(/Owner II of No\. 07/.test(await np.locator("#lead").innerText()), "transfer: the next owner sees they would be Owner II, and that the warranty stays");
await np.fill("#name", "Kim Lee"); await np.fill("#phone", "9811122233"); await np.fill("#email", "kim@example.com");
W.mails.length = 0;
await np.click("#send");
const ecode = (await waitMail("kim@example.com", /sign-in code/)).subject.slice(0, 7).replace(" ", "");
await np.fill("#ecode", ecode);
await np.check("#accept"); await np.check("#consent");
await np.click("#go2");
await np.waitForSelector("#s3:not([hidden])");
ok(/It is with us/.test(await np.locator("#doneH").innerText()), "transfer: accepted, waiting for the owner of the shop");

await ap.click('[data-go="overview"]'); await ap.click('[data-go="approvals"]');
await ap.waitForSelector('[data-act="decide"][data-kind="tr"][data-do="approve"]');
await ap.click('[data-act="decide"][data-kind="tr"][data-do="approve"]');
await ap.click('[data-act="decideGo"]');
const kdone = await waitMail("kim@example.com", /No\. 07 is recorded in your name/);
ok(kdone && /Owner II/.test(kdone.text), "transfer: approved, and Owner II is told");
ok(!!(await waitMail("asha@example.com", /No\. 07 has passed on/)), "transfer: and so is the owner who passed it on");

await np.click('a:has-text("Open Owners")');
await np.waitForSelector("#app:not([hidden]) .dial");
ok(/Owner II/.test(await np.locator(".kv").first().innerText()), "dashboard: Owner II sees themselves as Owner II");
const wk = await np.locator(".dial .cap + .days, .dial .days").first().innerText();
await bp.reload();
await bp.waitForSelector("#app:not([hidden])");
ok(await bp.locator(".dial").count() === 0, "dashboard: the first owner no longer holds it");
const pub = await np.evaluate(async () => (await (await fetch("https://kaal-edition.kaal-edition-hq.workers.dev/registry/data")).json()).pieces[6]);
ok(pub.owner.no === 2 && pub.state === "sold", "registry: the public record says Owner II");
ok(parseInt(wk, 10) >= 729, "warranty: unchanged by the transfer (" + parseInt(wk, 10) + " days left)");

ok(BUY.log.errors.length + ADM.log.errors.length + NEW.log.errors.length === 0, "no script errors anywhere " + JSON.stringify(BUY.log.errors.concat(ADM.log.errors, NEW.log.errors)).slice(0, 300));
for (const B of [BUY, ADM, NEW]) await B.browser.close();
console.log(failed ? `\n${failed} failed.` : "\nThe whole lifecycle passed.");
process.exit(failed ? 1 : 0);
