import type { TimeStepResult } from "./oscilloscope_panel";

export type OscilloscopeChannel = "ch1" | "ch2" | "ch3" | "ch4";
export type TriggerEdge = "rising" | "falling";

export interface OscilloscopeMetrics {
  vpp: number;
  vrms: number;
  freq: number;
  vmax: number;
  vmin: number;
  vavg: number;
  period: number;
  duty: number;
  riseTime?: number;
  fallTime?: number;
  overshoot?: number;
  undershoot?: number;
  posWidth?: number;
  negWidth?: number;
  phaseDiffDeg?: number;
}

export interface TraceChannelConfig {
  coupling?: "dc" | "ac" | "gnd";
  invert?: boolean;
  interpolation?: "linear" | "sinc";
}

export interface TyTracePoint {
  x: number;
  y: number;
}

export const OSCILLOSCOPE_VOLTS_PER_DIV = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000,
] as const;

export const OSCILLOSCOPE_TIME_PER_DIV = [
  1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4,
  1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5,
] as const;

const metricsCache = new WeakMap<readonly TimeStepResult[], Map<string, OscilloscopeMetrics>>();

function findVisibleEndIndex(
  results: readonly TimeStepResult[],
  startIndex: number,
  endTime: number,
): number {
  let low = startIndex;
  let high = results.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (results[middle].time <= endTime) low = middle + 1;
    else high = middle;
  }
  return low;
}

function buildLttbTrace(
  results: readonly TimeStepResult[],
  nodeId: string,
  startIndex: number,
  endIndex: number,
  maxPoints: number,
  toPoint: (sample: TimeStepResult) => TyTracePoint,
): TyTracePoint[] {
  const sampleCount = endIndex - startIndex;
  if (sampleCount <= maxPoints || maxPoints <= 2) {
    return results.slice(startIndex, endIndex).map(toPoint);
  }

  const sampled: TyTracePoint[] = [];
  const bucketSize = (sampleCount - 2) / (maxPoints - 2);

  let a = startIndex;
  sampled.push(toPoint(results[a]));

  for (let i = 0; i < maxPoints - 2; i++) {
    const bucketStart = startIndex + 1 + Math.floor(i * bucketSize);
    const bucketEnd = Math.min(endIndex - 1, startIndex + 1 + Math.floor((i + 1) * bucketSize));

    const nextBucketStart = startIndex + 1 + Math.floor((i + 1) * bucketSize);
    const nextBucketEnd = Math.min(endIndex, startIndex + 1 + Math.floor((i + 2) * bucketSize));

    let avgX = 0;
    let avgY = 0;
    const nextCount = Math.max(1, nextBucketEnd - nextBucketStart);
    for (let j = nextBucketStart; j < nextBucketEnd; j++) {
      avgX += results[j].time;
      avgY += results[j].nodeVoltages[nodeId] ?? 0;
    }
    avgX /= nextCount;
    avgY /= nextCount;

    let maxArea = -1;
    let maxIndex = bucketStart;
    const pointAX = results[a].time;
    const pointAY = results[a].nodeVoltages[nodeId] ?? 0;

    for (let j = bucketStart; j < bucketEnd; j++) {
      const px = results[j].time;
      const py = results[j].nodeVoltages[nodeId] ?? 0;
      const area = Math.abs(
        (pointAX - avgX) * (py - pointAY) - (pointAX - px) * (avgY - pointAY),
      ) * 0.5;

      if (area > maxArea) {
        maxArea = area;
        maxIndex = j;
      }
    }

    sampled.push(toPoint(results[maxIndex]));
    a = maxIndex;
  }

  sampled.push(toPoint(results[endIndex - 1]));
  return sampled;
}

export function selectTraceSampleIndices(
  length: number,
  maxPoints: number,
): number[] {
  if (length <= 0 || maxPoints <= 0) return [];
  if (length <= maxPoints) return Array.from({ length }, (_, index) => index);
  if (maxPoints === 1) return [0];

  const indices = new Array<number>(maxPoints);
  for (let index = 0; index < maxPoints; index++) {
    indices[index] = Math.round((index * (length - 1)) / (maxPoints - 1));
  }
  return indices;
}

