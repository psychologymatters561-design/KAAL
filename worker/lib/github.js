/* ══════════════════════════════════════════════════════════════════
   GITHUB, AS A PLACE THAT HOLDS ONE FILE.

   The contents API in two functions. Nothing above this line knows
   about base64, shas, or the fact that a 409 means somebody committed
   first — and nothing in here knows what a watch is.

   THE TOKEN THIS USES CAN WRITE THIS REPOSITORY. GitHub has no scope
   for "one line of one file", so the bound is enforced elsewhere:
   tools/check-autocommit.mjs fails CI within a minute if a commit
   wearing this worker's name touched anything but the sold array.
   ══════════════════════════════════════════════════════════════════ */

const headers = (env) => ({
  "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
  "Accept": "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "kaal-edition-worker"
});

const contentsUrl = (env) =>
  `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/index.html`;

export async function fetchPage(env) {
  const branch = env.GITHUB_BRANCH || "main";
  const res = await fetch(`${contentsUrl(env)}?ref=${encodeURIComponent(branch)}`, { headers: headers(env) });
  if (!res.ok) {
    console.log("GitHub GET failed:", res.status, (await res.text()).slice(0, 300));
    return { ok: false };
  }
  const file = await res.json();
  /* Over a megabyte the contents API answers with an EMPTY `content` and
     no error. Decoding that gives an empty string, which would match no
     pattern and commit a blank storefront. */
  if (file.encoding !== "base64" || !file.content) {
    console.log("GitHub returned index.html in an unusable shape — encoding:", String(file.encoding));
    return { ok: false };
  }
  return { ok: true, source: atob(file.content.replace(/\n/g, "")), sha: file.sha };
}

export async function commitPage(env, { source, sha, message }) {
  const res = await fetch(contentsUrl(env), {
    method: "PUT",
    headers: Object.assign({ "Content-Type": "application/json" }, headers(env)),
    body: JSON.stringify({ message, content: btoa(source), sha, branch: env.GITHUB_BRANCH || "main" })
  });
  if (res.ok) return { ok: true };
  /* Two webhooks landing together both read the same sha and the second
     PUT is rejected. The caller re-reads and tries again; leaving it to
     Razorpay's retry schedule would be minutes instead of milliseconds. */
  if (res.status === 409) return { ok: false, conflict: true };
  console.log("GitHub PUT failed:", res.status, (await res.text()).slice(0, 300));
  return { ok: false };
}
