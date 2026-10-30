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
  var LEAD = "Enter the email you ordered or registered with. We will send you a six-digit code. There is no password to remember.";
  $("fEmail").addEventListener("submit", function (e) {
    e.preventDefault();
    EMAIL = $("email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(EMAIL)) { $("eErr").textContent = WHY.invalid; return; }
    $("eGo").disabled = true; $("eErr").textContent = "";
    K.api("POST", "/o/auth/start", { email: EMAIL }, { token: false }).then(function (r) {
      $("eGo").disabled = false;
      if (r._status === 0 || (!r.ok && r.reason !== "invalid")) { $("eErr").textContent = K.why[r.reason] || "That did not work. Please try again."; return; }
      if (!r.ok) { $("eErr").textContent = WHY[r.reason]; return; }
      $("fEmail").hidden = true; $("fCode").hidden = false; $("cErr").textContent = ""; $("code").value = ""; $("code").focus(); resendIn(45);
      $("gateLead").textContent = "If that email holds a KAAL, or a KAAL was delivered to it, a six-digit code is on its way. Not registered yet? The code opens your registration.";
    });
  });
  $("back").addEventListener("click", function () { showEmail(""); $("gateLead").textContent = LEAD; });
  /* The code: digits only, however it arrives (typed, pasted, filled in by
     the phone from the email), and it sends itself once all six are in. */
  var AUTO = 0, BUSY = false, RESEND = 0;
  $("code").addEventListener("input", function () {
    var v = $("code").value.replace(/\D/g, "").slice(0, 6);
    if ($("code").value !== v) $("code").value = v;
    clearTimeout(AUTO);
    if (v.length === 6) AUTO = setTimeout(function () { if (!BUSY) $("fCode").requestSubmit ? $("fCode").requestSubmit() : $("cGo").click(); }, 380);
  });
  function resendIn(sec) {
    var b = $("again"); if (!b) return;
    clearInterval(RESEND); b.disabled = true;
    var left = sec;
    b.textContent = "Send a new code in " + left + "s";
    RESEND = setInterval(function () { left--; if (left <= 0) { clearInterval(RESEND); b.disabled = false; b.textContent = "Send a new code"; } else b.textContent = "Send a new code in " + left + "s"; }, 1000);
  }
  if ($("again")) $("again").addEventListener("click", function () {
    $("again").disabled = true;
    K.api("POST", "/o/auth/start", { email: EMAIL }, { token: false }).then(function () { $("cErr").textContent = ""; $("code").value = ""; $("code").focus(); resendIn(45); });
  });
  $("fCode").addEventListener("submit", function (e) {
    e.preventDefault();
    clearTimeout(AUTO);
    if (BUSY) return;
    BUSY = true;
    $("cGo").disabled = true; $("cErr").textContent = "";
    K.api("POST", "/o/auth/verify", { email: EMAIL, code: $("code").value }, { token: false }).then(function (r) {
      $("cGo").disabled = false; BUSY = false;
      /* Delivered, not registered yet: the code opens that piece's registration. */
      if (r.ok && r.register) { $("gateLead").textContent = "Opening No. " + K.pad(r.n) + "\u2019s registration."; location.href = r.register; return; }
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

    /* Hero: the piece inside its chapter ring, and its place in the line */
    var hero = K.el("div", "piece hero");
    hero.appendChild(K.el("p", "eyebrow", "The owners\u2019 room"));
    hero.appendChild(halo(K.face({ n: p.n, photo: p.photo })));
    var no = K.el("p", "no"); no.appendChild(document.createTextNode("No. " + K.pad(p.n) + " ")); no.appendChild(K.el("small", "", "of " + p.size)); hero.appendChild(no);
    hero.appendChild(K.el("p", "sub", p.series + " \u00b7 " + p.colorway));
    var held = K.el("p", "held"); held.appendChild(K.el("span", "", "Owner " + K.roman(p.ownerNo))); held.appendChild(document.createTextNode(" \u00b7 since " + K.day(p.registeredOn))); hero.appendChild(held);
    hero.appendChild(K.el("p", "oneof", "One of " + numberWord(p.size) + ". Never remade."));
    box.appendChild(hero);

    /* What is open */
    d.incoming.forEach(function (t) { box.appendChild(banner("warn", "A transfer to you is waiting.", " No. " + K.pad(t.n) + " will be recorded in your name once we have approved it. We will email you.")); });
    if (p.stolen) box.appendChild(banner("bad", "Reported stolen.", " This piece is flagged in the registry and cannot be transferred until it is cleared. Write to connect@thekaal.co the moment it is found."));
    p.requests.forEach(function (r) {
      var label = { warranty: "Your warranty claim", stolen: "Your report", contact: "Your contact change", service: "Your service request" }[r.type] || "Your request";
      var st = { open: "is with us. We answer within 48 hours.", info_needed: "needs a little more from you. Check your email.", approved: "has been approved." }[r.status] || "is open.";
      box.appendChild(banner("warn", label, " " + st));
    });
    if (p.transfer) {
      var tb = banner("warn", "A transfer is open.", p.transfer.status === "accepted" ? " The new owner has accepted. It is waiting for our approval." : " Its code is valid until " + K.day(p.transfer.expires_at) + ". Until someone accepts it, No. " + K.pad(p.n) + " is still yours.");
      var cx = K.el("p"); var cb = K.el("button", "linkbtn", "Cancel the transfer"); cb.type = "button";
      cb.addEventListener("click", function () { cb.disabled = true; K.api("POST", "/o/transfer/cancel", { piece: p.id }).then(function () { load(); }); });
      cx.appendChild(cb); tb.appendChild(cx); box.appendChild(tb);
    }

    /* The warranty, live, and the line it runs along */
    var w = p.warranty;
    if (w) { var wc = clock(w); wc.appendChild(lifeline(p, w)); box.appendChild(wc); }

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
    var expired = p.warranty && serverNow() >= p.warranty.endMs;
    if (!p.stolen) {
      g.appendChild(action(expired ? "Request paid service" : "Raise a warranty claim", function () { claimForm(p, expired ? "service" : "warranty"); }));
      if (!p.transfer) g.appendChild(action("Transfer ownership", function () { transferForm(p); }));
    }
    if (!p.stolen) g.appendChild(action("Report stolen", function () { reportForm(p, "stolen"); }));
    g.appendChild(action("Request a contact-details change", function () { reportForm(p, "contact"); }));
    g.appendChild(action("Download receipt", function () { paper("receipt", p); }));
    g.appendChild(action("Printable certificate", function () { paper("certificate", p); }));
    if (d.guide && /^https:\/\//.test(d.guide)) { var gl = K.el("a", "btn ghost", "Setting guide video"); gl.href = d.guide; gl.target = "_blank"; gl.rel = "noopener noreferrer"; g.appendChild(gl); }
    act.appendChild(g);
    box.appendChild(privacy(p, d.owner));
    box.appendChild(act);
    Array.prototype.forEach.call(box.querySelectorAll(".card"), function (c) { c.classList.add("rv"); });
    if (K.reveal) K.reveal(box);
    document.title = "KAAL · No. " + K.pad(p.n) + " · Owners";
  }
  function numberWord(n) { return ({ 10: "ten", 12: "twelve", 20: "twenty", 25: "twenty-five", 50: "fifty", 100: "a hundred" })[n] || String(n); }

  /* The chapter ring: sixty marks around the piece, drawn in once, turning
     a full circle every four minutes. Time, and only time. */
  function halo(face) {
    var h = K.el("div", "halo"), svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 200 200"); svg.setAttribute("class", "ring"); svg.setAttribute("aria-hidden", "true");
    var ring = document.createElementNS(NS, "circle"); ring.setAttribute("cx", "100"); ring.setAttribute("cy", "100"); ring.setAttribute("r", "97"); svg.appendChild(ring);
    for (var i = 0; i < 60; i++) {
      var a = i / 60 * 2 * Math.PI, five = i % 5 === 0, r1 = five ? 89 : 92, ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", (100 + r1 * Math.cos(a)).toFixed(2)); ln.setAttribute("y1", (100 + r1 * Math.sin(a)).toFixed(2));
      ln.setAttribute("x2", (100 + 95 * Math.cos(a)).toFixed(2)); ln.setAttribute("y2", (100 + 95 * Math.sin(a)).toFixed(2));
      if (five) ln.setAttribute("class", "five");
      ln.style.setProperty("--i", i);
      svg.appendChild(ln);
    }
    h.appendChild(svg); h.appendChild(face);
    return h;
  }

  /* Delivered, today, the end: where the warranty stands on one line. */
  function lifeline(p, w) {
    var f = K.el("div", "life"), span = w.endMs - w.startMs, now = serverNow();
    var frac = Math.min(1, Math.max(0, (now - w.startMs) / span));
    var tr = K.el("div", "track"), fill = K.el("i", "fill"), dot = K.el("i", "now");
    tr.setAttribute("role", "img"); tr.setAttribute("aria-label", Math.round(frac * 100) + " percent of the warranty has run");
    tr.appendChild(fill); tr.appendChild(dot); f.appendChild(tr);
    requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.transform = "scaleX(" + frac.toFixed(4) + ")"; dot.style.left = (frac * 100).toFixed(2) + "%"; }); });
    var marks = K.el("div", "marks");
    var a = K.el("span"); a.appendChild(K.el("b", "", "Delivered")); a.appendChild(K.el("small", "", K.day(p.deliveredOn))); marks.appendChild(a);
    var b = K.el("span", "r"); b.appendChild(K.el("b", "", "Covered until")); b.appendChild(K.el("small", "", K.day(w.endDay))); marks.appendChild(b);
    f.appendChild(marks);
    f.appendChild(K.el("p", "muted small center", human(w.endMs - now) + " of cover left. The return window closed when you registered, on " + K.day(p.registeredOn) + "."));
    return f;
  }
  function human(ms) {
    var d = Math.max(0, Math.floor(ms / 86400000)), y = Math.floor(d / 365.25), m = Math.floor((d - y * 365.25) / 30.44), out = [];
    if (y) out.push(y + (y === 1 ? " year" : " years"));
    if (m) out.push(m + (m === 1 ? " month" : " months"));
    if (!y && !m) out.push(d + (d === 1 ? " day" : " days"));
    return "About " + out.join(", ");
  }

  /* How they appear on the shop, as a visitor sees it, and the two yeses
     that change it. Both start as no; either can be taken back here. */
  function privacy(p, o) {
    var card = K.el("div", "card noprint"); card.appendChild(K.el("h2", "", "How you appear on the shop"));
    card.appendChild(K.el("p", "muted", "When someone taps No. " + K.pad(p.n) + " on thekaal.co, this is the card they see. Your name, email, phone and address are never shown."));
    var pv = K.el("div", "oc-preview"); pv.setAttribute("aria-live", "polite"); card.appendChild(pv);
    var st = { city: !!o.showCity, name: !!o.showName };
    function paint() {
      K.clear(pv);
      pv.appendChild(K.el("p", "e", "No. " + K.pad(p.n) + " \u00b7 " + p.colorway));
      var h = K.el("p", "h"); h.appendChild(document.createTextNode("Held by ")); h.appendChild(K.el("em", "", "Owner " + K.roman(p.ownerNo))); pv.appendChild(h);
      pv.appendChild(st.name && o.initials ? K.el("p", "who", o.initials) : K.el("p", "who priv", "A private collector"));
      var since = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(p.registeredOn));
      pv.appendChild(K.el("p", "m", "Since " + since + (st.city && o.city ? " \u00b7 " + o.city : "")));
      pv.appendChild(K.el("p", "f", "One of " + numberWord(p.size) + ". Never remade."));
    }
    function sw(key, label, sub, can) {
      var l = K.el("label", "switch"), i = K.el("input"); i.type = "checkbox"; i.setAttribute("role", "switch"); i.checked = st[key]; i.disabled = !can;
      var t = K.el("span", "t"); t.appendChild(K.el("b", "", label)); t.appendChild(K.el("small", "", sub));
      l.appendChild(t); l.appendChild(i); l.appendChild(K.el("i", "knob"));
      i.addEventListener("change", function () {
        var was = st[key]; st[key] = i.checked; paint(); msg.textContent = "Saving\u2026";
        K.api("POST", "/o/me/privacy", { showCity: st.city, showName: st.name }).then(function (r) {
          if (r.ok) { st.city = r.showCity; st.name = r.showName; o.showCity = r.showCity; o.showName = r.showName; msg.textContent = "Saved. The shop shows this within a minute."; paint(); return; }
          st[key] = was; i.checked = was; paint(); msg.textContent = K.why[r.reason] || "That did not save. Please try again.";
        });
      });
      return l;
    }
    paint();
    card.appendChild(sw("name", "Show my initials", o.initials ? "As " + o.initials + ", never your name" : "Your name is not on file yet", !!o.initials));
    card.appendChild(sw("city", "Show my city", o.city ? o.city + ", beside your number" : "No city on file", !!o.city));
    var msg = K.el("p", "hint"); msg.setAttribute("role", "status"); card.appendChild(msg);
    return card;
  }

  function banner(kind, bold, rest) { var b = K.el("div", "banner " + kind); b.appendChild(K.el("b", "", bold)); b.appendChild(document.createTextNode(rest)); return b; }
  function kv(dl, k, v) { var row = K.el("div"); row.appendChild(K.el("dt", "", k)); row.appendChild(K.el("dd", "", v)); dl.appendChild(row); }
  function action(label, fn) { var b = K.el("button", "btn ghost", label); b.type = "button"; b.addEventListener("click", fn); return b; }

  /* ── The signature: the warranty, counted down ── */
  function clock(w) {
    var card = K.el("div", "card warranty"); card.appendChild(K.el("h2", "", "Your warranty, live"));
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
    var last = -1, first = true;
    used.setAttribute("stroke-dasharray", "0 " + C.toFixed(2));
    function tick() {
      var now = serverNow(), rem = Math.max(0, w.endMs - now);
      if (rem <= 0) { render(); return; }
      var s = Math.floor(rem / 1000);
      if (s !== last) {
        last = s;
        dn.nodeValue = String(Math.floor(s / 86400));
        hh.textContent = K.pad(Math.floor(s % 86400 / 3600)); mm.textContent = K.pad(Math.floor(s % 3600 / 60)); ss.textContent = K.pad(s % 60);
        var frac = Math.min(1, Math.max(0, (now - w.startMs) / span)), arc = (frac * C).toFixed(2) + " " + C.toFixed(2);
        /* The first second draws the arc in from nothing; after that it only creeps. */
        if (first) { first = false; setTimeout(function () { used.setAttribute("stroke-dasharray", arc); }, 120); } else used.setAttribute("stroke-dasharray", arc);
        dial.setAttribute("aria-label", "Warranty remaining: " + Math.floor(s / 86400) + " days");
      }
      TIMER = setTimeout(tick, 1000 - (serverNow() % 1000) + 5);   /* the next second on the server's clock */
    }
    tick();
    return card;
  }

  /* ── The one sheet: a claim, a transfer, a report ── */
  var DLG = $("dlg");
  function sheet(title, build) {
    $("dlgT").textContent = title; var b = K.clear($("dlgB")); build(b);
    var x = K.el("p", "center"); var c = K.el("button", "linkbtn", "Close"); c.type = "button"; c.addEventListener("click", function () { DLG.close(); });
    x.appendChild(c); b.appendChild(x);
    if (typeof DLG.showModal === "function") DLG.showModal(); else DLG.setAttribute("open", "");
  }
  function field(b, id, label, el) { var l = K.el("label", "", label); l.setAttribute("for", id); el.id = id; b.appendChild(l); b.appendChild(el); return el; }
  function form(b) { var f = K.el("form"); f.noValidate = true; b.appendChild(f); return f; }
  function msg(f) { var m = K.el("p", "err"); m.setAttribute("role", "alert"); f.appendChild(m); return m; }
  function sayDone(b, text) { K.clear(b); b.appendChild(K.el("p", "okmsg", text)); var x = K.el("p", "center"); var c = K.el("button", "btn", "Done"); c.type = "button"; c.addEventListener("click", function () { DLG.close(); load(); }); x.appendChild(c); b.appendChild(x); }

  /* A warranty claim (or, after it has concluded, a paid service): words and up to four photographs or videos. */
  function claimForm(p, type) {
    var claim = type === "warranty";
    sheet(claim ? "Raise a warranty claim" : "Request paid service", function (b) {
      b.appendChild(K.el("p", "muted", claim ? "Tell us what No. " + K.pad(p.n) + " is doing. We answer within 48 hours, and the warranty covers the movement." : "Your warranty has concluded, so this is a paid service. Tell us what is wrong and we will quote it before anything is done."));
      var f = form(b);
      var ta = field(f, "cd", "What is it doing?", K.el("textarea")); ta.maxLength = 2000;
      var fi = field(f, "cf", "Photographs or a short video (optional, up to four)", K.el("input")); fi.type = "file"; fi.multiple = true; fi.accept = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";
      f.appendChild(K.el("p", "hint", "Only we can see them. Photographs up to 8 MB, videos up to 24 MB."));
      var m = msg(f), go = K.el("button", "btn block", claim ? "Send the claim" : "Send the request"); go.type = "submit"; f.appendChild(go);
      f.addEventListener("submit", function (e) {
        e.preventDefault(); m.textContent = "";
        var files = Array.prototype.slice.call(fi.files || [], 0, 4);
        if (ta.value.trim().length < 5) { m.textContent = "Say a little about it, in a sentence or two."; ta.focus(); return; }
        go.disabled = true; var keys = [], i = 0;
        (function next() {
          if (i >= files.length) {
            K.api("POST", "/o/requests", { piece: p.id, type: type, description: ta.value, media: keys }).then(function (r) {
              if (r.ok) { sayDone($("dlgB"), claim ? "Your claim is with us. A confirmation is in your email, and we answer within 48 hours." : "Your request is with us. We will write to you with a quote."); return; }
              go.disabled = false; m.textContent = r.why || K.why[r.reason] || "That did not work. Please try again.";
            });
            return;
          }
          m.textContent = "Adding file " + (i + 1) + " of " + files.length + "…";
          K.api("POST", "/o/upload?p=" + encodeURIComponent(p.id), files[i]).then(function (r) {
            if (!r.ok) { go.disabled = false; m.textContent = r.why || K.why[r.reason] || "That file did not go. Please try another."; return; }
            keys.push(r.key); i++; next();
          });
        })();
      });
    });
  }

  /* A stolen report or a contact-details change: words only. */
  function reportForm(p, type) {
    var stolen = type === "stolen";
    sheet(stolen ? "Report No. " + K.pad(p.n) + " stolen" : "Change your details", function (b) {
      b.appendChild(K.el("p", "muted", stolen ? "We will check what you tell us and confirm. Once confirmed, No. " + K.pad(p.n) + " is shown as stolen in the public registry and cannot be transferred until it is cleared. We will email you." : "Tell us what should change: your name, phone, email or city. We make the change by hand and will write to you if we need anything."));
      var f = form(b);
      var ta = field(f, "rd", stolen ? "What happened, and when?" : "What should change?", K.el("textarea")); ta.maxLength = 2000;
      var m = msg(f), go = K.el("button", "btn block", stolen ? "Send the report" : "Send the request"); go.type = "submit"; f.appendChild(go);
      f.addEventListener("submit", function (e) {
        e.preventDefault(); m.textContent = ""; go.disabled = true;
        K.api("POST", "/o/requests", { piece: p.id, type: type, description: ta.value }).then(function (r) {
          if (r.ok) { sayDone($("dlgB"), stolen ? "Your report is with us. We will confirm by email." : "Thank you. We will make the change and write to you."); return; }
          go.disabled = false; m.textContent = r.why || K.why[r.reason] || "That did not work. Please try again.";
        });
      });
    });
  }

  /* Passing it on: a code, shown once. */
  function transferForm(p) {
    sheet("Transfer No. " + K.pad(p.n), function (b) {
      b.appendChild(K.el("p", "muted", "You will be shown a code, once. Give it to the new owner with the watch and its letter. It works for seven days, and until they accept it No. " + K.pad(p.n) + " is still yours. Its warranty stays exactly as it is."));
      var f = form(b);
      var em = field(f, "te", "Their email (optional, so we can invite them)", K.el("input")); em.type = "email"; em.autocomplete = "off";
      var m = msg(f), go = K.el("button", "btn block", "Start the transfer"); go.type = "submit"; f.appendChild(go);
      f.addEventListener("submit", function (e) {
        e.preventDefault(); m.textContent = ""; go.disabled = true;
        K.api("POST", "/o/transfer/start", { piece: p.id, buyerEmail: em.value.trim() }).then(function (r) {
          if (!r.ok) { go.disabled = false; m.textContent = r.why || K.why[r.reason] || "That did not work. Please try again."; return; }
          var body = K.clear($("dlgB"));
          body.appendChild(K.el("p", "muted", "Here is the code. This is the only time we show it."));
          body.appendChild(K.el("p", "serif center big-code", r.code));
          var cp = K.el("button", "btn ghost block", "Copy the code"); cp.type = "button";
          cp.addEventListener("click", function () { try { navigator.clipboard.writeText(r.code); cp.textContent = "Copied"; } catch (x) { cp.textContent = "Select it and copy it by hand"; } });
          body.appendChild(cp);
          body.appendChild(K.el("p", "hint", "Valid until " + K.day(r.expiresAt) + ". The new owner enters it at thekaal.co/claim/transfer."));
          var x = K.el("p", "center"); var c = K.el("button", "btn", "Done"); c.type = "button"; c.addEventListener("click", function () { DLG.close(); load(); }); x.appendChild(c); body.appendChild(x);
        });
      });
    });
  }

  /* An owner who cannot sign in at all: a request for us to verify them by hand. */
  $("lost").addEventListener("click", function () {
    sheet("Cannot sign in?", function (b) {
      b.appendChild(K.el("p", "muted", "If you can no longer open the email you registered with, we will check it by hand against the order, a photograph of the caseback and the letter that came with your watch. Tell us the number and an email we can reach you on."));
      var f = form(b);
      var n = field(f, "rn", "The number of your piece", K.el("input")); n.type = "text"; n.inputMode = "numeric"; n.maxLength = 2;
      var e = field(f, "re", "An email we can reach you on", K.el("input")); e.type = "email";
      var t = field(f, "rt", "Anything that helps (optional)", K.el("textarea")); t.maxLength = 1000;
      var m = msg(f), go = K.el("button", "btn block", "Ask us to verify me"); go.type = "submit"; f.appendChild(go);
      f.addEventListener("submit", function (ev) {
        ev.preventDefault(); m.textContent = ""; go.disabled = true;
        K.api("POST", "/o/recovery", { number: n.value, email: e.value.trim(), description: t.value }, { token: false }).then(function (r) {
          if (r.ok) { K.clear($("dlgB")).appendChild(K.el("p", "okmsg", "Thank you. We will write to that address, and may ask for a photograph of the caseback and the letter.")); return; }
          go.disabled = false; m.textContent = r.why || K.why[r.reason] || "That did not work. Please try again.";
        });
      });
    });
  });

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
