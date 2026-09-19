/* ══════════════════════════════════════════════════════════════════
   A Cloudflare Worker, run on your laptop.

   The worker's only contract with the outside world is `fetch(Request,
   env) -> Response`. Everything else it touches — KV, the GitHub
   contents API — reaches it through `env` and global `fetch`. That is
   not an accident of the platform; it is the reason this file can exist
   at eighty lines and no test below needs a network, a Cloudflare
   account, or a mocking library.

   Keep it that way. The day a module here reaches for a global that is
   not passed in, this harness stops being able to hold it still, and
   the tests stop being able to tell you anything.
   ══════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PAGE = readFileSync(join(ROOT, "index.html"), "utf8");
export const SECRET = "whsec_test_only_never_a_real_one";

/* Workers give you atob/btoa; Node gives you Buffer. */
globalThis.atob = (s) => Buffer.from(s, "base64").toString("binary");
globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");

/* An in-memory KV with the same surface the real one exposes. */
export function makeKV() {
  const m = new Map();
  return {
    _map: m,
    writes: 0,
    get: async function (k, t) { const v = m.get(k); return v === undefined ? null : (t === "json" ? JSON.parse(v) : v); },
    put: async function (k, v) { this.writes++; m.set(k, v); },
    delete: async function (k) { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) })
  };
}

/* A GitHub contents API that serves the real index.html and records
   what would have been committed. */
export function makeGitHub(page = PAGE) {
  const state = { commits: [], failNext: null, conflictOnce: false };
  globalThis.fetch = async (url, init) => {
    if (state.failNext) { const s = state.failNext; state.failNext = null; return new Response("nope", { status: s }); }
    if (!init || init.method !== "PUT")
      return new Response(JSON.stringify({
        content: Buffer.from(page, "binary").toString("base64"), sha: "deadbeef", encoding: "base64"
      }), { status: 200 });
    if (state.conflictOnce) { state.conflictOnce = false; return new Response("conflict", { status: 409 }); }
    state.commits.push(JSON.parse(init.body));
    return new Response("{}", { status: 200 });
  };
  return state;
}

export function makeEnv(kv, over = {}) {
  return Object.assign({
    RAZORPAY_WEBHOOK_SECRET: SECRET,
    GITHUB_OWNER: "owner", GITHUB_REPO: "repo", GITHUB_TOKEN: "token",
    EDITION: "20", ALLOW_ORIGIN: "https://thekaal.co", ALERT_TOKEN: "alerttoken",
    KAAL_STATE: kv
  }, over);
}

export async function sign(body, secret = SECRET) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const m = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body));
  return [...new Uint8Array(m)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export const captured = (amount, n, id, over = {}) => JSON.stringify({
  event: "payment.captured",
  payload: { payment: { entity: Object.assign({ id, amount, currency: "INR", status: "captured", notes: { kaal_no: String(n) } }, over) } }
});

let eventSeq = 0;
export async function post(worker, env, body, opts = {}) {
  const sig = "sig" in opts ? opts.sig : await sign(body);
  const headers = { "x-razorpay-signature": sig, "x-razorpay-event-id": opts.eventId ?? `evt_${++eventSeq}` };
  if (opts.origin) headers.Origin = opts.origin;
  return worker.fetch(new Request("https://w.example" + (opts.path || "/"), { method: "POST", body, headers }), env);
}

export const get = (worker, env, path, headers = {}) =>
  worker.fetch(new Request("https://w.example" + path, { headers }), env);

export const hold = (worker, env, n, by, origin = "https://thekaal.co") =>
  worker.fetch(new Request("https://w.example/hold", {
    method: "POST", body: JSON.stringify({ n, by }),
    headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": "203.0.113.9" }
  }), env);
