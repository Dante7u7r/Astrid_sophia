import type { ComponentInstance } from "../canvas_orchestrator";
import {
  COMMERCIAL_BJTS,
  COMMERCIAL_DIODES,
  COMMERCIAL_MOSFETS,
  COMMERCIAL_JFETS,
  COMMERCIAL_OPAMPS,
} from "../simulation/commercial_models_catalog";

export function updateSemiconductorsSubform(comp: ComponentInstance): void {
  const semiContainer = document.querySelector("#semiconductor-properties-container") as HTMLElement | null;
  const semiModelSelect = document.querySelector("#prop-semi-model") as HTMLSelectElement | null;
  const semiDesc = document.querySelector("#prop-semi-desc") as HTMLElement | null;
  if (semiContainer && semiModelSelect && semiDesc) {
    const isSemiconductor = ["diode", "npn", "pnp", "nmos", "pmos", "njf", "pjf", "led", "opamp", "opamp_ideal"].includes(comp.type);
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
      else if (comp.type === "opamp" || comp.type === "opamp_ideal") models = COMMERCIAL_OPAMPS;

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

      const diodeBvGroup = document.querySelector("#group-diode-bv") as HTMLElement | null;
      const diodeBvInput = document.querySelector("#prop-diode-bv") as HTMLInputElement | null;
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

  const logicContainer = document.querySelector("#logic-properties-container") as HTMLElement | null;
  const logicVohSelect = document.querySelector("#prop-logic-voh") as HTMLSelectElement | null;
  const logicVthInput = document.querySelector("#prop-logic-vth") as HTMLInputElement | null;
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
}

export function applySemiconductorsSubform(selected: ComponentInstance): void {
  if (["diode", "npn", "pnp", "nmos", "pmos", "njf", "pjf", "led", "opamp", "opamp_ideal"].includes(selected.type)) {
    const semiModelSelect = document.querySelector("#prop-semi-model") as HTMLSelectElement | null;
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
      } else if (selected.type === "opamp" || selected.type === "opamp_ideal") {
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
      const diodeBvInput = document.querySelector("#prop-diode-bv") as HTMLInputElement | null;
      if (diodeBvInput) {
        const bvVal = parseFloat(diodeBvInput.value) || 0;
        selected.diodeBv = bvVal > 0 ? bvVal : undefined;
      }
    }
  }

  if (["and_gate", "or_gate", "not_gate", "nand_gate", "nor_gate", "xor_gate"].includes(selected.type)) {
    const logicVohSelect = document.querySelector("#prop-logic-voh") as HTMLSelectElement | null;
    const logicVthInput = document.querySelector("#prop-logic-vth") as HTMLInputElement | null;
    if (logicVohSelect) {
      selected.value = parseFloat(logicVohSelect.value) || 5.0;
    }
    if (logicVthInput) {
      selected.offset = parseFloat(logicVthInput.value) || 2.5;
    }
  }
}