export function normalizeTriggerChannel(value: string): OscilloscopeChannel {
  return value === "ch2" || value === "ch3" || value === "ch4" ? value : "ch1";
}

export function normalizeTriggerEdge(value: string): TriggerEdge {
  return value === "falling" ? "falling" : "rising";
}

export function calculateOscilloscopeMetrics(
  results: readonly TimeStepResult[],
  nodeId: string,
): OscilloscopeMetrics {
  if (results.length === 0) {
    return { vpp: 0, vrms: 0, freq: 0, vmax: 0, vmin: 0, vavg: 0, period: 0, duty: 0 };
  }

  let resultCache = metricsCache.get(results);
  if (!resultCache) {
    resultCache = new Map();
    metricsCache.set(results, resultCache);
  }
  const cacheKey = `${nodeId}:${results.length}:${results[results.length - 1]?.time ?? 0}`;
  const cached = resultCache.get(cacheKey);
  if (cached) return cached;
  if (resultCache.size >= 16) resultCache.clear();

  let maxV = -Infinity;
  let minV = Infinity;
  let sumV = 0;
  let sumSq = 0;

  for (const pt of results) {
    const v = pt.nodeVoltages[nodeId] ?? 0;
    if (v > maxV) maxV = v;
    if (v < minV) minV = v;
    sumV += v;
    sumSq += v * v;
  }

  const count = results.length;
  const vpp = maxV - minV;
  const vavg = sumV / count;
  const vrms = Math.sqrt(sumSq / count);
  let crossings = 0;
  let timeHigh = 0;
  const avg = (maxV + minV) / 2;
  const hyst = Math.max(1e-4, vpp * 0.08);
  const vHigh = avg + hyst;
  const vLow = avg - hyst;

  let trigState: "low" | "high" | "unknown" = "unknown";
  let firstCrossingTime: number | null = null;
  let lastCrossingTime: number | null = null;

  for (let i = 0; i < count; i++) {
    const v = results[i].nodeVoltages[nodeId] ?? 0;
    const t = results[i].time;
    if (trigState !== "high" && v >= vHigh) {
      if (trigState === "low") {
        crossings++;
        if (firstCrossingTime === null) firstCrossingTime = t;
        lastCrossingTime = t;
      }
      trigState = "high";
    } else if (trigState !== "low" && v <= vLow) {
      trigState = "low";
    }

    if (i > 0 && v >= avg) {
      timeHigh += (results[i].time - results[i - 1].time);
    }
  }

  const first = results[0];
  const last = results[count - 1];
  const totalDuration = last.time - first.time;
  let freq = 0;
  if (crossings >= 2 && firstCrossingTime !== null && lastCrossingTime !== null && lastCrossingTime > firstCrossingTime) {
    freq = (crossings - 1) / (lastCrossingTime - firstCrossingTime);
  } else if (crossings === 1 && totalDuration > 0 && vpp > 0.02) {
    freq = 1 / totalDuration;
  }
  const period = freq > 0 ? 1 / freq : 0;
  const duty = totalDuration > 0 ? Math.min(100, Math.max(0, (timeHigh / totalDuration) * 100)) : 50;

  // Métricas avanzadas de pulso y transitorios
  let riseTime: number | undefined;
  let fallTime: number | undefined;
  let posWidth: number | undefined;
  let negWidth: number | undefined;
  let overshoot: number | undefined;
  let undershoot: number | undefined;

  if (vpp > 1e-4 && count > 4) {
    const v10 = minV + 0.1 * vpp;
    const v90 = minV + 0.9 * vpp;
    const v50 = minV + 0.5 * vpp;

    let minRise = Infinity;
    let minFall = Infinity;
    let shortestPosW = Infinity;
    let shortestNegW = Infinity;

    let t10: number | null = null;
    let t90: number | null = null;
    let t50Rise: number | null = null;
    let t50Fall: number | null = null;

    for (let i = 1; i < count; i++) {
      const vPrev = results[i - 1].nodeVoltages[nodeId] ?? 0;
      const vCurr = results[i].nodeVoltages[nodeId] ?? 0;
      const tPrev = results[i - 1].time;
      const tCurr = results[i].time;
      const dt = Math.max(1e-15, tCurr - tPrev);

      const lerpTime = (vTarget: number) => tPrev + ((vTarget - vPrev) / (vCurr - vPrev || 1e-15)) * dt;

      if (vPrev <= v10 && vCurr > v10) t10 = lerpTime(v10);
      if (vPrev <= v90 && vCurr > v90 && t10 !== null) {
        t90 = lerpTime(v90);
        const dtRise = t90 - t10;
        if (dtRise > 0 && dtRise < minRise) minRise = dtRise;
        t10 = null;
      }

      if (vPrev >= v90 && vCurr < v90) t90 = lerpTime(v90);
      if (vPrev >= v10 && vCurr < v10 && t90 !== null) {
        t10 = lerpTime(v10);
        const dtFall = t10 - t90;
        if (dtFall > 0 && dtFall < minFall) minFall = dtFall;
        t90 = null;
      }

      if (vPrev <= v50 && vCurr > v50) {
        t50Rise = lerpTime(v50);
        if (t50Fall !== null) {
          const negW = t50Rise - t50Fall;
          if (negW > 0 && negW < shortestNegW) shortestNegW = negW;
        }
      }
      if (vPrev >= v50 && vCurr < v50) {
        t50Fall = lerpTime(v50);
        if (t50Rise !== null) {
          const posW = t50Fall - t50Rise;
          if (posW > 0 && posW < shortestPosW) shortestPosW = posW;
        }
      }
    }

    if (Number.isFinite(minRise)) riseTime = minRise;
    if (Number.isFinite(minFall)) fallTime = minFall;
    if (Number.isFinite(shortestPosW)) posWidth = shortestPosW;
    if (Number.isFinite(shortestNegW)) negWidth = shortestNegW;

    // Calcular Overshoot y Undershoot relativos
    if (vpp > 0.05) {
      const topOvershoot = Math.max(0, (maxV - (avg + vpp * 0.45)) / (vpp * 0.5));
      const botUndershoot = Math.max(0, ((avg - vpp * 0.45) - minV) / (vpp * 0.5));
      if (topOvershoot > 0.01) overshoot = Math.min(100, topOvershoot * 100);
      if (botUndershoot > 0.01) undershoot = Math.min(100, botUndershoot * 100);
    }
  }

  const metrics: OscilloscopeMetrics = {
    vpp,
    vmax: maxV,
    vmin: minV,
    vavg,
    vrms,
    freq,
    period,
    duty,
    riseTime,
    fallTime,
    posWidth,
    negWidth,
    overshoot,
    undershoot,
  };
  resultCache.set(cacheKey, metrics);
  return metrics;
}

