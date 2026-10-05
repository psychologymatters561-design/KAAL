/* ══════════════════════════════════════════════════════════════════
   KAAL · THE FOUR EMAILS

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
export function arriveBy(from) {
  const d = new Date((from || new Date()).getTime() + 5.5 * 3600 * 1000);
  let k = 0;
  while (k < 5) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0) k++; }
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

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

export const SUPPORT = { PHONE, PHONE_TEL, PHONE_WA };
