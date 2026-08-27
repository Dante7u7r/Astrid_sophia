/**
 * CurveTracerModel — Modelado Físico y Trazador Paramétrico de Semiconductores y Pasivos
 *
 * Simula familias de curvas I-V (Salida, Transferencia, 2/4 cuadrantes) para:
 * Diodos PN, Diodos Schottky, Zener, LEDs, BJTs NPN/PNP, MOSFETs N/P, JFETs N/P y Resistencias.
 * Extrae parámetros analíticos: Vf, Vz, Rd, hFE, hfe, Vaf, Vth, gm, Rds(on), Idss, Vp.
 */

export type DeviceCategory = "diode" | "bjt" | "mosfet" | "jfet" | "resistor";

export type TraceMode = "output" | "transfer" | "bipolar";

export interface CurvePoint {
  v: number; // Tensión en Voltios
  i: number; // Corriente en Amperios
}

export interface CurveTrace {
  stepValue: number; // Valor del parámetro de paso (Ib en A, Vgs en V, etc.)
  stepLabel: string; // Ej: "Ib = 20 µA", "Vgs = 3.5 V"
  color: string;     // Color cromático de la curva
  points: CurvePoint[];
}

export interface DeviceExtractedParams {
  // Diodo
  vf1mA?: number;       // Tensión forward a 1 mA (V)
  vf10mA?: number;      // Tensión forward a 10 mA (V)
  dynamicRes?: number;  // Resistencia dinámica dV/dI (Ω)
  zenerVoltage?: number;// Tensión de ruptura Zener (V)
  
  // BJT
  hFE_DC?: number;      // Ganancia de corriente continua Ic / Ib
  hfe_AC?: number;      // Ganancia de señal pequeña dIc / dIb
  vceSat?: number;      // Tensión de saturación Vce(sat) (V)
  earlyVoltage?: number;// Tensión Early Vaf (V)

  // MOSFET / JFET
  vth?: number;         // Tensión umbral / pinch-off Vth o Vp (V)
  gm?: number;          // Transconductancia dId / dVgs (mS o A/V)
  rdsOn?: number;       // Resistencia de canal Rds(on) en zona óhmica (Ω)
  idss?: number;        // Corriente de saturación con Vgs=0 (A)

  // Resistencia
  resistance?: number;  // Resistencia medida R (Ω)
}

export interface TraceResult {
  deviceName: string;
  category: DeviceCategory;
  mode: TraceMode;
  traces: CurveTrace[];
  params: DeviceExtractedParams;
  vMin: number;
  vMax: number;
  iMin: number;
  iMax: number;
  xLabel: string; // Ej: "Vd (V)", "Vce (V)", "Vds (V)"
  yLabel: string; // Ej: "Id (mA)", "Ic (mA)"
}

export interface DevicePreset {
  id: string;
  name: string;
  category: DeviceCategory;
  description: string;
  params: Record<string, number>;
}