export function findTriggerStartIndex(
  results: readonly TimeStepResult[],
  nodeId: string | null,
  edge: "rising" | "falling",
  level: number,
  timeDivValue?: number,
): number {
  if (!nodeId || results.length <= 2) return 0;

  const windowDuration = timeDivValue && Number.isFinite(timeDivValue) && timeDivValue > 0
    ? timeDivValue * 10
    : Infinity;
  const latestTime = results[results.length - 1].time;
  const totalDuration = latestTime - results[0].time;
  const isRollMode = (timeDivValue ?? 0.02) >= 0.1; // >= 100 ms/div opera en modo Roll continuo

  // 1. Modo Roll para bases de tiempo lentas (DSO Auto-Roll): desplazamiento continuo hacia la izquierda
  if (isRollMode && Number.isFinite(windowDuration) && totalDuration >= windowDuration) {
    const targetStartTime = latestTime - windowDuration - 1e-9;
    for (let i = 0; i < results.length; i++) {
      if (results[i].time >= targetStartTime) {
        return i;
      }
    }
    return 0;
  }

  // 2. Si disponemos de una ventana completa de datos acumulados:
  if (Number.isFinite(windowDuration) && totalDuration >= windowDuration) {
    // 2a. Buscamos el cruce de disparo más reciente que disponga de una ventana completa hacia adelante (DSO Phase Lock)
    for (let i = results.length - 2; i >= 1; i--) {
      const v0 = results[i - 1].nodeVoltages[nodeId] ?? 0;
      const v1 = results[i].nodeVoltages[nodeId] ?? 0;
      const isCrossing = edge === "rising"
        ? (v0 <= level && v1 > level)
        : (v0 >= level && v1 < level);

      if (isCrossing && latestTime - results[i].time >= windowDuration - 1e-9) {
        return i;
      }
    }

    // 2b. Fallback cuando hay ventana completa pero no hay cruce hacia adelante: ventana rodante más reciente para no dejar huecos negros
    const targetStartTime = latestTime - windowDuration - 1e-9;
    for (let i = 0; i < results.length; i++) {
      if (results[i].time >= targetStartTime) {
        return i;
      }
    }
    return 0;
  }

  // 3. Arranque progresivo: Si la simulación aún no acumula una ventana completa, anclamos al primer cruce para que la onda crezca suavemente
  for (let i = 1; i < results.length; i++) {
    const v0 = results[i - 1].nodeVoltages[nodeId] ?? 0;
    const v1 = results[i].nodeVoltages[nodeId] ?? 0;
    const isCrossing = edge === "rising"
      ? (v0 <= level && v1 > level)
      : (v0 >= level && v1 < level);

    if (isCrossing) {
      return i;
    }
  }

  return 0;
}

