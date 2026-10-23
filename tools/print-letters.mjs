#!/usr/bin/env node
/* Writes docs/ownership-emails.md: every letter the registry sends, as its
   subject and plain text, read straight from worker/letters.js, so the page
   the owner approves is never a copy that has drifted.
     node tools/print-letters.mjs */
import { writeFileSync } from "node:fs";
import { LETTERS, STAFF_LETTERS, sample } from "../worker/letters.js";

const WHEN = {
  placed: "The moment a payment is verified (automatic). Replaces the earlier confirmation.",
  inspected: "You tap Inspected (ten seconds to Undo).",
  packed: "You tap Packed.",
  dispatched: "You tap Dispatched, or Shiprocket reports the pickup.",
  outForDelivery: "Shiprocket reports out for delivery. Once.",
  delivered: "You tap Delivered, or Shiprocket reports it. Also when you or the owner ask for the link again.",
  reminder: "72 hours after delivery, if the owner has not registered. Once, never again.",
  registered: "The owner registers.",
  addressNeeded: "A payment arrives with no delivery address. Once.",
  claimReceived: "An owner raises a warranty claim.",
  claimApproved: "You approve a claim (with the pickup details you type).",
  moreInfo: "You ask the owner for more on a claim (with your question).",
  claimDeclined: "You decline a claim (with your reason). Offers the paid service.",
  serviceReturned: "You mark a claim serviced.",
  transferStarted: "An owner starts a transfer. The code is never in the email.",
  transferInvite: "An owner starts a transfer and gives the buyer's email (optional).",
  transferComplete: "A transfer is approved (to the seller and to the buyer; two wordings).",
  transferRejected: "You reject a transfer.",
  stolenConfirmed: "You confirm a stolen report.",
  stolenCleared: "You clear a stolen flag.",
  accessReset: "You verify a locked-out owner and move their sign-in. (The brief's \"passcode reset\": there are no passcodes here, only emailed codes.)",
  recoveryDeclined: "You decline a recovery request (with your reason).",
  returnProcessed: "A return is processed and refunded."
};
const site = "https://thekaal.co";
const out = ["# The registry's emails, for your approval", "",
  "Every email the ownership system sends to an owner, exactly as it will read. Placed, Inspected, Packed, Dispatched, Delivered, the reminder and Registered are the brief's own words and are fixed. All the others are in the same voice and are mine to propose: change any line you like and tell Claude. Nothing is sent to anyone until the action that triggers it.",
  "", "Generated from `worker/letters.js` by `tools/print-letters.mjs`.", ""];
const order = ["placed", "inspected", "packed", "dispatched", "outForDelivery", "delivered", "reminder", "registered", "addressNeeded",
  "claimReceived", "claimApproved", "moreInfo", "claimDeclined", "serviceReturned", "transferStarted", "transferInvite", "transferComplete", "transferRejected", "stolenConfirmed", "stolenCleared", "accessReset", "recoveryDeclined", "returnProcessed"];
for (const k of order) {
  if (!LETTERS[k]) continue;
  const m = k === "transferComplete" ? null : sample(k, site);
  const variants = k === "transferComplete" ? [["To the owner passing it on", LETTERS[k]({ site, n: 7, size: 20, role: "from", ownerNo: 1, fromYear: "2026", toYear: "2029" })], ["To the new owner", LETTERS[k]({ site, n: 7, size: 20, role: "to", ownerNo: 2, warrantyEnd: "23:59 on 24 October 2028" })]] : [["", m]];
  out.push(`## ${k}`, "", `**When:** ${WHEN[k] || ""}`, "");
  for (const [who, v] of variants) {
    if (who) out.push(`**${who}**`, "");
    out.push(`Subject: ${v.subject}`, "", "```", v.text.trim(), "```", "");
  }
}
out.push("## For you only (never to an owner)", "");
out.push(STAFF_LETTERS.map(k => `- \`${k}\`: ${sample(k, site).subject}`).join("\n"), "");
writeFileSync(new URL("../docs/ownership-emails.md", import.meta.url), out.join("\n"));
console.log("docs/ownership-emails.md written");
