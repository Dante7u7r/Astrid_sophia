import type { BoundingBox, WireInstance } from "../canvas_orchestrator";
import { wirePathIntersects } from "./wiring_model";

/**
 * CurrentAnimationRenderer
 * Anima el flujo de corriente a lo largo de los cables en el lienzo usando un patrón
 * de trazo punteado desfasado (lineDashOffset) sin instanciar objetos JS por frame (Zero-GC).
 */
export class CurrentAnimationRenderer {
  private dashOffset = 0;
  private lastTime = 0;
  public flowMode: "conventional" | "electron" = "conventional";
  public speedMultiplier: number = 1.0;

  /**
   * Renderiza la animación de corriente sobre los cables activos.
   */
  public renderCurrentFlow(
    ctx: CanvasRenderingContext2D,
    wires: readonly WireInstance[],
    branchCurrents: Record<string, number>,
    nodeVoltages: Record<string, number>,
    visibleWorldBounds: BoundingBox,
    now: number,
  ): void {
    if (!branchCurrents || (Object.keys(branchCurrents).length === 0 && Object.keys(nodeVoltages).length === 0)) {
      return;
    }

    if (this.lastTime === 0) {
      this.lastTime = now;
      return;
    }

    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.dashOffset += dt * 45;

    ctx.save();

    const flowSign = this.flowMode === "electron" ? 1 : -1;
    const speedMult = Math.max(0.1, Math.min(this.speedMultiplier, 5.0));

    for (const wire of wires) {
      const pts = wire.points;
      if (!pts || pts.length < 2) continue;
      if (!wirePathIntersects(pts, visibleWorldBounds)) continue;

      const fromKey = `${wire.from.componentId}:${wire.from.pinIndex}`;
      const toKey = `${wire.to.componentId}:${wire.to.pinIndex}`;

      const wireCurrentKey = `${wire.id}:I`;
      let current = branchCurrents[wireCurrentKey]
        ?? branchCurrents[wire.id]
        ?? branchCurrents[fromKey]
        ?? branchCurrents[toKey]
        ?? branchCurrents[wire.from.componentId]
        ?? branchCurrents[wire.to.componentId]
        ?? 0;

      if (current === 0) {
        const iFrom = branchCurrents[`${wire.from.componentId}:I`] ?? branchCurrents[wire.from.componentId];
        const iTo = branchCurrents[`${wire.to.componentId}:I`] ?? branchCurrents[wire.to.componentId];
        if (iFrom !== undefined && iFrom !== 0) {
          current = wire.from.pinIndex === 0 ? iFrom : -iFrom;
        } else if (iTo !== undefined && iTo !== 0) {
          current = wire.to.pinIndex === 0 ? -iTo : iTo;
        }
      }

      if (current === 0) {
        const vFrom = nodeVoltages[fromKey] ?? 0;
        const vTo = nodeVoltages[toKey] ?? 0;
        current = (vFrom - vTo) * 0.1;
      }

      const absI = Math.abs(current);
      if (absI < 1e-9) continue;

      const direction = (current >= 0 ? 1 : -1) * flowSign;
      // Velocidad comprimida logarítmicamente para que mA y A se vean naturales
      const speedFactor = Math.min(Math.max(1.0 + Math.log10(1 + absI * 100) * 1.5, 0.6), 5.0) * speedMult;
      const dashLength = 6;
      const gapLength = 14;
      const period = dashLength + gapLength;
      const offset = (direction * this.dashOffset * speedFactor) % period;

      // 1. Capa de brillo / halo exterior
      ctx.setLineDash([dashLength, gapLength]);
      ctx.lineDashOffset = offset;
      ctx.lineWidth = 3.0;
      ctx.strokeStyle = current > 0 ? "rgba(245, 158, 11, 0.40)" : "rgba(56, 189, 248, 0.40)";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();

      // 2. Núcleo incandescente de portador de carga
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = current > 0 ? "#F2C94C" : "#F8FAFC";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.restore();
  }
}