export function buildTyTracePoints(
  results: readonly TimeStepResult[],
  nodeId: string,
  dimensions: { width: number; height: number },
  scale: { voltsPerDiv: number; offsetPixels: number; timeDivValue: number },
  startIndex = 0,
  config?: TraceChannelConfig,
): TyTracePoint[] {
  if (!nodeId || results.length === 0) return [];

  const windowDuration = scale.timeDivValue * 10;
  if (windowDuration <= 0 || !Number.isFinite(windowDuration)) return [];

  let effectiveStartIndex = Math.max(0, Math.min(startIndex, results.length - 1));
  let firstTime = results[effectiveStartIndex].time;
  const latestTime = results[results.length - 1].time;
  const totalAvailableDuration = latestTime - results[0].time;

  // Si desde effectiveStartIndex no se cubre la duración esperada pero hay más datos en el buffer, rebobinar adecuadamente
  if (latestTime - firstTime < Math.min(windowDuration * 0.5, totalAvailableDuration)) {
    if (totalAvailableDuration >= windowDuration) {
      const targetStartTime = latestTime - windowDuration;
      let newStart = 0;
      for (let i = 0; i < results.length; i++) {
        if (results[i].time >= targetStartTime) {
          newStart = i;
          break;
        }
      }
      effectiveStartIndex = newStart;
      firstTime = results[effectiveStartIndex].time;
    } else {
      effectiveStartIndex = 0;
      firstTime = results[0].time;
    }
  }

  let endIndex = findVisibleEndIndex(results, effectiveStartIndex, firstTime + windowDuration);
  if (endIndex - effectiveStartIndex < 2 && results.length >= 2) {
    effectiveStartIndex = 0;
    firstTime = results[0].time;
    endIndex = findVisibleEndIndex(results, 0, firstTime + windowDuration);
    if (endIndex < 2) {
      endIndex = results.length;
    }
  }

  const divHeight = dimensions.height / 8;
  const maxPoints = Math.max(64, Math.min(2_000, Math.ceil(dimensions.width * 2)));

  // Calculate average for AC coupling if requested
  let acOffset = 0;
  if (config?.coupling === "ac" && endIndex > effectiveStartIndex) {
    let sum = 0;
    for (let i = effectiveStartIndex; i < endIndex; i++) {
      sum += results[i].nodeVoltages[nodeId] ?? 0;
    }
    acOffset = sum / (endIndex - effectiveStartIndex);
  }

  const toPoint = (pt: TimeStepResult): TyTracePoint => {
    const relativeTime = pt.time - firstTime;
    const x = Math.max(0, Math.min(dimensions.width, (relativeTime / windowDuration) * dimensions.width));
    let v = pt.nodeVoltages[nodeId] ?? 0.0;
    if (config?.coupling === "gnd") {
      v = 0.0;
    } else if (config?.coupling === "ac") {
      v = v - acOffset;
    }
    if (config?.invert) {
      v = -v;
    }
    const y = dimensions.height / 2 - (v / scale.voltsPerDiv) * divHeight - scale.offsetPixels;
    return { x, y };
  };

  const rawTrace = buildLttbTrace(
    results,
    nodeId,
    effectiveStartIndex,
    endIndex,
    maxPoints,
    toPoint,
  );

  if (config?.interpolation === "sinc" && rawTrace.length >= 4 && rawTrace.length < maxPoints / 2) {
    return interpolateSincTrace(rawTrace, Math.min(maxPoints, rawTrace.length * 4));
  }

  return rawTrace;
}

