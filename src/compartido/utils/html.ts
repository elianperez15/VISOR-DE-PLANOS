/* ──────────────────────────────────────────────────────────────────────
   html.ts — Escapado de texto que se interpola en plantillas HTML

   Los nombres de autor, de adjuntos y de planos llegan de otros usuarios (o
   del servidor): nunca deben interpretarse como HTML.
   ────────────────────────────────────────────────────────────────────── */

/** Escapa `& < > " '` para insertar texto de forma segura en HTML (también en atributos). */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
