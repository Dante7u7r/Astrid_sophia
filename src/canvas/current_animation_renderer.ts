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
    this.dashOffset += dt * 30;

    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1.8;

    for (const wire of wires) {
      const pts = wire.points;
      if (!pts || pts.length < 2) continue;
      if (!wirePathIntersects(pts, visibleWorldBounds)) continue;

      const fromKey = `${wire.from.componentId}:${wire.from.pinIndex}`;
      const toKey = `${wire.to.componentId}:${wire.to.pinIndex}`;

      const wireCurrentKey = `${wire.id}:I`;
      let current = branchCurrents[wireCurrentKey] ?? branchCurrents[fromKey] ?? branchCurrents[toKey] ?? 0;

      if (current === 0) {
        const vFrom = nodeVoltages[fromKey] ?? 0;
        const vTo = nodeVoltages[toKey] ?? 0;
        current = (vFrom - vTo) * 0.1;
      }

      if (Math.abs(current) < 1e-6) continue;

      const direction = current >= 0 ? -1 : 1;
      const speedFactor = Math.min(Math.max(Math.abs(current) * 10, 0.5), 4.0);
      const offset = (direction * this.dashOffset * speedFactor) % 10;

      ctx.lineDashOffset = offset;
      ctx.strokeStyle = current > 0 ? "#66fcf1" : "#a855f7";

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