/**
 * Interpolación Whittaker-Shannon con ventana de Lanczos (Sinc Interpolation)
 * para reconstrucción analógica de señales muestreadas.
 */
export function interpolateSincTrace(
  points: readonly TyTracePoint[],
  targetPoints: number,
  lanczosA = 3,
): TyTracePoint[] {
  const n = points.length;
  if (n < 4 || targetPoints <= n) return points.slice();

  const out: TyTracePoint[] = [];
  const xMin = points[0].x;
  const xMax = points[n - 1].x;
  const xSpan = xMax - xMin;
  if (xSpan <= 0) return points.slice();

  for (let idx = 0; idx < targetPoints; idx++) {
    const targetX = xMin + (idx / (targetPoints - 1)) * xSpan;
    let low = 0;
    let high = n - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (points[mid].x < targetX) low = mid + 1;
      else high = mid;
    }
    const centerIdx = low;
    let interpolatedY = 0;
    let weightSum = 0;

    const startK = Math.max(0, centerIdx - lanczosA);
    const endK = Math.min(n - 1, centerIdx + lanczosA);

    for (let k = startK; k <= endK; k++) {
      const xk = points[k].x;
      const dx = (points[k + 1] ? (points[k + 1].x - xk) : (xk - (points[k - 1]?.x ?? (xk - 1)))) || 1;
      const delta = (targetX - xk) / dx;

      let weight: number;
      if (Math.abs(delta) < 1e-6) {
        weight = 1.0;
      } else if (Math.abs(delta) > lanczosA) {
        weight = 0.0;
      } else {
        const piDelta = Math.PI * delta;
        const sinc = Math.sin(piDelta) / piDelta;
        const lanczosWindow = Math.sin(piDelta / lanczosA) / (piDelta / lanczosA);
        weight = sinc * lanczosWindow;
      }

      interpolatedY += points[k].y * weight;
      weightSum += weight;
    }

    const finalY = weightSum > 1e-4 ? interpolatedY / weightSum : points[centerIdx].y;
    out.push({ x: targetX, y: finalY });
  }

  return out;
}

export interface AutoFitSettings {
  voltsPerDiv: number;
  timeDivValue: number;
  centerVoltage: number;
}

function nearestTimePerDiv(target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0.02;
  return OSCILLOSCOPE_TIME_PER_DIV.reduce((nearest, candidate) => (
    Math.abs(Math.log(candidate / target)) < Math.abs(Math.log(nearest / target))
      ? candidate
      : nearest
  ));
}

