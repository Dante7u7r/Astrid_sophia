import type { AcSweepResult, TimeStepResult } from "../ui/oscilloscope_panel";
import { formatSpiceValue } from "./spice_value_parser";

export interface AutomatedMeasurementItem {
  id: string;
  name: string;
  category: "transient" | "ac" | "spectral" | "general";
  node: string;
  value: number;
  unit: string;
  formattedValue: string;
  description: string;
}

export interface AutomatedMeasurementReport {
  timestamp: string;
  circuitName?: string;
  analysisModes: string[];
  measurements: AutomatedMeasurementItem[];
}

/**
 * Calcula todas las mediciones automatizadas estilo .meas sobre resultados transitorios y AC.
 */
export function calculateAutomatedMeasurements(
  transientResults: readonly TimeStepResult[] = [],
  acSweepResults: AcSweepResult | null = null,
  activeNodes: string[] = ["1", "2", "out"],
): AutomatedMeasurementItem[] {
  const items: AutomatedMeasurementItem[] = [];

  // 1. Mediciones Transitorias por cada nodo activo
  for (const node of activeNodes) {
    if (!node || node === "0") continue;
    const hasData = transientResults.some((step) => step.nodeVoltages[node] !== undefined);
    if (!hasData || transientResults.length < 2) continue;

    // Rango dinámico y extremos
    let vMin = Infinity;
    let vMax = -Infinity;
    let sumV = 0;
    let sumSq = 0;
    const count = transientResults.length;

    for (const step of transientResults) {
      const v = step.nodeVoltages[node] ?? 0;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
      sumV += v;
      sumSq += v * v;
    }

    const vpp = vMax - vMin;
    const vavg = sumV / count;
    const vrms = Math.sqrt(sumSq / count);

    const vInitial = transientResults[0]?.nodeVoltages[node] ?? 0;
    const vFinal = transientResults[count - 1]?.nodeVoltages[node] ?? 0;
    const stepHeight = Math.abs(vFinal - vInitial);

    // Vpp
    items.push({
      id: `meas-${node}-vpp`,
      name: `Vpp(V(${node}))`,
      category: "general",
      node,
      value: vpp,
      unit: "V",
      formattedValue: `${formatSpiceValue(vpp)}V`,
      description: "Voltaje pico a pico",
    });

    // Vrms
    items.push({
      id: `meas-${node}-vrms`,
      name: `Vrms(V(${node}))`,
      category: "general",
      node,
      value: vrms,
      unit: "V",
      formattedValue: `${formatSpiceValue(vrms)}V`,
      description: "Voltaje eficaz (True RMS)",
    });

    // Vavg / DC
    items.push({
      id: `meas-${node}-vavg`,
      name: `Vavg(V(${node}))`,
      category: "general",
      node,
      value: vavg,
      unit: "V",
      formattedValue: `${formatSpiceValue(vavg)}V`,
      description: "Nivel promedio DC",
    });

    // Rise Time (10% -> 90%)
    const level10 = vMin + 0.1 * vpp;
    const level90 = vMin + 0.9 * vpp;
    const t10 = findThresholdCrossing(transientResults, node, level10, true);
    const t90 = findThresholdCrossing(transientResults, node, level90, true);

    if (t10 !== null && t90 !== null && t90 >= t10) {
      const riseTime = t90 - t10;
      items.push({
        id: `meas-${node}-risetime`,
        name: `RiseTime(V(${node}))`,
        category: "transient",
        node,
        value: riseTime,
        unit: "s",
        formattedValue: `${formatSpiceValue(riseTime)}s`,
        description: "Tiempo de subida (10% a 90%)",
      });
    }

    // Fall Time (90% -> 10%)
    const tFall90 = findThresholdCrossing(transientResults, node, level90, false);
    const tFall10 = findThresholdCrossing(transientResults, node, level10, false);

    if (tFall90 !== null && tFall10 !== null && tFall10 >= tFall90) {
      const fallTime = tFall10 - tFall90;
      items.push({
        id: `meas-${node}-falltime`,
        name: `FallTime(V(${node}))`,
        category: "transient",
        node,
        value: fallTime,
        unit: "s",
        formattedValue: `${formatSpiceValue(fallTime)}s`,
        description: "Tiempo de bajada (90% a 10%)",
      });
    }

    // Overshoot (%)
    if (stepHeight > 1e-4) {
      const overshoot = vFinal >= vInitial
        ? ((vMax - vFinal) / stepHeight) * 100
        : ((vFinal - vMin) / stepHeight) * 100;
      const osClamped = Math.max(0, overshoot);
      items.push({
        id: `meas-${node}-overshoot`,
        name: `Overshoot(V(${node}))`,
        category: "transient",
        node,
        value: osClamped,
        unit: "%",
        formattedValue: `${osClamped.toFixed(2)} %`,
        description: "Sobreimpulso porcentual transitorio",
      });
    }

    // Settling Time (Banda ±2%)
    if (stepHeight > 1e-4) {
      const band = Math.max(1e-5, 0.02 * stepHeight);
      let lastOutTime = transientResults[0].time;
      for (const step of transientResults) {
        const v = step.nodeVoltages[node] ?? 0;
        if (Math.abs(v - vFinal) > band) {
          lastOutTime = step.time;
        }
      }
      const settlingTime = Math.max(0, lastOutTime - transientResults[0].time);
      items.push({
        id: `meas-${node}-settlingtime`,
        name: `SettlingTime(V(${node}))`,
        category: "transient",
        node,
        value: settlingTime,
        unit: "s",
        formattedValue: `${formatSpiceValue(settlingTime)}s`,
        description: "Tiempo de establecimiento (banda ±2%)",
      });
    }

    // THD (Total Harmonic Distortion %)
    const thdVal = calculateThdFromTransient(transientResults, node);
    if (thdVal !== null) {
      items.push({
        id: `meas-${node}-thd`,
        name: `THD(V(${node}))`,
        category: "spectral",
        node,
        value: thdVal,
        unit: "%",
        formattedValue: `${thdVal.toFixed(3)} %`,
        description: "Distorsión armónica total (THD)",
      });
    }
  }

  // 2. Mediciones de Frecuencia y Estabilidad AC (Bode, Ancho de Banda, Margen de Fase)
  if (acSweepResults && acSweepResults.frequencies.length >= 2) {
    const freqs = acSweepResults.frequencies;

    for (const node of activeNodes) {
      const amps = acSweepResults.nodeAmplitudes[node];
      const phases = acSweepResults.nodePhases[node];
      if (!amps || amps.length !== freqs.length) continue;

      const peakAmp = Math.max(...amps);
      if (peakAmp <= 1e-12) continue;

      // Ancho de banda a -3 dB
      const cutoffAmp = peakAmp / Math.SQRT2; // ~0.7071 (-3 dB)
      let bwFreq: number | null = null;

      for (let i = 0; i < amps.length - 1; i++) {
        if ((amps[i] >= cutoffAmp && amps[i + 1] <= cutoffAmp) || (amps[i] <= cutoffAmp && amps[i + 1] >= cutoffAmp)) {
          const frac = (cutoffAmp - amps[i]) / (amps[i + 1] - amps[i]);
          bwFreq = freqs[i] + frac * (freqs[i + 1] - freqs[i]);
          break;
        }
      }

      if (bwFreq !== null) {
        items.push({
          id: `meas-${node}-bw`,
          name: `BW(V(${node}))`,
          category: "ac",
          node,
          value: bwFreq,
          unit: "Hz",
          formattedValue: `${formatSpiceValue(bwFreq)}Hz`,
          description: "Ancho de banda a -3 dB (Frecuencia de corte)",
        });
      }

      // Margen de Fase en ganancia unitaria (0 dB = 1.0 V/V)
      let phaseMargin: number | null = null;
      for (let i = 0; i < amps.length - 1; i++) {
        if ((amps[i] >= 1.0 && amps[i + 1] <= 1.0) || (amps[i] <= 1.0 && amps[i + 1] >= 1.0)) {
          const frac = (1.0 - amps[i]) / (amps[i + 1] - amps[i]);
          const phaseCross = (phases?.[i] ?? 0) + frac * ((phases?.[i + 1] ?? 0) - (phases?.[i] ?? 0));
          // Margen de fase respecto a -180°
          phaseMargin = 180 + phaseCross;
          while (phaseMargin > 180) phaseMargin -= 360;
          while (phaseMargin < -180) phaseMargin += 360;
          break;
        }
      }

      if (phaseMargin !== null) {
        items.push({
          id: `meas-${node}-pm`,
          name: `PhaseMargin(V(${node}))`,
          category: "ac",
          node,
          value: phaseMargin,
          unit: "°",
          formattedValue: `${phaseMargin.toFixed(2)} °`,
          description: "Margen de fase en el cruce de ganancia unitaria (0 dB)",
        });
      }
    }
  }

  return items;
}

