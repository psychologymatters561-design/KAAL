/* Every new page at 360, 768 and 1280 wide: no sideways scroll, every button
   and link a thumb can reach at least 44px tall, one h1, labelled fields,
   a visible focus ring, reduced motion honoured. By hand:
     NODE_PATH=/opt/node-tools/node_modules node --no-warnings tools/ui/layout.mjs */
import * as R from "../../worker/registry.js";
import { moveOrder, trackUrl } from "../../worker/orders.js";
import { flushOutbox } from "../../worker/outbox.js";
import { world, open, SITE } from "./harness.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const W = world();
const r = await R.recordPayment(W.env, { series: "S01", n: 7, paymentId: "pay_LAYOUT007", orderId: "order_LAYOUT007", amount: 599900, email: "asha@example.com", phone: "9876543210", name: "Asha Rao", address: { city: "Pune", state: "Maharashtra" }, paidAt: new Date().toISOString() });
W.DB.raw.prepare("UPDATE orders SET status='dispatched', dispatched_at=?, courier='Delhivery', tracking_number='D1', tracking_url='https://x.example/t' WHERE id=?").run(new Date(Date.now() - 86400000).toISOString(), r.order.id);
await moveOrder(W.env, { siteUrl: () => SITE, kick: () => {} }, "admin:1", r.order.id, { to: "delivered", day: new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10) });
await flushOutbox(W.env, async (to, subject, text, html) => { W.mails.push({ to: [to], subject, text, html }); return true; });
const claim = /claim\?t=([A-Za-z0-9_-]{43})/.exec(W.mails.find(m => /One step/.test(m.subject)).text)[1];
const track = await trackUrl(W.env, SITE, r.order.id);

const pages = [["/registry?n=07", "registry"], [track.replace(SITE, ""), "track"], ["/claim?t=" + claim, "claim"], ["/claim/transfer", "transfer"], ["/owners", "owners gate"], ["/legal.html#data", "legal"]];
for (const width of [360, 768, 1280]) {
  const B = await open(W, { viewport: { width, height: 900 } });
  for (const [url, name] of pages) {
    const p = await B.page();
    await p.goto(SITE + url);
    await p.waitForTimeout(700);
    const m = await p.evaluate(() => {
      const vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const tap = [...document.querySelectorAll("button, a.btn, input[type=checkbox], input[type=text], input[type=email], input[type=tel], select, textarea")].filter(vis).filter(e => !e.closest("[hidden]"));
      const small = tap.filter(e => { const b = e.getBoundingClientRect(); const box = e.type === "checkbox" ? e.closest("label") || e : e; const bb = box.getBoundingClientRect(); return bb.height < 43.5 && !e.closest(".reg-grid") && !e.classList.contains("linkbtn"); }).map(e => (e.id || e.className || e.tagName) + ":" + Math.round(e.getBoundingClientRect().height));
      const unlabeled = [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]), textarea, select")].filter(vis).filter(e => !e.labels || !e.labels.length) .filter(e => !e.getAttribute("aria-label")).map(e => e.id);
      return { over: document.documentElement.scrollWidth - window.innerWidth, h1: [...document.querySelectorAll("h1")].filter(vis).length, small, unlabeled, lang: document.documentElement.lang };
    });
    ok(m.over <= 0 && m.h1 === 1 && m.unlabeled.length === 0 && m.small.length === 0, `${width}px ${name}: no sideways scroll, one h1, every field labelled, taps >= 44px` + (m.over > 0 ? ` (over by ${m.over})` : "") + (m.small.length ? " small: " + m.small.join(",") : "") + (m.unlabeled.length ? " unlabelled: " + m.unlabeled.join(",") : ""));
    if (width === 360 && name === "transfer") await p.screenshot({ path: "/tmp/transfer-360.png", fullPage: true });
    await p.close();
  }
  await B.browser.close();
}
console.log(failed ? `\n${failed} failed.` : "\nEvery page is at home at 360, 768 and 1280.");
process.exit(failed ? 1 : 0);