export function calculateAutoFitSettings(
  results: readonly TimeStepResult[],
  nodeId: string | null,
): AutoFitSettings {
  if (!nodeId || results.length === 0) {
    return { voltsPerDiv: 1, timeDivValue: 0.02, centerVoltage: 0 };
  }

  let minVoltage = Infinity;
  let maxVoltage = -Infinity;
  const startIndex = Math.max(0, results.length - 2000);
  for (let i = startIndex; i < results.length; i++) {
    const voltage = results[i].nodeVoltages[nodeId];
    if (voltage === undefined || !Number.isFinite(voltage)) continue;
    minVoltage = Math.min(minVoltage, voltage);
    maxVoltage = Math.max(maxVoltage, voltage);
  }

  if (!Number.isFinite(minVoltage) || !Number.isFinite(maxVoltage)) {
    return { voltsPerDiv: 1, timeDivValue: 0.02, centerVoltage: 0 };
  }

  const vSpan = maxVoltage - minVoltage;
  let requiredVoltsPerDiv = 1.0;
  if (vSpan > 0.02) {
    requiredVoltsPerDiv = vSpan / 5.5;
  } else if (vSpan > 1e-4) {
    requiredVoltsPerDiv = Math.max(vSpan / 4, 0.01);
  } else {
    const absMax = Math.max(Math.abs(maxVoltage), Math.abs(minVoltage));
    requiredVoltsPerDiv = absMax > 0.1 ? absMax / 3.5 : 1.0;
  }

  const voltsPerDiv = OSCILLOSCOPE_VOLTS_PER_DIV.find((value) => value >= requiredVoltsPerDiv)
    ?? OSCILLOSCOPE_VOLTS_PER_DIV[OSCILLOSCOPE_VOLTS_PER_DIV.length - 1];

  const metrics = calculateOscilloscopeMetrics(results, nodeId);
  const totalDuration = Math.max(0, results[results.length - 1].time - results[0].time);
  const desiredTimePerDiv = metrics.freq > 0
    ? 0.25 / metrics.freq
    : totalDuration >= 0.02
      ? totalDuration / 10
      : 0.02;

  const rawCenter = (maxVoltage + minVoltage) / 2;
  const centerVoltage = Math.abs(rawCenter) < 0.15 * Math.max(vSpan, 1.0) ? 0 : rawCenter;

  return {
    voltsPerDiv,
    timeDivValue: nearestTimePerDiv(desiredTimePerDiv),
    centerVoltage,
  };
}

export function calculateAutoFitForValues(
  values: readonly number[] | Float64Array,
  results?: readonly TimeStepResult[],
): AutoFitSettings {
  if (values.length === 0) {
    return { voltsPerDiv: 1, timeDivValue: 0.02, centerVoltage: 0 };
  }

  let minVoltage = Infinity;
  let maxVoltage = -Infinity;
  for (const val of values) {
    if (!Number.isFinite(val)) continue;
    minVoltage = Math.min(minVoltage, val);
    maxVoltage = Math.max(maxVoltage, val);
  }

  if (!Number.isFinite(minVoltage) || !Number.isFinite(maxVoltage)) {
    return { voltsPerDiv: 1, timeDivValue: 0.02, centerVoltage: 0 };
  }

  const vSpan = maxVoltage - minVoltage;
  const requiredVoltsPerDiv = vSpan > 1e-4 ? Math.max(vSpan / 5, OSCILLOSCOPE_VOLTS_PER_DIV[0]) : 1.0;
  const voltsPerDiv = OSCILLOSCOPE_VOLTS_PER_DIV.find((value) => value >= requiredVoltsPerDiv)
    ?? OSCILLOSCOPE_VOLTS_PER_DIV[OSCILLOSCOPE_VOLTS_PER_DIV.length - 1];

  let desiredTimePerDiv = 0.02;
  if (results && results.length > 1) {
    const totalDuration = Math.max(0, results[results.length - 1].time - results[0].time);
    desiredTimePerDiv = totalDuration >= 0.02 ? totalDuration / 10 : 0.02;
  }

  return {
    voltsPerDiv,
    timeDivValue: nearestTimePerDiv(desiredTimePerDiv),
    centerVoltage: (maxVoltage + minVoltage) / 2,
  };
}

