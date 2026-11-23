/* ──────────────────────────────────────────────────────────────────────
   identity.ts — Quién está usando el visor y qué puede hacer

   La identidad SIEMPRE viene de APEX (parámetros de la URL del iframe o
   postMessage): no se recuerda ningún nombre de sesiones anteriores, así no
   quedan usuarios "fantasma".

     name           nombre visible; autor de las marcas ('Anónimo' si falta)
     userId         USUARIO_GRABACION — con él se guardan/consultan las marcas
     revId          ID_REVISIONES_PLANO (opcional)
     projectCode    P9130008_CODIGO_PROYECTO — filtra los listados de planos y RFI
     canCollaborate P0_PERMISO_COLABORADOR === '1' → puede guardar y descargar
   ────────────────────────────────────────────────────────────────────── */

const ANONYMOUS = 'Anónimo';

export interface IdentityHooks {
  /** Cambió el nombre del usuario activo (re-anunciarse en la sala, autor de las marcas). */
  onUserChange?: (name: string) => void;
}

/** Código leído de la URL/localStorage: sin espacios; los numéricos, como número. */
function parseCode(raw: unknown): string | number {
  const value = String(raw).trim();
  return /^\d+$/.test(value) ? Number(value) : value;
}

function isBlank(raw: unknown): boolean {
  return raw == null || String(raw).trim() === '';
}

export function createIdentity(hooks: IdentityHooks = {}) {
  let name = ANONYMOUS;
  let userId: string | number | null = null;
  let revId: number | null = null;
  let projectCode: string | null = null;
  let canCollaborate = false;

  function setUser(rawName: string | null | undefined) {
    name = (rawName || ANONYMOUS).trim() || ANONYMOUS;
    hooks.onUserChange?.(name);
  }

  /** Código recibido por postMessage: se conserva el valor tal cual llega
      (sólo los códigos numéricos exactos pasan a número). */
  function setUserId(raw: unknown, source: string) {
    if (isBlank(raw)) return;
    userId = /^\d+$/.test(String(raw)) ? Number(raw) : raw as string | number;
    console.info(`[SAF] codigo_usuario (${source}):`, userId);
  }

  function setRevId(raw: unknown) {
    if (raw != null && /^\d+$/.test(String(raw))) revId = Number(raw);
  }

  function setProjectCode(code: string) {
    projectCode = code;
  }

  /** Normaliza el permiso de colaborador (APEX) y muestra/oculta Guardar y Descargar. */
  function setPermission(raw: unknown) {
    canCollaborate = String(raw ?? '').trim() === '1';
    ['btn-save-marks', 'btn-download-doc'].forEach(id => {
      const button = document.getElementById(id);
      // El de Descargar vive dentro de un submenú: se oculta el envoltorio entero
      const box = button && ((button.closest('.tb-dropdown-wrap') as HTMLElement) || button);
      if (box) box.style.display = canCollaborate ? '' : 'none';
    });
  }

  /**
   * Lee la identidad de la URL del iframe. El nombre se acepta con cualquiera de
   * estas claves: ?usuario= · ?usuario_conectado= · ?user= · ?nombreUsuario= · ?usuario_nombre=
   */
  function readFromUrl(params: URLSearchParams) {
    setUser((params.get('usuario')
          || params.get('usuario_conectado')
          || params.get('user')
          || params.get('nombreUsuario')
          || params.get('usuario_nombre')
          || '').trim());

    // Código de usuario: PRIMERO el parámetro de la URL (APEX lo inyecta desde su
    // localStorage) y, como respaldo, el localStorage propio.
    const uid = params.get('codigo_usuario') || params.get('usuario_id') || params.get('id_usuario');
    if (uid && uid.trim()) {
      userId = parseCode(uid);
    } else {
      try {
        const stored = (localStorage.getItem('codigo_usuario') || '').trim();
        if (stored) userId = parseCode(stored);
      } catch (e) {}
    }
    setRevId(params.get('id_revision') || params.get('id_revisiones_plano'));

    const project = (params.get('codigo_proyecto') || params.get('proyecto') || '').trim();
    if (project) { projectCode = project; console.info('[SAF] codigo_proyecto:', projectCode); }

    setPermission(params.get('P0_PERMISO_COLABORADOR')
               ?? params.get('permiso_colaborador')
               ?? params.get('permiso'));
    console.info('[SAF] permiso_colaborador:', canCollaborate);

    if (userId == null)
      console.warn('[SAF] Sin codigo_usuario: USUARIO_GRABACION se guardará como 0. ' +
                   'Pásalo en la URL (?codigo_usuario=...) o por postMessage {action:"setUser",codigo:...}.');
    else
      console.info('[SAF] codigo_usuario para guardar marcas:', userId);
  }

  return {
    get name() { return name; },
    get userId() { return userId; },
    get revId() { return revId; },
    get projectCode() { return projectCode; },
    get canCollaborate() { return canCollaborate; },
    setUser, setUserId, setRevId, setProjectCode, setPermission, readFromUrl,
  };
}

export type Identity = ReturnType<typeof createIdentity>;
