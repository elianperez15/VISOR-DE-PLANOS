/* ──────────────────────────────────────────────────────────────────────
   ords.ts — Utilidades para hablar con los handlers ORDS

   Los handlers reciben sus parámetros como HTTP HEADERS (binds :id,
   :codigo_proyecto, …) y los listados responden { items: [...] }.
   ────────────────────────────────────────────────────────────────────── */

/** Arma los headers de una petición ORDS omitiendo los valores vacíos. */
export function ordsHeaders(values: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value != null && String(value).trim() !== '') headers[key] = String(value).trim();
  }
  return headers;
}

/** GET de un listado ORDS → sus `items` (vacío si el servidor responde con error). */
export async function fetchOrdsItems(url: string, headers: Record<string, string>): Promise<any[]> {
  const res = await fetch(url, { credentials: 'include', headers });
  return res.ok ? ((await res.json()).items || []) : [];
}
