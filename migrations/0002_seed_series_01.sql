-- ════════════════════════════════════════════════════════════════════
-- KAAL registry, migration 0002: Series 01 and its twenty pieces.
--
-- The colourways are the site's own names, in the blocks the edition was
-- made in (KAAL.dials in index.html, DIALS in wrangler.toml): Emerald
-- 01-06, Midnight 07-10, Champagne 11-14, Ivory 15-20.
--
-- Every piece starts available except No. 09, which the owner keeps off
-- sale for now (the owner's own test order of 2 October). The sales already made
-- (01, 02, 07, 10) are entered with their real orders and delivery dates
-- when production is switched on, never assumed here; until then the
-- worker also refuses every number the live site already marks sold.
-- ════════════════════════════════════════════════════════════════════

INSERT INTO series (code, name, size, price_paise, currency, warranty_months, return_days, manufactured)
VALUES ('S01', 'Series 01', 20, 599900, 'INR', 24, 7, 'September 2026');

INSERT INTO pieces (id, series, number, colorway, status, notes) VALUES
  ('S01-01', 'S01',  1, 'Emerald',   'available', NULL),
  ('S01-02', 'S01',  2, 'Emerald',   'available', NULL),
  ('S01-03', 'S01',  3, 'Emerald',   'available', NULL),
  ('S01-04', 'S01',  4, 'Emerald',   'available', NULL),
  ('S01-05', 'S01',  5, 'Emerald',   'available', NULL),
  ('S01-06', 'S01',  6, 'Emerald',   'available', NULL),
  ('S01-07', 'S01',  7, 'Midnight',  'available', NULL),
  ('S01-08', 'S01',  8, 'Midnight',  'available', NULL),
  ('S01-09', 'S01',  9, 'Midnight',  'withheld',  'Owner''s own test order, 2 Oct 2026. Kept off sale until the owner releases it.'),
  ('S01-10', 'S01', 10, 'Midnight',  'available', NULL),
  ('S01-11', 'S01', 11, 'Champagne', 'available', NULL),
  ('S01-12', 'S01', 12, 'Champagne', 'available', NULL),
  ('S01-13', 'S01', 13, 'Champagne', 'available', NULL),
  ('S01-14', 'S01', 14, 'Champagne', 'available', NULL),
  ('S01-15', 'S01', 15, 'Ivory',     'available', NULL),
  ('S01-16', 'S01', 16, 'Ivory',     'available', NULL),
  ('S01-17', 'S01', 17, 'Ivory',     'available', NULL),
  ('S01-18', 'S01', 18, 'Ivory',     'available', NULL),
  ('S01-19', 'S01', 19, 'Ivory',     'available', NULL),
  ('S01-20', 'S01', 20, 'Ivory',     'available', NULL);
