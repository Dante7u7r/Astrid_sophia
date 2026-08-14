import { drawComponentSymbol } from "./component_renderer";
import {
  createComponentLookup,
  createGridRenderPlan,
  createSelectedComponentIds,
  ensureCanvasBuffer,
  getVisibleComponents,
  resolveRenderDetail,
  type RenderDetail,
} from "./render_model";
import {
  drawAlignmentGuides,
  drawProbeBadges,
  drawSelectionBox,
  drawSParameterMarkers,
  drawTemporaryWire,
  type ProbeBadges,
  type SParameterMarker,
} from "./render_overlays";
import type { AlignmentGuide } from "./alignment_guidelines";
import { getVisibleWorldBounds, screenToWorld } from "./viewport_camera";
import {
  calculateWireMidpoint,
  findWireCrossings,
  findWireJunctionPoints,
  wirePathIntersects,
} from "./wiring_model";
import { getActiveNetHighlight, type NetHighlightResult } from "./net_highlight";
import { CurrentAnimationRenderer } from "./current_animation_renderer";
import { ThermalHeatmapRenderer } from "./thermal_heatmap_renderer";
import { renderPinTelemetryHud, renderWireTelemetryHud } from "./hud_inspector";
import type {
  BoundingBox,
  ComponentInstance,
  PinInstance,
  Point2D,
  WireInstance,
} from "../canvas_orchestrator";

type RenderPinCache = Map<string, PinInstance[]>;

interface GridPathCache {
  key: string;
  path: Path2D;
}

export interface CanvasRenderHost {
  zoom: number;
  offsetX: number;
  offsetY: number;
  gridSize: number;
  components: ComponentInstance[];
  wires: WireInstance[];
  selectedComponents: ComponentInstance[];
  selectedComponent: ComponentInstance | null;
  selectedWire: WireInstance | null;
  selectedWires: readonly WireInstance[];
  hoveredComponent: ComponentInstance | null;
  hoveredWire: WireInstance | null;
  hoveredPin: PinInstance | null;
  activePinForWire: PinInstance | null;
  tempWireEnd: Point2D | null;
  ercIssues: { componentId: string; type: "error" | "warning"; message: string; pinIndex?: number }[];
  selectionStart: Point2D | null;
  selectionEnd: Point2D | null;
  activeAlignmentGuides?: readonly AlignmentGuide[];
  showWireLabels?: boolean;
  currentFlowMode?: "conventional" | "electron";
  currentAnimationSpeed?: number;
  showCurrentAnimation?: boolean;
  showThermalHeatmap?: boolean;
  showReactiveFields?: boolean;
  showTelemetryHud?: boolean;
  clampCameraOffsets(): void;
  generateOrthogonalPath(start: Point2D, end: Point2D): Point2D[];
  getComponentPins(component: ComponentInstance): PinInstance[];
}

