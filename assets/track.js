/* /track: an order's journey, read from the same table the emails are
   made from. Opened by the signed link in a tracking email (?o=&s=), or
   by the order reference and the email. */
(function () {
  "use strict";
  var K = window.KAALO, $ = K.$, q = K.params();
  var HEAD = { placed: "Set aside for you", inspected: "Passed inspection", packed: "Boxed", dispatched: "On its way to you", delivered: "With you" };

  function show(j, strong, ref, email) {
    $("ask").hidden = true; $("found").hidden = false;
    var p = $("piece"); K.clear(p);
    p.appendChild(K.face(j.piece));
    var no = K.el("p", "no"); no.appendChild(document.createTextNode("No. " + K.pad(j.piece.n) + " "));
    no.appendChild(K.el("small", "", "of " + j.piece.size)); p.appendChild(no);
    if (j.piece.colorway) p.appendChild(K.el("p", "sub", "Series 01 · " + j.piece.colorway));

    var tl = K.clear($("timeline"));
    if (j.cancelled) {
      $("headline").textContent = "This order is closed";
      $("timeline").hidden = true;
      var n = K.el("div", "notice"); n.appendChild(document.createTextNode("This order was cancelled or returned. If a refund is due it goes back to the way you paid. Questions: connect@thekaal.co."));
      var a = K.clear($("after")); a.appendChild(n);
      return;
    }
    $("timeline").hidden = false;
    var cur = j.stages.filter(function (s) { return s.state === "current"; })[0] || j.stages[j.stages.length - 1];
    $("headline").textContent = j.delivered ? "It is with you" : HEAD[cur.key];
    j.stages.forEach(function (s) {
      var li = K.el("li", s.state); var dot = K.el("span", "dot"); dot.setAttribute("aria-hidden", "true"); li.appendChild(dot);
      li.appendChild(K.el("p", "what", s.label + (s.state === "current" ? " (now)" : "")));
      if (s.at) li.appendChild(K.el("p", "when", K.stamp(s.at)));
      if (s.key === "dispatched" && j.courier) {
        var m = K.el("p", "more"); m.appendChild(document.createTextNode("With " + j.courier + (j.tracking ? ", tracking number " + j.tracking + ". " : ". ")));
        if (j.trackingUrl && /^https:\/\//.test(j.trackingUrl)) { var l = K.el("a", "", "Follow it live"); l.href = j.trackingUrl; l.rel = "noopener noreferrer"; m.appendChild(l); }
        li.appendChild(m);
      }
      tl.appendChild(li);
    });

    var after = K.clear($("after"));
    if (j.registered) {
      var d = K.el("div", "card"); d.appendChild(K.el("h3", "", "Registered"));
      d.appendChild(K.el("p", "muted", "This piece has an owner on the register. Their dashboard is at thekaal.co/owners."));
      var go = K.el("a", "btn ghost", "Open the dashboard"); go.href = "owners.html"; d.appendChild(go); after.appendChild(d);
    } else if (j.canRegister) {
      var c = K.el("div", "card"); c.appendChild(K.el("h3", "", "One step makes it yours"));
      c.appendChild(K.el("p", "muted", "Registering writes you into the KAAL registry as the owner of No. " + K.pad(j.piece.n) + " and opens your warranty dashboard."));
      var nt = K.el("div", "notice"); var b = K.el("b", "", "Registering ends the 7-day return option."); nt.appendChild(b);
      nt.appendChild(document.createTextNode(" Until you register, the return window stays open" + (j.returnEndsAt ? " until " + K.day(j.returnEndsAt) : "") + ". Your 2-year warranty runs from the delivery date whether or not you register."));
      c.appendChild(nt);
      var err = K.el("p", "err"); err.setAttribute("role", "alert");
      var btn = K.el("button", "btn", strong ? "Register No. " + K.pad(j.piece.n) : "Email me the registration link"); btn.type = "button";
      btn.addEventListener("click", function () {
        btn.disabled = true; err.textContent = "";
        if (strong) {
          K.api("POST", "/track/register", { o: q.o, s: q.s }, { token: false }).then(function (r) {
            if (r.ok && /^https:\/\/thekaal\.co\/claim\?t=/.test(r.claimUrl)) { location.href = r.claimUrl.replace("https://thekaal.co", ""); return; }
            btn.disabled = false; err.textContent = r.why || K.why[r.reason] || "That did not work. Please try again.";
          });
        } else {
          K.api("POST", "/track/email-link", { ref: ref, email: email }, { token: false }).then(function (r) {
            btn.disabled = false;
            if (r.ok) { btn.hidden = true; err.className = "okmsg"; err.textContent = "Done. The link is on its way to the email you paid with."; }
            else err.textContent = K.why[r.reason] || "That did not work. Please try again.";
          });
        }
      });
      c.appendChild(btn); c.appendChild(err); after.appendChild(c);
    }
    document.title = "KAAL · No. " + K.pad(j.piece.n) + " · Follow your piece";
  }

  function ask(msg) {
    $("found").hidden = true; $("ask").hidden = false;
    $("err").textContent = msg || "";
    $("go").disabled = false;
  }

  $("form").addEventListener("submit", function (e) {
    e.preventDefault();
    var ref = $("ref").value.trim(), email = $("email").value.trim();
    if (!ref || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { $("err").textContent = "Enter the order reference and the email you paid with."; return; }
    $("go").disabled = true; $("err").textContent = "";
    K.api("POST", "/track/lookup", { ref: ref, email: email }, { token: false }).then(function (j) {
      if (j.ok) { show(j, false, ref, email); return; }
      ask(j.reason === "nomatch" ? "We could not find an order with that reference and email. Check both, or write to connect@thekaal.co." : (K.why[j.reason] || "That did not work. Please try again."));
    });
  });

  if (q.o && q.s) {
    K.api("GET", "/track/data?o=" + encodeURIComponent(q.o) + "&s=" + encodeURIComponent(q.s), undefined, { token: false }).then(function (j) {
      if (j.ok) show(j, true); else ask(j.reason === "link" ? "That link is not valid. Enter your order reference and email instead." : (K.why[j.reason] || "That did not work. Please try again."));
    });
  }
})();
