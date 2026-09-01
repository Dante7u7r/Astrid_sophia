import type {
  BoundingBox,
  CanvasOrchestrator,
  ComponentInstance,
  Point2D,
} from "../canvas_orchestrator";
import { ensureCanvasBuffer } from "./render_model";
import { CurrentAnimationRenderer } from "./current_animation_renderer";
import { FailureAnimationRenderer } from "./failure_animation_renderer";
import { ThermalHeatmapRenderer } from "./thermal_heatmap_renderer";
import {
  drawAlignmentGuides,
  drawErcAndDrcOverlays,
  drawSelectionBox,
  drawTemporaryWire,
} from "./render_overlays";
import { getVisibleWorldBounds, isVisible } from "./viewport_camera";

export interface CanvasOverlayHost {
  zoom: number;
  offsetX: number;
  offsetY: number;
  gridSize: number;
  wires: CanvasOrchestrator["wires"];
  components: readonly ComponentInstance[];
  selectedComponents: readonly ComponentInstance[];
  selectedComponent: ComponentInstance | null;
  hoveredComponent: ComponentInstance | null;
  hoveredPin: CanvasOrchestrator["hoveredPin"];
  hoveredWire: CanvasOrchestrator["hoveredWire"];
  hoveredWireSnapPoint: CanvasOrchestrator["hoveredWireSnapPoint"];
  selectedWire: CanvasOrchestrator["selectedWire"];
  selectedWires: readonly CanvasOrchestrator["selectedWire"][];
  activePinForWire: CanvasOrchestrator["activePinForWire"];
  tempWireEnd: CanvasOrchestrator["tempWireEnd"];
  selectionStart: Point2D | null;
  selectionEnd: Point2D | null;
  activeAlignmentGuides?: CanvasOrchestrator["activeAlignmentGuides"];
  simulationActive?: boolean;
  simulationPaused?: boolean;
  showCurrentAnimation?: boolean;
  currentFlowMode?: "conventional" | "electron";
  currentAnimationSpeed?: number;
  showThermalHeatmap?: boolean;
  ercIssues?: CanvasOrchestrator["ercIssues"];
  getComponentPins?(comp: ComponentInstance): import("../canvas_orchestrator").PinInstance[];
  generateOrthogonalPath(start: Point2D, end: Point2D): Point2D[];
}

export class CanvasOverlayRenderer {
  private readonly ctx: CanvasRenderingContext2D | null;
  public readonly currentAnimationRenderer = new CurrentAnimationRenderer();
  public readonly failureAnimationRenderer = new FailureAnimationRenderer();
  public readonly thermalHeatmapRenderer = new ThermalHeatmapRenderer();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: CanvasOverlayHost,
  ) {
    this.ctx = canvas.getContext("2d");
  }

  public clear(): void {
    if (!this.ctx) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  public renderOverlay(
    voltageMap: Record<string, number> = {},
    branchCurrents: Record<string, number> = {},
    now: number = typeof performance !== "undefined" ? performance.now() : Date.now(),
  ): void {
    if (!this.ctx) return;

    const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
    ensureCanvasBuffer(this.canvas, dpr);

    // 1. Reset transform & Clear overlay buffer
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 2. Comprobar si hay elementos dinámicos que renderizar
    const isSimActive = this.host.simulationActive !== false;
    const hasCurrentAnimation = this.host.showCurrentAnimation !== false && isSimActive && (
      Object.keys(branchCurrents).length > 0 || Object.keys(voltageMap).length > 0
    );
    const hasThermalHeatmap = this.host.showThermalHeatmap !== false && isSimActive;
    const hasTempWire = Boolean(this.host.activePinForWire && this.host.tempWireEnd);
    const hasSelectionBox = Boolean(this.host.selectionStart && this.host.selectionEnd);
    const hasGuides = Boolean(this.host.activeAlignmentGuides && this.host.activeAlignmentGuides.length > 0);
    const hasErcIssues = Boolean(this.host.ercIssues && this.host.ercIssues.length > 0);

    if (!hasCurrentAnimation && !hasThermalHeatmap && !hasTempWire && !hasSelectionBox && !hasGuides && !hasErcIssues) {
      return;
    }

    this.ctx.save();

    // 3. Aplicar matriz de cámara (zoom y desplazamiento)
    this.ctx.setTransform(
      this.host.zoom * dpr, 0,
      0, this.host.zoom * dpr,
      this.host.offsetX * dpr,
      this.host.offsetY * dpr,
    );

    const visibleWorldBounds = this.getVisibleWorldBounds();

    // 4. Flujo de corriente dinámico (Zero-GC con Path Batching)
    if (hasCurrentAnimation) {
      this.currentAnimationRenderer.flowMode = this.host.currentFlowMode ?? "conventional";
      this.currentAnimationRenderer.speedMultiplier = this.host.currentAnimationSpeed ?? 1.0;
      this.currentAnimationRenderer.renderCurrentFlow(
        this.ctx,
        this.host.wires,
        branchCurrents,
        voltageMap,
        visibleWorldBounds,
        now,
        this.host.zoom,
        Boolean(this.host.simulationPaused),
      );
    }

    // 5. Halos térmicos en vivo
    if (hasThermalHeatmap) {
      const visibleComps = this.host.components.filter(c => isVisible(
        { x: c.x - 20, y: c.y - 20, width: 40, height: 40 },
        { zoom: this.host.zoom, offsetX: 0, offsetY: 0 },
        visibleWorldBounds,
      ));
      this.thermalHeatmapRenderer.renderThermalHeatmap(
        this.ctx,
        visibleComps,
        voltageMap,
        branchCurrents,
        visibleWorldBounds,
        this.host.zoom,
        now,
      );
    }

    // 6. Animación de Chispas y Marcadores Discretos de Fallas (Zero-GPU Waste)
    if (isSimActive) {
      const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
      this.failureAnimationRenderer.renderFailures(
        this.ctx,
        this.host.wires,
        this.host.components,
        branchCurrents,
        this.host.ercIssues ?? [],
        now,
        isClassroom,
      );
    }

    // 7. Overlays de ERC/DRC (fatal: rojo, advertencia: amarillo) en tiempo real
    if (hasErcIssues) {
      drawErcAndDrcOverlays(
        this.ctx,
        this.host.ercIssues ?? [],
        this.host.components,
        (c) => (this.host.getComponentPins ? this.host.getComponentPins(c) : []),
        now,
        this.host.hoveredPin,
        this.host.hoveredComponent,
      );
    }

    // 7. Cable temporal mientras el usuario conecta pines
    if (hasTempWire) {
      drawTemporaryWire(
        this.ctx,
        this.host.activePinForWire,
        this.host.tempWireEnd,
        (start: Point2D, end: Point2D) => this.host.generateOrthogonalPath(start, end),
      );
    }

    // 8. Caja de selección interactiva
    if (hasSelectionBox) {
      drawSelectionBox(this.ctx, this.host.selectionStart, this.host.selectionEnd);
    }

    // 9. Guías de alineación magnéticas
    if (hasGuides) {
      drawAlignmentGuides(this.ctx, this.host.activeAlignmentGuides ?? []);
    }

    this.ctx.restore();
  }

  private getVisibleWorldBounds(): BoundingBox {
    const parent = this.canvas.parentElement;
    const width = parent && parent.clientWidth > 0 ? parent.clientWidth : this.canvas.clientWidth;
    const height = parent && parent.clientHeight > 0 ? parent.clientHeight : this.canvas.clientHeight;
    return getVisibleWorldBounds(this.host, {
      width,
      height,
    });
  }
}
