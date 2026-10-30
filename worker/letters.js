/* ══════════════════════════════════════════════════════════════════
   THE LETTERS (registry): the emails an order sends as it moves.

   The words are the brief's, VERBATIM (section 7). Do not edit them here
   without the owner: a test (tools/test-control.mjs) holds each one to
   the brief's text. {{ }} in the brief are the fields of `d` below.
   Delivered and the reminder were rewritten at the owner's request (Oct
   2026) to make registering something an owner wants to do, and Placed
   gained one line so the step is expected; see docs/ownership-emails.md.

   The look is the brief's too: a light page, off-white, the KAAL
   wordmark in letters (no image), generous space, one button at most,
   readable with images off, and a plain-text twin for every one.

   Each template takes d = { site, n, size, courier, tracking, trackingUrl,
   claimUrl, ownerNo, registeredOn, warrantyEnd, trackUrl, returnDays,
   returnEndsOn, returnClosed } and returns
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
   { quiet: [label, url] } is a small text link; { list: [lines] } is a short
   list (a table, so every mail client keeps its shape). */
function render(subject, blocks, opts) {
  const o = opts || {};
  const html = [];
  const text = [];
  for (const b of blocks) {
    if (b === undefined || b === null || b === "") continue;            /* a field the caller did not have: no empty paragraph, no crash */
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
    } else if (b.list) {
      const items = b.list.filter(Boolean);
      if (!items.length) continue;
      html.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:-6px 0 22px">${items.map(i =>
        `<tr><td valign="top" style="padding:0 12px 8px 2px;font-size:16px;line-height:1.55;color:${C.gold}">&#183;</td><td style="padding:0 0 8px;font-size:15px;line-height:1.55;color:${C.ink}">${esc(i)}</td></tr>`).join("")}</table>`);
      text.push(...items.map(i => `  · ${i}`), "");
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

/* A count in words where a sentence opens with it ("Twenty were made"). */
const NUMWORD = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];
const inWords = (n) => NUMWORD[n] || String(n);

const journey = (d) => d.trackUrl ? [{ quiet: [`Follow No. ${pad2(d.n)}'s journey`, d.trackUrl] }] : [];

