// ==========================================================================
// PASSIVE COMPONENT DESCRIPTORS — Resistencias, Capacitores, Bobinas, etc.
// ==========================================================================

import { DMM_INITIAL_DISPLAY, normalizeDmmMode } from "../../simulation/dmm";
import { drawCompactComponent } from "../../canvas/component_compact_renderer";
import { drawTransformer } from "../../canvas/component_discrete_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

const STANDARD_TWO_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: 0, label: "1" },
  { index: 1, x: 40, y: 0, label: "2" },
];

export const ResistorDefinition: ComponentDefinition = {
  type: "resistor",
  name: "Resistencia",
  category: "pasivos",
  prefix: "R",
  defaultProperties: { value: 1000 },
  halfExtents: { halfW: 40, halfH: 40 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }

    // Cálculo pedagógico de disipación térmica en tiempo real (P = V^2 / R)
    const v0 = options.voltageMap?.[`${comp.id}:0`] ?? 0;
    const v1 = options.voltageMap?.[`${comp.id}:1`] ?? 0;
    const vDiff = Math.abs(v0 - v1);
    const rVal = Math.max(Number(comp.value) || 1000, 1e-6);
    const power = (vDiff * vDiff) / rVal;
    const powerRating = Number(comp.powerRating) > 0 ? Number(comp.powerRating) : 0.25;
    const stress = power / powerRating;

    // 1. Resplandor / cuerpo térmico si hay calentamiento perceptible
    if (stress > 0.4) {
      ctx.save();
      if (stress > 3.0) {
        // Componente quemado / carbonizado por sobrecorriente severa
        ctx.fillStyle = "rgba(39, 39, 42, 0.92)";
        ctx.fillRect(-18, -10, 36, 20);
      } else if (stress > 1.0) {
        // Incandescencia al rojo vivo (Sobrecarga)
        const alpha = Math.min(0.85, 0.25 + (stress - 1.0) * 0.3);
        ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
        ctx.fillRect(-18, -9, 36, 18);
      } else {
        // Calentamiento moderado (Ámbar)
        const alpha = Math.min(0.4, (stress - 0.4) * 0.6);
        ctx.fillStyle = `rgba(245, 158, 11, ${alpha})`;
        ctx.fillRect(-18, -8, 36, 16);
      }
      ctx.restore();
    }

    const isIec = (options.symbolStandard ?? comp.symbolStandard) === "IEC";

    // 2. Trazo del cuerpo: IEC (Caja Rectangular Europea) vs IEEE (Zigzag Americano)
    ctx.beginPath();
    if (isIec) {
      ctx.rect(-18, -6, 36, 12);
    } else {
      ctx.moveTo(-20, 0);
      ctx.lineTo(-15, -8);
      ctx.lineTo(-5, 8);
      ctx.lineTo(5, -8);
      ctx.lineTo(15, 8);
      ctx.lineTo(20, 0);
    }

    if (stress > 3.0) {
      // Color quemado con alerta
      ctx.strokeStyle = "#71717A";
      ctx.stroke();

      ctx.save();
      ctx.fillStyle = "#EF4444";
      ctx.font = "bold 8px 'Inter', sans-serif";
      ctx.fillText("🔥 SOBREPOTENCIA", -36, -13);
      ctx.restore();
    } else if (stress > 1.0) {
      // Al rojo vivo
      ctx.strokeStyle = "#EF4444";
      ctx.stroke();
    } else if (stress > 0.4) {
      // Ámbar tibio
      ctx.strokeStyle = "#F59E0B";
      ctx.stroke();
    } else {
      ctx.stroke();
    }
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0];
    const v1 = pinVoltages[1];
    const rVal = Math.max(Number(comp.value) || 1000, 1e-6);
    const i = ((v0 ?? 0) - (v1 ?? 0)) / rVal;
    return {
      branchCurrents: { 0: i, 1: -i },
    };
  },
};

