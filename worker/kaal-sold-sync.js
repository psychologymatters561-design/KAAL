/* ══════════════════════════════════════════════════════════════════
   KAAL — sold-number sync worker.

   THE PROBLEM THIS CLOSES: index.html is a static site with no backend.
   `KAAL.sold` only ever changes when Arjun edits it by hand and pushes.
   Between a real sale landing and that push, the site is telling every
   other visitor a number is available when it is not — two people can
   pick the same number, pay, and only one watch exists. Razorpay's own
   stock-limit-20 stops the 21st sale; it does nothing about two people
   both landing on "07".

   THE FIX: Razorpay fires a webhook the instant a payment is captured.
   This worker verifies that webhook is genuinely from Razorpay, reads
   which number the buyer chose out of the payment's notes, and commits
   the updated `sold` array straight to index.html on GitHub. GitHub
   Pages rebuilds automatically. The gap between a sale and the site
   telling the truth about it drops from "whenever Arjun notices" to
   roughly the time it takes GitHub to rebuild a static page — seconds,
   not hours.

   WHAT THIS DOES NOT DO: it does not build you a database, a cart, or
   an inventory system. It edits one line of one file, because that is
   the entire footprint of "sold" in this codebase. Anything more than
   that would be solving a problem this site does not have.
   ══════════════════════════════════════════════════════════════════ */

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("KAAL sold-sync worker is alive.", { status: 200 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature") || "";

    const validSignature = await verifySignature(
      rawBody,
      signature,
      env.RAZORPAY_WEBHOOK_SECRET
    );
    if (!validSignature) {
      return new Response("Signature mismatch.", { status: 400 });
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (e) {
      return new Response("Bad JSON.", { status: 400 });
    }
    if (event.event !== "payment.captured") {
      return new Response("Ignored: " + event.event, { status: 200 });
    }

    const notes = event?.payload?.payment?.entity?.notes || {};
    const raw = notes.kaal_no;
    const chosen = parseInt(raw, 10);

    if (!raw || isNaN(chosen) || chosen < 1 || chosen > 20) {
      console.log("payment.captured with no usable kaal_no:", raw);
      return new Response("Captured but no valid kaal_no — check manually.", { status: 200 });
    }

    const owner  = env.GITHUB_OWNER;
    const repo   = env.GITHUB_REPO;
    const branch = env.GITHUB_BRANCH || "main";
    const path   = "index.html";
    const api    = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const ghHeaders = {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "kaal-sold-sync-worker"
    };

    const getRes = await fetch(`${api}?ref=${branch}`, { headers: ghHeaders });
    if (!getRes.ok) {
      console.log("GitHub GET failed:", getRes.status, await getRes.text());
      return new Response("Could not read index.html from GitHub.", { status: 502 });
    }
    const file = await getRes.json();
    const decoded = atob(file.content.replace(/\n/g, ""));

    const soldPattern = /sold:\s*\[([^\]]*)\]/;
    const match = decoded.match(soldPattern);
    if (!match) {
      console.log("Could not find `sold:` array — has index.html's config shape changed?");
      return new Response("sold: pattern not found in index.html.", { status: 500 });
    }

    const currentSold = match[1]
      .split(",")
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n));

    if (currentSold.includes(chosen)) {
      return new Response(`Number ${chosen} already recorded as sold. No change made.`, { status: 200 });
    }

    const updatedSold = [...currentSold, chosen].sort((a, b) => a - b);
    const updatedContent = decoded.replace(
      soldPattern,
      `sold:     [${updatedSold.join(", ")}]`
    );

    const putRes = await fetch(api, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Auto: mark number ${chosen} sold (payment ${event.payload.payment.entity.id})`,
        content: btoa(updatedContent),
        sha: file.sha,
        branch
      })
    });

    if (!putRes.ok) {
      const errBody = await putRes.text();
      console.log("GitHub PUT failed:", putRes.status, errBody);
      return new Response("GitHub commit failed: " + errBody, { status: 502 });
    }

    console.log(`Number ${chosen} marked sold. GitHub Pages will rebuild shortly.`);
    return new Response(`OK — number ${chosen} recorded as sold.`, { status: 200 });
  }
};

async function verifySignature(body, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === signatureHeader;
}

/* ══════════════════════════════════════════════════════════════════
   SETUP — do this once, after your Razorpay Payment Page is live.

   1. Free Cloudflare account. Install wrangler (`npm i -g wrangler`) or
      paste this file into the dashboard's Quick Edit — no build step.

   2. Set four secrets on the worker:
        RAZORPAY_WEBHOOK_SECRET   from Razorpay Dashboard -> Webhooks
        GITHUB_TOKEN              fine-grained PAT, scoped ONLY to the
                                   KAAL repo, Contents: Read and write.
        GITHUB_OWNER              psychologymatters561-design
        GITHUB_REPO               KAAL

   3. In Razorpay Dashboard -> Webhooks, add an endpoint pointing at the
      deployed worker's URL, subscribe to `payment.captured`, use the
      same secret as RAZORPAY_WEBHOOK_SECRET. Razorpay shows the secret
      once, at creation — save it immediately.

   4. On the Payment Page, confirm the custom field capturing the chosen
      number is literally named `kaal_no`. That is the only reason this
      chain works.

   5. Send one real ₹1 test transaction before trusting this with a real
      ₹5,999 one. Watch `wrangler tail`, watch the commit land, watch the
      live site's count move. Do this before turning Meta ads on.
   ══════════════════════════════════════════════════════════════════ */