export const LETTERS = {
  placed(d) {
    const n = pad2(d.n);
    return render(`No. ${n} is spoken for`, [
      "Owner,",
      `Your payment is received and No. ${n} of ${d.size} is now set aside for you alone. Before it leaves, it will be inspected again, boxed by hand and sent to you within five days. You will hear from us at each step.`,
      `The day it reaches you, we will send one last link: the step that writes your name beside No. ${n} in the KAAL registry.`,
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
  /* The letter that asks for the one step. It leads with what registering
     gives (a name in the record of one of twenty, and the owner's room),
     then says plainly what it closes, and leaves the choice with them:
     the warranty never depends on it, and the link waits. */
  delivered(d) {
    const n = pad2(d.n), days = d.returnDays || 7;
    const close = d.returnClosed
      ? `Its ${days}-day return window has already closed, so registering simply writes your name. Your warranty runs from the day of delivery either way.`
      : `Registering is how you accept the piece, so it closes the ${days}-day return option${d.returnEndsOn ? `, which is otherwise open until ${d.returnEndsOn}` : ""}. Your warranty does not depend on it: it runs from the day of delivery either way.`;
    return render(`No. ${n} is with you. One step makes it yours.`, [
      "Owner,",
      `No. ${n} has reached you. Before anything else, turn it over and read the caseback. That number was engraved once, for this piece, and will never be engraved again.`,
      `Each of the ${inWords(d.size).toLowerCase()} has one line in the KAAL registry, and No. ${n}'s is still blank. Registering writes your name into it as Owner ${roman(d.ownerNo || 1)} of No. ${n} of ${d.size}. That record stays with the piece for as long as it exists. If it is ever passed on, its history begins with you.`,
      "The moment you register, your owner's room opens:",
      { list: [
        "your 2-year warranty, counting down to the second, and any claim raised from there",
        "the piece's record, kept in your name",
        "its transfer, if you ever give it or sell it, so its history goes with it",
        `a way to report it stolen, so that anyone who looks up No. ${n} is warned`,
        "first word of Series 02, before anyone else"
      ] },
      { button: [`Make No. ${n} yours`, d.claimUrl] },
      close,
      d.returnClosed ? "" : `If you would like to live with No. ${n} for a few days first, do. This link will wait for you.`,
      `${inWords(d.size)} were made. This one found you.`,
      "KAAL", ...journey(d)
    ], { preheader: `One of ${inWords(d.size).toLowerCase()}. Its line in the registry is waiting for your name.` });
  },
  /* The one reminder, three days on. Said once, and it says so. */
  reminder(d) {
    const n = pad2(d.n);
    return render(`No. ${n} has no name beside it yet`, [
      "Owner,",
      `No. ${n} has been with you for three days. By now you will know whether it is yours.`,
      `Its line in the KAAL registry is still blank. A minute fills it: your name, as Owner ${roman(d.ownerNo || 1)} of No. ${n} of ${d.size}, for as long as the piece exists. Your owner's room opens with it.`,
      { button: [`Make No. ${n} yours`, d.claimUrl] },
      `Registering closes the return option${d.returnEndsOn ? `, open until ${d.returnEndsOn}` : ""}. Your warranty runs from the day of delivery either way.`,
      "We will not ask again.",
      "KAAL"
    ], { preheader: "Its line in the registry is still blank." });
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

  /* ── The other emails (the brief's section 7, written in its voice; the
        owner of the shop approves their wording). Short, plain, no sales. ── */
  claimReceived(d) {
    const n = pad2(d.n);
    return render(`No. ${n}: your claim is with us`, [
      "Owner,",
      `We have your warranty claim for No. ${n}. We answer within forty eight hours, and you will hear from us here.`,
      "KAAL"
    ], { preheader: "We answer within forty eight hours." });
  },
  claimApproved(d) {
    const n = pad2(d.n);
    return render(`No. ${n}: your claim is approved`, [
      "Owner,",
      `Your claim for No. ${n} is approved. Its movement will be replaced, and your warranty stays exactly as it was.`,
      d.pickup ? `Pickup: ${d.pickup}` : "We will send you the pickup details shortly.",
      "Please send it in its box, with its letter.",
      "KAAL"
    ], { preheader: "The movement will be replaced." });
  },
  moreInfo(d) {
    const n = pad2(d.n);
    return render(`No. ${n}: we need a little more`, [
      "Owner,",
      `To decide your claim for No. ${n} we need a little more from you:`,
      d.message,
      "Reply to this email with it, and we will carry on.",
      "KAAL"
    ], { preheader: "A little more, and we can decide." });
  },
  claimDeclined(d) {
    const n = pad2(d.n);
    return render(`No. ${n}: about your claim`, [
      "Owner,",
      `We have looked closely at your claim for No. ${n}, and we are not able to approve it under the warranty.`,
      d.reason,
      "If it still needs work, we will service it for a fee. Reply to this email and we will quote it before anything is done.",
      "KAAL"
    ], { preheader: "We could not approve it under the warranty." });
  },
  serviceReturned(d) {
    const n = pad2(d.n);
    return render(`No. ${n} is on its way back to you`, [
      "Owner,",
      `No. ${n} has its new movement and has been tested. It is on its way back to you${d.tracking ? `, with ${d.courier || "the courier"}, tracking number ${d.tracking}` : ""}.`,
      d.warrantyEnd ? `Your warranty is unchanged. It still runs until ${d.warrantyEnd}.` : "Your warranty is unchanged.",
      "KAAL"
    ], { preheader: "New movement, tested." });
  },
  transferStarted(d) {
    const n = pad2(d.n);
    return render(`No. ${n}: a transfer has begun`, [
      "Owner,",
      `You have started to pass No. ${n} to someone else. The code was shown to you once, on your owner page. Give it to them with the watch and its letter. It works for seven days.`,
      `Until they accept it, No. ${n} is still yours, and you can cancel from your owner page. If you did not keep the code, cancel and start again.`,
      "KAAL"
    ], { preheader: "Until they accept, it is still yours." });
  },
  transferInvite(d) {
    const n = pad2(d.n);
    return render(`No. ${n} is being passed to you`, [
      "Owner,",
      `Its owner has started to pass No. ${n} of ${d.size} to you. When you have it in your hands, open the page below and enter the code that came with it.`,
      { button: [`Accept No. ${n}`, d.inviteUrl] },
      "The code works for seven days from today. Until you accept, nothing changes.",
      "KAAL"
    ], { preheader: "Enter the code that came with it." });
  },
  transferComplete(d) {
    const n = pad2(d.n);
    return d.role === "from"
      ? render(`No. ${n} has passed on`, [
          "Owner,",
          `No. ${n} is now recorded in the name of its next owner. Your time with it, as Owner ${roman(d.ownerNo)}, is written into its history from ${d.fromYear} to ${d.toYear}.`,
          "Thank you for keeping it.",
          "KAAL"
        ], { preheader: "Your time with it is part of its history." })
      : render(`No. ${n} is recorded in your name`, [
          "Owner,",
          `It is done. You are Owner ${roman(d.ownerNo)} of No. ${n}. Its warranty is unchanged and runs until ${d.warrantyEnd}.`,
          "Your dashboard is at thekaal.co/owners, signed in with this email.",
          "Kaal does not wait. Wear it well.",
          "KAAL"
        ], { preheader: `You are Owner ${roman(d.ownerNo)} of No. ${n}.` });
  },
  transferRejected(d) {
    const n = pad2(d.n);
    return render(`No. ${n}: the transfer was not approved`, [
      "Owner,",
      `The transfer of No. ${n} was not approved, and it stays with its current owner. If you would like to know why, reply to this email.`,
      "KAAL"
    ], { preheader: "It stays with its current owner." });
  },
  stolenConfirmed(d) {
    const n = pad2(d.n);
    return render(`No. ${n} is flagged as stolen`, [
      "Owner,",
      `We have confirmed your report. No. ${n} is now shown as stolen in the public registry, and it cannot be transferred. If it is found, write to us and we will clear it.`,
      "KAAL"
    ], { preheader: "It cannot be transferred." });
  },
  stolenCleared(d) {
    const n = pad2(d.n);
    return render(`No. ${n} is cleared`, [
      "Owner,",
      `The stolen flag on No. ${n} is cleared. It is shown in the registry as it was, and it can be transferred again.`,
      "KAAL"
    ], { preheader: "The flag is cleared." });
  },
  accessReset(d) {
    const n = pad2(d.n);
    return render(`No. ${n}: your access is restored`, [
      "Owner,",
      `We have checked your record for No. ${n} and moved your sign-in to this address. Every earlier sign-in has been closed.`,
      { button: ["Sign in to Owners", d.signInUrl] },
      "We will email you a six digit code each time you sign in.",
      "KAAL"
    ], { preheader: "Your sign-in is moved to this address." });
  },
  recoveryDeclined(d) {
    const n = pad2(d.n);
    return render(`No. ${n}: about your request`, [
      "Owner,",
      `We could not verify your request for No. ${n}, and we have changed nothing.`,
      d.reason,
      "Reply to this email with a photograph of the caseback and of the letter that came with it, and we will look again.",
      "KAAL"
    ], { preheader: "We could not verify it yet." });
  },
  returnProcessed(d) {
    const n = pad2(d.n);
    return render(`No. ${n}: your return is processed`, [
      "Owner,",
      `We have received No. ${n} back, and your return is processed. ${d.amount ? `${d.amount} is on its way back to the way you paid, and can take up to seven working days to show.` : "Your refund is on its way back to the way you paid."}`,
      "Thank you for trying it.",
      "KAAL"
    ], { preheader: "Your refund is on its way." });
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
  requestNew(d) {
    const n = pad2(d.n);
    const what = { warranty: "A warranty claim", stolen: "A stolen report", contact: "A contact change", service: "A service request", recovery: "A recovery request", transfer: "A transfer" }[d.type] || "A request";
    return render(`[KAAL] ${what} for No. ${n} needs you`, [
      `${what} for No. ${n} is waiting${d.type === "warranty" ? ". The promise is an answer within forty eight hours" : ""}.`,
      d.summary || "",
      { button: ["Open Approvals", d.controlUrl] }
    ].filter(Boolean), { preheader: what });
  },
  requestLate(d) {
    const n = pad2(d.n);
    return render(`[KAAL] No. ${n}: a claim has waited 36 hours`, [
      `The warranty claim for No. ${n} has waited thirty six hours. The promise is an answer within forty eight.`,
      { button: ["Open Approvals", d.controlUrl] }
    ], { preheader: "Twelve hours left." });
  },
  linkRequested(d) {
    const n = pad2(d.n);
    return render(`A new registration link was asked for: No. ${n}`, [
      `Someone opened a registration link for No. ${n} that has expired, been used or been replaced, and asked for a new one.`,
      `The order's email is ${d.email}. If it is the owner, send them a fresh link from the order in the control room.`,
      { button: ["Open the control room", d.controlUrl] }
    ], { preheader: `No. ${n}` });
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
export const STAFF_LETTERS = ["sla", "courierAlert", "linkRequested", "requestNew", "requestLate"];

/* The same invitation as a WhatsApp message, for the owner of the shop to
   send from KAAL's phone (control room: "WhatsApp the link"). Plain text,
   one link, the return option said as plainly as in the email. */
export function whatsappNote(d) {
  const n = pad2(d.n), days = d.returnDays || 7;
  return [
    `Owner, No. ${n} has reached you.`,
    `One step makes it yours. This link writes your name into the KAAL registry as Owner ${roman(d.ownerNo || 1)} of No. ${n} of ${d.size}, and opens your owner's room: your warranty, the piece's record, and its transfer if you ever pass it on.`,
    d.claimUrl,
    d.returnClosed
      ? "Its return window has closed, so registering simply writes your name. Your warranty runs from the day of delivery either way."
      : `Registering closes the ${days}-day return option${d.returnEndsOn ? `, open until ${d.returnEndsOn}` : ""}. Your warranty runs from the day of delivery either way, and the link will wait if you would like a few days first.`,
    "KAAL"
  ].join("\n\n");
}

export function sample(name, site) {
  const d = { site, n: 7, size: 20, courier: "Delhivery", tracking: "SAMPLE123456", trackingUrl: "https://www.delhivery.com/track/package/SAMPLE123456",
    claimUrl: `${site}/claim?t=sample`, ownerNo: 1, registeredOn: "26 October 2026", warrantyEnd: "23:59 on 24 October 2028", trackUrl: `${site}/track?o=1&s=sample`, returnDays: 7, returnEndsOn: "2 November 2026", shipUrl: `${site}/claimed.html`,
    pickup: "A courier will collect it on 28 October, between 10 am and 1 pm. Keep it in its box.", message: "A photograph of the caseback, and of the dial in daylight.", reason: "The movement is working as it should; the time it shows is a setting, not a fault.", inviteUrl: `${site}/claim/transfer`, signInUrl: `${site}/owners`, role: "to", fromYear: "2026", toYear: "2029", amount: "\u20b95,999", type: "warranty", summary: "The watch stops after an hour.", email: "owner@example.com", why: "Placed more than 48 hours ago, not inspected", paidOn: "20 October 2026", status: "placed", controlUrl: `${site}/control`, awb: "SAMPLE123456" };
  return LETTERS[name] ? LETTERS[name](d) : null;
}