export const DEVICE_PRESETS: DevicePreset[] = [
  // Diodos
  {
    id: "1N4148",
    name: "1N4148 (Fast Switching)",
    category: "diode",
    description: "Diodo de conmutación rápida de silicio (Vf ~ 0.7V, Is ~ 2.5nA)",
    params: { is: 2.5e-9, n: 1.75, rs: 0.5, vz: 100, isz: 1e-12 },
  },
  {
    id: "1N4007",
    name: "1N4007 (Rectificador 1A)",
    category: "diode",
    description: "Diodo rectificador de potencia estándar (Vf ~ 0.7V, Is ~ 7e-9A)",
    params: { is: 7.06e-9, n: 1.9, rs: 0.04, vz: 1000, isz: 1e-12 },
  },
  {
    id: "1N5819",
    name: "1N5819 (Schottky 1A)",
    category: "diode",
    description: "Diodo Schottky de baja caída (Vf ~ 0.35V @ 10mA)",
    params: { is: 3.17e-7, n: 1.05, rs: 0.05, vz: 40, isz: 1e-10 },
  },
  {
    id: "1N4733A",
    name: "1N4733A (Zener 5.1V)",
    category: "diode",
    description: "Diodo regulador Zener de 5.1V / 1W",
    params: { is: 1e-11, n: 1.2, rs: 0.2, vz: 5.1, isz: 1e-3, vtz: 0.05 },
  },
  {
    id: "1N4739A",
    name: "1N4739A (Zener 9.1V)",
    category: "diode",
    description: "Diodo regulador Zener de 9.1V / 1W",
    params: { is: 1e-11, n: 1.2, rs: 0.2, vz: 9.1, isz: 1e-3, vtz: 0.05 },
  },
  {
    id: "LED_RED",
    name: "LED Rojo (1.8V)",
    category: "diode",
    description: "Diodo Emisor de Luz Rojo Estándar GaAsP (Vf ~ 1.8V)",
    params: { is: 1e-18, n: 2.1, rs: 2.5, vz: 5.0, isz: 1e-12 },
  },
  {
    id: "LED_GREEN",
    name: "LED Verde (2.2V)",
    category: "diode",
    description: "Diodo Emisor de Luz Verde GaP (Vf ~ 2.2V)",
    params: { is: 1e-20, n: 2.3, rs: 3.0, vz: 5.0, isz: 1e-12 },
  },
  {
    id: "LED_BLUE",
    name: "LED Azul (3.2V)",
    category: "diode",
    description: "Diodo Emisor de Luz Azul InGaN (Vf ~ 3.2V)",
    params: { is: 1e-24, n: 2.8, rs: 5.0, vz: 5.0, isz: 1e-12 },
  },

  // Transistores BJT
  {
    id: "2N2222A",
    name: "2N2222A (BJT NPN)",
    category: "bjt",
    description: "Transistor NPN de propósito general y conmutación rápida (hFE ~ 200)",
    params: { beta: 200, vaf: 100, is: 1.4e-14, vceSatKnee: 0.3, isPnp: 0 },
  },
  {
    id: "BC547B",
    name: "BC547B (BJT NPN Audio)",
    category: "bjt",
    description: "Transistor NPN de bajo ruido y alta ganancia (hFE ~ 300)",
    params: { beta: 300, vaf: 120, is: 1.8e-14, vceSatKnee: 0.25, isPnp: 0 },
  },
  {
    id: "2N3904",
    name: "2N3904 (BJT NPN General)",
    category: "bjt",
    description: "Transistor NPN estándar para pequeña señal (hFE ~ 150)",
    params: { beta: 150, vaf: 74, is: 6.7e-15, vceSatKnee: 0.25, isPnp: 0 },
  },
  {
    id: "2N3906",
    name: "2N3906 (BJT PNP General)",
    category: "bjt",
    description: "Transistor PNP complementario al 2N3904 (hFE ~ 150)",
    params: { beta: 150, vaf: 74, is: 6.7e-15, vceSatKnee: 0.25, isPnp: 1 },
  },
  {
    id: "TIP31C",
    name: "TIP31C (BJT NPN Potencia)",
    category: "bjt",
    description: "Transistor de potencia NPN 100V / 3A (hFE ~ 50)",
    params: { beta: 50, vaf: 80, is: 1e-12, vceSatKnee: 0.5, isPnp: 0 },
  },

  // Transistores MOSFET
  {
    id: "2N7000",
    name: "2N7000 (NMOS Small Signal)",
    category: "mosfet",
    description: "MOSFET canal N de pequeña señal (Vth ~ 2.1V, Rds(on) ~ 3Ω)",
    params: { vth: 2.1, kp: 0.05, lambda: 0.015, isPmos: 0 },
  },
  {
    id: "IRF540N",
    name: "IRF540N (NMOS Potencia)",
    category: "mosfet",
    description: "MOSFET de potencia 100V / 33A HEXFET (Vth ~ 3.0V, Rds(on) ~ 44mΩ)",
    params: { vth: 3.0, kp: 1.5, lambda: 0.005, isPmos: 0 },
  },
  {
    id: "IRF9540N",
    name: "IRF9540N (PMOS Potencia)",
    category: "mosfet",
    description: "MOSFET de potencia canal P -100V / -23A (Vth ~ -3.2V)",
    params: { vth: -3.2, kp: 1.2, lambda: 0.006, isPmos: 1 },
  },

  // Transistores JFET
  {
    id: "2N3819",
    name: "2N3819 (NJFET General)",
    category: "jfet",
    description: "JFET canal N para aplicaciones de audio y RF (Vp ~ -3.0V, Idss ~ 10mA)",
    params: { vp: -3.0, idss: 0.01, lambda: 0.01, isPjfet: 0 },
  },
  {
    id: "J201",
    name: "J201 (NJFET Audio)",
    category: "jfet",
    description: "JFET canal N de alta impedancia para preamplificadores (Vp ~ -1.0V, Idss ~ 1mA)",
    params: { vp: -1.0, idss: 0.001, lambda: 0.02, isPjfet: 0 },
  },

  // Pasivos
  {
    id: "RES_1K",
    name: "Resistor 1.0 kΩ",
    category: "resistor",
    description: "Resistor lineal óhmico de 1 kΩ (I = V / R)",
    params: { r: 1000 },
  },
  {
    id: "RES_100",
    name: "Resistor 100 Ω",
    category: "resistor",
    description: "Resistor lineal óhmico de 100 Ω",
    params: { r: 100 },
  },
  {
    id: "RES_10K",
    name: "Resistor 10 kΩ",
    category: "resistor",
    description: "Resistor lineal óhmico de 10 kΩ",
    params: { r: 10000 },
  },
];

