// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  openSubcircuitInspector,
  closeSubcircuitInspector,
} from "./subcircuit_inspector_modal";

describe("subcircuit_inspector_modal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    closeSubcircuitInspector();
  });

  it("abre el inspector y renderiza los pines y netlist del macromodelo", () => {
    const comp: ComponentInstance = {
      id: "X1",
      type: "x",
      x: 0,
      y: 0,
      rotation: 0,
      modelName: "LM741",
      pinLabels: { 0: "IN+", 1: "IN-", 2: "V+", 3: "V-", 4: "OUT" },
    };

    openSubcircuitInspector(comp);

    const overlay = document.querySelector(".subcircuit-inspector-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("LM741");
    expect(overlay?.textContent).toContain("IN+");
    expect(overlay?.textContent).toContain(".SUBCKT LM741");
  });

  it("cierra el inspector al invocar closeSubcircuitInspector()", () => {
    const comp: ComponentInstance = {
      id: "X2",
      type: "x",
      x: 0,
      y: 0,
      rotation: 0,
      modelName: "NE555",
    };

    openSubcircuitInspector(comp);
    expect(document.querySelector(".subcircuit-inspector-overlay")).not.toBeNull();

    closeSubcircuitInspector();
    expect(document.querySelector(".subcircuit-inspector-overlay")).toBeNull();
  });
});
