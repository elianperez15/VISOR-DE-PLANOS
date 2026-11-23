/* ──────────────────────────────────────────────────────────────────────
   models-api.ts — Descarga del modelo 3D (IFC o .frag) desde el repositorio

   El modelo llega por el mismo camino que el PDF: GET a ORDS con `id` y
   `nombre` como HTTP headers (ver API_MODELO en app/config). Los errores se
   devuelven con la misma forma que los del PDF (pista legible + detalle
   técnico) para que el aviso del lienzo los muestre igual.
   ────────────────────────────────────────────────────────────────────── */
import type { LoadError } from '../plano/pdf-renderer';

export type ModelFormat = 'ifc' | 'frag';

/** ¿Este nombre de archivo es un modelo 3D? (si no, se abre como plano PDF) */
export function isModelFile(name?: string | null): boolean {
  return /\.(ifc|frag)$/i.test(String(name || '').split(/[?#]/)[0].trim());
}

/** Formato por el CONTENIDO: un IFC (STEP) siempre empieza por "ISO-10303-21". */
export function detectFormat(bytes: Uint8Array): ModelFormat {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 64)).trimStart();
  return head.startsWith('ISO-10303-21') ? 'ifc' : 'frag';
}

function loadError(pista: string, tecnico: string): LoadError {
  const e: LoadError = new Error(`${pista}\n\n${tecnico}`);
  e.pista   = pista;
  e.tecnico = tecnico;
  return e;
}

/**
 * Sube el .frag recién convertido para que el siguiente usuario no espere.
 *
 * Es OPORTUNISTA: si falla —el handler aún no existe, el archivo supera el
 * límite del proxy, no hay permiso— se registra y se sigue. El visor ya tiene
 * el modelo abierto; esto sólo beneficia a la próxima persona.
 *
 * @returns true si el servidor lo aceptó.
 */
export async function uploadFragments(
  url: string,
  repoId: string | number,
  name: string,
  frag: Uint8Array,
  version: string,
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/octet-stream',
        id: String(repoId),
        nombre: encodeURIComponent(name.replace(/\.ifc$/i, '') + '.frag'),
        version_fragments: version,
      },
      // fetch acepta el Uint8Array tal cual y respeta su offset y longitud:
      // pasar `frag.buffer` podría enviar bytes de más, y copiarlo con slice()
      // duplicaría decenas de MB en memoria sin ninguna necesidad.
      // El cast es por los tipos: desde TS 5.7 Uint8Array es genérico sobre su
      // buffer y no encaja en BodyInit, aunque fetch lo acepta sin problema.
      body: frag as unknown as BodyInit,
    });
    if (!res.ok) {
      console.warn(`[SAF] no se pudo guardar el .frag en el repositorio (HTTP ${res.status}). `
                 + 'El siguiente usuario volverá a convertirlo.');
      return false;
    }
    console.info('[SAF] .frag guardado en el repositorio: la próxima apertura será inmediata.');
    return true;
  } catch (e: any) {
    console.warn('[SAF] no se pudo guardar el .frag en el repositorio:', e?.message || e);
    return false;
  }
}

/** Descarga el modelo. Lanza un LoadError con un motivo legible si algo falla. */
export async function fetchModel(url: string, headers: Record<string, string> | null): Promise<Uint8Array> {
  const sent = headers ? Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join(' · ') : '(ninguno)';
  let res: Response;
  try {
    res = await fetch(url, { headers: headers || {}, credentials: 'same-origin' });
  } catch (e) {
    throw loadError('No se pudo contactar con el servidor de documentos.',
      `La petición a ${url} no llegó a completarse: ${e.message}\nHeaders enviados: ${sent}`);
  }

  const ctype = res.headers.get('content-type') || '(sin Content-Type)';
  const where = `GET ${url}\nHeaders enviados: ${sent}\nHTTP ${res.status} ${res.statusText} · ${ctype}`;
  if (!res.ok) {
    const pista = res.status === 404 ? 'El servidor no encuentra el modelo solicitado.'
      : (res.status === 401 || res.status === 403) ? 'No tienes permiso para acceder a este modelo.'
      : (res.status === 502 || res.status === 504) ? 'El servidor de documentos no está respondiendo.'
      : 'El servidor no pudo entregar el modelo.';
    throw loadError(pista, where);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) {
    throw loadError('El servidor devolvió un archivo vacío. Es posible que ese modelo ya no exista.', where);
  }
  // Una página HTML (error de ORDS, login de APEX…) en lugar del archivo
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200)).replace(/\s+/g, ' ').trim();
  if (/^<(!doctype|html)/i.test(head)) {
    throw loadError('El servidor no devolvió un modelo, sino una página de error o de inicio de sesión.',
      `${where} · ${bytes.length} bytes\nEmpieza con: ${head}`);
  }
  return bytes;
}
