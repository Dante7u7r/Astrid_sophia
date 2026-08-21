import { solveTransientCircuitTS } from "./fallback_solver";
import { createMcuRuntime, runCycles, type McuRuntime } from "./mcu-runtime";
import { dispatchAnalogTrigger } from "./mcu-spice-bridge";
import { McuClockSynchronizer } from "./co_simulation_sync";
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

let interactiveMcuRuntimes: Record<string, { runtime: McuRuntime; type: string; pins: string[]; sync: McuClockSynchronizer }> | null = null;

self.onmessage = (e: MessageEvent) => {
  const data = e.data;

  if (data.type === "init_interactive") {
    const netlist = data.netlist as CircuitNetlist;
    const componentFirmware = data.firmware as Record<string, Uint8Array>;
    
    const runtimes: Record<string, { runtime: McuRuntime; type: string; pins: string[]; sync: McuClockSynchronizer }> = {};
    for (const comp of netlist.components) {
      if (
        comp.type === 'mcu_8051'
        || comp.type === 'mcu_avr'
        || comp.type === 'arduino_uno'
        || comp.type === 'esp32'
        || comp.type === 'raspberry_pi_pico'
      ) {
        const baseDefinition = (comp.type === 'mcu_avr' || comp.type === 'arduino_uno')
          ? ATMEGA328P_DEFINITIONS
          : STANDARD_8051_DEFINITION;
        const definition = {
          ...baseDefinition,
          clockSpeed: comp.mcuClockSpeed ?? baseDefinition.clockSpeed,
        };
        const runtime = createMcuRuntime({
          definition,
          firmware: componentFirmware[comp.id],
          maxCycles: Infinity,
        });
        runtime.pendingInterruptVector = null;
        runtime.globalInterruptEnable = true;
        const sync = new McuClockSynchronizer(definition.clockSpeed);
        runtimes[comp.id] = { runtime, type: comp.type, pins: [...comp.pins], sync };
      }
    }
    interactiveMcuRuntimes = runtimes;
    self.postMessage({ type: "init_success" });

  } else if (data.type === "process_frame") {
    const frame = data.frame as SimulationFrame;
    const dt = data.dt as number;

    const gpioUpdates: Array<{ componentId: string; pinIndex: number; state: 0 | 1 | "Z" | "X" }> = [];
    const mcuTelemetry: Record<string, { pc: number; cycles: number }> = {};

    if (interactiveMcuRuntimes) {
      try {
        // 1. Inyectar interrupción analógica si el frame trae trigger
        if (frame.triggerEvent) {
          dispatchAnalogTrigger(frame.triggerEvent, interactiveMcuRuntimes);
        }

        // 2. Avanzar el contador temporal del runtime MCU con sincronización cycle-accurate
        for (const [compId, entry] of Object.entries(interactiveMcuRuntimes)) {
          const cyclesToRun = entry.sync.calculateCyclesForTimestep(dt);
          if (cyclesToRun > 0) {
            runCycles(entry.runtime, Math.min(cyclesToRun, 200_000));
          }

          mcuTelemetry[compId] = {
            pc: entry.runtime.state.pc,
            cycles: entry.runtime.state.cycle,
          };

          // Extraer estado de pines de salida para retroalimentación analógica
          for (let pinIdx = 0; pinIdx < entry.pins.length; pinIdx++) {
            const pinVal = entry.runtime.memory.ram[0x80 + pinIdx] ?? 0;
            gpioUpdates.push({
              componentId: compId,
              pinIndex: pinIdx,
              state: (pinVal & 1) ? 1 : 0,
            });
          }
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        self.postMessage({ type: "mcu_error", error: errorMsg, frameIndex: frame.frameIndex });
      }
    }

    self.postMessage({ type: "frame_processed", frame, gpioUpdates, mcuTelemetry });

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
