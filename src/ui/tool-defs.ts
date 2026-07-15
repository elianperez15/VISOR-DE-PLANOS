/* ──────────────────────────────────────────────────────────────────────
   tool-defs.ts — Catálogos de herramientas y tipos de anotación (datos puros)

   Centraliza la definición de herramientas (icono + nombre), los textos de
   ayuda y los tipos de anotación de construcción. Sin lógica ni estado.
   ────────────────────────────────────────────────────────────────────── */

/** Herramientas del grupo "Anotación" (icono Lucide + etiqueta corta). */
export const ANNOT_TOOLS: Record<string, { lc: string; name: string }> = {
  arrow    : { lc: 'arrow-up-right', name: 'Flecha'  },
  rect     : { lc: 'square',         name: 'Rect'    },
  ellipse  : { lc: 'circle',         name: 'Elipse'  },
  highlight: { lc: 'highlighter',    name: 'Resalt.' },
  freehand : { lc: 'pencil',         name: 'Libre'   },
  cloud    : { lc: 'cloud',          name: 'Nube'    },
  text     : { lc: 'type',           name: 'Texto'   },
  note     : { lc: 'sticky-note',    name: 'Nota'    },
  callout  : { lc: 'message-square', name: 'Globo'   },
  stamp    : { lc: 'stamp',          name: 'Sello'   },
  link     : { lc: 'link',           name: 'Enlace'  },
  image    : { lc: 'camera',         name: 'Imagen'  },
};

/** Herramientas del grupo "Medición". */
export const MEASURE_TOOLS: Record<string, { lc: string; name: string }> = {
  measure  : { lc: 'move-horizontal', name: 'Cota'      },
  angle    : { lc: 'triangle',        name: 'Ángulo'    },
  area     : { lc: 'hexagon',         name: 'Área'      },
  perimeter: { lc: 'spline',          name: 'Perímetro' },
};

/** Texto de ayuda contextual por herramienta (se muestra al activarla). */
export const TOOL_HINTS: Record<string, string> = {
  arrow    : '↗ Clic y arrastra para dibujar flecha',
  measure  : '📏 Clic y arrastra para medir distancia (calibra la escala primero)',
  angle    : '∠ Clic 1 = vértice · Clic 2 = brazo A · Clic 3 = brazo B',
  perimeter: '〰 Clic para agregar puntos · Enter para cerrar y calcular longitud total',
  cloud    : '☁ Arrastra para dibujar la nube · Clic simple = nube estándar',
  rect     : '▭ Clic y arrastra para rectángulo',
  ellipse  : '⬭ Clic y arrastra para elipse',
  highlight: '🖍 Clic y arrastra para resaltar área',
  text     : 'T Clic para insertar texto editable',
  note     : '📝 Clic para insertar nota post-it',
  callout  : '💬 Clic para insertar globo de comentario',
  freehand : '✏ Dibuja libremente con el ratón',
  area     : '⬡ Clic para agregar vértices · Enter para calcular área · Esc cancela',
  stamp    : '🔖 Clic en el plano para colocar sello',
  image    : '📷 Clic en el plano para elegir y colocar una imagen',
  link     : '🔗 Arrastra para crear el enlace · luego define la hoja destino en el panel · doble clic para saltar',
  eraser   : '⌫ Clic sobre un objeto para eliminarlo',
  pan      : '✋ Arrastra para mover la vista · Rueda del ratón = zoom',
  select   : '',
};

/** Catálogo de tipos de anotación de construcción (RFI, NCR, etc.). */
export const ANNOT_TYPES = [
  { id: 'RFI',   label: 'RFI',          desc: 'Request for Information',               icon: '📋' },
  { id: 'NCR',   label: 'NCR',          desc: 'Non-Conformance Report',                icon: '🔴' },
  { id: 'OBS',   label: 'Observación',  desc: 'Observación / Incidencia',              icon: '👁'  },
  { id: 'AC',    label: 'AC',           desc: 'Aprobación de Cambio',                  icon: '✅' },
  { id: 'PCN',   label: 'PCN/ECR',      desc: 'Solicitud de cambio',                   icon: '🔄' },
  { id: 'COM',   label: 'Comentario',   desc: 'Comentario general',                    icon: '💬' },
  { id: 'DUDA',  label: 'Duda',         desc: 'Duda de constructibilidad',             icon: '❓' },
  { id: 'COORD', label: 'Coordinación', desc: 'Nota de coordinación entre disciplinas', icon: '🔗' },
  { id: 'MED',   label: 'Medición',     desc: 'Anotación de medición / cantidad',      icon: '📏' },
  { id: 'HITO',  label: 'Hito calidad', desc: 'Hito de calidad / control',             icon: '🏁' },
  { id: 'CHECK', label: 'Checklist',    desc: 'Checklist / verificación',              icon: '☑'  },
];
