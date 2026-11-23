/* ──────────────────────────────────────────────────────────────────────
   plans-api.ts — Planos del repositorio documental (ORDS)
   ────────────────────────────────────────────────────────────────────── */
import { API_PLANOS } from '../app/config';
import { fetchOrdsItems, ordsHeaders } from '../compartido/ords';

/**
 * Headers del endpoint ORDS 'documento': espera el id y el nombre como HTTP
 * HEADERS. El nombre se codifica (encodeURIComponent) porque los headers solo
 * admiten ISO-8859-1: acentos/ñ/… reventarían con "non ISO-8859-1 code point".
 */
export function documentHeaders(repoId: string | number, name?: string | null): Record<string, string> {
  const headers: Record<string, string> = { id: String(repoId) };
  if (name) headers.nombre = encodeURIComponent(String(name));
  return headers;
}

/**
 * Planos del proyecto, SIN el plano actual (su id va en el header `id` para
 * excluirlo del listado). GET → { items: [ { display, id_en_repositorio, nombre_archivo } ] }
 */
export async function fetchPlanos(currentDocId: string | null, projectCode: string | null): Promise<any[]> {
  const items = await fetchOrdsItems(API_PLANOS, ordsHeaders({ id: currentDocId, codigo_proyecto: projectCode }));
  return items.filter(p => p.id_en_repositorio != null);
}

/** Fila del selector de planos (list-picker). */
export function planoRow(p: any): { value: string; label: string } {
  return {
    value: String(p.id_en_repositorio),
    label: String(p.display || p.nombre_archivo || `Plano ${p.id_en_repositorio}`),
  };
}
