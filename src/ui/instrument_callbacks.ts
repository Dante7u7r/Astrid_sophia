import type { ComponentInstance } from "../canvas_orchestrator";

export type InstrumentLogType = "system" | "send" | "receive" | "error";

export interface InstrumentCallbacks {
  onCanvasModified(): void;
  onNetlistSync(): void;
  requestRender(immediate?: boolean): void;
  getPinNode(pinKey: string): string | undefined;
  log(text: string, type?: InstrumentLogType): void;
  isSimulating?: () => boolean;
  onSourceMutated?: (source: ComponentInstance) => void;
}

export function createNoopInstrumentCallbacks(): InstrumentCallbacks {
  return {
    onCanvasModified: () => undefined,
    onNetlistSync: () => undefined,
    requestRender: () => undefined,
    getPinNode: () => undefined,
    log: () => undefined,
  };
}
