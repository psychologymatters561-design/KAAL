/* ══════════════════════════════════════════════════════════════════
   MEASUREMENT. The Meta Pixel and Google Analytics 4, for every page.

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
     view      the twenty came on screen        ViewContent       view_item
     hero      "Choose your number" in hero     ChooseNumber*     hero_cta
     dial      a dial was tapped                CustomizeProduct  select_item
     number    a number was tapped              AddToCart         add_to_cart
     gift      "this is a gift" was ticked      GiftOrder*        add_gift
     checkout  the buy button, with checkout    InitiateCheckout  begin_checkout
     purchase  claimed.html, with a payment id  Purchase          purchase
     list      Series 02 list, address added    Lead              generate_lead

   Funnel events (October 2026). Custom in Meta, so they can be counted
   and audienced but are never mistaken for a sale; none carries a price.
     hero_complete     the film scrubbed to its end     HeroComplete*     hero_complete
     early_dial        a dial chosen in "Which one…"    EarlyDial*        early_dial
     ctx_cta           a dial act's quiet link          ContextCta*       ctx_cta
     caseback_view     the piece turned to its back     CasebackView*     caseback_view
     provenance_click  "Who is selling this →"          ProvenanceClick*  provenance_click
     deeplink          landed on a #nX link             DeepLink*         deep_link
   docs/funnel-metrics.md maps each stage of the funnel to its event.
   (* custom event in Meta; the rest are standard, so they can be
      optimised for.)

   Purchase carries the Razorpay payment id as its eventID. The worker
   sends the same purchase server-side through the Conversions API with
   the same id, and Meta counts the pair once — which is what keeps the
   number honest when Safari or an ad blocker drops the browser half.
   ══════════════════════════════════════════════════════════════════ */