// ==========================================================================
// 8. SEARCH & NAVIGATE IN TRACE
// ==========================================================================

export function findTimeIndex(
  results: readonly TimeStepResult[],
  targetTime: number,
): number {
  if (results.length === 0) return 0;
  if (targetTime <= results[0].time) return 0;
  if (targetTime >= results[results.length - 1].time) return results.length - 1;

  let low = 0;
  let high = results.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (results[mid].time < targetTime) {
      low = mid + 1;
    } else if (results[mid].time > targetTime) {
      high = mid - 1;
    } else {
      return mid;
    }
  }
  return low;
}

export function searchNextCrossing(
  results: readonly TimeStepResult[],
  nodeId: string,
  thresholdVolts = 0.0,
  edge: "rising" | "falling" | "both" = "both",
  fromIndex = 0,
): number | null {
  if (results.length < 2 || fromIndex >= results.length - 1) return null;

  for (let i = fromIndex; i < results.length - 1; i++) {
    const vCurr = results[i].nodeVoltages[nodeId] ?? 0;
    const vNext = results[i + 1].nodeVoltages[nodeId] ?? 0;

    const isRising = vCurr <= thresholdVolts && vNext > thresholdVolts;
    const isFalling = vCurr >= thresholdVolts && vNext < thresholdVolts;

    if (edge === "rising" && isRising) return i + 1;
    if (edge === "falling" && isFalling) return i + 1;
    if (edge === "both" && (isRising || isFalling)) return i + 1;
  }
  return null;
}

export function searchNextPeak(
  results: readonly TimeStepResult[],
  nodeId: string,
  type: "max" | "min" | "both" = "both",
  fromIndex = 0,
): number | null {
  if (results.length < 3 || fromIndex >= results.length - 2) return null;

  for (let i = Math.max(1, fromIndex); i < results.length - 1; i++) {
    const vPrev = results[i - 1].nodeVoltages[nodeId] ?? 0;
    const vCurr = results[i].nodeVoltages[nodeId] ?? 0;
    const vNext = results[i + 1].nodeVoltages[nodeId] ?? 0;

    const isMax = vCurr > vPrev && vCurr >= vNext;
    const isMin = vCurr < vPrev && vCurr <= vNext;

    if (type === "max" && isMax) return i;
    if (type === "min" && isMin) return i;
    if (type === "both" && (isMax || isMin)) return i;
  }
  return null;
}

// ==========================================================================
// 9. WAVEFORM HISTOGRAM & PDF (PROBABILITY DENSITY FUNCTION)
// ==========================================================================

export interface WaveformHistogram {
  readonly binCenters: readonly number[];
  readonly counts: readonly number[];
  readonly probabilities: readonly number[];
  readonly minV: number;
  readonly maxV: number;
  readonly mean: number;
  readonly stdDev: number;
  readonly median: number;
  readonly totalSamples: number;
}

