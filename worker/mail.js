/* ══════════════════════════════════════════════════════════════════
   KAAL · THE EMAILS

   Every message the shop sends, as HTML with a plain-text twin. The
   worker decides WHEN to send; this file decides only what each one
   says and looks like, so the words can be read and changed in one
   place without touching the money path.

     buyerConfirmation   to the buyer, the moment Razorpay confirms the
                         payment: their engraved number, the order, the
                         date it arrives, what happens next
     ownerSale           to the owner, at the same moment: who bought
                         which number, how to reach them, what to do
     ownerShip           to the owner, when the buyer gives an address:
                         where to send it, ready to copy
     buyerShip           to the buyer, at the same moment: the address
                         as we have it, so a mistake is caught before
                         dispatch
     buyerDispatched     to the buyer, when the owner marks it sent on the
                         desk: the courier and the tracking number, which
                         the first email promised "the day it leaves"
     buyerRefund         to the buyer, when Razorpay processes a refund:
                         how much, which references, when the bank shows it
     ownerRefund         to the owner, at the same moment, with the one
                         question a full refund leaves: is the number
                         back on sale?
     ownerDigest         to the owner, just after midnight: the day in
                         numbers, and whatever needs them

   And the ones nobody presses send on (worker section 3e). The two before
   a purchase read as a personal note, not a newsletter; all of them say
   only what is true the moment they land:

     buyerNearlyBought   to someone who stopped one step short of paying
     seriesTwoNote       to the Series 02 list, once, while Series 01 is open
     afterArrival        to the owner, the day after it should have arrived
     afterSettled        to the owner, once the seven days have passed
     afterYear           to the owner, a year after it left us

   Built the way email has to be built: tables, inline styles, no web
   fonts, no script, images only as decoration (every one has alt text
   and the message reads completely without them). Dark, like the site,
   with the colours set on every cell so a mail app's dark mode has
   nothing to invert. Anything a buyer typed is escaped before it is
   placed in HTML.
   ══════════════════════════════════════════════════════════════════ */

const C = {
  bg: "#0b0c0a", card: "#121310", line: "#26231f", bone: "#EDE8DF",
  mute: "#B3AC9F", faint: "#8f897e", gold: "#C6A15B", goldLit: "#E0BE7C"
};
const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const PHONE = "+91 93114 16678", PHONE_TEL = "+919311416678", PHONE_WA = "919311416678";

export function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const pad2 = (n) => (n < 10 ? "0" + n : String(n));

/* Five working days, Monday to Saturday, counted from today in India.
   The same rule the receipt page uses, so the two never disagree. */
function fiveWorkingDays(from) {
  const d = new Date((from || new Date()).getTime() + 5.5 * 3600 * 1000);
  let k = 0;
  while (k < 5) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0) k++; }
  return d;
}
export function arriveBy(from) {
  const d = fiveWorkingDays(from);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}
/* The same date as "2026-10-12", for comparing against today. */
export function arriveByDay(from) { return fiveWorkingDays(from).toISOString().slice(0, 10); }

