import { describe, expect, it } from "vitest";
import {
  calculateGpioLoadedVoltage,
  connectGpioToNode,
  createMcuSpiceBridge,
  disconnectGpio,
  getGpioState,
  getGpioTheveninEquivalent,
  setGpioDirection,
  syncMcSpice,
  voltageToDigitalState,
} from "./mcu-spice-bridge";

describe("mcu-spice-bridge (GPIO Co-simulation & Impedance Model)", () => {
  it("conecta, desconecta y configura la dirección de pines GPIO", () => {
    const mockMcu: any = { pc: 0, memory: { ram: new Uint8Array(128) } };
    const bridge = createMcuSpiceBridge(mockMcu, 8);

    expect(bridge.config.gpioPins.length).toBe(8);

    expect(connectGpioToNode(bridge, 0, "net_led")).toBe(true);
    expect(bridge.config.gpioPins[0].connectedNodeId).toBe("net_led");

    expect(setGpioDirection(bridge, 0, "output")).toBe(true);
    expect(bridge.config.gpioPins[0].direction).toBe("output");

    expect(disconnectGpio(bridge, 0)).toBe(true);
    expect(bridge.config.gpioPins[0].connectedNodeId).toBeNull();
  });

  it("calcula correctamente el modelo Thévenin en salida alta y baja", () => {
    const pin: any = { direction: "output", state: 1 };
    const eqHigh = getGpioTheveninEquivalent(pin, 5.0);
    expect(eqHigh.vTh).toBe(5.0);
    expect(eqHigh.rTh).toBe(25.0);
    expect(eqHigh.mode).toBe("output_high");

    pin.state = 0;
    const eqLow = getGpioTheveninEquivalent(pin, 5.0);
    expect(eqLow.vTh).toBe(0.0);
    expect(eqLow.rTh).toBe(25.0);
    expect(eqLow.mode).toBe("output_low");
  });

  it("calcula el modelo Thévenin con pull-up interno y alta impedancia", () => {
    const pin: any = { direction: "input", state: "Z" };

    const eqPullUp = getGpioTheveninEquivalent(pin, 5.0, true);
    expect(eqPullUp.vTh).toBe(5.0);
    expect(eqPullUp.rTh).toBe(35000.0);
    expect(eqPullUp.mode).toBe("input_pullup");

    const eqHighZ = getGpioTheveninEquivalent(pin, 5.0, false);
    expect(eqHighZ.rTh).toBe(10000000.0);
    expect(eqHighZ.mode).toBe("input_high_z");
  });

  it("calcula la corriente y caída de tensión con carga externa (calculateGpioLoadedVoltage)", () => {
    const pin: any = { direction: "output", state: 1 };
    // Salida 5V conectada a un nodo cargado a 4.5V
    const { pinCurrent } = calculateGpioLoadedVoltage(pin, 4.5, 5.0);
    // I = (5.0 - 4.5) / 25 = 0.5 / 25 = 0.02 A (20mA)
    expect(pinCurrent).toBeCloseTo(0.02, 4);
  });

  it("sincroniza tensiones analógicas y actualiza estados digitales en entradas", () => {
    const mockMcu: any = { pc: 0, memory: { ram: new Uint8Array(128) } };
    const bridge = createMcuSpiceBridge(mockMcu, 4);
    connectGpioToNode(bridge, 0, "net_in");
    setGpioDirection(bridge, 0, "input");

    const nodeVoltages = new Map<string, number>();
    nodeVoltages.set("net_in", 4.8);

    syncMcSpice(bridge, nodeVoltages);

    const pin = getGpioState(bridge, 0);
    expect(pin?.state).toBe(1);
  });
});
