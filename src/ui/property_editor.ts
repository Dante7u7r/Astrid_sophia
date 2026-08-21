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
  getUnitDisplayConfig,
  getValueEditorPresentation,
  supportsLiveMutation,
} from "./property_model";
import {
  COMPONENT_PRESETS,
  snapToStandardValue,
} from "./engineering_standards";
import {
  getTerminalType,
  parsePowerRailVoltage,
  type TerminalType,
} from "../canvas/component_annotation_renderer";
import {
  bindActuatorsSubformEvents,
  updateActuatorsSubform,
  applyActuatorsSubform,
} from "./property_subforms_actuators";
import {
  bindWaveSubformEvents,
  updateWaveSubform,
  applyWaveSubform,
  toggleWaveFieldsVisibility,
} from "./property_subforms_wave";
import {
  updateSemiconductorsSubform,
  applySemiconductorsSubform,
} from "./property_subforms_semiconductors";

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
      "terminal-properties-container",
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
      "terminal-properties-container",
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
    toggleWaveFieldsVisibility(waveType);
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
    updateWaveSubform(comp);

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

    // 6. Actuadores, Sensores Especiales y Semiconductores
    updateActuatorsSubform(comp);
    updateSemiconductorsSubform(comp);

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

    const terminalContainer = document.querySelector("#terminal-properties-container") as HTMLElement;
    const terminalTypeSelect = document.querySelector("#prop-terminal-type") as HTMLSelectElement;
    const terminalPowerGroup = document.querySelector("#terminal-power-group") as HTMLElement;
    const terminalPresetSelect = document.querySelector("#prop-terminal-preset") as HTMLSelectElement;
    const terminalVoltageGroup = document.querySelector("#terminal-voltage-group") as HTMLElement;
    const terminalVoltageInput = document.querySelector("#prop-terminal-voltage") as HTMLInputElement;

    if (terminalContainer && terminalTypeSelect) {
      if (comp.type === 'net_label') {
        terminalContainer.style.display = "flex";
        const tType = getTerminalType(comp);
        terminalTypeSelect.value = tType;

        const waveContainer = document.querySelector("#wave-properties-container") as HTMLElement | null;
        const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement | null;
        const waveAmpInput = document.querySelector("#prop-wave-amp") as HTMLInputElement | null;
        const waveFreqInput = document.querySelector("#prop-wave-freq") as HTMLInputElement | null;
        const waveOffsetInput = document.querySelector("#prop-wave-offset") as HTMLInputElement | null;
        const waveDutyInput = document.querySelector("#prop-wave-duty") as HTMLInputElement | null;

        if (tType === "power") {
          if (terminalPowerGroup) terminalPowerGroup.style.display = "flex";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "flex";
          if (waveContainer) waveContainer.style.display = "none";
          const v = parsePowerRailVoltage(comp);
          if (terminalVoltageInput) terminalVoltageInput.value = v.toString();
          if (terminalPresetSelect) {
            const label = String(comp.label || comp.value || "");
            terminalPresetSelect.value = ["+5V", "+3.3V", "+12V", "-12V", "+15V", "-15V", "+24V", "+1.8V", "+9V", "+3.7V"].includes(label) ? label : "custom";
          }
        } else if (tType === "generator") {
          if (terminalPowerGroup) terminalPowerGroup.style.display = "none";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "none";
          if (waveContainer) {
            waveContainer.style.display = "flex";
            if (waveTypeSelect) waveTypeSelect.value = comp.waveType || "square";
            if (waveAmpInput) waveAmpInput.value = (comp.amplitude ?? 5).toString();
            if (waveFreqInput) waveFreqInput.value = (comp.frequency ?? 1000).toString();
            if (waveOffsetInput) waveOffsetInput.value = (comp.offset ?? 0).toString();
            if (waveDutyInput) waveDutyInput.value = (comp.dutyCycle ?? 0.5).toString();
            this.toggleWaveFieldsVisibility(waveTypeSelect ? waveTypeSelect.value : (comp.waveType || "square"));
          }
        } else {
          if (terminalPowerGroup) terminalPowerGroup.style.display = "none";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "none";
          if (waveContainer) waveContainer.style.display = "none";
        }
      } else {
        terminalContainer.style.display = "none";
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

    const terminalTypeSelect = document.querySelector("#prop-terminal-type") as HTMLSelectElement;
    const terminalPresetSelect = document.querySelector("#prop-terminal-preset") as HTMLSelectElement;
    const terminalVoltageInput = document.querySelector("#prop-terminal-voltage") as HTMLInputElement;
    const terminalPowerGroup = document.querySelector("#terminal-power-group") as HTMLElement;
    const terminalVoltageGroup = document.querySelector("#terminal-voltage-group") as HTMLElement;
    const waveContainer = document.querySelector("#wave-properties-container") as HTMLElement;

    if (terminalTypeSelect) {
      terminalTypeSelect.addEventListener("change", () => {
        const val = terminalTypeSelect.value;
        if (val === "power") {
          if (terminalPowerGroup) terminalPowerGroup.style.display = "flex";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "flex";
          if (waveContainer) waveContainer.style.display = "none";
        } else if (val === "generator") {
          if (terminalPowerGroup) terminalPowerGroup.style.display = "none";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "none";
          if (waveContainer) {
            waveContainer.style.display = "flex";
            const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
            this.toggleWaveFieldsVisibility(waveTypeSelect ? waveTypeSelect.value : "square");
          }
        } else {
          if (terminalPowerGroup) terminalPowerGroup.style.display = "none";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "none";
          if (waveContainer) waveContainer.style.display = "none";
        }
      });
    }

    if (terminalPresetSelect && terminalVoltageInput) {
      terminalPresetSelect.addEventListener("change", () => {
        const preset = terminalPresetSelect.value;
        if (preset !== "custom") {
          const v = parseFloat(preset.replace("V", "").replace("+", ""));
          if (!isNaN(v)) {
            terminalVoltageInput.value = v.toString();
            if (this.propValInput) this.propValInput.value = preset;
          }
        }
      });
    }

    bindWaveSubformEvents();

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

    bindActuatorsSubformEvents(this.callbacks);

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

          applyWaveSubform(selected, newVal, this.propValInput, this.propValSlider);

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

          applyActuatorsSubform(selected);
          applySemiconductorsSubform(selected);

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
            const terminalTypeSelect = document.querySelector("#prop-terminal-type") as HTMLSelectElement;
            const terminalVoltageInput = document.querySelector("#prop-terminal-voltage") as HTMLInputElement;
            const tType = (terminalTypeSelect?.value as TerminalType) || "signal";
            selected.terminalType = tType;

            if (tType === "power") {
              const volt = parseFloat(terminalVoltageInput?.value || "5") || 5;
              selected.voltage = volt;
              const rawVal = String(newVal || selected.label || (volt >= 0 ? `+${volt}V` : `${volt}V`)).trim().toUpperCase();
              selected.value = rawVal;
              selected.label = rawVal;
            } else if (tType === "ground") {
              const rawVal = String(newVal || selected.label || "GND").trim().toUpperCase();
              selected.value = rawVal;
              selected.label = rawVal;
            } else if (tType === "generator") {
              const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
              const waveAmpInput = document.querySelector("#prop-wave-amp") as HTMLInputElement;
              const waveFreqInput = document.querySelector("#prop-wave-freq") as HTMLInputElement;
              const waveOffsetInput = document.querySelector("#prop-wave-offset") as HTMLInputElement;
              const waveDutyInput = document.querySelector("#prop-wave-duty") as HTMLInputElement;
              selected.waveType = waveTypeSelect ? waveTypeSelect.value : "square";
              selected.amplitude = waveAmpInput ? (parseFloat(waveAmpInput.value) || 5) : 5;
              selected.frequency = waveFreqInput ? (parseFloat(waveFreqInput.value) || 1000) : 1000;
              selected.offset = waveOffsetInput ? (parseFloat(waveOffsetInput.value) || 0) : 0;
              selected.dutyCycle = waveDutyInput ? (parseFloat(waveDutyInput.value) || 0.5) : 0.5;
              const rawVal = String(newVal || selected.label || "CLK").trim().toUpperCase();
              selected.value = rawVal;
              selected.label = rawVal;
            } else {
              const rawVal = String(newVal || selected.label || selected.id).trim().toUpperCase();
              selected.value = rawVal || "NET";
              selected.label = selected.value as string;
            }
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
