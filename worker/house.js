/* ══════════════════════════════════════════════════════════════════
   PIECES HELD FOR A NAMED ADDRESS: the shop owner's own (No. 01) and those
   sold before the registry existed (No. 02), each kept for its owner's
   email so they register and sign in at /owners like every other owner.

   The address is never written here in the open (this repository is
   public): only its SHA-256, and, so the worker can send the registration
   letter itself, the address sealed to the worker's own key (`box`: ECDH
   P-256 with a one-time key, HKDF-SHA-256, AES-256-GCM). The private half
   of that key was made by the worker and never leaves its store (KV); the
   public half is in tools/ops-key.json, and tools/seal-email.mjs seals an
   address to it. The piece is made ready for the address, then the usual
   path takes over:
     already that address's               nothing to do; a code goes
     held by the shop's own address       moved to this one (same person,
       (connect@, ADMIN_EMAIL, OWNER_EMAIL) same place in the line); a code goes
     held by anyone else                  never touched
     no owner yet                         its order is given this address and
                                          marked delivered (or, with no order,
                                          a house order of ₹0 is written), so
                                          the registration letter goes, and
                                          registering is theirs to do
   Every change is in the audit log. A ₹0 order is not a sale: the sales
   figures leave it out.
   ══════════════════════════════════════════════════════════════════ */
import { SERIES, audit } from "./registry.js";
import { normEmail, adminEmail, hex } from "./auth.js";
import { iso, istDay, queueDelivered } from "./orders.js";

/* At the shop owner's request (30 Oct 2026): No. 01 is their own; No. 02
   was sold before the registry. */
const HOUSE = [
  { n: 1, h: "60da370d17acfe076bef122f31391954e023b1893e9d4653f8a852f787a8a612" },
  { n: 2, h: "12724459e45e02cb86ca1e797ae1faab12733c90894f39b7f1e9e7676bfa0eb5" }
];

export function houseList(env) {
  if (env.HOUSE) { try { return JSON.parse(env.HOUSE); } catch (e) { return []; } }
  return HOUSE;
}
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/* The shop's own addresses: a piece held by one of them is the owner's. */
function shopAddress(env, email) {
  const e = normEmail(email);
  return e === adminEmail(env) || e === "connect@thekaal.co" ||
    String(env.OWNER_EMAIL || "").split(",").map(normEmail).filter(Boolean).indexOf(e) > -1;
}

/* Called with every address that asks to sign in at /owners. Only the
   reserved address changes anything. Returns what was done, per piece. */
export async function houseClaim(env, email) {
  const list = houseList(env);
  if (!list.length || !env.DB) return [];
  const e = normEmail(email), h = await sha(e);
  const out = [];
  for (const x of list.filter(x => x.h === h)) {
    try { out.push({ n: x.n, did: await ready(env, x.n, e) }); }
    catch (err) { console.log("House claim failed:", String(err).slice(0, 160)); out.push({ n: x.n, did: "error" }); }
  }
  return out;
}

async function ready(env, n, e) {
  const pc = await env.DB.prepare("SELECT * FROM pieces WHERE series = ?1 AND number = ?2").bind(SERIES, n).first();
  if (!pc) return "no piece";
  const actor = "system:house";
  const cur = await env.DB.prepare("SELECT s.id, s.owner_id, w.email FROM ownerships s JOIN owners w ON w.id = s.owner_id WHERE s.piece_id = ?1 AND s.to_at IS NULL").bind(pc.id).first();
  if (cur) {
    if (normEmail(cur.email) === e) return "registered";
    if (!shopAddress(env, cur.email)) return "held by another owner";
    /* The same person, at another of their addresses: their details and
       consents come with them, and their place in the line is unchanged. */
    await env.DB.prepare(
      `INSERT INTO owners (email, name, phone, city, state, show_city_publicly, show_name_publicly, data_consent_at, city_consent_at, name_consent_at)
       SELECT ?1, name, phone, city, state, show_city_publicly, show_name_publicly, data_consent_at, city_consent_at, name_consent_at FROM owners WHERE id = ?2
       ON CONFLICT (email) DO NOTHING`).bind(e, cur.owner_id).run();
    const to = await env.DB.prepare("SELECT id FROM owners WHERE email = ?1").bind(e).first();
    await env.DB.prepare("UPDATE ownerships SET owner_id = ?1 WHERE id = ?2").bind(to.id, cur.id).run();
    await audit(env, actor, "owner.house", "piece:" + pc.id, { owner: cur.owner_id }, { owner: to.id, why: "the owner's own piece, moved to their own address" }, pc.series);
    return "moved";
  }
  const now = iso(), today = istDay();
  const o = await env.DB.prepare("SELECT * FROM orders WHERE piece_id = ?1 AND status NOT IN ('cancelled','returned') ORDER BY id DESC LIMIT 1").bind(pc.id).first();
  if (o) {
    if (o.status === "registered") return "registered order, no owner";
    const before = { email_changed: normEmail(o.email) !== e, status: o.status };
    if (o.status === "delivered") {
      if (normEmail(o.email) !== e) await env.DB.prepare("UPDATE orders SET email = ?1, updated_at = ?2 WHERE id = ?3").bind(e, now, o.id).run();
    } else {
      await env.DB.prepare("UPDATE orders SET email = ?1, status = 'delivered', delivered_on = COALESCE(delivered_on, ?2), return_window_ends_at = ?3, updated_at = ?3 WHERE id = ?4")
        .bind(e, today, now, o.id).run();
    }
    await env.DB.prepare("UPDATE pieces SET status = 'delivered', order_ref = ?1, updated_at = ?2 WHERE id = ?3 AND status IN ('placed','delivered')").bind(o.id, now, pc.id).run();
    await audit(env, actor, "order.house", "order:" + o.id, before, { status: "delivered", why: "the owner's own piece, ready to register at their own address" }, pc.series);
    return "ready";
  }
  /* Sold before the registry and never recorded, kept back, or even still
     offered (it is the owner's own): a house order, ₹0, takes it off sale. */
  if (pc.order_ref || ["placed", "withheld", "available"].indexOf(pc.status) < 0) return `piece is ${pc.status}`;
  const row = await env.DB.prepare(
    `INSERT INTO orders (series, piece_id, razorpay_payment_id, email, amount_paise, status, paid_at, delivered_on, return_window_ends_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 0, 'delivered', ?5, ?6, ?5, ?5, ?5) RETURNING id`
  ).bind(pc.series, pc.id, "manual:house:" + crypto.randomUUID(), e, now, today).first();
  const took = await env.DB.prepare("UPDATE pieces SET status = 'delivered', order_ref = ?1, updated_at = ?2 WHERE id = ?3 AND order_ref IS NULL RETURNING id").bind(row.id, now, pc.id).first();
  if (!took) { await env.DB.prepare("DELETE FROM orders WHERE id = ?1").bind(row.id).run(); return "taken a moment ago"; }
  await audit(env, actor, "order.house", "order:" + row.id, { piece: pc.status }, { status: "delivered", amount: 0, why: "the owner's own piece, ready to register at their own address" }, pc.series);
  return "ready";
}

