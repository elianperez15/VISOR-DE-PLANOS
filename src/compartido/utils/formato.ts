/* ──────────────────────────────────────────────────────────────────────
   formato.ts — Cómo se escriben números y fechas en todo el visor

   UN SOLO SITIO. Antes cada módulo llamaba a toLocaleString('es'), que es la
   convención de ESPAÑA: coma decimal y sin separador de miles (1234,568).
   Guatemala usa punto decimal y coma para los miles (1,234.568), igual que
   México y Estados Unidos.

   Se puede cambiar sin tocar código con VITE_LOCALE en .env.production
   (por ejemplo 'es-ES' si algún día el visor se usa desde España).
   ────────────────────────────────────────────────────────────────────── */

/** Convención regional de números y fechas. Guatemala por defecto. */
export const LOCALE = import.meta.env.VITE_LOCALE || 'es-GT';

/**
 * Número con la convención local.
 * @param decimals  máximo de decimales (por defecto 3)
 * @param fixed     fuerza ese número exacto de decimales (coordenadas, importes)
 */
export function numero(value: number, decimals = 3, fixed = false): string {
  return value.toLocaleString(LOCALE, {
    maximumFractionDigits: decimals,
    ...(fixed ? { minimumFractionDigits: decimals } : {}),
  });
}

/**
 * Fecha y hora con la convención local.
 *
 * `hour12: false` a propósito: es-GT usaría "02:30 p. m." y en una tabla de
 * marcas o en un tooltip el formato de 24 h es más corto y más fácil de
 * comparar de un vistazo.
 */
export function fechaHora(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
