/* ══════════════════════════════════════════════════════════════════
   SIGNING IN (registry, Phase 2): a code by email. For the admin, a
   second code from an authenticator app (TOTP, RFC 6238) is available but
   OFF unless ADMIN_2FA is "on": the emailed code alone is the lock, so the
   admin's mailbox is the key to guard.

   No password is stored anywhere, because none exists. A sign-in is:
     1. POST /auth/start  {email}        a six-digit code is emailed, if
                                         that address belongs to an owner
                                         or the admin; the answer is the
                                         same either way
     2. POST /auth/verify {email, code}  the code, once, within ten
                                         minutes, at most five tries
     3. (admin, only if ADMIN_2FA is "on")
        POST /auth/totp {code}           the authenticator's code; the
                                         first time, /auth/totp/enroll
                                         hands over the secret to add

   What is kept: the code's keyed hash (HMAC with AUTH_SECRET), never the
   code; the session's SHA-256, never the token, which lives only in an
   HttpOnly, Secure, SameSite=Strict cookie; the TOTP secret encrypted
   with AES-GCM under a key derived from AUTH_SECRET, and the last time
   step used, so a code cannot be replayed.

   Same dialect as the worker: plain functions, WebCrypto, no library.
   ══════════════════════════════════════════════════════════════════ */

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_TRIES = 5;
const CODES_PER_WINDOW = 3, CODE_WINDOW_MS = 15 * 60 * 1000;
const OWNER_SESSION_MS = 30 * 86400 * 1000;
const ADMIN_SESSION_MS = 12 * 3600 * 1000;
const TOTP_FAILS = 5;

/* The authenticator is asked for only when ADMIN_2FA is "on". */
export const twoFactorOn = (env) => String((env && env.ADMIN_2FA) || "off").toLowerCase() === "on";
export const COOKIE = "kaal_s";

const enc = new TextEncoder();
const iso = (ms) => new Date(ms === undefined ? Date.now() : ms).toISOString();
export const normEmail = (v) => String(v || "").trim().toLowerCase().slice(0, 254);
const validEmail = (v) => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(v);

export const authOn = (env) => !!(env && env.DB && String(env.AUTH_SECRET || "").length >= 32);
export function adminEmail(env) {
  return normEmail(env.ADMIN_EMAIL || String(env.OWNER_EMAIL || "connect@thekaal.co").split(",")[0]);
}