/* What the deploy log and Health may say about a reserved piece: no address. */
export async function houseFacts(env) {
  const out = [];
  for (const x of houseList(env)) {
    const pc = await env.DB.prepare("SELECT id, status FROM pieces WHERE series = ?1 AND number = ?2").bind(SERIES, x.n).first();
    if (!pc) { out.push({ n: x.n, state: "no such piece" }); continue; }
    const cur = await env.DB.prepare("SELECT w.email FROM ownerships s JOIN owners w ON w.id = s.owner_id WHERE s.piece_id = ?1 AND s.to_at IS NULL").bind(pc.id).first();
    const mine = cur && (await sha(normEmail(cur.email))) === x.h;
    out.push({ n: x.n, piece: pc.status, owner: !cur ? "none yet" : mine ? "your address" : shopAddress(env, cur.email) ? "the shop's address" : "another owner" });
  }
  return out;
}

/* ── The worker's own key, for addresses sealed to it ──
   Made once, on the first deploy that asks, and kept in KV. Only the
   public half ever leaves (the deploy writes it to tools/ops-key.json). */
const KEY = "ops:ecdh";
const ALG = { name: "ECDH", namedCurve: "P-256" };
async function keyPair(env) {
  const have = await env.KAAL_STATE.get(KEY, "json").catch(() => null);
  if (have && have.pub && have.priv) return have;
  const k = await crypto.subtle.generateKey(ALG, true, ["deriveBits"]);
  const made = { pub: await crypto.subtle.exportKey("jwk", k.publicKey), priv: await crypto.subtle.exportKey("jwk", k.privateKey), at: iso() };
  await env.KAAL_STATE.put(KEY, JSON.stringify(made));
  return made;
}
export async function opsPublicKey(env) {
  if (!env.KAAL_STATE) return null;
  const { pub } = await keyPair(env);
  return { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y };
}
const unb64 = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
/* box = base64url of JSON { e: one-time public key {x, y}, iv, c } */
async function openBox(env, box) {
  const { priv } = await keyPair(env);
  const b = JSON.parse(new TextDecoder().decode(unb64(box)));
  const mine = await crypto.subtle.importKey("jwk", priv, ALG, false, ["deriveBits"]);
  const theirs = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b.e.x, y: b.e.y, ext: true }, ALG, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, mine, 256);
  const hk = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("kaal owner address") },
    hk, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(b.iv) }, aes, unb64(b.c)));
}

/* Each piece held for a sealed address: made ready for it and its
   registration letter sent, once (the letter's dedupe key). Run by the
   deploy and every light run until it has gone. Says what it did, never
   to whom. */
export async function houseDeliver(env, site) {
  const out = [];
  if (!env.DB || !env.KAAL_STATE) return out;
  for (const x of houseList(env).filter(x => x.box)) {
    try {
      const e = normEmail(await openBox(env, x.box));
      if ((await sha(e)) !== x.h) { out.push({ n: x.n, did: "sealed address does not match its fingerprint" }); continue; }
      const did = await ready(env, x.n, e);
      if (did === "registered") { out.push({ n: x.n, did: "registered" }); continue; }
      if (did === "held by another owner" || did === "moved") { out.push({ n: x.n, did }); continue; }
      const o = await env.DB.prepare("SELECT o.*, p.number FROM orders o JOIN pieces p ON p.id = o.piece_id WHERE p.series = ?1 AND p.number = ?2 AND o.status = 'delivered' AND o.email = ?3 ORDER BY o.id DESC LIMIT 1")
        .bind(SERIES, x.n, e).first();
      if (!o) { out.push({ n: x.n, did: "not ready: " + did }); continue; }
      const q = await queueDelivered(env, site, o, `house:${x.n}:letter`);
      out.push({ n: x.n, did: q ? "letter queued" : "letter already sent", id: q || 0 });
    } catch (err) {
      console.log("House delivery failed:", String(err).slice(0, 160));
      out.push({ n: x.n, did: "could not open the sealed address" });
    }
  }
  return out;
}