/**
 * Encuentra el tiempo exacto interpolado linealmente de cruce de umbral.
 */
function findThresholdCrossing(
  results: readonly TimeStepResult[],
  node: string,
  threshold: number,
  rising: boolean,
): number | null {
  for (let i = 1; i < results.length; i++) {
    const v0 = results[i - 1].nodeVoltages[node] ?? 0;
    const v1 = results[i].nodeVoltages[node] ?? 0;

    const isCrossing = rising ? v0 <= threshold && v1 > threshold : v0 >= threshold && v1 < threshold;
    if (isCrossing) {
      if (Math.abs(v1 - v0) < 1e-15) return results[i - 1].time;
      const frac = (threshold - v0) / (v1 - v0);
      return results[i - 1].time + frac * (results[i].time - results[i - 1].time);
    }
  }
  return null;
}

/**
 * Calcula el THD (%) a partir de la integración armónica de Fourier.
 */
function calculateThdFromTransient(results: readonly TimeStepResult[], node: string): number | null {
  const n = results.length;
  if (n < 16) return null;

  const tStart = results[0].time;
  const tEnd = results[n - 1].time;
  const tSpan = tEnd - tStart;
  if (tSpan <= 0) return null;

  let sumV = 0;
  for (let i = 0; i < n; i++) sumV += results[i].nodeVoltages[node] ?? 0;
  const avg = sumV / n;

  const positiveCrossings: number[] = [];
  for (let i = 1; i < n; i++) {
    const v0 = results[i - 1].nodeVoltages[node] ?? 0;
    const v1 = results[i].nodeVoltages[node] ?? 0;
    if (v0 <= avg && v1 > avg) {
      const frac = (avg - v0) / (v1 - v0);
      positiveCrossings.push(results[i - 1].time + frac * (results[i].time - results[i - 1].time));
    }
  }

  let f0 = 0;
  if (positiveCrossings.length >= 2) {
    let periodSum = 0;
    for (let i = 1; i < positiveCrossings.length; i++) {
      periodSum += positiveCrossings[i] - positiveCrossings[i - 1];
    }
    const avgPeriod = periodSum / (positiveCrossings.length - 1);
    if (avgPeriod > 1e-15) f0 = 1 / avgPeriod;
  } else {
    f0 = 1 / tSpan;
  }

  if (f0 <= 0 || !Number.isFinite(f0)) return null;

  const harmonicAmps: number[] = [];
  for (let k = 1; k <= 8; k++) {
    const freqK = k * f0;
    let cosSum = 0;
    let sinSum = 0;
    for (let i = 1; i < n; i++) {
      const dt = results[i].time - results[i - 1].time;
      const tRel = results[i].time - tStart;
      const v = results[i].nodeVoltages[node] ?? 0;
      const theta = 2 * Math.PI * freqK * tRel;
      cosSum += v * Math.cos(theta) * dt;
      sinSum += v * Math.sin(theta) * dt;
    }
    const aK = (2 / tSpan) * Math.sqrt(cosSum * cosSum + sinSum * sinSum);
    harmonicAmps.push(aK);
  }

  const fundamental = harmonicAmps[0];
  if (fundamental < 1e-4) return null;

  let sumHarmonicsSq = 0;
  for (let k = 1; k < harmonicAmps.length; k++) {
    sumHarmonicsSq += harmonicAmps[k] * harmonicAmps[k];
  }

  const thd = (Math.sqrt(sumHarmonicsSq) / fundamental) * 100;
  return Number.isFinite(thd) ? thd : null;
}