const TRACE_COLORS = [
  "#38bdf8", // Cian
  "#a855f7", // Púrpura
  "#22c55e", // Verde
  "#f97316", // Naranja
  "#eab308", // Amarillo
  "#ec4899", // Rosa
  "#06b6d4", // Turquesa
  "#f43f5e", // Carmesí
];

export interface TraceConfig {
  vMax: number;        // Tensión máxima de barrido (ej: 5V, 10V, 20V)
  vMin?: number;       // Tensión mínima de barrido para modo bipolar (ej: -10V)
  numPoints?: number;  // Número de puntos por curva (default 150)
  numSteps?: number;   // Número de curvas en la familia (default 5)
  mode: TraceMode;     // "output" | "transfer" | "bipolar"
}

/**
 * Genera el trazado completo de curvas I-V y extrae las métricas analíticas del dispositivo.
 */
export function generateDeviceTrace(
  preset: DevicePreset,
  config: TraceConfig,
): TraceResult {
  const { vMax, vMin = -vMax, numPoints = 150, numSteps = 5, mode } = config;
  const p = preset.params;
  const traces: CurveTrace[] = [];
  const extracted: DeviceExtractedParams = {};

  const Vt = 0.02585; // 25.85 mV a 300K

  if (preset.category === "diode") {
    const is = p.is || 1e-12;
    const n = p.n || 1.5;
    const rs = p.rs || 0.1;
    const vz = p.vz || 50;
    const isz = p.isz || 1e-3;
    const vtz = p.vtz || 0.05;

    const points: CurvePoint[] = [];
    const isBipolar = mode === "bipolar";
    const startV = isBipolar ? -Math.min(vMax, vz * 1.3) : 0;
    const endV = vMax;

    let iMax = -Infinity;
    let iMin = Infinity;

    for (let pt = 0; pt <= numPoints; pt++) {
      const v = startV + ((endV - startV) * pt) / numPoints;
      
      // Modelo Shockley con corrección de resistencia serie y breakdown Zener
      let iFwd = 0;
      if (v > 0) {
        // Solución aproximada de corriente forward: I = Is * exp((V - I*Rs)/(n*Vt))
        let iGuess = is * (Math.exp(Math.min(40, v / (n * Vt))) - 1);
        for (let iter = 0; iter < 3; iter++) {
          const vJunc = v - iGuess * rs;
          iGuess = is * (Math.exp(Math.max(-1, Math.min(40, vJunc / (n * Vt)))) - 1);
        }
        iFwd = Math.max(0, iGuess);
      }

      let iRev = 0;
      if (v < 0) {
        // Corriente inversa + corriente Zener
        const zenerOverdrive = -v - vz;
        if (zenerOverdrive > -1.0) {
          iRev = -isz * Math.exp(Math.min(30, zenerOverdrive / vtz));
        } else {
          iRev = -is;
        }
      }

      const iTotal = iFwd + iRev;
      points.push({ v, i: iTotal });
      if (iTotal > iMax) iMax = iTotal;
      if (iTotal < iMin) iMin = iTotal;
    }

    traces.push({
      stepValue: 0,
      stepLabel: "Curva I-V Diodo",
      color: "#38bdf8",
      points,
    });

    // Extracción de parámetros: Vf a 1mA y 10mA
    for (let k = 1; k < points.length; k++) {
      if (points[k - 1].i <= 0.001 && points[k].i >= 0.001) {
        extracted.vf1mA = points[k].v;
      }
      if (points[k - 1].i <= 0.010 && points[k].i >= 0.010) {
        extracted.vf10mA = points[k].v;
      }
    }
    if (vz <= vMax * 1.5) extracted.zenerVoltage = vz;
    extracted.dynamicRes = rs + (n * Vt) / 0.01;

    return {
      deviceName: preset.name,
      category: "diode",
      mode,
      traces,
      params: extracted,
      vMin: startV,
      vMax: endV,
      iMin: Math.min(0, iMin),
      iMax: Math.max(0.01, iMax),
      xLabel: "Tensión de Diodo Vd (V)",
      yLabel: "Corriente de Diodo Id (A)",
    };
  }

  if (preset.category === "bjt") {
    const beta = p.beta || 150;
    const vaf = p.vaf || 100;
    const knee = p.vceSatKnee || 0.25;
    const isPnp = p.isPnp === 1;

    if (mode === "transfer") {
      // Curva Ic vs Vbe
      const points: CurvePoint[] = [];
      for (let pt = 0; pt <= numPoints; pt++) {
        const vbe = (1.0 * pt) / numPoints; // 0 a 1V
        const ic = (p.is || 1e-14) * (Math.exp(vbe / (1.0 * Vt)) - 1);
        points.push({ v: vbe, i: Math.min(0.5, ic) });
      }
      traces.push({
        stepValue: 0,
        stepLabel: "Transferencia Ic vs Vbe",
        color: "#a855f7",
        points,
      });

      extracted.hFE_DC = beta;
      extracted.earlyVoltage = vaf;
      extracted.vceSat = knee;

      return {
        deviceName: preset.name,
        category: "bjt",
        mode: "transfer",
        traces,
        params: extracted,
        vMin: 0,
        vMax: 1.0,
        iMin: 0,
        iMax: 0.1,
        xLabel: "Tensión Base-Emisor Vbe (V)",
        yLabel: "Corriente de Colector Ic (A)",
      };
    }

    // Familia de curvas de salida Ic vs Vce para varios Ib
    const maxIb = (0.05 / beta); // Corriente de base máxima para ~50mA de Ic
    let overallMaxIc = 0;

    for (let step = 1; step <= numSteps; step++) {
      const ib = (maxIb * step) / numSteps;
      const ibStr = ib >= 1e-3 ? `${(ib * 1e3).toFixed(2)} mA` : `${(ib * 1e6).toFixed(1)} µA`;
      const points: CurvePoint[] = [];

      for (let pt = 0; pt <= numPoints; pt++) {
        const vce = (vMax * pt) / numPoints;
        const satFactor = 1 - Math.exp(-vce / knee);
        const ic = satFactor * beta * ib * (1 + vce / vaf);
        points.push({ v: vce, i: ic });
        if (ic > overallMaxIc) overallMaxIc = ic;
      }

      traces.push({
        stepValue: ib,
        stepLabel: `Ib = ${ibStr}`,
        color: TRACE_COLORS[(step - 1) % TRACE_COLORS.length],
        points,
      });
    }

    extracted.hFE_DC = beta;
    extracted.hfe_AC = beta * (1 + (vMax * 0.5) / vaf);
    extracted.vceSat = knee;
    extracted.earlyVoltage = vaf;

    return {
      deviceName: preset.name,
      category: "bjt",
      mode: "output",
      traces,
      params: extracted,
      vMin: 0,
      vMax,
      iMin: 0,
      iMax: Math.max(0.01, overallMaxIc * 1.05),
      xLabel: isPnp ? "-Vce (V)" : "Tensión Colector-Emisor Vce (V)",
      yLabel: isPnp ? "-Ic (A)" : "Corriente de Colector Ic (A)",
    };
  }

  if (preset.category === "mosfet") {
    const vth = p.vth || 2.0;
    const kp = p.kp || 0.05;
    const lambda = p.lambda || 0.01;
    const isPmos = p.isPmos === 1;

    if (mode === "transfer") {
      // Curva Id vs Vgs con Vds = vMax
      const points: CurvePoint[] = [];
      const maxVgs = Math.max(vth + 3.0, 6.0);

      for (let pt = 0; pt <= numPoints; pt++) {
        const vgs = (maxVgs * pt) / numPoints;
        let id = 0;
        if (vgs > vth) {
          id = kp * Math.pow(vgs - vth, 2) * (1 + lambda * (vMax * 0.5));
        }
        points.push({ v: vgs, i: id });
      }

      traces.push({
        stepValue: vMax,
        stepLabel: `Transferencia (Vds = ${vMax}V)`,
        color: "#22c55e",
        points,
      });

      extracted.vth = vth;
      extracted.gm = 2 * kp * (maxVgs * 0.7 - vth);
      extracted.rdsOn = 1 / (2 * kp * (maxVgs - vth));

      return {
        deviceName: preset.name,
        category: "mosfet",
        mode: "transfer",
        traces,
        params: extracted,
        vMin: 0,
        vMax: maxVgs,
        iMin: 0,
        iMax: points[points.length - 1].i * 1.1,
        xLabel: isPmos ? "-Vgs (V)" : "Tensión Gate-Source Vgs (V)",
        yLabel: isPmos ? "-Id (A)" : "Corriente de Drenador Id (A)",
      };
    }

    // Familia de curvas Id vs Vds para varios Vgs
    const minVgs = Math.max(0.5, vth + 0.3);
    const maxVgs = vth + 4.0;
    let overallMaxId = 0;

    for (let step = 1; step <= numSteps; step++) {
      const vgs = minVgs + ((maxVgs - minVgs) * (step - 1)) / Math.max(1, numSteps - 1);
      const points: CurvePoint[] = [];

      for (let pt = 0; pt <= numPoints; pt++) {
        const vds = (vMax * pt) / numPoints;
        let id = 0;
        const vov = vgs - vth; // Tensión de overdrive

        if (vov > 0) {
          if (vds < vov) {
            // Región Óhmica / Triodo
            id = kp * (2 * vov * vds - vds * vds) * (1 + lambda * vds);
          } else {
            // Región de Saturación
            id = kp * Math.pow(vov, 2) * (1 + lambda * vds);
          }
        }

        points.push({ v: vds, i: id });
        if (id > overallMaxId) overallMaxId = id;
      }

      traces.push({
        stepValue: vgs,
        stepLabel: `Vgs = ${vgs.toFixed(2)} V`,
        color: TRACE_COLORS[(step - 1) % TRACE_COLORS.length],
        points,
      });
    }

    extracted.vth = vth;
    extracted.gm = 2 * kp * (maxVgs - vth);
    extracted.rdsOn = 1 / (2 * kp * (maxVgs - vth));

    return {
      deviceName: preset.name,
      category: "mosfet",
      mode: "output",
      traces,
      params: extracted,
      vMin: 0,
      vMax,
      iMin: 0,
      iMax: Math.max(0.01, overallMaxId * 1.05),
      xLabel: isPmos ? "-Vds (V)" : "Tensión Drain-Source Vds (V)",
      yLabel: isPmos ? "-Id (A)" : "Corriente de Drain Id (A)",
    };
  }

  if (preset.category === "jfet") {
    const vp = p.vp || -3.0; // Pinch-off
    const idss = p.idss || 0.01;
    const lambda = p.lambda || 0.01;
    const absVp = Math.abs(vp);

    let overallMaxId = 0;

    for (let step = 1; step <= numSteps; step++) {
      // Vgs va desde 0 hasta -absVp
      const vgs = -((absVp * (step - 1)) / numSteps);
      const points: CurvePoint[] = [];

      for (let pt = 0; pt <= numPoints; pt++) {
        const vds = (vMax * pt) / numPoints;
        let id = 0;
        const vdsSat = absVp + vgs; // Vds de saturación

        if (vdsSat > 0) {
          if (vds < vdsSat) {
            // Región óhmica
            id = (2 * idss / (vp * vp)) * ((absVp + vgs) * vds - 0.5 * vds * vds) * (1 + lambda * vds);
          } else {
            // Región de saturación (pinch-off)
            id = idss * Math.pow(1 + vgs / absVp, 2) * (1 + lambda * vds);
          }
        }

        points.push({ v: vds, i: id });
        if (id > overallMaxId) overallMaxId = id;
      }

      traces.push({
        stepValue: vgs,
        stepLabel: `Vgs = ${vgs.toFixed(2)} V`,
        color: TRACE_COLORS[(step - 1) % TRACE_COLORS.length],
        points,
      });
    }

    extracted.vth = vp;
    extracted.idss = idss;
    extracted.gm = (2 * idss) / absVp;
    extracted.rdsOn = absVp / (2 * idss);

    return {
      deviceName: preset.name,
      category: "jfet",
      mode: "output",
      traces,
      params: extracted,
      vMin: 0,
      vMax,
      iMin: 0,
      iMax: Math.max(0.001, overallMaxId * 1.05),
      xLabel: "Tensión Drain-Source Vds (V)",
      yLabel: "Corriente de Drain Id (A)",
    };
  }

  // Pasivos: Resistencia
  const r = p.r || 1000;
  const isBipolar = mode === "bipolar";
  const startV = isBipolar ? vMin : 0;
  const endV = vMax;
  const points: CurvePoint[] = [];

  for (let pt = 0; pt <= numPoints; pt++) {
    const v = startV + ((endV - startV) * pt) / numPoints;
    points.push({ v, i: v / r });
  }

  traces.push({
    stepValue: r,
    stepLabel: `R = ${r} Ω`,
    color: "#38bdf8",
    points,
  });

  extracted.resistance = r;

  return {
    deviceName: preset.name,
    category: "resistor",
    mode,
    traces,
    params: extracted,
    vMin: startV,
    vMax: endV,
    iMin: startV / r,
    iMax: endV / r,
    xLabel: "Tensión en Resistor V (V)",
    yLabel: "Corriente en Resistor I (A)",
  };
}

