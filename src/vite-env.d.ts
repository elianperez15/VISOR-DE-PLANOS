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
  /** Convención de números y fechas (por defecto 'es-GT': punto decimal). */
  readonly VITE_LOCALE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Versión instalada de web-ifc (la inyecta vite.config.ts). Su .wasm se sirve en /web-ifc/<versión>/. */
declare const __WEB_IFC_VERSION__: string;
/** Versión instalada de @thatopen/fragments (la inyecta vite.config.ts): versiona la caché de modelos. */
declare const __FRAGMENTS_VERSION__: string;
