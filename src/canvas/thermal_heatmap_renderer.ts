import type { BoundingBox, ComponentInstance } from "../canvas_orchestrator";
import { isVisible } from "./viewport_camera";

/**
 * ThermalHeatmapRenderer
 * Genera un mapa de calor infrarrojo fotorrealista sobre los componentes del circuito
 * basándose en su disipación de potencia (P = V * I). Incorpora inercia térmica física (tau = 0.35s)
 * para calentamiento/enfriamiento progresivo y alertas de sobrecarga (Overpower Stress Flare)
 * utilizando un canvas fuera de pantalla (Offscreen Canvas LUT Cache) a 60 FPS (Zero-GC).
 */
export class ThermalHeatmapRenderer {
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenOverloadCanvas: HTMLCanvasElement | null = null;
  private offscreenSize = 128;
  private smoothedIntensities: Map<string, number> = new Map();
  private lastRenderTime = 0;

  constructor() {
    this.initOffscreenCache();
  }

  private initOffscreenCache(): void {
    if (typeof document === "undefined") return;

    // 1. Gradiente térmico estándar
    this.offscreenCanvas = document.createElement("canvas");
    this.offscreenCanvas.width = this.offscreenSize;
    this.offscreenCanvas.height = this.offscreenSize;

    const ctx = this.offscreenCanvas.getContext("2d");
    if (!ctx) return;

    const center = this.offscreenSize / 2;
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);

    gradient.addColorStop(0.0, "rgba(255, 255, 255, 0.95)"); // Núcleo incandescente
    gradient.addColorStop(0.20, "rgba(255, 160, 20, 0.85)"); // Naranja-dorado brillante
    gradient.addColorStop(0.48, "rgba(235, 40, 40, 0.55)");  // Rojo térmico
    gradient.addColorStop(0.78, "rgba(145, 35, 225, 0.22)"); // Violeta infrarrojo
    gradient.addColorStop(1.0, "rgba(0, 0, 0, 0)");          // Borde transparente

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.offscreenSize, this.offscreenSize);

    // 2. Gradiente de sobrecarga térmica / estrés crítico (Overpower Flare)
    this.offscreenOverloadCanvas = document.createElement("canvas");
    this.offscreenOverloadCanvas.width = this.offscreenSize;
    this.offscreenOverloadCanvas.height = this.offscreenSize;
    const ctxOv = this.offscreenOverloadCanvas.getContext("2d");
    if (!ctxOv) return;

    const gradOv = ctxOv.createRadialGradient(center, center, 0, center, center, center);
    gradOv.addColorStop(0.0, "rgba(255, 255, 255, 1.0)");   // Blanco plasma
    gradOv.addColorStop(0.25, "rgba(255, 60, 60, 0.9)");    // Rojo advertencia puro
    gradOv.addColorStop(0.60, "rgba(255, 150, 0, 0.5)");    // Fuego naranja
    gradOv.addColorStop(0.88, "rgba(180, 0, 100, 0.2)");    // Magenta térmico
    gradOv.addColorStop(1.0, "rgba(0, 0, 0, 0)");

    ctxOv.fillStyle = gradOv;
    ctxOv.fillRect(0, 0, this.offscreenSize, this.offscreenSize);
  }

  /**
   * Obtiene la potencia nominal admisible según el tipo de componente.
   */
  public getRatedPower(type: ComponentInstance["type"]): number {
    switch (type) {
      case "resistor":
      case "potentiometer":
      case "thermistor":
      case "ldr":
        return 0.25; // 1/4 Watt
      case "npn":
      case "pnp":
      case "nmos":
      case "pmos":
        return 0.80; // Transistor de pequeña señal / potencia media
      case "diode":
      case "led":
        return 0.20;
      case "lamp":
        return 5.00;
      default:
        return 1.00;
    }
  }

  /**
   * Limpia el histórico de inercia térmica (p. ej. al reiniciar simulación).
   */
  public reset(): void {
    this.smoothedIntensities.clear();
    this.lastRenderTime = 0;
  }

  /**
   * Renderiza los destellos térmicos sobre el lienzo 2D con inercia física y sobrecarga.
   */
  public renderThermalHeatmap(
    ctx: CanvasRenderingContext2D,
    components: readonly ComponentInstance[],
    nodeVoltages: Record<string, number>,
    branchCurrents: Record<string, number>,
    visibleWorldBounds: BoundingBox,
    hostZoom: number,
    now: number = typeof performance !== "undefined" ? performance.now() : Date.now(),
  ): void {
    if (!this.offscreenCanvas || (!nodeVoltages && !branchCurrents)) return;

    const dt = this.lastRenderTime > 0 ? Math.min((now - this.lastRenderTime) / 1000, 0.1) : 0.016;
    this.lastRenderTime = now;
    const thermalAlpha = 1 - Math.exp(-dt / 0.35); // tau = 0.35s

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

      const iBranch = Math.abs(branchCurrents[`${comp.id}:I`] ?? branchCurrents[p1Key] ?? branchCurrents[p2Key] ?? 0);

      // Disipación de potencia P = V * I
      let power = vDiff * iBranch;

      // Estimación secundaria para componentes pasivos si solo hay mapa de voltajes
      if (power === 0 && comp.type === "resistor") {
        const val = typeof comp.value === "number" ? comp.value : parseFloat(comp.value as string) || 1000;
        if (val > 0) {
          power = (vDiff * vDiff) / val;
        }
      }

      const ratedPower = this.getRatedPower(comp.type);
      const isOverloaded = power > ratedPower;

      // Escala de intensidad térmica perceptual (referencia nominal 0.25 W = 250 mW)
      const targetIntensity = power >= 0.0005 ? Math.min(1.0, Math.sqrt(power / ratedPower)) : 0;

      // Aplicar filtro pasa-bajos de inercia térmica
      const prevIntensity = this.smoothedIntensities.get(comp.id) ?? 0;
      const currentIntensity = prevIntensity + (targetIntensity - prevIntensity) * thermalAlpha;
      this.smoothedIntensities.set(comp.id, currentIntensity);

      if (currentIntensity < 0.02) continue;

      ctx.globalAlpha = Math.min(0.85, 0.25 + currentIntensity * 0.6);
      const radius = 30 + currentIntensity * 45;

      ctx.drawImage(
        this.offscreenCanvas,
        comp.x - radius / 2,
        comp.y - radius / 2,
        radius,
        radius,
      );

      // Alerta de Sobrecarga / Estrés Térmico (Overpower Flare Pulsante)
      if (isOverloaded && this.offscreenOverloadCanvas) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.015);
        ctx.globalAlpha = 0.4 + 0.5 * pulse;
        const ovRadius = radius * 1.25;
        ctx.drawImage(
          this.offscreenOverloadCanvas,
          comp.x - ovRadius / 2,
          comp.y - ovRadius / 2,
          ovRadius,
          ovRadius,
        );
      }
    }

    ctx.restore();
  }
}
