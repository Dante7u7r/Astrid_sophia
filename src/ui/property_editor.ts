import { type ComponentInstance, type CanvasOrchestrator, type WireInstance } from "../canvas_orchestrator";
import { type McuDebugPanel } from "./mcu_debug_panel";
import { type SimulationRunner } from "../simulation/simulation_runner";
import { parseSpiceValue, formatSpiceValue } from "../simulation/spice_value_parser";
import {
  DMM_INITIAL_DISPLAY,
  normalizeDmmMode,
} from "../simulation/dmm";
import {
  isValidComponentId,
  normalizeComponentId,
} from "../canvas/component_identity";
import {
  ACTUATOR_MODEL_EDITORS,
  DEDICATED_VALUE_EDITORS,
  analyzeBatchSelection,
  buildLiveMutations,
  calculateComponentOperatingPoint,
  formatComponentSpiceCard,
  formatEngineeringBadge,
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

export interface PropertyEditorCallbacks {
  getOrchestrator: () => CanvasOrchestrator | null;
  getMcuDebugPanel: () => McuDebugPanel | null;
  getSimulationRunner: () => SimulationRunner | null;
  getVoltageMap?: () => Readonly<Record<string, number>>;
  getCurrentMap?: () => Readonly<Record<string, number>>;
  getPinNode?: (pinKey: string) => string | undefined;
  setProbeNode?: (channel: "ch1" | "ch2", nodeId: string) => void;
  getProbeNodes?: () => { ch1?: string | null; ch2?: string | null };
  highlightNet?: (nodeId: string | null) => void;
  addLog: (text: string, type?: 'system' | 'send' | 'receive' | 'error') => void;
  updateCanvasRendering: () => void;
  markCurrentTabAsModified: () => void;
  extractNetlist?: () => void;
  onComponentPropertiesApplied?: (comp: ComponentInstance) => void;
  invokeTauri: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

export function syncNumericSelect(
  select: HTMLSelectElement | null,
  val: number | string | undefined,
  defaultVal: number | string,
): void {
  if (!select) return;
  const numTarget = typeof val === "number" ? val : parseFloat(String(val ?? ""));
  if (isNaN(numTarget)) {
    select.value = String(defaultVal);
    return;
  }
  select.value = numTarget.toString();
  if (select.selectedIndex !== -1 && select.value !== "") return;

  for (let i = 0; i < select.options.length; i++) {
    const optVal = parseFloat(select.options[i].value);
    if (!isNaN(optVal) && Math.abs(optVal - numTarget) <= Math.max(1e-9, Math.abs(numTarget) * 0.01)) {
      select.selectedIndex = i;
      return;
    }
  }
  select.value = String(defaultVal);
}

export class PropertyEditor {
  private propIdInput: HTMLInputElement | null = null;
  private propValInput: HTMLInputElement | null = null;
  private propValSlider: HTMLInputElement | null = null;
  private propUnitInput: HTMLInputElement | null = null;
  private propValInc: HTMLButtonElement | null = null;
  private propValDec: HTMLButtonElement | null = null;
  private btnApplyProperties: HTMLButtonElement | null = null;

  constructor(
    private callbacks: PropertyEditorCallbacks
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

  public updateValueBadge(compType: ComponentInstance["type"]): void {
    const valBadge = document.querySelector("#prop-val-badge") as HTMLElement | null;
    if (!valBadge || !this.propValInput) return;
    const res = formatEngineeringBadge(this.propValInput.value, compType);
    valBadge.style.display = "inline-flex";
    valBadge.textContent = res.badgeText;
    valBadge.className = `prop-badge ${res.valid ? (res.isExpression ? "expression" : "") : "invalid"}`;
  }

  public updateIdBadge(): void {
    const idBadge = document.querySelector("#prop-id-badge") as HTMLElement | null;
    if (!idBadge || !this.propIdInput) return;
    const val = this.propIdInput.value.trim();
    const orchestrator = this.callbacks.getOrchestrator();
    const selectedList = (orchestrator?.selectedComponents && orchestrator.selectedComponents.length > 0)
      ? orchestrator.selectedComponents
      : (orchestrator?.selectedComponent ? [orchestrator.selectedComponent] : []);
    const selected = selectedList[0];

    if (!val) {
      idBadge.style.display = "inline-flex";
      idBadge.textContent = "El identificador no puede estar vacío";
      idBadge.className = "prop-badge invalid";
      return;
    }

    if (!isValidComponentId(val)) {
      idBadge.style.display = "inline-flex";
      idBadge.textContent = "Debe iniciar con letra (ej. R1, C1, V_IN)";
      idBadge.className = "prop-badge invalid";
      return;
    }

    if (orchestrator && selected) {
      const normalizedVal = normalizeComponentId(val);
      const components = orchestrator.components ?? [];
      const isDuplicate = components.some(
        c => c !== selected && normalizeComponentId(c.id) === normalizedVal
      );
      if (isDuplicate) {
        idBadge.style.display = "inline-flex";
        idBadge.textContent = `El identificador [${val}] ya existe`;
        idBadge.className = "prop-badge invalid";
        return;
      }
    }

    if (selected && val === selected.id) {
      idBadge.style.display = "none";
      return;
    }

    idBadge.style.display = "inline-flex";
    idBadge.textContent = `Renombrar a ${val.toUpperCase()}`;
    idBadge.className = "prop-badge";
  }

  public updateSpiceDirective(comp: ComponentInstance, pinNodes: { pinName: string; nodeId: string }[]): void {
    const detailsSpice = document.querySelector("#details-spice-card") as HTMLElement | null;
    const spiceText = document.querySelector("#prop-spice-card-text") as HTMLElement | null;
    if (!detailsSpice || !spiceText) return;

    const card = formatComponentSpiceCard(comp, pinNodes);
    if (card) {
      detailsSpice.style.display = "block";
      spiceText.textContent = card;
    } else {
      detailsSpice.style.display = "none";
    }
  }

  public updateOperatingPointTelemetry(comp: ComponentInstance): void {
    const opContainer = document.querySelector("#prop-op-telemetry-container") as HTMLElement | null;
    const opRegionBadge = document.querySelector("#prop-op-region-badge") as HTMLElement | null;
    const opVdrop = document.querySelector("#prop-op-vdrop") as HTMLElement | null;
    const opIbranch = document.querySelector("#prop-op-ibranch") as HTMLElement | null;
    const opPower = document.querySelector("#prop-op-power") as HTMLElement | null;
    const opSmallSignalItem = document.querySelector("#prop-op-small-signal-item") as HTMLElement | null;
    const opGm = document.querySelector("#prop-op-gm") as HTMLElement | null;

    const detailsPins = document.querySelector("#details-pins") as HTMLElement | null;
    const pinsTbody = document.querySelector("#prop-pins-tbody") as HTMLElement | null;

    const orchestrator = this.callbacks.getOrchestrator();
    if (!orchestrator) {
      if (opContainer) opContainer.style.display = "none";
      if (detailsPins) detailsPins.style.display = "none";
      return;
    }

    const pins = typeof orchestrator.getComponentPins === "function" ? orchestrator.getComponentPins(comp) : [];
    const pinNodes = pins.map((p, idx) => {
      const pinKey = `${comp.id}:${idx}`;
      const nodeId = this.callbacks.getPinNode?.(pinKey) ?? "0";
      const pinName = p.name || p.label || `Pin ${idx + 1}`;
      return { pinIndex: idx, pinName, nodeId };
    });

    const nodeVoltages = this.callbacks.getVoltageMap?.() ?? {};
    const branchCurrents = this.callbacks.getCurrentMap?.() ?? {};

    const op = calculateComponentOperatingPoint(comp, pinNodes, nodeVoltages, branchCurrents);

    if (op && (orchestrator.simulationActive || Object.keys(nodeVoltages).length > 0)) {
      if (opContainer) {
        opContainer.style.display = "flex";
        if (opVdrop) opVdrop.textContent = `${formatSpiceValue(op.vDrop)} V`;
        if (opIbranch) opIbranch.textContent = `${formatSpiceValue(op.iBranch)} A`;
        if (opPower) {
          const pStr = `${formatSpiceValue(op.power)} W`;
          const ratioStr = op.powerRatio !== undefined ? ` (${Math.round(op.powerRatio * 100)}% P_max)` : "";
          opPower.textContent = `${pStr}${ratioStr}`;
          opPower.className = `prop-op-val ${op.isOverloaded ? "danger" : (op.powerRatio && op.powerRatio > 0.8 ? "warning" : "")}`;
        }
        if (opRegionBadge) {
          if (op.region) {
            opRegionBadge.style.display = "inline-block";
            opRegionBadge.textContent = op.region;
          } else {
            opRegionBadge.style.display = "none";
          }
        }
        if (opSmallSignalItem && opGm) {
          if (op.smallSignal?.gm !== undefined) {
            opSmallSignalItem.style.display = "flex";
            const extra = op.smallSignal.rpi !== undefined ? ` | rπ: ${formatSpiceValue(op.smallSignal.rpi)} Ω` : (op.smallSignal.ro !== undefined ? ` | ro: ${formatSpiceValue(op.smallSignal.ro)} Ω` : "");
            opGm.textContent = `gm: ${formatSpiceValue(op.smallSignal.gm)} S${extra}`;
          } else if (op.smallSignal?.rd !== undefined) {
            opSmallSignalItem.style.display = "flex";
            opGm.textContent = `rd: ${formatSpiceValue(op.smallSignal.rd)} Ω`;
          } else {
            opSmallSignalItem.style.display = "none";
          }
        }
      }
    } else {
      if (opContainer) opContainer.style.display = "none";
    }

    // Renderizar tabla de pines con Cross-Probing y Asignación de Sondas
    if (detailsPins && pinsTbody) {
      if (pinNodes.length > 0) {
        detailsPins.style.display = "block";
        const currentProbes = this.callbacks.getProbeNodes?.() ?? {};
        pinsTbody.innerHTML = pinNodes.map(p => {
          const v = nodeVoltages[p.nodeId];
          const vStr = v !== undefined ? `${v.toFixed(2)} V` : "-- V";
          const isCh1 = currentProbes.ch1 === p.nodeId;
          const isCh2 = currentProbes.ch2 === p.nodeId;
          const displayName = p.pinName.replace(/^Terminal\s+/i, "T");
          return `<tr class="interactive-row" data-node-id="${p.nodeId}">
            <td style="font-weight: 600; color: var(--text-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p.pinName}">${displayName}</td>
            <td><code style="color: var(--cyan);">${p.nodeId}</code></td>
            <td>${vStr}</td>
            <td style="text-align: right; white-space: nowrap;">
              <button type="button" class="btn-pin-probe ${isCh1 ? "active-ch1" : ""}" data-channel="ch1" data-node-id="${p.nodeId}" title="Fijar Canal 1 (CH1) a este nodo">CH1</button>
              <button type="button" class="btn-pin-probe ${isCh2 ? "active-ch2" : ""}" data-channel="ch2" data-node-id="${p.nodeId}" title="Fijar Canal 2 (CH2) a este nodo">CH2</button>
            </td>
          </tr>`;
        }).join("");

        for (const row of pinsTbody.querySelectorAll<HTMLTableRowElement>("tr.interactive-row")) {
          const nId = row.getAttribute("data-node-id");
          row.addEventListener("mouseenter", () => {
            if (nId) this.callbacks.highlightNet?.(nId);
          });
          row.addEventListener("mouseleave", () => {
            this.callbacks.highlightNet?.(null);
          });
        }

        for (const btn of pinsTbody.querySelectorAll<HTMLButtonElement>(".btn-pin-probe")) {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const ch = btn.getAttribute("data-channel") as "ch1" | "ch2";
            const nId = btn.getAttribute("data-node-id");
            if (ch && nId && this.callbacks.setProbeNode) {
              this.callbacks.setProbeNode(ch, nId);
              this.callbacks.addLog(`Sonda ${ch.toUpperCase()} conectada al nodo [${nId}]`, "system");
              this.updateOperatingPointTelemetry(comp);
            }
          });
        }
      } else {
        detailsPins.style.display = "none";
      }
    }

    // Actualizar visor de directiva SPICE
    this.updateSpiceDirective(comp, pinNodes);
  }

  public clearPropertiesPanel(): void {
    this.setFormControlsDisabled(true);
    if (this.propIdInput) {
      this.propIdInput.value = "";
      this.propIdInput.placeholder = "Selecciona un componente";
      this.propIdInput.disabled = true;
    }
    if (this.propValInput) this.propValInput.value = "";
    if (this.propUnitInput) this.propUnitInput.value = "";

    const batchHeader = document.querySelector("#prop-batch-header") as HTMLElement | null;
    if (batchHeader) batchHeader.style.display = "none";

    const valBadge = document.querySelector("#prop-val-badge") as HTMLElement | null;
    if (valBadge) valBadge.style.display = "none";

    const idBadge = document.querySelector("#prop-id-badge") as HTMLElement | null;
    if (idBadge) idBadge.style.display = "none";

    const snapControls = document.querySelector(".prop-snap-controls") as HTMLElement | null;
    if (snapControls) snapControls.style.display = "none";

    const opContainer = document.querySelector("#prop-op-telemetry-container") as HTMLElement | null;
    if (opContainer) opContainer.style.display = "none";

    const detailsPins = document.querySelector("#details-pins") as HTMLElement | null;
    if (detailsPins) detailsPins.style.display = "none";

    const detailsParasitics = document.querySelector("#details-parasitics") as HTMLElement | null;
    if (detailsParasitics) detailsParasitics.style.display = "none";

    const detailsIc = document.querySelector("#details-initial-conditions") as HTMLElement | null;
    if (detailsIc) detailsIc.style.display = "none";

    const detailsSpice = document.querySelector("#details-spice-card") as HTMLElement | null;
    if (detailsSpice) detailsSpice.style.display = "none";

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

    const orchestrator = this.callbacks.getOrchestrator();
    const selectedList = (orchestrator?.selectedComponents && orchestrator.selectedComponents.length > 0)
      ? orchestrator.selectedComponents
      : [comp];
    const batchSummary = analyzeBatchSelection(selectedList);

    const batchHeader = document.querySelector("#prop-batch-header") as HTMLElement | null;
    const batchTitle = document.querySelector("#prop-batch-title") as HTMLElement | null;
    const batchSubtitle = document.querySelector("#prop-batch-subtitle") as HTMLElement | null;

    if (batchSummary.isMultiple && batchHeader && batchTitle && batchSubtitle) {
      batchHeader.style.display = "flex";
      batchTitle.textContent = `${batchSummary.count} ${batchSummary.typeLabel}`;
      batchSubtitle.textContent = batchSummary.ids.join(", ");
      this.propIdInput.value = batchSummary.ids.join(", ");
      this.propIdInput.disabled = true;

      if (batchSummary.hasMixedValues) {
        this.propValInput.value = "";
        this.propValInput.placeholder = "<Valores Mixtos>";
      } else {
        this.propValInput.value = formatSpiceValue(Number(batchSummary.sharedValue) || 0);
      }
    } else {
      if (batchHeader) batchHeader.style.display = "none";
      this.propIdInput.disabled = false;
      this.propIdInput.value = comp.id;

      const usesActuatorModel = ACTUATOR_MODEL_EDITORS.has(comp.type);
      if (comp.expression) {
        this.propValInput.value = comp.expression;
      } else if (comp.type === "net_label") {
        this.propValInput.value = String(comp.label || comp.value || "NET_A");
      } else if (comp.type === "text_note") {
        this.propValInput.value = String(comp.label || comp.value || "");
      } else if (usesActuatorModel) {
        this.propValInput.value = comp.value.toString();
      } else {
        this.propValInput.value = formatSpiceValue(Number(comp.value) || 0);
      }
    }

    const usesActuator = ACTUATOR_MODEL_EDITORS.has(comp.type);
    this.propValSlider.value = usesActuator || comp.type === "net_label" || comp.type === "text_note" ? "0" : comp.value.toString();

    this.updateIdBadge();
    this.updateValueBadge(comp.type);
    this.updateOperatingPointTelemetry(comp);

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
    const snapControls = document.querySelector(".prop-snap-controls") as HTMLElement | null;
    if (snapControls) {
      snapControls.style.display = valuePresentation.showSnapSeries ? "flex" : "none";
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
        if (resistorTolSelect) syncNumericSelect(resistorTolSelect, comp.tolerance, 1);
        if (resistorPowerSelect) syncNumericSelect(resistorPowerSelect, comp.powerRating, 0.25);
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
        if (capVoltSelect) syncNumericSelect(capVoltSelect, comp.voltageRating, 25);
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

    // 7. Parásitos y Modelado HF (Divulgación Progresiva)
    const detailsParasitics = document.querySelector("#details-parasitics") as HTMLElement | null;
    const groupEsl = document.querySelector("#group-comp-esl") as HTMLElement | null;
    const groupCpar = document.querySelector("#group-comp-cpar") as HTMLElement | null;
    const groupTc1 = document.querySelector("#group-comp-tc1") as HTMLElement | null;
    const groupRleak = document.querySelector("#group-comp-rleak") as HTMLElement | null;

    const inputEsl = document.querySelector("#prop-comp-esl") as HTMLInputElement | null;
    const inputCpar = document.querySelector("#prop-comp-cpar") as HTMLInputElement | null;
    const inputTc1 = document.querySelector("#prop-comp-tc1") as HTMLInputElement | null;
    const inputRleak = document.querySelector("#prop-comp-rleak") as HTMLInputElement | null;

    if (detailsParasitics) {
      if (comp.type === "resistor") {
        detailsParasitics.style.display = "block";
        if (groupEsl) groupEsl.style.display = "flex";
        if (groupCpar) groupCpar.style.display = "flex";
        if (groupTc1) groupTc1.style.display = "flex";
        if (groupRleak) groupRleak.style.display = "none";
        if (inputEsl) inputEsl.value = comp.esr ? formatSpiceValue(comp.esr) : "";
        if (inputCpar) inputCpar.value = comp.cpar ? formatSpiceValue(comp.cpar) : "";
        if (inputTc1) inputTc1.value = comp.tc1 !== undefined ? comp.tc1.toString() : "";
      } else if (comp.type === "capacitor") {
        detailsParasitics.style.display = "block";
        if (groupEsl) groupEsl.style.display = "flex";
        if (groupCpar) groupCpar.style.display = "none";
        if (groupTc1) groupTc1.style.display = "none";
        if (groupRleak) groupRleak.style.display = "flex";
        if (inputEsl) inputEsl.value = comp.esr ? formatSpiceValue(comp.esr) : "";
        if (inputRleak) inputRleak.value = comp.rleak ? formatSpiceValue(comp.rleak) : "";
      } else if (comp.type === "inductor") {
        detailsParasitics.style.display = "block";
        if (groupEsl) groupEsl.style.display = "none";
        if (groupCpar) groupCpar.style.display = "flex";
        if (groupTc1) groupTc1.style.display = "none";
        if (groupRleak) groupRleak.style.display = "none";
        if (inputCpar) inputCpar.value = comp.cpar ? formatSpiceValue(comp.cpar) : "";
      } else {
        detailsParasitics.style.display = "none";
      }
    }

    // 8. Condiciones Iniciales (.IC)
    const detailsIc = document.querySelector("#details-initial-conditions") as HTMLElement | null;
    const inputIc = document.querySelector("#prop-comp-ic") as HTMLInputElement | null;
    if (detailsIc) {
      if (["capacitor", "inductor", "switch"].includes(comp.type)) {
        detailsIc.style.display = "block";
        if (inputIc) inputIc.value = comp.initialCondition !== undefined ? comp.initialCondition.toString() : "";
      } else {
        detailsIc.style.display = "none";
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

    const terminalContainer = document.querySelector("#terminal-properties-container") as HTMLElement;
    const terminalTypeSelect = document.querySelector("#prop-terminal-type") as HTMLSelectElement;
    const terminalGroundGroup = document.querySelector("#terminal-ground-group") as HTMLElement;
    const terminalGroundStyleSelect = document.querySelector("#prop-terminal-ground-style") as HTMLSelectElement;
    const terminalPowerStyleGroup = document.querySelector("#terminal-power-style-group") as HTMLElement;
    const terminalPowerStyleSelect = document.querySelector("#prop-terminal-power-style") as HTMLSelectElement;
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

        const powerNotice = document.querySelector("#terminal-power-notice") as HTMLElement | null;
        const generatorNotice = document.querySelector("#terminal-generator-notice") as HTMLElement | null;

        if (tType === "power") {
          if (terminalPowerStyleGroup) terminalPowerStyleGroup.style.display = "flex";
          if (terminalPowerGroup) terminalPowerGroup.style.display = "flex";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "flex";
          if (terminalGroundGroup) terminalGroundGroup.style.display = "none";
          if (powerNotice) powerNotice.style.display = "block";
          if (generatorNotice) generatorNotice.style.display = "none";
          if (waveContainer) waveContainer.style.display = "none";
          const v = parsePowerRailVoltage(comp);
          if (terminalVoltageInput) terminalVoltageInput.value = v.toString();
          if (terminalPowerStyleSelect) terminalPowerStyleSelect.value = comp.terminalStyle || "arrow";
          if (terminalPresetSelect) {
            const label = String(comp.label || comp.value || "");
            terminalPresetSelect.value = ["+5V", "+3.3V", "+12V", "-12V", "+15V", "-15V", "+24V", "+1.8V", "+9V", "+3.7V"].includes(label) ? label : "custom";
          }
        } else if (tType === "ground") {
          if (terminalGroundGroup) terminalGroundGroup.style.display = "flex";
          if (terminalGroundStyleSelect) terminalGroundStyleSelect.value = comp.terminalStyle || "standard";
          if (terminalPowerStyleGroup) terminalPowerStyleGroup.style.display = "none";
          if (terminalPowerGroup) terminalPowerGroup.style.display = "none";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "none";
          if (powerNotice) powerNotice.style.display = "none";
          if (generatorNotice) generatorNotice.style.display = "none";
          if (waveContainer) waveContainer.style.display = "none";
        } else if (tType === "generator") {
          if (terminalGroundGroup) terminalGroundGroup.style.display = "none";
          if (terminalPowerStyleGroup) terminalPowerStyleGroup.style.display = "none";
          if (terminalPowerGroup) terminalPowerGroup.style.display = "none";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "none";
          if (powerNotice) powerNotice.style.display = "none";
          if (generatorNotice) generatorNotice.style.display = "block";
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
          if (terminalGroundGroup) terminalGroundGroup.style.display = "none";
          if (terminalPowerStyleGroup) terminalPowerStyleGroup.style.display = "none";
          if (terminalPowerGroup) terminalPowerGroup.style.display = "none";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "none";
          if (powerNotice) powerNotice.style.display = "none";
          if (generatorNotice) generatorNotice.style.display = "none";
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
  public applyCurrentProperties(options?: { isLiveInput?: boolean; skipLogging?: boolean }): boolean {
    const isLive = options?.isLiveInput ?? false;
    const skipLogging = options?.skipLogging ?? isLive;
    const activeOrchestrator = this.callbacks.getOrchestrator();
    if (!activeOrchestrator) return false;
    const selectedList = (activeOrchestrator.selectedComponents && activeOrchestrator.selectedComponents.length > 0)
      ? activeOrchestrator.selectedComponents
      : (activeOrchestrator.selectedComponent ? [activeOrchestrator.selectedComponent] : []);
    if (selectedList.length === 0) return false;

    const isBatch = selectedList.length > 1;
    const selected = selectedList[0];
    const oldId = selected.id;
    const newId = this.propIdInput ? this.propIdInput.value.trim() : oldId;
    const rawInput = this.propValInput ? this.propValInput.value.trim() : "";
    const parsed = parseSpiceValue(rawInput);

    const isParametricExpr = rawInput.startsWith("{") && rawInput.endsWith("}");
    const hasNewVal = rawInput !== "" && rawInput !== "<Valores Mixtos>";

    if (hasNewVal && !isParametricExpr && (!parsed.valid || parsed.value === undefined || !Number.isFinite(parsed.value))) {
      if (!ACTUATOR_MODEL_EDITORS.has(selected.type) && selected.type !== "net_label" && selected.type !== "text_note" && selected.type !== "dmm") {
        if (!isLive) {
          this.callbacks.addLog(`Valor inválido: ${parsed.error || (this.propValInput?.value ?? "")}`, "error");
        }
        return false;
      }
    }

    const newVal = parsed.valid && parsed.value !== undefined ? parsed.value : (parseFloat(this.propValInput?.value || "0") || 0);

    for (const targetComp of selectedList) {
      if (!isBatch && newId.length > 0 && newId !== oldId && !isLive) {
        const renameError = activeOrchestrator.renameComponent(targetComp, newId);
        if (renameError) {
          if (this.propIdInput) this.propIdInput.value = oldId;
          const idBadge = document.querySelector("#prop-id-badge") as HTMLElement | null;
          if (idBadge) {
            idBadge.style.display = "inline-flex";
            idBadge.textContent = renameError;
            idBadge.className = "prop-badge invalid";
          }
          if (!skipLogging) this.callbacks.addLog(`Error: ${renameError}`, "error");
        } else {
          this.updateIdBadge();
        }
      }

      if (hasNewVal) {
        if (isParametricExpr) {
          targetComp.expression = rawInput;
        } else {
          targetComp.expression = undefined;
          if (targetComp.type === "net_label" || targetComp.type === "text_note") {
            // Se gestiona en sus bloques especializados para preservar cadenas de texto alfanuméricas
          } else if (!DEDICATED_VALUE_EDITORS.has(targetComp.type)) {
            targetComp.value = newVal;
          }
        }
      }

      if (targetComp.type === "dmm") {
        const dmmModeSelect = document.querySelector("#prop-dmm-mode") as HTMLSelectElement;
        targetComp.value = normalizeDmmMode(dmmModeSelect?.value);
        targetComp.dmmValue = DMM_INITIAL_DISPLAY;
      } else if (ACTUATOR_MODEL_EDITORS.has(targetComp.type) && hasNewVal) {
        targetComp.value = this.propValInput?.value.trim() || targetComp.value;
      }

      applyWaveSubform(targetComp, newVal, this.propValInput, this.propValSlider);

      if (targetComp.type === "resistor") {
        const resistorTolSelect = document.querySelector("#prop-resistor-tolerance") as HTMLSelectElement;
        const resistorPowerSelect = document.querySelector("#prop-resistor-power") as HTMLSelectElement;
        if (resistorTolSelect) targetComp.tolerance = parseFloat(resistorTolSelect.value) || 1;
        if (resistorPowerSelect) targetComp.powerRating = parseFloat(resistorPowerSelect.value) || 0.25;
      }

      if (targetComp.type === "capacitor") {
        const capVoltSelect = document.querySelector("#prop-capacitor-voltage") as HTMLSelectElement;
        const capEsrInput = document.querySelector("#prop-capacitor-esr") as HTMLInputElement;
        const capDielectricSelect = document.querySelector("#prop-capacitor-dielectric") as HTMLSelectElement;
        if (capVoltSelect) targetComp.voltageRating = parseFloat(capVoltSelect.value) || 25;
        if (capEsrInput) targetComp.esr = Math.max(0, parseFloat(capEsrInput.value) || 0);
        if (capDielectricSelect) targetComp.dielectricType = capDielectricSelect.value as any;
      }

      if (targetComp.type === "inductor") {
        const indDcrInput = document.querySelector("#prop-inductor-dcr") as HTMLInputElement;
        const indIsatInput = document.querySelector("#prop-inductor-isat") as HTMLInputElement;
        if (indDcrInput) targetComp.dcResistance = Math.max(0, parseFloat(indDcrInput.value) || 0);
        if (indIsatInput) {
          const val = parseFloat(indIsatInput.value);
          targetComp.isat = val > 0 ? val : undefined;
          targetComp.currentRating = targetComp.isat ?? 1.0;
        }
      }

      if (targetComp.type === "led") {
        const ledColorSelect = document.querySelector("#prop-led-color") as HTMLSelectElement;
        const ledImaxInput = document.querySelector("#prop-led-imax") as HTMLInputElement;
        if (ledColorSelect) targetComp.ledColor = ledColorSelect.value as any;
        if (ledImaxInput) targetComp.maxCurrent = Math.max(1, parseFloat(ledImaxInput.value) || 20);
      }

      // Parásitos físicos y condiciones iniciales
      const inputEsl = document.querySelector("#prop-comp-esl") as HTMLInputElement | null;
      const inputCpar = document.querySelector("#prop-comp-cpar") as HTMLInputElement | null;
      const inputTc1 = document.querySelector("#prop-comp-tc1") as HTMLInputElement | null;
      const inputRleak = document.querySelector("#prop-comp-rleak") as HTMLInputElement | null;
      const inputIc = document.querySelector("#prop-comp-ic") as HTMLInputElement | null;

      if (inputEsl && inputEsl.value.trim()) {
        const p = parseSpiceValue(inputEsl.value);
        targetComp.esr = p.valid && p.value !== undefined ? p.value : (parseFloat(inputEsl.value) || undefined);
      }
      if (inputCpar && inputCpar.value.trim()) {
        const p = parseSpiceValue(inputCpar.value);
        targetComp.cpar = p.valid && p.value !== undefined ? p.value : (parseFloat(inputCpar.value) || undefined);
      }
      if (inputTc1 && inputTc1.value.trim()) {
        targetComp.tc1 = parseFloat(inputTc1.value) || undefined;
      }
      if (inputRleak && inputRleak.value.trim()) {
        const p = parseSpiceValue(inputRleak.value);
        targetComp.rleak = p.valid && p.value !== undefined ? p.value : (parseFloat(inputRleak.value) || undefined);
      }
      if (inputIc && inputIc.value.trim()) {
        const p = parseSpiceValue(inputIc.value);
        targetComp.initialCondition = p.valid && p.value !== undefined ? p.value : (parseFloat(inputIc.value) || undefined);
      }

      applyActuatorsSubform(targetComp);
      applySemiconductorsSubform(targetComp);

      if (targetComp.type === 'x') {
        const macroTextarea = document.querySelector("#prop-spice-macro") as HTMLTextAreaElement;
        if (macroTextarea) {
          targetComp.spiceMacro = macroTextarea.value.trim() || undefined;
        }
        const pinCountInput = document.querySelector("#prop-pin-count") as HTMLInputElement;
        if (pinCountInput) {
          const newPinCount = parseInt(pinCountInput.value) || 4;
          targetComp.pinCount = Math.max(2, Math.min(64, newPinCount));
        }
      }

      if (targetComp.type === "text_note") {
        const noteTextInput = document.querySelector("#prop-note-text") as HTMLTextAreaElement | null;
        const noteFontInput = document.querySelector("#prop-note-fontsize") as HTMLInputElement | null;
        const noteThemeSelect = document.querySelector("#prop-note-theme") as HTMLSelectElement | null;
        const noteContent = noteTextInput ? noteTextInput.value : rawInput;
        targetComp.label = noteContent;
        targetComp.value = noteContent;
        if (noteFontInput) {
          targetComp.fontSize = Number(noteFontInput.value) || 12;
        }
        if (noteThemeSelect) {
          targetComp.noteTheme = (noteThemeSelect.value as any) || "card";
        }
      }

      if (targetComp.type === "net_label") {
        const terminalTypeSelect = document.querySelector("#prop-terminal-type") as HTMLSelectElement;
        const terminalGroundStyleSelect = document.querySelector("#prop-terminal-ground-style") as HTMLSelectElement;
        const terminalPowerStyleSelect = document.querySelector("#prop-terminal-power-style") as HTMLSelectElement;
        const terminalVoltageInput = document.querySelector("#prop-terminal-voltage") as HTMLInputElement;
        const tType = (terminalTypeSelect?.value as TerminalType) || targetComp.terminalType || "signal";
        targetComp.terminalType = tType;

        const typedText = rawInput.trim();

        if (tType === "power") {
          if (terminalPowerStyleSelect) targetComp.terminalStyle = terminalPowerStyleSelect.value as any || "arrow";
          const volt = parseFloat(terminalVoltageInput?.value || "5") || 5;
          targetComp.voltage = volt;
          const defaultLabel = volt >= 0 ? `+${volt}V` : `${volt}V`;
          const rawVal = (typedText || targetComp.label || defaultLabel).toUpperCase();
          targetComp.value = rawVal;
          targetComp.label = rawVal;
        } else if (tType === "ground") {
          if (terminalGroundStyleSelect) targetComp.terminalStyle = terminalGroundStyleSelect.value as any || "standard";
          const rawVal = (typedText || targetComp.label || "GND").toUpperCase();
          targetComp.value = rawVal;
          targetComp.label = rawVal;
        } else if (tType === "generator") {
          const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
          const waveAmpInput = document.querySelector("#prop-wave-amp") as HTMLInputElement;
          const waveFreqInput = document.querySelector("#prop-wave-freq") as HTMLInputElement;
          const waveOffsetInput = document.querySelector("#prop-wave-offset") as HTMLInputElement;
          const waveDutyInput = document.querySelector("#prop-wave-duty") as HTMLInputElement;
          targetComp.waveType = waveTypeSelect ? waveTypeSelect.value : "square";
          targetComp.amplitude = waveAmpInput ? (parseFloat(waveAmpInput.value) || 5) : 5;
          targetComp.frequency = waveFreqInput ? (parseFloat(waveFreqInput.value) || 1000) : 1000;
          targetComp.offset = waveOffsetInput ? (parseFloat(waveOffsetInput.value) || 0) : 0;
          targetComp.dutyCycle = waveDutyInput ? (parseFloat(waveDutyInput.value) || 0.5) : 0.5;
          const rawVal = (typedText || targetComp.label || "CLK").toUpperCase();
          targetComp.value = rawVal;
          targetComp.label = rawVal;
        } else if (tType === "no_connect") {
          const rawVal = (typedText || targetComp.label || "NC").toUpperCase();
          targetComp.value = rawVal;
          targetComp.label = rawVal;
        } else if (tType === "output") {
          const rawVal = (typedText || targetComp.label || "OUT").toUpperCase();
          targetComp.value = rawVal;
          targetComp.label = rawVal;
        } else if (tType === "input") {
          const rawVal = (typedText || targetComp.label || "IN").toUpperCase();
          targetComp.value = rawVal;
          targetComp.label = rawVal;
        } else if (tType === "bidirectional") {
          const rawVal = (typedText || targetComp.label || "DATA").toUpperCase();
          targetComp.value = rawVal;
          targetComp.label = rawVal;
        } else if (tType === "bus_tap") {
          const rawVal = (typedText || targetComp.label || "BUS[7:0]").toUpperCase();
          targetComp.value = rawVal;
          targetComp.label = rawVal;
        } else if (tType === "test_point") {
          const rawVal = (typedText || targetComp.label || targetComp.id || "TP1").toUpperCase();
          targetComp.value = rawVal;
          targetComp.label = rawVal;
        } else {
          const rawVal = (typedText || targetComp.label || targetComp.id || "NET").toUpperCase();
          targetComp.value = rawVal || "NET";
          targetComp.label = targetComp.value as string;
        }
      }
    }

    const simulationRunner = this.callbacks.getSimulationRunner();
    if (simulationRunner && simulationRunner.isSimulationActive() && supportsLiveMutation(selected.type)) {
      const runner = simulationRunner;
      for (const targetComp of selectedList) {
        const mutations = buildLiveMutations(targetComp, newVal);
        for (const m of mutations) {
          void runner.mutateComponent(
            m.componentId,
            m.field as unknown as import("../simulation/simulation_runner").InteractiveMutationField,
            m.value,
          );
        }
      }
      if (!skipLogging) {
        this.callbacks.addLog(
          `Mutación en caliente emitida para [${selectedList.map(c => c.id).join(", ")}]`,
          "send",
        );
      }
    } else if ((simulationRunner?.isSimulationActive() ?? false) && !skipLogging) {
      this.callbacks.addLog(
        `Los cambios de [${selectedList.map(c => c.id).join(", ")}] se aplicarán en la próxima simulación.`,
        "system",
      );
    }

    this.callbacks.updateCanvasRendering();
    this.callbacks.markCurrentTabAsModified();
    this.callbacks.extractNetlist?.();
    for (const targetComp of selectedList) {
      this.callbacks.onComponentPropertiesApplied?.(targetComp);
    }
    if (!skipLogging) {
      this.callbacks.addLog(
        isBatch
          ? `Propiedades aplicadas por lote a ${selectedList.length} componente(s)`
          : `Propiedades aplicadas a [${selected.id}]: Valor = [${selected.value}]`,
        "system",
      );
    }
    return true;
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
    const terminalGroundGroup = document.querySelector("#terminal-ground-group") as HTMLElement;
    const terminalGroundStyleSelect = document.querySelector("#prop-terminal-ground-style") as HTMLSelectElement;
    const terminalPowerStyleGroup = document.querySelector("#terminal-power-style-group") as HTMLElement;
    const terminalPowerStyleSelect = document.querySelector("#prop-terminal-power-style") as HTMLSelectElement;
    const terminalPresetSelect = document.querySelector("#prop-terminal-preset") as HTMLSelectElement;
    const terminalVoltageInput = document.querySelector("#prop-terminal-voltage") as HTMLInputElement;
    const terminalPowerGroup = document.querySelector("#terminal-power-group") as HTMLElement;
    const terminalVoltageGroup = document.querySelector("#terminal-voltage-group") as HTMLElement;
    const waveContainer = document.querySelector("#wave-properties-container") as HTMLElement;

    if (terminalTypeSelect) {
      terminalTypeSelect.addEventListener("change", () => {
        const val = terminalTypeSelect.value;
        if (val === "power") {
          if (terminalPowerStyleGroup) terminalPowerStyleGroup.style.display = "flex";
          if (terminalPowerGroup) terminalPowerGroup.style.display = "flex";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "flex";
          if (terminalGroundGroup) terminalGroundGroup.style.display = "none";
          if (waveContainer) waveContainer.style.display = "none";
        } else if (val === "ground") {
          if (terminalGroundGroup) terminalGroundGroup.style.display = "flex";
          if (terminalPowerStyleGroup) terminalPowerStyleGroup.style.display = "none";
          if (terminalPowerGroup) terminalPowerGroup.style.display = "none";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "none";
          if (waveContainer) waveContainer.style.display = "none";
        } else if (val === "generator") {
          if (terminalGroundGroup) terminalGroundGroup.style.display = "none";
          if (terminalPowerStyleGroup) terminalPowerStyleGroup.style.display = "none";
          if (terminalPowerGroup) terminalPowerGroup.style.display = "none";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "none";
          if (waveContainer) {
            waveContainer.style.display = "flex";
            const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
            this.toggleWaveFieldsVisibility(waveTypeSelect ? waveTypeSelect.value : "square");
          }
        } else {
          if (terminalGroundGroup) terminalGroundGroup.style.display = "none";
          if (terminalPowerStyleGroup) terminalPowerStyleGroup.style.display = "none";
          if (terminalPowerGroup) terminalPowerGroup.style.display = "none";
          if (terminalVoltageGroup) terminalVoltageGroup.style.display = "none";
          if (waveContainer) waveContainer.style.display = "none";
        }
        this.applyCurrentProperties({ isLiveInput: true, skipLogging: true });
      });
    }

    if (terminalGroundStyleSelect) {
      terminalGroundStyleSelect.addEventListener("change", () => {
        const orchestrator = this.callbacks.getOrchestrator();
        if (orchestrator?.selectedComponent && orchestrator.selectedComponent.type === "net_label") {
          orchestrator.selectedComponent.terminalStyle = terminalGroundStyleSelect.value as any;
          this.callbacks.updateCanvasRendering();
          this.callbacks.markCurrentTabAsModified();
        }
      });
    }

    if (terminalPowerStyleSelect) {
      terminalPowerStyleSelect.addEventListener("change", () => {
        const orchestrator = this.callbacks.getOrchestrator();
        if (orchestrator?.selectedComponent && orchestrator.selectedComponent.type === "net_label") {
          orchestrator.selectedComponent.terminalStyle = terminalPowerStyleSelect.value as any;
          this.callbacks.updateCanvasRendering();
          this.callbacks.markCurrentTabAsModified();
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
            this.applyCurrentProperties({ isLiveInput: true, skipLogging: true });
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

    const capDielectricSelect = document.querySelector("#prop-capacitor-dielectric") as HTMLSelectElement;
    if (capDielectricSelect) {
      capDielectricSelect.addEventListener("change", () => {
        const orchestrator = this.callbacks.getOrchestrator();
        if (orchestrator?.selectedComponent && orchestrator.selectedComponent.type === "capacitor") {
          orchestrator.selectedComponent.dielectricType = capDielectricSelect.value as any;
          this.callbacks.updateCanvasRendering();
          this.callbacks.markCurrentTabAsModified();
        }
      });
    }

    if (this.propValInput && this.propValSlider) {
      this.propValSlider.addEventListener("input", (e) => {
        const val = (e.target as HTMLInputElement).value;
        if (this.propValInput) this.propValInput.value = val;
        const orchestrator = this.callbacks.getOrchestrator();
        if (orchestrator?.selectedComponent) {
          this.updateValueBadge(orchestrator.selectedComponent.type);
        }
        this.applyCurrentProperties({ isLiveInput: true, skipLogging: true });
      });

      this.propValInput.addEventListener("input", (e) => {
        const val = (e.target as HTMLInputElement).value;
        if (this.propValSlider) this.propValSlider.value = val;
        const orchestrator = this.callbacks.getOrchestrator();
        if (orchestrator?.selectedComponent) {
          this.updateValueBadge(orchestrator.selectedComponent.type);
        }
        this.applyCurrentProperties({ isLiveInput: true, skipLogging: true });
      });
    }

    // Auto-guardado reactivo en todos los inputs y selects del formulario
    const propertiesForm = document.querySelector<HTMLElement>("#properties-form");
    if (propertiesForm) {
      propertiesForm.addEventListener("input", (e) => {
        const target = e.target as HTMLElement;
        if (target && target.id === "prop-id-input") {
          return;
        }
        this.applyCurrentProperties({ isLiveInput: true, skipLogging: true });
      });

      propertiesForm.addEventListener("change", (e) => {
        const target = e.target as HTMLElement;
        if (target && target.id === "prop-id-input") {
          this.applyCurrentProperties({ isLiveInput: false });
          return;
        }
        this.applyCurrentProperties({ isLiveInput: true, skipLogging: true });
      });
    }

    if (this.propIdInput) {
      this.propIdInput.addEventListener("input", () => {
        this.updateIdBadge();
      });
      this.propIdInput.addEventListener("blur", () => {
        this.applyCurrentProperties({ isLiveInput: false });
      });
    }

    const btnSnapStandard = document.querySelector("#btn-snap-standard") as HTMLButtonElement;
    const snapSeriesSelect = document.querySelector("#prop-snap-series") as HTMLSelectElement | null;
    if (btnSnapStandard && this.propValInput) {
      btnSnapStandard.addEventListener("click", () => {
        const orchestrator = this.callbacks.getOrchestrator();
        if (!orchestrator?.selectedComponent) return;
        const parsed = parseSpiceValue(this.propValInput!.value);
        const currentVal = parsed.valid && parsed.value !== undefined ? parsed.value : (parseFloat(this.propValInput!.value) || 0);
        if (currentVal > 0) {
          const series = (snapSeriesSelect?.value as "E12" | "E24" | "E96") || "E24";
          const snapped = snapToStandardValue(currentVal, series);
          this.propValInput!.value = formatSpiceValue(snapped);
          if (this.propValSlider) this.propValSlider.value = snapped.toString();
          this.updateValueBadge(orchestrator.selectedComponent.type);
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
          this.callbacks.onComponentPropertiesApplied?.(selected);
        }
      });
    }

    if (this.propValInc && this.propValInput && this.propValSlider) {
      this.propValInc.addEventListener("click", () => {
        const activeOrchestrator = this.callbacks.getOrchestrator();
        if (!activeOrchestrator?.selectedComponent) return;
        const comp = activeOrchestrator.selectedComponent;
        const parsed = parseSpiceValue(this.propValInput!.value);
        let val = parsed.valid && parsed.value !== undefined ? parsed.value : (Number(comp.value) || 0);

        let step = 1;
        if (comp.type === "capacitor") {
          step = val > 0 ? Math.pow(10, Math.floor(Math.log10(val))) : 1e-9;
        } else if (comp.type === "inductor") {
          step = val > 0 ? Math.pow(10, Math.floor(Math.log10(val))) : 1e-6;
        } else if (comp.type === "resistor" || comp.type === "potentiometer") {
          step = val >= 1000 ? 1000 : (val >= 100 ? 100 : (val >= 10 ? 10 : 1));
        } else {
          step = val > 0 ? Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.abs(val))))) : 1;
        }

        val += step;
        this.propValInput!.value = formatSpiceValue(val);
        this.propValSlider!.value = val.toString();
        this.updateValueBadge(comp.type);
        this.btnApplyProperties?.click();
      });
    }

    if (this.propValDec && this.propValInput && this.propValSlider) {
      this.propValDec.addEventListener("click", () => {
        const activeOrchestrator = this.callbacks.getOrchestrator();
        if (!activeOrchestrator?.selectedComponent) return;
        const comp = activeOrchestrator.selectedComponent;
        const parsed = parseSpiceValue(this.propValInput!.value);
        let val = parsed.valid && parsed.value !== undefined ? parsed.value : (Number(comp.value) || 0);

        let step = 1;
        if (comp.type === "capacitor") {
          step = val > 0 ? Math.pow(10, Math.floor(Math.log10(val))) : 1e-9;
        } else if (comp.type === "inductor") {
          step = val > 0 ? Math.pow(10, Math.floor(Math.log10(val))) : 1e-6;
        } else if (comp.type === "resistor" || comp.type === "potentiometer") {
          step = val > 1000 ? 1000 : (val > 100 ? 100 : (val > 10 ? 10 : 1));
        } else {
          step = val > 0 ? Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.abs(val))))) : 1;
        }

        val = Math.max(0, val - step);
        this.propValInput!.value = formatSpiceValue(val);
        this.propValSlider!.value = val.toString();
        this.updateValueBadge(comp.type);
        this.btnApplyProperties?.click();
      });
    }

    const applyFromKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== "Enter") return;
      if (event.target instanceof HTMLTextAreaElement && !event.ctrlKey) return;
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      this.applyCurrentProperties({ isLiveInput: false });
      if (this.btnApplyProperties) {
        this.btnApplyProperties.classList.add("active");
        setTimeout(() => this.btnApplyProperties?.classList.remove("active"), 200);
      }
    };

    propertiesForm?.addEventListener("keydown", applyFromKeyboard);

    const btnCopySpice = document.querySelector("#btn-copy-spice-card") as HTMLButtonElement | null;
    if (btnCopySpice) {
      btnCopySpice.addEventListener("click", async () => {
        const text = document.querySelector("#prop-spice-card-text")?.textContent;
        if (text) {
          try {
            await navigator.clipboard.writeText(text);
            this.callbacks.addLog("Directiva SPICE copiada al portapapeles.", "system");
          } catch {
            this.callbacks.addLog(text, "system");
          }
        }
      });
    }

    if (this.btnApplyProperties) {
      this.btnApplyProperties.addEventListener("click", () => {
        this.applyCurrentProperties({ isLiveInput: false });
      });
    }

    this.clearPropertiesPanel();
  }
}