(function(){
"use strict";

var TAGS = {
  pixel: "1607748840888926",
  ga4:   ""
};

var PRICE = 5999, CUR = "INR";

if(TAGS.pixel && !window.fbq){
  /* Meta's own loader, unchanged apart from layout. */
  (function(f,b,e,v,n,t,s){
    if(f.fbq) return;
    n = f.fbq = function(){ n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if(!f._fbq) f._fbq = n;
    n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
    t = b.createElement(e); t.async = true; t.src = v;
    s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  window.fbq("init", TAGS.pixel);
  window.fbq("track", "PageView");
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
  view:     ["ViewContent",      "view_item",      1],
  hero:     ["ChooseNumber",     "hero_cta",       0],
  dial:     ["CustomizeProduct", "select_item",    1],
  number:   ["AddToCart",        "add_to_cart",    1],
  gift:     ["GiftOrder",        "add_gift",       0],
  checkout: ["InitiateCheckout", "begin_checkout", 1],
  purchase: ["Purchase",         "purchase",       1],
  list:     ["Lead",             "generate_lead",  1],
  hero_complete:    ["HeroComplete",    "hero_complete",    0, 1],
  early_dial:       ["EarlyDial",       "early_dial",       0, 1],
  ctx_cta:          ["ContextCta",      "ctx_cta",          0, 1],
  caseback_view:    ["CasebackView",    "caseback_view",    0, 1],
  provenance_click: ["ProvenanceClick", "provenance_click", 0, 1],
  deeplink:         ["DeepLink",        "deep_link",        0, 1]
};

function send(name, d){
  var m = MAP[name];
  if(!m) return;
  d = d || {};
  var item = d.no ? "KAAL-" + d.no : "KAAL-S01";

  /* A name on a list is not a watch in a basket: it carries no product and
     no price, so the ad account never learns to value it at ₹5,999. */
  if(name === "list"){
    if(TAGS.pixel && window.fbq) window.fbq("track", "Lead", { content_name:"KAAL Series 02 list" });
    if(TAGS.ga4 && window.gtag) window.gtag("event", "generate_lead", { lead_source: d.source || "" });
    return;
  }

  /* The fourth flag marks a step in the funnel rather than a product
     moment: it is counted, with the dial or number when there is one, and
     it never carries a value — a scroll to the end of the film is not
     ₹5,999 of anything. */
  if(m[3]){
    var c = {};
    if(d.dial) c.dial = d.dial;
    if(d.no) c.number = d.no;
    if(d.where) c.where = d.where;
    if(TAGS.pixel && window.fbq) window.fbq("trackCustom", m[0], c);
    if(TAGS.ga4 && window.gtag) window.gtag("event", m[1], c);
    return;
  }

  if(TAGS.pixel && window.fbq){
    var p = { content_ids:[item], content_type:"product", value:PRICE, currency:CUR };
    if(d.dial) p.content_name = "KAAL Series 01 " + d.dial;
    var opt = d.eventID ? { eventID: String(d.eventID) } : {};
    window.fbq(m[2] ? "track" : "trackCustom", m[0], p, opt);
  }
  if(TAGS.ga4 && window.gtag){
    var it = { item_id:item, item_name:"KAAL Series 01", price:PRICE, quantity:1 };
    if(d.dial) it.item_variant = d.dial;
    var g = { currency:CUR, value:PRICE, items:[it] };
    if(d.eventID) g.transaction_id = String(d.eventID);
    window.gtag("event", m[1], g);
  }
}

function flush(){
  var q = window.kaalQ || [];
  window.kaalQ = [];
  for(var i = 0; i < q.length; i++){
    try{ send(q[i][0], q[i][1]); }catch(e){}
  }
}

window.kaalFlush = flush;
flush();

/* ══ THE OWNER'S HISTORY, on every page but the shop itself ══

   The storefront (index.html) sends its own steps to the shop's worker.
   Every other page says only that it was opened, that it is still open
   (once a minute while it is on screen), and when it was left: with the
   random id the shop already keeps on this device (kaal_client), the
   page's name and where the visit came from. So the owner's desk can show
   a visitor who read the movement page before they bought. No cookie,
   nothing from the page itself; legal.html#privacy says so. An empty
   HISTORY sends nothing. tools/check.mjs keeps it equal to KAAL.api. */
var HISTORY = "https://kaal-edition.kaal-edition-hq.workers.dev";
(function history(){
  var page = (/\/([a-z0-9]+)\.html$/.exec(location.pathname) || [])[1] || "";
  if(!HISTORY || !/^(about|manifesto|movement|provenance|legal|claimed|404)$/.test(page)) return;
  if(!navigator.sendBeacon || navigator.webdriver || !window.Blob) return;
  var uid = "", tag = "", i;
  try{
    uid = localStorage.getItem("kaal_client") || "";
    if(!uid){ uid = Date.now().toString(36) + Math.random().toString(36).slice(2,10); localStorage.setItem("kaal_client", uid); }
  }catch(e){ uid = ""; }
  if(!/^[a-z0-9]{6,24}$/.test(uid)) return;
  for(i = 0; i < 10; i++) tag += Math.floor(Math.random() * 36).toString(36);
  /* Where from, in a word: the ad's utm_source, else the site that sent
     it (the worker turns a site into a name). Never the address itself. */
  var src = "";
  try{ src = (new URLSearchParams(location.search).get("utm_source") || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 24); }catch(e){}
  if(!src){
    var h = "";
    try{ h = new URL(document.referrer).hostname.replace(/^www\./, ""); }catch(e){}
    src = !h ? "direct" : h === location.hostname.replace(/^www\./, "") ? "thekaal.co" : h.replace(/[^a-z0-9._-]/g, "").slice(0, 24);
  }
  function beacon(l){
    try{ navigator.sendBeacon(HISTORY + "/e", new Blob([JSON.stringify({ l:l })], { type:"text/plain" })); }catch(e){}
  }
  var gone = false;
  function here(ev){ beacon({ v:tag, u:uid, p:page, s:src, ev:ev || [] }); }
  here([{ e:"page", x:page }]);
  setInterval(function(){ if(document.visibilityState === "visible" && !gone) here(); }, 60000);
  function leave(){ if(gone) return; gone = true; beacon({ v:tag, u:uid, p:page, s:src, ev:[], g:1 }); }
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "hidden") leave(); else if(gone){ gone = false; here(); }
  });
  addEventListener("pagehide", leave);
})();
})();
