import { describe, expect, it } from "vitest";
import type { McuDefinition } from "./mcu-types";
import {
  createMcuRuntime,
  fetchWord,
  injectHardwareInterrupt,
  runCycles,
} from "./mcu-runtime";

const TEST_DEFINITION: McuDefinition = {
  name: "MCU de prueba",
  architecture: "8051",
  clockSpeed: 1_000_000,
  flashSize: 256,
  ramSize: 256,
  registers: [],
  peripherals: [],
  pcSize: 16,
  stackPointerSize: 8,
};

describe("infraestructura del runtime MCU experimental", () => {
  it("copia el firmware sin exceder la flash", () => {
    const firmware = Uint8Array.from({ length: 300 }, (_, index) => index);
    const runtime = createMcuRuntime({ definition: TEST_DEFINITION, firmware });

    expect(runtime.memory.flash).toHaveLength(256);
    expect(runtime.memory.flash[0]).toBe(0);
    expect(runtime.memory.flash[255]).toBe(255);
  });

  it("lee palabras little-endian desde dos bytes consecutivos", () => {
    const runtime = createMcuRuntime({
      definition: TEST_DEFINITION,
      firmware: Uint8Array.from([0x34, 0x12]),
    });

    expect(fetchWord(runtime)).toBe(0x1234);
    expect(runtime.state.pc).toBe(0);
  });

  it("aplica el limite total de ciclos tambien al reanudar", () => {
    const runtime = createMcuRuntime({
      definition: TEST_DEFINITION,
      firmware: Uint8Array.from([0x00, 0x00, 0x00, 0x00]),
      maxCycles: 3,
    });

    expect(runCycles(runtime, 2)).toBe(2);
    expect(runtime.state.cycle).toBe(2);
    expect(runCycles(runtime, 10)).toBe(1);
    expect(runtime.state.cycle).toBe(3);
    expect(runtime.halted).toBe(true);
    expect(runtime.haltReason).toBe("Cycle limit reached");
  });

  it("atiende una interrupcion pendiente dentro de runCycles", () => {
    const runtime = createMcuRuntime({
      definition: TEST_DEFINITION,
      initialPc: 0x1234,
      maxCycles: 20,
    });

    injectHardwareInterrupt(runtime, 2);
    expect(runCycles(runtime, 4)).toBe(4);

    expect(runtime.pendingInterruptVector).toBeNull();
    expect(runtime.globalInterruptEnable).toBe(false);
    expect(runtime.state.pc).toBe(8);
    expect(runtime.state.sp).toBe(0x81);
    expect(runtime.memory.ram[0x80]).toBe(0x12);
    expect(runtime.memory.ram[0x81]).toBe(0x34);
    expect(runtime.state.cycle).toBe(4);
  });

  it("respeta la mascara global de interrupciones", () => {
    const runtime = createMcuRuntime({ definition: TEST_DEFINITION });
    runtime.globalInterruptEnable = false;

    injectHardwareInterrupt(runtime, 3);

    expect(runtime.pendingInterruptVector).toBeNull();
  });
});
