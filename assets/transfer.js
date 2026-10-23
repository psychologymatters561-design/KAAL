/* /claim/transfer: the owner of a piece passes it on; this is the other
   person accepting it. A code from the watch's owner, an email proved with
   a six digit code, and their own acceptance. */
(function () {
  "use strict";
  var K = window.KAALO, $ = K.$, CODE = "", INFO = null;

  function step(n) { ["s1", "s2", "s3"].forEach(function (s, i) { $(s).hidden = i !== n - 1; }); window.scrollTo(0, 0); }

  $("fCode").addEventListener("submit", function (e) {
    e.preventDefault();
    CODE = $("code").value.trim(); $("e1").textContent = ""; $("go1").disabled = true;
    K.api("POST", "/o/transfer/lookup", { code: CODE }, { token: false }).then(function (r) {
      $("go1").disabled = false;
      if (!r.ok) { $("e1").textContent = r.why || K.why[r.reason] || "That did not work. Please try again."; return; }
      INFO = r; show(r);
    });
  });

  function show(r) {
    var n = K.pad(r.piece.n), p = K.clear($("piece"));
    p.appendChild(K.face(r.piece));
    var no = K.el("p", "no"); no.appendChild(document.createTextNode("No. " + n + " ")); no.appendChild(K.el("small", "", "of " + r.piece.size)); p.appendChild(no);
    p.appendChild(K.el("p", "sub", r.piece.series + " · " + r.piece.colorway));
    $("title").textContent = "Accept No. " + n;
    $("lead").textContent = "You would be Owner " + K.roman(r.ownerNo) + " of No. " + n + ". Its warranty stays with the piece and runs until " + K.day(r.warrantyEndDay) + "; it does not start again.";
    var nt = K.clear($("notice")); nt.appendChild(K.el("b", "", "Nothing changes until you accept. "));
    nt.appendChild(document.createTextNode("The seven day return option belongs to the first purchase and does not pass on. Your record, your warranty and your dashboard begin the day it is approved."));
    $("acceptText").textContent = "I accept No. " + n + " as its next owner.";
    $("go2").textContent = "Accept No. " + n;
    step(2);
  }
  $("back").addEventListener("click", function () { step(1); });

  $("send").addEventListener("click", function () {
    var b = $("send"); b.disabled = true; $("sendMsg").textContent = "";
    K.api("POST", "/o/transfer/email-code", { code: CODE, email: $("email").value.trim() }, { token: false }).then(function (r) {
      b.disabled = false;
      $("sendMsg").textContent = r.ok ? "Sent. It works for ten minutes." : (r.reason === "invalid-email" ? "That does not look like an email address." : r.reason === "invalid" ? "That code is no longer valid." : K.why.rate);
    });
  });

  $("reg").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("e2"); err.textContent = ""; $("go2").disabled = true;
    K.api("POST", "/o/transfer/accept", { code: CODE, email: $("email").value.trim(), emailCode: $("ecode").value, name: $("name").value, phone: $("phone").value,
      city: $("city").value, state: $("state").value, accept: $("accept").checked, consent: $("consent").checked, showCity: $("showCity").checked }, { token: false }).then(function (r) {
      $("go2").disabled = false;
      if (!r.ok) {
        err.textContent = r.why || K.why[r.reason] || "That did not work. Please try again.";
        var f = { name: "name", phone: "phone", email: "email", accept: "accept", consent: "consent", "email-code": "ecode" }[r.reason]; if (f && $(f)) $(f).focus();
        if (r.reason === "invalid") step(1);
        return;
      }
      K.token(r.token);
      $("doneH").textContent = r.completed ? "No. " + K.pad(r.n) + " is recorded in your name" : "Thank you. It is with us.";
      $("doneP").textContent = r.completed ? "You are its next owner. Your dashboard is ready." : "We approve each transfer by hand, usually within a day. We will email you the moment No. " + K.pad(r.n) + " is recorded in your name.";
      step(3);
    });
  });
})();
