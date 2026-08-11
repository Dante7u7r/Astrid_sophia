// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CanvasOrchestrator, ComponentInstance } from "../canvas_orchestrator";
import { PropertyEditor } from "./property_editor";

function installPropertyDom(): void {
  document.body.innerHTML = `
    <div id="properties-form">
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
    <div id="thermistor-container">
      <input id="prop-temp-slider" type="range" min="-50" max="150" />
      <span id="prop-temp-display"></span>
    </div>
    <div id="opamp-properties-container">
      <input id="prop-opamp-vos" type="range" min="0" max="20" step="0.1" />
      <span id="prop-opamp-vos-display"></span>
      <select id="prop-opamp-gain">
        <option value="100000">100k</option>
        <option value="1000000">1M</option>
      </select>
    </div>
    <button id="btn-apply-properties"></button>
    </div>
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

  test("limpia y deshabilita propiedades cuando no hay seleccion", () => {
    const component: ComponentInstance = {
      id: "R1", type: "resistor", value: 1000, x: 0, y: 0, rotation: 0,
    };
    const { editor } = createEditor(component);

    editor.clearPropertiesPanel();

    const idInput = document.querySelector<HTMLInputElement>("#prop-id-input")!;
    expect(idInput.value).toBe("");
    expect(idInput.placeholder).toBe("Selecciona un componente");
    expect(idInput.disabled).toBe(true);
    expect(document.querySelector("#properties-form")?.getAttribute("aria-disabled")).toBe("true");
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

  test("conserva cero grados en termistor y cero milivoltios en opamp", () => {
    const thermistor: ComponentInstance = {
      id: "TH1", type: "thermistor", value: 25, x: 0, y: 0, rotation: 0,
    };
    createEditor(thermistor);
    const temperature = document.querySelector("#prop-temp-slider") as HTMLInputElement;
    temperature.value = "0";
    temperature.dispatchEvent(new Event("input"));
    document.querySelector<HTMLButtonElement>("#btn-apply-properties")!.click();
    expect(thermistor.temperatureCelsius).toBe(0);
    expect(document.querySelector("#prop-temp-display")?.textContent).toBe("0 ºC");

    const opamp: ComponentInstance = {
      id: "U1", type: "opamp", value: 0, x: 0, y: 0, rotation: 0,
    };
    createEditor(opamp);
    const offset = document.querySelector("#prop-opamp-vos") as HTMLInputElement;
    offset.value = "0";
    offset.dispatchEvent(new Event("input"));
    document.querySelector<HTMLButtonElement>("#btn-apply-properties")!.click();
    expect(opamp.offsetVoltage).toBe(0);
    expect(document.querySelector("#prop-opamp-vos-display")?.textContent).toBe("0.0 mV");
  });
});
