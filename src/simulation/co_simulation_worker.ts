import { solveTransientCircuitTS } from "./fallback_solver";
import { createMcuRuntime, runCycles, type McuRuntime } from "./mcu-runtime";
import { dispatchAnalogTrigger } from "./mcu-spice-bridge";
import { STANDARD_8051_DEFINITION } from "./mcu-8051";
import { ATMEGA328P_DEFINITIONS } from "./mcu-avr";
import { type CircuitNetlist } from "./netlist_extractor";
import type { AnalogEventTrigger } from "./mcu-types";

export interface SimulationFrame {
  readonly runId: number;
  readonly time: number;
  readonly nodeVoltages: Readonly<Record<string, number>>;
  readonly branchCurrents: Readonly<Record<string, number>>;
  readonly frameIndex: number;
  readonly isFinal: boolean;
  readonly triggerEvent: AnalogEventTrigger | null;
}

let interactiveMcuRuntimes: Record<string, { runtime: McuRuntime; type: string; pins: string[] }> | null = null;

self.onmessage = (e: MessageEvent) => {
  const data = e.data;

  if (data.type === "init_interactive") {
    const netlist = data.netlist as CircuitNetlist;
    const componentFirmware = data.firmware as Record<string, Uint8Array>;
    
    const runtimes: Record<string, { runtime: McuRuntime; type: string; pins: string[] }> = {};
    for (const comp of netlist.components) {
      if (comp.type === 'mcu_8051' || comp.type === 'mcu_avr') {
        const baseDefinition = comp.type === 'mcu_avr'
          ? ATMEGA328P_DEFINITIONS
          : STANDARD_8051_DEFINITION;
        const definition = {
          ...baseDefinition,
          clockSpeed: comp.mcuClockSpeed ?? baseDefinition.clockSpeed,
        };
        const runtime = createMcuRuntime({
          definition,
          firmware: componentFirmware[comp.id],
        });
        runtime.pendingInterruptVector = null;
        runtime.globalInterruptEnable = true;
        runtimes[comp.id] = { runtime, type: comp.type, pins: [...comp.pins] };
      }
    }
    interactiveMcuRuntimes = runtimes;
    self.postMessage({ type: "init_success" });

  } else if (data.type === "process_frame") {
    const frame = data.frame as SimulationFrame;
    const dt = data.dt as number;

    if (interactiveMcuRuntimes) {
      // 1. Inyectar interrupción analógica si el frame trae trigger
      if (frame.triggerEvent) {
        dispatchAnalogTrigger(frame.triggerEvent, interactiveMcuRuntimes);
      }

      // 2. Avanzar cada MCU en dt ciclos de reloj
      for (const entry of Object.values(interactiveMcuRuntimes)) {
        const clockSpeed = entry.runtime.definition.clockSpeed;
        const cyclesToRun = Math.round(dt * clockSpeed);
        runCycles(entry.runtime, Math.min(cyclesToRun, 200_000));
      }
    }

    self.postMessage({ type: "frame_processed", frame });

  } else if (data.type === "stop_interactive") {
    interactiveMcuRuntimes = null;
    self.postMessage({ type: "stopped" });

  } else if (data.type === "run_fallback") {
    const netlist = data.netlist as CircuitNetlist;
    const dt = data.dt as number;
    const tMax = data.tMax as number;
    const firmware = data.firmware as Record<string, Uint8Array>;

    try {
      const results = solveTransientCircuitTS(netlist, dt, tMax, firmware);
      if (typeof results === "string") {
        self.postMessage({ type: "error", error: results });
      } else {
        self.postMessage({ type: "success", results });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: "error", error: errorMessage });
    }
  }
};