export const CapacitorDefinition: ComponentDefinition = {
  type: "capacitor",
  name: "Capacitor",
  category: "pasivos",
  prefix: "C",
  defaultProperties: { value: 0.000001 },
  halfExtents: { halfW: 40, halfH: 40 },
  getPins: (comp) => {
    const isPolarized = comp?.dielectricType === "electrolytic" || comp?.dielectricType === "tantalum" || Boolean((comp as any)?.polarized);
    if (isPolarized) {
      return [
        { index: 0, x: -40, y: 0, label: "+", name: "Positivo (+)" },
        { index: 1, x: 40, y: 0, label: "-", name: "Negativo (-)" },
      ];
    }
    return [
      { index: 0, x: -40, y: 0, label: "1", name: "Terminal 1" },
      { index: 1, x: 40, y: 0, label: "2", name: "Terminal 2" },
    ];
  },
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }

    const isPolarized = comp.dielectricType === "electrolytic" || comp.dielectricType === "tantalum" || Boolean((comp as any)?.polarized);

    // Conectores internos desde los extremos (-20 y +20) hasta las placas
    ctx.moveTo(-20, 0);
    ctx.lineTo(-6, 0);

    // Placa izquierda (Pin 0 / Positivo en polarizados)
    ctx.moveTo(-6, -14);
    ctx.lineTo(-6, 14);

    if (isPolarized) {
      // Placa derecha (Pin 1 / Negativo): Placa curva cóncava clásica de capacitor electrolítico (ANSI / IEC)
      ctx.moveTo(8, -14);
      ctx.quadraticCurveTo(4, 0, 8, 14);

      // Lead derecho desde el centro de la placa curva al terminal
      ctx.moveTo(5, 0);
      ctx.lineTo(20, 0);
    } else {
      // Placa derecha plana (Cerámico, Film, etc.)
      ctx.moveTo(6, -14);
      ctx.lineTo(6, 14);
      ctx.moveTo(6, 0);
      ctx.lineTo(20, 0);
    }
    ctx.stroke();

    if (isPolarized) {
      // Indicadores estáticos '+' y '-' claros y nítidos grabados en la simbología
      ctx.save();
      ctx.fillStyle = state.color || "#38BDF8";
      ctx.font = "bold 10px 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("+", -14, -9);
      ctx.fillText("-", 14, -9);
      ctx.restore();
    }

    const v0 = options.voltageMap?.[`${comp.id}:0`] ?? 0;
    const v1 = options.voltageMap?.[`${comp.id}:1`] ?? 0;
    const vDiff = v0 - v1;
    const absV = Math.abs(vDiff);
    if (options.showReactiveFields !== false && absV > 0.05) {
      const intensity = Math.min(1.0, absV / 10.0);
      ctx.save();
      ctx.fillStyle = vDiff > 0
        ? `rgba(14, 165, 233, ${0.15 + intensity * 0.35})`
        : `rgba(168, 85, 247, ${0.15 + intensity * 0.35})`;
      ctx.fillRect(-5, -13, 10, 26);

      if (!isPolarized) {
        // Polaridad dinámica (+) en la placa de mayor potencial para cerámicos
        ctx.fillStyle = vDiff > 0 ? "#38BDF8" : "#C084FC";
        ctx.font = "bold 8px 'Inter', sans-serif";
        if (vDiff > 0) {
          ctx.fillText("+", -13, -7);
        } else {
          ctx.fillText("+", 8, -7);
        }
      }
      ctx.restore();
    }

    // Alertas y efectos de Sobretensión / Ruptura de Dieléctrico / Polaridad Inversa
    const voltageRating = Number(comp.voltageRating) > 0 ? Number(comp.voltageRating) : 25;
    const isReversePolarity = isPolarized && vDiff < -0.3;
    const isOvervoltage = absV > voltageRating;

    if (isReversePolarity || isOvervoltage) {
      ctx.save();
      if (isReversePolarity) {
        ctx.fillStyle = "#EF4444";
        ctx.font = "bold 8px 'Inter', sans-serif";
        ctx.fillText("💥 POLARIDAD INV", -38, -16);
      } else {
        const ratio = absV / voltageRating;
        ctx.fillStyle = ratio > 1.5 ? "#EF4444" : "#F59E0B";
        ctx.font = "bold 8px 'Inter', sans-serif";
        ctx.fillText(ratio > 1.5 ? "⚡ RUPTURA DIELECTRICA" : "⚡ SOBRETENSIÓN", -42, -16);
      }
      ctx.restore();
    }
  },
};

