import type { BoundingBox, WireInstance } from "../canvas_orchestrator";
import { wirePathIntersects } from "./wiring_model";

interface PathBatch {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(ctx: CanvasRenderingContext2D): void;
}

class NativePath2DBatch implements PathBatch {
  private path: Path2D;
  constructor() {
    this.path = new Path2D();
  }
  moveTo(x: number, y: number): void {
    this.path.moveTo(x, y);
  }
  lineTo(x: number, y: number): void {
    this.path.lineTo(x, y);
  }
  stroke(ctx: CanvasRenderingContext2D): void {
    ctx.stroke(this.path);
  }
}

class FallbackPathBatch implements PathBatch {
  private ops: Array<{ type: "moveTo" | "lineTo"; x: number; y: number }> = [];
  moveTo(x: number, y: number): void {
    this.ops.push({ type: "moveTo", x, y });
  }
  lineTo(x: number, y: number): void {
    this.ops.push({ type: "lineTo", x, y });
  }
  stroke(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    for (const op of this.ops) {
      if (op.type === "moveTo") ctx.moveTo(op.x, op.y);
      else ctx.lineTo(op.x, op.y);
    }
    ctx.stroke();
  }
}

function createPathBatch(): PathBatch {
  if (typeof Path2D !== "undefined") {
    return new NativePath2DBatch();
  }
  return new FallbackPathBatch();
}

/**
 * CurrentAnimationRenderer
 * Anima el flujo de corriente a lo largo de los cables en el lienzo usando Path Batching
 * de alto rendimiento (agrupa todos los cables en un máximo de 2 trazos combinados Path2D a 60 FPS).
 */
export class CurrentAnimationRenderer {
  private dashOffset = 0;
  private lastTime = 0;
  public flowMode: "conventional" | "electron" = "conventional";
  public speedMultiplier: number = 1.0;

  /**
   * Renderiza la animación de corriente sobre los cables activos con Path Batching.
   */
  public renderCurrentFlow(
    ctx: CanvasRenderingContext2D,
    wires: readonly WireInstance[],
    branchCurrents: Record<string, number>,
    nodeVoltages: Record<string, number>,
    visibleWorldBounds: BoundingBox,
    now: number,
    zoom: number = 1.0,
  ): void {
    if (!branchCurrents || (Object.keys(branchCurrents).length === 0 && Object.keys(nodeVoltages).length === 0)) {
      return;
    }

    if (this.lastTime === 0 || now < this.lastTime) {
      this.lastTime = now;
      return;
    }

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.dashOffset += dt * 50;

    const flowSign = this.flowMode === "electron" ? 1 : -1;
    const speedMult = Math.max(0.1, Math.min(this.speedMultiplier, 5.0));

    const zoomScale = Math.max(0.3, Math.min(zoom, 4.0));
    const dashLength = Math.max(2.5, 6 / Math.pow(zoomScale, 0.45));
    const gapLength = Math.max(5.0, 14 / Math.pow(zoomScale, 0.45));
    const period = dashLength + gapLength;
    const haloWidth = Math.max(1.4, 2.8 / Math.pow(zoomScale, 0.3));
    const coreWidth = Math.max(0.9, 1.6 / Math.pow(zoomScale, 0.3));

    const forwardBatch = createPathBatch();
    const reverseBatch = createPathBatch();
    let hasForward = false;
    let hasReverse = false;

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

      const targetBatch = current >= 0 ? forwardBatch : reverseBatch;
      if (current >= 0) hasForward = true;
      else hasReverse = true;

      targetBatch.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        targetBatch.lineTo(pts[i].x, pts[i].y);
      }
    }

    if (!hasForward && !hasReverse) return;

    ctx.save();

    // 1. Batch de Corriente Directa (Amarillo / Ámbar)
    if (hasForward) {
      const offsetFwd = (flowSign * this.dashOffset * speedMult) % period;
      ctx.setLineDash([dashLength, gapLength]);
      ctx.lineDashOffset = offsetFwd;

      // Halo exterior
      ctx.lineWidth = haloWidth;
      ctx.strokeStyle = "rgba(245, 158, 11, 0.40)";
      forwardBatch.stroke(ctx);

      // Núcleo incandescente
      ctx.lineWidth = coreWidth;
      ctx.strokeStyle = "#F2C94C";
      forwardBatch.stroke(ctx);
    }

    // 2. Batch de Corriente Inversa (Cyan / Azul Eléctrico)
    if (hasReverse) {
      const offsetRev = (-flowSign * this.dashOffset * speedMult) % period;
      ctx.setLineDash([dashLength, gapLength]);
      ctx.lineDashOffset = offsetRev;

      // Halo exterior
      ctx.lineWidth = haloWidth;
      ctx.strokeStyle = "rgba(56, 189, 248, 0.40)";
      reverseBatch.stroke(ctx);

      // Núcleo incandescente
      ctx.lineWidth = coreWidth;
      ctx.strokeStyle = "#F8FAFC";
      reverseBatch.stroke(ctx);
    }

    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.restore();
  }
}
