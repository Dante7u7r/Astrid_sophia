import { type ComponentInstance, type CanvasOrchestrator } from "../canvas_orchestrator";
import { type McuDebugPanel } from "./mcu_debug_panel";
import { type SimulationRunner } from "../simulation/simulation_runner";
import { parseSpiceValue, formatSpiceValue } from "../simulation/spice_value_parser";

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
      invokeTauri: <T>(cmd: string, args?: any) => Promise<T>;
    }
  ) {}

  public toggleWaveFieldsVisibility(waveType: string) {
    const fAmp = document.querySelector("#field-wave-amp") as HTMLElement;
    const fFreq = document.querySelector("#field-wave-freq") as HTMLElement;
    const fOffset = document.querySelector("#field-wave-offset") as HTMLElement;
    const fDuty = document.querySelector("#field-wave-duty") as HTMLElement;
    const gAmp = document.querySelector("#group-comp-val") as HTMLElement;
    const gFreq = document.querySelector("#group-comp-unit") as HTMLElement;

    if (!fAmp || !fFreq || !fOffset || !fDuty) return;

    if (waveType === "dc") {
      fAmp.style.display = "none";
      fFreq.style.display = "none";
      fOffset.style.display = "none";
      fDuty.style.display = "none";
      if (gAmp) gAmp.style.display = "flex";
      if (gFreq) gFreq.style.display = "flex";
    } else if (waveType === "sine" || waveType === "triangle") {
      fAmp.style.display = "flex";
      fFreq.style.display = "flex";
      fOffset.style.display = "flex";
      fDuty.style.display = "none";
    } else if (waveType === "pulse") {
      fAmp.style.display = "flex";
      fFreq.style.display = "flex";
      fOffset.style.display = "flex";
      fDuty.style.display = "flex";
    }
  }

  public updatePropertiesPanel(comp: ComponentInstance) {
    if (!this.propIdInput || !this.propValInput || !this.propValSlider || !this.propUnitInput) return;

    this.propIdInput.value = comp.id;
    this.propValInput.value = formatSpiceValue(Number(comp.value) || 0);
    this.propValSlider.value = comp.value.toString();

    const mcuDebugPanel = this.callbacks.getMcuDebugPanel();
    if (comp.type === 'mcu_8051' || comp.type === 'mcu_avr') {
      mcuDebugPanel?.show(comp);
    } else {
      mcuDebugPanel?.hide();
    }

    const valGroup = document.querySelector("#group-comp-val") as HTMLElement;
    const unitGroup = document.querySelector("#group-comp-unit") as HTMLElement;
    const valLabel = document.querySelector("#group-comp-val .property-label") as HTMLElement;

    if (valGroup && unitGroup) {
      if (comp.type === 'mcu_8051' || comp.type === 'mcu_avr') {
        valGroup.style.display = "none";
        unitGroup.style.display = "none";
      } else if (comp.type === 'arduino_uno' || comp.type === 'esp32' || comp.type === 'raspberry_pi_pico') {
        valGroup.style.display = "flex";
        unitGroup.style.display = "none";
        if (valLabel) valLabel.textContent = "Modo de Simulación (0-3)";
      } else {
        valGroup.style.display = "flex";
        unitGroup.style.display = "flex";
        if (valLabel) valLabel.textContent = "Valor Nominal";
      }
    }

    const waveContainer = document.querySelector("#wave-properties-container") as HTMLElement;
    const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
    const waveAmpInput = document.querySelector("#prop-wave-amp") as HTMLInputElement;
    const waveFreqInput = document.querySelector("#prop-wave-freq") as HTMLInputElement;
    const waveOffsetInput = document.querySelector("#prop-wave-offset") as HTMLInputElement;
    const waveDutyInput = document.querySelector("#prop-wave-duty") as HTMLInputElement;

    if (waveContainer && waveTypeSelect && waveAmpInput && waveFreqInput && waveOffsetInput && waveDutyInput) {
      if (comp.type === 'vsource' || comp.type === 'isource') {
        waveContainer.style.display = "flex";
        waveTypeSelect.value = comp.waveType || "dc";
        waveAmpInput.value = (comp.amplitude ?? 5).toString();
        waveFreqInput.value = (comp.frequency ?? 1000).toString();
        waveOffsetInput.value = (comp.offset ?? 0).toString();
        waveDutyInput.value = (comp.dutyCycle ?? 0.5).toString();
        
        this.toggleWaveFieldsVisibility(waveTypeSelect.value);
      } else {
        waveContainer.style.display = "none";
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
        dmmModeSelect.value = comp.value?.toString() ?? "V";
      } else {
        dmmContainer.style.display = "none";
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

    if (comp.type === 'x' || comp.type === 'ldr' || comp.type === 'thermistor' || comp.type === 'dmm' || comp.type === 'opamp') {
      if (valGroup) valGroup.style.display = "none";
      if (unitGroup) unitGroup.style.display = "none";
    }

    switch (comp.type) {
      case 'resistor':
        this.propUnitInput.value = "Ohmios (Ω)";
        this.propValSlider.min = "1";
        this.propValSlider.max = "10000";
        break;
      case 'potentiometer':
        this.propUnitInput.value = "Resistencia Total (Ω)";
        this.propValSlider.min = "10";
        this.propValSlider.max = "1000000";
        break;
      case 'capacitor':
        this.propUnitInput.value = "Faradios (F)";
        this.propValSlider.min = "0.000000001";
        this.propValSlider.max = "0.001";
        break;
      case 'inductor':
        this.propUnitInput.value = "Henrios (H)";
        this.propValSlider.min = "0.000001";
        this.propValSlider.max = "1";
        break;
      case 'diode':
        this.propUnitInput.value = "Unidad Exponencial";
        this.propValSlider.min = "0";
        this.propValSlider.max = "2";
        break;
      case 'npn':
      case 'pnp':
        this.propUnitInput.value = "Beta Ganancia (β)";
        this.propValSlider.min = "10";
        this.propValSlider.max = "500";
        break;
      case 'nmos':
      case 'pmos':
        this.propUnitInput.value = "Tensión Umbral (Vt)";
        this.propValSlider.min = "-3";
        this.propValSlider.max = "3";
        break;
      case 'vsource':
        this.propUnitInput.value = "Voltios (V)";
        this.propValSlider.min = "-50";
        this.propValSlider.max = "50";
        break;
      case 'isource':
        this.propUnitInput.value = "Amperios (A)";
        this.propValSlider.min = "-5";
        this.propValSlider.max = "5";
        break;
      case 'transformer':
        this.propUnitInput.value = "Inductancia Mutua (H)";
        this.propValSlider.min = "0.000001";
        this.propValSlider.max = "1";
        break;
      default:
        this.propUnitInput.value = "Valor Nominal";
        this.propValSlider.min = "0";
        this.propValSlider.max = "100";
    }
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
        const val = parseInt((e.target as HTMLInputElement).value) || 25;
        tempDisplay.textContent = `${val} ºC`;
      });
    }

    const dmmModeSelect = document.querySelector("#prop-dmm-mode") as HTMLSelectElement | null;
    if (dmmModeSelect) {
      dmmModeSelect.addEventListener("change", () => {
        const orchestrator = this.callbacks.getOrchestrator();
        const selected = orchestrator ? orchestrator.selectedComponent : null;
        if (selected && selected.type === 'dmm') {
          selected.value = dmmModeSelect.value;
          selected.dmmValue = undefined; // reset screen
          this.callbacks.updateCanvasRendering();
          this.callbacks.markCurrentTabAsModified();
          if (this.btnApplyProperties) {
            this.btnApplyProperties.click();
          }
        }
      });
    }

    const opampVosSlider = document.querySelector("#prop-opamp-vos") as HTMLInputElement;
    const opampVosDisplay = document.querySelector("#prop-opamp-vos-display") as HTMLElement;
    const opampGainSelect = document.querySelector("#prop-opamp-gain") as HTMLSelectElement;

    if (opampVosSlider && opampVosDisplay) {
      opampVosSlider.addEventListener("input", (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value) || 2.0;
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
            const duplicate = activeOrchestrator.components.some(c => c.id === newId);
            if (!duplicate) {
              selected.id = newId;
            } else {
              this.callbacks.addLog(`Error: El identificador [${newId}] ya existe en el circuito.`, "error");
            }
          }

          selected.value = newVal;
          this.propValInput!.value = formatSpiceValue(newVal);

          if (selected.type === 'vsource' || selected.type === 'isource') {
            const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
            const waveAmpInput = document.querySelector("#prop-wave-amp") as HTMLInputElement;
            const waveFreqInput = document.querySelector("#prop-wave-freq") as HTMLInputElement;
            const waveOffsetInput = document.querySelector("#prop-wave-offset") as HTMLInputElement;
            const waveDutyInput = document.querySelector("#prop-wave-duty") as HTMLInputElement;

            if (waveTypeSelect && waveAmpInput && waveFreqInput && waveOffsetInput && waveDutyInput) {
              selected.waveType = waveTypeSelect.value;
              selected.amplitude = parseFloat(waveAmpInput.value) || 0;
              selected.frequency = parseFloat(waveFreqInput.value) || 1000;
              selected.offset = parseFloat(waveOffsetInput.value) || 0;
              selected.dutyCycle = parseFloat(waveDutyInput.value) || 0.5;

              selected.value = selected.offset;
              this.propValInput!.value = formatSpiceValue(selected.value);
              this.propValSlider!.value = selected.value.toString();
            }
          }

          if (selected.type === 'potentiometer') {
            const wiperSlider = document.querySelector("#prop-wiper-slider") as HTMLInputElement;
            if (wiperSlider) {
              selected.wiperPosition = parseFloat(wiperSlider.value) || 0.5;
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
              selected.temperatureCelsius = parseInt(tempSlider.value) || 25;
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
              selected.offsetVoltage = (parseFloat(opampVosSlider.value) || 2.0) / 1000.0;
            }
            if (opampGainSelect) {
              selected.openLoopGain = parseFloat(opampGainSelect.value) || 100000.0;
            }
          }

          const simulationRunner = this.callbacks.getSimulationRunner();
          if (simulationRunner?.isSimulationActive() ?? false) {
            const mutations: { componentId: string; field: string; value: number }[] = [];
            mutations.push({ componentId: selected.id, field: 'value', value: newVal });
            if (selected.amplitude !== undefined) {
              mutations.push({ componentId: selected.id, field: 'amplitude', value: selected.amplitude });
            }
            if (selected.frequency !== undefined) {
              mutations.push({ componentId: selected.id, field: 'frequency', value: selected.frequency });
            }
            if (selected.offset !== undefined) {
              mutations.push({ componentId: selected.id, field: 'offset', value: selected.offset });
            }
            if (selected.dutyCycle !== undefined) {
              mutations.push({ componentId: selected.id, field: 'duty_cycle', value: selected.dutyCycle });
            }
            if (selected.switchRon !== undefined) {
              mutations.push({ componentId: selected.id, field: 'switch_ron', value: selected.switchRon });
            }
            if (selected.switchRoff !== undefined) {
              mutations.push({ componentId: selected.id, field: 'switch_roff', value: selected.switchRoff });
            }
            if (selected.type === 'opamp') {
              mutations.push({ componentId: `${selected.id}__vos`, field: 'value', value: selected.offsetVoltage ?? 0.002 });
              mutations.push({ componentId: selected.id, field: 'value', value: selected.openLoopGain ?? 100000.0 });
            }
            for (const m of mutations) {
              this.callbacks.invokeTauri('inject_live_mutation', { mutation: m }).catch((err: unknown) => {
                this.callbacks.addLog(`Error en mutación en caliente: ${err}`, 'error');
              });
            }
            this.callbacks.addLog(`Mutación en caliente emitida para [${selected.id}]: ${mutations.length} campo(s)`, "send");
          }

          this.callbacks.updateCanvasRendering();
          this.callbacks.markCurrentTabAsModified();
          this.callbacks.addLog(`Propiedades aplicadas a [${selected.id}]: Valor = [${newVal}]`, "system");
        }
      });
    }
  }
}
