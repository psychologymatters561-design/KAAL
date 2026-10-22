-- ════════════════════════════════════════════════════════════════════
-- KAAL registry, migration 0001: the whole data model.
--
-- Cloudflare D1 (SQLite). Applied with:
--   wrangler d1 migrations apply DB --env staging --remote
-- (tools/setup-email.mjs --staging does it for you).
--
-- No browser ever queries this database. Every read and write goes through
-- the worker, which is the only thing holding the binding, so there is no
-- anonymous key to leak and nothing for row-level security to guard. The
-- one public read is the view public_registry at the bottom: safe columns
-- only, never a name, email, phone or street.
--
-- Every record that belongs to a watch carries `series`, so Series 02 is
-- rows, not a migration. People (owners, sessions, codes) and the shop's
-- own logs are not a series' records, and carry it only where it helps.
--
-- Times are ISO 8601 in UTC ("2026-10-22T08:55:00.000Z"), except:
--   pieces.held_until   epoch milliseconds, compared against "now" a lot
--   orders.delivered_on a calendar date in India, "2026-10-24", because
--                       the warranty starts at 00:00 IST that day
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE series (
  code             TEXT PRIMARY KEY,                     -- 'S01'
  name             TEXT NOT NULL,                        -- 'Series 01'
  size             INTEGER NOT NULL CHECK (size > 0),
  price_paise      INTEGER NOT NULL CHECK (price_paise >= 100),
  currency         TEXT NOT NULL DEFAULT 'INR',
  warranty_months  INTEGER NOT NULL DEFAULT 24,
  return_days      INTEGER NOT NULL DEFAULT 7,
  manufactured     TEXT,                                 -- 'September 2026'
  retired_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One watch. `status` is the piece's own state; the order says where in
-- the delivery it is. 'withheld' is a piece the owner keeps off sale for
-- now (No. 09): not sold, not offered, never shown as sold.
CREATE TABLE pieces (
  id          TEXT PRIMARY KEY,                          -- 'S01-07'
  series      TEXT NOT NULL REFERENCES series(code),
  number      INTEGER NOT NULL CHECK (number > 0),
  colorway    TEXT NOT NULL,
  photo_url   TEXT,
  status      TEXT NOT NULL DEFAULT 'available' CHECK (status IN
                ('available','held','placed','delivered','registered','returned','reported_stolen','retired','withheld')),
  held_by     TEXT,                                      -- the device token that holds it
  held_until  INTEGER,                                   -- ms; a hold past this is no hold
  order_ref   INTEGER,                                   -- orders.id of the order it belongs to
  notes       TEXT,                                      -- private, the owner's only
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (series, number)
);

-- One paid order. A row exists only once Razorpay has captured the money
-- (the webhook writes it), so there is no "pending". The payment id is the
-- idempotency key: a webhook delivered twice finds its row already there.
-- A second payment for a piece that already went is kept too, as
-- 'cancelled' with cancel_reason 'duplicate', and refunded.
CREATE TABLE orders (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  series                 TEXT NOT NULL REFERENCES series(code),
  piece_id               TEXT NOT NULL REFERENCES pieces(id),
  razorpay_order_id      TEXT,
  razorpay_payment_id    TEXT NOT NULL UNIQUE,
  buyer_name             TEXT,
  email                  TEXT,
  phone                  TEXT,
  address_line1          TEXT,
  address_line2          TEXT,
  city                   TEXT,
  state                  TEXT,
  pincode                TEXT,
  gift                   INTEGER NOT NULL DEFAULT 0,
  gift_note              TEXT,
  amount_paise           INTEGER NOT NULL,
  currency               TEXT NOT NULL DEFAULT 'INR',
  status                 TEXT NOT NULL DEFAULT 'placed' CHECK (status IN
                           ('placed','inspected','packed','dispatched','delivered','registered','returned','cancelled')),
  cancel_reason          TEXT,                           -- 'duplicate' | 'refund' | free text
  courier                TEXT,
  tracking_number        TEXT,
  tracking_url           TEXT,
  paid_at                TEXT NOT NULL,
  inspected_at           TEXT,
  packed_at              TEXT,
  dispatched_at          TEXT,
  delivered_on           TEXT,                           -- 'YYYY-MM-DD', India
  return_window_ends_at  TEXT,
  registered_at          TEXT,
  refund_requested_at    TEXT,                           -- claimed before the refund call, so only one is ever made
  refund_id              TEXT,
  refunded_at            TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX orders_rzp_order ON orders(razorpay_order_id);
CREATE INDEX orders_piece     ON orders(piece_id);
CREATE INDEX orders_email     ON orders(email);
CREATE INDEX orders_status    ON orders(status);

-- One person. Signs in with a code emailed to `email` (no password is ever
-- stored). show_city_publicly is off until they tick it.
CREATE TABLE owners (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  email                TEXT NOT NULL UNIQUE,             -- lower case
  name                 TEXT,
  phone                TEXT,
  city                 TEXT,
  state                TEXT,
  show_city_publicly   INTEGER NOT NULL DEFAULT 0,
  role                 TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin')),
  data_consent_at      TEXT,
  city_consent_at      TEXT,
  totp_secret_enc      TEXT,                             -- admin only, encrypted with a worker secret
  totp_confirmed_at    TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at           TEXT
);

-- One owner's holding of one piece. owner_no 1 is Owner I. At most one is
-- open (to_at NULL) per piece at any moment.
CREATE TABLE ownerships (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  series        TEXT NOT NULL REFERENCES series(code),
  piece_id      TEXT NOT NULL REFERENCES pieces(id),
  owner_id      INTEGER NOT NULL REFERENCES owners(id),
  owner_no      INTEGER NOT NULL CHECK (owner_no > 0),
  from_at       TEXT NOT NULL,
  to_at         TEXT,
  acquired_via  TEXT NOT NULL CHECK (acquired_via IN ('purchase','transfer','gift','inheritance')),
  order_id      INTEGER REFERENCES orders(id),
  UNIQUE (piece_id, owner_no)
);
CREATE UNIQUE INDEX ownerships_one_open ON ownerships(piece_id) WHERE to_at IS NULL;
CREATE INDEX ownerships_owner ON ownerships(owner_id);

-- One registration link. Only the hash of the token is kept.
CREATE TABLE claim_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  series      TEXT NOT NULL REFERENCES series(code),
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  piece_id    TEXT NOT NULL REFERENCES pieces(id),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE transfer_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  series          TEXT NOT NULL REFERENCES series(code),
  piece_id        TEXT NOT NULL REFERENCES pieces(id),
  from_owner      INTEGER NOT NULL REFERENCES owners(id),
  code_hash       TEXT NOT NULL UNIQUE,
  expires_at      TEXT NOT NULL,
  to_owner        INTEGER REFERENCES owners(id),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','approved','rejected','cancelled','expired')),
  admin_decision  TEXT,
  decided_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX transfers_piece ON transfer_requests(piece_id);

-- A warranty claim, a stolen report, a recovery request, a contact change.
CREATE TABLE requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  series       TEXT NOT NULL REFERENCES series(code),
  piece_id     TEXT NOT NULL REFERENCES pieces(id),
  owner_id     INTEGER REFERENCES owners(id),            -- NULL for a recovery from someone who cannot sign in
  type         TEXT NOT NULL CHECK (type IN ('warranty','stolen','recovery','contact','service')),
  description  TEXT,
  media        TEXT,                                     -- JSON array of private R2 keys
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','info_needed','approved','declined','closed')),
  admin_notes  TEXT,
  decision     TEXT,
  decided_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX requests_open ON requests(status, type);

CREATE TABLE service_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  series       TEXT NOT NULL REFERENCES series(code),
  piece_id     TEXT NOT NULL REFERENCES pieces(id),
  date         TEXT NOT NULL,                            -- 'YYYY-MM-DD'
  work_done    TEXT NOT NULL,                            -- private
  public_line  TEXT,                                     -- shown in the registry, if set
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Every email the system sends, queued first. A failed send never blocks
-- the change that caused it; it is retried with backoff and shown in admin.
-- dedupe_key makes "this stage's email for this order" exist at most once.
CREATE TABLE email_outbox (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  series           TEXT,
  template         TEXT NOT NULL,
  to_email         TEXT NOT NULL,
  subject          TEXT NOT NULL,
  payload          TEXT NOT NULL DEFAULT '{}',           -- JSON: the variables, never a rendered secret
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','cancelled')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_error       TEXT,
  provider_id      TEXT,
  sent_at          TEXT,
  dedupe_key       TEXT UNIQUE,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX outbox_due ON email_outbox(status, next_attempt_at);

-- Every admin action, and every action the system takes on money
-- (a duplicate refund): who, what, when, before and after.
CREATE TABLE audit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor   TEXT NOT NULL,                                 -- 'admin:<owner id>' | 'system:webhook' | 'system:cron'
  action  TEXT NOT NULL,
  target  TEXT,
  before  TEXT,                                          -- JSON
  after   TEXT,                                          -- JSON
  series  TEXT
);
CREATE INDEX audit_at ON audit_log(at);

-- Never sold to again (a returner, by the shop's own rule). Checked at
-- checkout against the buyer's email and phone; refused in neutral words.
CREATE TABLE blocked_buyers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT,                                      -- lower case
  phone       TEXT,                                      -- digits, with 91
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE INDEX blocked_email ON blocked_buyers(email);
CREATE INDEX blocked_phone ON blocked_buyers(phone);

-- Sign-in by emailed code. Only a hash of the code; a few tries each.
CREATE TABLE login_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX login_codes_email ON login_codes(email, created_at);

-- A signed-in device. `id` is the hash of the cookie's token, never the token.
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  owner_id    INTEGER NOT NULL REFERENCES owners(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  mfa_at      TEXT,                                      -- admin: when the TOTP code was given
  revoked_at  TEXT,
  user_agent  TEXT
);
CREATE INDEX sessions_owner ON sessions(owner_id);

-- ── The one public read ─────────────────────────────────────────────────
-- What the registry and the shop may show about each number: its state in
-- one word, its owner's place in the chain and since when, and a city only
-- when that owner ticked the box. A hold counts only while it is live.
CREATE VIEW public_registry AS
SELECT
  p.series                     AS series,
  s.name                       AS series_name,
  s.size                       AS series_size,
  p.number                     AS number,
  p.colorway                   AS colorway,
  p.photo_url                  AS photo_url,
  CASE
    WHEN p.status = 'reported_stolen'                          THEN 'stolen'
    WHEN p.status IN ('placed','delivered','registered')       THEN 'sold'
    WHEN p.status = 'held'
     AND p.held_until > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) THEN 'held'
    WHEN p.status IN ('available','held')                      THEN 'available'
    WHEN p.status = 'retired'                                  THEN 'retired'
    ELSE 'unavailable'                                         -- withheld, returned (being inspected)
  END                          AS state,
  o.owner_no                   AS owner_no,
  substr(o.from_at, 1, 7)      AS owner_since,               -- 'YYYY-MM'
  CASE WHEN w.show_city_publicly = 1 THEN w.city END AS owner_city
FROM pieces p
JOIN series s ON s.code = p.series
LEFT JOIN ownerships o ON o.piece_id = p.id AND o.to_at IS NULL
LEFT JOIN owners w ON w.id = o.owner_id AND w.deleted_at IS NULL;
