/* ──────────────────────────────────────────────────────────────────────
   rfi-api.ts — RFIs del proyecto (ORDS)
   ────────────────────────────────────────────────────────────────────── */
import { API_RFI } from '../app/config';
import { fetchOrdsItems, ordsHeaders } from '../compartido/ords';

/** RFIs del proyecto. GET → { items: [ { id, display, … } ] } */
export function fetchRfis(projectCode: string | null): Promise<any[]> {
  return fetchOrdsItems(API_RFI, ordsHeaders({ codigo_proyecto: projectCode }));
}

/** Fila del selector de RFI (list-picker). */
export function rfiRow(it: any): { value: string; label: string } {
  return {
    value: String(it.id ?? it.ID ?? ''),
    label: String(it.display ?? it.DISPLAY ?? it.nombre ?? (it.id ?? '')),
  };
}
