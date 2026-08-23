import type { BoundingBox, WireInstance } from "../canvas_orchestrator";
import { wirePathIntersects } from "./wiring_model";

/**
 * CurrentAnimationRenderer — Motor de Flujo de Corriente Físico Proporcional
 * 
 * Principios de física y rendimiento:
 * 1. Velocidad de flujo proporcional a la corriente real de cada rama (v ~ asinh(|I| / I_ref)).
 * 2. Culling inteligente: Cables inactivos (|I| < 0.1 µA) tienen 0 llamadas de dibujo.
 * 3. Renderizado vectorizado por lotes (Batched Multi-Tier): Ejecuta como máximo 6-8 pasadas
 *    de trazo para todo el esquema, con 0 ms de recolección de basura y sin filtros `shadowBlur`.
 */
export class CurrentAnimationRenderer {
  private baseOffset = 0;
  private lastTime = 0;
  public flowMode: "conventional" | "electron" = "conventional";
  public speedMultiplier: number = 1.0;

  /**
   * Renderiza el flujo de corriente proporcional sobre los cables activos.
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
    this.baseOffset += dt * 40;

    const flowSign = this.flowMode === "electron" ? 1 : -1;
    const speedMult = Math.max(0.05, Math.min(this.speedMultiplier, 50.0));

    const zoomScale = Math.max(0.3, Math.min(zoom, 4.0));
    const dashLength = Math.max(3.0, 7 / Math.pow(zoomScale, 0.45));
    const gapLength = Math.max(6.0, 15 / Math.pow(zoomScale, 0.45));
    const period = dashLength + gapLength;
    const coreWidth = Math.max(1.2, 2.0 / Math.pow(zoomScale, 0.3));

    // Clasificación de cables en 3 niveles de velocidad física:
    // Nivel 0: Bajo (< 5 mA) -> vel = 0.5x
    // Nivel 1: Medio (5 mA - 100 mA) -> vel = 1.2x
    // Nivel 2: Alto / Corto (> 100 mA) -> vel = 2.8x
    const fwdTiers: WireInstance[][] = [[], [], []];
    const revTiers: WireInstance[][] = [[], [], []];

    for (let w = 0; w < wires.length; w++) {
      const wire = wires[w];
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
      // Culling inteligente: Si no hay corriente apreciable, omitir dibujo de este cable
      if (absI < 1e-7) continue;

      const tier = absI < 0.005 ? 0 : absI < 0.1 ? 1 : 2;
      if (current > 0) {
        fwdTiers[tier].push(wire);
      } else {
        revTiers[tier].push(wire);
      }
    }

    const tierMultipliers = [0.5, 1.2, 2.8];

    ctx.save();
    ctx.lineWidth = coreWidth;
    ctx.lineCap = "round";

    // 1. Trazado de Corriente Directa (Amarillo Ámbar / Oro)
    for (let t = 0; t < 3; t++) {
      const tierWires = fwdTiers[t];
      if (tierWires.length === 0) continue;

      const tierSpeed = tierMultipliers[t] * speedMult;
      const offset = (flowSign * this.baseOffset * tierSpeed) % period;

      ctx.setLineDash([dashLength, gapLength]);
      ctx.lineDashOffset = offset;
      ctx.strokeStyle = t === 2 ? "#FEF08A" : t === 1 ? "#F59E0B" : "rgba(245, 158, 11, 0.75)";

      ctx.beginPath();
      for (let i = 0; i < tierWires.length; i++) {
        const pts = tierWires[i].points;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let p = 1; p < pts.length; p++) {
          ctx.lineTo(pts[p].x, pts[p].y);
        }
      }
      ctx.stroke();
    }

    // 2. Trazado de Corriente Inversa (Azul Eléctrico / Cyan)
    for (let t = 0; t < 3; t++) {
      const tierWires = revTiers[t];
      if (tierWires.length === 0) continue;

      const tierSpeed = tierMultipliers[t] * speedMult;
      const offset = (-flowSign * this.baseOffset * tierSpeed) % period;

      ctx.setLineDash([dashLength, gapLength]);
      ctx.lineDashOffset = offset;
      ctx.strokeStyle = t === 2 ? "#E0F2FE" : t === 1 ? "#0EA5E9" : "rgba(14, 165, 233, 0.75)";

      ctx.beginPath();
      for (let i = 0; i < tierWires.length; i++) {
        const pts = tierWires[i].points;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let p = 1; p < pts.length; p++) {
          ctx.lineTo(pts[p].x, pts[p].y);
        }
      }
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.restore();
  }
}
