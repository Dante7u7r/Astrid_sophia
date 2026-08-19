import { type ComponentInstance, type CanvasOrchestrator, type WireInstance } from "../canvas_orchestrator";
import { type McuDebugPanel } from "./mcu_debug_panel";
import { type SimulationRunner } from "../simulation/simulation_runner";
import { parseSpiceValue, formatSpiceValue } from "../simulation/spice_value_parser";
import {
  DMM_INITIAL_DISPLAY,
  normalizeDmmMode,
} from "../simulation/dmm";
import {
  ACTUATOR_MODEL_EDITORS,
  DEDICATED_VALUE_EDITORS,
  buildLiveMutations,
  clampSwitchProperties,
  clampTransformerProperties,
  getUnitDisplayConfig,
  getValueEditorPresentation,
  supportsLiveMutation,
} from "./property_model";
import {
  COMMERCIAL_BJTS,
  COMMERCIAL_DIODES,
  COMMERCIAL_MOSFETS,
  COMMERCIAL_JFETS,
  COMMERCIAL_OPAMPS,
} from "../simulation/commercial_models_catalog";
import {
  COMPONENT_PRESETS,
  snapToStandardValue,
} from "./engineering_standards";

export class PropertyEditor {
  private propIdInput: HTMLInputElement | null = null;
  private propValInput: HTMLInputElement | null = null;
  private propValSlider: HTMLInputElement | null = null;
  private propUnitInput: HTMLInputElement | null = null;
  private propValInc: HTMLButtonElement | null = null;
  private propValDec: HTMLButtonElement | null = null;
  private btnApplyProperties: HTMLButtonElement | null = null;

  constructor(
    private callbacks: {
      getOrchestrator: () => CanvasOrchestrator | null;
      getMcuDebugPanel: () => McuDebugPanel | null;
      getSimulationRunner: () => SimulationRunner | null;
      addLog: (text: string, type?: 'system' | 'send' | 'receive' | 'error') => void;
      updateCanvasRendering: () => void;
      markCurrentTabAsModified: () => void;
      extractNetlist?: () => void;
      invokeTauri: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    }
  ) {}

