import { describe, expect, it } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import { createCircuitStateManager } from "./circuit_state_manager";

function createComponent(id: string): ComponentInstance {
  return {
    id,
    type: "resistor",
    value: "1k",
    x: 0,
    y: 0,
    rotation: 0,
  };
}

describe("CircuitStateManager", () => {
  it("prepareForDemoLoad limpia osciloscopio, orquestador y estado electrico", () => {
    const state = createCircuitStateManager();
    state.setVoltagesFromSnapshot({ "1": 5 });
    state.setPinToNodeMap({ "R1:0": "1" });

    const oscilloscopePanel = {
      transientResults: [{ time: 0 }],
      acSweepResults: { frequencies: [1] },
      sweepTime: 1,
    };
    const component = createComponent("R1");
    const orchestrator = {
      components: [component],
      wires: [{ id: "W1", from: { componentId: "R1", pinIndex: 0 }, to: { componentId: "R1", pinIndex: 1 }, points: [] }],
      selectedComponent: component,
      selectedComponents: [component],
      selectedWire: null,
      activePinForWire: { componentId: "R1", pinIndex: 0, x: 0, y: 0 },
      tempWireEnd: { x: 10, y: 10 },
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 20, y: 20 },
    };

    state.prepareForDemoLoad(oscilloscopePanel, orchestrator);

    expect(oscilloscopePanel.transientResults).toEqual([]);
    expect(oscilloscopePanel.acSweepResults).toBeNull();
    expect(oscilloscopePanel.sweepTime).toBe(0);
    expect(orchestrator.components).toEqual([]);
    expect(orchestrator.wires).toEqual([]);
    expect(orchestrator.selectedComponent).toBeNull();
    expect(orchestrator.selectedComponents).toEqual([]);
    expect(orchestrator.activePinForWire).toBeNull();
    expect(orchestrator.tempWireEnd).toBeNull();
    expect(state.getVoltageMap()).toEqual({});
    expect(state.getPinToNodeMap()).toEqual({});
  });
});
