/* ══════════════════════════════════════════════════════════════════
   The rules, tested by calling them.

   Every test here is a plain function call with no worker, no request,
   no KV and no network — which is the entire argument for lib/edition.js
   being its own file. The suite next door needs a fake GitHub and a fake
   KV to ask "is a one-rupee payment refused". This one asks the same
   question in one line, and it is the line that would actually be wrong.
   ══════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseEdition, parsePrice, parseSold, isInEdition,
  withNumberSold, verifyAmount, entityOf, classifyEvent, chosenNumber
} from "../../worker/lib/edition.js";

const page = (over = {}) => `
  var KAAL = {
    checkout: "",
    price:    "${over.price ?? "5,999"}",
    edition:  ${over.edition ?? 20},
    sold:     [${over.sold ?? "1, 2"}]
  };`;

test("the edition and the price are read from the page", () => {
  assert.equal(parseEdition(page()), 20);
  assert.equal(parseEdition(page({ edition: 8 })), 8);
  assert.equal(parsePrice(page()), 5999);
  assert.equal(parsePrice(page({ price: "12,500" })), 12500);
});

test("an unreadable price is NaN, never a default", () => {
  assert.ok(Number.isNaN(parsePrice("price: nothing")));
  assert.ok(Number.isNaN(parsePrice(page({ price: "0" }))));
});

test("a missing sold array is null, which is not an empty edition", () => {
  assert.deepEqual(parseSold(page()), [1, 2]);
  assert.equal(parseSold("no config here"), null);
  assert.deepEqual(parseSold(page({ sold: "" })), []);
});

test("only whole numbers inside the edition count", () => {
  for (const n of [1, 20]) assert.equal(isInEdition(n, 20), true);
  for (const n of [0, 21, -1, 1.5, NaN, "7", null, undefined]) assert.equal(isInEdition(n, 20), false, String(n));
});

test("selling a number adds exactly one, sorted, and rewrites nothing else", () => {
  const before = page();
  const after = withNumberSold(before, 7);
  assert.equal(after.status, "ok");
  assert.deepEqual(after.sold, [1, 2, 7]);
  assert.match(after.source, /sold:\s+\[1, 2, 7\]/);
  assert.equal(after.source.replace(/sold:\s+\[[^\]]*\]/, "X"), before.replace(/sold:\s+\[[^\]]*\]/, "X"),
    "everything that is not the sold array must come out byte-identical");
});

test("selling a number twice is reported, not duplicated", () => {
  assert.equal(withNumberSold(page(), 1).status, "already");
});

test("a replacement containing $ patterns cannot be interpreted", () => {
  /* String.replace expands $& and $1 in a replacement string. The sold
     array is integers today; this proves it is not relying on that. */
  const src = page({ sold: "1, 2" }) + "\n// $& $1 $` tail";
  assert.match(withNumberSold(src, 7).source, /\/\/ \$& \$1 \$` tail$/);
});

test("a page whose shape changed is refused rather than guessed at", () => {
  assert.equal(withNumberSold("nothing that looks like a config", 7).status, "no-sold-array");
});

/* ── The money. Four lines that decide whether the edition can be
      bought for twenty rupees. ─────────────────────────────────── */

const entity = (over = {}) => Object.assign({ amount: 599900, currency: "INR" }, over);

test("the exact listed price passes", () => {
  assert.equal(verifyAmount(entity(), page(), {}).ok, true);
});

test("anything less than the listed price fails", () => {
  for (const amount of [100, 599899, 0, -1]) {
    const r = verifyAmount(entity({ amount }), page(), {});
    assert.equal(r.ok, false, `₹${amount / 100} must not buy a watch`);
    assert.equal(r.want, 599900);
  }
});

test("more than the listed price passes — overpaying is not an attack", () => {
  assert.equal(verifyAmount(entity({ amount: 700000 }), page(), {}).ok, true);
});

test("the right number in the wrong currency fails", () => {
  for (const currency of ["USD", "inr ", "", null])
    assert.equal(verifyAmount(entity({ currency }), page(), {}).ok, currency === null ? false : currency.trim() === "INR" ? true : false);
});

test("a missing or nonsense amount fails", () => {
  for (const amount of [undefined, null, "lots", NaN])
    assert.equal(verifyAmount(entity({ amount }), page(), {}).ok, false, String(amount));
});

test("a page with no readable price fails closed", () => {
  const r = verifyAmount(entity(), "price: whoops", {});
  assert.equal(r.ok, false);
  assert.equal(r.want, null, "an unverifiable payment is exactly the one worth stopping on");
});

test("MIN_AMOUNT_PAISE overrides the page, in both directions", () => {
  assert.equal(verifyAmount(entity({ amount: 100000 }), page(), { MIN_AMOUNT_PAISE: "100000" }).ok, true);
  assert.equal(verifyAmount(entity({ amount: 599900 }), page(), { MIN_AMOUNT_PAISE: "999900" }).ok, false);
});

test("AMOUNT_CHECK=off is the only way past, and it takes saying so", () => {
  assert.equal(verifyAmount(entity({ amount: 1 }), page(), { AMOUNT_CHECK: "off" }).ok, true);
  assert.equal(verifyAmount(entity({ amount: 1 }), page(), { AMOUNT_CHECK: "OFF" }).ok, true);
  for (const v of ["", "false", "0", "no", undefined])
    assert.equal(verifyAmount(entity({ amount: 1 }), page(), { AMOUNT_CHECK: v }).ok, false,
      `"${v}" must not read as off`);
});

/* ── Razorpay's wire format ──────────────────────────────────── */

test("the entity is found wherever Razorpay puts it", () => {
  assert.equal(entityOf({ payload: { payment: { entity: { id: "pay_1" } } } }).id, "pay_1");
  assert.equal(entityOf({ payload: { refund:  { entity: { id: "rfnd_1" } } } }).id, "rfnd_1");
  assert.equal(entityOf({ payload: { dispute: { entity: { id: "disp_1" } } } }).id, "disp_1");
  assert.deepEqual(entityOf({}), {});
  assert.deepEqual(entityOf(null), {});
});

test("events are classified into the three things this shop does", () => {
  assert.equal(classifyEvent({ event: "payment.captured" }).kind, "captured");
  for (const e of ["refund.processed", "refund.created", "payment.dispute.created", "payment.dispute.won"])
    assert.equal(classifyEvent({ event: e }).kind, "reversal", e);
  for (const e of ["payment.authorized", "order.paid", "", undefined])
    assert.equal(classifyEvent({ event: e }).kind, "ignored", String(e));
});

test("the chosen number survives a buyer typing into the field", () => {
  assert.equal(chosenNumber({ notes: { kaal_no: "7" } }).n, 7);
  assert.equal(chosenNumber({ notes: { kaal_no: " 07 " } }).n, 7);
  for (const v of ["banana", "", undefined, null])
    assert.ok(Number.isNaN(chosenNumber({ notes: { kaal_no: v } }).n), String(v));
  assert.ok(Number.isNaN(chosenNumber({}).n));
});
