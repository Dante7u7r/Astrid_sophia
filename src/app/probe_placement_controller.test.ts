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
      ch2: "2",
      ch3: "3",
      ch4: "4",
    });

    const logMessage = controller.placeProbe("CH3", "12");

    expect(controller.getNode("CH3")).toBe("12");
    expect(panel.ch3ProbeNode).toBe("12");
    expect(logMessage).toBe("Sonda del Canal 3 (Naranja) conectada al Nodo 12.");
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
});