export const InductorDefinition: ComponentDefinition = {
  type: "inductor",
  name: "Inductor",
  category: "pasivos",
  prefix: "L",
  defaultProperties: { value: 0.001 },
  halfExtents: { halfW: 40, halfH: 40 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    ctx.moveTo(-20, 0);
    for (let i = 0; i < 4; i++) {
      const startX = -20 + i * 10;
      ctx.arc(startX + 5, 0, 5, Math.PI, 0, false);
    }
    ctx.stroke();

    const iBranch = Math.abs(
      options.branchCurrents?.[`${comp.id}:I`] ??
      options.branchCurrents?.[`${comp.id}:0`] ??
      0,
    );
    if (options.showReactiveFields !== false && iBranch > 0.0001) {
      const intensity = Math.min(1.0, Math.sqrt(iBranch / 0.1));
      ctx.save();
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.25 + intensity * 0.45})`;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-20, 0);
      for (let i = 0; i < 4; i++) {
        const startX = -20 + i * 10;
        ctx.arc(startX + 5, 0, 5, Math.PI, 0, false);
      }
      ctx.stroke();
      ctx.restore();
    }
  },
};

export const PotentiometerDefinition: ComponentDefinition = {
  type: "potentiometer",
  name: "Potenciómetro",
  category: "pasivos",
  prefix: "RV",
  defaultProperties: { value: 10000, wiperPosition: 0.5 },
  halfExtents: { halfW: 40, halfH: 40 },
  getPins: () => [
    { index: 0, x: -40, y: 0, label: "A", name: "Terminal Extremo A" },
    { index: 1, x: 0, y: 40, label: "W", name: "Cursor / Wiper (W)" },
    { index: 2, x: 40, y: 0, label: "B", name: "Terminal Extremo B" },
  ],
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    const isIec = (options.symbolStandard ?? comp.symbolStandard) === "IEC";
    ctx.beginPath();
    if (isIec) {
      ctx.rect(-18, -6, 36, 12);
    } else {
      ctx.moveTo(-20, 0);
      ctx.lineTo(-15, -8);
      ctx.lineTo(-5, 8);
      ctx.lineTo(5, -8);
      ctx.lineTo(15, 8);
      ctx.lineTo(20, 0);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, 40);
    ctx.lineTo(0, isIec ? 10 : 16);
    ctx.lineTo(-4, isIec ? 14 : 20);
    ctx.moveTo(0, isIec ? 10 : 16);
    ctx.lineTo(4, isIec ? 14 : 20);
    ctx.stroke();

    const wiper = Math.max(0.01, Math.min(0.99, comp.wiperPosition ?? 0.5));
    const wiperPercent = Math.round(wiper * 100);
    ctx.save();
    ctx.font = "bold 9px 'Inter', sans-serif";
    ctx.fillStyle = "#38BDF8";
    ctx.textAlign = "center";
    ctx.fillText(`${wiperPercent}%`, 0, -14);
    ctx.restore();
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vA = pinVoltages[0] ?? 0;
    const vW = pinVoltages[1] ?? 0;
    const vB = pinVoltages[2] ?? 0;
    const rTotal = Math.max(Number(comp.value) || 10000, 1e-6);
    const wiper = Math.max(0.001, Math.min(0.999, comp.wiperPosition ?? 0.5));
    const r1 = Math.max(rTotal * wiper, 1e-6);
    const r2 = Math.max(rTotal * (1 - wiper), 1e-6);
    const iA = (vA - vW) / r1;
    const iB = (vB - vW) / r2;
    return {
      branchCurrents: { 0: iA, 1: -(iA + iB), 2: iB },
    };
  },
};

export const LdrDefinition: ComponentDefinition = {
  type: "ldr",
  name: "Fotorresistencia (LDR)",
  category: "pasivos",
  prefix: "LDR",
  defaultProperties: { value: 100, lux: 100 },
  halfExtents: { halfW: 40, halfH: 40 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    const isIec = (options.symbolStandard ?? comp.symbolStandard) === "IEC";
    ctx.beginPath();
    if (isIec) {
      ctx.rect(-18, -6, 36, 12);
    } else {
      ctx.moveTo(-20, 0);
      ctx.lineTo(-15, -8);
      ctx.lineTo(-5, 8);
      ctx.lineTo(5, -8);
      ctx.lineTo(15, 8);
      ctx.lineTo(20, 0);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-18, -26);
    ctx.lineTo(-8, -16);
    ctx.moveTo(-8, -16);
    ctx.lineTo(-13, -16);
    ctx.moveTo(-8, -16);
    ctx.lineTo(-8, -21);

    ctx.moveTo(-12, -32);
    ctx.lineTo(-2, -22);
    ctx.moveTo(-2, -22);
    ctx.lineTo(-7, -22);
    ctx.moveTo(-2, -22);
    ctx.lineTo(-2, -27);
    ctx.stroke();

    const luxVal = Math.round(comp.lux ?? 100);
    ctx.save();
    ctx.font = "bold 9px 'Inter', sans-serif";
    ctx.fillStyle = "#F59E0B";
    ctx.textAlign = "center";
    ctx.fillText(`${luxVal} lx`, 0, -28);
    ctx.restore();
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const lux = Math.max(comp.lux ?? 100, 0.1);
    const rLdr = Math.max(500000 / Math.pow(lux, 0.7), 10);
    const i = (v0 - v1) / rLdr;
    return { branchCurrents: { 0: i, 1: -i } };
  },
};

export const ThermistorDefinition: ComponentDefinition = {
  type: "thermistor",
  name: "Termistor NTC",
  category: "pasivos",
  prefix: "RT",
  defaultProperties: { value: 25, temperatureCelsius: 25 },
  halfExtents: { halfW: 40, halfH: 40 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    ctx.moveTo(-20, 0);
    ctx.lineTo(-15, -8);
    ctx.lineTo(-10, 8);
    ctx.lineTo(-5, -8);
    ctx.lineTo(0, 8);
    ctx.lineTo(5, -8);
    ctx.lineTo(10, 8);
    ctx.lineTo(15, -8);
    ctx.lineTo(20, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-26, 12);
    ctx.lineTo(-22, 12);
    ctx.lineTo(22, -12);
    ctx.stroke();

    const tempC = Math.round(comp.temperatureCelsius ?? 25);
    const tempColor = tempC > 50 ? "#EF4444" : (tempC < 15 ? "#38BDF8" : "#F59E0B");

    ctx.save();
    ctx.fillStyle = tempColor;
    ctx.font = "bold 9px 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${tempC}°C`, 0, -14);
    ctx.restore();
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const tempC = comp.temperatureCelsius ?? 25;
    const tempK = tempC + 273.15;
    const r0 = 10000;
    const beta = 3950;
    const t0 = 298.15;
    const rNtc = Math.max(r0 * Math.exp(beta * (1 / tempK - 1 / t0)), 1);
    const i = (v0 - v1) / rNtc;
    return { branchCurrents: { 0: i, 1: -i } };
  },
};

