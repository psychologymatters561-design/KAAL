/* /owners: an owner's dossier of the piece they hold.

   The warranty counts down in the server's time, not the phone's: the
   page learns the offset once, on load, and every figure derives from it.
   The seconds step once a second, like a quartz hand. They never sweep. */
(function () {
  "use strict";
  var K = window.KAALO, $ = K.$, DATA = null, SEL = 0, OFFSET = 0, TIMER = 0, EMAIL = "";
  var NS = "http://www.w3.org/2000/svg";
  var WHY = { wrong: "That code is not right. Check it and try again.", expired: "That code has expired or was already used. Ask for another.", tries: "Too many wrong tries on that code. Ask for another.",
    invalid: "That does not look like an email address.", admin: "This page is for owners.", rate: K.why.rate };

  function section(id) { ["boot", "gate", "app", "paper"].forEach(function (s) { $(s).hidden = s !== id; }); $("out").hidden = id === "gate" || id === "boot"; }
  function signedOut(note) { K.token(""); DATA = null; stopClock(); section("gate"); showEmail(note); }
  function showEmail(note) { $("fEmail").hidden = false; $("fCode").hidden = true; $("eErr").textContent = note || ""; $("eGo").disabled = false; }

  /* ── Signing in ── */
  $("fEmail").addEventListener("submit", function (e) {
    e.preventDefault();
    EMAIL = $("email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(EMAIL)) { $("eErr").textContent = WHY.invalid; return; }
    $("eGo").disabled = true; $("eErr").textContent = "";
    K.api("POST", "/o/auth/start", { email: EMAIL }, { token: false }).then(function (r) {
      $("eGo").disabled = false;
      if (r._status === 0 || (!r.ok && r.reason !== "invalid")) { $("eErr").textContent = K.why[r.reason] || "That did not work. Please try again."; return; }
      if (!r.ok) { $("eErr").textContent = WHY[r.reason]; return; }
      $("fEmail").hidden = true; $("fCode").hidden = false; $("cErr").textContent = ""; $("code").value = ""; $("code").focus();
      $("gateLead").textContent = "If that email belongs to an owner, a code is on its way.";
    });
  });
  $("back").addEventListener("click", function () { showEmail(""); $("gateLead").textContent = "Sign in with the email you registered with. We will send you a six-digit code. There is no password to remember."; });
  $("fCode").addEventListener("submit", function (e) {
    e.preventDefault();
    $("cGo").disabled = true; $("cErr").textContent = "";
    K.api("POST", "/o/auth/verify", { email: EMAIL, code: $("code").value }, { token: false }).then(function (r) {
      $("cGo").disabled = false;
      if (r.ok) { K.token(r.token); load(); return; }
      if (r.reason === "expired" || r.reason === "tries") { showEmail(WHY[r.reason]); return; }
      $("cErr").textContent = WHY[r.reason] || K.why[r.reason] || "That did not work. Please try again.";
    });
  });
  $("out").addEventListener("click", function () {
    $("out").disabled = true;
    K.api("POST", "/o/auth/logout", {}).then(function () { $("out").disabled = false; signedOut(""); });
  });

  /* ── Loading the dossier ── */
  function load() {
    section("boot");
    var t0 = Date.now();
    K.api("GET", "/o/me").then(function (r) {
      var t1 = Date.now();
      if (r._status === 401 || r.reason === "signed-out") { signedOut(r._status === 401 && K.token() ? "You have been signed out. Sign in again." : ""); return; }
      if (!r.ok) { section("boot"); K.clear($("boot")).appendChild(K.el("p", "center err", K.why[r.reason] || "We could not load your page. Please refresh.")); return; }
      OFFSET = r.now - (t0 + (t1 - t0) / 2);                       /* the server's clock, less half the trip */
      DATA = r; SEL = Math.min(SEL, r.pieces.length - 1);
      section("app"); render();
    });
  }
  var serverNow = function () { return Date.now() + OFFSET; };

  function stopClock() { if (TIMER) { clearTimeout(TIMER); TIMER = 0; } }

  /* ── The page ── */
  function render() {
    var d = DATA;
    if (!d.pieces.length) {
      K.clear($("tabs")); var box = K.clear($("dossier"));
      box.appendChild(K.el("h1", "", "Welcome"));
      box.appendChild(K.el("p", "muted", "You are signed in as " + d.owner.email + ", and no piece is recorded in your name yet. If one is on its way, register it from the link in the email we send when it is delivered."));
      return;
    }
    var tabs = K.clear($("tabs"));
    if (d.pieces.length > 1) d.pieces.forEach(function (p, i) {
      var b = K.el("button", "", "No. " + K.pad(p.n)); b.type = "button"; b.setAttribute("aria-pressed", i === SEL ? "true" : "false");
      b.addEventListener("click", function () { SEL = i; render(); }); tabs.appendChild(b);
    });
    var p = d.pieces[SEL], box = K.clear($("dossier")); stopClock();

    /* Hero */
    var hero = K.el("div", "piece"); hero.appendChild(K.face({ n: p.n, photo: p.photo }));
    var no = K.el("p", "no"); no.appendChild(document.createTextNode("No. " + K.pad(p.n) + " ")); no.appendChild(K.el("small", "", "of " + p.size)); hero.appendChild(no);
    hero.appendChild(K.el("p", "sub", p.series + " · " + p.colorway));
    box.appendChild(hero);

    /* What is open */
    if (p.stolen) box.appendChild(banner("bad", "Reported stolen.", " This piece is flagged in the registry and cannot be transferred until it is cleared. Write to connect@thekaal.co the moment it is found."));
    p.requests.forEach(function (r) {
      var label = { warranty: "Your warranty claim", stolen: "Your report", contact: "Your contact change", service: "Your service request" }[r.type] || "Your request";
      var st = { open: "is with us. We answer within 48 hours.", info_needed: "needs a little more from you. Check your email.", approved: "has been approved." }[r.status] || "is open.";
      box.appendChild(banner("warn", label, " " + st));
    });
    if (p.transfer) box.appendChild(banner("warn", "A transfer is open.", p.transfer.status === "accepted" ? " The new owner has accepted. It is waiting for our approval." : " Valid until " + K.day(p.transfer.expires_at) + "."));

    /* The warranty */
    var w = p.warranty;
    if (w) box.appendChild(clock(w));

    /* Ownership */
    var own = K.el("div", "card"); own.appendChild(K.el("h2", "", "Ownership"));
    var dl = K.el("dl", "kv");
    kv(dl, "Owner", d.owner.name || "");
    kv(dl, "Owner number", "Owner " + K.roman(p.ownerNo));
    if (p.city || p.state) kv(dl, "City", [p.city, p.state].filter(Boolean).join(", "));
    if (p.orderedOn) kv(dl, "Ordered", K.day(p.orderedOn));
    if (p.deliveredOn) kv(dl, "Delivered", K.day(p.deliveredOn));
    kv(dl, "Registered", K.day(p.registeredOn));
    own.appendChild(dl); box.appendChild(own);

    /* Provenance */
    var prov = K.el("div", "card"); prov.appendChild(K.el("h2", "", "Provenance"));
    var ol = K.el("ol", "chain");
    p.chain.forEach(function (c) {
      var li = K.el("li", c.mine ? "mine" : ""); var who = K.el("span", "who", "Owner " + K.roman(c.ownerNo));
      if (c.mine) who.appendChild(K.el("span", "you", "You"));
      li.appendChild(who); li.appendChild(K.el("span", "yr", c.from + " – " + (c.to || "present"))); ol.appendChild(li);
    });
    prov.appendChild(ol); box.appendChild(prov);

    /* Service */
    var sv = K.el("div", "card"); sv.appendChild(K.el("h2", "", "Service history"));
    if (!p.service.length) sv.appendChild(K.el("p", "muted", "Nothing yet. When No. " + K.pad(p.n) + " is ever serviced, each visit is written here."));
    else { var sl = K.el("ol", "chain"); p.service.forEach(function (s) { var li = K.el("li"); li.appendChild(K.el("span", "who", s.work_done)); li.appendChild(K.el("span", "yr", K.day(s.date))); sl.appendChild(li); }); sv.appendChild(sl); }
    box.appendChild(sv);

    /* Actions */
    var act = K.el("div", "card noprint"); act.appendChild(K.el("h2", "", "Yours to do"));
    var g = K.el("div", "actions");
    g.appendChild(action("Download receipt", function () { paper("receipt", p); }));
    g.appendChild(action("Printable certificate", function () { paper("certificate", p); }));
    if (d.guide && /^https:\/\//.test(d.guide)) { var gl = K.el("a", "btn ghost", "Setting guide video"); gl.href = d.guide; gl.target = "_blank"; gl.rel = "noopener noreferrer"; g.appendChild(gl); }
    act.appendChild(g); box.appendChild(act);
    document.title = "KAAL · No. " + K.pad(p.n) + " · Owners";
  }
  function banner(kind, bold, rest) { var b = K.el("div", "banner " + kind); b.appendChild(K.el("b", "", bold)); b.appendChild(document.createTextNode(rest)); return b; }
  function kv(dl, k, v) { var row = K.el("div"); row.appendChild(K.el("dt", "", k)); row.appendChild(K.el("dd", "", v)); dl.appendChild(row); }
  function action(label, fn) { var b = K.el("button", "btn ghost", label); b.type = "button"; b.addEventListener("click", fn); return b; }

  /* ── The signature: the warranty, counted down ── */
  function clock(w) {
    var card = K.el("div", "card"); card.appendChild(K.el("h2", "", "Warranty"));
    var span = w.endMs - w.startMs;
    if (serverNow() >= w.endMs) {
      var c = K.el("div", "concluded"); c.appendChild(K.el("p", "", "Warranty concluded on " + K.day(w.endDay)));
      c.appendChild(K.el("p", "muted", "The piece is yours outright. If it ever needs a service, we are here."));
      card.appendChild(c); return card;
    }
    var dial = K.el("div", "dial"); dial.setAttribute("role", "timer"); dial.setAttribute("aria-label", "Warranty remaining");
    var svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("aria-hidden", "true");
    function circle(cls, r) { var e = document.createElementNS(NS, "circle"); e.setAttribute("class", cls); e.setAttribute("cx", "50"); e.setAttribute("cy", "50"); e.setAttribute("r", r); svg.appendChild(e); return e; }
    circle("track", "46");
    for (var i = 0; i < 24; i++) {
      var a = (i / 24) * 2 * Math.PI, hr = i % 6 === 0, r1 = hr ? 40 : 42, r2 = 44;
      var ln = document.createElementNS(NS, "line"); ln.setAttribute("class", "tick" + (hr ? " hour" : ""));
      ln.setAttribute("x1", (50 + r1 * Math.cos(a)).toFixed(2)); ln.setAttribute("y1", (50 + r1 * Math.sin(a)).toFixed(2));
      ln.setAttribute("x2", (50 + r2 * Math.cos(a)).toFixed(2)); ln.setAttribute("y2", (50 + r2 * Math.sin(a)).toFixed(2)); svg.appendChild(ln);
    }
    var used = circle("used", "46"), C = 2 * Math.PI * 46;
    dial.appendChild(svg);
    var face = K.el("div", "face"); face.appendChild(K.el("p", "cap", "Warranty remaining"));
    var days = K.el("p", "days"); var dn = document.createTextNode("0"); days.appendChild(dn); days.appendChild(K.el("small", "", "days")); face.appendChild(days);
    var hms = K.el("div", "hms"), lab = K.el("div", "lab"), hh = K.el("span"), mm = K.el("span"), ss = K.el("span");
    [[hh, "hrs"], [mm, "min"], [ss, "sec"]].forEach(function (x, i) {
      if (i) { hms.appendChild(K.el("span", "sep", ":")); lab.appendChild(K.el("span", "sep", ":")); }
      hms.appendChild(x[0]); lab.appendChild(K.el("span", "", x[1]));
    });
    face.appendChild(hms); face.appendChild(lab); dial.appendChild(face); card.appendChild(dial);
    card.appendChild(K.el("p", "muted center", "Until " + K.day(w.endDay) + ", 23:59:59 India time. It runs from the day your piece reached you, and never restarts if it changes hands."));
    var last = -1;
    function tick() {
      var now = serverNow(), rem = Math.max(0, w.endMs - now);
      if (rem <= 0) { render(); return; }
      var s = Math.floor(rem / 1000);
      if (s !== last) {
        last = s;
        dn.nodeValue = String(Math.floor(s / 86400));
        hh.textContent = K.pad(Math.floor(s % 86400 / 3600)); mm.textContent = K.pad(Math.floor(s % 3600 / 60)); ss.textContent = K.pad(s % 60);
        var frac = Math.min(1, Math.max(0, (now - w.startMs) / span));
        used.setAttribute("stroke-dasharray", (frac * C).toFixed(2) + " " + C.toFixed(2));
        dial.setAttribute("aria-label", "Warranty remaining: " + Math.floor(s / 86400) + " days");
      }
      TIMER = setTimeout(tick, 1000 - (serverNow() % 1000) + 5);   /* the next second on the server's clock */
    }
    tick();
    return card;
  }

  /* ── The certificate and the receipt ── */
  function paper(kind, p) {
    var d = DATA, host = K.clear($("paper")), sheet = K.el("div", "paper");
    var bar = K.el("div", "row noprint");
    var back = K.el("button", "btn ghost", "Back"); back.type = "button"; back.addEventListener("click", function () { section("app"); render(); });
    var pr = K.el("button", "btn", "Print or save as PDF"); pr.type = "button"; pr.addEventListener("click", function () { window.print(); });
    bar.appendChild(back); bar.appendChild(pr); host.appendChild(bar); host.appendChild(K.el("p", "", " "));
    sheet.appendChild(K.el("p", "small", "KAAL"));
    if (kind === "certificate") {
      sheet.appendChild(K.el("p", "small", "Certificate of ownership"));
      sheet.appendChild(K.el("p", "big", "No. " + K.pad(p.n) + " of " + p.size));
      sheet.appendChild(K.el("p", "", p.series + ", " + p.colorway));
      sheet.appendChild(K.el("p", "", "is recorded in the KAAL registry in the name of"));
      sheet.appendChild(K.el("h1", "", d.owner.name || ""));
      sheet.appendChild(K.el("p", "", "as Owner " + K.roman(p.ownerNo) + ", on " + K.day(p.registeredOn) + "."));
      if (p.warranty) sheet.appendChild(K.el("p", "", "Movement warranty: 2 years from the day it was delivered, until " + K.day(p.warranty.endDay) + "."));
      sheet.appendChild(K.el("p", "small", "Twenty were made. We will not make another."));
    } else {
      var rc = p.receipt || {};
      sheet.appendChild(K.el("p", "small", "Receipt"));
      var tb = K.el("table"), rows = [["Piece", "No. " + K.pad(p.n) + " of " + p.size + ", " + p.series + ", " + p.colorway], ["Paid by", rc.name || d.owner.name || ""],
        ["Paid on", rc.paidAt ? K.day(rc.paidAt) : ""], ["Amount", rc.amountPaise ? "₹" + (rc.amountPaise / 100).toLocaleString("en-IN") + " (" + (rc.currency || "INR") + ")" : ""], ["Reference", rc.reference || ""]];
      rows.forEach(function (r) { if (!r[1]) return; var tr = K.el("tr"); tr.appendChild(K.el("td", "", r[0])); tr.appendChild(K.el("td", "", r[1])); tb.appendChild(tr); });
      sheet.appendChild(tb);
      sheet.appendChild(K.el("p", "small", "KAAL · connect@thekaal.co"));
    }
    host.appendChild(sheet); section("paper"); window.scrollTo(0, 0);
  }

  if (K.token()) load(); else section("gate");
})();
