/* ──────────────────────────────────────────────────────────────────────
   region-snapshot.ts — Captura de pantalla del plano POR SELECCIÓN (PNG)

   Reutiliza el recorte de región del lienzo (markup-layer.beginRegionSnapshot):
     fase 1 · dibujar el área con el ratón,
     fase 2 · moverla/redimensionarla,
     confirmar → se genera el PNG y se descarga (Escape o Cancelar aborta).

   Es el ÚNICO dueño de la barra #region-bar, así que cualquier disparador puede
   pedir una captura: el botón de la barra superior o el menú de descarga de la
   comparación de revisiones.
   ────────────────────────────────────────────────────────────────────── */
import { renderIcons } from '../ui/icons';

export interface RegionSnapshotCtx {
  getMarkup: () => any;
  downloadImage: (dataUrl: string, filename: string) => void;
  /** Nombre por defecto del PNG, SIN extensión (p. ej. plano_captura_p3). */
  defaultName: () => string;
  onActiveChange?: (on: boolean) => void;   // para reflejar el estado en el botón
}

export function createRegionSnapshot(ctx: RegionSnapshotCtx) {
  const $ = (id: string) => document.getElementById(id) as any;
  let active = false;
  let filename = '';

  /** Muestra/oculta la barra de confirmación, con el estado del botón Confirmar. */
  function showBar(on: boolean, ready = false) {
    const bar = $('region-bar');
    if (bar) bar.style.display = on ? 'flex' : 'none';
    const msg = $('region-bar-msg');
    if (msg) msg.innerHTML = ready
      ? '<i data-lucide="crop"></i> Ajusta el área y pulsa Confirmar'
      : '<i data-lucide="crop"></i> Arrastra el área — o haz clic en dos puntos opuestos';
    const ok = $('btn-region-confirm');
    if (ok) ok.disabled = !ready;
    if (bar) renderIcons(bar);
  }

  function setActive(on: boolean) {
    active = on;
    ctx.onActiveChange && ctx.onActiveChange(on);
  }

  /** Arranca una captura. `name` (sin extensión) sobreescribe el nombre por defecto. */
  function start(name?: string) {
    const markup = ctx.getMarkup();
    if (!markup || !markup.beginRegionSnapshot) return;
    if (active) cancel();                    // reinicia si ya había una en curso
    filename = `${name || ctx.defaultName()}.png`;
    setActive(true);
    showBar(true, false);                    // fase dibujo
    markup.beginRegionSnapshot({
      onReady: () => showBar(true, true),    // fase ajuste → habilita Confirmar
      onDone : (dataUrl: string | null) => { // confirmar, cancelar o Escape
        setActive(false);
        showBar(false);
        if (dataUrl) ctx.downloadImage(dataUrl, filename);
      },
    });
  }

  /** Aborta la captura en curso (si hay). */
  function cancel() {
    const markup = ctx.getMarkup();
    if (markup && markup.cancelRegionSnapshot) markup.cancelRegionSnapshot();
    setActive(false);
    showBar(false);
  }

  function isActive() { return active; }

  /** Enlaza los botones de la barra de confirmación (una vez al inicio). */
  function init() {
    $('btn-region-confirm')?.addEventListener('click', () => {
      const markup = ctx.getMarkup();
      markup && markup.confirmRegionSnapshot && markup.confirmRegionSnapshot();
    });
    $('btn-region-cancel')?.addEventListener('click', cancel);
  }

  return { init, start, cancel, isActive };
}
