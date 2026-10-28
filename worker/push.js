/* ══════════ PHONE ALERTS (Web Push) ══════════

   A sale, a checkout, a warranty claim: the owner's phone says so within
   seconds, from the command centre itself, with no app store and no third
   party holding the messages. Standard Web Push (RFC 8030), the message
   encrypted to the phone (RFC 8291, aes128gcm) and signed by this worker
   (VAPID, RFC 8292). The worker makes its own signing key the first time
   it is asked for one and keeps it in KV; nothing has to be set by hand.

   On an iPhone this needs iOS 16.4 or later and the command centre added
   to the Home Screen (Share, Add to Home Screen), opened from there, and
   "Phone alerts" turned on inside it: Apple allows web alerts only to an
   installed page. Android and every desktop browser need only the tap.

   Stored: push:vapid (the key pair), push:subs (up to ten devices),
   push:prefs (which kinds the owner wants). A device the push service says
   is gone (404, 410) is dropped. */

const enc = new TextEncoder();
const SUBS = "push:subs", PREFS = "push:prefs", VAPID = "push:vapid";
const MAX_SUBS = 10;
/* Only the push services browsers actually use: the worker never posts to
   anywhere else, whatever a subscription says. */
const PUSH_HOSTS = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]*\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]*\.notify\.windows\.com|[a-z0-9.-]*\.push\.apple\.com)\//;
export const KINDS = {
  sale:     "A watch is paid for",
  checkout: "Someone opens the checkout",
  details:  "Someone gives their name and number",
  owner:    "An owner registers, or asks for something",
  system:   "Something is wrong (a failed email, a missed payment)"
};

export function b64u(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}

/* The worker's own key pair, made once. */
const KEPT = new WeakMap();
export async function vapidKeys(env) {
  if (!env.KAAL_STATE) return null;
  const hit = KEPT.get(env.KAAL_STATE);
  if (hit) return hit;
  let v = await env.KAAL_STATE.get(VAPID, "json").catch(() => null);
  if (!v || !v.jwk || !v.pub) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    v = { jwk: await crypto.subtle.exportKey("jwk", pair.privateKey), pub: b64u(await crypto.subtle.exportKey("raw", pair.publicKey)), at: new Date().toISOString() };
    await env.KAAL_STATE.put(VAPID, JSON.stringify(v));
  }
  KEPT.set(env.KAAL_STATE, v);
  return v;
}

