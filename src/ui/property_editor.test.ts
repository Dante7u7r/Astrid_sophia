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
      <button id="btn-snap-standard">E24</button>
      <button id="prop-val-dec"></button>
      <button id="prop-val-inc"></button>
      <input id="prop-val-slider" type="range" />
    </div>
    <div id="group-comp-unit"><input id="prop-unit-input" /></div>
    <div id="group-comp-preset">
      <select id="prop-preset-select"></select>
    </div>
    <div id="wave-properties-container">
      <select id="prop-wave-type"><option value="dc">CC</option><option value="sine">Seno</option><option value="am">AM</option></select>
      <div id="group-wave-amp"><input id="prop-wave-amp" /></div>
      <div id="group-wave-freq"><input id="prop-wave-freq" /></div>
      <div id="group-wave-mod-freq"><input id="prop-wave-mod-freq" /></div>
      <div id="group-wave-mod-index"><input id="prop-wave-mod-index" /></div>
      <div id="group-wave-phase"><input id="prop-wave-phase" /></div>
      <div id="group-wave-offset"><input id="prop-wave-offset" /></div>
      <div id="group-wave-duty"><input id="prop-wave-duty" /></div>
      <div id="group-wave-rs"><input id="prop-wave-rs" /></div>
      <div id="group-wave-ac-mag"><input id="prop-wave-ac-mag" /></div>
      <div id="group-wave-ac-phase"><input id="prop-wave-ac-phase" /></div>
    </div>
    <div id="resistor-properties-container">
      <select id="prop-resistor-tolerance"><option value="1">1%</option><option value="5">5%</option></select>
      <select id="prop-resistor-power"><option value="0.25">0.25W</option><option value="1">1W</option></select>
    </div>
    <div id="capacitor-properties-container">
      <select id="prop-capacitor-voltage"><option value="25">25V</option><option value="50">50V</option></select>
      <input id="prop-capacitor-esr" />
      <select id="prop-capacitor-dielectric"><option value="ceramic">Ceramic</option><option value="electrolytic">Electrolytic</option></select>
    </div>
    <div id="inductor-properties-container">
      <input id="prop-inductor-dcr" />
      <input id="prop-inductor-isat" />
    </div>
    <div id="led-properties-container">
      <select id="prop-led-color"><option value="red">Red</option><option value="green">Green</option><option value="blue">Blue</option></select>
      <input id="prop-led-imax" />
    </div>
    <div id="potentiometer-container">
      <input id="prop-wiper-slider" type="range" min="0.01" max="0.99" step="0.01" value="0.5" />
      <span id="prop-wiper-display">50%</span>
      <select id="prop-pot-taper"><option value="linear">Lineal</option><option value="log">Log</option></select>
    </div>
    <div id="semiconductor-properties-container">
      <select id="prop-semi-model"><option value="custom">custom</option></select>
      <div id="prop-semi-desc"></div>
      <div id="group-diode-bv"><input id="prop-diode-bv" /></div>
    </div>
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
  const extractNetlist = vi.fn();
  const editor = new PropertyEditor({
    getOrchestrator: () => orchestrator,
    getMcuDebugPanel: () => null,
    getSimulationRunner: () => null,
    addLog: vi.fn(),
    updateCanvasRendering: vi.fn(),
    markCurrentTabAsModified: markModified,
    extractNetlist,
    invokeTauri: vi.fn(),
  });
  editor.init();
  editor.updatePropertiesPanel(component);
  return { editor, markModified, extractNetlist };
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

  test("Enter aplica la fuente CC y sincroniza la netlist", () => {
    const source: ComponentInstance = {
      id: "V1", type: "vsource", value: 5, x: 0, y: 0, rotation: 0,
    };
    const { extractNetlist } = createEditor(source);
    const valueInput = document.querySelector("#prop-val-input") as HTMLInputElement;
    valueInput.value = "12";
    valueInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(source.value).toBe(12);
    expect(source.offset).toBe(12);
    expect(extractNetlist).toHaveBeenCalledOnce();
  });

  test("aplica y persiste parametros avanzados de fuente AM, fase y resistencia interna", () => {
    const source: ComponentInstance = {
      id: "V_RF", type: "vsource", value: 1, x: 0, y: 0, rotation: 0,
    };
    createEditor(source);

    const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
    waveTypeSelect.value = "am";
    waveTypeSelect.dispatchEvent(new Event("change"));

    (document.querySelector("#prop-wave-amp") as HTMLInputElement).value = "10";
    (document.querySelector("#prop-wave-freq") as HTMLInputElement).value = "1000000";
    (document.querySelector("#prop-wave-mod-freq") as HTMLInputElement).value = "1000";
    (document.querySelector("#prop-wave-mod-index") as HTMLInputElement).value = "0.75";
    (document.querySelector("#prop-wave-phase") as HTMLInputElement).value = "45";
    (document.querySelector("#prop-wave-offset") as HTMLInputElement).value = "1.5";
    (document.querySelector("#prop-wave-rs") as HTMLInputElement).value = "50";

    document.querySelector<HTMLButtonElement>("#btn-apply-properties")!.click();

    expect(source.waveType).toBe("am");
    expect(source.amplitude).toBe(10);
    expect(source.frequency).toBe(1000000);
    expect(source.modFrequency).toBe(1000);
    expect(source.modIndex).toBe(0.75);
    expect(source.phase).toBe(45);
    expect(source.offset).toBe(1.5);
    expect(source.sourceResistance).toBe(50);
  });

  test("aplica y persiste propiedades de ingenieria para pasivos y optoelectronica", () => {
    // 1. Resistor: tolerancia y potencia
    const resistor: ComponentInstance = { id: "R1", type: "resistor", value: 4700, x: 0, y: 0, rotation: 0 };
    createEditor(resistor);
    (document.querySelector("#prop-resistor-tolerance") as HTMLSelectElement).value = "5";
    (document.querySelector("#prop-resistor-power") as HTMLSelectElement).value = "1";
    document.querySelector<HTMLButtonElement>("#btn-apply-properties")!.click();
    expect(resistor.tolerance).toBe(5);
    expect(resistor.powerRating).toBe(1);

    // 2. Capacitor: voltage rating, esr, dieléctrico
    const capacitor: ComponentInstance = { id: "C1", type: "capacitor", value: 1e-6, x: 0, y: 0, rotation: 0 };
    createEditor(capacitor);
    (document.querySelector("#prop-capacitor-voltage") as HTMLSelectElement).value = "50";
    (document.querySelector("#prop-capacitor-esr") as HTMLInputElement).value = "0.05";
    (document.querySelector("#prop-capacitor-dielectric") as HTMLSelectElement).value = "electrolytic";
    document.querySelector<HTMLButtonElement>("#btn-apply-properties")!.click();
    expect(capacitor.voltageRating).toBe(50);
    expect(capacitor.esr).toBe(0.05);
    expect(capacitor.dielectricType).toBe("electrolytic");

    // 3. Inductor: DCR y corriente de saturación
    const inductor: ComponentInstance = { id: "L1", type: "inductor", value: 1e-3, x: 0, y: 0, rotation: 0 };
    createEditor(inductor);
    (document.querySelector("#prop-inductor-dcr") as HTMLInputElement).value = "0.15";
    (document.querySelector("#prop-inductor-isat") as HTMLInputElement).value = "2.5";
    document.querySelector<HTMLButtonElement>("#btn-apply-properties")!.click();
    expect(inductor.dcResistance).toBe(0.15);
    expect(inductor.currentRating).toBe(2.5);

    // 4. LED: color y corriente máxima
    const led: ComponentInstance = { id: "D1", type: "led", value: 0, x: 0, y: 0, rotation: 0 };
    createEditor(led);
    (document.querySelector("#prop-led-color") as HTMLSelectElement).value = "blue";
    (document.querySelector("#prop-led-imax") as HTMLInputElement).value = "30";
    document.querySelector<HTMLButtonElement>("#btn-apply-properties")!.click();
    expect(led.ledColor).toBe("blue");
    expect(led.maxCurrent).toBe(30);

    // 5. Potenciómetro: curva / taper
    const pot: ComponentInstance = { id: "POT1", type: "potentiometer", value: 10000, x: 0, y: 0, rotation: 0 };
    createEditor(pot);
    (document.querySelector("#prop-pot-taper") as HTMLSelectElement).value = "log";
    document.querySelector<HTMLButtonElement>("#btn-apply-properties")!.click();
    expect(pot.potTaper).toBe("log");
  });

  test("ajusta valor nominal a la serie comercial E24 al pulsar el boton E24", () => {
    const resistor: ComponentInstance = { id: "R1", type: "resistor", value: 4620, x: 0, y: 0, rotation: 0 };
    createEditor(resistor);
    const valInput = document.querySelector("#prop-val-input") as HTMLInputElement;
    valInput.value = "4620";

    const btnSnap = document.querySelector("#btn-snap-standard") as HTMLButtonElement;
    btnSnap.click();

    expect(resistor.value).toBe(4700);
  });

  test("carga plantillas comerciales / presets rapidos en componentes", () => {
    const capacitor: ComponentInstance = { id: "C1", type: "capacitor", value: 1e-6, x: 0, y: 0, rotation: 0 };
    createEditor(capacitor);

    const presetSelect = document.querySelector("#prop-preset-select") as HTMLSelectElement;
    expect(presetSelect.options.length).toBeGreaterThan(1);

    presetSelect.value = "decoupling_100n";
    presetSelect.dispatchEvent(new Event("change"));

    expect(capacitor.value).toBe(1e-7);
    expect(capacitor.voltageRating).toBe(50);
    expect(capacitor.dielectricType).toBe("ceramic");
  });

  test("aplica magnitud y fase AC para barridos de frecuencia Bode y tension Zener", () => {
    const source: ComponentInstance = { id: "V1", type: "vsource", value: 10, x: 0, y: 0, rotation: 0 };
    createEditor(source);

    (document.querySelector("#prop-wave-ac-mag") as HTMLInputElement).value = "2.5";
    (document.querySelector("#prop-wave-ac-phase") as HTMLInputElement).value = "45";
    document.querySelector<HTMLButtonElement>("#btn-apply-properties")!.click();

    expect(source.acMag).toBe(2.5);
    expect(source.acPhase).toBe(45);

    const diode: ComponentInstance = { id: "D1", type: "diode", value: 0.7, x: 0, y: 0, rotation: 0 };
    createEditor(diode);

    (document.querySelector("#prop-diode-bv") as HTMLInputElement).value = "5.1";
    document.querySelector<HTMLButtonElement>("#btn-apply-properties")!.click();

    expect(diode.diodeBv).toBe(5.1);
  });
});
