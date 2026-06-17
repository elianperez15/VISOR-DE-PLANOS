/* ──────────────────────────────────────────────
   Storage — guarda/carga sesiones de markup
   Soporta localStorage y Oracle API
   ────────────────────────────────────────────── */

const USE_API = false;           // true → Oracle API, false → localStorage
const API_BASE = '/api/markup';  // base URL del backend Node.js/Express

/** Datos de sesión Fabric.js (estructura propietaria del visor) */
export type SessionData = Record<string, unknown>;

export type SaveResult = { ok: true } | { ok: false; error: string };
export type LoadResult = { ok: true; data: any } | { ok: false; error: string };

export class Storage {
  LS_KEY: string;

  constructor() {
    this.LS_KEY = 'saf_planos_session';
  }

  /** Guarda sesión completa (todas las páginas) */
  async saveSession(sessionData: SessionData): Promise<SaveResult> {
    if (USE_API) {
      return this._apiSave(sessionData);
    }
    try {
      localStorage.setItem(this.LS_KEY, JSON.stringify(sessionData));
      return { ok: true };
    } catch (e: any) {
      console.error('Storage.saveSession:', e);
      return { ok: false, error: e.message };
    }
  }

  /** Carga la última sesión guardada */
  async loadSession(): Promise<LoadResult> {
    if (USE_API) {
      return this._apiLoad();
    }
    try {
      const raw = localStorage.getItem(this.LS_KEY);
      return raw ? { ok: true, data: JSON.parse(raw) } : { ok: false, error: 'Sin sesión guardada' };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  /** Descarga sesión como archivo JSON */
  downloadJSON(sessionData: SessionData, filename?: string): void {
    const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `saf-markup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Lee un archivo JSON del sistema de archivos */
  readJSONFile(file: File): Promise<any> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try { resolve(JSON.parse(e.target!.result as string)); }
        catch (err) { reject(new Error('Archivo JSON inválido')); }
      };
      reader.onerror = () => reject(new Error('Error al leer archivo'));
      reader.readAsText(file);
    });
  }

  /* ── API Oracle ── */
  async _apiSave(data: SessionData): Promise<SaveResult> {
    try {
      const res = await fetch(`${API_BASE}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.ok ? { ok: true } : { ok: false, error: await res.text() };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  async _apiLoad(docId?: string | number): Promise<LoadResult> {
    try {
      const url = docId ? `${API_BASE}/load/${docId}` : `${API_BASE}/load`;
      const res = await fetch(url);
      if (!res.ok) return { ok: false, error: await res.text() };
      return { ok: true, data: await res.json() };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }
}
