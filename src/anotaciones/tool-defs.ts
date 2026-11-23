/* ──────────────────────────────────────────────────────────────────────
   tool-defs.ts — Catálogos de herramientas y tipos de anotación (datos puros)

   Centraliza la definición de herramientas (icono + nombre), los textos de
   ayuda y los tipos de anotación de construcción. Sin lógica ni estado.
   ────────────────────────────────────────────────────────────────────── */

/** Herramientas del grupo "Anotación" (icono Lucide + etiqueta corta). */
export const ANNOT_TOOLS: Record<string, { lc: string; name: string }> = {
  arrow    : { lc: 'arrow-up-right', name: 'Flecha'  },
  line     : { lc: 'minus',          name: 'Línea'   },
  rect     : { lc: 'square',         name: 'Rect'    },
  ellipse  : { lc: 'circle',         name: 'Elipse'  },
  highlight: { lc: 'highlighter',    name: 'Resalt.' },
  freehand : { lc: 'pencil',         name: 'Libre'   },
  cloud    : { lc: 'cloud',          name: 'Nube'    },
  'cloud-poly': { lc: 'cloud',       name: 'Nube pts'},
  text     : { lc: 'type',           name: 'Texto'   },
  note     : { lc: 'sticky-note',    name: 'Nota'    },
  callout  : { lc: 'message-square', name: 'Globo'   },
  stamp    : { lc: 'stamp',          name: 'Sello'   },
  link     : { lc: 'link',           name: 'Enlace'  },
  image    : { lc: 'image',          name: 'Imagen'  },
};

/** Herramientas del grupo "Medición". */
export const MEASURE_TOOLS: Record<string, { lc: string; name: string }> = {
  measure  : { lc: 'move-horizontal', name: 'Cota'      },
  angle    : { lc: 'triangle',        name: 'Ángulo'    },
  area     : { lc: 'hexagon',         name: 'Área'      },
  perimeter: { lc: 'spline',          name: 'Perímetro' },
};

/** Texto de ayuda contextual por herramienta (se muestra al activarla).
    Prefijo [[icon:nombre]] → showHint lo reemplaza por el icono Lucide. */
export const TOOL_HINTS: Record<string, string> = {
  arrow    : '[[icon:arrow-up-right]] Clic y arrastra para dibujar flecha',
  line     : '[[icon:minus]] Clic y arrastra para dibujar una línea recta',
  measure  : '[[icon:ruler]] Clic y arrastra para medir distancia (calibra la escala primero)',
  angle    : '[[icon:triangle]] Clic 1 = vértice · Clic 2 = brazo A · Clic 3 = brazo B',
  perimeter: '[[icon:spline]] Clic para agregar puntos · Enter para cerrar y calcular longitud total',
  cloud    : '[[icon:cloud]] Arrastra para dibujar la nube · Clic simple = nube estándar',
  'cloud-poly': '[[icon:cloud]] Clic en cada punto de la nube · doble clic o Enter para cerrar',
  rect     : '[[icon:square]] Clic y arrastra para rectángulo',
  ellipse  : '[[icon:circle]] Clic y arrastra para elipse',
  highlight: '[[icon:highlighter]] Clic y arrastra para resaltar área',
  text     : '[[icon:type]] Clic para insertar texto editable',
  note     : '[[icon:sticky-note]] Clic para insertar nota post-it',
  callout  : '[[icon:message-square]] Clic para insertar globo de comentario',
  freehand : '[[icon:pencil]] Dibuja libremente con el ratón',
  area     : '[[icon:hexagon]] Clic para agregar vértices · Enter para calcular área · Esc cancela',
  stamp    : '[[icon:stamp]] Clic en el plano para colocar sello',
  image    : '[[icon:camera]] Clic en el plano para elegir y colocar una imagen',
  link     : '[[icon:link]] Arrastra para crear el enlace · al soltar elige el plano destino · doble clic para saltar',
  eraser   : '[[icon:eraser]] Clic sobre un objeto para eliminarlo',
  pan      : '[[icon:hand]] Arrastra para mover la vista · Rueda del ratón = zoom',
  select   : '',
};

/** Catálogo de tipos de anotación de construcción (RFI, NCR, etc.).
    `icon` es un nombre de icono Lucide (se renderiza con <i data-lucide>). */
export const ANNOT_TYPES = [
  { id: 'RFI',   label: 'RFI',          desc: 'Request for Information',               icon: 'clipboard-list' },
  { id: 'NCR',   label: 'NCR',          desc: 'Non-Conformance Report',                icon: 'alert-circle'   },
  { id: 'OBS',   label: 'Observación',  desc: 'Observación / Incidencia',              icon: 'eye'            },
  { id: 'AC',    label: 'AC',           desc: 'Aprobación de Cambio',                  icon: 'check-circle'   },
  { id: 'PCN',   label: 'PCN/ECR',      desc: 'Solicitud de cambio',                   icon: 'refresh-cw'     },
  { id: 'COM',   label: 'Comentario',   desc: 'Comentario general',                    icon: 'message-square' },
  { id: 'DUDA',  label: 'Duda',         desc: 'Duda de constructibilidad',             icon: 'help-circle'    },
  { id: 'COORD', label: 'Coordinación', desc: 'Nota de coordinación entre disciplinas', icon: 'link'          },
  { id: 'MED',   label: 'Medición',     desc: 'Anotación de medición / cantidad',      icon: 'ruler'          },
  { id: 'HITO',  label: 'Hito calidad', desc: 'Hito de calidad / control',             icon: 'flag'           },
  { id: 'CHECK', label: 'Checklist',    desc: 'Checklist / verificación',              icon: 'check-square'   },
];