const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
async function sha256(text) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(text))); }
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}
function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
function randomDigits(n) {
  /* Rejection sampling, so every code is equally likely. */
  let out = "";
  while (out.length < n) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    for (const x of b) if (x < 250 && out.length < n) out += String(x % 10);
  }
  return out;
}
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* ── 1. The emailed code ──
   Returns { send: {to, code} } when a code should go out (the caller
   sends it, through the worker's own mail path), or { send: null }. The
   caller answers the browser identically in both cases. */
export async function startLogin(env, email) {
  const e = normEmail(email);
  if (!validEmail(e)) return { send: null, reason: "invalid" };
  const known = e === adminEmail(env) ||
    !!(await env.DB.prepare("SELECT 1 AS x FROM owners WHERE email = ?1 AND deleted_at IS NULL").bind(e).first());
  if (!known) return { send: null, reason: "unknown" };
  const recent = await env.DB.prepare("SELECT COUNT(*) AS c FROM login_codes WHERE email = ?1 AND created_at > ?2")
    .bind(e, iso(Date.now() - CODE_WINDOW_MS)).first();
  if (recent && recent.c >= CODES_PER_WINDOW) return { send: null, reason: "rate" };
  const code = randomDigits(6);
  await env.DB.prepare("INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?1, ?2, ?3)")
    .bind(e, await hmac(env.AUTH_SECRET, "code|" + e + "|" + code), iso(Date.now() + CODE_TTL_MS)).run();
  return { send: { to: e, code } };
}

/* The newest live code for that address, tried once more. On success the
   code is spent, an owner row exists (the admin's is made on first sign-in)
   and a session is opened. Returns { ok, token, owner, mfa } or { ok:false, reason }. */
export async function verifyLogin(env, email, code, userAgent) {
  const e = normEmail(email), c = String(code || "").replace(/\D/g, "");
  if (!validEmail(e) || c.length !== 6) return { ok: false, reason: "invalid" };
  const row = await env.DB.prepare(
    "SELECT id, code_hash, attempts FROM login_codes WHERE email = ?1 AND used_at IS NULL AND expires_at > ?2 ORDER BY id DESC LIMIT 1"
  ).bind(e, iso()).first();
  if (!row) return { ok: false, reason: "expired" };
  if (row.attempts >= CODE_TRIES) return { ok: false, reason: "tries" };
  const right = same(row.code_hash, await hmac(env.AUTH_SECRET, "code|" + e + "|" + c));
  if (!right) {
    await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?1").bind(row.id).run();
    return { ok: false, reason: row.attempts + 1 >= CODE_TRIES ? "tries" : "wrong" };
  }
  /* Spent by exactly one caller: two tabs racing the same code cannot both sign in. */
  const spent = await env.DB.prepare("UPDATE login_codes SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL RETURNING id").bind(iso(), row.id).first();
  if (!spent) return { ok: false, reason: "expired" };
  /* One code signed in: every other code still out for that address dies with it. */
  await env.DB.prepare("UPDATE login_codes SET used_at = ?1 WHERE email = ?2 AND used_at IS NULL").bind(iso(), e).run();

  const isAdmin = e === adminEmail(env);
  let owner = await env.DB.prepare("SELECT * FROM owners WHERE email = ?1 AND deleted_at IS NULL").bind(e).first();
  if (!owner && isAdmin) {
    owner = await env.DB.prepare("INSERT INTO owners (email, role) VALUES (?1, 'admin') RETURNING *").bind(e).first();
  } else if (owner && isAdmin && owner.role !== "admin") {
    owner = await env.DB.prepare("UPDATE owners SET role = 'admin', updated_at = ?1 WHERE id = ?2 RETURNING *").bind(iso(), owner.id).first();
  }
  if (!owner) return { ok: false, reason: "unknown" };

  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const life = owner.role === "admin" ? ADMIN_SESSION_MS : OWNER_SESSION_MS;
  await env.DB.prepare("INSERT INTO sessions (id, owner_id, expires_at, user_agent) VALUES (?1, ?2, ?3, ?4)")
    .bind(await sha256(token), owner.id, iso(Date.now() + life), String(userAgent || "").slice(0, 200)).run();
  return { ok: true, token, owner, maxAge: Math.floor(life / 1000), mfa: owner.role !== "admin" || !twoFactorOn(env) ? "none" : owner.totp_confirmed_at ? "needed" : "enroll" };
}

/* The session behind a request's cookie, or null. `mfa` is true when the
   admin has given the authenticator's code on this session, or when the
   authenticator is not required (ADMIN_2FA off). */
export async function sessionOf(env, request) {
  if (!authOn(env)) return null;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{40,60})`).exec(request.headers.get("Cookie") || "");
  if (!m) return null;
  const s = await env.DB.prepare(
    `SELECT s.id AS sid, s.mfa_at, s.expires_at, s.totp_failures, o.* FROM sessions s JOIN owners o ON o.id = s.owner_id
      WHERE s.id = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2 AND o.deleted_at IS NULL`
  ).bind(await sha256(m[1]), iso()).first();
  if (!s) return null;
  return { sid: s.sid, owner: s, admin: s.role === "admin", mfa: !!s.mfa_at || !twoFactorOn(env) };
}

export async function endSession(env, sid) {
  await env.DB.prepare("UPDATE sessions SET revoked_at = ?1 WHERE id = ?2").bind(iso(), sid).run();
}
export async function revokeAll(env, ownerId) {
  const r = await env.DB.prepare("UPDATE sessions SET revoked_at = ?1 WHERE owner_id = ?2 AND revoked_at IS NULL").bind(iso(), ownerId).run();
  return (r.meta && r.meta.changes) || 0;
}

export function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

/* ── 2. The authenticator (admin only) ── */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes) {
  let bits = 0, val = 0, out = "";
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function unbase32(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, ""), out = [];
  let bits = 0, val = 0;
  for (const ch of clean) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
export async function totpAt(secretBytes, step) {
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new ArrayBuffer(8), v = new DataView(msg);
  v.setUint32(0, Math.floor(step / 4294967296)); v.setUint32(4, step >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = mac[19] & 15;
  const n = (((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]) % 1000000;
  return String(n).padStart(6, "0");
}
async function aesKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("totp|" + env.AUTH_SECRET));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function seal(env, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), bytes));
  return b64url(iv) + "." + b64url(ct);
}
async function unseal(env, text) {
  const [a, b] = String(text || "").split(".");
  const dec = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: dec(a) }, await aesKey(env), dec(b)));
}

/* A new secret for an admin who has none confirmed. Returns what the
   phone needs: the key to type, and the otpauth:// link that opens an
   authenticator app with it filled in. Replaces any unconfirmed one. */
export async function totpEnroll(env, s) {
  if (!s || !s.admin || s.owner.totp_confirmed_at) return null;
  const secret = crypto.getRandomValues(new Uint8Array(20));
  await env.DB.prepare("UPDATE owners SET totp_secret_enc = ?1, updated_at = ?2 WHERE id = ?3").bind(await seal(env, secret), iso(), s.owner.id).run();
  const key = base32(secret);
  const label = "KAAL:" + encodeURIComponent(s.owner.email);
  return { key: key.replace(/(.{4})/g, "$1 ").trim(), uri: `otpauth://totp/${label}?secret=${key}&issuer=KAAL&algorithm=SHA1&digits=6&period=30` };
}

