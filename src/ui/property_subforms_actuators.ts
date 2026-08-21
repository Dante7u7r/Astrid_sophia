import type { ComponentInstance, CanvasOrchestrator } from "../canvas_orchestrator";
import { DMM_INITIAL_DISPLAY, normalizeDmmMode } from "../simulation/dmm";
import { clampSwitchProperties, clampTransformerProperties } from "./property_model";

export interface ActuatorSubformCallbacks {
  getOrchestrator: () => CanvasOrchestrator | null;
  updateCanvasRendering: () => void;
  markCurrentTabAsModified: () => void;
}

export function bindActuatorsSubformEvents(callbacks: ActuatorSubformCallbacks): void {
  const wiperSlider = document.querySelector("#prop-wiper-slider") as HTMLInputElement | null;
  const wiperDisplay = document.querySelector("#prop-wiper-display") as HTMLElement | null;
  if (wiperSlider && wiperDisplay) {
    wiperSlider.addEventListener("input", (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value) || 0.5;
      wiperDisplay.textContent = `${Math.round(val * 100)}%`;
    });
  }

  const luxSlider = document.querySelector("#prop-lux-slider") as HTMLInputElement | null;
  const luxDisplay = document.querySelector("#prop-lux-display") as HTMLElement | null;
  if (luxSlider && luxDisplay) {
    luxSlider.addEventListener("input", (e) => {
      const val = parseInt((e.target as HTMLInputElement).value) || 100;
      luxDisplay.textContent = `${val} Lx`;
    });
  }

  const tempSlider = document.querySelector("#prop-temp-slider") as HTMLInputElement | null;
  const tempDisplay = document.querySelector("#prop-temp-display") as HTMLElement | null;
  if (tempSlider && tempDisplay) {
    tempSlider.addEventListener("input", (e) => {
      const parsed = parseInt((e.target as HTMLInputElement).value);
      const val = Number.isFinite(parsed) ? parsed : 25;
      tempDisplay.textContent = `${val} ºC`;
    });
  }

  const dmmModeSelect = document.querySelector("#prop-dmm-mode") as HTMLSelectElement | null;
  if (dmmModeSelect) {
    dmmModeSelect.addEventListener("change", () => {
      const orchestrator = callbacks.getOrchestrator();
      const selected = orchestrator ? orchestrator.selectedComponent : null;
      if (selected && selected.type === "dmm") {
        selected.value = normalizeDmmMode(dmmModeSelect.value);
        selected.dmmValue = DMM_INITIAL_DISPLAY;
        callbacks.updateCanvasRendering();
        callbacks.markCurrentTabAsModified();
      }
    });
  }

  const opampVosSlider = document.querySelector("#prop-opamp-vos") as HTMLInputElement | null;
  const opampVosDisplay = document.querySelector("#prop-opamp-vos-display") as HTMLElement | null;
  const opampGainSelect = document.querySelector("#prop-opamp-gain") as HTMLSelectElement | null;

  if (opampVosSlider && opampVosDisplay) {
    opampVosSlider.addEventListener("input", (e) => {
      const parsed = parseFloat((e.target as HTMLInputElement).value);
      const val = Number.isFinite(parsed) ? parsed : 2.0;
      opampVosDisplay.textContent = `${val.toFixed(1)} mV`;
      const orchestrator = callbacks.getOrchestrator();
      const selected = orchestrator ? orchestrator.selectedComponent : null;
      if (selected && selected.type === "opamp") {
        selected.offsetVoltage = val / 1000.0;
        callbacks.updateCanvasRendering();
        callbacks.markCurrentTabAsModified();
      }
    });
  }

  if (opampGainSelect) {
    opampGainSelect.addEventListener("change", () => {
      const val = parseFloat(opampGainSelect.value) || 100000.0;
      const orchestrator = callbacks.getOrchestrator();
      const selected = orchestrator ? orchestrator.selectedComponent : null;
      if (selected && selected.type === "opamp") {
        selected.openLoopGain = val;
        callbacks.updateCanvasRendering();
        callbacks.markCurrentTabAsModified();
      }
    });
  }
}