async function vapidHeader(env, endpoint) {
  const v = await vapidKeys(env);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: "mailto:" + (env.PUSH_CONTACT || "connect@thekaal.co") })));
  const key = await crypto.subtle.importKey("jwk", v.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: { name: "SHA-256" } }, key, enc.encode(head + "." + claims));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${v.pub}`;
}

/* RFC 8291: the message, readable only by the phone that subscribed. */
export async function encryptFor(sub, text) {
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, secret, cat(enc.encode("WebPush: info\0"), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, ct);
}

export function goodSub(s) {
  return !!(s && typeof s.endpoint === "string" && s.endpoint.length < 1000 && PUSH_HOSTS.test(s.endpoint) && s.keys &&
    /^[A-Za-z0-9_-]{80,100}$/.test(String(s.keys.p256dh || "")) && /^[A-Za-z0-9_-]{16,32}$/.test(String(s.keys.auth || "")));
}

export async function pushOne(env, sub, note) {
  try {
    const body = await encryptFor(sub, JSON.stringify(note));
    const res = await fetch(sub.endpoint, { method: "POST", body, headers: {
      "TTL": String(note.ttl || 86400), "Urgency": note.urgency || "high", "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream", "Authorization": await vapidHeader(env, sub.endpoint) } });
    return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status };
  } catch (e) { return { ok: false, gone: false, status: 0, why: String(e).slice(0, 120) }; }
}

export async function subsOf(env) {
  if (!env.KAAL_STATE) return [];
  const v = await env.KAAL_STATE.get(SUBS, "json").catch(() => null);
  return Array.isArray(v) ? v : [];
}
export async function prefsOf(env) {
  const v = env.KAAL_STATE ? await env.KAAL_STATE.get(PREFS, "json").catch(() => null) : null;
  const p = {};
  for (const k of Object.keys(KINDS)) p[k] = !(v && v[k] === false);
  return p;
}
export async function savePrefs(env, b) {
  const p = {};
  for (const k of Object.keys(KINDS)) p[k] = b[k] !== false;
  p.sale = true;            /* a sale is always said */
  await env.KAAL_STATE.put(PREFS, JSON.stringify(p));
  return p;
}
export async function subscribe(env, sub, device) {
  if (!goodSub(sub)) return { ok: false, why: "That browser gave an address this worker does not post to." };
  const list = (await subsOf(env)).filter(s => s.endpoint !== sub.endpoint);
  list.unshift({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, at: new Date().toISOString(), device: String(device || "").slice(0, 60) });
  await env.KAAL_STATE.put(SUBS, JSON.stringify(list.slice(0, MAX_SUBS)));
  return { ok: true, devices: Math.min(list.length, MAX_SUBS) };
}
export async function unsubscribe(env, endpoint) {
  const list = await subsOf(env), left = endpoint ? list.filter(s => s.endpoint !== endpoint) : [];
  await env.KAAL_STATE.put(SUBS, JSON.stringify(left));
  return { ok: true, devices: left.length };
}

/* Tell every device the owner turned alerts on for. Never throws; returns
   how many took it. `note`: { kind, title, body, url, tag }. */
export async function notifyOwner(env, note) {
  try {
    if (!env.KAAL_STATE) return 0;
    const [subs, prefs] = await Promise.all([subsOf(env), prefsOf(env)]);
    if (!subs.length || prefs[note.kind] === false) return 0;
    const msg = { title: String(note.title || "KAAL").slice(0, 80), body: String(note.body || "").slice(0, 240),
      url: String(note.url || "/control").slice(0, 200), tag: String(note.tag || note.kind || "kaal").slice(0, 60), ttl: note.ttl, urgency: note.urgency };
    const res = await Promise.all(subs.map(s => pushOne(env, s, msg)));
    const dead = subs.filter((s, i) => res[i].gone).map(s => s.endpoint);
    if (dead.length) await env.KAAL_STATE.put(SUBS, JSON.stringify(subs.filter(s => dead.indexOf(s.endpoint) < 0))).catch(() => null);
    return res.filter(r => r.ok).length;
  } catch (e) { console.log("Phone alert failed:", String(e).slice(0, 120)); return 0; }
}

/* The page's helper, its manifest and its icons, served from /control so
   the alerts and the Home Screen app belong to the command centre alone. */
export const SW_JS = `self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener("push", function(e){
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) {}
  e.waitUntil(self.registration.showNotification(d.title || "KAAL", { body: d.body || "Open the command centre.", tag: d.tag || "kaal",
    renotify: true, icon: "/control/icon-192.png", badge: "/control/icon-192.png", data: { url: d.url || "/control" } }));
});
self.addEventListener("notificationclick", function(e){
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/control";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
    for (var i = 0; i < list.length; i++) if (list[i].url.indexOf("/control") > -1) { return list[i].focus().then(function(c){ return c.navigate ? c.navigate(url) : c; }); }
    return self.clients.openWindow(url);
  }));
});`;
export const MANIFEST = JSON.stringify({ name: "KAAL Command centre", short_name: "KAAL", start_url: "/control", scope: "/control",
  display: "standalone", background_color: "#0b0c0a", theme_color: "#0b0c0a",
  icons: [{ src: "/control/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/control/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }] });
const ICONS = {
  "icon-192.png": "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAIAAADdvvtQAAAC1ElEQVR42u3dwU0jYQyGYSbKYdIWLdAEJdEELVAbNyQUQSTQzG/7e57T7i3Jvmub3QS2/bY/wV9dvAQICAEhIAQEAkJACAgBgYAQEAJCQCAgBISAEBAICAEhIASEgEBACAgBISAQEAJCQAgIBISAEBACAgEhIASEgBAQCAgBISAEBAJCQAgIAYGAEBACQkAgIAT0zcfbi0e+ylU3RZ7F8+t7x8e/tfux3z910+4PYMYTuXZ/uefpNZMu8153j1ZAEzZUyPP1ZTwxAT38S9llLzx8nI3GrQmEgFoNoWFfTjYLKOGU7vUcrTDCAmp9Sk86n00gBNRqCI3835iWAU09pTs+LyuMyIDandLzzmcTCAE1GUKD38zUOKBJp3Tf52KFERxQi1N66vlsAiGg8gfs+M8CtA+o+ynd/fFbYcQHVPaUnn0+m0AIqPAxG/JR2iEBddwFM/4l3QpDQPVO6YTz2QRCQCUP25zvRDMtoC57YdIbUawwBFTplM45n00gBFTsyI06n8cGVHlHzPtIpBWGgGqc0mnnswmEgMocvIHn8/CAqu2Lqd9RxApDQKtP6czz2QRCQAWO39jzOSKgCrtj9ve2tsIQ0LpTOvl8NoEQ0NJTOvx8Dgpo1R5J+NEwJhACWnFKO59NIAS06JR2PicGdOZOyfkh5SYQAjr3lHY+m0AIaNEp7XxOD+jo/RK1v0wgBHTiKe18FhACWnRKO58FdOyuCdxfJhACOuWUdj4LCAEtOqWdzwI6du/E7i8TiP/a9ttuTxk/JhACQkBpp3T4/hIQAlo3hIwfASEgBNRxi9lfAkJAi4aQ8SMgBISAOm4x+0tACOisIfT7b7l6CR5m9PVr72295w1lWGEICAEhIBAQAkJACAgEhIAQEAICASEgBISAQEAICAEhIAQEAkJACAgBgYAQEAJCQCAgBISAEBAICAEhIASEgEBACAgBISAQEAKihU+fdNtNJrChwQAAAABJRU5ErkJggg==",
  "icon-512.png": "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"
};
export function iconPng(name) { return ICONS[name] ? unb64u(ICONS[name].replace(/\+/g, "-").replace(/\//g, "_")) : null; }
