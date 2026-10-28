/* ══════════════════════════════════════════════════════════════════
   THE NEARLY-BOUGHT NOTE, WRITTEN FOR ONE PERSON.

   Someone chose a number, reached checkout and stopped. The worker sends
   them one note, once, ever (section 3e). Since Oct 2026, when the
   ANTHROPIC_API_KEY secret is set, Claude writes the middle of that note
   for that one person: from what is true now (is their number still open,
   which others carry the same dial, how many are left) and from how they
   came to it (a first visit or their fourth, the dial they kept returning
   to, a payment that failed, a gift), so the reason it gives is theirs.

   The offer is the truth, said well: the exact piece is unclaimed, there
   is one of it and never another, seven days to live with it and every
   rupee back, two years on the movement, free delivery, a person who
   answers if paying went wrong. Nothing else is offered, ever: no
   discount, no deadline, no "held for you".

   Every draft is checked here, line by line, before it can be sent: the
   words the house never uses, every number it states (only the true
   ones), no links, no dashes, the length. A draft that fails, a refusal,
   a timeout or an error all mean the standard note goes instead, exactly
   as before. The greeting, the link, the offer of help, the signature and
   the P.S. are fixed in mail.js (writtenNote) and never written by Claude.

   Raw HTTP, like every other service this worker calls (Razorpay, Resend,
   GitHub): the worker has no dependencies and no build step.
   ══════════════════════════════════════════════════════════════════ */

export const WRITER_MODEL = "claude-opus-5-5";
const API = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 40000;

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["subject", "preheader", "paragraphs", "button", "angle", "why"],
  properties: {
    subject: { type: "string", description: "Under 45 characters. Usually just the number, e.g. No. 07, or a few plain words." },
    preheader: { type: "string", description: "Under 60 characters. The line an inbox shows after the subject." },
    paragraphs: { type: "array", items: { type: "string" }, description: "Two to four short paragraphs, each under 70 words. No greeting, no sign-off, no P.S., no links." },
    button: { type: "string", description: "The words before the one link, two to five words, e.g. Take No. 07." },
    angle: { type: "string", enum: ["still_open", "payment_help", "same_dial", "returning", "gift", "first_look"],
      description: "The one reason this note leads with." },
    why: { type: "string", description: "One sentence for the shop owner: why this angle, for this person." }
  }
};

const SYSTEM = `You write one short email for KAAL, a watch house in India, to one person who chose a watch, reached checkout and stopped. It is the only email they will ever get about it.

What KAAL is (only these facts; never add others):
- Series 01: twenty numbered watches. One case design, four dials: Emerald, Midnight, Champagne, Ivory. Each number is engraved on one caseback, once. When the twenty are gone the design is retired and never made again.
- Japanese Seiko Epson five hand quartz movement. Made in India, finished by hand. Day ring, twenty four hour counter, pointer date. Mineral glass, two tone stainless steel bracelet, gold tone bezel, water resistant.
- Price: ₹5,999, delivery across India included, in a handmade box.
- Seven days to live with it: if it is not for them, they send it back unworn and every rupee comes back.
- Two years' warranty on the movement, from delivery.
- Each owner is written into the KAAL registry with their place in the watch's line (Owner I, Owner II...). Owners of Series 01 hear about Series 02 first.
- Kaal means time, and only time.

The voice: a small workshop writing to one person. Plain words, short sentences, calm and certain, warm but never eager. It reads like a note, not marketing. Indian English spelling (colour, jewellery).

The offer is the truth said well. Lead with the one reason that fits this person (the angle), using the facts you are given: whether their number is still open, which other numbers carry the same dial, how many are left, how they came to it. If a payment failed, lead with help finishing it.

Never write:
- a discount, coupon, offer, deal, sale, percentage, free gift, or any price other than ₹5,999;
- urgency that is not a stated fact: no deadlines, "today only", "hurry", "last chance", "act now", "don't miss", "before it's gone", "held for you", "reserved for you";
- anything about religion, gods, Mahakaal or Shiva;
- a founder, a person's name from KAAL, reviews, celebrities, awards, "Swiss", luxury clichés, or any material or feature not listed above;
- that we watched them: never mention pages, the film, time on site, visits, devices or where they came from. Their history is for choosing the angle only. You may mention what they chose themselves: the number, the dial, that it was a gift;
- a greeting, a sign-off, a P.S., a link or a web address (all added separately);
- dashes of any kind between words, exclamation marks, emoji, or ALL CAPS;
- any number that is not in the facts you are given.

Counts: say how many are left only as the facts give it. One of twenty, four dials, seven days, two years and ₹5,999 are always true.`;

/* What Claude is told: the true state, and a summary of how they came to it. */
export function factsFor(d) {
  const f = {
    first_name: d.first || null,
    checked_out: d.when,
    how_it_ended: d.stage || "Closed checkout before paying",
    their_number: d.n ? `No. ${pad(d.n)}` : null,
    their_dial: d.dial || null,
    their_number_is_still_open: d.n ? !!d.open : null,
    same_dial_numbers_still_open: (d.sameDial || []).map(n => `No. ${pad(n)}`),
    left_of_twenty: d.left,
    already_worn: d.sold || 0,
    was_a_gift: !!d.gift
  };
  const h = d.history;
  if (h) f.how_they_came_to_it = {
    visits: h.visits, came_back_on_another_day: !!h.returned,
    numbers_they_looked_at: h.numbers, dials_they_looked_at: h.dials, turned_it_over_to_the_engraving: !!h.caseback,
    watched_the_film_to_the_end: !!h.film, read_the_story: !!h.story, minutes_on_the_site: h.minutes
  };
  return f;
}

