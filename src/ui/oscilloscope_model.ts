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
}

export interface TraceChannelConfig {
  coupling?: "dc" | "ac" | "gnd";
  invert?: boolean;
}

export interface TyTracePoint {
  x: number;
  y: number;
}

export const OSCILLOSCOPE_VOLTS_PER_DIV = [
  0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20,
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

function buildMinMaxTrace(
  results: readonly TimeStepResult[],
  nodeId: string,
  startIndex: number,
  endIndex: number,
  maxPoints: number,
  toPoint: (sample: TimeStepResult) => TyTracePoint,
): TyTracePoint[] {
  const sampleCount = endIndex - startIndex;
  if (sampleCount <= maxPoints) {
    return results.slice(startIndex, endIndex).map(toPoint);
  }

  const bucketCount = Math.max(1, Math.floor(maxPoints / 2));
  const bucketSize = sampleCount / bucketCount;
  const points: TyTracePoint[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const from = startIndex + Math.floor(bucket * bucketSize);
    const to = Math.min(endIndex, startIndex + Math.floor((bucket + 1) * bucketSize));
    let minIndex = from;
    let maxIndex = from;
    let minValue = results[from].nodeVoltages[nodeId] ?? 0;
    let maxValue = minValue;
    for (let index = from + 1; index < to; index++) {
      const value = results[index].nodeVoltages[nodeId] ?? 0;
      if (value < minValue) {
        minValue = value;
        minIndex = index;
      }
      if (value > maxValue) {
        maxValue = value;
        maxIndex = index;
      }
    }
    if (minIndex <= maxIndex) {
      points.push(toPoint(results[minIndex]));
      if (maxIndex !== minIndex) points.push(toPoint(results[maxIndex]));
    } else {
      points.push(toPoint(results[maxIndex]), toPoint(results[minIndex]));
    }
  }
  return points;
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

  for (let i = 1; i < count; i++) {
    const v0 = results[i - 1].nodeVoltages[nodeId] ?? 0;
    const v1 = results[i].nodeVoltages[nodeId] ?? 0;
    if (v0 <= avg && v1 > avg) crossings++;
    if (v1 >= avg) {
      timeHigh += (results[i].time - results[i - 1].time);
    }
  }

  const first = results[0];
  const last = results[count - 1];
  const totalDuration = last.time - first.time;
  const freq = totalDuration > 0 ? crossings / totalDuration : 0;
  const period = freq > 0 ? 1 / freq : 0;
  const duty = totalDuration > 0 ? Math.min(100, Math.max(0, (timeHigh / totalDuration) * 100)) : 50;

  const metrics: OscilloscopeMetrics = {
    vpp,
    vrms,
    freq,
    vmax: Number.isFinite(maxV) ? maxV : 0,
    vmin: Number.isFinite(minV) ? minV : 0,
    vavg: Number.isFinite(vavg) ? vavg : 0,
    period,
    duty,
  };
  resultCache.set(cacheKey, metrics);
  return metrics;
}

export function findTriggerStartIndex(
  results: readonly TimeStepResult[],
  nodeId: string | null,
  edge: TriggerEdge,
  level: number,
  timeDivValue?: number,
): number {
  if (!nodeId || results.length <= 2) return 0;

  // Search in recent window to lock onto the live periodic signal
  const windowDuration = timeDivValue ? timeDivValue * 10 : Infinity;
  const latestTime = results[results.length - 1].time;
  const searchStartTime = Number.isFinite(windowDuration) ? Math.max(0, latestTime - windowDuration * 2.5) : 0;

  let searchStartIdx = 1;
  if (searchStartTime > 0) {
    for (let i = results.length - 1; i >= 1; i--) {
      if (results[i].time <= searchStartTime) {
        searchStartIdx = i;
        break;
      }
    }
  }

  let bestTriggerIdx = -1;
  for (let i = searchStartIdx; i < results.length; i++) {
    const v0 = results[i - 1].nodeVoltages[nodeId] ?? 0;
    const v1 = results[i].nodeVoltages[nodeId] ?? 0;
    if (edge === "rising" && v0 <= level && v1 > level) {
      bestTriggerIdx = i;
    } else if (edge === "falling" && v0 >= level && v1 < level) {
      bestTriggerIdx = i;
    }
  }

  if (bestTriggerIdx > 0) {
    return bestTriggerIdx;
  }

  // Fallback for flat DC or untriggered signal: display latest rolling window
  if (Number.isFinite(windowDuration) && windowDuration > 0) {
    const fallbackStartTime = Math.max(0, latestTime - windowDuration);
    for (let i = 0; i < results.length; i++) {
      if (results[i].time >= fallbackStartTime) {
        return i;
      }
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
  if (!nodeId || results.length === 0 || startIndex >= results.length) return [];

  const windowDuration = scale.timeDivValue * 10;
  if (windowDuration <= 0 || !Number.isFinite(windowDuration)) return [];

  const divHeight = dimensions.height / 8;
  const firstTime = results[startIndex].time;
  const endIndex = findVisibleEndIndex(results, startIndex, firstTime + windowDuration);
  const maxPoints = Math.max(64, Math.min(2_000, Math.ceil(dimensions.width * 2)));

  // Calculate average for AC coupling if requested
  let acOffset = 0;
  if (config?.coupling === "ac" && endIndex > startIndex) {
    let sum = 0;
    for (let i = startIndex; i < endIndex; i++) {
      sum += results[i].nodeVoltages[nodeId] ?? 0;
    }
    acOffset = sum / (endIndex - startIndex);
  }

  const toPoint = (pt: TimeStepResult): TyTracePoint => {
    const relativeTime = pt.time - firstTime;
    const x = Math.min(dimensions.width, (relativeTime / windowDuration) * dimensions.width);
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

  return buildMinMaxTrace(
    results,
    nodeId,
    startIndex,
    endIndex,
    maxPoints,
    toPoint,
  );
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
  for (const result of results) {
    const voltage = result.nodeVoltages[nodeId] ?? 0;
    if (!Number.isFinite(voltage)) continue;
    minVoltage = Math.min(minVoltage, voltage);
    maxVoltage = Math.max(maxVoltage, voltage);
  }
  if (!Number.isFinite(minVoltage) || !Number.isFinite(maxVoltage)) {
    return { voltsPerDiv: 1, timeDivValue: 0.02, centerVoltage: 0 };
  }

  const vSpan = maxVoltage - minVoltage;
  const requiredVoltsPerDiv = vSpan > 1e-4 ? Math.max(vSpan / 5, OSCILLOSCOPE_VOLTS_PER_DIV[0]) : 1.0;
  const voltsPerDiv = OSCILLOSCOPE_VOLTS_PER_DIV.find((value) => value >= requiredVoltsPerDiv)
    ?? OSCILLOSCOPE_VOLTS_PER_DIV[OSCILLOSCOPE_VOLTS_PER_DIV.length - 1];
  const metrics = calculateOscilloscopeMetrics(results, nodeId);
  const totalDuration = Math.max(0, results[results.length - 1].time - results[0].time);
  const desiredTimePerDiv = metrics.freq > 0
    ? 0.3 / metrics.freq
    : totalDuration > 0
      ? totalDuration / 10
      : 0.02;

  return {
    voltsPerDiv,
    timeDivValue: nearestTimePerDiv(desiredTimePerDiv),
    centerVoltage: (maxVoltage + minVoltage) / 2,
  };
}