export const GroundDefinition: ComponentDefinition = {
  type: "ground",
  name: "Tierra (GND / 0V)",
  category: "pasivos",
  prefix: "GND",
  defaultProperties: { value: 0 },
  halfExtents: { halfW: 40, halfH: 40 },
  hasStandardLeads: false,
  hasValueLabel: false,
  isGroundReference: true,
  getPins: () => [{ index: 0, x: 0, y: -20, label: "GND" }],
  render: (ctx) => {
    ctx.moveTo(-14, 0);
    ctx.lineTo(14, 0);
    ctx.moveTo(-9, 5);
    ctx.lineTo(9, 5);
    ctx.moveTo(-4, 10);
    ctx.lineTo(4, 10);
    ctx.stroke();
  },
};

export const TransformerDefinition: ComponentDefinition = {
  type: "transformer",
  name: "Transformador",
  category: "pasivos",
  prefix: "T",
  defaultProperties: { value: 0.001 },
  halfExtents: { halfW: 45, halfH: 25 },
  getPins: () => [
    { index: 0, x: -40, y: -20, label: "P1", name: "Primario 1 (Fase •)" },
    { index: 1, x: -40, y: 20, label: "P2", name: "Primario 2" },
    { index: 2, x: 40, y: -20, label: "S1", name: "Secundario 1 (Fase •)" },
    { index: 3, x: 40, y: 20, label: "S2", name: "Secundario 2" },
  ],
  render: (ctx, _comp, state) => {
    drawTransformer(ctx, state.color);
  },
};