/* "2 Oct 2026, 7:15 pm", in India, whatever the server's clock. */
export function indiaTime(at) {
  const d = new Date((at || new Date()).getTime() + 5.5 * 3600 * 1000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let h = d.getUTCHours(); const m = d.getUTCMinutes(), pm = h >= 12;
  h = h % 12 || 12;
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h}:${m < 10 ? "0" + m : m} ${pm ? "pm" : "am"}`;
}

/* A phone number as WhatsApp wants it: digits only, with India's code. */
export function waNumber(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) d = "91" + d;
  if (d.length === 11 && d[0] === "0") d = "91" + d.slice(1);
  return d.length >= 11 ? d : "";
}

/* Every email that is not about an order someone has paid for carries a
   way out, in the footer and in the header mail apps read for their own
   "unsubscribe" button. A reply saying "stop" reaches a person, who marks
   it on the desk. */
export const STOP_LINE = `Reply "stop" and we won't write again.`;
const MARKETING = { "List-Unsubscribe": "<mailto:connect@thekaal.co?subject=stop>" };

/* ── THE FRAME every message sits in. */
function frame({ title, preheader, body, site, stop }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light">
<title>${esc(title)}</title>
<style>
  body{margin:0!important;padding:0!important;background:${C.bg}}
  a{color:${C.goldLit}}
  @media (max-width:540px){ .px{padding-left:22px!important;padding-right:22px!important} .h1{font-size:32px!important;line-height:38px!important} .stack{display:block!important;width:100%!important} }
</style></head>
<body style="margin:0;padding:0;background:${C.bg};" bgcolor="${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;color:${C.bg};font-size:1px;line-height:1px;">${esc(preheader)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
<tr><td align="center" style="padding:36px 10px 28px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
<tr><td align="center" class="px" style="padding:0 32px 26px;">
  <a href="${esc(site)}" style="text-decoration:none;color:${C.bone};font-family:${SANS};font-size:15px;letter-spacing:9px;font-weight:300;">K&Lambda;&Lambda;L</a>
</td></tr>
${body}
<tr><td class="px" style="padding:30px 32px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${C.line};font-size:0;line-height:0;">&nbsp;</td></tr></table>
</td></tr>
<tr><td align="center" class="px" style="padding:18px 32px 0;font-family:${SANS};font-size:12px;line-height:19px;color:${C.faint};">
  ${stop ? `${esc(STOP_LINE)}<br><br>` : ""}KAAL &middot; Series 01 &middot; twenty watches, never drawn again<br>
  <a href="${esc(site)}" style="color:${C.faint};">thekaal.co</a> &nbsp;&middot;&nbsp; <a href="${esc(site)}/legal.html" style="color:${C.faint};">Seller details, returns and warranty</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function h1(text) {
  return `<tr><td align="center" class="px" style="padding:0 32px 12px;"><h1 class="h1" style="margin:0;font-family:${SERIF};font-style:italic;font-weight:400;font-size:38px;line-height:44px;color:${C.goldLit};">${text}</h1></td></tr>`;
}
function para(html, opts = {}) {
  return `<tr><td align="${opts.align || "center"}" class="px" style="padding:${opts.pad || "0 32px 22px"};font-family:${SANS};font-size:${opts.size || 16}px;line-height:${opts.lh || 25}px;color:${opts.color || C.mute};">${html}</td></tr>`;
}
function eyebrow(text) {
  return `<tr><td align="center" class="px" style="padding:0 32px 14px;font-family:${SANS};font-size:11px;letter-spacing:4px;text-transform:uppercase;color:${C.gold};">${esc(text)}</td></tr>`;
}
function button(href, label, opts = {}) {
  const bg = opts.ghost ? C.bg : C.gold, fg = opts.ghost ? C.goldLit : C.bg;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 4px 8px;"><tr>
<td align="center" bgcolor="${bg}" style="border-radius:999px;background:${bg};border:1px solid ${C.gold};">
<a href="${esc(href)}" style="display:inline-block;padding:14px 26px;font-family:${SANS};font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:600;color:${fg};text-decoration:none;border-radius:999px;">${esc(label)}</a>
</td></tr></table>`;
}
function buttons(list) {
  return `<tr><td align="center" class="px" style="padding:4px 32px 22px;">${list.join("")}</td></tr>`;
}
/* A card of label / value rows. Values are HTML the caller has escaped. */
function card(title, rows, opts = {}) {
  const head = title ? `<tr><td colspan="2" style="padding:22px 24px 6px;font-family:${SERIF};font-size:21px;color:${C.bone};">${esc(title)}</td></tr>` : "";
  const body = rows.filter(Boolean).map(([k, v]) => `<tr>
<td valign="top" style="padding:11px 0 11px 24px;border-top:1px solid ${C.line};font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.faint};width:38%;">${esc(k)}</td>
<td valign="top" align="right" style="padding:11px 24px 11px 12px;border-top:1px solid ${C.line};font-family:${SANS};font-size:15px;line-height:22px;color:${C.bone};">${v}</td></tr>`).join("");
  return `<tr><td class="px" style="padding:${opts.pad || "6px 32px 22px"};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:4px;">
${head}${body}<tr><td colspan="2" style="padding:0 0 10px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>`;
}
function steps(title, list) {
  const rows = list.map(([k, v], i) => `<tr>
<td valign="top" style="padding:12px 0 0 24px;width:34px;"><div style="width:26px;height:26px;border:1px solid ${C.gold};border-radius:50%;text-align:center;font-family:${SANS};font-size:12px;line-height:26px;color:${C.goldLit};">${i + 1}</div></td>
<td valign="top" style="padding:12px 24px 0 12px;font-family:${SANS};font-size:15px;line-height:23px;color:${C.mute};"><b style="display:block;font-weight:600;color:${C.bone};">${esc(k)}</b>${esc(v)}</td></tr>`).join("");
  return `<tr><td class="px" style="padding:6px 32px 22px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:4px;">
<tr><td colspan="2" style="padding:22px 24px 2px;font-family:${SERIF};font-size:21px;color:${C.bone};">${esc(title)}</td></tr>
${rows}<tr><td colspan="2" style="padding:0 0 22px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>`;
}
function image(src, alt, w, h) {
  return `<tr><td align="center" style="padding:0 0 22px;"><img src="${esc(src)}" width="${w}" height="${h}" alt="${esc(alt)}" style="display:block;width:${w}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;color:${C.faint};font-family:${SANS};font-size:13px;"></td></tr>`;
}
/* Two pictures side by side, stacked on a phone. */
function imagePair([s1, a1, w1, h1], [s2, a2, w2, h2]) {
  const cell = (src, alt, w, h) => `<td class="stack" align="center" valign="middle" style="padding:0 8px 14px;"><img src="${esc(src)}" width="${w}" height="${h}" alt="${esc(alt)}" style="display:block;margin:0 auto;width:${w}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;color:${C.faint};font-family:${SANS};font-size:13px;"></td>`;
  return `<tr><td align="center" style="padding:0 0 10px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${cell(s1, a1, w1, h1)}${cell(s2, a2, w2, h2)}</tr></table></td></tr>`;
}
function addressBlock(a) {
  return [a.name, a.line1, a.line2, `${a.city}, ${a.state} ${a.pin}`].filter(Boolean).map(esc).join("<br>");
}
function addressText(a) {
  return [a.name, a.line1, a.line2, `${a.city}, ${a.state} ${a.pin}`, `Phone ${a.phone}`].filter(Boolean).join("\n");
}
const giftCard = (note) => note ? `Handwritten card, no price in the box.<br><span style="color:${C.mute};">&ldquo;${esc(note)}&rdquo;</span>` : "Handwritten card, no price in the box.";

/* ══════════ 1. TO THE BUYER, THE MOMENT THEY PAY ══════════
   The same words as the thank-you page (claimed.html), so the page and
   the inbox say one thing. A gift is bought by one person and worn by
   another, and the opening says so rather than telling the buyer they
   will wear it. */
export function welcomeSteps(n, arrive, gift) {
  return [
    ["Today", `No. ${n} comes out of the edition and is re-inspected by hand, from the movement to the last link of the bracelet. Nothing leaves us unseen.`],
    ["Next", `Its box is finished by hand for it, and No. ${n} is set inside with its warranty card.`],
    ["Within five working days", `It is dispatched${gift ? "" : " to your door"}. Tracking comes to this email the day it leaves.${arrive ? ` It ${gift ? "arrives" : "reaches you"} by ${arrive}.` : ""}`]
  ];
}
export const WELCOME_RETURN = "At your door, you have seven days to live with it. If it isn't you, send it back unworn for a full refund.";
export const WELCOME_RETURN_GIFT = "Once it arrives, there are seven days to live with it. If it isn't right, send it back unworn for a full refund.";
export const WELCOME_CLOSE = "Rare pieces find rare people. This one found you.";

export function buyerConfirmation(d) {
  const n = pad2(d.n), site = d.site, hi = d.first ? `${d.first},` : "Hello,";
  const subject = `No. ${n} is yours`;
  const preheader = `${d.amount} received. Here is what happens now.`;
  const opening = d.gift
    ? `No. ${n} is yours to give. Of everyone who will ever wear a KAAL, the person you give it to is the only one who will wear this one.`
    : `No. ${n} is yours. Of everyone who will ever wear a KAAL, you are the only one who will wear this one.`;
  const next = welcomeSteps(n, d.arriveBy, d.gift);
  const say = (t, o) => para(t, Object.assign({ align: "left", color: C.bone, pad: "0 32px 18px" }, o || {}));
  const caseback = [`${site}/assets/email/caseback-${n}.png`, `Your caseback, engraved: Limited edition No. ${n}`, 200, 200];
  const body = [
    d.dial ? imagePair([`${site}/assets/email/dial-${esc(String(d.dial).toLowerCase())}.jpg`, `The ${d.dial} dial`, 150, 236], caseback) : image(...caseback),
    say(esc(hi)),
    say(esc(opening)),
    say(`Your payment of ${esc(d.amount)} has been received.`),
    d.hasAddress
      ? say(`We have your delivery address. Nothing more is needed from you.`, { pad: "0 32px 22px" })
      : say(`One thing is left: tell us where to send it.`, { pad: "0 32px 14px" }),
    d.hasAddress ? "" : buttons([button(d.shipUrl, "Add delivery address")]),
    card("Your order", [
      ["Watch", `No. ${n}${d.dial ? " &middot; " + esc(d.dial) : ""}`],
      ["Paid", esc(d.amount)],
      ["Payment reference", `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(d.paymentId)}</span>`],
      ["Ordered", esc(d.when)],
      ["Arrives by", `${esc(d.arriveBy)}<br><span style="color:${C.faint};font-size:13px;">Free delivery, anywhere in India</span>`],
      d.gift ? ["Gift", giftCard(d.giftNote)] : null
    ]),
    steps("What happens now", next),
    say(esc(d.gift ? WELCOME_RETURN_GIFT : WELCOME_RETURN)),
    say(esc(WELCOME_CLOSE)),
    say(`Questions before it arrives? Reply here. A person answers.`),
    say("KAAL", { pad: "0 32px 0" })
  ].join("\n");

  const text = [
    hi, "",
    opening, "",
    `Your payment of ${d.amount} has been received.`, "",
    d.hasAddress ? "We have your delivery address. Nothing more is needed from you." : `One thing is left: tell us where to send it.\n${d.shipUrl}`, "",
    "YOUR ORDER",
    `Watch: No. ${n}${d.dial ? " · " + d.dial : ""}`,
    `Paid: ${d.amount}`,
    `Payment reference: ${d.paymentId}`,
    `Ordered: ${d.when}`,
    `Arrives by: ${d.arriveBy} (free delivery, anywhere in India)`,
    d.gift ? `Gift: handwritten card, no price in the box${d.giftNote ? `. Card: "${d.giftNote}"` : ""}` : "", "",
    "WHAT HAPPENS NOW",
    ...next.map(([k, v], i) => `${i + 1}. ${k}: ${/^No\. /.test(v) ? v : v.charAt(0).toLowerCase() + v.slice(1)}`), "",
    d.gift ? WELCOME_RETURN_GIFT : WELCOME_RETURN, "",
    WELCOME_CLOSE, "",
    `Questions before it arrives? Reply here. A person answers.`, "",
    "KAAL"
  ].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");

  return { subject, html: frame({ title: subject, preheader, body, site }), text };
}

/* ══════════ 2. TO THE OWNER, AT THE SAME MOMENT ══════════ */
export function ownerSale(d) {
  const site = d.site, known = d.n >= 1;
  const n = known ? pad2(d.n) : "??";
  const short = !known && d.short;
  const claimed = short && d.short.claimed ? ` mentioning No. ${pad2(d.short.claimed)}` : "";
  const subject = known
    ? `New order · No. ${n}${d.dial ? " " + d.dial : ""} · ${d.amount}`
    : short ? `Payment of ${d.amount} is not the price · not a sale · check Razorpay`
    : `Payment received, number unknown · ${d.amount} · check Razorpay`;
  const preheader = known
    ? `${d.email || "no email"} · ${d.contact || "no phone"} · dispatch by ${d.arriveBy}`
    : short ? `A payment of ${d.amount}${claimed} was captured. The price is ${d.short.price}, so nothing was marked sold.`
    : "A payment was captured without a usable watch number. Open it in Razorpay.";
  const why = short
    ? `A payment of ${d.amount}${claimed} was captured on your Razorpay account. The price is ${d.short.price}, so it was not recorded as a sale, no number was marked sold, and the payer was not told they own anything. Open it in Razorpay: if it was a mistake, refund it there.`
    : "The payment is real but the worker could not tell which number it was for. Open it in Razorpay, read the notes, and mark the number sold by hand.";
  const wa = waNumber(d.contact);
  const rzp = `https://dashboard.razorpay.com/app/payments/${encodeURIComponent(d.paymentId || "")}`;

  const body = [
    eyebrow(known ? "New order" : "Check this payment"),
    h1(known ? `No. ${n}${d.dial ? " &middot; " + esc(d.dial) : ""}` : short ? "Not the price" : "Number unknown"),
    para(`${esc(d.amount)} paid &middot; ${esc(d.when)}`, { color: C.bone, pad: "0 32px 18px" }),
    known && d.dial ? image(`${site}/assets/email/dial-${esc(String(d.dial).toLowerCase())}.jpg`, `${d.dial} dial`, 150, 236) : "",
    buttons([
      button(rzp, "Open in Razorpay"),
      wa ? button(`https://wa.me/${wa}`, "WhatsApp buyer", { ghost: true }) : ""
    ]),
    card("Buyer", [
      d.buyerName ? ["Name", esc(d.buyerName)] : null,
      ["Email", d.email ? `<a href="mailto:${esc(d.email)}" style="color:${C.goldLit};">${esc(d.email)}</a>` : `<span style="color:${C.faint};">not given</span>`],
      ["Phone", d.contact ? `<a href="tel:${esc(d.contact)}" style="color:${C.goldLit};">${esc(d.contact)}</a>` : `<span style="color:${C.faint};">not given</span>`],
      ["Address", d.address ? addressBlock(d.address) : `<span style="color:${C.mute};">Not given yet. They were asked on the thank-you page, and a second email comes the moment they send it.</span>`]
    ]),
    card("Order", [
      ["Payment", `<a href="${esc(rzp)}" style="color:${C.goldLit};font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(d.paymentId)}</a>`],
      d.orderId ? ["Order", `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(d.orderId)}</span>`] : null,
      ["Gift", d.gift ? giftCard(d.giftNote) : "No"],
      ["Dispatch by", esc(d.arriveBy)],
      ["Edition", `${esc(d.left)} of ${esc(d.edition)} remain`]
    ]),
    known ? steps("To do", [
      [`Inspect and box No. ${n}`, d.gift ? `Gift: write the card by hand${d.giftNote ? " (text above)" : ""}. No price in the box.` : "Check it, close it, box it."],
      [`Dispatch by ${d.arriveBy}`, "Book the courier once the address is in."],
      ["Send tracking", d.email ? `To ${d.email}, the day it leaves.` : "To the buyer, the day it leaves."]
    ]) : para(esc(why), { color: C.bone }),
    para("Reply to this email to write to the buyer directly.", { size: 13, lh: 20, color: C.faint, pad: "0 32px 0" })
  ].join("\n");

  const text = [
    known ? `NEW ORDER · No. ${n}${d.dial ? " · " + d.dial : ""}` : short ? `NOT THE PRICE, NOT A SALE: CHECK RAZORPAY\n${why}` : "PAYMENT RECEIVED, NUMBER UNKNOWN: CHECK RAZORPAY",
    `${d.amount} paid · ${d.when}`, "",
    d.buyerName ? `Buyer: ${d.buyerName}` : null,
    `Buyer email: ${d.email || "not given"}`,
    `Buyer phone: ${d.contact || "not given"}${wa ? ` (WhatsApp: https://wa.me/${wa})` : ""}`,
    d.address ? `Address:\n${addressText(d.address)}` : "Address: not given yet. A second email comes the moment they send it.", "",
    `Payment: ${d.paymentId}`, d.orderId ? `Order: ${d.orderId}` : "",
    d.gift ? `Gift: yes${d.giftNote ? `. Card: "${d.giftNote}"` : ""}. No price in the box.` : "Gift: no",
    `Dispatch by: ${d.arriveBy}`,
    `${d.left} of ${d.edition} remain.`, "",
    `Razorpay: ${rzp}`
  ].filter(x => x !== null).join("\n");

  return { subject, html: frame({ title: subject, preheader, body, site }), text };
}

/* ══════════ 3. TO THE OWNER, WHEN THE ADDRESS ARRIVES ══════════ */
export function ownerShip(d) {
  const n = pad2(d.n), site = d.site, a = d.address;
  const subject = `${d.updated ? "Address changed" : "Ship to"} · No. ${n} · ${a.name}, ${a.city}`;
  const preheader = `${a.city}, ${a.state} ${a.pin} · dispatch by ${d.arriveBy}`;
  const wa = waNumber(a.phone);
  const body = [
    eyebrow(d.updated ? "New delivery address" : "Ready to ship"),
    h1(`No. ${n}${d.dial ? " &middot; " + esc(d.dial) : ""}`),
    para(d.updated ? "The buyer changed where it should go. Use this address, not the earlier one." : "The buyer has told us where it goes.", { pad: "0 32px 18px" }),
    `<tr><td class="px" style="padding:0 32px 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.gold};border-radius:4px;">
<tr><td style="padding:22px 24px;font-family:${SANS};font-size:17px;line-height:27px;color:${C.bone};">${addressBlock(a)}<br><a href="tel:${esc(a.phone)}" style="color:${C.goldLit};">${esc(a.phone)}</a></td></tr></table></td></tr>`,
    buttons([wa ? button(`https://wa.me/${wa}`, "WhatsApp buyer", { ghost: true }) : ""]),
    card("Order", [
      d.paymentId ? ["Payment", `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(d.paymentId)}</span>`] : null,
      ["Order", `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(d.orderId)}</span>`],
      ["Gift", d.gift ? giftCard(d.giftNote) : "No"],
      ["Dispatch by", esc(d.arriveBy)],
      d.buyerEmail ? ["Tracking to", `<a href="mailto:${esc(d.buyerEmail)}" style="color:${C.goldLit};">${esc(d.buyerEmail)}</a>`] : null
    ])
  ].join("\n");
  const text = [
    `${d.updated ? "ADDRESS CHANGED" : "SHIP TO"} · No. ${n}${d.dial ? " · " + d.dial : ""}`, "",
    addressText(a), "",
    `Order: ${d.orderId}${d.paymentId ? `, payment ${d.paymentId}` : ""}`,
    d.gift ? `Gift: yes${d.giftNote ? `. Card: "${d.giftNote}"` : ""}. No price in the box.` : "Gift: no",
    `Dispatch by: ${d.arriveBy}`,
    d.buyerEmail ? `Tracking to: ${d.buyerEmail}` : ""
  ].filter(x => x !== "").join("\n");
  return { subject, html: frame({ title: subject, preheader, body, site }), text };
}

/* ══════════ 4. TO THE BUYER, WHEN THEY GIVE THE ADDRESS ══════════ */
export function buyerShip(d) {
  const n = pad2(d.n), site = d.site, a = d.address;
  const subject = `No. ${n} will come to you here`;
  const preheader = `${a.city}, ${a.state} ${a.pin}. Arrives by ${d.arriveBy}.`;
  const body = [
    image(`${site}/assets/email/caseback-${n}.png`, `Your caseback, engraved: Limited edition No. ${n}`, 160, 160),
    h1(`It will come to you here.`),
    para(`This is the address we have for No. ${n}. If anything in it is wrong, reply to this email before it is dispatched and we will correct it.`),
    `<tr><td class="px" style="padding:0 32px 22px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:4px;">
<tr><td style="padding:22px 24px;font-family:${SANS};font-size:16px;line-height:26px;color:${C.bone};">${addressBlock(a)}<br><span style="color:${C.mute};">${esc(a.phone)}</span></td></tr></table></td></tr>`,
    card("", [
      ["Arrives by", `${esc(d.arriveBy)}<br><span style="color:${C.faint};font-size:13px;">Tracking comes to this email the day it leaves</span>`]
    ], { pad: "0 32px 22px" }),
    para(`Questions? Reply to this email.`, { size: 14, lh: 22, pad: "0 32px 0" })
  ].join("\n");
  const text = [
    `No. ${n} will come to you here:`, "", addressText(a), "",
    `Arrives by ${d.arriveBy}. Tracking comes to this email the day it leaves.`, "",
    "If anything in the address is wrong, reply to this email before it is dispatched and we will correct it.", "",
    `Questions? Reply to this email.`, "", "KAAL · thekaal.co"
  ].join("\n");
  return { subject, html: frame({ title: subject, preheader, body, site }), text };
}

/* ══════════ 4b. TO THE BUYER, THE DAY IT LEAVES ══════════
   Sent from the desk when the owner marks the piece dispatched and ticks
   "email the buyer". The confirmation promised tracking "the day it
   leaves"; this is that promise kept. */
export function buyerDispatched(d) {
  const n = pad2(d.n), site = d.site;
  const subject = `No. ${n} is on its way`;
  const went = d.courier ? `handed to ${d.courier}` : "sent";
  const preheader = `${d.courier ? d.courier + " " : ""}${d.tracking ? "tracking " + d.tracking + ". " : ""}${d.arriveBy ? `Arrives by ${d.arriveBy}.` : ""}`;
  const body = [
    image(`${site}/assets/email/caseback-${n}.png`, `Your caseback, engraved: Limited edition No. ${n}`, 160, 160),
    h1(`No. ${n} is on its way.`),
    para(`It was checked by hand, boxed and ${esc(went)} today.`),
    d.url ? buttons([button(d.url, "Track it")]) : "",
    card("", [
      d.courier ? ["Courier", esc(d.courier)] : null,
      d.tracking ? ["Tracking number", `<span style="font-family:Menlo,Consolas,monospace;font-size:14px;">${esc(d.tracking)}</span>`] : null,
      d.arriveBy ? ["Arrives by", esc(d.arriveBy)] : null,
      d.address ? ["Going to", addressBlock(d.address)] : null
    ], { pad: "0 32px 22px" }),
    para("When it arrives: seven days to decide. If it is not you, send it back unworn and unmarked for a full refund.", { size: 14, lh: 22 }),
    para(`Questions? Reply to this email.`, { size: 14, lh: 22, pad: "0 32px 0" })
  ].join("\n");
  const text = [
    `No. ${n} is on its way.`, "",
    `It was checked by hand, boxed and ${went} today.`, "",
    d.courier ? `Courier: ${d.courier}` : null,
    d.tracking ? `Tracking number: ${d.tracking}` : null,
    d.url ? `Track it: ${d.url}` : null,
    d.arriveBy ? `Arrives by: ${d.arriveBy}` : null,
    d.address ? `Going to:\n${addressText(d.address)}` : null, "",
    "When it arrives: seven days to decide. If it is not you, send it back unworn and unmarked for a full refund.", "",
    `Questions? Reply to this email.`, "", "KAAL · thekaal.co"
  ].filter(x => x !== null).join("\n");
  return { subject, html: frame({ title: subject, preheader, body, site }), text };
}

/* ══════════ 4c. REFUNDS ══════════
   Found by the worker on its own (section 7 there). The buyer's is plain
   and complete: the amount, both references, and when a bank shows it.
   Nothing in it asks them to buy again. */
export function buyerRefund(d) {
  const n = d.n ? pad2(d.n) : "", site = d.site;
  const what = n ? ` for No. ${n}` : "";
  const subject = d.full ? `Your refund${what} has been processed` : `A refund of ${d.amount}${what} has been processed`;
  const preheader = `${d.amount} is on its way back to the account you paid from.`;
  const body = [
    h1("Your refund is on its way."),
    para(`${esc(d.amount)}${esc(what)} has been sent back to the account you paid from. Razorpay processed it on ${esc(d.when)}; most banks show it within 5 to 7 working days.`),
    card("", [
      ["Refunded", esc(d.amount)],
      ["Payment reference", `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(d.paymentId)}</span>`],
      ["Refund reference", `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(d.refundId)}</span>`]
    ], { pad: "0 32px 22px" }),
    para(`If it has not reached you after seven working days, reply to this email with the refund reference. A person answers.`, { size: 14, lh: 22, pad: "0 32px 0" })
  ].join("\n");
  const text = [
    "Your refund is on its way.", "",
    `${d.amount}${what} has been sent back to the account you paid from. Razorpay processed it on ${d.when}; most banks show it within 5 to 7 working days.`, "",
    `Refunded: ${d.amount}`, `Payment reference: ${d.paymentId}`, `Refund reference: ${d.refundId}`, "",
    `If it has not reached you after seven working days, reply to this email with the refund reference. A person answers.`, "",
    "KAAL · thekaal.co"
  ].join("\n");
  return { subject, html: frame({ title: subject, preheader, body, site }), text };
}

/* Two payments reached one number (registry, worker/registry.js). The
   second buyer is refunded in full by the worker, and told so once the
   refund exists. Draft wording: the owner approves it in Phase 3. */
export function buyerDuplicate(d) {
  const n = pad2(d.n), site = d.site;
  const subject = `No. ${n} went a moment before your payment`;
  const preheader = `Your ${d.amount} is refunded in full.`;
  const lines = [
    `Another payment for No. ${n} reached us moments before yours. Each number exists once, so we could not place your order.`,
    `Your payment of ${d.amount} has been refunded in full. Razorpay returns it to the same card or account, usually within five to seven working days.`,
    "We are sorry for the trouble. If anything about this is unclear, reply to this email and a person will answer."
  ];
  const body = [
    h1(`No. ${n} went first.`),
    para(esc(lines[0])),
    para(esc(lines[1])),
    card("", [
      ["Refunded", esc(d.amount)],
      ["Payment reference", `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(d.paymentId)}</span>`],
      ["Refund reference", `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(d.refundId)}</span>`]
    ], { pad: "0 32px 22px" }),
    para(esc(lines[2]), { size: 14, lh: 22, pad: "0 32px 0" })
  ].join("\n");
  const text = [`No. ${n} went first.`, "", lines[0], "", lines[1], "",
    `Refunded: ${d.amount}`, `Payment reference: ${d.paymentId}`, `Refund reference: ${d.refundId}`, "",
    lines[2], "", "KAAL"].join("\n");
  return { subject, html: frame({ title: subject, preheader, body, site }), text };
}

export function ownerDuplicate(d) {
  const n = pad2(d.n), site = d.site;
  const ok = !!d.refundId;
  const subject = ok ? `Two payments for No. ${n} · the second is refunded` : `Two payments for No. ${n} · refund it by hand`;
  const rzp = `https://dashboard.razorpay.com/app/payments/${encodeURIComponent(d.paymentId || "")}`;
  const what = ok
    ? `A second payment reached No. ${n} after it was already placed. The worker refunded it in full (${d.refundId}) and wrote to the buyer. The first order stands; nothing for you to do.`
    : `A second payment reached No. ${n} after it was already placed. The worker could not refund it (${d.error || "Razorpay did not answer"}). Razorpay will send the payment again and the worker will retry, but refund it in Razorpay now to be sure. The first order stands.`;
  const body = [
    eyebrow(ok ? "Duplicate payment, refunded" : "Duplicate payment, not refunded"),
    h1(`No. ${n}`),
    para(esc(what), { pad: "0 32px 18px" }),
    buttons([button(rzp, "Open the payment in Razorpay", { ghost: ok })]),
    card("Second payment", [["Amount", esc(d.amount)], ["Payment", esc(d.paymentId)], ["Buyer", esc(d.email || "not given")]], { pad: "0 32px 22px" })
  ].join("\n");
  const text = [`No. ${n}: ${ok ? "duplicate payment refunded" : "duplicate payment NOT refunded"}`, "", what, "",
    `Amount: ${d.amount}`, `Payment: ${d.paymentId}`, `Buyer: ${d.email || "not given"}`, "", rzp].join("\n");
  return { subject, html: frame({ title: subject, preheader: what.slice(0, 90), body, site }), text };
}

export function ownerRefund(d) {
  const site = d.site, n = d.n ? pad2(d.n) : "";
  const subject = n ? `Refund processed · No. ${n}${d.dial ? " " + d.dial : ""} · ${d.amount}${d.full ? "" : " (part)"}`
                    : `Refund processed · ${d.amount} · number unknown`;
  const next = !d.full ? "A part refund: the order itself stands."
    : !n ? "The worker could not tell which number this payment was for. Check the payment in Razorpay."
    : d.stillSold ? `No. ${n} is still shown as sold. On the desk, put it back on sale or keep it retired.`
    : `No. ${n} is not on the sold list.`;
  const rzp = `https://dashboard.razorpay.com/app/payments/${encodeURIComponent(d.paymentId || "")}`;
  const body = [
    eyebrow(d.full ? "Refund" : "Part refund"),
    h1(n ? `No. ${n}${d.dial ? " &middot; " + esc(d.dial) : ""}` : "Refund"),
    para(`${esc(d.amount)} of ${esc(d.paid)} went back to the buyer &middot; ${esc(d.when)}`, { color: C.bone, pad: "0 32px 18px" }),
    para(esc(next), { pad: "0 32px 14px" }),
    buttons([d.full && n && d.stillSold && d.deskUrl ? button(d.deskUrl, "Open the desk") : "", button(rzp, "Open in Razorpay", { ghost: true })]),
    card("Refund", [
      ["Buyer", d.email ? `<a href="mailto:${esc(d.email)}" style="color:${C.goldLit};">${esc(d.email)}</a>` : `<span style="color:${C.faint};">no email</span>`],
      d.contact ? ["Phone", `<a href="tel:${esc(d.contact)}" style="color:${C.goldLit};">${esc(d.contact)}</a>`] : null,
      ["Payment", `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(d.paymentId)}</span>`],
      ["Refund", `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(d.refundId)}</span>`],
      ["Buyer told", d.buyerTold ? "Yes, by KAAL and by Razorpay" : "By Razorpay"]
    ])
  ].join("\n");
  const text = [
    n ? `REFUND · No. ${n}${d.dial ? " · " + d.dial : ""}` : "REFUND · number unknown",
    `${d.amount} of ${d.paid} went back to the buyer · ${d.when}`, "", next, "",
    `Buyer: ${d.email || "no email"}${d.contact ? " · " + d.contact : ""}`,
    `Payment: ${d.paymentId}`, `Refund: ${d.refundId}`,
    `Buyer told: ${d.buyerTold ? "by KAAL and by Razorpay" : "by Razorpay"}`,
    d.full && n && d.stillSold && d.deskUrl ? `Desk: ${d.deskUrl}` : "",
    `Razorpay: ${rzp}`
  ].filter(x => x !== "").join("\n");
  return { subject, html: frame({ title: subject, preheader: next, body, site }), text };
}

/* ══════════ 4d. BEFORE A PURCHASE: TWO PERSONAL NOTES ══════════
   Sent by the worker on its own (section 3e there), each once per person,
   ever. They are written as a note from a small workshop to one person,
   and built to look like one: no heading, no button, no picture, no card,
   16px system type, left aligned, the link a single underlined line, and a
   plain-text twin with a blank line between paragraphs.

   Nothing in them is a tactic. No discount, no deadline, no "reserved for
   you": the count is the real count, and the scarcity is a fact about the
   edition (twenty, never remade), so it is stated as one. */
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
export const inWords = (n) => WORDS[n] || String(n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const greet = (first) => (first ? `${first},` : "Hello,");
/* "Yesterday" → "yesterday", "On Sunday" → "on Sunday": only the first letter. */
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const isAre = (n) => (n === 1 ? "is" : "are");
const nos = (list) => {
  const a = list.map(x => `No. ${pad2(x)}`);
  return a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
};
/* "three are already on someone's wrist", "one is…", or nothing at all. */
function wornClause(worn) {
  if (!worn) return "";
  return worn === 1 ? "one is already on someone's wrist" : `${inWords(worn)} are already on someone's wrist`;
}

function note({ subject, preheader, site, blocks }) {
  const p = (inner) => `<tr><td class="px" align="left" style="padding:0 32px 18px;font-family:${SANS};font-size:16px;line-height:26px;color:${C.bone};text-align:left;">${inner}</td></tr>`;
  const body = blocks.map(b => typeof b === "string" ? p(esc(b))
    : p(`${esc(b.label)}: <a href="${esc(b.href)}" style="color:${C.goldLit};text-decoration:underline;">${esc(b.href.replace(/^https?:\/\//, ""))}</a>`)).join("\n");
  const text = blocks.map(b => typeof b === "string" ? b : `${b.label}: ${b.href}`).concat(["--", STOP_LINE]).join("\n\n");
  return { subject, html: frame({ title: subject, preheader, body, site, stop: true }), text, headers: MARKETING };
}

const RETURN_LONG = "you have seven days to live with it. If it isn't you, send it back unworn and every rupee comes back.";
const RETURN_SHORT = "Live with it for seven days. If it isn't you, send it back unworn and every rupee comes back. Two years' warranty on the movement. Free delivery across India.";

/* The one email after an unfinished checkout. Three shapes, whichever is
   true when it is sent:
     A  their number is still open (and nobody is paying for it this minute)
     B  their number sold since: the same dial's open numbers, or the rest
     C  no number on the checkout
   d: { site, first, when, n, open, dial, sold (count), left, sameDial } */
export function buyerNearlyBought(d) {
  const site = d.site, worn = Array.isArray(d.sold) ? d.sold.length : (d.sold || 0), left = d.left;
  const leftW = inWords(left), wornC = wornClause(worn);
  const when = lower(d.when || "Recently");
  const No = d.n ? `No. ${pad2(d.n)}` : "";
  const later = `Nobody in the room will recognise the name on this watch, and that is the point.`;

  if (d.n && d.open) {
    return note({ subject: No, preheader: "Still unclaimed.", site, blocks: [
      greet(d.first),
      `You chose ${No} ${when}.${d.dial ? ` The ${d.dial} dial.` : ""} You got as far as checkout and stopped one step short.`,
      "It is still unclaimed. We're writing because that won't stay true on its own.",
      `${No} is one of twenty. Its number is engraved on the back, and there is only one of it. ${cap(leftW)} ${isAre(left)} left${wornC ? "; " + wornC : ""}. We never make a design twice, so once ${No} is claimed there is no other: not in another colour, not in a later batch. One person will own ${No}, permanently.`,
      "Most people buy a watch so a famous name can speak for them. The people who wear KAAL don't need that. Nobody in the room will recognise it, and that is the point. The ones who notice will ask, and you'll be the only person who can answer.",
      `You already chose it once. What stops people at the last step is usually small: a payment that failed, a call, a second thought about a name they don't know. For the last one: ${RETURN_LONG} The movement has a two-year warranty. Delivery is free across India, in its handmade box.`,
      "And owners of Series 01 hear about Series 02 before anyone else.",
      { label: No, href: `${site}/#n${d.n}` },
      "If something went wrong at payment, reply here. A person reads it and will help you finish.",
      "KAAL",
      `P.S. This is the only time we'll write about ${No}. If it's still there when you look, it's yours to take.`
    ] });
  }

  if (d.n) {
    const same = (d.sameDial || []).slice().sort((a, b) => a - b);
    const dialLine = !d.dial ? `Of the twenty, ${leftW} ${isAre(left)} left.`
      : same.length ? `If it was the ${d.dial} dial that held you, ${nos(same)} still ${same.length === 1 ? "carries" : "carry"} it. Of the twenty, ${leftW} ${isAre(left)} left.`
      : `The ${d.dial} dial is now fully claimed. ${cap(leftW)} ${left === 1 ? "piece remains" : "pieces remain"} in the other three.`;
    return note({ subject: No, preheader: "It found its owner.", site, blocks: [
      greet(d.first),
      `${No} is gone. You chose it ${when}, and since then someone else completed it. It's on a wrist now, and it will not be made again.`,
      "That is what twenty means here. When one goes, it goes.",
      dialLine,
      `${later} The people who notice will ask, and you'll be the only person who can answer.`,
      `${RETURN_SHORT} Owners of Series 01 hear about Series 02 first.`,
      d.dial && same.length ? { label: `The ${d.dial} dial`, href: `${site}/#n${same[0]}` } : { label: "What's left", href: `${site}/#twenty` },
      "KAAL",
      "P.S. This is the only time we'll write about it."
    ] });
  }

  return note({ subject: `${cap(leftW)} of twenty`, preheader: "Still open.", site, blocks: [
    greet(d.first),
    `You got as far as checkout at KAAL ${when} and stopped there.`,
    `Of the twenty, ${leftW} ${isAre(left)} left${wornC ? " and " + wornC : ""}. We never make a design twice. When the twenty are gone, this one is retired for good.`,
    `${later} On the back is a number, and the only person who will ever turn it over is you.`,
    `${RETURN_SHORT} Owners of Series 01 hear about Series 02 first.`,
    { label: "Choose yours", href: `${site}/#twenty` },
    "If something went wrong, reply here. A person reads it.",
    "KAAL",
    "P.S. This is the only time we'll write about it."
  ] });
}

/* The same moment for someone who gave a phone and no email. Nothing
   sends this: the desk opens WhatsApp with it typed, and the owner sends
   it by hand (automated WhatsApp needs Meta's paid Business API). Same
   three shapes, same voice. */
export function nearlyWhatsApp(d) {
  const site = d.site, left = d.left, leftW = inWords(left);
  const hello = d.first ? `Hello ${d.first}, this is KAAL.` : "Hello, this is KAAL.";
  const No = d.n ? `No. ${pad2(d.n)}` : "";
  if (d.n && d.open) {
    return `${hello} You chose ${No}${d.dial ? `, the ${d.dial} dial,` : ""} and stopped at payment. It's still unclaimed, ${leftW} of the twenty ${isAre(left)} left, and the design is never made again. If something went wrong at payment, reply here and we'll help you finish: ${site}/#n${d.n}`;
  }
  if (d.n) {
    const same = (d.sameDial || []).slice().sort((a, b) => a - b);
    const dialLine = !d.dial ? "" : same.length ? ` If it was the ${d.dial} dial that held you, ${nos(same)} still ${same.length === 1 ? "carries" : "carry"} it.` : ` The ${d.dial} dial is now fully claimed.`;
    return `${hello} You chose ${No} and stopped at payment. Since then someone else completed it, and it will not be made again.${dialLine} Of the twenty, ${leftW} ${isAre(left)} left: ${d.dial && same.length ? `${site}/#n${same[0]}` : `${site}/#twenty`}`;
  }
  return `${hello} You got as far as checkout and stopped at payment. ${cap(leftW)} of the twenty ${isAre(left)} left, and the design is never made again. If something went wrong at payment, reply here and we'll help you finish: ${site}/#twenty`;
}

/* The Series 02 list was promised one note while Series 01 is open and one
   email when Series 02 is drawn (the consent line under both forms). This
   is the first. d: { site, left } */
export function seriesTwoNote(d) {
  const left = d.left, leftW = inWords(left);
  return note({ subject: "Series 02", preheader: "Not drawn yet. One thing before it is.", site: d.site, blocks: [
    "Hello,",
    "You asked us to write once, when Series 02 is drawn. It isn't yet. We're writing once more now, because what follows can't wait until then.",
    "When Series 02 comes, it will be a different watch: a new case, new dials, new numbers. Owners of Series 01 hear first. Then this list. Then everyone else.",
    `Series 01 will not come back. Not its case, not its dials, not its numbers. Of the twenty, ${leftW} ${isAre(left)} left, and when the last is claimed the design is retired for good.`,
    "So waiting for Series 02 means waiting for a different watch, from the middle of the line. Owning one of these twenty puts you at the front of it, with a piece the rest of the list will never be able to buy.",
    "Nobody in the room will recognise the name, and that is the point. On the back is a number, and the only person who will ever turn it over is you.",
    RETURN_SHORT,
    { label: left === 1 ? "The last one" : `The ${leftW}`, href: `${d.site}/#twenty` },
    "When Series 02 is drawn, you'll hear, as promised. Until then, this is the only email from us.",
    "KAAL"
  ] });
}

/* ══════════ 4e. AFTER A PURCHASE: THREE NOTES TO THE OWNER ══════════
   Their number, their name, the caseback at the top, signed KAAL. No
   offer in any of them. d: { site, n, first, ... } */
function ownerNote({ subject, preheader, site, n, first, paras }) {
  const lines = [greet(first)].concat(paras, ["KAAL"]);
  const body = [image(`${site}/assets/email/caseback-${n}.png`, `The caseback of No. ${n}`, 160, 160)]
    .concat(lines.map(t => para(esc(t), { align: "left", color: C.bone, pad: "0 32px 18px" }))).join("\n");
  return { subject, html: frame({ title: subject, preheader, body, site }), text: lines.join("\n\n") };
}

/* The day, the date and the twenty-four hour hand are set before a piece
   leaves (the registers as movement.html places them), so the note says
   that rather than teaching anyone to set them. */
export function afterArrival(d) {
  const n = pad2(d.n);
  return ownerNote({ subject: `Has No. ${n} arrived?`, preheader: "Set before it left us, and read true on arrival.", site: d.site, n, first: d.first, paras: [
    `We hope No. ${n} arrived well, and that it looks the way it did when it left us.`,
    "We set the day, the date and the twenty-four hour hand before it left us, so it should read true when you open the box: the day at twelve, the date at six, the twenty-four hours at nine.",
    "If anything isn't right, reply here."
  ] });
}

export function afterSettled(d) {
  const n = pad2(d.n);
  return ownerNote({ subject: `No. ${n} is yours for good`, preheader: "The seven days have passed.", site: d.site, n, first: d.first, paras: [
    `The seven days have passed. No. ${n} is yours for good.`,
    `One thing, only if you want it: with your permission, your city and month can sit under No. ${n} on thekaal.co, for example "Delhi · Oct 2026". Reply "yes" to be listed.`,
    `And three short questions, if you have a minute. What is it like to wear No. ${n}, in two or three sentences, the way you'd tell a friend, good or not? Can we publish it with your first name, the first letter of your surname and your city? Would you like a photo beside it, of your face or the watch on your wrist? If you're happy for us to publish your words, end your reply with "Yes, you can publish this". There is no gift for doing so.`
  ] });
}

export function afterYear(d) {
  const n = pad2(d.n);
  return ownerNote({ subject: `One year with No. ${n}`, preheader: "The movement is covered for one more year.", site: d.site, n, first: d.first, paras: [
    `A year ago No. ${n} left us for your wrist. We hope it has kept good time, and that by now it looks like yours.`,
    `The movement warranty runs for one more year, until ${d.until}. If anything in it falters before then, reply here.`,
    "When Series 02 is drawn, owners of Series 01 hear first. You will hear from us then."
  ] });
}

/* ══════════ 5. TO THE OWNER, AT THE END OF EVERY DAY ══════════
   The day in one email: how many came, how far they got, who paid, who
   nearly did, who asked to hear about Series 02, what is left. */
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function dayLabel(day, short) {
  const d = new Date(day + "T12:00:00Z");
  return short ? `${DAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`
               : `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + "s")}`;
const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : "");

/* ── THE WORDS FOR A VISITOR'S STEPS. One place, read by the desk, the
      midnight email and both spreadsheets, so all four say the same
      thing. Plain text: whoever shows it escapes it. ── */
const ACTS = { early: "Which one is yours?", 1: "the idea", 2: "the four faces", 3: "Emerald", 4: "Midnight", 5: "Champagne",
  6: "Ivory", 7: "the craftsmanship", 8: "the box", 9: "the movement", 10: "the seven-day return", 11: "the twenty",
  who: "who it is for", owners: "owners' words" };
const PAGE_NAMES = { home: "the shop", about: "the About page", manifesto: "the manifesto", movement: "the movement page",
  provenance: "Who is selling this", legal: "terms and privacy", claimed: "the thank-you page", "404": "a page that does not exist" };
const SOURCE_NAMES = { instagram: "Instagram", ig: "Instagram", facebook: "Facebook", fb: "Facebook", meta: "a Meta ad", google: "Google",
  "google ads": "a Google ad", bing: "Bing", x: "X", youtube: "YouTube", whatsapp: "WhatsApp", linkedin: "LinkedIn",
  chatgpt: "ChatGPT", perplexity: "Perplexity", duckduckgo: "DuckDuckGo", direct: "a direct visit", "thekaal.co": "thekaal.co" };
const SITES = [[/(^|\.)instagram\.com$/, "Instagram"], [/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$/, "Facebook"],
  [/(^|\.)google\./, "Google"], [/(^|\.)bing\.com$/, "Bing"], [/^(t\.co|x\.com|twitter\.com)$/, "X"], [/(^|\.)youtube\.com$/, "YouTube"],
  [/whatsapp\./, "WhatsApp"], [/(^|\.)linkedin\.com$|^lnkd\.in$/, "LinkedIn"], [/chatgpt\.com$|openai\.com$/, "ChatGPT"],
  [/perplexity\.ai$/, "Perplexity"], [/duckduckgo\.com$/, "DuckDuckGo"]];
/* The in-app browsers send no referrer: the app is the better answer. */
export function sourceName(s, app) {
  if (app && (!s || s === "direct" || s === "meta")) return app;
  if (SOURCE_NAMES[s]) return SOURCE_NAMES[s];
  for (const [re, name] of SITES) if (re.test(s || "")) return name;
  return s || "a direct visit";
}
export function deviceName(os, dev) { return os || ({ computer: "a computer", tablet: "a tablet", phone: "a phone" })[dev] || ""; }
export function stepText(e) {
  const no = e.no ? `No. ${e.no}` : "", dial = e.dial || "";
  switch (e.e) {
    case "visit": {
      const where = deviceName(e.os, e.dev);
      return `Arrived from ${sourceName(e.s, e.app)}${e.c ? " (ad: " + e.c + (e.a ? " / " + e.a : "") + ")" : ""}${where ? " on " + where : ""}${e.g ? ", near " + e.g : ""}${e.x && e.x !== "home" ? ", on " + (PAGE_NAMES[e.x] || e.x) : ""}`;
    }
    case "page": return e.x === "home" ? "Opened the shop again" : `Opened ${PAGE_NAMES[e.x] || e.x}`;
    case "act": return `Read ${ACTS[e.x] || "part of the story"}`;
    case "hero": return "Pressed Choose your number";
    case "hero_complete": return "Watched the film to the end";
    case "film": return "Played the box film";
    case "view": return "Reached the twenty";
    case "dial": case "early_dial": return `Chose the ${dial || "?"} dial`;
    case "number": return `Chose ${no || "a number"}${dial ? " (" + dial + ")" : ""}`;
    case "caseback_view": return `Turned ${no || "the watch"} to its engraved back`;
    case "gift": return "Marked it as a gift";
    case "checkout": return `Pressed buy${no ? " for " + no : ""}`;
    case "details": return `Gave their name, phone and address${no ? " for " + no : ""}`;
    case "details_closed": return "Closed the details form without paying";
    case "pay_closed": return "Closed the payment window without paying";
    case "pay_failed": return `Payment failed${e.x ? ": " + e.x : ""}`;
    case "paid": {
      const paise = parseInt(e.x, 10) || 0;
      return `Paid${paise ? " ₹" + (paise / 100).toLocaleString("en-IN") : ""} for ${no || "a number"}${dial ? " (" + dial + ")" : ""}`;
    }
    case "list": return "Joined the Series 02 list";
    case "deeplink": return `Arrived on a link to ${no || "a number"}`;
    case "provenance_click": return "Opened Who is selling this";
    case "ctx_cta": return `Tapped Choose yours${dial ? " under " + dial : ""}`;
  }
  return String(e.e || "");
}
/* "2:41 pm", in India. */
function clockIn(t) {
  const d = new Date(t + 5.5 * 3600 * 1000), h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 || 12}:${m < 10 ? "0" + m : m} ${h >= 12 ? "pm" : "am"}`;
}
function took(ms) {
  const t = Math.max(0, Math.round(ms / 1000));
  return t < 60 ? `${t}s` : t < 3600 ? `${Math.floor(t / 60)}m` : `${Math.floor(t / 3600)}h ${Math.floor(t % 3600 / 60)}m`;
}
const ORD = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
/* One line about a visitor, for the email and the spreadsheets. */
export function visitorLine(v) {
  return [`Visitor ${v.k}`, v.name, sourceName(v.s, v.app), deviceName(v.os, v.dev),
    v.visitNo ? `${ORD(v.visitNo)} visit` : `${v.visits} ${v.visits === 1 ? "visit" : "visits"}`,
    v.time ? took(v.time) + " on the site" : "", v.paid && v.paid.length ? "paid for No. " + v.paid.join(", No. ") : ""].filter(Boolean).join(" · ");
}

export function ownerDigest(d) {
  const c = d.c || {}, site = d.site;
  const visitors = c.visitor || 0, numbers = c.number || 0, checkouts = c.checkout || 0;
  const orders = d.orders.length, leads = d.leads.length;
  const subject = `KAAL daily · ${dayLabel(d.day, true)} · ${plural(orders, "order")} · ${plural(visitors, "visitor")} · ${plural(leads, "lead")}`;
  const preheader = `${plural(numbers, "number")} chosen, ${plural(checkouts, "checkout")} opened, ${d.left} of ${d.edition} remain.`;
  const money = `₹${(d.revenue / 100).toLocaleString("en-IN")}`;

  const stat = (n, label) => `<td align="center" valign="top" width="50%" style="padding:16px 6px;border:1px solid ${C.line};background:${C.card};">
<div style="font-family:${SERIF};font-size:30px;line-height:34px;color:${C.goldLit};">${esc(n)}</div>
<div style="margin-top:6px;font-family:${SANS};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.faint};">${esc(label)}</div></td>`;
  const stats = `<tr><td class="px" style="padding:6px 32px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${stat(visitors, "Visitors")}${stat(numbers, "Add to cart")}</tr><tr>${stat(orders, "Orders")}${stat(leads, "Leads")}</tr></table></td></tr>`;

  const muted = (t) => t ? ` <span style="color:${C.faint};font-size:13px;">${esc(t)}</span>` : "";
  const funnel = card("How far they got", [
    ["Visitors", `${visitors}`],
    ["Page visits", `${c.visit || 0}`],
    ["Scrolled through the film", `${c.hero_complete || 0}${muted(pct(c.hero_complete || 0, visitors))}`],
    ["Reached the twenty", `${c.view || 0}${muted(pct(c.view || 0, visitors))}`],
    ["Chose a dial", `${(c.dial || 0) + (c.early_dial || 0)}`],
    ["Chose a number", `${numbers}${muted(pct(numbers, visitors))}`],
    ["Opened checkout", `${checkouts}${muted(pct(checkouts, visitors))}`],
    ["Gave their details", `${c.details || 0}${muted(pct(c.details || 0, visitors))}`],
    ["Paid", `${orders}${muted(pct(orders, visitors))}${orders ? `<br><span style="color:${C.mute};">${esc(money)}</span>` : ""}`]
  ]);

  const orderRows = d.orders.map(o => [
    `No. ${o.n ? pad2(o.n) : "??"}${o.dial ? " · " + o.dial : ""}`,
    `${esc(o.amount)} · ${esc(o.at)}<br>${o.email ? `<a href="mailto:${esc(o.email)}" style="color:${C.goldLit};">${esc(o.email)}</a>` : ""}${o.contact ? `<br><a href="tel:${esc(o.contact)}" style="color:${C.goldLit};">${esc(o.contact)}</a>` : ""}
<br><a href="https://dashboard.razorpay.com/app/payments/${encodeURIComponent(o.id)}" style="color:${C.faint};font-size:13px;">Open in Razorpay</a>`
  ]);
  const nearlyRows = d.unfinished.map(u => {
    const wa = waNumber(u.contact);
    return [`No. ${u.n ? pad2(u.n) : "??"}${u.dial ? " · " + u.dial : ""}`,
      `${u.name ? `<b style="font-weight:600;">${esc(u.name)}</b>${u.city ? ` &middot; ${esc(u.city)}` : ""}<br>` : ""}${esc(u.stage)}<br><span style="color:${C.faint};font-size:13px;">${esc(u.at)}</span>${u.email ? `<br><a href="mailto:${esc(u.email)}" style="color:${C.goldLit};">${esc(u.email)}</a>` : ""}${u.contact ? `<br><a href="tel:${esc(u.contact)}" style="color:${C.goldLit};">${esc(u.contact)}</a>` : ""}${wa ? ` · <a href="https://wa.me/${wa}" style="color:${C.goldLit};">WhatsApp</a>` : ""}`];
  });
  const refundRows = (d.refunds || []).map(r => [`No. ${r.n ? pad2(r.n) : "??"}${r.dial ? " · " + r.dial : ""}`,
    `${esc(r.amount)} back to the buyer${r.full ? "" : " (part)"}<br><span style="color:${C.faint};font-size:13px;">${esc(r.at)}</span>`]);
  /* Who visited, and everything each one did that day. Long days are cut
     to the sixty most recent, with the rest on the desk. */
  const VIS_MAX = 60, STEP_MAX = 14;
  const vis = (d.visitors && d.visitors.rows) || [], visTotal = (d.visitors && d.visitors.total) || vis.length;
  const visShown = vis.slice(-VIS_MAX).reverse();
  const visitorRows = visShown.map(v => {
    const st = v.today.filter(e => e.e !== "early_dial"), more = st.length - STEP_MAX;
    const head = `<b style="font-weight:600;">${esc(visitorLine(v).replace(/^Visitor \d+ · /, ""))}</b>` +
      (v.phone || v.email ? `<br>${v.phone ? `<a href="tel:${esc(v.phone)}" style="color:${C.goldLit};">${esc(v.phone)}</a>` : ""}${v.phone && v.email ? " · " : ""}${v.email ? `<a href="mailto:${esc(v.email)}" style="color:${C.goldLit};">${esc(v.email)}</a>` : ""}` : "");
    const list = st.slice(0, STEP_MAX).map(e => `<span style="color:${C.faint};">${esc(clockIn(e.t))}</span> ${esc(stepText(e))}`).join("<br>");
    return [`Visitor ${v.k}`, `<div style="text-align:left;">${head}<div style="margin-top:6px;font-size:13px;line-height:20px;color:${C.mute};">${list}${more > 0 ? `<br><span style="color:${C.faint};">and ${more} more steps on the desk</span>` : ""}</div></div>`];
  });
  const leadRows = d.leads.map(l => [esc(l.source || "Series 02"), `<a href="mailto:${esc(l.email)}" style="color:${C.goldLit};">${esc(l.email)}</a><br><span style="color:${C.faint};font-size:13px;">${esc(l.at)}</span>`]);
  /* The emails the worker sent by itself that day (section 3e), by kind. */
  const fu = d.followUps || {};
  const autoRows = [["Nearly bought", fu.nearly || 0], ["Series 02 note", fu.s02 || 0], ["Arrival note", fu.after1 || 0],
    ["Seven-day note", fu.after2 || 0], ["One-year note", fu.after3 || 0]];
  const autoTotal = autoRows.reduce((t, [, n]) => t + n, 0);
  const others = [
    ["Pressed Choose your number", c.hero || 0], ["Picked a dial early", c.early_dial || 0], ["Followed a dial link", c.ctx_cta || 0],
    ["Saw their caseback", c.caseback_view || 0], ["Added the gift card", c.gift || 0], ["Played the box film", c.film || 0],
    ["Checked who is selling", c.provenance_click || 0], ["Opened a shared number", c.deeplink || 0]
  ].filter(([, n]) => n).map(([k, n]) => [k, String(n)]);

  const th = (t, al) => `<td align="${al || "right"}" style="padding:10px 8px;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${C.faint};">${t}</td>`;
  const td = (t, al, hi) => `<td align="${al || "right"}" style="white-space:nowrap;padding:9px 8px;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:14px;color:${hi ? C.bone : C.mute};">${t}</td>`;
  const trend = `<tr><td class="px" style="padding:6px 32px 22px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:4px;">
<tr><td colspan="5" style="padding:20px 16px 8px;font-family:${SERIF};font-size:21px;color:${C.bone};">The last seven days</td></tr>
<tr>${th("Day", "left")}${th("Visitors")}${th("Cart")}${th("Checkout")}${th("Orders")}</tr>
${d.trend.map(t => `<tr>${td(esc(dayLabel(t.day, true).replace(/ [A-Z][a-z]{2}$/, "")), "left", t.day === d.day)}${td(t.visitors, "right", t.day === d.day)}${td(t.numbers, "right", t.day === d.day)}${td(t.checkouts, "right", t.day === d.day)}${td(t.orders, "right", t.day === d.day)}</tr>`).join("")}
<tr><td colspan="5" style="padding:0 0 10px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>`;

  const notes = [
    !d.counting ? "Visitor counts begin the day after the counter is switched on." : "",
    !d.razorpay ? "Orders and checkouts need the Razorpay keys on the worker." : ""
  ].filter(Boolean);

  /* What needs the owner, from the same list the desk shows. */
  const alerts = (d.alerts || []).filter(a => a.level === "act");
  const needs = alerts.length ? `<tr><td class="px" style="padding:0 32px 22px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.gold};border-radius:4px;">
<tr><td style="padding:20px 24px 4px;font-family:${SERIF};font-size:21px;color:${C.goldLit};">Needs you</td></tr>
${alerts.map(a => `<tr><td style="padding:10px 24px;border-top:1px solid ${C.line};font-family:${SANS};font-size:15px;line-height:22px;color:${C.bone};">${esc(a.title)}${a.detail ? `<br><span style="color:${C.mute};font-size:13px;">${esc(a.detail)}</span>` : ""}</td></tr>`).join("")}
<tr><td style="padding:0 0 10px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>` : "";

  const body = [
    eyebrow("Daily report"),
    h1(esc(dayLabel(d.day))),
    para(`${d.left} of ${d.edition} remain${d.sold.length ? ` · sold: ${d.sold.map(pad2).join(", ")}` : ""}`, { color: C.bone, pad: "0 32px 18px" }),
    needs,
    stats,
    funnel,
    d.orders.length ? card(plural(orders, "order"), orderRows) : "",
    d.unfinished.length ? card("Nearly bought", nearlyRows) : "",
    refundRows.length ? card(plural(refundRows.length, "refund"), refundRows) : "",
    d.leads.length ? card(`${plural(leads, "new lead")} for Series 02`, leadRows) : "",
    autoTotal ? card("Emails sent on their own", autoRows.map(([k, n]) => [k, String(n)])) : "",
    others.length ? card("Other moments", others) : "",
    visitorRows.length ? card(`Who visited (${visTotal})`, visitorRows) : "",
    visTotal > visShown.length ? para(`The ${visShown.length} most recent are here; all ${visTotal}, with every step, are on the desk under Visitors.`, { size: 13, lh: 20, color: C.faint, pad: "0 32px 18px" }) : "",
    trend,
    buttons([d.deskUrl ? button(d.deskUrl, "Open the desk") : "", button(`https://dashboard.razorpay.com/app/payments`, "Open Razorpay", { ghost: true })]),
    para(["Visitors are counted once per browser per day, without cookies; orders and checkouts come from Razorpay."].concat(notes).map(esc).join("<br>"), { size: 12, lh: 19, color: C.faint, pad: "0 32px 0" })
  ].join("\n");

  const text = [
    `KAAL DAILY · ${dayLabel(d.day)}`,
    `${d.left} of ${d.edition} remain${d.sold.length ? ` · sold: ${d.sold.map(pad2).join(", ")}` : ""}`, "",
    alerts.length ? "NEEDS YOU\n" + alerts.map(a => `${a.title}${a.detail ? ` (${a.detail})` : ""}`).join("\n") + "\n" : "",
    `Visitors: ${visitors} · Page visits: ${c.visit || 0}`,
    `Scrolled through the film: ${c.hero_complete || 0}`,
    `Reached the twenty: ${c.view || 0}`,
    `Chose a dial: ${(c.dial || 0) + (c.early_dial || 0)}`,
    `Chose a number (add to cart): ${numbers}`,
    `Opened checkout: ${checkouts}`,
    `Gave their details: ${c.details || 0}`,
    `Paid: ${orders}${orders ? ` (${money})` : ""}`, "",
    d.orders.length ? "ORDERS\n" + d.orders.map(o => `No. ${o.n ? pad2(o.n) : "??"}${o.dial ? " " + o.dial : ""} · ${o.amount} · ${o.at} · ${o.email || "no email"} · ${o.contact || "no phone"} · ${o.id}`).join("\n") + "\n" : "",
    d.unfinished.length ? "NEARLY BOUGHT\n" + d.unfinished.map(u => `No. ${u.n ? pad2(u.n) : "??"}${u.name ? " · " + u.name : ""}${u.city ? " · " + u.city : ""} · ${u.stage} · ${u.at} · ${u.email || "no email"} · ${u.contact || "no phone"}`).join("\n") + "\n" : "",
    (d.refunds || []).length ? "REFUNDS\n" + d.refunds.map(r => `No. ${r.n ? pad2(r.n) : "??"}${r.dial ? " " + r.dial : ""} · ${r.amount}${r.full ? "" : " (part)"} · ${r.at}`).join("\n") + "\n" : "",
    autoTotal ? "EMAILS SENT ON THEIR OWN\n" + autoRows.map(([k, n]) => `${k}: ${n}`).join("\n") + "\n" : "",
    d.leads.length ? "NEW LEADS (SERIES 02)\n" + d.leads.map(l => `${l.email} · ${l.source || "Series 02"} · ${l.at}`).join("\n") + "\n" : "",
    visShown.length ? `WHO VISITED (${visTotal})\n` + visShown.map(v => visitorLine(v) + (v.phone ? " · " + v.phone : "") + (v.email ? " · " + v.email : "") + "\n  " +
      v.today.filter(e => e.e !== "early_dial").slice(0, STEP_MAX).map(e => `${clockIn(e.t)} ${stepText(e)}`).join(" > ")).join("\n") + "\n" : "",
    "LAST SEVEN DAYS (visitors / cart / checkout / orders)",
    ...d.trend.map(t => `${dayLabel(t.day, true)}: ${t.visitors} / ${t.numbers} / ${t.checkouts} / ${t.orders}`), "",
    d.deskUrl ? `Desk: ${d.deskUrl}` : "",
    ...notes
  ].filter(x => x !== "").join("\n");

  return { subject, html: frame({ title: subject, preheader, body, site }), text };
}

export const SUPPORT = { PHONE, PHONE_TEL, PHONE_WA };
