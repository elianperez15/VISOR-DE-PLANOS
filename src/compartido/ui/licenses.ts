/* ──────────────────────────────────────────────────────────────────────
   licenses.ts — Enlace "Licencias" y ventana con las licencias de terceros

   Las librerías del visor (That Open, three.js, pdf.js, Fabric…) piden
   incluir su aviso de licencia. El texto lo genera en cada build
   scripts/third-party-licenses.mjs (public/THIRD_PARTY_LICENSES.txt).

   Se muestra en una ventana del propio visor (no en una pestaña nueva):
   embebido en APEX el iframe va en sandbox y puede no abrir ventanas.
   Lo usan los dos visores: un enlace discreto en una esquina, como la
   atribución de un mapa.
   ────────────────────────────────────────────────────────────────────── */

const LICENSES_URL = `${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.txt`;

let modal: HTMLElement | null = null;

function close() {
  if (modal) modal.style.display = 'none';
}

function buildModal(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay licenses-overlay';
  overlay.style.display = 'none';

  const card = document.createElement('div');
  card.className = 'licenses-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Licencias de software de terceros');

  const head = document.createElement('div');
  head.className = 'licenses-head';
  const title = document.createElement('span');
  title.textContent = 'Licencias de software de terceros';
  const closeButton = document.createElement('button');
  closeButton.className = 'licenses-close';
  closeButton.title = 'Cerrar';
  closeButton.textContent = '×';
  closeButton.addEventListener('click', close);
  head.append(title, closeButton);

  const text = document.createElement('pre');
  text.className = 'licenses-text';

  card.append(head, text);
  overlay.append(card);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.body.append(overlay);
  return overlay;
}

async function open() {
  modal = modal || buildModal();
  const text = modal.querySelector('.licenses-text') as HTMLElement;
  modal.style.display = 'flex';
  if (text.dataset.loaded) return;
  text.textContent = 'Cargando…';
  try {
    const res = await fetch(LICENSES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text.textContent = await res.text();
    text.dataset.loaded = '1';
  } catch (e) {
    text.textContent = `No se pudieron cargar las licencias (${e instanceof Error ? e.message : e}).`;
  }
}

/** Añade el enlace "Licencias" en la esquina inferior derecha de `container`. */
export function initLicensesLink(container: HTMLElement | null): void {
  if (!container) return;
  const link = document.createElement('button');
  link.className = 'licenses-link';
  link.textContent = 'Licencias';
  link.title = 'Licencias de software de terceros';
  link.addEventListener('click', open);
  container.append(link);
}
