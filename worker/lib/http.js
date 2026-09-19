/* ══════════════════════════════════════════════════════════════════
   THE EDGE. Everything about being on the web, and nothing about
   watches.

   A handler in index.js should never build a header by hand. If it did,
   one response would eventually be missing nosniff, or would answer
   Access-Control-Allow-Origin: * on a bad afternoon, and nothing would
   say so. Every response this worker emits leaves through json() or
   text(), and those two are the only places the headers are decided.
   ══════════════════════════════════════════════════════════════════ */

/* A webhook body is a few kilobytes. Anything larger is somebody asking
   this worker to run HMAC-SHA256 over a megabyte for free — and the read
   happens BEFORE any signature is checked, so it is the one place an
   unauthenticated caller gets to choose how much work we do. */
export const MAX_BODY_BYTES = 64 * 1024;

export async function readBounded(request) {
  const declared = parseInt(request.headers.get("content-length") || "", 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return null;
  return body;
}

export function originList(env) {
  return (env.ALLOW_ORIGIN || "https://thekaal.co,https://www.thekaal.co")
    .split(",").map(s => s.trim()).filter(Boolean);
}

/* No Origin header at all is a curl, a health check, or Razorpay — none
   of which a CORS policy is for. An Origin this shop does not own is
   another site's page calling these routes in a visitor's browser, and
   that is what gets turned away. */
export function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return originList(env).indexOf(origin) > -1;
}

export function allowedOrigin(request, env) {
  const list = originList(env);
  const origin = request.headers.get("Origin") || "";
  return list.indexOf(origin) > -1 ? origin : list[0];
}

export function cors(request, env) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(request, env),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

/* This worker serves JSON and short strings to a browser. None of these
   headers change that; all of them remove a way to misread it. */
export function guard() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-site",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  };
}

export function preflight(request, env) {
  return new Response(null, { status: 204, headers: Object.assign({}, cors(request, env), guard()) });
}

export function json(request, env, body, extra, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" },
                           cors(request, env), guard(), extra || {})
  });
}

export function text(request, env, body, status, extra) {
  return new Response(body, {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "text/plain; charset=utf-8" },
                           cors(request, env), guard(), extra || {})
  });
}
