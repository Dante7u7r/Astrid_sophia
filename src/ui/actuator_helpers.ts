import { ComponentInstance } from "../canvas_orchestrator";
import { TimeStepResult } from "./oscilloscope_panel";

export interface RelayActuatorModel {
  inductanceHenrys: number;
  coilResistanceOhms: number;
  pullInCurrentAmps: number;
  holdCurrentAmps: number;
  contactClosedResistanceOhms: number;
  contactOpenResistanceOhms: number;
  operateDelayMs: number;
  releaseDelayMs: number;
}

export interface LampActuatorModel {
  coldResistanceOhms: number;
  hotResistanceOhms: number;
  nominalVoltageVolts: number;
  nominalPowerWatts: number;
  heatRiseMs: number;
  coolFallMs: number;
}

export interface BuzzerActuatorModel {
  baseResistanceOhms: number;
  activeResistanceOhms: number;
  inactiveResistanceOhms: number;
  nominalVoltageVolts: number;
  activationVoltageVolts: number;
  resonantFrequencyHz: number;
  qualityFactor: number;
  responseRiseMs: number;
  responseFallMs: number;
}

export interface ActuatorStatePoint {
  glowLevel: number;
  relayClosed: boolean;
  buzzerLevel: number;
}

function parseEngineeringValue(raw: string, defaultValue: number): number {
  if (!raw) return defaultValue;
  const clean = raw.trim().replace(/,/g, ".").toLowerCase();
  const match = clean.match(/^([-+]?\d*\.?\d+(?:e[+-]?\d+)?)\s*([a-zµuΩ]*)/);
  if (!match) return defaultValue;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return defaultValue;
  const unit = match[2];
  const multipliers: Record<string, number> = {
    'p': 1e-12, 'pico': 1e-12,
    'n': 1e-9,  'nano': 1e-9,
    'u': 1e-6,  'micro': 1e-6,
    'µ': 1e-6,
    'm': 1e-3,  'milli': 1e-3,
    'k': 1e3,   'kilo': 1e3,
    'meg': 1e6, 'mega': 1e6,
    'g': 1e9,   'giga': 1e9
  };
  for (const prefix in multipliers) {
    if (unit.startsWith(prefix)) {
      return num * multipliers[prefix];
    }
  }
  return num;
}

function parseNamedParameters(raw: string): Map<string, string> {
  const params = new Map<string, string>();
  if (!raw) return params;
  const segments = raw.split(';').map(s => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const parts = seg.split('=');
    if (parts.length === 2) {
      params.set(parts[0].trim().toLowerCase(), parts[1].trim());
    } else {
      const match = seg.match(/^([A-Za-z0-9_-]+)\s*[:\s]\s*(.+)$/);
      if (match) {
        params.set(match[1].toLowerCase(), match[2].trim());
      }
    }
  }
  return params;
}

export function parseRelayActuatorModel(raw: string): RelayActuatorModel {
  const firstValStr = raw.split(';')[0] ?? "";
  const baseInductance = parseEngineeringValue(firstValStr, 0.08); // 80 mH por defecto
  const params = parseNamedParameters(raw);

  const coilResistance = parseEngineeringValue(params.get("rcoil") ?? params.get("coil") ?? params.get("r") ?? "", 120);
  const pullInCurrent = parseEngineeringValue(params.get("pull") ?? params.get("pullin") ?? params.get("ipull") ?? "", 0.03);
  const holdCurrent = parseEngineeringValue(params.get("hold") ?? params.get("ihold") ?? params.get("dropout") ?? "", 0.016);
  const contactClosedRes = parseEngineeringValue(params.get("ron") ?? params.get("contact") ?? params.get("closed") ?? "", 0.05);
  const contactOpenRes = parseEngineeringValue(params.get("roff") ?? params.get("open") ?? "", 1e8);
  const operateDelay = parseEngineeringValue(params.get("ton") ?? params.get("operate") ?? params.get("tdon") ?? "", 2.5);
  const releaseDelay = parseEngineeringValue(params.get("toff") ?? params.get("release") ?? params.get("tdoff") ?? "", 1.2);

  return {
    inductanceHenrys: baseInductance,
    coilResistanceOhms: coilResistance,
    pullInCurrentAmps: pullInCurrent,
    holdCurrentAmps: Math.min(holdCurrent, pullInCurrent),
    contactClosedResistanceOhms: contactClosedRes,
    contactOpenResistanceOhms: contactOpenRes,
    operateDelayMs: operateDelay,
    releaseDelayMs: releaseDelay
  };
}

