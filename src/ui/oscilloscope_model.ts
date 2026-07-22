import type { TimeStepResult } from "./oscilloscope_panel";

export type OscilloscopeChannel = "ch1" | "ch2" | "ch3" | "ch4";
export type TriggerEdge = "rising" | "falling";

export interface OscilloscopeMetrics {
  vpp: number;
  vrms: number;
  freq: number;
}

export interface TyTracePoint {
  x: number;
  y: number;
}

const traceCache = new WeakMap<readonly TimeStepResult[], Map<string, readonly TyTracePoint[]>>();
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
  if (results.length === 0) return { vpp: 0, vrms: 0, freq: 0 };

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
  let sumSq = 0;

  for (const pt of results) {
    const v = pt.nodeVoltages[nodeId] ?? 0;
    if (v > maxV) maxV = v;
    if (v < minV) minV = v;
    sumSq += v * v;
  }

  const vpp = maxV - minV;
  const vrms = Math.sqrt(sumSq / results.length);
  let crossings = 0;
  const avg = (maxV + minV) / 2;
  for (let i = 1; i < results.length; i++) {
    const v0 = results[i - 1].nodeVoltages[nodeId] ?? 0;
    const v1 = results[i].nodeVoltages[nodeId] ?? 0;
    if (v0 <= avg && v1 > avg) crossings++;
  }

  const first = results[0];
  const last = results[results.length - 1];
  const totalDuration = last.time - first.time;
  const metrics = {
    vpp,
    vrms,
    freq: totalDuration > 0 ? crossings / totalDuration : 0,
  };
  resultCache.set(cacheKey, metrics);
  return metrics;
}

export function findTriggerStartIndex(
  results: readonly TimeStepResult[],
  nodeId: string | null,
  edge: TriggerEdge,
  level: number,
): number {
  if (!nodeId || results.length <= 2) return 0;

  for (let i = 1; i < results.length; i++) {
    const v0 = results[i - 1].nodeVoltages[nodeId] ?? 0;
    const v1 = results[i].nodeVoltages[nodeId] ?? 0;
    if (edge === "rising" && v0 <= level && v1 > level) return i;
    if (edge === "falling" && v0 >= level && v1 < level) return i;
  }
  return 0;
}

export function buildTyTracePoints(
  results: readonly TimeStepResult[],
  nodeId: string,
  dimensions: { width: number; height: number },
  scale: { voltsPerDiv: number; offsetPixels: number; timeDivValue: number },
  startIndex = 0,
): TyTracePoint[] {
  if (!nodeId || results.length === 0 || startIndex >= results.length) return [];

  const windowDuration = scale.timeDivValue * 10;
  if (windowDuration <= 0 || !Number.isFinite(windowDuration)) return [];

  const divHeight = dimensions.height / 8;
  const firstTime = results[startIndex].time;
  const endIndex = findVisibleEndIndex(results, startIndex, firstTime + windowDuration);
  const maxPoints = Math.max(64, Math.min(4_000, Math.ceil(dimensions.width * 2)));
  let resultCache = traceCache.get(results);
  if (!resultCache) {
    resultCache = new Map();
    traceCache.set(results, resultCache);
  }
  const cacheKey = [
    nodeId,
    results.length,
    results[results.length - 1]?.time ?? 0,
    startIndex,
    endIndex,
    dimensions.width,
    dimensions.height,
    scale.voltsPerDiv,
    scale.offsetPixels,
    scale.timeDivValue,
  ].join(":");
  const cached = resultCache.get(cacheKey);
  if (cached) return [...cached];
  if (resultCache.size >= 32) resultCache.clear();

  const toPoint = (pt: TimeStepResult): TyTracePoint => {
    const relativeTime = pt.time - firstTime;
    const x = (relativeTime / windowDuration) * dimensions.width;
    const v = pt.nodeVoltages[nodeId] ?? 0.0;
    const y = dimensions.height / 2 - (v / scale.voltsPerDiv) * divHeight - scale.offsetPixels;
    return { x, y };
  };
  const points = buildMinMaxTrace(
    results,
    nodeId,
    startIndex,
    endIndex,
    maxPoints,
    toPoint,
  );
  resultCache.set(cacheKey, points);
  return points;
}
