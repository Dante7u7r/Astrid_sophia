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
  drawProbeBadges,
  drawSelectionBox,
  drawSParameterMarkers,
  drawTemporaryWire,
  type ProbeBadges,
  type SParameterMarker,
} from "./render_overlays";
import { getVisibleWorldBounds, screenToWorld } from "./viewport_camera";
import { wirePathIntersects } from "./wiring_model";
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
  hoveredComponent: ComponentInstance | null;
  hoveredWire: WireInstance | null;
  hoveredPin: PinInstance | null;
  activePinForWire: PinInstance | null;
  tempWireEnd: Point2D | null;
  ercIssues: { componentId: string; type: "error" | "warning"; message: string; pinIndex?: number }[];
  selectionStart: Point2D | null;
  selectionEnd: Point2D | null;
  clampCameraOffsets(): void;
  generateOrthogonalPath(start: Point2D, end: Point2D): Point2D[];
  getComponentPins(component: ComponentInstance): PinInstance[];
}

export class CanvasSceneRenderer {
  private gridPathCache: GridPathCache | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly host: CanvasRenderHost,
  ) {}

  public render(_voltageMap: Record<string, number> = {}, probes: ProbeBadges = {}, nodeMap: Record<string, string> = {}, sparMarkers?: SParameterMarker[]): void {
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

    // 4. Draw Background Grid
    this.drawWorldGrid(dpr);

    const componentById = createComponentLookup(this.host.components);
    const pinCache: RenderPinCache = new Map();
    const visibleWorldBounds = this.getVisibleWorldBounds();
    const visibleComponents = getVisibleComponents(this.host.components, visibleWorldBounds);
    const selectedIds = createSelectedComponentIds(this.host.selectedComponents);

    // 3. Draw Wires
    this.drawWires(componentById, pinCache, visibleWorldBounds);

    const renderDetail = resolveRenderDetail(this.host.zoom, visibleComponents.length);

    // 4. Draw Components
    for (const comp of visibleComponents) {
      const isSelected = comp.selected ||
                         this.host.selectedComponent?.id === comp.id ||
                         selectedIds.has(comp.id);
      const isHovered = this.host.hoveredComponent?.id === comp.id;
      drawComponentSymbol(this.ctx, comp, isSelected, isHovered, { detail: renderDetail });
    }

    drawTemporaryWire(
      this.ctx,
      this.host.activePinForWire,
      this.host.tempWireEnd,
      (start, end) => this.host.generateOrthogonalPath(start, end),
    );
    // 6. Draw Highlights & Pins
    this.drawPins(_voltageMap, nodeMap, pinCache, visibleComponents, renderDetail);

    // 6b. Draw Visual ERC Issues
    this.drawERCIssues(componentById, pinCache);

    drawProbeBadges(this.ctx, probes);
    drawSParameterMarkers(this.ctx, sparMarkers);
    drawSelectionBox(this.ctx, this.host.selectionStart, this.host.selectionEnd);

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
  ): void {
    this.ctx.save();

    for (const wire of this.host.wires) {
      // Find endpoints
      const fromComp = componentById.get(wire.from.componentId);
      const toComp = componentById.get(wire.to.componentId);

      if (!fromComp || !toComp) continue;

      const fromPins = this.getPinsCached(fromComp, pinCache);
      const toPins = this.getPinsCached(toComp, pinCache);
      const startPt = fromPins.find(p => p.pinIndex === wire.from.pinIndex);
      const endPt = toPins.find(p => p.pinIndex === wire.to.pinIndex);

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

      // Estilo interactivo del cable
      const isSelected = this.host.selectedWire?.id === wire.id;
      const isHovered = this.host.hoveredWire?.id === wire.id;

      if (isSelected) {
        this.ctx.strokeStyle = "hsl(270, 89%, 65%)"; // Selected violet neón
        this.ctx.lineWidth = 3;
        this.ctx.shadowColor = "hsl(270, 89%, 65%)";
        this.ctx.shadowBlur = 8;
      } else if (isHovered) {
        this.ctx.strokeStyle = "hsl(210, 100%, 56%)"; // Hovered azul neón
        this.ctx.lineWidth = 2.5;
        this.ctx.shadowColor = "hsl(210, 100%, 56%)";
        this.ctx.shadowBlur = 6;
      } else {
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.45)"; // Cable estándar semitransparente
        this.ctx.lineWidth = 2;
        this.ctx.shadowBlur = 0;
      }

      this.ctx.stroke();
      this.ctx.shadowBlur = 0; // Reset shadow

      // Highlight conexiones/pins
      this.ctx.fillStyle = isSelected
        ? "hsl(270, 89%, 65%)"
        : isHovered
          ? "hsl(210, 100%, 56%)"
          : "rgba(102, 252, 241, 0.3)";
      this.ctx.beginPath();
      this.ctx.arc(startPt.x, startPt.y, 4, 0, Math.PI * 2);
      this.ctx.arc(endPt.x, endPt.y, 4, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  private wirePathIntersects(points: readonly Point2D[], bounds: BoundingBox): boolean {
    return wirePathIntersects(points, bounds);
  }

  private drawPins(
    voltageMap: Record<string, number> = {},
    nodeMap: Record<string, string> = {},
    pinCache: RenderPinCache = new Map(),
    componentsToDraw: readonly ComponentInstance[] = this.host.components,
    renderDetail: RenderDetail = "full",
  ): void {
    this.ctx.save();

    for (const comp of componentsToDraw) {
      const pins = this.getPinsCached(comp, pinCache);
      for (const pin of pins) {
        const isHovered = this.host.hoveredPin &&
                          this.host.hoveredPin.componentId === pin.componentId &&
                          this.host.hoveredPin.pinIndex === pin.pinIndex;
        const isActive = this.host.activePinForWire &&
                         this.host.activePinForWire.componentId === pin.componentId &&
                         this.host.activePinForWire.pinIndex === pin.pinIndex;
        if (renderDetail === "compact" && !isHovered && !isActive) continue;

        if (isHovered || isActive) {
          this.ctx.fillStyle = "hsl(174, 97%, 69%)";
          this.ctx.shadowColor = "hsl(174, 97%, 69%)";
          this.ctx.shadowBlur = 6;
          this.ctx.beginPath();
          this.ctx.arc(pin.x, pin.y, 6, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.shadowBlur = 0;

          // Draw tooltip with node info and voltage
          const pinKey = `${pin.componentId}:${pin.pinIndex}`;
          const nodeId = nodeMap[pinKey];
          if (isHovered && nodeId) {
            const nodeLabel = nodeId === "0" ? "Nodo 0 (GND)" : `Nodo ${nodeId}`;
            const volt = voltageMap[pinKey];
            const voltLine = volt !== undefined ? `${volt.toFixed(4)} V` : null;

            const lines: string[] = [nodeLabel];
            if (voltLine) lines.push(voltLine);

            this.ctx.font = "bold 9px var(--font-mono)";
            const lineHeight = 12;
            const paddingX = 8;
            const paddingY = 5;
            let maxWidth = 0;
            for (const line of lines) {
              const w = this.ctx.measureText(line).width;
              if (w > maxWidth) maxWidth = w;
            }

            const boxH = lines.length * lineHeight + paddingY * 2;
            const boxY = pin.y - 10 - boxH;

            this.ctx.fillStyle = "rgba(8, 12, 22, 0.95)";
            this.ctx.strokeStyle = "rgba(102, 252, 241, 0.4)";
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.roundRect(
              pin.x - maxWidth / 2 - paddingX,
              boxY,
              maxWidth + paddingX * 2,
              boxH,
              4
            );
            this.ctx.fill();
            this.ctx.stroke();

            this.ctx.fillStyle = "hsl(174, 97%, 69%)";
            this.ctx.textAlign = "center";
            for (let i = 0; i < lines.length; i++) {
              this.ctx.fillText(lines[i], pin.x, boxY + paddingY + lineHeight * (i + 0.7));
            }
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
