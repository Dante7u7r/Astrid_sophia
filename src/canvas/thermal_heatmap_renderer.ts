import type { BoundingBox, ComponentInstance } from "../canvas_orchestrator";
import { isVisible } from "./viewport_camera";

/**
 * ThermalHeatmapRenderer
 * Genera un mapa de calor infrarrojo fotorrealista sobre los componentes del circuito
 * basándose en su disipación de potencia (P = V * I). Utiliza un canvas fuera de pantalla
 * (Offscreen Canvas LUT Cache) para lograr 60 FPS sin asignación dinámica de memoria.
 */
export class ThermalHeatmapRenderer {
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenSize = 128;

  constructor() {
    this.initOffscreenCache();
  }

  private initOffscreenCache(): void {
    if (typeof document === "undefined") return;
    this.offscreenCanvas = document.createElement("canvas");
    this.offscreenCanvas.width = this.offscreenSize;
    this.offscreenCanvas.height = this.offscreenSize;

    const ctx = this.offscreenCanvas.getContext("2d");
    if (!ctx) return;

    const center = this.offscreenSize / 2;
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);

    gradient.addColorStop(0.0, "rgba(255, 255, 255, 0.95)"); // Núcleo incandescente (100 ºC+)
    gradient.addColorStop(0.25, "rgba(255, 120, 0, 0.75)");  // Naranja-amarillo brillante
    gradient.addColorStop(0.55, "rgba(220, 20, 60, 0.45)");  // Rojo térmico
    gradient.addColorStop(0.85, "rgba(138, 43, 226, 0.15)"); // Violeta infrarrojo
    gradient.addColorStop(1.0, "rgba(0, 0, 0, 0)");         // Borde transparente

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.offscreenSize, this.offscreenSize);
  }

  /**
   * Renderiza los destellos térmicos sobre el lienzo 2D.
   */
  public renderThermalHeatmap(
    ctx: CanvasRenderingContext2D,
    components: readonly ComponentInstance[],
    nodeVoltages: Record<string, number>,
    branchCurrents: Record<string, number>,
    visibleWorldBounds: BoundingBox,
    hostZoom: number,
  ): void {
    if (!this.offscreenCanvas || (!nodeVoltages && !branchCurrents)) return;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (const comp of components) {
      if (!isVisible({ x: comp.x - 20, y: comp.y - 20, width: 40, height: 40 }, { zoom: hostZoom, offsetX: 0, offsetY: 0 }, visibleWorldBounds)) {
        continue;
      }

      const p1Key = `${comp.id}:0`;
      const p2Key = `${comp.id}:1`;
      const v1 = nodeVoltages[p1Key] ?? 0;
      const v2 = nodeVoltages[p2Key] ?? 0;
      const vDiff = Math.abs(v1 - v2);

      const iBranch = Math.abs(branchCurrents[`${comp.id}:I`] ?? branchCurrents[p1Key] ?? 0);

      // Disipación de potencia P = V * I
      let power = vDiff * iBranch;

      // Estimación secundaria para componentes pasivos
      if (power === 0 && comp.type === "resistor") {
        const val = typeof comp.value === "number" ? comp.value : parseFloat(comp.value as string) || 1000;
        if (val > 0) {
          power = (vDiff * vDiff) / val;
        }
      }

      if (power < 0.005) continue;

      // Resistencia térmica estimada por tipo
      const rTh = comp.type === "resistor" ? 40 : comp.type === "npn" || comp.type === "pmos" ? 70 : 50;
      const tempC = 25 + power * rTh;
      const normalizedTemp = Math.min(1.0, Math.max(0.0, (tempC - 25) / 80));

      if (normalizedTemp < 0.05) continue;

      ctx.globalAlpha = normalizedTemp * 0.8;
      const radius = 35 + normalizedTemp * 45;

      ctx.drawImage(
        this.offscreenCanvas,
        comp.x - radius / 2,
        comp.y - radius / 2,
        radius,
        radius,
      );
    }

    ctx.restore();
  }
}
