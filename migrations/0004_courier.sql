-- ════════════════════════════════════════════════════════════════════
-- Migration 0004: what the courier told us, once each.
--
-- Shiprocket (and any courier after it) posts a tracking event to the
-- worker. dedupe_key is awb|status|timestamp, so the same event delivered
-- twice, or replayed by the courier, is recognised and does nothing: a
-- stage email never goes twice. outcome says what the worker did with it.
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE courier_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key   TEXT NOT NULL UNIQUE,
  awb          TEXT,
  status       TEXT,
  order_id     INTEGER REFERENCES orders(id),
  outcome      TEXT,                                    -- dispatched | delivered | heads-up | alert | unmatched | ignored
  received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX courier_events_order ON courier_events(order_id);
