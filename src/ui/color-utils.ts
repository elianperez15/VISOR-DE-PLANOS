/* ──────────────────────────────────────────────────────────────────────
   color-utils.ts — Conversión de colores para la sección "Apariencia"
   Funciones puras (sin estado ni DOM).
   ────────────────────────────────────────────────────────────────────── */

const DEFAULT_COLOR = '#ef4444';
const DEFAULT_FILL_ALPHA = 0.15;

/** Normaliza cualquier color CSS (#rgb, #rrggbb, rgb(), rgba()) a #rrggbb. */
export function colorToHex(color: any): string {
  if (!color) return DEFAULT_COLOR;
  const cssColor = String(color);
  if (cssColor[0] === '#') {
    const isShortHex = cssColor.length === 4;
    return isShortHex
      ? '#' + cssColor[1] + cssColor[1] + cssColor[2] + cssColor[2] + cssColor[3] + cssColor[3]
      : cssColor.slice(0, 7);
  }
  const rgbMatch = cssColor.match(/rgba?\(([^)]+)\)/);
  if (!rgbMatch) return DEFAULT_COLOR;
  const [red, green, blue] = rgbMatch[1].split(',').map((channel: string) => parseInt(channel, 10));
  return '#' + [red, green, blue].map((channel: number) => (channel | 0).toString(16).padStart(2, '0')).join('');
}

/** Extrae el alpha de un color rgba() (o 1 si es hex, 0.15 por defecto). */
export function extractFillAlpha(color: any): number {
  const alphaMatch = String(color || '').match(/rgba\([^)]+,\s*([\d.]+)\s*\)/);
  if (alphaMatch) return parseFloat(alphaMatch[1]);
  const isHex = String(color || '')[0] === '#';
  return isHex ? 1 : DEFAULT_FILL_ALPHA;
}

/** Convierte #hex + alpha a rgba(). */
export function hexToRgba(hex: string, alpha: number): string {
  let normalizedHex = hex.replace('#', '');
  if (normalizedHex.length === 3) {
    normalizedHex = normalizedHex.split('').map(channel => channel + channel).join('');
  }
  const red = parseInt(normalizedHex.slice(0, 2), 16);
  const green = parseInt(normalizedHex.slice(2, 4), 16);
  const blue = parseInt(normalizedHex.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}