/**
 * Exporta un conjunto de mediciones a formato CSV (RFC 4180).
 */
export function exportMeasurementsToCsv(
  measurements: readonly AutomatedMeasurementItem[],
  metadata: { circuitName?: string; timestamp?: string } = {},
): string {
  const rows: string[] = [
    `# Mediciones Automáticas .MEAS - Biaani`,
    `# Circuito: ${metadata.circuitName || "Esquemático Principal"}`,
    `# Fecha: ${metadata.timestamp || new Date().toISOString()}`,
    `ID,Nombre,Categoría,Nodo,Valor,Unidad,ValorFormateado,Descripción`,
  ];

  for (const m of measurements) {
    const escName = `"${m.name.replace(/"/g, '""')}"`;
    const escDesc = `"${m.description.replace(/"/g, '""')}"`;
    rows.push(`${m.id},${escName},${m.category},${m.node},${m.value},${m.unit},"${m.formattedValue}",${escDesc}`);
  }

  return rows.join("\r\n");
}

/**
 * Exporta un conjunto de mediciones a formato JSON enriquecido.
 */
export function exportMeasurementsToJson(
  measurements: readonly AutomatedMeasurementItem[],
  metadata: { circuitName?: string; timestamp?: string; analysisModes?: string[] } = {},
): string {
  const report: AutomatedMeasurementReport = {
    timestamp: metadata.timestamp || new Date().toISOString(),
    circuitName: metadata.circuitName || "Esquemático Principal",
    analysisModes: metadata.analysisModes || ["TRAN", "AC"],
    measurements: [...measurements],
  };

  return JSON.stringify(report, null, 2);
}
