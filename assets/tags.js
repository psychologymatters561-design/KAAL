/* ══════════════════════════════════════════════════════════════════
   MEASUREMENT. The Meta Pixel and Google Analytics 4, for every page,
   and the server-side twin of every Pixel event.

   The IDs live here and nowhere else. Paste them in and every page on
   the site starts measuring; leave them empty and not one byte loads
   from Meta or Google — the site behaves exactly as it did before this
   file existed.

     pixel   Meta Pixel ID            Events Manager → Data sources
             (digits only, e.g. "123456789012345")
     ga4     GA4 Measurement ID       Admin → Data streams → Web
             (e.g. "G-ABC123XYZ9")

   Pages never call fbq or gtag themselves. They push a plain event onto
   window.kaalQ — [name, data] — and this file translates it for both
   services. That queue is why load order does not matter: an event
   pushed before this file has arrived is simply sent when it does.

   Events, and what each one tells the ad account:
     (load)    every page                        PageView          —
     dial      a dial was chosen                 ViewContent       view_item
     number    a number was chosen               AddToCart         add_to_cart
     checkout  the pay button                    InitiateCheckout  begin_checkout
     purchase  claimed.html, VERIFIED only       Purchase          purchase
     hero      "Choose your number" in hero      ChooseNumber*     hero_cta
     gift      "this is a gift" was ticked       GiftOrder*        add_gift
   (* custom event in Meta; the rest are standard, so they can be
      optimised for.) content_ids are series01-01 … series01-20.

   EVERY EVENT HAS TWO HALVES AND ONE ID. The Pixel sends the browser's
   copy with an eventID made here; the edition worker's /event route sends
   the server's copy to the Conversions API under the same id, with the
   IP address and browser only a server can vouch for. Meta matches the
   two on (event name, event id) and counts one. Purchase is the
   exception: its server half comes from the Razorpay webhook, never from
   a browser, and both halves carry the Razorpay order id.

   The server half is sent only when the browser's Pixel really loaded.
   Blocking Meta — an ad blocker, Firefox's strict mode, Safari's — blocks
   both halves, which is what legal.html tells people. The purchase itself
   is the one fact reported either way, and legal.html says that too.

   Where a visitor came from — UTM tags, and the fbclid of an ad click —
   is kept from the landing page to the checkout, and written onto the
   Razorpay order by the worker. The Pixel's own _fbc cookie is preferred;
   the fbclid is the fallback that survives a blocked Pixel.

   Nothing here may ever stand between a buyer and the checkout. Every
   call is wrapped, and the sending is done after the tap that caused it
   has been painted, not during it.
   ══════════════════════════════════════════════════════════════════ */
