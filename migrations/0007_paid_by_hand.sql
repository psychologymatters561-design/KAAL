-- ════════════════════════════════════════════════════════════════════
-- Migration 0007: how a payment taken outside the checkout was made.
--
-- The command centre's Mark as paid records a sale the owner was paid
-- for by hand: UPI, a bank transfer, cash, a card machine, a Razorpay
-- payment link. The order is kept like any other (its payment id starts
-- "manual:"); these three say how it was paid, the reference the owner
-- was given (a UPI or bank reference), and a private note. All empty for
-- a payment made through the checkout.
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE orders ADD COLUMN paid_via TEXT;
ALTER TABLE orders ADD COLUMN paid_ref TEXT;
ALTER TABLE orders ADD COLUMN paid_note TEXT;
