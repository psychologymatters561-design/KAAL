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
  purchase: ["Purchase",         "purchase",       1]
};

function send(name, d){
  var m = MAP[name];
  if(!m) return;
  d = d || {};
  var item = d.no ? "KAAL-" + d.no : "KAAL-S01";

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
})();
