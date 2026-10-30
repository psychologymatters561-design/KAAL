/* /claim?t=: registering a delivered piece. The link is the proof that
   this person holds the piece; registering is their acceptance of it. */
(function () {
  "use strict";
  var K = window.KAALO, $ = K.$, t = K.params().t || "", info = null;
  var WHY = {
    unknown: ["This link is not one of ours", "It may have been copied wrongly. If you have the email, open the link in it again, or ask for a new one."],
    expired: ["This link has expired", "Registration links last 30 days. We can send you a new one."],
    used: ["This piece is already registered", "This link was used. If that was you, sign in to Owners with the email you registered with. If it was not, ask for a new link and we will look into it."],
    early: ["Not quite yet", "Registration opens once the piece has been delivered. Your link will wait for you."]
  };

  function bad(reason) {
    $("loading").hidden = true; $("form").hidden = true; $("bad").hidden = false;
    var w = WHY[reason] || WHY.unknown;
    $("badH").textContent = w[0]; $("badWhy").textContent = w[1];
    $("again").hidden = reason === "early";
  }
  $("again").addEventListener("click", function () {
    $("again").disabled = true;
    K.api("POST", "/o/claim/request-link", { t: t }, { token: false }).then(function () {
      $("againMsg").textContent = "Thank you. We have been told, and will send a new link to the email on your order.";
    });
  });

  function row(dl, k, v, locked) { var d = K.el("div"); d.appendChild(K.el("dt", "", k)); d.appendChild(K.el("dd", locked ? "locked" : "", v)); dl.appendChild(d); }

  function show(j) {
    info = j;
    var n = K.pad(j.piece.n), p = $("piece");
    p.appendChild(K.face(j.piece));
    var no = K.el("p", "no"); no.appendChild(document.createTextNode("No. " + n + " ")); no.appendChild(K.el("small", "", "of " + j.piece.size)); p.appendChild(no);
    p.appendChild(K.el("p", "sub", j.piece.series + " · " + j.piece.colorway));
    $("title").textContent = "Make No. " + n + " yours";
    $("lead").textContent = "Each of the " + (j.piece.size === 20 ? "twenty" : j.piece.size) + " has one line in the KAAL registry. This writes your name into No. " + n + "’s, as Owner " + K.roman(j.ownerNo || 1) + ", for as long as the piece exists.";
    var ul = K.clear($("opens"));
    ["Your 2-year warranty, counting down to the second", "The piece’s record, kept in your name", "Its transfer, history intact, if you ever pass it on", "First word of Series 02, before anyone else"]
      .forEach(function (x) { ul.appendChild(K.el("li", "", x)); });
    var dl = $("facts");
    row(dl, "Piece", "No. " + n + " of " + j.piece.size, true);
    row(dl, "Series", j.piece.series, true);
    row(dl, "Colourway", j.piece.colorway, true);
    row(dl, "Delivered", K.day(j.deliveredOn), true);
    if (j.city || j.state) row(dl, "City", [j.city, j.state].filter(Boolean).join(", "), true);
    $("name").value = j.name; $("phone").value = j.phone ? "+" + j.phone.replace(/^\+/, "") : ""; $("email").value = j.email;
    /* Everything already on the order is shown as it will be written, not
       as three boxes to check; one tap opens them if anything is wrong. */
    if (j.name && j.phone && j.email) {
      $("meName").textContent = j.name;
      $("meMeta").textContent = $("phone").value + " · " + j.email;
      $("me").hidden = false; $("details").hidden = true;
    }
    var days = j.returnDays;
    var rn = $("returnNotice");
    if (j.returnOpen) {
      rn.appendChild(K.el("b", "", "Registering ends the " + days + "-day return option."));
      rn.appendChild(document.createTextNode(" Until you register, you can still return No. " + n + " for a full refund, until " + K.day(j.returnEndsAt) + ". Your 2-year warranty is honoured from the delivery date whether or not you register. If you would rather keep it on approval for now, this link will wait for you."));
    } else {
      rn.appendChild(K.el("b", "", "Its " + days + "-day return window has already closed."));
      rn.appendChild(document.createTextNode(" Registering writes you into the registry as its owner. Your 2-year warranty is honoured from the delivery date whether or not you register."));
    }
    $("acceptText").textContent = "I accept No. " + n + ". I understand registering ends my " + days + "-day return option.";
    $("cityText").textContent = "Show my city beside No. " + n + " in the public registry.";
    var cs = K.el("small", "", "Optional. Otherwise the registry says “Owner’s city withheld”. Your name, phone and email are never shown.");
    $("cityText").appendChild(cs);
    /* Initials on the shop: shown as they would appear, from the name as typed. */
    function initials() {
      var w = $("name").value.trim().split(/\s+/).map(function (x) { return x.replace(/[^A-Za-z\u00C0-\u024F\u0900-\u097F]/g, ""); }).filter(Boolean).slice(0, 2);
      return w.map(function (x) { return x.charAt(0).toUpperCase() + new Array(Math.min(5, Math.max(2, x.length - 1)) + 1).join("\u2022"); }).join(" ");
    }
    function nameText() {
      var i = initials();
      $("nameText").textContent = "Show my initials when someone taps No. " + n + " on the shop" + (i ? ", as " + i : "") + ".";
      $("nameText").appendChild(K.el("small", "", "Optional. Otherwise the card says \u201ca private collector\u201d. Never your full name."));
    }
    nameText(); $("name").addEventListener("input", nameText);
    $("go").textContent = "Make No. " + n + " yours";
    $("later").textContent = j.returnOpen ? "Not ready yet? Close this page. The link keeps, and the return option stays open until " + K.day(j.returnEndsAt) + "." : "";
    $("loading").hidden = true; $("form").hidden = false;
    document.title = "KAAL · Register No. " + n;
  }

  function openDetails(focus) {
    if (!$("details").hidden) return;
    $("details").hidden = false; $("me").hidden = true; $("editDetails").setAttribute("aria-expanded", "true");
    if (focus) $(focus).focus();
  }
  $("editDetails").addEventListener("click", function () { openDetails("name"); });

  /* A different email has to be shown to be theirs. */
  function emailChanged() { return info && $("email").value.trim().toLowerCase() !== (info.email || "").toLowerCase(); }
  $("email").addEventListener("input", function () { $("codeBlock").hidden = !emailChanged(); });
  $("sendCode").addEventListener("click", function () {
    var b = $("sendCode"); b.disabled = true; $("codeMsg").textContent = "";
    K.api("POST", "/o/claim/email-code", { t: t, email: $("email").value.trim() }, { token: false }).then(function (r) {
      b.disabled = false;
      $("codeMsg").textContent = r.ok ? "Sent. It works for ten minutes." : (r.reason === "rate" ? K.why.rate : r.reason === "invalid" ? "That does not look like an email address." : "That did not work. Please try again.");
    });
  });

  $("reg").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("err"); err.textContent = "";
    var body = { t: t, name: $("name").value, phone: $("phone").value, email: $("email").value.trim(), emailCode: $("emailCode").value,
      accept: $("accept").checked, showCity: $("showCity").checked, showName: $("showName").checked, consent: $("consent").checked };
    var go = $("go"); go.disabled = true;
    K.api("POST", "/o/claim/register", body, { token: false }).then(function (r) {
      if (r.ok) { done(r); return; }
      go.disabled = false;
      if (r.reason === "used" || r.reason === "expired" || r.reason === "unknown") { bad(r.reason); return; }
      err.textContent = r.why || K.why[r.reason] || "That did not work. Please try again.";
      var f = { name: "name", phone: "phone", email: "email", accept: "accept", consent: "consent", "email-code": "emailCode" }[r.reason];
      if (["name", "phone", "email", "emailCode"].indexOf(f) > -1) openDetails();
      if (f && $(f)) $(f).focus();
    });
  });

  function done(r) {
    K.token(r.token);
    $("form").hidden = true; $("done").hidden = false;
    var strip = $("strip"); K.clear(strip);
    for (var i = 1; i <= info.piece.size; i++) {
      var c = K.el("i", i === r.n ? "mine" : "", K.pad(i));
      strip.appendChild(c);
    }
    $("doneH").textContent = "No. " + K.pad(r.n) + " is recorded in your name";
    $("doneName").textContent = $("name").value.trim().replace(/\s+/g, " ");
    $("doneP").textContent = "You are Owner " + K.roman(r.ownerNo) + " of No. " + K.pad(r.n) + " of " + info.piece.size + ". Your warranty is counting down.";
    $("open").href = "/owners";
    $("open").focus({ preventScroll: true });
    document.title = "KAAL · No. " + K.pad(r.n) + " is yours";
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(function () { location.href = "/owners"; }, reduce ? 4000 : 6500);
  }

  if (!t) { bad("unknown"); return; }
  K.api("GET", "/o/claim/info?t=" + encodeURIComponent(t), undefined, { token: false }).then(function (j) {
    if (j.ok) show(j); else bad(j.reason);
  });
})();