/**
 * Calcula los puntos de la recta de carga (DC Load Line) y la intersección del punto de trabajo Q (Vq, Iq)
 * con la curva de polarización central.
 */
export function calculateLoadLineAndQPoint(
  vcc: number,
  rl: number,
  traces: CurveTrace[],
): { loadLinePoints: [CurvePoint, CurvePoint]; qPoint: CurvePoint | null } {
  const iMax = rl > 0 ? vcc / rl : 0;
  const loadLinePoints: [CurvePoint, CurvePoint] = [
    { v: 0, i: iMax },
    { v: vcc, i: 0 },
  ];

  if (traces.length === 0 || rl <= 0) {
    return { loadLinePoints, qPoint: null };
  }

  // Tomar la curva central de la familia
  const midTraceIdx = Math.floor(traces.length / 2);
  const midTrace = traces[midTraceIdx];
  if (!midTrace || midTrace.points.length < 2) {
    return { loadLinePoints, qPoint: null };
  }

  // Intersección entre la recta de carga: i_load(v) = (vcc - v) / rl y la curva del dispositivo
  let qPoint: CurvePoint | null = null;
  let minDiff = Infinity;

  for (let idx = 0; idx < midTrace.points.length; idx++) {
    const pt = midTrace.points[idx];
    const iLoad = (vcc - pt.v) / rl;
    const diff = Math.abs(pt.i - iLoad);
    if (diff < minDiff && pt.v <= vcc && pt.v >= 0) {
      minDiff = diff;
      qPoint = { v: pt.v, i: pt.i };
    }
  }

  return { loadLinePoints, qPoint };
}
