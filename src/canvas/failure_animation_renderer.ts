import type { ComponentInstance, Point2D, WireInstance } from "../canvas_orchestrator";
import { calculateWireMidpoint } from "./wiring_model";

/**
 * failure_animation_renderer.ts — Motor de Animaciones de Fallas Físicas y Cortocircuitos (Zero-GPU Waste)
 *
 * Principios:
 * 1. Trazado vectorial directo sin filtros pesados (`shadowBlur`).
 * 2. Cero asignación de memoria dinámica (Zero-GC) durante los fotogramas de animación.
 * 3. Cálculos de chispas y arcos eléctricos estocásticos mediante funciones trigonométricas y modulares puras.
 */

export class FailureAnimationRenderer {
  /**
   * Dibuja un destello y chispas de arco eléctrico vectorial en una coordenada (x, y).
   */
  public renderShortCircuitSparks(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    now: number,
    intensity = 1.0,
  ): void {
    ctx.save();

    // 1. Núcleo de destello estroboscópico central
    const pulsePhase = (now % 300) / 300; // 0 a 1 cada 300ms
    const coreRadius = Math.max(3, 5 + Math.sin(pulsePhase * Math.PI * 2) * 2.5) * intensity;

    ctx.fillStyle = "rgba(254, 240, 138, 0.85)"; // Amarillo eléctrico
    ctx.beginPath();
    ctx.arc(x, y, coreRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#FFFFFF"; // Núcleo blanco caliente
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.5, coreRadius * 0.5), 0, Math.PI * 2);
    ctx.fill();

    // 2. Rayos y arcos eléctricos dentados (4 a 6 puntas)
    const rayCount = 6;
    const baseAngle = ((now % 1000) / 1000) * Math.PI * 2;

    ctx.strokeStyle = pulsePhase > 0.5 ? "#FDE047" : "#EF4444";
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < rayCount; i++) {
      const angle = baseAngle + (i * (Math.PI * 2)) / rayCount + Math.sin(now * 0.02 + i) * 0.3;
      const rayLen = (10 + ((i * 7 + (now % 17)) % 12)) * intensity;

      // Segmento quebrado en zigzag del rayo
      const midLen = rayLen * 0.5;
      const midAngle = angle + (i % 2 === 0 ? 0.25 : -0.25);
      const midX = x + Math.cos(midAngle) * midLen;
      const midY = y + Math.sin(midAngle) * midLen;

      const endX = x + Math.cos(angle) * rayLen;
      const endY = y + Math.sin(angle) * rayLen;

      ctx.moveTo(x, y);
      ctx.lineTo(midX, midY);
      ctx.lineTo(endX, endY);
    }
    ctx.stroke();

    // 3. Pequeñas partículas de chispa dispersas
    ctx.fillStyle = "#FFFFFF";
    for (let p = 0; p < 4; p++) {
      const pAngle = baseAngle * 2 + p * 1.57;
      const pDist = (6 + ((p * 11 + (now % 13)) % 14)) * intensity;
      const px = x + Math.cos(pAngle) * pDist;
      const py = y + Math.sin(pAngle) * pDist;
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }

    ctx.restore();
  }

  /**
   * Detecta las coordenadas de los cortocircuitos activos en el circuito.
   */
  public detectShortCircuitPoints(
    wires: readonly WireInstance[],
    components: readonly ComponentInstance[],
    branchCurrents: Readonly<Record<string, number>> = {},
    ercIssues: readonly { componentId: string; type: "error" | "warning"; message: string }[] = [],
  ): Point2D[] {
    const points: Point2D[] = [];

    // 1. Fuentes en cortocircuito detectadas por el motor ERC
    for (const issue of ercIssues) {
      if (issue.type === "error" && issue.message.toLowerCase().includes("corto")) {
        const comp = components.find(c => c.id === issue.componentId);
        if (comp) {
          points.push({ x: comp.x, y: comp.y });
        }
      }
    }

    // 2. Cables o ramas con sobrecorriente destructiva (|I| > 10A en simulación no de potencia)
    for (const wire of wires) {
      const wireCurrentKey = `${wire.id}:I`;
      const current = branchCurrents[wireCurrentKey]
        ?? branchCurrents[wire.id]
        ?? branchCurrents[`${wire.from.componentId}:${wire.from.pinIndex}`]
        ?? 0;

      if (Math.abs(current) >= 10.0) {
        const mid = calculateWireMidpoint(wire.points);
        if (mid) {
          points.push(mid);
        }
      }
    }

    return points;
  }

  /**
   * Detecta extremos de cables que no están conectados a ningún pin ni unión (cables flotantes).
   */
  public detectDeadEndWirePoints(
    wires: readonly WireInstance[],
    components: readonly ComponentInstance[],
  ): Point2D[] {
    const compMap = new Map<string, boolean>();
    for (const c of components) {
      compMap.set(c.id, true);
    }

    const deadEnds: Point2D[] = [];

    for (const wire of wires) {
      const isStartConnected = wire.from.componentId === "wire_junction" || compMap.has(wire.from.componentId);
      const isEndConnected = wire.to.componentId === "wire_junction" || compMap.has(wire.to.componentId);

      if (!isStartConnected && wire.points.length > 0) {
        deadEnds.push(wire.points[0]);
      }
      if (!isEndConnected && wire.points.length > 1) {
        deadEnds.push(wire.points[wire.points.length - 1]);
      }
    }

    return deadEnds;
  }

  /**
   * Renderiza marcadores discretos (micro-anillos huecos de 2.5px) en extremos abiertos.
   */
  public renderDeadEndMarkers(
    ctx: CanvasRenderingContext2D,
    deadEnds: readonly Point2D[],
    isClassroom: boolean = false,
  ): void {
    if (deadEnds.length === 0) return;

    ctx.save();
    ctx.strokeStyle = isClassroom ? "#D97706" : "#F59E0B";
    ctx.fillStyle = isClassroom ? "rgba(254, 240, 138, 0.4)" : "rgba(245, 158, 11, 0.25)";
    ctx.lineWidth = 1.2;

    for (const pt of deadEnds) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Renderiza todas las fallas dinámicas detectadas en el fotograma actual.
   */
  public renderFailures(
    ctx: CanvasRenderingContext2D,
    wires: readonly WireInstance[],
    components: readonly ComponentInstance[],
    branchCurrents: Readonly<Record<string, number>>,
    ercIssues: readonly { componentId: string; type: "error" | "warning"; message: string }[] = [],
    now: number = typeof performance !== "undefined" ? performance.now() : Date.now(),
    isClassroom: boolean = false,
  ): void {
    // 1. Chispas localizadas en cortocircuitos reales
    const shortPoints = this.detectShortCircuitPoints(wires, components, branchCurrents, ercIssues);
    for (const pt of shortPoints) {
      this.renderShortCircuitSparks(ctx, pt.x, pt.y, now);
    }

    // 2. Marcadores discretos de cables flotantes / extremos abiertos
    const deadEnds = this.detectDeadEndWirePoints(wires, components);
    this.renderDeadEndMarkers(ctx, deadEnds, isClassroom);
  }
}