export class CanvasSceneRenderer {
  private gridPathCache: GridPathCache | null = null;
  private currentAnimationRenderer = new CurrentAnimationRenderer();
  private thermalHeatmapRenderer = new ThermalHeatmapRenderer();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly host: CanvasRenderHost,
  ) {}

  public render(
    _voltageMap: Record<string, number> = {},
    probes: ProbeBadges = {},
    nodeMap: Record<string, string> = {},
    sparMarkers?: SParameterMarker[],
    branchCurrents: Record<string, number> = {},
  ): void {
    const dpr = window.devicePixelRatio || 1;
    ensureCanvasBuffer(this.canvas, dpr);

    this.host.clampCameraOffsets();

    // 2. Reset transform to identity, clear the entire physical buffer
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.save();

    // 3. Apply Camera Transformations (zoom & pan) scaled by DPR
    this.ctx.setTransform(
      this.host.zoom * dpr, 0,
      0, this.host.zoom * dpr,
      this.host.offsetX * dpr,
      this.host.offsetY * dpr,
    );

    // 1. Draw World Grid
    this.drawWorldGrid(dpr);

    const componentById = createComponentLookup(this.host.components);
    const pinCache: RenderPinCache = new Map();
    const visibleWorldBounds = this.getVisibleWorldBounds();
    const visibleComponents = getVisibleComponents(this.host.components, visibleWorldBounds);
    const selectedIds = createSelectedComponentIds(this.host.selectedComponents);
    const netHighlight = getActiveNetHighlight({
      wires: this.host.wires,
      hoveredWire: this.host.hoveredWire,
      hoveredPin: this.host.hoveredPin,
      selectedWire: this.host.selectedWire,
      nodeMap,
    });

    // 3. Draw Wires
    this.drawWires(componentById, pinCache, visibleWorldBounds, nodeMap, netHighlight, _voltageMap, branchCurrents);

    const now = performance.now();

    // 3b. Draw Current Flow Animation (Zero-GC)
    if (this.host.showCurrentAnimation !== false) {
      this.currentAnimationRenderer.flowMode = this.host.currentFlowMode ?? "conventional";
      this.currentAnimationRenderer.speedMultiplier = this.host.currentAnimationSpeed ?? 1.0;
      this.currentAnimationRenderer.renderCurrentFlow(
        this.ctx,
        this.host.wires,
        branchCurrents,
        _voltageMap,
        visibleWorldBounds,
        now,
      );
    }

    // 3c. Draw Electro-Thermal Live Heatmap
    if (this.host.showThermalHeatmap !== false) {
      this.thermalHeatmapRenderer.renderThermalHeatmap(
        this.ctx,
        visibleComponents,
        _voltageMap,
        branchCurrents,
        visibleWorldBounds,
        this.host.zoom,
        now,
      );
    }

    const renderDetail = resolveRenderDetail(this.host.zoom, visibleComponents.length);

    // 4. Draw Components
    for (const comp of visibleComponents) {
      const isSelected = comp.selected ||
                         this.host.selectedComponent?.id === comp.id ||
                         selectedIds.has(comp.id);
      const isHovered = this.host.hoveredComponent?.id === comp.id;
      drawComponentSymbol(this.ctx, comp, isSelected, isHovered, {
        detail: renderDetail,
        voltageMap: _voltageMap,
        branchCurrents,
        showReactiveFields: this.host.showReactiveFields !== false,
      });
    }

    drawTemporaryWire(
      this.ctx,
      this.host.activePinForWire,
      this.host.tempWireEnd,
      (start, end) => this.host.generateOrthogonalPath(start, end),
    );
    // 6. Draw Highlights & Pins
    this.drawPins(_voltageMap, nodeMap, pinCache, visibleComponents, renderDetail, netHighlight, branchCurrents);

    // 6b. Draw Visual ERC Issues
    this.drawERCIssues(componentById, pinCache);

    drawProbeBadges(this.ctx, probes);
    drawSParameterMarkers(this.ctx, sparMarkers);
    drawSelectionBox(this.ctx, this.host.selectionStart, this.host.selectionEnd);
    drawAlignmentGuides(this.ctx, this.host.activeAlignmentGuides ?? []);

    this.ctx.restore();
  }

  private getVisibleWorldBounds(): BoundingBox {
    return getVisibleWorldBounds(this.host, {
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
    });
  }

  private drawWorldGrid(dpr: number = 1): void {
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (cssW <= 0 || cssH <= 0 || !Number.isFinite(this.host.zoom) || this.host.zoom <= 0) return;

    const topLeft = screenToWorld(0, 0, this.host);
    const bottomRight = screenToWorld(cssW, cssH, this.host);

    const gridPlan = createGridRenderPlan({
      topLeft,
      bottomRight,
      gridSize: this.host.gridSize,
      zoom: this.host.zoom,
    });
    if (!gridPlan) return;

    this.ctx.save();
    this.ctx.setTransform(
      this.host.zoom * dpr, 0,
      0, this.host.zoom * dpr,
      this.host.offsetX * dpr,
      this.host.offsetY * dpr,
    );
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.05)";

    let path = this.gridPathCache?.key === gridPlan.cacheKey ? this.gridPathCache.path : null;
    if (!path) {
      path = new Path2D();
      for (let x = gridPlan.startX; x <= gridPlan.endX; x += gridPlan.gridStep) {
        for (let y = gridPlan.startY; y <= gridPlan.endY; y += gridPlan.gridStep) {
          path.rect(
            x - gridPlan.dotSize / 2,
            y - gridPlan.dotSize / 2,
            gridPlan.dotSize,
            gridPlan.dotSize,
          );
        }
      }
      this.gridPathCache = { key: gridPlan.cacheKey, path };
    }
    this.ctx.fill(path);
    this.ctx.restore();
  }

  private getPinsCached(comp: ComponentInstance, pinCache: RenderPinCache): PinInstance[] {
    const cached = pinCache.get(comp.id);
    if (cached) return cached;
    const pins = this.host.getComponentPins(comp);
    pinCache.set(comp.id, pins);
    return pins;
  }

  private drawWires(
    componentById: ReadonlyMap<string, ComponentInstance>,
    pinCache: RenderPinCache,
    visibleWorldBounds: BoundingBox,
    nodeMap?: Record<string, string>,
    netHighlight?: NetHighlightResult,
    voltageMap: Record<string, number> = {},
    branchCurrents: Record<string, number> = {},
  ): void {
    this.ctx.save();

    const netWireIds = netHighlight ? netHighlight.netWireIds : new Set<string>();

    const selectedWireIds = new Set(this.host.selectedWires.map((w) => w.id));
    if (this.host.selectedWire) selectedWireIds.add(this.host.selectedWire.id);

    const crossingsByWire = findWireCrossings(this.host.wires, nodeMap);

    for (const wire of this.host.wires) {
      let startPt: Point2D | undefined;
      if (wire.from.isJunction && wire.from.junctionPos) {
        startPt = wire.from.junctionPos;
      } else {
        const fromComp = componentById.get(wire.from.componentId);
        if (fromComp) {
          const fromPins = this.getPinsCached(fromComp, pinCache);
          startPt = fromPins.find(p => p.pinIndex === wire.from.pinIndex);
        }
      }

      let endPt: Point2D | undefined;
      if (wire.to.isJunction && wire.to.junctionPos) {
        endPt = wire.to.junctionPos;
      } else {
        const toComp = componentById.get(wire.to.componentId);
        if (toComp) {
          const toPins = this.getPinsCached(toComp, pinCache);
          endPt = toPins.find(p => p.pinIndex === wire.to.pinIndex);
        }
      }

      if (!startPt || !endPt) continue;

      const pts = wire.points;
      if (!pts || pts.length < 2) continue;
      if (!this.wirePathIntersects(pts, visibleWorldBounds)) continue;

      // Dibujar camino ortogonal con esquinas redondeadas
      this.ctx.beginPath();
      this.ctx.moveTo(pts[0].x, pts[0].y);

      const cornerRadius = 8;
      if (pts.length > 2) {
        for (let i = 1; i < pts.length - 1; i++) {
          const p1 = pts[i];
          const p2 = pts[i + 1];
          this.ctx.arcTo(p1.x, p1.y, p2.x, p2.y, cornerRadius);
        }
      }
      this.ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);

      // Estilo interactivo del cable y Net Highlight
      const isSelected = selectedWireIds.has(wire.id);
      const isHovered = this.host.hoveredWire?.id === wire.id;
      const isNetHighlighted = netWireIds.has(wire.id);

      let strokeColor = "rgba(255, 255, 255, 0.45)";
      this.ctx.shadowBlur = 0;
      if (isSelected) {
        strokeColor = "hsl(270, 89%, 65%)";
        this.ctx.strokeStyle = strokeColor;
        this.ctx.lineWidth = 3;
      } else if (isHovered) {
        strokeColor = "hsl(210, 100%, 56%)";
        this.ctx.strokeStyle = strokeColor;
        this.ctx.lineWidth = 2.8;
      } else if (isNetHighlighted) {
        strokeColor = "#66fcf1";
        this.ctx.strokeStyle = strokeColor;
        this.ctx.lineWidth = 2.8;
        this.ctx.shadowColor = "rgba(102, 252, 241, 0.45)";
        this.ctx.shadowBlur = 6;
      } else if (wire.color) {
        strokeColor = wire.color;
        this.ctx.strokeStyle = strokeColor;
        this.ctx.lineWidth = 2;
      } else {
        this.ctx.strokeStyle = strokeColor;
        this.ctx.lineWidth = 2;
      }

      this.ctx.stroke();
      this.ctx.shadowBlur = 0;

      // Dibujar arcos de cruce (Jumper Arcs) sobre la ruta si existen
      const jumperPoints = crossingsByWire.get(wire.id);
      if (jumperPoints && jumperPoints.length > 0) {
        for (const jPt of jumperPoints) {
          this.ctx.fillStyle = "rgba(8, 12, 22, 0.9)";
          this.ctx.beginPath();
          this.ctx.arc(jPt.x, jPt.y, 6, 0, Math.PI * 2);
          this.ctx.fill();

          this.ctx.strokeStyle = strokeColor;
          this.ctx.lineWidth = 2;
          this.ctx.beginPath();
          this.ctx.arc(jPt.x, jPt.y, 6, Math.PI, 0, false);
          this.ctx.stroke();
        }
      }

      // Highlight conexiones/pins
      this.ctx.fillStyle = isSelected
        ? "hsl(270, 89%, 65%)"
        : (isHovered || isNetHighlighted)
          ? "hsl(174, 97%, 69%)"
          : "rgba(102, 252, 241, 0.3)";
      this.ctx.beginPath();
      this.ctx.arc(startPt.x, startPt.y, 4, 0, Math.PI * 2);
      this.ctx.arc(endPt.x, endPt.y, 4, 0, Math.PI * 2);
      this.ctx.fill();

      // Renderizar Net Label si está definida y las etiquetas están activas (o si el cable está seleccionado)
      if (wire.label && (this.host.showWireLabels || isSelected)) {
        const mid = calculateWireMidpoint(wire.points);
        if (mid) {
          this.drawWireLabelBadge(this.ctx, mid, wire.label, strokeColor);
        }
      }

      // Renderizar manijas de interacción (handles) si el cable está seleccionado o en hover
      if (isSelected || isHovered) {
        for (let i = 1; i < pts.length - 1; i++) {
          const pt = pts[i];
          this.ctx.fillStyle = isSelected ? "hsl(270, 89%, 65%)" : "#66fcf1";
          this.ctx.strokeStyle = "#030508";
          this.ctx.lineWidth = 1.5;
          this.ctx.beginPath();
          this.ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.stroke();
        }

        for (let i = 0; i < pts.length - 1; i++) {
          const p1 = pts[i];
          const p2 = pts[i + 1];
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;
          this.ctx.fillStyle = "rgba(102, 252, 241, 0.4)";
          this.ctx.strokeStyle = isSelected ? "hsl(270, 89%, 65%)" : "#66fcf1";
          this.ctx.lineWidth = 1;
          this.ctx.fillRect(midX - 3, midY - 3, 6, 6);
          this.ctx.strokeRect(midX - 3, midY - 3, 6, 6);
        }

        // Renderizar HUD de Telemetría si el cable está en hover (y no hay pin activo para evitar solapamiento)
        if (this.host.showTelemetryHud !== false && isHovered && !this.host.hoveredPin) {
          const fromKey = `${wire.from.componentId}:${wire.from.pinIndex}`;
          const toKey = `${wire.to.componentId}:${wire.to.pinIndex}`;
          const vWire = voltageMap[fromKey] ?? voltageMap[toKey];
          const iWire = branchCurrents[`${wire.id}:I`] ?? branchCurrents[fromKey] ?? branchCurrents[toKey];
          renderWireTelemetryHud(this.ctx, wire, vWire, iWire);
        }
      }
    }

    // Dibujar Nodos de Unión en T (T-Junction Dots)
    const junctions = findWireJunctionPoints(this.host.wires);
    for (const jPt of junctions) {
      this.ctx.fillStyle = "#66fcf1";
      this.ctx.strokeStyle = "#030508";
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.arc(jPt.x, jPt.y, 4, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  private wirePathIntersects(points: readonly Point2D[], bounds: BoundingBox): boolean {
    return wirePathIntersects(points, bounds);
  }

  private drawWireLabelBadge(
    ctx: CanvasRenderingContext2D,
    center: Point2D,
    label: string,
    accentColor?: string,
  ): void {
    ctx.save();
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const metrics = ctx.measureText(label);
    const paddingX = 6;
    const badgeWidth = metrics.width + paddingX * 2;
    const badgeHeight = 14;

    const x = center.x - badgeWidth / 2;
    const y = center.y - badgeHeight / 2;

    ctx.fillStyle = "rgba(8, 12, 22, 0.92)";
    ctx.beginPath();
    ctx.roundRect(x, y, badgeWidth, badgeHeight, 3);
    ctx.fill();

    ctx.strokeStyle = accentColor ?? "rgba(102, 252, 241, 0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, center.x, center.y + 0.5);
    ctx.restore();
  }

  private drawPins(
    voltageMap: Record<string, number> = {},
    nodeMap: Record<string, string> = {},
    pinCache: RenderPinCache = new Map(),
    componentsToDraw: readonly ComponentInstance[] = this.host.components,
    renderDetail: RenderDetail = "full",
    netHighlight?: NetHighlightResult,
    branchCurrents: Record<string, number> = {},
  ): void {
    this.ctx.save();

    const netPinKeys = netHighlight ? netHighlight.netPinKeys : new Set<string>();

    for (const comp of componentsToDraw) {
      const pins = this.getPinsCached(comp, pinCache);
      for (const pin of pins) {
        const pinKey = `${pin.componentId}:${pin.pinIndex}`;
        const isHovered = this.host.hoveredPin &&
                          this.host.hoveredPin.componentId === pin.componentId &&
                          this.host.hoveredPin.pinIndex === pin.pinIndex;
        const isActive = this.host.activePinForWire &&
                         this.host.activePinForWire.componentId === pin.componentId &&
                         this.host.activePinForWire.pinIndex === pin.pinIndex;
        const isNetHighlighted = netPinKeys.has(pinKey);

        if (renderDetail === "compact" && !isHovered && !isActive && !isNetHighlighted) continue;

        if (isHovered || isActive) {
          this.ctx.fillStyle = "hsl(174, 97%, 69%)";
          this.ctx.shadowColor = "hsl(174, 97%, 69%)";
          this.ctx.shadowBlur = 6;
          this.ctx.beginPath();
          this.ctx.arc(pin.x, pin.y, 6, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.shadowBlur = 0;

          // Draw HUD de Telemetría de Pin/Nodo
          const nodeId = nodeMap[pinKey];
          if (this.host.showTelemetryHud !== false && isHovered && nodeId) {
            const volt = voltageMap[pinKey];
            const current = branchCurrents[pinKey] ?? branchCurrents[`${pin.componentId}:I`];
            renderPinTelemetryHud(this.ctx, pin, nodeId, volt, current);
          }
        } else {
          this.ctx.fillStyle = "rgba(102, 252, 241, 0.5)";
          this.ctx.beginPath();
          this.ctx.arc(pin.x, pin.y, 3, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }

    this.ctx.restore();
  }

  private drawERCIssues(
    componentById: ReadonlyMap<string, ComponentInstance> = new Map(this.host.components.map(component => [component.id, component])),
    pinCache: RenderPinCache = new Map(),
  ): void {
    if (this.host.ercIssues.length === 0) return;

    const pulseRadius = 10 + Math.sin(Date.now() / 150) * 3;

    for (const issue of this.host.ercIssues) {
      const comp = componentById.get(issue.componentId);
      if (!comp) continue;

      const isError = issue.type === "error";
      const ringColor = isError ? "hsl(0, 84%, 60%)" : "hsl(35, 92%, 55%)";
      const fillColor = isError ? "rgba(239, 68, 68, 0.2)" : "rgba(245, 158, 11, 0.2)";

      if (issue.pinIndex !== undefined) {
        // Alerta específica en un pin
        const pins = this.getPinsCached(comp, pinCache);
        const pin = pins.find(p => p.pinIndex === issue.pinIndex);
        if (pin) {
          this.ctx.save();
          this.ctx.beginPath();
          this.ctx.arc(pin.x, pin.y, pulseRadius, 0, Math.PI * 2);
          this.ctx.strokeStyle = ringColor;
          this.ctx.lineWidth = 1.5;
          this.ctx.stroke();
          this.ctx.fillStyle = fillColor;
          this.ctx.fill();

          this.ctx.beginPath();
          this.ctx.arc(pin.x, pin.y, 4, 0, Math.PI * 2);
          this.ctx.fillStyle = ringColor;
          this.ctx.fill();
          this.ctx.restore();
        }
      } else {
        // Alerta en todo el componente
        this.ctx.save();
        this.ctx.beginPath();
        const compRadius = 25 + Math.sin(Date.now() / 150) * 5;
        this.ctx.arc(comp.x, comp.y, compRadius, 0, Math.PI * 2);
        this.ctx.strokeStyle = ringColor;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        this.ctx.fillStyle = fillColor;
        this.ctx.fill();

        // Cartel de advertencia arriba del componente
        const badgeY = comp.y - 32;
        this.ctx.beginPath();
        this.ctx.moveTo(comp.x - 7, badgeY + 4);
        this.ctx.lineTo(comp.x + 7, badgeY + 4);
        this.ctx.lineTo(comp.x, badgeY - 8);
        this.ctx.closePath();
        this.ctx.fillStyle = ringColor;
        this.ctx.fill();

        this.ctx.fillStyle = "white";
        this.ctx.font = "bold 8px var(--font-sans)";
        this.ctx.textAlign = "center";
        this.ctx.fillText("!", comp.x, badgeY + 2);
        this.ctx.restore();
      }
    }
  }


}
