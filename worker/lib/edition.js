/* ══════════════════════════════════════════════════════════════════
   THE EDITION'S RULES. Nothing in this file knows that KV, GitHub or
   Razorpay exist.

   That is the whole point of it. Everything here is a function from
   values to values: give it the text of index.html and a number and it
   tells you what is true. No fetch, no env, no globals, no clock.

   Which means the rules that decide whether ₹5,999 becomes a sale can
   be tested by calling them, and the day one of them is wrong it is
   wrong in a place you can read in thirty seconds rather than inside a
   handler that also does four other things.

   THE SOURCE OF TRUTH IS index.html ITSELF, deliberately. `edition` and
   `price` are the owner's decisions and they live where the owner edits
   them. A worker holding its own copy of a commercial value is a copy
   that will one day disagree, silently, on the exact day it matters.
   ══════════════════════════════════════════════════════════════════ */

export const SOLD_PATTERN = /sold:\s*\[([^\]]*)\]/;

export function parseEdition(pageSource) {
  const m = pageSource.match(/edition:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 20;
}

/* In rupees, as the page writes it. NaN when the page cannot be read —
   never a default, because a default here is a guess about money. */
export function parsePrice(pageSource) {
  const m = pageSource.match(/price:\s*"([\d,]+)"/);
  if (!m) return NaN;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return n > 0 ? n : NaN;
}

export function parseSold(pageSource) {
  const m = pageSource.match(SOLD_PATTERN);
  if (!m) return null;                      /* null means "the shape of the file changed", not "nothing sold" */
  return m[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
}

export function isInEdition(n, edition) {
  return Number.isInteger(n) && n >= 1 && n <= edition;
}

/* Returns the whole file back with one number added, or says why not.
   A function rather than a replacement string: String.replace interprets
   $& and $1 in a replacement, and "today the input is integers" is a
   property of the caller, not of this line. */
export function withNumberSold(pageSource, n) {
  const current = parseSold(pageSource);
  if (current === null) return { status: "no-sold-array" };
  if (current.indexOf(n) > -1) return { status: "already", sold: current };
  const updated = current.concat([n]).sort((a, b) => a - b);
  return {
    status: "ok",
    sold: updated,
    source: pageSource.replace(SOLD_PATTERN, () => `sold:     [${updated.join(", ")}]`)
  };
}

/* ── THE MONEY CHECK ─────────────────────────────────────────────

   A Razorpay webhook fires for EVERY payment on the account, and
   `kaal_no` is a field the buyer fills in. Without this, one cheap
   payment on any link on the account marks a watch sold; twenty of them
   close the shop for twenty rupees.

   `want` is the page's price in paise. MIN_AMOUNT_PAISE turns the exact
   match into a floor, for the day a coupon is real. AMOUNT_CHECK=off is
   the pre-audit behaviour and exists only so that turning it off is a
   deliberate act with a name — tools/check.mjs fails the build if it is
   ever committed that way. */
export function verifyAmount(entity, pageSource, env = {}) {
  if (String(env.AMOUNT_CHECK || "").toLowerCase() === "off") return { ok: true };

  const currency = String((entity && entity.currency) || "");
  const got = Number(entity && entity.amount);
  const wantCurrency = String(env.CURRENCY || "INR").toUpperCase();
  if (currency.toUpperCase() !== wantCurrency) return { ok: false, got, want: null, currency };

  let want = parseInt(env.MIN_AMOUNT_PAISE || "", 10);
  if (!Number.isFinite(want) || want <= 0) {
    const rupees = parsePrice(pageSource);
    /* No price to compare against is not permission to skip the check.
       An unverifiable payment is exactly the one worth stopping on. */
    if (!Number.isFinite(rupees)) return { ok: false, got, want: null, currency };
    want = rupees * 100;
  }

  if (!Number.isFinite(got) || got < want) return { ok: false, got, want, currency };
  return { ok: true };
}

/* ── RAZORPAY'S WIRE FORMAT, AND NOTHING ELSE ABOUT RAZORPAY ───── */

export function entityOf(event) {
  const p = (event && event.payload) || {};
  const holder = p.payment || p.refund || p.dispute || {};
  return holder.entity || {};
}

/* One place decides what an event means, so a handler never has to
   pattern-match on a string it half remembers. */
export function classifyEvent(event) {
  const name = String((event && event.event) || "");
  if (name.startsWith("refund.") || name.startsWith("payment.dispute")) return { kind: "reversal", name };
  if (name === "payment.captured") return { kind: "captured", name };
  return { kind: "ignored", name };
}

export function chosenNumber(entity) {
  const raw = (entity && entity.notes && entity.notes.kaal_no);
  return { raw, n: parseInt(raw, 10) };
}
