-- ════════════════════════════════════════════════════════════════════
-- KAAL registry, migration 0003: what the control room (/control) needs.
--
--   settings            the owner's switches, one row each
--   owners.totp_last_step   the authenticator step last accepted, so the
--                           same code can never be used twice
--   sessions.totp_failures  wrong authenticator codes on this session;
--                           five ends it
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO settings (key, value) VALUES
  ('transfers_need_approval', '1'),              -- the brief: default ON
  ('stage_emails', '1'),                         -- every stage change emails the buyer
  ('sender_name', 'KAAL'),
  ('warranty_terms', '');                        -- published only once rain coverage is decided

ALTER TABLE owners ADD COLUMN totp_last_step INTEGER;
ALTER TABLE sessions ADD COLUMN totp_failures INTEGER NOT NULL DEFAULT 0;
