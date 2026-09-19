/* ══════════════════════════════════════════════════════════════════
   THE SECURITY GATES.

   Everything here is a control that is worthless the moment somebody
   edits it out by accident, so each one is asserted rather than trusted.
   These are the checks that stand between a mistake and a buyer's
   money, which is a different category from a broken layout.
   ══════════════════════════════════════════════════════════════════ */
export const title = "security";

const MUST_HAVE = ["default-src 'none'", "base-uri 'none'", "object-src 'none'", "frame-src 'none'", "form-action 'none'"];

export default function ({ html, cfg, checkoutHosts, pages, read, exists, bad, soft }) {

  /* ── The checkout URL. A buyer clicking Claim leaves this site with
        their card; where they land is decided by this one string. The
        page refuses at runtime to link anywhere outside checkoutHosts —
        this refuses to deploy it at all, which is the half that happens
        before the traffic. ────────────────────────────────────────── */
  if (!checkoutHosts.length) bad("checkoutHosts is missing or empty — the page would refuse every checkout link");
  for (const h of checkoutHosts) {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) bad(`checkoutHosts contains "${h}", which is not a bare hostname`);
    if (h.split(".").length < 2) bad(`checkoutHosts entry "${h}" is too broad`);
  }
  if (cfg.checkout) {
    let u = null;
    try { u = new URL(cfg.checkout); } catch (e) { bad("checkout is not a valid URL"); }
    if (u) {
      if (u.protocol !== "https:") bad("checkout is not https — a payment link must never be plain http");
      if (!checkoutHosts.some(h => u.hostname === h || u.hostname.endsWith("." + h)))
        bad(`checkout points at ${u.hostname}, which is not in checkoutHosts — the live page will refuse to link to it`);
    }
  }

  /* ── The Content-Security-Policy. GitHub Pages sends no headers, so
        the meta tag is the entire policy; a page that loses it loses
        every restriction at once and looks exactly the same. ─────── */
  for (const f of pages) {
    const t = read(f);
    const csp = t.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
    if (!csp) { bad(`${f} has no Content-Security-Policy meta tag`); continue; }
    for (const d of MUST_HAVE) if (!csp.includes(d)) bad(`${f} CSP is missing ${d}`);
    if (/script-src[^;]*\bhttps?:(?!\/)/.test(csp) || /script-src[^;]*\*/.test(csp))
      bad(`${f} CSP allows scripts from a wildcard or a bare scheme`);
    if (!/window\.self !== window\.top/.test(t))
      bad(`${f} has no frame guard — frame-ancestors cannot be set from a meta tag, so the script is the only clickjacking defence`);
  }

  /* ── connect-src and the worker. The page's one cross-origin call is
        KAAL.api. Set it without naming its origin in the CSP and the
        browser blocks /state silently: the page keeps working on a
        stale sold array and nothing anywhere says why. ───────────── */
  if (cfg.api) {
    let a = null;
    try { a = new URL(cfg.api); } catch (e) { bad("api is set but is not a valid URL"); }
    if (a) {
      if (a.protocol !== "https:") bad("api is not https");
      const csp = html.match(/content="([^"]*connect-src[^"]*)"/)?.[1] ?? "";
      const connect = csp.match(/connect-src([^;]*)/)?.[1] ?? "";
      if (!connect.includes(a.origin))
        bad(`api is ${a.origin} but the CSP connect-src does not allow it — the live page would fail to read the edition state`);
    }
  }

  /* ── Outbound links and plain http. A target="_blank" without
        rel="noopener" hands the opened page a handle on this one. ── */
  for (const f of pages) {
    const t = read(f);
    for (const m of t.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g))
      if (!/rel="[^"]*noopener/.test(m[0])) bad(`${f} has a target="_blank" link without rel="noopener": ${m[0].slice(0, 80)}`);
    for (const m of t.matchAll(/(?:src|href)="(http:\/\/[^"]+)"/g))
      if (!m[1].startsWith("http://www.w3.org/")) bad(`${f} loads ${m[1]} over plain http`);
  }

  /* ── The worker's own money check. AMOUNT_CHECK=off is a documented
        escape hatch; it is not something that should ever be committed. */
  if (exists("wrangler.toml")) {
    const w = read("wrangler.toml");
    if (/^\s*AMOUNT_CHECK\s*=\s*["']off/mi.test(w))
      bad("wrangler.toml turns AMOUNT_CHECK off — any cheap payment on the Razorpay account could then mark a number sold");
    if (/RAZORPAY_WEBHOOK_SECRET\s*=/.test(w) || /GITHUB_TOKEN\s*=/.test(w) || /ALERT_TOKEN\s*=/.test(w))
      bad("wrangler.toml assigns a secret — secrets belong in `wrangler secret put`, never in a file that is committed");
    const main = w.match(/^\s*main\s*=\s*"([^"]+)"/m)?.[1];
    if (main && !exists(main)) bad(`wrangler.toml points main at ${main}, which does not exist — the deploy would fail`);
  }

  /* ── security.txt. A researcher who finds something and cannot find
        you posts it instead. ─────────────────────────────────────── */
  if (!exists(".well-known/security.txt")) soft("no .well-known/security.txt");
  else {
    const st = read(".well-known/security.txt");
    if (!/^Contact:/mi.test(st)) bad(".well-known/security.txt has no Contact: line");
    const exp = st.match(/^Expires:\s*(\S+)/mi)?.[1];
    if (!exp) bad(".well-known/security.txt has no Expires: line — RFC 9116 requires one");
    else if (new Date(exp) < new Date()) bad(`.well-known/security.txt expired on ${exp} — renew it`);
    else if (new Date(exp) - Date.now() < 30 * 864e5) soft(`.well-known/security.txt expires on ${exp}`);
  }
}
