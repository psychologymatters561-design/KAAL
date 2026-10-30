#!/usr/bin/env node
/* Seal an owner's email to the worker's own key, for worker/house.js, so
   the address can sit in this public repository and only the worker can
   read it. Prints the entry to paste into HOUSE.

     node tools/seal-email.mjs <number> <email>

   ECDH P-256 with a one-time key, HKDF-SHA-256 ("kaal owner address"),
   AES-256-GCM: the same steps worker/house.js (openBox) reverses with the
   private half, which never leaves the worker's store. tools/ops-key.json
   is the public half, written there by the deploy. */
import { readFileSync } from "node:fs";
import { webcrypto as C, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function seal(pubJwk, text) {
  const ALG = { name: "ECDH", namedCurve: "P-256" };
  const worker = await C.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: pubJwk.x, y: pubJwk.y, ext: true }, ALG, false, []);
  const once = await C.subtle.generateKey(ALG, true, ["deriveBits"]);
  const shared = await C.subtle.deriveBits({ name: "ECDH", public: worker }, once.privateKey, 256);
  const hk = await C.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await C.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("kaal owner address") },
    hk, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = C.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await C.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(text)));
  const e = await C.subtle.exportKey("jwk", once.publicKey);
  const b64 = (u) => Buffer.from(u).toString("base64url");
  return b64(Buffer.from(JSON.stringify({ e: { x: e.x, y: e.y }, iv: b64(iv), c: b64(c) })));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [n, raw] = process.argv.slice(2);
  const email = String(raw || "").trim().toLowerCase();
  if (!(+n >= 1 && +n <= 20) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("Usage: node tools/seal-email.mjs <number> <email>"); process.exit(1); }
  const pub = JSON.parse(readFileSync(new URL("ops-key.json", import.meta.url), "utf8"));
  const box = await seal(pub, email);
  const h = createHash("sha256").update(email).digest("hex");
  console.log(`  { n: ${+n}, h: "${h}",\n    box: "${box}" },`);
}