  private setFormControlsDisabled(disabled: boolean): void {
    const form = document.querySelector<HTMLElement>("#properties-form");
    if (!form) return;
    form.setAttribute("aria-disabled", String(disabled));
    for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
      "input, select, textarea, button",
    )) {
      control.disabled = disabled;
    }
  }

  public clearPropertiesPanel(): void {
    this.setFormControlsDisabled(true);
    if (this.propIdInput) {
      this.propIdInput.value = "";
      this.propIdInput.placeholder = "Selecciona un componente";
    }
    if (this.propValInput) this.propValInput.value = "";
    if (this.propUnitInput) this.propUnitInput.value = "";

    for (const id of [
      "wire-properties-container",
      "text-note-properties-container",
      "wave-properties-container",
      "resistor-properties-container",
      "capacitor-properties-container",
      "inductor-properties-container",
      "led-properties-container",
      "macro-spice-container",
      "potentiometer-container",
      "ldr-container",
      "thermistor-container",
      "dmm-properties-container",
      "switch-properties-container",
      "transformer-properties-container",
      "opamp-properties-container",
      "semiconductor-properties-container",
      "logic-properties-container",
    ]) {
      const container = document.getElementById(id);
      if (container) container.style.display = "none";
    }
    this.callbacks.getMcuDebugPanel()?.hide();
  }

  public populateNetLabelSuggestions(): void {
    const datalist = document.querySelector("#existing-net-labels");
    if (!datalist) return;
    const orchestrator = this.callbacks.getOrchestrator();
    if (!orchestrator) return;

    const netNames = new Set<string>();
    for (const wire of orchestrator.wires) {
      if (wire.label && wire.label.trim()) netNames.add(wire.label.trim().toUpperCase());
    }
    for (const comp of orchestrator.components) {
      if (comp.type === "net_label") {
        const n = String(comp.label || comp.value || comp.id).trim().toUpperCase();
        if (n) netNames.add(n);
      }
    }

    datalist.innerHTML = Array.from(netNames)
      .sort()
      .map(n => `<option value="${n}">${n}</option>`)
      .join("");
  }

  public updateWirePropertiesPanel(wire: WireInstance): void {
    if (!this.propIdInput) return;
    this.setFormControlsDisabled(false);
    this.populateNetLabelSuggestions();

    this.propIdInput.value = wire.id;
    this.propIdInput.placeholder = "Cable ID";
    if (this.propValInput) this.propValInput.value = "";
    if (this.propUnitInput) this.propUnitInput.value = "Conductor EDA";

    const valGroup = document.querySelector("#group-comp-val") as HTMLElement;
    const unitGroup = document.querySelector("#group-comp-unit") as HTMLElement;
    if (valGroup) valGroup.style.display = "none";
    if (unitGroup) unitGroup.style.display = "none";

    for (const id of [
      "text-note-properties-container",
      "wave-properties-container",
      "resistor-properties-container",
      "capacitor-properties-container",
      "inductor-properties-container",
      "led-properties-container",
      "macro-spice-container",
      "potentiometer-container",
      "ldr-container",
      "thermistor-container",
      "dmm-properties-container",
      "switch-properties-container",
      "transformer-properties-container",
      "opamp-properties-container",
      "semiconductor-properties-container",
      "logic-properties-container",
    ]) {
      const container = document.getElementById(id);
      if (container) container.style.display = "none";
    }
    this.callbacks.getMcuDebugPanel()?.hide();

    const wireContainer = document.querySelector("#wire-properties-container") as HTMLElement;
    const wireLabelInput = document.querySelector("#prop-wire-label") as HTMLInputElement;
    const wireColorInput = document.querySelector("#prop-wire-color") as HTMLInputElement;

    if (wireContainer && wireLabelInput && wireColorInput) {
      wireContainer.style.display = "flex";
      wireLabelInput.value = wire.label || "";
      wireColorInput.value = wire.color || "#66fcf1";
    }
  }

  public toggleWaveFieldsVisibility(waveType: string) {
    const gAmp = document.querySelector("#group-wave-amp") as HTMLElement;
    const gFreq = document.querySelector("#group-wave-freq") as HTMLElement;
    const gModFreq = document.querySelector("#group-wave-mod-freq") as HTMLElement;
    const gModIdx = document.querySelector("#group-wave-mod-index") as HTMLElement;
    const gPhase = document.querySelector("#group-wave-phase") as HTMLElement;
    const gOffset = document.querySelector("#group-wave-offset") as HTMLElement;
    const gDuty = document.querySelector("#group-wave-duty") as HTMLElement;
    const gRs = document.querySelector("#group-wave-rs") as HTMLElement;
    const lFreq = document.querySelector("#label-wave-freq") as HTMLElement;
    const gNomVal = document.querySelector("#group-comp-val") as HTMLElement;
    const gNomUnit = document.querySelector("#group-comp-unit") as HTMLElement;

    if (!gAmp || !gFreq) return;

    if (gRs) gRs.style.display = "flex";

    if (waveType === "dc") {
      gAmp.style.display = "none";
      gFreq.style.display = "none";
      if (gModFreq) gModFreq.style.display = "none";
      if (gModIdx) gModIdx.style.display = "none";
      if (gPhase) gPhase.style.display = "none";
      if (gOffset) gOffset.style.display = "none";
      if (gDuty) gDuty.style.display = "none";
      if (gNomVal) gNomVal.style.display = "flex";
      if (gNomUnit) gNomUnit.style.display = "flex";
    } else if (waveType === "am") {
      gAmp.style.display = "flex";
      gFreq.style.display = "flex";
      if (lFreq) lFreq.textContent = "Frecuencia Portadora fc (Hz)";
      if (gModFreq) gModFreq.style.display = "flex";
      if (gModIdx) gModIdx.style.display = "flex";
      if (gPhase) gPhase.style.display = "flex";
      if (gOffset) gOffset.style.display = "flex";
      if (gDuty) gDuty.style.display = "none";
    } else if (waveType === "sine" || waveType === "triangle") {
      gAmp.style.display = "flex";
      gFreq.style.display = "flex";
      if (lFreq) lFreq.textContent = "Frecuencia (Hz)";
      if (gModFreq) gModFreq.style.display = "none";
      if (gModIdx) gModIdx.style.display = "none";
      if (gPhase) gPhase.style.display = "flex";
      if (gOffset) gOffset.style.display = "flex";
      if (gDuty) gDuty.style.display = "none";
    } else if (waveType === "square" || waveType === "pulse") {
      gAmp.style.display = "flex";
      gFreq.style.display = "flex";
      if (lFreq) lFreq.textContent = "Frecuencia (Hz)";
      if (gModFreq) gModFreq.style.display = "none";
      if (gModIdx) gModIdx.style.display = "none";
      if (gPhase) gPhase.style.display = "none";
      if (gOffset) gOffset.style.display = "flex";
      if (gDuty) gDuty.style.display = "flex";
    } else if (waveType === "sawtooth") {
      gAmp.style.display = "flex";
      gFreq.style.display = "flex";
      if (lFreq) lFreq.textContent = "Frecuencia (Hz)";
      if (gModFreq) gModFreq.style.display = "none";
      if (gModIdx) gModIdx.style.display = "none";
      if (gPhase) gPhase.style.display = "none";
      if (gOffset) gOffset.style.display = "flex";
      if (gDuty) gDuty.style.display = "none";
    }
  }

  public updatePropertiesPanel(comp: ComponentInstance) {
    if (!this.propIdInput || !this.propValInput || !this.propValSlider || !this.propUnitInput) return;

    this.setFormControlsDisabled(false);
    this.propIdInput.placeholder = "Ej. R1";

    this.propIdInput.value = comp.id;
    const usesActuatorModel = ACTUATOR_MODEL_EDITORS.has(comp.type);
    this.propValInput.value = usesActuatorModel
      ? comp.value.toString()
      : formatSpiceValue(Number(comp.value) || 0);
    this.propValSlider.value = usesActuatorModel ? "0" : comp.value.toString();

    const mcuDebugPanel = this.callbacks.getMcuDebugPanel();
    if (comp.type === 'mcu_8051' || comp.type === 'mcu_avr') {
      mcuDebugPanel?.show(comp);
    } else {
      mcuDebugPanel?.hide();
    }

    const valGroup = document.querySelector("#group-comp-val") as HTMLElement;
    const unitGroup = document.querySelector("#group-comp-unit") as HTMLElement;
    const valLabel = document.querySelector("#group-comp-val .property-label") as HTMLElement;
    const valuePresentation = getValueEditorPresentation(comp.type);

    if (valGroup && unitGroup) {
      valGroup.style.display = valuePresentation.showValueGroup ? "flex" : "none";
      unitGroup.style.display = valuePresentation.showUnitGroup ? "flex" : "none";
      if (valLabel) valLabel.textContent = valuePresentation.valueLabel;
    }
    this.propValSlider.style.display = valuePresentation.showSliderControls ? "" : "none";
    if (this.propValInc) this.propValInc.style.display = valuePresentation.showSliderControls ? "" : "none";
    if (this.propValDec) this.propValDec.style.display = valuePresentation.showSliderControls ? "" : "none";

    // Selector de Presets / Plantillas Rápidas
    const presetGroup = document.querySelector("#group-comp-preset") as HTMLElement;
    const presetSelect = document.querySelector("#prop-preset-select") as HTMLSelectElement;
    if (presetGroup && presetSelect) {
      const presets = COMPONENT_PRESETS[comp.type];
      if (presets && presets.length > 0) {
        presetGroup.style.display = "flex";
        presetSelect.innerHTML = `<option value="">-- Cargar Plantilla / Preset Comercial --</option>` +
          presets.map(p => `<option value="${p.id}">${p.label}</option>`).join("");
      } else {
        presetGroup.style.display = "none";
      }
    }

    // 1. Fuentes (V, I)
    const waveContainer = document.querySelector("#wave-properties-container") as HTMLElement;
    const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
    const waveAmpInput = document.querySelector("#prop-wave-amp") as HTMLInputElement;
    const waveFreqInput = document.querySelector("#prop-wave-freq") as HTMLInputElement;
    const waveModFreqInput = document.querySelector("#prop-wave-mod-freq") as HTMLInputElement;
    const waveModIndexInput = document.querySelector("#prop-wave-mod-index") as HTMLInputElement;
    const wavePhaseInput = document.querySelector("#prop-wave-phase") as HTMLInputElement;
    const waveOffsetInput = document.querySelector("#prop-wave-offset") as HTMLInputElement;
    const waveDutyInput = document.querySelector("#prop-wave-duty") as HTMLInputElement;
    const waveRsInput = document.querySelector("#prop-wave-rs") as HTMLInputElement;
    const waveAcMagInput = document.querySelector("#prop-wave-ac-mag") as HTMLInputElement;
    const waveAcPhaseInput = document.querySelector("#prop-wave-ac-phase") as HTMLInputElement;

    if (waveContainer) {
      if (comp.type === 'vsource' || comp.type === 'isource') {
        waveContainer.style.display = "flex";
        if (waveTypeSelect) waveTypeSelect.value = comp.waveType || "dc";
        if (waveAmpInput) waveAmpInput.value = (comp.amplitude ?? 5).toString();
        if (waveFreqInput) waveFreqInput.value = (comp.frequency ?? 1000).toString();
        if (waveModFreqInput) waveModFreqInput.value = (comp.modFrequency ?? 100).toString();
        if (waveModIndexInput) waveModIndexInput.value = (comp.modIndex ?? 0.8).toString();
        if (wavePhaseInput) wavePhaseInput.value = (comp.phase ?? 0).toString();
        if (waveOffsetInput) waveOffsetInput.value = (comp.offset ?? 0).toString();
        if (waveDutyInput) waveDutyInput.value = (comp.dutyCycle ?? 0.5).toString();
        if (waveRsInput) waveRsInput.value = (comp.sourceResistance ?? 0).toString();
        if (waveAcMagInput) waveAcMagInput.value = (comp.acMag ?? 1.0).toString();
        if (waveAcPhaseInput) waveAcPhaseInput.value = (comp.acPhase ?? 0).toString();
        
        this.toggleWaveFieldsVisibility(waveTypeSelect ? waveTypeSelect.value : (comp.waveType || "dc"));
      } else {
        waveContainer.style.display = "none";
      }
    }

    // 2. Resistor
    const resistorContainer = document.querySelector("#resistor-properties-container") as HTMLElement;
    const resistorTolSelect = document.querySelector("#prop-resistor-tolerance") as HTMLSelectElement;
    const resistorPowerSelect = document.querySelector("#prop-resistor-power") as HTMLSelectElement;
    if (resistorContainer) {
      if (comp.type === "resistor") {
        resistorContainer.style.display = "flex";
        if (resistorTolSelect) resistorTolSelect.value = (comp.tolerance ?? 1).toString();
        if (resistorPowerSelect) resistorPowerSelect.value = (comp.powerRating ?? 0.25).toString();
      } else {
        resistorContainer.style.display = "none";
      }
    }

    // 3. Capacitor
    const capacitorContainer = document.querySelector("#capacitor-properties-container") as HTMLElement;
    const capVoltSelect = document.querySelector("#prop-capacitor-voltage") as HTMLSelectElement;
    const capEsrInput = document.querySelector("#prop-capacitor-esr") as HTMLInputElement;
    const capDielectricSelect = document.querySelector("#prop-capacitor-dielectric") as HTMLSelectElement;
    if (capacitorContainer) {
      if (comp.type === "capacitor") {
        capacitorContainer.style.display = "flex";
        if (capVoltSelect) capVoltSelect.value = (comp.voltageRating ?? 25).toString();
        if (capEsrInput) capEsrInput.value = (comp.esr ?? 0).toString();
        if (capDielectricSelect) capDielectricSelect.value = comp.dielectricType || "ceramic";
      } else {
        capacitorContainer.style.display = "none";
      }
    }

    // 4. Inductor
    const inductorContainer = document.querySelector("#inductor-properties-container") as HTMLElement;
    const indDcrInput = document.querySelector("#prop-inductor-dcr") as HTMLInputElement;
    const indIsatInput = document.querySelector("#prop-inductor-isat") as HTMLInputElement;
    if (inductorContainer) {
      if (comp.type === "inductor") {
        inductorContainer.style.display = "flex";
        if (indDcrInput) indDcrInput.value = (comp.dcResistance ?? 0).toString();
        if (indIsatInput) indIsatInput.value = (comp.isat ?? comp.currentRating ?? 1.0).toString();
      } else {
        inductorContainer.style.display = "none";
      }
    }

    // 5. LED
    const ledContainer = document.querySelector("#led-properties-container") as HTMLElement;
    const ledColorSelect = document.querySelector("#prop-led-color") as HTMLSelectElement;
    const ledImaxInput = document.querySelector("#prop-led-imax") as HTMLInputElement;
    if (ledContainer) {
      if (comp.type === "led") {
        ledContainer.style.display = "flex";
        if (ledColorSelect) ledColorSelect.value = comp.ledColor || "red";
        if (ledImaxInput) ledImaxInput.value = (comp.maxCurrent ?? 20).toString();
      } else {
        ledContainer.style.display = "none";
      }
    }

    const macroContainer = document.querySelector("#macro-spice-container") as HTMLElement;
    const macroTextarea = document.querySelector("#prop-spice-macro") as HTMLTextAreaElement;
    const pinCountInput = document.querySelector("#prop-pin-count") as HTMLInputElement;
    if (macroContainer && macroTextarea) {
      if (comp.type === 'x') {
        macroContainer.style.display = "flex";
        macroTextarea.value = comp.spiceMacro || "";
        if (pinCountInput) pinCountInput.value = (comp.pinCount ?? 4).toString();
      } else {
        macroContainer.style.display = "none";
      }
    }

    const potentiometerContainer = document.querySelector("#potentiometer-container") as HTMLElement;
    const wiperSlider = document.querySelector("#prop-wiper-slider") as HTMLInputElement;
    const wiperDisplay = document.querySelector("#prop-wiper-display") as HTMLElement;
    if (potentiometerContainer && wiperSlider && wiperDisplay) {
      if (comp.type === 'potentiometer') {
        potentiometerContainer.style.display = "flex";
        const wPos = comp.wiperPosition ?? 0.5;
        wiperSlider.value = wPos.toString();
        wiperDisplay.textContent = `${Math.round(wPos * 100)}%`;
      } else {
        potentiometerContainer.style.display = "none";
      }
    }

    const ldrContainer = document.querySelector("#ldr-container") as HTMLElement;
    const luxSlider = document.querySelector("#prop-lux-slider") as HTMLInputElement;
    const luxDisplay = document.querySelector("#prop-lux-display") as HTMLElement;
    if (ldrContainer && luxSlider && luxDisplay) {
      if (comp.type === 'ldr') {
        ldrContainer.style.display = "flex";
        const luxVal = comp.lux ?? 100;
        luxSlider.value = luxVal.toString();
        luxDisplay.textContent = `${luxVal} Lx`;
      } else {
        ldrContainer.style.display = "none";
      }
    }

    const thermistorContainer = document.querySelector("#thermistor-container") as HTMLElement;
    const tempSlider = document.querySelector("#prop-temp-slider") as HTMLInputElement;
    const tempDisplay = document.querySelector("#prop-temp-display") as HTMLElement;
    if (thermistorContainer && tempSlider && tempDisplay) {
      if (comp.type === 'thermistor') {
        thermistorContainer.style.display = "flex";
        const tempVal = comp.temperatureCelsius ?? 25;
        tempSlider.value = tempVal.toString();
        tempDisplay.textContent = `${tempVal} ºC`;
      } else {
        thermistorContainer.style.display = "none";
      }
    }

    const dmmContainer = document.querySelector("#dmm-properties-container") as HTMLElement;
    const dmmModeSelect = document.querySelector("#prop-dmm-mode") as HTMLSelectElement;
    if (dmmContainer && dmmModeSelect) {
      if (comp.type === 'dmm') {
        dmmContainer.style.display = "flex";
        dmmModeSelect.value = normalizeDmmMode(comp.value);
      } else {
        dmmContainer.style.display = "none";
      }
    }

    const switchContainer = document.querySelector("#switch-properties-container") as HTMLElement;
    const switchState = document.querySelector("#prop-switch-state") as HTMLInputElement;
    const switchRon = document.querySelector("#prop-switch-ron") as HTMLInputElement;
    const switchRoff = document.querySelector("#prop-switch-roff") as HTMLInputElement;
    const switchVth = document.querySelector("#prop-switch-vth") as HTMLInputElement;
    const switchVh = document.querySelector("#prop-switch-vh") as HTMLInputElement;
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

    const transformerContainer = document.querySelector("#transformer-properties-container") as HTMLElement;
    const transformerL1 = document.querySelector("#prop-transformer-l1") as HTMLInputElement;
    const transformerL2 = document.querySelector("#prop-transformer-l2") as HTMLInputElement;
    const transformerK = document.querySelector("#prop-transformer-k") as HTMLInputElement;
    if (transformerContainer && transformerL1 && transformerL2 && transformerK) {
      transformerContainer.style.display = comp.type === "transformer" ? "flex" : "none";
      if (comp.type === "transformer") {
        transformerL1.value = (comp.primaryInductance ?? 1e-3).toString();
        transformerL2.value = (comp.secondaryInductance ?? 1e-3).toString();
        transformerK.value = (comp.couplingCoefficient ?? 0.9).toString();
      }
    }

    const opampContainer = document.querySelector("#opamp-properties-container") as HTMLElement;
    const opampVosSlider = document.querySelector("#prop-opamp-vos") as HTMLInputElement;
    const opampVosDisplay = document.querySelector("#prop-opamp-vos-display") as HTMLElement;
    const opampGainSelect = document.querySelector("#prop-opamp-gain") as HTMLSelectElement;

    if (opampContainer && opampVosSlider && opampVosDisplay && opampGainSelect) {
      if (comp.type === 'opamp') {
        opampContainer.style.display = "flex";
        const vosMilli = (comp.offsetVoltage !== undefined ? comp.offsetVoltage : 0.002) * 1000;
        opampVosSlider.value = vosMilli.toString();
        opampVosDisplay.textContent = `${vosMilli.toFixed(1)} mV`;
        opampGainSelect.value = (comp.openLoopGain !== undefined ? comp.openLoopGain : 100000).toString();
      } else {
        opampContainer.style.display = "none";
      }
    }

    const semiContainer = document.querySelector("#semiconductor-properties-container") as HTMLElement;
    const semiModelSelect = document.querySelector("#prop-semi-model") as HTMLSelectElement;
    const semiDesc = document.querySelector("#prop-semi-desc") as HTMLElement;
    if (semiContainer && semiModelSelect && semiDesc) {
      const isSemiconductor = ["diode", "npn", "pnp", "nmos", "pmos", "njf", "pjf", "led", "opamp"].includes(comp.type);
      if (isSemiconductor) {
        semiContainer.style.display = "flex";
        semiModelSelect.innerHTML = `<option value="custom">-- Modelo Genérico / Personalizado --</option>`;
        
        let models: Record<string, { description: string }> = {};
        if (comp.type === "diode") models = COMMERCIAL_DIODES;
        else if (comp.type === "led") models = Object.fromEntries(Object.entries(COMMERCIAL_DIODES).filter(([k]) => k.startsWith("LED_")));
        else if (comp.type === "npn") models = Object.fromEntries(Object.entries(COMMERCIAL_BJTS).filter(([, m]) => m.polarity === "npn"));
        else if (comp.type === "pnp") models = Object.fromEntries(Object.entries(COMMERCIAL_BJTS).filter(([, m]) => m.polarity === "pnp"));
        else if (comp.type === "nmos") models = Object.fromEntries(Object.entries(COMMERCIAL_MOSFETS).filter(([, m]) => m.polarity === "nmos"));
        else if (comp.type === "pmos") models = Object.fromEntries(Object.entries(COMMERCIAL_MOSFETS).filter(([, m]) => m.polarity === "pmos"));
        else if (comp.type === "njf") models = Object.fromEntries(Object.entries(COMMERCIAL_JFETS).filter(([, m]) => m.polarity === "njf"));
        else if (comp.type === "pjf") models = Object.fromEntries(Object.entries(COMMERCIAL_JFETS).filter(([, m]) => m.polarity === "pjf"));
        else if (comp.type === "opamp") models = COMMERCIAL_OPAMPS;

        for (const [modelKey, modelData] of Object.entries(models)) {
          const opt = document.createElement("option");
          opt.value = modelKey;
          opt.textContent = `${modelKey} - ${modelData.description}`;
          semiModelSelect.appendChild(opt);
        }

        const currentModel = comp.modelName || "custom";
        semiModelSelect.value = currentModel;
        if (currentModel !== "custom" && models[currentModel]) {
          semiDesc.textContent = models[currentModel].description;
          semiDesc.style.display = "block";
        } else {
          semiDesc.style.display = "none";
        }

        const diodeBvGroup = document.querySelector("#group-diode-bv") as HTMLElement;
        const diodeBvInput = document.querySelector("#prop-diode-bv") as HTMLInputElement;
        if (diodeBvGroup && diodeBvInput) {
          diodeBvGroup.style.display = comp.type === "diode" ? "flex" : "none";
          if (comp.type === "diode") {
            diodeBvInput.value = (comp.diodeBv ?? 0).toString();
          }
        }
      } else {
        semiContainer.style.display = "none";
      }
    }

    const logicContainer = document.querySelector("#logic-properties-container") as HTMLElement;
    const logicVohSelect = document.querySelector("#prop-logic-voh") as HTMLSelectElement;
    const logicVthInput = document.querySelector("#prop-logic-vth") as HTMLInputElement;
    if (logicContainer && logicVohSelect && logicVthInput) {
      const isLogicGate = ["and_gate", "or_gate", "not_gate", "nand_gate", "nor_gate", "xor_gate"].includes(comp.type);
      if (isLogicGate) {
        logicContainer.style.display = "flex";
        logicVohSelect.value = (comp.value || 5.0).toString();
        logicVthInput.value = (comp.offset !== undefined ? comp.offset : 2.5).toString();
      } else {
        logicContainer.style.display = "none";
      }
    }

    const textNoteContainer = document.querySelector("#text-note-properties-container") as HTMLElement;
    const noteTextInput = document.querySelector("#prop-note-text") as HTMLTextAreaElement;
    const noteFontInput = document.querySelector("#prop-note-fontsize") as HTMLInputElement;
    const noteThemeSelect = document.querySelector("#prop-note-theme") as HTMLSelectElement;
    if (textNoteContainer && noteTextInput && noteFontInput && noteThemeSelect) {
      if (comp.type === 'text_note') {
        textNoteContainer.style.display = "flex";
        noteTextInput.value = String(comp.label || comp.value || "");
        noteFontInput.value = (comp.fontSize || 12).toString();
        noteThemeSelect.value = comp.noteTheme || "card";
      } else {
        textNoteContainer.style.display = "none";
      }
    }

    if (comp.type === "net_label") {
      this.propValInput.setAttribute("list", "existing-net-labels");
    } else {
      this.propValInput.removeAttribute("list");
    }

    this.populateNetLabelSuggestions();

    const unitConfig = getUnitDisplayConfig(comp.type);
    this.propUnitInput.value = unitConfig.label;
    this.propValSlider.min = unitConfig.min;
    this.propValSlider.max = unitConfig.max;
  }
  public init() {
    this.propValInput = document.querySelector("#prop-val-input");
    this.propValSlider = document.querySelector("#prop-val-slider");
    this.propValInc = document.querySelector("#prop-val-inc");
    this.propValDec = document.querySelector("#prop-val-dec");
    this.btnApplyProperties = document.querySelector("#btn-apply-properties");
    this.propIdInput = document.querySelector("#prop-id-input");
    this.propUnitInput = document.querySelector("#prop-unit-input");

    const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
    if (waveTypeSelect) {
      waveTypeSelect.addEventListener("change", () => {
        this.toggleWaveFieldsVisibility(waveTypeSelect.value);
      });
    }

    const wireLabelInput = document.querySelector("#prop-wire-label") as HTMLInputElement;
    const wireColorInput = document.querySelector("#prop-wire-color") as HTMLInputElement;
    const btnResetWireColor = document.querySelector("#btn-reset-wire-color") as HTMLButtonElement;

    if (wireLabelInput) {
      wireLabelInput.addEventListener("input", () => {
        const orchestrator = this.callbacks.getOrchestrator();
        if (orchestrator?.selectedWire) {
          orchestrator.selectedWire.label = wireLabelInput.value.trim() || undefined;
          this.callbacks.updateCanvasRendering();
          this.callbacks.markCurrentTabAsModified();
        }
      });
    }

    if (wireColorInput) {
      wireColorInput.addEventListener("input", () => {
        const orchestrator = this.callbacks.getOrchestrator();
        if (orchestrator?.selectedWire) {
          orchestrator.selectedWire.color = wireColorInput.value;
          this.callbacks.updateCanvasRendering();
          this.callbacks.markCurrentTabAsModified();
        }
      });
    }

    if (btnResetWireColor) {
      btnResetWireColor.addEventListener("click", () => {
        const orchestrator = this.callbacks.getOrchestrator();
        if (orchestrator?.selectedWire) {
          orchestrator.selectedWire.color = undefined;
          if (wireColorInput) wireColorInput.value = "#66fcf1";
          this.callbacks.updateCanvasRendering();
          this.callbacks.markCurrentTabAsModified();
        }
      });
    }
    const wiperSlider = document.querySelector("#prop-wiper-slider") as HTMLInputElement;
    const wiperDisplay = document.querySelector("#prop-wiper-display") as HTMLElement;
    if (wiperSlider && wiperDisplay) {
      wiperSlider.addEventListener("input", (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value) || 0.5;
        wiperDisplay.textContent = `${Math.round(val * 100)}%`;
      });
    }

    const luxSlider = document.querySelector("#prop-lux-slider") as HTMLInputElement;
    const luxDisplay = document.querySelector("#prop-lux-display") as HTMLElement;
    if (luxSlider && luxDisplay) {
      luxSlider.addEventListener("input", (e) => {
        const val = parseInt((e.target as HTMLInputElement).value) || 100;
        luxDisplay.textContent = `${val} Lx`;
      });
    }

    const tempSlider = document.querySelector("#prop-temp-slider") as HTMLInputElement;
    const tempDisplay = document.querySelector("#prop-temp-display") as HTMLElement;
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
        const orchestrator = this.callbacks.getOrchestrator();
        const selected = orchestrator ? orchestrator.selectedComponent : null;
        if (selected && selected.type === 'dmm') {
          selected.value = normalizeDmmMode(dmmModeSelect.value);
          selected.dmmValue = DMM_INITIAL_DISPLAY;
          this.callbacks.updateCanvasRendering();
          this.callbacks.markCurrentTabAsModified();
        }
      });
    }

    const opampVosSlider = document.querySelector("#prop-opamp-vos") as HTMLInputElement;
    const opampVosDisplay = document.querySelector("#prop-opamp-vos-display") as HTMLElement;
    const opampGainSelect = document.querySelector("#prop-opamp-gain") as HTMLSelectElement;

    if (opampVosSlider && opampVosDisplay) {
      opampVosSlider.addEventListener("input", (e) => {
        const parsed = parseFloat((e.target as HTMLInputElement).value);
        const val = Number.isFinite(parsed) ? parsed : 2.0;
        opampVosDisplay.textContent = `${val.toFixed(1)} mV`;
        const orchestrator = this.callbacks.getOrchestrator();
        const selected = orchestrator ? orchestrator.selectedComponent : null;
        if (selected && selected.type === 'opamp') {
          selected.offsetVoltage = val / 1000.0;
          this.callbacks.updateCanvasRendering();
          this.callbacks.markCurrentTabAsModified();
        }
      });
    }

    if (opampGainSelect) {
      opampGainSelect.addEventListener("change", () => {
        const val = parseFloat(opampGainSelect.value) || 100000.0;
        const orchestrator = this.callbacks.getOrchestrator();
        const selected = orchestrator ? orchestrator.selectedComponent : null;
        if (selected && selected.type === 'opamp') {
          selected.openLoopGain = val;
          this.callbacks.updateCanvasRendering();
          this.callbacks.markCurrentTabAsModified();
        }
      });
    }

    if (this.propValInput && this.propValSlider) {
      this.propValSlider.addEventListener("input", (e) => {
        const val = (e.target as HTMLInputElement).value;
        if (this.propValInput) this.propValInput.value = val;
      });

      this.propValInput.addEventListener("input", (e) => {
        const val = (e.target as HTMLInputElement).value;
        if (this.propValSlider) this.propValSlider.value = val;
      });
    }



    const btnSnapStandard = document.querySelector("#btn-snap-standard") as HTMLButtonElement;
    if (btnSnapStandard && this.propValInput) {
      btnSnapStandard.addEventListener("click", () => {
        const orchestrator = this.callbacks.getOrchestrator();
        if (!orchestrator?.selectedComponent) return;
        const currentVal = parseFloat(this.propValInput!.value) || 0;
        if (currentVal > 0) {
          const snapped = snapToStandardValue(currentVal, "E24");
          this.propValInput!.value = formatSpiceValue(snapped);
          if (this.propValSlider) this.propValSlider.value = snapped.toString();
          this.btnApplyProperties?.click();
        }
      });
    }

    const presetSelect = document.querySelector("#prop-preset-select") as HTMLSelectElement;
    if (presetSelect) {
      presetSelect.addEventListener("change", () => {
        const orchestrator = this.callbacks.getOrchestrator();
        const selected = orchestrator ? orchestrator.selectedComponent : null;
        if (!selected || !presetSelect.value) return;
        const presets = COMPONENT_PRESETS[selected.type] || [];
        const found = presets.find(p => p.id === presetSelect.value);
        if (found) {
          Object.assign(selected, found.values);
          this.updatePropertiesPanel(selected);
          this.callbacks.updateCanvasRendering();
          this.callbacks.markCurrentTabAsModified();
          this.callbacks.extractNetlist?.();
        }
      });
    }

    if (this.propValInc && this.propValInput && this.propValSlider) {
      this.propValInc.addEventListener("click", () => {
        const activeOrchestrator = this.callbacks.getOrchestrator();
        if (!activeOrchestrator?.selectedComponent) return;
        let val = parseFloat(this.propValInput!.value) || 0;
        const step = activeOrchestrator.selectedComponent.type === 'capacitor' ? 1e-7 : 10;
        val += step;
        this.propValInput!.value = val.toString();
        this.propValSlider!.value = val.toString();
      });
    }

    if (this.propValDec && this.propValInput && this.propValSlider) {
      this.propValDec.addEventListener("click", () => {
        const activeOrchestrator = this.callbacks.getOrchestrator();
        if (!activeOrchestrator?.selectedComponent) return;
        let val = parseFloat(this.propValInput!.value) || 0;
        const step = activeOrchestrator.selectedComponent.type === 'capacitor' ? 1e-7 : 10;
        val = Math.max(val - step, 0);
        this.propValInput!.value = val.toString();
        this.propValSlider!.value = val.toString();
      });
    }

    const applyFromKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.btnApplyProperties?.click();
    };
    this.propIdInput?.addEventListener("keydown", applyFromKeyboard);
    this.propValInput?.addEventListener("keydown", applyFromKeyboard);

    if (this.btnApplyProperties && this.propIdInput && this.propValInput) {
      this.btnApplyProperties.addEventListener("click", () => {
        const activeOrchestrator = this.callbacks.getOrchestrator();
        if (!activeOrchestrator) return;
        const selected = activeOrchestrator.selectedComponent;
        if (selected) {
          const oldId = selected.id;
          const newId = this.propIdInput!.value.trim();
          const parsed = parseSpiceValue(this.propValInput!.value);
          const newVal = parsed.valid && parsed.value !== undefined ? parsed.value : (parseFloat(this.propValInput!.value) || 0);

          if (newId.length > 0 && newId !== oldId) {
            const renameError = activeOrchestrator.renameComponent(selected, newId);
            if (renameError) {
              this.propIdInput!.value = oldId;
              this.callbacks.addLog(`Error: ${renameError}`, "error");
            }
          }

          if (selected.type === "dmm") {
            const dmmModeSelect = document.querySelector("#prop-dmm-mode") as HTMLSelectElement;
            selected.value = normalizeDmmMode(dmmModeSelect?.value);
            selected.dmmValue = DMM_INITIAL_DISPLAY;
          } else if (ACTUATOR_MODEL_EDITORS.has(selected.type)) {
            selected.value = this.propValInput!.value.trim() || selected.value;
          } else if (!DEDICATED_VALUE_EDITORS.has(selected.type)) {
            selected.value = newVal;
            this.propValInput!.value = formatSpiceValue(newVal);
          }

          if (selected.type === 'vsource' || selected.type === 'isource') {
            const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
            const waveAmpInput = document.querySelector("#prop-wave-amp") as HTMLInputElement;
            const waveFreqInput = document.querySelector("#prop-wave-freq") as HTMLInputElement;
            const waveModFreqInput = document.querySelector("#prop-wave-mod-freq") as HTMLInputElement;
            const waveModIndexInput = document.querySelector("#prop-wave-mod-index") as HTMLInputElement;
            const wavePhaseInput = document.querySelector("#prop-wave-phase") as HTMLInputElement;
            const waveOffsetInput = document.querySelector("#prop-wave-offset") as HTMLInputElement;
            const waveDutyInput = document.querySelector("#prop-wave-duty") as HTMLInputElement;
            const waveRsInput = document.querySelector("#prop-wave-rs") as HTMLInputElement;
            const waveAcMagInput = document.querySelector("#prop-wave-ac-mag") as HTMLInputElement;
            const waveAcPhaseInput = document.querySelector("#prop-wave-ac-phase") as HTMLInputElement;

            if (waveTypeSelect) selected.waveType = waveTypeSelect.value;
            if (waveAmpInput) selected.amplitude = parseFloat(waveAmpInput.value) || 0;
            if (waveFreqInput) selected.frequency = parseFloat(waveFreqInput.value) || 1000;
            if (waveModFreqInput) selected.modFrequency = parseFloat(waveModFreqInput.value) || 100;
            if (waveModIndexInput) selected.modIndex = Math.max(0, Math.min(1, parseFloat(waveModIndexInput.value) || 0.8));
            if (wavePhaseInput) selected.phase = parseFloat(wavePhaseInput.value) || 0;
            if (waveOffsetInput) selected.offset = parseFloat(waveOffsetInput.value) || 0;
            if (waveDutyInput) selected.dutyCycle = parseFloat(waveDutyInput.value) || 0.5;
            if (waveRsInput) selected.sourceResistance = Math.max(0, parseFloat(waveRsInput.value) || 0);
            if (waveAcMagInput) selected.acMag = parseFloat(waveAcMagInput.value) || 0;
            if (waveAcPhaseInput) selected.acPhase = parseFloat(waveAcPhaseInput.value) || 0;

            // En CC el valor nominal es la excitación efectiva. Para formas
            // de onda conserva el valor nominal editado y usa los parámetros
            // explícitos de la forma de onda durante el análisis transitorio.
            if (selected.waveType === "dc") {
              selected.value = newVal;
              selected.offset = newVal;
            }
            this.propValInput!.value = formatSpiceValue(Number(selected.value) || 0);
            this.propValSlider!.value = selected.value.toString();
          }

          if (selected.type === "resistor") {
            const resistorTolSelect = document.querySelector("#prop-resistor-tolerance") as HTMLSelectElement;
            const resistorPowerSelect = document.querySelector("#prop-resistor-power") as HTMLSelectElement;
            if (resistorTolSelect) selected.tolerance = parseFloat(resistorTolSelect.value) || 1;
            if (resistorPowerSelect) selected.powerRating = parseFloat(resistorPowerSelect.value) || 0.25;
          }

          if (selected.type === "capacitor") {
            const capVoltSelect = document.querySelector("#prop-capacitor-voltage") as HTMLSelectElement;
            const capEsrInput = document.querySelector("#prop-capacitor-esr") as HTMLInputElement;
            const capDielectricSelect = document.querySelector("#prop-capacitor-dielectric") as HTMLSelectElement;
            if (capVoltSelect) selected.voltageRating = parseFloat(capVoltSelect.value) || 25;
            if (capEsrInput) selected.esr = Math.max(0, parseFloat(capEsrInput.value) || 0);
            if (capDielectricSelect) selected.dielectricType = capDielectricSelect.value as any;
          }

          if (selected.type === "inductor") {
            const indDcrInput = document.querySelector("#prop-inductor-dcr") as HTMLInputElement;
            const indIsatInput = document.querySelector("#prop-inductor-isat") as HTMLInputElement;
            if (indDcrInput) selected.dcResistance = Math.max(0, parseFloat(indDcrInput.value) || 0);
            if (indIsatInput) {
              const val = parseFloat(indIsatInput.value);
              selected.isat = val > 0 ? val : undefined;
              selected.currentRating = selected.isat ?? 1.0;
            }
          }

          if (selected.type === "led") {
            const ledColorSelect = document.querySelector("#prop-led-color") as HTMLSelectElement;
            const ledImaxInput = document.querySelector("#prop-led-imax") as HTMLInputElement;
            if (ledColorSelect) selected.ledColor = ledColorSelect.value as any;
            if (ledImaxInput) selected.maxCurrent = Math.max(1, parseFloat(ledImaxInput.value) || 20);
          }

          if (selected.type === 'potentiometer') {
            const wiperSlider = document.querySelector("#prop-wiper-slider") as HTMLInputElement;
            const potTaperSelect = document.querySelector("#prop-pot-taper") as HTMLSelectElement;
            if (wiperSlider) {
              selected.wiperPosition = parseFloat(wiperSlider.value) || 0.5;
            }
            if (potTaperSelect) {
              selected.potTaper = potTaperSelect.value as any;
            }
          }

          if (selected.type === 'ldr') {
            const luxSlider = document.querySelector("#prop-lux-slider") as HTMLInputElement;
            if (luxSlider) {
              selected.lux = parseInt(luxSlider.value) || 100;
            }
          }

          if (selected.type === 'thermistor') {
            const tempSlider = document.querySelector("#prop-temp-slider") as HTMLInputElement;
            if (tempSlider) {
              const parsedTemperature = parseInt(tempSlider.value);
              selected.temperatureCelsius = Number.isFinite(parsedTemperature)
                ? parsedTemperature
                : 25;
            }
          }

          if (selected.type === 'x') {
            const macroTextarea = document.querySelector("#prop-spice-macro") as HTMLTextAreaElement;
            if (macroTextarea) {
              selected.spiceMacro = macroTextarea.value.trim() || undefined;
            }
            const pinCountInput = document.querySelector("#prop-pin-count") as HTMLInputElement;
            if (pinCountInput) {
              const newPinCount = parseInt(pinCountInput.value) || 4;
              selected.pinCount = Math.max(2, Math.min(64, newPinCount));
            }
          }

          if (selected.type === 'opamp') {
            const opampVosSlider = document.querySelector("#prop-opamp-vos") as HTMLInputElement;
            const opampGainSelect = document.querySelector("#prop-opamp-gain") as HTMLSelectElement;
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

          if (["diode", "npn", "pnp", "nmos", "pmos", "njf", "pjf", "led", "opamp"].includes(selected.type)) {
            const semiModelSelect = document.querySelector("#prop-semi-model") as HTMLSelectElement;
            if (semiModelSelect && semiModelSelect.value !== "custom") {
              selected.modelName = semiModelSelect.value;
              const modelKey = semiModelSelect.value;
              if (selected.type === "diode" || selected.type === "led") {
                const dm = COMMERCIAL_DIODES[modelKey];
                if (dm) {
                  if (dm.bv !== undefined) selected.diodeBv = dm.bv;
                  if (dm.forwardVoltage !== undefined) selected.forwardVoltage = dm.forwardVoltage;
                }
              } else if (selected.type === "npn" || selected.type === "pnp") {
                const bm = COMMERCIAL_BJTS[modelKey];
                if (bm) {
                  selected.value = bm.bf;
                }
              } else if (selected.type === "nmos" || selected.type === "pmos") {
                const mm = COMMERCIAL_MOSFETS[modelKey];
                if (mm) {
                  selected.value = mm.vth;
                }
              } else if (selected.type === "njf" || selected.type === "pjf") {
                const jm = COMMERCIAL_JFETS[modelKey];
                if (jm) {
                  selected.value = jm.vto;
                }
              } else if (selected.type === "opamp") {
                const om = COMMERCIAL_OPAMPS[modelKey];
                if (om) {
                  selected.openLoopGain = om.aol;
                  selected.offsetVoltage = om.vos;
                }
              }
            } else if (semiModelSelect) {
              delete selected.modelName;
            }

            if (selected.type === "diode") {
              const diodeBvInput = document.querySelector("#prop-diode-bv") as HTMLInputElement;
              if (diodeBvInput) {
                const bvVal = parseFloat(diodeBvInput.value) || 0;
                selected.diodeBv = bvVal > 0 ? bvVal : undefined;
              }
            }
          }

          if (["and_gate", "or_gate", "not_gate", "nand_gate", "nor_gate", "xor_gate"].includes(selected.type)) {
            const logicVohSelect = document.querySelector("#prop-logic-voh") as HTMLSelectElement;
            const logicVthInput = document.querySelector("#prop-logic-vth") as HTMLInputElement;
            if (logicVohSelect) {
              selected.value = parseFloat(logicVohSelect.value) || 5.0;
            }
            if (logicVthInput) {
              selected.offset = parseFloat(logicVthInput.value) || 2.5;
            }
          }

          if (selected.type === "switch") {
            const state = document.querySelector("#prop-switch-state") as HTMLInputElement;
            const ron = document.querySelector("#prop-switch-ron") as HTMLInputElement;
            const roff = document.querySelector("#prop-switch-roff") as HTMLInputElement;
            const vth = document.querySelector("#prop-switch-vth") as HTMLInputElement;
            const vh = document.querySelector("#prop-switch-vh") as HTMLInputElement;
            clampSwitchProperties(selected, {
              stateChecked: state?.checked,
              ron: ron?.value,
              roff: roff?.value,
              vth: vth?.value,
              vh: vh?.value,
            });
          }

          if (selected.type === "transformer") {
            const l1 = document.querySelector("#prop-transformer-l1") as HTMLInputElement;
            const l2 = document.querySelector("#prop-transformer-l2") as HTMLInputElement;
            const k = document.querySelector("#prop-transformer-k") as HTMLInputElement;
            clampTransformerProperties(selected, {
              l1: l1?.value,
              l2: l2?.value,
              k: k?.value,
            });
          }

          if (selected.type === "text_note") {
            const noteTextInput = document.querySelector("#prop-note-text") as HTMLTextAreaElement;
            const noteFontInput = document.querySelector("#prop-note-fontsize") as HTMLInputElement;
            const noteThemeSelect = document.querySelector("#prop-note-theme") as HTMLSelectElement;
            if (noteTextInput) {
              selected.label = noteTextInput.value;
              selected.value = noteTextInput.value;
            }
            if (noteFontInput) {
              selected.fontSize = Number(noteFontInput.value) || 12;
            }
            if (noteThemeSelect) {
              selected.noteTheme = (noteThemeSelect.value as any) || "card";
            }
          }

          if (selected.type === "net_label") {
            const rawVal = String(newVal || selected.id).trim().toUpperCase();
            selected.value = rawVal || "NET";
            selected.label = selected.value as string;
          }

          const simulationRunner = this.callbacks.getSimulationRunner();
          if (simulationRunner && simulationRunner.isSimulationActive() && supportsLiveMutation(selected.type)) {
            const runner = simulationRunner;
            const mutations = buildLiveMutations(selected, newVal);
            for (const m of mutations) {
              void runner.mutateComponent(
                m.componentId,
                m.field as unknown as import("../simulation/simulation_runner").InteractiveMutationField,
                m.value,
              );
            }
            this.callbacks.addLog(
              `Mutación en caliente emitida para [${selected.id}]: ${mutations.length} campo(s)`,
              "send",
            );
          } else if (simulationRunner?.isSimulationActive() ?? false) {
            this.callbacks.addLog(
              `Los cambios de [${selected.id}] se aplicarán en la próxima simulación.`,
              "system",
            );
          }

          this.callbacks.updateCanvasRendering();
          this.callbacks.markCurrentTabAsModified();
          this.callbacks.extractNetlist?.();
          this.callbacks.addLog(
            `Propiedades aplicadas a [${selected.id}]: Valor = [${selected.value}]`,
            "system",
          );
        }
      });
    }

    this.clearPropertiesPanel();
  }
}
