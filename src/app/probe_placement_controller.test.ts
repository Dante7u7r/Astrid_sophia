import { describe, expect, it } from "vitest";
import { createProbePlacementController } from "./probe_placement_controller";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";

describe("ProbePlacementController", () => {
  it("sincroniza nodos con el panel del osciloscopio al colocar sondas", () => {
    const panel = {
      ch1ProbeNode: null,
      ch2ProbeNode: null,
      ch3ProbeNode: null,
      ch4ProbeNode: null,
    } as OscilloscopePanel;
    const controller = createProbePlacementController({
      getOscilloscopePanel: () => panel,
    });

    expect(controller.getNodes()).toEqual({
      ch1: "1",
      ch2: null,
      ch3: null,
      ch4: null,
    });

    const logMessage = controller.placeProbe("CH3", "12");

    expect(controller.getNode("CH3")).toBe("12");
    expect(panel.ch3ProbeNode).toBe("12");
    expect(logMessage).toBe("Sonda del Canal 3 (Rosa) conectada al Nodo 12.");
  });

  it("gestiona el modo activo de colocacion", () => {
    const controller = createProbePlacementController({
      getOscilloscopePanel: () => null,
    });

    controller.setMode("CH2");
    expect(controller.getMode()).toBe("CH2");

    controller.clearMode();
    expect(controller.getMode()).toBeNull();
  });

  it("conecta sondas diferenciales V(pos,neg) y sincroniza con el panel", () => {
    const panel = {
      ch1ProbeNode: null,
      ch2ProbeNode: null,
      ch3ProbeNode: null,
      ch4ProbeNode: null,
      setChannelActive: () => {},
    } as unknown as OscilloscopePanel;
    const controller = createProbePlacementController({
      getOscilloscopePanel: () => panel,
    });

    const logMessage = controller.placeDifferentialProbe("CH2", "5", "3");
    expect(controller.getNode("CH2")).toBe("V(5,3)");
    expect(panel.ch2ProbeNode).toBe("V(5,3)");
    expect(logMessage).toContain("Sonda Diferencial del Canal 2");
    expect(logMessage).toContain("entre Nodos 5 y 3");
  });
});
