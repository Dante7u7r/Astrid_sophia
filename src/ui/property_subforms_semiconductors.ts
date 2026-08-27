import type { ComponentInstance } from "../canvas_orchestrator";
import { parseSpiceValue } from "../simulation/spice_value_parser";
import {
  COMMERCIAL_BJTS,
  COMMERCIAL_DIODES,
  COMMERCIAL_MOSFETS,
  COMMERCIAL_JFETS,
  COMMERCIAL_OPAMPS,
} from "../simulation/commercial_models_catalog";

export const SEMICONDUCTOR_TYPES: readonly ComponentInstance["type"][] = [
  "diode",
  "zener_diode",
  "schottky_diode",
  "led",
  "npn",
  "pnp",
  "nmos",
  "pmos",
  "njf",
  "pjf",
  "opamp",
  "opamp_ideal",
];

function createAdvancedInput(id: string, label: string, value: string | number): string {
  return `
    <div class="property-group" style="display: flex; flex-direction: column; gap: 2px;">
      <label class="property-label" style="font-size: 10px; color: #94A3B8;" for="${id}">${label}</label>
      <input id="${id}" class="prop-input" type="text" value="${value}" style="font-size: 11px; padding: 4px 6px; font-family: monospace;" />
    </div>
  `;
}

export function updateSemiconductorsSubform(comp: ComponentInstance): void {
  const semiContainer = document.querySelector("#semiconductor-properties-container") as HTMLElement | null;
  const semiModelSelect = document.querySelector("#prop-semi-model") as HTMLSelectElement | null;
  const semiDesc = document.querySelector("#prop-semi-desc") as HTMLElement | null;
  const advancedContainer = document.querySelector("#semi-advanced-fields") as HTMLElement | null;

  if (!semiContainer || !semiModelSelect || !semiDesc) return;

  const isSemiconductor = SEMICONDUCTOR_TYPES.includes(comp.type);
  if (!isSemiconductor) {
    semiContainer.style.display = "none";
    return;
  }

  semiContainer.style.display = "flex";
  semiModelSelect.innerHTML = `<option value="custom">-- Modelo Genérico / Personalizado --</option>`;

  let models: Record<string, { description: string }> = {};
  if (comp.type === "diode") {
    models = Object.fromEntries(
      Object.entries(COMMERCIAL_DIODES).filter(([k]) => !k.startsWith("LED_") && !k.startsWith("BZX") && !k.startsWith("1N47")),
    );
  } else if (comp.type === "zener_diode") {
    models = Object.fromEntries(
      Object.entries(COMMERCIAL_DIODES).filter(([k]) => k.startsWith("BZX") || k.startsWith("1N47")),
    );
  } else if (comp.type === "schottky_diode") {
    models = Object.fromEntries(
      Object.entries(COMMERCIAL_DIODES).filter(([k]) => k === "1N5819" || k === "1N5817" || k === "BAT54"),
    );
  } else if (comp.type === "led") {
    models = Object.fromEntries(
      Object.entries(COMMERCIAL_DIODES).filter(([k]) => k.startsWith("LED_")),
    );
  } else if (comp.type === "npn") {
    models = Object.fromEntries(Object.entries(COMMERCIAL_BJTS).filter(([, m]) => m.polarity === "npn"));
  } else if (comp.type === "pnp") {
    models = Object.fromEntries(Object.entries(COMMERCIAL_BJTS).filter(([, m]) => m.polarity === "pnp"));
  } else if (comp.type === "nmos") {
    models = Object.fromEntries(Object.entries(COMMERCIAL_MOSFETS).filter(([, m]) => m.polarity === "nmos"));
  } else if (comp.type === "pmos") {
    models = Object.fromEntries(Object.entries(COMMERCIAL_MOSFETS).filter(([, m]) => m.polarity === "pmos"));
  } else if (comp.type === "njf") {
    models = Object.fromEntries(Object.entries(COMMERCIAL_JFETS).filter(([, m]) => m.polarity === "njf"));
  } else if (comp.type === "pjf") {
    models = Object.fromEntries(Object.entries(COMMERCIAL_JFETS).filter(([, m]) => m.polarity === "pjf"));
  } else if (comp.type === "opamp" || comp.type === "opamp_ideal") {
    models = COMMERCIAL_OPAMPS;
  }

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

  // Grupo legado de tensión Zener en diodo simple
  const diodeBvGroup = document.querySelector("#group-diode-bv") as HTMLElement | null;
  const diodeBvInput = document.querySelector("#prop-diode-bv") as HTMLInputElement | null;
  if (diodeBvGroup && diodeBvInput) {
    diodeBvGroup.style.display = comp.type === "diode" || comp.type === "zener_diode" ? "flex" : "none";
    if (comp.type === "diode" || comp.type === "zener_diode") {
      diodeBvInput.value = (comp.diodeBv ?? (comp.type === "zener_diode" ? (Number(comp.value) || 5.1) : 0)).toString();
    }
  }

  // Poblar campos SPICE avanzados
  if (advancedContainer) {
    let fieldsHtml = "";
    if (comp.type === "npn" || comp.type === "pnp") {
      fieldsHtml += createAdvancedInput("prop-semi-bjt-is", "Is (A)", comp.bjtIs ?? 1.434e-14);
      fieldsHtml += createAdvancedInput("prop-semi-bjt-bf", "Beta (hFE)", comp.bjtBf ?? (Number(comp.value) || 200));
      fieldsHtml += createAdvancedInput("prop-semi-bjt-vaf", "Vaf (Early V)", comp.bjtVaf ?? 74.0);
      fieldsHtml += createAdvancedInput("prop-semi-bjt-rb", "Rb (Ω)", comp.bjtRb ?? 10.0);
      fieldsHtml += createAdvancedInput("prop-semi-bjt-rc", "Rc (Ω)", comp.bjtRc ?? 1.0);
      fieldsHtml += createAdvancedInput("prop-semi-bjt-cje", "Cje (F)", comp.bjtCje ?? 10e-12);
      fieldsHtml += createAdvancedInput("prop-semi-bjt-cjc", "Cjc (F)", comp.bjtCjc ?? 5e-12);
    } else if (comp.type === "nmos" || comp.type === "pmos") {
      fieldsHtml += createAdvancedInput("prop-semi-mos-vth", "Vth (V)", comp.mosVth ?? (Number(comp.value) || (comp.type === "nmos" ? 2.0 : -2.0)));
      fieldsHtml += createAdvancedInput("prop-semi-mos-ron", "RDS(on) (Ω)", comp.mosRon ?? 0.05);
      fieldsHtml += createAdvancedInput("prop-semi-mos-cgs", "Cgs (F)", comp.mosCgs ?? 100e-12);
      fieldsHtml += createAdvancedInput("prop-semi-mos-cgd", "Cgd (F)", comp.mosCgd ?? 20e-12);
    } else if (comp.type === "diode" || comp.type === "zener_diode" || comp.type === "schottky_diode" || comp.type === "led") {
      fieldsHtml += createAdvancedInput("prop-semi-dio-is", "Is (A)", comp.diodeIs ?? 2.5e-9);
      fieldsHtml += createAdvancedInput("prop-semi-dio-rs", "Rs (Ω)", comp.diodeRs ?? 0.5);
      fieldsHtml += createAdvancedInput("prop-semi-dio-n", "Idealidad (N)", comp.diodeN ?? 1.75);
      fieldsHtml += createAdvancedInput("prop-semi-dio-bv", "Bv / Vz (V)", comp.diodeBv ?? (comp.type === "zener_diode" ? (Number(comp.value) || 5.1) : 100));
      fieldsHtml += createAdvancedInput("prop-semi-dio-cjo", "Cj0 (F)", comp.diodeCjo ?? 4e-12);
      fieldsHtml += createAdvancedInput("prop-semi-dio-tt", "Tt (s)", comp.diodeTt ?? 5e-9);
    } else if (comp.type === "njf" || comp.type === "pjf") {
      fieldsHtml += createAdvancedInput("prop-semi-jfet-vto", "Vp / Vto (V)", comp.jfetVto ?? (Number(comp.value) || (comp.type === "njf" ? -2.5 : 2.5)));
      fieldsHtml += createAdvancedInput("prop-semi-jfet-beta", "Beta (A/V²)", comp.jfetBeta ?? 0.0012);
      fieldsHtml += createAdvancedInput("prop-semi-jfet-lambda", "Lambda (1/V)", comp.jfetLambda ?? 0.01);
      fieldsHtml += createAdvancedInput("prop-semi-jfet-cgs", "Cgs (F)", comp.jfetCgs ?? 4.5e-12);
      fieldsHtml += createAdvancedInput("prop-semi-jfet-cgd", "Cgd (F)", comp.jfetCgd ?? 1.5e-12);
    } else {
      fieldsHtml = `<span style="grid-column: 1 / -1; color: #94A3B8;">Modelo operacional estándar.</span>`;
    }
    advancedContainer.innerHTML = fieldsHtml;

    // Escuchar cambios en campos avanzados para conmutar a "custom"
    advancedContainer.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", () => {
        if (semiModelSelect.value !== "custom") {
          semiModelSelect.value = "custom";
          semiDesc.style.display = "none";
        }
      });
    });
  }

  // Configuración de Lógica Digital
  const logicContainer = document.querySelector("#logic-properties-container") as HTMLElement | null;
  const groupInputs = document.querySelector("#group-logic-inputs") as HTMLElement | null;
  const logicInputsSelect = document.querySelector("#prop-logic-inputs") as HTMLSelectElement | null;
  const logicFamilySelect = document.querySelector("#prop-logic-family") as HTMLSelectElement | null;
  const logicVohInput = document.querySelector("#prop-logic-voh") as HTMLInputElement | null;
  const logicVthInput = document.querySelector("#prop-logic-vth") as HTMLInputElement | null;
  const logicTpdInput = document.querySelector("#prop-logic-tpd") as HTMLInputElement | null;
  const logicSchmittCheck = document.querySelector("#prop-logic-schmitt") as HTMLInputElement | null;
  const logicOpenDrainCheck = document.querySelector("#prop-logic-opendrain") as HTMLInputElement | null;

  if (logicContainer && logicVohInput && logicVthInput) {
    const isLogicGate = ["and_gate", "or_gate", "not_gate", "nand_gate", "nor_gate", "xor_gate"].includes(comp.type);
    if (isLogicGate) {
      logicContainer.style.display = "flex";

      if (groupInputs && logicInputsSelect) {
        groupInputs.style.display = comp.type === "not_gate" ? "none" : "flex";
        logicInputsSelect.value = (comp.gateInputs ?? 2).toString();
      }

      if (logicFamilySelect) {
        logicFamilySelect.value = comp.logicFamily ?? "74hc";
        logicFamilySelect.onchange = () => {
          const fam = logicFamilySelect.value;
          if (fam === "74hc") {
            logicVohInput.value = "5.0";
            logicVthInput.value = "2.5";
            if (logicTpdInput) logicTpdInput.value = "8n";
          } else if (fam === "74ls") {
            logicVohInput.value = "5.0";
            logicVthInput.value = "1.4";
            if (logicTpdInput) logicTpdInput.value = "10n";
          } else if (fam === "cmos3v3") {
            logicVohInput.value = "3.3";
            logicVthInput.value = "1.65";
            if (logicTpdInput) logicTpdInput.value = "5n";
          } else if (fam === "lvcmos1v8") {
            logicVohInput.value = "1.8";
            logicVthInput.value = "0.9";
            if (logicTpdInput) logicTpdInput.value = "3n";
          } else if (fam === "cmos12v") {
            logicVohInput.value = "12.0";
            logicVthInput.value = "6.0";
            if (logicTpdInput) logicTpdInput.value = "50n";
          }
        };
      }

      logicVohInput.value = (comp.value !== undefined ? comp.value : 5.0).toString();
      logicVthInput.value = (comp.offset !== undefined ? comp.offset : 2.5).toString();

      if (logicTpdInput) {
        const tpdVal = comp.propagationDelay ?? 8e-9;
        logicTpdInput.value = tpdVal >= 1e-9 ? `${Math.round(tpdVal * 1e9)}n` : tpdVal.toString();
      }

      if (logicSchmittCheck) {
        logicSchmittCheck.checked = Boolean(comp.schmittTrigger);
      }
      if (logicOpenDrainCheck) {
        logicOpenDrainCheck.checked = Boolean(comp.openCollector);
      }
    } else {
      logicContainer.style.display = "none";
    }
  }
}