export function parseLampActuatorModel(raw: string): LampActuatorModel {
  const firstValStr = raw.split(';')[0] ?? "";
  const baseResistance = parseEngineeringValue(firstValStr, 120);
  const params = parseNamedParameters(raw);

  const hotResistance = parseEngineeringValue(params.get("rhot") ?? params.get("hot") ?? params.get("r") ?? "", baseResistance);
  const coldResistance = parseEngineeringValue(params.get("rcold") ?? params.get("cold") ?? "", hotResistance * 0.22);
  const nominalVoltage = parseEngineeringValue(params.get("vnom") ?? params.get("v") ?? "", 5);
  const nominalPower = parseEngineeringValue(params.get("pnom") ?? params.get("p") ?? "", (nominalVoltage * nominalVoltage) / hotResistance);
  const heatRise = parseEngineeringValue(params.get("heat") ?? params.get("warm") ?? "", 90);
  const coolFall = parseEngineeringValue(params.get("cool") ?? params.get("cooldown") ?? "", 160);

  return {
    coldResistanceOhms: coldResistance,
    hotResistanceOhms: hotResistance,
    nominalVoltageVolts: nominalVoltage,
    nominalPowerWatts: nominalPower,
    heatRiseMs: heatRise,
    coolFallMs: coolFall
  };
}

export function parseBuzzerActuatorModel(raw: string): BuzzerActuatorModel {
  const firstValStr = raw.split(';')[0] ?? "";
  const baseResistance = parseEngineeringValue(firstValStr, 90);
  const params = parseNamedParameters(raw);

  const activeRes = parseEngineeringValue(params.get("ron") ?? params.get("active") ?? "", baseResistance * 0.72);
  const inactiveRes = parseEngineeringValue(params.get("roff") ?? params.get("idle") ?? "", baseResistance * 2.8);
  const nominalVoltage = parseEngineeringValue(params.get("vnom") ?? params.get("v") ?? "", 5);
  const activationVoltage = parseEngineeringValue(params.get("vstart") ?? params.get("start") ?? "", nominalVoltage * 0.22);
  const resonantFreq = parseEngineeringValue(params.get("tone") ?? params.get("f") ?? params.get("freq") ?? "", 2400);
  const qualityFactor = parseEngineeringValue(params.get("q") ?? params.get("res") ?? "", 1.8);
  const responseRise = parseEngineeringValue(params.get("ton") ?? params.get("rise") ?? "", 7);
  const responseFall = parseEngineeringValue(params.get("toff") ?? params.get("fall") ?? "", 18);

  return {
    baseResistanceOhms: baseResistance,
    activeResistanceOhms: activeRes,
    inactiveResistanceOhms: inactiveRes,
    nominalVoltageVolts: nominalVoltage,
    activationVoltageVolts: activationVoltage,
    resonantFrequencyHz: resonantFreq,
    qualityFactor: qualityFactor,
    responseRiseMs: responseRise,
    responseFallMs: responseFall
  };
}

export class ActuatorHistoryManager {
  public history = new Map<string, ActuatorStatePoint[]>();

  public clear() {
    this.history.clear();
  }