/* The numbers a note may state, and nothing else. */
function allowedNumbers(d) {
  const a = new Set(["20", "7", "2", "24", "4", "5,999", "5999", "01", "02", "1"]);
  const add = (n) => { if (n || n === 0) { a.add(String(n)); a.add(pad(n)); } };
  add(d.n); (d.sameDial || []).forEach(add); add(d.left); add(d.sold || 0);
  return a;
}
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const NEVER = /\b(discount|coupon|promo|voucher|offer code|deal|sale|cashback|cheap|bargain|lowest|hurry|act now|today only|last chance|limited time|limited period|expire|expires|expiring|deadline|countdown|don'?t miss|before it'?s gone|reserved for you|held for you|holding it|we('| a)re holding|just for you|exclusive offer|free gift|mahakaal|shiva|god|gods|divine|blessed|sacred|holy|swiss|founder|ceo|review|reviews|rated|award|celebrity|guaranteed|percent)\b|%|—|–|!|https?:|www\.|\.com\b|\.co\b|@/i;
const WATCHED = /\b(we (saw|noticed|see)|you (watched|spent|visited|browsed|came from|clicked|viewed)|your visit|times? on|minutes on|our film|the film)\b/i;

/* Everything wrong with a draft, in plain words; empty when it may go. */
export function check(w, d) {
  const bad = [];
  if (!w || typeof w !== "object") return ["no draft"];
  const parts = [w.subject, w.preheader, w.button].concat(Array.isArray(w.paragraphs) ? w.paragraphs : []);
  if (parts.some(x => typeof x !== "string")) return ["a part is missing"];
  if (w.subject.length < 3 || w.subject.length > 60) bad.push("subject length");
  if (w.preheader.length > 90) bad.push("preheader length");
  if (w.button.length < 2 || w.button.length > 40) bad.push("button length");
  if (w.paragraphs.length < 1 || w.paragraphs.length > 4) bad.push("paragraph count");
  if (w.paragraphs.some(p => p.length < 12 || p.length > 520)) bad.push("paragraph length");
  const all = parts.join("\n");
  const never = all.match(NEVER);
  if (never) bad.push(`uses "${never[0]}"`);
  if (WATCHED.test(all)) bad.push("mentions what we saw of their visit");
  if (/\p{Extended_Pictographic}/u.test(all)) bad.push("emoji");
  if (/\b[A-Z]{4,}\b/.test(all.replace(/\bKAAL\b/g, ""))) bad.push("capitals");
  if (/^(hi|hello|dear|hey)\b/i.test(w.paragraphs[0] || "")) bad.push("greets (the greeting is added)");
  if (/\b(regards|sincerely|warmly|yours|p\.s\.)\b/i.test(w.paragraphs[w.paragraphs.length - 1] || "")) bad.push("signs off (the signature is added)");
  /* Every number it states must be a true one. */
  const ok = allowedNumbers(d);
  for (const m of all.matchAll(/₹?\s?(\d[\d,]*)/g)) if (!ok.has(m[1].replace(/,$/, ""))) bad.push(`states ${m[1]}`);
  for (const m of all.matchAll(/\bNo\.\s?(\d{1,2})\b/gi)) {
    const n = parseInt(m[1], 10);
    if (n !== d.n && (d.sameDial || []).indexOf(n) < 0) bad.push(`names No. ${m[1]}`);
  }
  if (d.n && !d.open && new RegExp(`No\\.\\s?0?${d.n}\\b[^.]*\\b(still|open|unclaimed|yours|available)\\b`, "i").test(all)) bad.push("says a sold number is open");
  const counts = new Set(["one", "two", "four", "seven", "twenty", WORDS[d.left], WORDS[d.sold || 0]]);
  for (const m of all.toLowerCase().matchAll(/\b(three|five|six|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/g))
    if (!counts.has(m[1])) bad.push(`states ${m[1]}`);
  return [...new Set(bad)];
}

/* One call. { ok, draft, usage } or { ok:false, why }, and never throws. */
export async function writeNote(env, d) {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, why: "no key" };
  let res, j;
  try {
    res = await fetch(API, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2026-10-21",
        /* A declined request is retried on the model Anthropic recommends for it. */
        "anthropic-beta": "server-side-fallback-2026-07-01"
      },
      body: JSON.stringify({
        model: env.WRITER_MODEL || WRITER_MODEL,
        max_tokens: 8000,
        fallbacks: "default",
        system: SYSTEM,
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content: "Write the note. The facts, as JSON:\n" + JSON.stringify(factsFor(d), null, 2) }]
      })
    });
    j = await res.json().catch(() => null);
  } catch (e) { return { ok: false, why: e && e.name === "TimeoutError" ? "timed out" : "unreachable" }; }
  if (!res.ok) {
    const t = j && j.error && j.error.type;
    return { ok: false, why: `HTTP ${res.status}${t ? " " + t : ""}`, retry: res.status === 429 || res.status >= 500 };
  }
  if (!j || j.stop_reason === "refusal") return { ok: false, why: "declined" };
  if (j.stop_reason === "max_tokens") return { ok: false, why: "ran out of room" };
  const block = (j.content || []).filter(b => b.type === "text").pop();
  let draft;
  try { draft = JSON.parse(block ? block.text : ""); } catch (e) { return { ok: false, why: "not JSON" }; }
  const problems = check(draft, d);
  if (problems.length) return { ok: false, why: "failed the check: " + problems.slice(0, 4).join("; "), draft };
  return { ok: true, draft, model: j.model, usage: j.usage || null };
}

function pad(n) { n = parseInt(n, 10) || 0; return n < 10 ? "0" + n : String(n); }
