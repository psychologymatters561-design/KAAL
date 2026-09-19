/* ══════════════════════════════════════════════════════════════════
   THE STORE. One adapter over Workers KV, and the only file in this
   worker that knows a key is a string with a prefix on it.

   Two reasons it is worth its own file.

   ONE: KV IS OPTIONAL AND MUST STAY OPTIONAL. Without the namespace
   bound, the webhook still records sales — the commit is the record,
   the store is an accelerator. `open()` returns a null object whose
   every method answers "no opinion" rather than throwing, so no handler
   above ever writes `if (env.KAAL_STATE)`. That check existed in six
   places before this file did, and the seventh was going to be the one
   somebody forgot.

   TWO: EVERY WRITE IS A COST. The free tier is a thousand writes a day
   and /hold is public. Counting them means having one place that does
   them; a handler reaching into KV directly is a handler that can spend
   the budget without anyone being able to find out where it went.
   ══════════════════════════════════════════════════════════════════ */

const KEY_SOLD     = "sold";
const HOLD_PREFIX  = "hold:";
const SEEN_PREFIX  = "seen:";
const ALERT_PREFIX = "alert:";
const RATE_PREFIX  = "rl:";

export const HOLD_SECONDS = 12 * 60;
const SEEN_TTL  = 24 * 60 * 60;
const ALERT_TTL = 30 * 24 * 60 * 60;

/* Every method swallows its own failures on purpose. A store having a
   bad afternoon must degrade the page, never close the shop. */
const quiet = async (p, fallback) => { try { return await p; } catch (e) { return fallback; } };

export function open(env) {
  const kv = env && env.KAAL_STATE;
  if (!kv) return absent();

  return {
    available: true,

    /* null means "no opinion", which is different from []. The page only
       ever ADDS numbers from this, so a null can never un-sell a watch. */
    readSold: async () => {
      const v = await quiet(kv.get(KEY_SOLD, "json"), null);
      return Array.isArray(v) ? v : null;
    },
    saveSold: (numbers) => quiet(kv.put(KEY_SOLD, JSON.stringify([...numbers].sort((a, b) => a - b))), undefined),

    listHeldNumbers: async () => {
      const list = await quiet(kv.list({ prefix: HOLD_PREFIX }), { keys: [] });
      return list.keys
        .map(k => parseInt(k.name.slice(HOLD_PREFIX.length), 10))
        .filter(n => !isNaN(n));
    },
    getHold:  (n) => quiet(kv.get(HOLD_PREFIX + n, "json"), null),
    putHold:  (n, hold) => quiet(kv.put(HOLD_PREFIX + n, JSON.stringify(hold), { expirationTtl: HOLD_SECONDS }), undefined),
    dropHold: (n) => quiet(kv.delete(HOLD_PREFIX + n), undefined),

    /* A Razorpay signature stays valid for its body forever, so a body
       anyone ever holds replays forever unless something remembers it. */
    hasSeen:  async (eventId) => !!eventId && (await quiet(kv.get(SEEN_PREFIX + eventId.slice(0, 64)), null)) !== null,
    remember: (eventId) => eventId ? quiet(kv.put(SEEN_PREFIX + eventId.slice(0, 64), "1", { expirationTtl: SEEN_TTL }), undefined) : undefined,

    /* Alerts are the only output of this worker a person reads. */
    alert: (payload) => {
      const id = `${payload.kind}:${payload.payment || Date.now()}`.slice(0, 96);
      return quiet(kv.put(ALERT_PREFIX + id, JSON.stringify(payload), { expirationTtl: ALERT_TTL }), undefined);
    },
    listAlerts: async () => {
      const list = await quiet(kv.list({ prefix: ALERT_PREFIX }), { keys: [] });
      const out = [];
      for (const k of list.keys) {
        const v = await quiet(kv.get(k.name, "json"), null);
        if (v) out.push(v);
      }
      return out.sort((a, b) => (b.at || 0) - (a.at || 0));
    },

    /* Incremented only when a real hold write is about to happen, so it
       can never cost more writes than it saves. */
    countHoldsFrom: async (ip, window) => {
      if (!ip) return { count: 0, bump: async () => {} };
      const key = RATE_PREFIX + ip;
      const seen = await quiet(kv.get(key, "json"), null);
      const count = seen && typeof seen.n === "number" ? seen.n : 0;
      return { count, bump: () => quiet(kv.put(key, JSON.stringify({ n: count + 1 }), { expirationTtl: window }), undefined) };
    }
  };
}

/* The same shape, answering "I do not know" to everything. No caller
   needs to ask whether the store is there. */
function absent() {
  return {
    available: false,
    readSold: async () => null,
    saveSold: async () => {},
    listHeldNumbers: async () => [],
    getHold: async () => null,
    putHold: async () => {},
    dropHold: async () => {},
    hasSeen: async () => false,
    remember: async () => {},
    alert: async () => {},
    listAlerts: async () => [],
    countHoldsFrom: async () => ({ count: 0, bump: async () => {} })
  };
}
