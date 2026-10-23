/* ══════════════════════════════════════════════════════════════════
   THE LETTERS (registry): the emails an order sends as it moves.

   The words are the brief's, VERBATIM (section 7). Do not edit them here
   without the owner: a test (tools/test-registry.mjs) holds each one to
   the brief's text. {{ }} in the brief are the fields of `d` below.

   The look is the brief's too: a light page, off-white, the KAAL
   wordmark in letters (no image), generous space, one button at most,
   readable with images off, and a plain-text twin for every one.

   Each template takes d = { site, n, size, courier, tracking, trackingUrl,
   claimUrl, ownerNo, registeredOn, warrantyEnd, trackUrl } and returns
   { subject, text, html }. trackUrl, when given, ends a tracking email
   with the quiet "Follow No. 07's journey" link (the /track page).
   ══════════════════════════════════════════════════════════════════ */

const pad2 = (n) => (n < 10 ? "0" + n : String(n));
export function roman(n) {
  const r = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "", x = Math.max(1, n | 0);
  for (const [v, s] of r) while (x >= v) { out += s; x -= v; }
  return out;
}
const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeUrl = (u) => (/^https:\/\/[^\s"'<>]+$/i.test(String(u || "")) ? String(u) : "");

const C = { page: "#F4F1EA", sheet: "#FBF9F4", ink: "#1D1B18", soft: "#5C574E", rule: "#E6E0D4", gold: "#8A6C33" };
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/* blocks: strings are paragraphs; { button: [label, url] } is the one button;
   { quiet: [label, url] } is a small text link. */
function render(subject, blocks, opts) {
  const o = opts || {};
  const html = [];
  const text = [];
  for (const b of blocks) {
    if (typeof b === "string") {
      html.push(`<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:${C.ink}">${esc(b)}</p>`);
      text.push(b, "");
    } else if (b.button) {
      const u = safeUrl(b.button[1]);
      if (!u) continue;
      html.push(`<p style="margin:6px 0 26px"><a href="${esc(u)}" style="display:inline-block;background:${C.ink};color:${C.sheet};text-decoration:none;font-size:15px;letter-spacing:.04em;padding:14px 22px">${esc(b.button[0])}</a></p>`);
      text.push(`${b.button[0]}: ${u}`, "");
    } else if (b.quiet) {
      const u = safeUrl(b.quiet[1]);
      if (!u) continue;
      html.push(`<p style="margin:26px 0 0;font-size:13px;line-height:1.6"><a href="${esc(u)}" style="color:${C.soft}">${esc(b.quiet[0])}</a></p>`);
      text.push(`${b.quiet[0]}: ${u}`, "");
    }
  }
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden">${esc(o.preheader || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:36px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${C.sheet};border:1px solid ${C.rule}"><tr><td style="padding:40px 32px 36px;font-family:${SANS}">
<p style="margin:0 0 40px;font-size:13px;letter-spacing:.55em;color:${C.ink}">KAAL</p>
${html.join("\n")}
</td></tr></table>
<p style="margin:18px 0 0;font-family:${SANS};font-size:12px;color:${C.soft}">thekaal.co</p>
</td></tr></table></body></html>`;
  return { subject, html: body, text: text.join("\n").trim() + "\n" };
}

const journey = (d) => d.trackUrl ? [{ quiet: [`Follow No. ${pad2(d.n)}'s journey`, d.trackUrl] }] : [];

export const LETTERS = {
  placed(d) {
    const n = pad2(d.n);
    return render(`No. ${n} is spoken for`, [
      "Owner,",
      `Your payment is received and No. ${n} of ${d.size} is now set aside for you alone. Before it leaves, it will be inspected again, boxed by hand and sent to you within five days. You will hear from us at each step.`,
      "KAAL", ...journey(d)
    ], { preheader: `No. ${n} of ${d.size} is set aside for you alone.` });
  },
  inspected(d) {
    const n = pad2(d.n);
    return render(`No. ${n} has passed inspection`, [
      "Owner,",
      `Before a KAAL leaves us, it is examined once more, on its own. Today it was No. ${n}'s turn: the time, the day and date, the 24-hour hand, the crown, the bracelet, the finish. It passed.`,
      "Next, its box is made for it.",
      "KAAL", ...journey(d)
    ], { preheader: "It passed." });
  },
  packed(d) {
    const n = pad2(d.n);
    return render(`No. ${n} is boxed`, [
      "Owner,",
      `Every KAAL box is made for the one piece it carries. No. ${n}'s is finished, and the piece is resting inside it with its letter.`,
      "It leaves for you next.",
      "KAAL", ...journey(d)
    ], { preheader: "It leaves for you next." });
  },
  dispatched(d) {
    const n = pad2(d.n);
    return render(`No. ${n} is on its way to you`, [
      "Owner,",
      `No. ${n} has left us. It travels with ${d.courier}, tracking number ${d.tracking}.`,
      { button: [`Follow No. ${n}`, d.trackingUrl] },
      "Somewhere between here and you is a piece that will not be made again. When it arrives, open it slowly.",
      "KAAL", ...journey(d)
    ], { preheader: `It travels with ${d.courier}.` });
  },
  delivered(d) {
    const n = pad2(d.n);
    return render(`No. ${n} is with you. One step makes it yours.`, [
      "Owner,",
      `No. ${n} has reached you. Before you wear it, take a minute with it. Turn it over and read the caseback.`,
      `One step remains. Registering writes you into the KAAL registry as Owner ${roman(d.ownerNo || 1)} of No. ${n} of ${d.size}. That record stays with this piece for as long as it exists. It also opens your owner dashboard: your 2-year warranty counting down to the second, the piece's history, and its transfer if you ever pass it on.`,
      { button: [`Register No. ${n}`, d.claimUrl] },
      `Registering is how you accept the piece. Once you register, the 7-day return option closes and No. ${n} is yours outright. If you would rather keep it on approval for now, this link will wait for you.`,
      `${d.size} were made. This one found you.`,
      "KAAL", ...journey(d)
    ], { preheader: "One step makes it yours." });
  },
  reminder(d) {
    const n = pad2(d.n);
    return render(`No. ${n} has no name beside it yet`, [
      "Owner,",
      `No. ${n} has been with you for three days. Its place in the registry is still empty.`,
      { button: [`Register No. ${n}`, d.claimUrl] },
      "Registering closes the return option and opens your warranty dashboard.",
      "KAAL"
    ], { preheader: "Its place in the registry is still empty." });
  },
  outForDelivery(d) {
    const n = pad2(d.n);
    const who = d.courier ? `${d.courier}'s rider` : "the courier's rider";
    return render(`No. ${n} is out for delivery`, [
      "Owner,",
      `No. ${n} is out for delivery. It is with ${who} today. Keep your phone close; the rider may call.`,
      "KAAL", ...journey(d)
    ], { preheader: "It should reach you today." });
  },
  addressNeeded(d) {
    const n = pad2(d.n);
    return render(`No. ${n} needs somewhere to go`, [
      "Owner,",
      `Your payment is received and No. ${n} of ${d.size} is set aside for you. One thing is left: tell us where to send it.`,
      { button: ["Add delivery address", d.shipUrl] },
      "KAAL"
    ], { preheader: "One thing is left: where to send it." });
  },
  registered(d) {
    const n = pad2(d.n);
    return render(`No. ${n} is recorded in your name`, [
      "Owner,",
      `It is done. You are Owner ${roman(d.ownerNo || 1)} of No. ${n}, recorded on ${d.registeredOn}. Your warranty runs until ${d.warrantyEnd}.`,
      "Your dashboard is always at thekaal.co/owners, signed in with this email.",
      "Kaal does not wait. Wear it well.",
      "KAAL"
    ], { preheader: `You are Owner ${roman(d.ownerNo || 1)} of No. ${n}.` });
  },

  /* ── For the shop's own inbox, never a customer's. Plain and short. ── */
  sla(d) {
    const n = pad2(d.n);
    return render(`No. ${n} is late: ${d.why}`, [
      `No. ${n}: ${d.why}.`,
      `Paid ${d.paidOn}. It is ${d.status} now. The promise is five days from payment to dispatch.`,
      { button: ["Open the control room", d.controlUrl] }
    ], { preheader: d.why });
  },
  courierAlert(d) {
    const head = d.n ? `No. ${pad2(d.n)}: the courier reports ${d.status}` : `A courier update could not be matched to an order`;
    return render(`${head}`, [
      d.n ? `The courier reports "${d.status}" for No. ${pad2(d.n)} (tracking ${d.awb}). Nothing was changed.` : `The courier reports "${d.status}" for tracking ${d.awb}, and no order carries that number or a KAAL number in its order reference. Nothing was changed.`,
      "Check it in Shiprocket and, if it needs a move, in the control room.",
      { button: ["Open the control room", d.controlUrl] }
    ], { preheader: d.status });
  }
};

/* Which letter a stage sends. Placed is the webhook's, not a tap's. */
export const STAGE_LETTER = { inspected: "inspected", packed: "packed", dispatched: "dispatched", delivered: "delivered" };

/* Letters that go to the shop, not to a customer. */
export const STAFF_LETTERS = ["sla", "courierAlert"];

export function sample(name, site) {
  const d = { site, n: 7, size: 20, courier: "Delhivery", tracking: "SAMPLE123456", trackingUrl: "https://www.delhivery.com/track/package/SAMPLE123456",
    claimUrl: `${site}/claim?t=sample`, ownerNo: 1, registeredOn: "26 October 2026", warrantyEnd: "23:59 on 24 October 2028", trackUrl: `${site}/track?o=1&s=sample`, shipUrl: `${site}/claimed.html`,
    why: "Placed more than 48 hours ago, not inspected", paidOn: "20 October 2026", status: "placed", controlUrl: `${site}/control`, awb: "SAMPLE123456" };
  return LETTERS[name] ? LETTERS[name](d) : null;
}
