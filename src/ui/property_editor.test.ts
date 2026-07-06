// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CanvasOrchestrator, ComponentInstance } from "../canvas_orchestrator";
import { PropertyEditor } from "./property_editor";

function installPropertyDom(): void {
  document.body.innerHTML = `
    <input id="prop-id-input" />
    <div id="group-comp-val"><span class="property-label"></span>
      <input id="prop-val-input" />
      <button id="prop-val-dec"></button>
      <button id="prop-val-inc"></button>
      <input id="prop-val-slider" type="range" />
    </div>
    <div id="group-comp-unit"><input id="prop-unit-input" /></div>
    <div id="dmm-properties-container">
      <select id="prop-dmm-mode">
        <option value="V">V</option><option value="A">A</option><option value="R">R</option>
      </select>
    </div>
    <div id="switch-properties-container">
      <input id="prop-switch-state" type="checkbox" />
      <input id="prop-switch-ron" />
      <input id="prop-switch-roff" />
      <input id="prop-switch-vth" />
      <input id="prop-switch-vh" />
    </div>
    <div id="transformer-properties-container">
      <input id="prop-transformer-l1" />
      <input id="prop-transformer-l2" />
      <input id="prop-transformer-k" />
    </div>
    <button id="btn-apply-properties"></button>
  `;
}

function createEditor(component: ComponentInstance) {
  const orchestrator = {
    selectedComponent: component,
    renameComponent: vi.fn(() => null),
  } as unknown as CanvasOrchestrator;
  const markModified = vi.fn();
  const editor = new PropertyEditor({
    getOrchestrator: () => orchestrator,
    getMcuDebugPanel: () => null,
    getSimulationRunner: () => null,
    addLog: vi.fn(),
    updateCanvasRendering: vi.fn(),
    markCurrentTabAsModified: markModified,
    invokeTauri: vi.fn(),
  });
  editor.init();
  editor.updatePropertiesPanel(component);
  return { editor, markModified };
}

describe("PropertyEditor componentes especiales", () => {
  beforeEach(installPropertyDom);

  test("cambiar y aplicar el modo DMM no lo sobrescribe con cero", () => {
    const dmm: ComponentInstance = {
      id: "DMM1", type: "dmm", value: "V", x: 0, y: 0, rotation: 0,
    };
    createEditor(dmm);
    const mode = document.querySelector("#prop-dmm-mode") as HTMLSelectElement;

    mode.value = "A";
    mode.dispatchEvent(new Event("change"));
    expect(dmm.value).toBe("A");
    expect(dmm.dmmValue).toBe("OPEN");

    mode.value = "R";
    document.querySelector<HTMLButtonElement>("#btn-apply-properties")!.click();
    expect(dmm.value).toBe("R");
  });

  test("aplica parametros de transformador y switch desde controles dedicados", () => {
    const transformer: ComponentInstance = {
      id: "T1", type: "transformer", value: 0.001, x: 0, y: 0, rotation: 0,
    };
    createEditor(transformer);
    (document.querySelector("#prop-transformer-l1") as HTMLInputElement).value = "0.002";
    (document.querySelector("#prop-transformer-l2") as HTMLInputElement).value = "0.008";
    (document.querySelector("#prop-transformer-k") as HTMLInputElement).value = "0.97";
    document.querySelector<HTMLButtonElement>("#btn-apply-properties")!.click();

    expect(transformer.primaryInductance).toBe(0.002);
    expect(transformer.secondaryInductance).toBe(0.008);
    expect(transformer.couplingCoefficient).toBe(0.97);
  });
});
