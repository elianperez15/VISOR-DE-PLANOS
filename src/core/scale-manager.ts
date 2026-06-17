/* ──────────────────────────────────────────────
   ScaleManager — convierte píxeles ↔ unidades reales
   ────────────────────────────────────────────── */

export interface Point {
  x: number;
  y: number;
}

type ScaleListener = (sm: ScaleManager) => void;

export class ScaleManager {
  /** Píxeles por unidad real (null = sin calibrar) */
  pxPerUnit: number | null;
  unit: string;
  private _listeners: ScaleListener[];

  constructor() {
    this.pxPerUnit = null;
    this.unit = 'm';
    this._listeners = [];
  }

  /**
   * Calibrar: se conocen `pxDistance` píxeles = `realValue` unidades
   */
  calibrate(pxDistance: number, realValue: number, unit?: string): boolean {
    if (pxDistance <= 0 || realValue <= 0) return false;
    this.pxPerUnit = pxDistance / realValue;
    this.unit = unit || 'm';
    this._notify();
    return true;
  }

  reset(): void {
    this.pxPerUnit = null;
    this._notify();
  }

  isCalibrated(): boolean { return this.pxPerUnit !== null; }

  /** Convierte píxeles a valor real formateado (ej: "5.50 m") */
  format(px: number): string {
    if (this.pxPerUnit === null) return `${Math.round(px)} px`;
    const val = px / this.pxPerUnit;
    return `${val.toFixed(2)} ${this.unit}`;
  }

  /** Convierte área en px² a valor real formateado (ej: "12.50 m²") */
  formatArea(pxArea: number): string {
    if (this.pxPerUnit === null) return `${Math.round(pxArea)} px²`;
    const val = pxArea / (this.pxPerUnit * this.pxPerUnit);
    return `${val.toFixed(2)} ${this.unit}²`;
  }

  /** Distancia euclidiana entre dos puntos en unidades reales */
  distance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1, dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Calcula área de un polígono dado su array de puntos {x,y} */
  polygonArea(pts: Point[]): number {
    let area = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const j = (i + 1) % n;
      area += pts[i].x * pts[j].y;
      area -= pts[j].x * pts[i].y;
    }
    return Math.abs(area) / 2; // en px²
  }

  on(fn: ScaleListener): void { this._listeners.push(fn); }
  private _notify(): void { this._listeners.forEach(fn => fn(this)); }
}
