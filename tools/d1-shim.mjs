/* ══════════════════════════════════════════════════════════════════
   Stand-ins for the worker's bindings, for the tests in tools/.

   d1()  Cloudflare D1, as far as the worker uses it (prepare, bind,
         first, all, run), on Node's own SQLite (node:sqlite, Node 22.13
         and later), with every migration in migrations/ applied.
   kv()  Workers KV: get (text, json, arrayBuffer), getWithMetadata, put
         (with metadata), delete, list by prefix.
   ctx() an execution context whose waitUntil work can be awaited.

   Node's standard library only. ══════════════════════════════════ */
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function d1() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const plain = (r) => (r ? Object.assign({}, r) : null);
  return {
    raw: db,
    prepare(sql) {
      const st = db.prepare(sql);
      let args = [];
      const s = {
        bind(...a) { args = a.map(v => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v)); return s; },
        async first() { return plain(st.get(...args)); },
        async all() { return { results: st.all(...args).map(plain) }; },
        async run() { const r = st.run(...args); return { success: true, meta: { changes: r.changes } }; }
      };
      return s;
    }
  };
}

export function kv() {
  const store = new Map(), meta = new Map(), ttl = new Map();
  const read = (v, t) => v === null || v === undefined ? null
    : t === "json" ? JSON.parse(v) : t === "arrayBuffer" ? (v instanceof ArrayBuffer ? v : new TextEncoder().encode(v).buffer) : v;
  return {
    store, meta, ttl,
    async get(k, t) { return read(store.has(k) ? store.get(k) : null, t); },
    async getWithMetadata(k, t) { return { value: read(store.has(k) ? store.get(k) : null, t), metadata: meta.get(k) || null }; },
    async put(k, v, o) { store.set(k, v); ttl.set(k, o && o.expirationTtl); if (o && o.metadata) meta.set(k, o.metadata); },
    async delete(k) { store.delete(k); meta.delete(k); ttl.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; }
  };
}

export function ctx() { const jobs = []; return { jobs, waitUntil: p => jobs.push(p), done: () => Promise.all(jobs) }; }
