import { describe, expect, it } from "vitest";
import {
  McuClockSynchronizer,
  AnalogThresholdEventDetector,
  CoSimulationSyncEngine,
} from "./co_simulation_sync";
import {
  createMcuRuntime,
  STANDARD_8051_DEFINITION,
  ATMEGA328P_DEFINITIONS,
  readACC,
} from "./index";

describe("Cycle-Accurate ↔ SPICE Co-Simulation Synchronization & Event-Driven Engine", () => {
  describe("1. McuClockSynchronizer (Zero Clock Drift)", () => {
    it("acumula fracciones de ciclo exactamente sin deriva temporal", () => {
      const sync = new McuClockSynchronizer(16_000_000); // 16 MHz (T_clk = 62.5 ns)

      // dt = 100 ns (1.6 ciclos -> debe ejecutar 1 ciclo y guardar 0.6 ciclos = 37.5 ns)
      const c1 = sync.calculateCyclesForTimestep(100e-9);
      expect(c1).toBe(1);

      // dt = 100 ns (tiempo disponible = 37.5 ns + 100 ns = 137.5 ns -> 2.2 ciclos -> ejecuta 2 ciclos)
      const c2 = sync.calculateCyclesForTimestep(100e-9);
      expect(c2).toBe(2);

      // dt = 100 ns (tiempo disponible = 12.5 ns + 100 ns = 112.5 ns -> 1.8 ciclos -> ejecuta 1 ciclo)
      const c3 = sync.calculateCyclesForTimestep(100e-9);
      expect(c3).toBe(1);

      // Total en 300 ns a 16 MHz: 300e-9 * 16e6 = 4.8 ciclos (1 + 2 + 1 = 4 ciclos ejecutados, 0.8 ciclos acumulados)
      const state = sync.getState();
      expect(state.totalCyclesExecuted).toBe(4);
      expect(state.totalSimulatedTime).toBeCloseTo(300e-9, 12);
    });

    it("mantiene consistencia de ciclos tras 1000 pasos de tamaño variable", () => {
      const sync = new McuClockSynchronizer(12_000_000); // 12 MHz (8051)
      let simulatedTime = 0;

      for (let i = 0; i < 1000; i++) {
        const dt = (10 + (i % 7)) * 1e-8; // 100 ns a 160 ns
        simulatedTime += dt;
        sync.calculateCyclesForTimestep(dt);
      }

      const expectedCycles = Math.floor(simulatedTime * 12_000_000);
      const state = sync.getState();
      expect(state.totalCyclesExecuted).toBe(expectedCycles);
    });
  });

  describe("2. AnalogThresholdEventDetector (Event-Driven Interrupts)", () => {
    it("detecta flanco de subida al cruzar el umbral analógico", () => {
      const detector = new AnalogThresholdEventDetector();
      detector.registerPin({
        componentId: "mcu1",
        pinIndex: 2,
        nodeId: "5",
        thresholdVoltage: 2.5,
        direction: "rising",
        interruptVector: 2, // INT0 en AVR
      });

      // Tensión inicial baja (0.5V) -> Sin evento
      const t1 = detector.detectCrossingEvents({ "5": 0.5 });
      expect(t1.length).toBe(0);

      // Tensión cruza a 3.3V (Flanco de subida) -> Dispara trigger
      const t2 = detector.detectCrossingEvents({ "5": 3.3 });
      expect(t2.length).toBe(1);
      expect(t2[0].componentId).toBe("mcu1");
      expect(t2[0].interruptVector).toBe(2);

      // Tensión se mantiene en 3.3V -> No vuelve a disparar
      const t3 = detector.detectCrossingEvents({ "5": 3.3 });
      expect(t3.length).toBe(0);
    });

    it("ignora fluctuaciones de ruido dentro de la banda de histéresis", () => {
      const detector = new AnalogThresholdEventDetector();
      detector.registerPin({
        componentId: "mcu1",
        pinIndex: 0,
        nodeId: "3",
        thresholdVoltage: 2.0,
        direction: "rising",
        interruptVector: 0,
        hysteresis: 0.1, // Banda 1.9V a 2.1V
      });

      detector.detectCrossingEvents({ "3": 1.0 }); // Inicial

      // Ruido cerca del umbral pero sin cruzar completamente (1.95V)
      const t1 = detector.detectCrossingEvents({ "3": 1.95 });
      expect(t1.length).toBe(0);

      // Cruce definitivo por encima de 2.1V
      const t2 = detector.detectCrossingEvents({ "3": 2.2 });
      expect(t2.length).toBe(1);
    });
  });

  describe("3. CoSimulationSyncEngine (Closed-Loop Mixed Signal Simulation)", () => {
    it("coordina cruce analógico con salto a ISR y actualización de pines GPIO", () => {
      // Firmware 8051:
      // 0x00: SJMP 0x00 (bucle infinito NOPs)
      // 0x08: ISR (vector 2 * 4 = 8): MOV A, #0x55; RETI
      const code = new Array(30).fill(0);
      code[0] = 0x80; code[1] = 0xFE; // SJMP -2
      code[8] = 0x74; code[9] = 0x55; // MOV A, #0x55
      code[10] = 0x32;                // RETI

      const runtime = createMcuRuntime({
        definition: STANDARD_8051_DEFINITION,
        firmware: new Uint8Array(code),
      });
      runtime.globalInterruptEnable = true;

      const engine = new CoSimulationSyncEngine();
      engine.addMcu("mcu_8051_1", runtime, "mcu_8051", ["0", "1", "2"]);

      // Monitorear pin 1 conectado al nodo analógico "3"
      engine.detector.registerPin({
        componentId: "mcu_8051_1",
        pinIndex: 1,
        nodeId: "3",
        thresholdVoltage: 2.5,
        direction: "rising",
        interruptVector: 2, // Vector 2 -> salta a 0x08
      });

      // Paso 1: Tensión baja (0V), avanzar 1 µs
      const res1 = engine.stepCoSimulation(1e-6, { "3": 0.0 });
      expect(res1.triggers.length).toBe(0);
      expect(readACC(runtime)).toBe(0x00);

      // Paso 2: Tensión sube a 5.0V (Flanco de subida -> Trigger) y avanza 5 µs
      const res2 = engine.stepCoSimulation(5e-6, { "3": 5.0 });
      expect(res2.triggers.length).toBe(1);
      expect(res2.triggers[0].interruptVector).toBe(2);

      // La MCU debió saltar a la ISR y ejecutar MOV A, #0x55
      expect(readACC(runtime)).toBe(0x55);
    });
  });
});
