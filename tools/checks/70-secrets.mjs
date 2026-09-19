/* Nothing that looks like a credential, in any file that ships or
   deploys. A secret in git history is not deletable in any way you will
   trust afterwards, so the only useful moment is before the commit. */
export const title = "secrets";

import { readdirSync } from "node:fs";

const PATTERNS = [
  ["GitHub token",      /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ["Razorpay key",      /\brzp_(live|test)_[A-Za-z0-9]{10,}/],
  ["AWS key",           /\bAKIA[0-9A-Z]{16}\b/],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  /* Razorpay's key secret and webhook secret have no fixed prefix, so
     the only honest check is "a secret-shaped value assigned to a name
     that says secret". It will nag about a placeholder one day; that is
     a far better failure than the other one. */
  ["hardcoded secret",  /\b(secret|token|password|passwd|api[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_\-\/+=]{16,}["']/i],
  ["Stripe key",        /\bsk_(live|test)_[A-Za-z0-9]{16,}/],
  ["Slack token",       /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["Google API key",    /\bAIza[0-9A-Za-z_\-]{35}\b/]
];

export default function ({ root, pages, exists, read, bad }) {
  /* The worker is a directory now, so it is walked rather than named —
     a new file in worker/lib/ must not be able to opt out of this by
     existing. */
  const workerFiles = [];
  const walk = (dir) => {
    for (const e of readdirSync(root + "/" + dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(dir + "/" + e.name);
      else if (e.name.endsWith(".js")) workerFiles.push(dir + "/" + e.name);
    }
  };
  if (exists("worker")) walk("worker");

  for (const f of [...pages, ...workerFiles, "wrangler.toml", "README.md", ".github/workflows/check.yml"]) {
    if (!exists(f)) continue;
    const t = read(f);
    for (const [name, re] of PATTERNS) if (re.test(t)) bad(`${f} looks like it contains a ${name}`);
  }
}