(function(){
"use strict";

var TAGS = {
  pixel: "1607748840888926",
  ga4:   ""
};

/* The edition worker, chosen by where the page is. thekaal.co always gets
   the live one. A rehearsal — this repo on localhost, or the Cloudflare
   Pages preview — gets the test worker, which records no sales and tells
   Meta only in test mode. Anywhere else gets neither. index.html makes the
   same choice for checkout, with the same two URLs; check.mjs holds all
   three copies equal. */
var API = {
  live: "https://kaal-edition.kaal-edition-hq.workers.dev",
  test: "https://kaal-edition-test.kaal-edition-hq.workers.dev"
};

var PRICE = 5999, CUR = "INR", SERIES = "series01";
var UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
var DAY = 864e5;

function apiFor(h){
  if(/(^|\.)thekaal\.co$/.test(h)) return API.live;
  if(h === "localhost" || h === "127.0.0.1" || /kaal-preview[a-z0-9-]*\.pages\.dev$/.test(h)) return API.test;
  return "";
}
var BASE = apiFor(location.hostname);

function get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function put(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
function cookie(name){
  try{
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }catch(e){ return ""; }
}
function pad(n){ n = parseInt(n, 10); return n < 10 ? "0" + n : "" + n; }

/* An event id nobody else will ever produce: the event, the time, and
   sixty four random bits. It only has to be unique per pixel. */
function newId(name){
  var r = "";
  try{
    var a = new Uint32Array(2);
    window.crypto.getRandomValues(a);
    r = a[0].toString(36) + a[1].toString(36);
  }catch(e){ r = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
  return name.slice(0, 3).toLowerCase() + "." + Date.now().toString(36) + "." + r;
}

/* ── WHERE THEY CAME FROM ─────────────────────────────────────────────
   Read on every page, so it does not matter which page the ad links to.
   A landing with UTM tags replaces the last set whole (last touch); an
   fbclid replaces the last click id. UTMs are kept thirty days, a click
   id ninety, which is how long Meta's own _fbc cookie keeps it. */
function capture(){
  var q;
  try{ q = new URLSearchParams(location.search); }catch(e){ return; }
  var a = readAttr(), hit = false, i, v;
  var tags = {};
  for(i = 0; i < UTM.length; i++){
    v = q.get(UTM[i]);
    if(v){ tags[UTM[i]] = v.replace(/[\u0000-\u001f]/g, " ").slice(0, 200); hit = true; }
  }
  if(hit){
    for(i = 0; i < UTM.length; i++) delete a[UTM[i]];
    for(v in tags) a[v] = tags[v];
    a.at = Date.now();
  }
  v = q.get("fbclid");
  if(v && /^[\w-]{10,240}$/.test(v)){
    a.fbclid = v; a.fbcAt = Date.now(); hit = true;
  }
  if(hit) put("kaal_attr", JSON.stringify(a));
}
function readAttr(){
  try{ var a = JSON.parse(get("kaal_attr") || "{}"); return a && typeof a === "object" ? a : {}; }
  catch(e){ return {}; }
}
/* What the checkout carries to the order: fresh UTM tags, a fresh click
   id, a _fbc built from it for when the Pixel never set one, and the
   hashed browser id. index.html calls this at the moment of paying. */
function attr(){
  var a = readAttr(), out = {}, now = Date.now(), i;
  if(a.at && now - a.at < 30 * DAY) for(i = 0; i < UTM.length; i++) if(a[UTM[i]]) out[UTM[i]] = a[UTM[i]];
  if(a.fbclid && a.fbcAt && now - a.fbcAt < 90 * DAY){
    out.fbclid = a.fbclid;
    out.fbc = "fb.1." + a.fbcAt + "." + a.fbclid;
  }
  if(xid) out.xid = xid;
  return out;
}
window.kaalAttr = attr;

/* ── WHO, WITHOUT A NAME ──────────────────────────────────────────────
   The anonymous token index.html already keeps for number holds, hashed.
   It is Meta's external_id: the same string on the Pixel and on every
   server event, so that the two halves of a visit recognise each other
   even on a browser that clears Meta's cookies. Never sent unhashed. */
var xid = "";
function clientToken(){
  var t = get("kaal_client");
  if(!t){
    t = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    put("kaal_client", t);
    if(get("kaal_client") !== t) return "";      /* storage refused: no stable id to offer */
  }
  return t;
}
function sha256(text){
  try{
    if(!window.crypto || !window.crypto.subtle || !window.TextEncoder) return Promise.resolve("");
    return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function(buf){
      var b = new Uint8Array(buf), s = "";
      for(var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
      return s;
    }, function(){ return ""; });
  }catch(e){ return Promise.resolve(""); }
}

/* ── THE SERVER HALF ──────────────────────────────────────────────────
   Held until it is known whether the Pixel itself is alive: its script
   loaded AND it wrote its _fbp cookie. A blocked script never loads; a
   blocker's stand-in script loads but writes no cookie. Either way the
   held events are dropped, never sent. */
var px = 0, held = [], loaded = false, ready = false;

function settle(alive){
  if(px) return;
  px = alive ? 1 : -1;
  var h = held; held = [];
  if(alive) for(var i = 0; i < h.length; i++) beacon(h[i]);
}
function probe(n){
  if(px || !loaded || !ready) return;
  if(cookie("_fbp")) return settle(true);
  if(n < 20) setTimeout(function(){ probe(n + 1); }, 250);
  else settle(false);
}
function relay(name, id, d){
  if(!BASE || px < 0) return;
  var b = { name:name, id:id, url:location.href, no:d.no || "", dial:d.dial || "" };
  if(px === 0) held.push(b); else beacon(b);
}
/* text/plain, so no preflight; a beacon, so it outlives the page. */
function beacon(b){
  b.fbp = cookie("_fbp");
  b.fbc = cookie("_fbc") || (attr().fbc || "");
  b.xid = xid;
  var body = JSON.stringify(b), url = BASE + "/event";
  try{
    if(navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type:"text/plain" }))) return;
  }catch(e){}
  try{
    fetch(url, { method:"POST", body:body, keepalive:true, mode:"no-cors", credentials:"omit",
                 headers:{ "Content-Type":"text/plain" } }).catch(function(){});
  }catch(e){}
}

/* ── THE PIXEL ────────────────────────────────────────────────────── */
function loadPixel(){
  if(!TAGS.pixel) return;
  if(window.fbq){ loaded = true; return; }          /* somebody else owns the loader */
  /* Meta's own loader, apart from layout, and the two handlers that tell
     the server half whether there is a browser half to match. */
  (function(f,b,e,v,n,t,s){
    n = f.fbq = function(){ n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if(!f._fbq) f._fbq = n;
    n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
    t = b.createElement(e); t.async = true; t.src = v;
    t.onload  = function(){ loaded = true; probe(0); };
    t.onerror = function(){ settle(false); };
    s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  /* A script that neither loads nor fails is as good as blocked. */
  setTimeout(function(){ settle(false); }, 20000);
}

if(TAGS.ga4 && !window.gtag){
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(TAGS.ga4);
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function(){ window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", TAGS.ga4);
}

var MAP = {
  dial:     ["ViewContent",      "view_item",      1],
  number:   ["AddToCart",        "add_to_cart",    1],
  checkout: ["InitiateCheckout", "begin_checkout", 1],
  purchase: ["Purchase",         "purchase",       1],
  hero:     ["ChooseNumber",     "hero_cta",       0],
  gift:     ["GiftOrder",        "add_gift",       0]
};

function send(name, d){
  var m = MAP[name];
  if(!m) return;
  d = d || {};
  var no = /^\d{1,2}$/.test(String(d.no || "")) ? pad(d.no) : "";
  var item = no ? SERIES + "-" + no : SERIES;
  var id = d.eventID ? String(d.eventID) : newId(m[0]);
  var value = +d.value > 0 ? +d.value : PRICE, cur = d.currency || CUR;

  if(TAGS.pixel && window.fbq){
    var p = { content_ids:[item], content_type:"product", value:value, currency:cur };
    if(d.dial) p.content_name = "KAAL Series 01 " + d.dial;
    if(name === "checkout" || name === "purchase") p.num_items = 1;
    if(name === "purchase" && d.order_id) p.order_id = String(d.order_id);
    window.fbq(m[2] ? "track" : "trackCustom", m[0], p, { eventID:id });
  }
  if(name !== "purchase") relay(m[0], id, { no:no, dial:d.dial });

  if(TAGS.ga4 && window.gtag){
    var it = { item_id:item, item_name:"KAAL Series 01", price:value, quantity:1 };
    if(d.dial) it.item_variant = d.dial;
    var g = { currency:cur, value:value, items:[it] };
    if(name === "purchase") g.transaction_id = String(d.order_id || id);
    window.gtag("event", m[1], g);
  }
}

function flush(){
  if(!ready) return;
  var q = window.kaalQ || [];
  window.kaalQ = [];
  for(var i = 0; i < q.length; i++){
    try{ send(q[i][0], q[i][1]); }catch(e){}
  }
}

/* Called by a page straight after pushing, usually inside a tap. The send
   waits for the next task, so the tap's own repaint is never queued
   behind the Pixel's work. */
var soon = 0;
window.kaalFlush = function(){
  if(soon || !ready) return;
  soon = setTimeout(function(){ soon = 0; flush(); }, 0);
};

/* ── GO ───────────────────────────────────────────────────────────────
   The loader goes first so the network starts at once; init waits the
   millisecond it takes to hash the browser id, then PageView, then
   whatever the page queued meanwhile. A purchase queued by claimed.html
   carries the buyer's hashed email and phone (from the worker, after the
   signature) and they go into init as advanced matching. */
function init(){
  if(TAGS.pixel && window.fbq){
    var user = {}, q = window.kaalQ || [];
    if(xid) user.external_id = xid;
    for(var i = 0; i < q.length; i++){
      var u = q[i] && q[i][1] && q[i][1].user;
      if(u && /^[a-f0-9]{64}$/.test(u.em || "")) user.em = u.em;
      if(u && /^[a-f0-9]{64}$/.test(u.ph || "")) user.ph = u.ph;
    }
    try{
      window.fbq("init", TAGS.pixel, user);
      var id = newId("PageView");
      window.fbq("track", "PageView", {}, { eventID:id });
      relay("PageView", id, {});
    }catch(e){}
  }
  ready = true;
  probe(0);
  flush();
}

try{ capture(); }catch(e){}
try{ loadPixel(); }catch(e){}
var tok = "";
try{ tok = clientToken(); }catch(e){}
(tok ? sha256(tok) : Promise.resolve("")).then(function(h){ xid = h || ""; }, function(){})
  .then(function(){ try{ init(); }catch(e){ ready = true; } });
})();
