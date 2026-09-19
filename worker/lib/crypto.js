/* ══════════════════════════════════════════════════════════════════
   IS THIS REALLY RAZORPAY.

   Two functions, and the second one is the reason this is its own file
   rather than three lines inside a handler: it is the single easiest
   thing in the whole codebase to "simplify" into a bug.
   ══════════════════════════════════════════════════════════════════ */

export async function verifySignature(body, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, String(signatureHeader).trim().toLowerCase());
}

/* `a === b` on a string returns as soon as two characters differ, so the
   time it takes leaks how much of a guess was right. That is the textbook
   way to be walked character by character towards a valid signature. This
   always reads both strings to the end.

   Do not replace this with ===. Do not add an early return for a length
   mismatch. The length difference is folded into the accumulator on the
   first line precisely so that it does not need one. */
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