export function applySemiconductorsSubform(selected: ComponentInstance): void {
  if (SEMICONDUCTOR_TYPES.includes(selected.type)) {
    const semiModelSelect = document.querySelector("#prop-semi-model") as HTMLSelectElement | null;
    const modelKey = semiModelSelect?.value ?? "custom";

    if (modelKey !== "custom") {
      selected.modelName = modelKey;
      if (selected.type === "diode" || selected.type === "zener_diode" || selected.type === "schottky_diode" || selected.type === "led") {
        const dm = COMMERCIAL_DIODES[modelKey];
        if (dm) {
          selected.diodeIs = dm.is;
          selected.diodeRs = dm.rs;
          selected.diodeN = dm.n;
          selected.diodeCjo = dm.cjo;
          selected.diodeTt = dm.tt;
          if (dm.bv !== undefined) selected.diodeBv = dm.bv;
          selected.diodeIbv = dm.ibv;
          if (dm.forwardVoltage !== undefined) selected.forwardVoltage = dm.forwardVoltage;
          if (selected.type === "zener_diode" && dm.bv !== undefined) {
            selected.value = dm.bv;
          }
        }
      } else if (selected.type === "npn" || selected.type === "pnp") {
        const bm = COMMERCIAL_BJTS[modelKey];
        if (bm) {
          selected.bjtIs = bm.is;
          selected.bjtBf = bm.bf;
          selected.bjtVaf = bm.vaf;
          selected.bjtRb = bm.rb;
          selected.bjtRc = bm.rc;
          selected.bjtCje = bm.cje;
          selected.bjtCjc = bm.cjc;
          selected.value = bm.bf;
        }
      } else if (selected.type === "nmos" || selected.type === "pmos") {
        const mm = COMMERCIAL_MOSFETS[modelKey];
        if (mm) {
          selected.mosVth = mm.vth;
          selected.mosRon = mm.ron;
          selected.mosCgs = mm.cgs;
          selected.mosCgd = mm.cgd;
          selected.value = mm.vth;
        }
      } else if (selected.type === "njf" || selected.type === "pjf") {
        const jm = COMMERCIAL_JFETS[modelKey];
        if (jm) {
          selected.jfetVto = jm.vto;
          selected.jfetBeta = jm.beta;
          selected.jfetLambda = jm.lambda;
          selected.jfetCgs = jm.cgs;
          selected.jfetCgd = jm.cgd;
          selected.value = jm.vto;
        }
      } else if (selected.type === "opamp" || selected.type === "opamp_ideal") {
        const om = COMMERCIAL_OPAMPS[modelKey];
        if (om) {
          selected.openLoopGain = om.aol;
          selected.offsetVoltage = om.vos;
          selected.opampAol = om.aol;
          selected.opampGbw = om.gbwHz;
          selected.opampSr = om.slewRateVUs;
          selected.opampRin = om.rin;
          selected.opampRout = om.rout;
          selected.opampVos = om.vos;
          selected.opampIb = om.ib;
          selected.opampIos = om.ios;
          selected.opampIq = om.iq;
          selected.opampIsc = om.isc;
          selected.opampVdrop = om.vdrop;
          selected.opampCmrr = om.cmrr;
          selected.opampPsrr = om.psrr;
          selected.opampEn = om.en;
          selected.opampIn = om.in;
          selected.opampFc = om.fc;
        }
      }
    } else {
      delete selected.modelName;

      // Lectura de campos SPICE avanzados manuales
      const readAdvNum = (id: string): number | undefined => {
        const input = document.querySelector<HTMLInputElement>(`#${id}`);
        if (!input) return undefined;
        const p = parseSpiceValue(input.value);
        return p.valid && p.value !== undefined ? p.value : (Number.parseFloat(input.value) || undefined);
      };

      if (selected.type === "npn" || selected.type === "pnp") {
        selected.bjtIs = readAdvNum("prop-semi-bjt-is") ?? selected.bjtIs;
        selected.bjtBf = readAdvNum("prop-semi-bjt-bf") ?? selected.bjtBf;
        selected.bjtVaf = readAdvNum("prop-semi-bjt-vaf") ?? selected.bjtVaf;
        selected.bjtRb = readAdvNum("prop-semi-bjt-rb") ?? selected.bjtRb;
        selected.bjtRc = readAdvNum("prop-semi-bjt-rc") ?? selected.bjtRc;
        selected.bjtCje = readAdvNum("prop-semi-bjt-cje") ?? selected.bjtCje;
        selected.bjtCjc = readAdvNum("prop-semi-bjt-cjc") ?? selected.bjtCjc;
        if (selected.bjtBf !== undefined) selected.value = selected.bjtBf;
      } else if (selected.type === "nmos" || selected.type === "pmos") {
        selected.mosVth = readAdvNum("prop-semi-mos-vth") ?? selected.mosVth;
        selected.mosRon = readAdvNum("prop-semi-mos-ron") ?? selected.mosRon;
        selected.mosCgs = readAdvNum("prop-semi-mos-cgs") ?? selected.mosCgs;
        selected.mosCgd = readAdvNum("prop-semi-mos-cgd") ?? selected.mosCgd;
        if (selected.mosVth !== undefined) selected.value = selected.mosVth;
      } else if (selected.type === "diode" || selected.type === "zener_diode" || selected.type === "schottky_diode" || selected.type === "led") {
        selected.diodeIs = readAdvNum("prop-semi-dio-is") ?? selected.diodeIs;
        selected.diodeRs = readAdvNum("prop-semi-dio-rs") ?? selected.diodeRs;
        selected.diodeN = readAdvNum("prop-semi-dio-n") ?? selected.diodeN;
        selected.diodeBv = readAdvNum("prop-semi-dio-bv") ?? selected.diodeBv;
        selected.diodeCjo = readAdvNum("prop-semi-dio-cjo") ?? selected.diodeCjo;
        selected.diodeTt = readAdvNum("prop-semi-dio-tt") ?? selected.diodeTt;
        if (selected.type === "zener_diode" && selected.diodeBv !== undefined) {
          selected.value = selected.diodeBv;
        }
      } else if (selected.type === "njf" || selected.type === "pjf") {
        selected.jfetVto = readAdvNum("prop-semi-jfet-vto") ?? selected.jfetVto;
        selected.jfetBeta = readAdvNum("prop-semi-jfet-beta") ?? selected.jfetBeta;
        selected.jfetLambda = readAdvNum("prop-semi-jfet-lambda") ?? selected.jfetLambda;
        selected.jfetCgs = readAdvNum("prop-semi-jfet-cgs") ?? selected.jfetCgs;
        selected.jfetCgd = readAdvNum("prop-semi-jfet-cgd") ?? selected.jfetCgd;
        if (selected.jfetVto !== undefined) selected.value = selected.jfetVto;
      }
    }

    if (selected.type === "diode" || selected.type === "zener_diode") {
      const diodeBvInput = document.querySelector("#prop-diode-bv") as HTMLInputElement | null;
      if (diodeBvInput) {
        const parsed = parseSpiceValue(diodeBvInput.value);
        const bvVal = parsed.valid && parsed.value !== undefined ? parsed.value : (parseFloat(diodeBvInput.value) || 0);
        selected.diodeBv = bvVal > 0 ? bvVal : undefined;
      }
    }
  }

  if (["and_gate", "or_gate", "not_gate", "nand_gate", "nor_gate", "xor_gate"].includes(selected.type)) {
    const inputsSelect = document.querySelector("#prop-logic-inputs") as HTMLSelectElement | null;
    const familySelect = document.querySelector("#prop-logic-family") as HTMLSelectElement | null;
    const logicVohInput = document.querySelector("#prop-logic-voh") as HTMLInputElement | null;
    const logicVthInput = document.querySelector("#prop-logic-vth") as HTMLInputElement | null;
    const logicTpdInput = document.querySelector("#prop-logic-tpd") as HTMLInputElement | null;
    const logicSchmittCheck = document.querySelector("#prop-logic-schmitt") as HTMLInputElement | null;
    const logicOpenDrainCheck = document.querySelector("#prop-logic-opendrain") as HTMLInputElement | null;

    if (selected.type !== "not_gate" && inputsSelect) {
      selected.gateInputs = parseInt(inputsSelect.value, 10) || 2;
    } else if (selected.type === "not_gate") {
      selected.gateInputs = 1;
    }

    if (familySelect) {
      selected.logicFamily = familySelect.value as any;
    }

    if (logicVohInput) {
      const parsed = parseSpiceValue(logicVohInput.value);
      selected.value = parsed.valid && parsed.value !== undefined ? parsed.value : (parseFloat(logicVohInput.value) || 5.0);
    }
    if (logicVthInput) {
      const parsed = parseSpiceValue(logicVthInput.value);
      selected.offset = parsed.valid && parsed.value !== undefined ? parsed.value : (parseFloat(logicVthInput.value) || 2.5);
    }
    if (logicTpdInput) {
      const parsed = parseSpiceValue(logicTpdInput.value);
      selected.propagationDelay = parsed.valid && parsed.value !== undefined ? parsed.value : (parseFloat(logicTpdInput.value) || 8e-9);
    }
    if (logicSchmittCheck) {
      selected.schmittTrigger = logicSchmittCheck.checked;
    }
    if (logicOpenDrainCheck) {
      selected.openCollector = logicOpenDrainCheck.checked;
    }
  }
}

