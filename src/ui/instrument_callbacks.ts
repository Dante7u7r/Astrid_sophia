export type InstrumentLogType = "system" | "send" | "receive" | "error";

export interface InstrumentCallbacks {
  onCanvasModified(): void;
  onNetlistSync(): void;
  requestRender(immediate?: boolean): void;
  getPinNode(pinKey: string): string | undefined;
  log(text: string, type?: InstrumentLogType): void;
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