/* The authenticator's code. A step is accepted once (the last one used is
   kept), one step of clock drift either way. Five wrong codes end the
   session: the emailed code has to be asked for again. */
export async function totpCheck(env, s, code, nowMs) {
  if (!s || !s.admin) return { ok: false, reason: "not-admin" };
  const owner = await env.DB.prepare("SELECT totp_secret_enc, totp_confirmed_at, totp_last_step FROM owners WHERE id = ?1").bind(s.owner.id).first();
  if (!owner || !owner.totp_secret_enc) return { ok: false, reason: "enroll" };
  const c = String(code || "").replace(/\D/g, "");
  const secret = await unseal(env, owner.totp_secret_enc);
  const now = Math.floor((nowMs || Date.now()) / 30000);
  let hit = -1;
  for (const st of [now - 1, now, now + 1]) if (c.length === 6 && same(await totpAt(secret, st), c)) hit = st;
  if (hit < 0 || (owner.totp_last_step !== null && hit <= owner.totp_last_step)) {
    const f = await env.DB.prepare("UPDATE sessions SET totp_failures = totp_failures + 1 WHERE id = ?1 RETURNING totp_failures").bind(s.sid).first();
    if (f && f.totp_failures >= TOTP_FAILS) { await endSession(env, s.sid); return { ok: false, reason: "locked" }; }
    return { ok: false, reason: hit < 0 ? "wrong" : "used" };
  }
  const at = iso();
  await env.DB.prepare("UPDATE owners SET totp_last_step = ?1, totp_confirmed_at = COALESCE(totp_confirmed_at, ?2), updated_at = ?2 WHERE id = ?3")
    .bind(hit, at, s.owner.id).run();
  await env.DB.prepare("UPDATE sessions SET mfa_at = ?1, totp_failures = 0 WHERE id = ?2").bind(at, s.sid).run();
  return { ok: true, enrolled: !owner.totp_confirmed_at };
}

/* The email that carries a code. Plain and short; the code is in the
   subject too, so a phone shows it without opening the message. */
export function codeEmail(code, site) {
  const spaced = code.slice(0, 3) + " " + code.slice(3);
  const subject = `${spaced} is your KAAL sign-in code`;
  const text = [`Your sign-in code is ${spaced}.`, "", "It works once, for the next ten minutes.", "",
    "If you did not ask for it, you can ignore this email. Nobody can sign in without it.", "", "KAAL"].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#F4F1EA;padding:32px 16px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1b18">
<div style="max-width:440px;margin:0 auto;background:#FBF9F4;padding:32px 28px;border:1px solid #E6E0D4">
<p style="letter-spacing:.5em;font-size:13px;margin:0 0 28px">KAAL</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 12px">Your sign-in code is</p>
<p style="font-family:Menlo,Consolas,monospace;font-size:30px;letter-spacing:.18em;margin:0 0 20px">${spaced}</p>
<p style="font-size:14px;line-height:1.6;color:#5c574e;margin:0 0 8px">It works once, for the next ten minutes.</p>
<p style="font-size:14px;line-height:1.6;color:#5c574e;margin:0">If you did not ask for it, you can ignore this email. Nobody can sign in without it.</p>
</div></body></html>`;
  return { subject, text, html };
}
