import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { CircuitDocumentController } from "../app/circuit_document_controller";

interface DesktopE2eSnapshot {
  readonly componentCount: number;
  readonly wireCount: number;
  readonly activeTabName: string | null;
  readonly components: Array<{
    readonly id: string;
    readonly type: string;
    readonly clientX: number;
    readonly clientY: number;
    readonly pins: Array<{ readonly clientX: number; readonly clientY: number }>;
  }>;
}

interface DesktopE2eBridge {
  snapshot(): DesktopE2eSnapshot;
  serializeCircuit(): string;
  loadSerializedCircuit(content: string): boolean;
}

declare global {
  interface Window {
    __ASTRYD_E2E__?: DesktopE2eBridge;
  }
}

interface DesktopE2eBridgeDependencies {
  getOrchestrator(): CanvasOrchestrator | null;
  getDocumentController(): CircuitDocumentController | null;
  getActiveTabName(): string | null;
  updateCanvasRendering(): void;
}

export function installDesktopE2eBridge(dependencies: DesktopE2eBridgeDependencies): void {
  if (import.meta.env.MODE !== "wdio") return;

  window.__ASTRYD_E2E__ = {
    snapshot(): DesktopE2eSnapshot {
      const orchestrator = dependencies.getOrchestrator();
      const canvas = document.querySelector<HTMLCanvasElement>("#circuit-canvas");
      if (!orchestrator || !canvas) {
        return { componentCount: 0, wireCount: 0, activeTabName: null, components: [] };
      }

      const rect = canvas.getBoundingClientRect();
      return {
        componentCount: orchestrator.components.length,
        wireCount: orchestrator.wires.length,
        activeTabName: dependencies.getActiveTabName(),
        components: orchestrator.components.map((component) => {
          const center = orchestrator.worldToScreen(component.x, component.y);
          return {
            id: component.id,
            type: component.type,
            clientX: rect.left + center.x,
            clientY: rect.top + center.y,
            pins: orchestrator.getComponentPins(component).map((pin) => {
              const point = orchestrator.worldToScreen(pin.x, pin.y);
              return { clientX: rect.left + point.x, clientY: rect.top + point.y };
            }),
          };
        }),
      };
    },

    serializeCircuit(): string {
      return dependencies.getDocumentController()?.serializeCircuit() ?? "{}";
    },

    loadSerializedCircuit(content: string): boolean {
      const loaded = dependencies.getDocumentController()?.deserializeCircuit(content) ?? false;
      if (loaded) dependencies.updateCanvasRendering();
      return loaded;
    },
  };
}
