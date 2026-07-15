/* ──────────────────────────────────────────────────────────────────────
   user-colors.ts — Color determinístico por usuario (atribución de marcas)

   Asigna a cada autor uno de N colores fijos según el hash de su nombre,
   para identificarlo de forma consistente en cursores, marcas y presencia.
   ────────────────────────────────────────────────────────────────────── */

/** Paleta de 12 colores determinísticos para identificar autores. */
export const USER_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#14b8a6',
  '#a855f7', '#64748b',
];

/** Color gris neutro para usuarios sin identificar. */
const ANON_COLOR = '#64748b';

function hashUser(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i);
  return Math.abs(h) % USER_COLORS.length;
}

/** Devuelve el color asignado a un usuario (estable para el mismo nombre). */
export function getUserColor(name: string): string {
  if (!name || name === 'Anónimo') return ANON_COLOR;
  return USER_COLORS[hashUser(name)];
}
