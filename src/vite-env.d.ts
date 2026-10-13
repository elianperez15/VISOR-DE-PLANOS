/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base del servicio ORDS (p.ej. '/ords/safws'). Relativa = mismo origen, sin CORS. */
  readonly VITE_ORDS_BASE?: string;
  /** Origen del portal APEX permitido en postMessage (p.ej. 'https://saf.aicsacorp.com'). */
  readonly VITE_APEX_ORIGIN?: string;
  /** URL del microservicio de colaboración. Por defecto, el mismo origen del visor. */
  readonly VITE_COLLAB_URL?: string;
  /** 'false' apaga la colaboración EN VIVO. No afecta a la persistencia (va por ORDS). */
  readonly VITE_COLLAB_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