export function updateActuatorsSubform(comp: ComponentInstance): void {
  const potentiometerContainer = document.querySelector("#potentiometer-container") as HTMLElement | null;
  const wiperSlider = document.querySelector("#prop-wiper-slider") as HTMLInputElement | null;
  const wiperDisplay = document.querySelector("#prop-wiper-display") as HTMLElement | null;
  const potTaperSelect = document.querySelector("#prop-pot-taper") as HTMLSelectElement | null;
  if (potentiometerContainer && wiperSlider && wiperDisplay) {
    if (comp.type === "potentiometer") {
      potentiometerContainer.style.display = "flex";
      const wPos = comp.wiperPosition ?? 0.5;
      wiperSlider.value = wPos.toString();
      wiperDisplay.textContent = `${Math.round(wPos * 100)}%`;
      if (potTaperSelect) potTaperSelect.value = comp.potTaper || "linear";
    } else {
      potentiometerContainer.style.display = "none";
    }
  }

  const ldrContainer = document.querySelector("#ldr-container") as HTMLElement | null;
  const luxSlider = document.querySelector("#prop-lux-slider") as HTMLInputElement | null;
  const luxDisplay = document.querySelector("#prop-lux-display") as HTMLElement | null;
  if (ldrContainer && luxSlider && luxDisplay) {
    if (comp.type === "ldr") {
      ldrContainer.style.display = "flex";
      const luxVal = comp.lux ?? 100;
      luxSlider.value = luxVal.toString();
      luxDisplay.textContent = `${luxVal} Lx`;
    } else {
      ldrContainer.style.display = "none";
    }
  }

  const thermistorContainer = document.querySelector("#thermistor-container") as HTMLElement | null;
  const tempSlider = document.querySelector("#prop-temp-slider") as HTMLInputElement | null;
  const tempDisplay = document.querySelector("#prop-temp-display") as HTMLElement | null;
  if (thermistorContainer && tempSlider && tempDisplay) {
    if (comp.type === "thermistor") {
      thermistorContainer.style.display = "flex";
      const tempVal = comp.temperatureCelsius ?? 25;
      tempSlider.value = tempVal.toString();
      tempDisplay.textContent = `${tempVal} ºC`;
    } else {
      thermistorContainer.style.display = "none";
    }
  }

  const dmmContainer = document.querySelector("#dmm-properties-container") as HTMLElement | null;
  const dmmModeSelect = document.querySelector("#prop-dmm-mode") as HTMLSelectElement | null;
  if (dmmContainer && dmmModeSelect) {
    if (comp.type === "dmm") {
      dmmContainer.style.display = "flex";
      dmmModeSelect.value = normalizeDmmMode(comp.value);
    } else {
      dmmContainer.style.display = "none";
    }
  }

  const switchContainer = document.querySelector("#switch-properties-container") as HTMLElement | null;
  const switchState = document.querySelector("#prop-switch-state") as HTMLInputElement | null;
  const switchRon = document.querySelector("#prop-switch-ron") as HTMLInputElement | null;
  const switchRoff = document.querySelector("#prop-switch-roff") as HTMLInputElement | null;
  const switchVth = document.querySelector("#prop-switch-vth") as HTMLInputElement | null;
  const switchVh = document.querySelector("#prop-switch-vh") as HTMLInputElement | null;
  if (switchContainer && switchState && switchRon && switchRoff && switchVth && switchVh) {
    switchContainer.style.display = comp.type === "switch" ? "flex" : "none";
    if (comp.type === "switch") {
      switchState.checked = comp.switchState ?? false;
      switchRon.value = (comp.switchRon ?? 0.01).toString();
      switchRoff.value = (comp.switchRoff ?? 1e9).toString();
      switchVth.value = (comp.switchVth ?? 0.5).toString();
      switchVh.value = (comp.switchVh ?? 0.05).toString();
    }
  }

  const transformerContainer = document.querySelector("#transformer-properties-container") as HTMLElement | null;
  const transformerL1 = document.querySelector("#prop-transformer-l1") as HTMLInputElement | null;
  const transformerL2 = document.querySelector("#prop-transformer-l2") as HTMLInputElement | null;
  const transformerK = document.querySelector("#prop-transformer-k") as HTMLInputElement | null;
  if (transformerContainer && transformerL1 && transformerL2 && transformerK) {
    transformerContainer.style.display = comp.type === "transformer" ? "flex" : "none";
    if (comp.type === "transformer") {
      transformerL1.value = (comp.primaryInductance ?? 1e-3).toString();
      transformerL2.value = (comp.secondaryInductance ?? 1e-3).toString();
      transformerK.value = (comp.couplingCoefficient ?? 0.9).toString();
    }
  }

  const opampContainer = document.querySelector("#opamp-properties-container") as HTMLElement | null;
  const opampVosSlider = document.querySelector("#prop-opamp-vos") as HTMLInputElement | null;
  const opampVosDisplay = document.querySelector("#prop-opamp-vos-display") as HTMLElement | null;
  const opampGainSelect = document.querySelector("#prop-opamp-gain") as HTMLSelectElement | null;
  if (opampContainer && opampVosSlider && opampVosDisplay && opampGainSelect) {
    if (comp.type === "opamp") {
      opampContainer.style.display = "flex";
      const vosMilli = (comp.offsetVoltage !== undefined ? comp.offsetVoltage : 0.002) * 1000;
      opampVosSlider.value = vosMilli.toString();
      opampVosDisplay.textContent = `${vosMilli.toFixed(1)} mV`;
      opampGainSelect.value = (comp.openLoopGain !== undefined ? comp.openLoopGain : 100000).toString();
    } else {
      opampContainer.style.display = "none";
    }
  }
}

