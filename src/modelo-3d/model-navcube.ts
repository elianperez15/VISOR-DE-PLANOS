/* ──────────────────────────────────────────────────────────────────────
   model-navcube.ts — Cubo de navegación (esquina superior derecha)

   Un cubo en CSS 3D que gira con la cámara. Al pulsar una cara, la cámara
   salta a esa vista ortogonal: arriba, abajo, frente, atrás, izquierda,
   derecha. Las caras van rotuladas, así que se sabe adónde se va aunque el
   cubo esté girado.

   Giro del cubo = inverso del giro de la cámara. Los ángulos llegan de
   camera-controls en radianes:
     · azimut  giro alrededor del eje vertical (0 = cámara al frente)
     · polar   0 = cámara justo encima · 90° = a la altura del horizonte

   DERIVACIÓN DE LOS SIGNOS (comprobada contra tres posiciones conocidas):

     · azimut 0 · polar 90°  cámara en +Z mirando al modelo → identidad, y la
       cara .nc-front (translateZ positivo) es justo la que mira al usuario.
     · polar 0               cámara justo encima; el giro debe traer la cara
       superior hacia delante. La normal de .nc-top apunta hacia arriba en
       pantalla, y rotateX(-90°) la lleva al frente → x = polar − 90.
     · azimut 90°            cámara en +X; hay que traer .nc-right al frente.
       Esa cara se colocó con rotateY(90°), así que el giro inverso es
       rotateY(−90°) → y = −azimut.

   Si aun así girase al revés, invertir AZIMUTH_SIGN o POLAR_SIGN es todo lo
   que hace falta: las caras y adónde llevan no dependen de esos signos.
   ────────────────────────────────────────────────────────────────────── */
import type { BimEngine } from './bim-engine';
import type { CubeFace } from './bim-navcube';

const AZIMUTH_SIGN = -1;
const POLAR_SIGN   = 1;

const DEG = 180 / Math.PI;

/** Cara → rótulo. El orden es el del DOM, no importa para la geometría. */
const FACES: { face: CubeFace; label: string; css: string }[] = [
  { face: 'front',  label: 'Frente',    css: 'nc-front'  },
  { face: 'back',   label: 'Atrás',     css: 'nc-back'   },
  { face: 'right',  label: 'Derecha',   css: 'nc-right'  },
  { face: 'left',   label: 'Izquierda', css: 'nc-left'   },
  { face: 'top',    label: 'Arriba',    css: 'nc-top'    },
  { face: 'bottom', label: 'Abajo',     css: 'nc-bottom' },
];

export function createNavCube(getEngine: () => BimEngine | null) {
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  let built = false;

  /** Crea las seis caras una sola vez. */
  function build() {
    if (built) return;
    built = true;
    const box = $('model-navcube-box');
    box.replaceChildren();
    for (const { face, label, css } of FACES) {
      const button = document.createElement('button');
      button.className = `navcube-face ${css}`;
      button.dataset.face = face;
      button.textContent = label;
      button.title = `Ver desde: ${label.toLowerCase()}`;
      button.addEventListener('click', () => {
        const engine = getEngine();
        if (engine) engine.navcube.go(face);
      });
      box.append(button);
    }
  }

  /** Gira el cubo para que mire como la cámara. Lo llama el motor al moverse. */
  function setAngles(azimuth: number, polar: number) {
    if (!built) return;
    const x = POLAR_SIGN   * (polar * DEG - 90);
    const y = AZIMUTH_SIGN * (azimuth * DEG);
    $('model-navcube-box').style.transform = `rotateX(${x}deg) rotateY(${y}deg)`;
  }

  /** El cubo sólo tiene sentido con un modelo delante. */
  function setVisible(on: boolean) {
    if (on) build();
    $('model-navcube').hidden = !on;
  }

  return { setVisible, setAngles };
}
