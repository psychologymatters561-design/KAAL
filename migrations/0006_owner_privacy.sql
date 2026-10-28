-- ════════════════════════════════════════════════════════════════════
-- Migration 0006: an owner may let the shop show their initials.
--
-- On the shop, a sold number opens a small card about the piece and who
-- holds it. By default it says "a private collector". Only an owner who
-- ticked the box (unticked by default, at registration or later on their
-- own page) is shown by initials, and only ever masked: "A•••• D••••",
-- never the name itself. The moment they untick it, the card forgets.
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE owners ADD COLUMN show_name_publicly INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN name_consent_at TEXT;
