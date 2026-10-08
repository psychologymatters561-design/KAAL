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

/* ── THE FRAME every message sits in. */
function frame({ title, preheader, body, site }) {
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
  KAAL &middot; Series 01 &middot; twenty watches, never drawn again<br>
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
function addressBlock(a) {
  return [a.name, a.line1, a.line2, `${a.city}, ${a.state} ${a.pin}`].filter(Boolean).map(esc).join("<br>");
}
function addressText(a) {
  return [a.name, a.line1, a.line2, `${a.city}, ${a.state} ${a.pin}`, `Phone ${a.phone}`].filter(Boolean).join("\n");
}
const giftCard = (note) => note ? `Handwritten card, no price in the box.<br><span style="color:${C.mute};">&ldquo;${esc(note)}&rdquo;</span>` : "Handwritten card, no price in the box.";

/* ══════════ 1. TO THE BUYER, THE MOMENT THEY PAY ══════════ */
export function buyerConfirmation(d) {
  const n = pad2(d.n), site = d.site;
  const subject = `No. ${n} is yours`;
  const preheader = `${d.amount} received. Here is your order, and the day it reaches you.`;
  const body = [
    image(`${site}/assets/email/caseback-${n}.png`, `Your caseback, engraved: Limited edition No. ${n}`, 240, 240),
    h1(`No. ${n} is yours.`),
    para(`Your payment of ${esc(d.amount)} has been received. No. ${n} is now set aside for you alone, and no one else will ever wear it.`),
    d.hasAddress
      ? para(`We have your delivery address. Nothing more is needed from you.`, { pad: "0 32px 22px", color: C.bone })
      : para(`One thing is left: tell us where to send it.`, { pad: "0 32px 14px", color: C.bone }),
    d.hasAddress ? "" : buttons([button(d.shipUrl, "Add delivery address")]),
    card("Your order", [
      ["Watch", `No. ${n}${d.dial ? " &middot; " + esc(d.dial) : ""}`],
      ["Paid", esc(d.amount)],
      ["Payment reference", `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(d.paymentId)}</span>`],
      ["Ordered", esc(d.when)],
      ["Arrives by", `${esc(d.arriveBy)}<br><span style="color:${C.faint};font-size:13px;">Free delivery, anywhere in India</span>`],
      d.gift ? ["Gift", giftCard(d.giftNote)] : null
    ]),
    steps("What happens next", [
      ["Today", `No. ${n} is opened, checked and closed again by hand. Nothing ships unseen.`],
      ["Within five working days", "It is boxed and dispatched. Tracking comes to this email the day it leaves."],
      ["At your door", "Seven days to decide. If it is not you, send it back unworn and unmarked for a full refund."]
    ]),
    para(`Questions before it arrives? Reply to this email, or call or WhatsApp <a href="tel:${PHONE_TEL}" style="color:${C.goldLit};">${PHONE}</a>. A person answers.`, { size: 14, lh: 22 }),
    para(`Keep this email. Your payment reference finds your order fastest.`, { size: 13, lh: 20, color: C.faint, pad: "0 32px 0" })
  ].join("\n");

  const text = [
    `No. ${n} is yours.`, "",
    `Your payment of ${d.amount} has been received. No. ${n} is now set aside for you alone.`, "",
    d.hasAddress ? "We have your delivery address. Nothing more is needed from you." : `One thing is left: tell us where to send it.\n${d.shipUrl}`, "",
    "YOUR ORDER",
    `Watch: No. ${n}${d.dial ? " · " + d.dial : ""}`,
    `Paid: ${d.amount}`,
    `Payment reference: ${d.paymentId}`,
    `Ordered: ${d.when}`,
    `Arrives by: ${d.arriveBy} (free delivery, anywhere in India)`,
    d.gift ? `Gift: handwritten card, no price in the box${d.giftNote ? `. Card: "${d.giftNote}"` : ""}` : "", "",
    "WHAT HAPPENS NEXT",
    `1. Today: No. ${n} is opened, checked and closed again by hand.`,
    "2. Within five working days: it is boxed and dispatched. Tracking comes to this email the day it leaves.",
    "3. At your door: seven days to decide. If it is not you, send it back unworn and unmarked for a full refund.", "",
    `Questions? Reply to this email, or call or WhatsApp ${PHONE}. A person answers.`, "",
    "KAAL · thekaal.co"
  ].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");

  return { subject, html: frame({ title: subject, preheader, body, site }), text };
}

/* ══════════ 2. TO THE OWNER, AT THE SAME MOMENT ══════════ */
export function ownerSale(d) {
  const site = d.site, known = d.n >= 1;
  const n = known ? pad2(d.n) : "??";
  const subject = known
    ? `New order · No. ${n}${d.dial ? " " + d.dial : ""} · ${d.amount}`
    : `Payment received, number unknown · ${d.amount} · check Razorpay`;
  const preheader = known
    ? `${d.email || "no email"} · ${d.contact || "no phone"} · dispatch by ${d.arriveBy}`
    : "A payment was captured without a usable watch number. Open it in Razorpay.";
  const wa = waNumber(d.contact);
  const rzp = `https://dashboard.razorpay.com/app/payments/${encodeURIComponent(d.paymentId || "")}`;

  const body = [
    eyebrow(known ? "New order" : "Check this payment"),
    h1(known ? `No. ${n}${d.dial ? " &middot; " + esc(d.dial) : ""}` : "Number unknown"),
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
    ]) : para("The payment is real but the worker could not tell which number it was for. Open it in Razorpay, read the notes, and mark the number sold by hand.", { color: C.bone }),
    para("Reply to this email to write to the buyer directly.", { size: 13, lh: 20, color: C.faint, pad: "0 32px 0" })
  ].join("\n");

  const text = [
    known ? `NEW ORDER · No. ${n}${d.dial ? " · " + d.dial : ""}` : "PAYMENT RECEIVED, NUMBER UNKNOWN: CHECK RAZORPAY",
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
    para(`Questions? Reply to this email, or call or WhatsApp <a href="tel:${PHONE_TEL}" style="color:${C.goldLit};">${PHONE}</a>.`, { size: 14, lh: 22, pad: "0 32px 0" })
  ].join("\n");
  const text = [
    `No. ${n} will come to you here:`, "", addressText(a), "",
    `Arrives by ${d.arriveBy}. Tracking comes to this email the day it leaves.`, "",
    "If anything in the address is wrong, reply to this email before it is dispatched and we will correct it.", "",
    `Questions? Call or WhatsApp ${PHONE}.`, "", "KAAL · thekaal.co"
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
    para(`Questions? Reply to this email, or call or WhatsApp <a href="tel:${PHONE_TEL}" style="color:${C.goldLit};">${PHONE}</a>.`, { size: 14, lh: 22, pad: "0 32px 0" })
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
    `Questions? Reply to this email, or call or WhatsApp ${PHONE}.`, "", "KAAL · thekaal.co"
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
    para(`If it has not reached you after seven working days, reply to this email with the refund reference, or call or WhatsApp <a href="tel:${PHONE_TEL}" style="color:${C.goldLit};">${PHONE}</a>. A person answers.`, { size: 14, lh: 22, pad: "0 32px 0" })
  ].join("\n");
  const text = [
    "Your refund is on its way.", "",
    `${d.amount}${what} has been sent back to the account you paid from. Razorpay processed it on ${d.when}; most banks show it within 5 to 7 working days.`, "",
    `Refunded: ${d.amount}`, `Payment reference: ${d.paymentId}`, `Refund reference: ${d.refundId}`, "",
    `If it has not reached you after seven working days, reply to this email with the refund reference, or call or WhatsApp ${PHONE}. A person answers.`, "",
    "KAAL · thekaal.co"
  ].join("\n");
  return { subject, html: frame({ title: subject, preheader, body, site }), text };
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
  const leadRows = d.leads.map(l => [esc(l.source || "Series 02"), `<a href="mailto:${esc(l.email)}" style="color:${C.goldLit};">${esc(l.email)}</a><br><span style="color:${C.faint};font-size:13px;">${esc(l.at)}</span>`]);
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
    others.length ? card("Other moments", others) : "",
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
    d.leads.length ? "NEW LEADS (SERIES 02)\n" + d.leads.map(l => `${l.email} · ${l.source || "Series 02"} · ${l.at}`).join("\n") + "\n" : "",
    "LAST SEVEN DAYS (visitors / cart / checkout / orders)",
    ...d.trend.map(t => `${dayLabel(t.day, true)}: ${t.visitors} / ${t.numbers} / ${t.checkouts} / ${t.orders}`), "",
    d.deskUrl ? `Desk: ${d.deskUrl}` : "",
    ...notes
  ].filter(x => x !== "").join("\n");

  return { subject, html: frame({ title: subject, preheader, body, site }), text };
}

export const SUPPORT = { PHONE, PHONE_TEL, PHONE_WA };