export function applyActuatorsSubform(selected: ComponentInstance): void {
  if (selected.type === "potentiometer") {
    const wiperSlider = document.querySelector("#prop-wiper-slider") as HTMLInputElement | null;
    const potTaperSelect = document.querySelector("#prop-pot-taper") as HTMLSelectElement | null;
    if (wiperSlider) selected.wiperPosition = parseFloat(wiperSlider.value) || 0.5;
    if (potTaperSelect) selected.potTaper = potTaperSelect.value as any;
  }

  if (selected.type === "ldr") {
    const luxSlider = document.querySelector("#prop-lux-slider") as HTMLInputElement | null;
    if (luxSlider) selected.lux = parseInt(luxSlider.value) || 100;
  }

  if (selected.type === "thermistor") {
    const tempSlider = document.querySelector("#prop-temp-slider") as HTMLInputElement | null;
    if (tempSlider) {
      const parsedTemperature = parseInt(tempSlider.value);
      selected.temperatureCelsius = Number.isFinite(parsedTemperature) ? parsedTemperature : 25;
    }
  }

  if (selected.type === "opamp") {
    const opampVosSlider = document.querySelector("#prop-opamp-vos") as HTMLInputElement | null;
    const opampGainSelect = document.querySelector("#prop-opamp-gain") as HTMLSelectElement | null;
    if (opampVosSlider) {
      const parsedOffsetMillivolts = parseFloat(opampVosSlider.value);
      selected.offsetVoltage = (
        Number.isFinite(parsedOffsetMillivolts) ? parsedOffsetMillivolts : 2.0
      ) / 1000.0;
    }
    if (opampGainSelect) {
      selected.openLoopGain = parseFloat(opampGainSelect.value) || 100000.0;
    }
  }

  if (selected.type === "switch") {
    const state = document.querySelector("#prop-switch-state") as HTMLInputElement | null;
    const ron = document.querySelector("#prop-switch-ron") as HTMLInputElement | null;
    const roff = document.querySelector("#prop-switch-roff") as HTMLInputElement | null;
    const vth = document.querySelector("#prop-switch-vth") as HTMLInputElement | null;
    const vh = document.querySelector("#prop-switch-vh") as HTMLInputElement | null;
    clampSwitchProperties(selected, {
      stateChecked: state?.checked,
      ron: ron?.value,
      roff: roff?.value,
      vth: vth?.value,
      vh: vh?.value,
    });
  }

  if (selected.type === "transformer") {
    const l1 = document.querySelector("#prop-transformer-l1") as HTMLInputElement | null;
    const l2 = document.querySelector("#prop-transformer-l2") as HTMLInputElement | null;
    const k = document.querySelector("#prop-transformer-k") as HTMLInputElement | null;
    clampTransformerProperties(selected, {
      l1: l1?.value,
      l2: l2?.value,
      k: k?.value,
    });
  }

  if (selected.type === "dmm") {
    const dmmModeSelect = document.querySelector("#prop-dmm-mode") as HTMLSelectElement | null;
    selected.value = normalizeDmmMode(dmmModeSelect?.value);
    selected.dmmValue = DMM_INITIAL_DISPLAY;
  }
}
