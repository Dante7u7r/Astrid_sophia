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
  return {
    vpp,
    vrms,
    freq: totalDuration > 0 ? crossings / totalDuration : 0,
  };
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
): TyTracePoint[] {
  if (!nodeId || results.length === 0) return [];

  const windowDuration = scale.timeDivValue * 10;
  if (windowDuration <= 0 || !Number.isFinite(windowDuration)) return [];

  const divHeight = dimensions.height / 8;
  const firstTime = results[0].time;
  const points: TyTracePoint[] = [];

  for (const pt of results) {
    const relativeTime = pt.time - firstTime;
    if (relativeTime > windowDuration) break;

    const x = (relativeTime / windowDuration) * dimensions.width;
    const v = pt.nodeVoltages[nodeId] ?? 0.0;
    const y = dimensions.height / 2 - (v / scale.voltsPerDiv) * divHeight - scale.offsetPixels;
    points.push({ x, y });
  }

  return points;
}