export function calculateWaveformHistogram(
  results: readonly TimeStepResult[],
  nodeId: string,
  binCount = 32,
  fromIndex = 0,
  toIndex?: number,
): WaveformHistogram {
  const endIndex = Math.min(results.length, toIndex ?? results.length);
  const sampleCount = Math.max(0, endIndex - fromIndex);

  if (sampleCount === 0) {
    return {
      binCenters: [],
      counts: [],
      probabilities: [],
      minV: 0,
      maxV: 0,
      mean: 0,
      stdDev: 0,
      median: 0,
      totalSamples: 0,
    };
  }

  const values: number[] = new Array(sampleCount);
  let minV = Infinity;
  let maxV = -Infinity;
  let sum = 0;

  for (let i = 0; i < sampleCount; i++) {
    const val = results[fromIndex + i].nodeVoltages[nodeId] ?? 0.0;
    values[i] = val;
    if (val < minV) minV = val;
    if (val > maxV) maxV = val;
    sum += val;
  }

  const mean = sum / sampleCount;
  let varianceSum = 0;
  for (let i = 0; i < sampleCount; i++) {
    varianceSum += (values[i] - mean) ** 2;
  }
  const stdDev = Math.sqrt(varianceSum / sampleCount);

  // Median calculation
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  // If signal is completely flat (DC)
  if (Math.abs(maxV - minV) < 1e-9) {
    return {
      binCenters: [minV],
      counts: [sampleCount],
      probabilities: [1.0],
      minV,
      maxV,
      mean,
      stdDev: 0,
      median,
      totalSamples: sampleCount,
    };
  }

  const binWidth = (maxV - minV) / binCount;
  const counts = new Array<number>(binCount).fill(0);
  const binCenters = new Array<number>(binCount);

  for (let b = 0; b < binCount; b++) {
    binCenters[b] = minV + (b + 0.5) * binWidth;
  }

  for (let i = 0; i < sampleCount; i++) {
    const val = values[i];
    let binIdx = Math.floor((val - minV) / binWidth);
    if (binIdx >= binCount) binIdx = binCount - 1;
    if (binIdx < 0) binIdx = 0;
    counts[binIdx]++;
  }

  const probabilities = counts.map((c) => c / sampleCount);

  return {
    binCenters,
    counts,
    probabilities,
    minV,
    maxV,
    mean,
    stdDev,
    median,
    totalSamples: sampleCount,
  };
}

// ==========================================================================
// 10. MASK TESTING (PASS / FAIL TOLERANCE ENVELOPE)
// ==========================================================================

export interface MaskToleranceDefinition {
  readonly referenceNodeId?: string;
  readonly centerPoints?: readonly { time: number; voltage: number }[];
  readonly deltaV: number; // Volts tolerance corridor (±)
  readonly deltaT?: number; // Time tolerance in seconds
}

export interface MaskTestResult {
  readonly passed: boolean;
  readonly totalSamples: number;
  readonly violationCount: number;
  readonly violationIndices: readonly number[];
  readonly violationPoints: readonly { time: number; voltage: number; expected: number }[];
}

export function evaluateMaskTest(
  results: readonly TimeStepResult[],
  testNodeId: string,
  mask: MaskToleranceDefinition,
  fromIndex = 0,
  toIndex?: number,
): MaskTestResult {
  const endIndex = Math.min(results.length, toIndex ?? results.length);
  const violationIndices: number[] = [];
  const violationPoints: Array<{ time: number; voltage: number; expected: number }> = [];

  let totalSamples = 0;
  for (let i = fromIndex; i < endIndex; i++) {
    const sample = results[i];
    const actualV = sample.nodeVoltages[testNodeId];
    if (actualV === undefined) continue;

    totalSamples++;
    let expectedV = 0;
    if (mask.referenceNodeId) {
      expectedV = sample.nodeVoltages[mask.referenceNodeId] ?? 0;
    } else if (mask.centerPoints && mask.centerPoints.length > 0) {
      // Find closest reference point by time
      const t = sample.time;
      let closest = mask.centerPoints[0];
      let minDiff = Math.abs(t - closest.time);
      for (let p = 1; p < mask.centerPoints.length; p++) {
        const diff = Math.abs(t - mask.centerPoints[p].time);
        if (diff < minDiff) {
          minDiff = diff;
          closest = mask.centerPoints[p];
        }
      }
      expectedV = closest.voltage;
    }

    const diff = Math.abs(actualV - expectedV);
    if (diff > mask.deltaV) {
      violationIndices.push(i);
      violationPoints.push({ time: sample.time, voltage: actualV, expected: expectedV });
    }
  }

  return {
    passed: violationIndices.length === 0,
    totalSamples,
    violationCount: violationIndices.length,
    violationIndices,
    violationPoints,
  };
}

