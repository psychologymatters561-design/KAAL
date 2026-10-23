/* ══════════════════════════════════════════════════════════════════
   THE PUBLIC REGISTRY, its data (registry, Phase 5): GET /registry/data.

   What thekaal.co/registry shows, and nothing else. It reads the one
   public view (public_registry: safe columns only) and the service lines
   an owner of the shop chose to publish. Never a name, email, phone or
   street. A city only where its owner ticked the box. A photograph only for
   a piece that has gone, since the others are not yet anyone's.

   It is read live, with ten seconds of cache, so a sale or a registration
   shows without anything being deployed. The shop's own number grid reads
   the same table (through /state), so a number shown sold here can never be
   bought there.
   ══════════════════════════════════════════════════════════════════ */
import { registryOn, SERIES } from "./registry.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/* "2026-10" as the registry writes it. */
export const since = (ym) => { const m = /^(\d{4})-(\d{2})$/.exec(ym || ""); return m ? `${MON[+m[2] - 1]} ${m[1]}` : ""; };

export async function registryData(env, series) {
  const code = series || SERIES;
  const s = await env.DB.prepare("SELECT name, size, retired_at FROM series WHERE code = ?1").bind(code).first();
  const rows = (await env.DB.prepare(
    "SELECT number, colorway, photo_url, state, owner_no, owner_since, owner_city FROM public_registry WHERE series = ?1 ORDER BY number"
  ).bind(code).all()).results || [];
  const lines = (await env.DB.prepare(
    "SELECT p.number, l.date, l.public_line FROM service_log l JOIN pieces p ON p.id = l.piece_id WHERE p.series = ?1 AND l.public_line IS NOT NULL AND l.public_line != '' ORDER BY l.date, l.id"
  ).bind(code).all()).results || [];
  const service = {};
  for (const l of lines) (service[l.number] = service[l.number] || []).push({ date: l.date, line: l.public_line });
  const pieces = rows.map(r => {
    const gone = r.state === "sold" || r.state === "stolen";
    return {
      n: r.number, colorway: r.colorway, state: r.state,
      photo: gone && r.photo_url ? r.photo_url : null,
      /* A sold piece nobody has registered yet has no owner to describe. */
      owner: r.owner_no ? { no: r.owner_no, since: since(r.owner_since), city: r.owner_city || null } : null,
      service: gone ? service[r.number] || [] : []
    };
  });
  const gone = pieces.filter(p => p.state === "sold" || p.state === "stolen").length;
  return {
    ok: true, now: Date.now(),
    series: { code, name: s ? s.name : "Series 01", size: s ? s.size : pieces.length,
      retired: !!(s && s.retired_at) || (pieces.length > 0 && gone === pieces.length) },
    pieces
  };
}

export async function registryRoute(request, env, deps) {
  if (!registryOn(env)) return deps.json(request, env, { ok: false, reason: "off" }, { "Cache-Control": "no-store" }, 503);
  try { return deps.json(request, env, await registryData(env), { "Cache-Control": "public, max-age=10" }); }
  catch (e) { console.log("Registry data failed:", String(e).slice(0, 160)); return deps.json(request, env, { ok: false, reason: "error" }, { "Cache-Control": "no-store" }, 500); }
}