export const DmmDefinition: ComponentDefinition = {
  type: "dmm",
  name: "Multímetro Digital (DMM)",
  category: "pasivos",
  prefix: "DMM",
  defaultProperties: { value: "V", dmmValue: DMM_INITIAL_DISPLAY },
  halfExtents: { halfW: 30, halfH: 40 },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: () => [
    { index: 0, x: -30, y: 0, label: "+", name: "Terminal Positivo (V·Ω·mA)" },
    { index: 1, x: 30, y: 0, label: "-", name: "Terminal Común (COM)" },
  ],
  render: (ctx, comp, state) => {
    const rawMode = typeof comp.value === "string" ? comp.value : "V";
    const mode = normalizeDmmMode(rawMode);
    const displayText = comp.dmmValue || DMM_INITIAL_DISPLAY;
    const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";

    ctx.fillStyle = isClassroom ? "#FFFFFF" : "rgba(10, 14, 22, 0.95)";
    ctx.strokeStyle = state.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(-24, -30, 48, 60);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isClassroom ? "#F1F5F9" : "rgba(0, 0, 0, 0.85)";
    ctx.fillRect(-20, -25, 40, 20);
    ctx.strokeStyle = isClassroom ? "#CBD5E1" : "#334155";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-20, -25, 40, 20);

    ctx.font = "bold 9px monospace";
    ctx.fillStyle = isClassroom ? "#0284C7" : "#38BDF8";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(displayText, 0, -15);

    ctx.font = "bold 8px sans-serif";
    ctx.fillStyle = isClassroom ? "#475569" : "#94A3B8";
    ctx.fillText(`DMM [${mode}]`, 0, 5);
  },
};

export const FuseDefinition: ComponentDefinition = {
  type: "fuse",
  name: "Fusible de Protección",
  category: "pasivos",
  prefix: "F",
  defaultProperties: { value: 1.0 },
  halfExtents: { halfW: 40, halfH: 20 },
  hasStandardLeads: true,
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }

    const iBranch = Math.abs(
      options.branchCurrents?.[`${comp.id}:I`] ??
      options.branchCurrents?.[`${comp.id}:0`] ??
      0,
    );
    const iRating = Math.max(Number(comp.value) || 1.0, 1e-4);
    const isBlown = comp.isBlown || (iBranch > iRating * 1.25);
    if (isBlown) {
      comp.isBlown = true;
    }

    const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";

    // 1. Cuerpo cilíndrico de vidrio
    ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.7)" : "rgba(15, 23, 42, 0.85)";
    ctx.strokeStyle = state.color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.rect(-20, -9, 40, 18);
    ctx.fill();
    ctx.stroke();

    // 2. Tapas metálicas de extremo
    ctx.fillStyle = isClassroom ? "#CBD5E1" : "#94A3B8";
    ctx.fillRect(-20, -9, 6, 18);
    ctx.fillRect(14, -9, 6, 18);

    // 3. Filamento interno
    ctx.beginPath();
    if (isBlown) {
      // Filamento fundido / roto
      ctx.moveTo(-14, 0);
      ctx.lineTo(-4, -4);
      ctx.moveTo(4, 4);
      ctx.lineTo(14, 0);
      ctx.strokeStyle = "#EF4444";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.save();
      ctx.fillStyle = "#EF4444";
      ctx.font = "bold 8px 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🔥 FUNDIDO", 0, -13);
      ctx.restore();
    } else {
      // Filamento intacto en S
      ctx.moveTo(-14, 0);
      ctx.quadraticCurveTo(-4, -6, 0, 0);
      ctx.quadraticCurveTo(4, 6, 14, 0);
      const stress = iBranch / iRating;
      ctx.strokeStyle = stress > 0.8 ? "#F59E0B" : (isClassroom ? "#475569" : "#E2E8F0");
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const rVal = comp.isBlown ? 1e9 : 0.01;
    const i = (v0 - v1) / rVal;
    return {
      branchCurrents: { 0: i, 1: -i },
    };
  },
};

