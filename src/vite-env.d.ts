/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base del módulo ORDS de APEX (p.ej. '/ords/safws/api_pdf'). Relativa = mismo origen. */
  readonly VITE_ORDS_BASE?: string;
  /** Origen del portal APEX permitido en postMessage (p.ej. 'https://saf.aicsacorp.com'). */
  readonly VITE_APEX_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