  public precompute(components: ComponentInstance[], results: TimeStepResult[], pinToNodeMap: Record<string, string>) {
    this.clear();
    if (!results || results.length === 0) return;

    for (const comp of components) {
      if (comp.type === 'lamp' || comp.type === 'relay' || comp.type === 'buzzer') {
        this.history.set(comp.id, []);
      }
    }

    const lampThermal = new Map<string, number>();
    const relayState = new Map<string, boolean>();
    const relayChargeTime = new Map<string, number>();
    const relayDischargeTime = new Map<string, number>();
    const buzzerLevelState = new Map<string, number>();

    for (const comp of components) {
      if (comp.type === 'lamp') lampThermal.set(comp.id, 0);
      if (comp.type === 'relay') {
        relayState.set(comp.id, false);
        relayChargeTime.set(comp.id, 0);
        relayDischargeTime.set(comp.id, 0);
      }
      if (comp.type === 'buzzer') buzzerLevelState.set(comp.id, 0);
    }

    for (let i = 0; i < results.length; i++) {
      const step = results[i];
      const prevStep = i > 0 ? results[i - 1] : null;
      const dtMs = prevStep ? Math.max((step.time - prevStep.time) * 1000, 0) : 0;

      for (const comp of components) {
        const hist = this.history.get(comp.id);
        if (!hist) continue;

        let glowLevel = 0;
        let relayClosed = false;
        let buzzerLevel = 0;

        if (comp.type === 'lamp') {
          const model = parseLampActuatorModel(comp.value?.toString() ?? "");
          const node0 = pinToNodeMap[`${comp.id}:0`] ?? "";
          const node1 = pinToNodeMap[`${comp.id}:1`] ?? "";
          const v0 = step.nodeVoltages[node0] ?? 0;
          const v1 = step.nodeVoltages[node1] ?? 0;
          const vDrop = Math.abs(v0 - v1);

          const currentThermal = lampThermal.get(comp.id) ?? 0;
          const currentR = model.coldResistanceOhms + (model.hotResistanceOhms - model.coldResistanceOhms) * currentThermal;
          const power = (vDrop * vDrop) / Math.max(currentR, 0.1);

          const targetThermal = Math.sqrt(Math.min(power / Math.max(model.nominalPowerWatts, 1e-3), 1.0));
          const tau = targetThermal >= currentThermal ? model.heatRiseMs : model.coolFallMs;
          const alpha = dtMs <= 0 ? 1 : 1 - Math.exp(-dtMs / Math.max(tau, 1.0));
          const nextThermal = currentThermal + (targetThermal - currentThermal) * alpha;

          lampThermal.set(comp.id, nextThermal);
          glowLevel = nextThermal;
        }
        else if (comp.type === 'relay') {
          const model = parseRelayActuatorModel(comp.value?.toString() ?? "");
          let coilCurrent = 0;
          const branchId = `${comp.id}__coil`;
          if (step.branchCurrents && step.branchCurrents[branchId] !== undefined) {
            coilCurrent = Math.abs(step.branchCurrents[branchId]);
          } else {
            const node0 = pinToNodeMap[`${comp.id}:0`] ?? "";
            const node1 = pinToNodeMap[`${comp.id}:1`] ?? "";
            const v0 = step.nodeVoltages[node0] ?? 0;
            const v1 = step.nodeVoltages[node1] ?? 0;
            const vDrop = Math.abs(v0 - v1);
            coilCurrent = vDrop / Math.max(model.coilResistanceOhms, 0.1);
          }

          let closed = relayState.get(comp.id) ?? false;
          let charge = relayChargeTime.get(comp.id) ?? 0;
          let discharge = relayDischargeTime.get(comp.id) ?? 0;

          if (!closed) {
            if (coilCurrent >= model.pullInCurrentAmps) {
              charge += dtMs;
            } else {
              charge = 0;
            }
            if (charge >= model.operateDelayMs) {
              closed = true;
              charge = 0;
              discharge = 0;
            }
          } else {
            if (coilCurrent <= model.holdCurrentAmps) {
              discharge += dtMs;
            } else {
              discharge = 0;
            }
            if (discharge >= model.releaseDelayMs) {
              closed = false;
              discharge = 0;
              charge = 0;
            }
          }

          relayState.set(comp.id, closed);
          relayChargeTime.set(comp.id, charge);
          relayDischargeTime.set(comp.id, discharge);
          relayClosed = closed;
        }
        else if (comp.type === 'buzzer') {
          const model = parseBuzzerActuatorModel(comp.value?.toString() ?? "");
          const node0 = pinToNodeMap[`${comp.id}:0`] ?? "";
          const node1 = pinToNodeMap[`${comp.id}:1`] ?? "";
          const v0 = step.nodeVoltages[node0] ?? 0;
          const v1 = step.nodeVoltages[node1] ?? 0;
          const vDrop = Math.abs(v0 - v1);

          const targetLevel = clamp01((vDrop - model.activationVoltageVolts) / Math.max(model.nominalVoltageVolts - model.activationVoltageVolts, 0.1));
          const currentLevel = buzzerLevelState.get(comp.id) ?? 0;
          const tau = targetLevel >= currentLevel ? model.responseRiseMs : model.responseFallMs;
          const alpha = dtMs <= 0 ? 1 : 1 - Math.exp(-dtMs / Math.max(tau, 1.0));
          const nextLevel = currentLevel + (targetLevel - currentLevel) * alpha;

          buzzerLevelState.set(comp.id, nextLevel);
          buzzerLevel = nextLevel;
        }

        hist.push({ glowLevel, relayClosed, buzzerLevel });
      }
    }
  }
}

function clamp01(val: number): number {
  return Math.max(0, Math.min(1, val));
}
